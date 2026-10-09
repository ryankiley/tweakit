// ── Tabs — group controls into pages. Lazy; build() recurses its page bodies
// after the module has loaded (ensured before the panel assembles).
import { el, txt, onReady, measurePill, navIndex, registerControl } from "../shared.js";
import type { Meta } from "../schema.js";

/** The tabs handle: a page body per tab for build() to fill, and the active tab for
 *  the panel's UI state (toJSON/fromJSON). */
export interface TabsControl { el: HTMLDivElement; bodies: HTMLDivElement[]; activate(i: number): void; active(): number }

// ── Tabs — group controls into pages; a pill slides to the active tab. Each page
// body is a .tw-controls that build() fills. ──
let tabsSeq = 0; // unique ids for the tab ↔ tabpanel aria pairing
function createTabs(meta: Meta): TabsControl {
  const uid = `tw-tabs-${++tabsSeq}`;
  const root = el("div", "tw-tabs");
  const bar = el("div", "tw-tabs-bar"); bar.setAttribute("role", "tablist");
  const pill = el("div", "tw-tabs-pill"); bar.append(pill);
  const pagesWrap = el("div", "tw-tabs-pages");
  const bodies: HTMLDivElement[] = [];
  const tabs = meta.pages.map((page, i) => {
    const tab = txt("button", "tw-tabs-tab", page.title); tab.setAttribute("role", "tab");
    tab.dataset.active = String(i === 0); tab.setAttribute("aria-selected", String(i === 0));
    tab.tabIndex = i === 0 ? 0 : -1; // roving tabindex from build, not only after the first activate
    tab.id = `${uid}-tab-${i}`; tab.setAttribute("aria-controls", `${uid}-page-${i}`);
    const body = el("div", "tw-tabs-page tw-controls"); body.dataset.active = String(i === 0);
    body.setAttribute("role", "tabpanel"); body.id = `${uid}-page-${i}`; body.setAttribute("aria-labelledby", tab.id);
    bodies.push(body); pagesWrap.append(body);
    tab.addEventListener("click", () => activate(i));
    bar.append(tab); return tab;
  });
  root.append(bar, pagesWrap);
  const measure = (animate?: boolean) => measurePill(bar, pill, animate); // slide the pill to the active tab; liquid stretch on a real move (shared with the segmented control)
  function activate(i: number) {
    tabs.forEach((b, k) => { b.dataset.active = String(k === i); b.setAttribute("aria-selected", String(k === i)); b.tabIndex = k === i ? 0 : -1; });
    bodies.forEach((b, k) => (b.dataset.active = String(k === i)));
    measure(true);
    // Controls built on a display:none page measured 0 (blank canvas/SVG, handles at
    // origin) — once the page is visible, let them re-measure. Namespaced, not a real
    // "resize": host pages listen to that.
    requestAnimationFrame(() => window.dispatchEvent(new Event("tw-reflow")));
  }
  bar.addEventListener("keydown", (e) => {
    const i = tabs.findIndex((b) => b.dataset.active === "true"); if (i < 0) return;
    const j = navIndex(e.key, i, tabs.length, -1); if (j < 0) return; // cols −1: ↑/↓ stay the page's scroll keys (the ARIA tabs pattern)
    e.preventDefault(); activate(j); tabs[j].focus();
  });
  onReady(measure);
  // active()/activate() let the panel read + restore the selected tab (toJSON/fromJSON).
  return { el: root, bodies, activate, active: () => tabs.findIndex((t) => t.dataset.active === "true") };
}

registerControl("tabs", createTabs);

