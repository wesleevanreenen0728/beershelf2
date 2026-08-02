/* ============================================================
   BrewOS — vanilla JS, IndexedDB-backed, offline-first
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

/* ---------------- state ---------------- */
let beers = [];
let settings = {};
let editingId = null;
let addStep = 1;
let rawPhotoDataUrl = null;
let rotationDeg = 0;
let croppedDataUrl = null;
let venuePhotoDataUrl = null;
let collectionSegment = 'owned';
let customBadges = [];
const APP_VERSION = 'v2.2 — Aug 2026';

function showUpdateToast() {
  if (document.getElementById('updateToast')) return; // already showing
  const toast = document.createElement('div');
  toast.id = 'updateToast';
  toast.className = 'update-toast';
  toast.innerHTML = `<span>⟲ A new version is ready</span><button id="updateReloadBtn">Refresh</button>`;
  document.body.appendChild(toast);
  document.getElementById('updateReloadBtn').addEventListener('click', () => window.location.reload());
}

const PLACEHOLDER_IMG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160">' +
  '<rect width="120" height="160" fill="#141a26" rx="14"/>' +
  '<text x="60" y="96" font-size="50" text-anchor="middle">🍺</text></svg>'
);

/* ---------------- helpers ---------------- */
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
// Robust decimal parser: fixes the iOS "type=number" keypad bug where the
// decimal point key is sometimes missing, and also accepts comma decimals.
function parseDecimalInput(str) {
  if (str === null || str === undefined) return null;
  const cleaned = String(str).trim().replace(',', '.').replace(/[^0-9.]/g, '');
  if (cleaned === '' || cleaned === '.') return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/* ---------------- boot ---------------- */
window.addEventListener('DOMContentLoaded', async () => {
  initSplash();

  beers = await idbAll('beers');
  const settingsRows = await idbAll('settings');
  settingsRows.forEach(r => settings[r.key] = r.value);
  customBadges = Array.isArray(settings.customBadges) ? settings.customBadges : [];

  applyBackground();
  renderShelf();
  renderCollection();
  renderStats();
  bindNav();
  bindShelf();
  bindAddFlow();
  bindDetailModal();
  bindSettings();
  bindBadgesLink();
  bindBadgePopup();
  bindCustomBadgeForm();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          // Only show the toast for an update to an already-running app —
          // not on the very first install, where there's nothing to "update" yet.
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast();
          }
        });
      });
    }).catch(() => {});
  }
});

/* ============================================================
   SPLASH / LAUNCH SEQUENCE
   ============================================================ */
function initSplash() {
  const splash = document.getElementById('splash');
  const video = document.getElementById('pourVideo');
  const glassStage = document.getElementById('glassStage');
  const logo = document.getElementById('splashLogo');
  const liquid = document.getElementById('liquidFill');
  const foam = document.getElementById('foamCap');

  let usedFallback = false;

  function finish(delay) {
    setTimeout(() => logo.classList.add('show'), usedFallback ? 300 : 80);
    setTimeout(() => splash.classList.add('hide'), delay);
    setTimeout(() => { splash.style.display = 'none'; }, delay + 650);
  }

  function runFallback() {
    if (usedFallback) return;
    usedFallback = true;
    glassStage.hidden = false;
    liquid.classList.remove('filled');
    foam.classList.remove('show');
    void liquid.offsetWidth;
    setTimeout(() => liquid.classList.add('filled'), 50);
    setTimeout(() => foam.classList.add('show'), 1500);
    finish(2200);
  }

  const fallbackTimer = setTimeout(runFallback, 1800);

  video.addEventListener('error', () => { clearTimeout(fallbackTimer); runFallback(); }, { once: true });

  video.addEventListener('canplaythrough', () => {
    clearTimeout(fallbackTimer);
    if (usedFallback) return;
    video.classList.add('ready');
    video.currentTime = 0;
    video.play().catch(runFallback);
  }, { once: true });

  video.addEventListener('ended', () => {
    if (usedFallback) return;
    video.classList.add('holding');
    finish(700);
  }, { once: true });

  video.load();
}

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
  if (name === 'badges') renderBadgesFull();
}
function bindBadgesLink() {
  document.getElementById('viewBadgesBtn').addEventListener('click', () => goToView('badges'));
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
  const owned = beers.filter(b => !b.wishlist);
  const list = owned
    .filter(b => !q || (b.name + b.brewery + b.style).toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt);

  document.getElementById('hudCount').textContent = owned.length;

  grid.innerHTML = '';
  const noResultsFromFilter = list.length === 0 && q !== '';
  empty.hidden = list.length > 0 || noResultsFromFilter;
  if (noResultsFromFilter) {
    grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-dim);padding:30px 0;font-size:12px;">NO MATCHES</p>';
    return;
  }
  list.forEach((b, i) => {
    const tile = document.createElement('div');
    tile.className = 'inv-card';
    tile.style.animationDelay = Math.min(i * 0.05, 0.5) + 's';
    const ring = b.rating > 0 ? `<div class="ring">${Math.round(b.rating)}.0</div>` : '';
    tile.innerHTML = `
      ${ring}
      <img src="${b.image || PLACEHOLDER_IMG}" alt="${escapeHtml(b.name)}">
      <div class="ct-name">${escapeHtml(b.name || 'Unnamed')}</div>
      <div class="ct-style">${escapeHtml(b.style) || '&nbsp;'}</div>
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
  const sortSelect = document.getElementById('sortSelect');
  if (!sortSelect.dataset.bound) {
    sortSelect.addEventListener('change', renderCollection);
    sortSelect.dataset.bound = '1';
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
    el.innerHTML = `<p style="text-align:center;color:var(--text-dim);padding:30px 0;font-size:12px;">${collectionSegment === 'wishlist' ? 'YOUR WISHLIST IS EMPTY' : 'NO BEERS YET'}</p>`;
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
        ${b.wishlist ? `<div class="cr-stars" style="color:var(--text-dim);">WANT TO TRY</div>` : `<div class="cr-stars">${starString(b.rating)}</div>`}
      </div>
    `;
    row.addEventListener('click', () => openDetail(b.id));
    el.appendChild(row);
  });
}

