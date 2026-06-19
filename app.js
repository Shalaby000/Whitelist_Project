/* ═══════════════════════════════════════════════════════════
   WHITELIST — app.js
═══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

const API           = 'https://pk58vbedrk.execute-api.eu-west-1.amazonaws.com/prod';

/* ── State ──────────────────────────────────────────────── */
let items         = [];
let currentFilter = 'all';
let searchQuery   = '';
let panicActive   = false;
let nowPlayingId  = null;
let isShuffled    = false;
let repeatMode    = 'none';
let shuffledOrder = [];
let SESSION_TOKEN = sessionStorage.getItem('wl_token') || '';

/* ── DOM ────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const loginScreen    = $('loginScreen');
const loginInput     = $('loginInput');
const loginBtn       = $('loginBtn');
const loginError     = $('loginError');
const app            = $('app');
const panicBtn       = $('panicBtn');
const panicOverlay   = $('panicOverlay');
const searchToggleBtn= $('searchToggleBtn');
const searchBar      = $('searchBar');
const searchQueryEl  = $('searchQuery');
const searchClearBtn = $('searchClearBtn');
const playerSection  = $('playerSection');
const audioPlayer    = $('audioPlayer');
const nowTitle       = $('nowTitle');
const closePlayer    = $('closePlayer');
const prevBtn        = $('prevBtn');
const nextBtn        = $('nextBtn');
const playPauseBtn   = $('playPauseBtn');
const shuffleBtn     = $('shuffleBtn');
const repeatBtn      = $('repeatBtn');
const seekSlider     = $('seekSlider');
const timeElapsed    = $('timeElapsed');
const timeTotal      = $('timeTotal');
const volumeSlider   = $('volumeSlider');
const volumeVal      = $('volumeVal');
const volumeIcon     = $('volumeIcon');
const urlInput       = $('urlInput');
const titleInput     = $('titleInput');
const addUrlBtn      = $('addUrlBtn');
const fileInput      = $('fileInput');
const fileNameEl     = $('fileName');
const uploadQueue    = $('uploadQueue');
const filterBtns     = document.querySelectorAll('.filter-btn');
const library        = $('library');
const empty          = $('empty');
const deleteModal    = $('deleteModal');
const deleteMsg      = $('deleteMsg');
const deleteWarning  = $('deleteWarning');
const deleteCancelBtn= $('deleteCancelBtn');
const deleteConfirmBtn=$('deleteConfirmBtn');

/* ── Login ──────────────────────────────────────────────── */
async function tryLogin() {
  loginBtn.disabled = true;
  loginError.textContent = '';
  try {
    const res  = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: loginInput.value })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      SESSION_TOKEN = data.token;
      sessionStorage.setItem('wl_token', SESSION_TOKEN);
      loginScreen.classList.add('hidden');
      app.classList.remove('hidden');
      await initApp();
    } else {
      loginError.textContent = 'Incorrect password';
      loginInput.value = '';
      loginInput.focus();
      setTimeout(() => { loginError.textContent = ''; }, 2000);
    }
  } catch {
    loginError.textContent = 'Connection error — try again';
  }
  loginBtn.disabled = false;
}

loginBtn.addEventListener('click', tryLogin);
loginInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });

if (SESSION_TOKEN) {
  loginScreen.classList.add('hidden');
  app.classList.remove('hidden');
  initApp();
}

/* ── Authenticated fetch ────────────────────────────────── */
async function authFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Token': SESSION_TOKEN,
      ...(options.headers || {})
    }
  });
  if (res.status === 401) {
    // Token expired — force re-login
    SESSION_TOKEN = '';
    sessionStorage.removeItem('wl_token');
    loginScreen.classList.remove('hidden');
    app.classList.add('hidden');
    loginError.textContent = 'Session expired — please log in again';
  }
  return res;
}

/* ── Init ───────────────────────────────────────────────── */
async function initApp() {
  await dbLoad();
}

