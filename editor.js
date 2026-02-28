/* ============================================================
   VibedStudio AI Video Studio — editor.js
   Timeline editor: media library, drag-drop, playback, export
   ============================================================ */

// ── Editor State ──────────────────────────────────────────────
const editorState = {
    mediaItems: [],
    tracks: [
        { id: 'v1', type: 'video', name: 'Video 1', segments: [] },
        { id: 'v2', type: 'video', name: 'Video 2', segments: [] },
        { id: 'a1', type: 'audio', name: 'Audio 1', segments: [] },
        { id: 'a2', type: 'audio', name: 'Audio 2', segments: [] },
    ],
    pxPerSec: 80,
    timelineDur: 300,
    currentTime: 0,
    playing: false,
    rafId: null,
    lastRafTime: null,
    dragMediaId: null,
    selectedSegId: null,
    exporting: false,
    exportRecorder: null,
    exportEnd: null,
    exportFormat: 'webm',
    exportSpeed: 1,
    exportWindow: null,
    exportPrevTime: 0,
    transitions: [],
    transitionMenuEl: null,
    segmentMenuEl: null,
    exportCanvas: null,
    exportCtx: null,
    previewType: null,
    previewOpacity: 1,
    playheadMenuEl: null,
    generatedPage: 1,
    generatedPerPage: 12,
};

let editorInited = false;
const TIMELINE_MIN_SECONDS = 300;
const TRANSITION_DUR = 0.5;

// ── DOM helpers ───────────────────────────────────────────────
const eq = id => document.getElementById(id);

// ── Tab switching ─────────────────────────────────────────────
document.querySelectorAll('.app-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.classList.contains('disabled')) {
            window.showServerHelp?.();
            return;
        }
        const tab = btn.dataset.tab;
        document.querySelectorAll('.app-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-page').forEach(p => p.classList.add('hidden'));
        btn.classList.add('active');
        document.getElementById('page-' + tab).classList.remove('hidden');
        if (tab === 'editor') initEditor();
        if (tab === 'images') window.initImages?.();
    });
});

// ── Init ──────────────────────────────────────────────────────
function initEditor() {
    if (editorInited) { syncMediaLibrary(); return; }
    editorInited = true;

    eq('tl-rewind').addEventListener('click', () => seekTo(0));
    eq('tl-play-pause').addEventListener('click', togglePlayback);
    eq('tl-stop').addEventListener('click', () => { stopPlayback(); seekTo(0); });
    eq('tl-zoom-in').addEventListener('click', () => setZoom(editorState.pxPerSec * 1.5));
    eq('tl-zoom-out').addEventListener('click', () => setZoom(editorState.pxPerSec / 1.5));
    eq('tool-add-video-track').addEventListener('click', () => addTrack('video'));
    eq('tool-add-audio-track').addEventListener('click', () => addTrack('audio'));
    eq('tool-clear-timeline').addEventListener('click', clearTimeline);
    eq('tool-load-test').addEventListener('click', loadTestMedia);
    eq('tool-save-project').addEventListener('click', saveProject);
    eq('tool-load-project').addEventListener('click', () => eq('project-file-input').click());
    const exportFormatSel = eq('export-format');
    if (exportFormatSel) {
        const saved = localStorage.getItem('vibedstudio_export_format');
        if (saved === 'webm' || saved === 'mp4') {
            editorState.exportFormat = saved;
            exportFormatSel.value = saved;
        }
        exportFormatSel.addEventListener('change', () => {
            editorState.exportFormat = exportFormatSel.value === 'mp4' ? 'mp4' : 'webm';
            localStorage.setItem('vibedstudio_export_format', editorState.exportFormat);
        });
    }
    eq('project-file-input').addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (file) loadProject(file);
        e.target.value = '';
    });
    eq('tool-export').addEventListener('click', startExport);
    eq('upload-video-btn').addEventListener('click', () => eq('upload-video-input').click());
    eq('upload-image-btn').addEventListener('click', () => eq('upload-image-input').click());
    eq('upload-audio-btn').addEventListener('click', () => eq('upload-audio-input').click());
    eq('upload-video-input').addEventListener('change', e => handleUpload(e, 'video'));
    eq('upload-image-input').addEventListener('change', e => handleUpload(e, 'image'));
    eq('upload-audio-input').addEventListener('change', e => handleUpload(e, 'audio'));
    const prevBtn = eq('media-gen-prev');
    const nextBtn = eq('media-gen-next');
    if (prevBtn && nextBtn) {
        prevBtn.addEventListener('click', () => {
            if (editorState.generatedPage > 1) {
                editorState.generatedPage--;
                renderMediaList();
            }
        });
        nextBtn.addEventListener('click', () => {
            editorState.generatedPage++;
            renderMediaList();
        });
    }
    const playhead = eq('tl-playhead');
    if (playhead) {
        playhead.addEventListener('contextmenu', e => {
            e.preventDefault();
            e.stopPropagation();
            showPlayheadMenu(e.clientX, e.clientY);
        });
        playhead.addEventListener('pointerdown', e => {
            e.preventDefault();
            playhead.setPointerCapture(e.pointerId);
            const scrollEl = eq('tl-scroll-area');
            const ruler = eq('tl-ruler');
            const rect = ruler.getBoundingClientRect();
            const onMove = mv => {
                const scrollLeft = scrollEl.scrollLeft;
                const t = (mv.clientX - rect.left + scrollLeft) / editorState.pxPerSec;
                seekTo(t);
            };
            const onUp = () => {
                playhead.removeEventListener('pointermove', onMove);
                playhead.removeEventListener('pointerup', onUp);
            };
            playhead.addEventListener('pointermove', onMove);
            playhead.addEventListener('pointerup', onUp, { once: true });
        });
    }
    initTimelineScrollSync();

    // Ruler click/drag to seek
    const ruler = eq('tl-ruler');
    ruler.addEventListener('pointerdown', e => {
        e.preventDefault();
        ruler.setPointerCapture(e.pointerId);
        const scrollLeft = eq('tl-scroll-area').scrollLeft;
        const rect = ruler.getBoundingClientRect();
        seekTo((e.clientX - rect.left + scrollLeft) / editorState.pxPerSec);
        ruler.addEventListener('pointermove', onRulerMove);
        ruler.addEventListener('pointerup', () => ruler.removeEventListener('pointermove', onRulerMove), { once: true });
    });
    function onRulerMove(e) {
        const rect = eq('tl-ruler').getBoundingClientRect();
        const scrollLeft = eq('tl-scroll-area').scrollLeft;
        seekTo((e.clientX - rect.left + scrollLeft) / editorState.pxPerSec);
    }

    renderTimeline();
    syncMediaLibrary();
    setZoom(80, true);
    initTransitionContextDelegate();
}

function initTimelineScrollSync() {
    const scrollArea = eq('tl-scroll-area');
    const labelCol = eq('tl-label-col');
    if (!scrollArea || !labelCol) return;
    if (scrollArea.dataset.sync === '1') return;
    scrollArea.dataset.sync = '1';
    labelCol.dataset.sync = '1';
    let syncing = false;
    scrollArea.addEventListener('scroll', () => {
        if (syncing) return;
        syncing = true;
        labelCol.scrollTop = scrollArea.scrollTop;
        syncing = false;
    });
    labelCol.addEventListener('scroll', () => {
        if (syncing) return;
        syncing = true;
        scrollArea.scrollTop = labelCol.scrollTop;
        syncing = false;
    });
}

// ── Media Library ─────────────────────────────────────────────
function syncMediaLibrary() {
    const generated = (window.state?.jobs || []).filter(j => j.status === 'succeeded' && j.videoUrl);
    generated.forEach(job => {
        const existing = editorState.mediaItems.find(m => m.id === job.id);
        if (existing) {
            if (existing.src !== job.videoUrl) existing.src = job.videoUrl;
            existing.proxySrc = maybeProxySrc(job.videoUrl);
            if (job.thumbDataUrl) existing.thumbDataUrl = job.thumbDataUrl;
            existing.thumbDisabled = !!job.thumbDisabled;
            editorState.tracks.forEach(t => {
                t.segments.forEach(s => {
                    if (s.mediaId === job.id && s.src !== job.videoUrl) s.src = job.videoUrl;
                });
            });
            return;
        }
        editorState.mediaItems.push({
            id: job.id,
            name: (job.prompt || 'Generated Video').slice(0, 30),
            src: job.videoUrl,
            proxySrc: maybeProxySrc(job.videoUrl),
            thumbDataUrl: job.thumbDataUrl || null,
            thumbDisabled: !!job.thumbDisabled,
            type: 'video',
            duration: job.duration || 5,
            source: 'generated',
        });
    });
    renderMediaList();
}
window.syncMediaLibrary = syncMediaLibrary;

