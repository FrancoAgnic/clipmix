/* ClipMix — collage de videos 100% en el navegador
 * Modos: cuadrícula (simultáneo) y secuencia (uno tras otro)
 * Features: recorte por clip, volumen por clip, encuadre (mover/escalar/rotar),
 * y presets de cuadrícula personalizados.
 */

// ---------- Estado ----------
const state = {
  clips: [],            // ver addClip() para la forma del objeto
  mode: 'collage',      // 'collage' | 'sequence'
  layout: '2x2',
  format: '16:9',
  playing: false,
  exporting: false,
  selectedId: null,     // clip seleccionado para encuadrar
  frameColor: '#ffffff',// color del marco de la cuadrícula
  frameWidth: 0.8,      // grosor del marco (% del lado menor). 0 = sin marco
};

let nextId = 1;
let seqIndex = 0;

// ---------- Definiciones ----------
// Celdas normalizadas [x, y, w, h]
const BUILTIN_LAYOUTS = {
  '1x1':  { cells: [[0,0,1,1]], label: '1' },
  '2col': { cells: [[0,0,.5,1],[.5,0,.5,1]], label: '2 ↔' },
  '2row': { cells: [[0,0,1,.5],[0,.5,1,.5]], label: '2 ↕' },
  '3col': { cells: [[0,0,1/3,1],[1/3,0,1/3,1],[2/3,0,1/3,1]], label: '3' },
  '2x2':  { cells: [[0,0,.5,.5],[.5,0,.5,.5],[0,.5,.5,.5],[.5,.5,.5,.5]], label: '4' },
  '1+2':  { cells: [[0,0,.66,1],[.66,0,.34,.5],[.66,.5,.34,.5]], label: '1+2' },
};
const LAYOUTS = Object.assign({}, BUILTIN_LAYOUTS);

const FORMATS = {
  '16:9': { w: 1280, h: 720,  label: '16:9' },
  '9:16': { w: 720,  h: 1280, label: '9:16' },
  '1:1':  { w: 1080, h: 1080, label: '1:1' },
  '4:5':  { w: 1080, h: 1350, label: '4:5' },
  '4:3':  { w: 1280, h: 960,  label: '4:3' },
};

const PRESETS_KEY = 'clipmix_presets_v1';

// ---------- Referencias DOM ----------
const $ = (id) => document.getElementById(id);
const canvas = $('preview');
const ctx = canvas.getContext('2d');

// ---------- Helpers de layout ----------
function currentCells() {
  return state.mode === 'collage' ? (LAYOUTS[state.layout]?.cells || [[0,0,1,1]]) : [[0,0,1,1]];
}
function activeCollageClips() {
  return state.clips.slice(0, currentCells().length);
}

// ---------- Presets personalizados ----------
function loadPresets() {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    Object.entries(obj).forEach(([k, v]) => { LAYOUTS[k] = { cells: v.cells, label: v.label, custom: true }; });
  } catch (_) {}
}
function savePresets() {
  const custom = {};
  Object.entries(LAYOUTS).forEach(([k, v]) => { if (v.custom) custom[k] = { cells: v.cells, label: v.label }; });
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(custom)); } catch (_) {}
}
function gridCells(rows, cols) {
  const cells = [], w = 1 / cols, h = 1 / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([c * w, r * h, w, h]);
  return cells;
}

// ---------- Construcción de tiles ----------
function buildLayoutTiles() {
  const grid = $('layoutGrid');
  grid.innerHTML = '';
  Object.entries(LAYOUTS).forEach(([key, def]) => {
    const tile = document.createElement('button');
    tile.className = 'opt-tile' + (key === state.layout ? ' active' : '');
    tile.dataset.layout = key;
    tile.innerHTML = layoutSVG(def) + `<span>${def.label}</span>`;
    tile.onclick = () => { state.layout = key; clampSelection(); refreshTiles(); renderStatic(); };
    if (def.custom) {
      const del = document.createElement('span');
      del.className = 'tile-del';
      del.textContent = '✕';
      del.title = 'Borrar preset';
      del.onclick = (e) => { e.stopPropagation(); deletePreset(key); };
      tile.appendChild(del);
    }
    grid.appendChild(tile);
  });
  // tile para crear preset
  const add = document.createElement('button');
  add.className = 'opt-tile add-tile';
  add.innerHTML = `<span class="plus">＋</span><span>Nuevo</span>`;
  add.onclick = openPresetBuilder;
  grid.appendChild(add);
}

