/* Markup-driven enhancement — the work behind enhance(): it turns [data-tw] hosts into live controls, sharing the
 * panel's meta derivation through the kit. A lazy chunk in the code-split build, fetched by the first enhance() on a page
 * with markup (single.ts imports it statically). It imports shared.ts alone: a panel module imported here as well as by
 * core would become a shared chunk every basic panel fetches, so core lends what it needs (enhance.ts builds the kit). */
import { el, btn, setCollapsed, getControl, titleCase, setMarkup } from "./shared.js";
import type { metaFor, restoreDefault, hasOwn, valueChanged, SPRING_KEYS, Meta } from "./schema.js";
import type { ensureForMetas, LAZY_IMPORT } from "./lazy.js";
import type { createFolder, createControl } from "./controls/basic.js";
import type { makeCopyBtn, makeResetBtn, addHintMarker } from "./feedback.js";
import type { Control, SchemaObject } from "./types.js";

/** What core lends the markup chunk. */
export interface MarkupKit {
  metaFor: typeof metaFor; restoreDefault: typeof restoreDefault; hasOwn: typeof hasOwn; valueChanged: typeof valueChanged; SPRING_KEYS: typeof SPRING_KEYS;
  ensureForMetas: typeof ensureForMetas; LAZY_IMPORT: typeof LAZY_IMPORT; createFolder: typeof createFolder; createControl: typeof createControl;
  makeCopyBtn: typeof makeCopyBtn; makeResetBtn: typeof makeResetBtn; addHintMarker: typeof addHintMarker;
}

// ── The markup forms — each [data-tw] type parses its dataset into the same verbose
// schema value TYPED_META consumes, then rides metaFor: ONE derivation, so markup defaults can't drift. ──
let springKeys: readonly string[] = []; // the kit's SPRING_KEYS, set by enhance()
const springData = (d: DOMStringMap) => ({ ...Object.fromEntries(springKeys.map((k) => [k, num(d[k])])), mode: d.mode }); // the motion control reads the same markup
const DATA_VALUE: Partial<Record<SchemaObject["type"], (d: DOMStringMap, host: HTMLElement, label: string) => object>> = {
  slider: (d) => ({ value: num(d.value), min: num(d.min), max: num(d.max), step: num(d.step), soft: flag(d.soft), unit: d.unit }), // absent bounds derive from the value, like the schema
  checkbox: (d) => (d.options ? { type: "radiogrid", options: splitList(d.options), value: d.value, cols: num(d.cols) } : { value: d.checked === "true" }),
  radiogrid: (d) => ({ options: splitList(d.options), value: d.value, cols: num(d.cols) }),
  list: (d) => ({ options: splitList(d.options), value: d.value }),
  buttongroup: (d) => ({ buttons: splitList(d.buttons).map((lab) => ({ label: lab })) }),
  separator: () => ({}),
  number: (d) => ({ value: num(d.value), min: num(d.min), max: num(d.max), step: num(d.step), unit: d.unit }),
  text: (d) => ({ value: d.value ?? "", placeholder: d.placeholder, rows: num(d.rows) }),
  fpsgraph: (d) => ({ label: d.label ?? "FPS" }),
  interval: (d) => ({ value: d.value ? d.value.split(",").map(Number) : undefined, min: num(d.min), max: num(d.max), step: num(d.step) }),
  sides: (d) => ({ value: d.value ?? d, corners: flag(d.corners), unit: d.unit, step: num(d.step), min: num(d.min), max: num(d.max) }), // "8px 16px", or data-top / -right / -bottom / -left
  shadow: (d) => ({ value: d.value ?? { ...d, inset: flag(d.inset) } }), // a box-shadow string, or data-x / -y / -blur / -color
  spring: springData,
  motion: (d) => ({ ...springData(d), curve: d.curve && d.curve.includes(",") ? d.curve.split(",").map(Number) : d.curve, duration: num(d.duration) }), // plus data-curve and data-duration
  cubicbezier: (d) => ({ value: d.value ? d.value.split(",").map(Number) : undefined }),
  point: (d) => {
    const vals = (d.value || "").split(",").map((s) => parseFloat(s));
    return {
      components: splitList(d.components || "X,Y").map((lab, i) => ({ key: lab.toLowerCase(), label: lab, value: isNaN(vals[i]) ? 0 : vals[i], step: num(d.step), min: num(d.min), max: num(d.max) })), // no step: the control derives a continuous one
      pad: flag(d.pad), invertY: d.invertY === "true",
    };
  },
  plot: (d) => ({ expr: d.expr, xMin: num(d.xmin), xMax: num(d.xmax), yMin: num(d.ymin), yMax: num(d.ymax), samples: num(d.samples), editable: d.editable !== "false" }),
};
const num = (s: string | undefined) => { if (s == null || s === "") return undefined; const n = +s; return Number.isFinite(n) ? n : undefined; }; // non-numeric → undefined, so the default applies
const flag = (s: string | undefined) => s === "true" || s === "";    // boolean attributes: data-x / data-x="true"
const splitList = (s: string | undefined) => (s || "").split(",").map((t) => t.trim()).filter(Boolean);
const dataMeta = (kit: MarkupKit, host: HTMLElement) => {
  const d = host.dataset, type = d.tw;
  const label = d.label ?? titleCase(d.key || type); // data-label="" means no label, like `label: ""`
  // A lazy type with no parser takes the dataset as its fields.
  const v = kit.hasOwn(DATA_VALUE, type) ? DATA_VALUE[type]!(d, host, label) : (kit.LAZY_IMPORT[type] || getControl(type)) ? { ...d } : null;
  if (!v) return null;
  // The label rides the verbose value; v spreads after, so a parser's own type or label wins.
  return kit.metaFor("v", { type, label, ...v });
};