function renderMediaList() {
    const genEl = eq('media-generated');
    const upEl = eq('media-uploads');
    const genInfo = eq('media-gen-info');
    const genPrev = eq('media-gen-prev');
    const genNext = eq('media-gen-next');
    editorState.mediaItems.forEach(m => {
        if (m.source) return;
        if (String(m.id || '').startsWith('upload-')) m.source = 'upload';
        else if (String(m.id || '').startsWith('test-')) m.source = 'generated';
        else m.source = m.type === 'audio' ? 'upload' : 'generated';
    });
    const uploads = editorState.mediaItems.filter(m => m.source === 'upload');
    const generated = editorState.mediaItems.filter(m => m.source === 'generated');

    eq('media-gen-count').textContent = generated.length;
    eq('media-up-count').textContent = uploads.length;

    const visibleGenerated = generated.filter(m => !m.thumbDisabled);
    const totalGenerated = visibleGenerated.length;
    const perPage = Math.max(4, editorState.generatedPerPage || 12);
    const totalPages = Math.max(1, Math.ceil(totalGenerated / perPage));
    if (editorState.generatedPage > totalPages) editorState.generatedPage = totalPages;
    if (editorState.generatedPage < 1) editorState.generatedPage = 1;
    const start = (editorState.generatedPage - 1) * perPage;
    const pagedGenerated = visibleGenerated.slice(start, start + perPage);

    if (genInfo) genInfo.textContent = `${totalGenerated} total`;
    if (genPrev) genPrev.disabled = editorState.generatedPage <= 1;
    if (genNext) genNext.disabled = editorState.generatedPage >= totalPages;

    genEl.innerHTML = totalGenerated === 0
        ? '<div class="media-empty-hint">Generate videos in the Generate tab to see them here</div>'
        : pagedGenerated.map(m => mediaItemHTML(m, { compact: true })).join('');

    upEl.innerHTML = uploads.length === 0
        ? '<div class="media-empty-hint">Upload video or audio files above</div>'
        : uploads.map(m => mediaItemHTML(m, { compact: false })).join('');

    document.querySelectorAll('.media-item[data-mid]').forEach(el => {
        el.setAttribute('draggable', 'true');
        el.addEventListener('dragstart', e => {
            editorState.dragMediaId = el.dataset.mid;
            el.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'copy';
        });
        el.addEventListener('dragend', () => el.classList.remove('dragging'));
        el.addEventListener('click', () => previewMediaItem(el.dataset.mid));
    });

    document.querySelectorAll('.media-thumb video').forEach(v => {
        if (v.dataset.bound === '1') return;
        v.dataset.bound = '1';
        v.addEventListener('error', async () => {
            const mediaId = v.closest('.media-item')?.dataset?.mid;
            if (mediaId && window.refreshJobVideoUrl) {
                const fresh = await window.refreshJobVideoUrl(mediaId, { silent: true });
                if (fresh) {
                    const proxy = maybeProxySrc(fresh);
                    v.dataset.proxy = proxy || '';
                    v.src = `${fresh}#t=0.1`;
                    try { v.load(); } catch { }
                    return;
                }
            }
            const proxy = v.dataset.proxy;
            if (proxy && v.src !== proxy) {
                v.src = proxy;
                try { v.load(); } catch { }
            }
        });
    });

    document.querySelectorAll('.media-item.compact .media-thumb img').forEach(img => {
        if (img.dataset.bound === '1') return;
        img.dataset.bound = '1';
        img.addEventListener('error', () => {
            const item = img.closest('.media-item');
            if (item) item.remove();
        });
    });
}

function mediaItemHTML(m, { compact = false } = {}) {
    const videoIcon = `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/><polygon points="10,8 10,16 17,12" fill="currentColor" opacity="0.8"/></svg>`;
    const audioIcon = `<svg viewBox="0 0 24 24" fill="none"><path d="M9 18V5L21 3V16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="1.5"/></svg>`;

    let thumbInner = `<div class="media-thumb-icon">${m.type === 'video' ? videoIcon : audioIcon}</div>`;
    if (m.src) {
        if (m.type === 'video') {
            if (compact && m.thumbDataUrl) {
                const safeThumb = escH(m.thumbDataUrl);
                thumbInner = `<img src="${safeThumb}" alt="${escH(m.name)}" />`;
            } else {
                const proxy = m.proxySrc || maybeProxySrc(m.src) || '';
                const proxyAttr = proxy ? ` data-proxy="${escH(proxy)}"` : '';
                const safeSrc = escH(m.src);
                thumbInner = `<video src="${safeSrc}#t=0.1" preload="metadata" muted playsinline${proxyAttr}></video>`;
            }
        }
        else if (m.type === 'image') {
            const safeSrc = escH(m.src);
            thumbInner = `<img src="${safeSrc}" alt="${escH(m.name)}" />`;
        }
    }

    const info = compact ? '' : `
      <div class="media-info">
        <div class="media-name">${escH(m.name)}</div>
        <div class="media-meta">${m.type.toUpperCase()} • ${formatDur(m.duration || 0)}</div>
      </div>`;
    const compactClass = compact ? ' compact' : '';
    return `
    <div class="media-item${compactClass}" data-mid="${m.id}">
      <div class="media-thumb">${thumbInner}</div>
      ${info}
    </div>`;
}

function previewMediaItem(id) {
    const item = editorState.mediaItems.find(m => m.id === id);
    if (!item) return;

    // Stop all other playing thumbnails
    document.querySelectorAll('.media-thumb video').forEach(v => v.pause());

    if (item.type !== 'video') return;

    // Play/Pause the clicked thumbnail
    const el = document.querySelector(`.media-item[data-mid="${id}"] .media-thumb video`);
    if (el) {
        if (el.paused) {
            el.currentTime = 0;
            el.play().catch(e => console.log('Playback error', e));
        } else {
            el.pause();
        }
    }
}

// ── Test Media ────────────────────────────────────────────────
async function loadTestMedia() {
    const btn = eq('tool-load-test');
    btn.textContent = 'Generating…';
    btn.disabled = true;

    showToast('Generating synthetic test media…', 'info', '🧪');

    try {
        const [vid1, vid2, aud1] = await Promise.all([
            makeTestVideo('#4c1d95', 'Test Video A', 8),
            makeTestVideo('#1e3a5f', 'Test Video B', 6),
            makeTestAudio(440, 10, 'Test Tone 440Hz'),
        ]);

        editorState.mediaItems.push(vid1, vid2, aud1);
        renderMediaList();
        showToast('Test media loaded — drag clips onto the timeline!', 'success', '✅');
    } catch (e) {
        console.error('Test media error:', e);
        showToast('Could not generate test media: ' + e.message, 'error', '❌');
    }

    btn.textContent = 'Load Test Media';
    btn.disabled = false;
}

function makeTestVideo(bgColor, label, duration) {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 360;
        const ctx = canvas.getContext('2d');

        let stream;
        try {
            stream = canvas.captureStream(24);
        } catch (e) { return reject(e); }

        const chunks = [];
        const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
        rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        rec.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            const src = URL.createObjectURL(blob);
            resolve({ id: 'test-' + Date.now() + Math.random(), name: label, src, type: 'video', duration, source: 'generated' });
        };

        let frame = 0;
        const totalFrames = duration * 24;
        rec.start();

        function draw() {
            const t = (frame / 24).toFixed(1);
            // Gradient background
            const grad = ctx.createLinearGradient(0, 0, 640, 360);
            grad.addColorStop(0, bgColor);
            grad.addColorStop(1, '#0f172a');
            ctx.fillStyle = grad; ctx.fillRect(0, 0, 640, 360);
            // Animated bar
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            const barX = (frame % 48) * (640 / 48);
            ctx.fillRect(barX - 20, 0, 40, 360);
            // Text
            ctx.fillStyle = 'white'; ctx.font = 'bold 48px Inter, sans-serif';
            ctx.textAlign = 'center'; ctx.fillText(label, 320, 160);
            ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '26px Inter, sans-serif';
            ctx.fillText(`${t}s / ${duration}s`, 320, 210);
            frame++;
            if (frame < totalFrames) requestAnimationFrame(draw);
            else { rec.stop(); stream.getTracks().forEach(t => t.stop()); }
        }
        draw();
    });
}

function makeTestAudio(freq, duration, name) {
    return new Promise(resolve => {
        const sampleRate = 44100;
        const numSamples = sampleRate * duration;
        const buffer = new ArrayBuffer(44 + numSamples * 2);
        const view = new DataView(buffer);

        // WAV header
        const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
        writeStr(0, 'RIFF'); view.setUint32(4, 36 + numSamples * 2, true);
        writeStr(8, 'WAVE'); writeStr(12, 'fmt '); view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true); view.setUint16(34, 16, true);
        writeStr(36, 'data'); view.setUint32(40, numSamples * 2, true);

        for (let i = 0; i < numSamples; i++) {
            // Fade in/out envelope
            const env = Math.min(i / (sampleRate * 0.1), 1, (numSamples - i) / (sampleRate * 0.3));
            const val = Math.sin(2 * Math.PI * freq * i / sampleRate) * 0.4 * env;
            view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, val * 32767)), true);
        }

        const blob = new Blob([buffer], { type: 'audio/wav' });
        const src = URL.createObjectURL(blob);
        resolve({ id: 'test-' + Date.now() + Math.random(), name, src, type: 'audio', duration, source: 'generated' });
    });
}

// ── Project save/load ─────────────────────────────────────────
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

async function saveProject() {
    const maxInlineSize = 12 * 1024 * 1024; // 12MB per asset
    const mediaItems = await Promise.all(editorState.mediaItems.map(async m => {
        const item = {
            id: m.id,
            name: m.name,
            type: m.type,
            duration: m.duration,
            source: m.source,
            src: m.src || null,
        };
        if (m.src && String(m.src).startsWith('blob:')) {
            try {
                const resp = await fetch(m.src);
                const blob = await resp.blob();
                if (blob.size <= maxInlineSize) {
                    item.srcDataUrl = await blobToDataUrl(blob);
                } else {
                    item.srcSkipped = true;
                    item.srcSize = blob.size;
                }
            } catch {
                item.srcSkipped = true;
            }
        }
        return item;
    }));

    const project = {
        version: 1,
        savedAt: new Date().toISOString(),
        timelineDur: editorState.timelineDur,
        pxPerSec: editorState.pxPerSec,
        tracks: editorState.tracks.map(t => ({
            id: t.id,
            type: t.type,
            name: t.name,
            segments: t.segments.map(s => ({
                id: s.id,
                mediaId: s.mediaId,
                name: s.name,
                start: s.start,
                duration: s.duration,
                mediaType: s.mediaType,
                muted: !!s.muted,
                fadeIn: !!s.fadeIn,
                fadeOut: !!s.fadeOut,
                fadeInDur: s.fadeInDur || null,
                fadeOutDur: s.fadeOutDur || null,
            })),
        })),
        transitions: editorState.transitions,
        mediaItems,
    };

    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vibedstudio-project-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Project saved', 'success', '💾');
}

