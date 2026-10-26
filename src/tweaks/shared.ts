/* Tweaks — shared building blocks: DOM + math helpers, theming, the popover shell and
 * the control registry. core.js and the lazy controls/*.js import what they each use. */
import type { Control, Option, Panel, Theme } from "./types.js";
import type { Meta } from "./schema.js";

// ── Internal types ──
/** A control's change callback. */
type OnChange = (value: unknown) => void;
/** The resolved `--tw-*` custom-property map a theme turns into (resolveTheme). */
type ThemeVars = Record<string, string>;
/** A panel root; panel.ts hangs its live theme, edit hook and ready promise on the node. */
interface PanelEl extends HTMLElement { _twTheme?: ThemeVars | null; _twEditPointer?: (e: PointerEvent) => void; ready?: Promise<Panel> }
/** A node applyThemeVars has written to; remembers which properties, to clear them next time. */
interface ThemedEl extends HTMLElement { _twAppliedVars?: string[] | null }
/** A single-select radio button carrying its option's real value (dataset stringifies). */
interface RadioBtn extends HTMLButtonElement { _twVal?: string }
/** setAttribute() / style.setProperty() taking a number as well as a string (the DOM
 *  stringifies either). Type-level only. */
interface Stringifying { setAttribute(name: string, value: string | number): void; style: { setProperty(name: string, value: string | number | null, priority?: string): void } }
type Built<E extends Element> = E & Stringifying;
/** The labeled numeric field's spec (numField). */
interface NumSpec { label: string; value?: unknown; min?: unknown; max?: unknown; step?: unknown; soft?: boolean; row?: boolean; unit?: string } // unit: muted suffix, also in the accessible name
/** The numeric field's handle: set() coerces and fits, get() reads the fitted number. */
interface NumField { el: HTMLDivElement; set(v: number | string): void; get(): number; range: [number, number] }
/** The popover shell's handle (popover). */
interface Popover { open(): void; close(): void; isOpen(): boolean; reflow(): void }
/** A control constructor: normalized meta in, handle out. The registry holds every one under
 *  the loose form; a lookup names the shape it expects — `getControl<TabsControl>("tabs")`. */
type ControlCtor<M = Meta, C = Control> = (meta: M, onChange?: OnChange) => C;

