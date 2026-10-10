/* Tweaks — shared building blocks: DOM + math helpers, drag/scrub gestures,
 * the numeric field, theming, and the control registry. Pure, side-effect-free
 * declarations; core.js and the lazy controls/*.js import what they each use. */
import type { Control, Option, Panel, Theme } from "./types.js";
import type { Meta } from "./schema.js";

// ── Internal types — the shapes the modules pass between them. ──
/** A control's change callback: the new value, as the control emits it. */
type OnChange = (value: unknown) => void;
/** The resolved `--tw-*` custom-property map a theme turns into (resolveTheme). */
type ThemeVars = Record<string, string>;
/** A panel root. panel.ts hangs its live theme, its edit-lifecycle hook and its ready
 *  promise on the node, and the portal helpers here read them back off
 *  `closest(".tw-panel")` — the one place the kit uses element expandos for panel state. */
interface PanelEl extends HTMLElement { _twTheme?: ThemeVars | null; _twEditPointer?: (e: PointerEvent) => void; ready?: Promise<Panel> }
/** A node applyThemeVars has written to — it remembers which properties, to clear them on
 *  the next application (the portaled singletons re-theme on every show). */
interface ThemedEl extends HTMLElement { _twAppliedVars?: string[] | null }
/** A single-select radio button carrying its option's real value (dataset stringifies). */
interface RadioBtn extends HTMLButtonElement { _twVal?: string }
/** What setAttribute() and style.setProperty() accept on an element the kit built: a
 *  number as well as a string. The DOM stringifies either, and the kit writes SVG geometry
 *  and the counts behind its custom properties straight from numbers — so the factories
 *  below return this, and those call sites type-check as they are. Type-level only. */
interface Stringifying { setAttribute(name: string, value: string | number): void; style: { setProperty(name: string, value: string | number | null, priority?: string): void } }
type Built<E extends Element> = E & Stringifying;
/** The labelled numeric field's spec (numField) — the Number control's meta, or a boxed
 *  field's own label + range inside a composite control. */
interface NumSpec { label: string; value?: unknown; min?: unknown; max?: unknown; step?: unknown; soft?: boolean; row?: boolean }
/** The numeric field's handle: set() coerces and fits, get() reads the fitted number. */
interface NumField { el: HTMLDivElement; set(v: number | string): void; get(): number }
/** The popover shell's handle (popover). */
interface Popover { open(): void; close(): void; isOpen(): boolean; reflow(): void }
/** A control constructor: the normalized meta in, a handle out. Folder, tabs and the
 *  color picker body hand back richer handles (and the body takes its own options), so
 *  the registry holds every constructor under the loose form and a lookup names the
 *  shape it expects — `getControl<TabsControl>("tabs")`. */
type ControlCtor<M = Meta, C = Control> = (meta: M, onChange?: OnChange) => C;

