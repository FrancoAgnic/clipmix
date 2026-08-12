/* ClipMix — collage de videos 100% en el navegador
 * Modos: cuadrícula (simultáneo) y secuencia (uno tras otro)
 * Exporta un solo archivo de video con Canvas + MediaRecorder.
 */

// ---------- Estado ----------
const state = {
  clips: [],            // { id, file, url, video, name, duration }
  mode: 'collage',      // 'collage' | 'sequence'
  layout: '2x2',
  format: '16:9',
  playing: false,
  exporting: false,
};

let nextId = 1;

// ---------- Definiciones ----------
// Celdas normalizadas [x, y, w, h]
const LAYOUTS = {
  '1x1':   { cells: [[0,0,1,1]], label: '1', cols: 1, rows: 1 },
  '2col':  { cells: [[0,0,.5,1],[.5,0,.5,1]], label: '2 ↔' },
  '2row':  { cells: [[0,0,1,.5],[0,.5,1,.5]], label: '2 ↕' },
  '3col':  { cells: [[0,0,1/3,1],[1/3,0,1/3,1],[2/3,0,1/3,1]], label: '3' },
  '2x2':   { cells: [[0,0,.5,.5],[.5,0,.5,.5],[0,.5,.5,.5],[.5,.5,.5,.5]], label: '4' },
  '1+2':   { cells: [[0,0,.66,1],[.66,0,.34,.5],[.66,.5,.34,.5]], label: '1+2' },
};

const FORMATS = {
  '16:9': { w: 1280, h: 720,  label: '16:9', sub: 'Horizontal' },
  '9:16': { w: 720,  h: 1280, label: '9:16', sub: 'Vertical' },
  '1:1':  { w: 1080, h: 1080, label: '1:1',  sub: 'Cuadrado' },
  '4:5':  { w: 1080, h: 1350, label: '4:5',  sub: 'Retrato' },
  '4:3':  { w: 1280, h: 960,  label: '4:3',  sub: 'Clásico' },
};

// ---------- Referencias DOM ----------
const $ = (id) => document.getElementById(id);
const canvas = $('preview');
const ctx = canvas.getContext('2d');

// ---------- Inicialización de UI ----------
function buildLayoutTiles() {
  const grid = $('layoutGrid');
  grid.innerHTML = '';
  Object.entries(LAYOUTS).forEach(([key, def]) => {
    const tile = document.createElement('button');
    tile.className = 'opt-tile' + (key === state.layout ? ' active' : '');
    tile.dataset.layout = key;
    tile.innerHTML = layoutSVG(def) + `<span>${def.label}</span>`;
    tile.onclick = () => { state.layout = key; refreshTiles(); renderStatic(); };
    grid.appendChild(tile);
  });
}

function layoutSVG(def) {
  const rects = def.cells.map(([x,y,w,h]) =>
    `<rect class="cell" x="${2+x*30}" y="${2+y*22}" width="${w*30}" height="${h*22}" rx="2"/>`
  ).join('');
  return `<svg viewBox="0 0 34 26">${rects}</svg>`;
}

function buildFormatTiles() {
  const grid = $('formatGrid');
  grid.innerHTML = '';
  Object.entries(FORMATS).forEach(([key, def]) => {
    const tile = document.createElement('button');
    tile.className = 'opt-tile' + (key === state.format ? ' active' : '');
    tile.dataset.format = key;
    const ar = def.w / def.h;
    const bw = ar >= 1 ? 30 : 30 * ar;
    const bh = ar >= 1 ? 30 / ar : 30;
    tile.innerHTML =
      `<svg viewBox="0 0 34 34"><rect class="cell" x="${(34-bw)/2}" y="${(34-bh)/2}" width="${bw}" height="${bh}" rx="2"/></svg>` +
      `<span>${def.label}</span>`;
    tile.onclick = () => { state.format = key; applyFormat(); refreshTiles(); };
    grid.appendChild(tile);
  });
}

function refreshTiles() {
  document.querySelectorAll('[data-layout]').forEach(t =>
    t.classList.toggle('active', t.dataset.layout === state.layout));
  document.querySelectorAll('[data-format]').forEach(t =>
    t.classList.toggle('active', t.dataset.format === state.format));
}

function applyFormat() {
  const f = FORMATS[state.format];
  canvas.width = f.w;
  canvas.height = f.h;
  // Ajustar el tamaño visible manteniendo la proporción dentro del escenario
  const wrap = canvas.parentElement.getBoundingClientRect();
  const scale = Math.min(wrap.width / f.w, wrap.height / f.h);
  canvas.style.width = (f.w * scale) + 'px';
  canvas.style.height = (f.h * scale) + 'px';
  renderStatic();
}