/* ============================================================
   BADGES SYSTEM
   ============================================================ */
function computeBadgeContext() {
  const owned = beers.filter(b => !b.wishlist);
  const wishlistItems = beers.filter(b => b.wishlist);
  const styles = {}, breweries = {}, locations = {};
  let ratedCount = 0, ratingSum = 0, has5 = false, has1 = false;
  let hasLowAbv = false, hasHighAbv = false;
  let hasCheap = false, hasExpensive = false;
  const spendByCur = {};
  let venueCount = 0, notesCount = 0;
  let nightOwl = false, earlyBird = false, weekendCount = 0;
  const months = new Set();

  owned.forEach(b => {
    const st = (b.style || '').trim().toLowerCase();
    if (st) styles[st] = (styles[st] || 0) + 1;
    const br = (b.brewery || '').trim().toLowerCase();
    if (br) breweries[br] = (breweries[br] || 0) + 1;
    const loc = (b.location || '').trim().toLowerCase();
    if (loc) locations[loc] = (locations[loc] || 0) + 1;

    if (Number(b.rating) > 0) { ratedCount++; ratingSum += Number(b.rating); }
    if (Number(b.rating) === 5) has5 = true;
    if (Number(b.rating) === 1) has1 = true;

    const abv = Number(b.abv);
    if (!isNaN(abv) && abv > 0) { if (abv < 4) hasLowAbv = true; if (abv >= 8) hasHighAbv = true; }

    const price = Number(b.priceAmount);
    if (!isNaN(price) && price > 0) {
      if (price < 1.5) hasCheap = true;
      if (price > 10) hasExpensive = true;
      const cur = b.priceCurrency || 'Other';
      spendByCur[cur] = (spendByCur[cur] || 0) + price;
    }

    if (b.venueImage) venueCount++;
    if (b.notes && b.notes.trim()) notesCount++;

    if (b.createdAt) {
      const d = new Date(b.createdAt);
      const hr = d.getHours();
      if (hr >= 22 || hr < 4) nightOwl = true;
      if (hr >= 4 && hr < 9) earlyBird = true;
      const day = d.getDay();
      if (day === 0 || day === 6) weekendCount++;
      months.add(d.getFullYear() + '-' + d.getMonth());
    }
  });

  const countBy = (obj, needle) => Object.entries(obj).filter(([k]) => k.includes(needle)).reduce((s, [, v]) => s + v, 0);

  return {
    total: owned.length,
    styleCount: Object.keys(styles).length,
    breweryCount: Object.keys(breweries).length,
    locationCount: Object.keys(locations).length,
    maxBrewery: Math.max(0, ...Object.values(breweries)),
    maxLocation: Math.max(0, ...Object.values(locations)),
    ipaCount: countBy(styles, 'ipa'),
    stoutCount: countBy(styles, 'stout'),
    lagerCount: countBy(styles, 'lager'),
    sourCount: countBy(styles, 'sour'),
    ratedCount, avgRating: ratedCount ? ratingSum / ratedCount : 0, has5, has1,
    hasLowAbv, hasHighAbv, hasCheap, hasExpensive,
    maxSpend: Math.max(0, ...Object.values(spendByCur)),
    venueCount, notesCount, nightOwl, earlyBird, weekendCount,
    monthCount: months.size,
    wishlistCount: wishlistItems.length
  };
}

