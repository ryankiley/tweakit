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

// ── Verbose `{ type: "…" }` forms — one handler per control type, returning only the
// control's own fields: baseMetaFor stamps `type` (the value's), `key` and `label` on
// top, and a handler may override any of them (segmented → radiogrid). Adding a control
// means one entry here (plus its constructor in the registry). A handler returns a falsy
// value for a malformed shape (e.g. a point without components), and that control is
// skipped with a console error like a handler that throws — it used to fall through to
// the shorthand inference, where the plain object became a folder holding a "Type" text
// control, which read as a bug rather than a degrade. The explicit
// slider/number/checkbox forms exist so shorthand controls can carry options (render /
// disabled / hint / step) the array/boolean shorthands can't.
// "segmented" is kept as an alias: picking one of a list renders as the radio grid (the
// nicer-looking single-select). The inline pill is reserved for booleans.
const radiogridMeta = (v) => Array.isArray(v.options) && { type: "radiogrid", options: v.options, value: v.value ?? optValue(v.options[0]), cols: v.cols };
// The colour a `{ type: "color" }` / [data-tw="color"] opens on when none is given — it
// lives on the meta (not only in the picker's own fallback) so reset() restores it rather
// than handing the control `undefined`, which parsed as black.
const DEFAULT_COLOR = "#7c5cff";
// The verbose range bounds (slider + interval): an absent min/max derives from the value(s)
// the range must contain, the way the bare-number shorthand does (defaultRange) — so
// `{ type: "slider", value: 50 }` spans 0–150 like `size: 50`, and an interval's ends each
// widen it. (Both used to default to 0–1 and clamp a 50 to 1.) Step defaults to the grain.
const rangeOf = (v, ...seeds) => {
  const ranges = (seeds.length ? seeds : [0]).map((s) => defaultRange(Number.isFinite(+s) ? +s : 0));
  const min = v.min ?? Math.min(...ranges.map((r) => r[0])), max = v.max ?? Math.max(...ranges.map((r) => r[1]));
  return { min, max, step: v.step ?? inferStep(min, max) };
};
// A verbose form's own `label` wins over the title-cased key — `??` semantics, so an
// explicit "" (= no label) survives where `||` fell back to the key.
const ownLabel = (v, label) => (v.label == null ? label : String(v.label));
// Typed against the public SchemaObject union, so tsc itself flags a control type
// added to types.ts but missing here (or a stray key with no public form). "button"
// is the one exception — it has no handler because the `{ action }` shorthand
// inference below already covers the verbose form.
const TYPED_META: Record<Exclude<SchemaObject["type"], "button">, (v: any, depth: number) => any> = {
  slider: (v) => { const r = rangeOf(v, v.value ?? v.min ?? 0); return { value: v.value ?? r.min, ...r, soft: v.soft }; },
  number: (v) => ({ value: v.value ?? 0, min: v.min, max: v.max, step: v.step ?? 1, soft: v.soft }),
  checkbox: (v) => ({ value: !!v.value }),
  radiogrid: radiogridMeta,
  segmented: radiogridMeta,
  list: (v) => Array.isArray(v.options) && { options: v.options, value: v.value ?? optValue(v.options[0]) },
  color: (v) => ({ value: v.value ?? DEFAULT_COLOR }),
  text: (v) => ({ value: v.value ?? "", rows: v.rows, placeholder: v.placeholder }),
  interval: (v) => { const r = rangeOf(v, ...(Array.isArray(v.value) ? v.value : [])); return { value: (Array.isArray(v.value) ? v.value : [r.min, r.max]).map(Number), ...r }; },
  // The config reads off the top level or a nested `value: {…}` — both published forms.
  // Physics (stiffness/damping/mass) is always normalised; the perceptual time pair
  // (visualDuration/bounce) and an explicit mode ride along only when present, so the
  // control can infer/restore the Time vs Physics mode.
  spring: (v) => {
    const s = isObj(v.value) ? v.value : v;
    const value: any = { stiffness: s.stiffness ?? 300, damping: s.damping ?? 26, mass: s.mass ?? 1 };
    if (Number.isFinite(+s.visualDuration)) value.visualDuration = +s.visualDuration;
    if (Number.isFinite(+s.bounce)) value.bounce = +s.bounce;
    const mode = v.mode ?? s.mode;
    if (mode === "time" || mode === "physics") value.mode = mode; // rides on the value, so the authored default carries it to set() (a reset restores the mode, not only the numbers)
    return { value };
  },
  cubicbezier: (v) => ({ value: Array.isArray(v.value) && v.value.length === 4 ? v.value.map(Number) : [0.25, 0.1, 0.25, 1] }),
  point: (v) => {
    if (!Array.isArray(v.components) || !v.components.length) return false;
    // A component without a key takes its label (lower-cased, the markup convention) or its
    // index — a missing key used to land on params as the literal "undefined" — and keys
    // dedupe like tab pages do, so two components can't share one param (the second's
    // field used to write over the first's value).
    const used = new Set();
    const components = v.components.map((c, k) => {
      const base = String(c.key ?? ((c.label ? String(c.label).toLowerCase() : "") || `c${k}`));
      let key = base, n = 2; while (used.has(key)) key = `${base}-${n++}`; used.add(key);
      return { ...c, key };
    });
    return { components, pad: v.pad, invertY: v.invertY, value: Object.fromEntries(components.map((c) => [c.key, c.value ?? 0])) }; // `value` = the default component map, so reset() / double-click-reset can restore it
  },
  gradient: (v) => ({ value: v.value ?? v.stops ?? null }),
  image: (v) => ({ value: v.value || "" }),
  plot: (v) => {
    const expr = v.expr != null ? String(v.expr) : (typeof v.fn === "function" ? "" : "sin(x)");
    return { value: expr, expr, fn: typeof v.fn === "function" ? v.fn : null,
      xMin: v.xMin ?? v.min ?? -10, xMax: v.xMax ?? v.max ?? 10,
      yMin: v.yMin, yMax: v.yMax, samples: v.samples, editable: v.editable };
  },
  fpsgraph: () => ({}),
  monitor: (v) => ({ get: v.get, value: v.value, graph: v.graph, view: v.view, min: v.min, max: v.max, interval: v.interval, rows: v.rows, decimals: v.decimals }),
  buttongroup: (v) => ({ buttons: v.buttons }),
  separator: () => ({}),
  // Page keys dedupe ("A!" and "A?" both slug to "a") so two pages can't silently share
  // one params subtree (the second used to overwrite the first, losing its values).
  tabs: (v, depth) => {
    if (!v.pages || typeof v.pages !== "object" || !Object.keys(v.pages).length) return false; // no pages is nothing to show, not an empty bar
    const used = new Set();
    return { pages: Object.entries(v.pages).map(([title, schema]: [string, any]) => {
      const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tab";
      let k = base, n = 2; while (used.has(k)) k = `${base}-${n++}`; used.add(k);
      return { key: k, title: title.trim() ? title : "Tab", children: Object.entries(schema).map(([ck, sv]) => metaFor(ck, sv, depth + 1)).filter(Boolean) }; // an empty title still gets a visible tab
    }) };
  },
};

