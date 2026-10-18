/* The paste's parse, checks and report: a lazy chunk the first paste fetches, so none of it rides in a basic
 * panel's download. A runtime import here of a module only core reaches (schema.ts, feedback.ts) would split
 * that module into a shared chunk of its own, so the caller lends what it needs (Report, ClipCtx); shared.ts is
 * already shared with the lazy controls. */
import type { Entry, Snapshot } from "./panel.js";
import type { PanelState } from "./types.js";
import type { Meta } from "./schema.js";
import type { flash, announce } from "./feedback.js";
import { isObj, isColorStr, optValue } from "./shared.js";

/** Where a pasted value can land: a control's path, its current value, its meta and its row (a disabled one takes nothing). */
export interface Slot { path: string[]; get: () => unknown; m: Meta; el?: Element }
/** How a paste reports: the paste button's check or cross, the words a screen reader hears, and whether its panel is still there. */
export interface Report { flash: typeof flash; announce: typeof announce; alive: () => boolean }
/** What a panel lends the paste. */
export interface ClipCtx extends Report { panel: HTMLElement; entries: Entry[]; fromJSON: (state: PanelState) => void; ui: () => PanelState["ui"] }
/** What a scoped ⌘C / ⌘V acts on: one row, or every row under a folder's path. */
export type Scope = { kind: "row"; entry: Entry; label: string } | { kind: "folder"; path: string[]; label: string };

