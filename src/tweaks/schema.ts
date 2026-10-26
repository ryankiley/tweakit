/* Schema derivation — ONE meta derivation for both entry points: a schema value (shorthand
 * or verbose `{ type }`), and a [data-tw] dataset through markup.ts, parses into the same control meta. A lazy
 * control that reads its own fields needs no table entry. test/registry.test.mjs cross-checks the tables. */
import { titleCase, isObj, isColorStr, optValue, getControl, controlTypes, TYPE_ALIASES } from "./shared.js";
import { LAZY_IMPORT } from "./lazy.js";
import type { SchemaObject, Option, Get, Control } from "./types.js";

/** A point control's component spec, as the public verbose form declares it. */
type PointComponent = Extract<SchemaObject, { type: "point" }>["components"][number];
/** One page of a tabs control: its slug key, title and the metas built inside it. */
interface TabPage { key: string; title: string; children: Meta[] }
/** The normalized control meta — ONE shape for every control type. The per-type fields are
 *  optional; type / key / label are always set. `value` is the authored default in the control's own shape. */
interface Meta {
  type: string; key: string; label: string;
  value?: any; // host-authored, in the control's own shape
  // Per-control options (ControlOptions), attached by metaFor.
  render?: (get: Get) => boolean; disabled?: boolean | ((get: Get) => boolean); hint?: string; persist?: boolean;
  // Ranges — slider, number, interval, monitor.
  min?: number; max?: number; step?: number; soft?: boolean; unit?: string; corners?: boolean; // corners: the sides control labels its four as corners and floors them at 0
  format?: (value: number) => string; parse?: (text: string) => number; // slider: readout from the value, and a typed one back
  // Single-select — list, radiogrid.
  options?: Option[]; cols?: number;
  // Text.
  rows?: number; placeholder?: string;
  // Spring (also tolerated top-level, beside the normalized `value`).
  mode?: "time" | "physics"; stiffness?: number; damping?: number; mass?: number; visualDuration?: number; bounce?: number;
  // Point.
  components?: PointComponent[]; pad?: boolean; invertY?: boolean;
  // Gradient: the verbose form may say `stops` for `value`.
  stops?: unknown;
  // Plot.
  expr?: string; fn?: ((x: number) => number) | null; xMin?: number; xMax?: number; yMin?: number; yMax?: number; samples?: number; editable?: boolean;
  // Monitor.
  get?: () => number | string; graph?: boolean; view?: "graph" | "text"; interval?: number; decimals?: number;
  // Image (`options` and `cols` above).
  maxSize?: number; fit?: number | false; quality?: number; upload?: boolean; clear?: boolean;
  // Button / button group.
  action?: () => void; buttons?: Record<string, () => void> | Array<{ label: string; action: () => void }>;
  // Folder / tabs.
  children?: Meta[]; pages?: TabPage[];
}
/** A verbose handler's result: the control's own fields, or falsy for a malformed shape. */
type MetaFields = Partial<Meta> | false;

// Parse one schema entry → a control meta, or null for an unknown shape. Per-control options
// (render / disabled / hint / persist) ride on any object-form value, whatever control it infers.
function metaFor(key: string, value: any, depth = 0): Meta | null {
  if (isReservedKey(key)) return null;
  const meta = baseMetaFor(key, value, depth);
  if (meta && value && typeof value === "object") {
    if (typeof value.render === "function") meta.render = value.render;
    if (value.disabled != null) meta.disabled = value.disabled;
    if (value.hint != null) meta.hint = String(value.hint);
    if (value.persist === false) meta.persist = false;
  }
  return meta;
}
// Own-key lookup for objects used as maps: "toString" must miss, not hit Object.prototype.
const hasOwn = <T extends object>(o: T, k: PropertyKey): k is keyof T => Object.prototype.hasOwnProperty.call(o, k);
// A key by one of these names would write through to Object.prototype on the params bag.
const isReservedKey = (k: string) => k === "__proto__" || k === "constructor" || k === "prototype";
// Identity for primitives, structural for the object-valued controls (a fresh object each
// get()). Gates notify(): a same-value echo from an on() listener recursed to stack exhaustion.
const valueChanged = (a: unknown, b: unknown) => a !== b && !(isObj(a) && isObj(b) && JSON.stringify(a) === JSON.stringify(b));
// Reset: the form the control OPENED on first (it covers a value set() can't take as-is),
// then the authored value on top, so whatever the control CAN take lands exactly.
const restoreDefault = (ctrl: Pick<Control, "set">, raw: unknown, def: unknown) => { ctrl.set(def); ctrl.set(raw); }; // a control, or the panel's entry for one

