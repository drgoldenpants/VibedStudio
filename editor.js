/* ============================================================
   VibedStudio AI Video Studio — editor.js
   Timeline editor: media library, drag-drop, playback, export
   ============================================================ */

const PROJECT_AUTOSAVE_KEY = 'vibedstudio_project_autosave';
const PROJECT_AUTOSAVE_INTERVAL_MS = 3 * 60 * 1000;

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
    selectedSegIds: [],
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
    exportAudioContext: null,
    exportAudioDestination: null,
    previewOpacity: 1,
    playheadMenuEl: null,
    generatedPage: 1,
    generatedPerPage: 12,
    previewRatio: '16:9',
    previewSegId: null,
    previewDrag: null,
    prefetchedSegs: new Set(),
    clipboardSeg: null,
    clipboardTrackId: null,
    effectLibraryReady: false,
    textPresetsReady: false,
    generatedMediaTab: 'video',
    timelineUndo: [],
    timelineRedo: [],
    historyLock: false,
    projectAutosaveEnabled: localStorage.getItem(PROJECT_AUTOSAVE_KEY) === '1',
    projectAutosaveTimer: null,
    projectSaveTarget: null,
    projectAutosaveBusy: false,
};

let editorInited = false;
const TIMELINE_MIN_SECONDS = 300;
const TRANSITION_DUR = 0.5;
const TIMELINE_HISTORY_LIMIT = 50;
const TIMELINE_TAIL_SECONDS = 2;
const TRANSITION_PRESETS = [
    { key: 'cross-dissolve', label: 'Cross Dissolve' },
    { key: 'whip-pan', label: 'Whip Pan' },
    { key: 'zoom-in-out', label: 'Zoom In/Out' },
    { key: 'glitch-effects', label: 'Glitch & Effects' },
    { key: 'speed-ramps', label: 'Speed Ramps' },
    { key: 'match-cut', label: 'Match Cut' },
];
const TRANSITION_PRESET_MAP = new Map(TRANSITION_PRESETS.map(p => [p.key, p]));
const TRANSITION_PARAM_DEFS = {
    'cross-dissolve': [
        { key: 'duration', label: 'Duration', min: 0.15, max: 1.5, step: 0.05, default: 0.5 },
    ],
    'whip-pan': [
        { key: 'duration', label: 'Duration', min: 0.15, max: 1.5, step: 0.05, default: 0.45 },
        { key: 'distance', label: 'Distance', min: 0.08, max: 0.45, step: 0.01, default: 0.22 },
    ],
    'zoom-in-out': [
        { key: 'duration', label: 'Duration', min: 0.15, max: 1.5, step: 0.05, default: 0.45 },
        { key: 'zoom', label: 'Zoom', min: 0.04, max: 0.35, step: 0.01, default: 0.16 },
    ],
    'glitch-effects': [
        { key: 'duration', label: 'Duration', min: 0.15, max: 1.2, step: 0.05, default: 0.35 },
        { key: 'shift', label: 'Shift', min: 0.01, max: 0.12, step: 0.01, default: 0.04 },
    ],
    'speed-ramps': [
        { key: 'duration', label: 'Duration', min: 0.15, max: 1.0, step: 0.05, default: 0.35 },
        { key: 'boost', label: 'Boost', min: 0.05, max: 0.35, step: 0.01, default: 0.14 },
    ],
    'match-cut': [
        { key: 'duration', label: 'Duration', min: 0.1, max: 0.8, step: 0.05, default: 0.22 },
        { key: 'settle', label: 'Settle', min: 0, max: 0.18, step: 0.01, default: 0.06 },
    ],
};

// ── DOM helpers ───────────────────────────────────────────────
const eq = id => document.getElementById(id);
const previewGuideV = eq('preview-guide-v');
const previewGuideH = eq('preview-guide-h');
const previewGuideVQ1 = eq('preview-guide-v-q1');
const previewGuideVQ3 = eq('preview-guide-v-q3');
const previewGuideHQ1 = eq('preview-guide-h-q1');
const previewGuideHQ3 = eq('preview-guide-h-q3');
const previewGuideLeft = eq('preview-guide-left');
const previewGuideRight = eq('preview-guide-right');
const previewGuideTop = eq('preview-guide-top');
const previewGuideBottom = eq('preview-guide-bottom');

function cloneTrackForHistory(track) {
    return {
        id: track.id,
        type: track.type,
        name: track.name,
        segments: (track.segments || []).map(seg => cloneSegmentData(seg)),
    };
}

function snapshotTimelineState() {
    return {
        tracks: editorState.tracks.map(cloneTrackForHistory),
        transitions: editorState.transitions.map(t => ({ ...t })),
        selectedSegId: editorState.selectedSegId,
        selectedSegIds: [...(editorState.selectedSegIds || [])],
        previewSegId: editorState.previewSegId,
        currentTime: editorState.currentTime,
        timelineDur: editorState.timelineDur,
    };
}

function applyTimelineState(state) {
    if (!state) return;
    editorState.historyLock = true;
    editorState.tracks = (state.tracks || []).map(t => ({
        id: t.id,
        type: t.type,
        name: t.name,
        segments: (t.segments || []).map(s => ({
            ...cloneSegmentData(s),
            transform: s.transform ? { ...s.transform } : { x: 0, y: 0, scale: 1 },
        })),
    }));
    editorState.transitions = Array.isArray(state.transitions) ? state.transitions.map(t => normalizeTransitionData(t)) : [];
    editorState.selectedSegId = state.selectedSegId || null;
    editorState.selectedSegIds = Array.isArray(state.selectedSegIds)
        ? [...new Set(state.selectedSegIds.filter(Boolean))]
        : (editorState.selectedSegId ? [editorState.selectedSegId] : []);
    if (editorState.selectedSegId && !editorState.selectedSegIds.includes(editorState.selectedSegId)) {
        editorState.selectedSegIds.unshift(editorState.selectedSegId);
    }
    editorState.previewSegId = state.previewSegId || null;
    editorState.timelineDur = state.timelineDur || editorState.timelineDur;
    renderTimeline();
    seekTo(state.currentTime || 0);
    updatePreviewSelection();
    editorState.historyLock = false;
}

function getSelectedSegIds() {
    const ids = Array.isArray(editorState.selectedSegIds) ? editorState.selectedSegIds.filter(Boolean) : [];
    if (editorState.selectedSegId && !ids.includes(editorState.selectedSegId)) ids.unshift(editorState.selectedSegId);
    return [...new Set(ids)];
}

function isSegmentSelected(segId) {
    return !!segId && getSelectedSegIds().includes(segId);
}

function setSelectedSegments(segIds, primarySegId = null) {
    const ids = [...new Set((segIds || []).filter(Boolean))];
    const primary = primarySegId && ids.includes(primarySegId)
        ? primarySegId
        : ids[0] || null;
    editorState.selectedSegIds = ids;
    editorState.selectedSegId = primary;
    if (primary) editorState.previewSegId = primary;
}

function toggleSelectedSegment(segId) {
    if (!segId) return;
    const ids = getSelectedSegIds();
    if (ids.includes(segId)) {
        const next = ids.filter(id => id !== segId);
        const nextPrimary = editorState.selectedSegId === segId ? (next[0] || null) : editorState.selectedSegId;
        setSelectedSegments(next, nextPrimary);
        return;
    }
    ids.push(segId);
    setSelectedSegments(ids, segId);
}

function clearSelectedSegments() {
    editorState.selectedSegIds = [];
    editorState.selectedSegId = null;
    editorState.previewSegId = null;
}

function getSelectedSegments() {
    const selected = new Set(getSelectedSegIds());
    return editorState.tracks.flatMap(track =>
        track.segments
            .filter(seg => selected.has(seg.id))
            .map(seg => ({ seg, track }))
    );
}

function getMultiDragBounds(selectedEntries) {
    let minDelta = -Infinity;
    let maxDelta = Infinity;
    const selectedIds = new Set(selectedEntries.map(entry => entry.seg.id));
    selectedEntries.forEach(({ seg, track }) => {
        const others = track.segments
            .filter(s => !selectedIds.has(s.id))
            .sort((a, b) => a.start - b.start);
        let prevEnd = 0;
        let nextStart = Infinity;
        for (const other of others) {
            const otherStart = other.start || 0;
            const otherEnd = otherStart + (other.duration || 0);
            if (otherEnd <= (seg.start || 0)) prevEnd = Math.max(prevEnd, otherEnd);
            if (otherStart >= (seg.start || 0) + (seg.duration || 0)) {
                nextStart = otherStart;
                break;
            }
        }
        minDelta = Math.max(minDelta, prevEnd - (seg.start || 0));
        maxDelta = Math.min(maxDelta, nextStart - ((seg.start || 0) + (seg.duration || 0)));
    });
    return { minDelta, maxDelta };
}

function pushTimelineHistory(snapshot) {
    if (editorState.historyLock) return;
    const state = snapshot || snapshotTimelineState();
    const hash = JSON.stringify({ tracks: state.tracks, transitions: state.transitions });
    const last = editorState.timelineUndo[editorState.timelineUndo.length - 1];
    if (last && last._hash === hash) return;
    state._hash = hash;
    editorState.timelineUndo.push(state);
    if (editorState.timelineUndo.length > TIMELINE_HISTORY_LIMIT) {
        editorState.timelineUndo.shift();
    }
    editorState.timelineRedo = [];
}

function pushTimelineRedo(snapshot) {
    const state = snapshot || snapshotTimelineState();
    const hash = JSON.stringify({ tracks: state.tracks, transitions: state.transitions });
    const last = editorState.timelineRedo[editorState.timelineRedo.length - 1];
    if (last && last._hash === hash) return;
    state._hash = hash;
    editorState.timelineRedo.push(state);
    if (editorState.timelineRedo.length > TIMELINE_HISTORY_LIMIT) {
        editorState.timelineRedo.shift();
    }
}

function undoTimeline() {
    if (!editorState.timelineUndo.length) return;
    const current = snapshotTimelineState();
    pushTimelineRedo(current);
    const prev = editorState.timelineUndo.pop();
    applyTimelineState(prev);
}

function redoTimeline() {
    if (!editorState.timelineRedo.length) return;
    const current = snapshotTimelineState();
    pushTimelineHistory(current);
    const next = editorState.timelineRedo.pop();
    applyTimelineState(next);
}

function ensureMediaDimensions(media) {
    if (!media || media._dimPending || (media.width && media.height)) return;
    media._dimPending = true;
    if (media.type === 'image') {
        const img = new Image();
        img.onload = () => {
            media.width = img.naturalWidth || 0;
            media.height = img.naturalHeight || 0;
            media._dimPending = false;
        };
        img.onerror = () => { media._dimPending = false; };
        const src = getEditorMediaPlaybackSrc(media);
        if (!src) {
            media._dimPending = false;
            if (media.id) ensureEditorMediaCache(media.id, media.type);
            return;
        }
        img.src = src;
        return;
    }
    if (media.type === 'video') {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        v.playsInline = true;
        v.onloadedmetadata = () => {
            media.width = v.videoWidth || 0;
            media.height = v.videoHeight || 0;
            media._dimPending = false;
            v.src = '';
        };
        v.onerror = () => { media._dimPending = false; };
        const src = getEditorVideoPlaybackSrc(media);
        if (!src) {
            media._dimPending = false;
            if (media.id) ensureEditorVideoCache(media.id);
            return;
        }
        v.src = src;
    }
}

function applyCachedEditorVideoSrc(mediaId, src) {
    if (!mediaId || !src) return;
    const media = editorState.mediaItems.find(m => m.id === mediaId);
    if (media) {
        media.src = src;
        media.proxySrc = src;
    }
    editorState.tracks.forEach(track => {
        track.segments.forEach(seg => {
            if (seg.mediaId === mediaId) seg.src = src;
        });
    });
}

function getCachedEditorVideoSrc(mediaId) {
    if (!mediaId) return null;
    const media = editorState.mediaItems.find(m => m.id === mediaId);
    if (media?.src && /^(blob:|data:)/i.test(media.src)) return media.src;
    const job = window.state?.jobs?.find(j => j.id === mediaId);
    if (!job) return null;
    if (job.videoBlob instanceof Blob) {
        if (!job._cachedUrl) {
            try { job._cachedUrl = URL.createObjectURL(job.videoBlob); } catch { }
        }
        if (job._cachedUrl) {
            applyCachedEditorVideoSrc(mediaId, job._cachedUrl);
            return job._cachedUrl;
        }
    }
    if (job._cachedUrl) {
        applyCachedEditorVideoSrc(mediaId, job._cachedUrl);
        return job._cachedUrl;
    }
    if (typeof job.videoUrl === 'string' && /^(blob:|data:)/i.test(job.videoUrl)) {
        applyCachedEditorVideoSrc(mediaId, job.videoUrl);
        return job.videoUrl;
    }
    return null;
}

function isEditorCachedSrc(src) {
    return typeof src === 'string' && /^(blob:|data:)/i.test(src);
}

function applyCachedEditorMediaSrc(mediaId, src) {
    if (!mediaId || !src) return;
    const media = editorState.mediaItems.find(m => m.id === mediaId);
    if (media) {
        media.src = src;
        media.proxySrc = src;
    }
    editorState.tracks.forEach(track => {
        track.segments.forEach(seg => {
            if (seg.mediaId === mediaId) seg.src = src;
        });
    });
}

function getCachedEditorImageSrc(mediaId) {
    if (!mediaId) return null;
    const media = editorState.mediaItems.find(m => m.id === mediaId);
    if (isEditorCachedSrc(media?.src)) return media.src;
    return null;
}

function getCachedEditorAudioSrc(mediaId) {
    if (!mediaId) return null;
    const media = editorState.mediaItems.find(m => m.id === mediaId);
    if (isEditorCachedSrc(media?.src)) return media.src;
    return null;
}

function getEditorVideoPlaybackSrc(mediaOrSeg) {
    if (!mediaOrSeg) return '';
    const mediaId = mediaOrSeg.mediaId || mediaOrSeg.id || null;
    const cachedSrc = getCachedEditorVideoSrc(mediaId);
    if (cachedSrc) return cachedSrc;
    const directSrc = mediaOrSeg.src || '';
    if (isEditorCachedSrc(directSrc)) return directSrc;
    return '';
}

function getEditorMediaPlaybackSrc(mediaOrSeg) {
    if (!mediaOrSeg) return '';
    const type = mediaOrSeg.mediaType || mediaOrSeg.type || '';
    if (type === 'video') return getEditorVideoPlaybackSrc(mediaOrSeg);
    const mediaId = mediaOrSeg.mediaId || mediaOrSeg.id || null;
    const directSrc = mediaOrSeg.src || '';
    if (type === 'image') {
        const media = editorState.mediaItems.find(m => m.id === mediaId);
        const cachedSrc = isEditorCachedSrc(media?.src) ? media.src : '';
        return cachedSrc || (isEditorCachedSrc(directSrc) ? directSrc : '');
    }
    if (type === 'audio') {
        const media = editorState.mediaItems.find(m => m.id === mediaId);
        const cachedSrc = isEditorCachedSrc(media?.src) ? media.src : '';
        return cachedSrc || (isEditorCachedSrc(directSrc) ? directSrc : '');
    }
    return directSrc;
}

function ensureEditorVideoCache(mediaId) {
    if (!mediaId || !window.ensureVideoCached) return;
    const media = editorState.mediaItems.find(m => m.id === mediaId);
    if (media?._cachePending) return;
    if (getCachedEditorVideoSrc(mediaId)) return;
    if (media) media._cachePending = true;
    window.ensureVideoCached(mediaId, { silent: true }).then(cachedSrc => {
        if (cachedSrc) {
            applyCachedEditorVideoSrc(mediaId, cachedSrc);
            if (eq('preview-layers')) updatePreviewForTime(editorState.currentTime || 0);
        }
    }).catch(() => {
    }).finally(() => {
        if (media) media._cachePending = false;
    });
}

function ensureEditorMediaCache(mediaId, type) {
    if (!mediaId || !type) return;
    if (type === 'video') {
        ensureEditorVideoCache(mediaId);
        return;
    }
    const media = editorState.mediaItems.find(m => m.id === mediaId);
    if (media?._cachePending) return;
    const cacheFn = type === 'image'
        ? window.ensureImageCached
        : type === 'audio'
            ? window.ensureAudioCached
            : null;
    if (!cacheFn) return;
    const currentSrc = getEditorMediaPlaybackSrc({ id: mediaId, type });
    if (currentSrc) return;
    if (media) media._cachePending = true;
    cacheFn(mediaId, { silent: true }).then(cachedSrc => {
        if (cachedSrc) {
            applyCachedEditorMediaSrc(mediaId, cachedSrc);
            renderMediaList();
            if (eq('preview-layers')) updatePreviewForTime(editorState.currentTime || 0);
        }
    }).catch(() => {
    }).finally(() => {
        if (media) media._cachePending = false;
    });
}

function initToolbarTabs() {
    const tabs = document.querySelectorAll('.toolbar-tab[data-toolbar-tab]');
    const panels = document.querySelectorAll('.toolbar-panel[data-toolbar-panel]');
    if (!tabs.length || !panels.length) return;
    tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.toolbarTab;
            tabs.forEach(t => t.classList.toggle('active', t === btn));
            panels.forEach(p => p.classList.toggle('hidden', p.dataset.toolbarPanel !== key));
        });
    });
}

function bindHeaderProjectButtons() {
    const headerSave = eq('header-save-project');
    const headerLoad = eq('header-load-project');
    const autosaveToggle = eq('project-autosave-toggle');
    if (headerSave && !headerSave.dataset.bound) {
        headerSave.dataset.bound = '1';
        headerSave.addEventListener('click', () => {
            saveProject();
        });
    }
    if (headerLoad && !headerLoad.dataset.bound) {
        headerLoad.dataset.bound = '1';
        headerLoad.addEventListener('click', () => triggerProjectLoad());
    }
    if (autosaveToggle && !autosaveToggle.dataset.bound) {
        autosaveToggle.dataset.bound = '1';
        autosaveToggle.addEventListener('change', e => {
            setProjectAutosaveEnabled(!!e.target.checked);
        });
    }
    updateProjectAutosaveUI();
    refreshProjectAutosaveTimer();
}

function canAutosaveProject() {
    return !!editorState.projectSaveTarget;
}

function updateProjectAutosaveUI() {
    const autosaveToggle = eq('project-autosave-toggle');
    const autosaveWrap = eq('project-autosave-wrap');
    if (!autosaveToggle || !autosaveWrap) return;
    const enabled = !!editorState.projectAutosaveEnabled;
    const available = canAutosaveProject();
    autosaveToggle.checked = enabled;
    autosaveToggle.disabled = !available;
    autosaveWrap.classList.toggle('disabled', !available);
    autosaveWrap.title = available
        ? `Autosaves every ${Math.round(PROJECT_AUTOSAVE_INTERVAL_MS / 60000)} minutes`
        : 'Autosave requires a saved project target';
}

function refreshProjectAutosaveTimer() {
    if (editorState.projectAutosaveTimer) {
        clearInterval(editorState.projectAutosaveTimer);
        editorState.projectAutosaveTimer = null;
    }
    if (!editorState.projectAutosaveEnabled || !canAutosaveProject()) return;
    editorState.projectAutosaveTimer = setInterval(() => {
        saveProject({ autosave: true, silent: true }).catch(err => {
            console.warn('Autosave failed:', err);
        });
    }, PROJECT_AUTOSAVE_INTERVAL_MS);
}

function setProjectSaveTarget(target) {
    editorState.projectSaveTarget = target || null;
    if (!editorState.projectSaveTarget) {
        editorState.projectAutosaveEnabled = false;
        localStorage.setItem(PROJECT_AUTOSAVE_KEY, '0');
    } else {
        editorState.projectAutosaveEnabled = true;
        localStorage.setItem(PROJECT_AUTOSAVE_KEY, '1');
    }
    updateProjectAutosaveUI();
    refreshProjectAutosaveTimer();
}

function setProjectAutosaveEnabled(enabled) {
    editorState.projectAutosaveEnabled = !!enabled && canAutosaveProject();
    localStorage.setItem(PROJECT_AUTOSAVE_KEY, editorState.projectAutosaveEnabled ? '1' : '0');
    updateProjectAutosaveUI();
    refreshProjectAutosaveTimer();
    if (enabled && !canAutosaveProject()) {
        showToast('Save the project once to enable autosave', 'info', '💾');
    } else if (editorState.projectAutosaveEnabled) {
        showToast(`Autosave enabled (${Math.round(PROJECT_AUTOSAVE_INTERVAL_MS / 60000)} min)`, 'success', '⏱️');
    } else {
        showToast('Autosave disabled', 'info', '⏸️');
    }
}

