/* Tweaks — a dependency-free real-time parameter panel.
 *
 * Hand it a plain schema object and it builds a live control panel — sliders,
 * toggles, dropdowns, wide-gamut colour pickers, curve editors and more — with
 * zero runtime dependencies. Two ways in, one code path:
 *   • tweaks(name, schema, opts) — build an inline panel, returns { params, on, set, reset, el }
 *   • enhance(root)             — turn [data-tw] markup into a live control (the showcase)
 *
 * Schema shorthands:
 *   [default, min, max, step?] → slider     true|false → toggle
 *   ["a","b"] | {options,value}→ select     "#rrggbb"  → colour
 *   { action: fn, label? }     → button
 */

import {
  titleCase, clamp, isColorStr, stepPrecision, roundToStep, inferStep, defaultMax,
  optValue, optLabel, el, popover, stopPointerLeak, applyThemeVars, resolveTheme, onReady,
  wireHoverClass, fuzzyMatch, setRadioActive, radioButton, attachScrub, ICON_GRIP,
  registerControl, getControl,
} from "./shared.js";
import type { Schema, TweaksOptions, Panel, Params } from "./types.js";
// Re-export the public types so `import type { Schema, Panel } from "tweakability"`
// works from either entry — they erase at build time.
export type { Schema, SchemaValue, SchemaObject, ControlOptions, Option, GradientStop, Get, TweaksOptions, Params, Panel, Control } from "./types.js";

// ── Lazy controls — each maps to a dynamic import of its module, which registers
// its constructor(s) into the shared registry on load. ensure() kicks the import
// (deduped); scanTypes walks a schema (into folders + tabs pages) for the lazy
// types it uses, so the panel can preload them before it assembles.
// TW_SPLIT is an esbuild `define`: `true` for the code-split build (each control loads
// on demand via these dynamic imports), `false` for the single-file bundle — where
// single.ts statically imports every control so they self-register, leaving this map
// empty so esbuild drops the import()s and the whole kit inlines, synchronous.
declare const TW_SPLIT: boolean;
const LAZY_IMPORT: Record<string, () => Promise<unknown>> = TW_SPLIT ? {
  interval: () => import("./controls/interval.js"),
  color: () => import("./controls/colour.js"),
  gradient: () => import("./controls/gradient.js"),
  tabs: () => import("./controls/tabs.js"),
  image: () => import("./controls/image.js"),
  fps: () => import("./controls/monitor.js"),
  monitor: () => import("./controls/monitor.js"),
  spring: () => import("./controls/spring.js"),
  bezier: () => import("./controls/bezier.js"),
  point: () => import("./controls/point.js"),
  plot: () => import("./controls/plot.js"),
} : {};
const loading: Record<string, Promise<unknown>> = {};
const ensure = (type) => (getControl(type) || !LAZY_IMPORT[type]) ? null : (loading[type] ||= LAZY_IMPORT[type]());
const scanTypes = (metas, set = new Set()) => {
  for (const m of metas) {
    if (!m) continue;
    if (LAZY_IMPORT[m.type]) set.add(m.type);
    if (m.children) scanTypes(m.children, set);
    if (m.pages) for (const pg of m.pages) scanTypes(pg.children, set);
  }
  return set;
};
// Returns a Promise once all lazy modules a schema needs are loaded, or null if
// none are missing (the synchronous fast path: monolith, or already warmed up).
const ensureForMetas = (metas) => {
  const pend = [...scanTypes(metas)].map(ensure).filter(Boolean);
  return pend.length ? Promise.all(pend) : null;
};

// Parse one schema entry → a control meta. Returns null for unknown shapes.
// Per-control options (render / disabled / hint) ride on any object-form value; the
// wrapper attaches them to whatever control baseMetaFor infers.
function metaFor(key, value) {
  const meta = baseMetaFor(key, value);
  if (meta && value && typeof value === "object") {
    if (typeof value.render === "function") meta.render = value.render;
    if (value.disabled != null) meta.disabled = value.disabled;
    if (value.hint != null) meta.hint = String(value.hint);
  }
  return meta;
}
// True for an object-form schema value (the verbose `{ type, … }` shapes).
const isObj = (v) => v && typeof v === "object";

// ── Verbose `{ type: "…" }` forms — one handler per control type. Adding a control
// means one entry here (plus its constructor in the registry). A handler returns a
// falsy value for a malformed shape (e.g. a point without components), which falls
// through to the shorthand inference — where a plain object still becomes a folder.
// The explicit slider/number/toggle forms exist so shorthand controls can carry
// options (render / disabled / hint / step) the array/boolean shorthands can't.
const radiogridMeta = (v, key, label) => Array.isArray(v.options) && { type: "radiogrid", key, label, options: v.options, value: v.value ?? optValue(v.options[0]), cols: v.cols };
const TYPED_META: Record<string, (v: any, key: string, label: string) => any> = {
  slider: (v, key, label) => { const mn = v.min ?? 0, mx = v.max ?? 1; return { type: "slider", key, label, value: v.value ?? mn, min: mn, max: mx, step: v.step ?? inferStep(mn, mx), soft: v.soft, alt: v.alt }; },
  number: (v, key, label) => ({ type: "number", key, label, value: v.value ?? 0, min: v.min, max: v.max, step: v.step ?? 1, soft: v.soft }),
  toggle: (v, key, label) => ({ type: "toggle", key, label, value: !!v.value }),
  // "segmented" is kept as an alias: picking one of a list renders as the radio
  // grid (the nicer-looking single-select). The inline pill is reserved for booleans.
  radiogrid: radiogridMeta,
  segmented: radiogridMeta,
  select: (v, key, label) => Array.isArray(v.options) && { type: "select", key, label, options: v.options, value: v.value ?? optValue(v.options[0]) },
  // An explicit colour with a custom label: { type: "color", value: "#hex", label: "Background" }.
  color: (v, key, label) => ({ type: "color", key, label: v.label || label, value: v.value }),
  string: (v, key, label) => ({ type: "string", key, label, value: v.value ?? "", rows: v.rows, placeholder: v.placeholder }),
  interval: (v, key, label) => { const mn = v.min ?? 0, mx = v.max ?? 1; return { type: "interval", key, label, value: (Array.isArray(v.value) ? v.value : [mn, mx]).map(Number), min: mn, max: mx, step: v.step ?? inferStep(mn, mx) }; },
  // The config reads off the top level or a nested `value: {…}` — both published forms.
  spring: (v, key, label) => { const s = isObj(v.value) ? v.value : v; return { type: "spring", key, label, value: { stiffness: s.stiffness ?? 300, damping: s.damping ?? 26, mass: s.mass ?? 1 } }; },
  bezier: (v, key, label) => ({ type: "bezier", key, label, value: Array.isArray(v.value) && v.value.length === 4 ? v.value.map(Number) : [0.25, 0.1, 0.25, 1] }),
  point: (v, key, label) => Array.isArray(v.components) && { type: "point", key, label, components: v.components, pad: v.pad, invertY: v.invertY, value: Object.fromEntries(v.components.map((c) => [c.key, c.value ?? 0])) }, // `value` = the default component map, so reset() / double-click-reset can restore it
  gradient: (v, key, label) => ({ type: "gradient", key, label, value: v.value ?? v.stops ?? null }),
  image: (v, key, label) => ({ type: "image", key, label, value: v.value || "" }),
  plot: (v, key, label) => {
    const expr = v.expr != null ? String(v.expr) : (typeof v.fn === "function" ? "" : "sin(x)");
    return { type: "plot", key, label, value: expr, expr, fn: typeof v.fn === "function" ? v.fn : null,
      xMin: v.xMin ?? v.min ?? -10, xMax: v.xMax ?? v.max ?? 10,
      yMin: v.yMin, yMax: v.yMax, samples: v.samples, editable: v.editable };
  },
  fps: (v, key, label) => ({ type: "fps", key, label: v.label || label }),
  monitor: (v, key, label) => ({ type: "monitor", key, label, get: v.get, value: v.value, graph: v.graph, view: v.view, min: v.min, max: v.max, interval: v.interval, rows: v.rows, decimals: v.decimals }),
  buttongroup: (v, key, label) => ({ type: "buttongroup", key, label, buttons: v.buttons }),
  separator: (v, key, label) => ({ type: "separator", key, label }),
  tabs: (v, key, label) => v.pages && typeof v.pages === "object" && { type: "tabs", key, label, pages: Object.entries(v.pages).map(([title, schema]: [string, any]) => ({ key: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title, children: Object.entries(schema).map(([k, sv]) => metaFor(k, sv)).filter(Boolean) })) },
};

