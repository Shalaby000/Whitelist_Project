/* ═══════════════════════════════════════════════════════════
   MEDIA SITE — app.js
   Features: YouTube search, URL add, file upload, panic button
═══════════════════════════════════════════════════════════ */

const STORAGE_KEY    = 'media_items_v1';
const API_KEY_STORE  = 'yt_api_key_v1';

/* ── State ──────────────────────────────────────────────── */
let items         = loadItems();
let currentFilter = 'all';
let currentFile   = null;
let panicActive   = false;
let pausedByPanic = false;

// YouTube search pagination
let searchResults   = [];
let searchPageTokens = [null]; // index 0 = first page (no token)
let searchPageIndex  = 0;
let lastQuery        = '';

/* ── DOM ────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const grid          = $('grid');
const empty         = $('empty');
const urlInput      = $('urlInput');
const titleInput    = $('titleInput');
const addUrlBtn     = $('addUrlBtn');
const fileInput     = $('fileInput');
const fileNameEl    = $('fileName');
const addFileBtn    = $('addFileBtn');
const clearBtn      = $('clearBtn');
const navBtns       = document.querySelectorAll('.nav-btn');

const playerSection = $('playerSection');
const playerWrap    = $('playerWrap');
const videoPlayer   = $('videoPlayer');
const audioPlayer   = $('audioPlayer');
const nowTitle      = $('nowTitle');
const closePlayer   = $('closePlayer');

const searchInput   = $('searchInput');
const searchBtn     = $('searchBtn');
const searchPanel   = $('searchPanel');
const searchGrid    = $('searchGrid');
const searchLabel   = $('searchLabel');
const searchLoading = $('searchLoading');
const searchEmpty   = $('searchEmpty');
const closeSearch   = $('closeSearch');
const prevPageBtn   = $('prevPageBtn');
const nextPageBtn   = $('nextPageBtn');

const apiKeyInput   = $('apiKeyInput');
const saveApiKeyBtn = $('saveApiKeyBtn');
const apiKeyStatus  = $('apiKeyStatus');

/* ── Panic Button (injected into sidebar) ───────────────── */
const panicBtn = document.createElement('button');
panicBtn.id = 'panicBtn';
panicBtn.title = 'Hide screen (press again or Esc to restore)';
panicBtn.textContent = '⬜  Hide screen';
panicBtn.style.cssText = `
  background: #1a1a1a !important;
  border: 1px solid #333 !important;
  color: #888 !important;
  font-size: 12px;
  letter-spacing: 0.03em;
  margin-top: auto;
`;
document.getElementById('sidebar').appendChild(panicBtn);

/* ── Panic Overlay ──────────────────────────────────────── */
const panicOverlay = document.createElement('div');
panicOverlay.id = 'panicOverlay';
panicOverlay.style.cssText = `
  display: none;
  position: fixed;
  inset: 0;
  background: #ffffff;
  z-index: 99999;
  cursor: pointer;
`;
document.body.appendChild(panicOverlay);

function activatePanic() {
  panicActive = true;
  panicOverlay.style.display = 'block';

  // Pause any playing media silently
  if (!videoPlayer.paused) { videoPlayer.pause(); pausedByPanic = true; }
  if (!audioPlayer.paused) { audioPlayer.pause(); pausedByPanic = true; }
  const iframe = document.getElementById('ytFrame');
  if (iframe) { iframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*'); pausedByPanic = true; }
}

function deactivatePanic() {
  panicActive = false;
  panicOverlay.style.display = 'none';
  pausedByPanic = false;
}

panicBtn.addEventListener('click', () => {
  panicActive ? deactivatePanic() : activatePanic();
});
panicOverlay.addEventListener('click', deactivatePanic);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && panicActive) deactivatePanic();
  // Shortcut: backtick ` key anywhere
  if (e.key === '`' && !e.target.matches('input, textarea')) {
    panicActive ? deactivatePanic() : activatePanic();
  }
});

