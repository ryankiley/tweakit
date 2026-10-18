/* The paste's parse, checks and report: a lazy chunk the first paste fetches, so none of it rides in a basic
 * panel's download. A runtime import here of a module only core reaches (schema.ts, feedback.ts) would split
 * that module into a shared chunk of its own, so the caller lends what it needs (Report, ClipCtx); shared.ts is
 * already shared with the lazy controls. */
import type { Entry, Snapshot } from "./panel.js";
import type { PanelState } from "./types.js";
import type { Meta } from "./schema.js";
import type { flash, showToast } from "./feedback.js";
import { isObj, isColorStr, optValue, el, btn, txt, carrySkin, stopPointerLeak, closeActivePopover } from "./shared.js";

/** Where a pasted value can land: a control's path, its current value, its meta and its row (a disabled one takes nothing). */
export interface Slot { path: string[]; get: () => unknown; m: Meta; el?: Element }
/** How a paste reports: the paste button's check or cross, the toast, and whether its panel is still there. */
export interface Report { flash: typeof flash; showToast: typeof showToast; alive: () => boolean }
/** What a panel lends the paste and the row menu: its entries and load path, and the copy, paste and reset the menu runs
 *  (the panel's own, so the clipboard work happens inside the menu's click). */
export interface ClipCtx extends Report { panel: HTMLElement; entries: Entry[]; fromJSON: (state: PanelState) => void; ui: () => PanelState["ui"]; copy: (s: Scope) => void; paste: (s: Scope) => void; reset: (es: Entry[]) => void }
/** What a scoped ⌘C / ⌘V acts on: one row, or every row under a folder's path. */
export type Scope = { kind: "row"; entry: Entry; label: string } | { kind: "folder"; path: string[]; label: string };

const RESERVED = new Set(["__proto__", "constructor", "prototype"]);
const atPath = (obj: unknown, path: string[]): unknown => path.reduce<any>((o, k) => (isObj(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined), obj);
const plural = (n: number) => `${n} value${n === 1 ? "" : "s"}`;

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

/** The rows a scope covers: the row itself, or every row under the folder's path. */
const rows = (ctx: ClipCtx, s: Scope) => s.kind === "row" ? [s.entry] : ctx.entries.filter((e) => e.path.length > s.path.length && s.path.every((k, i) => e.path[i] === k));

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
    const rs = rows(ctx, s);
    hits = [];
    for (const d of [data, unflatten(data)]) for (const v of [atPath(d, s.path), d]) { const h = isObj(v) ? pick(rs, v, s.path) : []; if (h.length > hits.length) hits = h; }
  }
  if (!hits.length) return false;
  write(ctx, hits);
  return hits.length;
}

/** Every paste ends here. `read` is the clipboard read the click started (null: no API, denied, an insecure context);
 *  `apply` returns how many values it took, -1 for a layout only, false for nothing usable (a throw counts the same).
 *  The paste button swaps in the check or the cross and the toast says which; a panel gone meanwhile hears nothing. */
export async function pasteInto(read: Promise<string | null>, b: HTMLButtonElement, anchor: Element, apply: (text: string) => number | false, r: Report, into?: string) {
  const text = await read;
  if (!r.alive()) return;
  let n: number | false = false;
  if (text !== null) try { n = apply(text); } catch {}
  if (!n) { r.flash(b, "is-failed"); r.showToast(text === null ? "Couldn't read the clipboard" : "No values to paste", anchor); return; }
  r.flash(b, "is-copied"); r.showToast(n < 0 ? "Layout pasted" : `${plural(n)} pasted${into ? ` into ${into}` : ""}`, anchor);
}

// ── The row menu — Copy, Paste and Reset for one row or folder, at the pointer or under the row. One at a time page-wide;
// it closes on choosing, Escape, Tab, an outside press, a scroll, a resize or a blur, and hands focus back. ──
let menuClose: (() => void) | null = null;
const keyHint = (k: string) => (/Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || "") ? "⌘" : "Ctrl+") + k;

