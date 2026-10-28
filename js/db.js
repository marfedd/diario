// Almacenamiento local (IndexedDB). Todo lo que se guarda aquí ya va cifrado,
// salvo metadatos de sincronización (nombres aleatorios, ids de Drive, banderas).
//   meta    clave → valor (cabecera del diario, passkey, estado de Drive)
//   entries { name: 'e_<id>', data, dirty, rev, remoteId, md5 }
//   files   { name: 'p_<id>' | 't_<id>', dirty, deleted, remoteId }  (sin datos)
//   blobs   name → ArrayBuffer cifrado de la foto

const DB_NAME = 'diario';
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('meta');
        d.createObjectStore('entries', { keyPath: 'name' });
        d.createObjectStore('files', { keyPath: 'name' });
        d.createObjectStore('blobs');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}

const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

const done = (t) => new Promise((resolve, reject) => {
  t.oncomplete = () => resolve();
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error);
});

async function store(name, mode = 'readonly') {
  return (await db()).transaction(name, mode).objectStore(name);
}

export const meta = {
  get: async (k) => req((await store('meta')).get(k)),
  set: async (k, v) => req((await store('meta', 'readwrite')).put(v, k)),
  del: async (k) => req((await store('meta', 'readwrite')).delete(k)),
};

export const entries = {
  get: async (k) => req((await store('entries')).get(k)),
  all: async () => req((await store('entries')).getAll()),
  put: async (rec) => req((await store('entries', 'readwrite')).put(rec)),
};

export const files = {
  get: async (k) => req((await store('files')).get(k)),
  all: async () => req((await store('files')).getAll()),
  data: async (k) => req((await store('blobs')).get(k)),
  putMeta: async (rec) => req((await store('files', 'readwrite')).put(rec)),
  async put(rec, data) {
    const t = (await db()).transaction(['files', 'blobs'], 'readwrite');
    t.objectStore('files').put(rec);
    if (data) t.objectStore('blobs').put(data, rec.name);
    else t.objectStore('blobs').delete(rec.name);
    return done(t);
  },
  async del(k) {
    const t = (await db()).transaction(['files', 'blobs'], 'readwrite');
    t.objectStore('files').delete(k);
    t.objectStore('blobs').delete(k);
    return done(t);
  },
};

export async function wipe() {
  (await db()).close();
  dbp = null;
  await req(indexedDB.deleteDatabase(DB_NAME));
}