/* ── Helpers ────────────────────────────────────────────── */
function loadItems() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveItems() {
  const saveable = items.filter(it => !it.blob);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saveable));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getApiKey() {
  return 'AIzaSyAZUCqqyzKfbFLyRP7qOasCGTgsA65tyy0';
}

function detectType(src) {
  const s = src.toLowerCase().split('?')[0];
  if (/\.(mp4|webm|mov|mkv|avi|m4v|ogv)$/.test(s)) return 'video';
  if (/\.(mp3|wav|ogg|flac|aac|m4a|opus)$/.test(s)) return 'audio';
  if (/youtube\.com|youtu\.be|vimeo\.com/.test(src)) return 'video';
  if (/soundcloud\.com|spotify\.com/.test(src)) return 'audio';
  return 'video';
}

function getYouTubeId(url) {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function ytEmbed(videoId) {
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1`;
}

function ytThumb(videoId) {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

/* ── API Key ────────────────────────────────────────────── */
function initApiKeyUI() {
  const saved = getApiKey();
  if (saved) {
    apiKeyInput.value = saved;
    apiKeyStatus.textContent = '✓ Key saved';
    apiKeyStatus.className = 'ok';
  }
}

saveApiKeyBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key) { apiKeyStatus.textContent = 'Enter a key first'; apiKeyStatus.className = 'err'; return; }
  localStorage.setItem(API_KEY_STORE, key);
  apiKeyStatus.textContent = '✓ Key saved';
  apiKeyStatus.className = 'ok';
});

/* ── YouTube Search ─────────────────────────────────────── */
searchBtn.addEventListener('click', doSearch);
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

async function doSearch(pageToken = null) {
  const q = searchInput.value.trim();
  if (!q) return;

  const key = getApiKey();
  if (!key) {
    apiKeyStatus.textContent = '⚠ Add API key first';
    apiKeyStatus.className = 'err';
    apiKeyInput.focus();
    return;
  }

  if (q !== lastQuery) {
    // New query — reset pagination
    lastQuery = q;
    searchPageTokens = [null];
    searchPageIndex = 0;
    if (pageToken === null) pageToken = null;
  }

  searchPanel.classList.remove('hidden');
  searchGrid.innerHTML = '';
  searchLoading.classList.remove('hidden');
  searchEmpty.classList.add('hidden');
  prevPageBtn.classList.add('hidden');
  nextPageBtn.classList.add('hidden');
  searchLabel.textContent = `Results for "${q}"`;

  try {
    let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=12&q=${encodeURIComponent(q)}&key=${key}`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const res  = await fetch(url);
    const data = await res.json();

    searchLoading.classList.add('hidden');

    if (data.error) {
      searchEmpty.textContent = `API error: ${data.error.message}`;
      searchEmpty.classList.remove('hidden');
      return;
    }

    const results = data.items || [];
    if (results.length === 0) {
      searchEmpty.classList.remove('hidden');
      return;
    }

    // Store next page token
    if (data.nextPageToken) {
      if (searchPageTokens.length === searchPageIndex + 1) {
        searchPageTokens.push(data.nextPageToken);
      }
    }

    renderSearchResults(results);

    // Pagination buttons
    if (searchPageIndex > 0) prevPageBtn.classList.remove('hidden');
    if (data.nextPageToken)  nextPageBtn.classList.remove('hidden');

  } catch (err) {
    searchLoading.classList.add('hidden');
    searchEmpty.textContent = 'Network error. Check your connection.';
    searchEmpty.classList.remove('hidden');
  }
}

prevPageBtn.addEventListener('click', () => {
  searchPageIndex = Math.max(0, searchPageIndex - 1);
  doSearch(searchPageTokens[searchPageIndex]);
});

nextPageBtn.addEventListener('click', () => {
  searchPageIndex++;
  doSearch(searchPageTokens[searchPageIndex]);
});