const RESERVED = new Set(["__proto__", "constructor", "prototype"]);
const atPath = (obj: unknown, path: string[]): unknown => path.reduce<any>((o, k) => (isObj(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined), obj);

/** ⇧-copy's output is a flat map by dotted path; nested, "folder.child" lands where set() would put it. A reserved
 *  segment is dropped, so a pasted "__proto__.x" can't write onto Object.prototype. */
const unflatten = (flat: Record<string, unknown>): Snapshot => {
  const out: Snapshot = {};
  for (const k of Object.keys(flat)) {
    const path = k.split("."); if (path.some((s) => RESERVED.has(s))) continue;
    let o = out; for (const s of path.slice(0, -1)) o = isObj(o[s]) ? o[s] : (o[s] = {});
    o[path[path.length - 1]] = flat[k];
  }
  return out;
};

// A pasted value fits where it's going when it has the current value's shape: the same JSON type all the way down, a
// finite number, a tuple (an interval, a curve) of the same length, a list (a gradient's stops) of 2 to 64 items each
// shaped like the first, a colour the browser can parse wherever a colour stands (a colour or gradient control), and
// for a list control one of its options. Anything else would be coerced or ignored by set() — null to 0, a stray string
// to black, a short tuple dropped — so it's skipped, and counted as not pasted; so is anything for a disabled row.
const isColour = (v: unknown) => isColorStr(v) && (typeof CSS === "undefined" || !CSS.supports || CSS.supports("color", v as string));
const sameShape = (cur: unknown, v: unknown, col: boolean): boolean => {
  if (Array.isArray(cur)) return Array.isArray(v) && (cur.every((x) => !isObj(x)) ? v.length === cur.length && v.every((x, i) => sameShape(cur[i], x, col)) : v.length >= 2 && v.length <= 64 && v.every((x) => sameShape(cur[0], x, col)));
  if (isObj(cur)) return isObj(v) && !Array.isArray(v) && Object.keys(cur).every((k) => sameShape(cur[k], v[k], col));
  return typeof v === typeof cur && (typeof v !== "number" || Number.isFinite(v)) && (!col || !isColorStr(cur) || isColour(v));
};
const fits = (s: Slot, v: unknown) => v != null && !s.el?.closest(".is-disabled") && sameShape(s.get(), v, s.m.type === "color" || s.m.type === "gradient")
  && (!s.m.options || s.m.options.some((o) => JSON.stringify(optValue(o)) === JSON.stringify(v)));

/** The values in `values` that fit their slots, each slot read at its path below `base`. */
export const pick = <S extends Slot>(slots: S[], values: unknown, base: string[] = []): Array<[S, unknown]> =>
  slots.map((s): [S, unknown] => [s, atPath(values, s.path.slice(base.length))]).filter(([s, v]) => fits(s, v));

/** The values that fit, read from `data` as it stands or as ⇧-copy's dotted map, whichever lands more: a copy whose own
 *  keys hold a literal "." reads as it stands, a changed-only map unflattened. */
export const pickBest = <S extends Slot>(slots: S[], data: Record<string, unknown>, base?: string[]) => {
  const a = pick(slots, data, base), b = pick(slots, unflatten(data), base);
  return b.length > a.length ? b : a;
};

/** The toolbar paste: the copy's object, ⇧-copy's dotted map, or a whole toJSON() state with its ui, through fromJSON
 *  (one undo step, saved and announced like any load). How many values it took, -1 for a state whose ui alone changed
 *  something, false for nothing usable. A panel whose own top-level keys are "values" or "ui" reads its copy as values. */
export function pasteValues(ctx: ClipCtx, text: string): number | false {
  const data = JSON.parse(text);
  if (!isObj(data) || Array.isArray(data)) return false;
  const keys = Object.keys(data), state = keys.length > 0 && keys.every((k) => k === "values" || k === "ui") && !ctx.entries.some((e) => e.path[0] === "values" || e.path[0] === "ui");
  const hits = pickBest(ctx.entries, state ? (isObj(data.values) ? data.values : {}) : data), ui = state && isObj(data.ui) ? data.ui : undefined;
  if (!hits.length) {
    if (!ui) return false;
    const before = JSON.stringify(ctx.ui()); ctx.fromJSON({ ui }); // no values: nothing notified
    return JSON.stringify(ctx.ui()) !== before && -1; // a layout that changed nothing is nothing pasted
  }
  write(ctx, hits, ui);
  return hits.length;
}
// Only what fits is written, through fromJSON: a bag key or a value set() would coerce stays as it is.
const write = (ctx: ClipCtx, hits: Array<[Entry, unknown]>, ui?: PanelState["ui"]) => {
  const out: Snapshot = {};
  for (const [e, v] of hits) { let o = out; for (const k of e.path.slice(0, -1)) o = o[k] ||= {}; o[e.path[e.path.length - 1]] = v; }
  ctx.fromJSON({ values: out, ui });
};

/** ⌘V on a row or folder. A row takes a bare value or its own one-key object. A folder takes its values object, or any
 *  copy that holds the folder at its own path (a whole-panel copy, a changed-only map), only into its own rows: each
 *  reading is tried, as it stands and unflattened, at the folder's path and as the folder's own, and the one that lands
 *  most wins (a folder whose subfolder shares its name reads its own copy right). */
export function pasteScope(ctx: ClipCtx, s: Scope, text: string): number | false {
  const data = JSON.parse(text);
  let hits: Array<[Entry, unknown]>;
  if (s.kind === "row") {
    const e = s.entry, v = isObj(data) && !Array.isArray(data) && Object.keys(data).length === 1 && Object.prototype.hasOwnProperty.call(data, e.key) ? data[e.key] : data;
    hits = fits(e, v) ? [[e, v]] : [];
  } else {
    if (!isObj(data) || Array.isArray(data)) return false;
    const rows = ctx.entries.filter((e) => e.path.length > s.path.length && s.path.every((k, i) => e.path[i] === k));
    hits = [];
    for (const d of [data, unflatten(data)]) for (const v of [atPath(d, s.path), d]) { const h = isObj(v) ? pick(rows, v, s.path) : []; if (h.length > hits.length) hits = h; }
  }
  if (!hits.length) return false;
  write(ctx, hits);
  return hits.length;
}

/** Every paste ends here. `read` is the clipboard read the click started (null: no API, denied, an insecure context);
 *  `apply` returns how many values it took, -1 for a layout only, false for nothing usable (a throw counts the same).
 *  The paste button swaps in the check, or the cross for nothing pasted, and a screen reader hears which; a panel gone
 *  meanwhile reports nothing. */
export async function pasteInto(read: Promise<string | null>, b: HTMLButtonElement, apply: (text: string) => number | false, r: Report) {
  const text = await read;
  if (!r.alive()) return;
  let n: number | false = false;
  if (text !== null) try { n = apply(text); } catch {}
  r.flash(b, n ? "is-copied" : "is-failed");
  r.announce(!n ? (text === null ? "Couldn't read the clipboard" : "Nothing to paste") : n < 0 ? "Layout pasted" : `${n} value${n === 1 ? "" : "s"} pasted`);
}