// ── Verbose `{ type: "…" }` forms — one handler per control type, returning only the control's
// own fields; baseMetaFor stamps type / key / label on top, and a handler may override them. A
// falsy return marks a malformed shape, skipped with a console error like a throw. ──
// "segmented" is an alias: a single-select from a list renders as the radio grid; the pill is for booleans.
const radiogridMeta = (v: any): MetaFields => Array.isArray(v.options) && { type: "radiogrid", options: v.options, value: v.value ?? optValue(v.options[0]), cols: v.cols };
// `??` semantics: an explicit "" (no label) survives where `||` fell back to the key.
const ownLabel = (v: any, label: string) => (v.label == null ? label : String(v.label));
const fnOf = (f: unknown) => (typeof f === "function" ? (f as any) : undefined);
const unitOf = (u: unknown) => (typeof u === "string" && u.trim() ? u.trim().slice(0, 12) : undefined);
// Typed against the public SchemaObject union, so tsc flags a control type added to types.ts
// but missing here. "button" has no handler: the `{ action }` shorthand covers its verbose form.
const SPRING_KEYS = ["stiffness", "damping", "mass", "visualDuration", "bounce"]; // read by the spring and motion controls
const TYPED_META: Partial<Record<SchemaObject["type"], (v: any, depth: number) => MetaFields>> = {
  // Absent min/max derive in the control from the value the range must contain, like the bare-number shorthand:
  // `{ type: "slider", value: 50 }` spans 0–150 like `size: 50`.
  slider: (v) => ({ value: v.value ?? v.min ?? 0, min: v.min, max: v.max, step: v.step, soft: v.soft, unit: unitOf(v.unit), format: fnOf(v.format), parse: fnOf(v.parse) }),
  number: (v) => ({ value: v.value ?? 0, min: v.min, max: v.max, step: v.step, soft: v.soft, unit: unitOf(v.unit) }), // no step: the number control (heavy.ts) fits one to the default
  checkbox: (v) => ({ value: !!v.value }),
  radiogrid: radiogridMeta,
  segmented: radiogridMeta,
  list: (v) => Array.isArray(v.options) && { options: v.options, value: v.value ?? optValue(v.options[0]) },

  text: (v) => ({ value: v.value ?? "", rows: v.rows, placeholder: v.placeholder }),
  // The config reads off the top level or a nested `value: {…}`, both published forms; the time
  // pair and mode ride along only when present, so the control can infer the mode.
  spring: (v) => {
    const s = isObj(v.value) ? v.value : v;
    const value: any = { stiffness: s.stiffness ?? 300, damping: s.damping ?? 26, mass: s.mass ?? 1 };
    if (Number.isFinite(+s.visualDuration)) value.visualDuration = +s.visualDuration;
    if (Number.isFinite(+s.bounce)) value.bounce = +s.bounce;
    const mode = v.mode ?? s.mode;
    if (mode === "time" || mode === "physics") value.mode = mode; // rides on the value, so a reset restores the mode
    return { value };
  },

  // Either mode's fields, top-level or nested, or `value` as a bare curve; the control infers
  // the mode (spring keys → spring) and fills the defaults.
  motion: (v) => {
    const s = typeof v.value === "string" || Array.isArray(v.value) ? { ...v, curve: v.value } : isObj(v.value) ? v.value : v; // the array test first: isObj is true of an array
    const springy = SPRING_KEYS.some((k) => s[k] != null);
    // Both sides get a default, so a reset restores the editor you weren't looking at too.
    const value: any = { curve: "ease", duration: 300, ...(springy ? {} : { visualDuration: 0.5, bounce: 0.2 }) };
    for (const k of ["mode", "curve", "duration", ...SPRING_KEYS]) if (s[k] != null) value[k] = s[k];
    if (value.mode !== "easing" && value.mode !== "spring") value.mode = springy ? "spring" : "easing";
    return { value };
  },
  point: (v) => {
    if (!Array.isArray(v.components) || !v.components.length) return false;
    // A keyless component takes its label (lower-cased) or index; keys dedupe so two can't share one param.
    const used = new Set<string>();
    const components = v.components.map((c: any, k: number) => {
      const base = String(c.key ?? ((c.label ? String(c.label).toLowerCase() : "") || `c${k}`));
      let key = base, n = 2; while (used.has(key)) key = `${base}-${n++}`; used.add(key);
      return { ...c, key };
    });
    return { components, pad: v.pad, invertY: v.invertY, value: Object.fromEntries(components.map((c: PointComponent) => [c.key, c.value ?? 0])) }; // the default component map, for reset()
  },
  buttongroup: (v) => ({ buttons: v.buttons }),
  separator: () => ({}),
  // Page keys dedupe ("A!" and "A?" both slug to "a") so two pages can't share one params subtree.
  tabs: (v, depth) => {
    if (!v.pages || typeof v.pages !== "object" || !Object.keys(v.pages).length) return false; // no pages is nothing to show, not an empty bar
    const used = new Set<string>();
    return { pages: Object.entries(v.pages).map(([title, schema]: [string, any]) => {
      const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tab";
      let k = base, n = 2; while (used.has(k)) k = `${base}-${n++}`; used.add(k);
      return { key: k, title: title.trim() ? title : "Tab", children: Object.entries(schema).map(([ck, sv]) => metaFor(ck, sv, depth + 1)).filter(Boolean) }; // an empty title still gets a visible tab
    }) };
  },
};

