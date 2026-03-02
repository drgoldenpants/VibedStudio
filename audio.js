/* ============================================================
   VibedStudio AI Video Studio — audio.js
   Sonauto audio generation + IndexedDB persistence
   ============================================================ */

const AUDIO_API_BASE = '/api/sonauto';
const AUDIO_STREAM_BASE = 'https://api-stream.sonauto.ai/stream';

const AUDIO_MODELS = [
    {
        id: 'v3',
        name: 'Sonauto v3 Preview',
        badge: 'PREVIEW',
        endpoint: 'v3',
        desc: 'Streaming-ready, faster generations',
        supports: {
            outputs: false,
            balance: false,
            bpm: false,
            seed: false,
            align: true,
            streaming: true,
        },
    },
    {
        id: 'v2',
        name: 'Sonauto v2',
        badge: 'STABLE',
        endpoint: 'v2',
        desc: '1-2 songs, BPM + seed, alignment supported',
        supports: {
            outputs: true,
            balance: true,
            bpm: true,
            seed: true,
            align: true,
            streaming: false,
        },
    },
];

const audioState = {
    model: 'v3',
    outputCount: 1,
    promptStrength: 2.0,
    balanceStrength: 0.7,
    bpm: 'auto',
    seed: '',
    format: 'ogg',
    bitrate: '',
    instrumental: false,
    alignLyrics: false,
    streaming: true,
    prompt: '',
    lyrics: '',
    tags: '',
    count: 0,
    page: 1,
};

let audioInited = false;
const audioQueue = [];
let audioProcessing = false;
const audioJobs = new Map();
const AUDIO_THUMB_SIZE = { w: 320, h: 180 };
const AUDIO_PENDING_KEY = 'vibedstudio_audio_pending';
const AUDIO_THUMB_MIGRATION_KEY = 'vibedstudio_audio_thumb_gradient_v1';
const audioRunning = new Set();
const AUDIO_PAGE_SIZE = 12;

window.initAudio = async function initAudio() {
    if (audioInited) return;
    audioInited = true;

    renderAudioModelGrid();

    const outputRange = document.getElementById('audio-output-range');
    if (outputRange) {
        outputRange.addEventListener('input', () => {
            audioState.outputCount = clampAudioOutput(parseInt(outputRange.value, 10) || 1);
            outputRange.value = audioState.outputCount;
            updateAudioOutputLabel();
            updateAudioJsonPreview();
            updateAudioPills();
        });
    }

    const promptStrength = document.getElementById('audio-prompt-strength');
    if (promptStrength) {
        promptStrength.addEventListener('input', () => {
            audioState.promptStrength = parseFloat(promptStrength.value) || 0;
            updateAudioLabels();
            updateAudioJsonPreview();
        });
    }

    const balanceStrength = document.getElementById('audio-balance-strength');
    if (balanceStrength) {
        balanceStrength.addEventListener('input', () => {
            audioState.balanceStrength = parseFloat(balanceStrength.value) || 0;
            updateAudioLabels();
            updateAudioJsonPreview();
        });
    }

    const bpmInput = document.getElementById('audio-bpm');
    if (bpmInput) {
        bpmInput.addEventListener('input', () => {
            audioState.bpm = bpmInput.value.trim();
            updateAudioJsonPreview();
        });
    }

    const seedInput = document.getElementById('audio-seed');
    if (seedInput) {
        seedInput.addEventListener('input', () => {
            audioState.seed = seedInput.value.trim();
            updateAudioJsonPreview();
        });
    }

    const formatSelect = document.getElementById('audio-format');
    if (formatSelect) {
        formatSelect.addEventListener('change', () => {
            audioState.format = formatSelect.value;
            updateAudioControls();
            updateAudioJsonPreview();
            updateAudioPills();
        });
    }

    const bitrateSelect = document.getElementById('audio-bitrate');
    if (bitrateSelect) {
        bitrateSelect.addEventListener('change', () => {
            audioState.bitrate = bitrateSelect.value;
            updateAudioJsonPreview();
        });
    }

    const instrumentalToggle = document.getElementById('audio-instrumental');
    if (instrumentalToggle) {
        instrumentalToggle.addEventListener('change', () => {
            audioState.instrumental = instrumentalToggle.checked;
            if (audioState.instrumental) {
                audioState.alignLyrics = false;
                const align = document.getElementById('audio-align-lyrics');
                if (align) align.checked = false;
            }
            updateAudioJsonPreview();
        });
    }

    const alignToggle = document.getElementById('audio-align-lyrics');
    if (alignToggle) {
        alignToggle.addEventListener('change', () => {
            audioState.alignLyrics = alignToggle.checked;
            updateAudioJsonPreview();
        });
    }

    const streamToggle = document.getElementById('audio-streaming');
    if (streamToggle) {
        streamToggle.addEventListener('change', () => {
            audioState.streaming = streamToggle.checked;
            updateAudioJsonPreview();
        });
    }

    const promptEl = document.getElementById('audio-prompt');
    if (promptEl) {
        promptEl.addEventListener('input', () => {
            audioState.prompt = promptEl.value;
            document.getElementById('audio-char-count').textContent = audioState.prompt.length;
            updateAudioJsonPreview();
            updateAudioPills();
        });
        document.getElementById('audio-char-count').textContent = audioState.prompt.length;
    }

    const lyricsEl = document.getElementById('audio-lyrics');
    if (lyricsEl) {
        lyricsEl.addEventListener('input', () => {
            audioState.lyrics = lyricsEl.value;
            document.getElementById('audio-lyrics-count').textContent = audioState.lyrics.length;
            updateAudioJsonPreview();
        });
        document.getElementById('audio-lyrics-count').textContent = audioState.lyrics.length;
    }

    const tagsEl = document.getElementById('audio-tags');
    if (tagsEl) {
        tagsEl.addEventListener('input', () => {
            audioState.tags = tagsEl.value;
            updateAudioJsonPreview();
        });
    }

    const copyBtn = document.getElementById('audio-copy-json');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const payload = buildAudioPayload({ preview: true });
            navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => {
                showToast('JSON copied to clipboard', 'success', '📋');
            });
        });
    }

    const copyRespBtn = document.getElementById('audio-copy-response');
    if (copyRespBtn) {
        copyRespBtn.addEventListener('click', () => {
            const text = document.getElementById('audio-json-response')?.textContent || '';
            navigator.clipboard.writeText(text).then(() => {
                showToast('Response copied to clipboard', 'success', '📋');
            });
        });
    }

    const genBtn = document.getElementById('audio-generate-btn');
    if (genBtn) {
        genBtn.addEventListener('click', handleAudioGenerate);
    }

    const refreshBtn = document.getElementById('audio-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => refreshAudioHistory());
    }
    const prevBtn = document.getElementById('audio-prev-page');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            audioState.page = Math.max(1, audioState.page - 1);
            applyAudioPagination();
        });
    }
    const nextBtn = document.getElementById('audio-next-page');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            audioState.page += 1;
            applyAudioPagination();
        });
    }
    const exportBtn = document.getElementById('audio-export-audio');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            exportAllAudio().catch(e => {
                console.warn('Export audio failed:', e);
                showToast('Export failed', 'error', '❌');
            });
        });
    }

    updateAudioLabels();
    updateAudioOutputLabel();
    updateAudioControls();
    updateAudioJsonPreview();
    updateAudioPills();
    setAudioResponsePreview({ status: 'idle' });

    restorePendingAudioJobs();
    await migrateAudioThumbsToGradient();
    await loadAudioFromDB();
    applyAudioPagination();
};

