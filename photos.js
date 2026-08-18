/* ClipMix — Sección Fotos: carrusel panorámico "sin costuras" para Instagram.
 * Varias fotos en una tira horizontal continua, cortada en N slides que, al
 * deslizar en IG, se ven conectadas como una sola foto larga.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  const SLIDE = {
    '4:5': { w: 1080, h: 1350, label: '4:5' },
    '1:1': { w: 1080, h: 1080, label: '1:1' },
    '4:3': { w: 1080, h: 810, label: '4:3' },
  };

  const P = { photos: [], format: '4:5', slides: 3, selectedId: null };
  let nextPid = 1;

  const PHOTOS_KEY = 'clipmix_photos_v1';
  let saveTimer = null;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- Cambio de sección (Video / Fotos) ----------
  function initSectionSwitch() {
    if (!document.body.dataset.section) document.body.dataset.section = 'video';
    document.querySelector('.section-switch').addEventListener('click', (e) => {
      const btn = e.target.closest('.sec-btn');
      if (!btn) return;
      const sec = btn.dataset.section;
      document.body.dataset.section = sec;
      document.querySelectorAll('.sec-btn').forEach(x => x.classList.toggle('active', x === btn));
      if (sec === 'photos') { if (window.stopPreview) try { window.stopPreview(); } catch (_) {} renderPhoto(); }
    });
  }

  // ---------- Dimensiones de la tira ----------
  function stripDims() {
    const s = SLIDE[P.format];
    return { sw: s.w, sh: s.h, W: s.w * P.slides, H: s.h };
  }

  // ---------- Cargar fotos ----------
  $('photoInput').addEventListener('change', (e) => {
    [...e.target.files].forEach(f => addPhoto(f));
    e.target.value = '';
  });

  function addPhoto(file, opts = {}) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { renderPhoto(); };
    img.src = url;
    const p = {
      id: opts.id != null ? opts.id : nextPid++, file, url, img, name: file.name,
      scale: opts.scale || 1, ox: opts.ox || 0, oy: opts.oy || 0,
    };
    if (opts.id != null) nextPid = Math.max(nextPid, opts.id + 1);
    P.photos.push(p);
    if (P.selectedId == null) P.selectedId = p.id;
    renderPhotoList();
    renderPhoto();
    if (!opts.restore) { savePhotoBlob(p); savePhotosSoon(); }
    return p;
  }

  function removePhoto(id) {
    const i = P.photos.findIndex(p => p.id === id);
    if (i < 0) return;
    URL.revokeObjectURL(P.photos[i].url);
    P.photos.splice(i, 1);
    if (P.selectedId === id) P.selectedId = P.photos[0]?.id ?? null;
    renderPhotoList();
    renderPhoto();
    delPhotoBlob(id);
    savePhotosSoon();
  }

  function movePhoto(id, dir) {
    const i = P.photos.findIndex(p => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= P.photos.length) return;
    [P.photos[i], P.photos[j]] = [P.photos[j], P.photos[i]];
    renderPhotoList();
    renderPhoto();
    savePhotosSoon();
  }

  function selectPhoto(id) {
    P.selectedId = id;
    renderPhotoList();
    syncZoom();
    renderPhoto();
  }
  function selectedIndex() { return P.photos.findIndex(p => p.id === P.selectedId); }
  function selectedPhoto() { return P.photos.find(p => p.id === P.selectedId) || null; }

  // ---------- Lista de fotos ----------
  function renderPhotoList() {
    const list = $('photoList');
    list.innerHTML = '';
    $('photoHint').style.display = P.photos.length ? 'none' : 'block';
    P.photos.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = p.id === P.selectedId ? 'selected' : '';
      const im = document.createElement('img');
      im.src = p.url;
      im.onclick = () => selectPhoto(p.id);
      const num = document.createElement('span'); num.className = 'pv-num'; num.textContent = i + 1;
      const rm = document.createElement('button'); rm.className = 'pv-rm'; rm.textContent = '✕'; rm.onclick = () => removePhoto(p.id);
      const acts = document.createElement('div'); acts.className = 'pv-actions';
      const l = document.createElement('button'); l.textContent = '◀'; l.disabled = i === 0; l.onclick = () => movePhoto(p.id, -1);
      const r = document.createElement('button'); r.textContent = '▶'; r.disabled = i === P.photos.length - 1; r.onclick = () => movePhoto(p.id, 1);
      acts.appendChild(l); acts.appendChild(r);
      li.appendChild(im); li.appendChild(num); li.appendChild(rm); li.appendChild(acts);
      list.appendChild(li);
    });
  }

  // ---------- Formato / slides ----------
  function buildPhotoFormatTiles() {
    const grid = $('photoFormatGrid');
    grid.innerHTML = '';
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
  function refreshPhotoFormat() {
    document.querySelectorAll('[data-pformat]').forEach(t => t.classList.toggle('active', t.dataset.pformat === P.format));
  }
  $('slidesMinus').onclick = () => setSlides(P.slides - 1);
  $('slidesPlus').onclick = () => setSlides(P.slides + 1);
  function setSlides(n) { P.slides = clamp(n, 2, 10); $('slidesVal').textContent = P.slides; renderPhoto(); savePhotosSoon(); }

  // ---------- Zoom de la foto seleccionada ----------
  function syncZoom() {
    const p = selectedPhoto();
    $('photoZoom').value = p ? Math.round(p.scale * 100) : 100;
    $('photoZoomVal').textContent = (p ? Math.round(p.scale * 100) : 100) + '%';
  }
  $('photoZoom').addEventListener('input', () => {
    const p = selectedPhoto(); if (!p) return;
    p.scale = parseInt($('photoZoom').value) / 100;
    $('photoZoomVal').textContent = Math.round(p.scale * 100) + '%';
    renderPhoto();
  });
  $('photoZoom').addEventListener('change', savePhotosSoon);

  // ---------- Dibujo ----------
  function drawCoverPhoto(c, img, dx, dy, dw, dh, scale, ox, oy) {
    const s = Math.max(dw / img.width, dh / img.height) * (scale || 1);
    const w = img.width * s, h = img.height * s;
    const cx = dx + dw / 2 + (ox || 0) * dw;
    const cy = dy + dh / 2 + (oy || 0) * dh;
    c.save();
    c.beginPath(); c.rect(dx, dy, dw, dh); c.clip();
    c.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    c.restore();
  }

  function drawStrip(c, W, H, guides) {
    c.fillStyle = '#111'; c.fillRect(0, 0, W, H);
    const n = P.photos.length;
    if (n) {
      const segW = W / n;
      P.photos.forEach((p, i) => {
        if (p.img && p.img.complete && p.img.naturalWidth) drawCoverPhoto(c, p.img, i * segW, 0, segW, H, p.scale, p.ox, p.oy);
        else { c.fillStyle = '#222'; c.fillRect(i * segW, 0, segW, H); }
      });
    }
    if (guides) {
      const { sw } = stripDims();
      c.strokeStyle = 'rgba(255,255,255,.92)';
      c.lineWidth = Math.max(2, W * 0.0018);
      c.setLineDash([W * 0.006, W * 0.006]);
      for (let k = 1; k < P.slides; k++) { const x = k * sw; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
      c.setLineDash([]);
      c.fillStyle = 'rgba(255,255,255,.9)';
      c.font = `bold ${Math.round(H * 0.09)}px system-ui, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      for (let k = 0; k < P.slides; k++) {
        const cx = k * sw + sw / 2;
        c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = H * 0.01;
        c.strokeText(String(k + 1), cx, H * 0.12);
        c.fillText(String(k + 1), cx, H * 0.12);
      }
      const si = selectedIndex();
      if (si >= 0 && n) {
        const segW = W / n;
        c.strokeStyle = '#34d399'; c.setLineDash([]); c.lineWidth = Math.max(3, W * 0.0025);
        c.strokeRect(si * segW + c.lineWidth, c.lineWidth, segW - c.lineWidth * 2, H - c.lineWidth * 2);
      }
    }
  }

  function renderPhoto() {
    if (document.body.dataset.section !== 'photos') return;
    const { W, H } = stripDims();
    const cv = $('photoPreview');
    cv.width = W; cv.height = H;
    drawStrip(cv.getContext('2d'), W, H, true);
    fitPhotoCanvas();
  }
  function fitPhotoCanvas() {
    const cv = $('photoPreview');
    const targetH = Math.min(340, Math.round(window.innerHeight * 0.4));
    const scale = targetH / cv.height;
    cv.style.height = targetH + 'px';
    cv.style.width = Math.round(cv.width * scale) + 'px';
  }
  window.addEventListener('resize', () => { if (document.body.dataset.section === 'photos') fitPhotoCanvas(); });

  // ---------- Gestos: arrastrar / pellizcar la foto seleccionada ----------
  const cv = $('photoPreview');
  const pts = new Map();
  let last = null, pinch = null;
  function toCanvas(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * cv.width, y: (e.clientY - r.top) / r.height * cv.height }; }
  function segAt(x) { const n = P.photos.length; if (!n) return -1; const segW = cv.width / n; return clamp(Math.floor(x / segW), 0, n - 1); }
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const p = toCanvas(e); pts.set(e.pointerId, p);
    if (pts.size === 1) {
      const i = segAt(p.x);
      if (i >= 0) selectPhoto(P.photos[i].id);
      last = p;
    } else if (pts.size === 2) {
      last = null; const a = [...pts.values()]; const ph = selectedPhoto();
      pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), scale: ph ? ph.scale : 1 };
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = toCanvas(e); pts.set(e.pointerId, p);
    const ph = selectedPhoto(); if (!ph) return;
    const n = P.photos.length; const segW = cv.width / n;
    if (pts.size === 1 && last) {
      ph.ox = clamp(ph.ox + (p.x - last.x) / segW, -2, 2);
      ph.oy = clamp(ph.oy + (p.y - last.y) / cv.height, -2, 2);
      last = p; renderPhoto();
    } else if (pts.size === 2 && pinch) {
      const a = [...pts.values()]; const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      ph.scale = clamp(pinch.scale * (d / pinch.d), 1, 4);
      syncZoom(); renderPhoto();
    }
  });
  function endPt(e) { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (pts.size === 0) { last = null; savePhotosSoon(); } }
  cv.addEventListener('pointerup', endPt);
  cv.addEventListener('pointercancel', endPt);

  // ---------- Exportar el carrusel (una imagen por slide) ----------
  $('photoExportBtn').onclick = exportCarousel;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  async function exportCarousel() {
    if (!P.photos.length) { setExportStatus('Añade al menos una foto.'); return; }
    const { sw, sh, W, H } = stripDims();
    // tira a resolución completa, sin guías
    const strip = document.createElement('canvas'); strip.width = W; strip.height = H;
    drawStrip(strip.getContext('2d'), W, H, false);
    for (let k = 0; k < P.slides; k++) {
      const c = document.createElement('canvas'); c.width = sw; c.height = sh;
      c.getContext('2d').drawImage(strip, k * sw, 0, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `carrusel-${String(k + 1).padStart(2, '0')}.jpg`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setExportStatus(`Guardando slide ${k + 1} de ${P.slides}…`);
      await sleep(400);
    }
    setExportStatus(`¡Listo! ${P.slides} imágenes descargadas. Súbelas a Instagram en orden (1, 2, 3…).`);
  }
  function setExportStatus(t) { $('photoExportStatus').textContent = t; }

  // ---------- Autoguardado / restauración ----------
  function savePhotosSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(savePhotosNow, 500); }
  function savePhotosNow() {
    const meta = {
      format: P.format, slides: P.slides, selectedId: P.selectedId,
      photos: P.photos.map(p => ({ id: p.id, name: p.name, scale: p.scale, ox: p.ox, oy: p.oy })),
    };
    try { localStorage.setItem(PHOTOS_KEY, JSON.stringify(meta)); } catch (_) {}
  }
  async function savePhotoBlob(p) { try { if (window.clipStore) await clipStore.put('photo_' + p.id, p.file); } catch (_) {} }
  async function delPhotoBlob(id) { try { if (window.clipStore) await clipStore.del('photo_' + id); } catch (_) {} }
  async function restorePhotos() {
    let meta; try { meta = JSON.parse(localStorage.getItem(PHOTOS_KEY) || 'null'); } catch (_) { meta = null; }
    if (!meta || !meta.photos || !meta.photos.length || !window.clipStore) return;
    if (SLIDE[meta.format]) P.format = meta.format;
    if (typeof meta.slides === 'number') P.slides = clamp(meta.slides, 2, 10);
    for (const pm of meta.photos) {
      let file; try { file = await clipStore.get('photo_' + pm.id); } catch (_) {}
      if (!file) continue;
      addPhoto(file, { restore: true, id: pm.id, scale: pm.scale, ox: pm.ox, oy: pm.oy });
    }
    if (meta.selectedId != null && P.photos.find(p => p.id === meta.selectedId)) P.selectedId = meta.selectedId;
  }

  // ---------- Arranque ----------
  async function initPhotos() {
    initSectionSwitch();
    buildPhotoFormatTiles();
    $('slidesVal').textContent = P.slides;
    try { await restorePhotos(); } catch (_) {}
    refreshPhotoFormat();
    $('slidesVal').textContent = P.slides;
    renderPhotoList();
    syncZoom();
    renderPhoto();
  }
  initPhotos();
})();