const BADGES = [
  { id: 'first_pour', icon: '🍺', name: 'First Pour', desc: 'Log 1 beer', check: c => c.total >= 1 },
  { id: 'six_pack', icon: '📦', name: 'Six Pack', desc: 'Log 6 beers', check: c => c.total >= 6 },
  { id: 'case_closed', icon: '🗃️', name: 'Case Closed', desc: 'Log 12 beers', check: c => c.total >= 12 },
  { id: 'keg_stand', icon: '🛢️', name: 'Keg Stand', desc: 'Log 24 beers', check: c => c.total >= 24 },
  { id: 'half_century', icon: '🎖️', name: 'Half Century', desc: 'Log 50 beers', check: c => c.total >= 50 },
  { id: 'century_club', icon: '💯', name: 'Century Club', desc: 'Log 100 beers', check: c => c.total >= 100 },
  { id: 'legendary_cellar', icon: '👑', name: 'Legendary Cellar', desc: 'Log 200 beers', check: c => c.total >= 200 },

  { id: 'style_explorer', icon: '🧭', name: 'Style Explorer', desc: '5 different styles', check: c => c.styleCount >= 5 },
  { id: 'style_connoisseur', icon: '🎓', name: 'Connoisseur', desc: '10 different styles', check: c => c.styleCount >= 10 },
  { id: 'style_master', icon: '🏅', name: 'Style Master', desc: '15 different styles', check: c => c.styleCount >= 15 },
  { id: 'ipa_fan', icon: '🌿', name: 'IPA Fan', desc: '5 IPAs logged', check: c => c.ipaCount >= 5 },
  { id: 'stout_lover', icon: '⚫', name: 'Stout Lover', desc: '5 Stouts logged', check: c => c.stoutCount >= 5 },
  { id: 'lager_loyalist', icon: '🌾', name: 'Lager Loyalist', desc: '5 Lagers logged', check: c => c.lagerCount >= 5 },
  { id: 'sour_enthusiast', icon: '🍋', name: 'Sour Enthusiast', desc: '3 Sours logged', check: c => c.sourCount >= 3 },

  { id: 'brewery_hopper', icon: '🐇', name: 'Brewery Hopper', desc: '5 different breweries', check: c => c.breweryCount >= 5 },
  { id: 'brewery_explorer', icon: '🗺️', name: 'Brewery Explorer', desc: '10 different breweries', check: c => c.breweryCount >= 10 },
  { id: 'loyal_regular', icon: '🤝', name: 'Loyal Regular', desc: '5 beers, same brewery', check: c => c.maxBrewery >= 5 },

  { id: 'local_hero', icon: '📍', name: 'Local Hero', desc: '5 beers, same spot', check: c => c.maxLocation >= 5 },
  { id: 'globe_trotter', icon: '🌍', name: 'Globe Trotter', desc: '3 different locations', check: c => c.locationCount >= 3 },
  { id: 'world_traveler', icon: '✈️', name: 'World Traveler', desc: '8 different locations', check: c => c.locationCount >= 8 },

  { id: 'top_shelf', icon: '⭐', name: 'Top Shelf', desc: 'Give a 5-star rating', check: c => c.has5 },
  { id: 'tough_critic', icon: '📝', name: 'Tough Critic', desc: 'Rate 10 beers', check: c => c.ratedCount >= 10 },
  { id: 'golden_palate', icon: '🏆', name: 'Golden Palate', desc: 'Avg 4.5★ (5+ rated)', check: c => c.ratedCount >= 5 && c.avgRating >= 4.5 },
  { id: 'honest_reviewer', icon: '💬', name: 'Honest Reviewer', desc: 'Give a 1-star rating', check: c => c.has1 },

  { id: 'session_sipper', icon: '🪶', name: 'Session Sipper', desc: 'Log a beer under 4% ABV', check: c => c.hasLowAbv },
  { id: 'heavy_hitter', icon: '🔥', name: 'Heavy Hitter', desc: 'Log a beer 8%+ ABV', check: c => c.hasHighAbv },
  { id: 'full_spectrum', icon: '📊', name: 'Full Spectrum', desc: 'Log both light & strong', check: c => c.hasLowAbv && c.hasHighAbv },

  { id: 'budget_hunter', icon: '🪙', name: 'Budget Hunter', desc: 'Log a beer under 1.50', check: c => c.hasCheap },
  { id: 'splurge', icon: '💎', name: 'Splurge', desc: 'Log a beer over 10.00', check: c => c.hasExpensive },
  { id: 'big_spender', icon: '💰', name: 'Big Spender', desc: 'Spend 100+ total', check: c => c.maxSpend >= 100 },

  { id: 'dreamer', icon: '📋', name: 'Dreamer', desc: 'Add a Wishlist item', check: c => c.wishlistCount >= 1 },
  { id: 'bucket_list', icon: '🗒️', name: 'Bucket List', desc: '10 Wishlist items', check: c => c.wishlistCount >= 10 },

  { id: 'memory_keeper', icon: '📸', name: 'Memory Keeper', desc: '3 venue photos added', check: c => c.venueCount >= 3 },
  { id: 'storyteller', icon: '✍️', name: 'Storyteller', desc: '5 beers with notes', check: c => c.notesCount >= 5 },
  { id: 'night_owl', icon: '🦉', name: 'Night Owl', desc: 'Log a beer late at night', check: c => c.nightOwl },
  { id: 'early_bird', icon: '🌅', name: 'Early Bird', desc: 'Log a beer early morning', check: c => c.earlyBird },
  { id: 'weekend_warrior', icon: '🎉', name: 'Weekend Warrior', desc: '5 weekend entries', check: c => c.weekendCount >= 5 },

  { id: 'consistent_logger', icon: '📅', name: 'Consistent Logger', desc: '3 different months', check: c => c.monthCount >= 3 },
  { id: 'dedicated', icon: '🗓️', name: 'Dedicated', desc: '6 different months', check: c => c.monthCount >= 6 },
  { id: 'year_round', icon: '🔄', name: 'Year Round', desc: '12 different months', check: c => c.monthCount >= 12 }
];