async function loadProject(file) {
    let data;
    try {
        data = JSON.parse(await file.text());
    } catch {
        showToast('Invalid project file', 'error', '❌');
        return;
    }
    if (!data || !Array.isArray(data.tracks) || !Array.isArray(data.mediaItems)) {
        showToast('Project file missing required data', 'error', '❌');
        return;
    }

    // Rebuild media items
    const mediaItems = data.mediaItems.map(m => {
        let src = m.src || null;
        if (m.srcDataUrl) {
            try { src = URL.createObjectURL(dataUrlToBlob(m.srcDataUrl)); } catch { }
        }
        return {
            id: m.id,
            name: m.name,
            type: m.type,
            duration: m.duration,
            source: m.source,
            src,
        };
    });

    editorState.mediaItems = mediaItems.map(m => ({
        ...m,
        proxySrc: maybeProxySrc(m.src),
    }));
    editorState.tracks = data.tracks.map(t => ({
        id: t.id,
        type: t.type,
        name: t.name,
        segments: (t.segments || []).map(s => ({
            id: s.id,
            mediaId: s.mediaId,
            name: s.name,
            src: mediaItems.find(m => m.id === s.mediaId)?.src || null,
            start: s.start,
            duration: s.duration,
            mediaType: s.mediaType,
            muted: !!s.muted,
            fadeIn: !!s.fadeIn,
            fadeOut: !!s.fadeOut,
            fadeInDur: s.fadeInDur || null,
            fadeOutDur: s.fadeOutDur || null,
        })),
    }));
    editorState.transitions = Array.isArray(data.transitions) ? data.transitions : [];

    const maxEnd = editorState.tracks.flatMap(t => t.segments).reduce((m, s) => Math.max(m, (s.start || 0) + (s.duration || 0)), 0);
    const baseDur = Math.max(TIMELINE_MIN_SECONDS, maxEnd + 2);
    editorState.timelineDur = Math.max(data.timelineDur || 0, baseDur);
    editorState.pxPerSec = data.pxPerSec || editorState.pxPerSec;
    editorState.currentTime = 0;
    editorState.selectedSegId = null;
    renderMediaList();
    renderTimeline();
    seekTo(0);
    showToast('Project loaded', 'success', '📂');
}

// ── File Upload ───────────────────────────────────────────────
function handleUpload(e, type) {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const id = 'upload-' + Date.now();
    if (type === 'image') {
        const img = new Image();
        img.onload = () => {
            editorState.mediaItems.push({ id, name: file.name, src: url, type, duration: 2, source: 'upload' });
            renderMediaList();
            showToast(`Uploaded: ${file.name}`, 'success', '🖼️');
        };
        img.onerror = () => {
            editorState.mediaItems.push({ id, name: file.name, src: url, type, duration: 2, source: 'upload' });
            renderMediaList();
        };
        img.src = url;
        e.target.value = '';
        return;
    }

    const tmp = type === 'video' ? document.createElement('video') : document.createElement('audio');
    tmp.src = url;
    tmp.onloadedmetadata = () => {
        editorState.mediaItems.push({ id, name: file.name, src: url, type, duration: tmp.duration || 10, source: 'upload' });
        renderMediaList();
        showToast(`Uploaded: ${file.name}`, 'success', type === 'video' ? '🎬' : '🎵');
    };
    tmp.onerror = () => {
        editorState.mediaItems.push({ id, name: file.name, src: url, type, duration: 10, source: 'upload' });
        renderMediaList();
    };
    e.target.value = '';
}

// ── Timeline Render ───────────────────────────────────────────
function renderTimeline() {
    updateTimelineDur();
    renderLabels();
    renderRuler();
    renderTracks();
    renderPlayhead();
    updateTimeDisplay();
}

function updateTimelineDur() {
    const videoSegs = editorState.tracks
        .flatMap(t => t.segments)
        .filter(s => s.mediaType === 'video' || s.mediaType === 'image');
    const maxEnd = videoSegs.reduce((m, s) => Math.max(m, (s.start || 0) + (s.duration || 0)), 0);
    const next = maxEnd > 0 ? Math.max(TIMELINE_MIN_SECONDS, maxEnd) : TIMELINE_MIN_SECONDS;
    if (Math.abs(next - editorState.timelineDur) > 0.01) {
        editorState.timelineDur = next;
        if (editorState.currentTime > next) editorState.currentTime = next;
    }
}

function renderLabels() {
    const col = eq('tl-label-col');
    col.innerHTML = '<div class="tl-label-ruler"></div>';
    editorState.tracks.forEach(t => {
        const row = document.createElement('div');
        row.className = 'tl-label-row';
        row.innerHTML = `<span class="tl-track-dot ${t.type}"></span><span class="tl-track-name">${t.name}</span>`;
        col.appendChild(row);
    });
}

function renderRuler() {
    const ruler = eq('tl-ruler');
    const dur = editorState.timelineDur;
    const px = editorState.pxPerSec;
    const totalW = dur * px;
    ruler.style.width = totalW + 'px';
    ruler.innerHTML = '';

    const intervals = [0.25, 0.5, 1, 2, 5, 10, 30, 60];
    const interval = intervals.find(i => i * px >= 60) || 60;

    for (let t = 0; t <= dur; t += interval / 5) {
        const x = t * px;
        const isMajor = Math.abs(t % interval) < 0.001;
        const tick = document.createElement('div');
        tick.style.cssText = `position:absolute;left:${x}px;width:1px;background:${isMajor ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.05)'};height:${isMajor ? '100%' : '40%'};bottom:0;`;
        ruler.appendChild(tick);
        if (isMajor) {
            const lbl = document.createElement('span');
            lbl.className = 'tl-ruler-label';
            lbl.style.left = x + 'px';
            lbl.textContent = formatDur(t);
            ruler.appendChild(lbl);
        }
    }
    eq('tl-content').style.minWidth = totalW + 'px';
}

function renderTracks() {
    const tracksEl = eq('tl-tracks');
    // Keep the empty hint div, replace track rows
    tracksEl.innerHTML = '';
    const totalW = editorState.timelineDur * editorState.pxPerSec;

    const noClips = editorState.tracks.every(t => t.segments.length === 0);
    if (noClips) {
        tracksEl.innerHTML = '<div class="tl-empty-hint">Drag media items from the library onto a track</div>';
    }

    editorState.tracks.forEach(track => {
        const row = document.createElement('div');
        row.className = 'tl-track-row';
        row.dataset.trackId = track.id;
        row.style.width = totalW + 'px';

        const snapLine = document.createElement('div');
        snapLine.className = 'tl-snap-line';
        row.appendChild(snapLine);

        row.addEventListener('dragover', e => {
            e.preventDefault();
            row.classList.add('dragover');
            if (!editorState.dragMediaId) return;
            const media = editorState.mediaItems.find(m => m.id === editorState.dragMediaId);
            if (!media) return;
            const scrollLeft = eq('tl-scroll-area').scrollLeft;
            const rect = row.getBoundingClientRect();
            const x = e.clientX - rect.left + scrollLeft;
            const start = Math.max(0, x / editorState.pxPerSec);
            const snap = getSnapInfo(track, start, media.duration || 5, null);
            const proposed = snap.snapped ? snap.start : start;
            const resolved = resolveNonOverlap(track, media.duration || 5, proposed, null);
            if (resolved != null && snap.snapped) {
                setSnapLine(row, resolved * editorState.pxPerSec);
            } else {
                clearSnapLine(row);
            }
        });
        row.addEventListener('dragleave', () => { row.classList.remove('dragover'); clearSnapLine(row); });
        row.addEventListener('drop', e => {
            e.preventDefault();
            row.classList.remove('dragover');
            clearSnapLine(row);
            if (!editorState.dragMediaId) return;
            const scrollLeft = eq('tl-scroll-area').scrollLeft;
            const rect = row.getBoundingClientRect();
            const x = e.clientX - rect.left + scrollLeft;
            const start = Math.max(0, x / editorState.pxPerSec);
            dropMediaOnTrack(track.id, editorState.dragMediaId, start);
            editorState.dragMediaId = null;
        });

        row.addEventListener('contextmenu', e => {
            e.preventDefault();
            handleTransitionContextMenu(e, track, row);
        });

        track.segments.forEach(seg => row.appendChild(createSegmentEl(seg, track)));
        renderTransitionsForTrack(row, track);
        tracksEl.appendChild(row);
    });
}

function handleTransitionContextMenu(e, track, row) {
    if (track.type !== 'video') return;
    const scrollLeft = eq('tl-scroll-area').scrollLeft;
    const rect = row.getBoundingClientRect();
    const t = (e.clientX - rect.left + scrollLeft) / editorState.pxPerSec;
    const pair = findTransitionPair(track, t);
    if (pair) {
        showTransitionMenu(e.clientX, e.clientY, pair.left, pair.right);
    } else {
        hideTransitionMenu();
        showToast('Right-click between two adjacent clips to add a transition', 'info', 'ℹ️');
    }
}

