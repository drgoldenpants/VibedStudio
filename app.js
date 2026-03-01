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
  resolution: '720p',
  returnLastFrame: true,
  serviceTier: 'flex',
  generateAudio: true,
  watermark: false,
  cameraFixed: false,
  seed: null,
  currency: localStorage.getItem('vibedstudio_currency') || 'USD',
  currencyRates: JSON.parse(localStorage.getItem('vibedstudio_currency_rates') || '{}'),
  currencyRatesUpdatedAt: parseInt(localStorage.getItem('vibedstudio_currency_rates_updated') || '0', 10) || 0,
  draft: false,
  mode: 'text',   // 'text' | 'image' | 'frames'
  imageFile: null,
  imageDataUrl: null,
  firstFrameFile: null,
  firstFrameDataUrl: null,
  lastFrameFile: null,
  lastFrameDataUrl: null,
  referenceImages: [], // [{ id, name, dataUrl }]
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
const durationMinLabel = $('duration-min-label');
const durationMaxLabel = $('duration-max-label');
const resolutionGrid = $('resolution-grid');
const returnLastFrameChk = $('return-last-frame');
const serviceTierRow = $('service-tier-row');
const genAudioChk = $('gen-audio');
const watermarkChk = $('watermark');
const cameraFixedChk = $('camera-fixed');
const seedInput = $('seed-input');
const seedDisplay = $('seed-display');
const jsonPreview = $('json-preview');
const copyJsonBtn = $('copy-json');
const jsonResponse = $('json-response');
const copyResponseBtn = $('copy-response');
const tabText = $('tab-text');
const tabImage = $('tab-image');
const tabReference = $('tab-reference');
const textMode = $('text-mode');
const imageMode = $('image-mode');
const referenceMode = $('reference-mode');
const textPrompt = $('text-prompt');
const imagePromptTxt = $('image-prompt');
const referencePromptEditor = $('reference-prompt-editor');
const charCount = $('char-count');
const refCharCount = $('ref-char-count');
const textTokenCountEl = $('text-token-count');
const imageTokenCountEl = $('image-token-count');
const refTokenCountEl = $('ref-token-count');
const dropZone = $('image-drop-zone');
const fileInput = $('image-file');
const dropContent = $('drop-content');
const removeImgBtn = $('remove-image');
const referenceDeck = $('reference-deck');
const referenceAddBtn = $('reference-add');
const referenceInput = $('reference-input');
const referenceMentionMenu = $('reference-mention-menu');
const referenceHeader = $('reference-header');
const generateBtn = $('generate-btn');
const queueBadge = $('queue-badge');
const emptyState = $('empty-state');
const videoGrid = $('video-grid');
const toastContainer = $('toast-container');
const serverHelpBtn = $('server-help-btn');
const exportHistoryBtn = $('export-history-btn');
const importHistoryBtn = $('import-history-btn');
const importHistoryInput = $('import-history-input');
const toggleControlsBtn = $('toggle-controls');
const controlsTab = $('controls-tab');
const pillModel = $('pill-model');
const pillRatio = $('pill-ratio');
const pillDuration = $('pill-duration');
const pillFrames = $('pill-frames');
const pillTokens = $('pill-tokens');
const pillCost = $('pill-cost');
const currencySelect = $('currency-select');
const draftToggle = $('draft-toggle');
const draftChip = $('draft-chip');
const firstFrameBtn = $('frame-first');
const lastFrameBtn = $('frame-last');
const firstFrameInput = $('first-frame-input');
const lastFrameInput = $('last-frame-input');
const firstFrameThumb = $('frame-first-thumb');
const lastFrameThumb = $('frame-last-thumb');
const firstFrameRemove = $('frame-first-remove');
const lastFrameRemove = $('frame-last-remove');
let listSyncTimer = null;
let listSyncInFlight = false;
const activePolls = new Map();

function getProxiedVideoUrl(videoUrl) {
  if (!videoUrl) return videoUrl;
  if (location.protocol !== 'file:' && location.origin !== 'null') {
    return `/api/video?url=${encodeURIComponent(videoUrl)}`;
  }
  return videoUrl;
}

function setRatioValue(value, { silent = false } = {}) {
  if (!value) return;
  state.ratio = value;
  if (ratioGrid) {
    ratioGrid.querySelectorAll('.ratio-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.ratio === value);
    });
  }
  if (!silent) updateJsonPreview();
}

const LITE_MODEL = 'seedance-1-0-lite';
const LITE_T2V_MODEL = 'seedance-1-0-lite-t2v-250428';
const LITE_I2V_MODEL = 'seedance-1-0-lite-i2v-250428';
const MAX_REFERENCE_IMAGES = 4;

const MODEL_CAPS = {
  'seedance-1-5-pro-251215': { text: true, image: true, frames: true, reference: false, draft: true, resolutions: ['480p', '720p', '1080p'], duration: { min: 4, max: 12 } },
  'seedance-1-0-pro-250528': { text: true, image: true, frames: true, reference: false, draft: false, resolutions: ['480p', '720p', '1080p'], duration: { min: 2, max: 12 } },
  'seedance-1-0-pro-fast-251015': { text: true, image: true, frames: true, reference: false, draft: false, resolutions: ['480p', '720p', '1080p'], duration: { min: 2, max: 12 } },
  [LITE_MODEL]: { text: true, image: true, frames: true, reference: true, draft: false, resolutions: ['480p', '720p'], duration: { min: 2, max: 12 } },
  [LITE_T2V_MODEL]: { text: true, image: false, frames: false, reference: false, draft: false, resolutions: ['480p', '720p'], duration: { min: 2, max: 12 } },
  [LITE_I2V_MODEL]: { text: false, image: true, frames: true, reference: true, draft: false, resolutions: ['480p', '720p'], duration: { min: 2, max: 12 } },
};

function getModelCaps(model) {
  return MODEL_CAPS[model] || { text: true, image: true, frames: true };
}

function resolveModelId(model, mode) {
  if (model === LITE_MODEL || model === LITE_T2V_MODEL || model === LITE_I2V_MODEL) {
    if (mode === 'reference') return LITE_I2V_MODEL;
    if (mode === 'image' || mode === 'frames') return LITE_I2V_MODEL;
    if (mode === 'text') return LITE_T2V_MODEL;
  }
  return model;
}


function formatTokenCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 10e6 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return `${Math.round(n)}`;
}

const CURRENCY_LIST = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD'];
const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  AUD: 'A$',
  CAD: 'C$',
};
const RATE_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const RATE_ENDPOINT = `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${CURRENCY_LIST.filter(c => c !== 'USD').join(',')}`;
const TOKENIZE_ENDPOINT = 'https://ark.ap-southeast.bytepluses.com/api/v3/tokenization';

function getModelPricing(model, { generateAudio = true, serviceTier = 'default' } = {}) {
  const resolved = resolveModelId(model, state.mode);
  const isFlex = serviceTier === 'flex';
  if (resolved.startsWith('seedance-1-5-pro')) {
    if (generateAudio) return isFlex ? 1.2 : 2.4;
    return isFlex ? 0.6 : 1.2;
  }
  if (resolved.startsWith('seedance-1-0-pro-fast')) return isFlex ? 0.5 : 1.0;
  if (resolved.startsWith('seedance-1-0-pro')) return isFlex ? 1.25 : 2.5;
  if (resolved.startsWith('seedance-1-0-lite')) return isFlex ? 0.9 : 1.8;
  return 0;
}

const DIMS_SEEDANCE_15 = {
  '480p': {
    '16:9': [864, 496],
    '21:9': [992, 432],
    '4:3': [752, 560],
    '3:4': [560, 752],
    '1:1': [640, 640],
    'adaptive': [864, 496],
  },
  '720p': {
    '16:9': [1280, 720],
    '21:9': [1470, 630],
    '4:3': [1112, 834],
    '3:4': [834, 1112],
    '1:1': [960, 960],
    'adaptive': [1280, 720],
  },
  '1080p': {
    '16:9': [1920, 1080],
    '21:9': [2206, 946],
    '4:3': [1664, 1248],
    '3:4': [1248, 1664],
    '1:1': [1440, 1440],
    'adaptive': [1920, 1080],
  },
};

const DIMS_SEEDANCE_10 = {
  '480p': {
    '16:9': [864, 480],
    '21:9': [960, 416],
    '4:3': [736, 544],
    '1:1': [640, 640],
    'adaptive': [864, 480],
  },
  '720p': {
    '16:9': [1248, 704],
    '21:9': [1504, 640],
    '4:3': [1120, 832],
    '1:1': [960, 960],
    'adaptive': [1248, 704],
  },
  '1080p': {
    '16:9': [1920, 1088],
    '21:9': [2176, 928],
    '4:3': [1664, 1248],
    '1:1': [1440, 1440],
    'adaptive': [1920, 1088],
  },
};

function getDimsForModel(model, resolution, ratio) {
  const resolved = resolveModelId(model, state.mode);
  const base = resolved.startsWith('seedance-1-5-pro') ? DIMS_SEEDANCE_15 : DIMS_SEEDANCE_10;
  const dimsByRes = base[resolution] || base['720p'];
  if (dimsByRes[ratio]) return dimsByRes[ratio];
  if (ratio === '3:4') {
    const swap = dimsByRes['4:3'];
    if (swap) return [swap[1], swap[0]];
  }
  return dimsByRes['16:9'];
}

function estimateTokenCount({ model, resolution, ratio, duration, draft, generateAudio }) {
  if (!duration) return null;
  const dims = getDimsForModel(model || state.model, resolution, ratio);
  const [w, h] = dims;
  const fps = 24;
  let tokens = (w * h * fps * duration) / 1024;
  if (draft) {
    tokens *= (generateAudio ? 0.6 : 0.7);
  }
  return Math.max(0, Math.round(tokens));
}

function getCurrencyRate(code) {
  if (code === 'USD') return 1;
  const rate = state.currencyRates?.[code];
  const n = Number(rate);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatCurrency(amount, code) {
  if (!Number.isFinite(amount)) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amount);
  } catch {
    const symbol = CURRENCY_SYMBOLS[code] || '';
    return `${symbol}${amount.toFixed(2)} ${code}`;
  }
}

async function refreshCurrencyRates({ force = false } = {}) {
  const now = Date.now();
  if (!force && state.currencyRatesUpdatedAt && now - state.currencyRatesUpdatedAt < RATE_CACHE_TTL_MS) return;
  try {
    const res = await fetch(RATE_ENDPOINT);
    if (!res.ok) throw new Error(`Rate fetch failed: ${res.status}`);
    const data = await res.json();
    if (!data || !data.rates) throw new Error('Invalid rate payload');
    state.currencyRates = { ...data.rates, USD: 1 };
    state.currencyRatesUpdatedAt = now;
    localStorage.setItem('vibedstudio_currency_rates', JSON.stringify(state.currencyRates));
    localStorage.setItem('vibedstudio_currency_rates_updated', String(state.currencyRatesUpdatedAt));
    updateJsonPreview();
  } catch (e) {
    console.warn('Failed to refresh currency rates:', e);
  }
}

const tokenizationState = {
  timers: {},
  controllers: {},
};

function setTokenCount(target, value) {
  const el = target === 'image' ? imageTokenCountEl : target === 'reference' ? refTokenCountEl : textTokenCountEl;
  if (!el) return;
  el.textContent = value == null ? '—' : String(value);
}