// ── helpers ──
// A word starts at a camel hump or where a capital opens a lowercase word ("myURLParser" → "My URL Parser").
// A key opening on one lowercase letter and capitals, or on an Apple OS, is a name written as meant ("sRGB", "iOS",
// "macOS", not "S RGB"), kept whole and the rest split after it ("sRGBGamut" → "sRGB Gamut"); a word ending in an
// acronym splits as any other ("showFPS" → "Show FPS").
const humanize = (s: string) => s.replace(/([a-z])(?=[A-Z])|([A-Z\d])(?=[A-Z][a-z])/g, "$1$2 ").replace(/^./, (c) => c.toUpperCase()).trim();
const titleCase = (s: string) => { const m = /^(?:[a-z][A-Z]{2,}?|(?:mac|tv|watch|iPad|vision)OS)(?=[A-Z][a-z]|[^A-Za-z]|$)/.exec(s); return m ? `${m[0]} ${humanize(s.slice(m[0].length))}`.trim() : humanize(s); };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";
// Hex or any CSS color function: routes a schema string to the color control.
const isColorStr = (v: unknown) => typeof v === "string" && (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.trim()) || /^(oklch|oklab|rgba?|hsla?|hwb|lab|lch|color)\(/i.test(v.trim()));
// toFixed() throws past 100 digits, and a readout past 20 decimals is noise.
const MAX_FIXED = 20;
const stepPrecision = (step: number) => {
  const t = String(step);
  // String(1e-7) has no "." — read the exponent, or fine steps round to whole numbers.
  const e = /e-(\d+)$/i.exec(t);
  if (e) return Math.min(MAX_FIXED, Number(e[1]) + (t.split("e")[0].split(".")[1] || "").length);
  const i = t.indexOf(".");
  return i === -1 ? 0 : Math.min(MAX_FIXED, t.length - i - 1);
};
// Round to the min-anchored step grid. The anchor is rounded to the step's decimals too: a
// finer min put every grid point half a decimal off, and each re-round walked the value up.
const roundToStep = (v: number, min: number, step: number) => {
  if (!(step > 0)) return v;
  const p = stepPrecision(step), a = Number((+min).toFixed(p));
  const n = Math.round((v - a) / step); if (!Number.isFinite(n)) return v; // a huge value over a tiny step overflows; keep the raw
  return Number((a + n * step).toFixed(p));
};
// The reachable ends of a [min, max] step grid, so a clamp never lands off-grid; a range too
// narrow to hold a grid point pins to min. ±Infinity = open.
const gridEnds = (min: number, max: number, step: number, anchor = min): [number, number] => {
  const r = (v: number) => roundToStep(v, anchor, step);
  let lo = Number.isFinite(min) ? r(min) : -Infinity, hi = Number.isFinite(max) ? r(max) : Infinity;
  // A millionth of a step is float noise, not overshoot: 0.1 * 3's min rounds to 0.3, a hair under it, and trimmed to 0.31.
  const eps = step * 1e-6;
  if (lo < min - eps) lo = r(lo + step);
  if (hi > max + eps) hi = r(hi - step);
  return lo > hi ? [min, min] : [lo, hi];
};
// By the span, then finer, a tenth at a time and at most twice, until each value the range was built around sits on the
// grid from min: a coarser grid snapped the default off what was written (37 over 0–110 became 40). A value finer still
// (3.14159) rounds to the last of those. A range across zero counts 0 among them, so -45's -135–135 steps by 1, not by
// 10 from -135 (…, -5, 5, …), which stepped over 0. roundToStep anchors the grid at min rounded to the step's decimals,
// so min must keep its own decimals too (0.25 over 0.1 anchored at 0.3, and 1.25 came back 1.2); max joins them when a
// step within reach fits it, else the grid trims it as before.
const inferStep = (min: number, max: number, ...vals: number[]) => {
  const range = max - min;
  if (min < 0 && max > 0) vals.push(0);
  const base = range <= 1 ? 0.01 : range <= 10 ? 0.1 : range <= 100 ? 1 : 10;
  const on = (n: number) => !Number.isFinite(n) || Math.abs(n - Math.round(n)) <= 1e-6;
  const fits = (step: number, vs: number[]) => on(min / Math.min(step, 1)) && vs.every((v) => on((v - min) / step));
  const finest = (vs: number[]) => { let step = base; for (let i = 0; i < 2 && !fits(step, vs); i++) step /= 10; return step; };
  const withMax = finest([...vals, max]);
  return fits(withMax, [...vals, max]) ? withMax : finest(vals);
};
// The range a value implies when no bound is given, widened by each value (defaultRange), and its step. A range mirrored
// about zero steps like its positive half (-0.5 by 0.01, like 0.5), not by its doubled span, and its ends keep 0 on the grid.
const derivedRange = (...vals: number[]) => {
  const rs = (vals.length ? vals : [0]).map(defaultRange);
  const min = Math.min(...rs.map((r) => r[0])), max = Math.max(...rs.map((r) => r[1]));
  return { min, max, step: min < 0 && min === -max ? inferStep(0, max, max, ...vals.map(Math.abs)) : inferStep(min, max, ...vals) };
};
// Every range swaps an inverted min/max, which is the right recovery, but silent it hides a typo: say so.
const swapNote = (label: string, min: unknown, max: unknown) => {
  const n = (v: unknown) => (v == null || v === "" ? NaN : +v!);
  if (n(max) < n(min)) notice("swap", label, min, max);
};
// A console notice for a mistake. Its words live in the lazy heavy chunk (heavy.ts NOTICES), so a panel that makes none
// never downloads them; it lands a moment later, which a console doesn't mind.
const notice = (kind: string, ...args: unknown[]) => { import("./heavy.js").then((m) => m.notice(kind, args), () => {}); };
// Normalize a slider-style range: an absent or non-finite bound derives from the values, an inverted pair swaps (with a
// note, given the control's label), and only then does an absent or unusable step infer, so a NaN min can't hand it a NaN
// span. Every range source funnels here.
const normalizeRange = (rawMin: unknown, rawMax: unknown, rawStep: unknown, vals: number[] = [], label?: string) => {
  const given = (n: unknown) => n != null && n !== "" && Number.isFinite(+n!);
  vals = vals.filter(Number.isFinite);
  const d = derivedRange(...vals);
  let min = given(rawMin) ? +rawMin! : d.min, max = given(rawMax) ? +rawMax! : d.max, step = +rawStep!;
  // One bound written at or past the values' own other end: that end derives from the written bound, as a bare number its
  // size would, and steps a span past it when that's still no range, so [5, 20] slides 20–60 and [0.5, 1] 1–2, not 15–20 or 1–1.
  if (given(rawMin) !== given(rawMax) && !(max > min)) { const up = given(rawMin), b = up ? min : max, r = derivedRange(b); if (up) max = r.max > b ? r.max : b + r.max - r.min; else min = r.min < b ? r.min : b - r.max + r.min; }
  if (max < min) { if (label != null) swapNote(label, min, max); const t = min; min = max; max = t; }
  if (!(step > 0) || step > max - min) step = given(rawMin) || given(rawMax) ? inferStep(min, max, ...vals) : d.step;
  return { min, max, step };
};
// One keyboard model for every 1-D range surface: arrows step (⇧ = ×10), Home/End snap to
// the ends, PageUp/Down jump by `page`. Null when the key isn't the range's to handle.
const rangeStep = (e: KeyboardEvent, cur: number, step: number, lo: number, hi: number, page: number | null = null) => {
  const coarse = e.shiftKey ? 10 : 1;
  switch (e.key) {
    case "ArrowRight": case "ArrowUp": return cur + step * coarse;
    case "ArrowLeft": case "ArrowDown": return cur - step * coarse;
    case "PageUp": return page != null ? cur + page : null;
    case "PageDown": return page != null ? cur - page : null;
    case "Home": return lo;
    case "End": return hi;
  }
  return null;
};
// Does a handle's pixel span [hx, hx+hw] overlap the label or value text? `m` is a near-miss buffer.
const overlapsText = (labelEl: HTMLElement, valueEl: HTMLElement, hx: number, hw: number, m = 0) => {
  const ll = labelEl.offsetLeft, lr = ll + labelEl.offsetWidth;
  const vl = valueEl.offsetLeft, vr = vl + valueEl.offsetWidth;
  return (hx < lr && hx + hw > ll) || (hx < vr + m && hx + hw > vl - m);
};
// Default range for a number with no bounds: 0–1 keeps 0–1, a positive spans 0–3× (100 as a
// last resort), and a negative spans that much either side of zero, so it can still cross it
// (rotate: -45 → −135 to 135).
const defaultRange = (v: number): [number, number] => {
  if (!Number.isFinite(v)) return [0, 1]; // NaN spanned NaN–NaN; every entry point now reads it as 0, as a verbose slider did
  const x3 = Number((Math.abs(v) * 3).toPrecision(12)); // 2.3 × 3 is 6.8999…, which the grid trimmed to 6.8
  if (v >= 0) return [0, v <= 1 ? 1 : x3 || 100];
  const m = v >= -1 ? 1 : x3;
  return [-m, m];
};

// An option is a string, a { value, label } object, or a bare primitive that is its own value.
const optValue = (o: Option) => (o == null ? undefined : typeof o === "object" ? o.value : o);
// An object's readable form: its JSON, or String() when it can't be stringified (a cycle).
const json = (v: unknown) => { try { return JSON.stringify(v); } catch { return String(v); } };
// A string option shows as written ("px", "sRGB"): it's the author's text, not a key. A { value }
// option with no label reads as its value's string; an object with neither, as its JSON.
const optLabel = (o: Option) => (o == null ? "" : typeof o === "string" ? o : typeof o === "object" ? o.label ?? (o.value !== undefined ? String(o.value) : json(o)) : String(o));