function initTransitionContextDelegate() {
    const tracksEl = eq('tl-tracks');
    if (!tracksEl || tracksEl.dataset.ctxBound === '1') return;
    tracksEl.dataset.ctxBound = '1';
    tracksEl.addEventListener('contextmenu', e => {
        const row = e.target.closest('.tl-track-row');
        if (!row) return;
        const trackId = row.dataset.trackId;
        const track = editorState.tracks.find(t => t.id === trackId);
        if (!track) return;
        e.preventDefault();
        handleTransitionContextMenu(e, track, row);
    });
}
function getSnapInfo(track, proposedStart, duration, excludeSegId) {
    const snapSec = 12 / editorState.pxPerSec;
    const points = [0];
    track.segments.forEach(s => {
        if (s.id === excludeSegId) return;
        points.push((s.start || 0) + (s.duration || 0));
    });
    let best = null;
    points.forEach(p => {
        const d = Math.abs(proposedStart - p);
        if (best === null || d < best.dist) best = { dist: d, point: p };
    });
    if (best && best.dist <= snapSec) {
        return { snapped: true, start: best.point };
    }
    return { snapped: false, start: proposedStart };
}

function resolveNonOverlap(track, duration, proposedStart, excludeSegId) {
    const segs = [...track.segments]
        .filter(s => s.id !== excludeSegId)
        .sort((a, b) => a.start - b.start);

    const gaps = [];
    let cursor = 0;
    for (const s of segs) {
        const end = s.start || 0;
        if (end - cursor >= duration) gaps.push({ start: cursor, end });
        cursor = (s.start || 0) + (s.duration || 0);
    }
    gaps.push({ start: cursor, end: Infinity });

    let best = null;
    for (const g of gaps) {
        const maxStart = (g.end === Infinity) ? proposedStart : Math.min(proposedStart, g.end - duration);
        const candidate = Math.max(g.start, maxStart);
        if (candidate < g.start || (g.end !== Infinity && candidate + duration > g.end + 1e-6)) continue;
        const dist = Math.abs(candidate - proposedStart);
        if (!best || dist < best.dist) best = { dist, start: candidate };
    }
    return best ? best.start : null;
}

function setSnapLine(row, x) {
    const line = row.querySelector('.tl-snap-line');
    if (!line) return;
    line.style.left = x + 'px';
    line.classList.add('active');
}

function clearSnapLine(row) {
    const line = row.querySelector('.tl-snap-line');
    if (!line) return;
    line.classList.remove('active');
}

function getNeighborBounds(track, segId) {
    const segs = [...track.segments].sort((a, b) => a.start - b.start);
    const idx = segs.findIndex(s => s.id === segId);
    if (idx === -1) return { prevEnd: null, nextStart: null };
    const prev = segs[idx - 1];
    const next = segs[idx + 1];
    const prevEnd = prev ? (prev.start || 0) + (prev.duration || 0) : null;
    const nextStart = next ? (next.start || 0) : null;
    return { prevEnd, nextStart };
}

function findTransitionPair(track, time) {
    const snapSec = 12 / editorState.pxPerSec;
    const maxGapSec = 1.0;
    const segs = [...track.segments].sort((a, b) => a.start - b.start);
    for (let i = 0; i < segs.length - 1; i++) {
        const left = segs[i];
        const right = segs[i + 1];
        const boundary = (left.start || 0) + (left.duration || 0);
        const gap = (right.start || 0) - boundary;
        if (gap < 0) continue;
        const nearBoundary = Math.abs(time - boundary) <= snapSec;
        const withinGap = time >= boundary - snapSec && time <= (right.start || 0) + snapSec;
        if ((nearBoundary || withinGap) && gap <= maxGapSec) {
            return { left, right };
        }
    }
    return null;
}

function renderTransitionsForTrack(row, track) {
    const px = editorState.pxPerSec;
    editorState.transitions.forEach(t => {
        const left = track.segments.find(s => s.id === t.leftId);
        const right = track.segments.find(s => s.id === t.rightId);
        if (!left || !right) return;
        const boundary = (left.start || 0) + (left.duration || 0);
        const gap = (right.start || 0) - boundary;
        if (gap > (12 / px)) return;
        const el = document.createElement('div');
        el.className = `tl-transition ${t.type}`;
        el.style.left = (boundary * px) + 'px';
        el.title = `Transition: ${transitionLabel(t.type)}`;
        row.appendChild(el);
    });
}

function transitionLabel(type) {
    if (type === 'fade-in') return 'Fade In';
    if (type === 'fade-out') return 'Fade Out';
    return 'Crossfade';
}

function showTransitionMenu(x, y, left, right) {
    hideTransitionMenu();
    hideSegmentMenu();
    const existing = editorState.transitions.find(t => t.leftId === left.id && t.rightId === right.id);
    const menu = document.createElement('div');
    menu.className = 'tl-context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    const items = [
        { id: 'fade-in', label: 'Add Fade In' },
        { id: 'fade-out', label: 'Add Fade Out' },
        { id: 'crossfade', label: 'Add Crossfade' },
    ];
    menu.innerHTML = `
        <div class="tl-context-title">Transition</div>
        ${items.map(i => `<button data-action="${i.id}">${i.label}</button>`).join('')}
        ${existing ? `<button class="danger" data-action="remove">Remove Transition</button>` : ''}
    `;
    const onClick = e => {
        const action = e.target?.dataset?.action;
        if (!action) return;
        if (action === 'remove') {
            removeTransition(left.id, right.id);
        } else {
            addTransition(left.id, right.id, action);
        }
        hideTransitionMenu();
        renderTimeline();
    };
    menu.addEventListener('click', onClick);
    document.body.appendChild(menu);
    editorState.transitionMenuEl = menu;
    setTimeout(() => {
        document.addEventListener('click', hideTransitionMenu, { once: true });
        document.addEventListener('keydown', onMenuKey, { once: true });
    }, 0);

    function onMenuKey(e) {
        if (e.key === 'Escape') hideTransitionMenu();
    }
}

function hideTransitionMenu() {
    if (editorState.transitionMenuEl) {
        editorState.transitionMenuEl.remove();
        editorState.transitionMenuEl = null;
    }
}

function showSegmentMenu(x, y, seg) {
    hideSegmentMenu();
    hideTransitionMenu();
    const menu = document.createElement('div');
    menu.className = 'tl-context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    const audioAction = seg.mediaType === 'video'
        ? `<button data-action="extract-audio">Extract Audio</button>`
        : '';
    menu.innerHTML = `
        <div class="tl-context-title">Clip</div>
        <button data-action="fade-in">${seg.fadeIn ? 'Remove Fade In' : 'Add Fade In'}</button>
        <button data-action="fade-out">${seg.fadeOut ? 'Remove Fade Out' : 'Add Fade Out'}</button>
        ${audioAction}
    `;
    const onClick = e => {
        const action = e.target?.dataset?.action;
        if (action === 'fade-in') {
            seg.fadeIn = !seg.fadeIn;
            if (seg.fadeIn && !seg.fadeInDur) seg.fadeInDur = TRANSITION_DUR;
            renderTimeline();
        }
        if (action === 'fade-out') {
            seg.fadeOut = !seg.fadeOut;
            if (seg.fadeOut && !seg.fadeOutDur) seg.fadeOutDur = TRANSITION_DUR;
            renderTimeline();
        }
        if (action === 'extract-audio') {
            extractAudioFromSegment(seg).catch(err => {
                console.warn('Audio extraction failed:', err);
            });
        }
        hideSegmentMenu();
    };
    menu.addEventListener('click', onClick);
    document.body.appendChild(menu);
    editorState.segmentMenuEl = menu;
    setTimeout(() => {
        document.addEventListener('click', hideSegmentMenu, { once: true });
        document.addEventListener('keydown', onMenuKey, { once: true });
    }, 0);

    function onMenuKey(e) {
        if (e.key === 'Escape') hideSegmentMenu();
    }
}

function hideSegmentMenu() {
    if (editorState.segmentMenuEl) {
        editorState.segmentMenuEl.remove();
        editorState.segmentMenuEl = null;
    }
}