function scheduleTokenization(text, target) {
  if (!text || !text.trim()) {
    setTokenCount(target, '—');
    return;
  }
  if (!state.apiKey) {
    setTokenCount(target, '—');
    return;
  }
  if (tokenizationState.timers[target]) clearTimeout(tokenizationState.timers[target]);
  tokenizationState.timers[target] = setTimeout(() => {
    runTokenization(text, target);
  }, 500);
}

async function runTokenization(text, target) {
  const previous = tokenizationState.controllers[target];
  if (previous) previous.abort();
  const controller = new AbortController();
  tokenizationState.controllers[target] = controller;
  try {
    const res = await fetch(TOKENIZE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.apiKey}`,
      },
      body: JSON.stringify({
        model: resolveModelId(state.model, state.mode),
        text,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const first = data?.data?.[0];
    const total = first?.total_tokens ?? first?.totalTokens ?? null;
    setTokenCount(target, Number.isFinite(total) ? total : '—');
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.warn('Tokenization failed:', e);
    setTokenCount(target, '—');
  }
}

function estimateCost(tokensEstimate, { model, generateAudio, serviceTier } = {}) {
  if (!tokensEstimate) return { value: null, reason: 'missing' };
  const pricePerM = getModelPricing(model || state.model, { generateAudio, serviceTier });
  if (!pricePerM) return { value: null, reason: 'missing' };
  const costUsd = (tokensEstimate / 1e6) * pricePerM;
  const rate = getCurrencyRate(state.currency);
  if (!rate) return { value: null, reason: 'rate_unavailable', costUsd };
  return { value: costUsd * rate, costUsd };
}

function extractTokensUsed(payload) {
  const usage = payload?.usage || payload?.data?.usage || payload?.result?.usage || payload?.output?.usage || null;
  if (!usage) return null;
  const raw = usage.total_tokens ?? usage.completion_tokens ?? usage.tokens ?? null;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function extractLastFrameUrl(payload) {
  return (
    payload?.content?.last_frame_url ||
    payload?.content?.lastFrameUrl ||
    payload?.last_frame_url ||
    payload?.lastFrameUrl ||
    payload?.output?.last_frame_url ||
    payload?.result?.last_frame_url ||
    null
  );
}

function getReferencePromptText() {
  if (!referencePromptEditor) return '';
  const walker = document.createTreeWalker(referencePromptEditor, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let out = '';
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node;
      if (el.classList?.contains('ref-chip')) {
        out += el.dataset.token || '';
      } else if (el.tagName === 'BR') {
        out += '\n';
      }
    }
    node = walker.nextNode();
  }
  return out.replace(/\s+/g, ' ').trim();
}

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
  if (imgTab) {
    imgTab.classList.add('disabled');
    imgTab.setAttribute(
      'title',
      'Images require server mode. Run: python3 server.py then open http://localhost:8787'
    );
    imgTab.setAttribute('aria-disabled', 'true');
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
  // Queue panel removed
}

function formatElapsed(seconds) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const s = safe % 60;
  const m = Math.floor(safe / 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
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

async function ensureDBReady() {
  if (window.db) return true;
  try {
    await openDB();
    return true;
  } catch (e) {
    console.warn('IndexedDB unavailable:', e);
    showToast('History is unavailable in this mode. Use server mode (http://localhost:8787).', 'error', '⚠️');
    return false;
  }
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
    thumbDataUrl: job.thumbDataUrl || null,
    thumbDisabled: !!job.thumbDisabled,
    draft: !!job.draft,
    mode: job.mode || 'text',
    draftTaskId: job.draftTaskId || null,
    promptText: job.promptText || '',
    imageDataUrl: job.imageDataUrl || null,
    firstFrameDataUrl: job.firstFrameDataUrl || null,
    lastFrameDataUrl: job.lastFrameDataUrl || null,
    referenceImages: job.referenceImages || [],
    generateAudio: !!job.generateAudio,
    watermark: !!job.watermark,
    prompt: job.prompt,
    model: job.model,
    ratio: job.ratio,
    duration: job.duration,
    resolution: job.resolution || null,
    returnLastFrame: !!job.returnLastFrame,
    serviceTier: job.serviceTier || 'default',
    tokensUsed: job.tokensUsed ?? null,
    tokensEstimate: job.tokensEstimate ?? null,
    lastFrameUrl: job.lastFrameUrl || null,
    cameraFixed: !!job.cameraFixed,
    seed: job.seed ?? null,
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
      if (item.status === 'running') {
        item._pollElapsed = Math.floor((Date.now() - item.timestamp.getTime()) / 1000);
      }
      item.thumbDisabled = !!item.thumbDisabled;
      state.jobs.push(item);
      renderJobCard(item);
      if (item.status === 'succeeded') updateJobCard(item.id, 'succeeded', item.videoUrl);
      else if (item.status === 'failed') updateJobCard(item.id, 'failed');
      else if (item.status === 'running') {
        const elapsed = Math.floor((Date.now() - item.timestamp.getTime()) / 1000);
        pollJob(item.id, { initialElapsed: Math.max(0, elapsed) });
      }
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
  if (!(await ensureDBReady())) return;
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
        thumbDataUrl: r.thumbDataUrl || null,
        prompt: r.prompt || '',
        model: r.model || '',
        ratio: r.ratio || '',
        duration: r.duration || 0,
        resolution: r.resolution || null,
        returnLastFrame: !!r.returnLastFrame,
        serviceTier: r.serviceTier || 'default',
        draft: !!r.draft,
        mode: r.mode || 'text',
        draftTaskId: r.draftTaskId || null,
        promptText: r.promptText || '',
        imageDataUrl: r.imageDataUrl || null,
        firstFrameDataUrl: r.firstFrameDataUrl || null,
        lastFrameDataUrl: r.lastFrameDataUrl || null,
        generateAudio: !!r.generateAudio,
        watermark: !!r.watermark,
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
  if (!file) return;
  if (!(await ensureDBReady())) return;
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
      thumbDataUrl: v.thumbDataUrl || null,
      prompt: v.prompt || '',
      model: v.model || state.model,
      ratio: v.ratio || state.ratio,
      duration: v.duration || 5,
      resolution: v.resolution || null,
      returnLastFrame: !!v.returnLastFrame,
      serviceTier: v.serviceTier || 'default',
      draft: !!v.draft,
      mode: v.mode || 'text',
      draftTaskId: v.draftTaskId || null,
      promptText: v.promptText || '',
      imageDataUrl: v.imageDataUrl || null,
      firstFrameDataUrl: v.firstFrameDataUrl || null,
      lastFrameDataUrl: v.lastFrameDataUrl || null,
      generateAudio: !!v.generateAudio,
      watermark: !!v.watermark,
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

async function cancelGeneration(taskId) {
  if (!taskId) return;
  try {
    const res = await fetch(`${API_BASE}/${taskId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.apiKey}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    if (activePolls.has(taskId)) {
      clearInterval(activePolls.get(taskId));
      activePolls.delete(taskId);
    }
    const job = state.jobs.find(j => j.id === taskId);
    if (job) job.status = 'failed';
    updateJobCard(taskId, 'failed');
    saveVideoJob(job || buildFallbackJob(taskId, 'failed', null), null);
    decrementActive();
    showToast('Generation canceled', 'info', '🛑');
  } catch (e) {
    console.warn('Cancel failed:', e);
    showError(`Failed to cancel task.\n\n${e.message || e}`);
  }
}

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
  if (resolutionGrid) {
    const selected = resolutionGrid.querySelector('.resolution-btn.selected');
    if (selected) state.resolution = selected.dataset.resolution;
    setResolution(state.resolution, { silent: true });
  }
  if (serviceTierRow) {
    const selected = serviceTierRow.querySelector('.tier-btn.selected');
    if (selected) state.serviceTier = selected.dataset.tier;
    setServiceTier(state.serviceTier, { silent: true });
  }
  if (returnLastFrameChk) {
    state.returnLastFrame = returnLastFrameChk.checked;
  }
  if (cameraFixedChk) {
    state.cameraFixed = cameraFixedChk.checked;
  }
  if (seedInput) {
    const seedVal = seedInput.value.trim();
    const parsed = seedVal === '' ? null : parseInt(seedVal, 10);
    state.seed = Number.isFinite(parsed) ? parsed : null;
    if (seedDisplay) seedDisplay.textContent = state.seed == null ? 'Random' : String(state.seed);
  }
  if (currencySelect) {
    currencySelect.value = state.currency || 'USD';
  }
  if (referencePromptEditor && refCharCount) {
    const text = getReferencePromptText();
    refCharCount.textContent = text.length;
  }
  renderReferenceDeck();
  refreshCurrencyRates();
  updateJsonPreview();
  scheduleTokenization(textPrompt.value, 'text');
  scheduleTokenization(imagePromptTxt.value, 'image');
  if (referencePromptEditor) scheduleTokenization(getReferencePromptText(), 'reference');
  setResponsePreview({ status: 'idle' });
  await openDB();
  await loadVideosFromDB();
  if (state.apiKey) scheduleRemoteSync();
  applyModelCapabilities();
  updatePromptChips();
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
  if (state.apiKey) scheduleRemoteSync();
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

if (toggleControlsBtn) {
  toggleControlsBtn.addEventListener('click', () => {
    const layout = document.querySelector('.main-layout');
    if (!layout) return;
    const hidden = layout.classList.toggle('controls-hidden');
    toggleControlsBtn.title = hidden ? 'Show controls' : 'Hide controls';
    toggleControlsBtn.setAttribute('aria-label', toggleControlsBtn.title);
  });
}
if (controlsTab) {
  controlsTab.addEventListener('click', () => {
    const layout = document.querySelector('.main-layout');
    if (!layout) return;
    layout.classList.remove('controls-hidden');
    if (toggleControlsBtn) {
      toggleControlsBtn.title = 'Hide controls';
      toggleControlsBtn.setAttribute('aria-label', toggleControlsBtn.title);
    }
  });
}

function updatePromptChips() {
  const caps = getModelCaps(state.model);
  if (pillModel) {
    const selected = document.querySelector('.model-card.selected .model-name');
    pillModel.textContent = selected ? selected.textContent.trim() : 'Model';
  }
  if (pillRatio) pillRatio.textContent = state.ratio || '—';
  if (pillDuration) pillDuration.textContent = `${state.duration || 0}s`;
  if (pillTokens) {
    const estimate = estimateTokenCount({
      model: state.model,
      resolution: state.draft ? '480p' : state.resolution,
      ratio: state.ratio,
      duration: state.duration,
      draft: state.draft,
      generateAudio: state.generateAudio,
    });
    pillTokens.textContent = estimate ? `≈ ${formatTokenCount(estimate)} tokens` : 'Tokens —';
    if (pillCost) {
      const cost = estimateCost(estimate, {
        model: state.model,
        generateAudio: state.generateAudio,
        serviceTier: state.serviceTier,
      });
      if (!estimate || cost.reason === 'missing') {
        pillCost.textContent = 'Cost —';
      } else if (cost.reason === 'rate_unavailable') {
        pillCost.textContent = 'Rates unavailable';
      } else {
        pillCost.textContent = `≈ ${formatCurrency(cost.value, state.currency)}`;
      }
    }
  }
  if (pillFrames) {
    if (state.mode === 'reference') {
      pillFrames.textContent = `References: ${state.referenceImages.length}`;
      pillFrames.classList.remove('disabled');
    } else if (!caps.frames) {
      pillFrames.textContent = 'Frames unsupported';
      pillFrames.classList.add('disabled');
    } else {
      pillFrames.classList.remove('disabled');
      if (state.firstFrameDataUrl && state.lastFrameDataUrl) pillFrames.textContent = 'First + last frames';
      else if (state.firstFrameDataUrl) pillFrames.textContent = 'First frame';
      else pillFrames.textContent = state.mode === 'image' ? 'Image + prompt' : 'Prompt only';
    }
  }
}