function baseMetaFor(key, value) {
  const label = titleCase(key);
  if (isObj(value) && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(TYPED_META, value.type)) { // hasOwnProperty, so a stray type like "toString" can't hit Object.prototype
    const meta = TYPED_META[value.type](value, key, label);
    if (meta) return meta;
  }
  // ── Shorthand inference ──
  // Interval / range: [[lo, hi], min, max, step?] — the first entry is a 2-tuple.
  if (Array.isArray(value) && Array.isArray(value[0]) && value[0].length === 2 && typeof value[0][0] === "number") {
    return { type: "interval", key, label, value: value[0].map(Number), min: value[1], max: value[2], step: value[3] ?? inferStep(value[1], value[2]) };
  }
  if (Array.isArray(value) && value.length <= 4 && typeof value[0] === "number") {
    // Tolerate a short array (e.g. [n] = "just a default"): fall back to a sensible
    // range the way a bare number does, so a missing min/max can't yield a NaN slider.
    const v0 = value[0];
    const min = value.length > 1 ? value[1] : 0;
    const max = value.length > 2 ? value[2] : defaultMax(v0);
    return { type: "slider", key, label, value: v0, min, max, step: value[3] ?? inferStep(min, max) };
  }
  if (typeof value === "number") {
    const min = 0, max = defaultMax(value);
    return { type: "slider", key, label, value, min, max, step: inferStep(min, max) };
  }
  if (typeof value === "boolean") return { type: "toggle", key, label, value };
  if (Array.isArray(value)) return { type: "select", key, label, options: value, value: optValue(value[0]) };
  if (isObj(value) && typeof value.action === "function")
    return { type: "button", key, label: value.label || label, action: value.action };
  if (isObj(value) && Array.isArray(value.options))
    return { type: "select", key, label, options: value.options, value: value.value ?? optValue(value.options[0]) };
  if (isColorStr(value)) return { type: "color", key, label, value };
  if (typeof value === "string") return { type: "string", key, label, value };
  if (isObj(value)) return { type: "folder", key, label, children: Object.entries(value).map(([k, v]) => metaFor(k, v)).filter(Boolean) };
  return null;
}

// ── Slider control (ported from Slider.tsx) ──
const CLICK_THRESHOLD = 3, DEAD_ZONE = 32, MAX_CURSOR_RANGE = 200, MAX_STRETCH = 8;
function createSlider(meta, onChange) {
  const { label, min, max, step } = meta;
  let value = clamp(Number.isFinite(+meta.value) ? +meta.value : min, min, max), pull = 0; // non-finite seed → min, so a NaN value / garbage data-value can't reach the readout or param; pull = the discrete detent's tension offset (read by render(), called below at construction)
  const decimals = stepPrecision(step);

  const wrap = el("div", "tw-slider-wrap");
  const track = el("div", "tw-slider"); if (meta.alt) track.classList.add("tw-slider--alt"); // "slider alternate" — M3 gap: a bar floating between two rounded track pills (workshop variant)
  const hashes = el("div", "tw-slider-hashmarks");
  const fill = el("div", "tw-slider-fill");
  const inactiveBar = meta.alt ? el("div", "tw-slider-inactive") : null; // alt (M3): the inactive track is its own rounded pill, separated from the bar by a transparent gap
  const handle = el("div", "tw-slider-handle");
  const labelEl = el("span", "tw-slider-label"); labelEl.textContent = label;
  const valueEl = el("span", "tw-slider-value");
  track.append(hashes, fill, handle, labelEl, valueEl);
  if (inactiveBar) track.insertBefore(inactiveBar, handle);
  wrap.append(track);

  // Keyboard + ARIA: the track is a focusable role="slider"; value attributes are
  // refreshed in render() below. Arrow keys step (⇧ = coarse), Page jumps a tenth,
  // Home/End snap to the ends — native range semantics.
  track.tabIndex = 0;
  track.setAttribute("role", "slider");
  track.setAttribute("aria-label", label);
  track.setAttribute("aria-valuemin", String(min));
  track.setAttribute("aria-valuemax", String(max));

  // Rule lines (hashmarks) live only on the discrete slider — one per step. The
  // continuous slider has none.
  const discrete = (max - min) / step;
  const snap = discrete <= 6; // snap + show rule lines only for a handful of stops; past ~6, snapping at every step felt notchy ("too many places"), so those run continuous
  const q = (v) => roundToStep(v, min, step);
  const marks = snap ? Array.from({ length: Math.max(0, Math.round(discrete) - 1) }, (_, i) => ((i + 1) * step) / (max - min) * 100) : [];
  for (const pct of marks) { const m = el("div", "tw-slider-hashmark"); m.style.left = pct + "%"; hashes.append(m); }

  // value stays continuous for smooth sliders; fill/handle track it directly,
  // only the readout + emitted value round to step (the fill + handle stay continuous).
  const render = () => {
    const pct = clamp(((value - min) / ((max - min) || 1)) * 100, 0, 100); // clamp the visual; a soft value past max still shows its real number in the readout
    // `pull` is the discrete detent's light tension — the active track stretches a
    // few px off its notch toward the cursor; the handle rides the same edge.
    const off = pull ? ` + ${pull.toFixed(1)}px` : "";
    const edge = `${pct}%${off}`;
    if (meta.alt) {
      // M3 gap that stops short of the ends exactly like the OG handle: the 3px bar centres
      // on the value through the middle, but clamps into [5px, 100%−9px] — the same span the
      // OG handle rides (5px at the floor, trackW−9 at the max) — so it never touches the
      // rounded track edge. The inactive pill derives from the *clamped* bar (so the 3px gaps
      // hold at the extremes); the active fill takes min(value, bar) so it empties to 0 at the
      // floor yet still stops with the bar — never overshooting it — once the bar clamps near max.
      track.style.setProperty("--tw-bar", `clamp(5px, calc(${edge} - 1.5px), calc(100% - 9px))`);
      handle.style.left = "var(--tw-bar)";
      fill.style.width = `max(0px, min(calc(${edge} - 4.5px), calc(var(--tw-bar) - 3px)))`;
      if (inactiveBar) inactiveBar.style.left = `calc(var(--tw-bar) + 6px)`;
    } else {
      fill.style.width = pull ? `calc(${edge})` : pct + "%";
      handle.style.left = `max(5px, calc(${edge} - 9px))`; // the inset hairline rides just inside the fill edge
    }
    valueEl.textContent = q(value).toFixed(decimals);
    track.setAttribute("aria-valuenow", String(q(value)));
    track.setAttribute("aria-valuetext", q(value).toFixed(decimals));
    // Value-dodge: the handle yields only when it actually overlaps the
    // label (left) or value (right) text — comparing the handle's real pixel span
    // (it renders at pct% − 9px, 3px wide) against each text's measured edge, so it
    // dims right as it reaches the number, not a fixed fraction early.
    const trackW = wrap.offsetWidth;
    if (trackW) {
      // Dodge tracks the handle's *actual* span: the default hairline sits at pct%−9
      // (3px wide); the alt's M3 bar is centred on the value at pct%−2 (4px wide). Using
      // the bar's own geometry is what fixes the "miscalculated by the gap" dimming.
      const hOff = meta.alt ? 1.5 : 9, hw = 3; // alt bar is now 3px, same as the default handle
      let hx = Math.max(5, (pct / 100) * trackW + pull - hOff);
      if (meta.alt) hx = Math.min(hx, trackW - 9); // bar clamps inside at the max end (matches the render's --tw-bar)
      const M = 0; // pure overlap on both edges: dim the handle only while it truly covers the label/value and re-show it the instant it clears. (The old 6px value-side buffer dimmed the OG handle a few px early AND kept it dimmed past the readout at the max — so the handle vanished on the trailing edge.)
      const labelLeft = labelEl.offsetLeft, labelRight = labelLeft + labelEl.offsetWidth;  // leading label's span — read live, so it tracks the CSS left + font width and can't drift
      const valueLeft = valueEl.offsetLeft, valueRight = valueLeft + valueEl.offsetWidth;  // trailing value's span — read live, same reason
      // The title: dodge only while the handle actually overlaps it, so the handle
      // reappears the instant it clears — no fixed buffer to sit behind (which reads
      // as a lag past a short title like "Y"). The value keeps that near-miss buffer for the OG only.
      const overLabel = hx < labelRight && hx + hw > labelLeft;
      const overValue = hx < valueRight + M && hx + hw > valueLeft - M;
      track.classList.toggle("is-dodge", overLabel || overValue);
    }
  };
  render();

  let rect = null, scale = 1, downPos = null, isClick = true, snapTimer, fineAnchor = null;
  const GLIDE_FILL = "width 0.34s cubic-bezier(0.34,1.2,0.64,1)";
  const GLIDE_HANDLE = "left 0.34s cubic-bezier(0.34,1.2,0.64,1), opacity 0.15s, transform 0.2s cubic-bezier(0.22,1,0.36,1)";
  // Discrete detent: a clean, quick settle to the next rule line (no bounce). While
  // dragging, the active track lightly tension-pulls off its notch toward the cursor
  // (capped at PULL px) and the handle rides that same filled edge — so the handle
  // never leaves the active track — then it releases to the next line on the snap.
  const DETENT = "cubic-bezier(0.22, 1, 0.36, 1)", PULL = 5, FINE_GAIN = 0.2;
  const DETENT_FILL = `width 0.16s ${DETENT}`;
  const DETENT_HANDLE = `left 0.16s ${DETENT}, opacity 0.15s, transform 0.2s cubic-bezier(0.22,1,0.36,1)`;
  const valFromX = (clientX) => {
    if (!rect) return value;
    const native = wrap.offsetWidth || rect.width;
    const pct = clamp((clientX - rect.left) / scale / native, 0, 1);
    return clamp(min + pct * (max - min), min, max);
  };
  const rubber = (clientX) => {
    let s = 0;
    if (clientX < rect.left) s = -MAX_STRETCH * Math.sqrt(Math.min(Math.max(0, rect.left - clientX - DEAD_ZONE) / MAX_CURSOR_RANGE, 1));
    else if (clientX > rect.right) s = MAX_STRETCH * Math.sqrt(Math.min(Math.max(0, clientX - rect.right - DEAD_ZONE) / MAX_CURSOR_RANGE, 1));
    track.style.width = `calc(100% + ${Math.abs(s)}px)`;
    track.style.transform = s < 0 ? `translateX(${s}px)` : "";
  };
  const set = (v, fire = true) => { v = +v; if (!Number.isFinite(v)) return; value = snap ? clamp(q(v), min, max) : (meta.soft ? v : clamp(v, min, max)); render(); if (fire) onChange(q(value)); }; // non-finite (NaN/±∞ from a stray .set()/restore) is ignored; soft: typed/scripted values may exceed [min,max] (drag stays bounded via valFromX)

  track.addEventListener("pointerdown", (e) => {
    if (valueEl.classList.contains("is-editing")) return;
    e.preventDefault();
    try { e.target.setPointerCapture(e.pointerId); } catch {}
    clearTimeout(snapTimer); track.style.transition = "";
    downPos = { x: e.clientX, y: e.clientY }; isClick = true;
    track.classList.add("is-active");
    rect = wrap.getBoundingClientRect(); scale = rect.width / (wrap.offsetWidth || rect.width);
    // Jump to the pressed position immediately, gliding there. A drag takes over
    // from here; the glide is cleared on the first move so dragging stays 1:1.
    fill.style.transition = GLIDE_FILL; handle.style.transition = GLIDE_HANDLE;
    set(valFromX(e.clientX));
  });
  track.addEventListener("pointermove", (e) => {
    if (!downPos) return;
    // Released off-track (e.g. outside the window, where a captured pointerup never
    // reaches us): the button is up but we're still in the drag. Bail on the next
    // move so the slider doesn't keep following the cursor.
    if (e.buttons === 0) { up(); return; }
    if (isClick && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > CLICK_THRESHOLD) {
      isClick = false; track.classList.add("is-dragging");
      // Continuous follows the cursor 1:1; discrete springs line-to-line (detent).
      if (snap) { fill.style.transition = DETENT_FILL; handle.style.transition = DETENT_HANDLE; }
      else { fill.style.transition = ""; handle.style.transition = ""; }
    }
    if (!isClick) {
      rubber(e.clientX);
      // Alt = fine scrub: drop into a low-gain relative drag, re-anchored the moment
      // Alt engages, so a continuous slider can be tuned sub-pixel. Snap sliders skip
      // it (they quantise anyway); Shift = coarse lives on the keyboard (arrow ×10).
      let raw;
      if (e.altKey && !snap) {
        if (!fineAnchor) fineAnchor = { x: e.clientX, v: value };
        const native = wrap.offsetWidth || rect.width;
        raw = clamp(fineAnchor.v + ((e.clientX - fineAnchor.x) / native) * (max - min) * FINE_GAIN, min, max);
      } else {
        fineAnchor = null;
        raw = valFromX(e.clientX);
      }
      // Light tension: the active track pulls off its snapped notch toward the cursor,
      // capped — computed before render so the fill + handle move together (the handle
      // stays on the filled edge, never beyond it), releasing on the snap.
      if (snap) pull = clamp(((raw - clamp(q(raw), min, max)) / ((max - min) || 1)) * (wrap.offsetWidth || 1), -PULL, PULL);
      set(raw);
    }
    if (e.clientX >= rect.left && e.clientX <= rect.right) { track.style.width = ""; track.style.transform = ""; }
  });
  const up = () => {
    if (!downPos) return;
    // value is already set (on press, then on every move) — release the tension pull so
    // the active track eases home onto its notch, and spring the rubber-band back.
    snapTimer = setTimeout(() => { fill.style.transition = ""; handle.style.transition = ""; }, 360);
    if (pull) { pull = 0; render(); } // the detent transition is still live, so it eases
    track.style.transition = "width 0.35s cubic-bezier(0.22,1,0.36,1), transform 0.35s cubic-bezier(0.22,1,0.36,1)";
    track.style.width = ""; track.style.transform = "";
    setTimeout(() => { track.style.transition = ""; }, 360);
    track.classList.remove("is-active", "is-dragging"); downPos = null; fineAnchor = null;
  };
  track.addEventListener("pointerup", up);
  track.addEventListener("pointercancel", up);
  // Reveal the handle on hover — JS companion to the CSS :hover.
  wireHoverClass(track, render); // re-render the value-dodge with the real track width on first hover
  // Harden the dodge against type metrics it can't predict: recompute once layout +
  // fonts settle (a web-font swap or a custom --tw-font-sans shifts the label/value
  // widths it measures), and on any track-width change. The dodge already reads the
  // real offsetWidth, so it adapts to any font — this just keeps it in sync.
  onReady(render);
  const onResize = () => { if (!track.isConnected) return window.removeEventListener("resize", onResize); render(); }; // panel removed → drop the listener (matches fps/bezier self-cleanup)
  window.addEventListener("resize", onResize);
  track.addEventListener("keydown", (e) => {
    const coarse = e.shiftKey ? 10 : 1, page = (max - min) / 10 || step * 10;
    let nv = value;
    switch (e.key) {
      case "ArrowRight": case "ArrowUp": nv = value + step * coarse; break;
      case "ArrowLeft": case "ArrowDown": nv = value - step * coarse; break;
      case "PageUp": nv = value + page; break;
      case "PageDown": nv = value - page; break;
      case "Home": nv = min; break;
      case "End": nv = max; break;
      default: return;
    }
    e.preventDefault();
    set(clamp(nv, min, max));
  });

  // value: hover 800ms → editable; click → inline input (ported)
  let hoverTimer;
  valueEl.addEventListener("mouseenter", () => { hoverTimer = setTimeout(() => valueEl.classList.add("is-editable"), 800); });
  valueEl.addEventListener("mouseleave", () => { clearTimeout(hoverTimer); if (!valueEl.classList.contains("is-editing")) valueEl.classList.remove("is-editable"); });
  valueEl.addEventListener("pointerdown", (e) => {
    // Touch/pen have no hover to arm the 800ms edit gate, so a deliberate tap on the
    // readout arms it directly (and is kept off the track so it doesn't jump the slider).
    if (e.pointerType && e.pointerType !== "mouse") { valueEl.classList.add("is-editable"); e.stopPropagation(); }
    else if (valueEl.classList.contains("is-editable")) e.stopPropagation();
  });
  valueEl.addEventListener("click", () => {
    if (!valueEl.classList.contains("is-editable")) return;
    const input = el("input", "tw-slider-input"); input.type = "text"; input.inputMode = "decimal"; input.value = q(value).toFixed(decimals);
    valueEl.classList.add("is-editing"); valueEl.replaceWith(input); input.focus(); input.select();
    const commit = () => { const p = parseFloat(input.value); if (!isNaN(p)) set(meta.soft ? p : clamp(p, min, max)); input.replaceWith(valueEl); valueEl.classList.remove("is-editing", "is-editable"); };
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") { input.replaceWith(valueEl); valueEl.classList.remove("is-editing", "is-editable"); } });
  });

  return { el: wrap, set: (v) => set(v, false), get: () => q(value) };
}