function createTextMediaItem(overrides = {}) {
    const id = overrides.id || `text-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    const item = {
        id,
        name: overrides.name || 'Text Overlay',
        type: 'text',
        duration: overrides.duration || 4,
        text: overrides.text || 'Add your text',
        fontFamily: overrides.fontFamily || 'Arial',
        fontSize: overrides.fontSize || 48,
        fontWeight: overrides.fontWeight || 600,
        fontStyle: overrides.fontStyle || 'normal',
        color: overrides.color || '#ffffff',
        align: overrides.align || 'center',
        bgColor: overrides.bgColor ?? 'transparent',
        padding: overrides.padding ?? 8,
        lineHeight: overrides.lineHeight || 1.1,
        letterSpacing: overrides.letterSpacing || 0,
        underline: overrides.underline || false,
        boxW: overrides.boxW ?? null,
        boxH: overrides.boxH ?? null,
    };
    if (overrides.source) item.source = overrides.source;
    if (overrides.presetKey) item.presetKey = overrides.presetKey;
    return item;
}

const EFFECT_PRESETS = [
    { name: 'Zoom Punch', key: 'zoom-punch', duration: 2.0 },
    { name: 'Glitch', key: 'glitch', duration: 1.5 },
    { name: 'VHS', key: 'vhs', duration: 3.0 },
    { name: 'Blur In', key: 'blur-in', duration: 1.2 },
    { name: 'Aesthetic Weekend', key: 'aesthetic-weekend', duration: 3.0 },
    { name: 'Retro Glow', key: 'retro-glow', duration: 3.0 },
    { name: 'Cozy', key: 'cozy', duration: 3.0 },
    { name: 'Brew', key: 'brew', duration: 3.0 },
    { name: 'Tonal', key: 'tonal', duration: 3.0 },
    { name: 'Beach', key: 'beach', duration: 3.0 },
    { name: 'Color Bomb', key: 'color-bomb', duration: 2.5 },
    { name: 'Vintage Film', key: 'vintage-film', duration: 3.0 },
    { name: 'ND3-Angel', key: 'nd3-angel', duration: 3.0 },
];

const EFFECT_PARAM_DEFS = {
    'zoom-punch': [
        { key: 'strength', label: 'Strength', min: 0.02, max: 0.2, step: 0.01, default: 0.06 },
    ],
    'glitch': [
        { key: 'shift', label: 'Shift', min: 1, max: 8, step: 0.5, default: 1.5 },
        { key: 'contrast', label: 'Contrast', min: 1, max: 1.8, step: 0.05, default: 1.2 },
    ],
    'vhs': [
        { key: 'saturation', label: 'Saturation', min: 1, max: 1.8, step: 0.05, default: 1.35 },
        { key: 'scanlines', label: 'Scanlines', min: 0, max: 0.7, step: 0.05, default: 0.35 },
    ],
    'blur-in': [
        { key: 'amount', label: 'Blur', min: 1, max: 10, step: 0.5, default: 4 },
    ],
    'aesthetic-weekend': [
        { key: 'warmth', label: 'Warmth', min: 0, max: 0.4, step: 0.02, default: 0.14 },
        { key: 'wash', label: 'Wash', min: 0, max: 0.45, step: 0.02, default: 0.28 },
    ],
    'retro-glow': [
        { key: 'sepia', label: 'Sepia', min: 0, max: 0.5, step: 0.02, default: 0.18 },
        { key: 'glow', label: 'Glow', min: 0, max: 0.5, step: 0.02, default: 0.34 },
    ],
    'cozy': [
        { key: 'warmth', label: 'Warmth', min: 0, max: 0.45, step: 0.02, default: 0.24 },
        { key: 'softness', label: 'Softness', min: 0, max: 0.4, step: 0.02, default: 0.22 },
    ],
    'brew': [
        { key: 'roast', label: 'Roast', min: 0, max: 0.6, step: 0.02, default: 0.44 },
        { key: 'shade', label: 'Shade', min: 0, max: 0.4, step: 0.02, default: 0.24 },
    ],
    'tonal': [
        { key: 'mono', label: 'Mono', min: 0, max: 1, step: 0.05, default: 0.85 },
        { key: 'contrast', label: 'Contrast', min: 1, max: 1.5, step: 0.05, default: 1.14 },
    ],
    'beach': [
        { key: 'vibrance', label: 'Vibrance', min: 1, max: 1.6, step: 0.05, default: 1.24 },
        { key: 'sunlight', label: 'Sunlight', min: 0, max: 0.4, step: 0.02, default: 0.24 },
    ],
    'color-bomb': [
        { key: 'saturation', label: 'Saturation', min: 1, max: 2.2, step: 0.05, default: 1.75 },
        { key: 'burst', label: 'Burst', min: 0, max: 0.35, step: 0.02, default: 0.2 },
    ],
    'vintage-film': [
        { key: 'age', label: 'Age', min: 0, max: 0.6, step: 0.02, default: 0.36 },
        { key: 'grain', label: 'Grain', min: 0, max: 0.5, step: 0.02, default: 0.3 },
    ],
    'nd3-angel': [
        { key: 'halo', label: 'Halo', min: 0, max: 0.45, step: 0.02, default: 0.28 },
        { key: 'softness', label: 'Softness', min: 0, max: 1.2, step: 0.05, default: 0.3 },
    ],
};

const EFFECT_PRESET_MAP = new Map(EFFECT_PRESETS.map(p => [p.key, p]));
const EFFECT_CSS_VAR_NAMES = [
    '--fx-zoom-scale',
    '--fx-glitch-shift',
    '--fx-glitch-contrast',
    '--fx-vhs-saturation',
    '--fx-vhs-scanlines',
    '--fx-blur-max',
    '--fx-aw-warmth',
    '--fx-aw-wash',
    '--fx-rg-sepia',
    '--fx-rg-glow',
    '--fx-cozy-warmth',
    '--fx-cozy-softness',
    '--fx-brew-roast',
    '--fx-brew-shade',
    '--fx-tonal-mono',
    '--fx-tonal-contrast',
    '--fx-beach-vibrance',
    '--fx-beach-sunlight',
    '--fx-cb-saturation',
    '--fx-cb-burst',
    '--fx-vf-age',
    '--fx-vf-grain',
    '--fx-angel-halo',
    '--fx-angel-softness',
];

function cloneEffectParams(params) {
    return params && typeof params === 'object' ? { ...params } : null;
}

function getEffectPreset(key) {
    return EFFECT_PRESET_MAP.get(key) || EFFECT_PRESETS[0];
}

function getEffectParamDefs(key) {
    return EFFECT_PARAM_DEFS[key] || [];
}

function getDefaultEffectParams(key) {
    const defs = getEffectParamDefs(key);
    const defaults = {};
    defs.forEach(def => {
        defaults[def.key] = def.default;
    });
    return defaults;
}

function normalizeEffectParams(key, params) {
    const defs = getEffectParamDefs(key);
    const next = {};
    defs.forEach(def => {
        const raw = Number(params?.[def.key]);
        const value = Number.isFinite(raw) ? raw : def.default;
        next[def.key] = Math.max(def.min, Math.min(def.max, value));
    });
    return next;
}

function ensureEffectLibrary() {
    if (editorState.effectLibraryReady) return;
    EFFECT_PRESETS.forEach(p => {
        const existing = editorState.mediaItems.find(m => m.id === `fx-${p.key}`);
        if (existing) {
            existing.name = p.name;
            existing.type = 'effect';
            existing.duration = p.duration;
            existing.source = 'effect';
            existing.effectKey = p.key;
            existing.effectParams = normalizeEffectParams(p.key, existing.effectParams);
            return;
        }
        editorState.mediaItems.push({
            id: `fx-${p.key}`,
            name: p.name,
            type: 'effect',
            duration: p.duration,
            source: 'effect',
            effectKey: p.key,
            effectParams: getDefaultEffectParams(p.key),
        });
    });
    editorState.effectLibraryReady = true;
}

function ensureTextPresets() {
    if (editorState.textPresetsReady) return;
    const hasOverlay = editorState.mediaItems.some(m => m.id === 'text-preset-overlay');
    const hasTitle = editorState.mediaItems.some(m => m.id === 'text-preset-title');
    if (!hasOverlay) {
        editorState.mediaItems.push(createTextMediaItem({
            id: 'text-preset-overlay',
            name: 'Text Overlay',
            text: 'Add your text',
            duration: 4,
            source: 'text-preset',
            presetKey: 'overlay',
        }));
    }
    if (!hasTitle) {
        editorState.mediaItems.push(createTextMediaItem({
            id: 'text-preset-title',
            name: 'Title',
            text: 'Title',
            duration: 4,
            fontSize: 72,
            fontWeight: 700,
            bgColor: '#000000',
            padding: 0,
            source: 'text-preset',
            presetKey: 'title',
        }));
    }
    editorState.textPresetsReady = true;
}

function renderEffectItems() {
    const container = eq('effect-items');
    if (!container) return;
    const items = editorState.mediaItems.filter(m => m.type === 'effect');
    container.innerHTML = items.length
        ? items.map(m => mediaItemHTML(m, { compact: false })).join('')
        : '<div class="media-empty-hint">No effects available</div>';
}

function renderTextItems() {
    const container = eq('text-items');
    if (!container) return;
    ensureTextPresets();
    const textIcon = `<svg viewBox="0 0 24 24" fill="none"><path d="M4 6H20M12 6V20M7 20H17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
    const items = editorState.mediaItems.filter(m => m.type === 'text' && m.source === 'text-preset');
    container.innerHTML = items.map(m => `
      <div class="media-item text-preset" data-mid="${m.id}">
        <div class="media-icon">${textIcon}</div>
        <div class="media-info">
          <div class="media-name">${escH(m.name)}</div>
          <div class="media-meta">TEXT • ${formatDur(m.duration || 0)}</div>
        </div>
      </div>`).join('');
}

function getTextStyle(seg) {
    const isTitle = seg?.presetKey === 'title';
    const bgColor = seg?.bgColor ?? (isTitle ? '#000000' : 'transparent');
    return {
        text: seg.text || 'Text',
        fontFamily: seg.fontFamily || 'Arial',
        fontSize: seg.fontSize || 48,
        fontWeight: seg.fontWeight || 600,
        fontStyle: seg.fontStyle || 'normal',
        color: seg.color || '#ffffff',
        align: seg.align || 'center',
        bgColor,
        padding: seg.padding ?? 8,
        lineHeight: seg.lineHeight || 1.1,
        letterSpacing: seg.letterSpacing || 0,
        underline: !!seg.underline,
        boxW: seg.boxW ?? null,
        boxH: seg.boxH ?? null,
    };
}

function resolveFontFamily(fontFamily) {
    const rootStyle = getComputedStyle(document.documentElement);
    const defaultFont = rootStyle.getPropertyValue('--font').trim() || 'sans-serif';
    const monoFont = rootStyle.getPropertyValue('--font-mono').trim() || 'monospace';
    if (!fontFamily) return defaultFont;
    if (fontFamily.includes('var(--font-mono)')) return monoFont;
    if (fontFamily.includes('var(--font)')) return defaultFont;
    return fontFamily;
}

function applyTextLayerStyle(seg, el) {
    if (!seg || !el) return;
    const style = getTextStyle(seg);
    const isTitle = seg.presetKey === 'title';
    let contentEl = el.querySelector('.text-content');
    if (!contentEl) {
        contentEl = document.createElement('span');
        contentEl.className = 'text-content';
        el.appendChild(contentEl);
    }
    if (!el.querySelector('.text-resize-handle')) {
        const handle = document.createElement('span');
        handle.className = 'text-resize-handle br';
        el.appendChild(handle);
    }
    contentEl.textContent = style.text;
    el.style.fontFamily = style.fontFamily;
    el.style.fontSize = `${style.fontSize}px`;
    el.style.fontWeight = String(style.fontWeight);
    el.style.fontStyle = style.fontStyle;
    el.style.color = style.color;
    el.style.textAlign = style.align;
    el.style.background = style.bgColor;
    el.style.padding = isTitle ? '0px' : `${style.padding}px`;
    el.style.lineHeight = String(style.lineHeight);
    el.style.letterSpacing = `${style.letterSpacing}px`;
    el.style.width = isTitle ? '100%' : (style.boxW ? `${style.boxW}px` : 'auto');
    el.style.height = isTitle ? '100%' : (style.boxH ? `${style.boxH}px` : 'auto');
    el.style.maxWidth = isTitle ? '100%' : '';
    el.style.display = isTitle ? 'flex' : '';
    el.style.alignItems = isTitle ? 'center' : '';
    el.style.justifyContent = isTitle ? 'center' : '';
    const handleEl = el.querySelector('.text-resize-handle');
    if (handleEl) handleEl.style.display = isTitle ? 'none' : '';
    if (isTitle && seg.transform) seg.transform.scale = 1;
    contentEl.style.textDecoration = style.underline ? 'underline' : 'none';
}

// ── Tab switching ─────────────────────────────────────────────
document.querySelectorAll('.app-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.classList.contains('disabled')) {
            window.showServerHelp?.();
            return;
        }
        const tab = btn.dataset.tab;
        if (tab === 'editor') stopGenerationVideos();
        document.querySelectorAll('.app-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-page').forEach(p => p.classList.add('hidden'));
        btn.classList.add('active');
        document.getElementById('page-' + tab).classList.remove('hidden');
        if (tab === 'editor') initEditor();
        if (tab === 'images') window.initImages?.();
        if (tab === 'audio') window.initAudio?.();
        requestAnimationFrame(() => {
            window.updateApiKeyGuidanceForCurrentContext?.();
        });
    });
});

function stopGenerationVideos() {
    const page = document.getElementById('page-generate');
    if (!page) return;
    page.querySelectorAll('video').forEach(v => {
        try {
            v.pause();
        } catch {
        }
    });
}

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
    eq('tool-add-effect-track')?.addEventListener('click', () => addTrack('effect'));
    eq('tool-add-text-track')?.addEventListener('click', () => addTrack('text'));
    initGeneratedMediaTabs();
    eq('tool-clear-timeline')?.addEventListener('click', clearTimeline);
    eq('tool-save-project')?.addEventListener('click', saveProject);
    eq('tool-load-project')?.addEventListener('click', () => triggerProjectLoad());
    bindHeaderProjectButtons();
    const ratioSelect = eq('preview-ratio-select');
    if (ratioSelect) {
        const savedRatio = localStorage.getItem('vibedstudio_preview_ratio');
        if (savedRatio) {
            editorState.previewRatio = savedRatio;
            ratioSelect.value = savedRatio;
        }
        ratioSelect.addEventListener('change', () => {
            editorState.previewRatio = ratioSelect.value;
            localStorage.setItem('vibedstudio_preview_ratio', editorState.previewRatio);
            applyPreviewRatio();
            const seg = getActivePreviewSegment();
            if (seg) applyPreviewTransform(seg);
        });
        applyPreviewRatio();
    }

    initPreviewTransformControls();
    initToolbarTabs();
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
    ensureProjectFileInputBound();
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
            const startX = e.clientX;
            let dragging = false;
            const onMove = mv => {
                if (!dragging) {
                    if (Math.abs(mv.clientX - startX) < 3) return;
                    dragging = true;
                }
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
        const scrollLeft = eq('tl-scroll-area').scrollLeft;
        const rect = ruler.getBoundingClientRect();
        const x = e.clientX - rect.left + scrollLeft;
        const playheadX = editorState.currentTime * editorState.pxPerSec;
        if (Math.abs(x - playheadX) <= 10) return;
        e.preventDefault();
        ruler.setPointerCapture(e.pointerId);
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
    ensureEffectLibrary();
    renderEffectItems();
    setZoom(80, true);
    initTransitionContextDelegate();
}

function applyPreviewRatio() {
    const stage = eq('preview-stage');
    const wrap = stage?.parentElement;
    if (!stage || !wrap) return;
    const { value } = parseRatio(editorState.previewRatio || '16:9');
    stage.style.setProperty('--preview-ratio', `${value}`);
    const rect = wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    let w = rect.width;
    let h = rect.width / value;
    if (h > rect.height) {
        h = rect.height;
        w = rect.height * value;
    }
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
    editorState.exportCanvas = null;
    editorState.exportCtx = null;
}

function parseRatio(value) {
    const [wRaw, hRaw] = String(value || '16:9').split(':');
    const w = Math.max(1, Number(wRaw) || 16);
    const h = Math.max(1, Number(hRaw) || 9);
    return { w, h, value: w / h };
}

function getPreviewStageRect() {
    const stage = eq('preview-stage');
    if (!stage) return null;
    return stage.getBoundingClientRect();
}

function getExportTextScale() {
    const stageRect = getPreviewStageRect();
    const canvas = editorState.exportCanvas;
    if (!stageRect || !canvas || !stageRect.width || !stageRect.height) return 1;
    return Math.min(canvas.width / stageRect.width, canvas.height / stageRect.height);
}

function getPreviewMediaSize(seg) {
    if (!seg) return null;
    if (seg._mediaW && seg._mediaH) return { w: seg._mediaW, h: seg._mediaH };
    const media = seg.mediaId ? editorState.mediaItems.find(m => m.id === seg.mediaId) : null;
    if (media?.width && media?.height) {
        seg._mediaW = media.width;
        seg._mediaH = media.height;
        return { w: seg._mediaW, h: seg._mediaH };
    }
    const layers = eq('preview-layers');
    const el = layers?.querySelector(`.preview-layer[data-seg-id="${seg.id}"]`);
    if (!el) return null;
    if (seg.mediaType === 'text') {
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        if (!w || !h) return null;
        seg._mediaW = w;
        seg._mediaH = h;
        return { w, h };
    }
    const isImage = seg.mediaType === 'image';
    const w = isImage ? el.naturalWidth : el.videoWidth;
    const h = isImage ? el.naturalHeight : el.videoHeight;
    if (!w || !h) return null;
    seg._mediaW = w;
    seg._mediaH = h;
    if (media) {
        media.width = w;
        media.height = h;
    }
    return { w, h };
}

function getPreviewContentMetrics(seg, stageRect, nx, ny, scaleOverride) {
    const mediaSize = getPreviewMediaSize(seg);
    if (!mediaSize || !stageRect) return null;
    const baseScale = seg.mediaType === 'text'
        ? 1
        : Math.min(stageRect.width / mediaSize.w, stageRect.height / mediaSize.h);
    const scale = baseScale * (scaleOverride ?? seg.transform?.scale ?? 1);
    const dw = mediaSize.w * scale;
    const dh = mediaSize.h * scale;
    const left = (stageRect.width - dw) / 2 + nx * stageRect.width;
    const right = left + dw;
    const top = (stageRect.height - dh) / 2 + ny * stageRect.height;
    const bottom = top + dh;
    return { dw, dh, left, right, top, bottom };
}

function getSegmentTransform(seg) {
    if (!seg) return { x: 0, y: 0, scale: 1 };
    if (!seg.transform) seg.transform = { x: 0, y: 0, scale: 1 };
    return seg.transform;
}

function applyPreviewTransform(seg) {
    const stageRect = getPreviewStageRect();
    if (!stageRect) return;
    const layers = eq('preview-layers');
    const target = layers?.querySelector(`.preview-layer[data-seg-id="${seg?.id}"]`);
    if (!target) return;
    const t = getSegmentTransform(seg);
    const transitionState = getTransitionVisualState(seg, editorState.currentTime || 0);
    const tx = (t.x + transitionState.x) * stageRect.width;
    const ty = (t.y + transitionState.y) * stageRect.height;
    const scale = (t.scale || 1) * (transitionState.scale || 1);
    if (seg?.mediaType === 'text') {
        target.style.transform = `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(${scale})`;
    } else {
        target.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    }
    target.style.filter = transitionState.filter || 'none';
    if (seg?.id === editorState.previewSegId) updatePreviewScaleHandle();
}

function getActivePreviewSegment() {
    const id = editorState.previewSegId;
    if (!id) return null;
    for (const track of editorState.tracks) {
        const seg = track.segments.find(s => s.id === id);
        if (seg) return seg;
    }
    return null;
}

function getActiveVideoSegmentsAtTime(t) {
    const layers = [];
    editorState.tracks.forEach((track, trackIndex) => {
        if (track.type !== 'video' && track.type !== 'text') return;
        track.segments.forEach(seg => {
            if (seg.mediaType !== 'video' && seg.mediaType !== 'image' && seg.mediaType !== 'text') return;
            if (t < seg.start || t >= seg.start + seg.duration) return;
            layers.push({ seg, trackIndex });
        });
    });
    return layers;
}

function getPreviewLayerStackAtPoint(x, y) {
    return document.elementsFromPoint(x, y)
        .filter(el => el.classList?.contains('preview-layer'))
        .map(el => el.dataset.segId)
        .filter(Boolean);
}

function getActiveEffectSegmentsAtTime(t) {
    const active = [];
    editorState.tracks.forEach(track => {
        if (track.type !== 'effect') return;
        track.segments.forEach(seg => {
            if (seg.mediaType !== 'effect') return;
            if (t < seg.start || t >= seg.start + seg.duration) return;
            active.push(seg);
        });
    });
    return active;
}

function clearPreviewEffectVars(stage) {
    EFFECT_CSS_VAR_NAMES.forEach(name => stage.style.removeProperty(name));
}

function applyPreviewEffectParams(stage, seg) {
    const key = seg.effectKey || '';
    const params = normalizeEffectParams(key, seg.effectParams);
    seg.effectParams = params;
    if (key === 'zoom-punch') {
        stage.style.setProperty('--fx-zoom-scale', String(1 + params.strength));
    }
    if (key === 'glitch') {
        stage.style.setProperty('--fx-glitch-shift', `${params.shift}px`);
        stage.style.setProperty('--fx-glitch-contrast', String(params.contrast));
    }
    if (key === 'vhs') {
        stage.style.setProperty('--fx-vhs-saturation', String(params.saturation));
        stage.style.setProperty('--fx-vhs-scanlines', String(params.scanlines));
    }
    if (key === 'blur-in') {
        stage.style.setProperty('--fx-blur-max', `${params.amount}px`);
    }
    if (key === 'aesthetic-weekend') {
        stage.style.setProperty('--fx-aw-warmth', String(params.warmth));
        stage.style.setProperty('--fx-aw-wash', String(params.wash));
    }
    if (key === 'retro-glow') {
        stage.style.setProperty('--fx-rg-sepia', String(params.sepia));
        stage.style.setProperty('--fx-rg-glow', String(params.glow));
    }
    if (key === 'cozy') {
        stage.style.setProperty('--fx-cozy-warmth', String(params.warmth));
        stage.style.setProperty('--fx-cozy-softness', String(params.softness));
    }
    if (key === 'brew') {
        stage.style.setProperty('--fx-brew-roast', String(params.roast));
        stage.style.setProperty('--fx-brew-shade', String(params.shade));
    }
    if (key === 'tonal') {
        stage.style.setProperty('--fx-tonal-mono', String(params.mono));
        stage.style.setProperty('--fx-tonal-contrast', String(params.contrast));
    }
    if (key === 'beach') {
        stage.style.setProperty('--fx-beach-vibrance', String(params.vibrance));
        stage.style.setProperty('--fx-beach-sunlight', String(params.sunlight));
    }
    if (key === 'color-bomb') {
        stage.style.setProperty('--fx-cb-saturation', String(params.saturation));
        stage.style.setProperty('--fx-cb-burst', String(params.burst));
    }
    if (key === 'vintage-film') {
        stage.style.setProperty('--fx-vf-age', String(params.age));
        stage.style.setProperty('--fx-vf-grain', String(params.grain));
    }
    if (key === 'nd3-angel') {
        stage.style.setProperty('--fx-angel-halo', String(params.halo));
        stage.style.setProperty('--fx-angel-softness', `${params.softness}px`);
    }
}