// The DOM factory, typed by tag like createElement (svgEl in heavy.ts is its SVG twin). A field it
// makes is a setting, not a form: autofill and the password managers leave it alone.
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): Built<HTMLElementTagNameMap[K]> => {
  const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html;
  if (tag == "input" || tag == "textarea") n.setAttribute("autocomplete", "off"), n.setAttribute("data-1p-ignore", ""), n.setAttribute("data-lpignore", "true");
  return n;
};
// Every <button> is type="button" — inside a host's <form> the default would submit — and
// text goes through textContent, never innerHTML: labels are host data.
const btn = (cls: string, html?: string) => { const b = el("button", cls, html); b.type = "button"; return b; };
const txt = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text: string) => { const n = el(tag, cls); n.textContent = text; if (tag === "button") (n as HTMLButtonElement).type = "button"; return n; };
// Stop a node's pointer events and clicks leaking to the page behind it.
const stopPointerLeak = (node: EventTarget) => ["pointerdown", "pointermove", "pointerup", "click"].forEach((t) => node.addEventListener(t, (e) => e.stopPropagation()));
// Run fn next frame and again once web fonts load — font swaps change the metrics controls measure.
const onReady = (fn: () => void) => { requestAnimationFrame(fn); if (document.fonts && document.fonts.ready) document.fonts.ready.then(fn); };
// Listen on global targets for a DOM-bound owner: the first event after the owner has left
// the document drops the listener set. "Left" means it was connected once, so an event
// between build and the host's append is skipped, not fatal. Returns the release fn.
const onLive = (owner: Element, targets: Array<[EventTarget, string]>, fn: (e?: Event) => void) => {
  let mounted = owner.isConnected;
  // A host appends right after building, before any event can arrive: note that mount next
  // frame, so an unmount with no event in between still releases on the first event after.
  if (!mounted) requestAnimationFrame(() => { if (owner.isConnected) mounted = true; });
  const h = (e: Event) => { if (!owner.isConnected) { if (mounted || owner.closest("[data-tw-destroyed]")) off(); return; } mounted = true; fn(e); }; // destroy() marks the owner; release even if never mounted
  const off = () => targets.forEach(([t, ev]) => t.removeEventListener(ev, h));
  targets.forEach(([t, ev]) => t.addEventListener(ev, h));
  return off;
};
// Ask every measured surface to re-measure next frame after a display:none → shown flip.
// Namespaced, not a real "resize": host pages listen to that.
const requestReflow = () => requestAnimationFrame(() => window.dispatchEvent(new Event("tw-reflow")));
// Toggle .is-hover while the pointer is over a node; onEnter runs on entry.
const wireHoverClass = (el: HTMLElement, onEnter?: () => void) => {
  el.addEventListener("pointerenter", () => { el.classList.add("is-hover"); onEnter && onEnter(); });
  el.addEventListener("pointerleave", () => el.classList.remove("is-hover"));
};
// ── Quiet mouse focus — :focus-visible always matches a focused text field, so a plain
// click drew the keyboard ring. One document-level modality note: a pointer press quiets
// the next focus, any key restores the ring. Installs once per page. ──
let pointerModality = false;
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", () => { pointerModality = true; }, true);
  document.addEventListener("keydown", () => { pointerModality = false; }, true);
}
const quietFocus = (input: HTMLElement) => {
  input.addEventListener("focus", () => input.classList.toggle("tw-focus-quiet", pointerModality));
  input.addEventListener("blur", () => input.classList.remove("tw-focus-quiet"));
};
// Escape in an edited field restores `kept` and stops; otherwise it passes on and closes the pane. Without this,
// closing blurred the field and committed the half-typed value.
const escapeReverts = (input: HTMLInputElement, kept: () => string) => input.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key !== "Escape" || input.value === kept()) return;
  e.preventDefault(); e.stopPropagation(); input.value = kept();
});
/** Place a portaled popover under its trigger, flipping above when it won't fit, clamped into
 *  the viewport. width:"match" sizes it to the trigger; align:"end" lines up the right edges. */
export const placeBelow = (trigger: Element, pop: HTMLElement, { width, fallbackH = 300, gap = 6, align = "start", prefer = "below" }: { width?: number | "match"; fallbackH?: number; gap?: number; align?: "start" | "end" | "center"; prefer?: "above" | "below" } = {}) => {
  const r = trigger.getBoundingClientRect();
  if (width === "match") pop.style.width = r.width + "px";
  const w = pop.offsetWidth || (width === "match" ? r.width : width || 0); // drawn width, which min-width may hold above a match
  // A match held wider by min-width grows left from the trigger's right edge, so in a nested folder it spans the panel's row.
  const end = align === "end" || (width === "match" && w > r.width + 0.5);
  const x = end ? r.right - w : align === "center" ? r.left + r.width / 2 - w / 2 : r.left;
  pop.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + "px";
  const h = pop.offsetHeight || fallbackH;
  const below = window.innerHeight - r.bottom, above = r.top, need = h + 12;
  // The preferred side if it fits, else the other if it fits, else whichever has more room.
  const fitsBelow = below >= need, fitsAbove = above >= need;
  const goAbove = prefer === "above" ? (fitsAbove || (!fitsBelow && above >= below)) : (!fitsBelow && (fitsAbove || above > below));
  const top = goAbove ? r.top - h - gap : r.bottom + gap;
  pop.style.top = clamp(top, gap, window.innerHeight - h - gap) + "px"; // clamp Y into the viewport
  // For the CSS entrance: the side it opened on, and its height.
  pop.dataset.side = goAbove ? "above" : "below"; pop.style.setProperty("--tw-pop-h", String(h));
};

