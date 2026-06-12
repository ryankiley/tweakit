/* Tweaks — a dependency-free real-time parameter panel.
 *
 * Hand it a plain schema object and it builds a live control panel — sliders,
 * toggles, dropdowns, wide-gamut colour pickers, curve editors and more — with
 * zero runtime dependencies. Two ways in, one code path:
 *   • tweaks(name, schema, opts) — build an inline panel, returns { params, on, set, reset, el }
 *   • enhance(root)             — turn [data-tw] markup into a live control (the showcase)
 *
 * Schema shorthands:
 *   [default, min, max, step?] → slider     true|false → checkbox
 *   ["a","b"] | {options,value}→ list       "#rrggbb"  → colour
 *   { action: fn, label? }     → button
 */

import {
  titleCase, clamp, isColorStr, stepPrecision, roundToStep, inferStep, defaultRange,
  optValue, optLabel, el, popover, closeActivePopover, stopPointerLeak, applyThemeVars, resolveTheme, onReady,
  wireHoverClass, fuzzyMatch, setRadioActive, radioButton, attachScrub, stretchPill, ICON_GRIP, REDUCE_MOTION,
  registerControl, getControl,
} from "./shared.js";
import type { Schema, TweaksOptions, Panel, Params } from "./types.js";
// Re-export the public types so `import type { Schema, Panel } from "tweakability"`
// works from either entry — they erase at build time.
export type { Schema, SchemaValue, SchemaObject, ControlOptions, Option, GradientStop, Get, TweaksOptions, Theme, Params, Panel, Control } from "./types.js";

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
  fpsgraph: () => import("./controls/monitor.js"),
  monitor: () => import("./controls/monitor.js"),
  spring: () => import("./controls/spring.js"),
  cubicbezier: () => import("./controls/bezier.js"),
  point: () => import("./controls/point.js"),
  plot: () => import("./controls/plot.js"),
} : {};
const loading: Record<string, Promise<unknown>> = {};
const ensure = (type) => (getControl(type) || !LAZY_IMPORT[type]) ? null : (loading[type] ||= LAZY_IMPORT[type]().catch((e) => { delete loading[type]; console.error(`[tweaks] control chunk "${type}" failed to load:`, e); throw e; })); // a rejection isn't cached — a later panel retries the chunk
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
function metaFor(key, value, depth = 0) {
  if (key === "__proto__" || key === "constructor" || key === "prototype") return null; // params is an object-as-map — these keys would write through to the prototype
  const meta = baseMetaFor(key, value, depth);
  if (meta && value && typeof value === "object") {
    if (typeof value.render === "function") meta.render = value.render;
    if (value.disabled != null) meta.disabled = value.disabled;
    if (value.hint != null) meta.hint = String(value.hint);
  }
  return meta;
}
// True for an object-form schema value (the verbose `{ type, … }` shapes).
const isObj = (v) => v && typeof v === "object";
// Did a value actually change? Identity for primitives; structural (JSON) for the
// object-valued controls (spring/point/gradient/bezier), whose get() returns a fresh
// object each call. Gates notify() so a same-value set()/emit can't echo — an on()
// listener mirroring values back into the panel recursed to stack exhaustion without it.
const valueChanged = (a, b) => a !== b && !(isObj(a) && isObj(b) && JSON.stringify(a) === JSON.stringify(b));

// ── Verbose `{ type: "…" }` forms — one handler per control type. Adding a control
// means one entry here (plus its constructor in the registry). A handler returns a
// falsy value for a malformed shape (e.g. a point without components), which falls
// through to the shorthand inference — where a plain object still becomes a folder.
// The explicit slider/number/checkbox forms exist so shorthand controls can carry
// options (render / disabled / hint / step) the array/boolean shorthands can't.
const radiogridMeta = (v, key, label) => Array.isArray(v.options) && { type: "radiogrid", key, label, options: v.options, value: v.value ?? optValue(v.options[0]), cols: v.cols };
const TYPED_META: Record<string, (v: any, key: string, label: string, depth?: number) => any> = {
  slider: (v, key, label) => { const mn = v.min ?? 0, mx = v.max ?? 1; return { type: "slider", key, label, value: v.value ?? mn, min: mn, max: mx, step: v.step ?? inferStep(mn, mx), soft: v.soft }; },
  number: (v, key, label) => ({ type: "number", key, label, value: v.value ?? 0, min: v.min, max: v.max, step: v.step ?? 1, soft: v.soft }),
  checkbox: (v, key, label) => ({ type: "checkbox", key, label, value: !!v.value }),
  // "segmented" is kept as an alias: picking one of a list renders as the radio
  // grid (the nicer-looking single-select). The inline pill is reserved for booleans.
  radiogrid: radiogridMeta,
  segmented: radiogridMeta,
  list: (v, key, label) => Array.isArray(v.options) && { type: "list", key, label, options: v.options, value: v.value ?? optValue(v.options[0]) },
  // An explicit colour with a custom label: { type: "color", value: "#hex", label: "Background" }.
  color: (v, key, label) => ({ type: "color", key, label: v.label || label, value: v.value }),
  text: (v, key, label) => ({ type: "text", key, label, value: v.value ?? "", rows: v.rows, placeholder: v.placeholder }),
  interval: (v, key, label) => { const mn = v.min ?? 0, mx = v.max ?? 1; return { type: "interval", key, label, value: (Array.isArray(v.value) ? v.value : [mn, mx]).map(Number), min: mn, max: mx, step: v.step ?? inferStep(mn, mx) }; },
  // The config reads off the top level or a nested `value: {…}` — both published forms.
  spring: (v, key, label) => { const s = isObj(v.value) ? v.value : v; return { type: "spring", key, label, value: { stiffness: s.stiffness ?? 300, damping: s.damping ?? 26, mass: s.mass ?? 1 } }; },
  cubicbezier: (v, key, label) => ({ type: "cubicbezier", key, label, value: Array.isArray(v.value) && v.value.length === 4 ? v.value.map(Number) : [0.25, 0.1, 0.25, 1] }),
  point: (v, key, label) => Array.isArray(v.components) && { type: "point", key, label, components: v.components, pad: v.pad, invertY: v.invertY, value: Object.fromEntries(v.components.map((c) => [c.key, c.value ?? 0])) }, // `value` = the default component map, so reset() / double-click-reset can restore it
  gradient: (v, key, label) => ({ type: "gradient", key, label, value: v.value ?? v.stops ?? null }),
  image: (v, key, label) => ({ type: "image", key, label, value: v.value || "" }),
  plot: (v, key, label) => {
    const expr = v.expr != null ? String(v.expr) : (typeof v.fn === "function" ? "" : "sin(x)");
    return { type: "plot", key, label, value: expr, expr, fn: typeof v.fn === "function" ? v.fn : null,
      xMin: v.xMin ?? v.min ?? -10, xMax: v.xMax ?? v.max ?? 10,
      yMin: v.yMin, yMax: v.yMax, samples: v.samples, editable: v.editable };
  },
  fpsgraph: (v, key, label) => ({ type: "fpsgraph", key, label: v.label || label }),
  monitor: (v, key, label) => ({ type: "monitor", key, label, get: v.get, value: v.value, graph: v.graph, view: v.view, min: v.min, max: v.max, interval: v.interval, rows: v.rows, decimals: v.decimals }),
  buttongroup: (v, key, label) => ({ type: "buttongroup", key, label, buttons: v.buttons }),
  separator: (v, key, label) => ({ type: "separator", key, label }),
  // Page keys dedupe ("A!" and "A?" both slug to "a") so two pages can't silently share
  // one params subtree (the second used to overwrite the first, losing its values).
  tabs: (v, key, label, depth) => {
    if (!v.pages || typeof v.pages !== "object") return false;
    const used = new Set();
    return { type: "tabs", key, label, pages: Object.entries(v.pages).map(([title, schema]: [string, any]) => {
      const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tab";
      let k = base, n = 2; while (used.has(k)) k = `${base}-${n++}`; used.add(k);
      return { key: k, title, children: Object.entries(schema).map(([ck, sv]) => metaFor(ck, sv, (depth || 0) + 1)).filter(Boolean) };
    }) };
  },
};