function updatePreviewEffects(t) {
    const stage = eq('preview-stage');
    if (!stage) return;
    const classes = [
        'effect-zoom-punch',
        'effect-glitch',
        'effect-vhs',
        'effect-blur-in',
        'effect-aesthetic-weekend',
        'effect-retro-glow',
        'effect-cozy',
        'effect-brew',
        'effect-tonal',
        'effect-beach',
        'effect-color-bomb',
        'effect-vintage-film',
        'effect-nd3-angel',
    ];
    classes.forEach(c => stage.classList.remove(c));
    clearPreviewEffectVars(stage);
    if (!editorState.playing) return;
    const active = getActiveEffectSegmentsAtTime(t);
    if (!active.length) return;
    active.forEach(seg => {
        const key = seg.effectKey || '';
        applyPreviewEffectParams(stage, seg);
        if (key === 'zoom-punch') stage.classList.add('effect-zoom-punch');
        if (key === 'glitch') stage.classList.add('effect-glitch');
        if (key === 'vhs') stage.classList.add('effect-vhs');
        if (key === 'blur-in') stage.classList.add('effect-blur-in');
        if (key === 'aesthetic-weekend') stage.classList.add('effect-aesthetic-weekend');
        if (key === 'retro-glow') stage.classList.add('effect-retro-glow');
        if (key === 'cozy') stage.classList.add('effect-cozy');
        if (key === 'brew') stage.classList.add('effect-brew');
        if (key === 'tonal') stage.classList.add('effect-tonal');
        if (key === 'beach') stage.classList.add('effect-beach');
        if (key === 'color-bomb') stage.classList.add('effect-color-bomb');
        if (key === 'vintage-film') stage.classList.add('effect-vintage-film');
        if (key === 'nd3-angel') stage.classList.add('effect-nd3-angel');
    });
}

function updatePreviewSelection() {
    document.querySelectorAll('.preview-layer').forEach(el => {
        const segId = el.dataset.segId;
        const isSelected = isSegmentSelected(segId);
        el.classList.toggle('selected', isSelected);
    });
    updatePreviewScaleHandle();
}

function ensurePreviewScaleHandle() {
    const stage = eq('preview-stage');
    if (!stage) return null;
    let handle = document.getElementById('preview-scale-handle');
    if (!handle) {
        handle = document.createElement('div');
        handle.id = 'preview-scale-handle';
        handle.className = 'preview-scale-handle';
        stage.appendChild(handle);
    }
    return handle;
}

function updatePreviewScaleHandle() {
    const stage = eq('preview-stage');
    if (!stage) return;
    const handle = ensurePreviewScaleHandle();
    if (!handle) return;
    const seg = getActivePreviewSegment();
    if (!seg || (seg.mediaType !== 'video' && seg.mediaType !== 'image')) {
        handle.classList.remove('visible');
        return;
    }
    const rect = stage.getBoundingClientRect();
    const t = getSegmentTransform(seg);
    const metrics = getPreviewContentMetrics(seg, rect, t.x, t.y, t.scale);
    if (!metrics) {
        handle.classList.remove('visible');
        return;
    }
    const size = 14;
    handle.style.width = `${size}px`;
    handle.style.height = `${size}px`;
    handle.style.left = `${metrics.right - size / 2}px`;
    handle.style.top = `${metrics.bottom - size / 2}px`;
    handle.classList.add('visible');
}

function renderPreviewLayers(layers, t) {
    const container = eq('preview-layers');
    if (!container) return;
    const activeIds = new Set();
    const audibleVideoSegId = layers
        .filter(layer => layer.seg.mediaType === 'video' && !layer.seg.muted)
        .sort((a, b) => a.trackIndex - b.trackIndex)[0]?.seg.id || null;
    layers.forEach(layer => {
        const seg = layer.seg;
        const isVideo = seg.mediaType === 'video';
        const isText = seg.mediaType === 'text';
        let el = container.querySelector(`.preview-layer[data-seg-id="${seg.id}"]`);
        if (!el) {
            el = document.createElement(isText ? 'div' : isVideo ? 'video' : 'img');
            el.className = `preview-layer ${isText ? 'preview-layer-text' : isVideo ? 'preview-layer-video' : 'preview-layer-image'}`;
            el.dataset.segId = seg.id;
            el.draggable = false;
            el.addEventListener('dragstart', e => e.preventDefault());
            if (isVideo) {
                el.muted = true;
                el.playsInline = true;
                el.preload = 'auto';
                if (!el.dataset.metaHooked) {
                    el.dataset.metaHooked = '1';
                    const syncPreviewVideoFrame = () => {
                        const targetTime = Number(el.dataset.previewTime || '0');
                        if (Number.isNaN(targetTime)) return;
                        if (Math.abs((el.currentTime || 0) - targetTime) > 0.12) {
                            try { el.currentTime = targetTime; } catch { }
                        }
                        if (editorState.playing) {
                            if (el.paused) el.play().catch(() => { });
                        } else if (!el.paused) {
                            el.pause();
                        }
                    };
                    el.addEventListener('loadedmetadata', () => {
                        if (el.videoWidth && el.videoHeight) {
                            seg._mediaW = el.videoWidth;
                            seg._mediaH = el.videoHeight;
                        }
                        syncPreviewVideoFrame();
                    });
                    el.addEventListener('loadeddata', () => {
                        syncPreviewVideoFrame();
                    });
                }
                el.addEventListener('error', async () => {
                    if (el.dataset.errorHandled === '1') return;
                    el.dataset.errorHandled = '1';
                    const mediaId = seg.mediaId;
                    if (mediaId) {
                        ensureEditorMediaCache(mediaId, 'video');
                    }
                });
            } else if (isText) {
                applyTextLayerStyle(seg, el);
                if (!el.dataset.textBound) {
                    el.dataset.textBound = '1';
                    el.addEventListener('contextmenu', e => {
                        e.preventDefault();
                        e.stopPropagation();
                        showTextStyleMenu(e.clientX, e.clientY, seg);
                    });
                }
            }
            container.appendChild(el);
        }

        if (!isVideo && !isText && !el.dataset.metaHooked) {
            el.dataset.metaHooked = '1';
            el.addEventListener('load', () => {
                if (el.naturalWidth && el.naturalHeight) {
                    seg._mediaW = el.naturalWidth;
                    seg._mediaH = el.naturalHeight;
                }
            });
        }

        activeIds.add(seg.id);
        el.classList.toggle('selected', isSegmentSelected(seg.id));
        el.style.zIndex = String(1000 - layer.trackIndex);
        el.style.opacity = String(getTransitionOpacity(seg, t));

        const src = isText ? '' : getEditorMediaPlaybackSrc(seg);
        if (!isText && !src && seg.mediaId) {
            ensureEditorMediaCache(seg.mediaId, seg.mediaType);
        }
        if (!isText && src && el.dataset.src !== src) {
            el.dataset.src = src;
            el.src = src;
            if (isVideo) {
                try { el.load(); } catch { }
            }
        } else if (isVideo && !src && el.dataset.src) {
            delete el.dataset.src;
            el.removeAttribute('src');
            try { el.load(); } catch { }
        }

        const media = seg.mediaId ? editorState.mediaItems.find(m => m.id === seg.mediaId) : null;
        if (isVideo) {
            const shouldPlayAudio = editorState.playing && seg.id === audibleVideoSegId && !seg.muted;
            el.muted = !shouldPlayAudio;
            el.volume = shouldPlayAudio ? 1 : 0;
            if (el.videoWidth && el.videoHeight) {
                seg._mediaW = el.videoWidth;
                seg._mediaH = el.videoHeight;
                if (media) {
                    media.width = el.videoWidth;
                    media.height = el.videoHeight;
                }
            }
        } else if (!isText && el.complete && el.naturalWidth && el.naturalHeight) {
            seg._mediaW = el.naturalWidth;
            seg._mediaH = el.naturalHeight;
            if (media) {
                media.width = el.naturalWidth;
                media.height = el.naturalHeight;
            }
        }

        if (isText) {
            if (el.dataset.editing !== '1') {
                applyTextLayerStyle(seg, el);
                if (el.offsetWidth && el.offsetHeight) {
                    seg._mediaW = el.offsetWidth;
                    seg._mediaH = el.offsetHeight;
                }
            }
        }

        if (isVideo) {
            const segTime = Math.max(0, Math.min(seg.duration || Infinity, t - seg.start));
            el.dataset.previewTime = String(segTime);
            if (!Number.isNaN(segTime) && el.readyState >= 1 && Math.abs(el.currentTime - segTime) > 0.12) {
                try { el.currentTime = segTime; } catch { }
            }
            if (editorState.playing) {
                if (el.paused) el.play().catch(() => { });
            } else if (!el.paused) {
                el.pause();
            }
        }

        applyPreviewTransform(seg);
    });

    container.querySelectorAll('.preview-layer').forEach(el => {
        if (!activeIds.has(el.dataset.segId)) el.remove();
    });
}

function clearPreviewLayers() {
    const container = eq('preview-layers');
    if (!container) return;
    container.querySelectorAll('.preview-layer').forEach(el => el.remove());
}