// The field each falsy-capable form hinges on: present-but-unusable is malformed, absent is a folder.
const REQUIRED: Record<string, string> = Object.assign(Object.create(null), { list: "options", radiogrid: "options", segmented: "options", point: "components", tabs: "pages" });
function baseMetaFor(key: string, value: any, depth = 0): Meta | null {
  if (depth > 64) return null; // a pathological depth is skipped, not a RangeError
  const label = titleCase(key);
  const meta = (type: string, fields: Partial<Meta>, lab = label): Meta => ({ type, key, label: lab, ...fields });
  if (isObj(value) && !Array.isArray(value) && typeof value.type === "string" && TYPE_ALIASES[value.type]) value = { ...value, type: TYPE_ALIASES[value.type] };
  if (isObj(value) && !Array.isArray(value) && hasOwn(TYPED_META, value.type)) { // own key only: "toString" must miss
    // A handler that throws or returns nothing for a malformed shape skips that control, not
    // the whole panel. The label is resolved here, once, so every verbose form honors `{ label }`.
    let fields: MetaFields;
    try { fields = TYPED_META[value.type as keyof typeof TYPED_META]!(value, depth); } // a guard can't narrow a property of an `any`
    catch (e) { console.error(`[tweaks] malformed "${value.type}" schema value for "${key}" — control skipped:`, e); return null; }
    if (fields) return meta(String(value.type), fields, ownLabel(value, label)); // a String object would miss m.type === "tabs" downstream
    // Nothing back with the hinge field present is malformed. Absent, this is a plain folder
    // holding a child named `type` (`marker: { type: "point", size: 3 }`) — fall through.
    if (hasOwn(value, REQUIRED[value.type])) { console.error(`[tweaks] malformed "${value.type}" schema value for "${key}" — control skipped`); return null; }
  }
  // A lazy control with no handler reads its own fields off the verbose form as given.
  else if (isObj(value) && !Array.isArray(value) && typeof value.type === "string" && (LAZY_IMPORT[value.type] || getControl(value.type))) {
    const { type, label: _l, ...fields } = value;
    return meta(type, fields, ownLabel(value, label));
  }
  // A `type` no control answers to: a typo (`slidr`) built a folder of `type` and `value` rows without a word. It may be a
  // folder with a child named `type`, so it still builds one; the console says so, with the near type, from a lazy chunk.
  else if (isObj(value) && !Array.isArray(value) && typeof value.type === "string" && !hasOwn(TYPED_META, value.type))
    import("./heavy.js").then((m) => m.unknownType(`"${key}"`, value.type, [...Object.keys(TYPED_META), ...Object.keys(LAZY_IMPORT), ...controlTypes()], "builds a folder"), () => {});
  // ── Shorthand inference ──
  // Interval / range: [[lo, hi], min, max, step?] — the first entry is a 2-tuple. Missing bounds and step derive in the
  // control, as for `{ type: "interval" }`: [[20, 80]] spans 0–240 (the tuple's own 20–80 pinned both handles).
  if (Array.isArray(value) && Array.isArray(value[0]) && value[0].length === 2 && typeof value[0][0] === "number")
    return meta("interval", { value: value[0].map(Number), min: value[1], max: value[2], step: value[3] });
  // [value, min?, max?, step?]: a short array ([n] = "just a default") takes the bare-number range. The slider derives
  // a missing or non-number bound and infers the step after, so [5, NaN] can't double 5 on a NaN span.
  if (Array.isArray(value) && value.length <= 4 && typeof value[0] === "number") return meta("slider", { value: value[0], min: value[1], max: value[2], step: value[3] });
  if (typeof value === "number") return meta("slider", { value });
  if (typeof value === "boolean") return meta("checkbox", { value });
  if (Array.isArray(value)) return meta("list", { options: value, value: optValue(value[0]) });
  if (isObj(value) && typeof value.action === "function") return meta("button", { action: value.action }, ownLabel(value, label));
  if (isObj(value) && Array.isArray(value.options)) return meta("list", { options: value.options, value: value.value ?? optValue(value.options[0]) });
  if (isColorStr(value)) return meta("color", { value });
  if (typeof value === "string") return meta("text", { value });
  // render / disabled / hint are the folder's chrome, not children.
  if (isObj(value)) return meta("folder", { children: Object.entries(value).filter(([k, v]) => !(k === "render" && typeof v === "function") && !((k === "disabled" || k === "hint") && v != null)).map(([k, v]) => metaFor(k, v, depth + 1)).filter(Boolean) });
  return null;
}
// Display/action controls carry no value; the panel build skips entry/reset/persist wiring.
const VALUELESS = new Set<string>(["button", "fpsgraph", "monitor", "buttongroup", "separator"]);
export { metaFor, valueChanged, restoreDefault, hasOwn, isReservedKey, VALUELESS, TYPED_META, SPRING_KEYS };
export type { Meta, TabPage, PointComponent };
