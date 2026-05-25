/* ═══════════════════════════════════════════════════════════
   MEDIA SITE — app.js
═══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

const YT_API_KEY   = 'AIzaSyAZUCqqyzKfbFLyRP7qOasCGTgsA65tyy0';
const SUPABASE_URL = 'https://ykbwyuazigomirpskdie.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrYnd5dWF6aWdvbWlycHNrZGllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NjQ1MjksImV4cCI6MjA5NTI0MDUyOX0.-PWhM1i4xNgE0e77YehMBDCMMKTlQWf-PxjqJoTmdr4';
const BUCKET       = 'BucketOne';
const DB_HEADERS   = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

/* ── State ──────────────────────────────────────────────── */
let items            = [];
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
const progressWrap  = $('progressWrap');
const progressBar   = $('progressBar');

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
$('sidebar').appendChild(panicBtn);

const panicOverlay = document.createElement('div');
panicOverlay.style.cssText = `
  display:none;position:fixed;inset:0;background:#fff;z-index:99999;cursor:pointer;
`;
document.body.appendChild(panicOverlay);

function activatePanic() {
  panicActive = true;
  panicOverlay.style.display = 'block';
  if (!videoPlayer.paused) videoPlayer.pause();
  if (!audioPlayer.paused) audioPlayer.pause();
  const f = document.getElementById('ytFrame');
  if (f) f.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}','*');
}
function deactivatePanic() { panicActive = false; panicOverlay.style.display = 'none'; }

panicBtn.addEventListener('click', () => panicActive ? deactivatePanic() : activatePanic());
panicOverlay.addEventListener('click', deactivatePanic);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && panicActive) deactivatePanic();
  if (e.key === 'k' && !e.target.matches('input,textarea')) {
    panicActive ? deactivatePanic() : activatePanic();
  }
});

/* ── Helpers ────────────────────────────────────────────── */
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

function ytEmbed(id) { return `https://www.youtube.com/embed/${id}?autoplay=1&enablejsapi=1`; }
function ytThumb(id) { return `https://img.youtube.com/vi/${id}/mqdefault.jpg`; }

/* ── Supabase DB ────────────────────────────────────────── */
async function dbLoad() {
  try {
    const res  = await fetch(`${SUPABASE_URL}/rest/v1/library?order=created_at.desc`, { headers: DB_HEADERS });
    const data = await res.json();
    if (Array.isArray(data)) {
      items = data.map(r => ({
        id:      r.id,
        videoid: r.videoid,
        src:     r.src,
        type:    r.type,
        title:   r.title,
        channel: r.channel,
        thumb:   r.thumb,
        youtube: r.youtube,
      }));
      render();
    }
  } catch(e) { console.error('Library load failed', e); }
}

async function dbInsert(item) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/library`, {
      method: 'POST',
      headers: DB_HEADERS,
      body: JSON.stringify({
        id:      item.id,
        videoid: item.videoid || null,
        src:     item.src    || null,
        type:    item.type,
        title:   item.title,
        channel: item.channel || null,
        thumb:   item.thumb   || null,
        youtube: item.youtube || false,
      })
    });
  } catch(e) { console.error('DB insert failed', e); }
}

async function dbDelete(id) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/library?id=eq.${id}`, {
      method: 'DELETE',
      headers: DB_HEADERS
    });
  } catch(e) { console.error('DB delete failed', e); }
}