function initPreviewTransformControls() {
    const stage = eq('preview-stage');
    if (!stage) return;
    const updateHoverState = e => {
        if (!stage) return;
        if (editorState.previewDrag) return;
        if (e?.target?.closest?.('.preview-scale-handle')) {
            stage.classList.add('preview-over-media');
            return;
        }
        const seg = getActivePreviewSegment();
        if (!seg) {
            stage.classList.remove('preview-over-media');
            return;
        }
        const stageRect = stage.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        let inside = false;
        if (seg.mediaType === 'text') {
            const el = document.querySelector(`.preview-layer[data-seg-id="${seg.id}"]`);
            const rect = el?.getBoundingClientRect();
            if (rect) {
                inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
            }
        } else {
            const t = getSegmentTransform(seg);
            const metrics = getPreviewContentMetrics(seg, stageRect, t.x, t.y, t.scale);
            if (metrics) {
                const left = stageRect.left + metrics.left;
                const right = stageRect.left + metrics.right;
                const top = stageRect.top + metrics.top;
                const bottom = stageRect.top + metrics.bottom;
                inside = x >= left && x <= right && y >= top && y <= bottom;
            }
        }
        stage.classList.toggle('preview-over-media', inside);
    };

    stage.addEventListener('pointerdown', e => {
        if (editorState.previewDrag) {
            editorState.previewDrag = null;
            stage.classList.remove('dragging');
        }
        const layerStack = getPreviewLayerStackAtPoint(e.clientX, e.clientY);
        const hitId = layerStack[0] || null;
        const hit = hitId ? document.querySelector(`.preview-layer[data-seg-id="${hitId}"]`) : null;
        const isHandle = !!e.target.closest('.text-resize-handle');
        const isScaleHandle = !!e.target.closest('.preview-scale-handle');
        if (hit?.classList?.contains('preview-layer-text') && hit.dataset.editing === '1' && !isHandle) {
            return;
        }
        const active = getActiveVideoSegmentsAtTime(editorState.currentTime || 0);
        let targetId = null;
        if (layerStack.length > 1) {
            const currentIdx = layerStack.indexOf(editorState.previewSegId);
            targetId = layerStack[(currentIdx + 1 + layerStack.length) % layerStack.length];
        } else if (layerStack.length === 1) {
            targetId = layerStack[0];
        } else {
            const selectedActive = active.find(l => isSegmentSelected(l.seg.id));
            targetId = selectedActive?.seg.id || null;
        }
        if (targetId) {
            editorState.previewSegId = targetId;
            document.querySelectorAll('.tl-segment').forEach(s => {
                s.classList.toggle('selected', isSegmentSelected(s.dataset.segId) || s.dataset.segId === targetId);
            });
            updatePreviewSelection();
        }
        const seg = getActivePreviewSegment();
        if (!seg || (seg.mediaType !== 'video' && seg.mediaType !== 'image' && seg.mediaType !== 'text')) return;
        if (e.button !== 0) return;
        if (seg.mediaType === 'video' || seg.mediaType === 'image') {
            const el = document.querySelector(`.preview-layer[data-seg-id="${seg.id}"]`);
            const rect = el?.getBoundingClientRect();
            if (rect) {
                const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
                if (!inside && !isScaleHandle) return;
            }
        }
        e.preventDefault();
        const rect = stage.getBoundingClientRect();
        const t = getSegmentTransform(seg);
        const isTitleText = seg.mediaType === 'text' && seg.presetKey === 'title';
        const allowShiftScale = seg.mediaType === 'text' || seg.mediaType === 'video' || seg.mediaType === 'image';
        editorState.previewDrag = {
            id: seg.id,
            mode: isTitleText ? 'move' : (isHandle ? 'resize-text' : (isScaleHandle ? 'scale' : (allowShiftScale && e.shiftKey ? 'scale' : 'move'))),
            startX: e.clientX,
            startY: e.clientY,
            baseX: t.x,
            baseY: t.y,
            baseScale: t.scale,
            baseBoxW: seg.boxW ?? null,
            baseBoxH: seg.boxH ?? null,
            rect,
            moved: false,
            hitEl: isHandle ? null : (hit || null),
            wasEditing: hit?.dataset?.editing === '1',
            pointerId: e.pointerId,
        };
        stage.setPointerCapture(e.pointerId);
        stage.classList.add('dragging');
    });

    stage.addEventListener('dblclick', () => {
        const seg = getActivePreviewSegment();
        if (!seg) return;
        seg.transform = { x: 0, y: 0, scale: 1 };
        applyPreviewTransform(seg);
    });

    stage.addEventListener('pointermove', e => {
        const drag = editorState.previewDrag;
        if (!drag) return;
        const seg = getActivePreviewSegment();
        if (!seg || seg.id !== drag.id) return;
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (!drag.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) drag.moved = true;
        const snapPx = 10;
        const edgeSnapPx = 20;
        const snapX = snapPx / drag.rect.width;
        const snapY = snapPx / drag.rect.height;
        if (drag.mode === 'resize-text') {
            if (seg.presetKey === 'title') return;
            const minSize = 40;
            const nextW = Math.max(minSize, (drag.baseBoxW ?? seg._mediaW ?? 140) + dx);
            const nextH = Math.max(minSize, (drag.baseBoxH ?? seg._mediaH ?? 48) + dy);
            const maxW = drag.rect.width * 0.92;
            const maxH = drag.rect.height * 0.92;
            seg.boxW = Math.min(nextW, maxW);
            seg.boxH = Math.min(nextH, maxH);
            seg._mediaW = null;
            seg._mediaH = null;
            applyTextLayerStyle(seg, document.querySelector(`.preview-layer[data-seg-id="${seg.id}"]`));
            applyPreviewTransform(seg);
            return;
        }
        if (drag.mode === 'scale' && seg.presetKey === 'title') return;
        if (drag.mode === 'move') {
            let nx = drag.baseX + dx / drag.rect.width;
            let ny = drag.baseY + dy / drag.rect.height;
            let snapCenterV = false;
            let snapCenterH = false;
            let snapQuarterV = null;
            let snapQuarterH = null;
            let snapEdgeLeft = false;
            let snapEdgeRight = false;
            let snapEdgeTop = false;
            let snapEdgeBottom = false;
            const vTargets = [
                { v: 0, key: 'center' },
                { v: -0.25, key: 'q1' },
                { v: 0.25, key: 'q3' },
            ];
            const hTargets = [
                { v: 0, key: 'center' },
                { v: -0.25, key: 'q1' },
                { v: 0.25, key: 'q3' },
            ];
            const vSnap = vTargets.reduce((best, t) => {
                const d = Math.abs(nx - t.v);
                if (d <= snapX && (!best || d < best.d)) return { d, t };
                return best;
            }, null);
            if (vSnap) {
                nx = vSnap.t.v;
                snapCenterV = vSnap.t.key === 'center';
                snapQuarterV = vSnap.t.key !== 'center' ? vSnap.t.key : null;
            }
            const hSnap = hTargets.reduce((best, t) => {
                const d = Math.abs(ny - t.v);
                if (d <= snapY && (!best || d < best.d)) return { d, t };
                return best;
            }, null);
            if (hSnap) {
                ny = hSnap.t.v;
                snapCenterH = hSnap.t.key === 'center';
                snapQuarterH = hSnap.t.key !== 'center' ? hSnap.t.key : null;
            }
            const scale = seg.transform?.scale || 1;
            const metrics = getPreviewContentMetrics(seg, drag.rect, nx, ny, scale);
            if (metrics) {
                const snapNxLeftA = (metrics.dw - drag.rect.width) / (2 * drag.rect.width);
                const snapNxRightA = (drag.rect.width - metrics.dw) / (2 * drag.rect.width);
                const snapNyTopA = (metrics.dh - drag.rect.height) / (2 * drag.rect.height);
                const snapNyBottomA = (drag.rect.height - metrics.dh) / (2 * drag.rect.height);

                const leftA = metrics.left;
                const rightA = drag.rect.width - metrics.right;
                const topA = metrics.top;
                const bottomA = drag.rect.height - metrics.bottom;

                const leftB = (drag.rect.width - metrics.dw) / 2 + nx * drag.rect.width * scale;
                const rightB = drag.rect.width - (leftB + metrics.dw);
                const topB = (drag.rect.height - metrics.dh) / 2 + ny * drag.rect.height * scale;
                const bottomB = drag.rect.height - (topB + metrics.dh);

                const snapNxLeftB = scale !== 0 ? (metrics.dw - drag.rect.width) / (2 * drag.rect.width * scale) : snapNxLeftA;
                const snapNxRightB = scale !== 0 ? (drag.rect.width - metrics.dw) / (2 * drag.rect.width * scale) : snapNxRightA;
                const snapNyTopB = scale !== 0 ? (metrics.dh - drag.rect.height) / (2 * drag.rect.height * scale) : snapNyTopA;
                const snapNyBottomB = scale !== 0 ? (drag.rect.height - metrics.dh) / (2 * drag.rect.height * scale) : snapNyBottomA;

                if (Math.min(Math.abs(leftA), Math.abs(leftB)) <= edgeSnapPx) {
                    nx = Math.abs(leftA) <= Math.abs(leftB) ? snapNxLeftA : snapNxLeftB;
                    snapEdgeLeft = true;
                } else if (Math.min(Math.abs(rightA), Math.abs(rightB)) <= edgeSnapPx) {
                    nx = Math.abs(rightA) <= Math.abs(rightB) ? snapNxRightA : snapNxRightB;
                    snapEdgeRight = true;
                }
                if (Math.min(Math.abs(topA), Math.abs(topB)) <= edgeSnapPx) {
                    ny = Math.abs(topA) <= Math.abs(topB) ? snapNyTopA : snapNyTopB;
                    snapEdgeTop = true;
                } else if (Math.min(Math.abs(bottomA), Math.abs(bottomB)) <= edgeSnapPx) {
                    ny = Math.abs(bottomA) <= Math.abs(bottomB) ? snapNyBottomA : snapNyBottomB;
                    snapEdgeBottom = true;
                }
            }
            seg.transform = { ...seg.transform, x: nx, y: ny };
            if (previewGuideV) previewGuideV.classList.toggle('active', snapCenterV);
            if (previewGuideH) previewGuideH.classList.toggle('active', snapCenterH);
            if (previewGuideVQ1) previewGuideVQ1.classList.toggle('active', snapQuarterV === 'q1');
            if (previewGuideVQ3) previewGuideVQ3.classList.toggle('active', snapQuarterV === 'q3');
            if (previewGuideHQ1) previewGuideHQ1.classList.toggle('active', snapQuarterH === 'q1');
            if (previewGuideHQ3) previewGuideHQ3.classList.toggle('active', snapQuarterH === 'q3');
            if (previewGuideLeft) previewGuideLeft.classList.toggle('active', snapEdgeLeft);
            if (previewGuideRight) previewGuideRight.classList.toggle('active', snapEdgeRight);
            if (previewGuideTop) previewGuideTop.classList.toggle('active', snapEdgeTop);
            if (previewGuideBottom) previewGuideBottom.classList.toggle('active', snapEdgeBottom);
        } else {
            const next = drag.baseScale * (1 - dy * 0.005);
            let clamped = Math.max(0.2, Math.min(5, next));
            let snapEdgeLeft = false;
            let snapEdgeRight = false;
            let snapEdgeTop = false;
            let snapEdgeBottom = false;
            const nx = drag.baseX;
            const ny = drag.baseY;
            let metrics = getPreviewContentMetrics(seg, drag.rect, nx, ny, clamped);
            if (metrics) {
                const candidates = [];
                const leftDist = metrics.left;
                const rightDist = drag.rect.width - metrics.right;
                const topDist = metrics.top;
                const bottomDist = drag.rect.height - metrics.bottom;
                if (Math.abs(leftDist) <= edgeSnapPx && metrics.dw > 0) {
                    const desiredDw = drag.rect.width * (1 + 2 * nx);
                    if (desiredDw > 0) {
                        candidates.push({ edge: 'left', scale: clamped * (desiredDw / metrics.dw) });
                    }
                }
                if (Math.abs(rightDist) <= edgeSnapPx && metrics.dw > 0) {
                    const desiredDw = drag.rect.width * (1 - 2 * nx);
                    if (desiredDw > 0) {
                        candidates.push({ edge: 'right', scale: clamped * (desiredDw / metrics.dw) });
                    }
                }
                if (Math.abs(topDist) <= edgeSnapPx && metrics.dh > 0) {
                    const desiredDh = drag.rect.height * (1 + 2 * ny);
                    if (desiredDh > 0) {
                        candidates.push({ edge: 'top', scale: clamped * (desiredDh / metrics.dh) });
                    }
                }
                if (Math.abs(bottomDist) <= edgeSnapPx && metrics.dh > 0) {
                    const desiredDh = drag.rect.height * (1 - 2 * ny);
                    if (desiredDh > 0) {
                        candidates.push({ edge: 'bottom', scale: clamped * (desiredDh / metrics.dh) });
                    }
                }
                if (candidates.length) {
                    let chosen = null;
                    candidates.forEach(c => {
                        const s = Math.max(0.2, Math.min(5, c.scale));
                        const delta = Math.abs(s - clamped);
                        if (!chosen || delta < chosen.delta) {
                            chosen = { edge: c.edge, scale: s, delta };
                        }
                    });
                    if (chosen) {
                        clamped = chosen.scale;
                        metrics = getPreviewContentMetrics(seg, drag.rect, nx, ny, clamped);
                        snapEdgeLeft = chosen.edge === 'left';
                        snapEdgeRight = chosen.edge === 'right';
                        snapEdgeTop = chosen.edge === 'top';
                        snapEdgeBottom = chosen.edge === 'bottom';
                    }
                }
            }
            seg.transform = { ...seg.transform, scale: clamped };
            if (previewGuideV) previewGuideV.classList.remove('active');
            if (previewGuideH) previewGuideH.classList.remove('active');
            if (previewGuideVQ1) previewGuideVQ1.classList.remove('active');
            if (previewGuideVQ3) previewGuideVQ3.classList.remove('active');
            if (previewGuideHQ1) previewGuideHQ1.classList.remove('active');
            if (previewGuideHQ3) previewGuideHQ3.classList.remove('active');
            if (previewGuideLeft) previewGuideLeft.classList.toggle('active', snapEdgeLeft);
            if (previewGuideRight) previewGuideRight.classList.toggle('active', snapEdgeRight);
            if (previewGuideTop) previewGuideTop.classList.toggle('active', snapEdgeTop);
            if (previewGuideBottom) previewGuideBottom.classList.toggle('active', snapEdgeBottom);
        }
        applyPreviewTransform(seg);
        updatePreviewScaleHandle();
    });

    const endDrag = e => {
        if (!editorState.previewDrag) return;
        const drag = editorState.previewDrag;
        const seg = drag?.id ? getActivePreviewSegment() : null;
        editorState.previewDrag = null;
        stage.classList.remove('dragging');
        if (previewGuideV) previewGuideV.classList.remove('active');
        if (previewGuideH) previewGuideH.classList.remove('active');
        if (previewGuideVQ1) previewGuideVQ1.classList.remove('active');
        if (previewGuideVQ3) previewGuideVQ3.classList.remove('active');
        if (previewGuideHQ1) previewGuideHQ1.classList.remove('active');
        if (previewGuideHQ3) previewGuideHQ3.classList.remove('active');
        if (previewGuideLeft) previewGuideLeft.classList.remove('active');
        if (previewGuideRight) previewGuideRight.classList.remove('active');
        if (previewGuideTop) previewGuideTop.classList.remove('active');
        if (previewGuideBottom) previewGuideBottom.classList.remove('active');
        if (drag && !drag.moved && drag.hitEl && seg?.mediaType === 'text' && drag.mode !== 'resize-text') {
            startTextEdit(seg, drag.hitEl);
        }
        if (drag?.wasEditing && seg?.mediaType === 'text') {
            const el = document.querySelector(`.preview-layer[data-seg-id="${seg.id}"]`);
            const content = el?.querySelector('.text-content');
            if (content) content.focus();
        }
        const pid = drag?.pointerId ?? e?.pointerId;
        try { if (pid != null) stage.releasePointerCapture(pid); } catch { }
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    window.addEventListener('pointerup', endDrag, true);
    window.addEventListener('blur', endDrag);

    stage.addEventListener('pointermove', updateHoverState);
    stage.addEventListener('pointerleave', () => stage.classList.remove('preview-over-media'));

    window.addEventListener('resize', () => {
        applyPreviewRatio();
        const layers = getActiveVideoSegmentsAtTime(editorState.currentTime || 0);
        layers.forEach(layer => applyPreviewTransform(layer.seg));
    });
}

function getNextVideoSegment(t) {
    let next = null;
    for (const track of editorState.tracks) {
        if (track.type !== 'video') continue;
        for (const seg of track.segments) {
            if (seg.mediaType !== 'video') continue;
            if (seg.start <= t) continue;
            if (!next || seg.start < next.start) next = seg;
        }
    }
    return next;
}

function prefetchVideoSegment(seg) {
    if (!seg || seg.mediaType !== 'video') return;
    if (editorState.prefetchedSegs.has(seg.id)) return;
    const media = seg.mediaId ? editorState.mediaItems.find(m => m.id === seg.mediaId) : null;
    if (!media?.id) return;
    editorState.prefetchedSegs.add(seg.id);
    if (window.ensureVideoCached) window.ensureVideoCached(media.id, { silent: true });
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
    const generated = (window.state?.jobs || [])
        .filter(j => j.status === 'succeeded' && j.videoUrl);
    generated.forEach(job => {
        upsertGeneratedVideoInEditor(job, { render: false });
    });
    editorState.mediaItems.forEach(ensureMediaDimensions);
    renderMediaList();
    syncGeneratedMediaFromDB();
}
window.syncMediaLibrary = syncMediaLibrary;

function upsertGeneratedMediaItem(media) {
    if (!media?.id) return null;
    const existing = editorState.mediaItems.find(m => m.id === media.id);
    if (existing) {
        Object.assign(existing, media);
        existing.source = 'generated';
        return existing;
    }
    const item = { ...media, source: 'generated' };
    editorState.mediaItems.push(item);
    return item;
}

function upsertGeneratedVideoInEditor(job, { render = true } = {}) {
    if (!job?.id) return null;
    const cachedSrc = getCachedEditorVideoSrc(job.id);
    const item = upsertGeneratedMediaItem({
        id: job.id,
        name: (job.prompt || 'Generated Video').slice(0, 30),
        src: cachedSrc || '',
        proxySrc: cachedSrc || '',
        thumbDataUrl: job.thumbDataUrl || null,
        thumbDisabled: !!job.thumbDisabled,
        type: 'video',
        duration: job.duration || 5,
    });
    editorState.tracks.forEach(t => {
        t.segments.forEach(s => {
            if (cachedSrc && s.mediaId === job.id && s.src !== cachedSrc) s.src = cachedSrc;
        });
    });
    if (!cachedSrc) ensureEditorVideoCache(job.id);
    if (item) ensureMediaDimensions(item);
    if (render) renderMediaList();
    return item;
}

let generatedMediaSyncPromise = null;
async function syncGeneratedMediaFromDB() {
    if (!window.dbGetAll || !window.db) return;
    if (generatedMediaSyncPromise) return generatedMediaSyncPromise;
    generatedMediaSyncPromise = (async () => {
        try {
            if (typeof ensureDBReady === 'function') await ensureDBReady();
        } catch {
        }
        let changed = false;
        try {
            const [images, audio] = await Promise.all([
                window.dbGetAll('images').catch(() => []),
                window.dbGetAll('audio').catch(() => []),
            ]);
            images.forEach(record => {
                if (!record || !record.id) return;
                const src = record.blob ? URL.createObjectURL(record.blob) : (isEditorCachedSrc(record.blobUrl) ? record.blobUrl : '');
                if (!src) {
                    ensureEditorMediaCache(record.id, 'image');
                    return;
                }
                upsertGeneratedMediaItem({
                    id: record.id,
                    name: (record.prompt || 'Generated Image').slice(0, 30),
                    src,
                    type: 'image',
                    duration: record.duration || 2,
                });
                changed = true;
            });
            audio.forEach(record => {
                if (!record || !record.id) return;
                const src = record.blob ? URL.createObjectURL(record.blob) : (isEditorCachedSrc(record.blobUrl) ? record.blobUrl : '');
                if (!src) {
                    ensureEditorMediaCache(record.id, 'audio');
                    return;
                }
                upsertGeneratedMediaItem({
                    id: record.id,
                    name: (record.prompt || 'Generated Audio').slice(0, 30),
                    src,
                    thumbDataUrl: record.thumbDataUrl || null,
                    type: 'audio',
                    duration: record.duration || 10,
                });
                changed = true;
            });
        } catch {
        }
        if (changed) renderMediaList();
    })();
    await generatedMediaSyncPromise;
    generatedMediaSyncPromise = null;
}

window.addGeneratedVideoToEditor = function addGeneratedVideoToEditor(record) {
    if (!record || !record.id) return;
    upsertGeneratedVideoInEditor(record);
};

window.addGeneratedImageToEditor = function addGeneratedImageToEditor(record) {
    if (!record || !record.id) return;
    const src = record.blob ? URL.createObjectURL(record.blob) : (isEditorCachedSrc(record.blobUrl) ? record.blobUrl : '');
    if (!src) {
        if (window.ensureImageCached) {
            window.ensureImageCached(record.id, { silent: true }).then(cachedSrc => {
                if (!cachedSrc) return;
                upsertGeneratedMediaItem({
                    id: record.id,
                    name: (record.prompt || 'Generated Image').slice(0, 30),
                    src: cachedSrc,
                    type: 'image',
                    duration: record.duration || 2,
                });
                renderMediaList();
            }).catch(() => {});
        }
        return;
    }
    upsertGeneratedMediaItem({
        id: record.id,
        name: (record.prompt || 'Generated Image').slice(0, 30),
        src,
        type: 'image',
        duration: record.duration || 2,
    });
    renderMediaList();
};

window.addGeneratedAudioToEditor = function addGeneratedAudioToEditor(record) {
    if (!record || !record.id) return;
    const src = record.blob ? URL.createObjectURL(record.blob) : (isEditorCachedSrc(record.blobUrl) ? record.blobUrl : '');
    if (!src) {
        if (window.ensureAudioCached) {
            window.ensureAudioCached(record.id, { silent: true }).then(cachedSrc => {
                if (!cachedSrc) return;
                upsertGeneratedMediaItem({
                    id: record.id,
                    name: (record.prompt || 'Generated Audio').slice(0, 30),
                    src: cachedSrc,
                    thumbDataUrl: record.thumbDataUrl || null,
                    type: 'audio',
                    duration: record.duration || 10,
                });
                renderMediaList();
            }).catch(() => {});
        }
        return;
    }
    upsertGeneratedMediaItem({
        id: record.id,
        name: (record.prompt || 'Generated Audio').slice(0, 30),
        src,
        thumbDataUrl: record.thumbDataUrl || null,
        type: 'audio',
        duration: record.duration || 10,
    });
    renderMediaList();
};

window.removeMediaItemById = function removeMediaItemById(id) {
    if (!id) return;
    const before = editorState.mediaItems.length;
    editorState.mediaItems = editorState.mediaItems.filter(m => m.id !== id);
    if (editorState.mediaItems.length === before) return;
    editorState.tracks.forEach(t => {
        t.segments = t.segments.filter(s => s.mediaId !== id);
    });
    renderMediaList();
    renderTimeline();
};

function initGeneratedMediaTabs() {
    const tabs = document.querySelectorAll('.media-section-tab[data-media-tab]');
    if (!tabs.length) return;
    tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.mediaTab;
            setGeneratedMediaTab(tab);
        });
    });
    setGeneratedMediaTab(editorState.generatedMediaTab || 'video', { silent: true });
}

function setGeneratedMediaTab(tab, { silent = false } = {}) {
    editorState.generatedMediaTab = tab;
    const tabs = document.querySelectorAll('.media-section-tab[data-media-tab]');
    tabs.forEach(btn => btn.classList.toggle('active', btn.dataset.mediaTab === tab));
    if (!silent) renderMediaList();
}

function hasGeneratedMediaThumbnail(media) {
    if (!media || media.source !== 'generated') return true;
    if (media.type === 'video' || media.type === 'audio') return !!media.thumbDataUrl;
    if (media.type === 'image') return !!getEditorMediaPlaybackSrc(media);
    return true;
}

