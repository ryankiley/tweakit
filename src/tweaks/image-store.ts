// ── Persisted images. An upload's data URL can outgrow localStorage (~5 MB an origin), so a panel with `persist`
// keeps each one in IndexedDB and saves a short ref in its place: `tw-image:<hash>`. Records are keyed
// [storage key, hash], so one panel's images read as a range. Loaded only by a panel that persists
// an image control. Every call settles, never rejects: IndexedDB off or refused reads as null. ──

const REF = "tw-image:";
type Store = IDBObjectStore;
let db: Promise<IDBDatabase | null> | null = null;
const open = () => db ||= new Promise<IDBDatabase | null>((done) => {
  try {
    const r = indexedDB.open("tweakit", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("images");
    r.onsuccess = () => done(r.result); r.onerror = () => done(null);
  } catch { done(null); } // no indexedDB at all
});
// One transaction; resolves with what `fn` returns once it commits, null if it fails.
const run = <T>(mode: IDBTransactionMode, fn: (s: Store) => T) => open().then((d) => d && new Promise<T | null>((done) => {
  try { const t = d.transaction("images", mode), out = fn(t.objectStore("images")); t.oncomplete = () => done(out); t.onerror = t.onabort = () => done(null); }
  catch { done(null); }
}));
const range = (key: string) => IDBKeyRange.bound([key], [key, []]); // an array sorts after every string, so [key, []] caps the range

// cyrb53: a 53-bit string hash, plenty to tell one panel's few images apart.
const hash = (s: string) => {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + s.length.toString(36);
};

const isRef = (v: unknown): v is string => typeof v === "string" && v.startsWith(REF);
const refFor = (dataUrl: string) => REF + hash(dataUrl);

/** Every image stored under `key`, ref → data URL; null when IndexedDB can't be used. */
const load = (key: string) => run("readonly", (s) => {
  const out = new Map<string, string>();
  s.openCursor(range(key)).onsuccess = function () { const c = this.result; if (!c) return; if (typeof c.value === "string") out.set(REF + (c.key as string[])[1], c.value); c.continue(); };
  return out;
});
const put = (key: string, ref: string, dataUrl: string) => run("readwrite", (s) => { s.put(dataUrl, [key, ref.slice(REF.length)]); return true; });
/** Delete the images under `key` that `refs` name. */
const prune = (key: string, refs: string[]) => run("readwrite", (s) => { for (const r of refs) s.delete([key, r.slice(REF.length)]); return true; });

export { isRef, refFor, load, put, prune };
