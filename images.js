/* ============================================================
   VibedStudio AI Video Studio — images.js
   Seedream image generation + IndexedDB persistence
   ============================================================ */

const IMAGE_API_BASE = '/api/image';
const OPENAI_IMAGE_API_BASE = '/api/openai/images';
const OPENAI_RESPONSES_API_BASE = '/api/openai/responses';
const OPENAI_RESPONSES_MODEL = 'gpt-4.1';

const IMAGE_MODELS = [
    {
        id: 'seedream-5-0-260128',
        name: 'Seedream 5.0 Lite',
        badge: 'NEW',
        sizes: ['2K', '3K'],
        provider: 'byteplus',
        supportsFormat: true,
        supportsOptimize: false,
        supportsReference: true,
        desc: 'Text, single-image, multi-image',
    },
    {
        id: 'seedream-4-5-251128',
        name: 'Seedream 4.5',
        badge: '',
        sizes: ['2K', '4K'],
        provider: 'byteplus',
        supportsFormat: false,
        supportsOptimize: false,
        supportsReference: true,
        desc: 'Text, single-image, multi-image',
    },
    {
        id: 'seedream-4-0-250828',
        name: 'Seedream 4.0',
        badge: '',
        sizes: ['1K', '2K', '4K'],
        provider: 'byteplus',
        supportsFormat: false,
        supportsOptimize: true,
        supportsReference: true,
        desc: 'Text, single-image, multi-image',
    },
    {
        id: 'gpt-image-1.5',
        name: 'GPT Image 1.5',
        badge: 'OPENAI',
        sizes: ['1024x1024', '1024x1536', '1536x1024'],
        provider: 'openai',
        supportsReference: true,
        desc: 'Text, multi-image reference',
    },
];

const imgState = {
    model: 'seedream-5-0-260128',
    size: '2K',
    baseSize: '2K',
    aspectRatio: 'auto',
    format: 'png',
    count: 0,
    outputCount: 1,
    optimizeMode: 'standard',
    referenceImages: [],
    page: 1,
};

let imagesInited = false;
const IMG_PAGE_SIZE = 12;
let imgProcessingCount = 0;
const imgJobs = new Map();
const SIZE_DEFAULTS = [];
const IMG_MAX_REFERENCE_IMAGES = 14;
const IMG_MAX_TOTAL_IMAGES = 15;
const IMG_MAX_OPENAI_OUTPUTS = 10;
const IMG_ASPECT_RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];
const imgPreviewModal = document.getElementById('image-preview-modal');
const imgPreviewClose = document.getElementById('image-preview-close');
const imgPreviewImg = document.getElementById('image-preview-img');
const imgPreviewCaption = document.getElementById('image-preview-caption');
const imgPreviewTitle = document.getElementById('image-preview-title');
const imgPreviewPrev = document.getElementById('image-preview-prev');
const imgPreviewNext = document.getElementById('image-preview-next');
let imgPreviewRecords = [];
let imgPreviewIndex = -1;
const IMG_RATIO_SIZE_MAP = {
    '1K': {
        '1:1': '1024x1024',
        '3:4': '864x1152',
        '4:3': '1152x864',
        '16:9': '1312x736',
        '9:16': '736x1312',
        '2:3': '832x1248',
        '3:2': '1248x832',
        '21:9': '1568x672',
    },
    '2K': {
        '1:1': '2048x2048',
        '3:4': '1728x2304',
        '4:3': '2304x1728',
        '16:9': '2848x1600',
        '9:16': '1600x2848',
        '3:2': '2496x1664',
        '2:3': '1664x2496',
        '21:9': '3136x1344',
    },
    '3K': {
        '1:1': '3072x3072',
        '3:4': '2592x3456',
        '4:3': '3456x2592',
        '16:9': '4096x2304',
        '9:16': '2304x4096',
        '2:3': '2496x3744',
        '3:2': '3744x2496',
        '21:9': '4704x2016',
    },
    '4K': {
        '1:1': '4096x4096',
        '3:4': '3520x4704',
        '4:3': '4704x3520',
        '16:9': '5504x3040',
        '9:16': '3040x5504',
        '2:3': '3328x4992',
        '3:2': '4992x3328',
        '21:9': '6240x2656',
    },
};
const IMG_OPENAI_RATIO_MAP = {
    '1:1': '1024x1024',
    '9:16': '1024x1536',
    '16:9': '1536x1024',
};

// ── Init ──────────────────────────────────────────────────────
window.initImages = async function initImages() {
    if (imagesInited) return;
    imagesInited = true;

    // Render model cards
    renderImgModelGrid();

    const outputRange = document.getElementById('img-output-range');
    if (outputRange) {
        outputRange.addEventListener('input', () => {
            imgState.outputCount = clampOutputCount(parseInt(outputRange.value, 10) || 1);
            outputRange.value = imgState.outputCount;
            updateOutputLabel();
            updateImgJsonPreview();
        });
    }

    // Size picker
    const sizeButtons = Array.from(document.querySelectorAll('.img-size-btn'));
    if (!SIZE_DEFAULTS.length) {
        SIZE_DEFAULTS.push(...sizeButtons.map(btn => ({
            value: btn.dataset.size,
            label: btn.textContent.trim(),
        })));
    }
    sizeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.img-size-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            imgState.baseSize = btn.dataset.size;
            applyAspectRatioSelection();
        });
    });

    // Aspect ratio picker
    document.querySelectorAll('.img-ratio-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            document.querySelectorAll('.img-ratio-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            imgState.aspectRatio = btn.dataset.ratio || 'auto';
            applyAspectRatioSelection();
        });
    });

    // Format picker
    document.querySelectorAll('.img-format-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            document.querySelectorAll('.img-format-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            imgState.format = btn.dataset.format;
            updateImgJsonPreview();
        });
    });

    const optimizeSelect = document.getElementById('img-optimize-select');
    if (optimizeSelect) {
        optimizeSelect.addEventListener('change', () => {
            imgState.optimizeMode = optimizeSelect.value;
            updateImgJsonPreview();
        });
    }

    initImgReferences();

    // Generate button
    document.getElementById('img-generate-btn').addEventListener('click', handleImageGenerate);

    // Char count
    const ta = document.getElementById('img-prompt');
    if (ta) {
        ta.addEventListener('input', () => {
            document.getElementById('img-char-count').textContent = ta.value.length;
            updateImgJsonPreview();
            updateImgChips();
        });
    }

    const copyBtn = document.getElementById('img-copy-json');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const payload = buildImgPayload({ preview: true });
            navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => {
                showToast('JSON copied to clipboard', 'success', '📋');
            });
        });
    }

    const copyRespBtn = document.getElementById('img-copy-response');
    if (copyRespBtn) {
        copyRespBtn.addEventListener('click', () => {
            const text = document.getElementById('img-json-response')?.textContent || '';
            navigator.clipboard.writeText(text).then(() => {
                showToast('Response copied to clipboard', 'success', '📋');
            });
        });
    }

    const refreshBtn = document.getElementById('img-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => refreshImageHistory());
    }
    const prevBtn = document.getElementById('img-prev-page');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            imgState.page = Math.max(1, imgState.page - 1);
            applyImgPagination();
        });
    }
    const nextBtn = document.getElementById('img-next-page');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            imgState.page += 1;
            applyImgPagination();
        });
    }
    const exportBtn = document.getElementById('img-export-images');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            exportAllImages().catch(e => {
                console.warn('Export images failed:', e);
                showToast('Export failed', 'error', '❌');
            });
        });
    }

    updateOutputLabel();
    renderImgReferenceDeck();
    updateOutputConstraints();
    updateSizeButtons();
    updateImgJsonPreview();
    updateFormatButtons();
    updateOptimizeControls();
    updateReferenceControls();
    updateImgChips();
    setImgResponsePreview({ status: 'idle' });
    initImagePreviewModal();
    await loadImagesFromDB();
    applyImgPagination();
};

