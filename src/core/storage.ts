/** Persistent key/value storage: IndexedDB with localStorage fallback, plus JSON export/import. */
const DB_NAME = 'football-simulator';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

function lsGet(key: string): string | null { try { return localStorage.getItem('fs:' + key); } catch { return null; } }
function lsSet(key: string, v: string): void { try { localStorage.setItem('fs:' + key, v); } catch { /* quota/private mode */ } }
function lsDel(key: string): void { try { localStorage.removeItem('fs:' + key); } catch { /* ignore */ } }

export const storage = {
  async get<T>(key: string): Promise<T | undefined> {
    const db = await openDb();
    if (db) {
      try {
        const v = await new Promise<unknown>((res, rej) => {
          const r = db.transaction(STORE).objectStore(STORE).get(key);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        if (v !== undefined) return v as T;
      } catch { /* fall through */ }
    }
    const s = lsGet(key);
    if (s == null) return undefined;
    try { return JSON.parse(s) as T; } catch { return undefined; }
  },

  async set(key: string, value: unknown): Promise<void> {
    const db = await openDb();
    if (db) {
      try {
        await new Promise<void>((res, rej) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(value, key);
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        });
        return;
      } catch { /* fall through */ }
    }
    lsSet(key, JSON.stringify(value));
  },

  async del(key: string): Promise<void> {
    const db = await openDb();
    if (db) {
      try {
        await new Promise<void>((res, rej) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(key);
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        });
      } catch { /* ignore */ }
    }
    lsDel(key);
  },

  async keys(): Promise<string[]> {
    const db = await openDb();
    if (db) {
      try {
        return await new Promise<string[]>((res, rej) => {
          const r = db.transaction(STORE).objectStore(STORE).getAllKeys();
          r.onsuccess = () => res(r.result as string[]);
          r.onerror = () => rej(r.error);
        });
      } catch { /* fall through */ }
    }
    const out: string[] = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('fs:')) out.push(k.slice(3)); } } catch { /* ignore */ }
    return out;
  },
};

export const SAVE_FORMAT = 'football-simulator-save';

export interface SaveEnvelope<T = unknown> { format: typeof SAVE_FORMAT; version: number; savedAt: string; data: T }

export function wrapSave<T>(data: T, version = 1): SaveEnvelope<T> {
  return { format: SAVE_FORMAT, version, savedAt: new Date().toISOString(), data };
}

export function parseSave(text: string): SaveEnvelope {
  const obj = JSON.parse(text) as Partial<SaveEnvelope>;
  if (obj?.format !== SAVE_FORMAT || typeof obj.version !== 'number' || obj.data === undefined) {
    throw new Error('Not a Football Simulator save file');
  }
  return obj as SaveEnvelope;
}

export function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function pickJsonFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return reject(new Error('No file selected'));
      f.text().then(resolve, reject);
    };
    input.click();
  });
}
