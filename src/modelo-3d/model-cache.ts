/* ──────────────────────────────────────────────────────────────────────
   model-cache.ts — Modelos ya convertidos (.frag) guardados en el navegador

   Convertir un IFC grande lleva minutos; abrir su .frag, segundos. Tras la
   primera conversión el .frag se guarda en IndexedDB, y la siguiente vez que
   se abre el MISMO archivo (en este navegador) no se vuelve a convertir.

   La clave identifica el archivo y la versión del formato:
     · archivo local   nombre + tamaño + fecha de modificación
     · repositorio     id_en_repositorio + nombre
   Si se actualiza @thatopen/fragments, las entradas viejas no se usan.

   Dos almacenes: 'fragments' (los datos, decenas de MB) y 'meta' (cuándo se
   usó cada uno). Así marcar un uso o elegir qué borrar no lee ni reescribe
   los modelos. Se guardan los MAX_ENTRIES más recientes. Sin IndexedDB
   (modo privado, almacenamiento bloqueado) el visor funciona igual, sin caché.
   ────────────────────────────────────────────────────────────────────── */

const DB_NAME = 'saf-visor-modelos';
const DATA = 'fragments';
const META = 'meta';
const MAX_ENTRIES = 5;

interface Meta { key: string; name: string; usedAt: number }

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore(DATA);
        db.createObjectStore(META, { keyPath: 'key' }).createIndex('usedAt', 'usedAt');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

/** Ejecuta `work` en una transacción y espera a que se confirme. */
async function transaction<T>(mode: IDBTransactionMode, work: (tx: IDBTransaction) => T): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction([DATA, META], mode);
    let result: T;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    result = work(tx);
  });
}

const versioned = (key: string) => `${__FRAGMENTS_VERSION__}|${key}`;

export const cacheKey = {
  file: (file: File) => `archivo|${file.name}|${file.size}|${file.lastModified}`,
  repo: (repoId: unknown, name?: string | null) => `repo|${repoId}|${name || ''}`,
};

/** El .frag guardado para esta clave, o null. */
export async function getCached(key: string): Promise<Uint8Array | null> {
  const k = versioned(key);
  try {
    let frag: Uint8Array | null = null;
    await transaction('readwrite', tx => {
      const request = tx.objectStore(DATA).get(k);
      request.onsuccess = () => {
        frag = request.result ?? null;
        if (frag) {
          const meta = tx.objectStore(META);
          const current = meta.get(k);
          current.onsuccess = () => meta.put({ ...(current.result || { key: k, name: '' }), usedAt: Date.now() });
        }
      };
    });
    return frag;
  } catch (e) {
    return null;
  }
}

/** Guarda el .frag y descarta los más viejos. Un fallo (cuota llena…) no interrumpe nada. */
export async function putCached(key: string, name: string, frag: Uint8Array): Promise<void> {
  const k = versioned(key);
  try {
    await transaction('readwrite', tx => {
      tx.objectStore(DATA).put(frag, k);
      tx.objectStore(META).put({ key: k, name, usedAt: Date.now() } as Meta);
    });
    await transaction('readwrite', tx => {
      const meta = tx.objectStore(META);
      const count = meta.count();
      count.onsuccess = () => {
        let excess = count.result - MAX_ENTRIES;
        if (excess <= 0) return;
        // Del más viejo al más nuevo, sólo claves (no se leen los modelos)
        meta.index('usedAt').openKeyCursor().onsuccess = event => {
          const cursor = (event.target as IDBRequest<IDBCursor | null>).result;
          if (!cursor || excess-- <= 0) return;
          tx.objectStore(DATA).delete(cursor.primaryKey);
          meta.delete(cursor.primaryKey);
          cursor.continue();
        };
      };
    });
  } catch (e) {
    console.warn('No se pudo guardar el modelo en la caché del navegador:', e);
  }
}
