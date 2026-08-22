/* ClipMix — Sección Fotos: moodboard / carrusel panorámico "sin costura".
 * Optimizado: proxies de imagen para editar, render solo de la ventana visible
 * y coalescido a 1 dibujo por frame. Export siempre en alta resolución.
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
  const BORDER_SWATCHES = ['#ffffff', '#000000', '#111111', '#f5f0e6', '#ffd23f', '#ff7ac2', '#5b8cff', '#34d399'];
  const PROXY_MAX = 640;

  // photo: { id, img, proxy, file, url, name, cx, cy, scale, rot, border:{on,color,width} }
  const P = { photos: [], format: '4:5', slides: 3, bg: '#111111', bg2: '#5b8cff', bgMode: 'solid', bgDir: 'h', selectedId: null, viewX: 0, exporting: false };
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
      if (btn.dataset.section === 'photos') {
        if (window.stopPreview) try { window.stopPreview(); } catch (_) {}
        placedPhotos().forEach(p => { if (p.kind === 'video' && p.video) p.video.play().catch(() => {}); });
        renderPhoto(); ensureVideoAnim();
      } else {
        P.photos.forEach(p => { if (p.kind === 'video' && p.video) p.video.pause(); });
        if (vidRaf) { cancelAnimationFrame(vidRaf); vidRaf = null; }
      }
    });
  }

  // Bucle que redibuja mientras haya videos colocados (para verlos moverse)
  let vidRaf = null;
  function anyPlacedVideo() { return placedPhotos().some(p => p.kind === 'video'); }
  function ensureVideoAnim() {
    if (vidRaf) return;
    if (document.body.dataset.section !== 'photos' || !anyPlacedVideo()) return;
    const tick = () => {
      if (document.body.dataset.section !== 'photos' || !anyPlacedVideo() || P.exporting) { vidRaf = null; return; }
      doRender();
      vidRaf = requestAnimationFrame(tick);
    };
    vidRaf = requestAnimationFrame(tick);
  }

  function boardDims() { const s = SLIDE[P.format]; return { sw: s.w, sh: s.h, W: s.w * P.slides, H: s.h }; }

  // ---------- Proxy de imagen (versión chica para editar) ----------
  function makeProxy(img) {
    const long = Math.max(img.naturalWidth, img.naturalHeight);
    if (!long || long <= PROXY_MAX) return null;
    const s = PROXY_MAX / long;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * s));
    c.height = Math.max(1, Math.round(img.naturalHeight * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  // ---------- Cargar fotos / videos ----------
  $('photoInput').addEventListener('change', (e) => {
    [...e.target.files].forEach(f => { if (f.type.startsWith('video')) addVideo(f); else addPhoto(f); });
    e.target.value = '';
  });

  function isVideoFile(name, mime) {
    if (mime && mime.startsWith('video')) return true;
    return /\.(mp4|mov|m4v|webm|avi|mkv|3gp|hevc)$/i.test(name || '');
  }
  function isImageFile(name, mime) {
    if (mime && mime.startsWith('image')) return true;
    return /\.(jpe?g|png|gif|webp|heic|heif|bmp|avif)$/i.test(name || '');
  }
  // Explorador de archivos del sistema (OneDrive/Drive/Descargas). Los archivos
  // en la nube se descargan al elegirlos, sin registrar ninguna app.
  $('photoBrowseInput').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    let skipped = 0;
    files.forEach(f => {
      if (isVideoFile(f.name, f.type)) addVideo(f);
      else if (isImageFile(f.name, f.type)) addPhoto(f);
      else skipped++;
    });
    if (skipped) setStatus(`Se ignoraron ${skipped} archivo(s) que no son foto ni video.`);
  });

  // Importar desde un enlace de OneDrive (carpeta o archivo compartido)
  function encodeShare(url) {
    const b = btoa(unescape(encodeURIComponent(url)));
    return 'u!' + b.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
  }
  async function importFromLink() {
    const raw = window.prompt('Pega el enlace de OneDrive de una CARPETA compartida (para bajar varios) o de un archivo. Puedes pegar varios enlaces, uno por línea:');
    if (!raw) return;
    const urls = raw.split(/\s+/).map(s => s.trim()).filter(u => /^https?:\/\//i.test(u));
    if (!urls.length) { setStatus('No se reconoció ningún enlace.'); return; }
    setStatus('Leyendo enlace(s) de OneDrive…');
    let added = 0, failed = 0;
    for (const u of urls) {
      let items = [];
      try {
        const id = encodeShare(u);
        try {
          const r = await fetch(`https://api.onedrive.com/v1.0/shares/${id}/root/children`);
          if (r.ok) { const j = await r.json(); items = (j.value || []).filter(it => it.file); }
        } catch (_) {}
        if (!items.length) {
          const r2 = await fetch(`https://api.onedrive.com/v1.0/shares/${id}/root`);
          if (r2.ok) { const it = await r2.json(); if (it && it.file) items = [it]; }
        }
      } catch (_) { failed++; continue; }
      if (!items.length) { failed++; continue; }
      for (const it of items) {
        const durl = it['@microsoft.graph.downloadUrl'] || it['@content.downloadUrl'];
        const name = it.name || 'onedrive';
        const mime = (it.file && it.file.mimeType) || '';
        if (!durl || !(isVideoFile(name, mime) || isImageFile(name, mime))) continue;
        try {
          setStatus(`Descargando ${name}…`);
          const rr = await fetch(durl);
          const blob = await rr.blob();
          const file = new File([blob], name, { type: blob.type || mime });
          if (isVideoFile(file.name, file.type)) addVideo(file); else addPhoto(file);
          added++;
        } catch (_) { failed++; }
      }
    }
    setStatus(added
      ? `Agregados ${added} desde OneDrive${failed ? ` (${failed} no se pudieron)` : ''}.`
      : 'No se pudo acceder. Microsoft puede bloquear el acceso directo desde el navegador; usa la app de OneDrive para descargar y luego «+ Fotos / Video».');
  }
  $('photoLink').onclick = importFromLink;

  function addVideo(file, opts = {}) {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = url; video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto';
    const { W, H } = boardDims();
    const idx = P.photos.length;
    const p = {
      id: opts.id != null ? opts.id : nextPid++, kind: 'video', file, url, video, img: null, proxy: null, poster: null, _posterImg: null, name: file.name,
      cx: opts.cx != null ? opts.cx : clamp((0.18 + idx * 0.28) * H, 0, W),
      cy: opts.cy != null ? opts.cy : H * (idx % 2 ? 0.62 : 0.42),
      scale: opts.scale || 1, rot: opts.rot || 0,
      border: opts.border ? { ...opts.border } : { on: false, color: '#ffffff', width: 0.04 },
      feather: opts.feather || 0,
      placed: opts.placed != null ? opts.placed : false,
    };
    if (opts.id != null) nextPid = Math.max(nextPid, opts.id + 1);
    video.addEventListener('loadeddata', () => {
      // poster (primer frame) para la miniatura del cajón
      try {
        const pc = document.createElement('canvas'); pc.width = 120; pc.height = 120;
        const g = pc.getContext('2d');
        const s = Math.max(120 / video.videoWidth, 120 / video.videoHeight);
        g.drawImage(video, (120 - video.videoWidth * s) / 2, (120 - video.videoHeight * s) / 2, video.videoWidth * s, video.videoHeight * s);
        p.poster = pc.toDataURL('image/jpeg', 0.7);
        const im = new Image(); im.src = p.poster; p._posterImg = im;
      } catch (_) {}
      renderPhotoList();
      if (p.placed) { video.play().catch(() => {}); ensureVideoAnim(); }
      renderPhoto();
    });
    P.photos.push(p);
    renderPhotoList(); renderPhoto();
    if (!opts.restore) { savePhotoBlob(p); commitPhoto(); savePhotosSoon(); }
    return p;
  }

  function addPhoto(file, opts = {}) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const { W, H } = boardDims();
    const idx = P.photos.length;
    const p = {
      id: opts.id != null ? opts.id : nextPid++, kind: 'photo', file, url, img, proxy: null, name: file.name,
      cx: opts.cx != null ? opts.cx : clamp((0.18 + idx * 0.28) * H, 0, W),
      cy: opts.cy != null ? opts.cy : H * (idx % 2 ? 0.62 : 0.42),
      scale: opts.scale || 1, rot: opts.rot || 0,
      border: opts.border ? { ...opts.border } : { on: false, color: '#ffffff', width: 0.04 },
      feather: opts.feather || 0,
      placed: opts.placed != null ? opts.placed : false,
    };
    img.onload = () => { p.proxy = makeProxy(img); renderPhoto(); };
    img.src = url;
    if (opts.id != null) nextPid = Math.max(nextPid, opts.id + 1);
    P.photos.push(p);
    renderPhotoList(); renderPhoto();
    if (!opts.restore) { savePhotoBlob(p); commitPhoto(); savePhotosSoon(); }
    return p;
  }
  function placedPhotos() { return P.photos.filter(p => p.placed); }

  // Suelta una foto del cajón al centro de lo que estás viendo
  function placeOnCanvas(id) {
    const p = P.photos.find(x => x.id === id); if (!p) return;
    const { W, H } = boardDims();
    const v = curView || computeView();
    const visW = v.viewW / v.scale;
    const j = (Math.random() - 0.5);
    p.cx = clamp(v.boardX + visW / 2 + j * visW * 0.18, 0, W);
    p.cy = clamp(H * (0.5 + j * 0.12), 0, H);
    p.placed = true;
    P.photos = P.photos.filter(x => x !== p); P.photos.push(p); // al frente
    P.selectedId = p.id;
    if (p.kind === 'video' && p.video) { p.video.play().catch(() => {}); ensureVideoAnim(); }
    renderPhotoList(); syncAdjust(); renderPhoto(); commitPhoto(); savePhotosSoon();
  }
  function unplacePhoto() {
    const p = selectedPhoto(); if (!p) return;
    p.placed = false;
    if (p.kind === 'video' && p.video) p.video.pause();
    P.selectedId = placedPhotos().slice(-1)[0]?.id ?? null;
    renderPhotoList(); syncAdjust(); renderPhoto(); commitPhoto(); savePhotosSoon();
  }
  $('photoUnplace').onclick = unplacePhoto;

  function clearAll() {
    if (!P.photos.length) { setStatus('El lienzo ya está vacío.'); return; }
    if (!window.confirm('¿Vaciar todo? Se quitarán todas las fotos y videos del lienzo y del cajón. Esto no se puede deshacer.')) return;
    P.photos.forEach(p => { try { if (p.kind === 'video' && p.video) p.video.pause(); } catch (_) {} URL.revokeObjectURL(p.url); delPhotoBlob(p.id); });
    if (vidRaf) { cancelAnimationFrame(vidRaf); vidRaf = null; }
    P.photos = []; P.selectedId = null; P.viewX = 0;
    $('photoPan').value = 0;
    renderPhotoList(); syncAdjust(); renderPhoto(); commitPhoto(); savePhotosNow();
    setStatus('Lienzo y cajón vacíos. ¡A empezar de nuevo!');
  }
  $('photoClearAll').onclick = clearAll;
  function removePhoto(id) {
    const i = P.photos.findIndex(p => p.id === id);
    if (i < 0) return;
    if (P.photos[i].kind === 'video' && P.photos[i].video) { try { P.photos[i].video.pause(); } catch (_) {} }
    URL.revokeObjectURL(P.photos[i].url);
    P.photos.splice(i, 1);
    if (P.selectedId === id) P.selectedId = placedPhotos().slice(-1)[0]?.id ?? null;
    renderPhotoList(); syncAdjust(); renderPhoto(); delPhotoBlob(id); commitPhoto(); savePhotosSoon();
  }
  function selectPhoto(id) { P.selectedId = id; renderPhotoList(); syncAdjust(); renderPhoto(); }
  function selectedPhoto() { const p = P.photos.find(p => p.id === P.selectedId); return (p && p.placed) ? p : null; }
  function bringFront() { const p = selectedPhoto(); if (!p) return; P.photos = P.photos.filter(x => x !== p); P.photos.push(p); renderPhotoList(); renderPhoto(); commitPhoto(); savePhotosSoon(); }
  function sendBack() { const p = selectedPhoto(); if (!p) return; P.photos = P.photos.filter(x => x !== p); P.photos.unshift(p); renderPhotoList(); renderPhoto(); commitPhoto(); savePhotosSoon(); }
  $('photoFront').onclick = bringFront;
  $('photoBack').onclick = sendBack;

  // ---------- Lista ----------
  function renderPhotoList() {
    const list = $('photoList'); list.innerHTML = '';
    const tray = P.photos.filter(p => !p.placed);
    $('photoHint').style.display = tray.length ? 'none' : 'block';
    tray.forEach((p) => {
      const li = document.createElement('li');
      const im = document.createElement('img');
      im.src = p.kind === 'video' ? (p.poster || 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==') : p.url;
      im.title = 'Agregar al lienzo'; im.onclick = () => placeOnCanvas(p.id);
      const add = document.createElement('span'); add.className = 'pv-add'; add.textContent = '＋';
      const rm = document.createElement('button'); rm.className = 'pv-rm'; rm.textContent = '✕'; rm.onclick = () => removePhoto(p.id);
      li.appendChild(im); li.appendChild(add); li.appendChild(rm);
      if (p.kind === 'video') { const badge = document.createElement('span'); badge.className = 'pv-vid'; badge.textContent = '▶'; li.appendChild(badge); }
      list.appendChild(li);
    });
  }

  // ---------- Fondo ----------
  function buildBgSwatches() {
    const w = $('photoBgSwatches'); w.innerHTML = '';
    BG_SWATCHES.forEach(col => {
      const b = document.createElement('button');
      b.className = 'swatch' + (col.toLowerCase() === P.bg.toLowerCase() ? ' active' : '');
      b.style.background = col; b.title = col; b.onclick = () => setBg(col);
      w.appendChild(b);
    });
  }
  function buildBg2Swatches() {
    const w = $('photoBg2Swatches'); if (!w) return; w.innerHTML = '';
    BG_SWATCHES.forEach(col => {
      const b = document.createElement('button');
      b.className = 'swatch' + (col.toLowerCase() === P.bg2.toLowerCase() ? ' active' : '');
      b.style.background = col; b.title = col; b.onclick = () => setBg2(col);
      w.appendChild(b);
    });
  }
  function setBg(col) { P.bg = col; $('photoBg').value = col; buildBgSwatches(); renderPhoto(); commitPhoto(); savePhotosSoon(); }
  function setBg2(col) { P.bg2 = col; $('photoBg2').value = col; buildBg2Swatches(); renderPhoto(); commitPhoto(); savePhotosSoon(); }
  $('photoBg').addEventListener('input', () => setBg($('photoBg').value));
  $('photoBg2').addEventListener('input', () => setBg2($('photoBg2').value));
  $('photoGrad').addEventListener('change', () => { P.bgMode = $('photoGrad').checked ? 'gradient' : 'solid'; syncBgUI(); renderPhoto(); commitPhoto(); savePhotosSoon(); });
  document.querySelector('.dir-row').addEventListener('click', (e) => { const btn = e.target.closest('[data-dir]'); if (!btn) return; P.bgDir = btn.dataset.dir; syncBgUI(); renderPhoto(); commitPhoto(); savePhotosSoon(); });
  function syncBgUI() {
    $('photoGrad').checked = P.bgMode === 'gradient';
    $('photoGradOpts').style.display = P.bgMode === 'gradient' ? 'block' : 'none';
    $('photoBg').value = P.bg; $('photoBg2').value = P.bg2;
    document.querySelectorAll('.dir-row [data-dir]').forEach(b => b.classList.toggle('active', b.dataset.dir === P.bgDir));
    buildBgSwatches(); buildBg2Swatches();
  }

  // ---------- Formato / slides ----------
  function buildPhotoFormatTiles() {
    const grid = $('photoFormatGrid'); grid.innerHTML = '';
    Object.entries(SLIDE).forEach(([key, def]) => {
      const tile = document.createElement('button');
      tile.className = 'opt-tile' + (key === P.format ? ' active' : '');
      tile.dataset.pformat = key;
      const ar = def.w / def.h, bw = ar >= 1 ? 30 : 30 * ar, bh = ar >= 1 ? 30 / ar : 30;
      tile.innerHTML = `<svg viewBox="0 0 34 34"><rect class="cell" x="${(34 - bw) / 2}" y="${(34 - bh) / 2}" width="${bw}" height="${bh}" rx="2"/></svg><span>${def.label}</span>`;
      tile.onclick = () => { P.format = key; refreshPhotoFormat(); renderPhoto(); commitPhoto(); savePhotosSoon(); };
      grid.appendChild(tile);
    });
  }
  function refreshPhotoFormat() { document.querySelectorAll('[data-pformat]').forEach(t => t.classList.toggle('active', t.dataset.pformat === P.format)); }
  $('slidesMinus').onclick = () => setSlides(P.slides - 1);
  $('slidesPlus').onclick = () => setSlides(P.slides + 1);
  function setSlides(n) { P.slides = clamp(n, 1, 12); $('slidesVal').textContent = P.slides; renderPhoto(); commitPhoto(); savePhotosSoon(); }

  // ---------- Ajuste de foto seleccionada (zoom/rot/marco) ----------
  function syncAdjust() {
    const p = selectedPhoto();
    $('photoAdjustGroup').style.display = p ? 'block' : 'none';
    $('photoZoom').value = p ? Math.round(p.scale * 100) : 100;
    $('photoZoomVal').textContent = (p ? Math.round(p.scale * 100) : 100) + '%';
    $('photoRot').value = p ? Math.round(p.rot) : 0;
    $('photoRotVal').textContent = (p ? Math.round(p.rot) : 0) + '°';
    $('photoFeather').value = p ? Math.round(p.feather * 100) : 0;
    $('photoFeatherVal').textContent = (p ? Math.round(p.feather * 100) : 0) + '%';
    const bd = p ? p.border : { on: false, color: '#ffffff', width: 0.04 };
    $('photoBorder').checked = bd.on;
    $('photoBorderColor').value = bd.color;
    $('photoBorderW').value = Math.round(bd.width * 100 * 2) / 2;
    $('photoBorderWVal').textContent = (Math.round(bd.width * 100 * 2) / 2) + '%';
    $('photoBorderOpts').style.display = bd.on ? 'block' : 'none';
    buildBorderSwatches();
  }
  $('photoZoom').addEventListener('input', () => { const p = selectedPhoto(); if (!p) return; p.scale = parseInt($('photoZoom').value) / 100; $('photoZoomVal').textContent = Math.round(p.scale * 100) + '%'; renderPhoto(); });
  $('photoRot').addEventListener('input', () => { const p = selectedPhoto(); if (!p) return; p.rot = parseInt($('photoRot').value); $('photoRotVal').textContent = Math.round(p.rot) + '°'; renderPhoto(); });
  $('photoFeather').addEventListener('input', () => { const p = selectedPhoto(); if (!p) return; p.feather = parseInt($('photoFeather').value) / 100; $('photoFeatherVal').textContent = parseInt($('photoFeather').value) + '%'; renderPhoto(); });
  $('photoZoom').addEventListener('change', () => { commitPhoto(); savePhotosSoon(); });
  $('photoRot').addEventListener('change', () => { commitPhoto(); savePhotosSoon(); });
  $('photoFeather').addEventListener('change', () => { commitPhoto(); savePhotosSoon(); });
  $('photoBorder').addEventListener('change', () => { const p = selectedPhoto(); if (!p) return; p.border.on = $('photoBorder').checked; $('photoBorderOpts').style.display = p.border.on ? 'block' : 'none'; renderPhoto(); commitPhoto(); savePhotosSoon(); });
  $('photoBorderColor').addEventListener('input', () => { const p = selectedPhoto(); if (!p) return; p.border.color = $('photoBorderColor').value; buildBorderSwatches(); renderPhoto(); });
  $('photoBorderColor').addEventListener('change', () => { commitPhoto(); savePhotosSoon(); });
  $('photoBorderW').addEventListener('input', () => { const p = selectedPhoto(); if (!p) return; p.border.width = parseFloat($('photoBorderW').value) / 100; $('photoBorderWVal').textContent = parseFloat($('photoBorderW').value) + '%'; renderPhoto(); });
  $('photoBorderW').addEventListener('change', () => { commitPhoto(); savePhotosSoon(); });
  function buildBorderSwatches() {
    const w = $('photoBorderSwatches'); if (!w) return; w.innerHTML = '';
    const p = selectedPhoto(); const cur = p ? p.border.color : '#ffffff';
    BORDER_SWATCHES.forEach(col => {
      const b = document.createElement('button');
      b.className = 'swatch' + (col.toLowerCase() === cur.toLowerCase() ? ' active' : '');
      b.style.background = col; b.title = col;
      b.onclick = () => { const pp = selectedPhoto(); if (!pp) return; pp.border.color = col; $('photoBorderColor').value = col; buildBorderSwatches(); renderPhoto(); savePhotosSoon(); };
      w.appendChild(b);
    });
  }

  // ---------- Dibujo ----------
  function objNatural(p) {
    if (p.kind === 'video') return { w: p.video ? p.video.videoWidth : 0, h: p.video ? p.video.videoHeight : 0 };
    return { w: p.img ? p.img.naturalWidth : 0, h: p.img ? p.img.naturalHeight : 0 };
  }
  function objSource(p, useProxy) {
    if (p.kind === 'video') return (p.video && p.video.readyState >= 2) ? p.video : (p._posterImg || null);
    return (useProxy && p.proxy) ? p.proxy : (p.img && p.img.complete && p.img.naturalWidth ? p.img : null);
  }
  function photoSize(p) {
    const { H } = boardDims();
    const nat = objNatural(p);
    if (!nat.w || !nat.h) { const d = H * 0.5 * p.scale; return { w: d, h: d }; }
    const targetLong = H * 0.6 * p.scale;
    const s = targetLong / Math.max(nat.w, nat.h);
    return { w: nat.w * s, h: nat.h * s };
  }
  // Versión con bordes desvanecidos (cacheada en fotos; recalculada en video)
  function getFeathered(p, src) {
    const isVid = src.tagName === 'VIDEO';
    const sw = isVid ? src.videoWidth : (src.width || src.naturalWidth);
    const sh = isVid ? src.videoHeight : (src.height || src.naturalHeight);
    if (!sw || !sh) return src;
    const key = `${sw}x${sh}_${p.feather.toFixed(3)}`;
    if (!isVid && p._feather && p._feather.key === key) return p._feather.c;
    const oc = document.createElement('canvas'); oc.width = sw; oc.height = sh;
    const g = oc.getContext('2d');
    g.drawImage(src, 0, 0, sw, sh);
    const f = clamp(Math.min(sw, sh) * p.feather, 1, Math.min(sw, sh) * 0.48);
    const mc = document.createElement('canvas'); mc.width = sw; mc.height = sh;
    const mg = mc.getContext('2d');
    mg.fillStyle = '#fff';
    try { mg.filter = `blur(${f * 0.6}px)`; } catch (_) {}
    mg.fillRect(f, f, sw - 2 * f, sh - 2 * f);
    mg.filter = 'none';
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(mc, 0, 0);
    g.globalCompositeOperation = 'source-over';
    if (!isVid) p._feather = { key, c: oc };
    return oc;
  }
  function drawPhotoObj(c, p, useProxy) {
    const { w, h } = photoSize(p);
    let src = objSource(p, useProxy);
    if (src && p.feather > 0) src = getFeathered(p, src);
    c.save();
    c.translate(p.cx, p.cy);
    if (p.rot) c.rotate(p.rot * Math.PI / 180);
    if (src) c.drawImage(src, -w / 2, -h / 2, w, h);
    else { c.fillStyle = '#333'; c.fillRect(-w / 2, -h / 2, w, h); }
    if (p.border && p.border.on) {
      const bw = Math.max(1, Math.min(w, h) * p.border.width);
      c.lineWidth = bw; c.strokeStyle = p.border.color;
      c.strokeRect(-w / 2 + bw / 2, -h / 2 + bw / 2, w - bw, h - bw);
    }
    c.restore();
  }
  function drawBoard(c, W, H, guides, useProxy) {
    if (P.bgMode === 'gradient') {
      const g = P.bgDir === 'v' ? c.createLinearGradient(0, 0, 0, H)
        : P.bgDir === 'd' ? c.createLinearGradient(0, 0, W, H)
          : c.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, P.bg); g.addColorStop(1, P.bg2);
      c.fillStyle = g;
    } else { c.fillStyle = P.bg; }
    c.fillRect(0, 0, W, H);
    placedPhotos().forEach(p => drawPhotoObj(c, p, useProxy));
    if (guides) {
      const { sw } = boardDims();
      c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = Math.max(2, W * 0.0016); c.setLineDash([H * 0.02, H * 0.02]);
      for (let k = 1; k < P.slides; k++) { const x = k * sw; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
      c.setLineDash([]);
      c.fillStyle = 'rgba(255,255,255,.85)'; c.strokeStyle = 'rgba(0,0,0,.5)';
      c.font = `bold ${Math.round(H * 0.08)}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = H * 0.008;
      for (let k = 0; k < P.slides; k++) { const cx = k * sw + sw / 2; c.strokeText(String(k + 1), cx, H * 0.1); c.fillText(String(k + 1), cx, H * 0.1); }
      const p = selectedPhoto();
      if (p) {
        const { w, h } = photoSize(p);
        c.save(); c.translate(p.cx, p.cy); if (p.rot) c.rotate(p.rot * Math.PI / 180);
        c.strokeStyle = '#34d399'; c.lineWidth = Math.max(3, W * 0.0022); c.strokeRect(-w / 2, -h / 2, w, h); c.restore();
      }
    }
  }

  // ---------- Vista (solo se dibuja la ventana visible) ----------
  const cv = $('photoPreview');
  let previewH = 320, curView = null, pending = false;
  function computePreviewH() { return Math.min(340, Math.round(window.innerHeight * 0.42)); }
  function computeView() {
    const { W, H } = boardDims();
    const wrapW = (cv.parentElement.clientWidth || 320);
    previewH = computePreviewH();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = previewH / H;              // px css por px de lienzo
    const dispW = W * scale;                 // ancho total del lienzo en css
    const viewW = Math.min(wrapW, dispW);     // ventana visible en css
    const maxBoardX = Math.max(0, (dispW - viewW)) / scale;
    const boardX = P.viewX * maxBoardX;
    return { W, H, wrapW, dpr, scale, dispW, viewW, maxBoardX, boardX };
  }
  function renderPhoto() { if (document.body.dataset.section !== 'photos') return; if (pending) return; pending = true; requestAnimationFrame(doRender); }
  function doRender() {
    pending = false;
    if (document.body.dataset.section !== 'photos') return;
    const v = computeView(); curView = v;
    cv.width = Math.max(1, Math.round(v.viewW * v.dpr));
    cv.height = Math.max(1, Math.round(previewH * v.dpr));
    cv.style.width = Math.round(v.viewW) + 'px';
    cv.style.height = previewH + 'px';
    const c = cv.getContext('2d');
    const k = v.scale * v.dpr;
    c.setTransform(k, 0, 0, k, -v.boardX * k, 0);
    drawBoard(c, v.W, v.H, true, true);
    c.setTransform(1, 0, 0, 1, 0, 0);
    const pan = $('photoPan'); pan.disabled = v.maxBoardX <= 1; pan.style.opacity = v.maxBoardX <= 1 ? 0.4 : 1;
  }
  $('photoPan').addEventListener('input', () => { P.viewX = parseFloat($('photoPan').value); renderPhoto(); });
  window.addEventListener('resize', () => { if (document.body.dataset.section === 'photos') renderPhoto(); });

  // ---------- Gestos ----------
  const pts = new Map();
  let last = null, pinch = null, pMoved = false;
  function toBoard(e) {
    const r = cv.getBoundingClientRect(); const v = curView || computeView();
    const kx = v.viewW / (r.width || v.viewW), ky = previewH / (r.height || previewH);
    return { x: v.boardX + (e.clientX - r.left) * kx / v.scale, y: (e.clientY - r.top) * ky / v.scale };
  }
  function hitPhoto(p, x, y) {
    const { w, h } = photoSize(p);
    const dx = x - p.cx, dy = y - p.cy, a = -p.rot * Math.PI / 180;
    const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(rx) <= w / 2 && Math.abs(ry) <= h / 2;
  }
  function topmostAt(x, y) { const ph = placedPhotos(); for (let i = ph.length - 1; i >= 0; i--) if (hitPhoto(ph[i], x, y)) return ph[i]; return null; }
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const p = toBoard(e); pts.set(e.pointerId, p);
    if (pts.size === 1) {
      const hit = topmostAt(p.x, p.y);
      if (hit) { if (hit.id !== P.selectedId) selectPhoto(hit.id); last = p; } else last = null;
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
      last = p; pMoved = true; renderPhoto();
    } else if (pts.size === 2 && pinch) {
      const a = [...pts.values()];
      const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      const ang = Math.atan2(a[1].y - a[0].y, a[1].x - a[0].x);
      ph.scale = clamp(pinch.scale * (d / pinch.d), 0.1, 6);
      ph.rot = pinch.rot + (ang - pinch.ang) * 180 / Math.PI;
      pMoved = true; syncAdjust(); renderPhoto();
    }
  });
  function endPt(e) { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (pts.size === 0) { last = null; if (pMoved) { pMoved = false; commitPhoto(); } savePhotosSoon(); } }
  cv.addEventListener('pointerup', endPt);
  cv.addEventListener('pointercancel', endPt);

  // ---------- Exportar (carrusel mixto foto/video, alta resolución) ----------
  $('photoExportBtn').onclick = exportCarousel;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  function slideRange(k) { const { sw } = boardDims(); return { x0: k * sw, x1: (k + 1) * sw }; }
  function bboxX(p) {
    const { w, h } = photoSize(p);
    const c = Math.abs(Math.cos(p.rot * Math.PI / 180)), s = Math.abs(Math.sin(p.rot * Math.PI / 180));
    const bw = w * c + h * s;
    return { x0: p.cx - bw / 2, x1: p.cx + bw / 2 };
  }
  function videosInSlide(k) {
    const { x0, x1 } = slideRange(k);
    return placedPhotos().filter(p => p.kind === 'video' && p.video && (() => { const b = bboxX(p); return b.x1 > x0 && b.x0 < x1; })());
  }
  function downloadNamed(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function encodeSlideVideo(k) {
    const { sw, sh, W, H } = boardDims();
    const fps = 30;
    const allV = placedPhotos().filter(p => p.kind === 'video' && p.video);
    const inSlide = videosInSlide(k);
    let dur = Math.max(1, ...inSlide.map(p => isFinite(p.video.duration) ? p.video.duration : 0));
    dur = Math.min(dur, 10);
    allV.forEach(p => { try { p.video.loop = true; p.video.currentTime = 0; } catch (_) {} });
    await Promise.all(allV.map(p => p.video.play().catch(() => {})));
    const slide = document.createElement('canvas'); slide.width = sw; slide.height = sh;
    const sc = slide.getContext('2d');
    const drawSlide = () => { sc.save(); sc.setTransform(1, 0, 0, 1, -k * sw, 0); drawBoard(sc, W, H, false, false); sc.restore(); };

    if (typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && window.Mp4Muxer) {
      const cands = [['avc1.42001f', 'avc'], ['avc1.4d0028', 'avc'], ['vp09.00.10.08', 'vp9'], ['av01.0.04M.08', 'av1']];
      let vcfg = null;
      for (const [codec, mux] of cands) { try { if ((await VideoEncoder.isConfigSupported({ codec, width: sw, height: sh, bitrate: 8e6, framerate: fps })).supported) { vcfg = { codec, mux }; break; } } catch (_) {} }
      if (vcfg) {
        const { Muxer, ArrayBufferTarget } = window.Mp4Muxer;
        const target = new ArrayBufferTarget();
        const muxer = new Muxer({ target, video: { codec: vcfg.mux, width: sw, height: sh, frameRate: fps }, fastStart: 'in-memory' });
        let err = null; const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => err = e });
        venc.configure({ codec: vcfg.codec, width: sw, height: sh, bitrate: 8e6, framerate: fps });
        const total = Math.round(dur * fps);
        const start = performance.now(); let lastIdx = -1;
        await new Promise(resolve => {
          const loop = async () => {
            const t = (performance.now() - start) / 1000;
            const idx = Math.min(total - 1, Math.floor(t * fps));
            if (idx > lastIdx) {
              lastIdx = idx; drawSlide();
              let g = 0; while (venc.encodeQueueSize > 6 && g++ < 500) await new Promise(r => setTimeout(r, 4));
              const fr = new VideoFrame(slide, { timestamp: Math.round(idx * 1e6 / fps), duration: Math.round(1e6 / fps) });
              try { venc.encode(fr, { keyFrame: idx % 60 === 0 }); } catch (_) {}
              fr.close();
              setStatus(`Slide ${k + 1}/${P.slides}: video ${Math.round(t)}s/${Math.round(dur)}s`);
            }
            if (t >= dur) { resolve(); return; }
            requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        });
        await venc.flush(); muxer.finalize(); if (err) throw err;
        return new Blob([target.buffer], { type: 'video/mp4' });
      }
    }
    // Fallback: MediaRecorder
    const stream = slide.captureStream(fps);
    const mime = ['video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp9', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
    const chunks = []; rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise(r => rec.onstop = r);
    const t0 = performance.now(); rec.start(100);
    await new Promise(resolve => { const loop = () => { drawSlide(); if ((performance.now() - t0) / 1000 >= dur) { resolve(); return; } requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
    rec.stop(); await stopped;
    let blob = new Blob(chunks, { type: (mime.split(';')[0]) || 'video/webm' });
    if (blob.type.includes('webm') && window.fixWebmDuration) { try { blob = await window.fixWebmDuration(blob, dur * 1000); } catch (_) {} }
    return blob;
  }

  async function exportCarousel() {
    if (!placedPhotos().length) { setStatus('Coloca al menos una foto o video en el lienzo.'); return; }
    P.exporting = true; if (vidRaf) { cancelAnimationFrame(vidRaf); vidRaf = null; }
    const { sw, sh, W, H } = boardDims();
    try {
      for (let k = 0; k < P.slides; k++) {
        if (videosInSlide(k).length) {
          setStatus(`Slide ${k + 1}/${P.slides}: procesando video…`);
          const blob = await encodeSlideVideo(k);
          if (blob) { const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'; downloadNamed(blob, `carrusel-${String(k + 1).padStart(2, '0')}.${ext}`); }
        } else {
          const c2 = document.createElement('canvas'); c2.width = sw; c2.height = sh;
          const cc = c2.getContext('2d'); cc.save(); cc.setTransform(1, 0, 0, 1, -k * sw, 0); drawBoard(cc, W, H, false, false); cc.restore();
          const blob = await new Promise(res => c2.toBlob(res, 'image/jpeg', 0.92));
          downloadNamed(blob, `carrusel-${String(k + 1).padStart(2, '0')}.jpg`);
          setStatus(`Guardando slide ${k + 1} de ${P.slides}…`);
        }
        await sleep(450);
      }
      setStatus(`¡Listo! ${P.slides} archivos. Súbelos al carrusel de IG en orden (1, 2, 3…).`);
    } catch (e) { console.error(e); setStatus('Hubo un problema al exportar. Prueba de nuevo o baja el número de slides.'); }
    P.exporting = false;
    placedPhotos().forEach(p => { if (p.kind === 'video' && p.video) p.video.play().catch(() => {}); });
    ensureVideoAnim();
  }
  function setStatus(t) { $('photoExportStatus').textContent = t; }

  // ---------- Autoguardado / restauración ----------
  function savePhotosSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(savePhotosNow, 500); }
  function savePhotosNow() {
    const meta = {
      format: P.format, slides: P.slides, bg: P.bg, bg2: P.bg2, bgMode: P.bgMode, bgDir: P.bgDir, selectedId: P.selectedId,
      photos: P.photos.map(p => ({ id: p.id, kind: p.kind, name: p.name, cx: p.cx, cy: p.cy, scale: p.scale, rot: p.rot, feather: p.feather, placed: p.placed, border: { ...p.border } })),
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
    if (meta.bg2) P.bg2 = meta.bg2;
    if (meta.bgMode) P.bgMode = meta.bgMode;
    if (meta.bgDir) P.bgDir = meta.bgDir;
    for (const pm of meta.photos) {
      let file; try { file = await clipStore.get('photo_' + pm.id); } catch (_) {}
      if (!file) continue;
      const o = { restore: true, id: pm.id, cx: pm.cx, cy: pm.cy, scale: pm.scale, rot: pm.rot, feather: pm.feather, border: pm.border, placed: pm.placed != null ? pm.placed : true };
      if (pm.kind === 'video' || (file.type && file.type.startsWith('video'))) addVideo(file, o); else addPhoto(file, o);
    }
    if (meta.selectedId != null && P.photos.find(p => p.id === meta.selectedId)) P.selectedId = meta.selectedId;
  }

  // ---------- Historial: deshacer / rehacer ----------
  let pHist = [], pIdx = -1; const PHIST_MAX = 60;
  function photoSnap() {
    return {
      order: P.photos.map(p => p.id),
      props: P.photos.map(p => ({ id: p.id, cx: p.cx, cy: p.cy, scale: p.scale, rot: p.rot, feather: p.feather, placed: p.placed, border: { ...p.border } })),
      bg: P.bg, bg2: P.bg2, bgMode: P.bgMode, bgDir: P.bgDir, format: P.format, slides: P.slides, selectedId: P.selectedId,
    };
  }
  function commitPhoto() {
    const s = photoSnap(), j = JSON.stringify(s);
    if (pIdx >= 0 && JSON.stringify(pHist[pIdx]) === j) return;
    pHist = pHist.slice(0, pIdx + 1); pHist.push(s);
    if (pHist.length > PHIST_MAX) pHist.shift();
    pIdx = pHist.length - 1; updatePhotoUndo();
  }
  function applyPhotoSnap(s) {
    const byId = new Map(P.photos.map(p => [p.id, p]));
    const arr = []; s.order.forEach(id => { const p = byId.get(id); if (p) arr.push(p); });
    P.photos.forEach(p => { if (!s.order.includes(p.id)) arr.push(p); });
    P.photos = arr;
    s.props.forEach(pr => { const p = byId.get(pr.id); if (p) { p.cx = pr.cx; p.cy = pr.cy; p.scale = pr.scale; p.rot = pr.rot; p.feather = pr.feather || 0; p.placed = pr.placed; p.border = { ...pr.border }; } });
    P.bg = s.bg; if (s.bg2) P.bg2 = s.bg2; if (s.bgMode) P.bgMode = s.bgMode; if (s.bgDir) P.bgDir = s.bgDir;
    if (SLIDE[s.format]) P.format = s.format; P.slides = clamp(s.slides, 1, 12);
    P.selectedId = (byId.get(s.selectedId) && byId.get(s.selectedId).placed) ? s.selectedId : (placedPhotos().slice(-1)[0]?.id ?? null);
    refreshPhotoFormat(); $('slidesVal').textContent = P.slides; syncBgUI();
    renderPhotoList(); syncAdjust(); renderPhoto(); savePhotosSoon(); updatePhotoUndo();
  }
  function undoPhoto() { if (pIdx <= 0) return; pIdx--; applyPhotoSnap(pHist[pIdx]); }
  function redoPhoto() { if (pIdx >= pHist.length - 1) return; pIdx++; applyPhotoSnap(pHist[pIdx]); }
  function updatePhotoUndo() { $('photoUndo').disabled = pIdx <= 0; $('photoRedo').disabled = pIdx >= pHist.length - 1; }
  $('photoUndo').onclick = undoPhoto;
  $('photoRedo').onclick = redoPhoto;
  window.addEventListener('keydown', (e) => {
    if (document.body.dataset.section !== 'photos') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redoPhoto() : undoPhoto(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redoPhoto(); }
  });

  // ---------- Arranque ----------
  async function initPhotos() {
    initSectionSwitch();
    buildBgSwatches();
    buildPhotoFormatTiles();
    $('slidesVal').textContent = P.slides;
    try { await restorePhotos(); } catch (_) {}
    syncBgUI();
    refreshPhotoFormat();
    $('slidesVal').textContent = P.slides;
    renderPhotoList();
    syncAdjust();
    renderPhoto();
    placedPhotos().forEach(p => { if (p.kind === 'video' && p.video) p.video.play().catch(() => {}); });
    ensureVideoAnim();
    commitPhoto();
    updatePhotoUndo();
  }
  initPhotos();
  window.__photoBoard = P;
})();