// ── Theming — the panel runs on --tw-* custom properties, so a theme is a set of those vars:
// resolveTheme maps a friendly object to {var: value}, applyThemeVars sets them inline.
// Null-prototype, like every table indexed with caller data: a key of "constructor" must miss.
const THEME_ALIASES: Record<string, string> = Object.assign(Object.create(null), {
  // color — backdrops
  accent: "--tw-accent", onAccent: "--tw-on-accent", base: "--tw-base", dropdownBg: "--tw-dropdown-bg",
  surface: "--tw-surface", surfaceHover: "--tw-surface-hover", surfaceActive: "--tw-surface-active",
  border: "--tw-border", borderHover: "--tw-border-hover", selection: "--tw-selection",
  // color — text tones
  title: "--tw-text-root", section: "--tw-text-section", text: "--tw-text-primary", label: "--tw-text-label",
  textMuted: "--tw-text-secondary", textFaint: "--tw-text-tertiary", focus: "--tw-text-focus",
  success: "--tw-success", danger: "--tw-danger",
  // elevation
  shadow: "--tw-shadow-dropdown", shadowPanel: "--tw-shadow-panel", shadowPanelLifted: "--tw-shadow-panel-lifted",
  // type + shape
  font: "--tw-font-sans", fontMono: "--tw-font-mono", radius: "--tw-radius", density: "--tw-row-height", width: "--tw-width", // numeric → px
});
const TW_PX_ALIASES = new Set(["radius", "density", "width"]);
// Font stacks and box-shadows: written as given. Every other friendly key holds a color.
const TW_FREE_ALIASES = new Set(["font", "fontMono", "shadow", "shadowPanel", "shadowPanelLifted"]);
// A length: a number with an optional unit, or a function such as calc() or var().
const TW_LENGTH = /^(-?(\d+\.?\d*|\.\d+)([a-z]+|%)?|[a-z-]+\(.*\))$/i;
// Can this friendly key's var hold the value? A DOM without CSS.supports (jsdom) can't judge a color, so it passes.
const themeOk = (k: string, s: string) => TW_PX_ALIASES.has(k) ? TW_LENGTH.test(s.trim())
  : TW_FREE_ALIASES.has(k) || typeof CSS === "undefined" || !CSS.supports || CSS.supports("color", s);
// On-accent text: black or white by the accent's WCAG luminance, so a bright accent stays
// legible. Hex and rgb() are read; anything else falls back to white. sRGB is all it needs.
const channelLin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const parseRgb = (s: string): number[] | null => {
  s = String(s).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s); if (m) return m[1].split("").map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})$/i.exec(s); if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(([^)]+)\)/i.exec(s); if (m) { const n = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return [n[0], n[1], n[2]]; }
  return null;
};
const onAccentText = (accent: string) => {
  const rgb = parseRgb(accent); if (!rgb || rgb.some((c) => !Number.isFinite(c))) return "#ffffff";
  const L = 0.2126 * channelLin(rgb[0]) + 0.7152 * channelLin(rgb[1]) + 0.0722 * channelLin(rgb[2]);
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.0571 ? "#ffffff" : "#161616"; // contrast vs white vs near-black (#161616, L≈0.0071)
};
const resolveTheme = (theme: Theme | null | undefined): ThemeVars | null => {
  if (!theme || typeof theme !== "object") return null;
  const out: ThemeVars = {};
  for (const [k, v] of Object.entries(theme)) {
    if (k.startsWith("--")) { out[k] = String(v); continue; } // raw tokens pass unchecked: the escape hatch
    if (v == null) continue; // unset, as an optional spread leaves a key
    const name = THEME_ALIASES[k], s = TW_PX_ALIASES.has(k) && typeof v === "number" ? `${v}px` : String(v);
    // A typo or a value its var can't hold is skipped out loud, not dropped or written as-is.
    // The message and its near-miss search are lazy, as only a mistake needs them.
    if (!name || !themeOk(k, s)) { import("./heavy.js").then((m) => m.badTheme(k, v, name ? (TW_PX_ALIASES.has(k) ? "length" : "color") : "", Object.keys(THEME_ALIASES)), () => {}); continue; }
    out[name] = s;
  }
  if (out["--tw-accent"] && !out["--tw-on-accent"]) out["--tw-on-accent"] = onAccentText(out["--tw-accent"]);
  return Object.keys(out).length ? out : null;
};
// Clear the previous application first, so a partial theme reverts what it no longer names.
const applyThemeVars = (node: ThemedEl | null | undefined, vars: ThemeVars | null | undefined) => {
  if (!node) return;
  if (node._twAppliedVars) for (const k of node._twAppliedVars) node.style.removeProperty(k);
  node._twAppliedVars = vars ? Object.keys(vars) : null;
  if (vars) for (const k in vars) node.style.setProperty(k, vars[k]);
};
// Carry a forced scheme onto a node portaled to <body>, where the cascade can't reach. Copy
// the WINNING scheme, not the nearest pin: pins resolve flat (light outranks dark; tweaks.css).
const carryScheme = (portal: Element, anchor: Element | null | undefined) => {
  const s = anchor?.closest('[data-tw-scheme="light"]') ? "light" : anchor?.closest('[data-tw-scheme="dark"]') ? "dark" : null;
  if (s) portal.setAttribute("data-tw-scheme", s); else portal.removeAttribute("data-tw-scheme");
};
// …and the anchor panel's live theme (read at carry time — setTheme() swaps the object).
const carrySkin = (portal: HTMLElement, anchor: Element | null | undefined) => { applyThemeVars(portal, anchor?.closest<PanelEl>(".tw-panel")?._twTheme); carryScheme(portal, anchor); };