function setResolution(value, { silent = false } = {}) {
  state.resolution = value;
  if (resolutionGrid) {
    resolutionGrid.querySelectorAll('.resolution-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.resolution === value);
    });
  }
  if (!silent) updateJsonPreview();
}

function setServiceTier(value, { silent = false } = {}) {
  state.serviceTier = value;
  if (serviceTierRow) {
    serviceTierRow.querySelectorAll('.tier-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.tier === value);
    });
  }
  if (!silent) updateJsonPreview();
}

function setToggleDisabled(inputEl, disabled, title) {
  if (!inputEl) return;
  inputEl.disabled = !!disabled;
  const row = inputEl.closest('.toggle-item');
  if (row) row.classList.toggle('disabled', !!disabled);
  if (disabled && title) row?.setAttribute('title', title);
  if (!disabled) row?.removeAttribute('title');
}

function setDisabled(el, disabled, title) {
  if (!el) return;
  el.classList.toggle('disabled', !!disabled);
  if (el.tagName === 'BUTTON') el.disabled = !!disabled;
  if (disabled) {
    if (title) el.setAttribute('title', title);
    el.setAttribute('aria-disabled', 'true');
  } else {
    el.removeAttribute('title');
    el.removeAttribute('aria-disabled');
  }
}

function applyModelCapabilities() {
  const caps = getModelCaps(state.model);

  setDisabled(tabText, !caps.text, 'Text-to-Video is not supported by this model.');
  setDisabled(tabImage, !caps.image, 'Image-to-Video is not supported by this model.');
  if (tabReference) {
    setDisabled(tabReference, !caps.reference, 'Reference images are not supported by this model.');
  }
  setDisabled(firstFrameBtn, !caps.frames, 'First/Last frame guidance is not supported by this model.');
  setDisabled(lastFrameBtn, !caps.frames, 'First/Last frame guidance is not supported by this model.');
  setDisabled(dropZone, !caps.image, 'Image upload is not supported by this model.');
  if (referenceAddBtn) setDisabled(referenceAddBtn, !caps.reference, 'Reference images are not supported by this model.');
  if (referenceDeck) setDisabled(referenceDeck, !caps.reference, 'Reference images are not supported by this model.');
  if (!caps.image) dropZone?.classList.remove('dragover');
  if (draftChip) {
    setDisabled(draftChip, !caps.draft, 'Draft mode is supported only by Seedance 1.5 Pro.');
    if (!caps.draft && state.draft) {
      state.draft = false;
      localStorage.setItem('vibedstudio_draft', '0');
      syncDraftUI();
      showToast('Draft mode is only available for Seedance 1.5 Pro.', 'info', 'ℹ️');
    }
  }

  if (fileInput) fileInput.disabled = !caps.image;
  if (removeImgBtn) removeImgBtn.disabled = !caps.image;

  if (resolutionGrid) {
    const supported = caps.resolutions || ['480p', '720p', '1080p'];
    resolutionGrid.querySelectorAll('.resolution-btn').forEach(btn => {
      const ok = supported.includes(btn.dataset.resolution);
      setDisabled(btn, !ok, 'Resolution not supported by this model.');
    });
    if (!supported.includes(state.resolution)) setResolution(supported[0], { silent: true });
  }

  if (durationSlider) {
    const minDur = caps.duration?.min ?? 2;
    const maxDur = caps.duration?.max ?? 12;
    durationSlider.min = String(minDur);
    durationSlider.max = String(maxDur);
    durationSlider.step = '1';
    if (state.duration < minDur) state.duration = minDur;
    if (state.duration > maxDur) state.duration = maxDur;
    durationSlider.value = String(state.duration);
    if (durationDisp) durationDisp.textContent = `${state.duration}s`;
    if (durationMinLabel) durationMinLabel.textContent = `${minDur}s`;
    if (durationMaxLabel) durationMaxLabel.textContent = `${maxDur}s`;
  }

  if (state.draft) {
    setResolution('480p', { silent: true });
    resolutionGrid?.querySelectorAll('.resolution-btn').forEach(btn => {
      const is480 = btn.dataset.resolution === '480p';
      setDisabled(btn, !is480, 'Draft mode supports 480p only.');
    });
    if (serviceTierRow) {
      setServiceTier('default', { silent: true });
      serviceTierRow.querySelectorAll('.tier-btn').forEach(btn => {
        setDisabled(btn, btn.dataset.tier !== 'default', 'Draft mode does not support offline inference.');
      });
    }
    if (returnLastFrameChk) {
      state.returnLastFrame = false;
      returnLastFrameChk.checked = false;
      setToggleDisabled(returnLastFrameChk, true, 'Draft mode does not support extensions.');
    }
  } else {
    if (serviceTierRow) {
      serviceTierRow.querySelectorAll('.tier-btn').forEach(btn => setDisabled(btn, false));
    }
    if (returnLastFrameChk) setToggleDisabled(returnLastFrameChk, false);
  }

  if (!caps.image && state.mode === 'image') setMode('text');
  if (!caps.text && state.mode === 'text') setMode('image');
  if (!caps.reference && state.mode === 'reference') setMode(caps.image ? 'image' : 'text');
  if (!caps.frames && state.mode === 'frames') {
    setMode(caps.image ? 'image' : 'text');
  }

  updatePromptChips();
}


// ── Model Selection ───────────────────────────────────────────
modelGrid.addEventListener('click', e => {
  const card = e.target.closest('.model-card');
  if (!card) return;
  document.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  state.model = card.dataset.model;
  card.querySelector('input[type="radio"]').checked = true;
  applyModelCapabilities();
  updateJsonPreview();
  scheduleTokenization(textPrompt.value, 'text');
  scheduleTokenization(imagePromptTxt.value, 'image');
  if (referencePromptEditor) scheduleTokenization(getReferencePromptText(), 'reference');
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

// ── Resolution ───────────────────────────────────────────────
if (resolutionGrid) {
  resolutionGrid.addEventListener('click', e => {
    const btn = e.target.closest('.resolution-btn');
    if (!btn || btn.classList.contains('disabled') || btn.disabled) return;
    setResolution(btn.dataset.resolution);
  });
}

// ── Duration ──────────────────────────────────────────────────
durationSlider.addEventListener('input', () => {
  const caps = getModelCaps(state.model);
  const minDur = caps.duration?.min ?? 2;
  const maxDur = caps.duration?.max ?? 12;
  let next = parseInt(durationSlider.value);
  if (Number.isNaN(next)) next = state.duration;
  next = Math.max(minDur, Math.min(maxDur, next));
  state.duration = next;
  durationDisp.textContent = `${state.duration}s`;
  updateJsonPreview();
});

// ── Service Tier ─────────────────────────────────────────────
if (serviceTierRow) {
  serviceTierRow.addEventListener('click', e => {
    const btn = e.target.closest('.tier-btn');
    if (!btn || btn.classList.contains('disabled') || btn.disabled) return;
    setServiceTier(btn.dataset.tier);
  });
}

// ── Toggles ───────────────────────────────────────────────────
genAudioChk.addEventListener('change', () => {
  state.generateAudio = genAudioChk.checked;
  updateJsonPreview();
});
watermarkChk.addEventListener('change', () => {
  state.watermark = watermarkChk.checked;
  updateJsonPreview();
});
if (cameraFixedChk) {
  cameraFixedChk.addEventListener('change', () => {
    state.cameraFixed = cameraFixedChk.checked;
    updateJsonPreview();
  });
}
if (seedInput) {
  seedInput.addEventListener('input', () => {
    const val = seedInput.value.trim();
    const parsed = val === '' ? null : parseInt(val, 10);
    state.seed = Number.isFinite(parsed) ? parsed : null;
    if (seedDisplay) seedDisplay.textContent = state.seed == null ? 'Random' : String(state.seed);
    updateJsonPreview();
  });
}
if (returnLastFrameChk) {
  returnLastFrameChk.addEventListener('change', () => {
    state.returnLastFrame = returnLastFrameChk.checked;
    updateJsonPreview();
  });
}
function syncDraftUI() {
  if (draftToggle) draftToggle.checked = state.draft;
  if (draftChip) {
    draftChip.classList.toggle('active', state.draft);
    draftChip.setAttribute('aria-pressed', state.draft ? 'true' : 'false');
  }
}

if (draftToggle || draftChip) {
  const saved = localStorage.getItem('vibedstudio_draft');
  if (saved === '1' || saved === '0') {
    state.draft = saved === '1';
  }
  syncDraftUI();
  if (draftToggle) {
    draftToggle.addEventListener('change', () => {
      state.draft = draftToggle.checked;
      localStorage.setItem('vibedstudio_draft', state.draft ? '1' : '0');
      syncDraftUI();
      applyModelCapabilities();
      updateJsonPreview();
    });
  }
  if (draftChip) {
    draftChip.addEventListener('click', () => {
      state.draft = !state.draft;
      localStorage.setItem('vibedstudio_draft', state.draft ? '1' : '0');
      syncDraftUI();
      applyModelCapabilities();
      updateJsonPreview();
    });
  }
}

// ── Mode Tabs ─────────────────────────────────────────────────
if (tabText) {
  tabText.addEventListener('click', () => {
    if (tabText.classList.contains('disabled')) return;
    setMode('text');
  });
}
if (tabImage) {
  tabImage.addEventListener('click', () => {
    if (tabImage.classList.contains('disabled')) return;
    setMode('image');
  });
}
if (tabReference) {
  tabReference.addEventListener('click', () => {
    if (tabReference.classList.contains('disabled')) return;
    setMode('reference');
  });
}

function setMode(mode) {
  const caps = getModelCaps(state.model);
  if (mode === 'text' && !caps.text) mode = caps.image ? 'image' : 'text';
  if (mode === 'image' && !caps.image) mode = caps.text ? 'text' : 'image';
  if (mode === 'reference' && !caps.reference) mode = caps.image ? 'image' : 'text';
  if (mode === 'frames' && !caps.frames) mode = caps.image ? 'image' : 'text';
  state.mode = mode;
  const isPrimary = mode === 'text' || mode === 'frames' || mode === 'image';
  const isImage = mode === 'image';
  const isReference = mode === 'reference';
  const promptTop = document.querySelector('.prompt-top');
  if (tabText) tabText.classList.toggle('active', isPrimary);
  if (tabImage) tabImage.classList.toggle('active', isImage);
  if (tabReference) tabReference.classList.toggle('active', isReference);
  if (textMode) textMode.classList.toggle('hidden', !isPrimary || isImage);
  if (imageMode) imageMode.classList.toggle('hidden', !isImage);
  if (referenceMode) referenceMode.classList.toggle('hidden', !isReference);
  if (promptTop) promptTop.classList.toggle('reference-mode', isReference);
  if (!isReference && referenceMentionMenu) referenceMentionMenu.classList.add('hidden');
  updateJsonPreview();
}

// ── Textarea char count ───────────────────────────────────────
textPrompt.addEventListener('input', () => {
  charCount.textContent = textPrompt.value.length;
  updateJsonPreview();
  scheduleTokenization(textPrompt.value, 'text');
});
imagePromptTxt.addEventListener('input', () => {
  updateJsonPreview();
  scheduleTokenization(imagePromptTxt.value, 'image');
});
if (referencePromptEditor) {
  referencePromptEditor.addEventListener('input', () => {
    const text = getReferencePromptText();
    if (refCharCount) refCharCount.textContent = text.length;
    updateJsonPreview();
    handleReferenceMention();
    scheduleTokenization(text, 'reference');
  });
  referencePromptEditor.addEventListener('click', handleReferenceMention);
  referencePromptEditor.addEventListener('keyup', handleReferenceMention);
  referencePromptEditor.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      referenceMentionMenu?.classList.add('hidden');
      referenceMentionContext = null;
    }
  });
}