function showPlayheadMenu(x, y) {
    hidePlayheadMenu();
    hideSegmentMenu();
    hideTransitionMenu();
    const menu = document.createElement('div');
    menu.className = 'tl-context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.innerHTML = `
        <div class="tl-context-title">Playhead</div>
        <button data-action="hold-frame">Create Hold Frame</button>
    `;
    const onClick = e => {
        const action = e.target?.dataset?.action;
        if (action === 'hold-frame') {
            createHoldFrameAtPlayhead().catch(err => {
                console.warn('Hold frame failed:', err);
                showToast('Hold frame failed', 'error', '❌');
            });
        }
        hidePlayheadMenu();
    };
    menu.addEventListener('click', onClick);
    document.body.appendChild(menu);
    editorState.playheadMenuEl = menu;
    setTimeout(() => {
        document.addEventListener('click', hidePlayheadMenu, { once: true });
        document.addEventListener('keydown', onMenuKey, { once: true });
    }, 0);

    function onMenuKey(e) {
        if (e.key === 'Escape') hidePlayheadMenu();
    }
}

function hidePlayheadMenu() {
    if (editorState.playheadMenuEl) {
        editorState.playheadMenuEl.remove();
        editorState.playheadMenuEl = null;
    }
}

function addTransition(leftId, rightId, type) {
    const existing = editorState.transitions.find(t => t.leftId === leftId && t.rightId === rightId);
    if (existing) {
        existing.type = type;
        return;
    }
    editorState.transitions.push({
        id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        leftId,
        rightId,
        type,
    });
}

function removeTransition(leftId, rightId) {
    editorState.transitions = editorState.transitions.filter(t => !(t.leftId === leftId && t.rightId === rightId));
}

async function createHoldFrameAtPlayhead() {
    const seg = findSegmentAtTime(editorState.currentTime);
    if (!seg) {
        showToast('No video or image at the playhead', 'error', '⚠️');
        return;
    }
    let frame = null;
    if (seg.mediaType === 'image') {
        frame = seg.src;
    } else if (seg.mediaType === 'video') {
        const src = getExportSrc(seg.src);
        const segTime = Math.max(0, editorState.currentTime - (seg.start || 0));
        frame = await captureVideoFrameAtTime(src, segTime);
    } else {
        showToast('Hold frames are only supported for video/image clips', 'error', '⚠️');
        return;
    }
    const media = {
        id: 'img-' + Date.now(),
        name: `${seg.name || 'Frame'} (Hold)`,
        src: frame,
        type: 'image',
        duration: 2,
        source: 'upload',
    };
    editorState.mediaItems.push(media);
    renderMediaList();
    showToast('Hold frame added to uploads', 'success', '🖼️');
}

function findTrackBySegId(segId) {
    for (const t of editorState.tracks) {
        if (t.segments.find(s => s.id === segId)) return t;
    }
    return null;
}

function findSegmentAtTime(t) {
    for (const track of editorState.tracks) {
        if (track.type !== 'video') continue;
        for (const seg of track.segments) {
            if (t >= seg.start && t < seg.start + seg.duration) return seg;
        }
    }
    return null;
}

async function captureVideoFrameAtTime(src, time) {
    return new Promise((resolve, reject) => {
        const v = document.createElement('video');
        v.src = src;
        v.crossOrigin = 'anonymous';
        v.preload = 'auto';
        v.muted = true;
        v.playsInline = true;
        v.addEventListener('loadedmetadata', () => {
            const maxDur = v.duration || 0;
            const target = Math.max(0.05, Math.min(time || 0, Math.max(0.05, maxDur - 0.05)));
            v.currentTime = target;
        }, { once: true });
        v.addEventListener('seeked', () => {
            const canvas = document.createElement('canvas');
            canvas.width = v.videoWidth || 1280;
            canvas.height = v.videoHeight || 720;
            const ctx = canvas.getContext('2d');
            try {
                ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/png'));
            } catch (e) {
                reject(e);
            }
        }, { once: true });
        v.addEventListener('error', () => reject(new Error('Video load failed')), { once: true });
        try { v.load(); } catch { }
    });
}

async function extractAudioFromSegment(seg) {
    if (!seg?.src) return;
    showToast('Extracting audio…', 'info', '🎵');
    try {
        const src = getExportSrc(seg.src);
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuf = await ctx.decodeAudioData(buf.slice(0));
        if (!audioBuf || !isFinite(audioBuf.duration) || audioBuf.duration <= 0) {
            throw new Error('no_audio');
        }
        const wav = audioBufferToWav(audioBuf);
        const blob = new Blob([wav], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const media = {
            id: 'audio-' + Date.now(),
            name: (seg.name || 'Extracted Audio').slice(0, 40),
            src: url,
            type: 'audio',
            duration: seg.duration || audioBuf.duration || 5,
            source: 'generated',
        };
        editorState.mediaItems.push(media);
        renderMediaList();
        placeAudioOnTrack(media, seg);
        showToast('Audio extracted and placed on a track', 'success', '🎵');
    } catch (err) {
        const msg = err?.message || '';
        if (msg === 'no_audio' || /decode/i.test(msg) || err?.name === 'EncodingError') {
            showToast('No audio track found in this clip', 'error', '🔇');
        } else if (/HTTP\s+\d+/i.test(msg)) {
            showToast(`Audio extraction failed (${msg})`, 'error', '❌');
        } else {
            showToast('Audio extraction failed', 'error', '❌');
        }
        throw err;
    }
}

function placeAudioOnTrack(media, seg) {
    const duration = media.duration || 1;
    const originTrack = seg
        ? editorState.tracks.find(t => t.segments.some(s => s.id === seg.id))
        : null;
    let targetTrack = null;
    const desiredStart = seg?.start || 0;
    const canPlaceAt = (track, start, dur) => {
        return !track.segments.some(s => {
            const sStart = s.start || 0;
            const sEnd = sStart + (s.duration || 0);
            const end = start + dur;
            return start < sEnd - 1e-6 && end > sStart + 1e-6;
        });
    };

    if (originTrack) {
        const originIdx = editorState.tracks.indexOf(originTrack);
        const next = editorState.tracks[originIdx + 1];
        if (next && next.type === 'audio' && canPlaceAt(next, desiredStart, duration)) {
            targetTrack = next;
        } else {
            const count = editorState.tracks.filter(t => t.type === 'audio').length;
            const newTrack = {
                id: 'audio-' + Date.now(),
                type: 'audio',
                name: `Audio ${count + 1}`,
                segments: [],
            };
            editorState.tracks.splice(originIdx + 1, 0, newTrack);
            targetTrack = newTrack;
        }
    }

    const audioTracks = editorState.tracks.filter(t => t.type === 'audio');
    if (!targetTrack) {
        const openTrack = audioTracks.find(t => canPlaceAt(t, desiredStart, duration));
        if (openTrack) targetTrack = openTrack;
        else {
            const count = editorState.tracks.filter(t => t.type === 'audio').length;
            const newTrack = {
                id: 'audio-' + Date.now(),
                type: 'audio',
                name: `Audio ${count + 1}`,
                segments: [],
            };
            editorState.tracks.push(newTrack);
            targetTrack = newTrack;
        }
    }

    const start = desiredStart;

    const audioSeg = {
        id: 'seg-' + Date.now(),
        mediaId: media.id,
        name: media.name,
        src: media.src,
        start,
        duration,
        mediaType: 'audio',
        muted: false,
    };
    targetTrack.segments.push(audioSeg);
    renderTimeline();
}

function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * blockAlign;
    const bufferLength = 44 + dataSize;
    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);

    let offset = 0;
    function writeString(s) {
        for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
        offset += s.length;
    }
    function writeUint32(v) { view.setUint32(offset, v, true); offset += 4; }
    function writeUint16(v) { view.setUint16(offset, v, true); offset += 2; }

    writeString('RIFF');
    writeUint32(36 + dataSize);
    writeString('WAVE');
    writeString('fmt ');
    writeUint32(16);
    writeUint16(1);
    writeUint16(numChannels);
    writeUint32(sampleRate);
    writeUint32(byteRate);
    writeUint16(blockAlign);
    writeUint16(bytesPerSample * 8);
    writeString('data');
    writeUint32(dataSize);

    const channels = [];
    for (let i = 0; i < numChannels; i++) channels.push(buffer.getChannelData(i));
    let sample = 0;
    for (let i = 0; i < length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
            sample = Math.max(-1, Math.min(1, channels[ch][i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }
    return arrayBuffer;
}

// ── Segment element ───────────────────────────────────────────
function createSegmentEl(seg, track) {
    const isAudio = seg.mediaType === 'audio';
    const el = document.createElement('div');
    const fadeInCls = seg.fadeIn ? ' fade-in' : '';
    const fadeOutCls = seg.fadeOut ? ' fade-out' : '';
    const needsLoad = !!seg.src && (seg.mediaType === 'video' || seg.mediaType === 'image');
    el.className = `tl-segment ${track.type}-seg${seg.muted && isAudio ? ' muted' : ''}${editorState.selectedSegId === seg.id ? ' selected' : ''}${fadeInCls}${fadeOutCls}${needsLoad ? ' loading' : ''}`;
    el.dataset.segId = seg.id;
    el.style.left = (seg.start * editorState.pxPerSec) + 'px';
    el.style.width = (seg.duration * editorState.pxPerSec) + 'px';

    const muteIcon = seg.muted
        ? `<svg viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2V15H6L11 19V5Z" fill="currentColor" opacity="0.5"/><path d="M23 9L17 15M17 9L23 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2V15H6L11 19V5Z" fill="currentColor"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

    let segThumb = '';
    if (seg.src && seg.mediaType === 'video') {
        const safeSrc = escH(seg.src);
        segThumb = `<div class="tl-seg-thumb"><video src="${safeSrc}#t=0.1" preload="metadata" muted playsinline tabindex="-1"></video></div>`;
    } else if (seg.src && seg.mediaType === 'image') {
        const safeSrc = escH(seg.src);
        segThumb = `<div class="tl-seg-thumb"><img src="${safeSrc}" alt="" /></div>`;
    }
    const loadingOverlay = needsLoad
        ? `<div class="tl-seg-loading"><span class="spinner sm purple"></span><span>Loading</span></div>`
        : '';

    el.innerHTML = `
    ${segThumb}
    ${loadingOverlay}
    <span class="tl-seg-trim left"></span>
    <span class="tl-seg-label">${escH(seg.name)}</span>
    <span class="tl-seg-mute-btn ${seg.muted ? 'is-muted' : ''}" title="${seg.muted ? 'Unmute' : 'Mute'}">${muteIcon}</span>
    <span class="tl-seg-del" title="Remove">✕</span>
    <span class="tl-seg-trim right"></span>`;

    if (needsLoad) {
        const mediaEl = el.querySelector('video, img');
        const markReady = () => el.classList.remove('loading');
        if (mediaEl) {
            if (mediaEl.tagName === 'VIDEO') {
                const vid = mediaEl;
                const onReady = () => markReady();
                vid.addEventListener('loadeddata', onReady, { once: true });
                vid.addEventListener('canplay', onReady, { once: true });
                vid.addEventListener('loadedmetadata', onReady, { once: true });
                vid.addEventListener('error', onReady, { once: true });
                setTimeout(onReady, 4000);
                if (vid.readyState >= 2) markReady();
            } else {
                if (mediaEl.complete) markReady();
                mediaEl.addEventListener('load', markReady, { once: true });
                mediaEl.addEventListener('error', markReady, { once: true });
                setTimeout(markReady, 4000);
            }
        } else {
            markReady();
        }
    }

    // ── Drag (cross-track ghost drag) ─────────────────────────
    el.addEventListener('pointerdown', e => {
        const t2 = e.target;
        if (t2.classList.contains('tl-seg-del') || t2.closest('.tl-seg-del') ||
            t2.classList.contains('tl-seg-mute-btn') || t2.closest('.tl-seg-mute-btn') ||
            t2.classList.contains('tl-seg-trim')) return;
        e.preventDefault();

        editorState.selectedSegId = seg.id;
        document.querySelectorAll('.tl-segment').forEach(s => s.classList.remove('selected'));
        el.classList.add('selected');

        const origRect = el.getBoundingClientRect();
        const origTrackId = track.id;
        const grabOffset = e.clientX - origRect.left;

        // Floating ghost that follows the cursor
        const ghost = document.createElement('div');
        ghost.className = el.className.replace(' selected', '') + ' tl-seg-ghost';
        ghost.innerHTML = `<span class="tl-seg-label">${escH(seg.name)}</span>`;
        ghost.style.cssText = `position:fixed;width:${origRect.width}px;height:${origRect.height}px;` +
            `left:${origRect.left}px;top:${origRect.top}px;opacity:0.8;pointer-events:none;` +
            `z-index:9999;padding:0 8px;display:flex;align-items:center;border-radius:5px;` +
            `overflow:hidden;box-sizing:border-box;transition:none;`;
        document.body.appendChild(ghost);
        el.style.opacity = '0.25';

        let targetTrackId = origTrackId;
        let targetStart = seg.start;
        let lastRow = null;

        function onMove(mv) {
            const dx = mv.clientX - e.clientX;
            const dy = mv.clientY - e.clientY;
            ghost.style.left = (origRect.left + dx) + 'px';
            ghost.style.top = (origRect.top + dy) + 'px';

            // Find which track row is under cursor
            ghost.style.display = 'none';
            const under = document.elementFromPoint(mv.clientX, mv.clientY);
            ghost.style.display = '';

            const row = under?.closest('.tl-track-row');
            if (row !== lastRow) {
                if (lastRow) {
                    lastRow.classList.remove('dragover');
                    clearSnapLine(lastRow);
                }
                if (row) row.classList.add('dragover');
                lastRow = row;
            }
            if (row) {
                targetTrackId = row.dataset.trackId;
                const scrollLeft = eq('tl-scroll-area').scrollLeft;
                const rowRect = row.getBoundingClientRect();
                // keep grab offset so small nudges work
                targetStart = Math.max(
                    0,
                    (mv.clientX - rowRect.left + scrollLeft - grabOffset) / editorState.pxPerSec
                );
                const targetTrack = editorState.tracks.find(t => t.id === targetTrackId);
                if (targetTrack) {
                    const snap = getSnapInfo(targetTrack, targetStart, seg.duration, seg.id);
                    const proposed = snap.snapped ? snap.start : targetStart;
                    const resolved = resolveNonOverlap(targetTrack, seg.duration, proposed, seg.id);
                    if (resolved != null) {
                        targetStart = resolved;
                        if (snap.snapped) setSnapLine(row, resolved * editorState.pxPerSec);
                        else clearSnapLine(row);
                    } else {
                        clearSnapLine(row);
                    }
                }
            }
        }

        function onUp() {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            if (lastRow) lastRow.classList.remove('dragover');
            if (lastRow) clearSnapLine(lastRow);
            ghost.remove();
            el.style.opacity = '';

            const origTrack = editorState.tracks.find(t => t.id === origTrackId);
            const targetTrack = editorState.tracks.find(t => t.id === targetTrackId);
            if (!origTrack || !targetTrack) return;

            // Type enforcement
            if (seg.mediaType === 'audio' && targetTrack.type === 'video') {
                showToast('Audio clips can only go on audio tracks', 'error', '⚠️');
                renderTracks(); return;
            }
            if ((seg.mediaType === 'video' || seg.mediaType === 'image') && targetTrack.type === 'audio') {
                showToast('Video clips can only go on video tracks', 'error', '⚠️');
                renderTracks(); return;
            }

            const resolved = resolveNonOverlap(targetTrack, seg.duration, Math.max(0, targetStart), seg.id);
            if (resolved == null) {
                showToast('No space on that track for this clip', 'error', '⚠️');
                renderTimeline();
                return;
            }
            seg.start = resolved;

            if (targetTrackId !== origTrackId) {
                // Cross-track move
                origTrack.segments = origTrack.segments.filter(s => s.id !== seg.id);
                targetTrack.segments.push(seg);
            }
            renderTimeline();
        }

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    });

    // Mute toggle
    el.querySelector('.tl-seg-mute-btn').addEventListener('click', e => {
        e.stopPropagation();
        seg.muted = !seg.muted;
        renderTracks();
    });

    // Delete
    el.querySelector('.tl-seg-del').addEventListener('click', e => {
        e.stopPropagation();
        removeSegment(track.id, seg.id);
    });

    // Context menu: fades/hold/extract
    el.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        showSegmentMenu(e.clientX, e.clientY, seg);
    });

    // Trim left
    const trimL = el.querySelector('.tl-seg-trim.left');
    trimL.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        trimL.setPointerCapture(e.pointerId);
        const sx = e.clientX, os = seg.start, od = seg.duration;
        function onMove(mv) {
            const dx = (mv.clientX - sx) / editorState.pxPerSec;
            let newStart = Math.max(0, Math.min(os + od - 0.25, os + dx));
            const neighbor = getNeighborBounds(track, seg.id);
            if (neighbor.prevEnd != null) newStart = Math.max(newStart, neighbor.prevEnd);
            seg.start = newStart; seg.duration = od - (newStart - os);
            el.style.left = (newStart * editorState.pxPerSec) + 'px';
            el.style.width = (seg.duration * editorState.pxPerSec) + 'px';
        }
        trimL.addEventListener('pointermove', onMove);
        trimL.addEventListener('pointerup', () => {
            trimL.removeEventListener('pointermove', onMove);
            renderTimeline();
        }, { once: true });
    });

    // Trim right
    const trimR = el.querySelector('.tl-seg-trim.right');
    trimR.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        trimR.setPointerCapture(e.pointerId);
        const sx = e.clientX, od = seg.duration;
        function onMove(mv) {
            let newDur = Math.max(0.25, od + (mv.clientX - sx) / editorState.pxPerSec);
            const neighbor = getNeighborBounds(track, seg.id);
            if (neighbor.nextStart != null) {
                const maxDur = Math.max(0.25, neighbor.nextStart - seg.start);
                newDur = Math.min(newDur, maxDur);
            }
            seg.duration = newDur;
            el.style.width = (seg.duration * editorState.pxPerSec) + 'px';
        }
        trimR.addEventListener('pointermove', onMove);
        trimR.addEventListener('pointerup', () => {
            trimR.removeEventListener('pointermove', onMove);
            renderTimeline();
        }, { once: true });
    });

    return el;
}