function baseMetaFor(key, value, depth = 0) {
  if (depth > 64) return null; // a pathologically deep schema degrades to skipped controls instead of a RangeError out of tweaks()
  const label = titleCase(key);
  if (isObj(value) && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(TYPED_META, value.type)) { // hasOwnProperty, so a stray type like "toString" can't hit Object.prototype
    // A handler that THROWS on a malformed shape (a null components entry, pages: { A: null })
    // degrades to skipping that control — not a TypeError out of tweaks() that drops the whole
    // panel. (A falsy return still falls through to shorthand inference, as documented above.)
    let meta;
    try { meta = TYPED_META[value.type](value, key, label, depth); }
    catch (e) { console.error(`[tweaks] malformed "${value.type}" schema value for "${key}" — control skipped:`, e); return null; }
    if (meta) return meta;
  }
  // ── Shorthand inference ──
  // Interval / range: [[lo, hi], min, max, step?] — the first entry is a 2-tuple.
  if (Array.isArray(value) && Array.isArray(value[0]) && value[0].length === 2 && typeof value[0][0] === "number") {
    // Missing bounds fall back to the tuple itself ([[2,8]] → min 2, max 8) — an
    // undefined min/max used to ride into the control as NaN ("NaN – NaN").
    const mn = Number.isFinite(+value[1]) ? +value[1] : +value[0][0], mx = Number.isFinite(+value[2]) ? +value[2] : +value[0][1];
    return { type: "interval", key, label, value: value[0].map(Number), min: mn, max: mx, step: value[3] ?? inferStep(mn, mx) };
  }
  if (Array.isArray(value) && value.length <= 4 && typeof value[0] === "number") {
    // Tolerate a short array (e.g. [n] = "just a default"): fall back to a sensible
    // range the way a bare number does, so a missing min/max can't yield a NaN slider.
    const v0 = value[0];
    const [dmin, dmax] = defaultRange(v0);
    const min = value.length > 1 ? value[1] : dmin;
    const max = value.length > 2 ? value[2] : dmax;
    return { type: "slider", key, label, value: v0, min, max, step: value[3] ?? inferStep(min, max) };
  }
  if (typeof value === "number") {
    const [min, max] = defaultRange(value);
    return { type: "slider", key, label, value, min, max, step: inferStep(min, max) };
  }
  if (typeof value === "boolean") return { type: "checkbox", key, label, value };
  if (Array.isArray(value)) return { type: "list", key, label, options: value, value: optValue(value[0]) };
  if (isObj(value) && typeof value.action === "function")
    return { type: "button", key, label: value.label || label, action: value.action };
  if (isObj(value) && Array.isArray(value.options))
    return { type: "list", key, label, options: value.options, value: value.value ?? optValue(value.options[0]) };
  if (isColorStr(value)) return { type: "color", key, label, value };
  if (typeof value === "string") return { type: "text", key, label, value };
  // Option keys metaFor consumes off this same object (render / disabled / hint) are the
  // folder's chrome, not children — a folder's `disabled: true` mustn't also build a checkbox.
  if (isObj(value)) return { type: "folder", key, label, children: Object.entries(value).filter(([k, v]) => !(k === "render" && typeof v === "function") && !((k === "disabled" || k === "hint") && v != null)).map(([k, v]) => metaFor(k, v, depth + 1)).filter(Boolean) };
  return null;
}

