/* Markup-driven enhancement — enhance() turns [data-tw] hosts into live controls
 * (the showcase path), sharing the panel's meta derivation via dataMeta. Imported
 * for its side effect too: it auto-runs over the document on load. */
import { el, btn, setCollapsed } from "./shared.js";
import { dataMeta, restoreDefault, hasOwn, valueChanged } from "./schema.js";
import { ensureForMetas } from "./lazy.js";
import { createFolder, createControl } from "./controls/basic.js";
import { makeCopyBtn, makeResetBtn, addHintMarker } from "./feedback.js";
import type { Control } from "./types.js";

/** The handle enhance() hangs on a bound [data-tw] host: the control (its set() runs the
 *  change path), the pair reset restores, and the key the change event names. */
interface HostHandle { ctrl: Control; raw: unknown; def: unknown; key: string; host: HTMLElement; reset: () => void }
interface HostEl extends HTMLElement { _tw?: HostHandle }

// Echo a control's value back onto its host's data-value, in the comma form the parsers
// in schema.ts read (interval / cubicbezier / point all split data-value on ","). An array
// already stringifies that way; a plain object — the point's component map, the spring's
// config — used to hit the default toString and write the literal "[object Object]", so
// take its values in declaration order instead. Order matches the components/channels the
// control was built from, so a point round-trips exactly.
const writeDataValue = (host: HTMLElement, v: unknown) => {
  host.dataset.value = v == null ? "" : Array.isArray(v) ? v.join(",") : typeof v === "object" ? Object.values(v).join(",") : String(v);
};
// ONE change path for a markup host: echo the value onto data-value, then tell the page —
// a bubbling tw:change carrying { key, value }, so the declarative path is observable
// without a MutationObserver on the attribute. The control's own edits, the handle's set()
// and the toolbar's reset all announce through here.
const announce = (host: HTMLElement, key: string, v: unknown) => {
  writeDataValue(host, v);
  host.dispatchEvent(new CustomEvent("tw:change", { bubbles: true, detail: { key, value: v } }));
};
// querySelectorAll sees descendants only — a root that is itself a host or a panel shell
// (enhance(hostEl) for one element added later) counts too. Typed by what the selector
// matches, as querySelectorAll<T> is (a Document has no matches(), so the root counts
// only when it is an element).
const select = <T extends Element = HTMLElement>(root: Document | Element, sel: string): T[] => [...(typeof (root as Element).matches === "function" && (root as Element).matches(sel) ? [root as T] : []), ...root.querySelectorAll<T>(sel)];
export async function enhance(root: Document | Element = document): Promise<void> {
  // Static showcase panels collapse like the real one: wrap the controls in a
  // .tw-body and turn the header title into a collapse toggle.
  // Panels built by tweaks() already nest controls in .tw-body, so they're skipped.
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
    // Copy + reset are part of the component, so the static samples carry them too —
    // the same toolbar tweaks() builds, operating over this panel's own [data-tw]
    // controls (gathered lazily at click time; they're created in the pass below).
    if (!header.querySelector(".tw-toolbar")) {
      const name = (title && title.textContent) || "Panel";
      const live = () => [...panel.querySelectorAll<HostEl>("[data-tw]")].map((h) => h._tw).filter((t) => t && t.ctrl.get() !== undefined);
      // Two controls can legitimately share a key (a data-key repeated, or two hosts
      // with the same label and no data-key at all) — suffix the duplicates instead of
      // letting the later one overwrite the earlier and drop a value from the copy.
      const values = () => {
        const vals: Record<string, unknown> = Object.create(null); // a data-key of "__proto__" is an ordinary key here, not a prototype assignment that drops the value from the copy
        for (const t of live()) {
          let k = t.key, n = 2; while (hasOwn(vals, k)) k = `${t.key}-${n++}`;
          vals[k] = t.ctrl.get();
        }
        return JSON.stringify(vals, null, 2);
      };
      const reset = () => { for (const t of live()) t.reset(); };
      const toolbar = el("div", "tw-toolbar");
      toolbar.append(makeCopyBtn(panel, name, () => [values(), -1]), makeResetBtn(reset)); header.append(toolbar); // a markup panel has no defaults to diff against: ⇧ or not, the copy is every value
    }
  });
  // Folders first: build the collapsible chrome and move child [data-tw] hosts into it.
  select(root, '[data-tw="folder"]:not([data-tw-bound])').forEach((host) => {
    host.setAttribute("data-tw-bound", "");
    const f = createFolder({ label: host.dataset.label || "Folder" });
    [...host.children].forEach((c) => f.body.append(c));
    host.append(f.el);
  });
  // Claim each host + its meta synchronously (so a re-entrant enhance can't double-bind),
  // load any lazy modules they need, then build. Markup enhancement is fire-and-forget,
  // so awaiting here is fine — a lazy control simply pops in once its chunk resolves.
  const hosts = select<HostEl>(root, "[data-tw]:not([data-tw-bound])")
    .map((h) => ({ host: h, meta: dataMeta(h) }))
    .filter((x) => x.meta);
  hosts.forEach(({ host }) => host.setAttribute("data-tw-bound", ""));
  const pend = ensureForMetas(hosts.map((x) => x.meta));
  if (pend) await pend.catch(() => {}); // a failed chunk degrades to skipping its controls (createControl finds no constructor), not an unhandled rejection out of the auto-run
  for (const { host, meta } of hosts) {
    const key = host.dataset.key || meta.label;
    // Gated the way the panel gates notify(): a same-value emit (a discrete drag inside one
    // detent, a page mirroring the value back through set()) announces nothing.
    let last: unknown;
    const emit = (v: unknown) => { if (!valueChanged(last, v)) return; last = v; announce(host, key, v); };
    const ctrl = createControl(meta, emit);
    if (!ctrl) continue;
    if (!host.closest(".tw-panel, .tw-portal")) host.classList.add("tw-portal"); // a bare host outside any panel gets the token scope, else the control has no row height, no surface and no type
    host.append(ctrl.el); if (host.dataset.hint) addHintMarker(ctrl.el, host.dataset.hint);
    // raw = the markup's value, def = the form the control opened on — the panel's entries hold the same pair for reset (restoreDefault).
    const def = ctrl.get(); last = def;
    // host._tw is the host's handle. Its ctrl.set() applies the value AND runs the change path
    // (data-value + tw:change) where the bare control's set() is silent — a page restoring
    // state programmatically used to have to write data-value by hand and saw nothing fire.
    const handle = { ...ctrl, set: (v: unknown) => { ctrl.set(v); emit(ctrl.get()); } };
    host._tw = { ctrl: handle, raw: meta.value, def, key, host, reset: () => { restoreDefault(ctrl, meta.value, def); emit(ctrl.get()); } };
  }
}

if (typeof document !== "undefined") {
  const run = () => enhance(document);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
}