window.getAudioGeneratorState = function getAudioGeneratorState() {
    return {
        model: audioState.model,
        outputCount: audioState.outputCount,
        promptStrength: audioState.promptStrength,
        balanceStrength: audioState.balanceStrength,
        bpm: audioState.bpm,
        seed: audioState.seed,
        format: audioState.format,
        bitrate: audioState.bitrate,
        instrumental: audioState.instrumental,
        alignLyrics: audioState.alignLyrics,
        streaming: audioState.streaming,
        prompt: audioState.prompt,
        lyrics: audioState.lyrics,
        tags: audioState.tags,
    };
};

window.applyAudioGeneratorState = function applyAudioGeneratorState(state) {
    if (!state) return;
    if (state.model) audioState.model = state.model;
    if (state.outputCount) audioState.outputCount = clampAudioOutput(state.outputCount);
    if (state.promptStrength != null) audioState.promptStrength = Number(state.promptStrength) || 0;
    if (state.balanceStrength != null) audioState.balanceStrength = Number(state.balanceStrength) || 0;
    if (state.bpm != null) audioState.bpm = String(state.bpm);
    if (state.seed != null) audioState.seed = String(state.seed);
    if (state.format) audioState.format = state.format;
    if (state.bitrate != null) audioState.bitrate = String(state.bitrate);
    audioState.instrumental = !!state.instrumental;
    audioState.alignLyrics = !!state.alignLyrics;
    audioState.streaming = !!state.streaming;
    audioState.prompt = state.prompt || '';
    audioState.lyrics = state.lyrics || '';
    audioState.tags = state.tags || '';

    const promptEl = document.getElementById('audio-prompt');
    if (promptEl) promptEl.value = audioState.prompt;
    const lyricsEl = document.getElementById('audio-lyrics');
    if (lyricsEl) lyricsEl.value = audioState.lyrics;
    const tagsEl = document.getElementById('audio-tags');
    if (tagsEl) tagsEl.value = audioState.tags;
    const outRange = document.getElementById('audio-output-range');
    if (outRange) outRange.value = audioState.outputCount;
    const promptStrength = document.getElementById('audio-prompt-strength');
    if (promptStrength) promptStrength.value = audioState.promptStrength;
    const balanceStrength = document.getElementById('audio-balance-strength');
    if (balanceStrength) balanceStrength.value = audioState.balanceStrength;
    const bpmInput = document.getElementById('audio-bpm');
    if (bpmInput) bpmInput.value = audioState.bpm;
    const seedInput = document.getElementById('audio-seed');
    if (seedInput) seedInput.value = audioState.seed;
    const formatSelect = document.getElementById('audio-format');
    if (formatSelect) formatSelect.value = audioState.format;
    const bitrateSelect = document.getElementById('audio-bitrate');
    if (bitrateSelect) bitrateSelect.value = audioState.bitrate;
    const instToggle = document.getElementById('audio-instrumental');
    if (instToggle) instToggle.checked = audioState.instrumental;
    const alignToggle = document.getElementById('audio-align-lyrics');
    if (alignToggle) alignToggle.checked = audioState.alignLyrics;
    const streamToggle = document.getElementById('audio-streaming');
    if (streamToggle) streamToggle.checked = audioState.streaming;
    const promptCount = document.getElementById('audio-char-count');
    if (promptCount) promptCount.textContent = audioState.prompt.length;
    const lyricsCount = document.getElementById('audio-lyrics-count');
    if (lyricsCount) lyricsCount.textContent = audioState.lyrics.length;

    renderAudioModelGrid();
    updateAudioLabels();
    updateAudioOutputLabel();
    updateAudioControls();
    updateAudioJsonPreview();
    updateAudioPills();
};

window.applyAudioHistory = function applyAudioHistory(records) {
    const grid = document.getElementById('audio-grid');
    if (!grid) return;
    grid.innerHTML = '';
    audioState.count = 0;
    audioState.page = 1;
    const list = Array.isArray(records) ? records.slice() : [];
    list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    list.forEach(r => {
        const record = { ...r };
        if (!record.blob && record.blobBase64 && typeof dataUrlToBlob === 'function') {
            try { record.blob = dataUrlToBlob(record.blobBase64); } catch { record.blob = null; }
        }
        normalizeAudioRecordUrls(record);
        renderSavedAudioCard(record);
        audioState.count++;
    });
    const badge = document.getElementById('audio-count-badge');
    if (badge) badge.textContent = audioState.count;
    updateAudioEmptyState();
    applyAudioPagination();
};

// ── Model grid ────────────────────────────────────────────────
function renderAudioModelGrid() {
    const grid = document.getElementById('audio-model-grid');
    if (!grid) return;
    grid.innerHTML = AUDIO_MODELS.map(m => {
        return `
        <label class="model-card ${m.id === audioState.model ? 'selected' : ''}" data-model="${m.id}">
            <input type="radio" name="audio-model" value="${m.id}" ${m.id === audioState.model ? 'checked' : ''} hidden />
            <div class="model-badge lite">${m.badge || 'AUDIO'}</div>
            <div class="model-name">${m.name}</div>
            <div class="model-desc">${escAudio(m.desc)}</div>
        </label>`;
    }).join('');

    grid.querySelectorAll('.model-card').forEach(card => {
        card.addEventListener('click', () => {
            grid.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            audioState.model = card.dataset.model;
            updateAudioControls();
            updateAudioOutputLabel();
            updateAudioJsonPreview();
            updateAudioPills();
        });
    });
}

function clampAudioOutput(value) {
    const model = getAudioModel();
    const min = 1;
    const max = model.supports.outputs ? 2 : 1;
    return Math.min(max, Math.max(min, value));
}