// ── Popover — the portal-to-<body> shell behind every transient surface. Opens under its
// trigger at its width (unless opts.width), carries the host theme, closes on outside-press / Esc / scroll-out. Globally
// single-open. onOpen runs once it's placed at real size; onReflow on resize while open. ──
let activePopoverClose: null | (() => void) = null, activePopoverTrigger: HTMLElement | null = null;
// With `owner` given, closes only when the open popover's trigger lives inside it.
const closeActivePopover = (owner?: Element) => { if (activePopoverClose && (!owner || owner.contains(activePopoverTrigger))) activePopoverClose(); };
function popover(root: HTMLElement, trigger: HTMLButtonElement, pop: HTMLElement, opts: { width?: number | "match"; fallbackH?: number; gap?: number; align?: "start" | "end"; movable?: boolean; onOpen?: () => void; onReflow?: () => void; initialFocus?: () => HTMLElement | null | undefined } = {}): Popover {
  let open = false, schemeObs: MutationObserver | null = null, removeTimer: ReturnType<typeof setTimeout> | undefined, byPointer = false, sizeObs: ResizeObserver | null = null;
  // Focus goes back to the row as the pane was opened: quietly after a click, even when an Escape closes it.
  const refocus = () => trigger.focus({ focusVisible: !byPointer });
  pop.classList.add("tw-portal"); // portal-wide CSS rules key off this
  // A closed pop stays in the DOM at opacity 0; inert keeps it out of the tab order and a11y tree.
  pop.inert = true;
  // Relay pointerdowns to the host panel's edit hook — on <body>, its own listener can't see them.
  pop.addEventListener("pointerdown", (e) => trigger.closest<PanelEl>(".tw-panel")?._twEditPointer?.(e), true);
  stopPointerLeak(pop); // on <body>, outside the panel's own pointer-stop
  // A scroll carries the pop along at its offset from the trigger (follow) instead of
  // re-placing it; once the row has left the viewport the pop closes.
  let dx = 0, dy = 0;
  // Drag the pane by its edge (padding, or a gap between parts) to uncover what's beneath. It keeps that offset from its
  // row while open; the next open resets it.
  let moved = false;
  const keepInView = () => { pop.style.left = clamp(parseFloat(pop.style.left), 8, window.innerWidth - pop.offsetWidth - 8) + "px"; pop.style.top = clamp(parseFloat(pop.style.top), 8, window.innerHeight - pop.offsetHeight - 8) + "px"; };
  const place = () => {
    if (moved) keepInView(); else placeBelow(trigger, pop, { width: opts.width ?? "match", fallbackH: opts.fallbackH, gap: opts.gap, align: opts.align });
    const r = trigger.getBoundingClientRect(); dx = parseFloat(pop.style.left) - r.left; dy = parseFloat(pop.style.top) - r.top;
  };
  pop.addEventListener("pointerdown", (e) => {
    if (e.target !== pop || e.button !== 0 || !open || opts.movable === false) return;
    e.preventDefault(); // no text selection, and focus stays where it was
    const id = e.pointerId, sx = e.clientX, sy = e.clientY, ox = parseFloat(pop.style.left), oy = parseFloat(pop.style.top), wasMoved = moved;
    let going = false;
    try { pop.setPointerCapture(id); } catch {}
    const move = (m: PointerEvent) => {
      if (m.pointerId !== id) return;
      if (!going) { if (Math.hypot(m.clientX - sx, m.clientY - sy) < 4) return; going = moved = true; pop.classList.add("is-moving"); }
      pop.style.left = ox + m.clientX - sx + "px"; pop.style.top = oy + m.clientY - sy + "px"; place();
    };
    const end = (m: PointerEvent) => { if (m.pointerId === id) stop(); };
    // Escape mid-move puts it back and keeps it open. Capture phase, so it beats the pane's own Escape.
    const key = (k: KeyboardEvent) => {
      if (k.key !== "Escape" || !going) return;
      k.preventDefault(); k.stopPropagation();
      pop.style.left = ox + "px"; pop.style.top = oy + "px"; moved = wasMoved; place(); stop();
      try { pop.releasePointerCapture(id); } catch {}
    };
    const stop = () => {
      pop.removeEventListener("pointermove", move); pop.removeEventListener("pointerup", end); pop.removeEventListener("pointercancel", end); pop.removeEventListener("lostpointercapture", end);
      document.removeEventListener("keydown", key, true); pop.classList.remove("is-moving");
    };
    pop.addEventListener("pointermove", move); pop.addEventListener("pointerup", end); pop.addEventListener("pointercancel", end); pop.addEventListener("lostpointercapture", end); // lost: the node left mid-press
    document.addEventListener("keydown", key, true);
  });
  // A detached trigger has a zero rect: if the host has unmounted the panel, close instead.
  const reflow = () => { if (open) { if (!root.isConnected) return close(); place(); opts.onReflow && opts.onReflow(); } };
  const follow = () => {
    if (!open) return; if (!root.isConnected) return close();
    const r = trigger.getBoundingClientRect();
    const sr = trigger.closest(".tw-panel")?.getBoundingClientRect(); // a floating panel scrolls, and clips its rows (an inline one holds them all)
    if (!(r.width || r.height) || r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth || (sr?.height && (r.bottom < sr.top || r.top > sr.bottom))) return close(); // hidden, or scrolled out
    pop.style.left = r.left + dx + "px"; pop.style.top = r.top + dy + "px";
  };
  const onOutside = (e: PointerEvent) => { if (!root.contains(e.target as Node) && !pop.contains(e.target as Node)) close(); };
  // Escape closes and stops propagation, so a host dialog doesn't close too. A field reverting an edit stops it first.
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && open && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); close(); refocus(); } };
  // Focus leaving both the pop and its trigger closes. A blur with no relatedTarget is
  // ambiguous (a press on a drag surface inside the pop blurs to <body> too), so the modality
  // note decides. A Tab that lands outside the panel comes back to the trigger a tick later.
  const onFocusOut = (e: FocusEvent) => {
    if (!open) return; const t = e.relatedTarget as Node | null;
    if (!t && !document.hasFocus()) return; // the window lost focus (a file dialog, another app): the pane waits for it
    if (t ? root.contains(t) || pop.contains(t) : pointerModality) return;
    close();
    if (t && !trigger.closest(".tw-panel")?.contains(t)) setTimeout(() => { if (!open && document.activeElement === t) trigger.focus(); }, 0);
  };
  root.addEventListener("focusout", onFocusOut); pop.addEventListener("focusout", onFocusOut);
  const firstFocusable = () => pop.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
  // Re-carry the host scheme + theme while open: the cascade can't reach <body>, so a mid-open
  // flip would strand a mismatched popover. The observer ignores its own write on `pop`.
  const recarry = () => carrySkin(pop, root);
  const onScheme = (recs: MutationRecord[]) => { if (!recs.every((r) => r.target === pop)) recarry(); };
  const openPop = () => {
    if (activePopoverClose && activePopoverClose !== close) activePopoverClose(); // close any other open popover first
    activePopoverClose = close; activePopoverTrigger = trigger;
    open = true; root.classList.add("is-open"); trigger.setAttribute("aria-expanded", "true");
    // Reopened mid-fade, it's still on <body>; re-appending would kill the transition, so it reverses in place.
    clearTimeout(removeTimer); const fading = pop.parentNode === document.body; moved = false; byPointer = pointerModality;
    pop.inert = false; if (!fading) document.body.appendChild(pop);
    carrySkin(pop, root);
    window.addEventListener("tw-retheme", recarry); // setTheme() while open
    if (typeof MutationObserver === "function") { schemeObs = new MutationObserver(onScheme); schemeObs.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-tw-scheme"] }); } // host scheme flip while open
    // Place with transitions off: the recorded side and height set the closed state the entrance starts from.
    if (fading) place(); else { pop.style.transition = "none"; place(); void pop.offsetWidth; pop.style.transition = ""; }
    // A pane that changes size while open (a mode switch, a disclosed picker) stays on its row and inside the window.
    if (typeof ResizeObserver === "function") { sizeObs = new ResizeObserver(() => { if (open) place(); }); sizeObs.observe(pop); }
    requestAnimationFrame(() => {
      if (!open) return; // a same-tick close already ran
      pop.classList.add("is-open"); opts.onOpen && opts.onOpen(); place(); // render at real size, then re-place
      // Focus moves into the pop, or Tab walks past the portaled node at the end of <body>.
      // initialFocus wins over the first focusable; a pointer-opened pop takes focus quietly.
      if (!pop.contains(document.activeElement)) { const f = (opts.initialFocus && opts.initialFocus()) || firstFocusable(); if (f) f.focus({ focusVisible: !pointerModality }); }
    });
    // Unmount watchdog: a host removing the panel while open (an SPA route change) would
    // otherwise strand the portaled pop on screen.
    requestAnimationFrame(function watch() { if (!open) return; if (!root.isConnected) return close(); requestAnimationFrame(watch); });
    // Capture phase: the panel's own stopPointerLeak would swallow the event before it bubbles.
    setTimeout(() => { if (open) document.addEventListener("pointerdown", onOutside, true); }, 0); // skip the opening click
    document.addEventListener("keydown", onKey); // Esc closes from anywhere while open
    window.addEventListener("scroll", follow, true); window.addEventListener("resize", reflow); // capture: inner scrollers move the row too
  };
  const close = () => {
    if (activePopoverClose === close) { activePopoverClose = null; activePopoverTrigger = null; }
    // Focus stranded inside the pop returns to the trigger before the node is removed.
    if (pop.contains(document.activeElement)) refocus();
    open = false; root.classList.remove("is-open"); pop.classList.remove("is-open"); pop.inert = true; trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true); document.removeEventListener("keydown", onKey);
    window.removeEventListener("scroll", follow, true); window.removeEventListener("resize", reflow);
    window.removeEventListener("tw-retheme", recarry); if (schemeObs) { schemeObs.disconnect(); schemeObs = null; } sizeObs?.disconnect(); sizeObs = null;
    removeTimer = setTimeout(() => { if (!open) pop.remove(); }, 200); // remove the portaled node once it's faded out
  };
  trigger.addEventListener("click", () => { if (trigger.disabled) return; open ? close() : openPop(); }); // a disabled trigger stays inert to a synthetic click
  return { open: openPop, close, isOpen: () => open, reflow };
}