// ── Segmented control (ported from SegmentedControl.tsx) ──
function createSegmented(options, value, onChange, ariaLabel) {
  const seg = el("div", "tw-seg"); seg.setAttribute("role", "radiogroup");
  if (ariaLabel) seg.setAttribute("aria-label", ariaLabel);
  const pill = el("div", "tw-seg-pill");
  seg.append(pill);
  const btns = options.map((o) => { const b = radioButton("tw-seg-btn", o, (v) => set(v)); seg.append(b); return b; }); // lazy `set` — it's declared below
  const measure = () => {
    const active = seg.querySelector('[data-active="true"]');
    if (!active) return;
    pill.style.left = active.offsetLeft + "px"; pill.style.width = active.offsetWidth + "px"; // fill the active segment; the 2px flex gap + 2px container padding frame it (same as tabs)
  };
  const reflect = () => { setRadioActive(btns, value); measure(); };
  const set = (v, fire = true) => { value = v; reflect(); if (fire) onChange(v); };
  seg.addEventListener("keydown", (e) => {
    const i = btns.findIndex((b) => b.dataset.value === String(value)); if (i < 0) return;
    let n = i;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % btns.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + btns.length) % btns.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = btns.length - 1;
    else return;
    e.preventDefault(); set(btns[n].dataset.value); btns[n].focus();
  });
  reflect();
  requestAnimationFrame(() => { measure(); seg.classList.add("is-ready"); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  return { el: seg, set: (v) => set(v, false), get: () => value };
}

function createToggle(meta, onChange) {
  const row = el("div", "tw-row");
  const label = el("span", "tw-row-label"); label.textContent = meta.label;
  // A boolean, shown as a two-segment Off/On pill that slides. Picking one of a
  // *list* of options is the radio grid's job now, not an inline segmented row.
  let checked = !!meta.value;
  const seg = createSegmented([{ value: "off", label: "Off" }, { value: "on", label: "On" }], checked ? "on" : "off", (v) => { checked = v === "on"; onChange(checked); }, meta.label);
  row.append(label, seg.el);
  return { el: row, set: (v) => { checked = !!v; seg.set(v ? "on" : "off"); }, get: () => checked };
}

// ── Radio grid — a segmented control wrapped into a 2- or 3-column grid, for a
// small set of short presets (10/25/50/100%, ratios, sizes) that won't fit
// inline on one row. Single-select; columns clamp to 2–3 (default by count). ──
function createRadiogrid(meta, onChange) {
  const options = meta.options || [];
  const cols = Math.min(3, Math.max(2, meta.cols || (options.length <= 3 ? options.length : options.length === 4 ? 2 : 3)));
  const row = el("div", "tw-radiogrid");
  const label = el("span", "tw-radiogrid-label"); label.textContent = meta.label;
  const grid = el("div", "tw-radiogrid-grid"); grid.style.setProperty("--tw-rg-cols", cols);
  grid.setAttribute("role", "radiogroup"); grid.setAttribute("aria-label", meta.label);
  let value = meta.value ?? optValue(options[0]);
  const btns = options.map((o) => { const b = radioButton("tw-radiogrid-btn", o, (v) => set(v)); grid.append(b); return b; }); // lazy `set` — it's declared below
  const reflect = () => setRadioActive(btns, value);
  const set = (v, fire = true) => { value = v; reflect(); if (fire) onChange(v); };
  // Arrow keys roam the grid: ←/→ step linearly (wrapping), ↑/↓ jump a row (by
  // the column count, clamped at the edges); Home/End to the ends.
  grid.addEventListener("keydown", (e) => {
    const i = btns.findIndex((b) => b.dataset.value === String(value)); if (i < 0) return;
    const n = btns.length; let j = i;
    switch (e.key) {
      case "ArrowRight": j = (i + 1) % n; break;
      case "ArrowLeft": j = (i - 1 + n) % n; break;
      case "ArrowDown": j = i + cols < n ? i + cols : i; break;
      case "ArrowUp": j = i - cols >= 0 ? i - cols : i; break;
      case "Home": j = 0; break;
      case "End": j = n - 1; break;
      default: return;
    }
    e.preventDefault(); if (j !== i) { set(btns[j].dataset.value); btns[j].focus(); }
  });
  reflect();
  row.append(label, grid);
  return { el: row, set: (v) => set(v, false), get: () => value };
}

// ── Select (ported from SelectControl.tsx) ──
const CHEVRON = `<svg class="tw-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
function createSelect(meta, onChange) {
  let value = meta.value;
  const opts = meta.options.map((o) => ({ value: optValue(o), label: optLabel(o) }));
  const root = el("div", "tw-select");
  const trigger = el("button", "tw-select-trigger"); trigger.type = "button"; trigger.setAttribute("aria-haspopup", "listbox"); trigger.setAttribute("aria-expanded", "false");
  const labelEl = el("span", "tw-select-label"); labelEl.textContent = meta.label;
  const right = el("span", "tw-select-right");
  const valEl = el("span", "tw-select-value");
  right.append(valEl);
  right.insertAdjacentHTML("beforeend", CHEVRON);
  trigger.append(labelEl, right);
  const dropdown = el("div", "tw-select-dropdown"); dropdown.setAttribute("role", "listbox");
  const optButtons = opts.map((o) => {
    const b = el("button", "tw-select-option"); b.type = "button"; b.setAttribute("role", "option"); b.textContent = o.label; b.dataset.value = o.value;
    b.addEventListener("click", () => { set(o.value); pop.close(); });
    dropdown.append(b); return b;
  });
  root.append(trigger, dropdown);
  const reflect = () => { valEl.textContent = (opts.find((o) => o.value === value) || {}).label ?? value; optButtons.forEach((b) => { const sel = b.dataset.value === value; b.dataset.selected = String(sel); b.setAttribute("aria-selected", String(sel)); }); };
  const set = (v, fire = true) => { value = v; reflect(); if (fire) onChange(v); };
  // The shared popover shell portals the dropdown to <body> (never clipped by the
  // panel's overflow or a transformed ancestor), themes + places it, and closes on
  // outside-press / Esc-back-to-trigger / scroll-away — the same machinery as the
  // colour and gradient editors, so opening the listbox closes any other popover.
  // Only the roving-focus listbox keyboarding below is select-specific.
  const pop = popover(root, trigger, dropdown, {
    width: "match", fallbackH: 200, gap: 4,
    onOpen: () => (optButtons.find((b) => b.dataset.value === value) || optButtons[0])?.focus(),
  });
  // Keyboard: open from the trigger with ↑/↓; once open, roving focus moves through
  // the options (Enter/Space on a focused option selects it natively via click),
  // Escape closes back to the trigger, and Tab/click away closes the listbox.
  trigger.addEventListener("keydown", (e) => {
    if (!pop.isOpen() && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); pop.open(); }
  });
  dropdown.addEventListener("keydown", (e) => {
    const i = optButtons.indexOf(document.activeElement); let j = i;
    if (e.key === "ArrowDown") j = i < 0 ? 0 : Math.min(optButtons.length - 1, i + 1);
    else if (e.key === "ArrowUp") j = i < 0 ? optButtons.length - 1 : Math.max(0, i - 1);
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = optButtons.length - 1;
    else return;
    e.preventDefault(); optButtons[j]?.focus();
  });
  const onFocusOut = (e) => { if (pop.isOpen() && !root.contains(e.relatedTarget) && !dropdown.contains(e.relatedTarget)) pop.close(); };
  trigger.addEventListener("focusout", onFocusOut); dropdown.addEventListener("focusout", onFocusOut);
  reflect();
  return { el: root, set: (v) => set(v, false), get: () => value };
}

function createButton(meta) {
  const b = el("button", "tw-button"); b.type = "button"; b.textContent = meta.label;
  b.addEventListener("click", () => meta.action && meta.action());
  return { el: b, set: () => {}, get: () => undefined };
}

// ── Button group — a row of compact actions under one label (leva's buttonGroup),
// the action sibling to the radio grid. `buttons` is { label: fn } or [{label, action}]. ──
function createButtonGroup(meta) {
  const row = el("div", "tw-row tw-buttongroup");
  if (meta.label) { const label = el("span", "tw-row-label"); label.textContent = meta.label; row.append(label); }
  const group = el("div", "tw-buttongroup-btns");
  const list = Array.isArray(meta.buttons) ? meta.buttons.map((b) => [b.label, b.action]) : Object.entries(meta.buttons || {});
  for (const [lab, fn] of list) {
    const b = el("button", "tw-buttongroup-btn"); b.type = "button"; b.textContent = lab;
    b.addEventListener("click", () => typeof fn === "function" && fn());
    group.append(b);
  }
  row.append(group);
  return { el: row, set: () => {}, get: () => undefined };
}

// ── Separator — a thin divider to break a long panel into sections. ──
function createSeparator() {
  return { el: el("div", "tw-separator"), set: () => {}, get: () => undefined };
}

// ── String — a labelled text input (ported from TextControl.tsx) ──
function createString(meta, onChange) {
  let value = meta.value ?? "";
  // `rows` makes it a multiline textarea (Tweakpane #386 / leva's `rows`): the row
  // grows to fit and aligns its label to the top instead of centring.
  const multi = meta.rows > 0;
  const row = el("div", multi ? "tw-row tw-row-multiline" : "tw-row");
  const label = el("span", "tw-row-label"); label.textContent = meta.label;
  const input = el(multi ? "textarea" : "input", multi ? "tw-text tw-textarea" : "tw-text");
  if (multi) input.rows = meta.rows; else input.type = "text";
  input.value = value;
  if (meta.placeholder) input.placeholder = meta.placeholder;
  input.addEventListener("input", () => { value = input.value; onChange(value); });
  row.append(label, input);
  return { el: row, set: (v) => { value = v; input.value = v; }, get: () => value };
}

// ── Number — a typeable field with a Tweakpane-style grab handle (drag to scrub) ──
function createNumber(meta, onChange) {
  const min = meta.min, max = meta.max, step = meta.step ?? 1;
  const fit = (v) => {
    let n = roundToStep(v, Number.isFinite(min) ? min : 0, step);
    if (!meta.soft) { if (Number.isFinite(min)) n = Math.max(min, n); if (Number.isFinite(max)) n = Math.min(max, n); }
    return n;
  };
  let value = fit(Number.isFinite(+meta.value) ? +meta.value : 0); // non-finite seed → 0, matching the set() guard
  const row = el("div", "tw-row");
  const label = el("span", "tw-row-label"); label.textContent = meta.label;
  const wrap = el("div", "tw-num-wrap");
  const grab = el("span", "tw-num-grab", ICON_GRIP); grab.setAttribute("aria-hidden", "true"); grab.title = "Drag to adjust";
  const input = el("input", "tw-num"); input.type = "text"; input.inputMode = "decimal"; input.value = value;
  wrap.append(grab, input); row.append(label, wrap);
  const set = (v, fire = true) => { v = +v; if (!Number.isFinite(v)) return; value = fit(v); input.value = value; if (fire) onChange(value); };
  input.addEventListener("change", () => { const p = parseFloat(input.value); set(isNaN(p) ? value : p); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
  // grab handle: drag horizontally to scrub (1px ≈ one step), with the shared
  // Tweakpane-style grab guide (dotted line to the cursor + value bubble).
  attachScrub(grab, wrap, step, () => value, set, () => input.value);
  return { el: row, set: (v) => set(v, false), get: () => value };
}

// ── Folder — a collapsible titled group (Tweakpane folders). Returns its inner
// container as `body` so the caller fills it; collapse reuses the grid-rows trick. ──
function createFolder(meta) {
  const root = el("div", "tw-folder");
  const header = el("button", "tw-folder-header"); header.type = "button"; header.setAttribute("aria-expanded", "true");
  header.append(Object.assign(el("span", "tw-folder-title"), { textContent: meta.label }));
  header.insertAdjacentHTML("beforeend", ICON_CHEVRON); // chevron trails the title
  const body = el("div", "tw-folder-body");
  const inner = el("div", "tw-controls"); body.append(inner);
  root.append(header, body);
  header.addEventListener("click", () => { const c = root.classList.toggle("is-collapsed"); header.setAttribute("aria-expanded", c ? "false" : "true"); });
  return { el: root, body: inner };
}

// Display/action controls — they carry no value, so the panel build skips the
// entry/reset/persist wiring for them.
const VALUELESS = new Set(["button", "fps", "monitor", "buttongroup", "separator"]);

// One bad control constructor must not abort the whole panel build — degrade to
// skipping just that control (every caller null-checks). Constructors come from
// the registry: core ones registered below, lazy ones once their module loads.
function createControl(meta, onChange) {
  const make = getControl(meta.type);
  if (!make) return null;
  try { return make(meta, onChange); }
  catch (e) { console.error("[tweaks] control failed to build:", meta && meta.type, e); return null; }
}

// ── Icons for the toolbar ──
// Inline SVGs adapted from Lucide (https://lucide.dev, ISC) and, upstream, Feather
// (https://feathericons.com, MIT). A few are lightly modified — two paths merged into
// one, a radius nudged, a polygon redrawn as a path. ICON_GRIP (shared.ts) is original.
// Per-icon origins and the full ISC + MIT notices: ../../THIRD-PARTY-NOTICES.md.
const ICON_COPY = `<svg class="tw-toolbar-btn__copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const ICON_CHECK = `<svg class="tw-toolbar-btn__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
const ICON_RESET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>`;
const ICON_MINUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>`;
const ICON_SEARCH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`;
const ICON_CHEVRON = `<svg class="tw-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
const ICON_PRESETS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>`;
const ICON_X = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
const ICON_INFO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`;
// Toolbar buttons shared by the live panel and the markup showcase: the copy⇄check
// swap button and the reset button, plus their one-shot animations (the copied flash,
// the reset spin — each stashes its timer on the button as `_t`).
const makeCopyBtn = () => { const b = el("button", "tw-toolbar-btn tw-toolbar-btn--swap", `<span class="tw-toolbar-btn__icons">${ICON_COPY}${ICON_CHECK}</span>`); b.type = "button"; b.title = "Copy values"; b.setAttribute("aria-label", "Copy values"); return b; };
const makeResetBtn = () => { const b = el("button", "tw-toolbar-btn tw-toolbar-btn--reset", ICON_RESET); b.type = "button"; b.title = "Reset"; b.setAttribute("aria-label", "Reset"); return b; };
const flashCopied = (btn) => { btn.classList.add("is-copied"); clearTimeout(btn._t); btn._t = setTimeout(() => btn.classList.remove("is-copied"), 1400); };
const spinReset = (btn) => { btn.classList.remove("is-spinning"); void btn.offsetWidth; btn.classList.add("is-spinning"); clearTimeout(btn._t); btn._t = setTimeout(() => btn.classList.remove("is-spinning"), 500); };

function showToast(msg) {
  const toast = document.querySelector(".toast");
  if (!toast) return;
  toast.textContent = msg; toast.classList.add("show");
  clearTimeout((showToast as any)._t); (showToast as any)._t = setTimeout(() => toast.classList.remove("show"), 2200);
}
// Hint tooltip — one shared, portaled bubble shown by a control's info marker on
// hover/focus. Portaled to <body> so it clears the panel's overflow clip; sits
// above its anchor, flipping below when there's no room. Pointer-transparent.
let hintTip = null, hintTimer = 0;
function showHint(anchor, text, themeVars) {
  if (!hintTip) { hintTip = el("div", "tw-tip"); hintTip.setAttribute("role", "tooltip"); document.body.appendChild(hintTip); }
  clearTimeout(hintTimer);
  hintTip.textContent = text;
  applyThemeVars(hintTip, themeVars);
  hintTip.style.visibility = "hidden"; hintTip.classList.add("is-open");
  const r = anchor.getBoundingClientRect(), w = hintTip.offsetWidth, h = hintTip.offsetHeight;
  const left = clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8);
  const top = r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8;
  hintTip.style.left = left + "px"; hintTip.style.top = top + "px"; hintTip.style.visibility = "";
}
function hideHint() { if (hintTip) hintTimer = setTimeout(() => hintTip.classList.remove("is-open"), 80); }
// A control's `hint` becomes a visible ⓘ marker beside its label that reveals the
// text in the tooltip on hover/focus — discoverable and keyboard-reachable, unlike
// the old native `title`. Shared by the panel build (registerCond) and enhance().
function addHintMarker(node: any, hint: string, themeVars?: any) {
  const label = node.querySelector(".tw-slider-label, .tw-row-label, .tw-select-label, .tw-color-label, .tw-gradient-label, .tw-radiogrid-label, .tw-field-label, .tw-folder-title, .tw-fps-label, .tw-plot-label") || node;
  const mark = el("button", "tw-hint", ICON_INFO); mark.type = "button"; mark.setAttribute("aria-label", hint);
  const show = () => showHint(mark, hint, themeVars);
  mark.addEventListener("pointerenter", show);
  mark.addEventListener("pointerleave", hideHint);
  mark.addEventListener("focus", show);
  mark.addEventListener("blur", hideHint);
  mark.addEventListener("pointerdown", (e) => e.stopPropagation()); // a press on the marker mustn't start a slider scrub or panel drag
  mark.addEventListener("click", (e) => e.preventDefault());
  label.appendChild(mark);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  // Fallback when the clipboard API is blocked (no user activation): the same
  // textarea + execCommand path copy.js uses, so values copy byte-identically.
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.top = "-9999px";
  document.body.appendChild(ta); ta.focus(); ta.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch {}
  document.body.removeChild(ta);
  return ok;
}

