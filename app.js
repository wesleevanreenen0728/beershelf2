/* ============================================================
   BeerShelf — vanilla JS, IndexedDB-backed, offline-first
   ============================================================ */

/* ---------------- IndexedDB helper ---------------- */
const DB_NAME = 'beershelf-db';
const DB_VERSION = 1;
let dbPromise = new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('beers')) {
      db.createObjectStore('beers', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('settings')) {
      db.createObjectStore('settings', { keyPath: 'key' });
    }
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function idbAll(store) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(store, value) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDelete(store, key) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbClear(store) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(store, key) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ---------------- state ---------------- */
let beers = [];       // in-memory cache
let settings = {};    // in-memory cache
let editingId = null; // id of beer being edited, or null for "add new"
let addStep = 1;
let rawPhotoDataUrl = null;   // pristine captured photo
let rotationDeg = 0;
let croppedDataUrl = null;    // final cropped image for the beer being added/edited

/* ---------------- boot ---------------- */
window.addEventListener('DOMContentLoaded', async () => {
  beers = await idbAll('beers');
  const settingsRows = await idbAll('settings');
  settingsRows.forEach(r => settings[r.key] = r.value);

  applyBackground();
  renderShelf();
  renderCollection();
  renderStats();
  bindNav();
  bindShelf();
  bindAddFlow();
  bindDetailModal();
  bindSettings();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
});

/* ---------------- navigation ---------------- */
function bindNav() {
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => goToView(btn.dataset.nav));
  });
}
function goToView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
  if (name === 'collection') renderCollection();
  if (name === 'stats') renderStats();
}

/* ---------------- shelf ---------------- */
function bindShelf() {
  document.getElementById('addBeerBtn').addEventListener('click', () => openAddFlow());
  document.getElementById('shelfSearch').addEventListener('input', renderShelf);
}
function starString(n) {
  n = Math.round(n || 0);
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}
function renderShelf() {
  const grid = document.getElementById('shelfGrid');
  const empty = document.getElementById('shelfEmpty');
  const q = (document.getElementById('shelfSearch').value || '').toLowerCase();
  const list = beers
    .filter(b => !q || (b.name + b.brewery + b.style).toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt);

  grid.innerHTML = '';
  empty.hidden = list.length > 0 || q !== '';
  if (list.length === 0 && q !== '') {
    grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#b7ab9a;padding:30px 0;">No matches.</p>';
    return;
  }
  list.forEach(b => {
    const tile = document.createElement('div');
    tile.className = 'can-tile';
    tile.innerHTML = `
      <img src="${b.image}" alt="${escapeHtml(b.name)}">
      <div class="ct-name">${escapeHtml(b.name || 'Unnamed')}</div>
      <div class="ct-stars">${starString(b.rating)}</div>
    `;
    tile.addEventListener('click', () => openDetail(b.id));
    grid.appendChild(tile);
  });
}
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------------- collection ---------------- */
function renderCollection() {
  const sortSelect = document.getElementById('sortSelect');
  if (!sortSelect.dataset.bound) {
    sortSelect.addEventListener('change', renderCollection);
    sortSelect.dataset.bound = '1';
  }
  const mode = sortSelect.value;
  let list = [...beers];
  if (mode === 'new') list.sort((a, b) => b.createdAt - a.createdAt);
  else if (mode === 'old') list.sort((a, b) => a.createdAt - b.createdAt);
  else if (mode === 'rating') list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  else if (mode === 'name') list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  else if (mode === 'brewery') list.sort((a, b) => (a.brewery || '').localeCompare(b.brewery || ''));

  const el = document.getElementById('collectionList');
  el.innerHTML = '';
  if (list.length === 0) {
    el.innerHTML = '<p style="text-align:center;color:#b7ab9a;padding:30px 0;">No beers yet.</p>';
    return;
  }
  list.forEach(b => {
    const row = document.createElement('div');
    row.className = 'collection-row';
    row.innerHTML = `
      <img src="${b.image}" alt="">
      <div class="cr-info">
        <div class="cr-name">${escapeHtml(b.name || 'Unnamed')}</div>
        <div class="cr-brewery">${escapeHtml(b.brewery || '')}${b.style ? ' · ' + escapeHtml(b.style) : ''}</div>
        <div class="cr-stars">${starString(b.rating)}</div>
      </div>
    `;
    row.addEventListener('click', () => openDetail(b.id));
    el.appendChild(row);
  });
}