// Fuzzy match for the filter: `q` is a substring of `text`, or within a small edit distance
// of a window of it ("blut" finds "blur"); the DP's zeroed first row lets a match start anywhere.
const fuzzyMatch = (text: string, q: string) => {
  text = text.toLowerCase();
  if (text.includes(q)) return true;
  if (q.length < 3) return false;
  const m = q.length, n = text.length;
  let prev: number[] = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (q[i - 1] === text[j - 1] ? 0 : 1));
    prev = cur;
  }
  return Math.min(...prev) <= (q.length < 6 ? 1 : 2);
};

const REDUCE_MOTION: { matches: boolean } = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
// ── Motion tokens — EASE_SPRING is the JS literal of the CSS --tw-ease-spring: WAAPI and
// nodes outside a .tw-panel can't read the custom property. ──
const EASE_SPRING = "cubic-bezier(0.22, 1, 0.36, 1)";
const EASE_GLIDE = "cubic-bezier(0.34, 1.2, 0.64, 1)"; // press glide with a light overshoot
// Liquid pill stretch (segmented + tabs): a one-shot scaleX overshoot, origin pinned to the
// trailing edge so it reads directional. dir>0 = moving right.
const stretchPill = (pill: HTMLElement, dir: number) => {
  if (REDUCE_MOTION.matches || typeof pill.animate !== "function") return;
  pill.style.transformOrigin = dir > 0 ? "left center" : "right center";
  pill.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(1.18)" }, { transform: "scaleX(1)" }], { duration: 300, easing: EASE_SPRING });
};
// Slide a pill to the active child of `container`. The box reads come before the writes so a
// measure can't force an extra layout; the stretch runs on a real move.
const measurePill = (container: Element, pill: HTMLElement, animate?: boolean) => {
  const a = container.querySelector<HTMLElement>('[data-active="true"]'); if (!a) return;
  const left = a.offsetLeft, width = a.offsetWidth, prev = parseFloat(pill.style.left);
  pill.style.left = left + "px"; pill.style.width = width + "px";
  if (animate && Number.isFinite(prev) && prev !== left) stretchPill(pill, left > prev ? 1 : -1);
};
// Slider rubber-band (slider + interval): dragged past an end by more than a 32px dead zone, the
// track widens toward the cursor, up to 8px on a sqrt falloff over the next 200px. rect is the wrap's box at press.
const RUBBER_DEAD = 32, RUBBER_RANGE = 200, RUBBER_MAX = 8;
const rubberBand = (track: HTMLElement, rect: DOMRect, clientX: number) => {
  const over = clientX < rect.left ? clientX - rect.left : clientX > rect.right ? clientX - rect.right : 0;
  const s = Math.sign(over) * RUBBER_MAX * Math.sqrt(Math.min(Math.max(0, Math.abs(over) - RUBBER_DEAD) / RUBBER_RANGE, 1));
  track.style.width = s ? `calc(100% + ${Math.abs(s)}px)` : "";
  track.style.transform = s < 0 ? `translateX(${s}px)` : "";
};
// Release: spring the track home, then drop the transition so the next drag tracks 1:1.
const rubberRelease = (track: HTMLElement) => {
  track.style.transition = `width 0.35s ${EASE_SPRING}, transform 0.35s ${EASE_SPRING}`;
  track.style.width = ""; track.style.transform = "";
  setTimeout(() => { track.style.transition = ""; }, 360);
};

