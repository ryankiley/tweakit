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
// Default range for a numeric entry with no explicit bounds: 0–1 keeps a 0–1 range,
// a positive spans 0–3× (100 as a last resort), and a negative mirrors that below
// zero (−1–0 / 3×–0) — a negative default used to produce max −3×|v| with min 0, an
// inverted range that clamped the value to the wrong end. Shared by the bare-number
// and short-array schema branches so the heuristic lives in one place.
const defaultRange = (v) => (v >= 0 ? [0, v <= 1 ? 1 : v * 3 || 100] : [v >= -1 ? -1 : v * 3, 0]);

// Options may be strings, { value, label } objects, or bare primitives (numbers,
// booleans — e.g. a five-number array inferring as a list): a primitive is its own
// value, labelled by its string form. (Primitives used to fall into the object arm
// and read `.value` off a number — empty labels, undefined values.)
const optValue = (o) => (o == null ? undefined : typeof o === "object" ? o.value : o);
const optLabel = (o) => (o == null ? "" : typeof o === "string" ? titleCase(o) : typeof o === "object" ? o.label ?? String(o.value) : String(o)); // label is optional on { value } options — fall back to the value's string form, not the literal "undefined"

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
  let activeId = null; // the one captured pointer — a second finger / other-button press can't hijack or fork the drag
  const end = (e) => { if (activeId === null || e.pointerId !== activeId) return; activeId = null; onEnd && onEnd(e); };
  node.addEventListener("pointerdown", (e) => { if (e.button !== 0 || activeId !== null) return; activeId = e.pointerId; try { node.setPointerCapture(e.pointerId); } catch {} onDown && onDown(e); });
  node.addEventListener("pointermove", (e) => { if (e.pointerId !== activeId) return; if (e.buttons === 0) return end(e); onMove && onMove(e); });
  node.addEventListener("pointerup", end); node.addEventListener("pointercancel", end);
  node.addEventListener("lostpointercapture", end); // implicit capture loss (the popover unmounting mid-drag) ends the gesture too, so grab state can't strand
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
export const placeBelow = (trigger: any, pop: any, { width, fallbackH = 300, gap = 6, align = "start", prefer = "below" }: { width?: number | "match"; fallbackH?: number; gap?: number; align?: "start" | "end" | "center"; prefer?: "above" | "below" } = {}) => {
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
const THEME_ALIASES = {
  // colour — backdrops
  accent: "--tw-accent", base: "--tw-base", dropdownBg: "--tw-dropdown-bg",
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
// Reused portaled nodes (popover, hint tip, toast) re-theme on every show — clear the
// previous application first, so a null/partial theme actually reverts what it no longer names.
const applyThemeVars = (node, vars) => {
  if (!node) return;
  if (node._twAppliedVars) for (const k of node._twAppliedVars) node.style.removeProperty(k);
  node._twAppliedVars = vars ? Object.keys(vars) : null;
  if (vars) for (const k in vars) node.style.setProperty(k, vars[k]);
};

// ── Popover — the one portal-to-<body> shell behind every transient surface: the
// colour picker, the gradient editor, the select dropdown, and the presets menu.
// It opens under its trigger (placeBelow, flipping up when it won't fit), carries
// the host panel's theme onto the portaled node, and closes on outside-press /
// Esc / scroll-away. Globally single-open — opening any popover closes whichever
// other one is up. onOpen runs once it's placed at real size (then it re-places,
// so content rendered in onOpen is measured); onReflow on scroll/resize while open.
let activePopoverClose: null | (() => void) = null;
const closeActivePopover = () => { if (activePopoverClose) activePopoverClose(); }; // panel teardown closes whichever popover is up
function popover(root: any, trigger: any, pop: any, opts: { width?: number | "match"; fallbackH?: number; gap?: number; align?: "start" | "end"; onOpen?: () => void; onReflow?: () => void } = {}) {
  let open = false;
  pop.classList.add("tw-portal"); // the reduced-motion kill-switch + portal-wide rules key off this
  // Relay pointerdowns to the host panel's edit-lifecycle hook (capture, ahead of the
  // pointer-stop below) — the colour/gradient drag surfaces live here on <body>, where
  // the panel's own pointerdown listener can't see them.
  pop.addEventListener("pointerdown", (e) => trigger.closest(".tw-panel")?._twEditPointer?.(e), true);
  stopPointerLeak(pop); // on <body>, outside the panel's own pointer-stop
  const place = () => placeBelow(trigger, pop, { width: opts.width, fallbackH: opts.fallbackH, gap: opts.gap, align: opts.align });
  // A reflow against a detached trigger would place off its zero-rect (the pop jumps to
  // the viewport corner) — if the host has unmounted the panel, close instead.
  const reflow = () => { if (open) { if (!root.isConnected) return close(); place(); opts.onReflow && opts.onReflow(); } };
  const onOutside = (e) => { if (!root.contains(e.target) && !pop.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === "Escape" && open) { close(); trigger.focus(); } };
  const openPop = () => {
    if (activePopoverClose && activePopoverClose !== close) activePopoverClose(); // close any other open popover first
    activePopoverClose = close;
    open = true; root.classList.add("is-open"); trigger.setAttribute("aria-expanded", "true");
    document.body.appendChild(pop);
    applyThemeVars(pop, root.closest(".tw-panel")?._twTheme); // carry the host panel's theme onto the portaled popover
    // Carry the forced scheme too — the portal escapes the subtree, so the
    // [data-tw-scheme] scope that styles the panel can't reach it via the cascade.
    // Copy the WINNING scheme, not the nearest: pins resolve flat (a light pin
    // anywhere outranks dark — see the scheme-resolution comment in tweaks.css), so
    // nearest-wins under light>dark nesting would put a dark popover on a light panel.
    const scheme = root.closest('[data-tw-scheme="light"]') ? "light" : root.closest('[data-tw-scheme="dark"]') ? "dark" : null;
    if (scheme) pop.setAttribute("data-tw-scheme", scheme); else pop.removeAttribute("data-tw-scheme");
    place();
    requestAnimationFrame(() => { pop.classList.add("is-open"); opts.onOpen && opts.onOpen(); place(); }); // render at real size, then re-place (height may have changed)
    // Unmount watchdog: a host that removes the panel while this is open (an SPA route
    // change) would otherwise strand the portaled pop on screen — visible and interactive
    // over whatever renders next — until something else was pressed. One rAF per frame,
    // only while the (globally single) popover is open.
    requestAnimationFrame(function watch() { if (!open) return; if (!root.isConnected) return close(); requestAnimationFrame(watch); });
    // Capture phase, so a press anywhere else in the panel closes too — the panel's own
    // stopPointerLeak would otherwise swallow the event before it bubbles to document.
    setTimeout(() => document.addEventListener("pointerdown", onOutside, true), 0); // skip the opening click
    document.addEventListener("keydown", onKey); // Esc closes from anywhere while open, not only when focus is inside
    window.addEventListener("scroll", reflow, true); window.addEventListener("resize", reflow);
  };
  const close = () => {
    if (activePopoverClose === close) activePopoverClose = null;
    // Focus stranded inside the pop (picking an option, loading a preset) returns to the
    // trigger before the node is removed; an outside click that already moved focus keeps it.
    if (pop.contains(document.activeElement)) trigger.focus();
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

// Liquid sliding-pill stretch — shared by the segmented control + tabs. As the pill
// travels to a new segment, a one-shot scaleX overshoot makes its leading edge stretch
// ahead and settle back (transform-origin pinned to the trailing edge so it reads
// directional), giving the same organic finesse the slider's glide has. Uses the Web
// Animations API (native, zero-dep, replayable); honours reduced-motion. dir>0 = moving
// right (origin left), dir<0 = moving left (origin right).
const REDUCE_MOTION = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false } as any;
const stretchPill = (pill, dir) => {
  if (REDUCE_MOTION.matches || typeof pill.animate !== "function") return;
  pill.style.transformOrigin = dir > 0 ? "left center" : "right center";
  pill.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(1.18)" }, { transform: "scaleX(1)" }], { duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
};

// Reflect a single-select value onto a radio group's buttons: data-active (paint),
// aria-checked (semantics), and a roving tabindex so Tab lands on the selected one
// and arrow keys move within the group. Shared by the segmented control + radio grid.
const setRadioActive = (btns, value) => btns.forEach((b) => { const on = b.dataset.value === String(value); b.dataset.active = String(on); b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; });
// A single-select radio button — the segmented pill and the radio-grid cell wire the
// role + value + click identically; only the class and container differ. onPick(value).
// _twVal carries the option's real value — dataset stringifies, so a keyboard pick
// reading dataset.value turned a numeric option into a string (type flipped by input method).
const radioButton = (cls, o, onPick) => { const b = el("button", cls); b.type = "button"; b.setAttribute("role", "radio"); b.textContent = optLabel(o); b.dataset.value = optValue(o); b._twVal = optValue(o); b.addEventListener("click", () => onPick(b._twVal)); return b; };

// Tweakpane-style grab guide — a dotted line from the grab point to the cursor
// plus a floating value bubble, portaled to <body> for the duration of a drag.
// Shared by createNumber and the numField helper (Spring / Point / Bezier).
function makeGrabGuide() {
  let g = null;
  return {
    show(x, y, bubbleX) {
      g = el("div", "tw-grab-guide tw-portal");
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
  let downX = 0, downV = 0, activeId = null, curK = 1; const gd = makeGrabGuide();
  grab.addEventListener("pointerdown", (e) => { if (e.button !== 0 || activeId !== null) return; e.preventDefault(); activeId = e.pointerId; downX = e.clientX; downV = read(); curK = 1; grab.classList.add("is-dragging"); try { grab.setPointerCapture(e.pointerId); } catch {} const br = wrap.getBoundingClientRect(); gd.show(e.clientX, br.top + br.height / 2, br.left + br.width / 2); gd.move(e.clientX, text()); });
  // Shift = coarse (×10), Alt = fine (×0.1); re-anchor on a modifier change so the value doesn't jump.
  grab.addEventListener("pointermove", (e) => { if (e.pointerId !== activeId) return; if (e.buttons === 0) { end(e); return; } const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1; if (k !== curK) { curK = k; downX = e.clientX; downV = read(); } apply(downV + (e.clientX - downX) * step * k); gd.move(e.clientX, text()); });
  const end = (e) => { if (activeId === null || e.pointerId !== activeId) return; activeId = null; grab.classList.remove("is-dragging"); gd.hide(); };
  grab.addEventListener("pointerup", end); grab.addEventListener("pointercancel", end);
  grab.addEventListener("lostpointercapture", end); // capture lost mid-scrub (the popover hosting the field closing) must still hide the full-screen guide — the singleton ref is overwritten on the next show, which would orphan the node
}

// ── A labelled numeric field: an uppercase label over a boxed input with a
// Tweakpane grab handle (drag to scrub). The shared building block for the
// Spring, Point, and Cubic-bezier value editors. ──
function numField(spec, onChange) {
  // A 0/negative/non-finite step breaks round-to-step (NaN out of Infinity, inverted
  // scrub + keyboard from a negative — reachable via a point component's user-supplied
  // step); a non-finite seed shows literal "NaN". Default both to sane values.
  const step = Number.isFinite(+spec.step) && +spec.step > 0 ? +spec.step : 1, min = spec.min, max = spec.max, decimals = stepPrecision(step);
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
  titleCase, clamp, isColorStr, stepPrecision, roundToStep, inferStep, defaultRange,
  optValue, optLabel, el, svgEl, cssVar, accentColor, stopPointerLeak, onReady,
  wireHoverClass, dragGesture, boxFrac, fitCanvas, popover, closeActivePopover,
  resolveTheme, applyThemeVars, fuzzyMatch, setRadioActive, radioButton,
  attachScrub, numField, stretchPill, ICON_GRIP, REDUCE_MOTION,
};