function updateAudioControls() {
    const model = getAudioModel();
    const outputRange = document.getElementById('audio-output-range');
    const outputHint = document.getElementById('audio-output-hint');
    const balanceWrap = document.getElementById('audio-balance-strength');
    const bpmInput = document.getElementById('audio-bpm');
    const seedInput = document.getElementById('audio-seed');
    const alignToggle = document.getElementById('audio-align-lyrics');
    const streamToggle = document.getElementById('audio-streaming');
    const bitrateSelect = document.getElementById('audio-bitrate');

    if (outputRange) {
        outputRange.disabled = !model.supports.outputs;
        audioState.outputCount = clampAudioOutput(audioState.outputCount);
        outputRange.value = audioState.outputCount;
    }
    if (outputHint) {
        outputHint.textContent = model.supports.outputs
            ? 'v2 supports 1-2 songs, v3 always 1'
            : 'v3 generates one song per request';
    }
    if (balanceWrap) {
        balanceWrap.disabled = !model.supports.balance;
    }
    if (bpmInput) {
        bpmInput.disabled = !model.supports.bpm;
    }
    if (seedInput) {
        seedInput.disabled = !model.supports.seed;
    }
    if (alignToggle) {
        const disableAlign = !model.supports.align
            || audioState.instrumental
            || (model.id === 'v2' && audioState.outputCount > 1);
        alignToggle.disabled = disableAlign;
        if (disableAlign) {
            alignToggle.checked = false;
            audioState.alignLyrics = false;
        }
    }
    if (streamToggle) {
        streamToggle.disabled = !model.supports.streaming;
        if (!model.supports.streaming) {
            streamToggle.checked = false;
            audioState.streaming = false;
        } else {
            streamToggle.checked = !!audioState.streaming;
        }
    }

    if (bitrateSelect) {
        const needsBitrate = audioState.format === 'mp3' || audioState.format === 'm4a';
        bitrateSelect.disabled = !needsBitrate;
        if (!needsBitrate) {
            bitrateSelect.value = '';
            audioState.bitrate = '';
        }
    }
}

function updateAudioLabels() {
    const strengthLabel = document.getElementById('audio-prompt-strength-label');
    if (strengthLabel) strengthLabel.textContent = audioState.promptStrength.toFixed(1);
    const balanceLabel = document.getElementById('audio-balance-label');
    if (balanceLabel) balanceLabel.textContent = audioState.balanceStrength.toFixed(2);
}

function updateAudioOutputLabel() {
    const label = document.getElementById('audio-output-label');
    if (label) label.textContent = `${audioState.outputCount} song${audioState.outputCount > 1 ? 's' : ''}`;
}

function updateAudioPills() {
    const model = getAudioModel();
    const pillModel = document.getElementById('audio-pill-model');
    const pillOutputs = document.getElementById('audio-pill-outputs');
    const pillFormat = document.getElementById('audio-pill-format');
    const pillCost = document.getElementById('audio-pill-cost');
    if (pillModel) pillModel.textContent = `Model ${model.name}`;
    if (pillOutputs) pillOutputs.textContent = `Outputs ${audioState.outputCount}`;
    if (pillFormat) pillFormat.textContent = `Format ${audioState.format.toUpperCase()}`;
    if (pillCost) {
        const credits = audioState.outputCount > 1 ? 150 : 100;
        pillCost.textContent = `Est. cost ~${credits} credits`;
    }
}

function buildAudioPayload({ preview = false } = {}) {
    const model = getAudioModel();
    const tags = parseTags(audioState.tags);
    const prompt = (audioState.prompt || '').trim();
    const lyrics = audioState.instrumental ? '' : (audioState.lyrics || '').trim();
    const payload = {
        prompt: prompt,
        tags: tags.length ? tags : undefined,
        lyrics: lyrics || undefined,
        instrumental: !!audioState.instrumental,
        prompt_strength: Number(audioState.promptStrength) || 0,
        output_format: audioState.format || 'ogg',
    };

    if ((audioState.format === 'mp3' || audioState.format === 'm4a') && audioState.bitrate) {
        payload.output_bit_rate = Number(audioState.bitrate);
    }

    if (model.id === 'v2') {
        payload.num_songs = clampAudioOutput(audioState.outputCount);
        payload.balance_strength = Number(audioState.balanceStrength) || 0.7;
        if (audioState.seed) {
            const seedNum = parseInt(audioState.seed, 10);
            if (!Number.isNaN(seedNum)) payload.seed = seedNum;
        }
        if (audioState.bpm !== '') {
            const bpm = audioState.bpm.trim();
            if (bpm && bpm.toLowerCase() === 'auto') payload.bpm = 'auto';
            else {
                const bpmNum = parseInt(bpm, 10);
                if (!Number.isNaN(bpmNum)) payload.bpm = bpmNum;
            }
        }
    }

    if (model.id === 'v3') {
        if (audioState.streaming) {
            payload.enable_streaming = true;
            payload.stream_format = audioState.format === 'mp3' ? 'mp3' : 'ogg';
        }
    }

    if (audioState.alignLyrics && !audioState.instrumental) {
        payload.align_lyrics = true;
    }

    if (preview) {
        const safe = { ...payload };
        if (safe.tags === undefined) delete safe.tags;
        if (safe.lyrics === undefined) delete safe.lyrics;
        return safe;
    }
    return payload;
}