// ---------- Carga de videos ----------
$('fileInput').addEventListener('change', (e) => {
  [...e.target.files].forEach(addClip);
  e.target.value = '';
});

function addClip(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.muted = false;
  video.playsInline = true;

  const clip = { id: nextId++, file, url, video, name: file.name, duration: 0 };
  state.clips.push(clip);

  video.addEventListener('loadedmetadata', () => {
    clip.duration = video.duration || 0;
    renderClipList();
    updateControls();
    renderStatic();
  });

  renderClipList();
  updateControls();
}

function removeClip(id) {
  const i = state.clips.findIndex(c => c.id === id);
  if (i < 0) return;
  URL.revokeObjectURL(state.clips[i].url);
  state.clips[i].video.remove();
  state.clips.splice(i, 1);
  renderClipList();
  updateControls();
  renderStatic();
}

// ---------- Lista de clips + reordenar ----------
let dragId = null;

function renderClipList() {
  const list = $('clipList');
  list.innerHTML = '';
  $('clipHint').style.display = state.clips.length ? 'none' : 'block';

  state.clips.forEach((clip, i) => {
    const li = document.createElement('li');
    li.className = 'clip';
    li.draggable = true;
    li.dataset.id = clip.id;

    const thumb = document.createElement('canvas');
    thumb.className = 'thumb';
    thumb.width = 54; thumb.height = 34;
    drawThumb(thumb, clip.video);

    li.appendChild(thumb);
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<div class="name">${clip.name}</div><div class="dur">${fmtTime(clip.duration)}</div>`;
    const idx = document.createElement('div');
    idx.className = 'idx';
    idx.textContent = i + 1;

    const moves = document.createElement('div');
    moves.className = 'moves';
    const up = document.createElement('button');
    up.textContent = '▲'; up.title = 'Subir';
    up.disabled = i === 0;
    up.onclick = () => moveClip(clip.id, -1);
    const down = document.createElement('button');
    down.textContent = '▼'; down.title = 'Bajar';
    down.disabled = i === state.clips.length - 1;
    down.onclick = () => moveClip(clip.id, 1);
    moves.appendChild(up);
    moves.appendChild(down);

    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.onclick = () => removeClip(clip.id);

    li.appendChild(idx);
    li.appendChild(meta);
    li.appendChild(moves);
    li.appendChild(rm);

    li.addEventListener('dragstart', () => { dragId = clip.id; li.classList.add('dragging'); });
    li.addEventListener('dragend', () => { dragId = null; li.classList.remove('dragging'); });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      const from = state.clips.findIndex(c => c.id === dragId);
      const to = state.clips.findIndex(c => c.id === clip.id);
      if (from < 0 || to < 0 || from === to) return;
      const [moved] = state.clips.splice(from, 1);
      state.clips.splice(to, 0, moved);
      renderClipList();
      renderStatic();
    });

    list.appendChild(li);
  });
}

function moveClip(id, dir) {
  const i = state.clips.findIndex(c => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.clips.length) return;
  [state.clips[i], state.clips[j]] = [state.clips[j], state.clips[i]];
  renderClipList();
  renderStatic();
}

function drawThumb(cnv, video) {
  const c = cnv.getContext('2d');
  const paint = () => {
    if (video.readyState >= 2) drawCover(c, video, 0, 0, cnv.width, cnv.height);
    else setTimeout(paint, 120);
  };
  if (video.readyState >= 2) paint();
  else video.addEventListener('loadeddata', paint, { once: true });
}

// ---------- Modo / controles ----------
$('modeSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg');
  if (!btn) return;
  state.mode = btn.dataset.mode;
  document.querySelectorAll('.seg').forEach(s => s.classList.toggle('active', s === btn));
  $('layoutGroup').style.display = state.mode === 'collage' ? 'block' : 'none';
  $('modeHint').textContent = state.mode === 'collage'
    ? 'Los videos se reproducen a la vez, uno en cada celda.'
    : 'Los videos se unen uno tras otro en un video más largo.';
  renderStatic();
});

function updateControls() {
  const has = state.clips.length > 0;
  $('playBtn').disabled = !has || state.exporting;
  $('stopBtn').disabled = !state.playing;
  $('exportBtn').disabled = !has || state.exporting || (typeof exportSupported !== 'undefined' && !exportSupported);
}

// ---------- Dibujo ----------
function drawCover(c, video, dx, dy, dw, dh) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) { c.fillStyle = '#000'; c.fillRect(dx, dy, dw, dh); return; }
  const scale = Math.max(dw / vw, dh / vh);
  const sw = dw / scale, sh = dh / scale;
  const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
  c.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
}

function composite() {
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  if (state.mode === 'collage') {
    const cells = LAYOUTS[state.layout].cells;
    cells.forEach((cell, i) => {
      const clip = state.clips[i];
      const [x, y, w, h] = cell;
      const dx = x * W, dy = y * H, dw = w * W, dh = h * H;
      if (clip && clip.video.readyState >= 2) drawCover(ctx, clip.video, dx, dy, dw, dh);
      else { ctx.fillStyle = '#0c0e12'; ctx.fillRect(dx, dy, dw, dh); }
      // línea divisoria
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(dx, dy, dw, dh);
    });
  } else {
    const clip = state.clips[seqIndex];
    if (clip && clip.video.readyState >= 2) drawCover(ctx, clip.video, 0, 0, W, H);
  }
}

// Render estático (una pasada) cuando no se está reproduciendo
function renderStatic() {
  if (state.playing || state.exporting) return;
  composite();
  updateTimeLabel();
}

// ---------- Reproducción (preview) ----------
let rafId = null;
let seqIndex = 0;

$('playBtn').onclick = () => state.playing ? null : startPreview();
$('stopBtn').onclick = () => stopPreview();

function startPreview() {
  if (!state.clips.length) return;
  state.playing = true;
  updateControls();
  seqIndex = 0;

  if (state.mode === 'collage') {
    state.clips.forEach((c, i) => {
      if (i < LAYOUTS[state.layout].cells.length) {
        c.video.currentTime = 0;
        c.video.play().catch(() => {});
      }
    });
  } else {
    playSequenceFrom(0);
  }
  loopPreview();
}

function playSequenceFrom(i) {
  seqIndex = i;
  const clip = state.clips[i];
  if (!clip) { stopPreview(); return; }
  clip.video.currentTime = 0;
  clip.video.play().catch(() => {});
  clip.video.onended = () => {
    if (i + 1 < state.clips.length) playSequenceFrom(i + 1);
    else stopPreview();
  };
}

function loopPreview() {
  composite();
  updateTimeLabel();
  // fin de cuadrícula: cuando todos los videos activos terminan
  if (state.mode === 'collage') {
    const active = state.clips.slice(0, LAYOUTS[state.layout].cells.length);
    if (active.length && active.every(c => c.video.ended)) { stopPreview(); return; }
  }
  if (state.playing) rafId = requestAnimationFrame(loopPreview);
}

function stopPreview() {
  state.playing = false;
  if (rafId) cancelAnimationFrame(rafId);
  state.clips.forEach(c => { c.video.pause(); c.video.onended = null; });
  updateControls();
  renderStatic();
}

// ---------- Tiempo ----------
function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60), ss = s % 60;
  return `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

function totalDuration() {
  if (!state.clips.length) return 0;
  if (state.mode === 'collage') {
    const active = state.clips.slice(0, LAYOUTS[state.layout].cells.length);
    return Math.max(0, ...active.map(c => c.duration));
  }
  return state.clips.reduce((a, c) => a + (c.duration || 0), 0);
}

function currentTime() {
  if (state.mode === 'collage') {
    const active = state.clips.slice(0, LAYOUTS[state.layout].cells.length);
    return Math.max(0, ...active.map(c => c.video.currentTime || 0));
  }
  let t = 0;
  for (let i = 0; i < seqIndex; i++) t += state.clips[i].duration || 0;
  return t + (state.clips[seqIndex]?.video.currentTime || 0);
}

function updateTimeLabel() {
  $('timeLabel').textContent = `${fmtTime(currentTime())} / ${fmtTime(totalDuration())}`;
}

// ---------- Exportar ----------
$('exportBtn').onclick = exportVideo;

function pickMime() {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find(m => MediaRecorder.isTypeSupported(m)) || '';
}

async function exportVideo() {
  if (!state.clips.length || state.exporting) return;
  stopPreview();
  state.exporting = true;
  updateControls();

  const statusEl = $('exportStatus');
  const barEl = $('exportBar');
  const textEl = $('exportText');
  statusEl.hidden = false;
  barEl.style.width = '0%';
  textEl.textContent = 'Preparando…';

  // --- Audio: mezclamos las pistas con Web Audio ---
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioCtx();
  const dest = audioCtx.createMediaStreamDestination();
  const master = audioCtx.createGain();
  master.connect(dest);
  master.connect(audioCtx.destination);

  state.clips.forEach(c => {
    try {
      if (!c._srcNode) c._srcNode = audioCtx.createMediaElementSource(c.video);
      c._srcNode.connect(master);
    } catch (_) { /* ya conectado en un export anterior */ }
  });

  // --- Stream de video del canvas + audio ---
  const fps = 30;
  const canvasStream = canvas.captureStream(fps);
  const audioTracks = dest.stream.getAudioTracks();
  audioTracks.forEach(t => canvasStream.addTrack(t));

  const mime = pickMime();
  const q = parseFloat($('qualitySel').value);
  const bitrate = Math.round(canvas.width * canvas.height * fps * 0.12 * q);

  let recorder;
  try {
    recorder = new MediaRecorder(canvasStream, { mimeType: mime, videoBitsPerSecond: bitrate });
  } catch (err) {
    finishExport();
    alert('Tu navegador no soporta la grabación de video (MediaRecorder). Usa Chrome/Edge actualizado.');
    return;
  }

  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mime.split(';')[0] || 'video/webm' });
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clipmix-${Date.now()}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    textEl.textContent = '¡Listo! Video descargado.';
    finishExport();
  };

  const total = totalDuration();
  const startAt = performance.now();
  let renderLoop;

  function finishExport() {
    state.exporting = false;
    if (renderLoop) cancelAnimationFrame(renderLoop);
    state.clips.forEach(c => { c.video.pause(); c.video.onended = null; });
    audioCtx.close().catch(() => {});
    updateControls();
    setTimeout(() => { statusEl.hidden = true; renderStatic(); }, 2500);
  }

  // --- Arranque de reproducción para grabar ---
  recorder.start(100);
  await audioCtx.resume().catch(() => {});

  if (state.mode === 'collage') {
    const active = state.clips.slice(0, LAYOUTS[state.layout].cells.length);
    await Promise.all(active.map(c => { c.video.currentTime = 0; return c.video.play().catch(()=>{}); }));

    renderLoop = requestAnimationFrame(function draw() {
      composite();
      const t = Math.max(0, ...active.map(c => c.video.currentTime));
      barEl.style.width = Math.min(100, (t / total) * 100) + '%';
      textEl.textContent = `Grabando… ${fmtTime(t)} / ${fmtTime(total)}`;
      if (active.every(c => c.video.ended)) { recorder.stop(); return; }
      renderLoop = requestAnimationFrame(draw);
    });
  } else {
    let idx = 0;
    const playIdx = (i) => {
      idx = i;
      const clip = state.clips[i];
      clip.video.currentTime = 0;
      clip.video.play().catch(()=>{});
      clip.video.onended = () => {
        if (i + 1 < state.clips.length) playIdx(i + 1);
        else recorder.stop();
      };
    };
    playIdx(0);

    renderLoop = requestAnimationFrame(function draw() {
      seqIndex = idx;
      composite();
      let t = 0;
      for (let i = 0; i < idx; i++) t += state.clips[i].duration || 0;
      t += state.clips[idx]?.video.currentTime || 0;
      barEl.style.width = Math.min(100, (t / total) * 100) + '%';
      textEl.textContent = `Grabando… ${fmtTime(t)} / ${fmtTime(total)}`;
      renderLoop = requestAnimationFrame(draw);
    });
  }
}

