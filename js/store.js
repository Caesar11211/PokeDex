// store.js — keeps your collection in this browser's built-in database (IndexedDB).
// Nothing is sent anywhere: it lives on this phone, works offline, and survives app updates.
// Four "tables":
//   entries  — one record per collected Pokémon, keyed by Dex number
//   wish     — wishlist items, keyed by Dex number
//   photos   — your cropped card photos, keyed by Dex number
//   meta     — small settings (e.g. last price update)

const DB_NAME = "living-dex";
const DB_VERSION = 1;
const TABLES = ["entries", "wish", "photos", "meta"];

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const t of TABLES) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

// Runs one read or write against a table and resolves when the browser confirms it.
async function run(table, mode, work) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(table, mode);
    const req = work(tx.objectStore(table));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const store = {
  /** Every record in a table, as a Map of key -> value. */
  async all(table) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const out = new Map();
      const cursor = db.transaction(table).objectStore(table).openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) { out.set(c.key, c.value); c.continue(); } else resolve(out);
      };
      cursor.onerror = () => reject(cursor.error);
    });
  },
  get: (table, key) => run(table, "readonly", s => s.get(key)),
  put: (table, key, value) => run(table, "readwrite", s => s.put(value, key)),
  remove: (table, key) => run(table, "readwrite", s => s.delete(key)),
  clear: table => run(table, "readwrite", s => s.clear()),
};

/** Ask the browser not to clear our data when the phone is low on space. */
export async function askToKeepData() {
  try {
    if (navigator.storage?.persisted && await navigator.storage.persisted()) return true;
    return navigator.storage?.persist ? await navigator.storage.persist() : false;
  } catch { return false; }
}