async function handleAudioGenerate() {
    const key = (window.state?.sonautoApiKey || document.getElementById('sonauto-api-key')?.value || '').trim();
    if (!key) {
        showError('No Sonauto API key found.\n\nPaste your key in the Authentication bar before generating audio.');
        return;
    }

    const prompt = (audioState.prompt || '').trim();
    const tags = parseTags(audioState.tags);
    const lyrics = (audioState.lyrics || '').trim();
    if (!prompt && !tags.length && !lyrics) {
        showError('Add a prompt, tags, or lyrics before generating audio.');
        return;
    }

    if (audioState.instrumental && lyrics) {
        showToast('Instrumental enabled: lyrics will be ignored.', 'info', '🎵');
    }

    if (audioState.alignLyrics && audioState.outputCount > 1) {
        audioState.outputCount = 1;
        const outputRange = document.getElementById('audio-output-range');
        if (outputRange) outputRange.value = 1;
        updateAudioOutputLabel();
        showToast('Align lyrics requires 1 song. Output count set to 1.', 'info', '🎼');
    }

    const payload = buildAudioPayload();
    updateAudioJsonPreview(payload);

    const job = {
        id: `audio-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        payload,
        key,
        prompt: prompt || 'Audio generation',
        tags,
        lyrics,
        model: audioState.model,
        format: audioState.format,
        bitrate: audioState.bitrate,
        streaming: audioState.streaming,
        outputCount: audioState.outputCount,
        instrumental: audioState.instrumental,
        status: 'queued',
        startedAt: Date.now(),
    };
    enqueueAudioJob(job);
}

function enqueueAudioJob(job) {
    audioJobs.set(job.id, job);
    addQueuedAudioCard(job);
    audioQueue.push(job);
    updateAudioQueueStatus();
    persistPendingAudioJobs();
    processAudioQueue();
}

async function processAudioQueue() {
    if (audioProcessing) return;
    audioProcessing = true;
    while (audioQueue.length) {
        const job = audioQueue.shift();
        if (!job || job.cancelled) continue;
        if (!job.startedAt) job.startedAt = Date.now();
        job.status = 'running';
        audioRunning.add(job.id);
        persistPendingAudioJobs();
        updateAudioCardStatus(job.id, 'running');
        try {
            await runAudioJob(job);
        } catch (err) {
            console.error(err);
            setAudioResponsePreview({ ok: false, error: err.message || String(err) });
            updateAudioCardStatus(job.id, 'failed', err.message);
            showError(`Audio generation failed:\n\n${err.message || err}`);
            audioRunning.delete(job.id);
            removePendingAudioJob(job.id);
        }
        updateAudioQueueStatus();
    }
    audioProcessing = false;
}

function updateAudioQueueStatus() {
    const queueCount = audioQueue.length;
    const btn = document.getElementById('audio-generate-btn');
    if (!btn) return;
    const label = btn.querySelector('.btn-text');
    if (!label) return;
    if (audioProcessing && queueCount > 0) {
        label.textContent = `Queued (${queueCount})`;
    } else if (audioProcessing) {
        label.textContent = 'Generating…';
    } else {
        label.textContent = 'Generate Music';
    }
}

async function runAudioJob(job) {
    const taskId = job.taskId || await createAudioTask(job.payload, job.key);
    job.taskId = taskId;
    job.status = 'running';
    persistPendingAudioJobs();
    setAudioResponsePreview({ status: 'pending', data: { task_id: taskId } });

    const statusData = await pollAudioStatus(taskId, job.key, job.streaming, job.id);
    if (statusData.status === 'FAILURE') {
        throw new Error(statusData.error_message || 'Audio generation failed');
    }

    const finalData = await fetchAudioResult(taskId, job.key);
    setAudioResponsePreview({ status: 'success', data: finalData });

    const songPathsRaw = Array.isArray(finalData.song_paths)
        ? finalData.song_paths
        : Array.isArray(finalData.songs)
            ? finalData.songs.map(s => s?.song_path || s?.url).filter(Boolean)
            : finalData.song_path
                ? [finalData.song_path]
                : [];
    const songPaths = (songPathsRaw || []).map(p => {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object') return p.song_path || p.url || '';
        return '';
    }).filter(Boolean);
    if (!songPaths.length) throw new Error('No audio URL returned from API');

    const records = [];
    for (let i = 0; i < songPaths.length; i++) {
        const url = songPaths[i];
        const record = await buildAudioRecord({
            id: `${taskId}-${i}`,
            url,
            prompt: finalData.prompt || job.prompt,
            lyrics: finalData.lyrics || (job.instrumental ? '' : job.lyrics),
            tags: finalData.tags || job.tags,
            model: finalData.model_version || job.model,
            format: job.format,
            bitrate: job.bitrate,
            timestamp: finalData.created_at || new Date().toISOString(),
        });
        records.push(record);
    }

    if (window.db) {
        for (const record of records) {
            await dbPut('audio', record);
        }
    }

    finishAudioCard(job.id, records[0]);
    updateAudioCardStatus(job.id, 'succeeded');
    audioRunning.delete(job.id);
    removePendingAudioJob(job.id);
    records.slice(1).forEach(r => renderSavedAudioCard(r));
    audioState.count += records.length;
    document.getElementById('audio-count-badge').textContent = audioState.count;
    updateAudioEmptyState();
    showToast(`Audio generated! (${records.length} track${records.length > 1 ? 's' : ''})`, 'success', '🎶');

    if (typeof window.addGeneratedAudioToEditor === 'function') {
        records.forEach(r => window.addGeneratedAudioToEditor(r));
    }
    records.forEach(r => {
        if (r?.id && r.blob) updateAudioCachedTag(r.id, true);
    });
}

function addQueuedAudioCard(job) {
    updateAudioEmptyState(true);
    const grid = document.getElementById('audio-grid');
    if (!grid) return;
    const thumb = job.thumbDataUrl || generateAudioThumb(job.id);
    job.thumbDataUrl = thumb;
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (!job.startedAt) job.startedAt = Date.now();
    const statusText = job.status === 'running' ? 'Generating…' : 'Queued';
    const modelName = getAudioModel().name;
    const visualizerMarkup = job.streaming ? renderAudioVisualizer(job.id) : '';
    const streamPlayerMarkup = job.streaming
        ? `<audio class="audio-thumb-player stream-pending" controls preload="none"></audio>`
        : '';
    const card = document.createElement('div');
    card.className = 'video-card audio-card generating';
    card.id = `audio-card-${job.id}`;
    card.innerHTML = `
        <div class="video-card-thumb">
            <img src="${thumb}" alt="Audio thumbnail" loading="lazy" />
            ${visualizerMarkup}
            ${streamPlayerMarkup}
            <div class="card-status" id="audio-status-${job.id}">
                <span class="spinner purple"></span>
                <span class="card-status-text">${statusText}</span>
                <span class="card-substatus"></span>
                <span class="card-timer" id="audio-timer-${job.id}">0s</span>
            </div>
        </div>
        <div class="video-card-info">
            <div class="card-meta">
                <span class="card-tag">${escAudio(modelName)}</span>
                <span class="card-tag cyan">${job.outputCount || 1}x</span>
                <span class="card-tag">${escAudio((job.format || 'ogg').toUpperCase())}</span>
                <span class="card-tag" style="margin-left:auto; opacity:0.6;">${timeStr}</span>
            </div>
            <p class="card-prompt">${escAudio(job.prompt || 'Audio generation')}</p>
            <div class="card-actions">
                <button class="card-btn danger" data-action="cancel-audio">Remove</button>
            </div>
        </div>
    `;
    const cancelBtn = card.querySelector('[data-action="cancel-audio"]');
    cancelBtn?.addEventListener('click', () => cancelQueuedAudio(job.id));
    if (job.streaming) bindAudioCardPlaybackFx(card);
    grid.insertBefore(card, grid.firstChild);
}

function cancelQueuedAudio(id) {
    const idx = audioQueue.findIndex(j => j.id === id);
    if (idx >= 0) {
        audioQueue.splice(idx, 1);
        const job = audioJobs.get(id);
        if (job) job.cancelled = true;
        updateAudioCardStatus(id, 'failed', 'Removed from queue.');
        removePendingAudioJob(id);
        updateAudioQueueStatus();
        return;
    }
    showToast('Audio is already generating and cannot be removed.', 'info', '🎧');
}

function updateAudioCardStatus(id, status, message) {
    const card = document.getElementById(`audio-card-${id}`);
    if (!card) return;
    const statusEl = card.querySelector('.card-status');
    const textEl = statusEl?.querySelector('.card-status-text');
    const subEl = statusEl?.querySelector('.card-substatus');
    const timerEl = statusEl?.querySelector('.card-timer');
    const job = audioJobs.get(id);
    if (!statusEl) return;
    if (job) job.status = status;
    statusEl.classList.remove('failed', 'succeeded');
    card.classList.toggle('generating', status === 'running' || status === 'queued');
    if (status === 'running') {
        if (textEl) textEl.textContent = 'Generating…';
        if (timerEl && job?.startedAt) {
            timerEl.textContent = formatElapsed((Date.now() - job.startedAt) / 1000);
        }
    } else if (status === 'queued') {
        if (textEl) textEl.textContent = 'Queued';
        if (timerEl) timerEl.textContent = '0s';
    } else if (status === 'failed') {
        statusEl.classList.add('failed');
        if (textEl) textEl.textContent = 'Failed';
        if (subEl) subEl.textContent = message || 'Generation failed.';
    }
}

function updateAudioCardSubstatus(id, text) {
    const card = document.getElementById(`audio-card-${id}`);
    const subEl = card?.querySelector('.card-substatus');
    if (subEl) subEl.textContent = text || '';
}

function markAudioCardStreamReady(cardId, taskId) {
    const card = document.getElementById(`audio-card-${cardId}`);
    if (!card || card.dataset.streamReady === '1') return;
    const audio = card.querySelector('.audio-thumb-player');
    if (!audio) return;
    card.dataset.streamReady = '1';
    audio.classList.remove('stream-pending');
    audio.src = `${AUDIO_STREAM_BASE}/${taskId}`;
    audio.load();
    updateAudioCardSubstatus(cardId, 'Streaming ready');
}

async function createAudioTask(payload, apiKey) {
    const model = getAudioModel();
    const res = await fetch(`${AUDIO_API_BASE}/generations/${model.endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data?.detail || data?.message || data?.error || `HTTP ${res.status}`);
    }
    if (!data.task_id) throw new Error('No task_id returned from API');
    return data.task_id;
}

