/**
 * Sounds you supply yourself.
 *
 * The synthesised set can be a drum, a horn, a bell — anything that is physics.
 * It cannot be a voice singing "tralalero tralala", and it must not be a pop
 * song: those are recordings somebody made and owns, and putting six of them in
 * a public repository is not a thing this app is going to do.
 *
 * So it does the other thing. You point at a file on your own phone and it
 * plays that instead. The file never leaves the device — it is not uploaded,
 * not committed, and not in the build; it lives in this browser's own storage
 * and nobody but you ever hears it. That is also the only arrangement in which
 * you can use whatever clip you actually want.
 *
 * IndexedDB rather than localStorage: a handful of clips is comfortably past
 * the 5 MB that localStorage allows, and base64 would add a third again on top.
 */

const DB = 'fc.sfx';
const STORE = 'clips';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(db => new Promise<T>((resolve, reject) => {
    const r = run(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

/** Biggest clip we will take. A draft-room sound is a second or two; anything
 *  past this is a song somebody meant to play, not a sound effect, and it would
 *  still be playing when the next pick lands. */
export const MAX_CLIP = 1_000_000;

export const putClip = (key: string, blob: Blob): Promise<unknown> =>
  tx('readwrite', s => s.put(blob, key));

export const dropClip = (key: string): Promise<unknown> =>
  tx('readwrite', s => s.delete(key));

export const readClips = (): Promise<Record<string, Blob>> =>
  Promise.all([
    tx<IDBValidKey[]>('readonly', s => s.getAllKeys()),
    tx<Blob[]>('readonly', s => s.getAll()),
  ]).then(([keys, vals]) => {
    const out: Record<string, Blob> = {};
    keys.forEach((k, i) => { if (vals[i]) out[String(k)] = vals[i]; });
    return out;
  }).catch(() => ({}));
