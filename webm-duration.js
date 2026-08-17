/* Reparador de duración para archivos WebM de MediaRecorder.
 * MediaRecorder no escribe la duración en la cabecera (graba "en vivo"), así que
 * muchos reproductores (Instagram, etc.) solo muestran unos segundos. Aquí
 * inyectamos el elemento Duration (EBML) dentro de Segment > Info.
 *
 * Uso:  const arreglado = await fixWebmDuration(blob, duracionEnMs);
 */
(function () {
  function vintLen(firstByte) {
    let mask = 0x80, len = 1;
    while (len <= 8) { if (firstByte & mask) return len; mask >>= 1; len++; }
    return 8;
  }
  function readId(buf, p) {
    const len = vintLen(buf[p]);
    let id = 0;
    for (let i = 0; i < len; i++) id = id * 256 + buf[p + i];
    return { id, length: len };
  }
  function readVint(buf, p) {
    const len = vintLen(buf[p]);
    let value = buf[p] & (0xff >> len);
    let allOnes = value === (0xff >> len);
    for (let i = 1; i < len; i++) { value = value * 256 + buf[p + i]; if (buf[p + i] !== 0xff) allOnes = false; }
    return { value, length: len, unknown: allOnes };
  }
  function writeVint(value, len) {
    const out = new Uint8Array(len);
    let v = value;
    for (let i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
    out[0] |= (0x80 >> (len - 1));
    return out;
  }
  function minVintLen(value) {
    let len = 1;
    while (len < 8 && value > Math.pow(2, 7 * len) - 2) len++;
    return len;
  }
  function concat(arrs) {
    const total = arrs.reduce((a, x) => a + x.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }

  const ID_SEGMENT = 0x18538067;
  const ID_INFO = 0x1549a966;
  const ID_TIMECODESCALE = 0x2ad7b1;
  const ID_DURATION = 0x4489;

  async function fixWebmDuration(blob, durationMs) {
    try {
      if (!blob || !durationMs || !isFinite(durationMs) || durationMs <= 0) return blob;
      const buf = new Uint8Array(await blob.arrayBuffer());

      // 1) localizar Segment (asumimos tamaño desconocido, como hace MediaRecorder)
      let p = 0, segDataStart = -1, segUnknown = false;
      while (p < buf.length) {
        const { id, length: idLen } = readId(buf, p);
        const sz = readVint(buf, p + idLen);
        const dataStart = p + idLen + sz.length;
        if (id === ID_SEGMENT) { segDataStart = dataStart; segUnknown = sz.unknown; break; }
        if (sz.unknown) break;
        p = dataStart + sz.value;
      }
      if (segDataStart < 0 || !segUnknown) return blob; // solo el caso típico de MediaRecorder

      // 2) localizar Info dentro de Segment
      p = segDataStart;
      let infoDataStart = -1, infoSizeLen = 0, infoSize = 0;
      while (p < buf.length) {
        const { id, length: idLen } = readId(buf, p);
        const sz = readVint(buf, p + idLen);
        const dataStart = p + idLen + sz.length;
        if (id === ID_INFO) { infoDataStart = dataStart; infoSizeLen = sz.length; infoSize = sz.value; break; }
        if (sz.unknown) break;
        p = dataStart + sz.value;
      }
      if (infoDataStart < 0 || !infoSize) return blob;

      // 3) leer TimecodeScale y ver si ya existe Duration
      let timecodeScale = 1000000, hasDuration = false;
      let q = infoDataStart; const infoEnd = infoDataStart + infoSize;
      while (q < infoEnd) {
        const { id, length: idLen } = readId(buf, q);
        const sz = readVint(buf, q + idLen);
        const dataStart = q + idLen + sz.length;
        if (id === ID_TIMECODESCALE) { let v = 0; for (let i = 0; i < sz.value; i++) v = v * 256 + buf[dataStart + i]; timecodeScale = v || 1000000; }
        if (id === ID_DURATION) hasDuration = true;
        q = dataStart + sz.value;
      }
      if (hasDuration) return blob; // ya tiene duración; no tocamos

      // 4) construir el elemento Duration (float de 8 bytes) en unidades de TimecodeScale
      const durationValue = (durationMs * 1e6) / timecodeScale;
      const dv = new DataView(new ArrayBuffer(8));
      dv.setFloat64(0, durationValue);
      const durEl = concat([new Uint8Array([0x44, 0x89]), writeVint(8, 1), new Uint8Array(dv.buffer)]);

      // 5) recomponer: Info ID + (nuevo tamaño) + Duration + resto de Info + resto del archivo
      const newInfoSize = infoSize + durEl.length;
      let newInfoSizeLen = infoSizeLen;
      if (newInfoSize > Math.pow(2, 7 * infoSizeLen) - 2) newInfoSizeLen = minVintLen(newInfoSize);
      const newInfoSizeBytes = writeVint(newInfoSize, newInfoSizeLen);

      const before = buf.slice(0, infoDataStart - infoSizeLen); // hasta el ID de Info inclusive
      const after = buf.slice(infoDataStart);                   // datos de Info + resto (Segment es de tamaño desconocido)
      const out = concat([before, newInfoSizeBytes, durEl, after]);
      return new Blob([out], { type: blob.type || 'video/webm' });
    } catch (_) {
      return blob; // ante cualquier duda, devolvemos el original sin romper nada
    }
  }

  window.fixWebmDuration = fixWebmDuration;
})();