// Disable a row: `inert` goes on the children, not the row — an inert element hit-tests like
// pointer-events:none, so an inert row would never show its not-allowed cursor.
const setDisabled = (node: HTMLElement, d: boolean) => {
  node.classList.toggle("is-disabled", d); for (const c of node.children) if (!c.classList.contains("tw-portal")) (c as HTMLElement).inert = d; // a closed popover child keeps its own inert
  if (d) closeActivePopover(node); // an open pane is portaled out of reach of inert: a control disabled mid-edit closes it
};
// Collapse a section: the fold class, aria-expanded, and `inert` on the body so hidden controls leave the tab order.
const setCollapsed = (root: Element, toggle: Element, body: HTMLElement, c: boolean) => { root.classList.toggle("is-collapsed", c); toggle.setAttribute("aria-expanded", String(!c)); body.inert = c; };
// …and animate the fold over only the visible height: content past the height cap or the window would otherwise stall,
// then snap. Without the Animations API, or with reduced motion, the CSS transition runs; `done` runs once settled.
type Folding = HTMLElement & { _twFold?: Animation | null };
const foldBody = (root: Element, toggle: Element, body: Folding, c: boolean, done?: () => void) => {
  if (REDUCE_MOTION.matches || typeof body.animate !== "function") { setCollapsed(root, toggle, body, c); if (done) setTimeout(done, 370); return; }
  // Everything read before the class flips, so a collapse forces no layout after it.
  const r = body.getBoundingClientRect(), from = r.height; // mid-fold, the height it's drawn at
  const panel = root.closest<HTMLElement>(".tw-panel"), cs = panel && getComputedStyle(panel), maxH = cs ? parseFloat(cs.maxHeight) : NaN; // border-box, so the cap includes the padding
  const capBottom = cs && panel.dataset.mode === "floating" && maxH >= 0 ? panel.getBoundingClientRect().top + maxH - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth) : Infinity;
  const room = Math.max(0, Math.min(window.innerHeight, capBottom) - r.top), easing = getComputedStyle(body).getPropertyValue("--tw-ease-fold").trim();
  body._twFold?.cancel(); body._twFold = null;
  body.style.transition = "none"; body.style.gridTemplateRows = "";
  setCollapsed(root, toggle, body, c);
  let to = 0; // collapsed is always 0
  if (!c) {
    // Finish the folder's padding transition first: it's hidden under the fold, and the end height must include it.
    for (const a of body.firstElementChild?.getAnimations?.() ?? []) if ((a as CSSTransition).transitionProperty !== "opacity") a.finish();
    to = body.getBoundingClientRect().height;
  }
  const f = Math.min(from, room), t = Math.min(to, room);
  // fill: forwards holds the last frame until the 1fr comes off; otherwise one frame would draw the whole body.
  const finish = () => { body.style.gridTemplateRows = ""; void body.offsetHeight; body._twFold?.cancel(); body._twFold = null; body.style.transition = ""; done?.(); };
  if (Math.abs(f - t) < 1) return finish();
  body.style.gridTemplateRows = "1fr"; // the rows stay laid out under the fold, clipped from the bottom
  const a = body._twFold = body.animate([{ height: f + "px" }, { height: t + "px" }], { duration: 350, easing, fill: "forwards" });
  a.onfinish = () => { if (body._twFold === a) finish(); };
};
// The button whose (stringified) value is active — or, when none matches, the first: the
// group's roving tab stop. Only an empty group gives −1.
const activeIndex = (btns: RadioBtn[], value: unknown) => { const i = btns.findIndex((b) => b.dataset.value === String(value)); return i < 0 && btns.length ? 0 : i; };
// Reflect a single-select value onto a radio group: data-active, aria-checked, and a roving
// tabindex. Paint follows the real match; the tab stop follows activeIndex's fallback.
const setRadioActive = (btns: RadioBtn[], value: unknown) => { const stop = activeIndex(btns, value); btns.forEach((b, k) => { const on = b.dataset.value === String(value); b.dataset.active = String(on); b.setAttribute("aria-checked", String(on)); b.tabIndex = k === stop ? 0 : -1; }); };
// A single-select radio button. _twVal carries the option's real value — dataset stringifies,
// so a keyboard pick off dataset.value turned a numeric option into a string.
const radioButton = (cls: string, o: Option, onPick: (v: string) => void) => { const b: RadioBtn = txt("button", cls, optLabel(o)); b.setAttribute("role", "radio"); b._twVal = optValue(o); b.dataset.value = b._twVal; b.addEventListener("click", () => onPick(b._twVal)); return b; };
// Arrow-key navigation → the next index, or −1 when the key isn't the group's. cols > 0 jumps
// ↑/↓ by a row (the radio grid); 0 treats ↑/↓ as ←/→; < 0 leaves ↑/↓ to the page (the tab bar).
const navIndex = (key: string, i: number, n: number, cols = 0) => {
  switch (key) {
    case "ArrowRight": return (i + 1) % n;
    case "ArrowLeft": return (i - 1 + n) % n;
    case "ArrowDown": return cols < 0 ? -1 : cols ? (i + cols < n ? i + cols : i) : (i + 1) % n;
    case "ArrowUp": return cols < 0 ? -1 : cols ? (i - cols >= 0 ? i - cols : i) : (i - 1 + n) % n;
    case "Home": return 0;
    case "End": return n - 1;
  }
  return -1;
};
// ── Segmented control — a single-select pill row (the boolean toggle, the spring's mode switch). ──
// `onIs`: the boolean toggle, a two-segment row that is one switch to a screen reader (role="switch", aria-checked, one tab
// stop, Space or Enter flips it) rather than "radio button, On, 2 of 2"; its Off/On segments stay as the pointer's targets.
function createSegmented(options: Option[], value: unknown, onChange: OnChange, ariaLabel?: string, onIs?: unknown) {
  const sw = onIs !== undefined, seg = el("div", "tw-seg"); seg.setAttribute("role", sw ? "switch" : "radiogroup");
  if (ariaLabel) seg.setAttribute("aria-label", ariaLabel);
  if (sw) seg.tabIndex = 0;
  const pill = el("div", "tw-seg-pill");
  seg.append(pill);
  const btns = options.map((o) => { const b = radioButton("tw-seg-btn", o, (v) => set(v)); if (sw) { b.setAttribute("aria-hidden", "true"); b.addEventListener("focus", () => seg.focus()); } seg.append(b); return b; }); // lazy `set` — it's declared below; a clicked segment hands focus to the switch, never parks it hidden
  const measure = (animate?: boolean) => measurePill(seg, pill, animate);
  const reflect = () => { setRadioActive(btns, value); if (sw) { seg.setAttribute("aria-checked", String(value === onIs)); btns.forEach((b) => (b.tabIndex = -1)); } measure(true); };
  const set = (v: unknown, fire = true) => { if (v != null && !btns.some((b) => b._twVal === v)) return; value = v; reflect(); if (fire) onChange(v); }; // null clears; a value matching no segment is ignored
  seg.addEventListener("keydown", (e) => {
    const i = activeIndex(btns, value); if (i < 0) return;
    if (sw && (e.key === " " || e.key === "Enter")) { e.preventDefault(); set(btns[1 - i]._twVal); return; }
    // A switch's arrows point at a side, Off or On, and stop there: wrapping, → on On turned it off.
    const j = sw ? ({ ArrowRight: 1, ArrowUp: 1, End: 1, ArrowLeft: 0, ArrowDown: 0, Home: 0 } as Record<string, number>)[e.key] ?? -1 : navIndex(e.key, i, btns.length); if (j < 0) return;
    e.preventDefault(); set(btns[j]._twVal); (sw ? seg : btns[j]).focus(); // _twVal: the real, possibly non-string value
  });
  reflect();
  onReady(() => { measure(); seg.classList.add("is-ready"); }); // once laid out, again when fonts land
  // A tab page revealing this control re-measures the pill, built at 0×0 while display:none.
  onLive(seg, [[window, "tw-reflow"]], () => measure());
  return { el: seg, set: (v: unknown) => set(v, false), get: () => value };
}