function renderMediaList() {
    const genVideoEl = eq('media-generated-video');
    const genImageEl = eq('media-generated-image');
    const genAudioEl = eq('media-generated-audio');
    const upEl = eq('media-uploads');
    const genInfo = eq('media-gen-info');
    const genPrev = eq('media-gen-prev');
    const genNext = eq('media-gen-next');
    editorState.mediaItems.forEach(m => {
        if (m.source) return;
        if (String(m.id || '').startsWith('upload-')) m.source = 'upload';
        else if (String(m.id || '').startsWith('test-')) m.source = 'generated';
        else if (m.type === 'text') m.source = 'text';
        else if (m.type === 'effect') m.source = 'effect';
        else m.source = m.type === 'audio' ? 'upload' : 'generated';
    });
    const uploads = editorState.mediaItems.filter(m => m.source === 'upload');
    const generated = editorState.mediaItems.filter(m => m.source === 'generated' && hasGeneratedMediaThumbnail(m));
    const generatedVideos = generated.filter(m => m.type === 'video');
    const generatedImages = generated.filter(m => m.type === 'image');
    const generatedAudio = generated.filter(m => m.type === 'audio');

    editorState.mediaItems.forEach(ensureMediaDimensions);
    renderTextItems();
    renderEffectItems();

    const activeTab = editorState.generatedMediaTab || 'video';
    const activeList = activeTab === 'image' ? generatedImages : activeTab === 'audio' ? generatedAudio : generatedVideos;
    eq('media-gen-count').textContent = activeList.length;
    eq('media-up-count').textContent = uploads.length;

    const visibleGenerated = activeList;
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

    if (genVideoEl) genVideoEl.classList.toggle('hidden', activeTab !== 'video');
    if (genImageEl) genImageEl.classList.toggle('hidden', activeTab !== 'image');
    if (genAudioEl) genAudioEl.classList.toggle('hidden', activeTab !== 'audio');

    const emptyVideo = '<div class="media-empty-hint">Generate videos in the Generate tab to see them here</div>';
    const emptyImage = '<div class="media-empty-hint">Generate images in the Images tab to see them here</div>';
    const emptyAudio = '<div class="media-empty-hint">Generate audio in the Audio tab to see them here</div>';
    const html = totalGenerated === 0
        ? (activeTab === 'image' ? emptyImage : activeTab === 'audio' ? emptyAudio : emptyVideo)
        : pagedGenerated.map(m => mediaItemHTML(m, { compact: true })).join('');
    if (activeTab === 'image' && genImageEl) genImageEl.innerHTML = html;
    if (activeTab === 'audio' && genAudioEl) genAudioEl.innerHTML = html;
    if (activeTab === 'video' && genVideoEl) genVideoEl.innerHTML = html;

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
        v.addEventListener('error', () => {
            const mediaId = v.closest('.media-item')?.dataset?.mid;
            if (mediaId) ensureEditorMediaCache(mediaId, 'video');
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

const mediaForbiddenChecks = new Map();

async function removeMediaIfForbidden(mediaId, src) {
    if (!mediaId || !src) return;
    if (mediaForbiddenChecks.has(mediaId)) return;
    mediaForbiddenChecks.set(mediaId, true);
    try {
        const isProxy = src.includes('/api/video?url=');
        if (!isProxy) return;
        const res = await fetch(src, {
            method: 'GET',
            cache: 'no-store',
            headers: { Range: 'bytes=0-0' },
        });
        if (res.status !== 403) return;
        editorState.mediaItems = editorState.mediaItems.filter(m => m.id !== mediaId);
        editorState.tracks.forEach(t => {
            t.segments = t.segments.filter(s => s.mediaId !== mediaId);
        });
        renderMediaList();
        renderTimeline();
        showToast('Removed a video that returned 403', 'info', '🧹');
    } catch {
    }
}

function mediaItemHTML(m, { compact = false } = {}) {
    const videoIcon = `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/><polygon points="10,8 10,16 17,12" fill="currentColor" opacity="0.8"/></svg>`;
    const audioIcon = `<svg viewBox="0 0 24 24" fill="none"><path d="M9 18V5L21 3V16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="1.5"/></svg>`;
    const textIcon = `<svg viewBox="0 0 24 24" fill="none"><path d="M4 6H20M12 6V20M7 20H17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
    const effectIcon = `<svg viewBox="0 0 24 24" fill="none"><path d="M4 12H20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><circle cx="16" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/></svg>`;

    const compactClass = compact ? ' compact' : '';
    const info = compact ? '' : `
      <div class="media-info">
        <div class="media-name">${escH(m.name)}</div>
        <div class="media-meta">${m.type.toUpperCase()} • ${formatDur(m.duration || 0)}</div>
      </div>`;

    if (m.type === 'effect') {
        return `
        <div class="media-item${compactClass}" data-mid="${m.id}">
          ${info || `<div class="media-info"><div class="media-name">${escH(m.name)}</div></div>`}
        </div>`;
    }

    let thumbInner = `<div class="media-thumb-icon">${m.type === 'video' ? videoIcon : m.type === 'audio' ? audioIcon : m.type === 'effect' ? effectIcon : textIcon}</div>`;
    const localSrc = getEditorMediaPlaybackSrc(m);
    if (compact && m.type === 'video' && m.thumbDataUrl) {
        const safeThumb = escH(m.thumbDataUrl);
        thumbInner = `<img src="${safeThumb}" alt="${escH(m.name)}" />`;
    } else if (compact && m.type === 'audio' && m.thumbDataUrl) {
        const [accentA, accentB] = getAudioThumbPalette(m.id || m.name || 'audio');
        const thumbStyle = `background-image: linear-gradient(180deg, rgba(7, 10, 18, 0.08), rgba(7, 10, 18, 0.3)), url('${escH(m.thumbDataUrl)}'); background-size: cover; background-position: center;`;
        const equalizerBars = Array.from({ length: 18 }, (_, idx) =>
            `<span class="media-thumb-audio-bar b${(idx % 5) + 1}"></span>`).join('');
        thumbInner = `
                <div class="media-thumb-audio-cover" style="--audio-accent-a:${accentA}; --audio-accent-b:${accentB}; ${thumbStyle}">
                    <div class="media-thumb-audio-eq" aria-hidden="true">${equalizerBars}</div>
                    <div class="media-thumb-audio-name">${escH(m.name || 'Generated Audio')}</div>
                </div>`;
    }
    if (localSrc) {
        if (m.type === 'video') {
            if (!compact) {
                const safeSrc = escH(localSrc);
                thumbInner = `<video src="${safeSrc}#t=0.1" preload="metadata" muted playsinline></video>`;
            }
        } else if (m.type === 'image') {
            const safeSrc = escH(localSrc);
            thumbInner = `<img src="${safeSrc}" alt="${escH(m.name)}" />`;
        } else if (m.type === 'audio' && compact && !m.thumbDataUrl) {
            const [accentA, accentB] = getAudioThumbPalette(m.id || m.name || 'audio');
            const thumbStyle = m.thumbDataUrl
                ? `background-image: linear-gradient(180deg, rgba(7, 10, 18, 0.08), rgba(7, 10, 18, 0.3)), url('${escH(m.thumbDataUrl)}'); background-size: cover; background-position: center;`
                : '';
            const equalizerBars = Array.from({ length: 18 }, (_, idx) =>
                `<span class="media-thumb-audio-bar b${(idx % 5) + 1}"></span>`).join('');
            thumbInner = `
                <div class="media-thumb-audio-cover" style="--audio-accent-a:${accentA}; --audio-accent-b:${accentB}; ${thumbStyle}">
                    <div class="media-thumb-audio-eq" aria-hidden="true">${equalizerBars}</div>
                    <div class="media-thumb-audio-name">${escH(m.name || 'Generated Audio')}</div>
                </div>`;
        }
    }
    return `
    <div class="media-item${compactClass}" data-mid="${m.id}">
      <div class="media-thumb">${thumbInner}</div>
      ${info}
    </div>`;
}

function getAudioThumbPalette(seedValue) {
    const text = String(seedValue || 'audio');
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    const baseHue = Math.abs(hash) % 360;
    const nextHue = (baseHue + 42 + (Math.abs(hash) % 37)) % 360;
    return [
        `hsl(${baseHue} 68% 52%)`,
        `hsl(${nextHue} 72% 44%)`,
    ];
}

function setCompactAudioPlaybackState(activeId) {
    document.querySelectorAll('.media-item.compact[data-mid]').forEach(el => {
        el.classList.toggle('is-playing', !!activeId && el.dataset.mid === activeId);
    });
}

async function previewMediaItem(id) {
    const item = editorState.mediaItems.find(m => m.id === id);
    if (!item) return;

    // Stop all other playing thumbnails
    document.querySelectorAll('.media-thumb video').forEach(v => v.pause());
    if (!previewMediaItem._audioMap) previewMediaItem._audioMap = new Map();
    const existingAudio = previewMediaItem._audioMap.get(item.id);
    const wasPlaying = item.type === 'audio'
        && existingAudio
        && !existingAudio.paused
        && !existingAudio.ended;
    previewMediaItem._audioMap.forEach(a => { try { a.pause(); } catch { } });
    previewMediaItem._activeAudioId = null;
    setCompactAudioPlaybackState(null);

    if (item.type === 'audio') {
        let audioSrc = getEditorMediaPlaybackSrc(item);
        if (!audioSrc && item.id) {
            ensureEditorMediaCache(item.id, 'audio');
            return;
        }
        let aud = previewMediaItem._audioMap.get(item.id);
        if (!aud) {
            aud = new Audio(audioSrc);
            aud.preload = 'metadata';
            aud.addEventListener('ended', () => {
                if (previewMediaItem._activeAudioId === item.id) {
                    previewMediaItem._activeAudioId = null;
                    setCompactAudioPlaybackState(null);
                }
            });
            previewMediaItem._audioMap.set(item.id, aud);
        } else if (aud.src !== audioSrc) {
            aud.src = audioSrc;
        }
        if (wasPlaying) {
            aud.currentTime = 0;
            return;
        }
        aud.currentTime = 0;
        aud.play().then(() => {
            previewMediaItem._activeAudioId = item.id;
            setCompactAudioPlaybackState(item.id);
        }).catch(() => {});
        return;
    }

    if (item.type !== 'video') return;
    if (!getEditorMediaPlaybackSrc(item) && item.id) {
        ensureEditorMediaCache(item.id, 'video');
        return;
    }

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

async function encodeProjectBlob(project) {
    const json = JSON.stringify(project);
    if (typeof CompressionStream !== 'undefined') {
        const cs = new CompressionStream('gzip');
        const stream = new Blob([json], { type: 'application/json' }).stream().pipeThrough(cs);
        return await new Response(stream).blob();
    }
    return new Blob([json], { type: 'application/json' });
}

async function decodeProjectFile(file) {
    const isSvs = (file?.name || '').toLowerCase().endsWith('.svs');
    if (isSvs && typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('gzip');
        const stream = file.stream().pipeThrough(ds);
        const text = await new Response(stream).text();
        return JSON.parse(text);
    }
    const text = await file.text();
    try {
        return JSON.parse(text);
    } catch {
        if (isSvs) {
            throw new Error('This browser cannot open compressed .svs files. Use Chrome/Edge or server mode.');
        }
        throw new Error('Invalid project file');
    }
}

function canUseProjectServer() {
    return typeof location !== 'undefined' && location.protocol !== 'file:';
}

async function saveProjectToServer(project, preferredName = null) {
    if (!canUseProjectServer()) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = preferredName || `vibedstudio-${stamp}.svs`;
    try {
        const resp = await fetch('/api/project/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, project }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } catch {
        return null;
    }
}

function triggerProjectLoad() {
    ensureProjectFileInputBound();
    const input = eq('project-file-input');
    if (!input) {
        showToast('Project loader unavailable', 'error', '❌');
        return;
    }
    input.click();
}

function ensureProjectFileInputBound() {
    const input = eq('project-file-input');
    if (!input || input.dataset.bound === '1') return;
    input.dataset.bound = '1';
    input.addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (file) {
            showToast('Loading project…', 'info', '⏳');
            loadProject(file).catch(err => {
                console.error('Load project failed:', err);
                showToast(`Load failed: ${err?.message || err}`, 'error', '❌');
            });
        }
        e.target.value = '';
    });
}

async function collectVideoHistory(maxBlobSize) {
    if (!window.dbGetAll || !window.db) return [];
    try {
        const records = await window.dbGetAll('videos');
        if (!records || !records.length) return [];
        const items = [];
        for (const r of records) {
            const entry = {
                id: r.id,
                status: r.status,
                videoUrl: r.videoUrl || null,
                thumbDataUrl: r.thumbDataUrl || null,
                thumbDisabled: !!r.thumbDisabled,
                draft: !!r.draft,
                mode: r.mode || null,
                draftTaskId: r.draftTaskId || null,
                promptText: r.promptText || '',
                imageDataUrl: r.imageDataUrl || null,
                firstFrameDataUrl: r.firstFrameDataUrl || null,
                lastFrameDataUrl: r.lastFrameDataUrl || null,
                referenceImages: Array.isArray(r.referenceImages) ? r.referenceImages : [],
                generateAudio: !!r.generateAudio,
                prompt: r.prompt || '',
                model: r.model || null,
                ratio: r.ratio || null,
                duration: r.duration || null,
                resolution: r.resolution || null,
                returnLastFrame: !!r.returnLastFrame,
                serviceTier: r.serviceTier || null,
                tokensUsed: r.tokensUsed ?? null,
                tokensEstimate: r.tokensEstimate ?? null,
                lastFrameUrl: r.lastFrameUrl || null,
                cameraFixed: !!r.cameraFixed,
                seed: r.seed ?? null,
                timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp || null,
            };
            if (r.videoBlob instanceof Blob) {
                if (!maxBlobSize || r.videoBlob.size <= maxBlobSize) {
                    try {
                        entry.videoBlobBase64 = await blobToDataUrl(r.videoBlob);
                    } catch {
                        entry.videoBlobSkipped = true;
                    }
                } else {
                    entry.videoBlobSkipped = true;
                    entry.videoBlobSize = r.videoBlob.size;
                }
            }
            items.push(entry);
        }
        return items;
    } catch {
        return [];
    }
}

async function clearVideoHistoryStore() {
    if (!window.db) return;
    try {
        const tx = window.db.transaction('videos', 'readwrite');
        tx.objectStore('videos').clear();
        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } catch {
    }
}

async function collectImageHistory(maxBlobSize) {
    if (!window.dbGetAll || !window.db) return [];
    try {
        const records = await window.dbGetAll('images');
        if (!records || !records.length) return [];
        const items = [];
        for (const r of records) {
            const entry = {
                id: r.id,
                url: r.url || null,
                prompt: r.prompt || '',
                model: r.model || null,
                size: r.size || null,
                format: r.format || null,
                timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp || null,
            };
            if (r.blob instanceof Blob) {
                if (!maxBlobSize || r.blob.size <= maxBlobSize) {
                    try {
                        entry.blobBase64 = await blobToDataUrl(r.blob);
                    } catch {
                        entry.blobSkipped = true;
                    }
                } else {
                    entry.blobSkipped = true;
                    entry.blobSize = r.blob.size;
                }
            }
            items.push(entry);
        }
        return items;
    } catch {
        return [];
    }
}

async function clearImageHistoryStore() {
    if (!window.db) return;
    try {
        const tx = window.db.transaction('images', 'readwrite');
        tx.objectStore('images').clear();
        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } catch {
    }
}

async function collectAudioHistory(maxBlobSize) {
    if (!window.dbGetAll || !window.db) return [];
    try {
        const records = await window.dbGetAll('audio');
        if (!records || !records.length) return [];
        const items = [];
        for (const r of records) {
            const entry = {
                id: r.id,
                url: r.url || null,
                prompt: r.prompt || '',
                lyrics: r.lyrics || '',
                tags: Array.isArray(r.tags) ? r.tags : [],
                model: r.model || null,
                format: r.format || null,
                bitrate: r.bitrate || null,
                duration: r.duration || null,
                timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp || null,
            };
            if (r.blob instanceof Blob) {
                if (!maxBlobSize || r.blob.size <= maxBlobSize) {
                    try {
                        entry.blobBase64 = await blobToDataUrl(r.blob);
                    } catch {
                        entry.blobSkipped = true;
                    }
                } else {
                    entry.blobSkipped = true;
                    entry.blobSize = r.blob.size;
                }
            }
            items.push(entry);
        }
        return items;
    } catch {
        return [];
    }
}

async function clearAudioHistoryStore() {
    if (!window.db) return;
    try {
        const tx = window.db.transaction('audio', 'readwrite');
        tx.objectStore('audio').clear();
        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } catch {
    }
}

async function saveProject({ autosave = false, silent = false } = {}) {
    if (autosave && (!canAutosaveProject() || editorState.projectAutosaveBusy)) return false;
    if (autosave) editorState.projectAutosaveBusy = true;
    const defaultName = `vibedstudio-project-${new Date().toISOString().replace(/[:.]/g, '-')}.svs`;
    let pickedFileHandle = null;
    const needsInteractiveFilePick = !autosave
        && !editorState.projectSaveTarget
        && typeof window.showSaveFilePicker === 'function';

    if (needsInteractiveFilePick) {
        try {
            pickedFileHandle = await window.showSaveFilePicker({
                suggestedName: defaultName,
                types: [{
                    description: 'VibedStudio Project',
                    accept: { 'application/octet-stream': ['.svs'] },
                }],
            });
        } catch (err) {
            if (err && err.name === 'AbortError') return false;
        }
    }

    const maxInlineSize = 12 * 1024 * 1024; // 12MB per asset
    const maxCachedVideoSize = 80 * 1024 * 1024; // 80MB for cached videos
    const maxHistoryVideoSize = 80 * 1024 * 1024; // 80MB per history video
    const maxHistoryImageSize = 25 * 1024 * 1024; // 25MB per history image
    const maxHistoryAudioSize = 25 * 1024 * 1024; // 25MB per history audio
    let cachedVideoMap = new Map();
    if (window.dbGetAll && window.db) {
        try {
            const records = await window.dbGetAll('videos');
            cachedVideoMap = new Map(
                (records || [])
                    .filter(r => r?.videoBlob instanceof Blob && r?.id)
                    .map(r => [r.id, r.videoBlob])
            );
        } catch {
        }
    }
    const mediaItems = await Promise.all(editorState.mediaItems.map(async m => {
        const item = {
            id: m.id,
            name: m.name,
            type: m.type,
            duration: m.duration,
            source: m.source,
            src: m.src || null,
            text: m.text || null,
            fontFamily: m.fontFamily || null,
            fontSize: m.fontSize || null,
            fontWeight: m.fontWeight || null,
            fontStyle: m.fontStyle || null,
            color: m.color || null,
            align: m.align || null,
            bgColor: m.bgColor || null,
            padding: m.padding ?? null,
            lineHeight: m.lineHeight || null,
            letterSpacing: m.letterSpacing ?? null,
            underline: m.underline ?? null,
            effectKey: m.effectKey || null,
            effectParams: cloneEffectParams(m.effectParams),
            presetKey: m.presetKey || null,
            boxW: m.boxW ?? null,
            boxH: m.boxH ?? null,
        };
        if (m.type === 'video' && cachedVideoMap.has(m.id)) {
            const cachedBlob = cachedVideoMap.get(m.id);
            if (cachedBlob && cachedBlob.size <= maxCachedVideoSize) {
                try {
                    item.cachedVideoDataUrl = await blobToDataUrl(cachedBlob);
                } catch {
                    item.cachedVideoSkipped = true;
                }
            } else if (cachedBlob) {
                item.cachedVideoSkipped = true;
                item.cachedVideoSize = cachedBlob.size;
            }
        }
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
        apiKey: (window.state?.apiKey || localStorage.getItem('vibedstudio_api_key') || ''),
        openaiApiKey: (window.state?.openaiApiKey || localStorage.getItem('vibedstudio_openai_api_key') || ''),
        sonautoApiKey: (window.state?.sonautoApiKey || localStorage.getItem('vibedstudio_sonauto_api_key') || ''),
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
                transform: s.transform || null,
                text: s.text || null,
                fontFamily: s.fontFamily || null,
                fontSize: s.fontSize || null,
                fontWeight: s.fontWeight || null,
                fontStyle: s.fontStyle || null,
                color: s.color || null,
                align: s.align || null,
                bgColor: s.bgColor || null,
                padding: s.padding ?? null,
                lineHeight: s.lineHeight || null,
                letterSpacing: s.letterSpacing ?? null,
                underline: s.underline ?? null,
                effectKey: s.effectKey || null,
                effectParams: cloneEffectParams(s.effectParams),
                presetKey: s.presetKey || null,
                boxW: s.boxW ?? null,
                boxH: s.boxH ?? null,
            })),
        })),
        transitions: editorState.transitions,
        mediaItems,
    };
    const history = await collectVideoHistory(maxHistoryVideoSize);
    if (history.length) project.videoHistory = history;
    const imageHistory = await collectImageHistory(maxHistoryImageSize);
    if (imageHistory.length) project.imageHistory = imageHistory;
    const audioHistory = await collectAudioHistory(maxHistoryAudioSize);
    if (audioHistory.length) project.audioHistory = audioHistory;

    if (window.state) {
        const textPromptEl = document.getElementById('text-prompt');
        const imagePromptEl = document.getElementById('image-prompt');
        const refPrompt = typeof getReferencePromptText === 'function' ? getReferencePromptText() : '';
        const imgPromptEl = document.getElementById('img-prompt');
        const imgModel = document.querySelector('#img-model-grid .model-card.selected')?.dataset?.model || null;
        const imgSize = document.querySelector('.img-size-btn.selected')?.dataset?.size || null;
        const imgFormat = document.querySelector('.img-format-btn.selected')?.dataset?.format || null;
        const imageState = typeof window.getImageGeneratorState === 'function'
            ? window.getImageGeneratorState()
            : {
                model: imgModel,
                size: imgSize,
                format: imgFormat,
                promptText: imgPromptEl?.value || '',
            };
        const audioState = typeof window.getAudioGeneratorState === 'function'
            ? window.getAudioGeneratorState()
            : null;
        project.generatorState = {
            video: {
                model: window.state.model,
                ratio: window.state.ratio,
                duration: window.state.duration,
                resolution: window.state.resolution,
                returnLastFrame: window.state.returnLastFrame,
                serviceTier: window.state.serviceTier,
                generateAudio: window.state.generateAudio,
                cameraFixed: window.state.cameraFixed,
                seed: window.state.seed,
                draft: window.state.draft,
                mode: window.state.mode,
                imageDataUrl: window.state.imageDataUrl || null,
                firstFrameDataUrl: window.state.firstFrameDataUrl || null,
                lastFrameDataUrl: window.state.lastFrameDataUrl || null,
                referenceImages: Array.isArray(window.state.referenceImages) ? window.state.referenceImages : [],
                promptText: textPromptEl?.value || '',
                imagePromptText: imagePromptEl?.value || '',
                referencePromptText: refPrompt || '',
            },
            image: imageState,
            audio: audioState,
        };
    }

    const blob = await encodeProjectBlob(project);

    const saveToFileHandle = async handle => {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
    };

    try {
        if (editorState.projectSaveTarget?.kind === 'file' && editorState.projectSaveTarget.handle) {
            await saveToFileHandle(editorState.projectSaveTarget.handle);
            if (!silent) showToast(autosave ? 'Project autosaved' : 'Project saved', 'success', '💾');
            return true;
        }

        if (editorState.projectSaveTarget?.kind === 'server' && editorState.projectSaveTarget.name) {
            const serverRes = await saveProjectToServer(project, editorState.projectSaveTarget.name);
            if (serverRes?.ok) {
                setProjectSaveTarget({ kind: 'server', name: serverRes.name || editorState.projectSaveTarget.name });
                if (!silent) showToast(autosave ? `Project autosaved: ${serverRes.name}` : `Project saved: ${serverRes.name}`, 'success', '💾');
                return true;
            }
            if (autosave) {
                if (!silent) showToast('Project autosave failed', 'error', '❌');
                return false;
            }
        }

        if (pickedFileHandle) {
            await saveToFileHandle(pickedFileHandle);
            setProjectSaveTarget({ kind: 'file', handle: pickedFileHandle, name: pickedFileHandle.name || defaultName });
            if (!silent) showToast('Project saved', 'success', '💾');
            return true;
        }

        if (typeof window.showSaveFilePicker === 'function' && !autosave) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: defaultName,
                    types: [{
                        description: 'VibedStudio Project',
                        accept: { 'application/octet-stream': ['.svs'] },
                    }],
                });
                await saveToFileHandle(handle);
                setProjectSaveTarget({ kind: 'file', handle, name: handle.name || defaultName });
                if (!silent) showToast('Project saved', 'success', '💾');
                return true;
            } catch (err) {
                if (err && err.name === 'AbortError') return false;
            }
        }

        const serverRes = await saveProjectToServer(project);
        if (serverRes?.ok) {
            setProjectSaveTarget({ kind: 'server', name: serverRes.name });
            if (!silent) showToast(`${autosave ? 'Project autosaved' : 'Project saved'}: ${serverRes.name}`, 'success', '💾');
            return true;
        }

        if (autosave) {
            if (!silent) showToast('Project autosave unavailable for download-only saves', 'error', '❌');
            return false;
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setProjectSaveTarget(null);
        if (!silent) showToast('Project saved (downloaded .svs)', 'success', '💾');
        return true;
    } finally {
        if (autosave) editorState.projectAutosaveBusy = false;
        updateProjectAutosaveUI();
    }
}

