/* ═══════════════════════════════════════════════════════════
   MEDIA SITE — app.js
═══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

const STORAGE_KEY    = 'media_items_v1';
const YT_API_KEY     = 'AIzaSyAZUCqqyzKfbFLyRP7qOasCGTgsA65tyy0';
const SUPABASE_URL   = 'https://ykbwyuazigomirpskdie.supabase.co';
const SUPABASE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrYnd5dWF6aWdvbWlycHNrZGllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NjQ1MjksImV4cCI6MjA5NTI0MDUyOX0.-PWhM1i4xNgE0e77YehMBDCMMKTlQWf-PxjqJoTmdr4';
const BUCKET         = 'BucketOne';

/* ── State ──────────────────────────────────────────────── */
let items            = loadItems();
let currentFilter    = 'all';
let currentFile      = null;
let panicActive      = false;
let searchPageTokens = [null];
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
const uploadStatus  = $('uploadStatus');

/* ── Panic Button ───────────────────────────────────────── */
const panicBtn = document.createElement('button');
panicBtn.textContent = '⬜';
panicBtn.title = 'Hide screen (K)';
panicBtn.style.cssText = `
  background: #1a1a1a !important;
  border: 1px solid #2a2a2a !important;
  color: #555 !important;
  font-size: 16px;
  width: 36px !important;
  height: 36px !important;
  padding: 0 !important;
  border-radius: 6px !important;
  cursor: pointer;
  margin-top: auto;
  align-self: flex-start;
`;
document.getElementById('sidebar').appendChild(panicBtn);

const panicOverlay = document.createElement('div');
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
  if (!videoPlayer.paused) videoPlayer.pause();
  if (!audioPlayer.paused) audioPlayer.pause();
  const iframe = document.getElementById('ytFrame');
  if (iframe) iframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
}

function deactivatePanic() {
  panicActive = false;
  panicOverlay.style.display = 'none';
}

panicBtn.addEventListener('click', () => panicActive ? deactivatePanic() : activatePanic());
panicOverlay.addEventListener('click', deactivatePanic);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && panicActive) deactivatePanic();
  if (e.key === 'k' && !e.target.matches('input, textarea')) {
    panicActive ? deactivatePanic() : activatePanic();
  }
});

/* ── Helpers ────────────────────────────────────────────── */
function loadItems() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveItems() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.filter(it => !it.blob)));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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

const progressWrap = $('progressWrap');
const progressBar  = $('progressBar');

/* ── Supabase Upload ────────────────────────────────────── */
fileInput.addEventListener('change', () => {
  currentFile = fileInput.files[0] || null;
  fileNameEl.textContent = currentFile ? currentFile.name : 'No file chosen';
  if (currentFile) uploadFile();
});