// The field each falsy-capable verbose form hinges on — present-but-unusable is malformed,
// absent means the object was never a verbose form (see baseMetaFor).
const REQUIRED = Object.assign(Object.create(null), { list: "options", radiogrid: "options", segmented: "options", point: "components", tabs: "pages" });
function baseMetaFor(key, value, depth = 0) {
  if (depth > 64) return null; // a pathologically deep schema degrades to skipped controls instead of a RangeError out of tweaks()
  const label = titleCase(key);
  // Every meta carries type / key / label; a handler's own fields ride on top (and may
  // override the type — segmented renders as the radio grid).
  const meta = (type, fields, lab = label) => ({ type, key, label: lab, ...fields });
  if (isObj(value) && !Array.isArray(value) && hasOwn(TYPED_META, value.type)) { // own key only, so a stray type like "toString" can't hit Object.prototype
    // A handler that THROWS on a malformed shape (a null components entry, pages: { A: null })
    // or returns nothing for one (components: null, pages: {}) degrades to skipping that
    // control — not a TypeError out of tweaks() that drops the whole panel, and not a folder.
    // The label is resolved here, once, so every verbose form honors `{ label }`; a plain
    // folder object is not a verbose form, so its `label` key stays a child control.
    let fields;
    try { fields = TYPED_META[value.type](value, depth); }
    catch (e) { console.error(`[tweaks] malformed "${value.type}" schema value for "${key}" — control skipped:`, e); return null; }
    if (fields) return meta(String(value.type), fields, ownLabel(value, label)); // the canonical string: a String object or one-element array coerces through the table lookup but would miss the identity checks downstream (m.type === "tabs", VALUELESS.has)
    // Nothing back: the shape is malformed if the field the form hinges on is there but
    // unusable (components: null, pages: {}) — skip it with the error. If that field is
    // absent, this is a plain folder that happens to hold a child named `type` with a
    // control's name (`marker: { type: "point", size: 3 }`) — fall through, as documented.
    if (hasOwn(value, REQUIRED[value.type])) { console.error(`[tweaks] malformed "${value.type}" schema value for "${key}" — control skipped`); return null; }
  }
  // ── Shorthand inference ──
  // Interval / range: [[lo, hi], min, max, step?] — the first entry is a 2-tuple.
  if (Array.isArray(value) && Array.isArray(value[0]) && value[0].length === 2 && typeof value[0][0] === "number") {
    // Missing bounds fall back to the tuple itself ([[2,8]] → min 2, max 8) — an
    // undefined min/max used to ride into the control as NaN ("NaN – NaN").
    const mn = Number.isFinite(+value[1]) ? +value[1] : +value[0][0], mx = Number.isFinite(+value[2]) ? +value[2] : +value[0][1];
    return meta("interval", { value: value[0].map(Number), min: mn, max: mx, step: value[3] ?? inferStep(mn, mx) });
  }
  if (Array.isArray(value) && value.length <= 4 && typeof value[0] === "number") {
    // Tolerate a short array (e.g. [n] = "just a default"): fall back to a sensible
    // range the way a bare number does, so a missing min/max can't yield a NaN slider.
    const v0 = value[0];
    const [dmin, dmax] = defaultRange(v0);
    const min = value.length > 1 ? value[1] : dmin;
    const max = value.length > 2 ? value[2] : dmax;
    return meta("slider", { value: v0, min, max, step: value[3] ?? inferStep(min, max) });
  }
  if (typeof value === "number") {
    const [min, max] = defaultRange(value);
    return meta("slider", { value, min, max, step: inferStep(min, max) });
  }
  if (typeof value === "boolean") return meta("checkbox", { value });
  if (Array.isArray(value)) return meta("list", { options: value, value: optValue(value[0]) });
  if (isObj(value) && typeof value.action === "function") return meta("button", { action: value.action }, ownLabel(value, label));
  if (isObj(value) && Array.isArray(value.options)) return meta("list", { options: value.options, value: value.value ?? optValue(value.options[0]) });
  if (isColorStr(value)) return meta("color", { value });
  if (typeof value === "string") return meta("text", { value });
  // Option keys metaFor consumes off this same object (render / disabled / hint) are the
  // folder's chrome, not children — a folder's `disabled: true` mustn't also build a checkbox.
  if (isObj(value)) return meta("folder", { children: Object.entries(value).filter(([k, v]) => !(k === "render" && typeof v === "function") && !((k === "disabled" || k === "hint") && v != null)).map(([k, v]) => metaFor(k, v, depth + 1)).filter(Boolean) });
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
  slider: (d) => ({ value: num(d.value), min: num(d.min), max: num(d.max), step: num(d.step), soft: flag(d.soft) }), // absent bounds derive from the value in the verbose handler, as on the schema path (this table used to pin 0–100)
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
  fpsgraph: (d) => ({ label: d.label ?? "FPS" }),
  interval: (d) => ({ value: d.value ? d.value.split(",").map(Number) : undefined, min: num(d.min), max: num(d.max), step: num(d.step) }),
  spring: (d) => ({ stiffness: num(d.stiffness), damping: num(d.damping), mass: num(d.mass), visualDuration: num(d.visualDuration), bounce: num(d.bounce), mode: d.mode }),
  cubicbezier: (d) => ({ value: d.value ? d.value.split(",").map(Number) : undefined }),
  point: (d) => {
    const vals = (d.value || "").split(",").map((s) => parseFloat(s));
    return {
      components: splitList(d.components || "X,Y").map((lab, i) => ({ key: lab.toLowerCase(), label: lab, value: isNaN(vals[i]) ? 0 : vals[i], step: num(d.step), min: num(d.min), max: num(d.max) })), // an absent step lets the control derive a continuous one from its range
      pad: flag(d.pad), invertY: d.invertY === "true",
    };
  },
  plot: (d) => ({ expr: d.expr, xMin: num(d.xmin), xMax: num(d.xmax), yMin: num(d.ymin), yMax: num(d.ymax), samples: num(d.samples), editable: d.editable !== "false" }),
};
const num = (s) => { if (s == null || s === "") return undefined; const n = +s; return Number.isFinite(n) ? n : undefined; }; // an absent, empty or non-numeric attribute → undefined, so the schema default applies (a NaN used to survive `??` and collapse an interval's range)
const flag = (s) => s === "true" || s === "";    // boolean attributes: data-x / data-x="true"
const splitList = (s) => (s || "").split(",").map((t) => t.trim()).filter(Boolean);
const dataMeta = (host) => {
  const d = host.dataset, type = d.tw;
  if (!hasOwn(DATA_VALUE, type)) return null;
  const label = d.label ?? titleCase(d.key || type); // an explicit data-label="" means no label, like the schema's `label: ""`
  const v = DATA_VALUE[type](d, host, label);
  // The dataset's label rides the verbose value, where metaFor honors it like any schema
  // `{ type, label }` (the placeholder key would title-case to "V"). v spreads after, so a
  // parser that re-routes (checkbox + options → radiogrid) or carries its own default
  // label (the FPS graph) wins.
  return metaFor("v", { type, label, ...v });
};

export { metaFor, dataMeta, valueChanged, restoreDefault, hasOwn, isReservedKey, VALUELESS, TYPED_META, DATA_VALUE };