function isBadgeUnlocked(badge, ctx) {
  return badge.custom ? !!badge.unlocked : badge.check(ctx);
}
function allBadgesForDisplay() {
  return [...BADGES, ...customBadges];
}
function findBadgeById(id) {
  return allBadgesForDisplay().find(b => b.id === id);
}
async function persistCustomBadges() {
  settings.customBadges = customBadges;
  await idbPut('settings', { key: 'customBadges', value: customBadges });
}

function renderBadgeHexes(container, badges, ctx, staggerMs) {
  container.innerHTML = '';
  badges.forEach(b => {
    const unlocked = isBadgeUnlocked(b, ctx);
    const hex = document.createElement('div');
    hex.className = 'hex' + (unlocked ? '' : ' locked');
    hex.dataset.badgeId = b.id;
    hex.innerHTML = `<div class="h">${b.icon}</div><span class="l">${escapeHtml(b.name)}</span>`;
    hex.addEventListener('click', () => openBadgePopup(b.id));
    container.appendChild(hex);
  });
  requestAnimationFrame(() => {
    container.querySelectorAll('.hex').forEach((h, i) => {
      setTimeout(() => h.classList.add('in'), (staggerMs || 40) * i);
    });
  });
}
function renderBadgesFull() {
  const ctx = computeBadgeContext();
  const all = allBadgesForDisplay();
  const unlockedCount = all.filter(b => isBadgeUnlocked(b, ctx)).length;
  document.getElementById('badgesSummary').innerHTML =
    `<b>${unlockedCount} / ${all.length}</b> achievement modules unlocked`;
  renderBadgeHexes(document.getElementById('badgesFullGrid'), all, ctx, 25);
}