/* ── Panic ──────────────────────────────────────────────── */
function activatePanic() {
  panicActive = true;
  panicOverlay.style.display = 'block';
  if (!audioPlayer.paused) audioPlayer.pause();
}
function deactivatePanic() {
  panicActive = false;
  panicOverlay.style.display = 'none';
}
panicBtn.addEventListener('click', () => panicActive ? deactivatePanic() : activatePanic());
panicOverlay.addEventListener('click', deactivatePanic);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && panicActive) deactivatePanic();
  if (e.key === 'k' && !e.target.matches('input,textarea')) {
    panicActive ? deactivatePanic() : activatePanic();
  }
});

/* ── Search ─────────────────────────────────────────────── */
searchToggleBtn.addEventListener('click', () => {
  const open = searchBar.classList.toggle('hidden');
  searchToggleBtn.classList.toggle('active', !open);
  if (!open) searchQueryEl.focus();
  else { searchQuery = ''; searchQueryEl.value = ''; render(); }
});

searchQueryEl.addEventListener('input', () => {
  searchQuery = searchQueryEl.value.toLowerCase().trim();
  render();
});

searchClearBtn.addEventListener('click', () => {
  searchQuery = '';
  searchQueryEl.value = '';
  searchQueryEl.focus();
  render();
});

/* ── DB ─────────────────────────────────────────────────── */
async function dbLoad() {
  try {
    const res  = await authFetch(`${API}/library`);
    const data = await res.json();
    if (Array.isArray(data)) {
      items = data.map(r => ({ id: r.id, src: r.src, type: r.type || 'audio', title: r.title }));
      render();
    }
  } catch(e) { console.error('Library load failed', e); }
}

async function dbInsert(item) {
  try {
    await authFetch(`${API}/library`, {
      method: 'POST',
      body: JSON.stringify({ id: item.id, src: item.src || '', type: item.type, title: item.title })
    });
  } catch(e) { console.error('DB insert failed', e); }
}

async function dbDelete(id) {
  try {
    await authFetch(`${API}/library/${id}`, { method: 'DELETE' });
  } catch(e) { console.error('DB delete failed', e); }
}

/* ── Helpers ────────────────────────────────────────────── */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/* ── Add URL ────────────────────────────────────────────── */
addUrlBtn.addEventListener('click', async () => {
  const raw   = urlInput.value.trim();
  if (!raw) return;
  const title = titleInput.value.trim() || raw.split('/').pop().split('?')[0] || 'Untitled';
  const item  = { id: uid(), src: raw, type: 'audio', title };
  items.unshift(item);
  render();
  await dbInsert(item);
  urlInput.value   = '';
  titleInput.value = '';
});
urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') addUrlBtn.click(); });

/* ── Upload ─────────────────────────────────────────────── */
fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files);
  if (!files.length) return;
  fileNameEl.textContent = files.length === 1 ? files[0].name : `${files.length} files selected`;
  files.forEach(file => prepareUpload(file));
  fileInput.value = '';
});

function getTitle(file) { return file.name.replace(/\.[^.]+$/, ''); }

function isDuplicate(file) {
  const title = getTitle(file).toLowerCase().trim();
  return items.some(it => (it.title || '').toLowerCase().trim() === title);
}

function prepareUpload(file) {
  if (isDuplicate(file)) showDuplicateWarning(file);
  else uploadFile(file, file.name);
}