function renderSearchResults(results) {
  searchGrid.innerHTML = '';
  results.forEach(item => {
    const videoId = item.id.videoId;
    const title   = item.snippet.title;
    const channel = item.snippet.channelTitle;
    const thumb   = item.snippet.thumbnails?.medium?.url || ytThumb(videoId);

    const card = document.createElement('div');
    card.className = 'result-card';
    card.innerHTML = `
      <img class="result-thumb" src="${thumb}" alt="" loading="lazy" />
      <div class="result-info">
        <div class="result-title" title="${title}">${title}</div>
        <div class="result-channel">${channel}</div>
      </div>
      <button class="result-add" title="Add to library">+</button>
    `;

    // Play on click
    card.addEventListener('click', e => {
      if (e.target.classList.contains('result-add')) return;
      playYouTube(videoId, title);
    });

    // Add to library
    card.querySelector('.result-add').addEventListener('click', e => {
      e.stopPropagation();
      addToLibrary({ videoId, title, channel, thumb });
      const btn = e.currentTarget;
      btn.textContent = '✓';
      btn.style.background = '#4caf50 !important';
      setTimeout(() => { btn.textContent = '+'; btn.style.background = ''; }, 1500);
    });

    searchGrid.appendChild(card);
  });
}

closeSearch.addEventListener('click', () => {
  searchPanel.classList.add('hidden');
  searchGrid.innerHTML = '';
  lastQuery = '';
  searchPageTokens = [null];
  searchPageIndex = 0;
});

/* ── Play YouTube ───────────────────────────────────────── */
function playYouTube(videoId, title) {
  stopAllMedia();
  playerSection.classList.remove('hidden');
  nowTitle.textContent = title;

  // Remove existing iframe or native players
  playerWrap.innerHTML = '';

  const iframe = document.createElement('iframe');
  iframe.id = 'ytFrame';
  iframe.src = ytEmbed(videoId);
  iframe.allow = 'autoplay; encrypted-media; fullscreen';
  iframe.allowFullscreen = true;
  iframe.style.cssText = 'width:100%;min-height:280px;max-height:50vh;border:none;display:block;';
  playerWrap.appendChild(iframe);
}

/* ── Play local / URL ───────────────────────────────────── */
function playItem(item) {
  stopAllMedia();
  playerSection.classList.remove('hidden');
  nowTitle.textContent = item.title;

  // Restore native players if needed
  if (!document.getElementById('videoPlayer')) {
    playerWrap.innerHTML = '';
    playerWrap.appendChild(videoPlayer);
    playerWrap.appendChild(audioPlayer);
  } else {
    const iframe = document.getElementById('ytFrame');
    if (iframe) {
      playerWrap.innerHTML = '';
      playerWrap.appendChild(videoPlayer);
      playerWrap.appendChild(audioPlayer);
    }
  }

  videoPlayer.classList.add('hidden');
  audioPlayer.classList.add('hidden');

  if (item.youtube) {
    playYouTube(item.videoId, item.title);
    return;
  }

  if (item.type === 'video') {
    videoPlayer.classList.remove('hidden');
    videoPlayer.src = item.src;
    videoPlayer.play();
  } else {
    audioPlayer.classList.remove('hidden');
    audioPlayer.src = item.src;
    audioPlayer.play();
  }
}

function stopAllMedia() {
  if (!videoPlayer.paused) videoPlayer.pause();
  if (!audioPlayer.paused) audioPlayer.pause();
  videoPlayer.src = '';
  audioPlayer.src = '';
  const oldFrame = document.getElementById('ytFrame');
  if (oldFrame) oldFrame.src = '';
}

/* ── Add to Library ─────────────────────────────────────── */
function addToLibrary({ videoId, title, channel, thumb }) {
  // Avoid duplicates
  if (items.find(it => it.videoId === videoId)) return;
  items.unshift({ id: uid(), videoId, title, channel, thumb, type: 'video', youtube: true });
  saveItems();
  render();
}