/* ---- badge info popup ---- */
function bindBadgePopup() {
  const overlay = document.getElementById('badgePopup');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeBadgePopup(); });
}
function closeBadgePopup() {
  document.getElementById('badgePopup').classList.remove('active');
}
function openBadgePopup(badgeId) {
  const badge = findBadgeById(badgeId);
  if (!badge) return;
  const ctx = computeBadgeContext();
  const unlocked = isBadgeUnlocked(badge, ctx);

  const card = document.getElementById('badgePopupCard');
  card.innerHTML = `
    <div class="popup-hex${unlocked ? '' : ' locked'}">${badge.icon}</div>
    <div class="popup-name">${escapeHtml(badge.name)}</div>
    <div class="popup-status ${unlocked ? 'unlocked' : 'locked'}">${unlocked ? '✓ UNLOCKED' : '🔒 LOCKED'}</div>
    <div class="popup-desc">${escapeHtml(badge.desc)}</div>
    <div class="popup-actions" id="popupActions"></div>
  `;
  const actions = document.getElementById('popupActions');

  if (badge.custom) {
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn-secondary wide';
    toggleBtn.textContent = unlocked ? 'Mark as Locked' : 'Mark as Unlocked';
    toggleBtn.addEventListener('click', async () => {
      badge.unlocked = !badge.unlocked;
      await persistCustomBadges();
      closeBadgePopup();
      renderBadgesFull(); renderStats();
    });
    actions.appendChild(toggleBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger wide';
    delBtn.textContent = 'Delete Badge';
    delBtn.addEventListener('click', async () => {
      if (!confirm('Delete this custom badge?')) return;
      customBadges = customBadges.filter(x => x.id !== badge.id);
      await persistCustomBadges();
      closeBadgePopup();
      renderBadgesFull(); renderStats();
    });
    actions.appendChild(delBtn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-ghost wide';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', closeBadgePopup);
  actions.appendChild(closeBtn);

  document.getElementById('badgePopup').classList.add('active');
}

/* ---- create custom badge ---- */
function bindCustomBadgeForm() {
  document.getElementById('createBadgeBtn').addEventListener('click', () => {
    document.getElementById('cbIcon').value = '';
    document.getElementById('cbName').value = '';
    document.getElementById('cbDesc').value = '';
    document.getElementById('customBadgeForm').classList.add('active');
  });
  document.getElementById('customBadgeCancel').addEventListener('click', () => {
    document.getElementById('customBadgeForm').classList.remove('active');
  });
  document.getElementById('customBadgeSave').addEventListener('click', async () => {
    const icon = document.getElementById('cbIcon').value.trim() || '🏆';
    const name = document.getElementById('cbName').value.trim();
    const desc = document.getElementById('cbDesc').value.trim();
    if (!name) { alert('Give your badge a name first.'); return; }
    customBadges.push({
      id: 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      icon, name, desc: desc || 'Custom badge — self-tracked.',
      unlocked: false, custom: true
    });
    await persistCustomBadges();
    document.getElementById('customBadgeForm').classList.remove('active');
    renderBadgesFull(); renderStats();
  });
}

/* ---------------- stats ---------------- */
function renderStats() {
  const el = document.getElementById('statsContent');
  const owned = beers.filter(b => !b.wishlist);
  if (owned.length === 0) {
    el.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:30px 0;font-size:12px;">ADD BEERS TO SEE STATS</p>';
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

  const ctx = computeBadgeContext();
  const allBadges = allBadgesForDisplay();
  const unlockedCount = allBadges.filter(b => isBadgeUnlocked(b, ctx)).length;
  const previewBadges = [...allBadges].sort((a, b) => (isBadgeUnlocked(b, ctx) ? 1 : 0) - (isBadgeUnlocked(a, ctx) ? 1 : 0)).slice(0, 4);

  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-big">${total}</div><div class="stat-label">Total Units</div></div>
      <div class="stat-card"><div class="stat-big">${avg}</div><div class="stat-label">Avg Rating</div></div>
      <div class="stat-card"><div class="stat-big">${breweries}</div><div class="stat-label">Sources</div></div>
      <div class="stat-card"><div class="stat-big">${avgAbv || '—'}${avgAbv ? '%' : ''}</div><div class="stat-label">Avg ABV</div></div>
    </div>
    ${spendEntries.length ? `
    <div class="stat-card">
      <div class="stat-label" style="margin-bottom:6px;">Total Spent</div>
      ${spendEntries.map(([cur, amt]) => `
        <div class="dv-row"><span class="dv-k">${cur}</span><span>${currencySymbols[cur] || ''}${amt.toFixed(2)}</span></div>
      `).join('')}
    </div>` : ''}
    <div class="stat-card">
      <div class="stat-label" style="margin-bottom:2px;">Top Styles</div>
      ${styleEntries.map(([s, c]) => `
        <div class="bar-row">
          <span style="width:80px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s)}</span>
          <div class="bar-track"><div class="bar-fill" data-w="${(c / maxCount) * 100}"></div></div>
          <span style="width:18px;text-align:right;">${c}</span>
        </div>
      `).join('')}
    </div>
    <div class="stat-card">
      <div class="stat-label" style="margin-bottom:8px;">${unlockedCount} / ${allBadges.length} Badges Unlocked</div>
      <div class="hex-row-full" id="statsBadgePreview" style="padding:0;"></div>
    </div>
  `;
  requestAnimationFrame(() => {
    el.querySelectorAll('.bar-fill').forEach(bar => {
      requestAnimationFrame(() => { bar.style.width = bar.dataset.w + '%'; });
    });
  });
  renderBadgeHexes(document.getElementById('statsBadgePreview'), previewBadges, ctx, 60);
}

/* ---------------- settings ---------------- */
function applyBackground() {
  const view = document.getElementById('view-shelf');
  if (settings.bgImage) {
    view.style.backgroundImage =
      `linear-gradient(180deg, rgba(6,8,16,0.35) 0%, rgba(6,8,16,0.55) 40%, rgba(6,8,16,0.85) 100%), url('${settings.bgImage}')`;
    view.style.backgroundSize = 'cover';
    view.style.backgroundPosition = 'center top';
    view.style.backgroundAttachment = 'fixed';
  } else {
    view.style.backgroundImage = '';
    view.style.backgroundAttachment = '';
  }
}
function bindSettings() {
  document.getElementById('aboutVersion').textContent = `BrewOS ${APP_VERSION} — a personal, offline-first beer collection app.`;

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
    a.download = `${nameSlug}-brewos-share.html`;
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
    a.download = `brewos-backup-${new Date().toISOString().slice(0,10)}.json`;
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

  document.getElementById('changePhotoBtn').addEventListener('click', () => goToAddStepIdx(1));

  document.getElementById('styleChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.getElementById('fStyle').value = chip.dataset.style;
    document.querySelectorAll('#styleChips .chip').forEach(c => c.classList.toggle('active', c === chip));
  });

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

  document.getElementById('zoomSlider').addEventListener('input', (e) => {
    const pct = Number(e.target.value);
    document.getElementById('cropImage').style.transform = `scale(${pct / 100})`;
    requestAnimationFrame(recalcCropBoundsAfterZoom);
  });

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
  document.getElementById('fPrice').value = (existingBeer?.priceAmount != null) ? existingBeer.priceAmount : '';
  document.getElementById('fCurrency').value = existingBeer?.priceCurrency || 'USD';
  document.getElementById('fAbv').value = (existingBeer?.abv != null) ? existingBeer.abv : '';
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
    n === 1 ? 'New Scan' : n === 2 ? 'Crop' : (editingId ? 'Edit Details' : 'Scan Details');
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
let cropState = null;
let imgBounds = null;
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

// Produces the final cropped can/bottle image: rounded-rect mask (soft corners
// instead of a harsh rectangle) plus a subtle cylindrical light/shadow overlay
// down the width, so it reads more like a curved can and less like a sticker.
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

  const radius = Math.min(outW, outH) * 0.16;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.arcTo(outW, 0, outW, outH, radius);
  ctx.arcTo(outW, outH, 0, outH, radius);
  ctx.arcTo(0, outH, 0, 0, radius);
  ctx.arcTo(0, 0, outW, 0, radius);
  ctx.closePath();
  ctx.clip();

  ctx.drawImage(cropImg, sx, sy, sw, sh, 0, 0, outW, outH);

  const shade = ctx.createLinearGradient(0, 0, outW, 0);
  shade.addColorStop(0, 'rgba(0,0,0,0.32)');
  shade.addColorStop(0.16, 'rgba(255,255,255,0.10)');
  shade.addColorStop(0.5, 'rgba(255,255,255,0.24)');
  shade.addColorStop(0.84, 'rgba(255,255,255,0.06)');
  shade.addColorStop(1, 'rgba(0,0,0,0.32)');
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, outW, outH);
  ctx.globalCompositeOperation = 'source-over';

  return canvas.toDataURL('image/png');
}

/* ---- save beer ---- */
async function saveBeer() {
  const rating = Number(document.getElementById('fRating').dataset.value || 0);
  const priceVal = parseDecimalInput(document.getElementById('fPrice').value);
  const abvVal = parseDecimalInput(document.getElementById('fAbv').value);
  const isWishlist = document.getElementById('fWishlist').checked;
  const beer = {
    id: editingId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
    image: croppedDataUrl || rawPhotoDataUrl || null,
    venueImage: venuePhotoDataUrl || null,
    name: document.getElementById('fName').value.trim(),
    brewery: document.getElementById('fBrewery').value.trim(),
    style: document.getElementById('fStyle').value.trim(),
    rating: isWishlist ? 0 : rating,
    priceAmount: (!isWishlist && priceVal != null) ? priceVal : null,
    priceCurrency: document.getElementById('fCurrency').value,
    abv: abvVal,
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
  renderShelf(); renderCollection(); renderStats();
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
    openAddFlow(b, true);
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
  const currencySymbols = { USD: '$', EUR: '€', GBP: '£', ZAR: 'R', AUD: '$', CAD: '$' };
  const priceStr = (b.priceAmount != null && b.priceAmount !== '')
    ? `${currencySymbols[b.priceCurrency] || ''}${Number(b.priceAmount).toFixed(2)} ${!currencySymbols[b.priceCurrency] ? (b.priceCurrency || '') : ''}`.trim()
    : '—';

  const hasAbv = b.abv != null && !isNaN(Number(b.abv));
  const abvPct = hasAbv ? Math.min(100, (Number(b.abv) / 12) * 100) : 0;
  const ratingPct = b.rating > 0 ? (Number(b.rating) / 5) * 100 : 0;

  const view = document.getElementById('detailView');
  view.innerHTML = `
    <div class="detail-preview"><img src="${b.image || PLACEHOLDER_IMG}"></div>
    <div class="detail-name-big">${escapeHtml(b.name)}</div>
    ${b.brewery ? `<div class="detail-brewery-sub">${escapeHtml(b.brewery)}</div>` : ''}
    ${b.wishlist ? `<div class="wishlist-badge">📋 ON YOUR WISHLIST — HAVEN'T TRIED IT YET</div>` : ''}
    <div class="dv-row"><span class="dv-k">Style</span><span>${escapeHtml(b.style) || '—'}</span></div>
    <div class="dv-row"><span class="dv-k">Serving</span><span>${escapeHtml(b.serving) || '—'}</span></div>
    ${!b.wishlist ? `<div class="dv-row"><span class="dv-k">Price</span><span>${priceStr}</span></div>` : ''}
    <div class="dv-row"><span class="dv-k">Location</span><span>${escapeHtml(b.location) || '—'}</span></div>
    ${!b.wishlist ? `<div class="dv-row"><span class="dv-k">Date</span><span>${b.date || '—'}</span></div>` : ''}

    <div class="gauge-wrap">
      <div class="gauge" id="abvGauge"><span>${hasAbv ? Number(b.abv).toFixed(1) + '%' : '—'}</span></div>
      <div>
        <div class="gauge-label">ABV Output</div>
        <div class="gauge-label" style="color:var(--amber-soft);margin-top:2px;">${hasAbv ? Math.round(abvPct) + '% of range' : 'Not logged'}</div>
      </div>
    </div>
    ${!b.wishlist ? `
    <div class="gauge-wrap">
      <div class="gauge" id="ratingGauge"><span>${b.rating > 0 ? Math.round(b.rating) + '/5' : '—'}</span></div>
      <div>
        <div class="gauge-label">Rating</div>
        <div class="gauge-label" style="color:var(--amber-soft);margin-top:2px;">${starString(b.rating)}</div>
      </div>
    </div>` : ''}

    ${b.notes ? `<div class="dv-notes">${escapeHtml(b.notes)}</div>` : ''}
    ${b.venueImage ? `<div class="dv-k" style="margin-top:14px;">Where you had it</div><img src="${b.venueImage}" style="width:100%;border-radius:12px;margin-top:8px;">` : ''}
  `;
  document.getElementById('detailMoveBtn').hidden = !b.wishlist;
  document.getElementById('detailModal').classList.add('active');

  requestAnimationFrame(() => {
    const abvGauge = document.getElementById('abvGauge');
    if (abvGauge) {
      abvGauge.style.background = 'conic-gradient(var(--amber) 0% 0%, rgba(255,255,255,0.07) 0% 100%)';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        abvGauge.style.background = `conic-gradient(var(--amber) 0% ${abvPct}%, rgba(255,255,255,0.07) ${abvPct}% 100%)`;
      }));
    }
    const ratingGauge = document.getElementById('ratingGauge');
    if (ratingGauge) {
      ratingGauge.style.background = 'conic-gradient(var(--cyan) 0% 0%, rgba(255,255,255,0.07) 0% 100%)';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        ratingGauge.style.background = `conic-gradient(var(--cyan) 0% ${ratingPct}%, rgba(255,255,255,0.07) ${ratingPct}% 100%)`;
      }));
    }
  });
}
function closeDetail() {
  document.getElementById('detailModal').classList.remove('active');
  currentDetailId = null;
}

/* ============================================================
   SHARE — standalone, self-contained, read-only HTML snapshot
   ============================================================ */
function buildShareableHtml() {
  const title = settings.displayName ? escapeHtml(settings.displayName) : 'My BrewOS Collection';
  const data = beers.filter(b => !b.wishlist).map(b => ({
    image: b.image, venueImage: b.venueImage || null,
    name: b.name, brewery: b.brewery, style: b.style, rating: b.rating,
    priceAmount: b.priceAmount, priceCurrency: b.priceCurrency, abv: b.abv, serving: b.serving,
    location: b.location, date: b.date, notes: b.notes,
    createdAt: b.createdAt
  })).sort((a, b) => b.createdAt - a.createdAt);

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root{--bg:#060810;--panel:#141a26;--amber:#FFB300;--amber-soft:#FFD873;--text:#EAF1FA;--text-dim:#7C8AA3;}
*{box-sizing:border-box;}
body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
.wrap{max-width:520px;margin:0 auto;padding-bottom:40px;}
.hero{padding:36px 20px 26px;text-align:center;border-bottom:1px solid rgba(255,179,0,0.25);}
.hero h1{margin:0;color:var(--amber);font-size:26px;letter-spacing:.5px;}
.hero p{color:#c9d3e3;font-size:13px;margin:6px 0 0;opacity:.85;}
.badge{display:inline-block;margin-top:10px;font-size:11px;background:rgba(255,179,0,0.12);color:var(--amber-soft);padding:4px 10px;border-radius:999px;border:1px solid rgba(255,179,0,0.3);}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:16px;}
.can{background:var(--panel);border:1px solid rgba(255,179,0,0.2);border-radius:12px;padding:10px 8px;text-align:center;cursor:pointer;}
.can img{width:100%;height:76px;object-fit:contain;object-position:center bottom;}
.can .nm{font-size:11px;font-weight:600;margin-top:6px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
.can .st{font-size:9px;color:var(--amber);margin-top:2px;}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.7);display:none;align-items:flex-end;justify-content:center;z-index:10;}
.modal.active{display:flex;}
.sheet{background:var(--panel);width:100%;max-width:520px;max-height:85vh;overflow-y:auto;border-radius:20px 20px 0 0;padding:20px;}
.sheet img.main{width:130px;display:block;margin:0 auto 14px;object-fit:contain;max-height:170px;}
.row{display:flex;justify-content:space-between;font-size:14px;padding:9px 0;border-bottom:1px dashed rgba(255,179,0,0.2);}
.row span:first-child{color:var(--text-dim);}
.notes{font-size:14px;line-height:1.5;padding-top:8px;font-style:italic;}
.venueimg{width:100%;border-radius:12px;margin-top:10px;}
.closeBtn{display:block;margin:16px auto 0;background:none;border:1px solid rgba(255,179,0,0.3);color:var(--text-dim);padding:10px 20px;border-radius:10px;}
.footer-note{text-align:center;color:var(--text-dim);font-size:11px;padding:20px;}
</style></head>
<body>
<div class="wrap">
  <div class="hero">
    <h1>${title}</h1>
    <p>${data.length} beer${data.length === 1 ? '' : 's'} in this collection</p>
    <span class="badge">Shared snapshot · view only</span>
  </div>
  <div class="grid" id="grid"></div>
  <p class="footer-note">This is a read-only snapshot shared from BrewOS. It won't update automatically — ask for a fresh copy anytime.</p>
</div>
<div class="modal" id="modal"><div class="sheet" id="sheet"></div></div>
<script>
const DATA = ${JSON.stringify(data)};
function esc(s){return (s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function stars(n){n=Math.round(n||0);return '★'.repeat(n)+'☆'.repeat(5-n);}
const CUR = {USD:'$',EUR:'€',GBP:'£',ZAR:'R',AUD:'$',CAD:'$'};
const grid = document.getElementById('grid');
DATA.forEach((b, idx) => {
  const el = document.createElement('div'); el.className = 'can';
  el.innerHTML = '<img src="'+b.image+'"><div class="nm">'+esc(b.name||'Unnamed')+'</div><div class="st">'+stars(b.rating)+'</div>';
  el.addEventListener('click', () => openDetail(idx));
  grid.appendChild(el);
});
function openDetail(idx){
  const b = DATA[idx];
  const priceStr = (b.priceAmount!=null && b.priceAmount!=='') ? ((CUR[b.priceCurrency]||'')+Number(b.priceAmount).toFixed(2)+' '+(!CUR[b.priceCurrency]?(b.priceCurrency||''):'')) : '—';
  document.getElementById('sheet').innerHTML =
    '<img class="main" src="'+b.image+'">'+
    '<div class="row"><span>Name</span><span>'+esc(b.name)+'</span></div>'+
    '<div class="row"><span>Brewery</span><span>'+(esc(b.brewery)||'—')+'</span></div>'+
    '<div class="row"><span>Style</span><span>'+(esc(b.style)||'—')+'</span></div>'+
    '<div class="row"><span>ABV</span><span>'+(b.abv?Number(b.abv).toFixed(1)+'%':'—')+'</span></div>'+
    '<div class="row"><span>Serving</span><span>'+(esc(b.serving)||'—')+'</span></div>'+
    '<div class="row"><span>Rating</span><span style="color:#FFB300;">'+stars(b.rating)+'</span></div>'+
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