window.applyImageHistory = function applyImageHistory(records) {
    const grid = document.getElementById('img-grid');
    if (!grid) return;
    grid.innerHTML = '';
    imgState.count = 0;
    imgState.page = 1;
    const list = Array.isArray(records) ? records.slice() : [];
    list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    list.forEach(r => {
        const record = { ...r };
        if (!record.blob && record.blobBase64 && typeof dataUrlToBlob === 'function') {
            try { record.blob = dataUrlToBlob(record.blobBase64); } catch { record.blob = null; }
        }
        if (record.blob && !record.blobUrl) record.blobUrl = URL.createObjectURL(record.blob);
        if (!record.blobUrl) record.blobUrl = record.url;
        renderSavedImageCard(record);
        if (typeof window.addGeneratedImageToEditor === 'function') {
            window.addGeneratedImageToEditor(record);
        }
        imgState.count++;
    });
    const badge = document.getElementById('img-count-badge');
    if (badge) badge.textContent = imgState.count;
    updateImgEmptyState();
    applyImgPagination();
};

window.applyImageGeneratorState = function applyImageGeneratorState(state) {
    if (!state) return;
    if (state.model) imgState.model = state.model;
    if (state.baseSize) imgState.baseSize = state.baseSize;
    if (state.size && !state.baseSize) imgState.baseSize = state.size;
    if (state.aspectRatio) imgState.aspectRatio = state.aspectRatio;
    if (state.format) imgState.format = state.format;
    if (state.outputCount != null) imgState.outputCount = parseInt(state.outputCount, 10) || 1;
    if (state.optimizeMode) imgState.optimizeMode = state.optimizeMode;
    imgState.referenceImages = Array.isArray(state.referenceImages)
        ? state.referenceImages.slice(0, IMG_MAX_REFERENCE_IMAGES)
        : [];
    renderImgModelGrid();
    updateSizeButtons();
    updateFormatButtons();
    updateOptimizeControls();
    updateReferenceControls();
    renderImgReferenceDeck();
    updateOutputConstraints();
    document.querySelectorAll('.img-size-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.size === imgState.baseSize);
    });
    updateRatioButtons();
    document.querySelectorAll('.img-format-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.format === imgState.format);
    });
    const outputRange = document.getElementById('img-output-range');
    if (outputRange) outputRange.value = imgState.outputCount;
    const optimizeSelect = document.getElementById('img-optimize-select');
    if (optimizeSelect) optimizeSelect.value = imgState.optimizeMode || 'standard';
    const promptEl = document.getElementById('img-prompt');
    if (promptEl && typeof state.promptText === 'string') {
        promptEl.value = state.promptText;
        const countEl = document.getElementById('img-char-count');
        if (countEl) countEl.textContent = promptEl.value.length;
    }
    applyAspectRatioSelection();
    updateImgJsonPreview();
};

window.getImageGeneratorState = function getImageGeneratorState() {
    const promptEl = document.getElementById('img-prompt');
    return {
        model: imgState.model,
        size: imgState.size,
        baseSize: imgState.baseSize,
        aspectRatio: imgState.aspectRatio,
        format: imgState.format,
        outputCount: imgState.outputCount,
        optimizeMode: imgState.optimizeMode,
        referenceImages: imgState.referenceImages.slice(0, IMG_MAX_REFERENCE_IMAGES),
        promptText: promptEl?.value || '',
    };
};

// ── Model grid ────────────────────────────────────────────────
function renderImgModelGrid() {
    const grid = document.getElementById('img-model-grid');
    if (!grid) return;
    grid.innerHTML = IMAGE_MODELS.map(m => {
        const sizeText = m.sizes?.length ? m.sizes.join(', ') : '—';
        const descText = m.desc ? escImg(m.desc) : 'Text-only';
        return `
        <label class="model-card ${m.id === imgState.model ? 'selected' : ''} ${m.disabled ? 'disabled' : ''}" data-model="${m.id}" ${m.disabled ? 'aria-disabled="true"' : ''}>
            <input type="radio" name="img-model" value="${m.id}" ${m.id === imgState.model ? 'checked' : ''} ${m.disabled ? 'disabled' : ''} hidden />
            ${m.badge ? `<div class="model-badge pro">${m.badge}</div>` : '<div class="model-badge lite">IMG</div>'}
            <div class="model-name">${m.name}</div>
            <div class="model-desc">${descText} · Sizes: ${sizeText}</div>
        </label>`;
    }).join('');

    grid.querySelectorAll('.model-card').forEach(card => {
        card.addEventListener('click', () => {
            const model = IMAGE_MODELS.find(m => m.id === card.dataset.model);
            if (model?.disabled) {
                showToast('Sora image API is not available yet. Choose a Seedream or GPT Image model.', 'info', 'ℹ️');
                return;
            }
            grid.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            imgState.model = card.dataset.model;
            // Update valid sizes for this model
            updateSizeButtons();
            updateFormatButtons();
            updateOptimizeControls();
            updateReferenceControls();
            updateOutputConstraints();
            updateImgJsonPreview();
        });
    });
}

function updateSizeButtons() {
    const model = IMAGE_MODELS.find(m => m.id === imgState.model);
    if (!model) return;
    const buttons = Array.from(document.querySelectorAll('.img-size-btn'));
    let validSizes = [];
    if (model.provider === 'openai' && model.sizes?.length) {
        const options = model.sizes.map(size => ({ value: size, label: size }));
        buttons.forEach((btn, idx) => {
            const opt = options[idx];
            if (!opt) {
                btn.disabled = true;
                btn.textContent = '—';
                return;
            }
            btn.disabled = false;
            btn.dataset.size = opt.value;
            btn.textContent = opt.label;
        });
        validSizes = options.map(o => o.value);
    } else {
        buttons.forEach((btn, idx) => {
            const base = SIZE_DEFAULTS[idx];
            if (!base) return;
            btn.dataset.size = base.value;
            btn.textContent = base.label;
            btn.disabled = !model.sizes.includes(base.value);
        });
        validSizes = model.sizes.slice();
    }
    if (!validSizes.length) return;
    if (!imgState.baseSize) imgState.baseSize = imgState.size || validSizes[0];
    if (!validSizes.includes(imgState.baseSize)) {
        imgState.baseSize = validSizes[0];
    }
    buttons.forEach(b => b.classList.toggle('selected', b.dataset.size === imgState.baseSize));
    updateRatioButtons();
    applyAspectRatioSelection({ silent: true });
}

function updateRatioButtons() {
    const model = IMAGE_MODELS.find(m => m.id === imgState.model);
    const buttons = Array.from(document.querySelectorAll('.img-ratio-btn'));
    if (!buttons.length) return;
    const allowed = model?.provider === 'openai'
        ? ['auto', '1:1', '16:9', '9:16']
        : IMG_ASPECT_RATIOS.slice();
    if (!allowed.includes(imgState.aspectRatio)) {
        imgState.aspectRatio = 'auto';
    }
    buttons.forEach(btn => {
        const ratio = btn.dataset.ratio || 'auto';
        const isAllowed = allowed.includes(ratio);
        btn.disabled = !isAllowed;
        btn.classList.toggle('selected', ratio === imgState.aspectRatio);
    });
}

function applyAspectRatioSelection({ silent = false } = {}) {
    const model = IMAGE_MODELS.find(m => m.id === imgState.model);
    const ratio = imgState.aspectRatio || 'auto';
    if (!imgState.baseSize) imgState.baseSize = imgState.size || model?.sizes?.[0] || '2K';
    let effectiveSize = imgState.baseSize;
    if (ratio !== 'auto') {
        if (model?.provider === 'openai') {
            const mapped = IMG_OPENAI_RATIO_MAP[ratio];
            if (mapped) {
                effectiveSize = mapped;
                imgState.baseSize = mapped;
                document.querySelectorAll('.img-size-btn').forEach(btn => {
                    btn.classList.toggle('selected', btn.dataset.size === imgState.baseSize);
                });
            }
        } else {
            const sizeMap = IMG_RATIO_SIZE_MAP[imgState.baseSize];
            if (sizeMap && sizeMap[ratio]) {
                effectiveSize = sizeMap[ratio];
            }
        }
    }
    imgState.size = effectiveSize;
    if (!silent) {
        updateImgJsonPreview();
        updateImgChips();
    }
}

