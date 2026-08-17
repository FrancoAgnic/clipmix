/* Almacén simple sobre IndexedDB para guardar los archivos de video del proyecto,
 * de modo que al refrescar la página no se pierda la edición. */
(function () {
  const DB = 'clipmix-db';
  const STORE = 'files';
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function put(key, val) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(val, key);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }
  async function get(key) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, 'readonly');
      const rq = t.objectStore(STORE).get(key);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  async function del(key) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).delete(key);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }
  async function keys() {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, 'readonly');
      const rq = t.objectStore(STORE).getAllKeys();
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => rej(rq.error);
    });
  }

  window.clipStore = { put, get, del, keys };
})();
