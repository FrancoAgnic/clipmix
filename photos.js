/* ClipMix — Sección Fotos: moodboard / carrusel panorámico "sin costura".
 * Lienzo largo horizontal con color de fondo y fotos libres (mover/escalar/rotar,
 * con capas). Se corta en N slides que, al deslizar en Instagram, se ven
 * conectados. Navegación del lienzo con una barra (no arrastrando el fondo).
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const SLIDE = {
    '4:5': { w: 1080, h: 1350, label: '4:5' },
    '1:1': { w: 1080, h: 1080, label: '1:1' },
    '4:3': { w: 1080, h: 810, label: '4:3' },
  };
  const BG_SWATCHES = ['#111111', '#ffffff', '#f5f0e6', '#0f172a', '#fde2e4', '#e2ece9', '#5b8cff', '#000000'];

  // photo: { id, img, file, url, name, cx, cy, scale, rot }  (cx,cy = centro en px del lienzo)
  const P = { photos: [], format: '4:5', slides: 3, bg: '#111111', selectedId: null, viewX: 0 };
  let nextPid = 1;

  const PHOTOS_KEY = 'clipmix_photos_v2';
  let saveTimer = null;

  // ---------- Sección ----------
  function initSectionSwitch() {
    if (!document.body.dataset.section) document.body.dataset.section = 'video';
    document.querySelector('.section-switch').addEventListener('click', (e) => {
      const btn = e.target.closest('.sec-btn');
      if (!btn) return;
      document.body.dataset.section = btn.dataset.section;
      document.querySelectorAll('.sec-btn').forEach(x => x.classList.toggle('active', x === btn));
      if (btn.dataset.section === 'photos') { if (window.stopPreview) try { window.stopPreview(); } catch (_) {} renderPhoto(); }
    });
  }

  function boardDims() { const s = SLIDE[P.format]; return { sw: s.w, sh: s.h, W: s.w * P.slides, H: s.h }; }

  // ---------- Cargar fotos ----------
  $('photoInput').addEventListener('change', (e) => { [...e.target.files].forEach(f => addPhoto(f)); e.target.value = ''; });

  function addPhoto(file, opts = {}) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => renderPhoto();
    img.src = url;
    const { W, H } = boardDims();
    const idx = P.photos.length;
    const p = {
      id: opts.id != null ? opts.id : nextPid++, file, url, img, name: file.name,
      cx: opts.cx != null ? opts.cx : clamp((0.18 + idx * 0.28) * H, 0, W),
      cy: opts.cy != null ? opts.cy : H * (idx % 2 ? 0.62 : 0.42),
      scale: opts.scale || 1, rot: opts.rot || 0,
    };
    if (opts.id != null) nextPid = Math.max(nextPid, opts.id + 1);
    P.photos.push(p);
    if (!opts.restore) P.selectedId = p.id;
    renderPhotoList(); renderPhoto();
    if (!opts.restore) { savePhotoBlob(p); savePhotosSoon(); }
    return p;
  }
  function removePhoto(id) {
    const i = P.photos.findIndex(p => p.id === id);
    if (i < 0) return;
    URL.revokeObjectURL(P.photos[i].url);
    P.photos.splice(i, 1);
    if (P.selectedId === id) P.selectedId = P.photos[P.photos.length - 1]?.id ?? null;
    renderPhotoList(); renderPhoto(); delPhotoBlob(id); savePhotosSoon();
  }
  function selectPhoto(id) { P.selectedId = id; renderPhotoList(); syncAdjust(); renderPhoto(); }
  function selectedPhoto() { return P.photos.find(p => p.id === P.selectedId) || null; }
  function bringFront() { const p = selectedPhoto(); if (!p) return; P.photos = P.photos.filter(x => x !== p); P.photos.push(p); renderPhotoList(); renderPhoto(); savePhotosSoon(); }
  function sendBack() { const p = selectedPhoto(); if (!p) return; P.photos = P.photos.filter(x => x !== p); P.photos.unshift(p); renderPhotoList(); renderPhoto(); savePhotosSoon(); }
  $('photoFront').onclick = bringFront;
  $('photoBack').onclick = sendBack;

  // ---------- Lista (miniaturas) ----------
  function renderPhotoList() {
    const list = $('photoList'); list.innerHTML = '';
    $('photoHint').style.display = P.photos.length ? 'none' : 'block';
    // mostramos de arriba (frente) hacia abajo
    P.photos.slice().reverse().forEach((p) => {
      const li = document.createElement('li');
      li.className = p.id === P.selectedId ? 'selected' : '';
      const im = document.createElement('img'); im.src = p.url; im.onclick = () => selectPhoto(p.id);
      const rm = document.createElement('button'); rm.className = 'pv-rm'; rm.textContent = '✕'; rm.onclick = () => removePhoto(p.id);
      li.appendChild(im); li.appendChild(rm);
      list.appendChild(li);
    });
  }

  // ---------- Fondo ----------
  function buildBgSwatches() {
    const w = $('photoBgSwatches'); w.innerHTML = '';
    BG_SWATCHES.forEach(col => {
      const b = document.createElement('button');
      b.className = 'swatch' + (col.toLowerCase() === P.bg.toLowerCase() ? ' active' : '');
      b.style.background = col; b.title = col;
      b.onclick = () => setBg(col);
      w.appendChild(b);
    });
  }
  function setBg(col) { P.bg = col; $('photoBg').value = col; buildBgSwatches(); renderPhoto(); savePhotosSoon(); }
  $('photoBg').addEventListener('input', () => setBg($('photoBg').value));

  // ---------- Formato / slides ----------
  function buildPhotoFormatTiles() {
    const grid = $('photoFormatGrid'); grid.innerHTML = '';
    Object.entries(SLIDE).forEach(([key, def]) => {
      const tile = document.createElement('button');
      tile.className = 'opt-tile' + (key === P.format ? ' active' : '');
      tile.dataset.pformat = key;
      const ar = def.w / def.h, bw = ar >= 1 ? 30 : 30 * ar, bh = ar >= 1 ? 30 / ar : 30;
      tile.innerHTML = `<svg viewBox="0 0 34 34"><rect class="cell" x="${(34 - bw) / 2}" y="${(34 - bh) / 2}" width="${bw}" height="${bh}" rx="2"/></svg><span>${def.label}</span>`;
      tile.onclick = () => { P.format = key; refreshPhotoFormat(); renderPhoto(); savePhotosSoon(); };
      grid.appendChild(tile);
    });
  }
  function refreshPhotoFormat() { document.querySelectorAll('[data-pformat]').forEach(t => t.classList.toggle('active', t.dataset.pformat === P.format)); }
  $('slidesMinus').onclick = () => setSlides(P.slides - 1);
  $('slidesPlus').onclick = () => setSlides(P.slides + 1);
  function setSlides(n) { P.slides = clamp(n, 1, 12); $('slidesVal').textContent = P.slides; renderPhoto(); savePhotosSoon(); }

  // ---------- Ajuste de foto seleccionada ----------
  function syncAdjust() {
    const p = selectedPhoto();
    $('photoZoom').value = p ? Math.round(p.scale * 100) : 100;
    $('photoZoomVal').textContent = (p ? Math.round(p.scale * 100) : 100) + '%';
    $('photoRot').value = p ? Math.round(p.rot) : 0;
    $('photoRotVal').textContent = (p ? Math.round(p.rot) : 0) + '°';
  }
  $('photoZoom').addEventListener('input', () => { const p = selectedPhoto(); if (!p) return; p.scale = parseInt($('photoZoom').value) / 100; $('photoZoomVal').textContent = Math.round(p.scale * 100) + '%'; renderPhoto(); });
  $('photoRot').addEventListener('input', () => { const p = selectedPhoto(); if (!p) return; p.rot = parseInt($('photoRot').value); $('photoRotVal').textContent = Math.round(p.rot) + '°'; renderPhoto(); });
  $('photoZoom').addEventListener('change', savePhotosSoon);
  $('photoRot').addEventListener('change', savePhotosSoon);

  // ---------- Dibujo ----------
  function photoSize(p) {
    const { H } = boardDims();
    const img = p.img;
    if (!img || !img.naturalWidth) { const d = H * 0.5 * p.scale; return { w: d, h: d }; }
    const targetLong = H * 0.6 * p.scale;
    const s = targetLong / Math.max(img.naturalWidth, img.naturalHeight);
    return { w: img.naturalWidth * s, h: img.naturalHeight * s };
  }
  function drawPhotoObj(c, p) {
    const { w, h } = photoSize(p);
    c.save();
    c.translate(p.cx, p.cy);
    if (p.rot) c.rotate(p.rot * Math.PI / 180);
    if (p.img && p.img.complete && p.img.naturalWidth) c.drawImage(p.img, -w / 2, -h / 2, w, h);
    else { c.fillStyle = '#333'; c.fillRect(-w / 2, -h / 2, w, h); }
    c.restore();
  }
  function drawBoard(c, W, H, guides) {
    c.fillStyle = P.bg; c.fillRect(0, 0, W, H);
    P.photos.forEach(p => drawPhotoObj(c, p));
    if (guides) {
      const { sw } = boardDims();
      c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = Math.max(2, W * 0.0016); c.setLineDash([H * 0.02, H * 0.02]);
      for (let k = 1; k < P.slides; k++) { const x = k * sw; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
      c.setLineDash([]);
      c.fillStyle = 'rgba(255,255,255,.85)'; c.strokeStyle = 'rgba(0,0,0,.5)';
      c.font = `bold ${Math.round(H * 0.08)}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = H * 0.008;
      for (let k = 0; k < P.slides; k++) { const cx = k * sw + sw / 2; c.strokeText(String(k + 1), cx, H * 0.1); c.fillText(String(k + 1), cx, H * 0.1); }
      const p = selectedPhoto();
      if (p) {
        const { w, h } = photoSize(p);
        c.save(); c.translate(p.cx, p.cy); if (p.rot) c.rotate(p.rot * Math.PI / 180);
        c.strokeStyle = '#34d399'; c.lineWidth = Math.max(3, W * 0.0022); c.strokeRect(-w / 2, -h / 2, w, h);
        c.restore();
      }
    }
  }

  let previewH = 320;
  function renderPhoto() {
    if (document.body.dataset.section !== 'photos') return;
    const { W, H } = boardDims();
    const cv = $('photoPreview'); cv.width = W; cv.height = H;
    drawBoard(cv.getContext('2d'), W, H, true);
    applyView();
  }
  function applyView() {
    const cv = $('photoPreview'), wrap = cv.parentElement;
    previewH = Math.min(340, Math.round(window.innerHeight * 0.42));
    const { W, H } = boardDims();
    const dispScale = previewH / H;
    const dispW = Math.round(W * dispScale);
    cv.style.height = previewH + 'px';
    cv.style.width = dispW + 'px';
    const wrapW = wrap.clientWidth || dispW;
    const maxOffset = Math.max(0, dispW - wrapW);
    const off = P.viewX * maxOffset;
    cv.style.transform = `translateX(${-off}px)`;
    const pan = $('photoPan');
    pan.disabled = maxOffset <= 1;
    pan.style.opacity = maxOffset <= 1 ? 0.4 : 1;
  }
  $('photoPan').addEventListener('input', () => { P.viewX = parseFloat($('photoPan').value); applyView(); });
  window.addEventListener('resize', () => { if (document.body.dataset.section === 'photos') applyView(); });

  // ---------- Gestos: mover / escalar / rotar la foto ----------
  const cv = $('photoPreview');
  const pts = new Map();
  let last = null, pinch = null;
  function toBoard(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * cv.width, y: (e.clientY - r.top) / r.height * cv.height }; }
  function hitPhoto(p, x, y) {
    const { w, h } = photoSize(p);
    const dx = x - p.cx, dy = y - p.cy, a = -p.rot * Math.PI / 180;
    const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(rx) <= w / 2 && Math.abs(ry) <= h / 2;
  }
  function topmostAt(x, y) { for (let i = P.photos.length - 1; i >= 0; i--) if (hitPhoto(P.photos[i], x, y)) return P.photos[i]; return null; }

  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const p = toBoard(e); pts.set(e.pointerId, p);
    if (pts.size === 1) {
      const hit = topmostAt(p.x, p.y);
      if (hit) { if (hit.id !== P.selectedId) selectPhoto(hit.id); last = p; }
      else { last = null; }   // tocar el fondo no hace nada (para desplazar, usa la barra)
    } else if (pts.size === 2) {
      last = null; const a = [...pts.values()]; const ph = selectedPhoto();
      pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), ang: Math.atan2(a[1].y - a[0].y, a[1].x - a[0].x), scale: ph ? ph.scale : 1, rot: ph ? ph.rot : 0 };
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = toBoard(e); pts.set(e.pointerId, p);
    const ph = selectedPhoto(); if (!ph) return;
    const { W, H } = boardDims();
    if (pts.size === 1 && last) {
      ph.cx = clamp(ph.cx + (p.x - last.x), 0, W);
      ph.cy = clamp(ph.cy + (p.y - last.y), 0, H);
      last = p; renderPhoto();
    } else if (pts.size === 2 && pinch) {
      const a = [...pts.values()];
      const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      const ang = Math.atan2(a[1].y - a[0].y, a[1].x - a[0].x);
      ph.scale = clamp(pinch.scale * (d / pinch.d), 0.1, 6);
      ph.rot = pinch.rot + (ang - pinch.ang) * 180 / Math.PI;
      syncAdjust(); renderPhoto();
    }
  });
  function endPt(e) { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (pts.size === 0) { last = null; savePhotosSoon(); } }
  cv.addEventListener('pointerup', endPt);
  cv.addEventListener('pointercancel', endPt);

  // ---------- Exportar ----------
  $('photoExportBtn').onclick = exportCarousel;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  async function exportCarousel() {
    if (!P.photos.length) { setStatus('Añade al menos una foto.'); return; }
    const { sw, sh, W, H } = boardDims();
    const board = document.createElement('canvas'); board.width = W; board.height = H;
    drawBoard(board.getContext('2d'), W, H, false);
    for (let k = 0; k < P.slides; k++) {
      const c = document.createElement('canvas'); c.width = sw; c.height = sh;
      c.getContext('2d').drawImage(board, k * sw, 0, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `carrusel-${String(k + 1).padStart(2, '0')}.jpg`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setStatus(`Guardando ${k + 1} de ${P.slides}…`);
      await sleep(400);
    }
    setStatus(`¡Listo! ${P.slides} imágenes. Súbelas al carrusel de IG en orden (1, 2, 3…).`);
  }
  function setStatus(t) { $('photoExportStatus').textContent = t; }

  // ---------- Autoguardado / restauración ----------
  function savePhotosSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(savePhotosNow, 500); }
  function savePhotosNow() {
    const meta = {
      format: P.format, slides: P.slides, bg: P.bg, selectedId: P.selectedId,
      photos: P.photos.map(p => ({ id: p.id, name: p.name, cx: p.cx, cy: p.cy, scale: p.scale, rot: p.rot })),
    };
    try { localStorage.setItem(PHOTOS_KEY, JSON.stringify(meta)); } catch (_) {}
  }
  async function savePhotoBlob(p) { try { if (window.clipStore) await clipStore.put('photo_' + p.id, p.file); } catch (_) {} }
  async function delPhotoBlob(id) { try { if (window.clipStore) await clipStore.del('photo_' + id); } catch (_) {} }
  async function restorePhotos() {
    let meta; try { meta = JSON.parse(localStorage.getItem(PHOTOS_KEY) || 'null'); } catch (_) { meta = null; }
    if (!meta || !meta.photos || !meta.photos.length || !window.clipStore) return;
    if (SLIDE[meta.format]) P.format = meta.format;
    if (typeof meta.slides === 'number') P.slides = clamp(meta.slides, 1, 12);
    if (meta.bg) P.bg = meta.bg;
    for (const pm of meta.photos) {
      let file; try { file = await clipStore.get('photo_' + pm.id); } catch (_) {}
      if (!file) continue;
      addPhoto(file, { restore: true, id: pm.id, cx: pm.cx, cy: pm.cy, scale: pm.scale, rot: pm.rot });
    }
    if (meta.selectedId != null && P.photos.find(p => p.id === meta.selectedId)) P.selectedId = meta.selectedId;
  }

  // ---------- Arranque ----------
  async function initPhotos() {
    initSectionSwitch();
    buildBgSwatches();
    buildPhotoFormatTiles();
    $('slidesVal').textContent = P.slides;
    try { await restorePhotos(); } catch (_) {}
    buildBgSwatches();
    refreshPhotoFormat();
    $('slidesVal').textContent = P.slides;
    $('photoBg').value = P.bg;
    renderPhotoList();
    syncAdjust();
    renderPhoto();
  }
  initPhotos();
  window.__photoBoard = P; // acceso para depuración/pruebas
})();