if (currencySelect) {
  currencySelect.addEventListener('change', () => {
    state.currency = currencySelect.value;
    localStorage.setItem('vibedstudio_currency', state.currency);
    refreshCurrencyRates();
    updateJsonPreview();
  });
}

// ── Image Drop Zone ───────────────────────────────────────────
dropZone.addEventListener('click', e => {
  if (dropZone.classList.contains('disabled')) return;
  if (e.target === removeImgBtn || removeImgBtn.contains(e.target)) return;
  if (!state.imageDataUrl) fileInput.click();
});

dropZone.addEventListener('dragover', e => {
  if (dropZone.classList.contains('disabled')) return;
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  if (dropZone.classList.contains('disabled')) return;
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

// ── Reference Images ─────────────────────────────────────────
function renderReferenceDeck() {
  if (!referenceDeck) return;
  referenceDeck.innerHTML = '';
  if (!state.referenceImages.length) {
    const empty = document.createElement('div');
    empty.className = 'reference-card empty';
    empty.textContent = 'Add references';
    referenceDeck.appendChild(empty);
    return;
  }

  const angles = [-12, -4, 4, 12];
  state.referenceImages.forEach((img, idx) => {
    const card = document.createElement('div');
    card.className = 'reference-card';
    const angle = angles[idx] ?? 0;
    const offset = idx * 18;
    card.style.transform = `translateX(${offset}px) rotate(${angle}deg)`;
    card.style.zIndex = 10 + idx;
    const image = document.createElement('img');
    image.src = img.dataUrl;
    image.alt = img.name || `Reference ${idx + 1}`;
    const label = document.createElement('span');
    label.className = 'reference-label';
    label.textContent = `Image ${idx + 1}`;
    const remove = document.createElement('button');
    remove.className = 'reference-remove';
    remove.type = 'button';
    remove.textContent = '✕';
    remove.addEventListener('click', e => {
      e.stopPropagation();
      removeReferenceImage(img.id);
    });
    card.appendChild(image);
    card.appendChild(label);
    card.appendChild(remove);
    referenceDeck.appendChild(card);
  });
}

function removeReferenceImage(id) {
  state.referenceImages = state.referenceImages.filter(img => img.id !== id);
  renderReferenceDeck();
  updateJsonPreview();
  handleReferenceMention();
}

function addReferenceFiles(files) {
  const list = Array.from(files || []).filter(f => f.type.startsWith('image/'));
  if (!list.length) return;
  const remaining = Math.max(0, MAX_REFERENCE_IMAGES - state.referenceImages.length);
  list.slice(0, remaining).forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      state.referenceImages.push({
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        dataUrl: ev.target.result,
      });
      renderReferenceDeck();
      setMode('reference');
      updateJsonPreview();
      handleReferenceMention();
    };
    reader.readAsDataURL(file);
  });
}

if (referenceAddBtn) {
  referenceAddBtn.addEventListener('click', () => {
    if (referenceAddBtn.classList.contains('disabled')) return;
    referenceInput?.click();
  });
}

if (referenceInput) {
  referenceInput.addEventListener('change', () => {
    if (referenceInput.files?.length) addReferenceFiles(referenceInput.files);
    referenceInput.value = '';
  });
}

if (referenceDeck) {
  referenceDeck.addEventListener('dragover', e => {
    if (referenceDeck.classList.contains('disabled')) return;
    e.preventDefault();
    referenceDeck.classList.add('dragover');
  });
  referenceDeck.addEventListener('dragleave', () => referenceDeck.classList.remove('dragover'));
  referenceDeck.addEventListener('drop', e => {
    if (referenceDeck.classList.contains('disabled')) return;
    e.preventDefault();
    referenceDeck.classList.remove('dragover');
    addReferenceFiles(e.dataTransfer.files);
  });
}

let referenceMentionContext = null;

function getMentionContext(text, caret) {
  if (caret == null) return null;
  const upto = text.slice(0, caret);
  const atIndex = upto.lastIndexOf('@');
  if (atIndex === -1) return null;
  const query = upto.slice(atIndex + 1);
  if (/\\s/.test(query)) return null;
  return { atIndex, query };
}

function handleReferenceMention() {
  if (!referencePromptEditor || !referenceMentionMenu) return;
  if (state.mode !== 'reference') {
    referenceMentionMenu.classList.add('hidden');
    return;
  }
  const ctx = getReferenceMentionContext();
  if (!ctx) {
    referenceMentionMenu.classList.add('hidden');
    return;
  }
  const items = state.referenceImages.map((img, idx) => ({
    id: img.id,
    label: `Image ${idx + 1}`,
    name: img.name || `Reference ${idx + 1}`,
    token: `[Image ${idx + 1}]`,
  }));
  if (!items.length) {
    referenceMentionContext = ctx;
    referenceMentionMenu.innerHTML = `<div class="mention-item" style="opacity:0.6; cursor:default;">Add reference images first</div>`;
    referenceMentionMenu.classList.remove('hidden');
    return;
  }
  const filtered = items.filter(item => {
    if (!ctx.query) return true;
    return item.label.toLowerCase().includes(ctx.query.toLowerCase()) ||
      item.name.toLowerCase().includes(ctx.query.toLowerCase());
  });
  if (!filtered.length) {
    referenceMentionMenu.classList.add('hidden');
    return;
  }
  referenceMentionContext = ctx;
  referenceMentionMenu.innerHTML = '';
  filtered.forEach(item => {
    const row = document.createElement('div');
    row.className = 'mention-item';
    row.innerHTML = `<span class="mention-pill">${item.label}</span><span>${item.name}</span>`;
    row.addEventListener('click', () => {
      insertReferenceMention(item);
    });
    referenceMentionMenu.appendChild(row);
  });
  referenceMentionMenu.classList.remove('hidden');
}

function getReferenceMentionContext() {
  if (!referencePromptEditor) return null;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!referencePromptEditor.contains(range.startContainer)) return null;
  let node = range.startContainer;
  let offset = range.startOffset;
  if (node.nodeType !== Node.TEXT_NODE) {
    const fallback = findPreviousTextNode(node, offset);
    if (!fallback) return null;
    node = fallback.node;
    offset = fallback.offset;
  }
  const before = node.textContent.slice(0, offset);
  const atIndex = before.lastIndexOf('@');
  if (atIndex === -1) return null;
  const afterAt = before.slice(atIndex + 1);
  if (/\\s/.test(afterAt)) return null;
  return { node, atIndex, caretOffset: offset };
}

function findPreviousTextNode(container, offset) {
  if (!container) return null;
  let idx = offset - 1;
  const children = container.childNodes || [];
  while (idx >= 0) {
    const node = children[idx];
    if (node.nodeType === Node.TEXT_NODE) {
      return { node, offset: node.textContent.length };
    }
    idx--;
  }
  return null;
}

function createReferenceChip(item) {
  const idx = state.referenceImages.findIndex(img => img.id === item.id);
  const label = idx >= 0 ? `Image ${idx + 1}` : item.label || 'Image';
  const imgData = state.referenceImages[idx]?.dataUrl;
  const chip = document.createElement('span');
  chip.className = 'ref-chip';
  chip.contentEditable = 'false';
  chip.dataset.token = item.token;
  if (imgData) {
    const img = document.createElement('img');
    img.src = imgData;
    img.alt = label;
    chip.appendChild(img);
  }
  const text = document.createElement('span');
  text.textContent = label;
  chip.appendChild(text);
  return chip;
}