function updateFormatButtons() {
    const model = IMAGE_MODELS.find(m => m.id === imgState.model);
    const supportsFormat = model?.provider === 'openai' || model?.supportsFormat;
    const buttons = Array.from(document.querySelectorAll('.img-format-btn'));
    const hint = document.getElementById('img-format-hint');
    if (!supportsFormat) {
        imgState.format = 'jpeg';
        buttons.forEach(btn => {
            const isJpeg = btn.dataset.format === 'jpeg';
            btn.disabled = !isJpeg;
            btn.classList.toggle('selected', isJpeg);
        });
        if (hint) hint.textContent = 'Seedream 4.5/4.0 output JPEG only';
    } else {
        buttons.forEach(btn => {
            btn.disabled = false;
            btn.classList.toggle('selected', btn.dataset.format === imgState.format);
        });
        if (hint) hint.textContent = model?.provider === 'openai' ? 'Output format supported by model' : 'PNG or JPEG';
    }
    updateImgJsonPreview();
}

function updateOptimizeControls() {
    const model = IMAGE_MODELS.find(m => m.id === imgState.model);
    const select = document.getElementById('img-optimize-select');
    if (!select) return;
    if (!model?.supportsOptimize) {
        imgState.optimizeMode = 'standard';
        select.value = 'standard';
        select.disabled = true;
    } else {
        select.disabled = false;
        select.value = imgState.optimizeMode || 'standard';
    }
    updateImgJsonPreview();
}

function updateReferenceControls() {
    const model = IMAGE_MODELS.find(m => m.id === imgState.model);
    const supports = !!model?.supportsReference;
    const deck = document.getElementById('img-reference-deck');
    const addBtn = document.getElementById('img-reference-add');
    const hint = document.getElementById('img-reference-hint');
    if (deck) deck.classList.toggle('disabled', !supports);
    if (addBtn) addBtn.classList.toggle('disabled', !supports);
    if (hint) hint.textContent = supports ? 'Up to 14 images' : 'References unavailable for this model';
}

function updateOutputLabel() {
    const label = document.getElementById('img-output-label');
    if (!label) return;
    label.textContent = `${imgState.outputCount} ${imgState.outputCount === 1 ? 'image' : 'images'}`;
}

function clampOutputCount(value) {
    const maxOutputs = getMaxOutputCount();
    const next = Math.min(Math.max(1, value || 1), maxOutputs);
    imgState.outputCount = next;
    return next;
}

function getMaxOutputCount() {
    const model = IMAGE_MODELS.find(m => m.id === imgState.model);
    const refCount = model?.supportsReference ? imgState.referenceImages.length : 0;
    let maxOutputs = IMG_MAX_TOTAL_IMAGES - refCount;
    if (!Number.isFinite(maxOutputs) || maxOutputs < 1) maxOutputs = 1;
    if (model?.provider === 'openai') {
        maxOutputs = Math.min(maxOutputs, IMG_MAX_OPENAI_OUTPUTS);
    }
    return maxOutputs;
}

function updateOutputConstraints() {
    const range = document.getElementById('img-output-range');
    const hint = document.getElementById('img-output-hint');
    const model = IMAGE_MODELS.find(m => m.id === imgState.model);
    const supportsRefs = model?.supportsReference;
    const maxOutputs = getMaxOutputCount();
    if (range) {
        range.max = String(maxOutputs);
        imgState.outputCount = clampOutputCount(imgState.outputCount);
        range.value = imgState.outputCount;
    }
    if (hint) {
        const refCount = supportsRefs ? imgState.referenceImages.length : 0;
        hint.textContent = `Max ${maxOutputs} output${maxOutputs === 1 ? '' : 's'} (references: ${refCount}/${IMG_MAX_REFERENCE_IMAGES})`;
    }
    updateOutputLabel();
    updateImgJsonPreview();
}

function parseSizeToMegaPixels(size) {
    if (!size) return null;
    if (size.endsWith('K')) {
        const n = Number(size.replace('K', ''));
        if (!Number.isFinite(n)) return null;
        const px = (1024 * n) ** 2;
        return px / 1e6;
    }
    if (/^\d+x\d+$/.test(size)) {
        const [w, h] = size.split('x').map(n => Number(n));
        if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
        return (w * h) / 1e6;
    }
    return null;
}

function estimateImageCost() {
    const mp = parseSizeToMegaPixels(imgState.size);
    if (!mp) return null;
    const model = IMAGE_MODELS.find(m => m.id === imgState.model);
    const factor = model?.provider === 'openai' ? 1.4 : 1;
    const cost = mp * imgState.outputCount * factor;
    return Math.max(0.01, cost);
}

function updateImgChips() {
    const model = IMAGE_MODELS.find(m => m.id === imgState.model);
    const pillModel = document.getElementById('img-pill-model');
    const pillInputs = document.getElementById('img-pill-inputs');
    const pillSize = document.getElementById('img-pill-size');
    const pillRatio = document.getElementById('img-pill-ratio');
    const pillFormat = document.getElementById('img-pill-format');
    const pillOptimize = document.getElementById('img-pill-optimize');
    const pillOutputs = document.getElementById('img-pill-outputs');
    const pillCost = document.getElementById('img-pill-cost');
    if (pillModel) pillModel.textContent = model ? model.name : 'Model —';
    if (pillInputs) {
        const supportsRefs = model?.supportsReference;
        const refCount = supportsRefs ? imgState.referenceImages.length : 0;
        if (!supportsRefs && imgState.referenceImages.length) {
            pillInputs.textContent = 'Refs disabled';
        } else {
            pillInputs.textContent = refCount ? `Text + ${refCount} ref${refCount > 1 ? 's' : ''}` : 'Text only';
        }
    }
    const baseSize = imgState.baseSize || imgState.size || '—';
    const effectiveSize = imgState.size || baseSize;
    if (pillSize) {
        pillSize.textContent = baseSize !== effectiveSize
            ? `Size ${baseSize} → ${effectiveSize}`
            : `Size ${effectiveSize}`;
    }
    if (pillRatio) {
        const ratioText = imgState.aspectRatio && imgState.aspectRatio !== 'auto'
            ? imgState.aspectRatio
            : 'Auto';
        pillRatio.textContent = `Ratio ${ratioText}`;
    }
    if (pillFormat) {
        const fixed = model?.provider === 'byteplus' && !model?.supportsFormat;
        const fmt = (imgState.format || '—').toUpperCase();
        pillFormat.textContent = fixed ? `Format ${fmt} (fixed)` : `Format ${fmt}`;
    }
    if (pillOptimize) {
        if (model?.supportsOptimize) {
            pillOptimize.textContent = `Optimize ${imgState.optimizeMode === 'fast' ? 'Fast' : 'Standard'}`;
        } else {
            pillOptimize.textContent = 'Optimize Standard';
        }
    }
    if (pillOutputs) pillOutputs.textContent = `${imgState.outputCount} output${imgState.outputCount === 1 ? '' : 's'}`;
    if (pillCost) {
        const cost = estimateImageCost();
        pillCost.textContent = cost ? `Est. cost ~${cost.toFixed(2)} credits` : 'Est. cost —';
    }
}