/* ---------------- stats ---------------- */
function renderStats() {
  const el = document.getElementById('statsContent');
  if (beers.length === 0) {
    el.innerHTML = '<p style="text-align:center;color:#b7ab9a;padding:30px 0;">Add some beers to see stats.</p>';
    return;
  }
  const total = beers.length;
  const avg = (beers.reduce((s, b) => s + (Number(b.rating) || 0), 0) / total).toFixed(1);
  const breweries = new Set(beers.map(b => b.brewery).filter(Boolean)).size;

  const styleCounts = {};
  beers.forEach(b => {
    const s = b.style && b.style.trim() ? b.style.trim() : 'Unspecified';
    styleCounts[s] = (styleCounts[s] || 0) + 1;
  });
  const styleEntries = Object.entries(styleCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxCount = Math.max(...styleEntries.map(e => e[1]), 1);

  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-big">${total}</div><div class="stat-label">Total Beers</div></div>
      <div class="stat-card"><div class="stat-big">${avg}</div><div class="stat-label">Average Rating</div></div>
      <div class="stat-card"><div class="stat-big">${breweries}</div><div class="stat-label">Breweries</div></div>
      <div class="stat-card"><div class="stat-big">${styleEntries.length}</div><div class="stat-label">Styles Tried</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-label" style="margin-bottom:6px;">Top Styles</div>
      ${styleEntries.map(([s, c]) => `
        <div class="bar-row">
          <span style="width:90px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(c / maxCount) * 100}%"></div></div>
          <span style="width:18px;text-align:right;">${c}</span>
        </div>
      `).join('')}
    </div>
  `;
}

/* ---------------- settings ---------------- */
function applyBackground() {
  const hero = document.getElementById('heroBg');
  if (settings.bgImage) {
    hero.style.backgroundImage = `linear-gradient(180deg, rgba(10,8,6,0.55), rgba(10,8,6,0.75)), url('${settings.bgImage}')`;
  } else {
    hero.style.backgroundImage = '';
  }
}
function bindSettings() {
  const bgFileInput = document.getElementById('bgFileInput');
  document.getElementById('bgUploadBtn').addEventListener('click', () => bgFileInput.click());
  bgFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await resizeImageFile(file, 1200, 0.85);
    settings.bgImage = dataUrl;
    await idbPut('settings', { key: 'bgImage', value: dataUrl });
    applyBackground();
    bgFileInput.value = '';
  });
  document.getElementById('bgResetBtn').addEventListener('click', async () => {
    delete settings.bgImage;
    await idbDelete('settings', 'bgImage');
    applyBackground();
  });

  document.getElementById('exportBtn').addEventListener('click', async () => {
    const data = { beers, settings, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `beershelf-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  });

  const importFileInput = document.getElementById('importFileInput');
  document.getElementById('importBtn').addEventListener('click', () => importFileInput.click());
  importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data.beers)) throw new Error('bad format');
      if (!confirm(`Import ${data.beers.length} beers? This will be merged into your current collection.`)) return;
      for (const b of data.beers) await idbPut('beers', b);
      if (data.settings) {
        for (const [k, v] of Object.entries(data.settings)) {
          settings[k] = v;
          await idbPut('settings', { key: k, value: v });
        }
      }
      beers = await idbAll('beers');
      applyBackground();
      renderShelf(); renderCollection(); renderStats();
      alert('Import complete.');
    } catch (err) {
      alert('Could not import this file.');
    }
    importFileInput.value = '';
  });

  document.getElementById('clearAllBtn').addEventListener('click', async () => {
    if (!confirm('Delete ALL beers? This cannot be undone.')) return;
    await idbClear('beers');
    beers = [];
    renderShelf(); renderCollection(); renderStats();
  });
}