// ---------- Pestañas (móvil) ----------
document.querySelector('.tabbar').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  const tab = btn.dataset.tab;
  document.body.classList.remove('tab-videos', 'tab-editar');
  document.body.classList.add('tab-' + tab);
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
  // reajustar el canvas al nuevo tamaño visible del escenario
  requestAnimationFrame(applyFormat);
});

// ---------- Instalar como app (PWA) ----------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('installBtn').hidden = false;
});
$('installBtn').onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('installBtn').hidden = true;
};
window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; });

// ---------- Compatibilidad de exportación ----------
function checkExportSupport() {
  const canRecord = typeof MediaRecorder !== 'undefined';
  const canCapture = typeof HTMLCanvasElement !== 'undefined' &&
    typeof document.createElement('canvas').captureStream === 'function';
  const warn = $('exportWarn');
  if (!canRecord || !canCapture) {
    warn.hidden = false;
    warn.textContent = 'Tu navegador no soporta exportar video. En iPhone usa Safari actualizado; en Android usa Chrome. La edición y vista previa sí funcionan.';
    return false;
  }
  return true;
}
const exportSupported = checkExportSupport();

// ---------- Service Worker (offline + auto-actualización) ----------
if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;      // recarga una sola vez cuando entra una versión nueva
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // busca actualizaciones al abrir y al volver a la app
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          // hay una versión nueva lista y ya había una controlando -> actívala
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            nw.postMessage('skipWaiting');
          }
        });
      });
    }).catch(() => {});
  });
}

// ---------- Arranque ----------
window.addEventListener('resize', () => applyFormat());
window.addEventListener('orientationchange', () => setTimeout(applyFormat, 200));
buildLayoutTiles();
buildFormatTiles();
applyFormat();
renderStatic();
updateControls();