/** The handle enhance() hangs on a bound [data-tw] host: its control, the reset pair and its key. */
interface HostHandle { ctrl: Control; raw: unknown; def: unknown; key: string; host: HTMLElement; reset: () => void }
interface HostEl extends HTMLElement { _tw?: HostHandle }

// Echo a control's value onto its host's data-value, in the comma form schema.ts parses. A plain
// object (a point, a spring) would stringify as "[object Object]", so take its values in order.
const writeDataValue = (host: HTMLElement, v: unknown) => {
  host.dataset.value = v == null ? "" : Array.isArray(v) ? v.join(",") : typeof v === "object" ? Object.values(v).join(",") : String(v);
};
// One change path for a markup host: echo onto data-value, then a bubbling tw:change with { key, value }.
const announce = (host: HTMLElement, key: string, v: unknown) => {
  writeDataValue(host, v);
  host.dispatchEvent(new CustomEvent("tw:change", { bubbles: true, detail: { key, value: v } }));
};
// querySelectorAll sees descendants only — a root that is itself a host counts too (a Document has no matches()).
const select = <T extends Element = HTMLElement>(root: Document | Element, sel: string): T[] => [...(typeof (root as Element).matches === "function" && (root as Element).matches(sel) ? [root as T] : []), ...root.querySelectorAll<T>(sel)];
/** Bind every unbound [data-tw] host under `root`. */
async function enhance(root: Document | Element, kit: MarkupKit): Promise<void> {
  const { createFolder, createControl, makeCopyBtn, makeResetBtn, addHintMarker, restoreDefault, hasOwn, valueChanged, ensureForMetas } = kit;
  springKeys = kit.SPRING_KEYS;
  // Static showcase panels collapse like the real one: wrap the controls in a .tw-body, make the title the toggle.
  select(root, '.tw-panel[data-mode="inline"]:not([data-tw-panel-bound])').forEach((panel) => {
    const header = panel.querySelector(":scope > .tw-header");
    const controls = panel.querySelector(":scope > .tw-controls");
    if (!header || !controls) return;
    panel.setAttribute("data-tw-panel-bound", "");
    const body = el("div", "tw-body"); panel.insertBefore(body, controls); body.append(controls);
    let toggle = header.querySelector<HTMLButtonElement>(".tw-header-toggle");
    const title = header.querySelector(".tw-title");
    if (!toggle && title) { toggle = btn("tw-header-toggle"); title.replaceWith(toggle); toggle.append(title); }
    if (!toggle) return;
    toggle.setAttribute("aria-expanded", "true");
    toggle.addEventListener("click", () => setCollapsed(panel, toggle, body, !panel.classList.contains("is-collapsed")));
    // The same toolbar tweaks() builds, over this panel's own [data-tw] controls (gathered at click time).
    if (!header.querySelector(".tw-toolbar")) {
      const name = (title && title.textContent) || "Panel";
      const live = () => [...panel.querySelectorAll<HostEl>("[data-tw]")].map((h) => h._tw).filter((t) => t && t.ctrl.get() !== undefined);
      // Two hosts can share a key (a repeated data-key, or the same label): suffix the duplicates.
      const values = () => {
        const vals: Record<string, unknown> = Object.create(null); // null-proto: a "__proto__" data-key is an ordinary key
        for (const t of live()) {
          let k = t.key, n = 2; while (hasOwn(vals, k)) k = `${t.key}-${n++}`;
          vals[k] = t.ctrl.get();
        }
        return JSON.stringify(vals, null, 2);
      };
      const reset = () => { for (const t of live()) t.reset(); };
      const toolbar = el("div", "tw-toolbar");
      toolbar.append(makeCopyBtn(() => [values(), -1]), makeResetBtn(reset)); header.append(toolbar); // no defaults to diff against: the copy is every value
    }
  });
  // Folders first: move child hosts into the collapsible chrome.
  select(root, '[data-tw="folder"]:not([data-tw-bound])').forEach((host) => {
    host.setAttribute("data-tw-bound", "");
    const f = createFolder({ label: host.dataset.label || "Folder" });
    [...host.children].forEach((c) => f.body.append(c));
    host.append(f.el);
  });
  // Claim each host synchronously, so a re-entrant enhance can't double-bind; then load and build.
  const hosts = select<HostEl>(root, "[data-tw]:not([data-tw-bound])")
    .map((h) => ({ host: h, meta: dataMeta(kit, h) }))
    .filter((x) => x.meta);
  hosts.forEach(({ host }) => host.setAttribute("data-tw-bound", ""));
  const pend = ensureForMetas(hosts.map((x) => x.meta));
  if (pend) await pend.catch(() => {}); // a failed chunk skips its controls instead of rejecting
  for (const { host, meta } of hosts) {
    const key = host.dataset.key || meta.label;
    // Gated the way the panel gates notify(): a same-value emit announces nothing.
    let last: unknown;
    const emit = (v: unknown) => { if (!valueChanged(last, v)) return; last = v; announce(host, key, v); };
    const ctrl = createControl(meta, emit);
    if (!ctrl) continue;
    if (!host.closest(".tw-panel, .tw-portal")) host.classList.add("tw-portal"); // a bare host gets the token scope
    host.append(ctrl.el); if (host.dataset.hint) addHintMarker(ctrl.el, host.dataset.hint);
    // raw = the markup's value, def = the form the control opened on: the panel's reset pair.
    const def = ctrl.get(); last = def;
    // The handle's set() runs the change path too, where the bare control's set() is silent.
    const handle = { ...ctrl, set: (v: unknown) => { ctrl.set(v); emit(ctrl.get()); } };
    host._tw = { ctrl: handle, raw: meta.value, def, key, host, reset: () => { restoreDefault(ctrl, meta.value, def); emit(ctrl.get()); } };
  }
}

setMarkup(enhance);

export { DATA_VALUE }; // for the registry sync test