// ── helpers ──
const titleCase = (s: string) => s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
// A colour-valued string: hex, or any CSS colour function (oklch/rgb/hsl/…). Used
// to route a schema string to the colour control (a plain label stays a string).
const isColorStr = (v: unknown) => typeof v === "string" && (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.trim()) || /^(oklch|oklab|rgba?|hsla?|hwb|lab|lch|color)\(/i.test(v.trim()));
// Capped at 100 — the ceiling toFixed() accepts. A sub-1e-100 step (finite, positive, so
// it clears every step guard) otherwise produced a digit count that threw RangeError out
// of roundToStep, which degraded the whole control to "skipped" at construction.
const MAX_FIXED = 20; // toFixed's own ceiling is 100, but a readout past 20 decimals is noise (a 1e-120 step painted a hundred zeros over its label)
const stepPrecision = (step: number) => {
  const t = String(step);
  // Scientific notation (e.g. 1e-7 → 7): String(1e-7) === "1e-7" has no ".", so a plain
  // index-of would wrongly report 0 decimals and round fine steps to whole numbers.
  const e = /e-(\d+)$/i.exec(t);
  if (e) return Math.min(MAX_FIXED, Number(e[1]) + (t.split("e")[0].split(".")[1] || "").length);
  const i = t.indexOf(".");
  return i === -1 ? 0 : Math.min(MAX_FIXED, t.length - i - 1);
};
// Round to the min-anchored step grid, on the step's decimals. The anchor is min rounded
// to those decimals too: a finer min (0.5 on a step-1 grid, -Math.PI on a 0.01 grid) put
// every grid point half a decimal off the rounding, and at exactly half a step the two
// roundings compounded — each round-to-step (a reset, a restore, set(get())) walked the
// value up by a step (3 → 4 → 5 …).
const roundToStep = (v: number, min: number, step: number) => {
  if (!(step > 0)) return v;
  const p = stepPrecision(step), a = Number((+min).toFixed(p));
  const n = Math.round((v - a) / step); if (!Number.isFinite(n)) return v; // a huge finite value (a soft slider's set(1e308)) divided by a small step overflows; the raw value is still finite, so keep it
  return Number((a + n * step).toFixed(p));
};
// The reachable ends of a [min, max] step grid: the first grid point at or above min and the
// last at or below max. Clamping to an off-grid bound (max 14.45 on a step-1 grid) left a
// value the readout showed rounded and the next round-to-step moved — or, on a slider, one
// past max. A range too narrow to hold a grid point pins to its min (one value, so the
// clamp stays a fixed point — raw [min, max] ends had the value walking between them).
// ±Infinity = open.
const gridEnds = (min: number, max: number, step: number, anchor = min): [number, number] => {
  const r = (v: number) => roundToStep(v, anchor, step);
  let lo = Number.isFinite(min) ? r(min) : -Infinity, hi = Number.isFinite(max) ? r(max) : Infinity;
  if (lo < min) lo = r(lo + step);
  if (hi > max) hi = r(hi - step);
  return lo > hi ? [min, min] : [lo, hi];
};
const inferStep = (min: number, max: number) => {
  const range = max - min;
  if (range <= 1) return 0.01;
  if (range <= 10) return 0.1;
  if (range <= 100) return 1;
  return 10;
};
// Normalise a slider-style range before anything reads it: non-finite bounds take
// the defaults (max defaults to min+100 when no explicit fallback is given), an
// inverted pair swaps (a backwards schema/markup used to clamp the value to the
// wrong end), and a degenerate step re-infers. Every range source — schema
// shorthand, verbose form, [data-tw] markup — funnels through here; the slider
// and the interval share it.
const normalizeRange = (rawMin: unknown, rawMax: unknown, rawStep: unknown, defMin = 0, defMax: number | null = null) => {
  let min = +rawMin, max = +rawMax, step = +rawStep;
  if (!Number.isFinite(min)) min = defMin;
  if (!Number.isFinite(max)) max = defMax != null ? defMax : min + 100;
  if (max < min) { const t = min; min = max; max = t; }
  if (!(step > 0) || step > max - min) step = inferStep(min, max); // a step too fine to count in (a denormal) is harmless downstream: roundToStep keeps the raw value when the grid index overflows, and readouts cap at MAX_FIXED decimals
  return { min, max, step };
};
// One keyboard model for every 1-D range surface (the slider track, the interval
// handles, the colour picker's alpha strip): arrows step (⇧ = ×10 coarse), Home/End
// snap to the given ends, PageUp/Down jump by `page` when the surface supports it.
// Returns the next value, or null when the key isn't the range's to handle — the
// caller preventDefaults and clamps/commits on non-null.
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
// The label/value dodge shared by the slider + interval: does a handle's pixel span
// [hx, hx+hw] overlap the leading label or the trailing value text? Spans are read
// live (offsetLeft/offsetWidth) so they track the CSS and any font swap; `m` is the
// optional near-miss buffer on the value side.
const overlapsText = (labelEl: HTMLElement, valueEl: HTMLElement, hx: number, hw: number, m = 0) => {
  const ll = labelEl.offsetLeft, lr = ll + labelEl.offsetWidth;
  const vl = valueEl.offsetLeft, vr = vl + valueEl.offsetWidth;
  return (hx < lr && hx + hw > ll) || (hx < vr + m && hx + hw > vl - m);
};
// Default range for a numeric entry with no explicit bounds: 0–1 keeps a 0–1 range,
// a positive spans 0–3× (100 as a last resort), and a negative mirrors that below
// zero (−1–0 / 3×–0) — a negative default used to produce max −3×|v| with min 0, an
// inverted range that clamped the value to the wrong end. Shared by the bare-number
// and short-array schema branches so the heuristic lives in one place.
const defaultRange = (v: number): [number, number] => (v >= 0 ? [0, v <= 1 ? 1 : v * 3 || 100] : [v >= -1 ? -1 : v * 3, 0]);

// Options may be strings, { value, label } objects, or bare primitives (numbers,
// booleans — e.g. a five-number array inferring as a list): a primitive is its own
// value, labelled by its string form. (Primitives used to fall into the object arm
// and read `.value` off a number — empty labels, undefined values.)
const optValue = (o: Option) => (o == null ? undefined : typeof o === "object" ? o.value : o);
// An object's readable form for a label or readout: its JSON, or String() when it can't
// be stringified (a circular value) — never a throw out of a build, never "[object Object]".
const json = (v: unknown) => { try { return JSON.stringify(v); } catch { return String(v); } };
const optLabel = (o: Option) => (o == null ? "" : typeof o === "string" ? titleCase(o) : typeof o === "object" ? o.label ?? (o.value !== undefined ? String(o.value) : json(o)) : String(o)); // label is optional on { value } options — fall back to the value's string form, and an object with neither to its JSON, never the literal "undefined"