function uploadFile() {
  const file  = currentFile;
  const safeName = file.name
    .replace(/[^\x00-\x7F]/g, '')  // remove non-ASCII (Arabic etc.)
    .replace(/\s+/g, '_')           // spaces to underscores
    .replace(/[^a-zA-Z0-9._-]/g, '') // remove any remaining special chars
    || 'file';                        // fallback if name becomes empty
  const ext   = file.name.split('.').pop();
  const fname = `${uid()}_${safeName || 'upload'}.${ext}`;
  const type  = file.type.startsWith('video') ? 'video' : 'audio';
  const title = file.name.replace(/\.[^.]+$/, '');

  setUploadStatus('Uploading…', '#888');
  progressWrap.classList.remove('hidden');
  progressBar.style.width = '0%';
  addFileBtn.disabled = true;

  const xhr = new XMLHttpRequest();

  xhr.upload.addEventListener('progress', e => {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      progressBar.style.width = pct + '%';
      setUploadStatus(`Uploading… ${pct}%`, '#888');
    }
  });

  xhr.addEventListener('load', () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${fname}`;
      items.unshift({ id: uid(), src: publicUrl, type, title });
      saveItems();
      render();
      progressBar.style.width = '100%';
      setUploadStatus('✓ Uploaded', '#4caf50');
      setTimeout(() => {
        progressWrap.classList.add('hidden');
        progressBar.style.width = '0%';
        setUploadStatus('', '');
      }, 3000);
    } else {
      setUploadStatus('✗ Upload failed', '#ff4444');
      progressWrap.classList.add('hidden');
      setTimeout(() => setUploadStatus('', ''), 4000);
    }
    addFileBtn.disabled = false;
    fileInput.value        = '';
    fileNameEl.textContent = 'No file chosen';
    currentFile            = null;
  });

  xhr.addEventListener('error', () => {
    setUploadStatus('✗ Network error', '#ff4444');
    progressWrap.classList.add('hidden');
    setTimeout(() => setUploadStatus('', ''), 4000);
    addFileBtn.disabled = false;
    currentFile = null;
  });

  xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${fname}`);
  xhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_KEY}`);
  xhr.setRequestHeader('Content-Type', file.type);
  xhr.setRequestHeader('x-upsert', 'true');
  xhr.send(file);
}

function setUploadStatus(msg, color) {
  uploadStatus.textContent = msg;
  uploadStatus.style.color = color;
}

/* ── YouTube Search ─────────────────────────────────────── */
searchBtn.addEventListener('click', () => doSearch());
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

async function doSearch(pageToken = null) {
  const q = searchInput.value.trim();
  if (!q) return;

  if (q !== lastQuery) {
    lastQuery = q;
    searchPageTokens = [null];
    searchPageIndex = 0;
    pageToken = null;
  }

  searchPanel.classList.remove('hidden');
  searchGrid.innerHTML = '';
  searchLoading.classList.remove('hidden');
  searchEmpty.classList.add('hidden');
  prevPageBtn.classList.add('hidden');
  nextPageBtn.classList.add('hidden');
  searchLabel.textContent = `Results for "${q}"`;

  try {
    let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=12&q=${encodeURIComponent(q)}&key=${YT_API_KEY}`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const res  = await fetch(url);
    const data = await res.json();

    searchLoading.classList.add('hidden');

    if (data.error) {
      searchEmpty.textContent = `Error: ${data.error.message}`;
      searchEmpty.classList.remove('hidden');
      return;
    }

    const results = data.items || [];
    if (results.length === 0) { searchEmpty.classList.remove('hidden'); return; }

    if (data.nextPageToken && searchPageTokens.length === searchPageIndex + 1) {
      searchPageTokens.push(data.nextPageToken);
    }

    renderSearchResults(results);

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
      <button class="result-add" title="Save to library">+ Save</button>
    `;

    card.addEventListener('click', e => {
      if (e.target.classList.contains('result-add')) return;
      playYouTube(videoId, title);
    });

    card.querySelector('.result-add').addEventListener('click', e => {
      e.stopPropagation();
      addToLibrary({ videoId, title, channel, thumb });
      const btn = e.currentTarget;
      btn.textContent = '✓ Saved';
      setTimeout(() => { btn.textContent = '+ Save'; }, 1500);
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
  playerWrap.innerHTML = '';
  const iframe = document.createElement('iframe');
  iframe.id = 'ytFrame';
  iframe.src = ytEmbed(videoId);
  iframe.allow = 'autoplay; encrypted-media; fullscreen';
  iframe.allowFullscreen = true;
  iframe.style.cssText = 'width:100%;min-height:280px;max-height:50vh;border:none;display:block;';
  playerWrap.appendChild(iframe);
}

/* ── Play Item ──────────────────────────────────────────── */
function playItem(item) {
  stopAllMedia();
  playerSection.classList.remove('hidden');
  nowTitle.textContent = item.title;

  const iframe = document.getElementById('ytFrame');
  if (iframe || !document.getElementById('videoPlayer')) {
    playerWrap.innerHTML = '';
    playerWrap.appendChild(videoPlayer);
    playerWrap.appendChild(audioPlayer);
  }

  videoPlayer.classList.add('hidden');
  audioPlayer.classList.add('hidden');

  if (item.youtube) { playYouTube(item.videoId, item.title); return; }

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
  const f = document.getElementById('ytFrame');
  if (f) f.src = '';
}

/* ── Library ────────────────────────────────────────────── */
function addToLibrary({ videoId, title, channel, thumb }) {
  if (items.find(it => it.videoId === videoId)) return;
  items.unshift({ id: uid(), videoId, title, channel, thumb, type: 'video', youtube: true });
  saveItems();
  render();
}

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

function removeItem(id) {
  const item = items.find(it => it.id === id);
  if (item?.blob && item.src) URL.revokeObjectURL(item.src);
  items = items.filter(it => it.id !== id);
  saveItems();
  render();
}

clearBtn.addEventListener('click', () => {
  if (!confirm('Remove all items from your library?')) return;
  items = [];
  localStorage.removeItem(STORAGE_KEY);
  closePlayer.click();
  render();
});

closePlayer.addEventListener('click', () => {
  stopAllMedia();
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

navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    navBtns.forEach(b => b.classList.remove('active'));
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

  grid.innerHTML = '';

  if (filtered.length === 0) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  filtered.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = item.id;

    let thumbInner = item.type === 'video' ? '▶' : '♪';
    if (item.thumb) thumbInner = `<img src="${item.thumb}" alt="" loading="lazy" onerror="this.style.display='none'" />`;

    const channelLine = item.channel ? `<div class="card-channel">${item.channel}</div>` : '';

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

/* ── Mobile Bottom Nav ──────────────────────────────────── */
const bottomNav  = $('bottomNav');
const bnavAll    = $('bnavAll');
const bnavUpload = $('bnavUpload');
const bnavMenu   = $('bnavMenu');

if (bottomNav) {
  const sidebar = $('sidebar');

  bnavAll.addEventListener('click', () => {
    sidebar.classList.remove('open');
    bnavAll.classList.add('active');
    bnavMenu.classList.remove('active');
  });

  bnavUpload.addEventListener('click', () => {
    sidebar.classList.remove('open');
    fileInput.click();
  });

  bnavMenu.addEventListener('click', () => {
    const isOpen = sidebar.classList.toggle('open');
    bnavMenu.classList.toggle('active', isOpen);
    bnavAll.classList.remove('active');
  });

  // Close sidebar when tapping outside
  document.addEventListener('click', e => {
    if (sidebar.classList.contains('open') &&
        !sidebar.contains(e.target) &&
        !bnavMenu.contains(e.target)) {
      sidebar.classList.remove('open');
      bnavMenu.classList.remove('active');
    }
  });
}

/* ── Init ───────────────────────────────────────────────── */
render();

}); // end DOMContentLoaded