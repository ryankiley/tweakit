/* Schema derivation — ONE meta derivation for both entry points: a schema value
 * (shorthand or verbose `{ type }` form) or a [data-tw] dataset parses into the
 * same control meta the builders consume. Adding a control type means an entry in
 * TYPED_META (and DATA_VALUE for the markup path) beside its constructor module —
 * test/registry.test.mjs cross-checks the tables so they can't drift apart. */
import { titleCase, isColorStr, inferStep, defaultRange, optValue } from "./shared.js";
import { showToast } from "./feedback.js";
import type { SchemaObject } from "./types.js";

// Parse one schema entry → a control meta. Returns null for unknown shapes.
// Per-control options (render / disabled / hint) ride on any object-form value; the
// wrapper attaches them to whatever control baseMetaFor infers.
function metaFor(key, value, depth = 0) {
  if (isReservedKey(key)) return null;
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
// Own-key lookup for objects used as maps — a stray key like "toString" must miss,
// not hit Object.prototype (the dispatch tables + params bags below).
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// params is an object-as-map: a schema key or a set() path segment by one of these names
// would write through to Object.prototype, so both entry points refuse it outright.
const isReservedKey = (k) => k === "__proto__" || k === "constructor" || k === "prototype";
// Did a value actually change? Identity for primitives; structural (JSON) for the
// object-valued controls (spring/point/gradient/bezier), whose get() returns a fresh
// object each call. Gates notify() so a same-value set()/emit can't echo — an on()
// listener mirroring values back into the panel recursed to stack exhaustion without it.
const valueChanged = (a, b) => a !== b && !(isObj(a) && isObj(b) && JSON.stringify(a) === JSON.stringify(b));
// Put a control back to its default: the form it OPENED on (its own get() at build — the
// state the constructor made of the schema value, so it covers a value set() can't take
// as-is: an unusable number, a numeric text, a spring mode the value alone doesn't fix),
// then the authored value on top, so whatever the control CAN take lands exactly (a hex
// colour re-parses to the same colour where its opened form is the readout's rounded
// string; a spring restores both of its mode caches). One rule for the panel's reset
// paths and the markup toolbar's.
const restoreDefault = (ctrl, raw, def) => { ctrl.set(def); ctrl.set(raw); };

// ── Verbose `{ type: "…" }` forms — one handler per control type. Adding a control
// means one entry here (plus its constructor in the registry). A handler returns a
// falsy value for a malformed shape (e.g. a point without components), which falls
// through to the shorthand inference — where a plain object still becomes a folder.
// The explicit slider/number/checkbox forms exist so shorthand controls can carry
// options (render / disabled / hint / step) the array/boolean shorthands can't.
const radiogridMeta = (v, key, label) => Array.isArray(v.options) && { type: "radiogrid", key, label, options: v.options, value: v.value ?? optValue(v.options[0]), cols: v.cols };
// The colour a `{ type: "color" }` / [data-tw="color"] opens on when none is given — it
// lives on the meta (not only in the picker's own fallback) so reset() restores it rather
// than handing the control `undefined`, which parsed as black.
const DEFAULT_COLOR = "#7c5cff";
// The verbose range bounds (slider + interval): min/max default to 0/1, step to the inferred grain.
const rangeOf = (v) => { const min = v.min ?? 0, max = v.max ?? 1; return { min, max, step: v.step ?? inferStep(min, max) }; };
// Typed against the public SchemaObject union, so tsc itself flags a control type
// added to types.ts but missing here (or a stray key with no public form). "button"
// is the one exception — it has no handler because the `{ action }` shorthand
// inference below already covers the verbose form.
const TYPED_META: Record<Exclude<SchemaObject["type"], "button">, (v: any, key: string, label: string, depth?: number) => any> = {
  slider: (v, key, label) => { const r = rangeOf(v); return { type: "slider", key, label, value: v.value ?? r.min, ...r, soft: v.soft }; },
  number: (v, key, label) => ({ type: "number", key, label, value: v.value ?? 0, min: v.min, max: v.max, step: v.step ?? 1, soft: v.soft }),
  checkbox: (v, key, label) => ({ type: "checkbox", key, label, value: !!v.value }),
  // "segmented" is kept as an alias: picking one of a list renders as the radio
  // grid (the nicer-looking single-select). The inline pill is reserved for booleans.
  radiogrid: radiogridMeta,
  segmented: radiogridMeta,
  list: (v, key, label) => Array.isArray(v.options) && { type: "list", key, label, options: v.options, value: v.value ?? optValue(v.options[0]) },
  // An explicit colour with a custom label: { type: "color", value: "#hex", label: "Background" }.
  color: (v, key, label) => ({ type: "color", key, label: v.label || label, value: v.value ?? DEFAULT_COLOR }),
  text: (v, key, label) => ({ type: "text", key, label, value: v.value ?? "", rows: v.rows, placeholder: v.placeholder }),
  interval: (v, key, label) => { const r = rangeOf(v); return { type: "interval", key, label, value: (Array.isArray(v.value) ? v.value : [r.min, r.max]).map(Number), ...r }; },
  // The config reads off the top level or a nested `value: {…}` — both published forms.
  // Physics (stiffness/damping/mass) is always normalised; the perceptual time pair
  // (visualDuration/bounce) and an explicit mode ride along only when present, so the
  // control can infer/restore the Time vs Physics mode.
  spring: (v, key, label) => {
    const s = isObj(v.value) ? v.value : v;
    const value: any = { stiffness: s.stiffness ?? 300, damping: s.damping ?? 26, mass: s.mass ?? 1 };
    if (Number.isFinite(+s.visualDuration)) value.visualDuration = +s.visualDuration;
    if (Number.isFinite(+s.bounce)) value.bounce = +s.bounce;
    const mode = v.mode ?? s.mode;
    if (mode === "time" || mode === "physics") value.mode = mode; // rides on the value, so the authored default carries it to set() (a reset restores the mode, not only the numbers)
    return { type: "spring", key, label, value };
  },
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
  if (isObj(value) && !Array.isArray(value) && hasOwn(TYPED_META, value.type)) { // own key only, so a stray type like "toString" can't hit Object.prototype
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
// Display/action controls — they carry no value, so the panel build skips the
// entry/reset/persist wiring for them.
const VALUELESS = new Set(["button", "fpsgraph", "monitor", "buttongroup", "separator"]);
// ── Markup-driven enhancement (the showcase: minimal [data-tw] hosts → live control) ──
// Each [data-tw] type parses its dataset into the same verbose schema value the
// TYPED_META table (and shorthand inference) consume, then rides metaFor — ONE meta
// derivation for both entry points. The markup branch used to re-derive every meta by
// hand, and markup-only defaults drifted (a list with no data-value rendered a blank
// readout while the schema path defaulted to the first option).
// Partial over the same public union: every markup type must be a real control type
// (tsc flags a typo'd key), but not every control needs a markup form.
const DATA_VALUE: Partial<Record<SchemaObject["type"], (d: any, host: any, label: string) => any>> = {
  slider: (d) => ({ value: num(d.value), min: num(d.min) ?? 0, max: num(d.max) ?? 100, step: num(d.step), soft: flag(d.soft) }),
  // A list of options is a single-select → radio grid; a bare checkbox is boolean.
  checkbox: (d) => (d.options ? { type: "radiogrid", options: splitList(d.options), value: d.value, cols: num(d.cols) } : { value: d.checked === "true" }),
  radiogrid: (d) => ({ options: splitList(d.options), value: d.value, cols: num(d.cols) }),
  list: (d) => ({ options: splitList(d.options), value: d.value }),
  color: (d) => ({ value: d.value || DEFAULT_COLOR }),
  button: (d, host, label) => ({ action: () => showToast(`${label} pressed`, host) }),
  buttongroup: (d, host) => ({ buttons: splitList(d.buttons).map((lab) => ({ label: lab, action: () => showToast(`${lab} pressed`, host) })) }),
  separator: () => ({}),
  number: (d) => ({ value: num(d.value), min: num(d.min), max: num(d.max), step: num(d.step) }),
  text: (d) => ({ value: d.value ?? "", placeholder: d.placeholder, rows: num(d.rows) }),
  image: (d) => ({ value: d.value }),
  fpsgraph: (d) => ({ label: d.label || "FPS" }),
  interval: (d) => ({ value: d.value ? d.value.split(",").map(Number) : undefined, min: num(d.min), max: num(d.max), step: num(d.step) }),
  spring: (d) => ({ stiffness: num(d.stiffness), damping: num(d.damping), mass: num(d.mass), visualDuration: num(d.visualDuration), bounce: num(d.bounce), mode: d.mode }),
  cubicbezier: (d) => ({ value: d.value ? d.value.split(",").map(Number) : undefined }),
  point: (d) => {
    const vals = (d.value || "").split(",").map((s) => parseFloat(s));
    return {
      components: splitList(d.components || "X,Y").map((lab, i) => ({ key: lab.toLowerCase(), label: lab, value: isNaN(vals[i]) ? 0 : vals[i], step: num(d.step) ?? 1, min: num(d.min), max: num(d.max) })),
      pad: flag(d.pad), invertY: d.invertY === "true",
    };
  },
  plot: (d) => ({ expr: d.expr, xMin: num(d.xmin), xMax: num(d.xmax), yMin: num(d.ymin), yMax: num(d.ymax), samples: num(d.samples), editable: d.editable !== "false" }),
};
const num = (s) => (s == null ? undefined : +s); // absent attribute → undefined, so the schema default applies
const flag = (s) => s === "true" || s === "";    // boolean attributes: data-x / data-x="true"
const splitList = (s) => (s || "").split(",").map((t) => t.trim()).filter(Boolean);
const dataMeta = (host) => {
  const d = host.dataset, type = d.tw;
  if (!hasOwn(DATA_VALUE, type)) return null;
  const label = d.label || titleCase(d.key || type);
  const v = DATA_VALUE[type](d, host, label);
  const meta = metaFor("v", { type, ...v }); // v spreads after `type`, so a parser that re-routes (checkbox + options → radiogrid) wins
  if (meta) meta.label = v.label || label; // metaFor derived "V" from the key — the dataset's label (or the type's default) is the real one
  return meta;
};

export { metaFor, dataMeta, valueChanged, restoreDefault, hasOwn, isReservedKey, VALUELESS, TYPED_META, DATA_VALUE };
