/* ============================================================
   VibedStudio AI Video Studio — app.js
   ============================================================ */

const API_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks';

// ── State ─────────────────────────────────────────────────────
const state = {
  apiKey: localStorage.getItem('vibedstudio_api_key') || '',
  model: 'seedance-1-5-pro-251215',
  ratio: '16:9',
  duration: 5,
  generateAudio: true,
  watermark: false,
  mode: 'text',   // 'text' | 'image'
  imageFile: null,
  imageDataUrl: null,
  activeJobs: 0,   // number of in-flight jobs being polled
  jobs: [],        // { id, status, videoUrl, prompt, model, ratio, duration, timestamp }
};
window.state = state;

// ── DOM Refs ──────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const apiKeyInput = $('api-key');
const toggleKeyBtn = $('toggle-key');
const errorModal = $('error-modal');
const modalMessage = $('modal-message');
const modalTitle = $('modal-title');
const modalClose = $('modal-close');
const modalOk = $('modal-ok');
const modelGrid = $('model-grid');
const ratioGrid = $('ratio-grid');
const durationSlider = $('duration-slider');
const durationDisp = $('duration-display');
const genAudioChk = $('gen-audio');
const watermarkChk = $('watermark');
const jsonPreview = $('json-preview');
const copyJsonBtn = $('copy-json');
const jsonResponse = $('json-response');
const copyResponseBtn = $('copy-response');
const tabText = $('tab-text');
const tabImage = $('tab-image');
const textMode = $('text-mode');
const imageMode = $('image-mode');
const textPrompt = $('text-prompt');
const imagePromptTxt = $('image-prompt');
const charCount = $('char-count');
const dropZone = $('image-drop-zone');
const fileInput = $('image-file');
const dropContent = $('drop-content');
const thumbImg = $('image-preview-thumb');
const removeImgBtn = $('remove-image');
const generateBtn = $('generate-btn');
const queueBadge = $('queue-badge');
const queuePanel = $('queue-panel');
const queueList = $('queue-list');
const emptyState = $('empty-state');
const videoGrid = $('video-grid');
const toastContainer = $('toast-container');
const serverHelpBtn = $('server-help-btn');
const exportHistoryBtn = $('export-history-btn');
const importHistoryBtn = $('import-history-btn');
const importHistoryInput = $('import-history-input');

// ── Error Modal ───────────────────────────────────────────────
function showModal(title, message) {
  if (modalTitle) modalTitle.textContent = title || 'Notice';
  modalMessage.textContent = message;
  errorModal.classList.remove('hidden');
  modalOk.focus();
}

function showError(message) {
  showModal('Error', message);
}

function showServerHelp() {
  showModal(
    'Server Mode Required',
    'Images require server mode to avoid CORS errors.\n\nRun:\npython3 server.py\n\nThen open:\nhttp://localhost:8787'
  );
}
window.showServerHelp = showServerHelp;
function closeErrorModal() {
  errorModal.classList.add('hidden');
}
modalClose.addEventListener('click', closeErrorModal);
modalOk.addEventListener('click', closeErrorModal);
errorModal.addEventListener('click', e => { if (e.target === errorModal) closeErrorModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeErrorModal(); });

// ── Server Mode Gate (Images tab) ─────────────────────────────
const isServerMode = location.protocol !== 'file:' && location.origin !== 'null';
if (!isServerMode) {
  const imgTab = document.querySelector('.app-tab[data-tab="images"]');
  const editorTab = document.querySelector('.app-tab[data-tab="editor"]');
  if (imgTab) {
    imgTab.classList.add('disabled');
    imgTab.setAttribute(
      'title',
      'Images require server mode. Run: python3 server.py then open http://localhost:8787'
    );
    imgTab.setAttribute('aria-disabled', 'true');
  }
  if (editorTab) {
    editorTab.classList.add('disabled');
    editorTab.setAttribute(
      'title',
      'Editor requires server mode. Run: python3 server.py then open http://localhost:8787'
    );
    editorTab.setAttribute('aria-disabled', 'true');
  }
  if (serverHelpBtn) {
    serverHelpBtn.classList.remove('hidden');
    serverHelpBtn.addEventListener('click', showServerHelp);
  }
}