function showDuplicateWarning(file) {
  const el = document.createElement('div');
  el.className = 'upload-item duplicate-warning';
  el.innerHTML = `
    <div class="upload-item-header">
      <span class="upload-item-name" title="${file.name}">⚠ Already exists: <strong>${getTitle(file)}</strong></span>
    </div>
    <p style="font-size:11px;color:var(--sub);margin-top:6px;">A track with this name is already in your library.</p>
    <div class="duplicate-actions">
      <input class="rename-input" type="text" placeholder="New name (without extension)" />
      <button class="dup-rename-btn">Rename & Upload</button>
      <button class="dup-skip-btn">Skip</button>
    </div>
  `;
  uploadQueue.appendChild(el);

  const renameInput = el.querySelector('.rename-input');
  const renameBtn   = el.querySelector('.dup-rename-btn');
  const skipBtn     = el.querySelector('.dup-skip-btn');

  renameBtn.addEventListener('click', () => {
    const newName = renameInput.value.trim();
    if (!newName) { renameInput.focus(); return; }
    const ext = file.name.split('.').pop();
    const renamed = new File([file], `${newName}.${ext}`, { type: file.type });
    el.remove();
    uploadFile(renamed, renamed.name);
  });
  skipBtn.addEventListener('click', () => el.remove());
}

