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
    timelineDur: 60,
    currentTime: 0,
    playing: false,
    rafId: null,
    lastRafTime: null,
    dragMediaId: null,
    selectedSegId: null,
    exporting: false,
    exportRecorder: null,
    exportEnd: null,
};

let editorInited = false;

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
    eq('project-file-input').addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (file) loadProject(file);
        e.target.value = '';
    });
    eq('tool-export').addEventListener('click', startExport);
    eq('upload-video-btn').addEventListener('click', () => eq('upload-video-input').click());
    eq('upload-audio-btn').addEventListener('click', () => eq('upload-audio-input').click());
    eq('upload-video-input').addEventListener('change', e => handleUpload(e, 'video'));
    eq('upload-audio-input').addEventListener('change', e => handleUpload(e, 'audio'));
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
        if (!editorState.mediaItems.find(m => m.id === job.id)) {
            editorState.mediaItems.push({
                id: job.id,
                name: (job.prompt || 'Generated Video').slice(0, 30),
                src: job.videoUrl,
                type: 'video',
                duration: job.duration || 5,
                source: 'generated',
            });
        }
    });
    renderMediaList();
}

function renderMediaList() {
    const genEl = eq('media-generated');
    const upEl = eq('media-uploads');
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

    genEl.innerHTML = generated.length === 0
        ? '<div class="media-empty-hint">Generate videos in the Generate tab to see them here</div>'
        : generated.map(mediaItemHTML).join('');

    upEl.innerHTML = uploads.length === 0
        ? '<div class="media-empty-hint">Upload video or audio files above</div>'
        : uploads.map(mediaItemHTML).join('');

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
}

function mediaItemHTML(m) {
    const videoIcon = `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/><polygon points="10,8 10,16 17,12" fill="currentColor" opacity="0.8"/></svg>`;
    const audioIcon = `<svg viewBox="0 0 24 24" fill="none"><path d="M9 18V5L21 3V16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="1.5"/></svg>`;

    let thumbInner = `<div class="media-thumb-icon">${m.type === 'video' ? videoIcon : audioIcon}</div>`;
    if (m.src) {
        if (m.type === 'video') thumbInner = `<video src="${m.src}#t=0.1" preload="metadata" muted playsinline></video>`;
        else if (m.type === 'image') thumbInner = `<img src="${m.src}" alt="${escH(m.name)}" />`;
    }

    return `
    <div class="media-item" data-mid="${m.id}">
      <div class="media-thumb">${thumbInner}</div>
      <div class="media-info">
        <div class="media-name">${escH(m.name)}</div>
        <div class="media-meta">${m.type.toUpperCase()} • ${formatDur(m.duration || 0)}</div>
      </div>
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
            })),
        })),
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

    editorState.mediaItems = mediaItems;
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
        })),
    }));

    const maxEnd = editorState.tracks.flatMap(t => t.segments).reduce((m, s) => Math.max(m, (s.start || 0) + (s.duration || 0)), 0);
    editorState.timelineDur = data.timelineDur || Math.max(10, maxEnd + 2);
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
    renderLabels();
    renderRuler();
    renderTracks();
    renderPlayhead();
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

        row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('dragover'); });
        row.addEventListener('dragleave', () => row.classList.remove('dragover'));
        row.addEventListener('drop', e => {
            e.preventDefault();
            row.classList.remove('dragover');
            if (!editorState.dragMediaId) return;
            const scrollLeft = eq('tl-scroll-area').scrollLeft;
            const rect = row.getBoundingClientRect();
            const x = e.clientX - rect.left + scrollLeft;
            dropMediaOnTrack(track.id, editorState.dragMediaId, Math.max(0, x / editorState.pxPerSec));
            editorState.dragMediaId = null;
        });

        track.segments.forEach(seg => row.appendChild(createSegmentEl(seg, track)));
        tracksEl.appendChild(row);
    });
}

// ── Segment element ───────────────────────────────────────────
function createSegmentEl(seg, track) {
    const isAudio = seg.mediaType === 'audio';
    const el = document.createElement('div');
    el.className = `tl-segment ${track.type}-seg${seg.muted && isAudio ? ' muted' : ''}${editorState.selectedSegId === seg.id ? ' selected' : ''}`;
    el.dataset.segId = seg.id;
    el.style.left = (seg.start * editorState.pxPerSec) + 'px';
    el.style.width = (seg.duration * editorState.pxPerSec) + 'px';

    const muteIcon = seg.muted
        ? `<svg viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2V15H6L11 19V5Z" fill="currentColor" opacity="0.5"/><path d="M23 9L17 15M17 9L23 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2V15H6L11 19V5Z" fill="currentColor"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

    const segThumb = seg.mediaType === 'video' && seg.src
        ? `<div class="tl-seg-thumb"><video src="${seg.src}#t=0.1" preload="metadata" muted playsinline tabindex="-1"></video></div>`
        : '';

    el.innerHTML = `
    ${segThumb}
    <span class="tl-seg-trim left"></span>
    <span class="tl-seg-label">${escH(seg.name)}</span>
    <span class="tl-seg-mute-btn ${seg.muted ? 'is-muted' : ''}" title="${seg.muted ? 'Unmute' : 'Mute'}">${muteIcon}</span>
    <span class="tl-seg-del" title="Remove">✕</span>
    <span class="tl-seg-trim right"></span>`;

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
                if (lastRow) lastRow.classList.remove('dragover');
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
            }
        }

        function onUp() {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            if (lastRow) lastRow.classList.remove('dragover');
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
            if (seg.mediaType === 'video' && targetTrack.type === 'audio') {
                showToast('Video clips can only go on video tracks', 'error', '⚠️');
                renderTracks(); return;
            }

            seg.start = Math.max(0, targetStart);

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

    // Trim left
    const trimL = el.querySelector('.tl-seg-trim.left');
    trimL.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        trimL.setPointerCapture(e.pointerId);
        const sx = e.clientX, os = seg.start, od = seg.duration;
        function onMove(mv) {
            const dx = (mv.clientX - sx) / editorState.pxPerSec;
            const newStart = Math.max(0, Math.min(os + od - 0.25, os + dx));
            seg.start = newStart; seg.duration = od - (newStart - os);
            el.style.left = (newStart * editorState.pxPerSec) + 'px';
            el.style.width = (seg.duration * editorState.pxPerSec) + 'px';
        }
        trimL.addEventListener('pointermove', onMove);
        trimL.addEventListener('pointerup', () => trimL.removeEventListener('pointermove', onMove), { once: true });
    });

    // Trim right
    const trimR = el.querySelector('.tl-seg-trim.right');
    trimR.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        trimR.setPointerCapture(e.pointerId);
        const sx = e.clientX, od = seg.duration;
        function onMove(mv) {
            seg.duration = Math.max(0.25, od + (mv.clientX - sx) / editorState.pxPerSec);
            el.style.width = (seg.duration * editorState.pxPerSec) + 'px';
        }
        trimR.addEventListener('pointermove', onMove);
        trimR.addEventListener('pointerup', () => trimR.removeEventListener('pointermove', onMove), { once: true });
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
    if (media.type === 'video' && track.type === 'audio') {
        showToast('Video clips can only go on video tracks — drop onto Video 1 or Video 2', 'error', '⚠️');
        return;
    }

    const seg = {
        id: 'seg-' + Date.now(), mediaId, name: media.name, src: media.src,
        start: startTime, duration: media.duration || 5, mediaType: media.type, muted: false
    };
    track.segments.push(seg);
    const end = seg.start + seg.duration;
    if (end > editorState.timelineDur) editorState.timelineDur = end + 10;
    renderTimeline();
    showToast(`Added "${media.name}" to ${track.name}`, 'info', '✂️');
}

