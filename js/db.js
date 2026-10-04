// IndexedDB の薄いラッパー。データはこの端末のブラウザ内だけに保存される。

const DB_NAME = 'wardrobe-manager';
const DB_VERSION = 2;
export const STORES = ['items', 'outfits', 'members'];

let dbPromise;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' });
          }
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // 新しい版のアプリが別のタブで開かれたら、更新を妨げないように閉じる
        db.onversionchange = () => { db.close(); location.reload(); };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(storeNames, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    Promise.resolve(fn(tx)).then((r) => { result = r; });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function getAll(store) {
  return run(store, 'readonly', (tx) => request(tx.objectStore(store).getAll()));
}

export function put(store, value) {
  return run(store, 'readwrite', (tx) => { tx.objectStore(store).put(value); });
}

export function putMany(store, values) {
  return run(store, 'readwrite', (tx) => {
    const os = tx.objectStore(store);
    for (const v of values) os.put(v);
  });
}

export function remove(store, id) {
  return run(store, 'readwrite', (tx) => { tx.objectStore(store).delete(id); });
}

export function clearAll() {
  return run(STORES, 'readwrite', (tx) => {
    for (const name of STORES) tx.objectStore(name).clear();
  });
}