// el is the internal DOM factory, typed by tag the way createElement is (so a
// div / input / canvas each read back as their own element; svgEl in heavy.ts is its SVG twin) — see Built above for
// the one allowance they add. The public API (types.ts) is fully typed.
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): Built<HTMLElementTagNameMap[K]> => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
// The two element shapes the kit builds everywhere: a non-submitting button (every
// <button> here is type="button" — inside a host's <form>, the default "submit" would
// post the page), and a text-bearing node (textContent, never innerHTML — labels are
// host data). txt("button", …) is the text-labelled button, so it carries the same type.
const btn = (cls: string, html?: string) => { const b = el("button", cls, html); b.type = "button"; return b; };
const txt = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text: string) => { const n = el(tag, cls); n.textContent = text; if (tag === "button") (n as HTMLButtonElement).type = "button"; return n; };
// Stop a node's pointer events leaking to the page behind it (the panel + the
// popovers portaled to <body>, which sit outside the panel's own pointer-stop).
const stopPointerLeak = (node: EventTarget) => ["pointerdown", "pointermove", "pointerup"].forEach((t) => node.addEventListener(t, (e) => e.stopPropagation()));
// Run fn next frame (after layout) and again once web fonts load — canvas/SVG
// controls measure their box, and font swaps change metrics.
const onReady = (fn: () => void) => { requestAnimationFrame(fn); if (document.fonts && document.fonts.ready) document.fonts.ready.then(fn); };
// Listen on global targets (window / document / a media query) for a DOM-bound owner:
// the first event arriving after the owner has left the document drops the whole
// listener set — the kit-wide self-cleaning idiom (sliders re-rendering their dodge on
// resize, canvases re-fitting, the floating panel's viewport clamp). "Left" means it was
// connected once: an event in the window between build and the host's append (a second
// panel built but not yet mounted, a resize mid-construction) is skipped, not fatal — it
// used to unsubscribe permanently, so the owner mounted deaf. Returns the release fn
// for owners that also tear down eagerly (panel.destroy()).
const onLive = (owner: Element, targets: Array<[EventTarget, string]>, fn: (e?: Event) => void) => {
  let mounted = owner.isConnected;
  // A host appends the owner right after building it, in the same task — before any event
  // can arrive. Note that mount next frame, so an unmount with no event in between (an SPA
  // route change, no destroy()) still releases on the first event after it, instead of never.
  if (!mounted) requestAnimationFrame(() => { if (owner.isConnected) mounted = true; });
  const h = (e: Event) => { if (!owner.isConnected) { if (mounted || owner.closest("[data-tw-destroyed]")) off(); return; } mounted = true; fn(e); }; // a destroyed panel / standalone wrapper marks itself, so a listener that never saw the owner connected still releases
  const off = () => targets.forEach(([t, ev]) => t.removeEventListener(ev, h));
  targets.forEach(([t, ev]) => t.addEventListener(ev, h));
  return off;
};
// Ask every measured surface (canvas/SVG controls, the segmented + tabs pills, the
// slider dodge) to re-measure next frame — the owner of a display:none → shown flip
// (a tab page, a render condition, the filter) dispatches it once the box is real.
// Namespaced, not a real "resize": host pages listen to that.
const requestReflow = () => requestAnimationFrame(() => window.dispatchEvent(new Event("tw-reflow")));
// Toggle .is-hover while the pointer is over a node; onEnter runs on entry (the slider
// + interval re-render their value-dodge with the real track width on first hover).
const wireHoverClass = (el: HTMLElement, onEnter?: () => void) => {
  el.addEventListener("pointerenter", () => { el.classList.add("is-hover"); onEnter && onEnter(); });
  el.addEventListener("pointerleave", () => el.classList.remove("is-hover"));
};
// ── Quiet mouse focus — :focus-visible always matches a focused text field, however
// focus arrived (the spec treats text entry as "keyboard imminent"), so a plain click
// into one drew the heavy keyboard ring. The text-field counterpart of the sliders'
// focus({ focusVisible: false }): one document-level modality note (a pointer press
// quiets the next focus, any key restores the ring — so Tab always rings, and the
// note arriving mid-edit doesn't re-ring a field being typed in). The pair of
// capture listeners installs once per page, shared by every panel. ──
let pointerModality = false;
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", () => { pointerModality = true; }, true);
  document.addEventListener("keydown", () => { pointerModality = false; }, true);
}
const quietFocus = (input: HTMLElement) => {
  input.addEventListener("focus", () => input.classList.toggle("tw-focus-quiet", pointerModality));
  input.addEventListener("blur", () => input.classList.remove("tw-focus-quiet"));
};
// Place a portaled popover under its trigger — flipping above when it won't fit below —
// clamped into the viewport. width:"match" sizes it to the trigger; a number is the
// fallback width to use before layout; align:"end" lines up the right edges instead
// (the presets menu, which hangs off a toolbar button near the panel's right edge).
export const placeBelow = (trigger: Element, pop: HTMLElement, { width, fallbackH = 300, gap = 6, align = "start", prefer = "below" }: { width?: number | "match"; fallbackH?: number; gap?: number; align?: "start" | "end" | "center"; prefer?: "above" | "below" } = {}) => {
  const r = trigger.getBoundingClientRect();
  if (width === "match") pop.style.width = r.width + "px";
  const w = width === "match" ? r.width : (pop.offsetWidth || width || 0);
  const x = align === "end" ? r.right - w : align === "center" ? r.left + r.width / 2 - w / 2 : r.left;
  pop.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + "px";
  const h = pop.offsetHeight || fallbackH;
  const below = window.innerHeight - r.bottom, above = r.top, need = h + 12;
  // Open on the preferred side if it fits; else the opposite side if THAT fits; else
  // whichever side has more room — so a surface too tall for either side overflows the
  // least, instead of always falling to the preferred side. (prefer="above" = tooltips.)
  const fitsBelow = below >= need, fitsAbove = above >= need;
  const goAbove = prefer === "above" ? (fitsAbove || (!fitsBelow && above >= below)) : (!fitsBelow && (fitsAbove || above > below));
  const top = goAbove ? r.top - h - gap : r.bottom + gap;
  pop.style.top = clamp(top, gap, window.innerHeight - h - gap) + "px"; // clamp Y into the viewport so a tall surface can't open off a short screen
};