/* ── Add from URL ───────────────────────────────────────── */
addUrlBtn.addEventListener('click', () => {
  const raw = urlInput.value.trim();
  if (!raw) return;

  const ytId = getYouTubeId(raw);
  if (ytId) {
    addToLibrary({ videoId: ytId, title: titleInput.value.trim() || raw, channel: '', thumb: ytThumb(ytId) });
  } else {
    const type  = detectType(raw);
    const title = titleInput.value.trim() || raw.split('/').pop().split('?')[0] || 'Untitled';
    items.unshift({ id: uid(), src: raw, type, title });
    saveItems();
    render();
  }

  urlInput.value   = '';
  titleInput.value = '';
});
urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') addUrlBtn.click(); });

/* ── Upload File ────────────────────────────────────────── */
fileInput.addEventListener('change', () => {
  currentFile = fileInput.files[0] || null;
  fileNameEl.textContent = currentFile ? currentFile.name : 'No file chosen';
});

addFileBtn.addEventListener('click', () => {
  if (!currentFile) return;
  const src   = URL.createObjectURL(currentFile);
  const type  = currentFile.type.startsWith('video') ? 'video' : 'audio';
  const title = titleInput.value.trim() || currentFile.name.replace(/\.[^.]+$/, '');
  items.unshift({ id: uid(), src, type, title, blob: true });
  render();
  fileInput.value     = '';
  fileNameEl.textContent = 'No file chosen';
  titleInput.value    = '';
  currentFile         = null;
});

/* ── Remove Item ────────────────────────────────────────── */
function removeItem(id) {
  const item = items.find(it => it.id === id);
  if (item?.blob && item.src) URL.revokeObjectURL(item.src);
  items = items.filter(it => it.id !== id);
  saveItems();
  render();
}

/* ── Clear All ──────────────────────────────────────────── */
clearBtn.addEventListener('click', () => {
  if (!confirm('Remove all items from your library?')) return;
  items.forEach(it => { if (it.blob && it.src) URL.revokeObjectURL(it.src); });
  items = [];
  localStorage.removeItem(STORAGE_KEY);
  closePlayer.click();
  render();
});

/* ── Close Player ───────────────────────────────────────── */
closePlayer.addEventListener('click', () => {
  stopAllMedia();
  // Restore native players
  const iframe = document.getElementById('ytFrame');
  if (iframe) {
    playerWrap.innerHTML = '';
    playerWrap.appendChild(videoPlayer);
    playerWrap.appendChild(audioPlayer);
  }
  videoPlayer.classList.add('hidden');
  audioPlayer.classList.add('hidden');
  playerSection.classList.add('hidden');
});

/* ── Filter Nav ─────────────────────────────────────────── */
navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    navBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    render();
  });
});

/* ── Render Library ─────────────────────────────────────── */
function render() {
  const filtered = currentFilter === 'all'
    ? items
    : items.filter(it => it.type === currentFilter);

  grid.innerHTML = '';

  if (filtered.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  filtered.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = item.id;

    let thumbInner = item.type === 'video' ? '▶' : '♪';
    if (item.thumb) thumbInner = `<img src="${item.thumb}" alt="" loading="lazy" onerror="this.style.display='none'" />`;

    const channelLine = item.channel
      ? `<div class="card-channel">${item.channel}</div>` : '';

    card.innerHTML = `
      <div class="card-thumb">
        ${thumbInner}
        <span class="card-badge">${item.youtube ? 'youtube' : item.type}</span>
      </div>
      <div class="card-info">
        <div class="card-title" title="${item.title}">${item.title}</div>
        ${channelLine}
      </div>
      <button class="card-del" data-id="${item.id}" title="Remove">✕</button>
    `;

    card.addEventListener('click', e => {
      if (e.target.classList.contains('card-del')) return;
      playItem(item);
    });

    card.querySelector('.card-del').addEventListener('click', e => {
      e.stopPropagation();
      removeItem(item.id);
    });

    grid.appendChild(card);
  });
}

/* ── Init ───────────────────────────────────────────────── */
initApiKeyUI();
render();