// ── Drop / Remove / AddTrack / Clear ─────────────────────────
function dropMediaOnTrack(trackId, mediaId, startTime) {
    const track = editorState.tracks.find(t => t.id === trackId);
    const media = editorState.mediaItems.find(m => m.id === mediaId);
    if (!track || !media) return;

    // Type enforcement
    if (media.type === 'audio' && track.type === 'video') {
        showToast('Audio clips can only go on audio tracks — drop onto Audio 1 or Audio 2', 'error', '⚠️');
        return;
    }
    if ((media.type === 'video' || media.type === 'image') && track.type === 'audio') {
        showToast('Video clips can only go on video tracks — drop onto Video 1 or Video 2', 'error', '⚠️');
        return;
    }

    const snap = getSnapInfo(track, startTime, media.duration || 5, null);
    const proposed = snap.snapped ? snap.start : startTime;
    const finalStart = resolveNonOverlap(track, media.duration || 5, proposed, null);
    if (finalStart == null) {
        showToast('No space on this track for that clip', 'error', '⚠️');
        return;
    }

    const seg = {
        id: 'seg-' + Date.now(), mediaId, name: media.name, src: media.src,
        start: finalStart, duration: media.duration || 5, mediaType: media.type, muted: false
    };
    track.segments.push(seg);
    renderTimeline();
    showToast(`Added "${media.name}" to ${track.name}`, 'info', '✂️');
}

function removeSegment(trackId, segId) {
    const track = editorState.tracks.find(t => t.id === trackId);
    if (track) track.segments = track.segments.filter(s => s.id !== segId);
    editorState.transitions = editorState.transitions.filter(t => t.leftId !== segId && t.rightId !== segId);
    renderTimeline();
}

function addTrack(type) {
    const count = editorState.tracks.filter(t => t.type === type).length;
    const newTrack = {
        id: type + '-' + Date.now(), type,
        name: `${type === 'video' ? 'Video' : 'Audio'} ${count + 1}`, segments: []
    };
    const lastIdx = [...editorState.tracks].map((t, i) => t.type === type ? i : -1).filter(i => i >= 0).pop();
    if (lastIdx === undefined) editorState.tracks.push(newTrack);
    else editorState.tracks.splice(lastIdx + 1, 0, newTrack);
    renderTimeline();
}

function clearTimeline() {
    editorState.tracks.forEach(t => t.segments = []);
    editorState.transitions = [];
    renderTimeline();
}