// ── Theming — the panel runs entirely on --tw-* custom properties, so a theme is
// just a set of those vars. resolveTheme turns a friendly object into a {var: value}
// map; applyThemeVars sets them inline. Raw "--tw-*" keys pass straight through; the
// aliases below cover the common levers. Anything unset falls back to the CSS default,
// so no theme === the default monochrome look, and partial themes only move what they name.
// Friendly name → token. The full themeable surface — every lever the look runs on,
// so a theme can reach all of it by readable name (raw "--tw-*" keys also pass through).
// Null-prototype, like every other lookup table the kit indexes with caller data (the
// plot whitelist, the presets bag): a theme key of "constructor" / "toString" must MISS,
// not resolve to an inherited member and mint a garbage custom-property name.
const THEME_ALIASES: Record<string, string> = Object.assign(Object.create(null), {
  // colour — backdrops
  accent: "--tw-accent", onAccent: "--tw-on-accent", base: "--tw-base", dropdownBg: "--tw-dropdown-bg",
  surface: "--tw-surface", surfaceHover: "--tw-surface-hover", surfaceActive: "--tw-surface-active",
  border: "--tw-border", borderHover: "--tw-border-hover", selection: "--tw-selection",
  // colour — text tones
  title: "--tw-text-root", section: "--tw-text-section", text: "--tw-text-primary", label: "--tw-text-label",
  textMuted: "--tw-text-secondary", textFaint: "--tw-text-tertiary", focus: "--tw-text-focus",
  success: "--tw-success", danger: "--tw-danger",
  // elevation
  shadow: "--tw-shadow-dropdown", shadowPanel: "--tw-shadow-panel", shadowPanelLifted: "--tw-shadow-panel-lifted",
  // type + shape
  font: "--tw-font-sans", fontMono: "--tw-font-mono", radius: "--tw-radius", density: "--tw-row-height", // numeric → px
});
const TW_PX_ALIASES = new Set(["radius", "density"]);
// On-accent text (the active segment pill / radio cell sits a label on the accent). Pick
// black or white by the accent's WCAG relative luminance, whichever contrasts more — so a
// bright accent (green, orange) stays legible where the panel's own light/dark text would
// wash out. Hex (#rgb / #rrggbb) and rgb()/rgba() are read; anything else falls back to
// white (most accents are mid-to-dark). Lightweight on purpose: shared.ts can't pull the
// lazy wide-gamut engine, and sRGB luminance is all the black-or-white choice needs.
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
    if (k.startsWith("--")) { out[k] = String(v); continue; }
    const name = THEME_ALIASES[k]; if (!name) continue;
    out[name] = TW_PX_ALIASES.has(k) && typeof v === "number" ? `${v}px` : String(v);
  }
  // An accent without an explicit on-accent gets a legible one derived from its luminance.
  if (out["--tw-accent"] && !out["--tw-on-accent"]) out["--tw-on-accent"] = onAccentText(out["--tw-accent"]);
  return Object.keys(out).length ? out : null;
};
// Reused portaled nodes (popover, hint tip, toast) re-theme on every show — clear the
// previous application first, so a null/partial theme actually reverts what it no longer names.
const applyThemeVars = (node: ThemedEl | null | undefined, vars: ThemeVars | null | undefined) => {
  if (!node) return;
  if (node._twAppliedVars) for (const k of node._twAppliedVars) node.style.removeProperty(k);
  node._twAppliedVars = vars ? Object.keys(vars) : null;
  if (vars) for (const k in vars) node.style.setProperty(k, vars[k]);
};
// Carry a forced scheme onto a node that portals to <body> (popover, tip, toast, a
// lifted panel) — the [data-tw-scheme] scope that styles the anchor's subtree can't
// reach a portal via the cascade. Copy the WINNING scheme, not the nearest pin:
// pins resolve flat (a light pin anywhere outranks dark — see the scheme-resolution
// comment in tweaks.css), so nearest-wins under light>dark nesting would put a dark
// portal on a light panel.
const carryScheme = (portal: Element, anchor: Element | null | undefined) => {
  const s = anchor?.closest('[data-tw-scheme="light"]') ? "light" : anchor?.closest('[data-tw-scheme="dark"]') ? "dark" : null;
  if (s) portal.setAttribute("data-tw-scheme", s); else portal.removeAttribute("data-tw-scheme");
};
// …and the anchor panel's live theme with it (resolved at carry time — setTheme()
// swaps the panel's _twTheme object, so a build-time capture would pin stale vars).
const carrySkin = (portal: HTMLElement, anchor: Element | null | undefined) => { applyThemeVars(portal, anchor?.closest<PanelEl>(".tw-panel")?._twTheme); carryScheme(portal, anchor); };

