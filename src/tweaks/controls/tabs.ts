// ── Tabs — group controls into pages. Lazy; build() recurses its page bodies
// after the module has loaded (ensured before the panel assembles).
import { el, onReady, stretchPill, registerControl } from "../shared.js";

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
    const btn = el("button", "tw-tabs-tab"); btn.type = "button"; btn.setAttribute("role", "tab"); btn.textContent = page.title;
    btn.dataset.active = String(i === 0); btn.setAttribute("aria-selected", String(i === 0));
    btn.tabIndex = i === 0 ? 0 : -1; // roving tabindex from build, not only after the first activate
    btn.id = `${uid}-tab-${i}`; btn.setAttribute("aria-controls", `${uid}-page-${i}`);
    const body = el("div", "tw-tabs-page tw-controls"); body.dataset.active = String(i === 0);
    body.setAttribute("role", "tabpanel"); body.id = `${uid}-page-${i}`; body.setAttribute("aria-labelledby", btn.id);
    bodies.push(body); pagesWrap.append(body);
    btn.addEventListener("click", () => activate(i));
    bar.append(btn); return btn;
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
    let n = i;
    if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") n = 0; // Home/End jump to the ends — the ARIA tabs pattern, matching the segmented/radiogrid groups
    else if (e.key === "End") n = tabs.length - 1;
    else return;
    e.preventDefault(); activate(n); tabs[n].focus();
  });
  onReady(measure);
  return { el: root, bodies };
}

registerControl("tabs", createTabs);