// ── Active-job counter ────────────────────────────────────────
function incrementActive() {
  state.activeJobs++;
  updateQueueUI();
}
function decrementActive() {
  state.activeJobs = Math.max(0, state.activeJobs - 1);
  updateQueueUI();
}

function updateQueueUI() {
  const n = state.activeJobs;
  // Badge on generate button
  if (n > 0) {
    queueBadge.textContent = n;
    queueBadge.classList.remove('hidden');
  } else {
    queueBadge.classList.add('hidden');
  }
  // Queue panel (shows running jobs)
  const running = state.jobs.filter(j => j.status === 'running');
  if (running.length > 0) {
    queuePanel.classList.remove('hidden');
    queueList.innerHTML = running.map(j => `
      <div class="queue-item">
        <span class="spinner sm purple"></span>
        <span class="queue-item-prompt">${escHtml(j.prompt.slice(0, 60))}${j.prompt.length > 60 ? '…' : ''}</span>
        <span class="queue-item-id">${j.id.slice(-6)}</span>
      </div>
    `).join('');
  } else {
    queuePanel.classList.add('hidden');
  }
}

// ── IndexedDB helpers (shared with images.js via window.db) ───────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('vibedstudio-db', 1);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('videos')) d.createObjectStore('videos', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('images')) d.createObjectStore('images', { keyPath: 'id' });
    };
    req.onsuccess = e => { window.db = e.target.result; resolve(); };
    req.onerror = e => reject(e.target.error);
  });
}