// ── Popover — the one portal-to-<body> shell behind every transient surface: the
// colour picker, the gradient editor, the select dropdown, and the presets menu.
// It opens under its trigger (placeBelow, flipping up when it won't fit), carries
// the host panel's theme onto the portaled node, and closes on outside-press /
// Esc / scroll-away. Globally single-open — opening any popover closes whichever
// other one is up. onOpen runs once it's placed at real size (then it re-places,
// so content rendered in onOpen is measured); onReflow on scroll/resize while open.
let activePopoverClose: null | (() => void) = null, activePopoverTrigger: HTMLElement | null = null;
// Panel teardown closes the open popover — but only its own: with `owner` given, the
// close runs only when the open popover's trigger lives inside it (destroying panel A
// used to dismiss the menu or picker open on panel B). No owner closes whichever is up.
const closeActivePopover = (owner?: Element) => { if (activePopoverClose && (!owner || owner.contains(activePopoverTrigger))) activePopoverClose(); };
function popover(root: HTMLElement, trigger: HTMLButtonElement, pop: HTMLElement, opts: { width?: number | "match"; fallbackH?: number; gap?: number; align?: "start" | "end"; onOpen?: () => void; onReflow?: () => void; initialFocus?: () => HTMLElement | null | undefined } = {}): Popover {
  let open = false, schemeObs: MutationObserver | null = null;
  pop.classList.add("tw-portal"); // the reduced-motion kill-switch + portal-wide rules key off this
  // A closed pop is still in the DOM — inside the control root until its first open, on
  // <body> through the 200 ms fade after a close — at opacity 0. `inert` keeps its tab
  // stops out of the tab order and its names out of the accessibility tree until it opens:
  // without it, Tab from the trigger landed on an invisible plane and arrows edited the value.
  pop.inert = true;
  // Relay pointerdowns to the host panel's edit-lifecycle hook (capture, ahead of the
  // pointer-stop below) — the colour/gradient drag surfaces live here on <body>, where
  // the panel's own pointerdown listener can't see them.
  pop.addEventListener("pointerdown", (e) => trigger.closest<PanelEl>(".tw-panel")?._twEditPointer?.(e), true);
  stopPointerLeak(pop); // on <body>, outside the panel's own pointer-stop
  const place = () => placeBelow(trigger, pop, { width: opts.width, fallbackH: opts.fallbackH, gap: opts.gap, align: opts.align });
  // A reflow against a detached trigger would place off its zero-rect (the pop jumps to
  // the viewport corner) — if the host has unmounted the panel, close instead.
  const reflow = () => { if (open) { if (!root.isConnected) return close(); place(); opts.onReflow && opts.onReflow(); } };
  const onOutside = (e: PointerEvent) => { if (!root.contains(e.target as Node) && !pop.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && open) { close(); trigger.focus(); } };
  // Focus leaving both the pop and its trigger (Tab past the last field, Shift+Tab off
  // the first) closes, so a keyboard user never leaves a portaled surface stranded open
  // behind them. A blur with no relatedTarget is ambiguous: a press on a non-focusable
  // drag surface inside the pop (the colour plane) blurs the hex field to <body> too, so
  // the modality note decides — a pointer-origin blur is left to the outside-press path.
  // A keyboard move that lands outside the host panel (the portaled pop sits at the end
  // of <body>, so Tab wraps to the top of the page) comes back to the trigger instead —
  // the pop's place in the tab order — a tick later, once the browser's own focus move
  // has finished. A pointer press elsewhere closed on pointerdown, so it never gets here.
  const onFocusOut = (e: FocusEvent) => {
    if (!open) return; const t = e.relatedTarget as Node | null;
    if (t ? root.contains(t) || pop.contains(t) : pointerModality) return;
    close();
    if (t && !trigger.closest(".tw-panel")?.contains(t)) setTimeout(() => { if (!open && document.activeElement === t) trigger.focus(); }, 0);
  };
  root.addEventListener("focusout", onFocusOut); pop.addEventListener("focusout", onFocusOut);
  // The first keyboard-reachable element inside the pop, for the focus move on open.
  const firstFocusable = () => pop.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
  // Re-carry the host scheme + theme while open. The portaled node took them at open
  // time and the cascade can't reach <body>, so a mid-open scheme flip (a dark-mode
  // toggle, the theming demo's segmented control) or a setTheme() would otherwise strand
  // a mismatched popover. The observer ignores its own carry's attribute write on `pop`.
  const recarry = () => carrySkin(pop, root);
  const onScheme = (recs: MutationRecord[]) => { if (!recs.every((r) => r.target === pop)) recarry(); };
  const openPop = () => {
    if (activePopoverClose && activePopoverClose !== close) activePopoverClose(); // close any other open popover first
    activePopoverClose = close; activePopoverTrigger = trigger;
    open = true; root.classList.add("is-open"); trigger.setAttribute("aria-expanded", "true");
    pop.inert = false; document.body.appendChild(pop);
    carrySkin(pop, root); // the host panel's theme + winning scheme, neither of which the cascade can deliver to <body>
    window.addEventListener("tw-retheme", recarry); // setTheme() while open
    if (typeof MutationObserver === "function") { schemeObs = new MutationObserver(onScheme); schemeObs.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-tw-scheme"] }); } // host scheme flip while open
    place();
    requestAnimationFrame(() => {
      if (!open) return; // a same-tick close (a destroy() right after the open) already ran: showing the dead pop and focusing into it would undo that close
      pop.classList.add("is-open"); opts.onOpen && opts.onOpen(); place(); // render at real size, then re-place (height may have changed)
      // Focus moves into the pop on open — a trigger opened with Enter otherwise kept
      // focus, and Tab walked straight past the portaled node (it sits at the end of
      // <body>). An onOpen that placed focus itself (the listbox's selected option, the
      // gradient's selected stop, via initialFocus) wins; otherwise the first focusable.
      // A pointer-opened pop takes focus quietly (no ring); browsers without the option ignore it.
      if (!pop.contains(document.activeElement)) { const f = (opts.initialFocus && opts.initialFocus()) || firstFocusable(); if (f) f.focus({ focusVisible: !pointerModality }); }
    });
    // Unmount watchdog: a host that removes the panel while this is open (an SPA route
    // change) would otherwise strand the portaled pop on screen — visible and interactive
    // over whatever renders next — until something else was pressed. One rAF per frame,
    // only while the (globally single) popover is open.
    requestAnimationFrame(function watch() { if (!open) return; if (!root.isConnected) return close(); requestAnimationFrame(watch); });
    // Capture phase, so a press anywhere else in the panel closes too — the panel's own
    // stopPointerLeak would otherwise swallow the event before it bubbles to document.
    setTimeout(() => { if (open) document.addEventListener("pointerdown", onOutside, true); }, 0); // skip the opening click; a same-tick close has already run its removal, so don't add behind it
    document.addEventListener("keydown", onKey); // Esc closes from anywhere while open, not only when focus is inside
    window.addEventListener("scroll", reflow, true); window.addEventListener("resize", reflow);
  };
  const close = () => {
    if (activePopoverClose === close) { activePopoverClose = null; activePopoverTrigger = null; }
    // Focus stranded inside the pop (picking an option, loading a preset) returns to the
    // trigger before the node is removed; an outside click that already moved focus keeps it.
    if (pop.contains(document.activeElement)) trigger.focus();
    open = false; root.classList.remove("is-open"); pop.classList.remove("is-open"); pop.inert = true; trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true); document.removeEventListener("keydown", onKey);
    window.removeEventListener("scroll", reflow, true); window.removeEventListener("resize", reflow);
    window.removeEventListener("tw-retheme", recarry); if (schemeObs) { schemeObs.disconnect(); schemeObs = null; }
    setTimeout(() => { if (!open) pop.remove(); }, 200); // remove the portaled node once it's faded out
  };
  trigger.addEventListener("click", () => { if (trigger.disabled) return; open ? close() : openPop(); }); // a disabled trigger (the presets button before the panel is built) stays inert to a synthetic click, as the toolbar buttons do
  return { open: openPop, close, isOpen: () => open, reflow };
}