// ── Request Preview ──────────────────────────────────────────
function buildImgPayload({ preview = false } = {}) {
    const prompt = document.getElementById('img-prompt')?.value.trim();
    const model = IMAGE_MODELS.find(m => m.id === imgState.model);
    const outputCount = clampOutputCount(imgState.outputCount || 1);
    const supportsRefs = !!model?.supportsReference;
    const refImages = supportsRefs ? imgState.referenceImages : [];
    const refPayload = preview
        ? refImages.map((_, idx) => `(reference image ${idx + 1} base64...)`)
        : refImages.map(img => img.dataUrl);
    if (model?.provider === 'openai') {
        if (shouldUseOpenAiResponses({ provider: 'openai', referenceImages: refImages })) {
            return buildOpenAiResponsesPayload({
                prompt: prompt || '(your prompt here)',
                size: imgState.size || '1024x1024',
                format: imgState.format || 'png',
                referenceImages: refPayload,
            });
        }
        return {
            model: imgState.model,
            prompt: prompt || '(your prompt here)',
            size: imgState.size || '1024x1024',
            n: outputCount,
            output_format: imgState.format || 'png',
            moderation: 'low',
        };
    }
    const payload = {
        model: imgState.model,
        prompt: prompt || '(your prompt here)',
        size: imgState.size,
        response_format: 'url',
    };
    if (refPayload.length) payload.image = refPayload.length === 1 ? refPayload[0] : refPayload;
    if (outputCount > 1) {
        payload.sequential_image_generation = 'auto';
        payload.sequential_image_generation_options = { max_images: outputCount };
    }
    if (model?.supportsFormat) payload.output_format = imgState.format;
    if (model?.supportsOptimize && imgState.optimizeMode === 'fast') {
        payload.optimize_prompt_options = { mode: 'fast' };
    }
    return payload;
}

function buildImgPayloadForJob(job) {
    if (job.provider === 'openai') {
        if (shouldUseOpenAiResponses(job)) {
            return buildOpenAiResponsesPayload({
                prompt: job.prompt || '(your prompt here)',
                size: job.size || '1024x1024',
                format: job.format || 'png',
                referenceImages: (job.referenceImages || []).map(img => img.dataUrl || img),
            });
        }
        return {
            model: job.model,
            prompt: job.prompt || '(your prompt here)',
            size: job.size || '1024x1024',
            n: job.outputCount || 1,
            output_format: job.format || 'png',
            moderation: 'low',
        };
    }
    const payload = {
        model: job.model,
        prompt: job.prompt || '(your prompt here)',
        size: job.size,
        response_format: 'url',
    };
    if (job.referenceImages && job.referenceImages.length) {
        payload.image = job.referenceImages.length === 1 ? job.referenceImages[0].dataUrl : job.referenceImages.map(r => r.dataUrl);
    }
    if (job.outputCount > 1) {
        payload.sequential_image_generation = 'auto';
        payload.sequential_image_generation_options = { max_images: job.outputCount };
    }
    if (job.supportsFormat) payload.output_format = job.format;
    if (job.supportsOptimize && job.optimizeMode === 'fast') {
        payload.optimize_prompt_options = { mode: 'fast' };
    }
    return payload;
}

function shouldUseOpenAiResponses(job) {
    return job?.provider === 'openai' && Array.isArray(job.referenceImages) && job.referenceImages.length > 0;
}

function buildOpenAiResponsesPayload({ prompt, size, format, referenceImages = [] }) {
    return {
        model: OPENAI_RESPONSES_MODEL,
        input: [
            {
                role: 'user',
                content: [
                    { type: 'input_text', text: prompt || '(your prompt here)' },
                    ...referenceImages.map(imageUrl => ({
                        type: 'input_image',
                        image_url: imageUrl,
                    })),
                ],
            },
        ],
        tools: [
            {
                type: 'image_generation',
                size: size || '1024x1024',
                output_format: format || 'png',
                moderation: 'low',
            },
        ],
    };
}

function updateImgJsonPreview() {
    const preview = document.getElementById('img-json-preview');
    if (!preview) return;
    preview.textContent = JSON.stringify(buildImgPayload({ preview: true }), null, 2);
    updateImgChips();
}

function setImgResponsePreview(payload) {
    const preview = document.getElementById('img-json-response');
    if (!preview) return;
    preview.textContent = JSON.stringify(payload, null, 2);
}

// ── Reference Images ──────────────────────────────────────────
function initImgReferences() {
    const deck = document.getElementById('img-reference-deck');
    const addBtn = document.getElementById('img-reference-add');
    const input = document.getElementById('img-reference-input');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            if (addBtn.classList.contains('disabled')) return;
            input?.click();
        });
    }
    if (input) {
        input.addEventListener('change', () => {
            if (input.files?.length) addReferenceFiles(input.files);
            input.value = '';
        });
    }
    if (deck) {
        deck.addEventListener('dragover', e => {
            if (deck.classList.contains('disabled')) return;
            e.preventDefault();
            deck.classList.add('dragover');
        });
        deck.addEventListener('dragleave', () => deck.classList.remove('dragover'));
        deck.addEventListener('drop', e => {
            if (deck.classList.contains('disabled')) return;
            e.preventDefault();
            deck.classList.remove('dragover');
            if (e.dataTransfer?.files?.length) addReferenceFiles(e.dataTransfer.files);
        });
    }
}

function renderImgReferenceDeck() {
    const deck = document.getElementById('img-reference-deck');
    if (!deck) return;
    deck.innerHTML = '';
    if (!imgState.referenceImages.length) {
        const empty = document.createElement('div');
        empty.className = 'reference-card empty';
        empty.textContent = 'Add references';
        deck.appendChild(empty);
        return;
    }
    const angles = [-12, -4, 4, 12];
    const display = imgState.referenceImages.slice(0, 4);
    display.forEach((img, idx) => {
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
        const extra = imgState.referenceImages.length > display.length && idx === display.length - 1
            ? `+${imgState.referenceImages.length - display.length} more`
            : `Image ${idx + 1}`;
        label.textContent = extra;
        const remove = document.createElement('button');
        remove.className = 'reference-remove';
        remove.type = 'button';
        remove.textContent = '✕';
        remove.addEventListener('click', e => {
            e.stopPropagation();
            removeImgReference(img.id);
        });
        card.appendChild(image);
        card.appendChild(label);
        card.appendChild(remove);
        deck.appendChild(card);
    });
}

function removeImgReference(id) {
    imgState.referenceImages = imgState.referenceImages.filter(img => img.id !== id);
    renderImgReferenceDeck();
    updateOutputConstraints();
    updateImgJsonPreview();
    updateImgChips();
}

