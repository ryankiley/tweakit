/* The paste's parse, checks and report: a lazy chunk the first paste fetches, so none of it rides in a basic
 * panel's download. A runtime import here of a module only core reaches (schema.ts, feedback.ts) would split
 * that module into a shared chunk of its own, so the caller lends what it needs (Report, ClipCtx); shared.ts is
 * already shared with the lazy controls. */
import type { Entry, Snapshot } from "./panel.js";
import type { PanelState } from "./types.js";
import type { Meta } from "./schema.js";
import type { announce } from "./feedback.js";
import { isObj, isColorStr, optValue } from "./shared.js";

/** Where a pasted value can land: a control's path, its current value, its meta and its row (a disabled one takes nothing). */
export interface Slot { path: string[]; get: () => unknown; m: Meta; el?: Element }
/** How a paste reports: the words a screen reader hears, and whether its panel is still there. */
export interface Report { announce: typeof announce; alive: () => boolean }
/** What a panel lends the paste. */
export interface ClipCtx extends Report { panel: HTMLElement; entries: Entry[]; fromJSON: (state: PanelState) => void }
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

// Only what fits is written, through fromJSON: a bag key or a value set() would coerce stays as it is.
const write = (ctx: ClipCtx, hits: Array<[Entry, unknown]>) => {
  const out: Snapshot = {};
  for (const [e, v] of hits) { let o = out; for (const k of e.path.slice(0, -1)) o = o[k] ||= {}; o[e.path[e.path.length - 1]] = v; }
  ctx.fromJSON({ values: out });
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

/** Every paste ends here. `text` is what the browser's paste event carried (null: none); `apply` returns how many
 *  values it took, or false for nothing usable (a throw counts the same). A screen reader hears which, and a picked
 *  `band` flashes it; the result is whether anything landed, or undefined when the panel went while this chunk loaded. */
export function pasteInto(text: string | null, apply: (text: string) => number | false, r: Report, band?: Element) {
  if (!r.alive()) return;
  let n: number | false = false;
  if (text !== null) try { n = apply(text); } catch {}
  r.announce(!n ? (text === null ? "Couldn't read the clipboard" : "Nothing to paste") : `${n} value${n === 1 ? "" : "s"} pasted`);
  if (band) { const c = n ? "is-pasted" : "is-refused"; band.classList.remove("is-pasted", "is-refused"); band.classList.add(c); setTimeout(() => band.classList.remove(c), 450); }
  return !!n;
}