// Core controls register synchronously; lazy ones register when imported.
registerControl("slider", createSlider);
registerControl("toggle", createToggle);
registerControl("radiogrid", createRadiogrid);
registerControl("select", createSelect);
registerControl("button", createButton);
registerControl("buttongroup", createButtonGroup);
registerControl("separator", createSeparator);
registerControl("string", createString);
registerControl("number", createNumber);
registerControl("folder", createFolder);

export function tweaks(name: string, schema: Schema, opts: TweaksOptions = {}): Panel {
  const metas = Object.entries(schema).map(([k, v]) => metaFor(k, v)).filter(Boolean);
  const params: Params = {};
  const entries = []; // { target, key, set, get, def, path } — flattened across folders, for reset + persist
  const listeners = new Set<(p?: any, last?: any) => void>();
  let persist = () => {}; // reassigned below when opts.persist is set (debounced localStorage save)
  // Assigned by assemble() below. Declared here so the API returned synchronously can
  // forward to them even on the lazy path, where assemble() runs after modules load.
  let listPresets: () => Record<string, any> = () => ({}), savePreset: (nm?: string) => boolean = () => false, loadPreset: (nm?: string) => boolean = () => false, deletePreset: (nm?: string) => void = () => {};
  let undo = () => {}, redo = () => {};
  // Each listener runs isolated: a throwing on() callback (or internal listener)
  // can't break the others, skip persist(), or bubble back out through set().
  const notify = () => { listeners.forEach((fn) => { try { fn(params, params._last); } catch (e) { console.error("[tweaks] listener threw:", e); } }); persist(); };
  // Persistence + presets storage keys — opt-in via opts.persist (a string key, or
  // `true` to key by the panel name). null disables both (existing callers unaffected).
  const persistKey = opts.persist ? `tw:${opts.persist === true ? name : opts.persist}` : null;
  const presetsKey = persistKey ? `${persistKey}:presets` : null;

  const panel = el("div", "tw-panel"); panel.dataset.mode = "inline";
  // Stop pointer events leaking past the panel to whatever's behind it (e.g. a
  // demo stage that listens on window). The controls have handled them by now.
  stopPointerLeak(panel);
  const header = el("div", "tw-header");
  // Tapping the title collapses the body (Tweakpane-style); the toolbar sits
  // beside it and never triggers a collapse. No chevron — the title is the toggle.
  const titleBtn = el("button", "tw-header-toggle");
  titleBtn.type = "button"; titleBtn.setAttribute("aria-expanded", "true");
  titleBtn.append(Object.assign(el("span", "tw-title"), { textContent: name }));
  const toolbar = el("div", "tw-toolbar");
  // Copy uses the site's contextual icon swap — copy ⇄ check cross-fade (both
  // icons stacked, opacity+scale+blur transitioned), not an innerHTML cut.
  const copyBtn = makeCopyBtn();
  const resetBtn = makeResetBtn();
  // Presets button appears only when persistence is on (presets share its storage).
  let presetsBtn = null;
  if (persistKey) {
    presetsBtn = el("button", "tw-toolbar-btn", ICON_PRESETS); presetsBtn.type = "button"; presetsBtn.title = "Presets";
    presetsBtn.setAttribute("aria-label", "Presets"); presetsBtn.setAttribute("aria-haspopup", "menu"); presetsBtn.setAttribute("aria-expanded", "false");
    toolbar.append(presetsBtn);
  }
  // Filter (opts.filter): a search button swaps the title for an input; typing hides
  // controls whose label doesn't match (folders stay if their title or a child does).
  const filterOn = !!opts.filter;
  const searchBtn = filterOn ? el("button", "tw-toolbar-btn", ICON_SEARCH) : null;
  const searchInput = filterOn ? el("input", "tw-search") : null;
  if (filterOn) {
    searchBtn.type = "button"; searchBtn.title = "Filter"; searchBtn.setAttribute("aria-label", "Filter controls");
    searchInput.type = "text"; searchInput.placeholder = "Filter…"; searchInput.spellcheck = false; searchInput.setAttribute("aria-label", "Filter controls");
    toolbar.append(searchBtn);
  }
  toolbar.append(copyBtn, resetBtn);
  header.append(titleBtn);
  if (filterOn) header.append(searchInput);
  if (opts.toolbar !== false) header.append(toolbar); // opts.toolbar:false → a bare panel (no copy/reset/presets), e.g. an embedded single-control demo
  // A header drag (floating mode) sets this so the click ending the drag doesn't collapse.
  let dragMoved = false;
  titleBtn.addEventListener("click", () => {
    if (dragMoved) { dragMoved = false; return; }
    const collapsed = panel.classList.toggle("is-collapsed");
    titleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  });
  const body = el("div", "tw-body");
  const controls = el("div", "tw-controls");
  body.append(controls);
  panel.append(header, body);

  // Apply the optional theme to the panel; stash it so the portaled popovers —
  // which escape to <body> and lose the panel's inherited vars — re-apply it on open.
  let themeVars = resolveTheme(opts.theme);
  applyThemeVars(panel, themeVars); panel._twTheme = themeVars;

  // Per-control reset: double-click a control's label (or the slider's value
  // readout — its label is a pointer-events:none overlay) to revert just that
  // control to the default it was built with. Complements the whole-panel reset.
  const resetEntry = (e) => { e.set(e.def); e.target[e.key] = e.get(); params._last = e.key; notify(); };
  const wireReset = (root, entry) => {
    const t = root.querySelector(".tw-slider-value")
      || root.querySelector(".tw-row-label, .tw-select-label, .tw-color-label, .tw-gradient-label, .tw-radiogrid-label, .tw-field-label")
      || root;
    t.classList.add("tw-resettable"); t.title = "Double-click or hold to reset";
    // Coarse pointers get a press-and-hold reset — the desktop double-click fights
    // double-tap-zoom on touch. The held class fills a charging cue; releasing or moving
    // off before it completes cancels. On the slider value (which also taps-to-edit), a
    // completed hold drops is-editable and swallows the trailing tap so it resets cleanly.
    let holdT = 0, hx = 0, hy = 0;
    const cancelHold = () => { if (holdT) { clearTimeout(holdT); holdT = 0; t.classList.remove("tw-reset-holding"); } };
    t.addEventListener("pointerdown", (e) => {
      e.stopPropagation(); t._twHeld = false; // a press on the readout shouldn't jump the slider on the way to a reset
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      hx = e.clientX; hy = e.clientY; t.classList.add("tw-reset-holding");
      holdT = setTimeout(() => { holdT = 0; t.classList.remove("tw-reset-holding", "is-editable"); t._twHeld = true; resetEntry(entry); }, 500);
    });
    t.addEventListener("pointermove", (e) => { if (holdT && Math.abs(e.clientX - hx) + Math.abs(e.clientY - hy) > 8) cancelHold(); });
    t.addEventListener("pointerup", cancelHold);
    t.addEventListener("pointercancel", cancelHold);
    t.addEventListener("pointerleave", cancelHold);
    t.addEventListener("contextmenu", (e) => { if (t._twHeld) e.preventDefault(); }); // a long-press mustn't raise the text callout
    t.addEventListener("click", (e) => { if (t._twHeld) { e.preventDefault(); e.stopImmediatePropagation(); t._twHeld = false; } }, true); // a completed hold-reset swallows the trailing tap-to-edit
    t.addEventListener("dblclick", (e) => { e.preventDefault(); e.stopPropagation(); resetEntry(entry); });
  };

  // Conditional controls — `render: (get) => bool` shows/hides; `disabled` (boolean
  // or `(get) => bool`) greys-out + locks; both re-evaluate on every change. `hint`
  // is a static tooltip. registerCond wires whichever a control declared.
  const conditionals = [];
  const registerCond = (node, m) => {
    if (m.hint) addHintMarker(node, m.hint, panel._twTheme);
    if (m.render || m.disabled != null) conditionals.push({ node, m });
  };
  const filterItems = [], filterFolders = []; // searchable index (opts.filter) keyed on each control's real label

  // Build controls into a container, recursing into folders (nested params).
  const build = (container, ms, target, basePath = [], folderItem = null) => {
    for (const m of ms) {
      if (m.type === "tabs") {
        const sub = {}; target[m.key] = sub;
        const makeTabs = getControl("tabs");
        const tabsCtrl = makeTabs && makeTabs(m);
        if (!tabsCtrl) continue; // tabs module ensured before assemble; skip if it failed to load
        m.pages.forEach((page, i) => { const psub = {}; sub[page.key] = psub; build(tabsCtrl.bodies[i], page.children, psub, [...basePath, m.key, page.key]); });
        registerCond(tabsCtrl.el, m); container.append(tabsCtrl.el);
        continue;
      }
      if (m.type === "folder") {
        const sub = {}; target[m.key] = sub;
        const f = createFolder(m);
        const fi = filterOn ? { el: f.el, label: m.label, body: f.body } : null;
        if (fi) filterFolders.push(fi);
        build(f.body, m.children, sub, [...basePath, m.key], fi); registerCond(f.el, m); container.append(f.el);
        continue;
      }
      if (VALUELESS.has(m.type)) { const ctrl = createControl(m, () => {}); if (ctrl) { if (filterOn && m.type !== "separator") filterItems.push({ el: ctrl.el, label: m.label, folder: folderItem }); registerCond(ctrl.el, m); container.append(ctrl.el); } continue; }
      const ctrl = createControl(m, (v) => { target[m.key] = v; params._last = m.key; notify(); });
      if (!ctrl) continue;
      target[m.key] = ctrl.get();
      const entry = { target, key: m.key, set: ctrl.set, get: ctrl.get, def: m.value, path: [...basePath, m.key] };
      entries.push(entry); wireReset(ctrl.el, entry); registerCond(ctrl.el, m);
      if (filterOn) filterItems.push({ el: ctrl.el, label: m.label, folder: folderItem });
      container.append(ctrl.el);
    }
  };

  // Build the controls + wire everything (persistence, presets, undo, filter, …).
  // Runs synchronously when every control type the schema needs is already registered
  // — the readable single-file build, and any split build after the modules have loaded
  // once — and is deferred behind panel.ready otherwise. tweaks() returns synchronously
  // either way: the panel shell + API exist immediately; lazy controls fill in on ready.
  const assemble = () => {
  build(controls, metas, params);

  // Apply the conditionals now and on every change (a sibling's value can flip them).
  if (conditionals.length) {
    const getVal = (k) => { const e = entries.find((x) => x.key === k); return e ? e.target[e.key] : params[k]; };
    const applyConditionals = () => {
      for (const { node, m } of conditionals) {
        // A throwing render/disabled predicate degrades to "leave the node as-is"
        // rather than aborting construction or the whole notify() pass.
        try {
          if (m.render) node.classList.toggle("tw-cond-hidden", !m.render(getVal));
          if (m.disabled != null) { const d = typeof m.disabled === "function" ? m.disabled(getVal) : m.disabled; node.classList.toggle("is-disabled", !!d); node.inert = !!d; } // inert blocks keyboard + focus too, not just the CSS pointer-events
        } catch {}
      }
    };
    listeners.add(applyConditionals); applyConditionals();
  }

  // ── Filter (opts.filter) — the search button swaps the title for a filter input ──
  if (filterOn) {
    const applyFilter = (raw) => {
      const q = raw.trim().toLowerCase();
      if (!q) { filterItems.forEach((i) => i.el.classList.remove("tw-filter-hidden")); filterFolders.forEach((f) => f.el.classList.remove("tw-filter-hidden")); return; }
      for (const it of filterItems) {
        const folderMatch = it.folder && fuzzyMatch(it.folder.label, q);
        it.el.classList.toggle("tw-filter-hidden", !(fuzzyMatch(it.label, q) || folderMatch));
      }
      // innermost folders first, so an outer folder sees its children's resolved state
      for (const f of filterFolders.slice().reverse()) {
        const hasChild = [...f.body.children].some((ch) => !ch.classList.contains("tw-filter-hidden"));
        f.el.classList.toggle("tw-filter-hidden", !(fuzzyMatch(f.label, q) || hasChild));
      }
    };
    const exitSearch = () => { panel.classList.remove("is-searching"); searchInput.value = ""; applyFilter(""); };
    searchBtn.addEventListener("click", () => { if (panel.classList.toggle("is-searching")) { searchInput.focus(); searchInput.select(); } else exitSearch(); });
    searchInput.addEventListener("input", () => applyFilter(searchInput.value));
    searchInput.addEventListener("keydown", (e) => { if (e.key === "Escape") { exitSearch(); searchBtn.focus(); } });
  }

  // ── Persistence + named presets (opt-in via opts.persist) ──────────────────
  // The live values save to localStorage (debounced) and restore on build; presets
  // are named snapshots under "<key>:presets". Path-aware so folders round-trip.
  const readStore = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
  const writeStore = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const atPath = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const snapshot = () => JSON.parse(JSON.stringify(params, (k, v) => (k === "_last" ? undefined : v)));
  const applySnapshot = (snap, fire = true) => {
    if (!snap || typeof snap !== "object") return;
    for (const e of entries) { const v = atPath(snap, e.path); if (v !== undefined) { e.set(v); e.target[e.key] = e.get(); } }
    params._last = undefined; if (fire) notify();
  };
  if (persistKey) {
    let saveT; persist = () => { clearTimeout(saveT); saveT = setTimeout(() => writeStore(persistKey, snapshot()), 150); };
    applySnapshot(readStore(persistKey), false); // restore last session quietly — the host reads params on init
  }
  listPresets = () => { const p = presetsKey ? readStore(presetsKey) : null; return p && typeof p === "object" ? p : {}; };
  savePreset = (nm) => { if (!presetsKey || !nm) return false; const all = listPresets(); all[nm] = snapshot(); writeStore(presetsKey, all); return true; };
  loadPreset = (nm) => { const all = listPresets(); if (all[nm]) { applySnapshot(all[nm]); return true; } return false; };
  deletePreset = (nm) => { if (!presetsKey) return; const all = listPresets(); delete all[nm]; writeStore(presetsKey, all); };

  // ── Floating mode (opts.floating) ──────────────────────────────────────────
  // A fixed, draggable panel. Drag the header to move it; a click on the title
  // (no drag past the threshold) still collapses. `true` → top-left default;
  // `{ x, y }` → an explicit start. Position persists to "<key>:pos" when
  // persistence is on, so a dragged panel returns where the user left it.
  if (opts.floating) {
    panel.dataset.mode = "floating";
    const posKey = persistKey ? `${persistKey}:pos` : null;
    const saved = posKey ? readStore(posKey) : null;
    const start = saved || (typeof opts.floating === "object" ? opts.floating : null) || { x: 16, y: 16 };
    let px = +start.x || 16, py = +start.y || 16;
    const apply = () => { panel.style.left = px + "px"; panel.style.top = py + "px"; };
    apply();
    let dragId = null, sx = 0, sy = 0, ox = 0, oy = 0;
    header.addEventListener("pointerdown", (e) => {
      // Let the toolbar buttons and any inputs work; drag from anywhere else on the header.
      if (e.button !== 0 || e.target.closest(".tw-toolbar, input, textarea, select")) return;
      dragId = e.pointerId; sx = e.clientX; sy = e.clientY; ox = px; oy = py; dragMoved = false;
      try { header.setPointerCapture(dragId); } catch {}
      panel.classList.add("is-dragging");
    });
    header.addEventListener("pointermove", (e) => {
      if (e.pointerId !== dragId) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragMoved && Math.abs(dx) + Math.abs(dy) < 4) return; // a few px of slop before it counts as a drag, not a click
      dragMoved = true;
      const maxX = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
      const maxY = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
      px = clamp(ox + dx, 8, maxX); py = clamp(oy + dy, 8, maxY); apply();
    });
    const endDrag = (e) => {
      if (e.pointerId !== dragId) return;
      try { header.releasePointerCapture(dragId); } catch {}
      dragId = null; panel.classList.remove("is-dragging");
      if (dragMoved && posKey) writeStore(posKey, { x: px, y: py });
    };
    header.addEventListener("pointerup", endDrag);
    header.addEventListener("pointercancel", endDrag);
  }

  if (presetsBtn) {
    const menu = el("div", "tw-presets-menu");
    const saveRow = el("div", "tw-presets-save");
    const input = el("input", "tw-presets-input"); input.type = "text"; input.placeholder = "Preset name…"; input.spellcheck = false; input.setAttribute("aria-label", "New preset name");
    const saveBtn = el("button", "tw-presets-savebtn"); saveBtn.type = "button"; saveBtn.textContent = "Save";
    saveRow.append(input, saveBtn);
    const list = el("div", "tw-presets-list");
    menu.append(saveRow, list);
    const renderList = () => {
      const all = listPresets(), names = Object.keys(all);
      list.replaceChildren();
      if (!names.length) { const empty = el("div", "tw-presets-empty"); empty.textContent = "No presets yet"; list.append(empty); return; }
      for (const nm of names) {
        const row = el("div", "tw-presets-row");
        const load = el("button", "tw-presets-load"); load.type = "button"; load.textContent = nm;
        load.addEventListener("click", () => { loadPreset(nm); menuPop.close(); showToast(`Loaded “${nm}”`); });
        const del = el("button", "tw-presets-del", ICON_X); del.type = "button"; del.setAttribute("aria-label", `Delete preset ${nm}`);
        del.addEventListener("click", (e) => { e.stopPropagation(); deletePreset(nm); renderList(); });
        row.append(load, del); list.append(row);
      }
    };
    const doSave = () => { const nm = input.value.trim(); if (!nm) { input.focus(); return; } savePreset(nm); input.value = ""; renderList(); showToast(`Saved “${nm}”`); };
    // The shared popover shell again — portaled, theme-carried, outside/Esc/scroll-away
    // close, single-open with the editors. align:"end" hangs it off the button's right
    // edge (it sits at the panel's right corner).
    const menuPop = popover(presetsBtn, presetsBtn, menu, {
      width: 208, fallbackH: 160, gap: 6, align: "end",
      onOpen: () => { renderList(); input.focus(); },
    });
    saveBtn.addEventListener("click", doSave);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSave(); });
  }

  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(JSON.stringify(params, (k, v) => (k === "_last" ? undefined : v), 2));
    if (ok) { flashCopied(copyBtn); showToast(`${name} values copied`); }
    else showToast("Copy failed");
  });
  // A host can supply its own reset (e.g. restore real app defaults + rebuild);
  // otherwise reset each control to the default it was built with. The icon spins
  // once on click — motion feedback to match the copy swap.
  resetBtn.addEventListener("click", () => {
    spinReset(resetBtn);
    if (typeof opts.onReset === "function") return opts.onReset();
    entries.forEach((e) => { e.set(e.def); e.target[e.key] = e.get(); }); params._last = undefined; notify();
  });

  // ── Edit lifecycle (opts.onEditStart / onEditEnd) — fired when a drag/scrub on any
  // in-panel control begins and ends, so a host can pause expensive work during a
  // continuous edit and commit once on release. Continuous values still flow via on(). ──
  if (opts.onEditStart || opts.onEditEnd) {
    const DRAG_SEL = ".tw-slider, .tw-num-grab, .tw-pad, .tw-wg-area, .tw-wg-hue, .tw-wg-alpha, .tw-bezier-handle, .tw-gradient-bar, .tw-gradient-stop";
    let editing = false;
    panel.addEventListener("pointerdown", (e) => { if (!editing && e.target.closest(DRAG_SEL)) { editing = true; opts.onEditStart && opts.onEditStart(); } });
    const endEdit = () => { if (editing) { editing = false; opts.onEditEnd && opts.onEditEnd(); } };
    panel.addEventListener("pointerup", endEdit);
    panel.addEventListener("pointercancel", endEdit);
  }

  // ── Undo / redo (opts.undo) — a debounced history of snapshots. Cmd/Ctrl-Z undoes,
  // ⇧ (or Ctrl-Y) redoes, scoped to when the panel is hovered or focused so it doesn't
  // hijack the page's own undo. A continuous drag coalesces into one step. ──
  if (opts.undo) {
    let history = [snapshot()], histIdx = 0, applyingHistory = false, histTimer = 0;
    const commit = () => {
      histTimer = 0;
      const snap = snapshot();
      if (JSON.stringify(snap) === JSON.stringify(history[histIdx])) return; // unchanged
      history = history.slice(0, histIdx + 1); history.push(snap); histIdx = history.length - 1; // a new edit drops the redo branch
    };
    const record = () => { if (applyingHistory) return; clearTimeout(histTimer); histTimer = setTimeout(commit, 350); };
    const flush = () => { if (histTimer) { clearTimeout(histTimer); commit(); } }; // commit a pending edit first, so ⌘Z right after a change still undoes it
    listeners.add(record);
    const restore = (idx) => { applyingHistory = true; applySnapshot(history[idx]); applyingHistory = false; histIdx = idx; };
    undo = () => { flush(); if (histIdx > 0) restore(histIdx - 1); };
    redo = () => { flush(); if (histIdx < history.length - 1) restore(histIdx + 1); };
    const focused = () => panel.matches(":hover") || panel.contains(document.activeElement);
    document.addEventListener("keydown", (e) => {
      if (!focused() || !(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (k === "y") { e.preventDefault(); redo(); }
    });
  }
  }; // end assemble

  // The API is built + returned synchronously. on/set/reset/setTheme operate on the
  // shell (live immediately); the presets + undo methods forward to bindings assemble()
  // fills in (no-ops until then — only reachable on the lazy path, before ready).
  const api: any = {
    el: panel, params,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    set(key, v) { const e = entries.find((x) => x.target === params && x.key === key); if (e) { e.set(v); params[key] = e.get(); } else params[key] = v; notify(); },
    reset() { resetBtn.click(); },
    // Live theming — re-applies --tw-* vars to the panel (and future popovers). Clears
    // the prior theme first, so setTheme(null) reverts to the default monochrome look.
    setTheme(theme) { if (themeVars) for (const k in themeVars) panel.style.removeProperty(k); themeVars = resolveTheme(theme); panel._twTheme = themeVars; applyThemeVars(panel, themeVars); window.dispatchEvent(new Event("tw-retheme")); },
    // Presets API (no-ops without opts.persist). Names are arbitrary strings.
    savePreset: (nm) => savePreset(nm), loadPreset: (nm) => loadPreset(nm), deletePreset: (nm) => deletePreset(nm), presets: () => Object.keys(listPresets()),
    undo: () => undo(), redo: () => redo(), // no-ops without opts.undo
  };
  // Lazy controls: if the schema needs feature modules not yet loaded, assemble once
  // they resolve and surface that on panel.ready / api.ready; otherwise assemble now
  // (synchronous — the monolith and warmed-up split builds always take this path).
  const pending = ensureForMetas(metas);
  if (pending) { api.ready = panel.ready = pending.then(assemble).then(() => api); }
  else { assemble(); api.ready = panel.ready = Promise.resolve(api); }
  return api as Panel;
}