// ── Playback ──────────────────────────────────────────────────
function togglePlayback() {
    if (editorState.playing) stopPlayback(); else startPlayback();
}

function startPlayback() {
    editorState.playing = true;
    editorState.lastRafTime = null;
    const btn = eq('tl-play-pause');
    btn.classList.add('playing');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><rect x="6" y="4" width="4" height="16" fill="currentColor" rx="1"/><rect x="14" y="4" width="4" height="16" fill="currentColor" rx="1"/></svg>';
    editorState.rafId = requestAnimationFrame(rafTick);
}

function stopPlayback() {
    editorState.playing = false;
    if (editorState.rafId) cancelAnimationFrame(editorState.rafId);
    const btn = eq('tl-play-pause');
    btn.classList.remove('playing');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>';
    // Pause preview video
    const vid = eq('preview-video');
    if (vid && !vid.paused) vid.pause();
    // Pause ALL audio segment elements immediately
    editorState.tracks.forEach(track => {
        track.segments.forEach(seg => {
            if (seg._audioEl && !seg._audioEl.paused) seg._audioEl.pause();
        });
    });
}

function rafTick(now) {
    if (!editorState.playing) return;
    if (editorState.lastRafTime !== null) {
        const dt = (now - editorState.lastRafTime) / 1000;
        const speed = editorState.exporting ? (editorState.exportSpeed || 1) : 1;
        editorState.currentTime = Math.min(editorState.timelineDur, editorState.currentTime + dt * speed);
    }
    editorState.lastRafTime = now;
    updatePreviewForTime(editorState.currentTime);
    if (editorState.exporting) renderExportFrame();
    renderPlayhead();
    updateTimeDisplay();
    const limit = editorState.exporting && editorState.exportEnd != null
        ? editorState.exportEnd
        : editorState.timelineDur;
    if (editorState.currentTime >= limit) {
        stopPlayback();
        // Finalize export if recording
        if (editorState.exporting && editorState.exportRecorder?.state === 'recording') {
            editorState.exportRecorder.stop();
        }
        return;
    }
    editorState.rafId = requestAnimationFrame(rafTick);
}

function seekTo(t) {
    editorState.currentTime = Math.max(0, Math.min(editorState.timelineDur, t));
    renderPlayhead();
    updateTimeDisplay();
    updatePreviewForTime(editorState.currentTime);
}

function updatePreviewForTime(t) {
    let found = null;
    let hasAnyVideo = false;
    for (const track of editorState.tracks) {
        if (track.type !== 'video') continue;
        if (track.segments.length) hasAnyVideo = true;
        for (const seg of track.segments) {
            if (t >= seg.start && t < seg.start + seg.duration) { found = seg; break; }
        }
        if (found) break;
    }
    const vid = eq('preview-video');
    const img = eq('preview-image');
    const emptyEl = eq('preview-empty');
    if (found?.src) {
        const opacity = String(getTransitionOpacity(found, t));
        emptyEl.style.display = 'none';
        if (found.mediaType === 'image') {
            if (!vid.paused) vid.pause();
            vid.classList.remove('active');
            vid.style.opacity = '1';
            img.classList.add('active');
            img.style.opacity = opacity;
            if (img.dataset.src !== found.src) { img.dataset.src = found.src; img.src = found.src; }
            editorState.previewType = 'image';
            editorState.previewOpacity = Number(opacity);
        } else {
            const src = editorState.exporting ? getExportSrc(found.src) : found.src;
            img.classList.remove('active');
            img.style.opacity = '1';
            vid.classList.add('active');
            if (vid.dataset.src !== src) { vid.dataset.src = src; vid.src = src; }
            vid.muted = !!found.muted;
            vid.style.opacity = opacity;
            const segTime = t - found.start;
            if (Math.abs(vid.currentTime - segTime) > 0.3) vid.currentTime = segTime;
            if (editorState.playing && vid.paused) vid.play().catch(() => { });
            if (!editorState.playing && !vid.paused) vid.pause();
            editorState.previewType = 'video';
            editorState.previewOpacity = Number(opacity);
        }
    } else {
        if (!vid.paused) vid.pause();
        vid.muted = false;
        img.classList.remove('active');
        img.style.opacity = '1';
        if (hasAnyVideo) {
            // Gap between clips: keep preview black
            vid.classList.add('active');
            vid.style.opacity = '0';
            emptyEl.style.display = 'none';
            editorState.previewType = null;
            editorState.previewOpacity = 0;
        } else {
            vid.classList.remove('active');
            vid.style.opacity = '1';
            emptyEl.style.display = 'flex';
            editorState.previewType = null;
            editorState.previewOpacity = 1;
        }
    }

    // Sync audio segments
    for (const track of editorState.tracks) {
        for (const seg of track.segments) {
            if (seg.mediaType !== 'audio') continue;
            if (!seg._audioEl) {
                seg._audioEl = new Audio(seg.src);
                seg._audioEl.preload = 'auto';
            }
            const aud = seg._audioEl;
            aud.muted = !!seg.muted;
            if (!seg.muted && t >= seg.start && t < seg.start + seg.duration) {
                const segTime = t - seg.start;
                if (Math.abs(aud.currentTime - segTime) > 0.3) aud.currentTime = segTime;
                if (editorState.playing && aud.paused) aud.play().catch(() => { });
                if (!editorState.playing && !aud.paused) aud.pause();
            } else {
                if (!aud.paused) aud.pause();
            }
        }
    }
}

function renderPlayhead() {
    const ph = eq('tl-playhead');
    const x = editorState.currentTime * editorState.pxPerSec;
    ph.style.left = x + 'px';
    if (editorState.playing) {
        const scroll = eq('tl-scroll-area');
        if (scroll && x > scroll.scrollLeft + scroll.clientWidth - 80) scroll.scrollLeft = x - 80;
    }
}

function updateTimeDisplay() {
    const t = editorState.currentTime;
    eq('tl-time').textContent = formatDurMs(t);
    eq('preview-cur').textContent = formatDur(t);
    eq('preview-dur').textContent = formatDur(editorState.timelineDur);
}

// ── Zoom ──────────────────────────────────────────────────────
function setZoom(px, silent) {
    editorState.pxPerSec = Math.max(8, Math.min(500, px));
    eq('tl-zoom-label').textContent = Math.round(editorState.pxPerSec) + 'px/s';
    renderRuler();
    renderTracks();
    renderPlayhead();
    renderLabels();
}

// ── Export via MediaRecorder ──────────────────────────────────
async function startExport() {
    if (editorState.exporting) return;
    const allSegs = editorState.tracks.flatMap(t => t.segments);
    if (allSegs.length === 0) {
        showToast('No clips on the timeline to export', 'error', '⚠️');
        return;
    }
    const videoSegs = allSegs.filter(s => s.mediaType === 'video');
    if (videoSegs.length === 0) {
        showToast('Export requires at least one video clip on a video track', 'error', '❌');
        return;
    }
    editorState.exportEnd = Math.max(...videoSegs.map(s => s.start + s.duration));

    const vid = eq('preview-video');
    if (!vid || typeof vid.captureStream !== 'function') {
        showToast('Export not supported in this browser. Use Chrome or Edge.', 'error', '❌');
        return;
    }
    // Ensure the preview video is ready if the first segment is a video
    const firstSeg = videoSegs[0];
    if (firstSeg?.mediaType === 'video') {
        const ready = await ensurePreviewReady(vid, firstSeg);
        if (!ready) return;
    }
    let stream;
    try {
        const { canvas } = ensureExportCanvas(vid);
        stream = canvas.captureStream(30);
    } catch (e) {
        showToast('Export failed to capture the export stream', 'error', '❌');
        return;
    }
    if (!stream.getVideoTracks || stream.getVideoTracks().length === 0) {
        showToast('Export failed: export stream has no video track.', 'error', '❌');
        return;
    }

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';

    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType });
    editorState.exportRecorder = rec;
    editorState.exportWindow = openExportWindow(stream);

    rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    rec.onstop = async () => {
        editorState.exporting = false;
        editorState.exportEnd = null;
        editorState.exportSpeed = 1;
        editorState.exportCanvas = null;
        editorState.exportCtx = null;
        if (editorState.exportWindow && !editorState.exportWindow.closed) {
            editorState.exportWindow.close();
        }
        editorState.exportWindow = null;
        eq('tool-export').textContent = 'Export';
        eq('tool-export').disabled = false;
        stopPlayback();
        const restoreTime = editorState.exportPrevTime ?? 0;
        seekTo(restoreTime);
        const blob = new Blob(chunks, { type: mimeType });
        let outBlob = blob;
        let suggestedName = `vibedstudio-edit-${Date.now()}.${editorState.exportFormat === 'mp4' ? 'mp4' : 'webm'}`;
        if (editorState.exportFormat === 'mp4') {
            try {
                const mp4 = await exportMp4FromServer(blob);
                if (mp4) {
                    outBlob = mp4;
                } else {
                    showToast('MP4 export requires server mode with ffmpeg. Exported WebM instead.', 'error', '⚠️');
                    outBlob = blob;
                    suggestedName = suggestedName.replace(/\.mp4$/, '.webm');
                }
            } catch (e) {
                console.warn('MP4 export failed, falling back to WebM:', e);
                showToast('MP4 export failed, falling back to WebM', 'error', '⚠️');
                outBlob = blob;
                suggestedName = suggestedName.replace(/\.mp4$/, '.webm');
            }
        }
        try {
            if (window.showSaveFilePicker) {
                const handle = await window.showSaveFilePicker({
                    suggestedName,
                    types: [{
                        description: suggestedName.endsWith('.mp4') ? 'MP4 Video' : 'WebM Video',
                        accept: suggestedName.endsWith('.mp4')
                            ? { 'video/mp4': ['.mp4'] }
                            : { 'video/webm': ['.webm'] },
                    }],
                });
                const writable = await handle.createWritable();
                await writable.write(outBlob);
                await writable.close();
                showToast('Export saved! 🎬', 'success', '📁');
                return;
            }
        } catch (e) {
            if (e?.name !== 'AbortError') {
                console.warn('Save picker failed:', e);
            } else {
                return;
            }
        }
        const url = URL.createObjectURL(outBlob);
        showExportDownload(url, suggestedName);
    };

    editorState.exporting = true;
    editorState.exportSpeed = editorState.exportFormat === 'mp4' ? 4 : 1;
    editorState.exportPrevTime = editorState.currentTime;
    seekTo(0);
    setTimeout(() => {
        rec.start(100); // collect data every 100ms
        startPlayback();
        eq('tool-export').textContent = '⏺ Recording…';
        eq('tool-export').disabled = true;
        showToast('Recording timeline… playback will stop when done', 'info', '⏺');
    }, 200);
}

