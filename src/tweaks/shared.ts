/* Tweaks — shared building blocks: DOM + math helpers, drag/scrub gestures,
 * the numeric field, theming, and the control registry. Pure, side-effect-free
 * declarations; core.js and the lazy controls/*.js import what they each use. */

// ── helpers ──
const titleCase = (s) => s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// A colour-valued string: hex, or any CSS colour function (oklch/rgb/hsl/…). Used
// to route a schema string to the colour control (a plain label stays a string).
const isColorStr = (v) => typeof v === "string" && (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.trim()) || /^(oklch|oklab|rgba?|hsla?|hwb|lab|lch|color)\(/i.test(v.trim()));
const stepPrecision = (step) => {
  const t = String(step);
  // Scientific notation (e.g. 1e-7 → 7): String(1e-7) === "1e-7" has no ".", so a plain
  // index-of would wrongly report 0 decimals and round fine steps to whole numbers.
  const e = /e-(\d+)$/i.exec(t);
  if (e) return Number(e[1]) + (t.split("e")[0].split(".")[1] || "").length;
  const i = t.indexOf(".");
  return i === -1 ? 0 : t.length - i - 1;
};
const roundToStep = (v, min, step) => {
  if (!(step > 0)) return v;
  return Number((min + Math.round((v - min) / step) * step).toFixed(stepPrecision(step)));
};
const inferStep = (min, max) => {
  const range = max - min;
  if (range <= 1) return 0.01;
  if (range <= 10) return 0.1;
  if (range <= 100) return 1;
  return 10;
};
// Default upper bound for a numeric entry with no explicit max: a 0–1 value keeps a
// 0–1 range, otherwise 3× the value (100 as a last resort). Shared by the bare-number
// and short-array schema branches so the heuristic lives in one place.
const defaultMax = (v) => (v <= 1 && v >= 0 ? 1 : v * 3 || 100);

const optValue = (o) => (o == null ? undefined : typeof o === "string" ? o : o.value);
const optLabel = (o) => (typeof o === "string" ? titleCase(o) : o.label);

const svgNS = "http://www.w3.org/2000/svg";
// el/svgEl return `any` on purpose: they're the internal DOM factory, used as div /
// input / canvas / svg interchangeably across the kit. The public API (types.ts) is
// fully typed; internal DOM typing is intentionally loose (tighten incrementally).
const el = (tag: string, cls?: string, html?: string): any => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const svgEl = (tag: string, cls?: string): any => { const n = document.createElementNS(svgNS, tag); if (cls) n.setAttribute("class", cls); return n; };
// A resolved custom property off a node; accentColor picks the panel accent and
// falls back to the primary text colour then white (canvas strokes need a literal).
const cssVar = (node, name) => getComputedStyle(node).getPropertyValue(name).trim();
const accentColor = (node) => cssVar(node, "--tw-accent") || cssVar(node, "--tw-text-primary") || "#fff";
// Stop a node's pointer events leaking to the page behind it (the panel + the
// popovers portaled to <body>, which sit outside the panel's own pointer-stop).
const stopPointerLeak = (node) => ["pointerdown", "pointermove", "pointerup"].forEach((t) => node.addEventListener(t, (e) => e.stopPropagation()));
// Run fn next frame (after layout) and again once web fonts load — canvas/SVG
// controls measure their box, and font swaps change metrics.
const onReady = (fn) => { requestAnimationFrame(fn); if (document.fonts && document.fonts.ready) document.fonts.ready.then(fn); };
// Toggle .is-hover while the pointer is over a node; onEnter runs on entry (the slider
// + interval re-render their value-dodge with the real track width on first hover).
const wireHoverClass = (el, onEnter) => {
  el.addEventListener("pointerenter", () => { el.classList.add("is-hover"); onEnter && onEnter(); });
  el.addEventListener("pointerleave", () => el.classList.remove("is-hover"));
};
// Press-drag on a node: onDown fires on pointerdown (pointer captured), onMove on
// each move; it ends on pointerup/cancel or when the button releases off the node
// (buttons===0), then onEnd runs. The shape behind the colour plane/strips, the
// point pad, and the bezier handles — the controls with bespoke physics (slider,
// number scrub, gradient) keep their own loops.
function dragGesture(node: any, { onDown, onMove, onEnd }: { onDown?: (e: any) => void; onMove?: (e: any) => void; onEnd?: (e: any) => void } = {}) {
  let active = false;
  const end = (e) => { if (!active) return; active = false; onEnd && onEnd(e); };
  node.addEventListener("pointerdown", (e) => { active = true; try { node.setPointerCapture(e.pointerId); } catch {} onDown && onDown(e); });
  node.addEventListener("pointermove", (e) => { if (!active) return; if (e.buttons === 0) return end(e); onMove && onMove(e); });
  node.addEventListener("pointerup", end); node.addEventListener("pointercancel", end);
}
// Pointer position inside a box as [x, y] fractions in 0–1 — read off the box's own
// rect (the colour plane/strips and the point pad).
const boxFrac = (e, box) => { const r = box.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)]; };
// Size a canvas to its CSS box × devicePixelRatio (capped at maxDpr) and scale the
// context to draw in CSS pixels; returns [cssW, cssH]. The fps + monitor graphs.
const fitCanvas = (canvas, ctx, maxDpr = Infinity) => {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [r.width, r.height];
};
// Place a portaled popover under its trigger — flipping above when it won't fit below —
// clamped into the viewport. width:"match" sizes it to the trigger; a number is the
// fallback width to use before layout; align:"end" lines up the right edges instead
// (the presets menu, which hangs off a toolbar button near the panel's right edge).
const placeBelow = (trigger: any, pop: any, { width, fallbackH = 300, gap = 6, align = "start" }: { width?: number | "match"; fallbackH?: number; gap?: number; align?: "start" | "end" } = {}) => {
  const r = trigger.getBoundingClientRect();
  if (width === "match") pop.style.width = r.width + "px";
  const w = width === "match" ? r.width : (pop.offsetWidth || width || 0);
  pop.style.left = Math.max(8, Math.min(align === "end" ? r.right - w : r.left, window.innerWidth - w - 8)) + "px";
  const h = pop.offsetHeight || fallbackH, below = window.innerHeight - r.bottom;
  const top = below < h + 12 && r.top > h + 12 ? r.top - h - gap : r.bottom + gap;
  pop.style.top = clamp(top, gap, window.innerHeight - h - gap) + "px"; // clamp Y into the viewport too (only X was) so a tall picker can't open off a short screen
};

