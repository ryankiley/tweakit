/* Markup-driven enhancement — enhance() turns [data-tw] hosts into live controls, sharing the
 * panel's meta derivation via dataMeta. Imported for its side effect too: it auto-runs on load. */
import { el, btn, setCollapsed } from "./shared.js";
import { dataMeta, restoreDefault, valueChanged } from "./schema.js";
import { ensureForMetas } from "./lazy.js";
import { createFolder, createControl } from "./controls/basic.js";
import { makeCopyBtn, makePasteBtn, makeResetBtn, addHintMarker, flash, showToast } from "./feedback.js";
import type { Control } from "./types.js";
import type { Meta } from "./schema.js";

/** The handle enhance() hangs on a bound [data-tw] host: its control, the reset pair and its key. */
interface HostHandle { ctrl: Control; raw: unknown; def: unknown; key: string; host: HTMLElement; reset: () => void; m: Meta }
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
/** Bind every unbound [data-tw] host under `root` (the document by default). */
export async function enhance(root: Document | Element = document): Promise<void> {
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
      // Two hosts can share a key (a repeated data-key, or the same label): suffix the duplicates. Copy and paste key them alike.
      const keyed = () => { const seen = new Set<string>(); return live().map((t) => { let k = t.key, n = 2; while (seen.has(k)) k = `${t.key}-${n++}`; seen.add(k); return { path: [k], get: t.ctrl.get, m: t.m, t }; }); };
      const values = () => JSON.stringify(Object.fromEntries(keyed().map((s) => [s.path[0], s.get()])), null, 2); // fromEntries: a "__proto__" data-key is an ordinary key
      // The copy's object back (or a panel's { values } state): the values that fit their hosts, each through its change path.
      const paste = (pick: typeof import("./clip.js").pick) => (text: string) => {
        const data = JSON.parse(text), vals = data && Object.keys(data).every((k) => k === "values" || k === "ui") && data.values ? data.values : data;
        const hits = pick(keyed(), vals); for (const [s, v] of hits) s.t.ctrl.set(v);
        return hits.length || false;
      };
      const reset = () => { for (const t of live()) t.reset(); };
      const toolbar = el("div", "tw-toolbar");
      const pasteBtn = makePasteBtn((read, b) => { import("./clip.js").then((m) => m.pasteInto(read, b, panel, paste(m.pick), { flash, showToast, alive: () => panel.isConnected }), () => flash(b, "is-failed")); });
      toolbar.append(makeCopyBtn(panel, () => name, () => [values(), -1]), pasteBtn, makeResetBtn(reset)); header.append(toolbar); // no defaults to diff against: the copy is every value
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
    .map((h) => ({ host: h, meta: dataMeta(h) }))
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
    host._tw = { ctrl: handle, raw: meta.value, def, key, host, m: meta, reset: () => { restoreDefault(ctrl, meta.value, def); emit(ctrl.get()); } };
  }
}

if (typeof document !== "undefined") {
  const run = () => enhance(document);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
}