// ── Slider control (ported from Slider.tsx) ──
const CLICK_THRESHOLD = 3, DEAD_ZONE = 32, MAX_CURSOR_RANGE = 200, MAX_STRETCH = 8;
function createSlider(meta, onChange) {
  const label = meta.label;
  // Normalise the range before anything reads it: non-finite bounds get defaults, an
  // inverted pair swaps (a backwards schema/markup used to clamp the value to the wrong
  // end), and a degenerate step re-infers — every slider source (schema shorthand,
  // verbose form, [data-tw] markup) funnels through here.
  let min = +meta.min, max = +meta.max, step = +meta.step;
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = min + 100;
  if (max < min) { const t = min; min = max; max = t; }
  if (!(step > 0) || step > max - min) step = inferStep(min, max);
  const snap = (max - min) / step <= 6; // snap + show rule lines only for a handful of stops; past ~6, snapping at every step felt notchy ("too many places"), so those run continuous
  const seed = Number.isFinite(+meta.value) ? +meta.value : min; // non-finite seed → min, so a NaN value / garbage data-value can't reach the readout or param
  let value = meta.soft && !snap ? seed : clamp(seed, min, max), pull = 0; // a soft slider keeps an out-of-range default — the seed is a scripted value, so it follows set()'s soft rule (only the snap slider always clamps, also like set()); pull = the discrete detent's tension offset (read by render(), called below at construction)
  const decimals = stepPrecision(step);

  const wrap = el("div", "tw-slider-wrap");
  const track = el("div", "tw-slider");
  const hashes = el("div", "tw-slider-hashmarks");
  const fill = el("div", "tw-slider-fill");
  const handle = el("div", "tw-slider-handle");
  const labelEl = el("span", "tw-slider-label"); labelEl.textContent = label;
  const valueEl = el("span", "tw-slider-value");
  track.append(hashes, fill, handle, labelEl, valueEl);
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
  const q = (v) => roundToStep(v, min, step);
  const marks = snap ? Array.from({ length: Math.max(0, Math.round((max - min) / step) - 1) }, (_, i) => ((i + 1) * step) / (max - min) * 100) : [];
  for (const pct of marks) { const m = el("div", "tw-slider-hashmark"); m.style.left = pct + "%"; hashes.append(m); }

  // value stays continuous for smooth sliders; fill/handle track it directly,
  // only the readout + emitted value round to step (the fill + handle stay continuous).
  const render = () => {
    const pct = clamp(((value - min) / ((max - min) || 1)) * 100, 0, 100); // clamp the visual; a soft value past max still shows its real number in the readout
    // `pull` is the discrete detent's light tension — the active track stretches a
    // few px off its notch toward the cursor; the handle rides the same edge.
    const off = pull ? ` + ${pull.toFixed(1)}px` : "";
    const edge = `${pct}%${off}`;
    fill.style.width = pull ? `calc(${edge})` : pct + "%";
    handle.style.left = `max(5px, calc(${edge} - 9px))`; // the inset hairline rides just inside the fill edge
    valueEl.textContent = q(value).toFixed(decimals);
    track.setAttribute("aria-valuenow", String(q(value)));
    track.setAttribute("aria-valuetext", q(value).toFixed(decimals));
    // Value-dodge: the handle yields only when it actually overlaps the
    // label (left) or value (right) text — comparing the handle's real pixel span
    // (it renders at pct% − 9px, 3px wide) against each text's measured edge, so it
    // dims right as it reaches the number, not a fixed fraction early.
    const trackW = wrap.offsetWidth;
    if (trackW) {
      // Dodge tracks the handle's *actual* span: the hairline sits at pct%−9 (3px wide),
      // so comparing that span against the label/value text edges fixes the early-dim.
      const hOff = 9, hw = 3;
      let hx = Math.max(5, (pct / 100) * trackW + pull - hOff);
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

  let rect = null, scale = 1, downPos = null, isClick = true, snapTimer, fineAnchor = null, downId = null;
  const GLIDE_FILL = "width 0.34s cubic-bezier(0.34,1.2,0.64,1)";
  const GLIDE_HANDLE = "left 0.34s cubic-bezier(0.34,1.2,0.64,1), opacity 0.15s, transform 0.2s cubic-bezier(0.22,1,0.36,1)";
  // Discrete detent — a spring resisting the snap. While dragging, the active track
  // stretches off its notch toward the cursor on a compliance curve: near-1:1 at the
  // notch (the edge feels connected to the finger), bending asymptotically toward
  // ~45% of the notch gap as the cursor nears the midpoint (the spring loading up) —
  // pull = A·tanh(offset/A), A scaled to the gap, not a fixed pixel cap (a 5px cap on
  // a ~40px gap left most of the travel dead, then hopped: snapping, not springing).
  // Crossing the midpoint re-anchors to the next notch with the tension mirrored, so
  // the visible release is only the ungrabbed middle (~25% of the gap), eased by a
  // slightly overshooting curve — the spring letting go. The handle rides the same
  // stretched edge throughout, so it never leaves the active track.
  const DETENT = "cubic-bezier(0.3, 1.3, 0.5, 1)", TENSION = 0.45, FINE_GAIN = 0.2;
  const DETENT_FILL = `width 0.2s ${DETENT}`;
  const DETENT_HANDLE = `left 0.2s ${DETENT}, opacity 0.15s, transform 0.2s cubic-bezier(0.22,1,0.36,1)`;
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
    if (e.button !== 0 || downPos) return; // primary button only; a second pointer can't hijack a live drag
    e.preventDefault();
    track.focus(); // preventDefault suppressed click-to-focus — restore it, so click-then-arrow-keys works
    downId = e.pointerId;
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
    if (!downPos || e.pointerId !== downId) return;
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
      // Spring tension: the offset from the snapped notch (in px) through the tanh
      // compliance curve — computed before render so the fill + handle move together
      // (the handle stays on the filled edge, never beyond it), releasing on the snap.
      if (snap) {
        const trackW = wrap.offsetWidth || 1;
        const offsetPx = ((raw - clamp(q(raw), min, max)) / ((max - min) || 1)) * trackW;
        const A = Math.max(6, TENSION * (step / ((max - min) || 1)) * trackW); // asymptote ≈ 45% of the notch gap (floored for very fine steps)
        pull = A * Math.tanh(offsetPx / A);
      }
      set(raw);
    }
    if (e.clientX >= rect.left && e.clientX <= rect.right) { track.style.width = ""; track.style.transform = ""; }
  });
  const up = (e?) => {
    if (!downPos || (e && e.pointerId !== downId)) return;
    // value is already set (on press, then on every move) — release the tension pull so
    // the active track eases home onto its notch, and spring the rubber-band back.
    snapTimer = setTimeout(() => { fill.style.transition = ""; handle.style.transition = ""; }, 360);
    if (pull) { pull = 0; render(); } // the detent transition is still live, so it eases
    track.style.transition = "width 0.35s cubic-bezier(0.22,1,0.36,1), transform 0.35s cubic-bezier(0.22,1,0.36,1)";
    track.style.width = ""; track.style.transform = "";
    setTimeout(() => { track.style.transition = ""; }, 360);
    track.classList.remove("is-active", "is-dragging"); downPos = null; fineAnchor = null; downId = null;
  };
  track.addEventListener("pointerup", up);
  track.addEventListener("pointercancel", up);
  track.addEventListener("lostpointercapture", up); // implicit capture loss ends the drag like a release — no stranded is-active/is-dragging state
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
  const measure = (animate?) => {
    const active = seg.querySelector('[data-active="true"]');
    if (!active) return;
    const left = active.offsetLeft, width = active.offsetWidth, prev = parseFloat(pill.style.left);
    pill.style.left = left + "px"; pill.style.width = width + "px"; // fill the active segment; the 2px flex gap + 2px container padding frame it (same as tabs)
    // Liquid pill: as it slides between segments, a transient scaleX overshoot makes the
    // leading edge stretch ahead then pull in — the kind of finesse the slider's glide has.
    // Origin is the trailing edge so the stretch reads directional. Reduced-motion skips it.
    if (animate && Number.isFinite(prev) && prev !== left) stretchPill(pill, left > prev ? 1 : -1);
  };
  const reflect = () => { setRadioActive(btns, value); measure(true); };
  const set = (v, fire = true) => { value = v; reflect(); if (fire) onChange(v); };
  seg.addEventListener("keydown", (e) => {
    const i = btns.findIndex((b) => b.dataset.value === String(value)); if (i < 0) return;
    let n = i;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % btns.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + btns.length) % btns.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = btns.length - 1;
    else return;
    e.preventDefault(); set(btns[n]._twVal); btns[n].focus(); // _twVal, not dataset.value — the keyboard pick must emit the option's real (possibly non-string) value
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
    e.preventDefault(); if (j !== i) { set(btns[j]._twVal); btns[j].focus(); } // _twVal, not dataset.value — same reason as the segmented control
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
  const reflect = () => { valEl.textContent = (opts.find((o) => o.value === value) || {}).label ?? value; optButtons.forEach((b) => { const sel = b.dataset.value === String(value); b.dataset.selected = String(sel); b.setAttribute("aria-selected", String(sel)); }); }; // String(value): dataset stringifies, so numeric option values never matched (no selected/aria state)
  const set = (v, fire = true) => { value = v; reflect(); if (fire) onChange(v); };
  // The shared popover shell portals the dropdown to <body> (never clipped by the
  // panel's overflow or a transformed ancestor), themes + places it, and closes on
  // outside-press / Esc-back-to-trigger / scroll-away — the same machinery as the
  // colour and gradient editors, so opening the listbox closes any other popover.
  // Only the roving-focus listbox keyboarding below is select-specific.
  const pop = popover(root, trigger, dropdown, {
    width: "match", fallbackH: 200, gap: 4,
    onOpen: () => (optButtons.find((b) => b.dataset.value === String(value)) || optButtons[0])?.focus(),
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
  return { el: row, set: (v) => { value = v == null ? "" : String(v); input.value = value; }, get: () => value }; // null/undefined → "", not the literal "undefined" the input renders for a raw assignment
}

// ── Number — a typeable field with a Tweakpane-style grab handle (drag to scrub) ──
function createNumber(meta, onChange) {
  let min = +meta.min, max = +meta.max; // non-finite (absent/garbage) → unbounded, matching fit()'s isFinite guards
  if (Number.isFinite(min) && Number.isFinite(max) && max < min) { const t = min; min = max; max = t; }
  const step = Number.isFinite(+meta.step) && +meta.step > 0 ? +meta.step : 1; // a 0/negative/NaN step deadened the scrub + keyboard; an Infinity step (data-step="Infinity" coerces to it) rounded every value to NaN
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
const VALUELESS = new Set(["button", "fpsgraph", "monitor", "buttongroup", "separator"]);

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
// Reset uses Lucide's full rotate-ccw geometry (the 9.75-radius blend into the head —
// an earlier straight-chord simplification flattened the circle's upper-left, reading
// as off-centre), merged into ONE path: the kit's icon colour is translucent, and
// separate paths double-composite where they cross (a bright hotspot at the arrowhead),
// while a single path's stroke paints as one union — uniform alpha throughout.
const ICON_RESET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5"/></svg>`;
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
// Reset spin — an accumulated rotation on --tw-spin, driven by the transform transition
// (no keyframes): transitions retarget mid-flight, so a second click mid-spin continues
// smoothly into the next full turn from the current angle instead of snapping back to
// rest ("interruptible beats staged"). is-spinning lengthens the transition for the
// spin's run; once settled, the counter renormalises to 0 with the transition suppressed
// — −n·360° is the same angle, so nothing visibly moves and the counter can't grow forever.
const spinReset = (btn) => {
  const svg = btn.querySelector("svg");
  svg.style.setProperty("--tw-spin", `${(parseFloat(svg.style.getPropertyValue("--tw-spin")) || 0) - 360}deg`);
  btn.classList.add("is-spinning");
  clearTimeout(btn._t);
  btn._t = setTimeout(() => {
    btn.classList.remove("is-spinning");
    svg.style.transition = "none"; svg.style.setProperty("--tw-spin", "0deg");
    void svg.offsetWidth; svg.style.transition = "";
  }, 520);
};

// Toast — the kit's own feedback pill (copy / preset confirmations), portaled to
// <body> bottom-centre so it works anywhere the panel is dropped, not only on a host
// page that happens to have a .toast element. One shared node, tip-style visuals;
// carries the anchor panel's winning scheme + live theme the way the tip does.
let toastEl = null, toastTimer = 0;
function showToast(msg, anchor?) {
  if (!toastEl) { toastEl = el("div", "tw-toast tw-portal"); toastEl.setAttribute("role", "status"); document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  applyThemeVars(toastEl, anchor?.closest(".tw-panel")?._twTheme);
  const scheme = anchor && (anchor.closest('[data-tw-scheme="light"]') ? "light" : anchor.closest('[data-tw-scheme="dark"]') ? "dark" : null);
  if (scheme) toastEl.setAttribute("data-tw-scheme", scheme); else toastEl.removeAttribute("data-tw-scheme");
  toastEl.classList.add("is-open");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("is-open"), 1600);
}
// Hint tooltip — one shared, portaled bubble shown by a control's info marker on
// hover/focus. Portaled to <body> so it clears the panel's overflow clip; sits
// above its anchor, flipping below when there's no room. Pointer-transparent.
let hintTip = null, hintTimer = 0, hintAnchor = null;
const onHintKey = (e) => { if (e.key === "Escape") hideHintNow(); }; // bound only while the tip is open — WCAG 1.4.13, the hover content is dismissable
const hideHintNow = () => { clearTimeout(hintTimer); document.removeEventListener("keydown", onHintKey); if (hintTip) hintTip.classList.remove("is-open"); };
function showHint(anchor, text, themeVars) {
  if (!hintTip) { hintTip = el("div", "tw-tip tw-portal"); hintTip.setAttribute("role", "tooltip"); document.body.appendChild(hintTip); }
  clearTimeout(hintTimer);
  hintTip.textContent = text;
  applyThemeVars(hintTip, themeVars);
  // Carry the scheme scope, popover()-style — the tip portals to <body>, so a
  // [data-tw-scheme] scope that styles the panel can't reach it via the cascade.
  // Like popover(), copy the winning scheme, not the nearest (light pin outranks
  // dark — see the scheme-resolution comment in tweaks.css).
  const scheme = anchor.closest('[data-tw-scheme="light"]') ? "light" : anchor.closest('[data-tw-scheme="dark"]') ? "dark" : null;
  if (scheme) hintTip.setAttribute("data-tw-scheme", scheme); else hintTip.removeAttribute("data-tw-scheme");
  const wasOpen = hintTip.classList.contains("is-open");
  hintTip.style.visibility = "hidden"; hintTip.classList.add("is-open");
  const r = anchor.getBoundingClientRect(), w = hintTip.offsetWidth, h = hintTip.offsetHeight;
  const left = clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8);
  const top = r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8;
  hintTip.style.left = left + "px"; hintTip.style.top = top + "px"; hintTip.style.visibility = "";
  document.addEventListener("keydown", onHintKey);
  hintAnchor = anchor;
  // Unmount watchdog (popover()'s pattern): a host removing the panel mid-hover would
  // otherwise strand the open tip on screen. One rAF per frame, only while open.
  if (!wasOpen) requestAnimationFrame(function watch() { if (!hintTip.classList.contains("is-open")) return; if (!hintAnchor.isConnected) return hideHintNow(); requestAnimationFrame(watch); });
}
function hideHint() { if (hintTip) hintTimer = setTimeout(() => { hintTip.classList.remove("is-open"); document.removeEventListener("keydown", onHintKey); }, 80); }
// A control's `hint` becomes a visible ⓘ marker beside its label that reveals the
// text in the tooltip on hover/focus — discoverable and keyboard-reachable, unlike
// the old native `title`. Shared by the panel build (registerCond) and enhance().
function addHintMarker(node: any, hint: string) {
  const label = node.querySelector(".tw-slider-label, .tw-row-label, .tw-select-label, .tw-color-label, .tw-gradient-label, .tw-radiogrid-label, .tw-field-label, .tw-folder-title, .tw-fps-label, .tw-plot-label") || node;
  const mark = el("button", "tw-hint", ICON_INFO); mark.type = "button"; mark.setAttribute("aria-label", hint);
  const show = () => showHint(mark, hint, mark.closest(".tw-panel")?._twTheme); // theme resolved at show time — setTheme() swaps the panel's _twTheme object, so a build-time capture would pin the old vars forever
  mark.addEventListener("pointerenter", show);
  mark.addEventListener("pointerleave", hideHint);
  mark.addEventListener("focus", show);
  mark.addEventListener("blur", hideHint);
  mark.addEventListener("pointerdown", (e) => e.stopPropagation()); // a press on the marker mustn't start a slider scrub or panel drag
  mark.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); }); // the marker nests inside trigger/header buttons — its click mustn't toggle the parent
  mark.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }); // keyboard activation stays on the marker too
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
registerControl("checkbox", createToggle);
registerControl("radiogrid", createRadiogrid);
registerControl("list", createSelect);
registerControl("button", createButton);
registerControl("buttongroup", createButtonGroup);
registerControl("separator", createSeparator);
registerControl("text", createString);
registerControl("number", createNumber);
registerControl("folder", createFolder);

