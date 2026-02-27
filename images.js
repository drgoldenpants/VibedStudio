/* ============================================================
   VibedStudio AI Video Studio — images.js
   Seedream image generation + IndexedDB persistence
   ============================================================ */

const IMAGE_API_BASE = '/api/image';

const IMAGE_MODELS = [
    { id: 'seedream-5-0-260128', name: 'Seedream 5.0', badge: 'NEW', sizes: ['2K', '3K'] },
    { id: 'seedream-4-5-251128', name: 'Seedream 4.5', badge: '', sizes: ['2K', '4K'] },
    { id: 'seedream-4-0-250828', name: 'Seedream 4.0', badge: '', sizes: ['1K', '2K', '4K'] },
];

const imgState = {
    model: 'seedream-5-0-260128',
    size: '2K',
    format: 'png',
    count: 0,
};

let imagesInited = false;

// ── Init ──────────────────────────────────────────────────────
window.initImages = async function initImages() {
    if (imagesInited) return;
    imagesInited = true;

    // Render model cards
    renderImgModelGrid();

    // Size picker
    document.querySelectorAll('.img-size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.img-size-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            imgState.size = btn.dataset.size;
            updateImgJsonPreview();
        });
    });

    // Format picker
    document.querySelectorAll('.img-format-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.img-format-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            imgState.format = btn.dataset.format;
            updateImgJsonPreview();
        });
    });

    // Generate button
    document.getElementById('img-generate-btn').addEventListener('click', handleImageGenerate);

    // Char count
    const ta = document.getElementById('img-prompt');
    if (ta) {
        ta.addEventListener('input', () => {
            document.getElementById('img-char-count').textContent = ta.value.length;
            updateImgJsonPreview();
        });
    }

    const copyBtn = document.getElementById('img-copy-json');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const payload = buildImgPayload();
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

    updateImgJsonPreview();
    setImgResponsePreview({ status: 'idle' });
    await loadImagesFromDB();
};

// ── Model grid ────────────────────────────────────────────────
function renderImgModelGrid() {
    const grid = document.getElementById('img-model-grid');
    if (!grid) return;
    grid.innerHTML = IMAGE_MODELS.map(m => `
        <label class="model-card ${m.id === imgState.model ? 'selected' : ''}" data-model="${m.id}">
            <input type="radio" name="img-model" value="${m.id}" ${m.id === imgState.model ? 'checked' : ''} hidden />
            ${m.badge ? `<div class="model-badge pro">${m.badge}</div>` : '<div class="model-badge lite">IMG</div>'}
            <div class="model-name">${m.name}</div>
            <div class="model-desc">Sizes: ${m.sizes.join(', ')}</div>
        </label>`).join('');

    grid.querySelectorAll('.model-card').forEach(card => {
        card.addEventListener('click', () => {
            grid.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            imgState.model = card.dataset.model;
            // Update valid sizes for this model
            updateSizeButtons();
            updateImgJsonPreview();
        });
    });
}

function updateSizeButtons() {
    const model = IMAGE_MODELS.find(m => m.id === imgState.model);
    if (!model) return;
    document.querySelectorAll('.img-size-btn').forEach(btn => {
        const valid = model.sizes.includes(btn.dataset.size);
        btn.disabled = !valid;
        if (!valid && btn.classList.contains('selected')) {
            btn.classList.remove('selected');
            // Select first valid
            const first = document.querySelector(`.img-size-btn[data-size="${model.sizes[0]}"]`);
            if (first) { first.classList.add('selected'); imgState.size = model.sizes[0]; }
        }
    });
    updateImgJsonPreview();
}

// ── Request Preview ──────────────────────────────────────────
function buildImgPayload() {
    const prompt = document.getElementById('img-prompt')?.value.trim();
    return {
        model: imgState.model,
        prompt: prompt || '(your prompt here)',
        size: imgState.size,
        n: 1,
        response_format: 'url',
        output_format: imgState.format,
    };
}

function updateImgJsonPreview() {
    const preview = document.getElementById('img-json-preview');
    if (!preview) return;
    preview.textContent = JSON.stringify(buildImgPayload(), null, 2);
}

function setImgResponsePreview(payload) {
    const preview = document.getElementById('img-json-response');
    if (!preview) return;
    preview.textContent = JSON.stringify(payload, null, 2);
}

