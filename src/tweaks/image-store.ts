// ── Persisted images. An upload's data URL can outgrow localStorage (~5 MB an origin), so a panel with `persist`
// keeps each one in IndexedDB and saves a short ref in its place: `tw-image:<hash>`. Records are keyed
// [storage key, hash], so one panel's images read as a range. Loaded only by a panel that persists
// an image control. Every call settles, never rejects: IndexedDB off or refused reads as null. ──

const REF = "tw-image:";
type Store = IDBObjectStore;
let db: Promise<IDBDatabase | null> | null = null;
// An open that never settles (another tab's pending delete or upgrade) reads as unavailable after 3s rather than holding
// panel.ready forever. The connection closes for another tab's upgrade or delete, and one the browser drops is reopened.
const open = () => db ||= new Promise<IDBDatabase | null>((done) => {
  let late = false;
  const t = setTimeout(() => { late = true; db = null; done(null); }, 3000);
  try {
    const r = indexedDB.open("tweakit", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("images");
    r.onsuccess = () => {
      const d = r.result; clearTimeout(t);
      if (late) { d.close(); return; }
      d.onversionchange = () => { d.close(); db = null; }; d.onclose = () => { db = null; };
      done(d);
    };
    r.onerror = () => { clearTimeout(t); db = null; done(null); };
  } catch { clearTimeout(t); done(null); } // no indexedDB at all
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

const refFor = (dataUrl: string) => REF + hash(dataUrl);

/** Every image stored under `key`, ref → data URL; null when IndexedDB can't be used. */
const load = (key: string) => run("readonly", (s) => {
  const out = new Map<string, string>();
  s.openCursor(range(key)).onsuccess = function () { const c = this.result; if (!c) return; if (typeof c.value === "string") out.set(REF + (c.key as string[])[1], c.value); c.continue(); };
  return out;
});
/** One image by its ref (a preset another tab saved after this panel loaded); null when it isn't there. */
const get = (key: string, ref: string) => run("readonly", (s) => { const r = s.get([key, ref.slice(REF.length)]); return r; }).then((r) => (r && typeof r.result === "string" ? r.result : null));
const put = (key: string, ref: string, dataUrl: string) => run("readwrite", (s) => { s.put(dataUrl, [key, ref.slice(REF.length)]); return true; });
/** Delete the images under `key` that `refs` name. */
const prune = (key: string, refs: string[]) => run("readwrite", (s) => { for (const r of refs) s.delete([key, r.slice(REF.length)]); return true; });

/** Each ref a stored snapshot or preset names, read from its JSON whatever the schema: a renamed field's preset still counts. */
const refsIn = (v: unknown) => new Set<string>(JSON.stringify(v ?? null).match(/tw-image:[0-9a-z]+/g) || []);
/** Delete the records under `key` this panel knows (`known`) that nothing in `named` names any more. */
const pruneUnnamed = (key: string, known: Map<string, string>, named: unknown[]) => {
  const keep = refsIn(named), gone = [...known.keys()].filter((r) => !keep.has(r));
  for (const r of gone) known.delete(r);
  if (gone.length) prune(key, gone);
};
/** `presets` with `ref` swapped for `with` everywhere it appears, or null when nothing names it. */
const swapRef = (presets: unknown, ref: string, withText: string) => {
  const text = JSON.stringify(presets);
  return text.includes(ref) ? JSON.parse(text.split(ref).join(JSON.stringify(withText).slice(1, -1))) : null;
};

/** The store bound to one panel: `known` holds the records it has loaded or written (ref → data URL), `refused` runs when
 *  a write fails with its ref (the panel saves again, that image inline), and the presets pair reads and writes its presets. */
const bind = (key: string, known: Map<string, string>, refused: (ref: string) => void, readPresets: () => unknown, writePresets: (v: unknown) => boolean) => {
  const failed = new Set<string>(), hashed = new WeakMap<object, [string, string]>();
  // Each row's last data URL and its ref, so a save that didn't touch the image doesn't hash megabytes again.
  const refOf = (row: object, v: string) => { const c = hashed.get(row); if (c?.[0] === v) return c[1]; const r = refFor(v); hashed.set(row, [v, r]); return r; };
  // A record the store refused: a preset that names it takes the data URL inline, or an empty image if storage can't fit it.
  const inlinePresets = (ref: string, v: string) => {
    const inlined = swapRef(readPresets(), ref, v);
    if (!inlined || writePresets(inlined)) return;
    writePresets(swapRef(readPresets(), ref, ""));
    console.warn("[tweaks] persist: an image a preset holds didn't fit in storage — the preset keeps the rest");
  };
  return {
    /** The ref `row`'s image saves as, or null to save it inline (the store refused it). Written once, and again whenever
     *  `stored` (what storage holds now) no longer names it: a tab that replaced it may have pruned the record. */
    save(row: object, v: string, stored: unknown) {
      const ref = refOf(row, v);
      if (failed.has(ref)) return null;
      if (!known.has(ref) || !refsIn(stored).has(ref)) {
        known.set(ref, v);
        put(key, ref, v).then((ok) => { if (ok) return; known.delete(ref); failed.add(ref); refused(ref); inlinePresets(ref, v); });
      }
      return ref;
    },
    prune: (named: unknown[]) => pruneUnnamed(key, known, named),
    /** A ref this panel hasn't seen (a preset another tab saved), read from the store. */
    fetch: (ref: string) => get(key, ref).then((url) => { if (url) known.set(ref, url); return url; }),
  };
};

export { refFor, load, bind };