// ── Markup-driven enhancement (the showcase: minimal [data-tw] hosts → live control) ──
const dataMeta = (host) => {
  const d = host.dataset, type = d.tw, label = d.label || titleCase(d.key || type);
  if (type === "slider") return { type, key: "v", label, value: +(d.value ?? 0), min: +(d.min ?? 0), max: +(d.max ?? 100), step: +(d.step || inferStep(+(d.min ?? 0), +(d.max ?? 100))), soft: d.soft === "true" || d.soft === "", alt: d.alt === "true" || d.alt === "" };
  if (type === "toggle") {
    // A list of options is a single-select → radio grid; a bare toggle is boolean.
    const options = d.options ? d.options.split(",").map((s) => s.trim()).filter(Boolean) : null;
    if (options) return { type: "radiogrid", key: "v", label, options, value: d.value ?? options[0], cols: d.cols != null ? +d.cols : undefined };
    return { type, key: "v", label, value: d.checked === "true" };
  }
  if (type === "radiogrid") return { type, key: "v", label, options: (d.options || "").split(",").map((s) => s.trim()).filter(Boolean), value: d.value, cols: d.cols != null ? +d.cols : undefined };
  if (type === "select") return { type, key: "v", label, options: (d.options || "").split(",").map((s) => s.trim()).filter(Boolean), value: d.value };
  if (type === "color") return { type, key: "v", label, value: d.value || "#7c5cff" };
  if (type === "button") return { type, key: "v", label, action: () => showToast(`${label} pressed`) };
  if (type === "buttongroup") return { type, key: "v", label, buttons: (d.buttons || "").split(",").map((s) => s.trim()).filter(Boolean).map((lab) => ({ label: lab, action: () => showToast(`${lab} pressed`) })) };
  if (type === "separator") return { type, key: "v", label };
  if (type === "number") return { type, key: "v", label, value: +(d.value ?? 0), min: d.min != null ? +d.min : undefined, max: d.max != null ? +d.max : undefined, step: +(d.step || 1) };
  if (type === "string") return { type, key: "v", label, value: d.value ?? "", placeholder: d.placeholder, rows: d.rows != null ? +d.rows : undefined };
  if (type === "image") return { type, key: "v", label, value: d.value || "" };
  if (type === "fps") return { type, key: "v", label: d.label || "FPS" };
  if (type === "interval") { const mn = +(d.min ?? 0), mx = +(d.max ?? 1); return { type, key: "v", label, value: (d.value || (mn + "," + mx)).split(",").map(Number), min: mn, max: mx, step: +(d.step || inferStep(mn, mx)) }; }
  if (type === "spring") return { type, key: "v", label, value: { stiffness: +(d.stiffness ?? 300), damping: +(d.damping ?? 26), mass: +(d.mass ?? 1) } };
  if (type === "bezier") return { type, key: "v", label, value: (d.value || "0.25,0.1,0.25,1").split(",").map(Number) };
  if (type === "point") {
    const labels = (d.components || "X,Y").split(",").map((s) => s.trim()).filter(Boolean);
    const vals = (d.value || "").split(",").map((s) => parseFloat(s));
    const step = d.step != null ? +d.step : 1, min = d.min != null ? +d.min : undefined, max = d.max != null ? +d.max : undefined;
    const components = labels.map((lab, i) => ({ key: lab.toLowerCase(), label: lab, value: isNaN(vals[i]) ? 0 : vals[i], step, min, max }));
    return { type, key: "v", label, pad: d.pad === "true" || d.pad === "", invertY: d.invertY === "true", components, value: Object.fromEntries(components.map((c) => [c.key, c.value])) }; // `value` = default map so a static-panel reset restores the point
  }
  if (type === "plot") {
    const expr = d.expr ?? "sin(x)";
    return { type, key: "v", label, value: expr, expr, fn: null, xMin: d.xmin != null ? +d.xmin : -10, xMax: d.xmax != null ? +d.xmax : 10, yMin: d.ymin != null ? +d.ymin : undefined, yMax: d.ymax != null ? +d.ymax : undefined, samples: d.samples != null ? +d.samples : undefined, editable: d.editable !== "false" };
  }
  return null;
};
export async function enhance(root: Document | Element = document): Promise<void> {
  // Static showcase panels collapse like the real one: wrap the controls in a
  // .tw-body and turn the header title into a collapse toggle (Tweakpane-style).
  // Panels built by tweaks() already nest controls in .tw-body, so they're skipped.
  root.querySelectorAll('.tw-panel[data-mode="inline"]:not([data-tw-panel-bound])').forEach((panel) => {
    const header = panel.querySelector(":scope > .tw-header");
    const controls = panel.querySelector(":scope > .tw-controls");
    if (!header || !controls) return;
    panel.setAttribute("data-tw-panel-bound", "");
    const body = el("div", "tw-body"); panel.insertBefore(body, controls); body.append(controls);
    let btn: any = header.querySelector(".tw-header-toggle");
    const title = header.querySelector(".tw-title");
    if (!btn && title) { btn = el("button", "tw-header-toggle"); btn.type = "button"; title.replaceWith(btn); btn.append(title); }
    if (!btn) return;
    btn.setAttribute("aria-expanded", "true");
    btn.addEventListener("click", () => { const c = panel.classList.toggle("is-collapsed"); btn.setAttribute("aria-expanded", c ? "false" : "true"); });
    // Copy + reset are part of the component, so the static samples carry them too —
    // the same toolbar tweaks() builds, operating over this panel's own [data-tw]
    // controls (gathered lazily at click time; they're created in the pass below).
    if (!header.querySelector(".tw-toolbar")) {
      const name = (title && title.textContent) || "Panel";
      const toolbar = el("div", "tw-toolbar");
      const copyBtn = makeCopyBtn();
      const resetBtn = makeResetBtn();
      toolbar.append(copyBtn, resetBtn); header.append(toolbar);
      const live = () => [...panel.querySelectorAll("[data-tw]")].map((h: any) => h._tw).filter((t: any) => t && t.ctrl.get() !== undefined);
      copyBtn.addEventListener("click", async () => {
        const vals = {}; for (const t of live()) vals[t.key] = t.ctrl.get();
        const ok = await copyText(JSON.stringify(vals, null, 2));
        if (ok) { flashCopied(copyBtn); showToast(`${name} values copied`); }
        else showToast("Copy failed");
      });
      resetBtn.addEventListener("click", () => {
        spinReset(resetBtn);
        for (const t of live()) { t.ctrl.set(t.def); t.host.dataset.value = t.ctrl.get(); }
      });
    }
  });
  // Folders first: build the collapsible chrome and move child [data-tw] hosts into it.
  root.querySelectorAll('[data-tw="folder"]:not([data-tw-bound])').forEach((host: any) => {
    host.setAttribute("data-tw-bound", "");
    const f = createFolder({ label: host.dataset.label || "Folder" });
    [...host.children].forEach((c) => f.body.append(c));
    host.append(f.el);
  });
  // Claim each host + its meta synchronously (so a re-entrant enhance can't double-bind),
  // load any lazy modules they need, then build. Markup enhancement is fire-and-forget,
  // so awaiting here is fine — a lazy control simply pops in once its chunk resolves.
  const hosts = [...root.querySelectorAll("[data-tw]:not([data-tw-bound])")]
    .map((h: any) => ({ host: h, meta: dataMeta(h) }))
    .filter((x) => x.meta);
  hosts.forEach(({ host }) => host.setAttribute("data-tw-bound", ""));
  const pend = ensureForMetas(hosts.map((x) => x.meta));
  if (pend) await pend;
  for (const { host, meta } of hosts) {
    const ctrl = createControl(meta, (v) => (host.dataset.value = v));
    if (ctrl) { host.append(ctrl.el); if (host.dataset.hint) addHintMarker(ctrl.el, host.dataset.hint); host._tw = { ctrl, def: meta.value, key: meta.label, host }; }
  }
}

if (typeof document !== "undefined") {
  const run = () => enhance(document);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
}

