/* Undo / redo (opts.undo) — a debounced history of snapshots, scoped to a hovered or focused panel so it doesn't hijack
 * the page's own undo. Its own module, so the history can be tested without a panel (test/undo.test.mjs). */
import { hasOwn, valueChanged, activeIn } from "./shared.js";
import type { Snapshot } from "./panel.js";

/** A panel's history: `snapshot` reads its values, `applySnapshot` writes them back, `watch` subscribes to every change
 *  (the silent ones too), and ⌘Z belongs to `panel` while it's hovered or focused, outside an editable field. Positional,
 *  as a context object's keys would survive minification in the core. */
export const createUndo = (panel: HTMLElement, snapshot: () => Snapshot, applySnapshot: (snap: Snapshot) => void, atPath: (obj: Snapshot | null, path: string[]) => unknown, inEditable: (t: Element | null) => boolean, watch: (fn: () => void) => void) => {
  // Bounded: each step is a deep clone of every value.
  const HIST_MAX = 200;
  let history: Snapshot[] = [], histIdx = 0, applyingHistory = false, histTimer = 0;
  // Walk a new step beside the one before it: a string that didn't change takes the earlier step's copy, so an image's
  // data URL is held once across history, not once a step. Strings only, never objects, so no step can edit another.
  // True when nothing changed, which spares serializing both steps to compare them.
  // (Snapshots are JSON: own keys, no undefined. A key b lacks reads undefined or an inherited function, and never matches.)
  const share = (a: any, b: any): boolean => {
    if (a === b) return true;
    if (!a || !b || typeof a != "object" || typeof b != "object" || Array.isArray(a) != Array.isArray(b)) return false;
    let same = Object.keys(a).length == Object.keys(b).length;
    for (const k in a) if (a[k] === b[k]) a[k] = b[k]; else if (!share(a[k], b[k])) same = false;
    return same;
  };
  const commit = () => {
    histTimer = 0;
    const snap = snapshot();
    if (share(snap, history[histIdx])) return; // unchanged
    history = history.slice(0, histIdx + 1); history.push(snap); // a new edit drops the redo branch
    if (history.length > HIST_MAX) history = history.slice(history.length - HIST_MAX); // oldest steps age out
    histIdx = history.length - 1;
  };
  const record = () => { if (applyingHistory) return; clearTimeout(histTimer); histTimer = setTimeout(commit, 350); };
  // so ⌘Z right after a change still undoes that change
  const flush = () => { if (histTimer) { clearTimeout(histTimer); commit(); } };
  watch(record);
  const restore = (idx: number) => { applyingHistory = true; applySnapshot(history[idx]); applyingHistory = false; histIdx = idx; };
  const undo = () => { flush(); if (histIdx > 0) restore(histIdx - 1); };
  const redo = () => { flush(); if (histIdx < history.length - 1) restore(histIdx + 1); };
  const focused = () => panel.matches(":hover") || panel.contains(activeIn(panel));
  const onKey = (e: KeyboardEvent) => {
    // the path: a shadow host retargets e.target
    if (!focused() || !(e.metaKey || e.ctrlKey) || inEditable(e.composedPath()[0] as Element)) return;
    const k = e.key.toLowerCase();
    if (k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (k === "y") { e.preventDefault(); redo(); }
  };
  // patch: a late restore (an image the store just answered for) goes into every step that still held what its row held,
  // so it isn't a step of its own, and ⌘Z neither takes it back out nor folds a pending edit into the base.
  const patch = (path: string[], held: unknown, v: unknown) => {
    const k = path[path.length - 1], h = JSON.parse(JSON.stringify(held ?? null)), nv = JSON.parse(JSON.stringify(v ?? null));
    for (const step of history) { const o: any = atPath(step, path.slice(0, -1)); if (o && typeof o === "object" && hasOwn(o, k) && !valueChanged(o[k], h)) o[k] = nv; }
  };
  const arm = () => { history = [snapshot()]; histIdx = 0; }; // the base step: the panel as built and restored
  return { undo, redo, onKey, flush, arm, patch };
};
export type Undo = ReturnType<typeof createUndo>;