function insertReferenceMention(item) {
  if (!referencePromptEditor) return;
  const ctx = referenceMentionContext || getReferenceMentionContext();
  const chip = createReferenceChip(item);
  const space = document.createTextNode(' ');

  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    if (ctx && ctx.node) {
      const delRange = document.createRange();
      delRange.setStart(ctx.node, ctx.atIndex);
      delRange.setEnd(ctx.node, ctx.caretOffset);
      delRange.deleteContents();
      delRange.insertNode(space);
      delRange.insertNode(chip);
      range.setStart(space, 1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      range.insertNode(space);
      range.insertNode(chip);
      range.setStart(space, 1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } else {
    referencePromptEditor.appendChild(chip);
    referencePromptEditor.appendChild(space);
  }

  referenceMentionMenu?.classList.add('hidden');
  referenceMentionContext = null;
  const text = getReferencePromptText();
  if (refCharCount) refCharCount.textContent = text.length;
  updateJsonPreview();
  scheduleTokenization(text, 'reference');
}

document.addEventListener('click', e => {
  if (!referenceMentionMenu || referenceMentionMenu.classList.contains('hidden')) return;
  if (referenceMentionMenu.contains(e.target)) return;
  if (referencePromptEditor && referencePromptEditor.contains(e.target)) return;
  referenceMentionMenu.classList.add('hidden');
  referenceMentionContext = null;
});

// ── First/Last Frame Controls ─────────────────────────────────
if (firstFrameBtn && firstFrameInput) {
  firstFrameBtn.addEventListener('click', e => {
    if (firstFrameBtn.classList.contains('disabled')) return;
    if (firstFrameRemove && firstFrameRemove.contains(e.target)) return;
    firstFrameInput.click();
  });
  firstFrameInput.addEventListener('change', () => {
    const file = firstFrameInput.files?.[0];
    if (file) loadFrameFile(file, 'first');
    firstFrameInput.value = '';
  });
}
if (lastFrameBtn && lastFrameInput) {
  lastFrameBtn.addEventListener('click', e => {
    if (lastFrameBtn.classList.contains('disabled')) return;
    if (lastFrameRemove && lastFrameRemove.contains(e.target)) return;
    lastFrameInput.click();
  });
  lastFrameInput.addEventListener('change', () => {
    const file = lastFrameInput.files?.[0];
    if (file) loadFrameFile(file, 'last');
    lastFrameInput.value = '';
  });
}

if (firstFrameRemove) {
  firstFrameRemove.addEventListener('click', e => {
    e.stopPropagation();
    clearFrame('first');
  });
}
if (lastFrameRemove) {
  lastFrameRemove.addEventListener('click', e => {
    e.stopPropagation();
    clearFrame('last');
  });
}

function loadFrameFile(file, which) {
  const reader = new FileReader();
  reader.onload = ev => {
    if (which === 'first') {
      state.firstFrameFile = file;
      state.firstFrameDataUrl = ev.target.result;
      if (firstFrameThumb) {
        firstFrameThumb.src = ev.target.result;
        firstFrameThumb.classList.remove('hidden');
        firstFrameBtn?.classList.add('has-image');
      }
      if (firstFrameRemove) firstFrameRemove.classList.remove('hidden');
      // Use first frame as image-to-video input by default
      state.imageDataUrl = ev.target.result;
      state.imageFile = file;
      dropContent.classList.add('hidden');
      removeImgBtn.classList.remove('hidden');
    } else {
      state.lastFrameFile = file;
      state.lastFrameDataUrl = ev.target.result;
      if (lastFrameThumb) {
        lastFrameThumb.src = ev.target.result;
        lastFrameThumb.classList.remove('hidden');
        lastFrameBtn?.classList.add('has-image');
      }
      if (lastFrameRemove) lastFrameRemove.classList.remove('hidden');
    }
    // Mode switching logic
    if (state.firstFrameDataUrl && state.lastFrameDataUrl) {
      setMode('frames');
    } else if (state.firstFrameDataUrl) {
      if (!state.imageDataUrl) state.imageDataUrl = state.firstFrameDataUrl;
      setMode('image');
    }
    updateJsonPreview();
  };
  reader.readAsDataURL(file);
}

function clearFrame(which) {
  const usedAsImage = state.imageDataUrl && state.firstFrameDataUrl && state.imageDataUrl === state.firstFrameDataUrl;
  if (which === 'first') {
    state.firstFrameDataUrl = null;
    state.firstFrameFile = null;
    if (firstFrameThumb) {
      firstFrameThumb.src = '';
      firstFrameThumb.classList.add('hidden');
      firstFrameBtn?.classList.remove('has-image');
    }
    if (firstFrameRemove) firstFrameRemove.classList.add('hidden');
    if (usedAsImage) {
      state.imageDataUrl = null;
      state.imageFile = null;
      dropContent.classList.remove('hidden');
      removeImgBtn.classList.add('hidden');
    }
  } else if (which === 'last') {
    state.lastFrameDataUrl = null;
    state.lastFrameFile = null;
    if (lastFrameThumb) {
      lastFrameThumb.src = '';
      lastFrameThumb.classList.add('hidden');
      lastFrameBtn?.classList.remove('has-image');
    }
    if (lastFrameRemove) lastFrameRemove.classList.add('hidden');
  }

  syncModeFromMedia();
  updateJsonPreview();
}

function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    state.imageDataUrl = ev.target.result;
    state.imageFile = file;
    dropContent.classList.add('hidden');
    removeImgBtn.classList.remove('hidden');
    setMode('image');
    updateJsonPreview();
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  const wasFirst = state.firstFrameDataUrl && state.imageDataUrl === state.firstFrameDataUrl;
  state.imageDataUrl = null;
  state.imageFile = null;
  dropContent.classList.remove('hidden');
  removeImgBtn.classList.add('hidden');
  fileInput.value = '';
  if (wasFirst) {
    state.firstFrameDataUrl = null;
    state.firstFrameFile = null;
    if (firstFrameThumb) {
      firstFrameThumb.src = '';
      firstFrameThumb.classList.add('hidden');
      firstFrameBtn?.classList.remove('has-image');
    }
    if (firstFrameRemove) firstFrameRemove.classList.add('hidden');
  }
  syncModeFromMedia();
  updateJsonPreview();
}

function syncModeFromMedia() {
  if (state.mode === 'reference') return;
  if (state.firstFrameDataUrl && state.lastFrameDataUrl) {
    setMode('frames');
    return;
  }
  if (state.imageDataUrl || state.firstFrameDataUrl) {
    setMode('image');
    return;
  }
  setMode('text');
}

function setImageFromDataUrl(dataUrl) {
  if (!dataUrl) return;
  state.imageDataUrl = dataUrl;
  state.imageFile = null;
  if (dropContent) dropContent.classList.add('hidden');
  if (removeImgBtn) removeImgBtn.classList.remove('hidden');
}

function setFrameFromDataUrl(dataUrl, which) {
  if (!dataUrl) return;
  if (which === 'first') {
    state.firstFrameDataUrl = dataUrl;
    state.firstFrameFile = null;
    if (firstFrameThumb) {
      firstFrameThumb.src = dataUrl;
      firstFrameThumb.classList.remove('hidden');
      firstFrameBtn?.classList.add('has-image');
    }
    if (firstFrameRemove) firstFrameRemove.classList.remove('hidden');
    if (!state.imageDataUrl) setImageFromDataUrl(dataUrl);
  } else {
    state.lastFrameDataUrl = dataUrl;
    state.lastFrameFile = null;
    if (lastFrameThumb) {
      lastFrameThumb.src = dataUrl;
      lastFrameThumb.classList.remove('hidden');
      lastFrameBtn?.classList.add('has-image');
    }
    if (lastFrameRemove) lastFrameRemove.classList.remove('hidden');
  }
}

function setReferencePromptFromText(text) {
  if (!referencePromptEditor) return;
  referencePromptEditor.innerHTML = '';
  if (!text) return;
  const regex = /\[Image\s*(\d+)\]/gi;
  let last = 0;
  let match;
  while ((match = regex.exec(text))) {
    const before = text.slice(last, match.index);
    if (before) referencePromptEditor.appendChild(document.createTextNode(before));
    const idx = Math.max(1, parseInt(match[1], 10)) - 1;
    const img = state.referenceImages[idx];
    const chip = createReferenceChip({
      id: img?.id,
      label: `Image ${idx + 1}`,
      token: `[Image ${idx + 1}]`,
    });
    referencePromptEditor.appendChild(chip);
    referencePromptEditor.appendChild(document.createTextNode(' '));
    last = match.index + match[0].length;
  }
  const tail = text.slice(last);
  if (tail) referencePromptEditor.appendChild(document.createTextNode(tail));
}

function applyJobToForm(job) {
  if (!job) return;

  // Model selection
  if (job.model) {
    state.model = job.model;
    const card = document.querySelector(`.model-card[data-model="${job.model}"]`);
    if (card) {
      document.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const radio = card.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    }
  }

  // Core settings
  if (job.ratio) state.ratio = job.ratio;
  if (job.duration) state.duration = Number(job.duration) || state.duration;
  if (job.resolution) state.resolution = job.resolution;
  if (job.serviceTier) state.serviceTier = job.serviceTier;
  if (job.generateAudio != null) state.generateAudio = !!job.generateAudio;
  if (job.watermark != null) state.watermark = !!job.watermark;
  if (job.returnLastFrame != null) state.returnLastFrame = !!job.returnLastFrame;
  if (job.cameraFixed != null) state.cameraFixed = !!job.cameraFixed;
  if (job.seed !== undefined) state.seed = job.seed ?? null;
  state.draft = !!job.draft;

  localStorage.setItem('vibedstudio_draft', state.draft ? '1' : '0');
  syncDraftUI();

  // Clear existing media
  clearImage();
  clearFrame('first');
  clearFrame('last');
  state.referenceImages = [];
  renderReferenceDeck();
  if (referencePromptEditor) referencePromptEditor.innerHTML = '';

  // Apply mode + media
  const mode = job.mode || 'text';
  setMode(mode);

  if (mode === 'reference') {
    state.referenceImages = Array.isArray(job.referenceImages) ? job.referenceImages : [];
    renderReferenceDeck();
    setReferencePromptFromText(job.promptText || job.prompt || '');
  } else {
    const promptText = job.promptText || job.prompt || '';
    if (textPrompt) {
      textPrompt.value = promptText;
      charCount.textContent = textPrompt.value.length;
    }
    if (imagePromptTxt) imagePromptTxt.value = promptText;
    if (job.imageDataUrl) setImageFromDataUrl(job.imageDataUrl);
    if (job.firstFrameDataUrl) setFrameFromDataUrl(job.firstFrameDataUrl, 'first');
    if (job.lastFrameDataUrl) setFrameFromDataUrl(job.lastFrameDataUrl, 'last');
    if (!job.imageDataUrl && job.firstFrameDataUrl && mode === 'image') {
      setImageFromDataUrl(job.firstFrameDataUrl);
    }
    syncModeFromMedia();
  }

  applyModelCapabilities();
  setRatioValue(state.ratio, { silent: true });
  setResolution(state.resolution, { silent: true });
  setServiceTier(state.serviceTier, { silent: true });

  if (durationSlider) {
    durationSlider.value = String(state.duration);
    if (durationDisp) durationDisp.textContent = `${state.duration}s`;
  }
  if (returnLastFrameChk) returnLastFrameChk.checked = state.returnLastFrame;
  if (genAudioChk) genAudioChk.checked = state.generateAudio;
  if (watermarkChk) watermarkChk.checked = state.watermark;
  if (cameraFixedChk) cameraFixedChk.checked = state.cameraFixed;
  if (seedInput) seedInput.value = state.seed == null ? '' : String(state.seed);
  if (seedDisplay) seedDisplay.textContent = state.seed == null ? 'Random' : String(state.seed);

  updateJsonPreview();
  scheduleTokenization(textPrompt.value, 'text');
  scheduleTokenization(imagePromptTxt.value, 'image');
  if (referencePromptEditor) scheduleTokenization(getReferencePromptText(), 'reference');
}

function retryFromJob(jobId) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;
  applyJobToForm(job);
  showToast('Settings restored for retry. Press Generate to run again.', 'info', '🔁');
}

// ── JSON Preview ──────────────────────────────────────────────
function buildPayload() {
  const content = [];
  if (state.mode === 'draft_task') {
    content.push({ type: 'draft_task', draft_task: { id: '(draft task id...)' } });
  } else if (state.mode === 'frames' && state.firstFrameDataUrl && state.lastFrameDataUrl) {
    content.push({ type: 'image_url', image_url: { url: '(first frame base64...)' }, role: 'first_frame' });
    content.push({ type: 'image_url', image_url: { url: '(last frame base64...)' }, role: 'last_frame' });
    const prompt = textPrompt.value.trim();
    if (prompt) content.push({ type: 'text', text: prompt });
  } else if (state.mode === 'text') {
    const prompt = textPrompt.value.trim();
    if (prompt) content.push({ type: 'text', text: prompt });
    else content.push({ type: 'text', text: '(your prompt here)' });
  } else if (state.mode === 'reference') {
    const prompt = getReferencePromptText();
    if (prompt) content.push({ type: 'text', text: prompt });
    if (state.referenceImages.length) {
      state.referenceImages.forEach(img => {
        content.push({ type: 'image_url', image_url: { url: '(reference image base64...)' }, role: 'reference_image' });
      });
    } else {
      content.push({ type: 'image_url', image_url: { url: '(reference image base64...)' }, role: 'reference_image' });
    }
  } else {
    const imageUrl = state.imageDataUrl || state.firstFrameDataUrl;
    if (imageUrl) {
      const item = { type: 'image_url', image_url: { url: '(base64 data...)' } };
      if (state.firstFrameDataUrl) item.role = 'first_frame';
      content.push(item);
    } else {
      content.push({ type: 'image_url', image_url: { url: '(image URL or base64)' } });
    }
    const imgPrompt = imagePromptTxt.value.trim();
    if (imgPrompt) content.push({ type: 'text', text: imgPrompt });
  }
  return {
    model: resolveModelId(state.model, state.mode),
    content,
    ...(state.draft ? { draft: true, resolution: '480p' } : {}),
    ...(state.resolution && !state.draft ? { resolution: state.resolution } : {}),
    ...(state.returnLastFrame ? { return_last_frame: true } : {}),
    ...(state.serviceTier && state.serviceTier !== 'default' ? { service_tier: state.serviceTier } : {}),
    ...(state.cameraFixed ? { camera_fixed: true } : {}),
    ...(state.seed != null ? { seed: state.seed } : {}),
    ratio: state.ratio,
    duration: state.duration,
    generate_audio: state.generateAudio,
    watermark: state.watermark,
  };
}