function layoutSVG(def) {
  const rects = def.cells.map(([x, y, w, h]) =>
    `<rect class="cell" x="${2 + x * 30}" y="${2 + y * 22}" width="${Math.max(1, w * 30)}" height="${Math.max(1, h * 22)}" rx="1.5"/>`
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
      `<svg viewBox="0 0 34 34"><rect class="cell" x="${(34 - bw) / 2}" y="${(34 - bh) / 2}" width="${bw}" height="${bh}" rx="2"/></svg>` +
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

function deletePreset(key) {
  if (!LAYOUTS[key] || !LAYOUTS[key].custom) return;
  delete LAYOUTS[key];
  savePresets();
  if (state.layout === key) state.layout = '2x2';
  buildLayoutTiles();
  renderStatic();
}

function applyFormat() {
  const f = FORMATS[state.format];
  canvas.width = f.w;
  canvas.height = f.h;
  const wrap = canvas.parentElement.getBoundingClientRect();
  const scale = Math.min(wrap.width / f.w, wrap.height / f.h);
  canvas.style.width = (f.w * scale) + 'px';
  canvas.style.height = (f.h * scale) + 'px';
  renderStatic();
}

// ---------- Audio (contexto persistente + ganancia por clip) ----------
const audio = { ctx: null, recordDest: null };
function ensureAudioGraph() {
  if (audio.ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audio.ctx = new AC();
  audio.recordDest = audio.ctx.createMediaStreamDestination();
}
function ensureClipNodes(clip) {
  if (!audio.ctx || clip._gainNode) return;
  try {
    const src = audio.ctx.createMediaElementSource(clip.video);
    const gain = audio.ctx.createGain();
    src.connect(gain);
    gain.connect(audio.ctx.destination);   // altavoces (preview)
    gain.connect(audio.recordDest);        // grabación (export)
    gain.gain.value = clip.volume;
    clip._srcNode = src;
    clip._gainNode = gain;
  } catch (_) { /* el elemento ya estaba ligado a otro contexto */ }
}
function applyVolume(clip) {
  if (clip._gainNode) clip._gainNode.gain.value = clip.volume;
  try { clip.video.volume = Math.min(1, clip.volume); } catch (_) {}
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
  video.playsInline = true;

  const clip = {
    id: nextId++, file, url, video, name: file.name,
    duration: 0, trimStart: 0, trimEnd: 0, volume: 1,
    transform: { scale: 1, x: 0, y: 0, rot: 0 },
    _done: false, _open: false, _srcNode: null, _gainNode: null,
  };
  state.clips.push(clip);

  const finalizeMeta = () => {
    clip.duration = isFinite(video.duration) ? video.duration : 0;
    clip.trimEnd = clip.duration;
    if (state.selectedId == null) state.selectedId = clip.id;
    try { video.currentTime = 0; } catch (_) {}
    renderClipList();
    updateControls();
    renderStatic();
  };

  video.addEventListener('loadedmetadata', () => {
    if (isFinite(video.duration)) { finalizeMeta(); return; }
    // Algunos videos (webm de MediaRecorder) reportan duración Infinity hasta
    // que se busca hasta el final: forzamos la resolución de la duración.
    const fix = () => { video.removeEventListener('timeupdate', fix); finalizeMeta(); };
    video.addEventListener('timeupdate', fix);
    try { video.currentTime = 1e101; } catch (_) { finalizeMeta(); }
  });

  renderClipList();
  updateControls();
}

function removeClip(id) {
  const i = state.clips.findIndex(c => c.id === id);
  if (i < 0) return;
  const clip = state.clips[i];
  try { clip._srcNode && clip._srcNode.disconnect(); } catch (_) {}
  try { clip._gainNode && clip._gainNode.disconnect(); } catch (_) {}
  URL.revokeObjectURL(clip.url);
  clip.video.remove();
  state.clips.splice(i, 1);
  if (state.selectedId === id) state.selectedId = state.clips[0]?.id ?? null;
  clampSelection();
  renderClipList();
  updateControls();
  renderStatic();
}

function moveClip(id, dir) {
  const i = state.clips.findIndex(c => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.clips.length) return;
  [state.clips[i], state.clips[j]] = [state.clips[j], state.clips[i]];
  renderClipList();
  renderStatic();
}

function selectClip(id) {
  state.selectedId = id;
  if (state.mode === 'sequence' && !state.playing) {
    const i = state.clips.findIndex(c => c.id === id);
    if (i >= 0) { seqIndex = i; state.clips[i].video.currentTime = state.clips[i].trimStart; }
  }
  renderClipList();
  renderStatic();
}
function clampSelection() {
  if (!state.clips.find(c => c.id === state.selectedId)) state.selectedId = state.clips[0]?.id ?? null;
}
function selectedClip() { return state.clips.find(c => c.id === state.selectedId) || null; }

// ---------- Lista de clips + editor por clip ----------
function renderClipList() {
  const list = $('clipList');
  list.innerHTML = '';
  $('clipHint').style.display = state.clips.length ? 'none' : 'block';

  state.clips.forEach((clip, i) => {
    const li = document.createElement('li');
    li.className = 'clip' + (clip.id === state.selectedId ? ' selected' : '');
    li.dataset.id = clip.id;

    // fila principal
    const row = document.createElement('div');
    row.className = 'clip-row';

    const thumb = document.createElement('canvas');
    thumb.className = 'thumb';
    thumb.width = 58; thumb.height = 36;
    drawThumb(thumb, clip.video);
    thumb.onclick = () => selectClip(clip.id);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.onclick = () => selectClip(clip.id);
    const durEl = document.createElement('div');
    durEl.className = 'dur';
    durEl.textContent = fmtTime(clipDur(clip));
    const nameEl = document.createElement('div');
    nameEl.className = 'name';
    nameEl.textContent = clip.name;
    meta.appendChild(nameEl);
    meta.appendChild(durEl);

    const idx = document.createElement('div');
    idx.className = 'idx';
    idx.textContent = i + 1;

    const moves = document.createElement('div');
    moves.className = 'moves';
    const up = document.createElement('button');
    up.textContent = '▲'; up.disabled = i === 0; up.onclick = () => moveClip(clip.id, -1);
    const down = document.createElement('button');
    down.textContent = '▼'; down.disabled = i === state.clips.length - 1; down.onclick = () => moveClip(clip.id, 1);
    moves.appendChild(up); moves.appendChild(down);

    const edit = document.createElement('button');
    edit.className = 'edit-toggle' + (clip._open ? ' open' : '');
    edit.textContent = '⚙';
    edit.title = 'Editar clip';
    edit.onclick = () => { clip._open = !clip._open; selectClip(clip.id); };

    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.onclick = () => removeClip(clip.id);

    row.appendChild(idx);
    row.appendChild(thumb);
    row.appendChild(meta);
    row.appendChild(moves);
    row.appendChild(edit);
    row.appendChild(rm);
    li.appendChild(row);

    if (clip._open) li.appendChild(buildClipEditor(clip, durEl));

    list.appendChild(li);
  });
}

function buildClipEditor(clip, durEl) {
  const box = document.createElement('div');
  box.className = 'clip-editor';
  const dur = clip.duration || 0;

  // ----- Recorte -----
  const trimWrap = document.createElement('div');
  trimWrap.className = 'edit-block';
  trimWrap.innerHTML = `<div class="edit-title">✂️ Recorte</div>`;

  const startRow = sliderRow('Inicio', 0, dur, 0.05, clip.trimStart, (v) => {
    clip.trimStart = Math.min(v, clip.trimEnd - 0.1);
    startRow.input.value = clip.trimStart;
    startRow.val.textContent = fmtTime(clip.trimStart);
    durEl.textContent = fmtTime(clipDur(clip));
    seekPreview(clip, clip.trimStart);
  }, fmtTime(clip.trimStart));

  const endRow = sliderRow('Fin', 0, dur, 0.05, clip.trimEnd, (v) => {
    clip.trimEnd = Math.max(v, clip.trimStart + 0.1);
    endRow.input.value = clip.trimEnd;
    endRow.val.textContent = fmtTime(clip.trimEnd);
    durEl.textContent = fmtTime(clipDur(clip));
    seekPreview(clip, clip.trimEnd);
  }, fmtTime(clip.trimEnd));

  trimWrap.appendChild(startRow.el);
  trimWrap.appendChild(endRow.el);

  // ----- Volumen -----
  const volWrap = document.createElement('div');
  volWrap.className = 'edit-block';
  volWrap.innerHTML = `<div class="edit-title">🔊 Volumen</div>`;
  const volRow = sliderRow('Nivel', 0, 150, 1, Math.round(clip.volume * 100), (v) => {
    clip.volume = v / 100;
    volRow.val.textContent = v + '%';
    applyVolume(clip);
  }, Math.round(clip.volume * 100) + '%');
  volWrap.appendChild(volRow.el);

  // ----- Encuadre -----
  const frWrap = document.createElement('div');
  frWrap.className = 'edit-block';
  frWrap.innerHTML = `<div class="edit-title">🖐️ Encuadre <span class="edit-note">(o arrastra en la vista previa)</span></div>`;
  const scaleRow = sliderRow('Escala', 50, 300, 1, Math.round(clip.transform.scale * 100), (v) => {
    clip.transform.scale = v / 100;
    scaleRow.val.textContent = v + '%';
    selectClip(clip.id); renderStatic();
  }, Math.round(clip.transform.scale * 100) + '%');
  const rotRow = sliderRow('Rotación', -180, 180, 1, Math.round(clip.transform.rot), (v) => {
    clip.transform.rot = v;
    rotRow.val.textContent = v + '°';
    selectClip(clip.id); renderStatic();
  }, Math.round(clip.transform.rot) + '°');
  const reset = document.createElement('button');
  reset.className = 'btn small';
  reset.textContent = 'Reset encuadre';
  reset.onclick = () => {
    clip.transform = { scale: 1, x: 0, y: 0, rot: 0 };
    scaleRow.input.value = 100; scaleRow.val.textContent = '100%';
    rotRow.input.value = 0; rotRow.val.textContent = '0°';
    renderStatic();
  };
  frWrap.appendChild(scaleRow.el);
  frWrap.appendChild(rotRow.el);
  frWrap.appendChild(reset);

  box.appendChild(trimWrap);
  box.appendChild(volWrap);
  box.appendChild(frWrap);
  return box;
}

// Crea una fila etiqueta + slider + valor. oninput recibe número.
function sliderRow(label, min, max, step, value, oninput, valText) {
  const el = document.createElement('label');
  el.className = 'slider-row';
  const lab = document.createElement('span'); lab.className = 'slab'; lab.textContent = label;
  const input = document.createElement('input');
  input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
  const val = document.createElement('span'); val.className = 'sval'; val.textContent = valText;
  input.addEventListener('input', () => oninput(parseFloat(input.value)));
  el.appendChild(lab); el.appendChild(input); el.appendChild(val);
  return { el, input, val };
}

function seekPreview(clip, t) {
  if (state.playing || state.exporting) return;
  const onSeeked = () => { renderStatic(); clip.video.removeEventListener('seeked', onSeeked); };
  clip.video.addEventListener('seeked', onSeeked);
  try { clip.video.currentTime = t; } catch (_) {}
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

// ---------- Modo ----------
$('modeSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg');
  if (!btn) return;
  state.mode = btn.dataset.mode;
  document.querySelectorAll('.seg').forEach(s => s.classList.toggle('active', s === btn));
  $('layoutGroup').style.display = state.mode === 'collage' ? 'block' : 'none';
  $('frameGroup').style.display = state.mode === 'collage' ? 'block' : 'none';
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

// Mantiene una copia del último fotograma decodificado de cada clip, para que
// nunca se vea negro si el navegador libera el decodificador del <video>.
function frameSource(clip) {
  const v = clip.video;
  if (v.readyState >= 2 && v.videoWidth) {
    if (!clip._frame) clip._frame = document.createElement('canvas');
    if (clip._frame.width !== v.videoWidth) { clip._frame.width = v.videoWidth; clip._frame.height = v.videoHeight; }
    try { clip._frame.getContext('2d').drawImage(v, 0, 0); } catch (_) {}
    return v;
  }
  // sin fotograma disponible: intentamos recuperarlo con un micro-seek (una vez)
  if (!state.playing && !state.exporting && !clip._recovering && isFinite(v.currentTime) && v.readyState >= 1) {
    clip._recovering = true;
    const t = v.currentTime;
    const done = () => { clip._recovering = false; v.removeEventListener('seeked', done); renderStatic(); };
    v.addEventListener('seeked', done);
    try { v.currentTime = Math.max(0, t + (t < (clip.duration || 0) - 0.05 ? 0.03 : -0.03)); }
    catch (_) { clip._recovering = false; }
  }
  return (clip._frame && clip._frame.width) ? clip._frame : null;
}

// Dibuja un clip dentro de una celda aplicando su transformación (mover/escalar/rotar)
function drawClipInCell(c, clip, dx, dy, dw, dh) {
  const src = frameSource(clip);
  if (!src) { c.fillStyle = '#0c0e12'; c.fillRect(dx, dy, dw, dh); return; }
  const isVid = src.tagName === 'VIDEO';
  const vw = (isVid ? src.videoWidth : src.width) || 16;
  const vh = (isVid ? src.videoHeight : src.height) || 9;
  const t = clip.transform;
  c.save();
  c.beginPath(); c.rect(dx, dy, dw, dh); c.clip();
  const cx = dx + dw / 2 + t.x * dw;
  const cy = dy + dh / 2 + t.y * dh;
  c.translate(cx, cy);
  if (t.rot) c.rotate(t.rot * Math.PI / 180);
  const base = Math.max(dw / vw, dh / vh) * (t.scale || 1);
  const w = vw * base, h = vh * base;
  c.drawImage(src, -w / 2, -h / 2, w, h);
  c.restore();
}

// Rectángulos de celda en coordenadas del canvas (con el índice de clip que ocupan)
function cellRects() {
  const W = canvas.width, H = canvas.height;
  if (state.mode === 'collage') {
    return currentCells().map((cell, i) => ({ i, dx: cell[0] * W, dy: cell[1] * H, dw: cell[2] * W, dh: cell[3] * H }));
  }
  return [{ i: seqIndex, dx: 0, dy: 0, dw: W, dh: H }];
}

function composite(forExport) {
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const rects = cellRects();

  // 1) videos
  rects.forEach(({ i, dx, dy, dw, dh }) => {
    const clip = state.clips[i];
    if (clip) drawClipInCell(ctx, clip, dx, dy, dw, dh);
    else { ctx.fillStyle = '#0c0e12'; ctx.fillRect(dx, dy, dw, dh); }
  });

  // 2) marco (separadores + borde exterior) con color y grosor elegidos
  if (state.mode === 'collage') {
    const fw = Math.min(W, H) * (state.frameWidth / 100);
    if (fw >= 0.75) {
      ctx.strokeStyle = state.frameColor;
      ctx.lineJoin = 'miter';
      ctx.lineWidth = fw;
      rects.forEach(({ dx, dy, dw, dh }) => ctx.strokeRect(dx, dy, dw, dh)); // líneas internas
      ctx.strokeRect(fw / 2, fw / 2, W - fw, H - fw);                        // borde exterior completo
    }
  }

  // 3) resaltado del clip seleccionado (no se graba al exportar)
  if (!forExport) {
    rects.forEach(({ i, dx, dy, dw, dh }) => {
      const clip = state.clips[i];
      if (clip && clip.id === state.selectedId) {
        const lw = Math.max(3, W * 0.004);
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = lw;
        ctx.strokeRect(dx + lw / 2, dy + lw / 2, dw - lw, dh - lw);
      }
    });
  }
}

function renderStatic() {
  if (state.playing || state.exporting) return;
  composite(false);
  updateTimeLabel();
}

// ---------- Gestos de encuadre en el canvas ----------
const pointers = new Map();
let panLast = null, pinch = null;

canvas.addEventListener('pointerdown', (e) => {
  if (state.exporting) return;
  canvas.setPointerCapture(e.pointerId);
  const p = canvasPoint(e);
  pointers.set(e.pointerId, p);

  if (pointers.size === 1) {
    const hit = cellAtPoint(p.x, p.y);
    if (hit && state.clips[hit.i]) selectClip(state.clips[hit.i].id);
    panLast = p;
  } else if (pointers.size === 2) {
    panLast = null;
    const pts = [...pointers.values()];
    const clip = selectedClip();
    pinch = {
      dist: dist(pts[0], pts[1]),
      ang: angle(pts[0], pts[1]),
      scale: clip ? clip.transform.scale : 1,
      rot: clip ? clip.transform.rot : 0,
    };
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const p = canvasPoint(e);
  pointers.set(e.pointerId, p);
  const clip = selectedClip();
  if (!clip) return;

  if (pointers.size === 1 && panLast) {
    const rect = selectedCellRect();
    if (rect) {
      clip.transform.x += (p.x - panLast.x) / rect.dw;
      clip.transform.y += (p.y - panLast.y) / rect.dh;
    }
    panLast = p;
    if (!state.playing) renderStatic();
  } else if (pointers.size === 2 && pinch) {
    const pts = [...pointers.values()];
    const d = dist(pts[0], pts[1]);
    const a = angle(pts[0], pts[1]);
    clip.transform.scale = clamp(pinch.scale * (d / pinch.dist), 0.2, 5);
    clip.transform.rot = pinch.rot + (a - pinch.ang) * 180 / Math.PI;
    syncEditorSliders(clip);
    if (!state.playing) renderStatic();
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) panLast = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * canvas.width, y: (e.clientY - r.top) / r.height * canvas.height };
}
function cellAtPoint(x, y) {
  return cellRects().find(c => x >= c.dx && x <= c.dx + c.dw && y >= c.dy && y <= c.dy + c.dh) || null;
}
function selectedCellRect() {
  const clip = selectedClip();
  if (!clip) return null;
  const i = state.clips.indexOf(clip);
  return cellRects().find(c => c.i === i) || null;
}
function syncEditorSliders(clip) {
  // actualiza los sliders del editor si está abierto, sin re-render completo
  const li = document.querySelector(`.clip[data-id="${clip.id}"] .clip-editor`);
  if (!li) return;
  const ranges = li.querySelectorAll('.edit-block:last-child input[type=range]');
  if (ranges[0]) { ranges[0].value = Math.round(clip.transform.scale * 100); ranges[0].nextElementSibling.textContent = Math.round(clip.transform.scale * 100) + '%'; }
  if (ranges[1]) { ranges[1].value = Math.round(clip.transform.rot); ranges[1].nextElementSibling.textContent = Math.round(clip.transform.rot) + '°'; }
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- Tiempo (con recorte) ----------
function fmtTime(s) {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
function clipDur(clip) { return Math.max(0, (clip.trimEnd || clip.duration) - (clip.trimStart || 0)); }

function totalDuration() {
  if (!state.clips.length) return 0;
  if (state.mode === 'collage') return Math.max(0, ...activeCollageClips().map(clipDur));
  return state.clips.reduce((a, c) => a + clipDur(c), 0);
}
function currentTime() {
  if (state.mode === 'collage') {
    const a = activeCollageClips();
    if (!a.length) return 0;
    return Math.max(0, ...a.map(c => clamp(c.video.currentTime - c.trimStart, 0, clipDur(c))));
  }
  let t = 0;
  for (let i = 0; i < seqIndex; i++) t += clipDur(state.clips[i]);
  const cur = state.clips[seqIndex];
  return t + (cur ? clamp(cur.video.currentTime - cur.trimStart, 0, clipDur(cur)) : 0);
}
function updateTimeLabel() {
  $('timeLabel').textContent = `${fmtTime(currentTime())} / ${fmtTime(totalDuration())}`;
}

// ---------- Reproducción (preview) ----------
let rafId = null;

$('playBtn').onclick = () => { if (!state.playing) startPreview(); };
$('stopBtn').onclick = () => stopPreview();

function startPreview() {
  if (!state.clips.length) return;
  ensureAudioGraph();
  state.clips.forEach(ensureClipNodes);
  if (audio.ctx) audio.ctx.resume().catch(() => {});
  state.playing = true;
  updateControls();

  if (state.mode === 'collage') {
    activeCollageClips().forEach(c => { c._done = false; seekTo(c, c.trimStart); c.video.play().catch(() => {}); });
  } else {
    seqIndex = 0;
    startSeqClip(0);
  }
  loopPreview();
}

function startSeqClip(i) {
  seqIndex = i;
  const c = state.clips[i];
  if (!c) { stopPreview(); return; }
  c._done = false;
  seekTo(c, c.trimStart);
  c.video.play().catch(() => {});
}

function seekTo(clip, t) { try { clip.video.currentTime = t; } catch (_) {} }

function loopPreview() {
  composite(false);
  updateTimeLabel();

  if (state.mode === 'collage') {
    const a = activeCollageClips();
    a.forEach(c => {
      if (!c._done && (c.video.currentTime >= c.trimEnd - 0.03 || c.video.ended)) { c.video.pause(); c._done = true; }
    });
    if (a.length && a.every(c => c._done)) { stopPreview(); return; }
  } else {
    const c = state.clips[seqIndex];
    if (c && (c.video.currentTime >= c.trimEnd - 0.03 || c.video.ended)) {
      c.video.pause();
      if (seqIndex + 1 < state.clips.length) startSeqClip(seqIndex + 1);
      else { stopPreview(); return; }
    }
  }
  if (state.playing) rafId = requestAnimationFrame(loopPreview);
}

function stopPreview() {
  state.playing = false;
  if (rafId) cancelAnimationFrame(rafId);
  state.clips.forEach(c => c.video.pause());
  updateControls();
  renderStatic();
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

  const statusEl = $('exportStatus'), barEl = $('exportBar'), textEl = $('exportText');
  statusEl.hidden = false; barEl.style.width = '0%'; textEl.textContent = 'Preparando…';

  ensureAudioGraph();
  state.clips.forEach(ensureClipNodes);
  if (audio.ctx) await audio.ctx.resume().catch(() => {});

  const fps = 30;
  const canvasStream = canvas.captureStream(fps);
  if (audio.recordDest) audio.recordDest.stream.getAudioTracks().forEach(t => canvasStream.addTrack(t));

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
    const blob = new Blob(chunks, { type: (mime.split(';')[0]) || 'video/webm' });
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `clipmix-${Date.now()}.${ext}`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    textEl.textContent = '¡Listo! Video descargado.';
    finishExport();
  };

  const total = totalDuration();
  let renderLoop = null;
  function finishExport() {
    state.exporting = false;
    if (renderLoop) cancelAnimationFrame(renderLoop);
    state.clips.forEach(c => c.video.pause());
    updateControls();
    setTimeout(() => { statusEl.hidden = true; renderStatic(); }, 2500);
  }
  const progress = (t) => {
    barEl.style.width = Math.min(100, (t / total) * 100) + '%';
    textEl.textContent = `Grabando… ${fmtTime(t)} / ${fmtTime(total)}`;
  };

  recorder.start(100);

  if (state.mode === 'collage') {
    const active = activeCollageClips();
    active.forEach(c => { c._done = false; seekTo(c, c.trimStart); });
    await Promise.all(active.map(c => c.video.play().catch(() => {})));
    renderLoop = requestAnimationFrame(function draw() {
      composite(true);
      active.forEach(c => {
        if (!c._done && (c.video.currentTime >= c.trimEnd - 0.03 || c.video.ended)) { c.video.pause(); c._done = true; }
      });
      progress(Math.max(0, ...active.map(c => clamp(c.video.currentTime - c.trimStart, 0, clipDur(c)))));
      if (active.every(c => c._done)) { recorder.stop(); return; }
      renderLoop = requestAnimationFrame(draw);
    });
  } else {
    let done = 0;
    const startIdx = (i) => { seqIndex = i; const c = state.clips[i]; c._done = false; seekTo(c, c.trimStart); c.video.play().catch(() => {}); };
    startIdx(0);
    renderLoop = requestAnimationFrame(function draw() {
      composite(true);
      const c = state.clips[seqIndex];
      if (c && (c.video.currentTime >= c.trimEnd - 0.03 || c.video.ended)) {
        c.video.pause();
        done += clipDur(c);
        if (seqIndex + 1 < state.clips.length) startIdx(seqIndex + 1);
        else { recorder.stop(); return; }
      }
      const inClip = c ? clamp(c.video.currentTime - c.trimStart, 0, clipDur(c)) : 0;
      progress(done + inClip);
      renderLoop = requestAnimationFrame(draw);
    });
  }
}

// ---------- Constructor de presets ----------
function openPresetBuilder() {
  $('presetModal').hidden = false;
  updatePresetPreview();
}
function closePresetBuilder() { $('presetModal').hidden = true; }
function updatePresetPreview() {
  const rows = parseInt($('presetRows').value) || 1;
  const cols = parseInt($('presetCols').value) || 1;
  $('presetRowsVal').textContent = rows;
  $('presetColsVal').textContent = cols;
  const def = { cells: gridCells(rows, cols), label: `${cols}×${rows}` };
  $('presetPreview').innerHTML = layoutSVG(def);
}
function savePresetFromBuilder() {
  const rows = parseInt($('presetRows').value) || 1;
  const cols = parseInt($('presetCols').value) || 1;
  const name = ($('presetName').value || '').trim() || `${cols}×${rows}`;
  const key = 'custom_' + Date.now();
  LAYOUTS[key] = { cells: gridCells(rows, cols), label: name, custom: true };
  savePresets();
  state.layout = key;
  buildLayoutTiles();
  refreshTiles();
  closePresetBuilder();
  clampSelection();
  renderStatic();
}

// ---------- Pestañas (móvil) ----------
document.querySelector('.tabbar').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.body.classList.remove('tab-videos', 'tab-editar');
  document.body.classList.add('tab-' + btn.dataset.tab);
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
  requestAnimationFrame(applyFormat);
});

// ---------- Instalar como app (PWA) ----------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredPrompt = e; $('installBtn').hidden = false;
});
$('installBtn').onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null; $('installBtn').hidden = true;
};
window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; });

