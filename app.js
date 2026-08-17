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
  texts: [],            // {id, content, start, duration, x, y, size, color, bold}
  selectedTextId: null, // texto seleccionado (para mover/editar)
  proxy: true,          // edición ligera (baja resolución); export siempre en alta
  template: 'none',     // plantilla de efectos/transiciones del collage
  templateSpeed: 1,     // velocidad de la animación
};

let nextId = 1;
let nextTextId = 1;
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
  // La plantilla "Cambia videos" usa todos los clips; el resto, solo los de las celdas.
  return templateDef().usesAll ? state.clips.slice() : state.clips.slice(0, currentCells().length);
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
    tile.onclick = () => { state.layout = key; clampSelection(); refreshTiles(); renderStatic(); commit(); };
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

// ----- Plantillas de efectos: UI + animación en vivo -----
function buildTemplateTiles() {
  const grid = $('templateGrid');
  grid.innerHTML = '';
  TEMPLATE_ORDER.forEach(key => {
    const def = TEMPLATES[key];
    const tile = document.createElement('button');
    tile.className = 'opt-tile' + (key === state.template ? ' active' : '');
    tile.dataset.template = key;
    tile.innerHTML = `<span class="tmpl-ico">${def.icon}</span><span>${def.name}</span>`;
    tile.onclick = () => { state.template = key; refreshTemplateTiles(); renderStatic(); ensureIdleAnim(); commit(); };
    grid.appendChild(tile);
  });
}
function refreshTemplateTiles() {
  document.querySelectorAll('[data-template]').forEach(t => t.classList.toggle('active', t.dataset.template === state.template));
}
function refreshTemplateUI() {
  refreshTemplateTiles();
  $('templateSpeed').value = state.templateSpeed;
  $('templateSpeedVal').textContent = state.templateSpeed.toFixed(1) + '×';
}
function initTemplateControls() {
  buildTemplateTiles();
  const sp = $('templateSpeed');
  sp.value = state.templateSpeed;
  $('templateSpeedVal').textContent = state.templateSpeed.toFixed(1) + '×';
  sp.addEventListener('input', () => {
    state.templateSpeed = parseFloat(sp.value);
    $('templateSpeedVal').textContent = state.templateSpeed.toFixed(1) + '×';
    renderStatic();
  });
}

// Tiempo para las plantillas: durante play/export sigue al video; en pausa usa el
// reloj real para que el efecto se vea moverse en la vista previa.
function templateTime() {
  return (state.playing || state.exporting) ? currentTime() : performance.now() / 1000;
}

// Bucle de animación en reposo: mueve el efecto en la vista previa aunque esté en pausa
let idleRaf = null;
function idleActive() {
  return !state.playing && !state.exporting && state.mode === 'collage' && state.template !== 'none' && state.clips.length > 0;
}
function idleAnimTick() {
  if (!idleActive()) { idleRaf = null; return; }
  composite(false);
  idleRaf = requestAnimationFrame(idleAnimTick);
}
function ensureIdleAnim() {
  if (!idleRaf && idleActive()) idleRaf = requestAnimationFrame(idleAnimTick);
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
    tile.onclick = () => { state.format = key; applyFormat(); refreshTiles(); commit(); };
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
  commit();
}

// Resolución interna del canvas. En modo proxy (edición) usamos un lado máximo
// más pequeño para que sea liviano; al exportar volvemos a resolución completa.
const PROXY_MAX = 640;
let forceFullRes = false;

function targetResolution() {
  const f = FORMATS[state.format];
  if (forceFullRes || !state.proxy) return { w: f.w, h: f.h };
  const scale = Math.min(1, PROXY_MAX / Math.max(f.w, f.h));
  return { w: Math.round(f.w * scale / 2) * 2, h: Math.round(f.h * scale / 2) * 2 };
}

function applyFormat() {
  const f = FORMATS[state.format];
  const r = targetResolution();
  canvas.width = r.w;
  canvas.height = r.h;
  const wrap = canvas.parentElement.getBoundingClientRect();
  const scale = Math.min(wrap.width / f.w, wrap.height / f.h);
  canvas.style.width = (f.w * scale) + 'px';
  canvas.style.height = (f.h * scale) + 'px';
  renderStatic();
}

// Antes de exportar pasamos a resolución completa; devuelve función para restaurar.
function beginFullResForExport() {
  if (forceFullRes || !state.proxy) return () => {};
  forceFullRes = true;
  applyFormat();
  return () => { forceFullRes = false; applyFormat(); };
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
  [...e.target.files].forEach(f => makeClip(f));
  e.target.value = '';
});

function addClip(file) { return makeClip(file); }

// Crea un clip. opts.restore=true conserva id/recorte/volumen/encuadre guardados.
function makeClip(file, opts = {}) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.playsInline = true;

  const clip = {
    id: opts.id != null ? opts.id : nextId++, file, url, video, name: file.name,
    duration: 0, trimStart: opts.trimStart || 0, trimEnd: opts.trimEnd || 0,
    volume: (typeof opts.volume === 'number') ? opts.volume : 1,
    transform: opts.transform ? { ...opts.transform } : { scale: 1, x: 0, y: 0, rot: 0 },
    _done: false, _open: false, _srcNode: null, _gainNode: null,
  };
  if (opts.id != null) nextId = Math.max(nextId, opts.id + 1);
  state.clips.push(clip);

  const finalizeMeta = () => {
    clip.duration = isFinite(video.duration) ? video.duration : 0;
    if (opts.restore) {
      if (!clip.trimEnd || clip.trimEnd > clip.duration) clip.trimEnd = clip.duration;
      clip.trimStart = Math.min(clip.trimStart, Math.max(0, clip.duration - 0.1));
    } else {
      clip.trimEnd = clip.duration;
    }
    if (state.selectedId == null && !opts.restore) state.selectedId = clip.id;
    try { video.currentTime = clip.trimStart || 0; } catch (_) {}
    renderClipList();
    renderTextList();
    updateControls();
    renderStatic();
    ensureIdleAnim();
    if (!opts.restore) { commit(); saveProjectSoon(); saveClipBlob(clip); }
  };

  video.addEventListener('loadedmetadata', () => {
    if (isFinite(video.duration)) { finalizeMeta(); return; }
    const fix = () => { video.removeEventListener('timeupdate', fix); finalizeMeta(); };
    video.addEventListener('timeupdate', fix);
    try { video.currentTime = 1e101; } catch (_) { finalizeMeta(); }
  });

  renderClipList();
  updateControls();
  return clip;
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
  commit();
  delClipBlob(id);
  saveProjectSoon();
}