// ── Theming — the panel runs entirely on --tw-* custom properties, so a theme is
// just a set of those vars. resolveTheme turns a friendly object into a {var: value}
// map; applyThemeVars sets them inline. Raw "--tw-*" keys pass straight through; the
// aliases below cover the common levers. Anything unset falls back to the CSS default,
// so no theme === the default monochrome look, and partial themes only move what they name.
const THEME_ALIASES = {
  accent: "--tw-accent", base: "--tw-base", surface: "--tw-surface", surfaceHover: "--tw-surface-hover",
  surfaceActive: "--tw-surface-active", border: "--tw-border", text: "--tw-text-primary", label: "--tw-text-label",
  dropdownBg: "--tw-dropdown-bg", shadow: "--tw-shadow-dropdown", font: "--tw-font-sans",
  radius: "--tw-radius", density: "--tw-row-height", // numeric → px
};
const TW_PX_ALIASES = new Set(["radius", "density"]);
const resolveTheme = (theme) => {
  if (!theme || typeof theme !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(theme)) {
    if (k.startsWith("--")) { out[k] = String(v); continue; }
    const name = THEME_ALIASES[k]; if (!name) continue;
    out[name] = TW_PX_ALIASES.has(k) && typeof v === "number" ? `${v}px` : String(v);
  }
  return Object.keys(out).length ? out : null;
};
const applyThemeVars = (node, vars) => { if (node && vars) for (const k in vars) node.style.setProperty(k, vars[k]); };