function addReferenceFiles(files) {
    const list = Array.from(files || []).filter(f => f.type.startsWith('image/'));
    if (!list.length) return;
    const remaining = Math.max(0, IMG_MAX_REFERENCE_IMAGES - imgState.referenceImages.length);
    if (!remaining) {
        showToast(`Reference limit reached (${IMG_MAX_REFERENCE_IMAGES}).`, 'info', 'ℹ️');
        return;
    }
    list.slice(0, remaining).forEach(file => {
        const reader = new FileReader();
        reader.onload = ev => {
            imgState.referenceImages.push({
                id: `img-ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                name: file.name,
                dataUrl: ev.target.result,
            });
            renderImgReferenceDeck();
            updateOutputConstraints();
            updateImgJsonPreview();
            updateImgChips();
        };
        reader.readAsDataURL(file);
    });
    if (list.length > remaining) {
        showToast(`Only ${remaining} reference image${remaining === 1 ? '' : 's'} added (limit ${IMG_MAX_REFERENCE_IMAGES}).`, 'info', 'ℹ️');
    }
}

// ── Generate ──────────────────────────────────────────────────
async function handleImageGenerate() {
    const model = IMAGE_MODELS.find(m => m.id === imgState.model);
    const provider = model?.provider || 'byteplus';
    const apiKey = provider === 'openai'
        ? (window.state?.openaiApiKey || localStorage.getItem('vibedstudio_openai_api_key') || '')
        : (window.state?.apiKey || localStorage.getItem('vibedstudio_api_key') || '');
    if (!apiKey) {
        showError(provider === 'openai'
            ? 'No OpenAI API key found.\n\nPlease paste your OpenAI API key in the API key menu first.'
            : 'No API key found.\n\nPlease paste your BytePlus API key in the Generate tab first.');
        return;
    }
    const prompt = document.getElementById('img-prompt')?.value.trim();
    if (!prompt) {
        showError('Please enter a prompt describing the image you want to generate.');
        document.getElementById('img-prompt')?.focus();
        return;
    }
    const job = {
        id: `img-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        prompt,
        model: imgState.model,
        size: imgState.size,
        format: imgState.format,
        outputCount: clampOutputCount(imgState.outputCount || 1),
        optimizeMode: imgState.optimizeMode,
        provider,
        apiKey,
        referenceImages: model?.supportsReference ? imgState.referenceImages.slice(0, IMG_MAX_REFERENCE_IMAGES) : [],
        supportsFormat: model?.provider === 'openai' || model?.supportsFormat,
        supportsOptimize: model?.supportsOptimize,
        startedAt: Date.now(),
    };
    enqueueImageJob(job);
}

function enqueueImageJob(job) {
    imgJobs.set(job.id, job);
    addPendingImageCard(job, 'Generating…');
    startImageJob(job);
}

async function startImageJob(job) {
    imgProcessingCount += 1;
    updateImageQueueStatus();
    if (!job.startedAt) job.startedAt = Date.now();
    updatePendingImageCardStatus(job.id, 'Generating…');
    const timerId = setInterval(() => {
        updatePendingImageCardStatus(job.id, 'Generating…');
    }, 1000);
    try {
        await runImageJob(job);
    } catch (err) {
        console.error(err);
        setImgResponsePreview({ ok: false, error: err.message || String(err) });
        failImageCard(job.id, err.message);
        showError(`Image generation failed:\n\n${err.message}`);
    } finally {
        clearInterval(timerId);
        imgProcessingCount = Math.max(0, imgProcessingCount - 1);
        updateImageQueueStatus();
    }
}

function updateImageQueueStatus() {
    const btn = document.getElementById('img-generate-btn');
    if (!btn) return;
    const label = btn.querySelector('.btn-text');
    if (!label) return;
    if (imgProcessingCount > 0) {
        label.textContent = imgProcessingCount > 1
            ? `Generating (${imgProcessingCount})`
            : 'Generating…';
        return;
    }
    label.textContent = 'Generate Image';
}

async function runImageJob(job) {
    if (shouldUseOpenAiResponses(job)) {
        await runOpenAiResponsesJob(job);
        return;
    }

    const body = buildImgPayloadForJob(job);

    const res = await fetch(job.provider === 'openai' ? OPENAI_IMAGE_API_BASE : IMAGE_API_BASE, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${job.apiKey}`,
        },
        body: JSON.stringify(body),
    });

    const headers = Object.fromEntries(res.headers.entries());
    const contentType = res.headers.get('content-type') || '';
    const rawText = await res.text();
    let payload = null;
    try {
        payload = rawText ? JSON.parse(rawText) : null;
    } catch {
        payload = {
            message: 'Non-JSON response body',
            contentType: contentType || null,
            rawBody: rawText ? rawText.slice(0, 4000) : '',
        };
    }

    if (!res.ok) {
        setImgResponsePreview({
            ok: false,
            status: res.status,
            statusText: res.statusText,
            headers,
            body: payload,
        });
        throw new Error(
            payload?.error?.message
            || payload?.error
            || payload?.message
            || payload?.rawBody
            || `HTTP ${res.status}`
        );
    }

    setImgResponsePreview({
        ok: true,
        status: res.status,
        statusText: res.statusText,
        headers,
        body: payload,
    });

    const dataItems = Array.isArray(payload?.data) ? payload.data : [];
    if (!dataItems.length) throw new Error('No image returned from API');

    const records = [];
    for (let idx = 0; idx < dataItems.length; idx++) {
        const dataItem = dataItems[idx];
        const b64 = dataItem?.b64_json;
        const imageUrl = dataItem?.url || (b64 ? `data:image/${job.format || 'png'};base64,${b64}` : null);
        if (!imageUrl) continue;

        let blob = null;
        try {
            if (imageUrl.startsWith('data:')) {
                const [meta, b64data] = imageUrl.split(',');
                const mime = meta.match(/data:(.*);base64/)?.[1] || 'image/png';
                const bin = atob(b64data);
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                blob = new Blob([arr], { type: mime });
            } else {
                blob = await fetchImageBlob(imageUrl);
            }
        } catch (e) {
            console.warn('Could not fetch image blob (CORS?):', e);
        }

        const record = {
            id: idx === 0 ? job.id : `img-${Date.now()}-${idx}`,
            url: imageUrl,
            blob: blob || null,
            blobUrl: blob ? URL.createObjectURL(blob) : imageUrl,
            prompt: job.prompt,
            model: job.model,
            size: job.size,
            format: job.format,
            provider: job.provider,
            timestamp: new Date().toISOString(),
        };
        records.push(record);
    }

    if (!records.length) throw new Error('No image returned from API');

    for (const record of records) {
        if (window.db) await dbPut('images', record);
    }

    finishImageCard(job.id, records[0]);
    records.slice(1).forEach(record => renderSavedImageCard(record));
    imgState.count += records.length;
    document.getElementById('img-count-badge').textContent = imgState.count;
    if (typeof window.addGeneratedImageToEditor === 'function') {
        records.forEach(record => window.addGeneratedImageToEditor(record));
    }

    showToast(`Image generated! ✨ (${records.length} output${records.length > 1 ? 's' : ''})`, 'success', '🖼️');
}

async function runOpenAiResponsesJob(job) {
    const responses = [];
    const records = [];
    const totalOutputs = Math.max(1, job.outputCount || 1);

    for (let attempt = 0; attempt < totalOutputs; attempt++) {
        const body = buildImgPayloadForJob(job);
        const res = await fetch(OPENAI_RESPONSES_API_BASE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${job.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        const headers = Object.fromEntries(res.headers.entries());
        const contentType = res.headers.get('content-type') || '';
        const rawText = await res.text();
        let payload = null;
        try {
            payload = rawText ? JSON.parse(rawText) : null;
        } catch {
            payload = {
                message: 'Non-JSON response body',
                contentType: contentType || null,
                rawBody: rawText ? rawText.slice(0, 4000) : '',
            };
        }

        responses.push({
            ok: res.ok,
            status: res.status,
            statusText: res.statusText,
            headers,
            body: payload,
        });

        if (!res.ok) {
            setImgResponsePreview({ ok: false, mode: 'responses', responses });
            throw new Error(
                payload?.error?.message
                || payload?.error
                || payload?.message
                || payload?.rawBody
                || `HTTP ${res.status}`
            );
        }

        const imageUrls = extractOpenAiResponseImages(payload, job.format);
        if (!imageUrls.length) {
            setImgResponsePreview({ ok: false, mode: 'responses', responses });
            throw new Error('No image returned from OpenAI Responses API');
        }

        imageUrls.forEach((imageUrl, idx) => {
            const blob = dataUrlToBlobSafe(imageUrl);
            records.push({
                id: records.length === 0 ? job.id : `img-${Date.now()}-${attempt}-${idx}`,
                url: imageUrl,
                blob: blob || null,
                blobUrl: blob ? URL.createObjectURL(blob) : imageUrl,
                prompt: job.prompt,
                model: job.model,
                size: job.size,
                format: job.format,
                provider: job.provider,
                timestamp: new Date().toISOString(),
            });
        });
    }

    setImgResponsePreview({ ok: true, mode: 'responses', responses });

    if (!records.length) throw new Error('No image returned from OpenAI Responses API');

    for (const record of records) {
        if (window.db) await dbPut('images', record);
    }

    finishImageCard(job.id, records[0]);
    records.slice(1).forEach(record => renderSavedImageCard(record));
    imgState.count += records.length;
    document.getElementById('img-count-badge').textContent = imgState.count;
    if (typeof window.addGeneratedImageToEditor === 'function') {
        records.forEach(record => window.addGeneratedImageToEditor(record));
    }

    showToast(`Image generated! ✨ (${records.length} output${records.length > 1 ? 's' : ''})`, 'success', '🖼️');
}

function extractOpenAiResponseImages(payload, format = 'png') {
    const output = Array.isArray(payload?.output) ? payload.output : [];
    return output
        .filter(item => item?.type === 'image_generation_call' && typeof item?.result === 'string' && item.result)
        .map(item => `data:image/${format || 'png'};base64,${item.result}`);
}

function dataUrlToBlobSafe(dataUrl) {
    try {
        if (typeof dataUrlToBlob === 'function') return dataUrlToBlob(dataUrl);
    } catch {
    }
    try {
        const [meta, b64data] = String(dataUrl || '').split(',');
        if (!meta || !b64data) return null;
        const mime = meta.match(/data:(.*?);base64/)?.[1] || 'image/png';
        const bin = atob(b64data);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: mime });
    } catch {
        return null;
    }
}

// ── Load from IndexedDB ────────────────────────────────────────
async function loadImagesFromDB() {
    if (!window.db) return;
    try {
        const records = await dbGetAll('images');
        if (!records.length) return;

        // Sort newest first
        records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        records.forEach(r => {
            // Restore blob URL
            if (r.blob) r.blobUrl = URL.createObjectURL(r.blob);
            else r.blobUrl = r.url;
            renderSavedImageCard(r);
            imgState.count++;
            if (typeof window.addGeneratedImageToEditor === 'function') {
                window.addGeneratedImageToEditor(r);
            }
        });
        document.getElementById('img-count-badge').textContent = imgState.count;

        updateImgEmptyState();
        showToast(`Loaded ${records.length} image${records.length > 1 ? 's' : ''} from history`, 'info', '🖼️');
        applyImgPagination();
    } catch (e) {
        console.warn('Could not load image history:', e);
    }
}

async function refreshImageHistory() {
    if (!window.db) return;
    try {
        const records = await dbGetAll('images');
        for (const r of records) {
            if (r.blob instanceof Blob) continue;
            const url = r.url || r.blobUrl;
            if (!url || url.startsWith('data:')) continue;
            try {
                const blob = await fetchImageBlob(url);
                if (!blob) continue;
                r.blob = blob;
                r.blobUrl = URL.createObjectURL(r.blob);
                await dbPut('images', r);
            } catch {
            }
        }
        window.applyImageHistory(records || []);
        showToast('Image history refreshed', 'info', '🔄');
    } catch (e) {
        console.warn('Image refresh failed:', e);
    }
}

function applyImgPagination() {
    const grid = document.getElementById('img-grid');
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll('.image-card'));
    const totalPages = Math.max(1, Math.ceil(cards.length / IMG_PAGE_SIZE));
    if (imgState.page > totalPages) imgState.page = totalPages;
    if (imgState.page < 1) imgState.page = 1;
    const start = (imgState.page - 1) * IMG_PAGE_SIZE;
    const end = start + IMG_PAGE_SIZE;
    cards.forEach((card, idx) => {
        card.style.display = idx >= start && idx < end ? '' : 'none';
    });
    const prevBtn = document.getElementById('img-prev-page');
    const nextBtn = document.getElementById('img-next-page');
    if (prevBtn) prevBtn.disabled = imgState.page <= 1;
    if (nextBtn) nextBtn.disabled = imgState.page >= totalPages;
}

async function fetchImageBlob(url) {
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

let imgApiSyncInflight = false;
const imgApiLastSync = { byteplus: '', openai: '' };

window.syncImageHistoryFromApi = async function syncImageHistoryFromApi(provider = 'byteplus', { silent = true } = {}) {
    if (imgApiSyncInflight) return;
    const key = provider === 'openai'
        ? (localStorage.getItem('vibedstudio_openai_api_key') || '')
        : (localStorage.getItem('vibedstudio_api_key') || '');
    if (!key) return;
    if (imgApiLastSync[provider] === key && !silent) return;
    if (typeof ensureDBReady === 'function') {
        const ready = await ensureDBReady();
        if (!ready) return;
    }
    if (!window.db || typeof dbGetAll !== 'function' || typeof dbPut !== 'function') return;
    if (location.protocol === 'file:' || location.origin === 'null') return;
    const endpoint = provider === 'openai' ? '/api/openai/images/history' : '/api/image/history';
    imgApiSyncInflight = true;
    try {
        const res = await fetch(endpoint, {
            headers: { 'Authorization': `Bearer ${key}` },
        });
        if (!res.ok) {
            if (!silent) showToast('Image history sync failed', 'error', '❌');
            return;
        }
        const payload = await res.json().catch(() => ({}));
        const list = Array.isArray(payload?.images) ? payload.images : [];
        if (!list.length) {
            if (!silent) showToast('No past images found', 'info', '🖼️');
            return;
        }
        const existing = await dbGetAll('images');
        const byUrl = new Set(existing.map(r => r.url).filter(Boolean));
        const byId = new Set(existing.map(r => r.id).filter(Boolean));
        let added = 0;
        for (const item of list) {
            const url = item?.url;
            if (!url || byUrl.has(url)) continue;
            const id = item?.id || `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            if (byId.has(id)) continue;
            const record = {
                id,
                url,
                blob: null,
                blobUrl: url,
                prompt: item?.prompt || '',
                model: item?.model || imgState.model,
                size: item?.size || imgState.size,
                format: item?.format || imgState.format,
                provider: item?.provider || provider,
                timestamp: item?.timestamp || new Date().toISOString(),
            };
            await dbPut('images', record);
            byUrl.add(url);
            byId.add(id);
            added += 1;
        }
        if (added > 0) {
            const records = await dbGetAll('images');
            window.applyImageHistory(records || []);
            if (!silent) showToast(`Loaded ${added} image${added !== 1 ? 's' : ''} from API`, 'success', '🖼️');
        } else if (!silent) {
            showToast('No new images from API', 'info', '🖼️');
        }
        imgApiLastSync[provider] = key;
    } catch (e) {
        console.warn('Image history sync failed:', e);
        if (!silent) showToast('Image history sync failed', 'error', '❌');
    } finally {
        imgApiSyncInflight = false;
    }
};

async function exportAllImages() {
    if (!window.db) return;
    const records = await dbGetAll('images');
    if (!records.length) {
        showToast('No images to export', 'info', '🖼️');
        return;
    }

    const getExt = blob => {
        const type = (blob?.type || '').toLowerCase();
        if (type.includes('png')) return 'png';
        if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
        if (type.includes('webp')) return 'webp';
        return (imgState.format || 'png').toLowerCase();
    };

    const fetchBlobForRecord = async record => {
        if (record.blob instanceof Blob) return record.blob;
        const url = record.url || record.blobUrl;
        if (!url) return null;
        return await fetchImageBlob(url);
    };

    const hasProgress = typeof window.startExportProgress === 'function'
        && typeof window.updateExportProgress === 'function'
        && typeof window.finishExportProgress === 'function';

    if (typeof window.showDirectoryPicker === 'function') {
        if (hasProgress) window.startExportProgress(records.length, 'Exporting images…');
        try {
            const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            let exported = 0;
            for (let i = 0; i < records.length; i += 1) {
                const r = records[i];
                const blob = await fetchBlobForRecord(r);
                if (hasProgress) window.updateExportProgress(i + 1, records.length, r.prompt || r.id);
                if (!blob) continue;
                const ext = getExt(blob);
                const name = `vibedstudio-${String(r.id).slice(-10)}.${ext}`;
                const fileHandle = await dirHandle.getFileHandle(name, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();
                exported += 1;
            }
            if (hasProgress) window.finishExportProgress();
            showToast(`Exported ${exported} image${exported !== 1 ? 's' : ''}`, 'success', '📁');
            return;
        } catch (err) {
            if (hasProgress) window.finishExportProgress();
            if (err && err.name === 'AbortError') return;
            throw err;
        }
    }

    let exported = 0;
    if (hasProgress) window.startExportProgress(records.length, 'Exporting images…');
    try {
        for (let i = 0; i < records.length; i += 1) {
            const r = records[i];
            const blob = await fetchBlobForRecord(r);
            if (hasProgress) window.updateExportProgress(i + 1, records.length, r.prompt || r.id);
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
    } finally {
        if (hasProgress) window.finishExportProgress();
    }
    showToast(`Exported ${exported} image${exported !== 1 ? 's' : ''}`, 'success', '📁');
}

// ── Card rendering ────────────────────────────────────────────
function addPendingImageCard(job, statusText = 'Generating…') {
    updateImgEmptyState(true);
    const grid = document.getElementById('img-grid');
    const card = document.createElement('div');
    card.className = 'image-card';
    card.id = `img-card-${job.id}`;
    const modelName = IMAGE_MODELS.find(m => m.id === job.model)?.name || job.model;
    const timerText = statusText.startsWith('Queued') ? '0s' : formatElapsed(0);
    card.innerHTML = `
        <div class="image-card-thumb">
            <div class="img-generating">
                <span class="spinner purple"></span>
                <span class="img-generating-text">${statusText}</span>
                <span class="img-generating-timer" id="img-timer-${job.id}">${timerText}</span>
            </div>
        </div>
        <div class="image-card-info">
            <div class="image-card-prompt">${escImg(job.prompt)}</div>
            <div class="image-card-meta">
                <span class="image-tag purple">${escImg(modelName)}</span>
                <span class="image-tag cyan">${job.size}</span>
                <span class="image-tag">${(job.format || 'png').toUpperCase()}</span>
            </div>
        </div>`;
    grid.insertBefore(card, grid.firstChild);
}

function updatePendingImageCardStatus(id, text) {
    const card = document.getElementById(`img-card-${id}`);
    const label = card?.querySelector('.img-generating-text');
    if (label) label.textContent = text || 'Generating…';
    const timer = card?.querySelector('.img-generating-timer');
    const job = imgJobs.get(id);
    if (timer && job?.startedAt) {
        timer.textContent = formatElapsed((Date.now() - job.startedAt) / 1000);
    }
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

async function resolveImageRecordById(id) {
    if (window.db && typeof dbGetAll === 'function') {
        try {
            const records = await dbGetAll('images');
            const match = records.find(r => r.id === id);
            if (match) return match;
        } catch {
        }
    }
    const img = document.querySelector(`#img-card-${CSS.escape(id)} img`);
    if (!img) return null;
    return { id, url: img.src, blobUrl: img.src, prompt: img.alt || '' };
}

async function addReferenceFromRecord(record) {
    if (!record) return;
    if (imgState.referenceImages.length >= IMG_MAX_REFERENCE_IMAGES) {
        showToast(`Reference limit reached (${IMG_MAX_REFERENCE_IMAGES}).`, 'info', 'ℹ️');
        return;
    }
    let dataUrl = null;
    if (record.blob instanceof Blob) {
        dataUrl = await blobToDataUrl(record.blob);
    } else if (record.blobBase64 && String(record.blobBase64).startsWith('data:')) {
        dataUrl = record.blobBase64;
    } else if (record.blobUrl && String(record.blobUrl).startsWith('data:')) {
        dataUrl = record.blobUrl;
    } else {
        const src = record.url || record.blobUrl;
        if (src) {
            const blob = await fetchImageBlob(src);
            if (blob) dataUrl = await blobToDataUrl(blob);
        }
    }
    if (!dataUrl) {
        showToast('Could not load image data for reference', 'error', '❌');
        return;
    }
    imgState.referenceImages.push({
        id: `img-ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: record.prompt || record.id || 'Reference',
        dataUrl,
    });
    renderImgReferenceDeck();
    updateOutputConstraints();
    updateImgJsonPreview();
    updateImgChips();
    showToast('Added to reference images', 'success', '🧩');
}

window.remixImageToReferences = async function remixImageToReferences(id) {
    const record = await resolveImageRecordById(id);
    await addReferenceFromRecord(record);
};

function finishImageCard(id, record) {
    const card = document.getElementById(`img-card-${id}`);
    if (!card) return;
    const thumb = card.querySelector('.image-card-thumb');
    const modelName = IMAGE_MODELS.find(m => m.id === record.model)?.name || record.model;
    const timeStr = new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    thumb.innerHTML = `
        <img src="${record.blobUrl}" alt="${escImg(record.prompt)}" loading="lazy" />
        <div class="image-card-overlay">
            <a class="img-action-btn primary" href="${record.blobUrl}" download="vibedstudio-${id}.${record.format || 'png'}" title="Download">
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 2V17M12 17L7 12M12 17L17 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 20H21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                Download
            </a>
            <button class="img-action-btn" onclick="remixImageToReferences('${id}')" title="Remix to references">
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 3v4M12 17v4M4 12h4M16 12h4M6.5 6.5l2.8 2.8M14.7 14.7l2.8 2.8M17.5 6.5l-2.8 2.8M9.3 14.7l-2.8 2.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                Remix
            </button>
            <button class="img-action-btn" onclick="copyImgUrl('${record.url}')" title="Copy URL">
                <svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4C2.895 15 2 14.105 2 13V4C2 2.895 2.895 2 4 2H13C14.105 2 15 2.895 15 4V5" stroke="currentColor" stroke-width="2"/></svg>
                Copy URL
            </button>
            <button class="img-action-btn danger" onclick="deleteImage('${id}')" title="Delete">
                <svg viewBox="0 0 24 24" fill="none"><path d="M3 6H21M8 6V4H16V6M19 6L18 20H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
        </div>`;

    const cachedTag = record.blob ? '<span class="image-tag cached">Cached</span>' : '';
    card.querySelector('.image-card-meta').innerHTML = `
        <span class="image-tag purple">${escImg(modelName)}</span>
        <span class="image-tag cyan">${record.size}</span>
        <span class="image-tag">${(record.format || 'PNG').toUpperCase()}</span>
        ${cachedTag}
        <span class="image-tag" style="margin-left:auto;opacity:0.6;">${timeStr}</span>`;
    bindImageCardPreview(card, record);
}

function failImageCard(id, msg) {
    const card = document.getElementById(`img-card-${id}`);
    if (!card) return;
    const thumb = card.querySelector('.image-card-thumb');
    thumb.innerHTML = `
        <div class="img-generating">
            <span style="font-size:24px;">✕</span>
            <span class="img-generating-text" style="color:var(--red);">Failed</span>
        </div>`;
    setTimeout(() => {
        card.style.transition = 'opacity 0.3s'; card.style.opacity = '0';
        setTimeout(() => card.remove(), 300);
    }, 3000);
}

function renderSavedImageCard(record) {
    const grid = document.getElementById('img-grid');
    if (!grid) return;
    const card = document.createElement('div');
    card.className = 'image-card';
    card.id = `img-card-${record.id}`;
    const modelName = IMAGE_MODELS.find(m => m.id === record.model)?.name || record.model;
    const timeStr = new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    card.innerHTML = `
        <div class="image-card-thumb">
            <img src="${record.blobUrl}" alt="${escImg(record.prompt)}" loading="lazy" />
            <div class="image-card-overlay">
                <a class="img-action-btn primary" href="${record.blobUrl}" download="vibedstudio-${record.id}.${record.format || 'png'}">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M12 2V17M12 17L7 12M12 17L17 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 20H21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    Download
                </a>
                <button class="img-action-btn" onclick="remixImageToReferences('${record.id}')">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M12 3v4M12 17v4M4 12h4M16 12h4M6.5 6.5l2.8 2.8M14.7 14.7l2.8 2.8M17.5 6.5l-2.8 2.8M9.3 14.7l-2.8 2.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                    Remix
                </button>
                <button class="img-action-btn" onclick="copyImgUrl('${record.url}')">
                    <svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4C2.895 15 2 14.105 2 13V4C2 2.895 2.895 2 4 2H13C14.105 2 15 2.895 15 4V5" stroke="currentColor" stroke-width="2"/></svg>
                    Copy URL
                </button>
                <button class="img-action-btn danger" onclick="deleteImage('${record.id}')">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M3 6H21M8 6V4H16V6M19 6L18 20H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                </button>
            </div>
        </div>
        <div class="image-card-info">
            <div class="image-card-prompt">${escImg(record.prompt)}</div>
            <div class="image-card-meta">
                <span class="image-tag purple">${escImg(modelName)}</span>
                <span class="image-tag cyan">${record.size}</span>
                <span class="image-tag">${(record.format || 'PNG').toUpperCase()}</span>
                ${record.blob ? '<span class="image-tag cached">Cached</span>' : ''}
                <span class="image-tag" style="margin-left:auto;opacity:0.6;">${timeStr}</span>
            </div>
        </div>`;
    bindImageCardPreview(card, record);
    grid.appendChild(card);
    applyImgPagination();
}

function initImagePreviewModal() {
    if (!imgPreviewModal || imgPreviewModal.dataset.bound === '1') return;
    imgPreviewModal.dataset.bound = '1';
    imgPreviewClose?.addEventListener('click', closeImagePreviewModal);
    imgPreviewPrev?.addEventListener('click', () => stepImagePreview(-1));
    imgPreviewNext?.addEventListener('click', () => stepImagePreview(1));
    imgPreviewModal.addEventListener('click', e => {
        if (e.target === imgPreviewModal) closeImagePreviewModal();
    });
    document.addEventListener('keydown', e => {
        if (imgPreviewModal.classList.contains('hidden')) return;
        if (e.key === 'Escape' && !imgPreviewModal.classList.contains('hidden')) {
            closeImagePreviewModal();
            return;
        }
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            stepImagePreview(-1);
        }
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            stepImagePreview(1);
        }
    });
}

function bindImageCardPreview(card, record) {
    const thumb = card?.querySelector('.image-card-thumb');
    const img = thumb?.querySelector('img');
    if (!thumb || !img) return;
    card._previewRecord = record;
    thumb.style.cursor = 'zoom-in';
    thumb.setAttribute('role', 'button');
    thumb.setAttribute('tabindex', '0');
    thumb.setAttribute('aria-label', 'Open image preview');
    if (thumb.dataset.previewBound === '1') return;
    thumb.dataset.previewBound = '1';
    const open = event => {
        if (event.type === 'click' && event.target.closest('.img-action-btn')) return;
        if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
        if (event.type === 'keydown') event.preventDefault();
        openImagePreviewModal(record);
    };
    thumb.addEventListener('click', open);
    thumb.addEventListener('keydown', open);
}

function openImagePreviewModal(record) {
    if (!imgPreviewModal || !imgPreviewImg || !record) return;
    imgPreviewRecords = getPreviewableImageRecords();
    imgPreviewIndex = imgPreviewRecords.findIndex(item => item?.id === record.id);
    if (imgPreviewIndex < 0) {
        imgPreviewRecords = [record];
        imgPreviewIndex = 0;
    }
    renderImagePreview();
    imgPreviewModal.classList.remove('hidden');
}

function closeImagePreviewModal() {
    if (!imgPreviewModal) return;
    imgPreviewModal.classList.add('hidden');
    if (imgPreviewImg) {
        imgPreviewImg.removeAttribute('src');
        imgPreviewImg.alt = '';
    }
    if (imgPreviewCaption) imgPreviewCaption.textContent = '';
    if (imgPreviewTitle) imgPreviewTitle.textContent = 'Image Preview';
    imgPreviewRecords = [];
    imgPreviewIndex = -1;
}

function getPreviewableImageRecords() {
    const grid = document.getElementById('img-grid');
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('.image-card'))
        .map(card => card._previewRecord)
        .filter(record => record && (record.blobUrl || record.url));
}

function renderImagePreview() {
    if (!imgPreviewImg || !imgPreviewRecords.length || imgPreviewIndex < 0) return;
    const total = imgPreviewRecords.length;
    const record = imgPreviewRecords[imgPreviewIndex];
    const src = record.blobUrl || record.url;
    if (!src) return;
    imgPreviewImg.src = src;
    imgPreviewImg.alt = record.prompt || 'Generated image preview';
    if (imgPreviewCaption) {
        const prompt = record.prompt || 'Generated image';
        imgPreviewCaption.textContent = total > 1 ? `${imgPreviewIndex + 1} / ${total} · ${prompt}` : prompt;
    }
    if (imgPreviewTitle) imgPreviewTitle.textContent = record.model ? `Image Preview · ${record.model}` : 'Image Preview';
    const showNav = total > 1;
    if (imgPreviewPrev) imgPreviewPrev.hidden = !showNav;
    if (imgPreviewNext) imgPreviewNext.hidden = !showNav;
}

function stepImagePreview(direction) {
    if (!imgPreviewRecords.length) return;
    const total = imgPreviewRecords.length;
    imgPreviewIndex = (imgPreviewIndex + direction + total) % total;
    renderImagePreview();
}

// ── Delete image ──────────────────────────────────────────────
window.deleteImage = async function deleteImage(id) {
    if (window.db) await dbDelete('images', id).catch(() => { });
    if (typeof window.removeMediaItemById === 'function') {
        window.removeMediaItemById(id);
    }
    const card = document.getElementById(`img-card-${id}`);
    if (card) {
        card.style.transition = 'opacity 0.25s, transform 0.25s';
        card.style.opacity = '0'; card.style.transform = 'scale(0.95)';
        setTimeout(() => { card.remove(); imgState.count = Math.max(0, imgState.count - 1); document.getElementById('img-count-badge').textContent = imgState.count; updateImgEmptyState(); }, 260);
    }
};

// ── Copy URL ──────────────────────────────────────────────────
window.copyImgUrl = async function copyImgUrl(url) {
    try {
        await navigator.clipboard.writeText(url);
        showToast('URL copied!', 'success', '📋');
    } catch { showToast('Could not copy URL', 'error', '❌'); }
};

// ── Empty state ────────────────────────────────────────────────
function updateImgEmptyState(forceHide) {
    const empty = document.getElementById('img-empty-state');
    const grid = document.getElementById('img-grid');
    if (!empty || !grid) return;
    const hasCards = grid.children.length > 0;
    empty.style.display = (hasCards || forceHide) ? 'none' : 'flex';
}

// ── Helpers ────────────────────────────────────────────────────
window.ensureImageCached = async function ensureImageCached(id, { silent = false } = {}) {
    if (!window.db || !id) return null;
    try {
        const records = await dbGetAll('images');
        const record = records.find(r => r.id === id);
        if (!record) return null;
        if (record.blob instanceof Blob) return record.blobUrl || URL.createObjectURL(record.blob);
        const url = record.url || record.blobUrl;
        if (!url || url.startsWith('data:')) return url;
        const blob = await fetchImageBlob(url);
        if (!blob) return null;
        record.blob = blob;
        record.blobUrl = URL.createObjectURL(blob);
        await dbPut('images', record);
        if (!silent) showToast('Image cached', 'success', '🗂️');
        return record.blobUrl;
    } catch (e) {
        if (!silent) showToast('Could not cache image', 'error', '❌');
        return null;
    }
};

function escImg(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