function moveClip(id, dir) {
  const i = state.clips.findIndex(c => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.clips.length) return;
  [state.clips[i], state.clips[j]] = [state.clips[j], state.clips[i]];
  renderClipList();
  renderStatic();
  commit();
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
    commit();
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
function syncModeUI() {
  document.querySelectorAll('.seg').forEach(s => s.classList.toggle('active', s.dataset.mode === state.mode));
  $('layoutGroup').style.display = state.mode === 'collage' ? 'block' : 'none';
  $('frameGroup').style.display = state.mode === 'collage' ? 'block' : 'none';
  $('templateGroup').style.display = state.mode === 'collage' ? 'block' : 'none';
  $('modeHint').textContent = state.mode === 'collage'
    ? 'Los videos se reproducen a la vez, uno en cada celda.'
    : 'Los videos se unen uno tras otro en un video más largo.';
}
$('modeSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg');
  if (!btn) return;
  state.mode = btn.dataset.mode;
  syncModeUI();
  renderStatic();
  ensureIdleAnim();
  commit();
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

// ---------- Plantillas de efectos / transiciones (collage animado) ----------
const _ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const _clamp01 = (u) => Math.max(0, Math.min(1, u));
const _lerp = (a, b, u) => a + (b - a) * u;
const _item = (i, c, extra) => Object.assign({ clipIndex: i, x: c[0], y: c[1], w: c[2], h: c[3], scale: 1, rot: 0, alpha: 1, px: 0, py: 0 }, extra);

// Cada plantilla devuelve una lista de "items" a dibujar según el tiempo t (seg).
const TEMPLATES = {
  none: {
    name: 'Ninguno', icon: '▦', usesAll: false,
    anim: (t, o) => o.cells.map((c, i) => _item(i, c)),
  },
  kenburns: {
    name: 'Zoom lento', icon: '🎞️', usesAll: false,
    anim: (t, o) => o.cells.map((c, i) => {
      const ph = t * 0.5 * o.speed + i * 0.8;
      return _item(i, c, { scale: 1.12 + 0.08 * Math.sin(ph), px: 0.04 * Math.sin(ph * 0.7), py: 0.04 * Math.cos(ph * 0.5) });
    }),
  },
  slidein: {
    name: 'Entrada', icon: '➡️', usesAll: false,
    anim: (t, o) => {
      const p = _ease(_clamp01(t / 0.7));
      return o.cells.map((c, i) => _item(i, c, { alpha: p, px: (1 - p) * (i % 2 ? 1 : -1), py: 0 }));
    },
  },
  punch: {
    name: 'Beat', icon: '💥', usesAll: false,
    anim: (t, o) => {
      const per = Math.max(0.35, 0.6 / o.speed);
      const b = Math.max(0, 1 - ((t % per) / per) * 5);
      const s = 1 + 0.10 * b;
      return o.cells.map((c, i) => _item(i, c, { scale: s }));
    },
  },
  wave: {
    name: 'Ola', icon: '🌊', usesAll: false,
    anim: (t, o) => o.cells.map((c, i) => _item(i, c, { scale: 1 + 0.09 * Math.sin(t * 3 * o.speed - i * 0.9) })),
  },
  sway: {
    name: 'Balanceo', icon: '↔️', usesAll: false,
    anim: (t, o) => o.cells.map((c, i) => _item(i, c, { scale: 1.08, rot: 4 * Math.sin(t * 1.5 * o.speed + i) })),
  },
  parallax: {
    name: 'Parallax', icon: '🪄', usesAll: false,
    anim: (t, o) => o.cells.map((c, i) => {
      const ph = t * 0.6 * o.speed + i, dir = i % 2 ? 1 : -1;
      return _item(i, c, { scale: 1.12, px: 0.06 * Math.sin(ph) * dir, py: 0.035 * Math.cos(ph) });
    }),
  },
  spotlight: {
    name: 'Foco', icon: '🔦', usesAll: false,
    anim: (t, o) => {
      const cells = o.cells, per = Math.max(0.8, 1.5 / o.speed);
      const idx = Math.floor(t / per) % cells.length;
      const local = (t % per) / per;
      const s = _ease(local < 0.5 ? local * 2 : (1 - local) * 2);
      const items = [];
      cells.forEach((c, i) => { if (i !== idx) items.push(_item(i, c, { alpha: 1 - 0.88 * s })); });
      const c = cells[idx];
      items.push(_item(idx, [_lerp(c[0], 0.04, s), _lerp(c[1], 0.04, s), _lerp(c[2], 0.92, s), _lerp(c[3], 0.92, s)]));
      return items;
    },
  },
  shuffle: {
    name: 'Cambia videos', icon: '🔀', usesAll: true,
    anim: (t, o) => {
      const cells = o.cells, n = Math.max(1, o.n), per = Math.max(0.7, 1.4 / o.speed);
      const step = Math.floor(t / per), local = (t % per) / per;
      const items = [];
      cells.forEach((c, i) => {
        const cur = (i + step) % n;
        if (local < 0.22 && step > 0) {
          const a = _ease(local / 0.22);
          const prev = (i + step - 1 + n) % n;
          items.push(_item(prev, c, { alpha: 1 - a, scale: 1 + 0.04 * (1 - a) }));
          items.push(_item(cur, c, { alpha: a, scale: 1 + 0.04 * (1 - a) }));
        } else {
          items.push(_item(cur, c));
        }
      });
      return items;
    },
  },
};
const TEMPLATE_ORDER = ['none', 'kenburns', 'slidein', 'punch', 'wave', 'sway', 'parallax', 'spotlight', 'shuffle'];
function templateDef() { return TEMPLATES[state.template] || TEMPLATES.none; }

// Dibuja un clip en un rectángulo normalizado con transform propio + animación (scale/rot/alpha/pan)
function drawClipItem(c, clip, it) {
  const W = canvas.width, H = canvas.height;
  const dx = it.x * W, dy = it.y * H, dw = it.w * W, dh = it.h * H;
  const src = frameSource(clip);
  c.save();
  c.globalAlpha = it.alpha != null ? it.alpha : 1;
  c.beginPath(); c.rect(dx, dy, dw, dh); c.clip();
  if (!src) { c.fillStyle = '#0c0e12'; c.fillRect(dx, dy, dw, dh); c.restore(); return; }
  const isVid = src.tagName === 'VIDEO';
  const vw = (isVid ? src.videoWidth : src.width) || 16;
  const vh = (isVid ? src.videoHeight : src.height) || 9;
  const tr = clip.transform;
  const cx = dx + dw / 2 + (tr.x + (it.px || 0)) * dw;
  const cy = dy + dh / 2 + (tr.y + (it.py || 0)) * dh;
  c.translate(cx, cy);
  const rot = (tr.rot || 0) + (it.rot || 0);
  if (rot) c.rotate(rot * Math.PI / 180);
  const base = Math.max(dw / vw, dh / vh) * (tr.scale || 1) * (it.scale || 1);
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

  const fw = Math.min(W, H) * (state.frameWidth / 100);

  if (state.mode === 'collage') {
    // 1) videos según la plantilla de efectos
    const info = { cells: currentCells(), n: state.clips.length, total: totalDuration(), W, H, speed: state.templateSpeed };
    const items = templateDef().anim(templateTime(), info);
    items.forEach(it => {
      const clip = state.clips[it.clipIndex];
      if (clip) drawClipItem(ctx, clip, it);
      else { ctx.fillStyle = '#0c0e12'; ctx.fillRect(it.x * W, it.y * H, it.w * W, it.h * H); }
    });
    // 2) marco: un borde por item (sigue el movimiento) + borde exterior
    if (fw >= 0.75) {
      ctx.strokeStyle = state.frameColor;
      ctx.lineJoin = 'miter';
      ctx.lineWidth = fw;
      items.forEach(it => { ctx.globalAlpha = it.alpha != null ? it.alpha : 1; ctx.strokeRect(it.x * W, it.y * H, it.w * W, it.h * H); });
      ctx.globalAlpha = 1;
      ctx.strokeRect(fw / 2, fw / 2, W - fw, H - fw);
    }
  } else {
    const clip = state.clips[seqIndex];
    if (clip) drawClipInCell(ctx, clip, 0, 0, W, H);
    else { ctx.fillStyle = '#0c0e12'; ctx.fillRect(0, 0, W, H); }
  }

  const paused = !state.playing && !state.exporting;

  // 3) textos (respetan su tiempo; en pausa se muestra el seleccionado para editarlo)
  drawTexts(paused);

  // 4) resaltado del clip seleccionado (solo si NO hay un texto seleccionado; no se graba)
  if (!forExport && !state.selectedTextId && state.mode === 'collage') {
    cellRects().forEach(({ i, dx, dy, dw, dh }) => {
      const clip = state.clips[i];
      if (clip && clip.id === state.selectedId) {
        const lw = Math.max(3, W * 0.004);
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = lw;
        ctx.strokeRect(dx + lw / 2, dy + lw / 2, dw - lw, dh - lw);
      }
    });
  }

  // 5) contorno del texto seleccionado (guía para moverlo; no se graba)
  if (!forExport && state.selectedTextId) {
    const tx = selectedText();
    if (tx) {
      const bb = textBBox(tx);
      const pad = W * 0.015;
      ctx.strokeStyle = '#34d399';
      ctx.setLineDash([W * 0.012, W * 0.012]);
      ctx.lineWidth = Math.max(2, W * 0.003);
      ctx.strokeRect(bb.left - pad, bb.top - pad, bb.w + pad * 2, bb.h + pad * 2);
      ctx.setLineDash([]);
    }
  }
}

function renderStatic() {
  if (state.playing || state.exporting) return;
  composite(false);
  updateTimeLabel();
}

// ---------- Gestos de encuadre en el canvas ----------
const pointers = new Map();
let panLast = null, pinch = null, textDrag = false, gestureChanged = false;

canvas.addEventListener('pointerdown', (e) => {
  if (state.exporting) return;
  canvas.setPointerCapture(e.pointerId);
  const p = canvasPoint(e);
  pointers.set(e.pointerId, p);

  if (pointers.size === 1) {
    // ¿hay un texto seleccionado y tocamos sobre él? -> mover texto
    const tx = selectedText();
    if (tx && hitText(tx, p)) { textDrag = true; panLast = p; return; }
    // si había un texto seleccionado y tocamos fuera, lo deseleccionamos
    if (state.selectedTextId) { state.selectedTextId = null; renderTextList(); }
    const hit = cellAtPoint(p.x, p.y);
    if (hit && state.clips[hit.i]) selectClip(state.clips[hit.i].id);
    panLast = p;
  } else if (pointers.size === 2) {
    panLast = null; textDrag = false;
    const pts = [...pointers.values()];
    const tx = selectedText();
    if (tx) {
      pinch = { text: true, dist: dist(pts[0], pts[1]), size: tx.size };
    } else {
      const clip = selectedClip();
      pinch = {
        text: false, dist: dist(pts[0], pts[1]), ang: angle(pts[0], pts[1]),
        scale: clip ? clip.transform.scale : 1, rot: clip ? clip.transform.rot : 0,
      };
    }
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const p = canvasPoint(e);
  pointers.set(e.pointerId, p);

  // mover el texto seleccionado (un dedo)
  if (pointers.size === 1 && textDrag) {
    const tx = selectedText();
    if (tx && panLast) {
      tx.x = clamp(tx.x + (p.x - panLast.x) / canvas.width, 0, 1);
      tx.y = clamp(tx.y + (p.y - panLast.y) / canvas.height, 0, 1);
      panLast = p;
      gestureChanged = true;
      if (!state.playing) renderStatic();
    }
    return;
  }

  if (pointers.size === 2 && pinch && pinch.text) {
    const pts = [...pointers.values()];
    const tx = selectedText();
    if (tx) { tx.size = clamp(pinch.size * (dist(pts[0], pts[1]) / pinch.dist), 2, 40); syncTextSize(tx); gestureChanged = true; if (!state.playing) renderStatic(); }
    return;
  }

  // encuadre del clip
  const clip = selectedClip();
  if (!clip) return;
  if (pointers.size === 1 && panLast && !state.selectedTextId) {
    const rect = selectedCellRect();
    if (rect) {
      clip.transform.x += (p.x - panLast.x) / rect.dw;
      clip.transform.y += (p.y - panLast.y) / rect.dh;
    }
    panLast = p;
    gestureChanged = true;
    if (!state.playing) renderStatic();
  } else if (pointers.size === 2 && pinch && !pinch.text) {
    const pts = [...pointers.values()];
    const d = dist(pts[0], pts[1]);
    const a = angle(pts[0], pts[1]);
    clip.transform.scale = clamp(pinch.scale * (d / pinch.dist), 0.2, 5);
    clip.transform.rot = pinch.rot + (a - pinch.ang) * 180 / Math.PI;
    syncEditorSliders(clip);
    gestureChanged = true;
    if (!state.playing) renderStatic();
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) {
    panLast = null; textDrag = false;
    if (gestureChanged) { gestureChanged = false; commit(); }
  }
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
  ensureIdleAnim();
}

// ---------- Exportar ----------
let exportJob = null;
$('exportBtn').onclick = exportVideo;
$('exportCancelBtn').onclick = () => { if (exportJob) exportJob.cancel(); };

function pickMime() {
  // Para el respaldo MediaRecorder: preferimos MP4 (compatible con Instagram);
  // WebM como último recurso (su duración se repara con webm-duration.js).
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find(m => MediaRecorder.isTypeSupported(m)) || '';
}

// Elige el mejor método y códecs disponibles (WebCodecs->MP4 si se puede)
async function chooseExportMethod() {
  if (typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && window.Mp4Muxer) {
    const W = canvas.width, H = canvas.height;
    const vids = [['avc1.42001f', 'avc'], ['avc1.4d0028', 'avc'], ['avc1.640028', 'avc'], ['vp09.00.10.08', 'vp9'], ['av01.0.04M.08', 'av1']];
    let video = null;
    for (const [codec, mux] of vids) {
      try { if ((await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate: 4e6, framerate: 30 })).supported) { video = { codec, muxerCodec: mux }; break; } } catch (_) {}
    }
    if (video) {
      let audioC = null;
      if (typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined') {
        const auds = [['mp4a.40.2', 'aac'], ['opus', 'opus']];
        for (const [codec, mux] of auds) {
          try { if ((await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported) { audioC = { codec, muxerCodec: mux, sampleRate: 48000, channels: 2 }; break; } } catch (_) {}
        }
      }
      return { type: 'webcodecs', video, audio: audioC };
    }
  }
  return { type: 'mediarecorder' };
}

// Reproduce los clips respetando el recorte y llama onFrame(tSeg) por cuadro.
function runExportPlayback(onFrame) {
  let cancelled = false, raf = null;
  const stop = () => { if (raf) cancelAnimationFrame(raf); state.clips.forEach(c => c.video.pause()); };
  const promise = (async () => {
    if (state.mode === 'collage') {
      const active = activeCollageClips();
      active.forEach(c => { c._done = false; seekTo(c, c.trimStart); });
      await Promise.all(active.map(c => c.video.play().catch(() => {})));
      await new Promise((resolve) => {
        const loop = async () => {
          if (cancelled) { resolve(); return; }
          composite(true);
          const t = active.length ? Math.max(0, ...active.map(c => clamp(c.video.currentTime - c.trimStart, 0, clipDur(c)))) : 0;
          await onFrame(t);
          active.forEach(c => { if (!c._done && (c.video.currentTime >= c.trimEnd - 0.03 || c.video.ended)) { c.video.pause(); c._done = true; } });
          if (!active.length || active.every(c => c._done)) { resolve(); return; }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      });
    } else {
      let acc = 0;
      const startIdx = (i) => { seqIndex = i; const c = state.clips[i]; c._done = false; seekTo(c, c.trimStart); c.video.play().catch(() => {}); };
      startIdx(0);
      await new Promise((resolve) => {
        const loop = async () => {
          if (cancelled) { resolve(); return; }
          composite(true);
          const c = state.clips[seqIndex];
          if (c && (c.video.currentTime >= c.trimEnd - 0.03 || c.video.ended)) {
            c.video.pause(); acc += clipDur(c);
            if (seqIndex + 1 < state.clips.length) startIdx(seqIndex + 1);
            else { await onFrame(acc); resolve(); return; }
          }
          const inClip = c ? clamp(c.video.currentTime - c.trimStart, 0, clipDur(c)) : 0;
          await onFrame(acc + inClip);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      });
    }
    stop();
  })();
  return { promise, cancel: () => { cancelled = true; }, stop };
}

// Mezcla el audio de todos los clips (con recorte, volumen y orden) fuera de línea
async function renderMixedAudio(sampleRate, channels) {
  const total = totalDuration();
  if (total <= 0) return null;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return null;
  const oac = new OAC(channels, Math.max(1, Math.ceil(total * sampleRate)), sampleRate);
  const clips = state.mode === 'collage' ? activeCollageClips() : state.clips;
  let any = false;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    let buf;
    try { const ab = await clip.file.arrayBuffer(); buf = await oac.decodeAudioData(ab.slice(0)); }
    catch (_) { continue; }
    any = true;
    const src = oac.createBufferSource(); src.buffer = buf;
    const g = oac.createGain(); g.gain.value = clip.volume;
    src.connect(g).connect(oac.destination);
    let when = 0;
    if (state.mode === 'sequence') for (let k = 0; k < i; k++) when += clipDur(clips[k]);
    const offset = Math.min(clip.trimStart, buf.duration);
    const dur = Math.min(clipDur(clip), Math.max(0, buf.duration - offset));
    if (dur > 0) { try { src.start(when, offset, dur); } catch (_) {} }
  }
  if (!any) return null;
  return await oac.startRendering();
}

async function encodeAudioBuffer(aenc, rendered) {
  const sr = rendered.sampleRate, chans = rendered.numberOfChannels, len = rendered.length;
  const chData = [];
  for (let c = 0; c < chans; c++) chData.push(rendered.getChannelData(c));
  const CH = 1024;
  let pos = 0;
  while (pos < len) {
    const n = Math.min(CH, len - pos);
    const data = new Float32Array(n * chans);
    for (let c = 0; c < chans; c++) data.set(chData[c].subarray(pos, pos + n), c * n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: chans, timestamp: Math.round(pos / sr * 1e6), data });
    aenc.encode(ad); ad.close();
    pos += n;
  }
}

async function exportWithWebCodecs(vcfg, acfg, opts) {
  const { onProgress, isCancelled, setInner } = opts;
  const W = canvas.width, H = canvas.height, fps = 30;
  const q = parseFloat($('qualitySel').value);
  const bitrate = Math.max(1e6, Math.round(W * H * fps * 0.08 * q));
  const { Muxer, ArrayBufferTarget } = window.Mp4Muxer;

  // audio primero (para saber si lo incluimos)
  let rendered = null;
  if (acfg) { try { rendered = await renderMixedAudio(acfg.sampleRate, acfg.channels); } catch (_) {} }
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: vcfg.muxerCodec, width: W, height: H, frameRate: fps },
    audio: rendered ? { codec: acfg.muxerCodec, numberOfChannels: rendered.numberOfChannels, sampleRate: rendered.sampleRate } : undefined,
    fastStart: 'in-memory',
  });

  let encErr = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
  venc.configure({ codec: vcfg.codec, width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality' });

  if (rendered) {
    const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { encErr = e; } });
    aenc.configure({ codec: acfg.codec, sampleRate: rendered.sampleRate, numberOfChannels: rendered.numberOfChannels, bitrate: 128000 });
    await encodeAudioBuffer(aenc, rendered);
    await aenc.flush();
  }

  const total = totalDuration();
  let lastFrame = -1;
  const job = runExportPlayback(async (t) => {
    onProgress(t, total);
    const idx = Math.floor(t * fps);
    if (idx > lastFrame && !isCancelled()) {
      let guard = 0;
      while (venc.encodeQueueSize > 6 && guard++ < 500) await new Promise(r => setTimeout(r, 4));
      const frame = new VideoFrame(canvas, { timestamp: Math.round(idx * 1e6 / fps), duration: Math.round(1e6 / fps) });
      try { venc.encode(frame, { keyFrame: idx % 60 === 0 }); } catch (_) {}
      frame.close();
      lastFrame = idx;
    }
  });
  setInner(job);
  await job.promise;
  if (isCancelled()) { try { venc.close(); } catch (_) {} return null; }
  await venc.flush();
  muxer.finalize();
  if (encErr) throw encErr;
  return new Blob([target.buffer], { type: 'video/mp4' });
}