async function applyProjectData(data) {
    if (!data || !Array.isArray(data.tracks) || !Array.isArray(data.mediaItems)) {
        showToast('Project file missing required data', 'error', '❌');
        return;
    }

    if (data.apiKey !== undefined) {
        const apiKey = String(data.apiKey || '').trim();
        const apiInput = eq('api-key');
        if (apiInput) {
            apiInput.value = apiKey;
            apiInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        localStorage.setItem('vibedstudio_api_key', apiKey);
        if (window.state) window.state.apiKey = apiKey;
        if (typeof window.updateHakDot === 'function') {
            window.updateHakDot();
        }
    }
    if (data.openaiApiKey !== undefined) {
        const openaiKey = String(data.openaiApiKey || '').trim();
        const openaiInput = eq('openai-api-key');
        if (openaiInput) {
            openaiInput.value = openaiKey;
            openaiInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        localStorage.setItem('vibedstudio_openai_api_key', openaiKey);
        if (window.state) window.state.openaiApiKey = openaiKey;
    }
    if (data.sonautoApiKey !== undefined) {
        const sonautoKey = String(data.sonautoApiKey || '').trim();
        const sonautoInput = eq('sonauto-api-key');
        if (sonautoInput) {
            sonautoInput.value = sonautoKey;
            sonautoInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        localStorage.setItem('vibedstudio_sonauto_api_key', sonautoKey);
        if (window.state) window.state.sonautoApiKey = sonautoKey;
    }

    // Rebuild media items
    const cachedVideoBlobs = new Map();
    const mediaItems = data.mediaItems.map(m => {
        let src = m.src || null;
        if (m.cachedVideoDataUrl) {
            try {
                const blob = dataUrlToBlob(m.cachedVideoDataUrl);
                cachedVideoBlobs.set(m.id, blob);
                src = URL.createObjectURL(blob);
            } catch {
            }
        } else if (m.srcDataUrl) {
            try { src = URL.createObjectURL(dataUrlToBlob(m.srcDataUrl)); } catch { }
        }
        return {
            id: m.id,
            name: m.name,
            type: m.type,
            duration: m.duration,
            source: m.source,
            src,
            text: m.text || null,
            fontFamily: m.fontFamily || null,
            fontSize: m.fontSize || null,
            fontWeight: m.fontWeight || null,
            fontStyle: m.fontStyle || null,
            color: m.color || null,
            align: m.align || null,
            bgColor: m.bgColor || null,
            padding: m.padding ?? null,
            lineHeight: m.lineHeight || null,
            letterSpacing: m.letterSpacing ?? null,
            underline: m.underline ?? null,
            effectKey: m.effectKey || null,
            effectParams: cloneEffectParams(m.effectParams),
            presetKey: m.presetKey || null,
            boxW: m.boxW ?? null,
            boxH: m.boxH ?? null,
        };
    });

    editorState.mediaItems = mediaItems.map(m => ({
        ...m,
        proxySrc: maybeProxySrc(m.src),
    }));
    editorState.mediaItems.forEach(m => {
        if (!m.source && m.type === 'text') m.source = 'text';
        if (m.type === 'effect' && m.effectKey) {
            m.effectParams = normalizeEffectParams(m.effectKey, m.effectParams);
        }
    });
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
            transform: s.transform || { x: 0, y: 0, scale: 1 },
            text: s.text || null,
            fontFamily: s.fontFamily || null,
            fontSize: s.fontSize || null,
            fontWeight: s.fontWeight || null,
            fontStyle: s.fontStyle || null,
            color: s.color || null,
            align: s.align || null,
            bgColor: s.bgColor || null,
            padding: s.padding ?? null,
            lineHeight: s.lineHeight || null,
            letterSpacing: s.letterSpacing ?? null,
            underline: s.underline ?? null,
            effectKey: s.effectKey || null,
            effectParams: cloneEffectParams(s.effectParams),
            presetKey: s.presetKey || null,
            boxW: s.boxW ?? null,
            boxH: s.boxH ?? null,
        })),
    }));
    editorState.tracks.forEach(track => {
        track.segments.forEach(seg => {
            if (seg.mediaType === 'effect' && seg.effectKey) {
                seg.effectParams = normalizeEffectParams(seg.effectKey, seg.effectParams);
            }
        });
    });

    if (cachedVideoBlobs.size && window.dbPut && window.db) {
        const timestamp = new Date().toISOString();
        cachedVideoBlobs.forEach((blob, id) => {
            const src = mediaItems.find(m => m.id === id)?.src || null;
            window.dbPut('videos', {
                id,
                status: 'cached',
                videoUrl: src,
                videoBlob: blob,
                duration: mediaItems.find(m => m.id === id)?.duration || null,
                timestamp,
            }).catch(() => {});
        });
    }
    editorState.transitions = Array.isArray(data.transitions) ? data.transitions.map(t => normalizeTransitionData(t)) : [];

    const maxEnd = editorState.tracks.flatMap(t => t.segments).reduce((m, s) => Math.max(m, (s.start || 0) + (s.duration || 0)), 0);
    const baseDur = Math.max(TIMELINE_MIN_SECONDS, maxEnd + TIMELINE_TAIL_SECONDS);
    editorState.timelineDur = Math.max(data.timelineDur || 0, baseDur);
    editorState.pxPerSec = data.pxPerSec || editorState.pxPerSec;
    editorState.currentTime = 0;
    clearSelectedSegments();
    renderMediaList();
    renderTimeline();
    seekTo(0);
    editorState.timelineUndo = [];
    editorState.timelineRedo = [];

    if (Array.isArray(data.videoHistory) && data.videoHistory.length) {
        try {
            if (typeof ensureDBReady === 'function') {
                await ensureDBReady();
            }
            await clearVideoHistoryStore();
            if (window.state) window.state.jobs = [];
            for (const v of data.videoHistory) {
                let blob = null;
                if (v.videoBlobBase64) {
                    try { blob = dataUrlToBlob(v.videoBlobBase64); } catch { blob = null; }
                }
                const record = {
                    id: v.id || `import-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    status: v.status || ((v.videoUrl || blob) ? 'succeeded' : 'failed'),
                    videoUrl: v.videoUrl || null,
                    videoBlob: blob,
                    thumbDataUrl: v.thumbDataUrl || null,
                    thumbDisabled: !!v.thumbDisabled,
                    prompt: v.prompt || '',
                    model: v.model || (window.state?.model || null),
                    ratio: v.ratio || (window.state?.ratio || null),
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
                    referenceImages: Array.isArray(v.referenceImages) ? v.referenceImages : [],
                    generateAudio: !!v.generateAudio,
                    tokensUsed: v.tokensUsed ?? null,
                    tokensEstimate: v.tokensEstimate ?? null,
                    lastFrameUrl: v.lastFrameUrl || null,
                    cameraFixed: !!v.cameraFixed,
                    seed: v.seed ?? null,
                    timestamp: v.timestamp || new Date().toISOString(),
                };
                if (window.dbPut && window.db) await window.dbPut('videos', record).catch(() => {});
                record.timestamp = new Date(record.timestamp);
                if (record.videoBlob) record.videoUrl = URL.createObjectURL(record.videoBlob);
                if (window.state) window.state.jobs.push(record);
            }
            if (typeof renderVideoPage === 'function') renderVideoPage();
            if (typeof updateEmptyState === 'function') updateEmptyState();
            if (window.syncMediaLibrary) window.syncMediaLibrary();
        } catch (e) {
            console.warn('Video history restore failed:', e);
        }
    }

    if (Array.isArray(data.imageHistory) && data.imageHistory.length) {
        try {
            if (typeof ensureDBReady === 'function') {
                await ensureDBReady();
            }
            await clearImageHistoryStore();
            const restored = [];
            for (const img of data.imageHistory) {
                let blob = null;
                if (img.blobBase64) {
                    try { blob = dataUrlToBlob(img.blobBase64); } catch { blob = null; }
                }
                const record = {
                    id: img.id || `import-img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    url: img.url || null,
                    prompt: img.prompt || '',
                    model: img.model || null,
                    size: img.size || null,
                    format: img.format || null,
                    timestamp: img.timestamp || new Date().toISOString(),
                    blob,
                };
                restored.push(record);
                if (window.dbPut && window.db) await window.dbPut('images', record).catch(() => {});
            }
            if (typeof window.applyImageHistory === 'function') {
                window.applyImageHistory(restored);
            } else if (window.initImages) {
                window.initImages();
            }
        } catch (e) {
            console.warn('Image history restore failed:', e);
        }
    }

    if (Array.isArray(data.audioHistory) && data.audioHistory.length) {
        try {
            if (typeof ensureDBReady === 'function') {
                await ensureDBReady();
            }
            await clearAudioHistoryStore();
            const restored = [];
            for (const aud of data.audioHistory) {
                let blob = null;
                if (aud.blobBase64) {
                    try { blob = dataUrlToBlob(aud.blobBase64); } catch { blob = null; }
                }
                const record = {
                    id: aud.id || `import-audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    url: aud.url || null,
                    prompt: aud.prompt || '',
                    lyrics: aud.lyrics || '',
                    tags: Array.isArray(aud.tags) ? aud.tags : [],
                    model: aud.model || null,
                    format: aud.format || null,
                    bitrate: aud.bitrate || null,
                    duration: aud.duration || null,
                    timestamp: aud.timestamp || new Date().toISOString(),
                    blob,
                };
                restored.push(record);
                if (window.dbPut && window.db) await window.dbPut('audio', record).catch(() => {});
            }
            if (typeof window.applyAudioHistory === 'function') {
                window.applyAudioHistory(restored);
            } else if (window.initAudio) {
                window.initAudio();
            }
        } catch (e) {
            console.warn('Audio history restore failed:', e);
        }
    }

    if (data.generatorState && typeof window.applyJobToForm === 'function') {
        const v = data.generatorState.video || {};
        const job = {
            model: v.model,
            ratio: v.ratio,
            duration: v.duration,
            resolution: v.resolution,
            serviceTier: v.serviceTier,
            generateAudio: v.generateAudio,
            returnLastFrame: v.returnLastFrame,
            cameraFixed: v.cameraFixed,
            seed: v.seed,
            draft: v.draft,
            mode: v.mode,
            promptText: v.promptText || v.referencePromptText || v.imagePromptText || '',
            imageDataUrl: v.imageDataUrl || null,
            firstFrameDataUrl: v.firstFrameDataUrl || null,
            lastFrameDataUrl: v.lastFrameDataUrl || null,
            referenceImages: Array.isArray(v.referenceImages) ? v.referenceImages : [],
        };
        window.applyJobToForm(job);
        if (v.referencePromptText && typeof window.setReferencePromptFromText === 'function') {
            window.setReferencePromptFromText(v.referencePromptText);
        }
        if (v.imagePromptText) {
            const imgPromptEl = document.getElementById('image-prompt');
            if (imgPromptEl) imgPromptEl.value = v.imagePromptText;
        }
        if (data.generatorState.image && typeof window.applyImageGeneratorState === 'function') {
            window.applyImageGeneratorState(data.generatorState.image);
        }
        if (data.generatorState.audio && typeof window.applyAudioGeneratorState === 'function') {
            window.applyAudioGeneratorState(data.generatorState.audio);
        }
    }
}

async function loadProject(file) {
    let data;
    try {
        data = await decodeProjectFile(file);
    } catch (err) {
        showToast(err?.message || 'Invalid project file', 'error', '❌');
        return;
    }
    await applyProjectData(data);
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
    if (eq('preview-layers')) {
        updatePreviewForTime(editorState.currentTime);
    }
}

function updateTimelineDur() {
    const maxEnd = getTimelineContentEnd([
        'video',
        'image',
        'text',
        'effect',
    ]);
    const next = maxEnd > 0 ? Math.max(TIMELINE_MIN_SECONDS, maxEnd + TIMELINE_TAIL_SECONDS) : TIMELINE_MIN_SECONDS;
    if (Math.abs(next - editorState.timelineDur) > 0.01) {
        editorState.timelineDur = next;
        if (editorState.currentTime > next) editorState.currentTime = next;
    }
}

function getTimelineContentEnd(mediaTypes = null) {
    return editorState.tracks
        .flatMap(t => t.segments)
        .filter(s => !mediaTypes || mediaTypes.includes(s.mediaType))
        .reduce((maxEnd, seg) => Math.max(maxEnd, (seg.start || 0) + (seg.duration || 0)), 0);
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
        row.addEventListener('mousemove', e => {
            if (track.type !== 'video') {
                row.classList.remove('transition-hotspot');
                return;
            }
            if (e.target.closest('.tl-seg-trim') || e.target.closest('.tl-seg-del') || e.target.closest('.tl-seg-mute-btn')) {
                row.classList.remove('transition-hotspot');
                return;
            }
            const scrollLeft = eq('tl-scroll-area').scrollLeft;
            const rect = row.getBoundingClientRect();
            const t = (e.clientX - rect.left + scrollLeft) / editorState.pxPerSec;
            row.classList.toggle('transition-hotspot', !!findTransitionPair(track, t));
        });
        row.addEventListener('mouseleave', () => {
            row.classList.remove('transition-hotspot');
        });
        row.addEventListener('click', e => {
            if (!e.target.closest('.tl-segment') && !e.target.closest('.tl-transition-hit')) {
                clearSelectedSegments();
                updatePreviewSelection();
                renderTracks();
                return;
            }
            if (track.type !== 'video') return;
            if (e.button !== 0) return;
            if (e.target.closest('.tl-seg-trim') || e.target.closest('.tl-seg-del') || e.target.closest('.tl-seg-mute-btn')) return;
            const scrollLeft = eq('tl-scroll-area').scrollLeft;
            const rect = row.getBoundingClientRect();
            const t = (e.clientX - rect.left + scrollLeft) / editorState.pxPerSec;
            const pair = findTransitionPair(track, t);
            if (!pair) return;
            const existing = getTransitionByPair(pair.left.id, pair.right.id);
            if (existing) return;
            pushTimelineHistory();
            addTransition(pair.left.id, pair.right.id, 'cross-dissolve');
            renderTimeline();
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

function getTimelineSnapPoints(excludeSegId) {
    const points = [0];
    editorState.tracks.forEach(track => {
        track.segments.forEach(seg => {
            if (seg.id === excludeSegId) return;
            points.push(seg.start || 0);
            points.push((seg.start || 0) + (seg.duration || 0));
        });
    });
    return points;
}

function findNearestSnapPoint(time, excludeSegId, minTime = -Infinity, maxTime = Infinity) {
    const snapSec = 12 / editorState.pxPerSec;
    const points = getTimelineSnapPoints(excludeSegId)
        .filter(point => point >= minTime && point <= maxTime);
    let best = null;
    points.forEach(point => {
        const dist = Math.abs(time - point);
        if (best === null || dist < best.dist) best = { dist, point };
    });
    if (best && best.dist <= snapSec) return best.point;
    return null;
}

function getSnapInfo(track, proposedStart, duration, excludeSegId) {
    const point = findNearestSnapPoint(proposedStart, excludeSegId, 0);
    if (point != null) return { snapped: true, start: point };
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
    const snapSec = 28 / editorState.pxPerSec;
    const maxGapSec = 1.0;
    const segs = [...track.segments].sort((a, b) => a.start - b.start);
    for (let i = 0; i < segs.length - 1; i++) {
        const left = segs[i];
        const right = segs[i + 1];
        const boundary = (left.start || 0) + (left.duration || 0);
        const gap = (right.start || 0) - boundary;
        if (gap < 0) continue;
        const nearBoundary = Math.abs(time - boundary) <= snapSec;
        const withinGap = time >= boundary - snapSec * 1.5 && time <= (right.start || 0) + snapSec * 1.5;
        if ((nearBoundary || withinGap) && gap <= maxGapSec) {
            return { left, right };
        }
    }
    return null;
}

function renderTransitionsForTrack(row, track) {
    const px = editorState.pxPerSec;
    const segs = [...track.segments].sort((a, b) => a.start - b.start);
    for (let i = 0; i < segs.length - 1; i += 1) {
        const left = segs[i];
        const right = segs[i + 1];
        const boundary = (left.start || 0) + (left.duration || 0);
        const gap = (right.start || 0) - boundary;
        if (gap < 0 || gap > 1.0) continue;
        const existing = getTransitionByPair(left.id, right.id);
        const hit = document.createElement('div');
        hit.className = `tl-transition-hit${existing ? ' has-transition' : ''}`;
        hit.style.left = (boundary * px) + 'px';
        hit.title = existing
            ? `Transition: ${transitionLabel(existing.type)}`
            : 'Click to add cross dissolve';
        hit.addEventListener('click', e => {
            e.stopPropagation();
            if (existing) return;
            pushTimelineHistory();
            addTransition(left.id, right.id, 'cross-dissolve');
            renderTimeline();
        });
        hit.addEventListener('contextmenu', e => {
            e.preventDefault();
            e.stopPropagation();
            showTransitionMenu(e.clientX, e.clientY, left, right);
        });
        row.appendChild(hit);
        if (!existing) continue;
        const el = document.createElement('div');
        el.className = `tl-transition ${existing.type}`;
        el.title = `Transition: ${transitionLabel(existing.type)}`;
        hit.appendChild(el);
    }
}

function transitionLabel(type) {
    return getTransitionPreset(type).label;
}

function showTransitionMenu(x, y, left, right) {
    hideTransitionMenu();
    hideSegmentMenu();
    let existing = getTransitionByPair(left.id, right.id);
    const menu = document.createElement('div');
    menu.className = 'tl-context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.innerHTML = `
        <div class="tl-context-title">Transition</div>
        <label class="tl-context-label">Preset</label>
        <select data-field="transitionType">
            ${TRANSITION_PRESETS.map(p => `<option value="${p.key}">${p.label}</option>`).join('')}
        </select>
        <div class="tl-context-effect-params"></div>
        ${existing ? '<button class="danger" data-action="remove">Remove Transition</button>' : ''}
    `;
    const historySnapshot = snapshotTimelineState();
    let historyPushed = false;
    const typeEl = menu.querySelector('[data-field="transitionType"]');
    const paramsEl = menu.querySelector('.tl-context-effect-params');
    const pushHistoryOnce = () => {
        if (historyPushed) return;
        pushTimelineHistory(historySnapshot);
        historyPushed = true;
    };
    const ensureTransition = () => {
        if (existing) return existing;
        pushHistoryOnce();
        existing = addTransition(left.id, right.id, 'cross-dissolve');
        return existing;
    };
    const renderParams = () => {
        const transition = existing || { type: typeEl.value, params: getDefaultTransitionParams(typeEl.value) };
        const defs = getTransitionParamDefs(typeEl.value);
        const params = normalizeTransitionParams(typeEl.value, transition.params);
        if (existing) existing.params = params;
        if (!defs.length) {
            paramsEl.innerHTML = '<div class="media-empty-hint">No parameters</div>';
            return;
        }
        paramsEl.innerHTML = defs.map(def => `
            <label class="tl-context-label">${def.label}</label>
            <div class="tl-context-range-row">
                <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${params[def.key]}" data-param="${def.key}" />
                <span class="tl-context-range-value" data-value-for="${def.key}">${params[def.key]}</span>
            </div>
        `).join('');
        paramsEl.querySelectorAll('input[data-param]').forEach(input => {
            const valueEl = paramsEl.querySelector(`[data-value-for="${input.dataset.param}"]`);
            const syncValue = () => {
                const num = Number(input.value);
                valueEl.textContent = Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.00$/, '').replace(/0$/, '');
            };
            syncValue();
            input.addEventListener('input', () => {
                const transitionRef = ensureTransition();
                transitionRef.type = normalizeTransitionType(typeEl.value);
                transitionRef.params = normalizeTransitionParams(transitionRef.type, {
                    ...transitionRef.params,
                    [input.dataset.param]: Number(input.value),
                });
                syncValue();
                updatePreviewForTime(editorState.currentTime || 0);
            });
            input.addEventListener('change', () => {
                renderTimeline();
            });
        });
    };
    const activeType = existing ? existing.type : 'cross-dissolve';
    typeEl.value = activeType;
    renderParams();
    const onTypeChange = () => {
        const transitionRef = ensureTransition();
        pushHistoryOnce();
        transitionRef.type = normalizeTransitionType(typeEl.value);
        transitionRef.params = getDefaultTransitionParams(transitionRef.type);
        renderParams();
        renderTimeline();
    };
    typeEl.addEventListener('input', onTypeChange);
    typeEl.addEventListener('change', onTypeChange);
    const onClick = e => {
        const action = e.target?.dataset?.action;
        if (!action) return;
        if (action === 'remove') {
            pushHistoryOnce();
            removeTransition(left.id, right.id);
            existing = null;
        }
        hideTransitionMenu();
        renderTimeline();
    };
    menu.addEventListener('click', onClick);
    menu.addEventListener('click', e => e.stopPropagation());
    menu.addEventListener('input', e => e.stopPropagation());
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

function showEffectSegmentMenu(x, y, seg) {
    hideSegmentMenu();
    hideTransitionMenu();
    const menu = document.createElement('div');
    menu.className = 'tl-context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.innerHTML = `
        <div class="tl-context-title">Effect</div>
        <label class="tl-context-label">Preset</label>
        <select data-field="effectKey">
            ${EFFECT_PRESETS.map(p => `<option value="${p.key}">${p.name}</option>`).join('')}
        </select>
        <div class="tl-context-effect-params"></div>
        <button data-action="reset">Reset Parameters</button>
        <button class="danger" data-action="remove">Remove Effect</button>
    `;
    const historySnapshot = snapshotTimelineState();
    let historyPushed = false;
    const presetEl = menu.querySelector('[data-field="effectKey"]');
    const paramsEl = menu.querySelector('.tl-context-effect-params');
    const currentPreset = getEffectPreset(seg.effectKey || 'zoom-punch');
    presetEl.value = currentPreset.key;
    seg.effectKey = currentPreset.key;
    seg.name = currentPreset.name;
    seg.effectParams = normalizeEffectParams(currentPreset.key, seg.effectParams);

    const pushHistoryOnce = () => {
        if (historyPushed) return;
        pushTimelineHistory(historySnapshot);
        historyPushed = true;
    };

    const updatePreview = (rerender = false) => {
        if (rerender) renderTimeline();
        updatePreviewForTime(editorState.currentTime || 0);
    };

    const renderParamControls = () => {
        const defs = getEffectParamDefs(seg.effectKey);
        const params = normalizeEffectParams(seg.effectKey, seg.effectParams);
        seg.effectParams = params;
        if (!defs.length) {
            paramsEl.innerHTML = '<div class="media-empty-hint">No parameters</div>';
            return;
        }
        paramsEl.innerHTML = defs.map(def => `
            <label class="tl-context-label">${def.label}</label>
            <div class="tl-context-range-row">
                <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${params[def.key]}" data-param="${def.key}" />
                <span class="tl-context-range-value" data-value-for="${def.key}">${params[def.key]}</span>
            </div>
        `).join('');
        paramsEl.querySelectorAll('input[data-param]').forEach(input => {
            const valueEl = paramsEl.querySelector(`[data-value-for="${input.dataset.param}"]`);
            const syncValue = () => {
                const num = Number(input.value);
                valueEl.textContent = Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.00$/, '').replace(/0$/, '');
            };
            syncValue();
            input.addEventListener('input', () => {
                pushHistoryOnce();
                seg.effectParams[input.dataset.param] = Number(input.value);
                syncValue();
                updatePreview(false);
            });
            input.addEventListener('change', () => {
                seg.effectParams[input.dataset.param] = Number(input.value);
                syncValue();
                updatePreview(false);
            });
        });
    };

    renderParamControls();

    const onPresetChange = () => {
        const preset = getEffectPreset(presetEl.value);
        pushHistoryOnce();
        seg.effectKey = preset.key;
        seg.name = preset.name;
        seg.effectParams = getDefaultEffectParams(preset.key);
        renderParamControls();
        updatePreview(true);
    };
    presetEl.addEventListener('input', onPresetChange);
    presetEl.addEventListener('change', onPresetChange);

    const onClick = e => {
        const action = e.target?.dataset?.action;
        if (!action) return;
        if (action === 'reset') {
            pushHistoryOnce();
            seg.effectParams = getDefaultEffectParams(seg.effectKey);
            renderParamControls();
            updatePreview(false);
        }
        if (action === 'remove') {
            pushHistoryOnce();
            const track = findTrackBySegId(seg.id);
            if (track) track.segments = track.segments.filter(s => s.id !== seg.id);
            renderTimeline();
            updatePreviewForTime(editorState.currentTime || 0);
        }
        hideSegmentMenu();
    };
    menu.addEventListener('click', onClick);
    menu.addEventListener('input', e => e.stopPropagation());
    menu.addEventListener('click', e => e.stopPropagation());
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

function showTextStyleMenu(x, y, seg) {
    hideSegmentMenu();
    hideTransitionMenu();
    const menu = document.createElement('div');
    menu.className = 'tl-context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    const fontOptions = [
        'Inter',
        'Arial',
        'Helvetica',
        'Verdana',
        'Trebuchet MS',
        'Georgia',
        'Times New Roman',
        'Garamond',
        'Courier New',
        'Impact',
    ];
    menu.innerHTML = `
        <div class="tl-context-title">Text Style</div>
        <label class="tl-context-label">Font</label>
        <select data-field="fontFamily">
            ${fontOptions.map(f => `<option value="${f}">${f}</option>`).join('')}
        </select>
        <div class="tl-context-row">
            <div>
                <label class="tl-context-label">Size</label>
                <input type="number" min="8" max="300" step="1" data-field="fontSize" />
            </div>
            <div>
                <label class="tl-context-label">Color</label>
                <input type="color" data-field="color" />
            </div>
        </div>
        <div class="tl-context-row">
            <div>
                <label class="tl-context-label">Background</label>
                <input type="color" data-field="bgColor" />
            </div>
            <div>
                <label class="tl-context-label">Opacity</label>
                <input type="range" min="0" max="1" step="0.05" data-field="bgOpacity" />
            </div>
        </div>
        <div class="tl-context-row">
            <div>
                <label class="tl-context-label">Align</label>
                <select data-field="align">
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                </select>
            </div>
            <div>
                <label class="tl-context-label">Style</label>
                <div class="tl-context-inline">
                    <label><input type="checkbox" data-field="bold" /> Bold</label>
                    <label><input type="checkbox" data-field="italic" /> Italic</label>
                    <label><input type="checkbox" data-field="underline" /> Underline</label>
                </div>
            </div>
        </div>
    `;

    const style = getTextStyle(seg);
    const fontEl = menu.querySelector('[data-field="fontFamily"]');
    const sizeEl = menu.querySelector('[data-field="fontSize"]');
    const colorEl = menu.querySelector('[data-field="color"]');
    const alignEl = menu.querySelector('[data-field="align"]');
    const boldEl = menu.querySelector('[data-field="bold"]');
    const italicEl = menu.querySelector('[data-field="italic"]');
    const underlineEl = menu.querySelector('[data-field="underline"]');
    const bgEl = menu.querySelector('[data-field="bgColor"]');
    const bgOpacityEl = menu.querySelector('[data-field="bgOpacity"]');

    fontEl.value = fontOptions.includes(style.fontFamily) ? style.fontFamily : 'Inter';
    sizeEl.value = style.fontSize;
    colorEl.value = style.color;
    alignEl.value = style.align;
    boldEl.checked = Number(style.fontWeight) >= 600;
    italicEl.checked = style.fontStyle === 'italic';
    underlineEl.checked = !!style.underline;
    const bgVal = style.bgColor || 'transparent';
    const rgbaMatch = bgVal.match(/rgba?\(([^)]+)\)/i);
    let bgOpacity = 1;
    if (bgVal === 'transparent') {
        bgOpacity = 0;
    } else if (rgbaMatch) {
        const parts = rgbaMatch[1].split(',').map(v => v.trim());
        if (parts.length === 4) bgOpacity = Number(parts[3]) || 0;
    }
    bgOpacityEl.value = String(Math.max(0, Math.min(1, bgOpacity)));
    bgEl.value = bgVal.startsWith('#') ? bgVal : '#000000';

    const applyChanges = (soft = false) => {
        seg.fontFamily = fontEl.value || 'Inter';
        seg.fontSize = Number(sizeEl.value) || 48;
        seg.fontWeight = boldEl.checked ? 700 : 400;
        seg.fontStyle = italicEl.checked ? 'italic' : 'normal';
        seg.underline = !!underlineEl.checked;
        seg.color = colorEl.value || '#ffffff';
        const opacity = Math.max(0, Math.min(1, Number(bgOpacityEl.value)));
        const base = bgEl.value || '#000000';
        const rgb = base.replace('#', '');
        const r = parseInt(rgb.substring(0, 2), 16) || 0;
        const g = parseInt(rgb.substring(2, 4), 16) || 0;
        const b = parseInt(rgb.substring(4, 6), 16) || 0;
        seg.bgColor = opacity === 0 ? 'transparent' : `rgba(${r}, ${g}, ${b}, ${opacity})`;
        seg.align = alignEl.value || 'center';
        seg._mediaW = null;
        seg._mediaH = null;
        if (seg.padding == null) seg.padding = 8;
        if (!seg.lineHeight) seg.lineHeight = 1.1;
        if (seg.letterSpacing == null) seg.letterSpacing = 0;
        applyTextLayerStyle(seg, document.querySelector(`.preview-layer[data-seg-id="${seg.id}"]`));
        applyPreviewTransform(seg);
        if (!soft) renderTimeline();
    };

    [fontEl, sizeEl, colorEl, bgEl, bgOpacityEl, alignEl, boldEl, italicEl, underlineEl].forEach(input => {
        input.addEventListener('input', () => applyChanges(true));
        input.addEventListener('change', () => applyChanges(false));
    });

    menu.addEventListener('click', e => e.stopPropagation());
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

function startTextEdit(seg, el) {
    if (!seg || !el) return;
    if (el.dataset.editing === '1') return;
    el.dataset.editing = '1';
    el.classList.add('text-editing');
    const style = getTextStyle(seg);
    let contentEl = el.querySelector('.text-content');
    if (!contentEl) {
        contentEl = document.createElement('span');
        contentEl.className = 'text-content';
        el.appendChild(contentEl);
    }
    contentEl.contentEditable = 'true';
    contentEl.spellcheck = false;
    contentEl.textContent = style.text;
    contentEl.focus();
    document.execCommand?.('selectAll', false, null);

    const finish = () => {
        contentEl.contentEditable = 'false';
        el.classList.remove('text-editing');
        el.dataset.editing = '0';
        const nextText = contentEl.innerText.replace(/\r\n/g, '\n').trimEnd();
        seg.text = nextText || 'Text';
        seg._mediaW = null;
        seg._mediaH = null;
        const firstLine = seg.text.split('\n')[0].trim();
        seg.name = firstLine ? `Text: ${firstLine.slice(0, 24)}` : 'Text Overlay';
        applyTextLayerStyle(seg, el);
        applyPreviewTransform(seg);
        renderTimeline();
    };

    const onKey = ev => {
        if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
            ev.preventDefault();
            el.blur();
        }
        if (ev.key === 'Escape') {
            ev.preventDefault();
            el.textContent = style.text;
            el.blur();
        }
    };

    contentEl.addEventListener('keydown', onKey, { once: false });
    contentEl.addEventListener('blur', () => {
        contentEl.removeEventListener('keydown', onKey);
        finish();
    }, { once: true });
}

function hidePlayheadMenu() {
    if (editorState.playheadMenuEl) {
        editorState.playheadMenuEl.remove();
        editorState.playheadMenuEl = null;
    }
}

function addTransition(leftId, rightId, type, params = null) {
    const normalized = normalizeTransitionData({ leftId, rightId, type, params });
    const existing = editorState.transitions.find(t => t.leftId === leftId && t.rightId === rightId);
    if (existing) {
        existing.type = normalized.type;
        existing.params = normalized.params;
        return existing;
    }
    const next = {
        id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        leftId,
        rightId,
        type: normalized.type,
        params: normalized.params,
    };
    editorState.transitions.push(next);
    return next;
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

function getSelectedSegment() {
    if (!editorState.selectedSegId) return null;
    for (const t of editorState.tracks) {
        const seg = t.segments.find(s => s.id === editorState.selectedSegId);
        if (seg) return seg;
    }
    return null;
}

function getTrackTypeForMedia(mediaType) {
    if (mediaType === 'audio') return 'audio';
    if (mediaType === 'text') return 'text';
    if (mediaType === 'effect') return 'effect';
    return 'video';
}

function cloneSegmentData(seg) {
    return {
        id: seg.id,
        mediaId: seg.mediaId,
        name: seg.name,
        src: seg.src,
        start: seg.start,
        duration: seg.duration,
        mediaType: seg.mediaType,
        muted: !!seg.muted,
        fadeIn: !!seg.fadeIn,
        fadeOut: !!seg.fadeOut,
        fadeInDur: seg.fadeInDur || null,
        fadeOutDur: seg.fadeOutDur || null,
        thumbDataUrl: seg.thumbDataUrl || null,
        transform: seg.transform ? { ...seg.transform } : { x: 0, y: 0, scale: 1 },
        text: seg.text || null,
        fontFamily: seg.fontFamily || null,
        fontSize: seg.fontSize || null,
        fontWeight: seg.fontWeight || null,
        fontStyle: seg.fontStyle || null,
        color: seg.color || null,
        align: seg.align || null,
        bgColor: seg.bgColor || null,
        padding: seg.padding ?? null,
        lineHeight: seg.lineHeight || null,
        letterSpacing: seg.letterSpacing ?? null,
        underline: !!seg.underline,
        effectKey: seg.effectKey || null,
        effectParams: cloneEffectParams(seg.effectParams),
        presetKey: seg.presetKey || null,
        boxW: seg.boxW ?? null,
        boxH: seg.boxH ?? null,
    };
}

function copySelectedSegment() {
    const seg = getSelectedSegment();
    if (!seg) return false;
    editorState.clipboardSeg = cloneSegmentData(seg);
    const track = findTrackBySegId(seg.id);
    editorState.clipboardTrackId = track?.id || null;
    showToast('Clip copied', 'info', '📋');
    return true;
}

function pasteClipboardSegment() {
    const data = editorState.clipboardSeg;
    if (!data) {
        showToast('Clipboard is empty', 'info', '📋');
        return false;
    }
    const desiredStart = Math.max(0, editorState.currentTime || 0);
    const trackType = getTrackTypeForMedia(data.mediaType);
    const originalTrack = editorState.clipboardTrackId
        ? editorState.tracks.find(t => t.id === editorState.clipboardTrackId)
        : null;
    const candidates = editorState.tracks.filter(t => t.type === trackType);
    const ordered = originalTrack && originalTrack.type === trackType
        ? [originalTrack, ...candidates.filter(t => t.id !== originalTrack.id)]
        : candidates;

    let target = null;
    let start = null;
    for (const t of ordered) {
        const resolved = resolveNonOverlap(t, data.duration || 1, desiredStart, null);
        if (resolved != null) {
            target = t;
            start = resolved;
            break;
        }
    }

    if (!target) {
        const newTrack = addTrack(trackType);
        target = newTrack || editorState.tracks.find(t => t.type === trackType);
        if (target) start = resolveNonOverlap(target, data.duration || 1, desiredStart, null);
    }

    if (!target || start == null) {
        showToast('No space to paste on the timeline', 'error', '⚠️');
        return false;
    }

    pushTimelineHistory();
    const seg = {
        ...data,
        id: 'seg-' + Date.now() + '-' + Math.random().toString(16).slice(2, 6),
        start,
        transform: data.transform ? { ...data.transform } : { x: 0, y: 0, scale: 1 },
    };
    delete seg._mediaW;
    delete seg._mediaH;
    target.segments.push(seg);
    setSelectedSegments([seg.id], seg.id);
    renderTimeline();
    showToast('Clip pasted', 'success', '📋');
    return true;
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
    if (seg.mediaType === 'video' && !seg.thumbDataUrl && seg.mediaId) {
        const media = editorState.mediaItems.find(m => m.id === seg.mediaId);
        if (media?.thumbDataUrl) seg.thumbDataUrl = media.thumbDataUrl;
    }
    const needsLoad = !!seg.src && seg.mediaType === 'image';
    el.className = `tl-segment ${track.type}-seg${seg.muted && isAudio ? ' muted' : ''}${isSegmentSelected(seg.id) ? ' selected' : ''}${fadeInCls}${fadeOutCls}${needsLoad ? ' loading' : ''}`;
    el.dataset.segId = seg.id;
    el.style.left = (seg.start * editorState.pxPerSec) + 'px';
    el.style.width = (seg.duration * editorState.pxPerSec) + 'px';
    if (isAudio) {
        const media = seg.mediaId ? editorState.mediaItems.find(m => m.id === seg.mediaId) : null;
        const [accentA, accentB] = getAudioThumbPalette(media?.id || media?.name || seg.mediaId || seg.name || seg.id || 'audio');
        el.style.background = `linear-gradient(135deg, ${accentA}cc, ${accentB}b3)`;
        el.style.border = `1px solid ${accentA}`;
    }

    const muteIcon = seg.muted
        ? `<svg viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2V15H6L11 19V5Z" fill="currentColor" opacity="0.5"/><path d="M23 9L17 15M17 9L23 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2V15H6L11 19V5Z" fill="currentColor"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

    let segThumb = '';
    if (seg.mediaType === 'video') {
        if (seg.thumbDataUrl) {
            const safeThumb = escH(seg.thumbDataUrl);
            segThumb = `<div class="tl-seg-thumb"><img src="${safeThumb}" alt="" /></div>`;
        } else {
            segThumb = `<div class="tl-seg-thumb tl-seg-thumb-placeholder"></div>`;
        }
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
        const wasMultiSelected = isSegmentSelected(seg.id) && getSelectedSegIds().length > 1;

        if (e.shiftKey) {
            toggleSelectedSegment(seg.id);
            document.querySelectorAll('.tl-segment').forEach(s => {
                s.classList.toggle('selected', isSegmentSelected(s.dataset.segId));
            });
            updatePreviewSelection();
            return;
        } else if (!wasMultiSelected) {
            setSelectedSegments([seg.id], seg.id);
        }
        document.querySelectorAll('.tl-segment').forEach(s => {
            s.classList.toggle('selected', isSegmentSelected(s.dataset.segId));
        });
        updatePreviewSelection();

        const selectedEntries = getSelectedSegments();
        if (selectedEntries.length > 1 && isSegmentSelected(seg.id)) {
            const historySnapshot = snapshotTimelineState();
            const baseStarts = new Map(selectedEntries.map(entry => [entry.seg.id, entry.seg.start || 0]));
            const bounds = getMultiDragBounds(selectedEntries);
            const selectedEls = selectedEntries
                .map(entry => document.querySelector(`.tl-segment[data-seg-id="${entry.seg.id}"]`))
                .filter(Boolean);
            selectedEls.forEach(node => { node.style.opacity = '0.45'; });

            function onMove(mv) {
                const delta = (mv.clientX - e.clientX) / editorState.pxPerSec;
                const clampedDelta = Math.max(bounds.minDelta, Math.min(bounds.maxDelta, delta));
                selectedEntries.forEach(({ seg }) => {
                    seg.start = (baseStarts.get(seg.id) || 0) + clampedDelta;
                });
                selectedEntries.forEach(({ seg }) => {
                    const node = document.querySelector(`.tl-segment[data-seg-id="${seg.id}"]`);
                    if (node) node.style.left = `${seg.start * editorState.pxPerSec}px`;
                });
            }

            function onUp() {
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                selectedEls.forEach(node => { node.style.opacity = ''; });
                const changed = selectedEntries.some(({ seg }) => Math.abs((seg.start || 0) - (baseStarts.get(seg.id) || 0)) > 1e-6);
                if (changed) pushTimelineHistory(historySnapshot);
                renderTimeline();
            }

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            return;
        }

        const origRect = el.getBoundingClientRect();
        const origTrackId = track.id;
        const origStart = seg.start;
        const historySnapshot = snapshotTimelineState();
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
            if (seg.mediaType === 'audio' && targetTrack.type !== 'audio') {
                showToast('Audio clips can only go on audio tracks', 'error', '⚠️');
                renderTracks(); return;
            }
            if ((seg.mediaType === 'video' || seg.mediaType === 'image') && targetTrack.type !== 'video') {
                showToast('Video clips can only go on video tracks', 'error', '⚠️');
                renderTracks(); return;
            }
            if (seg.mediaType === 'text' && targetTrack.type !== 'text') {
                showToast('Text clips can only go on text tracks', 'error', '⚠️');
                renderTracks(); return;
            }
            if (seg.mediaType === 'effect' && targetTrack.type !== 'effect') {
                showToast('Effects can only go on effect tracks', 'error', '⚠️');
                renderTracks(); return;
            }

            const resolved = resolveNonOverlap(targetTrack, seg.duration, Math.max(0, targetStart), seg.id);
            if (resolved == null) {
                showToast('No space on that track for this clip', 'error', '⚠️');
                renderTimeline();
                return;
            }
            const changed = targetTrackId !== origTrackId || Math.abs(resolved - origStart) > 1e-6;
            if (changed) pushTimelineHistory(historySnapshot);
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
        pushTimelineHistory();
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
        if (seg.mediaType === 'text') {
            showToast('Right-click the text in preview to style it', 'info', 'ℹ️');
            return;
        }
        if (seg.mediaType === 'effect') {
            showEffectSegmentMenu(e.clientX, e.clientY, seg);
            return;
        }
        showSegmentMenu(e.clientX, e.clientY, seg);
    });

    // Trim left
    const trimL = el.querySelector('.tl-seg-trim.left');
    trimL.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        trimL.setPointerCapture(e.pointerId);
        const sx = e.clientX, os = seg.start, od = seg.duration;
        const row = el.closest('.tl-track-row');
        const historySnapshot = snapshotTimelineState();
        function onMove(mv) {
            const dx = (mv.clientX - sx) / editorState.pxPerSec;
            const neighbor = getNeighborBounds(track, seg.id);
            const minStart = Math.max(0, neighbor.prevEnd ?? 0);
            const maxStart = os + od - 0.25;
            let newStart = Math.max(minStart, Math.min(maxStart, os + dx));
            const snapped = findNearestSnapPoint(newStart, seg.id, minStart, maxStart);
            if (snapped != null) {
                newStart = snapped;
                if (row) setSnapLine(row, newStart * editorState.pxPerSec);
            } else if (row) {
                clearSnapLine(row);
            }
            seg.start = newStart; seg.duration = od - (newStart - os);
            el.style.left = (newStart * editorState.pxPerSec) + 'px';
            el.style.width = (seg.duration * editorState.pxPerSec) + 'px';
        }
        trimL.addEventListener('pointermove', onMove);
        trimL.addEventListener('pointerup', () => {
            trimL.removeEventListener('pointermove', onMove);
            if (row) clearSnapLine(row);
            if (Math.abs(seg.start - os) > 1e-6 || Math.abs(seg.duration - od) > 1e-6) {
                pushTimelineHistory(historySnapshot);
            }
            renderTimeline();
        }, { once: true });
    });

    // Trim right
    const trimR = el.querySelector('.tl-seg-trim.right');
    trimR.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        trimR.setPointerCapture(e.pointerId);
        const sx = e.clientX, od = seg.duration;
        const row = el.closest('.tl-track-row');
        const historySnapshot = snapshotTimelineState();
        function onMove(mv) {
            const neighbor = getNeighborBounds(track, seg.id);
            const minEnd = seg.start + 0.25;
            const maxEnd = neighbor.nextStart != null ? neighbor.nextStart : Infinity;
            let newEnd = Math.max(minEnd, seg.start + od + (mv.clientX - sx) / editorState.pxPerSec);
            if (Number.isFinite(maxEnd)) newEnd = Math.min(newEnd, maxEnd);
            const snapped = findNearestSnapPoint(newEnd, seg.id, minEnd, maxEnd);
            if (snapped != null) {
                newEnd = snapped;
                if (row) setSnapLine(row, newEnd * editorState.pxPerSec);
            } else if (row) {
                clearSnapLine(row);
            }
            let newDur = Math.max(0.25, newEnd - seg.start);
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
            if (row) clearSnapLine(row);
            if (Math.abs(seg.duration - od) > 1e-6) {
                pushTimelineHistory(historySnapshot);
            }
            renderTimeline();
        }, { once: true });
    });

    return el;
}