// Dependency-free fuzzy match (for the filter): true if `q` is a substring of `text`,
// or within a small edit distance of some window of it — so "blut" finds "blur". The
// edit-distance DP starts its first row at 0, which lets the query begin matching at
// any position in the text (approximate substring). Threshold scales with length so
// short queries stay strict and don't over-match.
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

// Liquid sliding-pill stretch — shared by the segmented control + tabs. As the pill
// travels to a new segment, a one-shot scaleX overshoot makes its leading edge stretch
// ahead and settle back (transform-origin pinned to the trailing edge so it reads
// directional), giving the same organic finesse the slider's glide has. Uses the Web
// Animations API (native, zero-dep, replayable); honours reduced-motion. dir>0 = moving
// right (origin left), dir<0 = moving left (origin right).
const REDUCE_MOTION: { matches: boolean } = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
// ── Motion tokens — the easings the kit's JS-driven glides share. EASE_SPRING is
// the JS-side literal of the CSS token --tw-ease-spring (tweaks.css) — WAAPI and
// inline transitions on nodes that may sit outside a .tw-panel can't read the
// custom property, so the value lives here once instead of inline per call site.
const EASE_SPRING = "cubic-bezier(0.22, 1, 0.36, 1)";
const EASE_GLIDE = "cubic-bezier(0.34, 1.2, 0.64, 1)"; // press glide with a light overshoot (the slider's tap-to-value)
const stretchPill = (pill: HTMLElement, dir: number) => {
  if (REDUCE_MOTION.matches || typeof pill.animate !== "function") return;
  pill.style.transformOrigin = dir > 0 ? "left center" : "right center";
  pill.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(1.18)" }, { transform: "scaleX(1)" }], { duration: 300, easing: EASE_SPRING });
};
// Slide a pill to the active child of `container` — the segmented control + tabs share
// this. Batch the three box reads before either write (so a measure can't force an extra
// layout flush), then run the liquid stretch on a real move (animate + position changed).
const measurePill = (container: Element, pill: HTMLElement, animate?: boolean) => {
  const a = container.querySelector<HTMLElement>('[data-active="true"]'); if (!a) return;
  const left = a.offsetLeft, width = a.offsetWidth, prev = parseFloat(pill.style.left);
  pill.style.left = left + "px"; pill.style.width = width + "px";
  if (animate && Number.isFinite(prev) && prev !== left) stretchPill(pill, left > prev ? 1 : -1);
};

