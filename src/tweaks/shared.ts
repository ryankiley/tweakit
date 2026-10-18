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
/** The labelled numeric field's spec (numField). */
interface NumSpec { label: string; value?: unknown; min?: unknown; max?: unknown; step?: unknown; soft?: boolean; row?: boolean; unit?: string } // unit: muted suffix, also in the accessible name
/** The numeric field's handle: set() coerces and fits, get() reads the fitted number. */
interface NumField { el: HTMLDivElement; set(v: number | string): void; get(): number }
/** The popover shell's handle (popover). */
interface Popover { open(): void; close(): void; isOpen(): boolean; reflow(): void }
/** A control constructor: normalized meta in, handle out. The registry holds every one under
 *  the loose form; a lookup names the shape it expects — `getControl<TabsControl>("tabs")`. */
type ControlCtor<M = Meta, C = Control> = (meta: M, onChange?: OnChange) => C;

// ── helpers ──
// A word starts at a camel hump or where a capital opens a lowercase word ("myURLParser" → "My URL Parser").
const titleCase = (s: string) => s.replace(/([a-z])(?=[A-Z])|([A-Z\d])(?=[A-Z][a-z])/g, "$1$2 ").replace(/^./, (c) => c.toUpperCase()).trim();
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";
// Hex or any CSS colour function: routes a schema string to the colour control.
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
// Normalise a slider-style range: non-finite bounds take the defaults (max: min+100), an
// inverted pair swaps, a degenerate step re-infers. Every range source funnels through here.
const normalizeRange = (rawMin: unknown, rawMax: unknown, rawStep: unknown, defMin = 0, defMax: number | null = null) => {
  let min = +rawMin, max = +rawMax, step = +rawStep;
  if (!Number.isFinite(min)) min = defMin;
  if (!Number.isFinite(max)) max = defMax != null ? defMax : min + 100;
  if (max < min) { const t = min; min = max; max = t; }
  if (!(step > 0) || step > max - min) step = inferStep(min, max);
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
// last resort), a negative mirrors that below zero.
const defaultRange = (v: number): [number, number] => (v >= 0 ? [0, v <= 1 ? 1 : v * 3 || 100] : [v >= -1 ? -1 : v * 3, 0]);

// An option is a string, a { value, label } object, or a bare primitive that is its own value.
const optValue = (o: Option) => (o == null ? undefined : typeof o === "object" ? o.value : o);
// An object's readable form: its JSON, or String() when it can't be stringified (a cycle).
const json = (v: unknown) => { try { return JSON.stringify(v); } catch { return String(v); } };
// A { value } option with no label reads as its value's string; an object with neither, as its JSON.
const optLabel = (o: Option) => (o == null ? "" : typeof o === "string" ? titleCase(o) : typeof o === "object" ? o.label ?? (o.value !== undefined ? String(o.value) : json(o)) : String(o));

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
/** Place a portaled popover under its trigger, flipping above when it won't fit, clamped into
 *  the viewport. width:"match" sizes it to the trigger; align:"end" lines up the right edges. */
export const placeBelow = (trigger: Element, pop: HTMLElement, { width, fallbackH = 300, gap = 6, align = "start", prefer = "below" }: { width?: number | "match"; fallbackH?: number; gap?: number; align?: "start" | "end" | "center"; prefer?: "above" | "below" } = {}) => {
  const r = trigger.getBoundingClientRect();
  if (width === "match") pop.style.width = r.width + "px";
  const w = width === "match" ? r.width : (pop.offsetWidth || width || 0);
  const x = align === "end" ? r.right - w : align === "center" ? r.left + r.width / 2 - w / 2 : r.left;
  pop.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + "px";
  const h = pop.offsetHeight || fallbackH;
  const below = window.innerHeight - r.bottom, above = r.top, need = h + 12;
  // The preferred side if it fits, else the other if it fits, else whichever has more room.
  const fitsBelow = below >= need, fitsAbove = above >= need;
  const goAbove = prefer === "above" ? (fitsAbove || (!fitsBelow && above >= below)) : (!fitsBelow && (fitsAbove || above > below));
  const top = goAbove ? r.top - h - gap : r.bottom + gap;
  pop.style.top = clamp(top, gap, window.innerHeight - h - gap) + "px"; // clamp Y into the viewport
};

// ── Theming — the panel runs on --tw-* custom properties, so a theme is a set of those vars:
// resolveTheme maps a friendly object to {var: value}, applyThemeVars sets them inline.
// Null-prototype, like every table indexed with caller data: a key of "constructor" must miss.
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
  font: "--tw-font-sans", fontMono: "--tw-font-mono", radius: "--tw-radius", density: "--tw-row-height", width: "--tw-width", // numeric → px
});
const TW_PX_ALIASES = new Set(["radius", "density", "width"]);
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
    if (k.startsWith("--")) { out[k] = String(v); continue; }
    const name = THEME_ALIASES[k]; if (!name) continue;
    out[name] = TW_PX_ALIASES.has(k) && typeof v === "number" ? `${v}px` : String(v);
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
// trigger, carries the host theme, closes on outside-press / Esc / scroll-out. Globally
// single-open. onOpen runs once it's placed at real size; onReflow on resize while open. ──
let activePopoverClose: null | (() => void) = null, activePopoverTrigger: HTMLElement | null = null;
// With `owner` given, closes only when the open popover's trigger lives inside it.
const closeActivePopover = (owner?: Element) => { if (activePopoverClose && (!owner || owner.contains(activePopoverTrigger))) activePopoverClose(); };
function popover(root: HTMLElement, trigger: HTMLButtonElement, pop: HTMLElement, opts: { width?: number | "match"; fallbackH?: number; gap?: number; align?: "start" | "end"; onOpen?: () => void; onReflow?: () => void; initialFocus?: () => HTMLElement | null | undefined } = {}): Popover {
  let open = false, schemeObs: MutationObserver | null = null;
  pop.classList.add("tw-portal"); // portal-wide CSS rules key off this
  // A closed pop stays in the DOM at opacity 0; inert keeps it out of the tab order and a11y tree.
  pop.inert = true;
  // Relay pointerdowns to the host panel's edit hook — on <body>, its own listener can't see them.
  pop.addEventListener("pointerdown", (e) => trigger.closest<PanelEl>(".tw-panel")?._twEditPointer?.(e), true);
  stopPointerLeak(pop); // on <body>, outside the panel's own pointer-stop
  // A scroll carries the pop along at its offset from the trigger (follow) instead of
  // re-placing it; once the row has left the viewport the pop closes.
  let dx = 0, dy = 0;
  const place = () => { placeBelow(trigger, pop, { width: opts.width, fallbackH: opts.fallbackH, gap: opts.gap, align: opts.align }); const r = trigger.getBoundingClientRect(); dx = parseFloat(pop.style.left) - r.left; dy = parseFloat(pop.style.top) - r.top; };
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
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && open) { close(); trigger.focus(); } };
  // Focus leaving both the pop and its trigger closes. A blur with no relatedTarget is
  // ambiguous (a press on a drag surface inside the pop blurs to <body> too), so the modality
  // note decides. A Tab that lands outside the panel comes back to the trigger a tick later.
  const onFocusOut = (e: FocusEvent) => {
    if (!open) return; const t = e.relatedTarget as Node | null;
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
    pop.inert = false; document.body.appendChild(pop);
    carrySkin(pop, root);
    window.addEventListener("tw-retheme", recarry); // setTheme() while open
    if (typeof MutationObserver === "function") { schemeObs = new MutationObserver(onScheme); schemeObs.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-tw-scheme"] }); } // host scheme flip while open
    place();
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
    if (pop.contains(document.activeElement)) trigger.focus();
    open = false; root.classList.remove("is-open"); pop.classList.remove("is-open"); pop.inert = true; trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true); document.removeEventListener("keydown", onKey);
    window.removeEventListener("scroll", follow, true); window.removeEventListener("resize", reflow);
    window.removeEventListener("tw-retheme", recarry); if (schemeObs) { schemeObs.disconnect(); schemeObs = null; }
    setTimeout(() => { if (!open) pop.remove(); }, 200); // remove the portaled node once it's faded out
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

// Disable a row: `inert` goes on the children, not the row — an inert element hit-tests like
// pointer-events:none, so an inert row would never show its not-allowed cursor.
const setDisabled = (node: HTMLElement, d: boolean) => { node.classList.toggle("is-disabled", d); for (const c of node.children) if (!c.classList.contains("tw-portal")) (c as HTMLElement).inert = d; }; // a closed popover child keeps its own inert
// Collapse a section: the fold class, aria-expanded, and `inert` on the body so hidden controls leave the tab order.
const setCollapsed = (root: Element, toggle: Element, body: HTMLElement, c: boolean) => { root.classList.toggle("is-collapsed", c); toggle.setAttribute("aria-expanded", String(!c)); body.inert = c; };
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
function createSegmented(options: Option[], value: unknown, onChange: OnChange, ariaLabel?: string) {
  const seg = el("div", "tw-seg"); seg.setAttribute("role", "radiogroup");
  if (ariaLabel) seg.setAttribute("aria-label", ariaLabel);
  const pill = el("div", "tw-seg-pill");
  seg.append(pill);
  const btns = options.map((o) => { const b = radioButton("tw-seg-btn", o, (v) => set(v)); seg.append(b); return b; }); // lazy `set` — it's declared below
  const measure = (animate?: boolean) => measurePill(seg, pill, animate);
  const reflect = () => { setRadioActive(btns, value); measure(true); };
  const set = (v: unknown, fire = true) => { if (v != null && !btns.some((b) => b._twVal === v)) return; value = v; reflect(); if (fire) onChange(v); }; // null clears; a value matching no segment is ignored
  seg.addEventListener("keydown", (e) => {
    const i = activeIndex(btns, value); if (i < 0) return;
    const j = navIndex(e.key, i, btns.length); if (j < 0) return;
    e.preventDefault(); set(btns[j]._twVal); btns[j].focus(); // _twVal: the real, possibly non-string value
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

export {
  titleCase, clamp, isObj, isColorStr, stepPrecision, gridEnds, roundToStep, inferStep, defaultRange,
  normalizeRange, rangeStep, overlapsText,
  optValue, optLabel, json, el, btn, txt, stopPointerLeak, onReady, onLive, requestReflow,
  wireHoverClass, popover, closeActivePopover,
  resolveTheme, applyThemeVars, carryScheme, carrySkin, fuzzyMatch, setCollapsed, setDisabled, activeIndex, setRadioActive, radioButton, navIndex, createSegmented,
  blade, quietFocus, measurePill, REDUCE_MOTION, EASE_SPRING, EASE_GLIDE, icon,
};
export type { OnChange, ThemeVars, PanelEl, RadioBtn, Built, NumSpec, NumField, Popover, ControlCtor };
// Re-exported for the chunking: core and the gradient control both import easing.ts, and a
// module only those two reach would become a chunk of its own (test/chunks.test.mjs holds it
// to three). Core exports from easing.ts directly so the .d.ts prune skips shared.ts internals.
export { gradientCss, gradientStops } from "./easing.js";