// One stroke-icon shell for every inline SVG. It lives here, not in icons.ts, because a lazy
// control imports it: anything both core and a lazy chunk import must sit in the shared chunk,
// or esbuild hoists the module into a third chunk every basic panel has to fetch.
const icon = (body: string, cls = "", width = 2, box = 24) => `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 ${box} ${box}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

// The handle a display/action control returns: no value, so build skips entry/reset/persist
// wiring. `destroy` lets panel.destroy() stop a control's loop even if the panel never connected.
const blade = (el: HTMLElement, destroy?: () => void): Control => ({ el, set: () => {}, get: () => undefined, destroy });

// ── Control registry — type → constructor. Core controls register on load; a lazy one when
// its module is imported, so the loaded set drives what can be built. ──
const REGISTRY: Record<string, ControlCtor<any, any>> = {}; // heterogeneous by design — see ControlCtor
export const registerControl = (type: string, ctor: ControlCtor<any, any>) => { REGISTRY[type] = ctor; };
export const getControl = <C = Control, M = Meta>(type: string): ControlCtor<M, C> | undefined => REGISTRY[type];
export const controlTypes = () => Object.keys(REGISTRY);
// The names people reach for: `bezier` is the cubicbezier control, and `toggle` or `switch` the checkbox, which draws as an
// Off/On switch. A schema's `type` and markup's data-tw both read through this.
export const TYPE_ALIASES: Record<string, string> = Object.assign(Object.create(null), { bezier: "cubicbezier", toggle: "checkbox", switch: "checkbox" });
// The markup chunk's enhance(), registered when markup.ts loads (enhance.ts fetches it, or single.ts imports it).
let MARKUP: ((root: Document | Element, kit: any) => Promise<void>) | null = null; // any: the kit's type lives in markup.ts, which imports this
export const setMarkup = (fn: typeof MARKUP) => { MARKUP = fn; };
export const getMarkup = <K>() => MARKUP as ((root: Document | Element, kit: K) => Promise<void>) | null;

// What a click or a run of keys did, in words, for a screen reader: one visually hidden status region for the page,
// where the toast used to speak. It's cleared and written a beat later, so the same words twice are read twice.
let srEl: HTMLDivElement | null = null, srT = 0;
const announce = (msg: string) => {
  if (!srEl) { srEl = el("div", "tw-sr"); srEl.setAttribute("role", "status"); }
  if (!srEl.isConnected) document.body.appendChild(srEl); // re-home after a host replaced <body>'s content
  srEl.textContent = ""; clearTimeout(srT); srT = setTimeout(() => { srEl!.textContent = msg; }, 100);
};

export {
  titleCase, clamp, isObj, isColorStr, stepPrecision, gridEnds, roundToStep, inferStep, defaultRange,
  normalizeRange, swapNote, notice, rangeStep, overlapsText,
  optValue, optLabel, json, el, btn, txt, stopPointerLeak, onReady, onLive, requestReflow,
  wireHoverClass, popover, closeActivePopover,
  resolveTheme, applyThemeVars, carryScheme, carrySkin, fuzzyMatch, setCollapsed, foldBody, setDisabled, activeIndex, setRadioActive, radioButton, navIndex, createSegmented,
  blade, quietFocus, escapeReverts, measurePill, rubberBand, rubberRelease, REDUCE_MOTION, EASE_SPRING, EASE_GLIDE, icon, announce,
};
export type { OnChange, ThemeVars, PanelEl, RadioBtn, Built, NumSpec, NumField, Popover, ControlCtor };
// Re-exported for the chunking: core and the gradient control both import easing.ts, and a
// module only those two reach would become a chunk of its own (test/chunks.test.mjs holds it
// to three). Core exports from easing.ts directly so the .d.ts prune skips shared.ts internals.
export { gradientCss, gradientStops } from "./easing.js";