export function tweaks(name: string, schema: Schema, opts: TweaksOptions = {}): Panel {
  // "_last" is the changed-key channel on params — a schema entry by that name would
  // fight it (the param's value doubles as the listener's "what changed" argument).
  const metas = Object.entries(schema).filter(([k]) => k !== "_last" || (console.warn('[tweaks] "_last" is reserved (the changed-key channel) — schema entry skipped'), false)).map(([k, v]) => metaFor(k, v)).filter(Boolean);
  const params: Params = {};
  const entries = []; // { target, key, set, get, def, path } — flattened across folders, for reset + persist
  const subTrees = new Set(); // the folder/tabs params sub-objects — set() refuses to overwrite one (doing so orphaned every child entry silently)
  const listeners = new Set<(p?: any, last?: any) => void>();
  const cleanups: Array<() => void> = []; // every global attachment (document/window listeners, pending timers) registers its release here for destroy()
  let destroyed = false; // flipped by destroy(): assemble() bails, the mutating API methods go silent
  let assembled = false; // flipped at the end of assemble() — set() queues until the controls exist
  const preSets: Array<[string, any]> = []; // set() calls from the lazy window, replayed once assemble() has built the controls — a dotted/nested set before then used to warn-and-drop, and a bare nested key minted a top-level orphan while the control kept its default
  let liftSlot = null; // the placeholder a lifted panel leaves in its host slot — removed on destroy()
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
  const readStore = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
  const writeStore = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

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
  // The toolbar's handlers wire up in assemble() — until then (the lazy-chunk window on
  // the split build) the buttons are honestly inert rather than silently dead.
  for (const b of [copyBtn, resetBtn, presetsBtn, searchBtn]) if (b) b.disabled = true;
  // A header drag (floating mode) sets this so the click ending the drag doesn't collapse.
  let dragMoved = false;
  titleBtn.addEventListener("click", () => {
    if (dragMoved) { dragMoved = false; return; }
    const collapsed = panel.classList.toggle("is-collapsed");
    titleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    // A bottom-parked floating panel grows past the viewport when it expands — re-clamp
    // once the 0.25s body collapse has settled and the height is real.
    if (panel.dataset.mode === "floating") setTimeout(() => { if (panel.dataset.mode === "floating" && panel.isConnected) { clampPos(); apply(); } }, 270);
  });
  const body = el("div", "tw-body");
  const controls = el("div", "tw-controls");
  body.append(controls);
  panel.append(header, body);

  // Apply the optional theme to the panel; stash it so the portaled popovers —
  // which escape to <body> and lose the panel's inherited vars — re-apply it on open.
  let themeVars = resolveTheme(opts.theme);
  applyThemeVars(panel, themeVars); panel._twTheme = themeVars;

  // ── Floating position — seeded in the shell, so an opts.floating / persisted-position
  // panel is fixed in place the moment tweaks() returns instead of jumping when the lazy
  // chunks land. The drag wiring itself still lives in assemble(). ──
  const draggable = opts.draggable !== false;
  const MARGIN = 8, SNAP = 28; // px: viewport inset, and the drop distance within which the panel parks against an edge
  const bounds = () => ({ maxX: Math.max(MARGIN, window.innerWidth - panel.offsetWidth - MARGIN), maxY: Math.max(MARGIN, window.innerHeight - panel.offsetHeight - MARGIN) });
  const posKey = persistKey ? `${persistKey}:pos` : null;
  const saved = (draggable || opts.floating) && posKey ? readStore(posKey) : null;
  const start = saved || (typeof opts.floating === "object" ? opts.floating : null) || { x: 16, y: 16 };
  let px = +start.x || 16, py = +start.y || 16;
  const apply = () => { panel.style.left = px + "px"; panel.style.top = py + "px"; };
  const clampPos = () => { const { maxX, maxY } = bounds(); px = clamp(px, MARGIN, maxX); py = clamp(py, MARGIN, maxY); };
  if ((draggable || opts.floating) && (opts.floating || saved)) {
    panel.dataset.mode = "floating"; clampPos(); apply();
    // A position saved on a larger monitor restores fully off this viewport — re-clamp
    // once the host has mounted the panel (offsetWidth is 0 until then, so the build-time
    // clamp above can only pin the left/top edge into the viewport).
    requestAnimationFrame(() => { if (!destroyed && panel.dataset.mode === "floating" && panel.isConnected) { clampPos(); apply(); } });
  }

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
    if (m.hint) addHintMarker(node, m.hint);
    if (m.render || m.disabled != null) conditionals.push({ node, m });
  };
  const filterItems = [], filterFolders = []; // searchable index (opts.filter) keyed on each control's real label

  // Build controls into a container, recursing into folders (nested params).
  const build = (container, ms, target, basePath = [], folderItem = null) => {
    for (const m of ms) {
      if (m.type === "tabs") {
        const sub = {}; subTrees.add(sub); target[m.key] = sub;
        const makeTabs = getControl("tabs");
        const tabsCtrl = makeTabs && makeTabs(m);
        if (!tabsCtrl) continue; // tabs module ensured before assemble; skip if it failed to load
        m.pages.forEach((page, i) => { const psub = {}; subTrees.add(psub); sub[page.key] = psub; build(tabsCtrl.bodies[i], page.children, psub, [...basePath, m.key, page.key]); });
        registerCond(tabsCtrl.el, m); container.append(tabsCtrl.el);
        continue;
      }
      if (m.type === "folder") {
        const sub = {}; subTrees.add(sub); target[m.key] = sub;
        const f = createFolder(m);
        const fi = filterOn ? { el: f.el, label: m.label, body: f.body } : null;
        if (fi) filterFolders.push(fi);
        build(f.body, m.children, sub, [...basePath, m.key], fi); registerCond(f.el, m); container.append(f.el);
        continue;
      }
      if (VALUELESS.has(m.type)) { const ctrl = createControl(m, () => {}); if (ctrl) { if (filterOn && m.type !== "separator") filterItems.push({ el: ctrl.el, label: m.label, folder: folderItem }); registerCond(ctrl.el, m); container.append(ctrl.el); } continue; }
      const ctrl = createControl(m, (v) => { if (!valueChanged(target[m.key], v)) return; target[m.key] = v; params._last = m.key; notify(); }); // same-value emits (a discrete drag inside one detent, a re-entrant echo) don't notify
      if (!ctrl) continue;
      // A value a host parked on params directly before assemble ran (the lazy-load
      // window on the split build) wins over the schema default — apply it to the
      // control rather than clobbering it back with ctrl.get(). (API set() calls from
      // that window queue in preSets and replay after the build instead.)
      if (Object.prototype.hasOwnProperty.call(target, m.key)) ctrl.set(target[m.key]);
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
  if (destroyed) return; // destroy() before the lazy chunks landed — nothing to build
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
  const atPath = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const stripLast = function (k, v) { return k === "_last" && this === params ? undefined : v; }; // function, not arrow: `this` is the holder, so only the top-level changed-key channel strips — a folder child legitimately keyed "_last" survives
  const snapshot = () => JSON.parse(JSON.stringify(params, stripLast));
  const applySnapshot = (snap, fire = true) => {
    if (!snap || typeof snap !== "object") return;
    for (const e of entries) { const v = atPath(snap, e.path); if (v !== undefined) { e.set(v); e.target[e.key] = e.get(); } }
    params._last = undefined; if (fire) notify();
  };
  if (persistKey) {
    let saveT; persist = () => { clearTimeout(saveT); saveT = setTimeout(() => writeStore(persistKey, snapshot()), 150); };
    cleanups.push(() => clearTimeout(saveT));
    // Restore last session, notifying: on the lazy path assemble runs after tweaks()
    // returned, so a host that already subscribed must hear the restored values (on the
    // synchronous path nobody is subscribed yet, so the notify is free).
    applySnapshot(readStore(persistKey));
  }
  listPresets = () => { const p = presetsKey ? readStore(presetsKey) : null; return Object.assign(Object.create(null), p && typeof p === "object" ? p : {}); }; // null-proto: a preset named "__proto__" is an ordinary key (a plain object's assignment wrote the prototype — savePreset claimed success while storing nothing, loadPreset applied Object.prototype)
  savePreset = (nm) => { if (!presetsKey || !nm) return false; const all = listPresets(); all[nm] = snapshot(); writeStore(presetsKey, all); return true; };
  loadPreset = (nm) => { const all = listPresets(); if (all[nm]) { applySnapshot(all[nm]); return true; } return false; };
  deletePreset = (nm) => { if (!presetsKey) return; const all = listPresets(); delete all[nm]; writeStore(presetsKey, all); };

  // ── Repositioning — drag the header to move the panel ───────────────────────
  // Every panel is draggable by its header (opt out with opts.draggable:false). An
  // inline panel lifts into a fixed, floating layer on the first drag — popping out of
  // document flow at the exact spot it sat, so it doesn't jump — then tracks the pointer.
  // opts.floating starts it already floated (`true` → top-left, or an explicit {x,y}). A
  // plain click on the title (no drag past the threshold) still collapses. On release the
  // panel eases the rest of the way to a viewport edge when dropped near one (a gentle
  // magnetism), and the position persists to "<key>:pos" when persistence is on — so a
  // moved panel returns where the user left it.
  if (draggable || opts.floating) {
    if (draggable) {
      panel.dataset.draggable = "true"; // CSS grab cursor on the header — the affordance
      // A top-centre grabber pill — the visual cue to match the cursor. Decorative
      // (pointer-events:none, so the press still lands on the header), it reveals on
      // header hover and brightens mid-drag the way the slider handle does.
      const grabber = el("span", "tw-grabber"); grabber.setAttribute("aria-hidden", "true");
      header.prepend(grabber);
    }
    // Lift an inline panel into the floating layer at its current on-screen rect, so a
    // drag pops it out of flow in place rather than snapping to a corner. A same-size
    // placeholder stays behind in the old slot — without it the host container reflows
    // mid-drag (an emptied flex/grid cell collapses), which reads as a layout break.
    const lift = () => {
      if (panel.dataset.mode === "floating") return;
      const r = panel.getBoundingClientRect();
      px = r.left; py = r.top;
      if (panel.parentNode) {
        liftSlot = el("span", "tw-lift-slot");
        liftSlot.style.width = r.width + "px"; liftSlot.style.height = r.height + "px";
        liftSlot.setAttribute("aria-hidden", "true");
        panel.before(liftSlot);
      }
      // Portal to <body>: left in its slot, any transformed/filter/contain ancestor would
      // become the fixed panel's containing block (the bug class the popovers already
      // solved by portaling). The inline --tw-* theme vars ride along on the node; the
      // scheme scope doesn't — copy the WINNING scheme, not the nearest (popover()'s idiom).
      const scheme = panel.closest('[data-tw-scheme="light"]') ? "light" : panel.closest('[data-tw-scheme="dark"]') ? "dark" : null;
      if (scheme) panel.setAttribute("data-tw-scheme", scheme); else panel.removeAttribute("data-tw-scheme");
      document.body.appendChild(panel);
      panel.dataset.mode = "floating"; apply();
    };

    let dragId = null, sx = 0, sy = 0, ox = 0, oy = 0;
    header.addEventListener("pointerdown", (e) => {
      // Let the toolbar buttons and any inputs work; drag from anywhere else on the header.
      if (e.button !== 0 || dragId !== null || e.target.closest(".tw-toolbar, input, textarea, select")) return;
      dragId = e.pointerId; sx = e.clientX; sy = e.clientY; dragMoved = false;
      panel.classList.add("is-grabbing"); // press feedback: brighten the grabber the instant it's grabbed, before any move — matters on touch, where there's no hover to reveal it first
      // Regrab mid–edge-snap: pick the panel up where it visually is (the eased,
      // in-flight position), not the parked target px/py already hold — clearing the
      // transition against the target style teleported it on the first move.
      if (panel.style.transition) {
        const cur = getComputedStyle(panel);
        px = parseFloat(cur.left) || px; py = parseFloat(cur.top) || py;
        panel.style.transition = ""; apply();
      } else panel.style.transition = ""; // clear any leftover snap transition so the grab is 1:1
    });
    header.addEventListener("pointermove", (e) => {
      if (e.pointerId !== dragId) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragMoved) {
        if (Math.abs(dx) + Math.abs(dy) < 4) return; // a few px of slop before it counts as a drag, not a click
        dragMoved = true; lift(); ox = px; oy = py; // capture the (possibly just-lifted) origin once the drag truly starts
        try { header.setPointerCapture(dragId); } catch {}
        panel.classList.add("is-dragging");
      }
      const { maxX, maxY } = bounds();
      px = clamp(ox + dx, MARGIN, maxX); py = clamp(oy + dy, MARGIN, maxY); apply();
    });
    const endDrag = (e) => {
      if (e.pointerId !== dragId) return;
      try { header.releasePointerCapture(dragId); } catch {}
      dragId = null;
      if (dragMoved) {
        // Edge magnetism: a drop near a side eases the rest of the way to the margin, so the
        // panel parks cleanly against the edge instead of hovering a few px off it.
        const { maxX, maxY } = bounds();
        if (px <= MARGIN + SNAP) px = MARGIN; else if (px >= maxX - SNAP) px = maxX;
        if (py <= MARGIN + SNAP) py = MARGIN; else if (py >= maxY - SNAP) py = maxY;
        if (!REDUCE_MOTION.matches) { // the glide is inline style, out of reach of the CSS reduced-motion kill-switch — park instantly instead
          panel.style.transition = "left 0.32s var(--tw-ease-spring), top 0.32s var(--tw-ease-spring)";
          setTimeout(() => { panel.style.transition = ""; }, 340);
        }
        apply();
        if (posKey) writeStore(posKey, { x: px, y: py });
      }
      panel.classList.remove("is-dragging", "is-grabbing");
    };
    header.addEventListener("pointerup", endDrag);
    header.addEventListener("pointercancel", endDrag);
    header.addEventListener("lostpointercapture", endDrag); // implicit capture loss mid-drag ends it like a release
    // Keep a floated panel inside the viewport as the window resizes. Self-cleans on
    // the first resize after the panel leaves the DOM (this listener leaked per
    // draggable panel, holding the panel alive — the slider's resize pattern).
    const onWinResize = () => {
      if (!panel.isConnected) return window.removeEventListener("resize", onWinResize);
      if (panel.dataset.mode === "floating") { clampPos(); apply(); }
    };
    window.addEventListener("resize", onWinResize);
    cleanups.push(() => window.removeEventListener("resize", onWinResize));
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
        load.addEventListener("click", () => { loadPreset(nm); menuPop.close(); showToast(`Loaded “${nm}”`, panel); });
        const del = el("button", "tw-presets-del", ICON_X); del.type = "button"; del.setAttribute("aria-label", `Delete preset ${nm}`);
        del.addEventListener("click", (e) => { e.stopPropagation(); deletePreset(nm); renderList(); });
        row.append(load, del); list.append(row);
      }
    };
    const doSave = () => { const nm = input.value.trim(); if (!nm) { input.focus(); return; } savePreset(nm); input.value = ""; renderList(); showToast(`Saved “${nm}”`, panel); };
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
    const ok = await copyText(JSON.stringify(params, stripLast, 2));
    if (ok) { flashCopied(copyBtn); showToast(`${name} values copied`, panel); }
    else showToast("Copy failed", panel);
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
    // The end listeners sit on document (capture) only for the edit's duration: a drag on
    // a popover surface portaled to <body> (the colour plane, a gradient stop) releases
    // there, where the panel's own pointerup listener would never hear it.
    const endEdit = () => {
      document.removeEventListener("pointerup", endEdit, true); document.removeEventListener("pointercancel", endEdit, true);
      if (editing) { editing = false; opts.onEditEnd && opts.onEditEnd(); }
    };
    const editDown = (e) => {
      if (editing || !e.target.closest(DRAG_SEL)) return;
      editing = true; opts.onEditStart && opts.onEditStart();
      document.addEventListener("pointerup", endEdit, true); document.addEventListener("pointercancel", endEdit, true);
    };
    panel.addEventListener("pointerdown", editDown);
    panel._twEditPointer = editDown; // popover() relays pointerdowns on its portaled surfaces here
    cleanups.push(endEdit);
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
    // Self-clean like the slider's resize listener: the first keydown after the panel
    // leaves the DOM drops the listener (it held the whole panel + history alive
    // forever — a permanent leak per undo panel).
    const onUndoKey = (e) => {
      if (!panel.isConnected) return document.removeEventListener("keydown", onUndoKey);
      if (!focused() || !(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (k === "y") { e.preventDefault(); redo(); }
    };
    document.addEventListener("keydown", onUndoKey);
    cleanups.push(() => document.removeEventListener("keydown", onUndoKey));
  }
  assembled = true;
  // Replay set() calls queued during the lazy window — after the persisted-session
  // restore above, so an explicit host set() wins over a stored value the way it wins
  // over the schema default. Each replays through api.set, so paths resolve against
  // the real entries and listeners hear the changes.
  for (const [k, v] of preSets.splice(0)) api.set(k, v);
  for (const b of [copyBtn, resetBtn, presetsBtn, searchBtn]) if (b) b.disabled = false; // the toolbar's handlers are live now
  }; // end assemble

  // The API is built + returned synchronously. on/set/reset/setTheme operate on the
  // shell (live immediately); the presets + undo methods forward to bindings assemble()
  // fills in (no-ops until then — only reachable on the lazy path, before ready).
  const api: any = {
    el: panel, params,
    on(fn) { if (destroyed) return () => {}; listeners.add(fn); return () => listeners.delete(fn); },
    set(key, v) {
      if (destroyed) return;
      const parts = String(key).split(".");
      if (parts.some((p) => p === "__proto__" || p === "constructor" || p === "prototype")) return console.warn(`[tweaks] set("${key}") ignored — reserved key`); // params is an object-as-map; never write through to the prototype
      if (!assembled) return void preSets.push([String(key), v]); // the lazy window (split build, before ready): the controls don't exist yet, so queue and let assemble() replay — resolving against the real entries instead of warning a nested path away or orphaning a bare key on params
      let e;
      if (parts.length > 1) {
        // Dotted path ("folder.child", "tabs.page.child") — walk the folder/tabs
        // subtrees to the owning target, then match the leaf there.
        let t: any = params;
        for (let i = 0; i < parts.length - 1 && t; i++) { t = t[parts[i]]; if (!subTrees.has(t)) t = null; }
        e = t && entries.find((x) => x.target === t && x.key === parts[parts.length - 1]);
        if (!e) return console.warn(`[tweaks] set("${key}") — no control at that path`);
      } else {
        // Bare key — a unique match anywhere reaches nested controls without a path;
        // ambiguity warns instead of guessing (and instead of minting an orphan top-level key).
        const matches = entries.filter((x) => x.key === key);
        if (matches.length > 1) return console.warn(`[tweaks] set("${key}") is ambiguous — ${matches.length} controls share that key; use a dotted path (e.g. "${matches[0].path.join(".")}")`);
        e = matches[0];
      }
      const target = e ? e.target : params, leaf = e ? e.key : key;
      const prev = target[leaf];
      if (e) { e.set(v); target[leaf] = e.get(); }
      else if (subTrees.has(params[key])) return console.warn(`[tweaks] set("${key}") ignored — it's a folder/tabs group; set its children instead`); // overwriting the subtree would silently orphan every child value
      else params[key] = v; // bag passthrough — hosts park free keys on params
      if (!valueChanged(prev, target[leaf])) return; // a no-change set doesn't notify — the guard that keeps a store-sync listener from echoing forever
      params._last = leaf; notify(); // stamp the changed key, so on((p, last)) sees programmatic sets the same as control edits
    },
    reset() { if (!destroyed) resetBtn.click(); },
    // Live theming — re-applies --tw-* vars to the panel (and future popovers). Clears
    // the prior theme first, so setTheme(null) reverts to the default monochrome look.
    setTheme(theme) { if (destroyed) return; if (themeVars) for (const k in themeVars) panel.style.removeProperty(k); themeVars = resolveTheme(theme); panel._twTheme = themeVars; applyThemeVars(panel, themeVars); window.dispatchEvent(new Event("tw-retheme")); },
    // Presets API (no-ops without opts.persist). Names are arbitrary strings.
    savePreset: (nm) => !destroyed && savePreset(nm), loadPreset: (nm) => !destroyed && loadPreset(nm), deletePreset: (nm) => { if (!destroyed) deletePreset(nm); }, presets: () => (destroyed ? [] : Object.keys(listPresets())),
    undo: () => { if (!destroyed) undo(); }, redo: () => { if (!destroyed) redo(); }, // no-ops without opts.undo
    // Teardown: close any open portaled surface, release every global attachment, pull
    // the panel (and the lift placeholder) out of the DOM, and inert the API. Safe to
    // call before ready resolves — assemble() sees the flag and bails.
    destroy() {
      if (destroyed) return;
      destroyed = true;
      closeActivePopover(); // popovers are globally single-open, so whichever is up closes (idempotent if it isn't this panel's)
      hideHintNow();
      for (const fn of cleanups.splice(0)) { try { fn(); } catch {} }
      listeners.clear();
      if (liftSlot) { liftSlot.remove(); liftSlot = null; }
      panel.remove();
    },
  };
  // Lazy controls: if the schema needs feature modules not yet loaded, assemble once
  // they resolve and surface that on panel.ready / api.ready; otherwise assemble now
  // (synchronous — the monolith and warmed-up split builds always take this path).
  const pending = ensureForMetas(metas);
  if (pending) {
    api.ready = panel.ready = pending.then(assemble).then(() => api);
    api.ready.catch(() => {}); // a handled fork — no unhandled-rejection noise when a chunk fails, while ready still rejects for hosts that await it
  }
  else { assemble(); api.ready = panel.ready = Promise.resolve(api); }
  return api as Panel;
}