/* ---------------- image resize helper ---------------- */
function resizeImageFile(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ============================================================
   ADD / EDIT FLOW
   ============================================================ */
function bindAddFlow() {
  const cameraInput = document.getElementById('cameraInput');
  document.getElementById('takePhotoBtn').addEventListener('click', () => {
    cameraInput.removeAttribute('data-nolib');
    cameraInput.setAttribute('capture', 'environment');
    cameraInput.click();
  });
  document.getElementById('choosePhotoBtn').addEventListener('click', () => {
    cameraInput.removeAttribute('capture');
    cameraInput.click();
  });
  cameraInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      rawPhotoDataUrl = reader.result;
      rotationDeg = 0;
      const prev = document.getElementById('capturePreview');
      prev.src = rawPhotoDataUrl;
      prev.hidden = false;
      document.getElementById('captureHint').hidden = true;
    };
    reader.readAsDataURL(file);
    cameraInput.value = '';
  });

  document.getElementById('addBack').addEventListener('click', () => {
    if (addStep === 1) { closeAddFlow(); return; }
    if (addStep === 3 && editingId) { closeAddFlow(); openDetail(editingId); return; }
    goToAddStepIdx(addStep - 1);
  });
  document.getElementById('addNext').addEventListener('click', onAddNext);

  document.getElementById('rotateBtn').addEventListener('click', () => {
    rotationDeg = (rotationDeg + 90) % 360;
    renderRotatedImage();
  });

  document.getElementById('changePhotoBtn').addEventListener('click', () => {
    goToAddStepIdx(1);
  });

  // star picker
  const picker = document.getElementById('fRating');
  picker.querySelectorAll('span').forEach(star => {
    star.addEventListener('click', () => {
      picker.dataset.value = star.dataset.star;
      updateStarPicker();
    });
  });
}

function openAddFlow(existingBeer) {
  editingId = existingBeer ? existingBeer.id : null;
  rawPhotoDataUrl = existingBeer ? existingBeer.image : null;
  croppedDataUrl = existingBeer ? existingBeer.image : null;
  rotationDeg = 0;

  document.getElementById('fName').value = existingBeer?.name || '';
  document.getElementById('fBrewery').value = existingBeer?.brewery || '';
  document.getElementById('fStyle').value = existingBeer?.style || '';
  document.getElementById('fLocation').value = existingBeer?.location || '';
  document.getElementById('fDate').value = existingBeer?.date || new Date().toISOString().slice(0, 10);
  document.getElementById('fNotes').value = existingBeer?.notes || '';
  document.getElementById('fRating').dataset.value = existingBeer?.rating || 0;
  updateStarPicker();

  const prev = document.getElementById('capturePreview');
  if (existingBeer) {
    prev.src = existingBeer.image; prev.hidden = false;
    document.getElementById('captureHint').hidden = true;
  } else {
    prev.hidden = true;
    document.getElementById('captureHint').hidden = false;
  }

  document.getElementById('addFlow').classList.add('active');
  goToAddStepIdx(existingBeer ? 3 : 1);
}
function closeAddFlow() {
  document.getElementById('addFlow').classList.remove('active');
  editingId = null;
}
function goToAddStepIdx(n) {
  addStep = n;
  document.querySelectorAll('.flow-step').forEach(s => s.classList.remove('active'));
  document.getElementById('addStep' + n).classList.add('active');
  document.getElementById('addStepTitle').textContent =
    n === 1 ? 'Add Photo' : n === 2 ? 'Crop' : (editingId ? 'Edit Details' : 'Add Details');
  document.getElementById('addNext').textContent = n === 3 ? 'Save' : 'Next';
  document.getElementById('addBack').textContent = n === 1 ? 'Cancel' : 'Back';

  if (n === 2) initCropStage();
  if (n === 3) {
    document.getElementById('detailPreviewImg').src = croppedDataUrl || rawPhotoDataUrl || '';
  }
}
function onAddNext() {
  if (addStep === 1) {
    if (!rawPhotoDataUrl) { alert('Please take or choose a photo first.'); return; }
    goToAddStepIdx(2);
  } else if (addStep === 2) {
    croppedDataUrl = computeCroppedImage();
    goToAddStepIdx(3);
  } else if (addStep === 3) {
    saveBeer();
  }
}
function updateStarPicker() {
  const picker = document.getElementById('fRating');
  const val = Number(picker.dataset.value || 0);
  picker.querySelectorAll('span').forEach(s => {
    s.classList.toggle('filled', Number(s.dataset.star) <= val);
  });
}