// ── Popover — the one portal-to-<body> shell behind every transient surface: the
// colour picker, the gradient editor, the select dropdown, and the presets menu.
// It opens under its trigger (placeBelow, flipping up when it won't fit), carries
// the host panel's theme onto the portaled node, and closes on outside-press /
// Esc / scroll-away. Globally single-open — opening any popover closes whichever
// other one is up. onOpen runs once it's placed at real size (then it re-places,
// so content rendered in onOpen is measured); onReflow on scroll/resize while open.
let activePopoverClose: null | (() => void) = null;
function popover(root: any, trigger: any, pop: any, opts: { width?: number | "match"; fallbackH?: number; gap?: number; align?: "start" | "end"; onOpen?: () => void; onReflow?: () => void } = {}) {
  let open = false;
  stopPointerLeak(pop); // on <body>, outside the panel's own pointer-stop
  const place = () => placeBelow(trigger, pop, { width: opts.width, fallbackH: opts.fallbackH, gap: opts.gap, align: opts.align });
  const reflow = () => { if (open) { place(); opts.onReflow && opts.onReflow(); } };
  const onOutside = (e) => { if (!root.contains(e.target) && !pop.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === "Escape" && open) { close(); trigger.focus(); } };
  const openPop = () => {
    if (activePopoverClose && activePopoverClose !== close) activePopoverClose(); // close any other open popover first
    activePopoverClose = close;
    open = true; root.classList.add("is-open"); trigger.setAttribute("aria-expanded", "true");
    document.body.appendChild(pop);
    applyThemeVars(pop, root.closest(".tw-panel")?._twTheme); // carry the host panel's theme onto the portaled popover
    place();
    requestAnimationFrame(() => { pop.classList.add("is-open"); opts.onOpen && opts.onOpen(); place(); }); // render at real size, then re-place (height may have changed)
    // Capture phase, so a press anywhere else in the panel closes too — the panel's own
    // stopPointerLeak would otherwise swallow the event before it bubbles to document.
    setTimeout(() => document.addEventListener("pointerdown", onOutside, true), 0); // skip the opening click
    document.addEventListener("keydown", onKey); // Esc closes from anywhere while open, not only when focus is inside
    window.addEventListener("scroll", reflow, true); window.addEventListener("resize", reflow);
  };
  const close = () => {
    if (activePopoverClose === close) activePopoverClose = null;
    open = false; root.classList.remove("is-open"); pop.classList.remove("is-open"); trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true); document.removeEventListener("keydown", onKey);
    window.removeEventListener("scroll", reflow, true); window.removeEventListener("resize", reflow);
    setTimeout(() => { if (!open) pop.remove(); }, 200); // remove the portaled node once it's faded out
  };
  trigger.addEventListener("click", () => (open ? close() : openPop()));
  return { open: openPop, close, isOpen: () => open, reflow };
}

// Dependency-free fuzzy match (for the filter): true if `q` is a substring of `text`,
// or within a small edit distance of some window of it — so "blut" finds "blur". The
// edit-distance DP starts its first row at 0, which lets the query begin matching at
// any position in the text (approximate substring). Threshold scales with length so
// short queries stay strict and don't over-match.
const fuzzyMatch = (text, q) => {
  text = text.toLowerCase();
  if (text.includes(q)) return true;
  if (q.length < 3) return false;
  const m = q.length, n = text.length;
  let prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (q[i - 1] === text[j - 1] ? 0 : 1));
    prev = cur;
  }
  return Math.min(...prev) <= (q.length < 6 ? 1 : 2);
};

// Reflect a single-select value onto a radio group's buttons: data-active (paint),
// aria-checked (semantics), and a roving tabindex so Tab lands on the selected one
// and arrow keys move within the group. Shared by the segmented control + radio grid.
const setRadioActive = (btns, value) => btns.forEach((b) => { const on = b.dataset.value === String(value); b.dataset.active = String(on); b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; });
// A single-select radio button — the segmented pill and the radio-grid cell wire the
// role + value + click identically; only the class and container differ. onPick(value).
const radioButton = (cls, o, onPick) => { const b = el("button", cls); b.type = "button"; b.setAttribute("role", "radio"); b.textContent = optLabel(o); b.dataset.value = optValue(o); b.addEventListener("click", () => onPick(optValue(o))); return b; };

// Tweakpane-style grab guide — a dotted line from the grab point to the cursor
// plus a floating value bubble, portaled to <body> for the duration of a drag.
// Shared by createNumber and the numField helper (Spring / Point / Bezier).
function makeGrabGuide() {
  let g = null;
  return {
    show(x, y, bubbleX) {
      g = el("div", "tw-grab-guide");
      g.innerHTML = `<span class="tw-grab-line"></span><span class="tw-grab-dot"></span><span class="tw-grab-arrow"></span><span class="tw-grab-bubble"></span>`;
      g._y = y; g._x0 = x; g._bx = bubbleX ?? x; // bubble anchors over the field centre, not the cursor
      g.children[1].style.cssText = `left:${x}px;top:${y}px`;
      document.body.appendChild(g);
    },
    move(x, text) {
      if (!g) return;
      const lo = Math.min(g._x0, x), dir = x >= g._x0 ? 1 : -1;
      g.children[0].style.cssText = `left:${lo}px;top:${g._y}px;width:${Math.abs(x - g._x0)}px`;
      g.children[2].style.cssText = `left:${x}px;top:${g._y}px;transform:translate(-50%,-50%) scaleX(${dir})`; // arrowhead at the cursor, pointing in the drag direction
      // bubble holds its place centred over the field, so the readout doesn't slide away with the cursor
      g.children[3].style.cssText = `left:${g._bx}px;top:${g._y - 16}px`; g.children[3].textContent = text;
    },
    hide() { if (g) { g.remove(); g = null; } },
  };
}