async function pollAudioStatus(taskId, apiKey, streamingEnabled, cardId) {
    const includeAlignment = audioState.alignLyrics && !audioState.instrumental;
    const query = includeAlignment ? '?include_alignment=true' : '';
    let lastStatus = 'PENDING';
    for (let attempt = 0; attempt < 240; attempt++) {
        await sleep(1500);
        const res = await fetch(`${AUDIO_API_BASE}/generations/status/${taskId}${query}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        const data = await res.json().catch(() => null);
        let statusText = '';
        let alignment = null;
        if (typeof data === 'string') statusText = data;
        else if (data && data.status) {
            statusText = data.status;
            alignment = data.alignment_status || null;
        }

        if (statusText) lastStatus = statusText;
        updateAudioCardSubstatus(cardId, statusText);
        updateAudioCardStatus(cardId, 'running');
        setAudioResponsePreview({ status: statusText || lastStatus, data: { status: statusText || lastStatus, alignment_status: alignment } });

        if (streamingEnabled && statusText === 'GENERATING_STREAMING_READY') {
            markAudioCardStreamReady(cardId, taskId);
        }

        if (statusText === 'SUCCESS' || statusText === 'FAILURE') {
            return { status: statusText, alignment_status: alignment };
        }
    }
    return { status: lastStatus };
}

async function fetchAudioResult(taskId, apiKey) {
    const res = await fetch(`${AUDIO_API_BASE}/generations/${taskId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data?.detail || data?.message || data?.error || `HTTP ${res.status}`);
    }
    return data;
}

async function buildAudioRecord({ id, url, prompt, lyrics, tags, model, format, bitrate, timestamp }) {
    let blob = null;
    try {
        blob = await fetchAudioBlob(url);
    } catch {
        blob = null;
    }

    const record = {
        id,
        url,
        prompt: prompt || '',
        lyrics: lyrics || '',
        tags: Array.isArray(tags) ? tags : parseTags(tags),
        model: model || audioState.model,
        format: format || audioState.format,
        bitrate: bitrate || audioState.bitrate,
        timestamp: timestamp || new Date().toISOString(),
        thumbDataUrl: generateAudioThumb(id),
        blob,
        cached: !!blob,
    };

    if (blob) {
        record.blobUrl = URL.createObjectURL(blob);
        record.duration = await loadAudioDuration(record.blobUrl);
    } else {
        record.duration = await loadAudioDuration(url);
    }
    return record;
}

async function loadAudioDuration(src) {
    return new Promise(resolve => {
        if (!src) return resolve(0);
        const audio = document.createElement('audio');
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => resolve(audio.duration || 0);
        audio.onerror = () => resolve(0);
        audio.src = src;
    });
}

async function migrateAudioThumbsToGradient() {
    if (!window.db) return;
    try {
        if (localStorage.getItem(AUDIO_THUMB_MIGRATION_KEY) === '1') return;
    } catch {
    }
    try {
        const records = await dbGetAll('audio');
        let changed = false;
        for (const record of records) {
            if (!record || !record.id || !record.thumbDataUrl) continue;
            delete record.thumbDataUrl;
            await dbPut('audio', record);
            changed = true;
        }
        if (changed) {
            showToast('Updated audio covers to the new gradient style', 'info', '🎨');
        }
        try {
            localStorage.setItem(AUDIO_THUMB_MIGRATION_KEY, '1');
        } catch {
        }
    } catch (e) {
        console.warn('Audio thumbnail migration failed:', e);
    }
}

function normalizeAudioRecordUrls(record) {
    if (!record) return record;
    const hasBlob = record.blob instanceof Blob;
    const storedBlobUrl = typeof record.blobUrl === 'string' ? record.blobUrl : '';
    if (hasBlob) {
        record.blobUrl = URL.createObjectURL(record.blob);
        record.cached = true;
    } else if (storedBlobUrl.startsWith('blob:')) {
        record.blobUrl = '';
    }
    if (!record.blobUrl) record.blobUrl = record.url || '';
    return record;
}

async function loadAudioFromDB() {
    if (!window.db) return;
    try {
        const records = await dbGetAll('audio');
        if (!records.length) return;
        records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        records.forEach(r => {
            normalizeAudioRecordUrls(r);
            if (!r.thumbDataUrl) r.thumbDataUrl = generateAudioThumb(r.id);
            renderSavedAudioCard(r);
            audioState.count++;
            if (typeof window.addGeneratedAudioToEditor === 'function') {
                window.addGeneratedAudioToEditor(r);
            }
        });
        document.getElementById('audio-count-badge').textContent = audioState.count;
        updateAudioEmptyState();
        showToast(`Loaded ${records.length} audio track${records.length > 1 ? 's' : ''} from history`, 'info', '🎵');
    } catch (e) {
        console.warn('Could not load audio history:', e);
    }
}

// ── Card rendering ────────────────────────────────────────────
function addPendingAudioCard(id, prompt) {
    updateAudioEmptyState(true);
    const grid = document.getElementById('audio-grid');
    if (!grid) return;
    const thumb = generateAudioThumb(id);
    const card = document.createElement('div');
    card.className = 'video-card audio-card generating';
    card.id = `audio-card-${id}`;
    card.innerHTML = renderAudioCardInner({
        id,
        status: 'running',
        modelName: getAudioModel().name,
        outputCount: 1,
        format: audioState.format || 'ogg',
        timeStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        prompt: prompt || 'Generating…',
        thumb,
        showPlayer: false,
        actions: [],
    });
    grid.insertBefore(card, grid.firstChild);
}

function finishAudioCard(id, record) {
    const card = document.getElementById(`audio-card-${id}`);
    if (!card) return;
    const audioSrc = record.blobUrl || record.url;
    const modelName = record.model || getAudioModel().name;
    const timeStr = new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const thumb = record.thumbDataUrl || generateAudioThumb(record.id);
    record.thumbDataUrl = thumb;
    card.classList.remove('pending');
    card.innerHTML = renderAudioCardInner({
        id: record.id,
        status: 'succeeded',
        modelName,
        outputCount: 1,
        format: record.format || 'ogg',
        timeStr,
        prompt: record.prompt || 'Generated audio',
        thumb,
        showPlayer: true,
        audioSrc,
        duration: record.duration,
        cached: !!record.blob,
        actions: [
            { label: 'Download', href: audioSrc, download: `vibedstudio-${record.id}.${record.format || 'ogg'}` },
            { label: 'Copy URL', action: `copyAudioUrl('${record.url || audioSrc}')` },
            { label: 'Add to Editor', action: `addAudioToEditor('${record.id}')` },
            { label: 'Delete', className: 'danger', action: `deleteAudio('${record.id}')` },
        ],
    });
    bindAudioCardPlaybackFx(card);
}

function failAudioCard(id, message) {
    const card = document.getElementById(`audio-card-${id}`);
    if (!card) return;
    updateAudioCardStatus(id, 'failed', message || 'Please try again.');
}

function renderSavedAudioCard(record) {
    const grid = document.getElementById('audio-grid');
    if (!grid) return;
    const audioSrc = record.blobUrl || record.url;
    const timeStr = new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const modelName = record.model || getAudioModel().name;
    const thumb = record.thumbDataUrl || generateAudioThumb(record.id);
    record.thumbDataUrl = thumb;
    if (record.blob) record.cached = true;

    const card = document.createElement('div');
    card.className = 'video-card audio-card';
    card.id = `audio-card-${record.id}`;
    card.innerHTML = renderAudioCardInner({
        id: record.id,
        status: 'succeeded',
        modelName,
        outputCount: 1,
        format: record.format || 'ogg',
        timeStr,
        prompt: record.prompt || 'Generated audio',
        thumb,
        showPlayer: true,
        audioSrc,
        duration: record.duration,
        cached: !!record.blob,
        actions: [
            { label: 'Download', href: audioSrc, download: `vibedstudio-${record.id}.${record.format || 'ogg'}` },
            { label: 'Copy URL', action: `copyAudioUrl('${record.url || audioSrc}')` },
            { label: 'Add to Editor', action: `addAudioToEditor('${record.id}')` },
            { label: 'Delete', className: 'danger', action: `deleteAudio('${record.id}')` },
        ],
    });
    bindAudioCardPlaybackFx(card);
    grid.appendChild(card);
    applyAudioPagination();
}

function renderAudioCardInner({
    id,
    status,
    modelName,
    outputCount,
    format,
    timeStr,
    prompt,
    thumb,
    showPlayer,
    audioSrc,
    duration,
    cached,
    actions,
}) {
    const actionHtml = (actions || []).map(action => {
        if (action.href) {
            return `<a class="card-btn ${action.className || ''}" href="${action.href}" ${action.download ? `download="${action.download}"` : ''}>${action.label}</a>`;
        }
        if (action.action === 'cancel-audio') {
            return `<button class="card-btn ${action.className || ''}" data-action="cancel-audio">${action.label}</button>`;
        }
        if (action.action) {
            return `<button class="card-btn ${action.className || ''}" onclick="${action.action}">${action.label}</button>`;
        }
        return `<button class="card-btn ${action.className || ''}">${action.label}</button>`;
    }).join('');

    const durationTag = duration ? `<span class="card-tag green">${formatAudioDuration(duration)}</span>` : '';
    const cachedTag = cached ? `<span class="card-tag cached">Cached</span>` : '';
    const statusClass = status === 'succeeded' ? 'succeeded' : status === 'failed' ? 'failed' : '';
    const visualizerMarkup = showPlayer ? renderAudioVisualizer(id) : '';
    return `
        <div class="video-card-thumb">
            <img src="${thumb}" alt="Audio thumbnail" loading="lazy" />
            ${visualizerMarkup}
            ${showPlayer ? `<audio class="audio-thumb-player" controls preload="metadata" src="${audioSrc}"></audio>` : ''}
            <div class="card-status ${statusClass}">
                <span class="spinner purple"></span>
                <span class="card-status-text">${status === 'queued' ? 'Queued' : status === 'running' ? 'Generating…' : status === 'failed' ? 'Failed' : ''}</span>
                <span class="card-substatus"></span>
            </div>
        </div>
        <div class="video-card-info">
            <div class="card-meta">
                <span class="card-tag">${escAudio(modelName)}</span>
                <span class="card-tag cyan">${outputCount}x</span>
                <span class="card-tag">${escAudio((format || 'ogg').toUpperCase())}</span>
                ${durationTag}
                ${cachedTag}
                <span class="card-tag" style="margin-left:auto; opacity:0.6;">${timeStr}</span>
            </div>
            <p class="card-prompt">${escAudio(prompt)}</p>
            <div class="card-actions">${actionHtml}</div>
        </div>
    `;
}

function renderAudioVisualizer(id) {
    const variant = getAudioVisualizerVariant(id);
    if (variant === 'orb') {
        return `
            <div class="audio-visualizer orb-pulse" aria-hidden="true">
                <span class="audio-orb-core"></span>
                <span class="audio-orb-ring r1"></span>
                <span class="audio-orb-ring r2"></span>
                <span class="audio-orb-ring r3"></span>
            </div>`;
    }
    if (variant === 'sonar') {
        return `
            <div class="audio-visualizer radial-sonar" aria-hidden="true">
                <span class="audio-sonar-ring s1"></span>
                <span class="audio-sonar-ring s2"></span>
                <span class="audio-sonar-ring s3"></span>
                <span class="audio-sonar-ring s4"></span>
                <span class="audio-sonar-sweep"></span>
            </div>`;
    }
    const waveLines = Array.from({ length: 5 }, (_, idx) =>
        `<span class="audio-wave-line w${idx + 1}"></span>`).join('');
    return `<div class="audio-visualizer wave-ribbon" aria-hidden="true">${waveLines}</div>`;
}

function getAudioVisualizerVariant(id) {
    const variants = ['wave', 'orb', 'sonar'];
    const seed = Math.abs(hashString(String(id || 'audio')));
    return variants[seed % variants.length];
}

function bindAudioCardPlaybackFx(card) {
    if (!card || card.dataset.audioFxBound === '1') return;
    const audio = card.querySelector('.audio-thumb-player');
    if (!audio) return;
    card.dataset.audioFxBound = '1';
    const pauseOtherCards = () => {
        document.querySelectorAll('.audio-thumb-player').forEach(other => {
            if (other === audio) return;
            try { other.pause(); } catch {}
        });
    };
    const syncState = () => {
        const active = !audio.paused && !audio.ended && audio.readyState >= 2;
        card.classList.toggle('is-playing', active);
    };
    audio.addEventListener('play', pauseOtherCards);
    audio.addEventListener('play', syncState);
    audio.addEventListener('pause', syncState);
    audio.addEventListener('ended', syncState);
    audio.addEventListener('waiting', syncState);
    audio.addEventListener('playing', syncState);
    audio.addEventListener('emptied', syncState);
    syncState();
}

function generateAudioThumb(id) {
    const seed = hashString(id || String(Math.random()));
    const rand = mulberry32(seed);
    const canvas = document.createElement('canvas');
    canvas.width = AUDIO_THUMB_SIZE.w;
    canvas.height = AUDIO_THUMB_SIZE.h;
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, AUDIO_THUMB_SIZE.w, AUDIO_THUMB_SIZE.h);
    const hue = Math.floor(rand() * 360);
    g.addColorStop(0, `hsl(${hue}, 80%, 45%)`);
    g.addColorStop(1, `hsl(${(hue + 60) % 360}, 80%, 35%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, AUDIO_THUMB_SIZE.w, AUDIO_THUMB_SIZE.h);

    const glow = ctx.createRadialGradient(
        AUDIO_THUMB_SIZE.w * (0.2 + rand() * 0.6),
        AUDIO_THUMB_SIZE.h * (0.2 + rand() * 0.5),
        0,
        AUDIO_THUMB_SIZE.w * 0.5,
        AUDIO_THUMB_SIZE.h * 0.5,
        AUDIO_THUMB_SIZE.w * 0.8
    );
    glow.addColorStop(0, 'rgba(255,255,255,0.28)');
    glow.addColorStop(0.45, 'rgba(255,255,255,0.08)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, AUDIO_THUMB_SIZE.w, AUDIO_THUMB_SIZE.h);

    return canvas.toDataURL('image/png');
}

function updateAudioCachedTag(id, cached) {
    const card = document.getElementById(`audio-card-${id}`);
    if (!card) return;
    const meta = card.querySelector('.card-meta');
    if (!meta) return;
    let tag = meta.querySelector('.card-tag.cached');
    if (cached) {
        if (!tag) {
            tag = document.createElement('span');
            tag.className = 'card-tag cached';
            tag.textContent = 'Cached';
            const tail = meta.querySelector('.card-tag[style*="margin-left"]');
            if (tail) meta.insertBefore(tag, tail);
            else meta.appendChild(tag);
        }
        return;
    }
    if (tag) tag.remove();
}

function hashString(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function mulberry32(seed) {
    return function () {
        let t = seed += 0x6d2b79f5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Delete audio ──────────────────────────────────────────────
window.deleteAudio = async function deleteAudio(id) {
    if (window.db) await dbDelete('audio', id).catch(() => { });
    if (typeof window.removeMediaItemById === 'function') {
        window.removeMediaItemById(id);
    }
    const card = document.getElementById(`audio-card-${id}`);
    if (card) {
        card.style.transition = 'opacity 0.25s, transform 0.25s';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        setTimeout(() => {
            card.remove();
            audioState.count = Math.max(0, audioState.count - 1);
            document.getElementById('audio-count-badge').textContent = audioState.count;
            updateAudioEmptyState();
        }, 260);
    }
};

window.copyAudioUrl = async function copyAudioUrl(url) {
    try {
        await navigator.clipboard.writeText(url);
        showToast('URL copied!', 'success', '📋');
    } catch {
        showToast('Could not copy URL', 'error', '❌');
    }
};

window.addAudioToEditor = function addAudioToEditor(id) {
    if (!id) return;
    if (typeof window.addGeneratedAudioToEditor !== 'function') {
        showToast('Open the Editor tab to use this audio', 'info', '🎧');
        return;
    }
    if (window.dbGetAll) {
        window.dbGetAll('audio').then(records => {
            const record = records.find(r => r.id === id);
            if (record) {
                normalizeAudioRecordUrls(record);
                window.addGeneratedAudioToEditor(record);
                showToast('Added audio to Editor media list', 'success', '🎛️');
            }
        }).catch(() => {
            showToast('Could not locate audio in history', 'error', '❌');
        });
    }
};

// ── Empty state ───────────────────────────────────────────────
function updateAudioEmptyState(forceHide) {
    const empty = document.getElementById('audio-empty-state');
    const grid = document.getElementById('audio-grid');
    if (!empty || !grid) return;
    const hasCards = grid.children.length > 0;
    empty.style.display = (hasCards || forceHide) ? 'none' : 'flex';
}

async function refreshAudioHistory() {
    if (!window.db) return;
    try {
        const records = await dbGetAll('audio');
        for (const r of records) {
            if (r.blob instanceof Blob) continue;
            const url = r.url || r.blobUrl;
            if (!url || url.startsWith('data:')) continue;
            try {
                const res = await fetch(url, { cache: 'no-store' });
                if (!res.ok) continue;
                r.blob = await res.blob();
                r.blobUrl = URL.createObjectURL(r.blob);
                await dbPut('audio', r);
            } catch {
            }
        }
        window.applyAudioHistory(records || []);
        showToast('Audio history refreshed', 'info', '🔄');
    } catch (e) {
        console.warn('Audio refresh failed:', e);
    }
}

function applyAudioPagination() {
    const grid = document.getElementById('audio-grid');
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll('.audio-card'));
    const totalPages = Math.max(1, Math.ceil(cards.length / AUDIO_PAGE_SIZE));
    if (audioState.page > totalPages) audioState.page = totalPages;
    if (audioState.page < 1) audioState.page = 1;
    const start = (audioState.page - 1) * AUDIO_PAGE_SIZE;
    const end = start + AUDIO_PAGE_SIZE;
    cards.forEach((card, idx) => {
        card.style.display = idx >= start && idx < end ? '' : 'none';
    });
    const prevBtn = document.getElementById('audio-prev-page');
    const nextBtn = document.getElementById('audio-next-page');
    if (prevBtn) prevBtn.disabled = audioState.page <= 1;
    if (nextBtn) nextBtn.disabled = audioState.page >= totalPages;
}

function persistPendingAudioJobs() {
    const jobs = Array.from(audioJobs.values())
        .filter(j => j && (j.status === 'queued' || j.status === 'running'))
        .map(j => ({
            id: j.id,
            payload: j.payload,
            prompt: j.prompt,
            tags: j.tags,
            lyrics: j.lyrics,
            model: j.model,
            format: j.format,
            bitrate: j.bitrate,
            streaming: j.streaming,
            outputCount: j.outputCount,
            instrumental: j.instrumental,
            status: j.status,
            taskId: j.taskId || null,
            startedAt: j.startedAt || null,
            thumbDataUrl: j.thumbDataUrl || null,
        }));
    try {
        localStorage.setItem(AUDIO_PENDING_KEY, JSON.stringify(jobs));
    } catch {
    }
}

function removePendingAudioJob(id) {
    audioJobs.delete(id);
    persistPendingAudioJobs();
}

function restorePendingAudioJobs() {
    let list = [];
    try {
        list = JSON.parse(localStorage.getItem(AUDIO_PENDING_KEY) || '[]');
    } catch {
        list = [];
    }
    if (!Array.isArray(list) || !list.length) return;
    const running = list.filter(j => j.status === 'running');
    const queued = list.filter(j => j.status !== 'running');
    const restored = running.concat(queued);
    restored.forEach(j => {
        const job = {
            ...j,
            key: (window.state?.sonautoApiKey || localStorage.getItem('vibedstudio_sonauto_api_key') || ''),
        };
        if (!job.key) {
            job.status = 'queued';
        }
        audioJobs.set(job.id, job);
        addQueuedAudioCard(job);
        if (job.status === 'running') {
            updateAudioCardStatus(job.id, 'running');
        } else {
            updateAudioCardStatus(job.id, 'queued');
        }
        audioQueue.push(job);
    });
    updateAudioQueueStatus();
    processAudioQueue();
}

async function fetchAudioBlob(url) {
    if (!url) return null;
    const isHttp = /^https?:/i.test(url);
    const isBlob = /^blob:/i.test(url);
    const isData = /^data:/i.test(url);
    let sameOrigin = false;
    if (typeof location !== 'undefined' && isHttp) {
        try {
            sameOrigin = new URL(url, location.href).origin === location.origin;
        } catch {
            sameOrigin = false;
        }
    }

    const shouldDirectFetch = !isHttp || isBlob || isData || sameOrigin;
    if (shouldDirectFetch) {
        try {
            const res = await fetch(url, { cache: 'no-store' });
            if (res.ok) return await res.blob();
        } catch {
        }
    }

    if (typeof location !== 'undefined' && location.protocol.startsWith('http') && isHttp) {
        try {
            const proxyUrl = `/api/video?url=${encodeURIComponent(url)}`;
            const res = await fetch(proxyUrl, { cache: 'no-store' });
            if (res.ok) return await res.blob();
        } catch {
        }
    }
    return null;
}

async function exportAllAudio() {
    if (!window.db) return;
    const records = await dbGetAll('audio');
    if (!records.length) {
        showToast('No audio to export', 'info', '🎵');
        return;
    }

    const getExt = blob => {
        const type = (blob?.type || '').toLowerCase();
        if (type.includes('wav')) return 'wav';
        if (type.includes('mpeg')) return 'mp3';
        if (type.includes('ogg')) return 'ogg';
        if (type.includes('flac')) return 'flac';
        if (type.includes('mp4') || type.includes('aac')) return 'm4a';
        return (audioState.format || 'ogg').toLowerCase();
    };

    const fetchBlobForRecord = async record => {
        if (record.blob instanceof Blob) return record.blob;
        const url = record.url || record.blobUrl;
        if (!url) return null;
        return await fetchAudioBlob(url);
    };

    if (typeof window.showDirectoryPicker === 'function') {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        let exported = 0;
        for (const r of records) {
            const blob = await fetchBlobForRecord(r);
            if (!blob) continue;
            const ext = getExt(blob);
            const name = `vibedstudio-${String(r.id).slice(-10)}.${ext}`;
            const fileHandle = await dirHandle.getFileHandle(name, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            exported += 1;
        }
        showToast(`Exported ${exported} audio file${exported !== 1 ? 's' : ''}`, 'success', '📁');
        return;
    }

    let exported = 0;
    for (const r of records) {
        const blob = await fetchBlobForRecord(r);
        if (!blob) continue;
        const ext = getExt(blob);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vibedstudio-${String(r.id).slice(-10)}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        exported += 1;
    }
    showToast(`Exported ${exported} audio file${exported !== 1 ? 's' : ''}`, 'success', '📁');
}

window.ensureAudioCached = async function ensureAudioCached(id, { silent = false } = {}) {
    if (!window.db || !id) return null;
    try {
        const records = await dbGetAll('audio');
        const record = records.find(r => r.id === id);
        if (!record) return null;
        if (record.blob instanceof Blob) return record.blobUrl || URL.createObjectURL(record.blob);
        const url = record.url || record.blobUrl;
        if (!url || url.startsWith('data:')) return url;
        const blob = await fetchAudioBlob(url);
        if (!blob) return null;
        record.blob = blob;
        record.cached = true;
        record.blobUrl = URL.createObjectURL(blob);
        await dbPut('audio', record);
        updateAudioCachedTag(id, true);
        if (!silent) showToast('Audio cached', 'success', '🗂️');
        return record.blobUrl;
    } catch (e) {
        if (!silent) showToast('Could not cache audio', 'error', '❌');
        return null;
    }
};

// ── Request/Response previews ─────────────────────────────────
function updateAudioJsonPreview(customPayload) {
    const payload = customPayload || buildAudioPayload({ preview: true });
    const el = document.getElementById('audio-json-preview');
    if (!el) return;
    el.textContent = JSON.stringify(payload, null, 2);
}

function setAudioResponsePreview({ status, data, error }) {
    const el = document.getElementById('audio-json-response');
    if (!el) return;
    if (error) {
        el.textContent = JSON.stringify({ error }, null, 2);
        return;
    }
    if (status === 'idle') {
        el.textContent = '{}';
        return;
    }
    if (data) {
        el.textContent = JSON.stringify(data, null, 2);
        return;
    }
    el.textContent = JSON.stringify({ status }, null, 2);
}

// ── Helpers ───────────────────────────────────────────────────
function getAudioModel() {
    return AUDIO_MODELS.find(m => m.id === audioState.model) || AUDIO_MODELS[0];
}

function parseTags(input) {
    if (!input) return [];
    return input
        .split(',')
        .map(t => t.trim())
        .filter(Boolean)
        .slice(0, 32);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatAudioDuration(seconds) {
    if (typeof formatDur === 'function') return formatDur(seconds);
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}

function escAudio(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