// ---------- Compatibilidad de exportación ----------
function checkExportSupport() {
  const canRecord = typeof MediaRecorder !== 'undefined';
  const canCapture = typeof document.createElement('canvas').captureStream === 'function';
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
    if (reloading) return; reloading = true; window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) nw.postMessage('skipWaiting');
        });
      });
    }).catch(() => {});
  });
}

// ---------- Marco: color y grosor ----------
const SETTINGS_KEY = 'clipmix_settings_v1';
const FRAME_SWATCHES = ['#ffffff', '#000000', '#ff4d4d', '#ffd23f', '#34d399', '#5b8cff', '#ff7ac2', '#8b5cf6'];

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (s.frameColor) state.frameColor = s.frameColor;
    if (typeof s.frameWidth === 'number') state.frameWidth = s.frameWidth;
  } catch (_) {}
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ frameColor: state.frameColor, frameWidth: state.frameWidth })); } catch (_) {}
}
function buildSwatches() {
  const w = $('frameSwatches');
  w.innerHTML = '';
  FRAME_SWATCHES.forEach(col => {
    const b = document.createElement('button');
    b.className = 'swatch' + (col.toLowerCase() === state.frameColor.toLowerCase() ? ' active' : '');
    b.style.background = col;
    b.title = col;
    b.onclick = () => setFrameColor(col);
    w.appendChild(b);
  });
}
function setFrameColor(col) {
  state.frameColor = col;
  $('frameColor').value = col;
  buildSwatches();
  renderStatic();
  saveSettings();
}
function initFrameControls() {
  $('frameColor').value = state.frameColor;
  $('frameWidth').value = state.frameWidth;
  $('frameWidthVal').textContent = state.frameWidth + '%';
  buildSwatches();
  $('frameColor').addEventListener('input', (e) => setFrameColor(e.target.value));
  $('frameWidth').addEventListener('input', (e) => {
    state.frameWidth = parseFloat(e.target.value);
    $('frameWidthVal').textContent = state.frameWidth + '%';
    renderStatic();
    saveSettings();
  });
}

// ---------- Modal: listeners ----------
$('presetRows').addEventListener('input', updatePresetPreview);
$('presetCols').addEventListener('input', updatePresetPreview);
$('presetSave').addEventListener('click', savePresetFromBuilder);
$('presetCancel').addEventListener('click', closePresetBuilder);
$('presetModal').addEventListener('click', (e) => { if (e.target.id === 'presetModal') closePresetBuilder(); });

// ---------- Arranque ----------
window.addEventListener('resize', () => applyFormat());
window.addEventListener('orientationchange', () => setTimeout(applyFormat, 200));
loadSettings();
loadPresets();
buildLayoutTiles();
buildFormatTiles();
initFrameControls();
applyFormat();
renderStatic();
updateControls();