// Collapse / expand a section — the panel body, a markup panel, a folder: the class the
// CSS folds on, the toggle's aria-expanded, and `inert` on the body so its (still mounted,
// clip-faded) controls leave the tab order + a11y tree while hidden. Synchronous, so it's
// correct under reduced-motion too.
// Disable a control row: greyed + locked. `inert` goes on the row's children, not the row —
// an inert element hit-tests like pointer-events:none, so an inert row would pass the pointer
// through to the panel and never show its not-allowed cursor. The children still drop out of
// focus, keyboard and the a11y tree; the row stays a pointer target for the cursor alone.
const setDisabled = (node: HTMLElement, d: boolean) => { node.classList.toggle("is-disabled", d); for (const c of node.children) if (!c.classList.contains("tw-portal")) (c as HTMLElement).inert = d; }; // a not-yet-opened popover is a child too, and keeps its own inert (closed = inert) — re-enabling the row mustn't wake it
const setCollapsed = (root: Element, toggle: Element, body: HTMLElement, c: boolean) => { root.classList.toggle("is-collapsed", c); toggle.setAttribute("aria-expanded", String(!c)); body.inert = c; };
// The index of the button whose (stringified — dataset) value is the active one — or,
// when none matches (a value no option carries), the first button: the group's roving
// tab stop and keyboard start point. Only an empty group gives −1. A no-match group
// used to put every button at tabIndex −1 and bail out of its keydown, so it fell out
// of the tab order entirely.
const activeIndex = (btns: RadioBtn[], value: unknown) => { const i = btns.findIndex((b) => b.dataset.value === String(value)); return i < 0 && btns.length ? 0 : i; };
// Reflect a single-select value onto a radio group's buttons: data-active (paint),
// aria-checked (semantics), and a roving tabindex so Tab lands on the selected one
// and arrow keys move within the group. Shared by the segmented control + radio grid.
// Paint + semantics follow the real match (nothing lights up when nothing matches);
// the tab stop follows activeIndex's fallback.
const setRadioActive = (btns: RadioBtn[], value: unknown) => { const stop = activeIndex(btns, value); btns.forEach((b, k) => { const on = b.dataset.value === String(value); b.dataset.active = String(on); b.setAttribute("aria-checked", String(on)); b.tabIndex = k === stop ? 0 : -1; }); };
// A single-select radio button — the segmented pill and the radio-grid cell wire the
// role + value + click identically; only the class and container differ. onPick(value).
// _twVal carries the option's real value — dataset stringifies, so a keyboard pick
// reading dataset.value turned a numeric option into a string (type flipped by input method).
const radioButton = (cls: string, o: Option, onPick: (v: string) => void) => { const b: RadioBtn = txt("button", cls, optLabel(o)); b.setAttribute("role", "radio"); b._twVal = optValue(o); b.dataset.value = b._twVal; b.addEventListener("click", () => onPick(b._twVal)); return b; };
// Arrow-key navigation over a one-dimensional or gridded group → the next index, or −1
// when the key isn't the group's to handle. The three radio-ish groups share it:
// cols > 0 jumps ↑/↓ by a row, clamped at the edges (the radio grid); cols 0 treats
// ↑/↓ as ←/→ (the segmented pill); cols < 0 leaves ↑/↓ to the page (the tab bar —
// a horizontal tablist shouldn't capture vertical scroll keys). ←/→ wrap; Home/End end.
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
// ── Segmented control — a single-select pill row, shared by the boolean Off/On toggle
// and the spring's Time | Physics mode switch. ──
function createSegmented(options: Option[], value: unknown, onChange: OnChange, ariaLabel?: string) {
  const seg = el("div", "tw-seg"); seg.setAttribute("role", "radiogroup");
  if (ariaLabel) seg.setAttribute("aria-label", ariaLabel);
  const pill = el("div", "tw-seg-pill");
  seg.append(pill);
  const btns = options.map((o) => { const b = radioButton("tw-seg-btn", o, (v) => set(v)); seg.append(b); return b; }); // lazy `set` — it's declared below
  // Fill the active segment; the 2px flex gap + 2px container padding frame it. The liquid
  // pill (a transient scaleX overshoot, trailing-edge origin) rides on a real move — shared
  // with tabs via measurePill (reduced-motion skips the stretch).
  const measure = (animate?: boolean) => measurePill(seg, pill, animate);
  const reflect = () => { setRadioActive(btns, value); measure(true); };
  const set = (v: unknown, fire = true) => { if (v != null && !btns.some((b) => b._twVal === v)) return; value = v; reflect(); if (fire) onChange(v); }; // null/undefined clear the selection (a snapshot writes undefined as null); any other value matching no segment (a stale restore, a stray set()) is ignored, like an out-of-range slider value is clamped
  seg.addEventListener("keydown", (e) => {
    const i = activeIndex(btns, value); if (i < 0) return;
    const j = navIndex(e.key, i, btns.length); if (j < 0) return;
    e.preventDefault(); set(btns[j]._twVal); btns[j].focus(); // _twVal, not dataset.value — the keyboard pick must emit the option's real (possibly non-string) value
  });
  reflect();
  onReady(() => { measure(); seg.classList.add("is-ready"); }); // measure once laid out, again when fonts land (re-adding is-ready is a no-op)
  // A tab page revealing this control re-measures the pill — built at 0×0 while the page
  // was display:none, it would otherwise sit stuck at left:0/width:0 until the next edit or
  // resize (the canvas controls subscribe to the same event). No animate arg → reposition
  // without the liquid stretch; self-cleans once the panel leaves the DOM.
  onLive(seg, [[window, "tw-reflow"]], () => measure());
  return { el: seg, set: (v: unknown) => set(v, false), get: () => value };
}