window.dbPut = function dbPut(store, item) {
  return new Promise((resolve, reject) => {
    const tx = window.db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

window.dbGetAll = function dbGetAll(store) {
  return new Promise((resolve, reject) => {
    const tx = window.db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

window.dbDelete = function dbDelete(store, key) {
  return new Promise((resolve, reject) => {
    const tx = window.db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

// ── Video persistence ─────────────────────────────────────────

async function saveVideoJob(job, blob) {
  if (!window.db) return;
  const record = {
    id: job.id,
    status: job.status,
    videoUrl: job.videoUrl || null,
    videoBlob: blob || null,
    prompt: job.prompt,
    model: job.model,
    ratio: job.ratio,
    duration: job.duration,
    timestamp: job.timestamp instanceof Date ? job.timestamp.toISOString() : job.timestamp,
  };
  await dbPut('videos', record).catch(e => console.warn('DB save failed:', e));
}

async function loadVideosFromDB() {
  if (!window.db) return;
  try {
    const records = await dbGetAll('videos');
    if (!records.length) return;
    records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    records.forEach(item => {
      if (item.videoBlob) item.videoUrl = URL.createObjectURL(item.videoBlob);
      item.timestamp = new Date(item.timestamp);
      state.jobs.push(item);
      renderJobCard(item);
      if (item.status === 'succeeded') updateJobCard(item.id, 'succeeded', item.videoUrl);
      else if (item.status === 'failed') updateJobCard(item.id, 'failed');
    });
    updateEmptyState();
    window.syncMediaLibrary?.();
    showToast(`Loaded ${records.length} video${records.length > 1 ? 's' : ''} from history`, 'info', '📂');
  } catch (e) {
    console.warn('Could not load video history:', e);
  }
}

// ── History export/import ────────────────────────────────────
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = meta.match(/data:(.*);base64/)?.[1] || 'application/octet-stream';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function exportVideoHistory() {
  if (!window.db) return;
  const records = await dbGetAll('videos');
  if (!records.length) {
    showToast('No video history to export', 'info', '📦');
    return;
  }

  const maxBlobSize = 8 * 1024 * 1024; // 8MB
  const videos = await Promise.all(records.map(async r => {
    const item = {
      id: r.id,
      status: r.status,
      videoUrl: r.videoUrl || null,
      prompt: r.prompt || '',
      model: r.model || '',
      ratio: r.ratio || '',
      duration: r.duration || 0,
      timestamp: r.timestamp,
    };
    if (r.videoBlob && r.videoBlob.size <= maxBlobSize) {
      try {
        item.videoBlobBase64 = await blobToDataUrl(r.videoBlob);
      } catch { item.videoBlobSkipped = true; }
    } else if (r.videoBlob) {
      item.videoBlobSkipped = true;
      item.videoBlobSize = r.videoBlob.size;
    }
    return item;
  }));

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    videos,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vibedstudio-history-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('History exported', 'success', '📦');
}

async function importVideoHistory(file) {
  if (!file || !window.db) return;
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    showToast('Invalid history file', 'error', '❌');
    return;
  }
  const list = Array.isArray(data?.videos) ? data.videos : [];
  if (!list.length) {
    showToast('No videos found in file', 'info', '📦');
    return;
  }

  let added = 0;
  let skipped = 0;
  for (const v of list) {
    const id = v.id || `import-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (state.jobs.find(j => j.id === id)) { skipped++; continue; }
    let blob = null;
    if (v.videoBlobBase64) {
      try { blob = dataUrlToBlob(v.videoBlobBase64); } catch { blob = null; }
    }
    const status = v.status || ((v.videoUrl || blob) ? 'succeeded' : 'failed');
    const record = {
      id,
      status,
      videoUrl: v.videoUrl || null,
      videoBlob: blob,
      prompt: v.prompt || '',
      model: v.model || state.model,
      ratio: v.ratio || state.ratio,
      duration: v.duration || 5,
      timestamp: v.timestamp || new Date().toISOString(),
    };
    await dbPut('videos', record).catch(() => { });
    record.timestamp = new Date(record.timestamp);
    if (record.videoBlob) record.videoUrl = URL.createObjectURL(record.videoBlob);
    state.jobs.push(record);
    renderJobCard(record);
    if (record.status === 'succeeded' && record.videoUrl) updateJobCard(record.id, 'succeeded', record.videoUrl);
    else if (record.status === 'failed') updateJobCard(record.id, 'failed');
    added++;
  }
  updateEmptyState();
  window.syncMediaLibrary?.();
  showToast(`Imported ${added} video${added !== 1 ? 's' : ''}${skipped ? ` (${skipped} skipped)` : ''}`, 'success', '📥');
}

function deleteJob(id) {
  state.jobs = state.jobs.filter(j => j.id !== id);
  if (window.db) dbDelete('videos', id).catch(() => { });
  const card = $(`card-${id}`);
  if (card) {
    card.style.transition = 'opacity 0.25s, transform 0.25s';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.95)';
    setTimeout(() => { card.remove(); updateEmptyState(); }, 260);
  }
}
window.deleteJob = deleteJob;

function autoDownload(url, taskId) {
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `vibedstudio-${taskId.slice(-10)}.mp4`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Video auto-saved to Downloads', 'success', '📁');
  } catch (e) { console.warn('Auto-download failed:', e); }
}

async function init() {
  if (state.apiKey) { apiKeyInput.value = state.apiKey; updateHakDot(); }
  updateJsonPreview();
  setResponsePreview({ status: 'idle' });
  await openDB();
  await loadVideosFromDB();
}

if (exportHistoryBtn) {
  exportHistoryBtn.addEventListener('click', () => {
    exportVideoHistory().catch(e => {
      console.warn('Export history failed:', e);
      showToast('Export failed', 'error', '❌');
    });
  });
}

if (importHistoryBtn && importHistoryInput) {
  importHistoryBtn.addEventListener('click', () => importHistoryInput.click());
  importHistoryInput.addEventListener('change', async () => {
    const file = importHistoryInput.files?.[0];
    if (file) await importVideoHistory(file);
    importHistoryInput.value = '';
  });
}

// ── API Key ───────────────────────────────────────────────────
apiKeyInput.addEventListener('input', () => {
  state.apiKey = apiKeyInput.value.trim();
  localStorage.setItem('vibedstudio_api_key', state.apiKey);
  updateHakDot();
});

function updateHakDot() {
  const dot = $('hak-dot');
  if (!dot) return;
  dot.style.background = state.apiKey ? 'var(--green, #22c55e)' : 'var(--red, #ef4444)';
  dot.style.opacity = state.apiKey ? '1' : '0.5';
}

// Widget open/close
const hakWidget = $('hak-widget');
const hakTrigger = $('hak-trigger');
const hakPanel = $('hak-panel');

if (hakTrigger) {
  hakTrigger.addEventListener('click', () => {
    const open = hakWidget.classList.toggle('open');
    if (open) apiKeyInput.focus();
  });
  document.addEventListener('click', e => {
    if (!hakWidget.contains(e.target)) hakWidget.classList.remove('open');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hakWidget.classList.remove('open');
  });
}

toggleKeyBtn.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  $('eye-icon').innerHTML = isPassword
    ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1L23 23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`
    : `<path d="M1 12C1 12 5 4 12 4C19 4 23 12 23 12C23 12 19 20 12 20C5 20 1 12 1 12Z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>`;
});


// ── Model Selection ───────────────────────────────────────────
modelGrid.addEventListener('click', e => {
  const card = e.target.closest('.model-card');
  if (!card) return;
  document.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  state.model = card.dataset.model;
  card.querySelector('input[type="radio"]').checked = true;
  updateJsonPreview();
});

// ── Ratio ─────────────────────────────────────────────────────
ratioGrid.addEventListener('click', e => {
  const btn = e.target.closest('.ratio-btn');
  if (!btn) return;
  document.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  state.ratio = btn.dataset.ratio;
  updateJsonPreview();
});

// ── Duration ──────────────────────────────────────────────────
durationSlider.addEventListener('input', () => {
  state.duration = parseInt(durationSlider.value);
  durationDisp.textContent = `${state.duration}s`;
  updateJsonPreview();
});

// ── Toggles ───────────────────────────────────────────────────
genAudioChk.addEventListener('change', () => {
  state.generateAudio = genAudioChk.checked;
  updateJsonPreview();
});
watermarkChk.addEventListener('change', () => {
  state.watermark = watermarkChk.checked;
  updateJsonPreview();
});

// ── Mode Tabs ─────────────────────────────────────────────────
tabText.addEventListener('click', () => setMode('text'));
tabImage.addEventListener('click', () => setMode('image'));

function setMode(mode) {
  state.mode = mode;
  tabText.classList.toggle('active', mode === 'text');
  tabImage.classList.toggle('active', mode === 'image');
  textMode.classList.toggle('hidden', mode !== 'text');
  imageMode.classList.toggle('hidden', mode !== 'image');
  updateJsonPreview();
}

// ── Textarea char count ───────────────────────────────────────
textPrompt.addEventListener('input', () => {
  charCount.textContent = textPrompt.value.length;
  updateJsonPreview();
});
imagePromptTxt.addEventListener('input', () => updateJsonPreview());

// ── Image Drop Zone ───────────────────────────────────────────
dropZone.addEventListener('click', e => {
  if (e.target === removeImgBtn || removeImgBtn.contains(e.target)) return;
  if (!state.imageDataUrl) fileInput.click();
});

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadImageFile(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadImageFile(fileInput.files[0]);
});

removeImgBtn.addEventListener('click', e => {
  e.stopPropagation();
  clearImage();
});

function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    state.imageDataUrl = ev.target.result;
    state.imageFile = file;
    thumbImg.src = ev.target.result;
    thumbImg.classList.remove('hidden');
    dropContent.classList.add('hidden');
    removeImgBtn.classList.remove('hidden');
    updateJsonPreview();
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  state.imageDataUrl = null;
  state.imageFile = null;
  thumbImg.src = '';
  thumbImg.classList.add('hidden');
  dropContent.classList.remove('hidden');
  removeImgBtn.classList.add('hidden');
  fileInput.value = '';
  updateJsonPreview();
}

// ── JSON Preview ──────────────────────────────────────────────
function buildPayload() {
  const content = [];
  if (state.mode === 'text') {
    const prompt = textPrompt.value.trim();
    if (prompt) content.push({ type: 'text', text: prompt });
    else content.push({ type: 'text', text: '(your prompt here)' });
  } else {
    if (state.imageDataUrl) {
      content.push({ type: 'image_url', image_url: { url: '(base64 data...)' } });
    } else {
      content.push({ type: 'image_url', image_url: { url: '(image URL or base64)' } });
    }
    const imgPrompt = imagePromptTxt.value.trim();
    if (imgPrompt) content.push({ type: 'text', text: imgPrompt });
  }
  return {
    model: state.model,
    content,
    ratio: state.ratio,
    duration: state.duration,
    generate_audio: state.generateAudio,
    watermark: state.watermark,
  };
}

function updateJsonPreview() {
  const payload = buildPayload();
  jsonPreview.textContent = JSON.stringify(payload, null, 2);
}

copyJsonBtn.addEventListener('click', () => {
  const payload = buildPayload();
  navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => {
    showToast('JSON copied to clipboard', 'success', '📋');
  });
});

function setResponsePreview(payload) {
  if (!jsonResponse) return;
  jsonResponse.textContent = JSON.stringify(payload, null, 2);
}

if (copyResponseBtn) {
  copyResponseBtn.addEventListener('click', () => {
    const text = jsonResponse?.textContent || '';
    navigator.clipboard.writeText(text).then(() => {
      showToast('Response copied to clipboard', 'success', '📋');
    });
  });
}

// ── Generate ──────────────────────────────────────────────────
generateBtn.addEventListener('click', handleGenerate);

async function handleGenerate() {
  // Validation
  if (!state.apiKey) {
    showError('No API key found.\n\nPlease paste your BytePlus API key into the Authentication field on the left before generating.');
    $('api-key').focus();
    return;
  }

  const promptText = state.mode === 'text' ? textPrompt.value.trim() : imagePromptTxt.value.trim();
  if (state.mode === 'image' && !state.imageDataUrl) {
    showError('No image selected.\n\nPlease upload an image before generating in Image-to-Video mode.');
    return;
  }
  if (state.mode === 'text' && !promptText) {
    showError('No prompt entered.\n\nPlease describe the video you want to generate in the text box.');
    textPrompt.focus();
    return;
  }

  // Snapshot current settings (so queuing multiple with different params works)
  const jobConfig = {
    model: state.model,
    ratio: state.ratio,
    duration: state.duration,
    generateAudio: state.generateAudio,
    watermark: state.watermark,
    mode: state.mode,
    promptText,
    imageDataUrl: state.imageDataUrl,
  };

  // Visual pulse on the button to acknowledge the queue
  generateBtn.classList.add('btn-queued');
  setTimeout(() => generateBtn.classList.remove('btn-queued'), 600);

  // Build actual content array
  const content = [];
  if (jobConfig.mode === 'text') {
    content.push({ type: 'text', text: jobConfig.promptText });
  } else {
    content.push({ type: 'image_url', image_url: { url: jobConfig.imageDataUrl } });
    if (jobConfig.promptText) content.push({ type: 'text', text: jobConfig.promptText });
  }

  const body = {
    model: jobConfig.model,
    content,
    ratio: jobConfig.ratio,
    duration: jobConfig.duration,
    generate_audio: jobConfig.generateAudio,
    watermark: jobConfig.watermark,
  };

  incrementActive();

  let responseSet = false;
  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const headers = Object.fromEntries(res.headers.entries());
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = { message: 'Non-JSON response body' };
    }

    if (!res.ok) {
      setResponsePreview({
        ok: false,
        status: res.status,
        statusText: res.statusText,
        headers,
        body: payload,
      });
      responseSet = true;
      throw new Error(payload?.message || payload?.error?.message || `HTTP ${res.status}`);
    }

    setResponsePreview({
      ok: true,
      status: res.status,
      statusText: res.statusText,
      headers,
      body: payload,
    });
    responseSet = true;

    const taskId = payload.id;
    if (!taskId) throw new Error('No task ID returned from API');

    showToast(`Queued #${state.activeJobs}: …${taskId.slice(-6)}`, 'info', '🎬');

    // Add job record
    const job = {
      id: taskId,
      status: 'running',
      videoUrl: null,
      prompt: jobConfig.mode === 'text' ? jobConfig.promptText : (jobConfig.promptText || '[Image-to-Video]'),
      model: jobConfig.model,
      ratio: jobConfig.ratio,
      duration: jobConfig.duration,
      timestamp: new Date(),
    };
    state.jobs.unshift(job);
    renderJobCard(job);
    updateEmptyState();
    updateQueueUI();

    // Start polling — each job is independent
    pollJob(taskId);

  } catch (err) {
    console.error(err);
    decrementActive();
    if (!responseSet) {
      setResponsePreview({ ok: false, error: err.message || String(err) });
    }
    showError(`Failed to create video generation task:\n\n${err.message}`);
  }
}

// ── Polling — one interval per job ───────────────────────────
function pollJob(taskId) {
  let elapsed = 0;

  const interval = setInterval(async () => {
    elapsed += 8;

    // Update that job's card timer
    const timerEl = $(`timer-${taskId}`);
    if (timerEl) {
      const s = elapsed % 60;
      const m = Math.floor(elapsed / 60);
      timerEl.textContent = m > 0 ? `${m}m ${s}s` : `${s}s`;
    }

    try {
      const res = await fetch(`${API_BASE}/${taskId}`, {
        headers: { 'Authorization': `Bearer ${state.apiKey}` },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const status = data.status;
      const job = state.jobs.find(j => j.id === taskId);

      if (status === 'succeeded') {
        clearInterval(interval);
        const videoUrl = data.content?.video_url;
        if (job) { job.status = 'succeeded'; job.videoUrl = videoUrl; }
        updateJobCard(taskId, 'succeeded', videoUrl);
        // Fetch blob for offline storage (may fail due to CORS; that's OK)
        let blob = null;
        if (videoUrl) {
          try { const r = await fetch(videoUrl); blob = await r.blob(); } catch (_) { }
        }
        saveVideoJob(job || { id: taskId, status: 'succeeded', videoUrl, prompt: '', model: state.model, ratio: state.ratio, duration: state.duration, timestamp: new Date() }, blob);
        window.syncMediaLibrary?.();
        autoDownload(videoUrl, taskId);
        decrementActive();
        showToast('✅ Video ready!', 'success', '🎉');

      } else if (status === 'failed') {
        clearInterval(interval);
        if (job) job.status = 'failed';
        updateJobCard(taskId, 'failed');
        saveVideoJob(job || { id: taskId, status: 'failed', videoUrl: null, prompt: '', model: state.model, ratio: state.ratio, duration: state.duration, timestamp: new Date() }, null);
        decrementActive();
        showError(`Video generation failed.\n\nTask ID: ${taskId}\n\nThis may be due to your prompt, input image, or an API issue. Please adjust your settings and try again.`);

      } else if (status === 'expired') {
        clearInterval(interval);
        if (job) job.status = 'failed';
        updateJobCard(taskId, 'failed');
        saveVideoJob(job || { id: taskId, status: 'failed', videoUrl: null, prompt: '', model: state.model, ratio: state.ratio, duration: state.duration, timestamp: new Date() }, null);
        decrementActive();
        showError(`Task expired before completing.\n\nTask ID: ${taskId}\n\nThe video took too long to generate. Please try again with a shorter duration or simpler prompt.`);
      }
      // else: still running, keep polling

    } catch (err) {
      console.error('Poll error:', err);
    }
  }, 8000);
}

// ── Video Cards ───────────────────────────────────────────────
function updateEmptyState() {
  emptyState.classList.toggle('hidden', state.jobs.length > 0);
}

function renderJobCard(job) {
  const card = document.createElement('div');
  card.className = 'video-card';
  card.id = `card-${job.id}`;

  const modelShort = job.model.split('-').slice(0, 3).join(' ');
  const timeStr = job.timestamp instanceof Date
    ? job.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : new Date(job.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  card.innerHTML = `
    <div class="video-card-thumb" id="thumb-${job.id}">
      <div class="card-status" id="status-overlay-${job.id}">
        <span class="spinner purple"></span>
        <span class="card-status-text">Generating…</span>
        <span class="card-timer" id="timer-${job.id}">0s</span>
      </div>
    </div>
    <div class="video-card-info">
      <div class="card-meta">
        <span class="card-tag">${escHtml(modelShort)}</span>
        <span class="card-tag blue">${job.ratio}</span>
        <span class="card-tag cyan">${job.duration}s</span>
        <span class="card-tag" style="margin-left:auto; opacity:0.6;">${timeStr}</span>
        <button class="card-delete-btn" onclick="deleteJob('${job.id}')" title="Delete from history">
          <svg viewBox="0 0 24 24" fill="none"><path d="M3 6H21M8 6V4H16V6M19 6L18 20H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <p class="card-prompt">${escHtml(job.prompt)}</p>
      <div class="card-actions" id="actions-${job.id}">
        <button class="card-btn" disabled style="flex:1; opacity:0.4; cursor:default;">
          <span class="spinner sm purple"></span>
          Generating…
        </button>
      </div>
    </div>
  `;

  videoGrid.insertBefore(card, videoGrid.firstChild);
}

function updateJobCard(taskId, status, videoUrl) {
  const thumbEl = $(`thumb-${taskId}`);
  const overlayEl = $(`status-overlay-${taskId}`);
  const actionsEl = $(`actions-${taskId}`);
  if (!thumbEl) return;

  if (status === 'succeeded' && videoUrl) {
    overlayEl.classList.add('succeeded');

    const video = document.createElement('video');
    video.src = videoUrl;
    video.controls = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'metadata';
    thumbEl.appendChild(video);

    actionsEl.innerHTML = `
      <a class="card-btn primary" href="${escHtml(videoUrl)}" target="_blank" rel="noopener" download>
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 2V17M12 17L7 12M12 17L17 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 20H21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Download
      </a>
      <button class="card-btn" onclick="copyVideoUrl('${escHtml(videoUrl)}')">
        <svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4C2.895 15 2 14.105 2 13V4C2 2.895 2 4 4 2H13C14.105 2 15 2.895 15 4V5" stroke="currentColor" stroke-width="2"/></svg>
        Copy URL
      </button>
    `;

    const card = $(`card-${taskId}`);
    if (card) {
      card.style.borderColor = 'rgba(16,185,129,0.3)';
      const meta = card.querySelector('.card-meta');
      const tag = document.createElement('span');
      tag.className = 'card-tag green';
      tag.textContent = '✓ Done';
      meta.appendChild(tag);
    }

  } else if (status === 'failed') {
    overlayEl.innerHTML = `
      <div class="status-icon">✕</div>
      <span class="card-status-text" style="color: var(--red);">Generation failed</span>
    `;
    overlayEl.classList.add('failed');
    actionsEl.innerHTML = `<span style="font-size:12px;color:var(--red);padding:6px 0;">Task failed or expired</span>`;
    const card = $(`card-${taskId}`);
    if (card) card.style.borderColor = 'rgba(239,68,68,0.3)';
  }

  updateQueueUI();
}

function copyVideoUrl(url) {
  navigator.clipboard.writeText(url).then(() => showToast('Video URL copied!', 'success', '📋'));
}
window.copyVideoUrl = copyVideoUrl;

// ── Toast ─────────────────────────────────────────────────────
function showToast(message, type = 'info', icon = 'ℹ️') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${message}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.4s'; }, 3500);
  setTimeout(() => toast.remove(), 4000);
}

// ── Utils ─────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Keyboard shortcut: Cmd/Ctrl + Enter to generate ──────────
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    generateBtn.click();
  }
});

// ── Run ───────────────────────────────────────────────────────
init();