// ── Drop / Remove / AddTrack / Clear ─────────────────────────
function ensureTextTrack() {
    const existing = editorState.tracks.find(t => t.type === 'text');
    if (existing) return existing;
    const count = editorState.tracks.filter(t => t.type === 'text').length;
    const newTrack = {
        id: 'text-' + Date.now(),
        type: 'text',
        name: `Text ${count + 1}`,
        segments: [],
    };
    const firstVideoIdx = editorState.tracks.findIndex(t => t.type === 'video');
    const insertIdx = firstVideoIdx === -1 ? 0 : firstVideoIdx;
    editorState.tracks.splice(insertIdx, 0, newTrack);
    return newTrack;
}

function ensureEffectTrack() {
    const existing = editorState.tracks.find(t => t.type === 'effect');
    if (existing) return existing;
    const count = editorState.tracks.filter(t => t.type === 'effect').length;
    const newTrack = {
        id: 'effect-' + Date.now(),
        type: 'effect',
        name: `Effect ${count + 1}`,
        segments: [],
    };
    const firstAudioIdx = editorState.tracks.findIndex(t => t.type === 'audio');
    const insertIdx = firstAudioIdx === -1 ? editorState.tracks.length : firstAudioIdx;
    editorState.tracks.splice(insertIdx, 0, newTrack);
    return newTrack;
}

function dropMediaOnTrack(trackId, mediaId, startTime) {
    let track = editorState.tracks.find(t => t.id === trackId);
    const media = editorState.mediaItems.find(m => m.id === mediaId);
    if (!track || !media) return;
    const historySnapshot = snapshotTimelineState();
    let historyPushed = false;

    // Type enforcement
    if (media.type === 'text') {
        if (track.type !== 'text') {
            pushTimelineHistory(historySnapshot);
            historyPushed = true;
            track = ensureTextTrack();
        }
    }
    if (media.type === 'effect') {
        if (track.type !== 'effect') {
            if (!historyPushed) pushTimelineHistory(historySnapshot);
            historyPushed = true;
            track = ensureEffectTrack();
        }
    }
    if (media.type === 'audio' && track.type !== 'audio') {
        showToast('Audio clips can only go on audio tracks — drop onto Audio 1 or Audio 2', 'error', '⚠️');
        return;
    }
    if ((media.type === 'video' || media.type === 'image') && track.type !== 'video') {
        showToast('Video clips can only go on video tracks — drop onto Video 1 or Video 2', 'error', '⚠️');
        return;
    }
    if (media.type === 'text' && track.type !== 'text') {
        showToast('Text clips can only go on text tracks', 'error', '⚠️');
        return;
    }
    if (media.type === 'effect' && track.type !== 'effect') {
        showToast('Effects can only go on effect tracks', 'error', '⚠️');
        return;
    }

    if (!historyPushed) pushTimelineHistory(historySnapshot);
    const snap = getSnapInfo(track, startTime, media.duration || 5, null);
    const proposed = snap.snapped ? snap.start : startTime;
    const finalStart = resolveNonOverlap(track, media.duration || 5, proposed, null);
    if (finalStart == null) {
        showToast('No space on this track for that clip', 'error', '⚠️');
        return;
    }

    const seg = {
        id: 'seg-' + Date.now(), mediaId, name: media.name, src: media.src,
        start: finalStart, duration: media.duration || 5, mediaType: media.type, muted: false,
        thumbDataUrl: media.thumbDataUrl || null,
        transform: { x: 0, y: 0, scale: 1 },
    };
    if (media.type === 'text') {
        seg.text = media.text || 'Text';
        seg.fontFamily = media.fontFamily;
        seg.fontSize = media.fontSize;
        seg.fontWeight = media.fontWeight;
        seg.fontStyle = media.fontStyle;
        seg.color = media.color;
        seg.align = media.align;
        seg.bgColor = media.bgColor;
        seg.padding = media.padding;
        seg.lineHeight = media.lineHeight;
        seg.letterSpacing = media.letterSpacing;
        seg.underline = !!media.underline;
        seg.boxW = media.boxW ?? null;
        seg.boxH = media.boxH ?? null;
        seg.presetKey = media.presetKey || null;
    }
    if (media.type === 'effect') {
        seg.effectKey = media.effectKey || null;
        seg.effectParams = normalizeEffectParams(seg.effectKey, media.effectParams);
    }
    track.segments.push(seg);
    renderTimeline();
    showToast(`Added "${media.name}" to ${track.name}`, 'info', '✂️');

    if (media.type === 'video' && window.ensureVideoCached) {
        window.ensureVideoCached(mediaId, { silent: true });
    }
    if (media.type === 'image' && window.ensureImageCached) {
        window.ensureImageCached(mediaId, { silent: true });
    }
    if (media.type === 'audio' && window.ensureAudioCached) {
        window.ensureAudioCached(mediaId, { silent: true });
    }
}

