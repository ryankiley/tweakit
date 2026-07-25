/* Markup-driven enhancement — enhance() turns [data-tw] hosts into live controls
 * (the showcase path), sharing the panel's meta derivation via dataMeta. Imported
 * for its side effect too: it auto-runs over the document on load. */
import { el, btn } from "./shared.js";
import { dataMeta } from "./schema.js";
import { ensureForMetas } from "./lazy.js";
import { createFolder, createControl } from "./controls/basic.js";
import { makeCopyBtn, makeResetBtn, flashCopied, spinReset, showToast, copyText, addHintMarker } from "./feedback.js";

export async function enhance(root: Document | Element = document): Promise<void> {
  // Static showcase panels collapse like the real one: wrap the controls in a
  // .tw-body and turn the header title into a collapse toggle.
  // Panels built by tweaks() already nest controls in .tw-body, so they're skipped.
  root.querySelectorAll('.tw-panel[data-mode="inline"]:not([data-tw-panel-bound])').forEach((panel) => {
    const header = panel.querySelector(":scope > .tw-header");
    const controls = panel.querySelector(":scope > .tw-controls");
    if (!header || !controls) return;
    panel.setAttribute("data-tw-panel-bound", "");
    const body = el("div", "tw-body"); panel.insertBefore(body, controls); body.append(controls);
    let toggle: any = header.querySelector(".tw-header-toggle");
    const title = header.querySelector(".tw-title");
    if (!toggle && title) { toggle = btn("tw-header-toggle"); title.replaceWith(toggle); toggle.append(title); }
    if (!toggle) return;
    toggle.setAttribute("aria-expanded", "true");
    toggle.addEventListener("click", () => { const c = panel.classList.toggle("is-collapsed"); toggle.setAttribute("aria-expanded", c ? "false" : "true"); body.inert = c; });
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