async function dbClear() {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/library?id=neq.none`, {
      method: 'DELETE',
      headers: DB_HEADERS
    });
  } catch(e) { console.error('DB clear failed', e); }
}

/* ── Upload ─────────────────────────────────────────────── */
fileInput.addEventListener('change', () => {
  currentFile = fileInput.files[0] || null;
  fileNameEl.textContent = currentFile ? currentFile.name : 'No file chosen';
  if (currentFile) uploadFile();
});

function uploadFile() {
  const file     = currentFile;
  const safeName = file.name
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '') || 'file';
  const ext   = file.name.split('.').pop();
  const fname = `${uid()}_${safeName}.${ext}`;
  const type  = file.type.startsWith('video') ? 'video' : 'audio';
  const title = file.name.replace(/\.[^.]+$/, '');

  setUploadStatus('Uploading…', '#888');
  progressWrap.classList.remove('hidden');
  progressBar.style.width = '0%';

  const xhr = new XMLHttpRequest();

  xhr.upload.addEventListener('progress', e => {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      progressBar.style.width = pct + '%';
      setUploadStatus(`Uploading… ${pct}%`, '#888');
    }
  });

  xhr.addEventListener('load', async () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      const src  = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${fname}`;
      const item = { id: uid(), src, type, title, youtube: false };
      items.unshift(item);
      render();
      await dbInsert(item);
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
    fileInput.value        = '';
    fileNameEl.textContent = 'No file chosen';
    currentFile            = null;
  });

  xhr.addEventListener('error', () => {
    setUploadStatus('✗ Network error', '#ff4444');
    progressWrap.classList.add('hidden');
    setTimeout(() => setUploadStatus('', ''), 4000);
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
    searchPageIndex  = 0;
    pageToken        = null;
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
    if (!results.length) { searchEmpty.classList.remove('hidden'); return; }

    if (data.nextPageToken && searchPageTokens.length === searchPageIndex + 1) {
      searchPageTokens.push(data.nextPageToken);
    }

    renderSearchResults(results);
    if (searchPageIndex > 0)  prevPageBtn.classList.remove('hidden');
    if (data.nextPageToken)   nextPageBtn.classList.remove('hidden');

  } catch {
    searchLoading.classList.add('hidden');
    searchEmpty.textContent = 'Network error. Check your connection.';
    searchEmpty.classList.remove('hidden');
  }
}

