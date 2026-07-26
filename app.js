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
let venuePhotoDataUrl = null; // optional secondary photo (venue/friends)

const PLACEHOLDER_IMG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160">' +
  '<rect width="120" height="160" fill="#241d15" rx="14"/>' +
  '<text x="60" y="96" font-size="50" text-anchor="middle">🍺</text></svg>'
);

function resizeDataUrl(dataUrl, maxDim, quality) {
  return new Promise((resolve) => {
    if (!dataUrl) { resolve(null); return; }
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
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
let shelfStyleFilter = null;  // active style chip filter, or null
let shelfRatingFilter = false; // "4★+" filter toggle
let collectionSegment = 'owned'; // 'owned' | 'wishlist'

/* ---------------- boot ---------------- */
window.addEventListener('DOMContentLoaded', async () => {
  beers = await idbAll('beers');
  const settingsRows = await idbAll('settings');
  settingsRows.forEach(r => settings[r.key] = r.value);

  applyBackground();
  renderShelfChips();
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
function renderShelfChips() {
  const wrap = document.getElementById('shelfFilterChips');
  const owned = beers.filter(b => !b.wishlist);
  const styles = [...new Set(owned.map(b => (b.style || '').trim()).filter(Boolean))].sort();
  let html = '';
  styles.forEach(s => {
    html += `<button type="button" class="chip${shelfStyleFilter === s ? ' active' : ''}" data-style-filter="${escapeHtml(s)}">${escapeHtml(s)}</button>`;
  });
  html += `<button type="button" class="chip${shelfRatingFilter ? ' active' : ''}" id="chipRating4">4★+</button>`;
  wrap.innerHTML = html;
  wrap.hidden = owned.length === 0;

  wrap.querySelectorAll('[data-style-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      shelfStyleFilter = (shelfStyleFilter === chip.dataset.styleFilter) ? null : chip.dataset.styleFilter;
      renderShelfChips();
      renderShelf();
    });
  });
  const ratingChip = document.getElementById('chipRating4');
  if (ratingChip) {
    ratingChip.addEventListener('click', () => {
      shelfRatingFilter = !shelfRatingFilter;
      renderShelfChips();
      renderShelf();
    });
  }
}

function renderShelf() {
  const grid = document.getElementById('shelfGrid');
  const empty = document.getElementById('shelfEmpty');
  const q = (document.getElementById('shelfSearch').value || '').toLowerCase();
  const list = beers
    .filter(b => !b.wishlist)
    .filter(b => !q || (b.name + b.brewery + b.style).toLowerCase().includes(q))
    .filter(b => !shelfStyleFilter || (b.style || '').trim() === shelfStyleFilter)
    .filter(b => !shelfRatingFilter || Number(b.rating || 0) >= 4)
    .sort((a, b) => b.createdAt - a.createdAt);

  grid.innerHTML = '';
  const noResultsFromFilter = list.length === 0 && (q !== '' || shelfStyleFilter || shelfRatingFilter);
  empty.hidden = list.length > 0 || noResultsFromFilter;
  if (noResultsFromFilter) {
    grid.innerHTML = '<p style="text-align:center;color:#b7ab9a;padding:30px 0;">No matches.</p>';
    return;
  }

  list.forEach(b => {
    const tile = document.createElement('div');
    tile.className = 'can-tile';
    tile.innerHTML = `
      <img src="${b.image || PLACEHOLDER_IMG}" alt="${escapeHtml(b.name)}">
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
  const segWrap = document.getElementById('collectionSegment');
  if (!segWrap.dataset.bound) {
    segWrap.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        collectionSegment = btn.dataset.seg;
        segWrap.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
        renderCollection();
      });
    });
    segWrap.dataset.bound = '1';
  }
  const mode = sortSelect.value;
  let list = beers.filter(b => (collectionSegment === 'wishlist') ? b.wishlist : !b.wishlist);
  if (mode === 'new') list.sort((a, b) => b.createdAt - a.createdAt);
  else if (mode === 'old') list.sort((a, b) => a.createdAt - b.createdAt);
  else if (mode === 'rating') list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  else if (mode === 'name') list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  else if (mode === 'brewery') list.sort((a, b) => (a.brewery || '').localeCompare(b.brewery || ''));

  const el = document.getElementById('collectionList');
  el.innerHTML = '';
  if (list.length === 0) {
    el.innerHTML = `<p style="text-align:center;color:#b7ab9a;padding:30px 0;">${collectionSegment === 'wishlist' ? 'Your wishlist is empty.' : 'No beers yet.'}</p>`;
    return;
  }
  list.forEach(b => {
    const row = document.createElement('div');
    row.className = 'collection-row';
    row.innerHTML = `
      <img src="${b.image || PLACEHOLDER_IMG}" alt="">
      <div class="cr-info">
        <div class="cr-name">${escapeHtml(b.name || 'Unnamed')}</div>
        <div class="cr-brewery">${escapeHtml(b.brewery || '')}${b.style ? ' · ' + escapeHtml(b.style) : ''}</div>
        ${b.wishlist ? `<div class="cr-stars" style="color:var(--text-dim);">Want to try</div>` : `<div class="cr-stars">${starString(b.rating)}</div>`}
      </div>
    `;
    row.addEventListener('click', () => openDetail(b.id));
    el.appendChild(row);
  });
}

/* ---------------- stats ---------------- */
function renderStats() {
  const el = document.getElementById('statsContent');
  const owned = beers.filter(b => !b.wishlist);
  if (owned.length === 0) {
    el.innerHTML = '<p style="text-align:center;color:#b7ab9a;padding:30px 0;">Add some beers to see stats.</p>';
    return;
  }
  const total = owned.length;
  const avg = (owned.reduce((s, b) => s + (Number(b.rating) || 0), 0) / total).toFixed(1);
  const breweries = new Set(owned.map(b => b.brewery).filter(Boolean)).size;

  const styleCounts = {};
  owned.forEach(b => {
    const s = b.style && b.style.trim() ? b.style.trim() : 'Unspecified';
    styleCounts[s] = (styleCounts[s] || 0) + 1;
  });
  const styleEntries = Object.entries(styleCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxCount = Math.max(...styleEntries.map(e => e[1]), 1);

  const spendByCurrency = {};
  owned.forEach(b => {
    if (b.priceAmount && !isNaN(b.priceAmount)) {
      const cur = b.priceCurrency || 'Other';
      spendByCurrency[cur] = (spendByCurrency[cur] || 0) + Number(b.priceAmount);
    }
  });
  const currencySymbols = { USD: '$', EUR: '€', GBP: '£', ZAR: 'R', AUD: '$', CAD: '$' };
  const spendEntries = Object.entries(spendByCurrency);

  const abvValues = owned.map(b => Number(b.abv)).filter(v => !isNaN(v) && v > 0);
  const avgAbv = abvValues.length ? (abvValues.reduce((s, v) => s + v, 0) / abvValues.length).toFixed(1) : null;
  const strongest = owned.filter(b => !isNaN(Number(b.abv)) && b.abv).sort((a, b) => Number(b.abv) - Number(a.abv))[0];

  const badges = computeBadges();

  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-big">${total}</div><div class="stat-label">Total Beers</div></div>
      <div class="stat-card"><div class="stat-big">${avg}</div><div class="stat-label">Average Rating</div></div>
      <div class="stat-card"><div class="stat-big">${breweries}</div><div class="stat-label">Breweries</div></div>
      <div class="stat-card"><div class="stat-big">${styleEntries.length}</div><div class="stat-label">Styles Tried</div></div>
      ${avgAbv ? `<div class="stat-card"><div class="stat-big">${avgAbv}%</div><div class="stat-label">Average ABV</div></div>` : ''}
      ${strongest ? `<div class="stat-card"><div class="stat-big">${Number(strongest.abv).toFixed(1)}%</div><div class="stat-label">Strongest: ${escapeHtml(strongest.name)}</div></div>` : ''}
    </div>
    ${spendEntries.length ? `
    <div class="stat-card">
      <div class="stat-label" style="margin-bottom:6px;">Total Spent</div>
      ${spendEntries.map(([cur, amt]) => `
        <div class="dv-row"><span class="dv-k">${cur}</span><span>${currencySymbols[cur] || ''}${amt.toFixed(2)}</span></div>
      `).join('')}
    </div>` : ''}
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
    <div class="stat-card">
      <div class="stat-label" style="margin-bottom:10px;">Badges</div>
      <div class="badges-grid">
        ${badges.map(bd => `
          <div class="badge-card${bd.unlocked ? ' unlocked' : ''}">
            <div class="badge-icon">${bd.icon}</div>
            <div class="badge-name">${bd.name}</div>
            <div class="badge-desc">${bd.desc}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function computeBadges() {
  const owned = beers.filter(b => !b.wishlist);
  const total = owned.length;
  const styleCount = new Set(owned.map(b => (b.style || '').trim()).filter(Boolean)).size;
  const breweryCount = new Set(owned.map(b => (b.brewery || '').trim()).filter(Boolean)).size;
  const locationCount = new Set(owned.map(b => (b.location || '').trim()).filter(Boolean)).size;
  const avgRating = total ? owned.reduce((s, b) => s + (Number(b.rating) || 0), 0) / total : 0;
  const hasHeavyHitter = owned.some(b => Number(b.abv) >= 8);

  return [
    { icon: '🍺', name: 'First Pour', desc: '1 beer added', unlocked: total >= 1 },
    { icon: '📦', name: 'Six Pack', desc: '6 beers added', unlocked: total >= 6 },
    { icon: '🧊', name: 'Case Closed', desc: '24 beers added', unlocked: total >= 24 },
    { icon: '🏆', name: 'Century Club', desc: '100 beers added', unlocked: total >= 100 },
    { icon: '🌍', name: 'World Traveler', desc: '5+ locations', unlocked: locationCount >= 5 },
    { icon: '🏭', name: 'Brewery Hopper', desc: '5+ breweries', unlocked: breweryCount >= 5 },
    { icon: '🎨', name: 'Style Explorer', desc: '5+ styles tried', unlocked: styleCount >= 5 },
    { icon: '🧐', name: 'Connoisseur', desc: '4★+ avg, 10+ beers', unlocked: total >= 10 && avgRating >= 4 },
    { icon: '💪', name: 'Heavy Hitter', desc: 'A beer 8%+ ABV', unlocked: hasHeavyHitter }
  ];
}

/* ---------------- settings ---------------- */
function applyBackground() {
  const view = document.getElementById('view-shelf');
  const overlay = 'linear-gradient(180deg, rgba(10,8,6,0.55) 0px, rgba(9,7,5,0.82) 320px, rgba(8,6,4,0.93) 650px, rgba(6,5,4,0.97) 1100px)';
  if (settings.bgImage) {
    view.style.backgroundImage = `${overlay}, url('${settings.bgImage}')`;
  } else {
    view.style.backgroundImage = '';
  }
}
function bindSettings() {
  const displayNameInput = document.getElementById('fDisplayName');
  displayNameInput.value = settings.displayName || '';
  displayNameInput.addEventListener('change', async () => {
    settings.displayName = displayNameInput.value.trim();
    await idbPut('settings', { key: 'displayName', value: settings.displayName });
  });

  document.getElementById('shareBtn').addEventListener('click', () => {
    if (beers.length === 0) { alert('Add at least one beer before sharing.'); return; }
    const html = buildShareableHtml();
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const nameSlug = (settings.displayName || 'my').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my';
    a.download = `${nameSlug}-beershelf-share.html`;
    a.click();
  });

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
      renderShelf(); renderShelfChips(); renderCollection(); renderStats();
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
    renderShelf(); renderShelfChips(); renderCollection(); renderStats();
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
    const isWishlist = document.getElementById('fWishlist').checked;
    if (addStep === 1) { closeAddFlow(); return; }
    if (addStep === 3 && editingId) { closeAddFlow(); openDetail(editingId); return; }
    if (addStep === 3 && isWishlist) { goToAddStepIdx(1); return; }
    goToAddStepIdx(addStep - 1);
  });
  document.getElementById('addNext').addEventListener('click', onAddNext);

  const wishlistCheckbox = document.getElementById('fWishlist');
  wishlistCheckbox.addEventListener('change', () => togglePostTryFields(wishlistCheckbox.checked));

  document.getElementById('rotateBtn').addEventListener('click', () => {
    rotationDeg = (rotationDeg + 90) % 360;
    renderRotatedImage();
  });

  document.getElementById('changePhotoBtn').addEventListener('click', () => {
    goToAddStepIdx(1);
  });

  // style quick-pick chips
  document.getElementById('styleChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.getElementById('fStyle').value = chip.dataset.style;
    document.querySelectorAll('#styleChips .chip').forEach(c => c.classList.toggle('active', c === chip));
  });

  // venue / friends photo
  const venueFileInput = document.getElementById('venueFileInput');
  document.getElementById('venueAddBtn').addEventListener('click', () => venueFileInput.click());
  venueFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await resizeImageFile(file, 1000, 0.85);
    venuePhotoDataUrl = dataUrl;
    document.getElementById('venuePreviewImg').src = dataUrl;
    document.getElementById('venuePreviewWrap').hidden = false;
    document.getElementById('venueAddWrap').hidden = true;
    venueFileInput.value = '';
  });
  document.getElementById('venueRemoveBtn').addEventListener('click', () => {
    venuePhotoDataUrl = null;
    document.getElementById('venuePreviewWrap').hidden = true;
    document.getElementById('venueAddWrap').hidden = false;
  });

  // crop zoom
  document.getElementById('zoomSlider').addEventListener('input', (e) => {
    const pct = Number(e.target.value);
    document.getElementById('cropImage').style.transform = `scale(${pct / 100})`;
    requestAnimationFrame(recalcCropBoundsAfterZoom);
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

function openAddFlow(existingBeer, forceConvert) {
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
  document.getElementById('fPrice').value = existingBeer?.priceAmount || '';
  document.getElementById('fCurrency').value = existingBeer?.priceCurrency || 'USD';
  document.getElementById('fAbv').value = existingBeer?.abv || '';
  document.getElementById('fServing').value = existingBeer?.serving || '';
  const isWishlist = forceConvert ? false : !!existingBeer?.wishlist;
  document.getElementById('fWishlist').checked = isWishlist;
  togglePostTryFields(isWishlist);
  document.getElementById('fRating').dataset.value = existingBeer?.rating || 0;
  updateStarPicker();
  document.querySelectorAll('#styleChips .chip').forEach(c =>
    c.classList.toggle('active', c.dataset.style === (existingBeer?.style || ''))
  );

  venuePhotoDataUrl = existingBeer?.venueImage || null;
  if (venuePhotoDataUrl) {
    document.getElementById('venuePreviewImg').src = venuePhotoDataUrl;
    document.getElementById('venuePreviewWrap').hidden = false;
    document.getElementById('venueAddWrap').hidden = true;
  } else {
    document.getElementById('venuePreviewWrap').hidden = true;
    document.getElementById('venueAddWrap').hidden = false;
  }

  const prev = document.getElementById('capturePreview');
  if (existingBeer && existingBeer.image && !forceConvert) {
    prev.src = existingBeer.image; prev.hidden = false;
    document.getElementById('captureHint').hidden = true;
  } else {
    prev.hidden = true;
    document.getElementById('captureHint').hidden = false;
    if (forceConvert) { rawPhotoDataUrl = null; croppedDataUrl = null; }
  }

  document.getElementById('addFlow').classList.add('active');
  goToAddStepIdx((existingBeer && !forceConvert) ? 3 : 1);
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
    document.getElementById('detailPreviewImg').src = croppedDataUrl || rawPhotoDataUrl || PLACEHOLDER_IMG;
    document.getElementById('changePhotoBtn').textContent = (croppedDataUrl || rawPhotoDataUrl) ? 'Change Photo' : 'Add a Photo';
  }
}
async function onAddNext() {
  const isWishlist = document.getElementById('fWishlist').checked;
  if (addStep === 1) {
    if (!rawPhotoDataUrl && !isWishlist) { alert('Please take or choose a photo first.'); return; }
    if (isWishlist) {
      croppedDataUrl = rawPhotoDataUrl ? await resizeDataUrl(rawPhotoDataUrl, 500, 0.85) : null;
      goToAddStepIdx(3);
    } else {
      goToAddStepIdx(2);
    }
  } else if (addStep === 2) {
    croppedDataUrl = computeCroppedImage();
    goToAddStepIdx(3);
  } else if (addStep === 3) {
    saveBeer();
  }
}
function togglePostTryFields(isWishlist) {
  ['postTryFields', 'postTryFields2', 'postTryFields3'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = isWishlist;
  });
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
  document.getElementById('zoomSlider').value = 100;
  cropImg.style.transform = 'scale(1)';
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
function recalcCropBoundsAfterZoom() {
  const cropImg = document.getElementById('cropImage');
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

  // Rounded-rect alpha mask so the tight crop reads as a soft can/bottle
  // shape rather than a harsh rectangle, even though the underlying crop is a rectangle.
  const radius = Math.min(outW, outH) * 0.12;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.arcTo(outW, 0, outW, outH, radius);
  ctx.arcTo(outW, outH, 0, outH, radius);
  ctx.arcTo(0, outH, 0, 0, radius);
  ctx.arcTo(0, 0, outW, 0, radius);
  ctx.closePath();
  ctx.clip();

  ctx.drawImage(cropImg, sx, sy, sw, sh, 0, 0, outW, outH);
  return canvas.toDataURL('image/png');
}

/* ---- save beer ---- */
async function saveBeer() {
  const rating = Number(document.getElementById('fRating').dataset.value || 0);
  const priceVal = document.getElementById('fPrice').value;
  const abvVal = document.getElementById('fAbv').value;
  const isWishlist = document.getElementById('fWishlist').checked;
  const beer = {
    id: editingId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
    image: croppedDataUrl || rawPhotoDataUrl || null,
    venueImage: venuePhotoDataUrl || null,
    name: document.getElementById('fName').value.trim(),
    brewery: document.getElementById('fBrewery').value.trim(),
    style: document.getElementById('fStyle').value.trim(),
    rating: isWishlist ? 0 : rating,
    priceAmount: (!isWishlist && priceVal) ? Number(priceVal) : null,
    priceCurrency: document.getElementById('fCurrency').value,
    abv: abvVal ? Number(abvVal) : null,
    serving: document.getElementById('fServing').value.trim(),
    wishlist: isWishlist,
    location: document.getElementById('fLocation').value.trim(),
    date: isWishlist ? '' : document.getElementById('fDate').value,
    notes: document.getElementById('fNotes').value.trim(),
    createdAt: editingId ? (beers.find(b => b.id === editingId)?.createdAt || Date.now()) : Date.now()
  };
  if (!beer.name) beer.name = 'Unnamed Beer';

  await idbPut('beers', beer);
  const idx = beers.findIndex(b => b.id === beer.id);
  if (idx >= 0) beers[idx] = beer; else beers.push(beer);

  closeAddFlow();
  renderShelf(); renderShelfChips(); renderCollection(); renderStats();
  if (beer.wishlist) {
    collectionSegment = 'wishlist';
    const segWrap = document.getElementById('collectionSegment');
    segWrap.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.seg === 'wishlist'));
    renderCollection();
    goToView('collection');
  } else {
    goToView('shelf');
  }
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
  document.getElementById('detailMoveBtn').addEventListener('click', () => {
    const b = beers.find(x => x.id === currentDetailId);
    closeDetail();
    openAddFlow(b, true); // forceConvert: requires a real photo + crop, clears wishlist flag
  });
  document.getElementById('detailDelete').addEventListener('click', async () => {
    if (!confirm('Delete this beer?')) return;
    await idbDelete('beers', currentDetailId);
    beers = beers.filter(b => b.id !== currentDetailId);
    closeDetail();
    renderShelf(); renderShelfChips(); renderCollection(); renderStats();
  });
}
function openDetail(id) {
  currentDetailId = id;
  const b = beers.find(x => x.id === id);
  if (!b) return;
  const currencySymbols = { USD: '$', EUR: '€', GBP: '£', ZAR: 'R', AUD: '$', CAD: '$' };
  const priceStr = (b.priceAmount != null && b.priceAmount !== '')
    ? `${currencySymbols[b.priceCurrency] || ''}${Number(b.priceAmount).toFixed(2)} ${!currencySymbols[b.priceCurrency] ? (b.priceCurrency || '') : ''}`.trim()
    : '—';
  const view = document.getElementById('detailView');
  view.innerHTML = `
    <div class="detail-preview"><img src="${b.image || PLACEHOLDER_IMG}"></div>
    ${b.wishlist ? `<div class="wishlist-badge">📋 On your Wishlist — haven't tried it yet</div>` : ''}
    <div class="dv-row"><span class="dv-k">Name</span><span>${escapeHtml(b.name)}</span></div>
    <div class="dv-row"><span class="dv-k">Brewery</span><span>${escapeHtml(b.brewery) || '—'}</span></div>
    <div class="dv-row"><span class="dv-k">Style</span><span>${escapeHtml(b.style) || '—'}</span></div>
    <div class="dv-row"><span class="dv-k">ABV</span><span>${b.abv ? Number(b.abv).toFixed(1) + '%' : '—'}</span></div>
    <div class="dv-row"><span class="dv-k">Serving</span><span>${escapeHtml(b.serving) || '—'}</span></div>
    ${!b.wishlist ? `<div class="dv-row"><span class="dv-k">Rating</span><span style="color:#e8a33d;">${starString(b.rating)}</span></div>` : ''}
    ${!b.wishlist ? `<div class="dv-row"><span class="dv-k">Price</span><span>${priceStr}</span></div>` : ''}
    <div class="dv-row"><span class="dv-k">Location</span><span>${escapeHtml(b.location) || '—'}</span></div>
    ${!b.wishlist ? `<div class="dv-row"><span class="dv-k">Date</span><span>${b.date || '—'}</span></div>` : ''}
    ${b.notes ? `<div class="dv-notes">${escapeHtml(b.notes)}</div>` : ''}
    ${b.venueImage ? `<div class="dv-k" style="margin-top:14px;font-size:13px;">Where you had it</div><img src="${b.venueImage}" style="width:100%;border-radius:12px;margin-top:8px;">` : ''}
  `;
  document.getElementById('detailMoveBtn').hidden = !b.wishlist;
  document.getElementById('detailModal').classList.add('active');
}
function closeDetail() {
  document.getElementById('detailModal').classList.remove('active');
  currentDetailId = null;
}

/* ============================================================
   SHARE — standalone, self-contained, read-only HTML snapshot
   ============================================================ */
function buildShareableHtml() {
  const title = settings.displayName ? escapeHtml(settings.displayName) : 'My BeerShelf';
  const data = beers.map(b => ({
    image: b.image, venueImage: b.venueImage || null,
    name: b.name, brewery: b.brewery, style: b.style, rating: b.rating,
    priceAmount: b.priceAmount, priceCurrency: b.priceCurrency,
    location: b.location, date: b.date, notes: b.notes,
    createdAt: b.createdAt
  })).sort((a, b) => b.createdAt - a.createdAt);

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root{--bg:#0f0d0a;--panel:#1a1611;--gold:#e8a33d;--gold-light:#ffd68c;--text:#f2ece3;--text-dim:#b7ab9a;}
*{box-sizing:border-box;}
body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
.wrap{max-width:520px;margin:0 auto;padding-bottom:40px;}
.hero{padding:36px 20px 26px;text-align:center;background:radial-gradient(circle at 50% 20%,#3a2c1c,#14100b 70%);}
.hero h1{margin:0;color:var(--gold);font-family:Georgia,serif;font-size:30px;letter-spacing:1px;}
.hero p{color:#e9e2d6;font-size:13px;margin:6px 0 0;opacity:.85;}
.badge{display:inline-block;margin-top:10px;font-size:11px;background:rgba(232,163,61,0.15);color:var(--gold-light);padding:4px 10px;border-radius:999px;border:1px solid rgba(232,163,61,0.3);}
.shelf-row{margin:0 10px 24px;}
.shelf-items{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px;padding:10px 8px 16px;}
.can{width:74px;text-align:center;cursor:pointer;}
.can img{width:100%;height:92px;object-fit:contain;filter:drop-shadow(0 8px 5px rgba(0,0,0,.55));}
.can .nm{font-size:11px;font-weight:600;margin-top:6px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
.can .st{font-size:9px;color:var(--gold);margin-top:2px;}
.plank{height:30px;border-radius:3px;background:linear-gradient(180deg,#8a5a2c 0%,#6b431f 55%,#3a2412 60%,#241408 100%);box-shadow:0 6px 10px rgba(0,0,0,.45);}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.7);display:none;align-items:flex-end;justify-content:center;z-index:10;}
.modal.active{display:flex;}
.sheet{background:var(--panel);width:100%;max-width:520px;max-height:85vh;overflow-y:auto;border-radius:20px 20px 0 0;padding:20px;}
.sheet img.main{width:130px;display:block;margin:0 auto 14px;object-fit:contain;max-height:170px;}
.row{display:flex;justify-content:space-between;font-size:14px;padding:9px 0;border-bottom:1px solid #241d15;}
.row span:first-child{color:var(--text-dim);}
.notes{font-size:14px;line-height:1.5;padding-top:8px;}
.venueimg{width:100%;border-radius:12px;margin-top:10px;}
.closeBtn{display:block;margin:16px auto 0;background:none;border:1px solid #3a3022;color:var(--text-dim);padding:10px 20px;border-radius:10px;}
.footer-note{text-align:center;color:var(--text-dim);font-size:11px;padding:20px;}
</style></head>
<body>
<div class="wrap">
  <div class="hero">
    <h1>${title}</h1>
    <p>${data.length} beer${data.length === 1 ? '' : 's'} in this collection</p>
    <span class="badge">Shared snapshot · view only</span>
  </div>
  <div id="shelves"></div>
  <p class="footer-note">This is a read-only snapshot shared from BeerShelf. It won't update automatically — ask for a fresh copy anytime.</p>
</div>
<div class="modal" id="modal"><div class="sheet" id="sheet"></div></div>
<script>
const DATA = ${JSON.stringify(data)};
function esc(s){return (s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function stars(n){n=Math.round(n||0);return '★'.repeat(n)+'☆'.repeat(5-n);}
const CUR = {USD:'$',EUR:'€',GBP:'£',ZAR:'R',AUD:'$',CAD:'$'};
const shelves = document.getElementById('shelves');
const PER_ROW = 4;
for (let i=0;i<DATA.length;i+=PER_ROW){
  const rowBeers = DATA.slice(i,i+PER_ROW);
  const row = document.createElement('div'); row.className='shelf-row';
  const items = document.createElement('div'); items.className='shelf-items';
  rowBeers.forEach((b) => {
    const idx = DATA.indexOf(b);
    const el = document.createElement('div'); el.className='can';
    el.innerHTML = '<img src="'+b.image+'"><div class="nm">'+esc(b.name||'Unnamed')+'</div><div class="st">'+stars(b.rating)+'</div>';
    el.addEventListener('click', () => openDetail(idx));
    items.appendChild(el);
  });
  row.appendChild(items);
  const plank = document.createElement('div'); plank.className='plank';
  row.appendChild(plank);
  shelves.appendChild(row);
}
function openDetail(idx){
  const b = DATA[idx];
  const priceStr = (b.priceAmount!=null && b.priceAmount!=='') ? ((CUR[b.priceCurrency]||'')+Number(b.priceAmount).toFixed(2)+' '+(!CUR[b.priceCurrency]?(b.priceCurrency||''):'')) : '—';
  document.getElementById('sheet').innerHTML =
    '<img class="main" src="'+b.image+'">'+
    '<div class="row"><span>Name</span><span>'+esc(b.name)+'</span></div>'+
    '<div class="row"><span>Brewery</span><span>'+(esc(b.brewery)||'—')+'</span></div>'+
    '<div class="row"><span>Style</span><span>'+(esc(b.style)||'—')+'</span></div>'+
    '<div class="row"><span>Rating</span><span style="color:#e8a33d;">'+stars(b.rating)+'</span></div>'+
    '<div class="row"><span>Price</span><span>'+priceStr+'</span></div>'+
    '<div class="row"><span>Location</span><span>'+(esc(b.location)||'—')+'</span></div>'+
    '<div class="row"><span>Date</span><span>'+(b.date||'—')+'</span></div>'+
    (b.notes ? '<div class="notes">'+esc(b.notes)+'</div>' : '')+
    (b.venueImage ? '<img class="venueimg" src="'+b.venueImage+'">' : '')+
    '<button class="closeBtn" onclick="document.getElementById(\\'modal\\').classList.remove(\\'active\\')">Close</button>';
  document.getElementById('modal').classList.add('active');
}
document.getElementById('modal').addEventListener('click', (e)=>{ if(e.target.id==='modal') e.target.classList.remove('active'); });
</script>
</body></html>`;
}
