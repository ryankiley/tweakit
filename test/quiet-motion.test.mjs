/* Motion that only a pointer earns, and the touch and paint costs around it: a press the page takes as a scroll gives the
 * slider its value back, a pick or a pane driven from the keyboard lands at once, and the FPS graph paints nothing while
 * it can't be seen. Runs against the single-file bundle under jsdom; the stylesheet's part is read from the source. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "./_setup-dom.mjs";
import { loadSingle, wait, ptr, key } from "./_helpers.mjs";

const { tweaks } = await loadSingle();

// jsdom lays out nothing: a press needs a real track width.
const pressable = (track) => {
  track.setPointerCapture = () => {};
  track.parentNode.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 32, width: 200, height: 32 });
  return track;
};

test("a press the page takes as a scroll puts the slider's value back, continuous or notched", async (t) => {
  const p = tweaks("Swipe", { fine: [5, 0, 10, 0.1], notch: [3, 0, 6, 1] });
  t.after(() => p.destroy()); // even when an assertion fails, so no loop outlives the test
  document.body.append(p.el);
  const [fine, notch] = [...p.el.querySelectorAll(".twk-slider")].map(pressable);
  for (const [k, track] of [
    ["fine", fine],
    ["notch", notch],
  ]) {
    const before = p.params[k];
    track.dispatchEvent(ptr("pointerdown", { clientX: 190, pointerType: "touch" }));
    await wait(40); // a notched slider commits on its spring's first frames
    assert.notEqual(p.params[k], before, `${k}: the press moved the value`);
    track.dispatchEvent(ptr("pointercancel", { clientX: 190, buttons: 0, pointerType: "touch" }));
    await wait(700); // the notch's spring settles
    assert.equal(p.params[k], before, `${k}: the cancelled press left the value it began from`);
  }
});

test("a pick by key lands a pill at once; a pick by pointer slides it", (t) => {
  const p = tweaks("Pills", { on: true, size: { type: "radiogrid", options: ["S", "M", "L"], value: "S" } });
  t.after(() => p.destroy());
  document.body.append(p.el);
  const seg = p.el.querySelector(".twk-seg"),
    grid = p.el.querySelector(".twk-radiogrid-grid");
  const segPill = seg.querySelector(".twk-seg-pill"),
    gridPill = grid.querySelector(".twk-radiogrid-pill");
  key(seg, { key: "ArrowLeft" });
  assert.equal(p.params.on, false);
  assert.ok(segPill.classList.contains("is-still"), "a switch flipped by key doesn't slide");
  key(grid.querySelector('[data-active="true"]'), { key: "ArrowRight" });
  assert.equal(p.params.size, "M");
  assert.ok(gridPill.classList.contains("is-still"), "a grid stepped by key doesn't slide");
  const on = seg.querySelectorAll(".twk-seg-btn")[1],
    large = grid.querySelectorAll(".twk-radiogrid-btn")[2];
  on.dispatchEvent(ptr("pointerdown"));
  on.click();
  assert.equal(p.params.on, true);
  assert.ok(!segPill.classList.contains("is-still"), "a switch clicked slides");
  large.dispatchEvent(ptr("pointerdown"));
  large.click();
  assert.equal(p.params.size, "L");
  assert.ok(!gridPill.classList.contains("is-still"), "a grid clicked slides");
});

test("a list's pane opened and closed from the keyboard moves at once; by a click, it eases", async (t) => {
  const p = tweaks("Pane", { pick: { type: "list", options: ["a", "b", "c"], value: "a" } });
  t.after(() => p.destroy());
  document.body.append(p.el);
  const trigger = p.el.querySelector(".twk-select-trigger");
  key(trigger, { key: "ArrowDown" });
  const pane = document.querySelector(".twk-select-dropdown");
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.ok(pane.classList.contains("is-still"), "opened by a key: no entrance");
  key(pane, { key: "Escape" });
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.ok(pane.classList.contains("is-still"), "closed by a key: gone at once");
  await wait(250); // the closed pane leaves the page
  trigger.dispatchEvent(ptr("pointerdown"));
  trigger.click();
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.ok(!pane.classList.contains("is-still"), "opened by a click: it eases in");
});

test("the FPS graph paints nothing while it can't be seen or is folded away, and picks up when it can", async (t) => {
  let report = (_seen) => {};
  const real = window.HTMLCanvasElement.prototype.getContext;
  // jsdom has no 2D context, and without one the graph degrades to a plain readout
  window.HTMLCanvasElement.prototype.getContext = () =>
    Object.fromEntries(
      ["setTransform", "clearRect", "beginPath", "moveTo", "lineTo", "stroke"].map((m) => [m, () => {}]),
    );
  globalThis.IntersectionObserver = class {
    constructor(cb) {
      report = (seen) => cb([{ isIntersecting: seen, intersectionRatio: seen ? 1 : 0 }]);
    }
    observe() {}
    disconnect() {}
  };
  try {
    const p = tweaks("Seen", { box: { fps: { type: "fpsgraph" } } });
    t.after(() => p.destroy());
    document.body.append(p.el);
    const val = p.el.querySelector(".twk-fps-val"),
      header = p.el.querySelector(".twk-folder-header");
    // the readout's writes over a few polyfilled frames
    const writes = () =>
      new Promise((done) => {
        let n = 0;
        const mo = new window.MutationObserver((ms) => (n += ms.length));
        mo.observe(val, { childList: true, characterData: true, subtree: true });
        setTimeout(() => (mo.disconnect(), done(n)), 120);
      });
    report(false);
    assert.equal(await writes(), 0, "nothing written while it can't be seen");
    report(true);
    assert.ok((await writes()) > 0, "the readout follows once it can");
    header.click();
    assert.equal(await writes(), 0, "nothing written while its folder is folded");
    header.click();
    assert.ok((await writes()) > 0, "and again once it opens");
  } finally {
    delete globalThis.IntersectionObserver;
    window.HTMLCanvasElement.prototype.getContext = real;
  }
});

test("src/tweaks.css: what a drag rewrites isn't inherited, tabs switch at once, tips wait, panes keep their scroll", async () => {
  const css = await readFile(new URL("../src/tweaks.css", import.meta.url), "utf8");
  for (const name of ["x", "y", "max-h"])
    assert.match(css, new RegExp(`@property --twk-float-${name} \\{[^}]*inherits: false`), `--twk-float-${name}`);
  assert.doesNotMatch(css, /\.twk-tabs-page\[data-active="true"\] \{[^}]*animation/, "a tab page has no entrance");
  assert.match(css, /\.twk-tip\.is-open \{[^}]*transition-delay/, "a tip waits before it shows");
  assert.match(css, /\.twk-select-dropdown \{[^}]*overscroll-behavior: contain/, "a list's pane keeps its scroll");
  assert.match(css, /\.twk-slider \{[^}]*touch-action: pan-y/, "a vertical swipe on a slider scrolls the page");
  assert.match(
    css,
    /\.twk-tabs-tab \{[^}]*flex: 1 0 auto[^}]*max-width: 100%/,
    "tab titles wrap, and one too long ellipsizes",
  );
  // between wrapped rows the pill goes straight to the pick, as a grid's does, never along the row it left
  assert.match(css, /\.twk-tabs-pill \{[^}]*transition:[^}]*\btop\b[^}]*\bheight\b/, "a tab pill eases its top too");
});