async function exportWithMediaRecorder(opts) {
  const { onProgress, isCancelled, setInner } = opts;
  const fps = 30;
  const stream = canvas.captureStream(fps);
  if (audio.recordDest) audio.recordDest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  const mime = pickMime();
  const q = parseFloat($('qualitySel').value);
  const bitrate = Math.round(canvas.width * canvas.height * fps * 0.12 * q);
  let recorder;
  try { recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate }); }
  catch (_) { return null; }
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise(res => { recorder.onstop = res; });
  const recordStart = performance.now();
  recorder.start(100);
  const total = totalDuration();
  const job = runExportPlayback(async (t) => onProgress(t, total));
  setInner(job);
  await job.promise;
  try { recorder.stop(); } catch (_) {}
  await stopped;
  if (isCancelled()) return null;
  let blob = new Blob(chunks, { type: (mime.split(';')[0]) || 'video/webm' });
  const durMs = performance.now() - recordStart;
  if (blob.type.includes('webm') && typeof fixWebmDuration === 'function') {
    try { blob = await fixWebmDuration(blob, durMs); } catch (_) {}
  }
  return blob;
}

function downloadBlob(blob) {
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `clipmix-${Date.now()}.${ext}`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function exportVideo() {
  if (!state.clips.length || state.exporting) return;
  stopPreview();
  state.exporting = true;
  updateControls();

  const statusEl = $('exportStatus'), barEl = $('exportBar'), textEl = $('exportText');
  statusEl.hidden = false; barEl.style.width = '0%'; textEl.textContent = 'Preparando…';
  $('exportCancelBtn').hidden = false;

  ensureAudioGraph();
  state.clips.forEach(ensureClipNodes);
  if (audio.ctx) await audio.ctx.resume().catch(() => {});

  // exportamos siempre a resolución completa (aunque la edición use proxy)
  const restoreProxy = beginFullResForExport();

  let cancelled = false, lastProgress = performance.now();
  const onProgress = (t, total) => {
    lastProgress = performance.now();
    barEl.style.width = Math.min(100, (t / total) * 100) + '%';
    textEl.textContent = `Exportando… ${fmtTime(t)} / ${fmtTime(total)}`;
  };
  const isCancelled = () => cancelled;
  exportJob = { cancel: () => { cancelled = true; if (exportJob._inner) exportJob._inner.cancel(); }, _inner: null };
  const setInner = (j) => { exportJob._inner = j; };

  // watchdog: si no hay progreso por 15s, cancela para no quedar trabado
  const watchdog = setInterval(() => {
    if (performance.now() - lastProgress > 15000) { cancelled = true; if (exportJob._inner) exportJob._inner.cancel(); }
  }, 3000);

  let blob = null, error = null;
  try {
    const method = await chooseExportMethod();
    const opts = { onProgress, isCancelled, setInner };
    if (method.type === 'webcodecs') blob = await exportWithWebCodecs(method.video, method.audio, opts);
    else blob = await exportWithMediaRecorder(opts);
  } catch (e) { error = e; console.error('export error', e); }

  clearInterval(watchdog);
  restoreProxy();

  if (cancelled && !blob) textEl.textContent = 'Exportación cancelada.';
  else if (error || !blob) textEl.textContent = 'Hubo un problema al exportar. Prueba de nuevo o baja la calidad.';
  else { downloadBlob(blob); textEl.textContent = '¡Listo! Video descargado.'; }

  state.exporting = false;
  exportJob = null;
  $('exportCancelBtn').hidden = true;
  state.clips.forEach(c => c.video.pause());
  updateControls();
  setTimeout(() => { statusEl.hidden = true; renderStatic(); }, 2600);
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
  commit();
}

// ---------- Textos ----------
function selectedText() { return state.texts.find(t => t.id === state.selectedTextId) || null; }

function drawOneText(c, tx) {
  const W = canvas.width, H = canvas.height;
  const fs = Math.max(8, H * (tx.size / 100));
  c.save();
  c.font = `${tx.bold ? '700 ' : '400 '}${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  const lines = (tx.content || '').split('\n');
  const lh = fs * 1.2;
  const cx = tx.x * W, cy = tx.y * H;
  const startY = cy - (lines.length - 1) * lh / 2;
  lines.forEach((ln, i) => {
    const y = startY + i * lh;
    c.lineWidth = Math.max(2, fs * 0.16);
    c.strokeStyle = 'rgba(0,0,0,.78)';   // contorno para legibilidad sobre el video
    c.strokeText(ln, cx, y);
    c.fillStyle = tx.color;
    c.fillText(ln, cx, y);
  });
  c.restore();
}

function textBBox(tx) {
  const W = canvas.width, H = canvas.height;
  const fs = Math.max(8, H * (tx.size / 100));
  ctx.save();
  ctx.font = `${tx.bold ? '700 ' : '400 '}${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const lines = (tx.content || ' ').split('\n');
  let maxw = 0;
  lines.forEach(l => { maxw = Math.max(maxw, ctx.measureText(l || ' ').width); });
  ctx.restore();
  const lh = fs * 1.2;
  const h = Math.max(lh, lines.length * lh);
  const cx = tx.x * W, cy = tx.y * H;
  return { cx, cy, w: maxw, h, left: cx - maxw / 2, top: cy - h / 2 };
}

function hitText(tx, p) {
  const bb = textBBox(tx);
  const pad = canvas.width * 0.03;
  return p.x >= bb.left - pad && p.x <= bb.left + bb.w + pad && p.y >= bb.top - pad && p.y <= bb.top + bb.h + pad;
}

function drawTexts(paused) {
  if (!state.texts.length) return;
  const t = currentTime();
  state.texts.forEach(tx => {
    const visible = t >= tx.start && t < tx.start + tx.duration;
    if (visible || (paused && tx.id === state.selectedTextId)) drawOneText(ctx, tx);
  });
}

function addText() {
  const t = {
    id: nextTextId++, content: 'Escribe aquí', start: 0,
    duration: Math.min(3, Math.max(1, Math.ceil(totalDuration()) || 3)),
    x: 0.5, y: 0.85, size: 7, color: '#ffffff', bold: true,
  };
  state.texts.push(t);
  state.selectedTextId = t.id;
  renderTextList();
  renderStatic();
  commit();
}
function removeText(id) {
  const i = state.texts.findIndex(t => t.id === id);
  if (i < 0) return;
  state.texts.splice(i, 1);
  if (state.selectedTextId === id) state.selectedTextId = null;
  renderTextList();
  renderStatic();
  commit();
}
function selectText(id) {
  state.selectedTextId = id;
  renderTextList();
  renderStatic();
}

function renderTextList() {
  const list = $('textList');
  list.innerHTML = '';
  const maxT = Math.max(5, Math.ceil(totalDuration()));
  state.texts.forEach((tx, i) => {
    const li = document.createElement('li');
    li.className = 'text-item' + (tx.id === state.selectedTextId ? ' selected' : '');
    li.dataset.id = tx.id;

    const head = document.createElement('div');
    head.className = 'text-head';
    const badge = document.createElement('span');
    badge.className = 'text-badge';
    badge.textContent = i + 1;
    const title = document.createElement('div');
    title.className = 'text-title';
    title.textContent = (tx.content.split('\n')[0] || '(vacío)').slice(0, 22) || '(vacío)';
    title.onclick = () => selectText(tx.id);
    const time = document.createElement('span');
    time.className = 'text-time';
    time.textContent = `${tx.start.toFixed(1)}s · ${tx.duration.toFixed(1)}s`;
    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.onclick = () => removeText(tx.id);
    head.appendChild(badge);
    head.appendChild(title);
    head.appendChild(time);
    head.appendChild(rm);
    li.appendChild(head);

    if (tx.id === state.selectedTextId) li.appendChild(buildTextEditor(tx, title, time, maxT));
    list.appendChild(li);
  });
}

function buildTextEditor(tx, titleEl, timeEl, maxT) {
  const box = document.createElement('div');
  box.className = 'text-editor';

  const ta = document.createElement('textarea');
  ta.className = 'text-input textarea';
  ta.rows = 2;
  ta.value = tx.content;
  ta.placeholder = 'Tu texto… (Enter para varias líneas)';
  ta.addEventListener('input', () => {
    tx.content = ta.value;
    titleEl.textContent = (tx.content.split('\n')[0] || '(vacío)').slice(0, 22) || '(vacío)';
    renderStatic();
  });
  box.appendChild(ta);

  const startRow = sliderRow('Aparece', 0, maxT, 0.1, tx.start, (v) => {
    tx.start = v; startRow.val.textContent = v.toFixed(1) + 's';
    timeEl.textContent = `${tx.start.toFixed(1)}s · ${tx.duration.toFixed(1)}s`;
    renderStatic();
  }, tx.start.toFixed(1) + 's');

  const durRow = sliderRow('Dura', 0.2, maxT, 0.1, tx.duration, (v) => {
    tx.duration = v; durRow.val.textContent = v.toFixed(1) + 's';
    timeEl.textContent = `${tx.start.toFixed(1)}s · ${tx.duration.toFixed(1)}s`;
    renderStatic();
  }, tx.duration.toFixed(1) + 's');

  const sizeRow = sliderRow('Tamaño', 2, 20, 0.5, tx.size, (v) => {
    tx.size = v; sizeRow.val.textContent = v.toFixed(1);
    renderStatic();
  }, tx.size.toFixed(1));
  sizeRow.input.classList.add('txt-size');

  box.appendChild(startRow.el);
  box.appendChild(durRow.el);
  box.appendChild(sizeRow.el);

  // color + negrita
  const styleRow = document.createElement('div');
  styleRow.className = 'text-style-row';
  const color = document.createElement('input');
  color.type = 'color'; color.value = tx.color; color.title = 'Color del texto';
  color.addEventListener('input', () => { tx.color = color.value; renderStatic(); });
  const bold = document.createElement('button');
  bold.className = 'btn small bold-toggle' + (tx.bold ? ' on' : '');
  bold.textContent = 'Negrita';
  bold.onclick = () => { tx.bold = !tx.bold; bold.classList.toggle('on', tx.bold); renderStatic(); commit(); };
  styleRow.appendChild(color);
  styleRow.appendChild(bold);
  box.appendChild(styleRow);

  return box;
}

function syncTextSize(tx) {
  const inp = document.querySelector(`.text-item[data-id="${tx.id}"] .txt-size`);
  if (inp) { inp.value = tx.size; inp.nextElementSibling.textContent = tx.size.toFixed(1); }
}

$('addTextBtn').addEventListener('click', addText);

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
    if (typeof s.proxy === 'boolean') state.proxy = s.proxy;
  } catch (_) {}
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ frameColor: state.frameColor, frameWidth: state.frameWidth, proxy: state.proxy })); } catch (_) {}
}
function initProxyToggle() {
  const t = $('proxyToggle');
  t.checked = state.proxy;
  t.addEventListener('change', () => { state.proxy = t.checked; applyFormat(); saveSettings(); });
}
function buildSwatches() {
  const w = $('frameSwatches');
  w.innerHTML = '';
  FRAME_SWATCHES.forEach(col => {
    const b = document.createElement('button');
    b.className = 'swatch' + (col.toLowerCase() === state.frameColor.toLowerCase() ? ' active' : '');
    b.style.background = col;
    b.title = col;
    b.onclick = () => { setFrameColor(col); commit(); };
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
function refreshFrameInputs() {
  $('frameColor').value = state.frameColor;
  $('frameWidth').value = state.frameWidth;
  $('frameWidthVal').textContent = state.frameWidth + '%';
  buildSwatches();
}
function initFrameControls() {
  refreshFrameInputs();
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

// ---------- Historial: deshacer / rehacer ----------
let history = [];
let histIndex = -1;
const HIST_MAX = 80;

function snapshot() {
  return {
    order: state.clips.map(c => c.id),
    clips: state.clips.map(c => ({
      id: c.id, trimStart: c.trimStart, trimEnd: c.trimEnd, volume: c.volume,
      transform: { ...c.transform },
    })),
    texts: state.texts.map(t => ({ ...t })),
    layout: state.layout, format: state.format, mode: state.mode,
    frameColor: state.frameColor, frameWidth: state.frameWidth,
    template: state.template, templateSpeed: state.templateSpeed,
    selectedId: state.selectedId, selectedTextId: state.selectedTextId,
  };
}

// Guarda un nuevo estado en el historial (si cambió algo respecto al último)
function commit() {
  const snap = snapshot();
  const json = JSON.stringify(snap);
  if (histIndex >= 0 && JSON.stringify(history[histIndex]) === json) return; // sin cambios
  history = history.slice(0, histIndex + 1);
  history.push(snap);
  if (history.length > HIST_MAX) history.shift();
  histIndex = history.length - 1;
  updateUndoButtons();
  saveProjectSoon();
}

// ---------- Autoguardado / restauración ----------
const PROJECT_KEY = 'clipmix_project_v1';
let saveTimer = null;
function saveProjectSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveProjectNow, 500); }
function saveProjectNow() {
  const meta = {
    clips: state.clips.map(c => ({ id: c.id, name: c.name, trimStart: c.trimStart, trimEnd: c.trimEnd, volume: c.volume, transform: { ...c.transform } })),
    texts: state.texts.map(t => ({ ...t })),
    mode: state.mode, layout: state.layout, format: state.format,
    frameColor: state.frameColor, frameWidth: state.frameWidth,
    template: state.template, templateSpeed: state.templateSpeed,
    selectedId: state.selectedId, selectedTextId: state.selectedTextId,
  };
  try { localStorage.setItem(PROJECT_KEY, JSON.stringify(meta)); } catch (_) {}
}
async function saveClipBlob(clip) { try { await clipStore.put('clip_' + clip.id, clip.file); } catch (_) {} }
async function delClipBlob(id) { try { await clipStore.del('clip_' + id); } catch (_) {} }

async function restoreProject() {
  let meta;
  try { meta = JSON.parse(localStorage.getItem(PROJECT_KEY) || 'null'); } catch (_) { meta = null; }
  if (!meta || !meta.clips || !meta.clips.length || !window.clipStore) return false;
  const ordered = [];
  for (const cm of meta.clips) {
    let file;
    try { file = await clipStore.get('clip_' + cm.id); } catch (_) {}
    if (!file) continue;
    const clip = makeClip(file, { restore: true, id: cm.id, trimStart: cm.trimStart, trimEnd: cm.trimEnd, volume: cm.volume, transform: cm.transform });
    clip.name = cm.name || clip.name;
    ordered.push(clip);
  }
  if (!ordered.length) return false;
  state.clips = ordered; // respetar el orden guardado
  state.texts = (meta.texts || []).map(t => ({ ...t }));
  state.mode = meta.mode || state.mode;
  if (LAYOUTS[meta.layout]) state.layout = meta.layout;
  if (FORMATS[meta.format]) state.format = meta.format;
  if (meta.frameColor) state.frameColor = meta.frameColor;
  if (typeof meta.frameWidth === 'number') state.frameWidth = meta.frameWidth;
  if (meta.template && TEMPLATES[meta.template]) state.template = meta.template;
  if (typeof meta.templateSpeed === 'number') state.templateSpeed = meta.templateSpeed;
  state.selectedId = state.clips.find(c => c.id === meta.selectedId) ? meta.selectedId : (state.clips[0]?.id ?? null);
  state.selectedTextId = state.texts.find(t => t.id === meta.selectedTextId) ? meta.selectedTextId : null;
  nextTextId = Math.max(nextTextId, ...state.texts.map(t => (t.id || 0) + 1), 1);
  return true;
}

function applySnapshot(s) {
  const byId = new Map(state.clips.map(c => [c.id, c]));
  // reordenar clips según el snapshot (los que no estén, van al final)
  const arr = [];
  s.order.forEach(id => { const c = byId.get(id); if (c) arr.push(c); });
  state.clips.forEach(c => { if (!s.order.includes(c.id)) arr.push(c); });
  state.clips = arr;
  // aplicar propiedades por clip
  s.clips.forEach(cs => {
    const c = byId.get(cs.id);
    if (c) { c.trimStart = cs.trimStart; c.trimEnd = cs.trimEnd; c.volume = cs.volume; c.transform = { ...cs.transform }; applyVolume(c); }
  });
  // textos
  state.texts = s.texts.map(t => ({ ...t }));
  state.layout = LAYOUTS[s.layout] ? s.layout : state.layout;
  state.format = FORMATS[s.format] ? s.format : state.format;
  state.mode = s.mode;
  state.frameColor = s.frameColor;
  state.frameWidth = s.frameWidth;
  if (s.template && TEMPLATES[s.template]) state.template = s.template;
  if (typeof s.templateSpeed === 'number') state.templateSpeed = s.templateSpeed;
  state.selectedId = byId.has(s.selectedId) ? s.selectedId : (state.clips[0]?.id ?? null);
  state.selectedTextId = state.texts.find(t => t.id === s.selectedTextId) ? s.selectedTextId : null;
  // refrescar toda la interfaz
  syncModeUI();
  refreshTiles();
  refreshFrameInputs();
  refreshTemplateUI();
  renderClipList();
  renderTextList();
  applyFormat();
  renderStatic();
  ensureIdleAnim();
  saveSettings();
}

function undo() {
  if (histIndex <= 0) return;
  histIndex--;
  applySnapshot(history[histIndex]);
  updateUndoButtons();
}
function redo() {
  if (histIndex >= history.length - 1) return;
  histIndex++;
  applySnapshot(history[histIndex]);
  updateUndoButtons();
}
function updateUndoButtons() {
  $('undoBtn').disabled = histIndex <= 0;
  $('redoBtn').disabled = histIndex >= history.length - 1;
}

$('undoBtn').onclick = undo;
$('redoBtn').onclick = redo;

// Deshacer/rehacer con atajos de teclado (escritorio)
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); }
});

// Confirmar cambios: cualquier slider/color/textarea que termine de cambiar
document.addEventListener('change', (e) => {
  if (e.target.matches('input[type=range], input[type=color], textarea')) commit();
});

// ---------- Arranque ----------
window.addEventListener('resize', () => applyFormat());
window.addEventListener('orientationchange', () => setTimeout(applyFormat, 200));

async function init() {
  loadSettings();
  loadPresets();
  try { await restoreProject(); } catch (_) {}
  buildLayoutTiles();
  buildFormatTiles();
  initFrameControls();
  initProxyToggle();
  initTemplateControls();
  syncModeUI();
  renderClipList();
  renderTextList();
  updateControls();
  applyFormat();
  renderStatic();
  ensureIdleAnim();
  commit();            // estado inicial en el historial
  updateUndoButtons();
}
init();