function updateJsonPreview() {
  const payload = buildPayload();
  jsonPreview.textContent = JSON.stringify(payload, null, 2);
  updatePromptChips();
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
  const promptText = state.mode === 'reference'
    ? getReferencePromptText()
    : (state.mode === 'text' || state.mode === 'frames'
    ? textPrompt.value.trim()
    : imagePromptTxt.value.trim());

  const jobConfig = {
    model: state.model,
    ratio: state.ratio,
    duration: state.duration,
    resolution: state.draft ? '480p' : state.resolution,
    returnLastFrame: state.returnLastFrame,
    serviceTier: state.serviceTier,
    generateAudio: state.generateAudio,
    watermark: state.watermark,
    cameraFixed: state.cameraFixed,
    seed: state.seed,
    mode: state.mode,
    promptText,
    imageDataUrl: state.imageDataUrl,
    firstFrameDataUrl: state.firstFrameDataUrl,
    lastFrameDataUrl: state.lastFrameDataUrl,
    referenceImages: state.referenceImages.slice(0, 4),
    draft: state.draft,
  };
  jobConfig.tokensEstimate = estimateTokenCount({
    model: jobConfig.model,
    resolution: jobConfig.resolution,
    ratio: jobConfig.ratio,
    duration: jobConfig.duration,
    draft: jobConfig.draft,
    generateAudio: jobConfig.generateAudio,
  });

  if (!validateJobConfig(jobConfig, { focusOnError: true })) return;

  // Visual pulse on the button to acknowledge the queue
  generateBtn.classList.add('btn-queued');
  setTimeout(() => generateBtn.classList.remove('btn-queued'), 600);

  const placeholderId = createPlaceholderJob(jobConfig);
  await submitGeneration(jobConfig, { skipValidation: true, placeholderId });
}

function validateJobConfig(jobConfig, { focusOnError = false } = {}) {
  if (!state.apiKey) {
    showError('No API key found.\n\nPlease paste your BytePlus API key into the Authentication field on the left before generating.');
    if (focusOnError) $('api-key').focus();
    return false;
  }
  if (jobConfig.mode === 'draft_task' && !jobConfig.draftTaskId) {
    showError('Draft task ID is missing.\n\nPlease generate a Draft video first.');
    return false;
  }
  if (jobConfig.draft) {
    const caps = getModelCaps(jobConfig.model);
    if (!caps.draft) {
      showError('Draft mode is supported only by Seedance 1.5 Pro.');
      return false;
    }
  }
  if (jobConfig.mode === 'reference') {
    const caps = getModelCaps(jobConfig.model);
    if (!caps.reference) {
      showError('Reference images are supported only by Seedance 1.0 Lite I2V.');
      return false;
    }
    if (!jobConfig.referenceImages || jobConfig.referenceImages.length < 1) {
      showError('Add at least one reference image before generating.');
      return false;
    }
  }
  if (jobConfig.mode === 'frames' && (!jobConfig.firstFrameDataUrl || !jobConfig.lastFrameDataUrl)) {
    showError('Both first and last frames are required for First & Last Frames mode.');
    return false;
  }
  if (jobConfig.mode === 'image' && !jobConfig.imageDataUrl && !jobConfig.firstFrameDataUrl) {
    showError('No image selected.\n\nPlease upload an image before generating in Image-to-Video mode.');
    return false;
  }
  if (jobConfig.mode === 'text' && !jobConfig.promptText) {
    showError('No prompt entered.\n\nPlease describe the video you want to generate in the text box.');
    if (focusOnError) textPrompt.focus();
    return false;
  }
  return true;
}

function buildContent(jobConfig) {
  const content = [];
  if (jobConfig.mode === 'draft_task') {
    content.push({ type: 'draft_task', draft_task: { id: jobConfig.draftTaskId } });
  } else if (jobConfig.mode === 'frames') {
    content.push({ type: 'image_url', image_url: { url: jobConfig.firstFrameDataUrl }, role: 'first_frame' });
    content.push({ type: 'image_url', image_url: { url: jobConfig.lastFrameDataUrl }, role: 'last_frame' });
    if (jobConfig.promptText) content.push({ type: 'text', text: jobConfig.promptText });
  } else if (jobConfig.mode === 'reference') {
    if (jobConfig.promptText) content.push({ type: 'text', text: jobConfig.promptText });
    (jobConfig.referenceImages || []).forEach(img => {
      if (!img?.dataUrl) return;
      content.push({ type: 'image_url', image_url: { url: img.dataUrl }, role: 'reference_image' });
    });
  } else if (jobConfig.mode === 'text') {
    content.push({ type: 'text', text: jobConfig.promptText });
  } else {
    const imageUrl = jobConfig.imageDataUrl || jobConfig.firstFrameDataUrl;
    const item = { type: 'image_url', image_url: { url: imageUrl } };
    if (jobConfig.firstFrameDataUrl && !jobConfig.lastFrameDataUrl) item.role = 'first_frame';
    content.push(item);
    if (jobConfig.promptText) content.push({ type: 'text', text: jobConfig.promptText });
  }
  return content;
}

function createPlaceholderJob(jobConfig) {
  const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const prompt = jobConfig.mode === 'text' ? jobConfig.promptText : (jobConfig.promptText || '[Image-to-Video]');
  const requestModel = resolveModelId(jobConfig.model, jobConfig.mode);
  const job = {
    id,
    status: 'running',
    videoUrl: null,
    prompt,
    model: requestModel,
    ratio: jobConfig.ratio,
    duration: jobConfig.duration,
    resolution: jobConfig.resolution || null,
    returnLastFrame: !!jobConfig.returnLastFrame,
    serviceTier: jobConfig.serviceTier || 'default',
    timestamp: new Date(),
    draft: !!jobConfig.draft,
    mode: jobConfig.mode,
    promptText: jobConfig.promptText,
    imageDataUrl: jobConfig.imageDataUrl,
    firstFrameDataUrl: jobConfig.firstFrameDataUrl,
    lastFrameDataUrl: jobConfig.lastFrameDataUrl,
    referenceImages: jobConfig.referenceImages || [],
    generateAudio: jobConfig.generateAudio,
    watermark: jobConfig.watermark,
    tokensEstimate: jobConfig.tokensEstimate ?? null,
    lastFrameUrl: jobConfig.lastFrameUrl || null,
    cameraFixed: !!jobConfig.cameraFixed,
    seed: jobConfig.seed ?? null,
    _placeholder: true,
  };
  state.jobs.unshift(job);
  renderJobCard(job);
  updateEmptyState();
  updateQueueUI();
  return id;
}

function removeJobSilently(id) {
  state.jobs = state.jobs.filter(j => j.id !== id);
  const card = $(`card-${id}`);
  if (card) card.remove();
  updateEmptyState();
  updateQueueUI();
}

async function submitGeneration(jobConfig, { focusOnError = false, skipValidation = false, placeholderId = null } = {}) {
  if (!skipValidation && !validateJobConfig(jobConfig, { focusOnError })) return;

  const requestModel = resolveModelId(jobConfig.model, jobConfig.mode);
  const body = {
    model: requestModel,
    content: buildContent(jobConfig),
  };
  if (jobConfig.mode !== 'draft_task') {
    body.ratio = jobConfig.ratio;
    body.duration = jobConfig.duration;
    body.generate_audio = jobConfig.generateAudio;
    if (jobConfig.cameraFixed) body.camera_fixed = true;
    if (jobConfig.seed != null) body.seed = jobConfig.seed;
  }
  body.watermark = jobConfig.watermark;
  if (jobConfig.draft) {
    body.draft = true;
    body.resolution = '480p';
  }
  if (!jobConfig.draft && jobConfig.resolution) body.resolution = jobConfig.resolution;
  if (jobConfig.returnLastFrame) body.return_last_frame = true;
  if (jobConfig.serviceTier && jobConfig.serviceTier !== 'default') body.service_tier = jobConfig.serviceTier;

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

    const prompt = jobConfig.mode === 'text' ? jobConfig.promptText : (jobConfig.promptText || '[Image-to-Video]');
    const job = {
      id: taskId,
      status: 'running',
      videoUrl: null,
      prompt,
      model: requestModel,
      ratio: jobConfig.ratio,
      duration: jobConfig.duration,
      resolution: jobConfig.resolution || null,
      returnLastFrame: !!jobConfig.returnLastFrame,
      serviceTier: jobConfig.serviceTier || 'default',
      timestamp: new Date(),
      draft: !!jobConfig.draft,
      mode: jobConfig.mode,
    draftTaskId: jobConfig.draftTaskId || null,
    promptText: jobConfig.promptText,
    imageDataUrl: jobConfig.imageDataUrl,
    firstFrameDataUrl: jobConfig.firstFrameDataUrl,
    lastFrameDataUrl: jobConfig.lastFrameDataUrl,
    referenceImages: jobConfig.referenceImages || [],
    generateAudio: jobConfig.generateAudio,
    watermark: jobConfig.watermark,
    tokensEstimate: jobConfig.tokensEstimate ?? null,
    lastFrameUrl: jobConfig.lastFrameUrl || null,
    cameraFixed: !!jobConfig.cameraFixed,
    seed: jobConfig.seed ?? null,
  };
    if (placeholderId) removeJobSilently(placeholderId);
    state.jobs.unshift(job);
    renderJobCard(job);
    updateEmptyState();
    updateQueueUI();
    saveVideoJob(job, null);

    pollJob(taskId);
  } catch (err) {
    console.error(err);
    if (placeholderId) removeJobSilently(placeholderId);
    decrementActive();
    if (!responseSet) {
      setResponsePreview({ ok: false, error: err.message || String(err) });
    }
    showError(`Failed to create video generation task:\n\n${err.message}`);
  }
}

function buildFallbackJob(taskId, status, videoUrl) {
  return {
    id: taskId,
    status,
    videoUrl: videoUrl || null,
    prompt: '',
    model: state.model,
    ratio: state.ratio,
    duration: state.duration,
    resolution: state.draft ? '480p' : state.resolution,
    returnLastFrame: state.returnLastFrame,
    serviceTier: state.serviceTier,
    lastFrameUrl: null,
    timestamp: new Date(),
    draft: false,
    mode: state.mode,
    draftTaskId: null,
    promptText: '',
    imageDataUrl: state.imageDataUrl,
    firstFrameDataUrl: state.firstFrameDataUrl,
    lastFrameDataUrl: state.lastFrameDataUrl,
    referenceImages: state.referenceImages || [],
    generateAudio: state.generateAudio,
    watermark: state.watermark,
    cameraFixed: state.cameraFixed,
    seed: state.seed,
  };
}

