// ── Tabs — group controls into pages; build() fills the page bodies. Lazy.
import { el, txt, addPill, navIndex, requestReflow, registerControl } from "../shared.js";
import type { Meta } from "../schema.js";

/** The tabs handle: a page body per tab for build() to fill, and the active tab for the panel's UI state. */
export interface TabsControl {
  el: HTMLDivElement;
  bodies: HTMLDivElement[];
  activate(i: number): void;
  active(): number;
}

let tabsSeq = 0; // unique ids for the tab ↔ tabpanel aria pairing
function createTabs(meta: Meta): TabsControl {
  const uid = `twk-tabs-${++tabsSeq}`;
  const root = el("div", "twk-tabs");
  const bar = el("div", "twk-tabs-bar");
  bar.setAttribute("role", "tablist");
  const measure = addPill(bar, "twk-tabs-pill"); // slides to the active tab
  const pagesWrap = el("div", "twk-tabs-pages");
  const bodies: HTMLDivElement[] = [];
  const tabs = meta.pages.map((page, i) => {
    const tab = txt("button", "twk-tabs-tab", page.title);
    tab.setAttribute("role", "tab");
    tab.id = `${uid}-tab-${i}`;
    tab.setAttribute("aria-controls", `${uid}-page-${i}`);
    const body = el("div", "twk-tabs-page twk-controls");
    body.setAttribute("role", "tabpanel");
    body.id = `${uid}-page-${i}`;
    body.setAttribute("aria-labelledby", tab.id);
    bodies.push(body);
    pagesWrap.append(body);
    tab.addEventListener("click", () => activate(i));
    bar.append(tab);
    return tab;
  });
  root.append(bar, pagesWrap);
  // The active tab and page; the roving tabindex is set from the build, not only after a switch.
  const mark = (i: number) => {
    tabs.forEach((b, k) => {
      b.dataset.active = String(k === i);
      b.setAttribute("aria-selected", String(k === i));
      b.tabIndex = k === i ? 0 : -1;
    });
    bodies.forEach((b, k) => (b.dataset.active = String(k === i)));
  };
  mark(0);
  function activate(i: number) {
    mark(i);
    measure(true);
    requestReflow(); // controls built on a display:none page measured 0; let them re-measure
  }
  bar.addEventListener("keydown", (e) => {
    const i = tabs.findIndex((b) => b.dataset.active === "true");
    if (i < 0) return;
    const j = navIndex(e.key, i, tabs.length, -1);
    if (j < 0) return; // cols −1: ↑/↓ stay the page's scroll keys
    e.preventDefault();
    activate(j);
    tabs[j].focus();
  });
  return { el: root, bodies, activate, active: () => tabs.findIndex((t) => t.dataset.active === "true") };
}

registerControl("tabs", createTabs);