async function ensurePreviewReady(vid, firstVid) {
    const src = firstVid?.src ? getExportSrc(firstVid.src) : null;
    if (src && vid.dataset.src !== src) {
        vid.dataset.src = src;
        vid.src = src;
    }
    // Ensure metadata is loaded so captureStream has tracks
    if (vid.readyState < 2) {
        const ok = await new Promise(resolve => {
            const done = (v) => {
                vid.removeEventListener('loadedmetadata', onReady);
                vid.removeEventListener('canplay', onReady);
                vid.removeEventListener('error', onError);
                resolve(v);
            };
            const onReady = () => done(true);
            const onError = () => done(false);
            vid.addEventListener('loadedmetadata', onReady, { once: true });
            vid.addEventListener('canplay', onReady, { once: true });
            vid.addEventListener('error', onError, { once: true });
            try { vid.load(); } catch { }
        });
        if (!ok) {
            showToast('Preview video failed to load. Try reloading or re-adding the clip.', 'error', '❌');
            return false;
        }
    }
    return true;
}

function showExportDownload(url, filename) {
    const wrap = document.createElement('div');
    wrap.className = 'export-download';
    wrap.innerHTML = `
      <div class="export-download-title">Export ready</div>
      <div class="export-download-meta">${escH(filename)}</div>
      <div class="export-download-actions">
        <button class="export-download-btn" data-action="download">Download</button>
        <button class="export-download-btn ghost" data-action="close">Dismiss</button>
      </div>
    `;
    document.body.appendChild(wrap);
    const onClick = e => {
        const action = e.target?.dataset?.action;
        if (action === 'download') {
            const a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            const fmt = filename.endsWith('.mp4') ? 'MP4' : 'WebM';
            showToast(`Export downloaded as ${fmt}`, 'success', '📁');
        }
        if (action === 'download' || action === 'close') {
            wrap.remove();
            URL.revokeObjectURL(url);
        }
    };
    wrap.addEventListener('click', onClick);
}

function openExportWindow(stream) {
    let win = null;
    try {
        win = window.open('', 'vibedstudio-export', 'width=840,height=520');
    } catch {
        win = null;
    }
    if (!win) {
        showToast('Popup blocked — export will run in the main window', 'info', 'ℹ️');
        return null;
    }
    win.document.write(`
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8"/>
            <title>VibedStudio Export</title>
            <style>
                body { margin:0; background:#0b0f1a; color:#e5e7eb; font:14px/1.4 system-ui; display:flex; flex-direction:column; height:100vh; }
                header { padding:10px 14px; background:#0f172a; border-bottom:1px solid rgba(255,255,255,0.08); }
                .wrap { flex:1; display:flex; align-items:center; justify-content:center; padding:10px; }
                video { width:100%; height:100%; max-width:100%; max-height:100%; background:#000; border-radius:10px; }
                small { opacity:0.7; }
            </style>
        </head>
        <body>
            <header>Export Preview <small>(recording)</small></header>
            <div class="wrap">
                <video id="export-preview" muted autoplay playsinline></video>
            </div>
        </body>
        </html>
    `);
    win.document.close();
    const v = win.document.getElementById('export-preview');
    if (v) {
        v.srcObject = stream;
        v.muted = true;
        v.play().catch(() => { });
    }
    return win;
}

function ensureExportCanvas(vid) {
    if (editorState.exportCanvas && editorState.exportCtx) {
        return { canvas: editorState.exportCanvas, ctx: editorState.exportCtx };
    }
    const canvas = document.createElement('canvas');
    const w = vid?.videoWidth || 1280;
    const h = vid?.videoHeight || 720;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    editorState.exportCanvas = canvas;
    editorState.exportCtx = ctx;
    return { canvas, ctx };
}

function renderExportFrame() {
    const canvas = editorState.exportCanvas;
    const ctx = editorState.exportCtx;
    if (!canvas || !ctx) return;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const opacity = editorState.previewOpacity ?? 1;
    if (!editorState.previewType || opacity <= 0) return;

    const sourceEl = editorState.previewType === 'image'
        ? eq('preview-image')
        : eq('preview-video');
    if (!sourceEl) return;

    const sw = editorState.previewType === 'image'
        ? (sourceEl.naturalWidth || canvas.width)
        : (sourceEl.videoWidth || canvas.width);
    const sh = editorState.previewType === 'image'
        ? (sourceEl.naturalHeight || canvas.height)
        : (sourceEl.videoHeight || canvas.height);

    const scale = Math.min(canvas.width / sw, canvas.height / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = (canvas.width - dw) / 2;
    const dy = (canvas.height - dh) / 2;

    ctx.save();
    ctx.globalAlpha = opacity;
    try { ctx.drawImage(sourceEl, dx, dy, dw, dh); } catch { }
    ctx.restore();
}

async function exportMp4FromServer(blob) {
    if (location.protocol === 'file:' || location.origin === 'null') return null;
    const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'video/webm' },
        body: blob,
    });
    if (!res.ok) {
        let msg = 'MP4 export failed';
        try {
            const data = await res.json();
            if (data?.message) msg = data.message;
        } catch { }
        throw new Error(msg);
    }
    return await res.blob();
}

// ── Keyboard shortcuts ────────────────────────────────────────
document.addEventListener('keydown', e => {
    if (!document.getElementById('page-editor') || document.getElementById('page-editor').classList.contains('hidden')) return;
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlayback(); }
    if (e.code === 'Home') { e.preventDefault(); seekTo(0); }
    if (e.code === 'KeyM' && editorState.selectedSegId) {
        // Mute selected segment
        editorState.tracks.forEach(t => {
            const seg = t.segments.find(s => s.id === editorState.selectedSegId);
            if (seg) seg.muted = !seg.muted;
        });
        renderTracks();
    }
    if (e.code === 'Delete' || e.code === 'Backspace') {
        if (editorState.selectedSegId) {
            editorState.tracks.forEach(t => {
                t.segments = t.segments.filter(s => s.id !== editorState.selectedSegId);
            });
            editorState.selectedSegId = null;
            renderTimeline();
        }
    }
});

// ── Helpers ───────────────────────────────────────────────────
function formatDur(s) {
    if (!s || isNaN(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}
function formatDurMs(s) {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60), ms = Math.floor((s % 1) * 10);
    return `${m}:${sec.toString().padStart(2, '0')}.${ms}`;
}
function maybeProxySrc(src) {
    if (!src) return src;
    if (src.startsWith('/api/video?url=')) return src;
    if (!/^https?:/i.test(src)) return src;
    if (location.protocol === 'file:' || location.origin === 'null') return src;
    return `/api/video?url=${encodeURIComponent(src)}`;
}
function getExportSrc(src) {
    return maybeProxySrc(src);
}
function getTransitionOpacity(seg, t) {
    let opacity = 1;
    if (seg.fadeIn) {
        const dur = seg.fadeInDur || TRANSITION_DUR;
        if (t >= seg.start && t <= seg.start + dur) {
            const p = (t - seg.start) / dur;
            opacity = Math.min(opacity, clamp01(p));
        }
    }
    if (seg.fadeOut) {
        const dur = seg.fadeOutDur || TRANSITION_DUR;
        const end = (seg.start || 0) + (seg.duration || 0);
        if (t >= end - dur && t <= end) {
            const p = (end - t) / dur;
            opacity = Math.min(opacity, clamp01(p));
        }
    }
    if (!editorState.transitions || editorState.transitions.length === 0) return opacity;
    for (const tr of editorState.transitions) {
        const left = findSegById(tr.leftId);
        const right = findSegById(tr.rightId);
        if (!left || !right) continue;
        const boundary = (left.start || 0) + (left.duration || 0);
        const isCross = tr.type === 'crossfade';
        if (seg.id === left.id && (tr.type === 'fade-out' || isCross)) {
            if (t >= boundary - TRANSITION_DUR && t <= boundary) {
                const p = (boundary - t) / TRANSITION_DUR;
                opacity = Math.min(opacity, clamp01(p));
            }
        }
        if (seg.id === right.id && (tr.type === 'fade-in' || isCross)) {
            if (t >= boundary && t <= boundary + TRANSITION_DUR) {
                const p = (t - boundary) / TRANSITION_DUR;
                opacity = Math.min(opacity, clamp01(p));
            }
        }
    }
    return opacity;
}
function findSegById(id) {
    for (const track of editorState.tracks) {
        const seg = track.segments.find(s => s.id === id);
        if (seg) return seg;
    }
    return null;
}
function clamp01(n) {
    return Math.max(0, Math.min(1, n));
}
function escH(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