// ── Polling — one interval per job ───────────────────────────
function pollJob(taskId, { initialElapsed = 0 } = {}) {
  if (activePolls.has(taskId)) return;
  let elapsed = Math.max(0, Math.floor(initialElapsed));

  const interval = setInterval(async () => {
    elapsed += 8;
    const job = state.jobs.find(j => j.id === taskId);
    if (job) job._pollElapsed = elapsed;

    // Update that job's card timer
    const timerEl = $(`timer-${taskId}`);
    if (timerEl) {
      const s = elapsed % 60;
      const m = Math.floor(elapsed / 60);
      timerEl.textContent = m > 0 ? `${m}m ${s}s` : `${s}s`;
    }
    const statusText = document.querySelector(`#status-overlay-${taskId} .card-status-text`);
    if (statusText) statusText.textContent = 'Generating…';
    const subText = $(`substatus-${taskId}`);
    if (subText) {
      if (elapsed >= 1200) {
        subText.textContent = 'Still generating. You can check history later.';
      } else if (elapsed >= 90) {
        subText.textContent = 'Still working… this can take a few minutes.';
      } else {
        subText.textContent = '';
      }
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
        activePolls.delete(taskId);
        const videoUrl = extractVideoUrl(data) || job?.videoUrl || null;
        const tokensUsed = extractTokensUsed(data);
        const lastFrameUrl = extractLastFrameUrl(data);
        if (job) {
          job.status = 'succeeded';
          if (videoUrl) job.videoUrl = videoUrl;
          if (tokensUsed != null) job.tokensUsed = tokensUsed;
          if (lastFrameUrl) job.lastFrameUrl = lastFrameUrl;
        }
        updateJobCard(taskId, 'succeeded', videoUrl || job?.videoUrl);
        // Avoid downloading the full video on generation completion.
        // Only save the URL; the video will be fetched when the user plays or downloads it.
        saveVideoJob(job || buildFallbackJob(taskId, 'succeeded', videoUrl || null), null);
        window.syncMediaLibrary?.();
        decrementActive();
        showToast('✅ Video ready!', 'success', '🎉');

      } else if (status === 'failed') {
        clearInterval(interval);
        activePolls.delete(taskId);
        if (job) job.status = 'failed';
        updateJobCard(taskId, 'failed');
        saveVideoJob(job || buildFallbackJob(taskId, 'failed', null), null);
        decrementActive();
        showError(`Video generation failed.\n\nTask ID: ${taskId}\n\nThis may be due to your prompt, input image, or an API issue. Please adjust your settings and try again.`);

      } else if (status === 'expired') {
        clearInterval(interval);
        activePolls.delete(taskId);
        if (job) job.status = 'failed';
        updateJobCard(taskId, 'failed');
        saveVideoJob(job || buildFallbackJob(taskId, 'failed', null), null);
        decrementActive();
        showError(`Task expired before completing.\n\nTask ID: ${taskId}\n\nThe video took too long to generate. Please try again with a shorter duration or simpler prompt.`);
      }
      // else: still running, keep polling

    } catch (err) {
      console.error('Poll error:', err);
      const timerEl = $(`timer-${taskId}`);
      if (timerEl) timerEl.textContent = 'Waiting for server…';
      const statusText = document.querySelector(`#status-overlay-${taskId} .card-status-text`);
      if (statusText) statusText.textContent = 'Waiting for server…';
    }
  }, 8000);
  activePolls.set(taskId, interval);
}

// ── Video Cards ───────────────────────────────────────────────
function updateEmptyState() {
  emptyState.classList.toggle('hidden', state.jobs.length > 0);
}

function renderJobCard(job) {
  const card = document.createElement('div');
  card.className = 'video-card';
  card.id = `card-${job.id}`;
  if (job.status === 'running') card.classList.add('generating');

  const modelShort = (job.model || 'model').split('-').slice(0, 3).join(' ');
  const timeStr = job.timestamp instanceof Date
    ? job.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : new Date(job.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const ratio = job.ratio || '—';
  const duration = Number(job.duration) || 0;
  const resolution = job.resolution || '—';
  const tierTag = job.serviceTier === 'flex' ? '<span class="card-tag teal">Flex</span>' : '';
  const tokensTag = job.tokensUsed ? `<span class="card-tag token-tag">${formatTokenCount(job.tokensUsed)} tokens</span>` : '';
  const elapsedSeconds = typeof job._pollElapsed === 'number'
    ? job._pollElapsed
    : (job.timestamp ? Math.floor((Date.now() - new Date(job.timestamp).getTime()) / 1000) : 0);

  card.innerHTML = `
    <div class="video-card-thumb" id="thumb-${job.id}">
      <div class="card-status" id="status-overlay-${job.id}">
        <span class="spinner purple"></span>
        <span class="card-status-text">Generating…</span>
        <span class="card-substatus" id="substatus-${job.id}"></span>
        <span class="card-timer" id="timer-${job.id}">${formatElapsed(elapsedSeconds)}</span>
      </div>
    </div>
    <div class="video-card-info">
      <div class="card-meta">
        <span class="card-tag">${escHtml(modelShort)}</span>
        <span class="card-tag blue">${ratio}</span>
        <span class="card-tag cyan">${duration}s</span>
        <span class="card-tag">${resolution}</span>
        ${tierTag}
        ${tokensTag}
        ${job.draft ? '<span class="card-tag orange">Draft</span>' : ''}
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
        <button class="card-btn danger" data-action="cancel-job">Cancel</button>
        <button class="card-btn" data-action="copy-id">Copy Task ID</button>
        <button class="card-btn" data-action="toggle-poll">Pause polling</button>
      </div>
    </div>
  `;

  const actionsEl = card.querySelector('.card-actions');
  actionsEl?.querySelector('[data-action="copy-id"]')?.addEventListener('click', () => {
    navigator.clipboard.writeText(job.id).then(() => {
      showToast('Task ID copied', 'success', '📋');
    });
  });
  actionsEl?.querySelector('[data-action="toggle-poll"]')?.addEventListener('click', e => {
    togglePolling(job.id, e.currentTarget);
  });
  actionsEl?.querySelector('[data-action="cancel-job"]')?.addEventListener('click', () => {
    cancelGeneration(job.id);
  });

  const existing = videoGrid.querySelector(`#card-${job.id}`);
  if (existing) existing.remove();
  const ref = Array.from(videoGrid.children).find(el => {
    const id = el.id?.replace('card-', '');
    const other = state.jobs.find(j => j.id === id);
    return other && other.timestamp && job.timestamp && new Date(other.timestamp) < new Date(job.timestamp);
  });
  if (ref) videoGrid.insertBefore(card, ref);
  else videoGrid.appendChild(card);
}

function updateJobCard(taskId, status, videoUrl) {
  const thumbEl = $(`thumb-${taskId}`);
  const overlayEl = $(`status-overlay-${taskId}`);
  const actionsEl = $(`actions-${taskId}`);
  if (!thumbEl || !overlayEl || !actionsEl) return;

  const job = state.jobs.find(j => j.id === taskId) || {};
  const resolvedUrl = videoUrl || job.videoUrl;

  if (status === 'succeeded' && resolvedUrl) {
    if (activePolls.has(taskId)) {
      clearInterval(activePolls.get(taskId));
      activePolls.delete(taskId);
    }
    overlayEl.classList.add('succeeded');
    const card = $(`card-${taskId}`);
    if (card) card.classList.remove('generating');
    const thumbUrl = job.thumbDataUrl || null;
    thumbEl.innerHTML = '';
    if (thumbUrl) {
      const img = document.createElement('img');
      img.src = thumbUrl;
      img.alt = 'Thumbnail';
      thumbEl.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'thumb-placeholder';
      ph.textContent = job.thumbDisabled ? 'Thumbnail unavailable' : 'Loading thumbnail…';
      thumbEl.appendChild(ph);
      if (!job.thumbDisabled && resolvedUrl) ensureThumbnail(job, taskId, resolvedUrl);
    }
    const play = document.createElement('button');
    play.className = 'thumb-play-btn';
    play.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><polygon points="7,5 19,12 7,19" fill="currentColor"/></svg>`;
    play.title = 'Play';
    play.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      loadVideoIntoCard(taskId, resolvedUrl);
    });
    thumbEl.appendChild(play);

    actionsEl.innerHTML = `
      <a class="card-btn" href="${escHtml(resolvedUrl)}" target="_blank" rel="noopener" download>
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 2V17M12 17L7 12M12 17L17 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 20H21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Download
      </a>
      <button class="card-btn" data-action="copy-url">
        <svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4C2.895 15 2 14.105 2 13V4C2 2.895 2 4 4 2H13C14.105 2 15 2.895 15 4V5" stroke="currentColor" stroke-width="2"/></svg>
        Copy URL
      </button>
      <button class="card-btn" data-action="retry-job">
        <svg viewBox="0 0 24 24" fill="none"><path d="M4 12a8 8 0 0 1 13.66-5.66L20 8M20 8V3M20 8h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 12a8 8 0 0 1-13.66 5.66L4 16M4 16v5M4 16h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Retry
      </button>
    `;
    actionsEl.querySelector('[data-action="copy-url"]')?.addEventListener('click', () => copyVideoUrl(resolvedUrl));
    actionsEl.querySelector('[data-action="retry-job"]')?.addEventListener('click', () => retryFromJob(taskId));
    if (job.lastFrameUrl) {
      const extendBtn = document.createElement('button');
      extendBtn.className = 'card-btn';
      extendBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Extend`;
      extendBtn.addEventListener('click', () => extendFromJob(job));
      actionsEl.appendChild(extendBtn);
    }
    if (job.draft) {
      const makeBtn = document.createElement('button');
      makeBtn.className = 'card-btn';
      makeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Make official`;
      makeBtn.addEventListener('click', () => makeOfficialFromJob(job));
      actionsEl.appendChild(makeBtn);
    }

    if (card) {
      card.style.borderColor = 'rgba(16,185,129,0.3)';
      const meta = card.querySelector('.card-meta');
      if (job.tokensUsed && meta && !meta.querySelector('.token-tag')) {
        const tokenTag = document.createElement('span');
        tokenTag.className = 'card-tag token-tag';
        tokenTag.textContent = `${formatTokenCount(job.tokensUsed)} tokens`;
        const timeTag = meta.querySelector('.card-tag[style*="margin-left"]');
        if (timeTag) meta.insertBefore(tokenTag, timeTag);
        else meta.appendChild(tokenTag);
      }
      if (job.draft && meta && !meta.querySelector('.card-tag.orange')) {
        const tag = document.createElement('span');
        tag.className = 'card-tag orange';
        tag.textContent = 'Draft';
        const timeTag = meta.querySelector('.card-tag[style*="margin-left"]');
        if (timeTag) meta.insertBefore(tag, timeTag);
        else meta.appendChild(tag);
      }
    }

  } else if (status === 'failed') {
    if (activePolls.has(taskId)) {
      clearInterval(activePolls.get(taskId));
      activePolls.delete(taskId);
    }
    overlayEl.innerHTML = `
      <div class="status-icon">✕</div>
      <span class="card-status-text" style="color: var(--red);">Generation failed</span>
    `;
    overlayEl.classList.add('failed');
    actionsEl.innerHTML = `
      <button class="card-btn" data-action="retry-job">
        <svg viewBox="0 0 24 24" fill="none"><path d="M4 12a8 8 0 0 1 13.66-5.66L20 8M20 8V3M20 8h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 12a8 8 0 0 1-13.66 5.66L4 16M4 16v5M4 16h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Retry
      </button>
      <button class="card-btn" data-action="copy-id">Copy Task ID</button>
    `;
    actionsEl.querySelector('[data-action="retry-job"]')?.addEventListener('click', () => retryFromJob(taskId));
    actionsEl.querySelector('[data-action="copy-id"]')?.addEventListener('click', () => {
      navigator.clipboard.writeText(taskId).then(() => showToast('Task ID copied', 'success', '📋'));
    });
    const card = $(`card-${taskId}`);
    if (card) {
      card.classList.remove('generating');
      card.style.borderColor = 'rgba(239,68,68,0.3)';
    }
  }

  updateQueueUI();
}

function togglePolling(taskId, btn) {
  if (activePolls.has(taskId)) {
    clearInterval(activePolls.get(taskId));
    activePolls.delete(taskId);
    if (btn) btn.textContent = 'Resume polling';
    return;
  }
  const job = state.jobs.find(j => j.id === taskId);
  const elapsed = job?._pollElapsed || (job?.timestamp ? Math.floor((Date.now() - new Date(job.timestamp).getTime()) / 1000) : 0);
  pollJob(taskId, { initialElapsed: elapsed });
  if (btn) btn.textContent = 'Pause polling';
}

function makeOfficialFromJob(job) {
  if (!job) return;
  const jobConfig = {
    model: job.model || state.model,
    ratio: job.ratio || state.ratio,
    duration: job.duration || state.duration,
    resolution: state.resolution,
    returnLastFrame: state.returnLastFrame,
    serviceTier: state.serviceTier,
    generateAudio: job.generateAudio ?? state.generateAudio,
    watermark: job.watermark ?? state.watermark,
    mode: 'draft_task',
    draftTaskId: job.id,
    draft: false,
    promptText: '',
  };

  submitGeneration(jobConfig).catch(err => {
    console.warn('Make official failed:', err);
    showError(`Failed to create official video:\n\n${err.message || err}`);
  });
}

function extendFromJob(job) {
  if (!job || !job.lastFrameUrl) return;
  const promptText = job.promptText || job.prompt || textPrompt?.value?.trim() || '';
  state.firstFrameDataUrl = job.lastFrameUrl;
  state.firstFrameFile = null;
  if (firstFrameThumb) {
    firstFrameThumb.src = job.lastFrameUrl;
    firstFrameThumb.classList.remove('hidden');
    firstFrameBtn?.classList.add('has-image');
  }
  if (firstFrameRemove) firstFrameRemove.classList.remove('hidden');
  state.imageDataUrl = job.lastFrameUrl;
  state.imageFile = null;
  dropContent.classList.add('hidden');
  removeImgBtn.classList.remove('hidden');

  textPrompt.value = promptText;
  charCount.textContent = textPrompt.value.length;
  setMode('image');
  updateJsonPreview();
  showToast('Last frame loaded. Press Generate to extend.', 'info', '⏱️');
}

function loadVideoIntoCard(taskId, videoUrl) {
  const thumbEl = $(`thumb-${taskId}`);
  if (!thumbEl || !videoUrl) return;
  document.querySelectorAll('.video-card-thumb video').forEach(v => {
    if (!v.paused) v.pause();
  });
  thumbEl.innerHTML = '';
  const video = document.createElement('video');
  video.src = getProxiedVideoUrl(videoUrl);
  video.controls = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'metadata';
  thumbEl.appendChild(video);
  video.addEventListener('play', () => {
    document.querySelectorAll('.video-card-thumb video').forEach(v => {
      if (v !== video && !v.paused) v.pause();
    });
  });
  video.addEventListener('error', () => {
    showToast('Video failed to load. Try refresh or regenerate.', 'error', '⚠️');
  });
  video.play().catch(() => { });
}

function extractVideoUrl(data) {
  if (!data || typeof data !== 'object') return null;
  const direct = data.video_url || data.videoUrl || null;
  if (direct) return direct;
  const content = data.content || data.output || data.result || data.data?.content || data.data?.output || null;
  if (content?.video_url) return content.video_url;
  if (content?.videoUrl) return content.videoUrl;
  if (Array.isArray(content) && content[0]?.video_url) return content[0].video_url;
  if (Array.isArray(content) && content[0]?.url) return content[0].url;
  if (data.data?.video_url) return data.data.video_url;
  if (data.data?.result?.video_url) return data.data.result.video_url;
  return null;
}

function scheduleRemoteSync() {
  if (!state.apiKey) return;
  if (listSyncTimer) clearTimeout(listSyncTimer);
  listSyncTimer = setTimeout(() => {
    syncRemoteGenerations().catch(err => console.warn('Sync failed:', err));
  }, 500);
}

async function syncRemoteGenerations() {
  if (!state.apiKey || listSyncInFlight) return;
  listSyncInFlight = true;
  try {
    const url = new URL(API_BASE);
    url.searchParams.set('page_num', '1');
    url.searchParams.set('page_size', '50');
    // Note: filter key names may differ; adjust if your API expects a different schema.
    url.searchParams.set('filter.status', 'succeeded');
    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${state.apiKey}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    const data = await res.json().catch(() => ({}));
    const items = data.items || data.data?.items || data.tasks || data.data || [];
    if (!Array.isArray(items)) return;
    items.forEach(item => upsertRemoteJob(item));
    updateEmptyState();
  } finally {
    listSyncInFlight = false;
  }
}

function upsertRemoteJob(item) {
  const id = item.id || item.task_id || item.taskId;
  if (!id) return;
  const status = item.status || item.state || 'succeeded';
  const videoUrl = extractVideoUrl(item) || item.content?.video_url || item.video_url || item.output?.video_url || item.result?.video_url || null;
  const prompt = item.prompt || item.input?.prompt || item.request?.prompt || '';
  const model = item.model || item.input?.model || 'model';
  const ratio = item.ratio || item.input?.ratio || state.ratio || '16:9';
  const duration = item.duration || item.input?.duration || state.duration || 5;
  const resolution = item.resolution || item.input?.resolution || null;
  const returnLastFrame = item.return_last_frame ?? item.input?.return_last_frame ?? false;
  const serviceTier = item.service_tier || item.input?.service_tier || 'default';
  const draft = item.draft ?? item.is_draft ?? item.input?.draft ?? false;
  const mode = item.mode || item.input?.mode || (item.input?.image_url ? 'image' : 'text');
  const promptText = item.input?.prompt || item.prompt || '';
  const tokensUsed = extractTokensUsed(item);
  const lastFrameUrl = extractLastFrameUrl(item);
  const ts = item.created_at || item.createdAt || item.timestamp || new Date().toISOString();
  const timestamp = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);

  let job = state.jobs.find(j => j.id === id);
  if (!job) {
    job = { id, status, videoUrl, prompt, model, ratio, duration, resolution, returnLastFrame, serviceTier, timestamp, draft, mode, promptText, tokensUsed, lastFrameUrl };
    state.jobs.push(job);
    renderJobCard(job);
  } else {
    job.status = status;
    job.videoUrl = videoUrl || job.videoUrl;
    job.prompt = job.prompt || prompt;
    job.model = job.model || model;
    job.ratio = job.ratio || ratio;
    job.duration = job.duration || duration;
    job.resolution = job.resolution || resolution;
    job.returnLastFrame = job.returnLastFrame ?? returnLastFrame;
    job.serviceTier = job.serviceTier || serviceTier;
    job.draft = job.draft ?? draft;
    job.mode = job.mode || mode;
    job.promptText = job.promptText || promptText;
    job.tokensUsed = job.tokensUsed ?? tokensUsed;
    job.lastFrameUrl = job.lastFrameUrl || lastFrameUrl;
  }

  if (status === 'succeeded' && job.videoUrl) updateJobCard(id, 'succeeded', job.videoUrl);
  else if (status === 'failed') updateJobCard(id, 'failed');

  saveVideoJob(job, job.videoBlob || null);
}

async function ensureThumbnail(job, taskId, videoUrl) {
  if (!job) return;
  if (job.thumbDataUrl || job.thumbDisabled || job._thumbLoading) return;
  job._thumbLoading = true;
  try {
    const thumb = await fetchVideoThumbnail(videoUrl);
    if (!thumb) {
      job.thumbDisabled = true;
      await saveVideoJob(job, job.videoBlob || null);
      const holder = $(`thumb-${taskId}`);
      const placeholder = holder?.querySelector('.thumb-placeholder');
      if (placeholder) placeholder.textContent = 'Thumbnail unavailable';
      return;
    }
    job.thumbDataUrl = thumb;
    await saveVideoJob(job, job.videoBlob || null);
    const thumbEl = $(`thumb-${taskId}`);
    if (thumbEl) {
      thumbEl.innerHTML = '';
      const img = document.createElement('img');
      img.src = thumb;
      img.alt = 'Thumbnail';
      thumbEl.appendChild(img);
      if (videoUrl && !thumbEl.querySelector('.thumb-play-btn')) {
        const play = document.createElement('button');
        play.className = 'thumb-play-btn';
        play.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><polygon points="7,5 19,12 7,19" fill="currentColor"/></svg>`;
        play.title = 'Play';
        play.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          loadVideoIntoCard(taskId, videoUrl);
        });
        thumbEl.appendChild(play);
      }
    }
    window.syncMediaLibrary?.();
  } catch (e) {
    console.warn('Thumbnail failed:', e);
  } finally {
    job._thumbLoading = false;
  }
}