/* ---- crop stage ---- */
let cropState = null; // {x,y,w,h} in stage-relative px
let imgBounds = null; // {left,top,w,h} in stage-relative px
let dragInfo = null;

function renderRotatedImage() {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    const rad = rotationDeg * Math.PI / 180;
    if (rotationDeg % 180 === 0) { canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; }
    else { canvas.width = img.naturalHeight; canvas.height = img.naturalWidth; }
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    document.getElementById('cropImage').src = canvas.toDataURL('image/jpeg', 0.92);
  };
  img.src = rawPhotoDataUrl;
}

function initCropStage() {
  const cropImg = document.getElementById('cropImage');
  const doInit = () => {
    requestAnimationFrame(() => {
      const stage = document.getElementById('cropStage');
      const stageRect = stage.getBoundingClientRect();
      const imgRect = cropImg.getBoundingClientRect();
      imgBounds = {
        left: imgRect.left - stageRect.left,
        top: imgRect.top - stageRect.top,
        w: imgRect.width,
        h: imgRect.height
      };
      const insetX = imgBounds.w * 0.12, insetY = imgBounds.h * 0.06;
      cropState = {
        x: imgBounds.left + insetX,
        y: imgBounds.top + insetY,
        w: imgBounds.w - insetX * 2,
        h: imgBounds.h - insetY * 2
      };
      drawCropBox();
    });
  };
  if (rotationDeg !== 0) {
    renderRotatedImage();
    cropImg.onload = doInit;
  } else {
    cropImg.src = rawPhotoDataUrl;
    if (cropImg.complete) doInit(); else cropImg.onload = doInit;
  }
}
function drawCropBox() {
  const box = document.getElementById('cropBox');
  box.style.left = cropState.x + 'px';
  box.style.top = cropState.y + 'px';
  box.style.width = cropState.w + 'px';
  box.style.height = cropState.h + 'px';
}
function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

// handle drag (resize corners)
document.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.crop-handle');
  const box = e.target.closest('.crop-box');
  if (handle) {
    dragInfo = { type: 'resize', corner: handle.dataset.h, startX: e.clientX, startY: e.clientY, start: { ...cropState } };
    e.preventDefault();
  } else if (box) {
    dragInfo = { type: 'move', startX: e.clientX, startY: e.clientY, start: { ...cropState } };
    e.preventDefault();
  }
});
document.addEventListener('pointermove', (e) => {
  if (!dragInfo || !cropState || !imgBounds) return;
  const dx = e.clientX - dragInfo.startX;
  const dy = e.clientY - dragInfo.startY;
  const minSize = 30;

  if (dragInfo.type === 'move') {
    let nx = dragInfo.start.x + dx;
    let ny = dragInfo.start.y + dy;
    nx = clamp(nx, imgBounds.left, imgBounds.left + imgBounds.w - cropState.w);
    ny = clamp(ny, imgBounds.top, imgBounds.top + imgBounds.h - cropState.h);
    cropState.x = nx; cropState.y = ny;
  } else {
    let { x, y, w, h } = dragInfo.start;
    const right = x + w, bottom = y + h;
    if (dragInfo.corner === 'tl') {
      const nx = clamp(dragInfo.start.x + dx, imgBounds.left, right - minSize);
      const ny = clamp(dragInfo.start.y + dy, imgBounds.top, bottom - minSize);
      cropState.x = nx; cropState.y = ny; cropState.w = right - nx; cropState.h = bottom - ny;
    } else if (dragInfo.corner === 'tr') {
      const nRight = clamp(right + dx, x + minSize, imgBounds.left + imgBounds.w);
      const ny = clamp(dragInfo.start.y + dy, imgBounds.top, bottom - minSize);
      cropState.y = ny; cropState.w = nRight - x; cropState.h = bottom - ny;
    } else if (dragInfo.corner === 'bl') {
      const nx = clamp(dragInfo.start.x + dx, imgBounds.left, right - minSize);
      const nBottom = clamp(bottom + dy, y + minSize, imgBounds.top + imgBounds.h);
      cropState.x = nx; cropState.w = right - nx; cropState.h = nBottom - y;
    } else if (dragInfo.corner === 'br') {
      const nRight = clamp(right + dx, x + minSize, imgBounds.left + imgBounds.w);
      const nBottom = clamp(bottom + dy, y + minSize, imgBounds.top + imgBounds.h);
      cropState.w = nRight - x; cropState.h = nBottom - y;
    }
  }
  drawCropBox();
});
document.addEventListener('pointerup', () => { dragInfo = null; });