prevPageBtn.addEventListener('click', () => { searchPageIndex = Math.max(0, searchPageIndex - 1); doSearch(searchPageTokens[searchPageIndex]); });
nextPageBtn.addEventListener('click', () => { searchPageIndex++; doSearch(searchPageTokens[searchPageIndex]); });

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
      <button class="result-add">+ Save</button>
    `;

    card.addEventListener('click', e => {
      if (e.target.classList.contains('result-add')) return;
      playYouTube(videoId, title);
    });

    card.querySelector('.result-add').addEventListener('click', async e => {
      e.stopPropagation();
      const btn = e.currentTarget;
      if (btn.textContent === '✓ Saved') return;
      await addToLibrary({ videoId, title, channel, thumb });
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
  searchPageIndex  = 0;
});

/* ── Play ───────────────────────────────────────────────── */
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

function playItem(item) {
  stopAllMedia();
  playerSection.classList.remove('hidden');
  nowTitle.textContent = item.title;

  const iframe = document.getElementById('ytFrame');
  if (iframe) {
    playerWrap.innerHTML = '';
    playerWrap.appendChild(videoPlayer);
    playerWrap.appendChild(audioPlayer);
  }

  videoPlayer.classList.add('hidden');
  audioPlayer.classList.add('hidden');

  if (item.youtube) { playYouTube(item.videoid || item.videoId, item.title); return; }

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

/* ── Library CRUD ───────────────────────────────────────── */
async function addToLibrary({ videoId, title, channel, thumb }) {
  if (items.find(it => (it.videoid || it.videoId) === videoId)) return;
  const item = { id: uid(), videoid: videoId, title, channel, thumb, type: 'video', youtube: true };
  items.unshift(item);
  render();
  await dbInsert(item);
}

addUrlBtn.addEventListener('click', async () => {
  const raw = urlInput.value.trim();
  if (!raw) return;
  const ytId = getYouTubeId(raw);
  if (ytId) {
    await addToLibrary({ videoId: ytId, title: titleInput.value.trim() || raw, channel: '', thumb: ytThumb(ytId) });
  } else {
    const type  = detectType(raw);
    const title = titleInput.value.trim() || raw.split('/').pop().split('?')[0] || 'Untitled';
    const item  = { id: uid(), src: raw, type, title, youtube: false };
    items.unshift(item);
    render();
    await dbInsert(item);
  }
  urlInput.value   = '';
  titleInput.value = '';
});
urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') addUrlBtn.click(); });

async function removeItem(id) {
  items = items.filter(it => it.id !== id);
  render();
  await dbDelete(id);
}

clearBtn.addEventListener('click', async () => {
  if (!confirm('Remove all items from your library?')) return;
  items = [];
  render();
  closePlayer.click();
  await dbClear();
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

  if (!filtered.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  // Separate videos and audios
  const videos = filtered.filter(it => it.type === 'video');
  const audios  = filtered.filter(it => it.type === 'audio');

  // Render videos as grid
  if (videos.length) {
    const videoGrid = document.createElement('div');
    videoGrid.className = 'video-grid';
    videos.forEach(item => videoGrid.appendChild(makeCard(item)));
    grid.appendChild(videoGrid);
  }

  // Render audios as list
  if (audios.length) {
    if (videos.length) {
      const divider = document.createElement('div');
      divider.className = 'section-divider';
      divider.textContent = 'Audio';
      grid.appendChild(divider);
    }
    const audioList = document.createElement('div');
    audioList.className = 'audio-list';
    audios.forEach(item => audioList.appendChild(makeAudioRow(item)));
    grid.appendChild(audioList);
  }
}

function makeCard(item) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = item.id;

  let thumbInner = '▶';
  if (item.thumb) thumbInner = `<img src="${item.thumb}" alt="" loading="lazy" onerror="this.style.display='none'" />`;

  const channelLine = item.channel ? `<div class="card-channel">${item.channel}</div>` : '';

  card.innerHTML = `
    <div class="card-thumb">
      ${thumbInner}
      <span class="card-badge">${item.youtube ? 'youtube' : 'video'}</span>
    </div>
    <div class="card-info">
      <div class="card-title" title="${item.title}">${item.title}</div>
      ${channelLine}
    </div>
    <button class="card-del" title="Remove">✕</button>
  `;

  card.addEventListener('click', e => { if (!e.target.classList.contains('card-del')) playItem(item); });
  card.querySelector('.card-del').addEventListener('click', e => { e.stopPropagation(); removeItem(item.id); });
  return card;
}

function makeAudioRow(item) {
  const row = document.createElement('div');
  row.className = 'audio-row';
  row.dataset.id = item.id;
  row.innerHTML = `
    <div class="audio-icon">♪</div>
    <div class="audio-info">
      <div class="audio-title" title="${item.title}">${item.title}</div>
    </div>
    <button class="card-del" title="Remove">✕</button>
  `;
  row.addEventListener('click', e => { if (!e.target.classList.contains('card-del')) playItem(item); });
  row.querySelector('.card-del').addEventListener('click', e => { e.stopPropagation(); removeItem(item.id); });
  return row;
}

/* ── Mobile Bottom Nav ──────────────────────────────────── */
const bottomNav  = $('bottomNav');
const bnavAll    = $('bnavAll');
const bnavUpload = $('bnavUpload');
const bnavMenu   = $('bnavMenu');

if (bottomNav) {
  const sidebar = $('sidebar');
  bnavAll.addEventListener('click', () => { sidebar.classList.remove('open'); bnavAll.classList.add('active'); bnavMenu.classList.remove('active'); });
  bnavUpload.addEventListener('click', () => { sidebar.classList.remove('open'); fileInput.click(); });
  bnavMenu.addEventListener('click', () => { const o = sidebar.classList.toggle('open'); bnavMenu.classList.toggle('active', o); bnavAll.classList.remove('active'); });
  document.addEventListener('click', e => {
    if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && !bnavMenu.contains(e.target)) {
      sidebar.classList.remove('open'); bnavMenu.classList.remove('active');
    }
  });
}

/* ── Init ───────────────────────────────────────────────── */
dbLoad();

}); // end DOMContentLoaded