async function fetchVideoThumbnail(videoUrl) {
  // Prefer server-side thumbnail if available
  if (location.protocol !== 'file:' && location.origin !== 'null') {
    try {
      const res = await fetch(`/api/thumb?url=${encodeURIComponent(videoUrl)}`);
      if (res.ok) {
        const blob = await res.blob();
        return await blobToDataUrl(blob);
      }
      await res.json().catch(() => ({}));
    } catch (e) {
    }
  }
  // Fallback: client-side capture (may still be lightweight)
  return await captureThumbnailClient(videoUrl);
}

function captureThumbnailClient(videoUrl) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    const src = getProxiedVideoUrl(videoUrl);
    v.src = src;
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;
    v.addEventListener('loadedmetadata', () => {
      const target = Math.max(0.05, Math.min(0.1, (v.duration || 1) - 0.05));
      v.currentTime = target;
    }, { once: true });
    v.addEventListener('seeked', () => {
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth || 640;
      canvas.height = v.videoHeight || 360;
      const ctx = canvas.getContext('2d');
      try {
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      }
    }, { once: true });
    v.addEventListener('error', () => resolve(null), { once: true });
    try { v.load(); } catch { resolve(null); }
  });
}

function copyVideoUrl(url) {
  navigator.clipboard.writeText(url).then(() => showToast('Video URL copied!', 'success', '📋'));
}
window.copyVideoUrl = copyVideoUrl;

// Refresh a task to get a fresh signed video URL (useful if links expire)
async function refreshJobVideoUrl(jobId, { silent = false } = {}) {
  if (!state.apiKey || !jobId) return null;
  try {
    const res = await fetch(`${API_BASE}/${jobId}`, {
      headers: { 'Authorization': `Bearer ${state.apiKey}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (!silent) showToast(`Refresh failed (HTTP ${res.status})`, 'error', '⚠️');
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    const data = await res.json().catch(() => ({}));
    const freshUrl = extractVideoUrl(data);
    if (!freshUrl) {
      if (!silent) showToast('No fresh video URL returned', 'error', '⚠️');
      return null;
    }
    const job = state.jobs.find(j => j.id === jobId);
    if (job) {
      job.videoUrl = freshUrl;
      job.status = data.status || job.status || 'succeeded';
      job.lastFrameUrl = extractLastFrameUrl(data) || job.lastFrameUrl;
      job.tokensUsed = extractTokensUsed(data) ?? job.tokensUsed;
      saveVideoJob(job, job.videoBlob || null);
      if (job.status === 'succeeded') updateJobCard(jobId, 'succeeded', freshUrl);
    }
    window.syncMediaLibrary?.();
    if (!silent) showToast('Video link refreshed', 'success', '🔁');
    return freshUrl;
  } catch (e) {
    if (!silent) console.warn('Refresh failed:', e);
    return null;
  }
}
window.refreshJobVideoUrl = refreshJobVideoUrl;

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