// ── Generate ──────────────────────────────────────────────────
async function handleImageGenerate() {
    const apiKey = window.state?.apiKey || localStorage.getItem('vibedstudio_api_key') || '';
    if (!apiKey) {
        showError('No API key found.\n\nPlease paste your BytePlus API key in the Generate tab first.');
        return;
    }
    const prompt = document.getElementById('img-prompt')?.value.trim();
    if (!prompt) {
        showError('Please enter a prompt describing the image you want to generate.');
        document.getElementById('img-prompt')?.focus();
        return;
    }

    const cost = 5;

    const genBtn = document.getElementById('img-generate-btn');
    genBtn.disabled = true;
    genBtn.querySelector('.btn-text').textContent = 'Generating…';

    // Show a pending card
    const pendingId = 'img-' + Date.now();
    addPendingImageCard(pendingId, prompt);

    let responseSet = false;
    try {
        const body = {
            model: imgState.model,
            prompt,
            size: imgState.size,
            n: 1,
            response_format: 'url',
            output_format: imgState.format,
        };

        const res = await fetch(IMAGE_API_BASE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
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
            setImgResponsePreview({
                ok: false,
                status: res.status,
                statusText: res.statusText,
                headers,
                body: payload,
            });
            responseSet = true;
            throw new Error(payload?.error?.message || payload?.message || `HTTP ${res.status}`);
        }

        setImgResponsePreview({
            ok: true,
            status: res.status,
            statusText: res.statusText,
            headers,
            body: payload,
        });
        responseSet = true;

        const imageUrl = payload?.data?.[0]?.url;
        if (!imageUrl) throw new Error('No image URL returned from API');

        // Fetch blob for local storage
        let blob = null;
        try {
            const imgRes = await fetch(imageUrl);
            blob = await imgRes.blob();
        } catch (e) {
            console.warn('Could not fetch image blob (CORS?):', e);
        }

        const record = {
            id: pendingId,
            url: imageUrl,
            blob: blob || null,
            blobUrl: blob ? URL.createObjectURL(blob) : imageUrl,
            prompt,
            model: imgState.model,
            size: imgState.size,
            format: imgState.format,
            timestamp: new Date().toISOString(),
        };

        // Save to IndexedDB
        if (window.db) await dbPut('images', record);

        // Update the pending card to show the image
        finishImageCard(pendingId, record);
        imgState.count++;
        document.getElementById('img-count-badge').textContent = imgState.count;

        showToast('Image generated! ✨', 'success', '🖼️');

    } catch (err) {
        console.error(err);
        if (!responseSet) {
            setImgResponsePreview({ ok: false, error: err.message || String(err) });
        }
        failImageCard(pendingId, err.message);
        showError(`Image generation failed:\n\n${err.message}`);
    } finally {
        genBtn.disabled = false;
        genBtn.querySelector('.btn-text').textContent = 'Generate Image';
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
        });
        document.getElementById('img-count-badge').textContent = imgState.count;

        updateImgEmptyState();
        showToast(`Loaded ${records.length} image${records.length > 1 ? 's' : ''} from history`, 'info', '🖼️');
    } catch (e) {
        console.warn('Could not load image history:', e);
    }
}

// ── Card rendering ────────────────────────────────────────────
function addPendingImageCard(id, prompt) {
    updateImgEmptyState(true);
    const grid = document.getElementById('img-grid');
    const card = document.createElement('div');
    card.className = 'image-card';
    card.id = `img-card-${id}`;
    const modelName = IMAGE_MODELS.find(m => m.id === imgState.model)?.name || imgState.model;
    card.innerHTML = `
        <div class="image-card-thumb">
            <div class="img-generating">
                <span class="spinner purple"></span>
                <span class="img-generating-text">Generating…</span>
            </div>
        </div>
        <div class="image-card-info">
            <div class="image-card-prompt">${escImg(prompt)}</div>
            <div class="image-card-meta">
                <span class="image-tag purple">${escImg(modelName)}</span>
                <span class="image-tag cyan">${imgState.size}</span>
                <span class="image-tag">${imgState.format.toUpperCase()}</span>
            </div>
        </div>`;
    grid.insertBefore(card, grid.firstChild);
}

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
            <button class="img-action-btn" onclick="copyImgUrl('${record.url}')" title="Copy URL">
                <svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4C2.895 15 2 14.105 2 13V4C2 2.895 2.895 2 4 2H13C14.105 2 15 2.895 15 4V5" stroke="currentColor" stroke-width="2"/></svg>
                Copy URL
            </button>
            <button class="img-action-btn danger" onclick="deleteImage('${id}')" title="Delete">
                <svg viewBox="0 0 24 24" fill="none"><path d="M3 6H21M8 6V4H16V6M19 6L18 20H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
        </div>`;

    card.querySelector('.image-card-meta').innerHTML = `
        <span class="image-tag purple">${escImg(modelName)}</span>
        <span class="image-tag cyan">${record.size}</span>
        <span class="image-tag">${(record.format || 'PNG').toUpperCase()}</span>
        <span class="image-tag" style="margin-left:auto;opacity:0.6;">${timeStr}</span>`;
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
                <span class="image-tag" style="margin-left:auto;opacity:0.6;">${timeStr}</span>
            </div>
        </div>`;
    grid.appendChild(card);
}

// ── Delete image ──────────────────────────────────────────────
window.deleteImage = async function deleteImage(id) {
    if (window.db) await dbDelete('images', id).catch(() => { });
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
function escImg(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