async function uploadFile(file, displayName) {
  const safeName = file.name.replace(/[^\x00-\x7F]/g,'').replace(/\s+/g,'_').replace(/[^a-zA-Z0-9._-]/g,'') || 'file';
  const ext   = file.name.split('.').pop();
  const fname = `${uid()}_${safeName}.${ext}`;
  const title = displayName.replace(/\.[^.]+$/, '');

  const el = document.createElement('div');
  el.className = 'upload-item';
  el.innerHTML = `
    <div class="upload-item-header">
      <span class="upload-item-name" title="${displayName}">${displayName}</span>
      <span class="upload-item-status" style="color:var(--sub)">Preparing…</span>
      <button class="upload-cancel-btn" title="Cancel">✕</button>
    </div>
    <div class="upload-item-bar-wrap"><div class="upload-item-bar"></div></div>
  `;
  uploadQueue.appendChild(el);

  const statusEl  = el.querySelector('.upload-item-status');
  const barEl     = el.querySelector('.upload-item-bar');
  const headerEl  = el.querySelector('.upload-item-header');
  const cancelBtn = el.querySelector('.upload-cancel-btn');

  let xhr = null;
  let cancelled = false;

  cancelBtn.addEventListener('click', () => {
    cancelled = true;
    if (xhr) xhr.abort();
    el.remove();
  });

  function setStatus(msg, color) { statusEl.textContent = msg; statusEl.style.color = color; }

  async function doUpload() {
    const existingRetry = el.querySelector('.retry-btn');
    if (existingRetry) existingRetry.remove();
    barEl.className = 'upload-item-bar';
    barEl.style.width = '0%';
    setStatus('Preparing…', 'var(--sub)');

    try {
      const urlRes = await authFetch(`${API}/upload-url`, {
        method: 'POST',
        body: JSON.stringify({ filename: fname, mimetype: file.type })
      });
      const json = await urlRes.json();
      const uploadUrl = json.uploadUrl;
      const publicUrl = json.publicUrl;

      if (!uploadUrl) throw new Error('No upload URL returned');

      await new Promise((resolve, reject) => {
        xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            barEl.style.width = pct + '%';
            setStatus(`${pct}%`, '#888');
          }
        });

        xhr.addEventListener('load', async () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            barEl.style.width = '100%';
            barEl.classList.add('done');
            setStatus('✓ Done', '#4caf50');
            cancelBtn.style.display = 'none';
            const newItem = { id: uid(), src: publicUrl, type: 'audio', title };
            items.unshift(newItem);
            render();
            await dbInsert(newItem);
            setTimeout(() => el.remove(), 4000);
            resolve();
          } else {
            barEl.classList.add('error');
            setStatus('✗ Failed', '#ff4444');
            addRetryBtn();
            reject();
          }
        });

        xhr.addEventListener('error', () => {
          if (cancelled) return;
          barEl.classList.add('error');
          setStatus('✗ Network error', '#ff4444');
          addRetryBtn();
          reject();
        });

        xhr.addEventListener('abort', () => resolve());

        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });

    } catch(err) {
      if (cancelled) return;
      barEl.classList.add('error');
      setStatus('✗ Failed', '#ff4444');
      addRetryBtn();
    }
  }

  function addRetryBtn() {
    if (el.querySelector('.retry-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'retry-btn';
    btn.textContent = '↺ Retry';
    btn.addEventListener('click', doUpload);
    headerEl.insertBefore(btn, cancelBtn);
  }

  doUpload();
}

/* ── Player ─────────────────────────────────────────────── */
function getQueue() {
  const filtered = visibleItems();
  return filtered;
}

function currentIndex() {
  if (isShuffled) return shuffledOrder.indexOf(nowPlayingId);
  return getQueue().findIndex(it => it.id === nowPlayingId);
}

function playItem(item) {
  audioPlayer.src = item.src;
  audioPlayer.volume = parseFloat(volumeSlider.value);
  audioPlayer.play();
  nowTitle.textContent = item.title;
  playerSection.classList.remove('hidden');
  nowPlayingId = item.id;
  updatePlayPauseBtn();
  render();
}

audioPlayer.addEventListener('ended', () => {
  if (repeatMode === 'one') { audioPlayer.play(); return; }
  const queue = getQueue();
  if (!queue.length) return;
  const idx = currentIndex();
  if (repeatMode === 'all' || idx < queue.length - 1) {
    const next = queue[(idx + 1) % queue.length];
    if (next) playItem(next);
  } else {
    nowPlayingId = null;
    playerSection.classList.add('hidden');
    render();
  }
});

prevBtn.addEventListener('click', () => {
  const queue = getQueue();
  if (!queue.length) return;
  const idx = currentIndex();
  const prev = queue[idx <= 0 ? queue.length - 1 : idx - 1];
  if (prev) playItem(prev);
});

nextBtn.addEventListener('click', () => {
  const queue = getQueue();
  if (!queue.length) return;
  const idx = currentIndex();
  const next = queue[(idx + 1) % queue.length];
  if (next) playItem(next);
});

shuffleBtn.addEventListener('click', () => {
  isShuffled = !isShuffled;
  shuffleBtn.classList.toggle('active', isShuffled);
  if (isShuffled) {
    shuffledOrder = [...getQueue().map(it => it.id)].sort(() => Math.random() - 0.5);
  }
});

repeatBtn.addEventListener('click', () => {
  if (repeatMode === 'none') repeatMode = 'all';
  else if (repeatMode === 'all') repeatMode = 'one';
  else repeatMode = 'none';
  repeatBtn.classList.toggle('active', repeatMode !== 'none');
  repeatBtn.title = repeatMode === 'one' ? 'Repeat: One' : repeatMode === 'all' ? 'Repeat: All' : 'Repeat: Off';
  repeatBtn.textContent = repeatMode === 'one' ? '↻¹' : '↻';
});

/* ── Play/Pause & Stop ──────────────────────────────────── */
function updatePlayPauseBtn() {
  playPauseBtn.textContent = audioPlayer.paused ? '▶' : '⏸';
}

playPauseBtn.addEventListener('click', () => {
  if (audioPlayer.paused) audioPlayer.play();
  else audioPlayer.pause();
});

/* ── Seek bar ────────────────────────────────────────────── */
function formatTime(s) {
  if (isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

audioPlayer.addEventListener('timeupdate', () => {
  if (!audioPlayer.duration) return;
  const pct = (audioPlayer.currentTime / audioPlayer.duration) * 100;
  seekSlider.value = pct;
  timeElapsed.textContent = formatTime(audioPlayer.currentTime);
});

audioPlayer.addEventListener('loadedmetadata', () => {
  timeTotal.textContent = formatTime(audioPlayer.duration);
  seekSlider.value = 0;
  timeElapsed.textContent = '0:00';
});

seekSlider.addEventListener('input', () => {
  if (!audioPlayer.duration) return;
  audioPlayer.currentTime = (seekSlider.value / 100) * audioPlayer.duration;
});

audioPlayer.addEventListener('play',  updatePlayPauseBtn);
audioPlayer.addEventListener('pause', updatePlayPauseBtn);

/* ── Volume ─────────────────────────────────────────────── */
// Fix auto-volume-down bug — disable any browser audio normalization
audioPlayer.preservesPitch = true;

function setVolume(v) {
  audioPlayer.volume = v;
  volumeSlider.value = v;
  volumeVal.textContent = Math.round(v * 100) + '%';
  volumeIcon.textContent = v === 0 ? '🔇' : v < 0.5 ? '🔉' : '🔊';
}

volumeSlider.addEventListener('input', () => setVolume(parseFloat(volumeSlider.value)));

// Mute/unmute on icon click
let lastVolume = 1;
volumeIcon.addEventListener('click', () => {
  if (audioPlayer.volume > 0) { lastVolume = audioPlayer.volume; setVolume(0); }
  else setVolume(lastVolume);
});

// Prevent browser from silently changing volume
audioPlayer.addEventListener('volumechange', () => {
  volumeSlider.value = audioPlayer.volume;
  volumeVal.textContent = Math.round(audioPlayer.volume * 100) + '%';
  volumeIcon.textContent = audioPlayer.volume === 0 ? '🔇' : audioPlayer.volume < 0.5 ? '🔉' : '🔊';
});

setVolume(1);

closePlayer.addEventListener('click', () => {
  audioPlayer.pause();
  audioPlayer.src = '';
  playerSection.classList.add('hidden');
  nowPlayingId = null;
  render();
});

/* ── Delete Modal ────────────────────────────────────────── */
let pendingDeleteId = null;

function confirmDelete(id, title) {
  pendingDeleteId = id;
  deleteMsg.textContent = `Delete "${title}" from your library?`;
  deleteWarning.textContent = 'This action cannot be undone. The track will be permanently removed.';
  deleteModal.classList.remove('hidden');
}

deleteCancelBtn.addEventListener('click', () => {
  deleteModal.classList.add('hidden');
  pendingDeleteId = null;
});

deleteConfirmBtn.addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  deleteModal.classList.add('hidden');
  const id = pendingDeleteId;
  pendingDeleteId = null;
  if (nowPlayingId === id) closePlayer.click();
  items = items.filter(it => it.id !== id);
  render();
  await dbDelete(id);
});

// Close modal on backdrop click
deleteModal.addEventListener('click', e => {
  if (e.target === deleteModal) {
    deleteModal.classList.add('hidden');
    pendingDeleteId = null;
  }
});

/* ── Filter ─────────────────────────────────────────────── */
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    render();
  });
});

function visibleItems() {
  let list = currentFilter === 'all' ? items : items.filter(it => it.type === currentFilter);
  if (searchQuery) list = list.filter(it => (it.title || '').toLowerCase().includes(searchQuery));
  return list;
}

/* ── Render ─────────────────────────────────────────────── */
function render() {
  const filtered = visibleItems();
  library.innerHTML = '';

  if (!filtered.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  filtered.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'audio-row' + (item.id === nowPlayingId ? ' playing' : '');

    row.innerHTML = `
      <span class="audio-num">${item.id === nowPlayingId ? '♪' : idx + 1}</span>
      <div class="audio-info">
        <div class="audio-title" title="${item.title}">${item.title}</div>
      </div>
      <button class="row-del" title="Delete">✕</button>
    `;

    row.addEventListener('click', e => {
      if (e.target.classList.contains('row-del')) return;
      playItem(item);
    });

    row.querySelector('.row-del').addEventListener('click', e => {
      e.stopPropagation();
      confirmDelete(item.id, item.title);
    });

    library.appendChild(row);
  });
}

}); // end DOMContentLoaded