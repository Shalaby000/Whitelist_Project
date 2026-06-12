/* ═══════════════════════════════════════════════════════════
   WHITELIST — app.js
═══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

const API          = 'https://pk58vbedrk.execute-api.eu-west-1.amazonaws.com/prod';
const PASSWORD_HASH = '99452b87584654dcce539e9b7618bf342964a00bd258dd46950f4bca75db07f8';

/* ── State ──────────────────────────────────────────────── */
let items         = [];
let currentFilter = 'all';
let panicActive   = false;
let nowPlayingId  = null;

/* ── DOM ────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const loginScreen  = $('loginScreen');
const loginInput   = $('loginInput');
const loginBtn     = $('loginBtn');
const loginError   = $('loginError');
const app          = $('app');
const panicBtn     = $('panicBtn');
const panicOverlay = $('panicOverlay');
const playerSection= $('playerSection');
const audioPlayer  = $('audioPlayer');
const nowTitle     = $('nowTitle');
const closePlayer  = $('closePlayer');
const urlInput     = $('urlInput');
const titleInput   = $('titleInput');
const addUrlBtn    = $('addUrlBtn');
const fileInput    = $('fileInput');
const fileNameEl   = $('fileName');
const addFileBtn   = $('addFileBtn');
const uploadQueue  = $('uploadQueue');
const clearBtn     = $('clearBtn');
const filterBtns   = document.querySelectorAll('.filter-btn');
const library      = $('library');
const empty        = $('empty');

/* ── Login ──────────────────────────────────────────────── */
async function hashPassword(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function tryLogin() {
  const hash = await hashPassword(loginInput.value);
  if (hash === PASSWORD_HASH) {
    sessionStorage.setItem('auth', '1');
    loginScreen.classList.add('hidden');
    app.classList.remove('hidden');
    await initApp();
  } else {
    loginError.textContent = 'Incorrect password';
    loginInput.value = '';
    loginInput.focus();
    setTimeout(() => { loginError.textContent = ''; }, 2000);
  }
}

loginBtn.addEventListener('click', tryLogin);
loginInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });

if (sessionStorage.getItem('auth') === '1') {
  loginScreen.classList.add('hidden');
  app.classList.remove('hidden');
  initApp();
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

/* ── AWS DB ──────────────────────────────────────────────── */
async function dbLoad() {
  try {
    const res  = await fetch(`${API}/library`);
    const data = await res.json();
    if (Array.isArray(data)) {
      items = data.map(r => ({
        id:    r.id,
        src:   r.src,
        type:  r.type,
        title: r.title,
      }));
      render();
    }
  } catch(e) { console.error('Library load failed', e); }
}

async function dbInsert(item) {
  try {
    await fetch(`${API}/library`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id:      item.id,
        src:     item.src    || '',
        type:    item.type,
        title:   item.title,
        videoid: '',
        channel: '',
        thumb:   '',
        youtube: false,
      })
    });
  } catch(e) { console.error('DB insert failed', e); }
}

async function dbDelete(id) {
  try {
    await fetch(`${API}/library/${id}`, { method: 'DELETE' });
  } catch(e) { console.error('DB delete failed', e); }
}

async function dbClear() {
  try {
    await fetch(`${API}/library`, { method: 'DELETE' });
  } catch(e) { console.error('DB clear failed', e); }
}

/* ── Helpers ────────────────────────────────────────────── */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function detectType(src) {
  return 'audio';
}