function removeSegment(trackId, segId) {
    const track = editorState.tracks.find(t => t.id === trackId);
    if (track) track.segments = track.segments.filter(s => s.id !== segId);
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
        editorState.currentTime = Math.min(editorState.timelineDur, editorState.currentTime + dt);
    }
    editorState.lastRafTime = now;
    updatePreviewForTime(editorState.currentTime);
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
    for (const track of editorState.tracks) {
        if (track.type !== 'video') continue;
        for (const seg of track.segments) {
            if (t >= seg.start && t < seg.start + seg.duration) { found = seg; break; }
        }
        if (found) break;
    }
    const vid = eq('preview-video');
    const emptyEl = eq('preview-empty');
    if (found?.src) {
        vid.classList.add('active');
        emptyEl.style.display = 'none';
        if (vid.dataset.src !== found.src) { vid.dataset.src = found.src; vid.src = found.src; }
        vid.muted = !!found.muted;
        const segTime = t - found.start;
        if (Math.abs(vid.currentTime - segTime) > 0.3) vid.currentTime = segTime;
        if (editorState.playing && vid.paused) vid.play().catch(() => { });
        if (!editorState.playing && !vid.paused) vid.pause();
    } else {
        if (!vid.paused) vid.pause();
        vid.muted = false;
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
function startExport() {
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
    // Ensure the preview video has a source before capture
    const firstVid = videoSegs[0];
    if (firstVid?.src && vid.dataset.src !== firstVid.src) {
        vid.dataset.src = firstVid.src;
        vid.src = firstVid.src;
        try { vid.load(); } catch { }
    }
    let stream;
    try {
        stream = vid.captureStream(30);
    } catch (e) {
        showToast('Export failed to capture the preview stream', 'error', '❌');
        return;
    }

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';

    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType });
    editorState.exportRecorder = rec;

    rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    rec.onstop = async () => {
        editorState.exporting = false;
        editorState.exportEnd = null;
        eq('tool-export').textContent = 'Export';
        eq('tool-export').disabled = false;
        stopPlayback();
        const blob = new Blob(chunks, { type: mimeType });
        const suggestedName = `vibedstudio-edit-${Date.now()}.webm`;
        try {
            if (window.showSaveFilePicker) {
                const handle = await window.showSaveFilePicker({
                    suggestedName,
                    types: [{
                        description: 'WebM Video',
                        accept: { 'video/webm': ['.webm'] },
                    }],
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
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
        const url = URL.createObjectURL(blob);
        showExportDownload(url, suggestedName);
    };

    editorState.exporting = true;
    seekTo(0);
    setTimeout(() => {
        rec.start(100); // collect data every 100ms
        startPlayback();
        eq('tool-export').textContent = '⏺ Recording…';
        eq('tool-export').disabled = true;
        showToast('Recording timeline… playback will stop when done', 'info', '⏺');
    }, 200);
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
            showToast('Export downloaded as WebM', 'success', '📁');
        }
        if (action === 'download' || action === 'close') {
            wrap.remove();
            URL.revokeObjectURL(url);
        }
    };
    wrap.addEventListener('click', onClick);
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
function escH(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