/** Open the menu for `s` at `at` (x, y), or under `anchor`; returns its close. */
export function openMenu(ctx: ClipCtx, s: Scope, anchor: Element, at: number[] | null) {
  menuClose?.(); closeActivePopover(); // one transient surface at a time
  const scoped = rows(ctx, s).filter((e) => !e.el.closest(".is-disabled")), back = document.activeElement as HTMLElement | null; // a disabled row isn't reset
  const menu = el("div", "tw-ctx-menu tw-portal"); menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", s.label); menu.tabIndex = -1;
  const title = txt("div", "tw-ctx-title", s.label); title.setAttribute("aria-hidden", "true");
  menu.append(title);
  const items: HTMLButtonElement[] = [];
  const item = (label: string, hint: string, run: () => void, disabled = false) => {
    const b = btn("tw-ctx-item"); b.setAttribute("role", "menuitem"); b.disabled = disabled;
    b.append(txt("span", "tw-ctx-label", label)); if (hint) b.append(txt("span", "tw-ctx-hint", hint));
    b.addEventListener("click", () => { if (b.disabled) return; close(); if (ctx.alive()) run(); });
    items.push(b); menu.append(b);
  };
  item("Copy", keyHint("C"), () => ctx.copy(s));
  item("Paste", keyHint("V"), () => ctx.paste(s));
  item("Reset", s.kind === "row" ? "Double-click" : "", () => { ctx.reset(scoped); ctx.showToast(`${s.label} reset`, ctx.panel); },
    scoped.every((e) => JSON.stringify(e.get()) === JSON.stringify(e.def))); // nothing moved: nothing to reset
  const live = () => items.filter((b) => !b.disabled);
  const onKey = (e: KeyboardEvent) => {
    const all = live(), i = all.indexOf(document.activeElement as HTMLButtonElement);
    const to = e.key === "ArrowDown" ? (i + 1) % all.length : e.key === "ArrowUp" ? (i <= 0 ? all.length - 1 : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : -1;
    if (to >= 0) { e.preventDefault(); all[to].focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Tab") close();
  };
  const onOutside = (e: Event) => { if (!menu.contains(e.target as Node)) close(); };
  const close = () => {
    if (menuClose !== close) return; menuClose = null;
    document.removeEventListener("pointerdown", onOutside, true); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); window.removeEventListener("blur", close);
    if (menu.contains(document.activeElement) && back && back !== document.body && back.isConnected) back.focus({ preventScroll: true });
    menu.classList.remove("is-open"); menu.inert = true;
    setTimeout(() => menu.remove(), 160); // once faded
  };
  menuClose = close;
  menu.addEventListener("keydown", onKey);
  menu.addEventListener("contextmenu", (e) => e.preventDefault()); // a right-click on the menu itself keeps it
  stopPointerLeak(menu);
  document.body.append(menu); carrySkin(menu, anchor);
  // Flipped up or left where it would run off the viewport, and grown from the corner it hangs from.
  const r = anchor.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight, [x, y] = at || [r.left, r.bottom + 4];
  const left = x + w > window.innerWidth - 8, up = y + h > window.innerHeight - 8;
  menu.style.left = Math.max(8, left ? x - w : x) + "px";
  menu.style.top = Math.max(8, up ? (at ? y : r.top - 4) - h : y) + "px";
  menu.style.transformOrigin = `${up ? "bottom" : "top"} ${left ? "right" : "left"}`;
  setTimeout(() => { if (menuClose === close) document.addEventListener("pointerdown", onOutside, true); }, 0); // not the press that opened it
  window.addEventListener("scroll", close, true); window.addEventListener("resize", close); window.addEventListener("blur", close);
  requestAnimationFrame(() => { if (menuClose === close) menu.classList.add("is-open"); });
  (live()[0] || menu).focus({ preventScroll: true }); // the first item; its highlight shows only for the keyboard (:focus-visible)
  return close;
}