/* ── Add URL ────────────────────────────────────────────── */
addUrlBtn.addEventListener('click', async () => {
  const raw   = urlInput.value.trim();
  if (!raw) return;
  const type  = detectType(raw);
  const title = titleInput.value.trim() || raw.split('/').pop().split('?')[0] || 'Untitled';
  const item  = { id: uid(), src: raw, type, title };
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

function getBaseName(file) {
  return file.name.replace(/\.[^.]+$/, '').toLowerCase().trim();
}

function isDuplicate(file) {
  const base = getBaseName(file);
  return items.some(it => (it.title || '').toLowerCase().trim() === base);
}

function prepareUpload(file) {
  if (isDuplicate(file)) {
    showDuplicateWarning(file);
  } else {
    uploadFile(file, file.name);
  }
}

function showDuplicateWarning(file) {
  const item = document.createElement('div');
  item.className = 'upload-item duplicate-warning';
  item.innerHTML = `
    <div class="upload-item-header">
      <span class="upload-item-name" title="${file.name}">${file.name}</span>
      <span class="upload-item-status" style="color:#f0a500">⚠ Already exists</span>
    </div>
    <div class="duplicate-actions">
      <input class="rename-input" type="text" placeholder="New name (without extension)" />
      <button class="dup-rename-btn">Rename & Upload</button>
      <button class="dup-skip-btn">Skip</button>
    </div>
  `;
  uploadQueue.appendChild(item);

  const renameInput = item.querySelector('.rename-input');
  const renameBtn   = item.querySelector('.dup-rename-btn');
  const skipBtn     = item.querySelector('.dup-skip-btn');

  renameBtn.addEventListener('click', () => {
    const newName = renameInput.value.trim();
    if (!newName) { renameInput.focus(); return; }
    const ext = file.name.split('.').pop();
    const renamedFile = new File([file], `${newName}.${ext}`, { type: file.type });
    item.remove();
    uploadFile(renamedFile, renamedFile.name);
  });

  skipBtn.addEventListener('click', () => item.remove());
}

async function uploadFile(file, displayName) {
  const safeName = file.name
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '') || 'file';
  const ext   = file.name.split('.').pop();
  const fname = `${uid()}_${safeName}.${ext}`;
  const title = displayName.replace(/\.[^.]+$/, '');

  const item = document.createElement('div');
  item.className = 'upload-item';
  item.innerHTML = `
    <div class="upload-item-header">
      <span class="upload-item-name" title="${displayName}">${displayName}</span>
      <span class="upload-item-status" style="color:var(--sub)">Preparing…</span>
    </div>
    <div class="upload-item-bar-wrap">
      <div class="upload-item-bar"></div>
    </div>
  `;
  uploadQueue.appendChild(item);

  const statusEl = item.querySelector('.upload-item-status');
  const barEl    = item.querySelector('.upload-item-bar');
  const headerEl = item.querySelector('.upload-item-header');

  function setStatus(msg, color) {
    statusEl.textContent = msg;
    statusEl.style.color = color;
  }

  async function doUpload() {
    // Remove retry button if present
    const existingRetry = item.querySelector('.retry-btn');
    if (existingRetry) existingRetry.remove();
    barEl.className = 'upload-item-bar';
    barEl.style.width = '0%';
    setStatus('Preparing…', 'var(--sub)');

    try {
      const urlRes = await fetch(`${API}/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: fname, mimetype: file.type })
      });
      const { uploadUrl, publicUrl } = await urlRes.json();

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

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
            const newItem = { id: uid(), src: publicUrl, type: 'audio', title };
            items.unshift(newItem);
            render();
            await dbInsert(newItem);
            setTimeout(() => item.remove(), 4000);
            resolve();
          } else {
            barEl.classList.add('error');
            setStatus('✗ Failed', '#ff4444');
            addRetryBtn();
            reject();
          }
        });

        xhr.addEventListener('error', () => {
          barEl.classList.add('error');
          setStatus('✗ Network error', '#ff4444');
          addRetryBtn();
          reject();
        });

        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });

    } catch {
      barEl.classList.add('error');
      setStatus('✗ Failed', '#ff4444');
      addRetryBtn();
    }
  }

  function addRetryBtn() {
    if (item.querySelector('.retry-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'retry-btn';
    btn.textContent = '↺ Retry';
    btn.addEventListener('click', doUpload);
    headerEl.appendChild(btn);
  }

  doUpload();
}

/* ── Play ───────────────────────────────────────────────── */
function playItem(item) {
  audioPlayer.src = item.src;
  audioPlayer.play();
  nowTitle.textContent = item.title;
  playerSection.classList.remove('hidden');
  nowPlayingId = item.id;
  render();
}

closePlayer.addEventListener('click', () => {
  audioPlayer.pause();
  audioPlayer.src = '';
  playerSection.classList.add('hidden');
  nowPlayingId = null;
  render();
});

/* ── Remove ─────────────────────────────────────────────── */
async function removeItem(id) {
  if (nowPlayingId === id) closePlayer.click();
  items = items.filter(it => it.id !== id);
  render();
  await dbDelete(id);
}

/* ── Clear ──────────────────────────────────────────────── */
clearBtn.addEventListener('click', async () => {
  if (!confirm('Remove all items from your library?')) return;
  closePlayer.click();
  items = [];
  render();
  await dbClear();
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

/* ── Render ─────────────────────────────────────────────── */
function render() {
  const filtered = currentFilter === 'all'
    ? items
    : items.filter(it => it.type === currentFilter);

  library.innerHTML = '';

  if (!filtered.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  filtered.forEach(item => {
    const row = document.createElement('div');
    row.className = 'audio-row' + (item.id === nowPlayingId ? ' playing' : '');

    const icon = '♪';

    row.innerHTML = `
      <div class="audio-icon">${icon}</div>
      <div class="audio-info">
        <div class="audio-title" title="${item.title}">${item.title}</div>
        <div class="audio-type">${item.type}</div>
      </div>
      <button class="row-del" title="Remove">✕</button>
    `;

    row.addEventListener('click', e => {
      if (e.target.classList.contains('row-del')) return;
      playItem(item);
    });

    row.querySelector('.row-del').addEventListener('click', e => {
      e.stopPropagation();
      removeItem(item.id);
    });

    library.appendChild(row);
  });
}

}); // end DOMContentLoaded