function removeSegment(trackId, segId, { skipHistory = false } = {}) {
    const track = editorState.tracks.find(t => t.id === trackId);
    if (!skipHistory) pushTimelineHistory();
    if (track) track.segments = track.segments.filter(s => s.id !== segId);
    editorState.transitions = editorState.transitions.filter(t => t.leftId !== segId && t.rightId !== segId);
    if (isSegmentSelected(segId)) {
        setSelectedSegments(getSelectedSegIds().filter(id => id !== segId));
    }
    if (editorState.previewSegId === segId) editorState.previewSegId = null;
    renderTimeline();
}

function addTrack(type) {
    pushTimelineHistory();
    const count = editorState.tracks.filter(t => t.type === type).length;
    const newTrack = {
        id: type + '-' + Date.now(), type,
        name: `${type === 'video' ? 'Video' : 'Audio'} ${count + 1}`, segments: []
    };
    if (type === 'text') {
        newTrack.name = `Text ${count + 1}`;
        const firstVideoIdx = editorState.tracks.findIndex(t => t.type === 'video');
        const insertIdx = firstVideoIdx === -1 ? 0 : firstVideoIdx;
        editorState.tracks.splice(insertIdx, 0, newTrack);
    } else if (type === 'effect') {
        newTrack.name = `Effect ${count + 1}`;
        const firstAudioIdx = editorState.tracks.findIndex(t => t.type === 'audio');
        const insertIdx = firstAudioIdx === -1 ? editorState.tracks.length : firstAudioIdx;
        editorState.tracks.splice(insertIdx, 0, newTrack);
    } else {
        const lastIdx = [...editorState.tracks].map((t, i) => t.type === type ? i : -1).filter(i => i >= 0).pop();
        if (lastIdx === undefined) editorState.tracks.push(newTrack);
        else editorState.tracks.splice(lastIdx + 1, 0, newTrack);
    }
    renderTimeline();
    return newTrack;
}

function clearTimeline() {
    pushTimelineHistory();
    editorState.tracks.forEach(t => t.segments = []);
    editorState.transitions = [];
    clearSelectedSegments();
    editorState.previewSegId = null;
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
    // Pause preview videos
    const layers = eq('preview-layers');
    layers?.querySelectorAll('video').forEach(v => {
        try { if (!v.paused) v.pause(); } catch { }
    });
    // Pause ALL audio segment elements immediately
    editorState.tracks.forEach(track => {
        track.segments.forEach(seg => {
            if (seg._audioEl && !seg._audioEl.paused) seg._audioEl.pause();
        });
    });
    if (editorState.exporting) pauseExportAudio();
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
    const playbackEnd = getTimelineContentEnd();
    const limit = editorState.exporting && editorState.exportEnd != null
        ? editorState.exportEnd
        : playbackEnd;
    if (editorState.currentTime >= limit) {
        if (!editorState.exporting) {
            editorState.currentTime = playbackEnd;
            updatePreviewForTime(editorState.currentTime);
            renderPlayhead();
            updateTimeDisplay();
        }
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
    const emptyEl = eq('preview-empty');
    const hasAnyVideo = editorState.tracks.some(tk => tk.type === 'video' && tk.segments.length);
    let layers = getActiveVideoSegmentsAtTime(t);
    const contentEnd = getTimelineContentEnd(['video', 'image', 'text']);
    if (!layers.length && hasAnyVideo && contentEnd > 0 && t >= contentEnd) {
        layers = getActiveVideoSegmentsAtTime(Math.max(0, contentEnd - 1 / 60));
    }
    updatePreviewEffects(t);
    const audibleVideoSegId = layers
        .filter(layer => layer.seg.mediaType === 'video' && !layer.seg.muted)
        .sort((a, b) => a.trackIndex - b.trackIndex)[0]?.seg.id || null;

    if (layers.length) {
        layers.forEach(layer => {
            if (layer.seg.mediaType === 'video') {
                prefetchVideoSegment(layer.seg);
                const nextSeg = getNextVideoSegment(t);
                if (nextSeg && nextSeg.start - t <= 3) prefetchVideoSegment(nextSeg);
            }
        });
        emptyEl.style.display = 'none';
        renderPreviewLayers(layers, t);
        const top = layers.slice().sort((a, b) => a.trackIndex - b.trackIndex)[0];
        if (!layers.find(l => l.seg.id === editorState.previewSegId)) {
            editorState.previewSegId = top?.seg.id || null;
        }
        updatePreviewSelection();
        editorState.previewOpacity = 1;
    } else {
        clearPreviewLayers();
        if (hasAnyVideo) {
            emptyEl.style.display = 'none';
            editorState.previewOpacity = 0;
        } else {
            emptyEl.style.display = 'flex';
            editorState.previewOpacity = 1;
        }
        editorState.previewSegId = null;
        updatePreviewScaleHandle();
    }

    // Sync audio segments
    for (const track of editorState.tracks) {
        for (const seg of track.segments) {
            if (seg.mediaType !== 'audio') continue;
            const audioSrc = getEditorMediaPlaybackSrc(seg);
            if (!audioSrc) {
                if (seg.mediaId) ensureEditorMediaCache(seg.mediaId, 'audio');
                if (seg._audioEl && !seg._audioEl.paused) seg._audioEl.pause();
                continue;
            }
            if (!seg._audioEl) {
                seg._audioEl = new Audio(audioSrc);
                seg._audioEl.preload = 'auto';
            } else if (seg._audioEl.src !== audioSrc) {
                seg._audioEl.src = audioSrc;
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

    if (editorState.exporting) {
        syncExportAudio(t, audibleVideoSegId);
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
    editorState.pxPerSec = Math.max(2, Math.min(500, px));
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

    let stream;
    try {
        const { canvas } = ensureExportCanvas();
        if (typeof canvas.captureStream !== 'function') {
            showToast('Export not supported in this browser. Use Chrome or Edge.', 'error', '❌');
            return;
        }
        stream = canvas.captureStream(30);
        const mixedAudioTracks = getExportAudioTracks();
        mixedAudioTracks.forEach(track => stream.addTrack(track));
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
        cleanupExportAudio();
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

function ensureExportCanvas() {
    if (editorState.exportCanvas && editorState.exportCtx) {
        return { canvas: editorState.exportCanvas, ctx: editorState.exportCtx };
    }
    const canvas = document.createElement('canvas');
    const size = getExportCanvasSize();
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    editorState.exportCanvas = canvas;
    editorState.exportCtx = ctx;
    return { canvas, ctx };
}

function ensureExportAudioGraph() {
    if (editorState.exportAudioContext && editorState.exportAudioDestination) {
        return {
            context: editorState.exportAudioContext,
            destination: editorState.exportAudioDestination,
        };
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const context = new Ctx();
    const destination = context.createMediaStreamDestination();
    editorState.exportAudioContext = context;
    editorState.exportAudioDestination = destination;
    return { context, destination };
}

function getExportAudioTracks() {
    const graph = ensureExportAudioGraph();
    if (!graph) return [];
    return graph.destination.stream.getAudioTracks();
}

function getExportMediaElement(seg, mediaType, src) {
    const graph = ensureExportAudioGraph();
    if (!graph || !src) return null;
    const tagName = mediaType === 'video' ? 'video' : 'audio';
    let el = seg._exportMediaEl;
    if (!el || el.tagName.toLowerCase() !== tagName) {
        el = document.createElement(tagName);
        el.preload = 'auto';
        if (mediaType === 'video') {
            el.playsInline = true;
        }
        seg._exportMediaEl = el;
        const source = graph.context.createMediaElementSource(el);
        source.connect(graph.destination);
        seg._exportAudioNode = source;
    }
    if (el.dataset.src !== src) {
        el.dataset.src = src;
        el.src = src;
        if (typeof el.load === 'function') {
            try { el.load(); } catch { }
        }
    }
    return el;
}

function syncExportMediaElement(seg, mediaType, t) {
    const src = getEditorMediaPlaybackSrc(seg);
    if (!src || seg.muted) return false;
    const el = getExportMediaElement(seg, mediaType, src);
    if (!el) return false;
    const segTime = Math.max(0, Math.min(seg.duration || Infinity, t - seg.start));
    if (Math.abs((el.currentTime || 0) - segTime) > 0.2) {
        try { el.currentTime = segTime; } catch { }
    }
    if (editorState.exportAudioContext?.state === 'suspended') {
        editorState.exportAudioContext.resume().catch(() => { });
    }
    if (editorState.playing && el.paused) {
        el.play().catch(() => { });
    } else if (!editorState.playing && !el.paused) {
        el.pause();
    }
    return true;
}

function pauseExportAudio() {
    editorState.tracks.forEach(track => {
        track.segments.forEach(seg => {
            if (seg._exportMediaEl && !seg._exportMediaEl.paused) {
                seg._exportMediaEl.pause();
            }
        });
    });
}

function cleanupExportAudio() {
    pauseExportAudio();
    editorState.tracks.forEach(track => {
        track.segments.forEach(seg => {
            if (seg._exportMediaEl) {
                try {
                    seg._exportMediaEl.removeAttribute('src');
                    seg._exportMediaEl.load?.();
                } catch { }
                delete seg._exportMediaEl;
            }
            delete seg._exportAudioNode;
        });
    });
    if (editorState.exportAudioContext) {
        editorState.exportAudioContext.close().catch(() => { });
    }
    editorState.exportAudioContext = null;
    editorState.exportAudioDestination = null;
}

function syncExportAudio(t, audibleVideoSegId = null) {
    const graph = ensureExportAudioGraph();
    if (!graph) return;
    let hasActive = false;

    for (const track of editorState.tracks) {
        for (const seg of track.segments) {
            const isActive = !seg.muted && t >= seg.start && t < seg.start + seg.duration;
            if (seg.mediaType === 'audio' && isActive) {
                hasActive = syncExportMediaElement(seg, 'audio', t) || hasActive;
                continue;
            }
            if (seg.mediaType === 'video' && isActive && seg.id === audibleVideoSegId) {
                hasActive = syncExportMediaElement(seg, 'video', t) || hasActive;
                continue;
            }
            if (seg._exportMediaEl && !seg._exportMediaEl.paused) {
                seg._exportMediaEl.pause();
            }
        }
    }

    if (!hasActive) pauseExportAudio();
}

function getExportCanvasSize() {
    const ratio = parseRatio(editorState.previewRatio || '16:9').value;
    const base = 1280;
    if (ratio >= 1) {
        return { width: base, height: Math.round(base / ratio) };
    }
    return { width: Math.round(base * ratio), height: base };
}

function renderExportFrame() {
    const canvas = editorState.exportCanvas;
    const ctx = editorState.exportCtx;
    if (!canvas || !ctx) return;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const layers = getActiveVideoSegmentsAtTime(editorState.currentTime || 0);
    if (!layers.length) return;
    const ordered = layers.slice().sort((a, b) => b.trackIndex - a.trackIndex);
    const textScale = getExportTextScale();
    ordered.forEach(layer => {
        const seg = layer.seg;
        const opacity = getTransitionOpacity(seg, editorState.currentTime || 0);
        if (opacity <= 0) return;
        if (seg.mediaType === 'text') {
            const t = getSegmentTransform(seg);
            const style = getTextStyle(seg);
            const fontFamily = resolveFontFamily(style.fontFamily);
            const fontSize = style.fontSize * textScale;
            const padding = style.padding * textScale;
            const lineHeight = fontSize * style.lineHeight;
            const lines = String(style.text || '').split('\n');
            ctx.save();
            ctx.globalAlpha = opacity;
            ctx.translate(canvas.width / 2 + (t.x || 0) * canvas.width, canvas.height / 2 + (t.y || 0) * canvas.height);
            ctx.scale(t.scale || 1, t.scale || 1);
            ctx.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${fontFamily}`;
            ctx.textAlign = style.align;
            ctx.textBaseline = 'middle';
            const widths = lines.map(line => ctx.measureText(line).width);
            const maxW = widths.length ? Math.max(...widths) : 0;
            const totalH = lines.length ? (lines.length - 1) * lineHeight : 0;
            let bgX = -padding;
            if (style.align === 'center') bgX = -maxW / 2 - padding;
            if (style.align === 'right') bgX = -maxW - padding;
            const bgY = -totalH / 2 - padding;
            if (style.bgColor && style.bgColor !== 'transparent') {
                ctx.fillStyle = style.bgColor;
                ctx.fillRect(bgX, bgY, maxW + padding * 2, totalH + padding * 2);
            }
            ctx.fillStyle = style.color;
            const startY = -totalH / 2;
            lines.forEach((line, i) => {
                ctx.fillText(line, 0, startY + i * lineHeight);
                if (style.underline) {
                    const w = ctx.measureText(line).width;
                    let lx = 0;
                    if (style.align === 'center') lx = -w / 2;
                    if (style.align === 'right') lx = -w;
                    const ly = startY + i * lineHeight + fontSize * 0.38;
                    ctx.strokeStyle = style.color;
                    ctx.lineWidth = Math.max(1, fontSize / 18);
                    ctx.beginPath();
                    ctx.moveTo(lx, ly);
                    ctx.lineTo(lx + w, ly);
                    ctx.stroke();
                }
            });
            ctx.restore();
            return;
        }

        const el = document.querySelector(`.preview-layer[data-seg-id="${seg.id}"]`);
        if (!el) return;
        const isImage = seg.mediaType === 'image';
        const sw = isImage ? (el.naturalWidth || 0) : (el.videoWidth || 0);
        const sh = isImage ? (el.naturalHeight || 0) : (el.videoHeight || 0);
        if (!sw || !sh) return;
        const t = getSegmentTransform(seg);
        const transitionState = getTransitionVisualState(seg, editorState.currentTime || 0);
        const baseScale = Math.min(canvas.width / sw, canvas.height / sh);
        const scale = baseScale * (t.scale || 1) * (transitionState.scale || 1);
        const dw = sw * scale;
        const dh = sh * scale;
        const dx = (canvas.width - dw) / 2 + ((t.x || 0) + (transitionState.x || 0)) * canvas.width;
        const dy = (canvas.height - dh) / 2 + ((t.y || 0) + (transitionState.y || 0)) * canvas.height;
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.filter = transitionState.filter || 'none';
        try { ctx.drawImage(el, dx, dy, dw, dh); } catch { }
        ctx.restore();
    });
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
    if (e.target.isContentEditable || document.activeElement?.isContentEditable) return;
    const isMod = e.metaKey || e.ctrlKey;
    const key = String(e.key || '').toLowerCase();
    if (isMod && key === 'c') {
        e.preventDefault();
        copySelectedSegment();
        return;
    }
    if (isMod && key === 'v') {
        e.preventDefault();
        pasteClipboardSegment();
        return;
    }
    if (e.code === 'Space') { e.preventDefault(); togglePlayback(); }
    if (e.code === 'Home') { e.preventDefault(); seekTo(0); }
    if (e.code === 'KeyM' && getSelectedSegIds().length) {
        pushTimelineHistory();
        const selectedIds = new Set(getSelectedSegIds());
        editorState.tracks.forEach(t => {
            t.segments.forEach(seg => {
                if (selectedIds.has(seg.id)) seg.muted = !seg.muted;
            });
        });
        renderTracks();
    }
    if (e.code === 'Delete' || e.code === 'Backspace') {
        const selectedIds = getSelectedSegIds();
        if (selectedIds.length) {
            pushTimelineHistory();
            const idSet = new Set(selectedIds);
            editorState.tracks.forEach(track => {
                track.segments = track.segments.filter(seg => !idSet.has(seg.id));
            });
            editorState.transitions = editorState.transitions.filter(t => !idSet.has(t.leftId) && !idSet.has(t.rightId));
            clearSelectedSegments();
            if (editorState.previewSegId && idSet.has(editorState.previewSegId)) editorState.previewSegId = null;
            renderTimeline();
        }
    }
    if (isMod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoTimeline();
        return;
    }
    if ((isMod && key === 'z' && e.shiftKey) || (isMod && key === 'y')) {
        e.preventDefault();
        redoTimeline();
        return;
    }
});

// Bind header buttons on load (even if editor tab isn't opened yet)
bindHeaderProjectButtons();

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

function normalizeTransitionType(type) {
    const key = String(type || '').trim().toLowerCase();
    if (key === 'crossfade' || key === 'fade-in' || key === 'fade-out') return 'cross-dissolve';
    if (TRANSITION_PRESET_MAP.has(key)) return key;
    return 'cross-dissolve';
}

function getTransitionPreset(type) {
    return TRANSITION_PRESET_MAP.get(normalizeTransitionType(type)) || TRANSITION_PRESETS[0];
}

function getTransitionParamDefs(type) {
    return TRANSITION_PARAM_DEFS[normalizeTransitionType(type)] || [];
}

function getDefaultTransitionParams(type) {
    const params = {};
    getTransitionParamDefs(type).forEach(def => {
        params[def.key] = def.default;
    });
    return params;
}

function normalizeTransitionParams(type, params) {
    const next = {};
    getTransitionParamDefs(type).forEach(def => {
        const raw = Number(params?.[def.key]);
        const value = Number.isFinite(raw) ? raw : def.default;
        next[def.key] = Math.max(def.min, Math.min(def.max, value));
    });
    return next;
}

function normalizeTransitionData(tr) {
    if (!tr) return null;
    const type = normalizeTransitionType(tr.type);
    return {
        ...tr,
        type,
        params: normalizeTransitionParams(type, tr.params),
    };
}

function getTransitionByPair(leftId, rightId) {
    const transition = editorState.transitions.find(t => t.leftId === leftId && t.rightId === rightId);
    if (!transition) return null;
    const normalized = normalizeTransitionData(transition);
    Object.assign(transition, normalized);
    return transition;
}

function getTransitionDuration(tr) {
    return normalizeTransitionParams(tr?.type, tr?.params).duration || TRANSITION_DUR;
}

function getTransitionVisualForPhase(type, params, side, progress) {
    const p = clamp01(progress);
    const isOut = side === 'out';
    const mix = isOut ? p : (1 - p);
    const state = {
        opacity: isOut ? (1 - p) : p,
        x: 0,
        y: 0,
        scale: 1,
        filter: 'none',
    };
    const normalizedType = normalizeTransitionType(type);
    const normalizedParams = normalizeTransitionParams(normalizedType, params);
    if (normalizedType === 'whip-pan') {
        const distance = normalizedParams.distance;
        state.x = isOut ? (-distance * p) : (distance * (1 - p));
        state.filter = `blur(${(mix * 10).toFixed(2)}px)`;
    } else if (normalizedType === 'zoom-in-out') {
        const zoom = normalizedParams.zoom;
        state.scale = 1 + zoom * mix;
    } else if (normalizedType === 'glitch-effects') {
        const shift = normalizedParams.shift;
        const dir = isOut ? -1 : 1;
        state.x = dir * shift * mix;
        state.filter = `contrast(1.25) saturate(1.35) hue-rotate(${dir * 16 * mix}deg)`;
    } else if (normalizedType === 'speed-ramps') {
        const boost = normalizedParams.boost;
        state.scale = 1 + boost * mix * 0.5;
        state.filter = `blur(${(mix * 6).toFixed(2)}px)`;
    } else if (normalizedType === 'match-cut') {
        const settle = normalizedParams.settle;
        state.scale = 1 + settle * (isOut ? p * 0.5 : (1 - p));
        state.y = isOut ? (-settle * 0.4 * p) : (settle * 0.4 * (1 - p));
        state.opacity = isOut ? (1 - p * 0.65) : Math.min(1, 0.35 + p * 0.65);
    }
    return state;
}

function getTransitionVisualState(seg, t) {
    const out = { opacity: 1, x: 0, y: 0, scale: 1, filter: 'none' };
    if (!seg || !editorState.transitions?.length) return out;
    for (const raw of editorState.transitions) {
        const tr = normalizeTransitionData(raw);
        const left = findSegById(tr.leftId);
        const right = findSegById(tr.rightId);
        if (!left || !right) continue;
        const boundary = (left.start || 0) + (left.duration || 0);
        const dur = getTransitionDuration(tr);
        if (seg.id === left.id && t >= boundary - dur && t <= boundary) {
            const progress = dur > 0 ? (t - (boundary - dur)) / dur : 1;
            return getTransitionVisualForPhase(tr.type, tr.params, 'out', progress);
        }
        if (seg.id === right.id && t >= boundary && t <= boundary + dur) {
            const progress = dur > 0 ? (t - boundary) / dur : 1;
            return getTransitionVisualForPhase(tr.type, tr.params, 'in', progress);
        }
    }
    return out;
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
    const transitionState = getTransitionVisualState(seg, t);
    opacity = Math.min(opacity, clamp01(transitionState.opacity ?? 1));
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