function computeCroppedImage() {
  const cropImg = document.getElementById('cropImage');
  const scaleX = cropImg.naturalWidth / imgBounds.w;
  const scaleY = cropImg.naturalHeight / imgBounds.h;
  const sx = (cropState.x - imgBounds.left) * scaleX;
  const sy = (cropState.y - imgBounds.top) * scaleY;
  const sw = cropState.w * scaleX;
  const sh = cropState.h * scaleY;

  const maxOut = 700;
  let outW = sw, outH = sh;
  if (outH > maxOut || outW > maxOut) {
    if (outH >= outW) { outW = Math.round(outW * maxOut / outH); outH = maxOut; }
    else { outH = Math.round(outH * maxOut / outW); outW = maxOut; }
  }
  const canvas = document.createElement('canvas');
  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(cropImg, sx, sy, sw, sh, 0, 0, outW, outH);
  return canvas.toDataURL('image/jpeg', 0.88);
}

/* ---- save beer ---- */
async function saveBeer() {
  const rating = Number(document.getElementById('fRating').dataset.value || 0);
  const beer = {
    id: editingId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
    image: croppedDataUrl || rawPhotoDataUrl,
    name: document.getElementById('fName').value.trim(),
    brewery: document.getElementById('fBrewery').value.trim(),
    style: document.getElementById('fStyle').value.trim(),
    rating,
    location: document.getElementById('fLocation').value.trim(),
    date: document.getElementById('fDate').value,
    notes: document.getElementById('fNotes').value.trim(),
    createdAt: editingId ? (beers.find(b => b.id === editingId)?.createdAt || Date.now()) : Date.now()
  };
  if (!beer.name) beer.name = 'Unnamed Beer';

  await idbPut('beers', beer);
  const idx = beers.findIndex(b => b.id === beer.id);
  if (idx >= 0) beers[idx] = beer; else beers.push(beer);

  closeAddFlow();
  renderShelf(); renderCollection(); renderStats();
  goToView('shelf');
}

/* ============================================================
   DETAIL MODAL
   ============================================================ */
let currentDetailId = null;
function bindDetailModal() {
  document.getElementById('detailClose').addEventListener('click', closeDetail);
  document.getElementById('detailEdit').addEventListener('click', () => {
    const b = beers.find(x => x.id === currentDetailId);
    closeDetail();
    openAddFlow(b);
  });
  document.getElementById('detailDelete').addEventListener('click', async () => {
    if (!confirm('Delete this beer?')) return;
    await idbDelete('beers', currentDetailId);
    beers = beers.filter(b => b.id !== currentDetailId);
    closeDetail();
    renderShelf(); renderCollection(); renderStats();
  });
}
function openDetail(id) {
  currentDetailId = id;
  const b = beers.find(x => x.id === id);
  if (!b) return;
  const view = document.getElementById('detailView');
  view.innerHTML = `
    <div class="detail-preview"><img src="${b.image}"></div>
    <div class="dv-row"><span class="dv-k">Name</span><span>${escapeHtml(b.name)}</span></div>
    <div class="dv-row"><span class="dv-k">Brewery</span><span>${escapeHtml(b.brewery) || '—'}</span></div>
    <div class="dv-row"><span class="dv-k">Style</span><span>${escapeHtml(b.style) || '—'}</span></div>
    <div class="dv-row"><span class="dv-k">Rating</span><span style="color:#e8a33d;">${starString(b.rating)}</span></div>
    <div class="dv-row"><span class="dv-k">Location</span><span>${escapeHtml(b.location) || '—'}</span></div>
    <div class="dv-row"><span class="dv-k">Date</span><span>${b.date || '—'}</span></div>
    ${b.notes ? `<div class="dv-notes">${escapeHtml(b.notes)}</div>` : ''}
  `;
  document.getElementById('detailModal').classList.add('active');
}
function closeDetail() {
  document.getElementById('detailModal').classList.remove('active');
  currentDetailId = null;
}