// Drag-to-scrub on a grab handle: 1px ≈ one step (Shift ×10, Alt ×0.1), re-anchoring
// on a modifier change so the value never jumps, with the shared grab guide drawn
// from the field. read() returns the live value, apply(v) commits it, text() the
// bubble label. Shared by createNumber and the numField building block.
function attachScrub(grab, wrap, step, read, apply, text) {
  let downX = 0, downV = 0, dragging = false, curK = 1; const gd = makeGrabGuide();
  grab.addEventListener("pointerdown", (e) => { e.preventDefault(); dragging = true; downX = e.clientX; downV = read(); curK = 1; grab.classList.add("is-dragging"); try { grab.setPointerCapture(e.pointerId); } catch {} const br = wrap.getBoundingClientRect(); gd.show(e.clientX, br.top + br.height / 2, br.left + br.width / 2); gd.move(e.clientX, text()); });
  // Shift = coarse (×10), Alt = fine (×0.1); re-anchor on a modifier change so the value doesn't jump.
  grab.addEventListener("pointermove", (e) => { if (!dragging) return; if (e.buttons === 0) { end(); return; } const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1; if (k !== curK) { curK = k; downX = e.clientX; downV = read(); } apply(downV + (e.clientX - downX) * step * k); gd.move(e.clientX, text()); });
  const end = () => { dragging = false; grab.classList.remove("is-dragging"); gd.hide(); };
  grab.addEventListener("pointerup", end); grab.addEventListener("pointercancel", end);
}

// ── A labelled numeric field: an uppercase label over a boxed input with a
// Tweakpane grab handle (drag to scrub). The shared building block for the
// Spring, Point, and Cubic-bezier value editors. ──
function numField(spec, onChange) {
  // A 0 or non-finite step divides the round-to-step to NaN; a non-finite seed shows
  // literal "NaN". set() already guards both — match it at construction.
  const step = Number.isFinite(+spec.step) && +spec.step !== 0 ? +spec.step : 1, min = spec.min, max = spec.max, decimals = stepPrecision(step);
  const fit = (val) => {
    let n = roundToStep(val, 0, step);
    if (Number.isFinite(min)) n = Math.max(min, n);
    if (Number.isFinite(max)) n = Math.min(max, n);
    return n;
  };
  let value = fit(Number.isFinite(+spec.value) ? +spec.value : 0);
  const f = el("div", "tw-field");
  const l = el("span", "tw-field-label"); l.textContent = spec.label;
  const wrap = el("div", "tw-num-wrap");
  const grab = el("span", "tw-num-grab", ICON_GRIP); grab.setAttribute("aria-hidden", "true"); grab.title = "Drag to adjust";
  const inp = el("input", "tw-num"); inp.type = "text"; inp.inputMode = "decimal"; inp.value = value.toFixed(decimals);
  wrap.append(grab, inp); f.append(l, wrap);
  const set = (val, fire = true) => { val = +val; if (!Number.isFinite(val)) return; value = fit(val); inp.value = value.toFixed(decimals); if (fire && onChange) onChange(value); };
  inp.addEventListener("change", () => { const p = parseFloat(inp.value); set(isNaN(p) ? value : p); });
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
  attachScrub(grab, wrap, step, () => value, set, () => inp.value);
  return { el: f, set: (val) => set(val, false), get: () => value };
}

// ICON_GRIP — original 2-bar drag handle, not from an icon set (Lucide's grip is dots).
const ICON_GRIP = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M6 4v8M10 4v8"/></svg>`;

// ── Control registry — control type → constructor. Core controls register on
// load; a lazy control registers when its module is dynamically imported. build()
// looks constructors up by type, so the loaded set drives what can be built.
const REGISTRY: Record<string, any> = {};
export const registerControl = (type, ctor) => { REGISTRY[type] = ctor; };
export const getControl = (type) => REGISTRY[type];

export {
  titleCase, clamp, isColorStr, stepPrecision, roundToStep, inferStep, defaultMax,
  optValue, optLabel, el, svgEl, cssVar, accentColor, stopPointerLeak, onReady,
  wireHoverClass, dragGesture, boxFrac, fitCanvas, popover,
  resolveTheme, applyThemeVars, fuzzyMatch, setRadioActive, radioButton,
  attachScrub, numField, ICON_GRIP,
};