// ── Markup-driven enhancement (the showcase: minimal [data-tw] hosts → live control) ──
const dataMeta = (host) => {
  const d = host.dataset, type = d.tw, label = d.label || titleCase(d.key || type);
  if (type === "slider") return { type, key: "v", label, value: +(d.value ?? 0), min: +(d.min ?? 0), max: +(d.max ?? 100), step: +(d.step || inferStep(+(d.min ?? 0), +(d.max ?? 100))), soft: d.soft === "true" || d.soft === "" };
  if (type === "checkbox") {
    // A list of options is a single-select → radio grid; a bare checkbox is boolean.
    const options = d.options ? d.options.split(",").map((s) => s.trim()).filter(Boolean) : null;
    if (options) return { type: "radiogrid", key: "v", label, options, value: d.value ?? options[0], cols: d.cols != null ? +d.cols : undefined };
    return { type, key: "v", label, value: d.checked === "true" };
  }
  if (type === "radiogrid") { const options = (d.options || "").split(",").map((s) => s.trim()).filter(Boolean); return { type, key: "v", label, options, value: d.value ?? options[0], cols: d.cols != null ? +d.cols : undefined }; }
  if (type === "list") { const options = (d.options || "").split(",").map((s) => s.trim()).filter(Boolean); return { type, key: "v", label, options, value: d.value ?? options[0] }; }
  if (type === "color") return { type, key: "v", label, value: d.value || "#7c5cff" };
  if (type === "button") return { type, key: "v", label, action: () => showToast(`${label} pressed`, host) };
  if (type === "buttongroup") return { type, key: "v", label, buttons: (d.buttons || "").split(",").map((s) => s.trim()).filter(Boolean).map((lab) => ({ label: lab, action: () => showToast(`${lab} pressed`, host) })) };
  if (type === "separator") return { type, key: "v", label };
  if (type === "number") return { type, key: "v", label, value: +(d.value ?? 0), min: d.min != null ? +d.min : undefined, max: d.max != null ? +d.max : undefined, step: +(d.step || 1) };
  if (type === "text") return { type, key: "v", label, value: d.value ?? "", placeholder: d.placeholder, rows: d.rows != null ? +d.rows : undefined };
  if (type === "image") return { type, key: "v", label, value: d.value || "" };
  if (type === "fpsgraph") return { type, key: "v", label: d.label || "FPS" };
  if (type === "interval") { const mn = +(d.min ?? 0), mx = +(d.max ?? 1); return { type, key: "v", label, value: (d.value || (mn + "," + mx)).split(",").map(Number), min: mn, max: mx, step: +(d.step || inferStep(mn, mx)) }; }
  if (type === "spring") return { type, key: "v", label, value: { stiffness: +(d.stiffness ?? 300), damping: +(d.damping ?? 26), mass: +(d.mass ?? 1) } };
  if (type === "cubicbezier") return { type, key: "v", label, value: (d.value || "0.25,0.1,0.25,1").split(",").map(Number) };
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
        if (ok) { flashCopied(copyBtn); showToast(`${name} values copied`, panel); }
        else showToast("Copy failed", panel);
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
  if (pend) await pend.catch(() => {}); // a failed chunk degrades to skipping its controls (createControl finds no constructor), not an unhandled rejection out of the auto-run
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

