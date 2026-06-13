// ── Tabs — group controls into pages. Lazy; build() recurses its page bodies
// after the module has loaded (ensured before the panel assembles).
import { el, txt, onReady, stretchPill, navIndex, registerControl } from "../shared.js";

// ── Tabs — group controls into pages; a pill slides to the active tab (Tweakpane's
// addTab / leva pages). Each page body is a .tw-controls that build() fills. ──
let tabsSeq = 0; // unique ids for the tab ↔ tabpanel aria pairing
function createTabs(meta) {
  const uid = `tw-tabs-${++tabsSeq}`;
  const root = el("div", "tw-tabs");
  const bar = el("div", "tw-tabs-bar"); bar.setAttribute("role", "tablist");
  const pill = el("div", "tw-tabs-pill"); bar.append(pill);
  const pagesWrap = el("div", "tw-tabs-pages");
  const bodies = [];
  const tabs = meta.pages.map((page, i) => {
    const tab = txt("button", "tw-tabs-tab", page.title); tab.type = "button"; tab.setAttribute("role", "tab");
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
  const measure = (animate?) => {
    const a = bar.querySelector('[data-active="true"]'); if (!a) return;
    const left = a.offsetLeft, prev = parseFloat(pill.style.left);
    pill.style.left = left + "px"; pill.style.width = a.offsetWidth + "px";
    if (animate && Number.isFinite(prev) && prev !== left) stretchPill(pill, left > prev ? 1 : -1); // liquid stretch as the pill crosses to the new tab
  };
  function activate(i) {
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
  return { el: root, bodies };
}

registerControl("tabs", createTabs);