// One stroke-icon shell for every inline SVG in the kit (icons.ts holds the chrome set;
// the gradient's + and the grip below use it too): the body is the path data, the class
// (optional) is the CSS hook, the stroke weight and view box vary per glyph. It lives here
// rather than in icons.ts because a lazy control imports it: anything both core and a
// lazy chunk import must sit in the module that is already the shared chunk, or esbuild
// hoists the whole module into a third chunk every basic panel has to fetch.
const icon = (body: string, cls = "", width = 2, box = 24) => `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 ${box} ${box}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

// The handle a display/action control returns — buttons, separators, monitors, the
// FPS graph. No value: the panel build skips entry/reset/persist wiring for them.
// `destroy` is optional and only the live ones supply it (the monitor's poll, the FPS
// rAF loop): build() forwards it into the panel's cleanups, so panel.destroy() stops a
// control's own loops even when the panel never connected — the case those loops
// deliberately idle through, and so could never self-stop on unmount.
const blade = (el: HTMLElement, destroy?: () => void): Control => ({ el, set: () => {}, get: () => undefined, destroy });

// ── Control registry — control type → constructor. Core controls register on
// load; a lazy control registers when its module is dynamically imported. build()
// looks constructors up by type, so the loaded set drives what can be built.
const REGISTRY: Record<string, ControlCtor<any, any>> = {}; // heterogeneous by design — see ControlCtor
export const registerControl = (type: string, ctor: ControlCtor<any, any>) => { REGISTRY[type] = ctor; };
export const getControl = <C = Control, M = Meta>(type: string): ControlCtor<M, C> | undefined => REGISTRY[type];

export {
  titleCase, clamp, isColorStr, stepPrecision, gridEnds, roundToStep, inferStep, defaultRange,
  normalizeRange, rangeStep, overlapsText,
  optValue, optLabel, json, el, btn, txt, stopPointerLeak, onReady, onLive, requestReflow,
  wireHoverClass, popover, closeActivePopover,
  resolveTheme, applyThemeVars, carryScheme, carrySkin, fuzzyMatch, setCollapsed, setDisabled, activeIndex, setRadioActive, radioButton, navIndex, createSegmented,
  blade, quietFocus, measurePill, REDUCE_MOTION, EASE_SPRING, EASE_GLIDE, icon,
};
export type { OnChange, ThemeVars, PanelEl, RadioBtn, Built, NumSpec, NumField, Popover, ControlCtor };
// easing.ts is re-exported here for the chunking alone: core and the gradient control both
// import it, and a module only those two reach would become a chunk of its own, while one
// every control reaches via shared.ts joins the shared chunk (test/chunks.test.mjs holds it
// to three). Core exports the helpers straight from easing.ts so the .d.ts prune walk
// doesn't pull shared.ts's internal declarations into the package.
export { gradientCss, gradientStops } from "./easing.js";

