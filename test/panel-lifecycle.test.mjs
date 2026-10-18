/* Panel lifecycle edges: a lifted panel whose host container goes away, two floating
 * panels fighting for the top, presets and undo called before a lazy panel is ready, and
 * free bag keys surviving an undo. */
import test from "node:test";
import assert from "node:assert/strict";
import { window } from "./_setup-dom.mjs";
import { loadSingle, loadSplit, tick, ptr, distCss } from "./_helpers.mjs";
globalThis.MutationObserver = window.MutationObserver; // the kit guards on the global; the shared setup doesn't expose it

const { tweaks } = await loadSingle();
const lazy = await loadSplit();
const drag = (p, dx) => {
  const header = p.el.querySelector(".tw-header");
  header.setPointerCapture = header.releasePointerCapture = () => {};
  header.dispatchEvent(ptr("pointerdown", { clientX: 100, clientY: 10 }));
  header.dispatchEvent(ptr("pointermove", { clientX: 100 + dx, clientY: 10 }));
  header.dispatchEvent(ptr("pointerup", { clientX: 100 + dx, clientY: 10, buttons: 0 }));
};

test("a lifted panel leaves the document with the host container that held it", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const p = tweaks("Lift", { a: [1, 0, 10, 1] }); host.append(p.el);
  drag(p, 40);
  assert.equal(p.el.dataset.mode, "floating");
  assert.equal(p.el.parentNode, document.body, "lifted to body");
  host.remove();
  await tick(20);
  assert.ok(!p.el.isConnected, "the panel followed its slot out");
  p.destroy();
});

// The three edges a real pointer hits that header-only listeners missed: a release that
// lands a hair off the header, a flick whose first move is already outside it, and the
// click the browser fires on the capturing header once the drag ends.
test("a press released off the header still ends: the grabber unlights", () => {
  const p = tweaks("Press", { a: 1 }); document.body.append(p.el);
  const header = p.el.querySelector(".tw-header");
  header.setPointerCapture = header.releasePointerCapture = () => {};
  header.dispatchEvent(ptr("pointerdown", { clientX: 100, clientY: 10 }));
  assert.ok(p.el.classList.contains("is-grabbing"));
  document.body.dispatchEvent(ptr("pointerup", { clientX: 101, clientY: 60, buttons: 0 }));
  assert.ok(!p.el.classList.contains("is-grabbing"), "the release elsewhere ended the press");
  assert.equal(p.el.dataset.mode, "inline");
  p.destroy();
});

test("a flick whose moves land outside the header still drags the panel", () => {
  const p = tweaks("Flick", { a: 1 }); document.body.append(p.el);
  const header = p.el.querySelector(".tw-header");
  header.setPointerCapture = header.releasePointerCapture = () => {};
  header.dispatchEvent(ptr("pointerdown", { clientX: 100, clientY: 10 }));
  document.body.dispatchEvent(ptr("pointermove", { clientX: 160, clientY: 90 }));
  document.body.dispatchEvent(ptr("pointerup", { clientX: 160, clientY: 90, buttons: 0 }));
  assert.equal(p.el.dataset.mode, "floating", "the move heard on the document lifted it");
  assert.ok(!p.el.classList.contains("is-grabbing") && !p.el.classList.contains("is-dragging"));
  p.destroy();
});

test("the click that ends a drag is swallowed once; the next title click still collapses", () => {
  const p = tweaks("Click", { a: 1 }); document.body.append(p.el);
  const header = p.el.querySelector(".tw-header"), title = p.el.querySelector(".tw-header-toggle");
  drag(p, 40);
  // With the header holding pointer capture, the browser targets the drag-ending click at
  // the header (the common ancestor of the press on the title and the captured release).
  header.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.ok(!p.el.classList.contains("is-collapsed"), "the drag-ending click did not collapse");
  title.click();
  assert.ok(p.el.classList.contains("is-collapsed"), "the next real click collapses");
  title.click();
  assert.ok(!p.el.classList.contains("is-collapsed"), "and the one after re-expands");
  p.destroy();
});

// A fixed box ignores page scroll, so a floating panel taller than the window used to run off
// it with its last folders unreachable. The CSS caps it at the viewport below its top edge
// (--tw-top, written with every position) and scrolls the controls under the header.
test("a floating panel taller than the viewport caps at the viewport below its top and scrolls its controls", async () => {
  const css = distCss();
  assert.match(css, /\.tw-panel\[data-mode=floating\]\{[^}]*max-height:calc\(100dvh - var\(--tw-top,\s*16px\) - 8px\)/, "the cap reads the panel's top offset");
  assert.match(css, /\.tw-panel\[data-mode=floating\]>\.tw-body>\.tw-controls\{[^}]*overflow:hidden auto/, "the controls scroll, the header stays out of the scroller");
  assert.match(css, /\.tw-panel\[data-mode=floating\]>\.tw-body>\.tw-controls\{[^}]*scrollbar-width:none/, "the scrollbar is hidden");
  assert.match(css, /:is\(\.tw-body,\s*\.tw-folder-body\)>\.tw-controls>\*\{flex-shrink:0\}/, "a capped column scrolls its rows instead of squashing them (a slider's row has no min-content height)");
  assert.match(css, /\.tw-panel\[data-mode=floating\]>\.tw-header\{margin-bottom:0\}/, "the header's gap moves into the scroller, so scrolled rows reach its hairline");
  assert.match(css, /\.tw-panel\[data-mode=floating\]\.is-collapsed>\.tw-body>\.tw-controls\{padding-top:0;padding-bottom:0\}/, "collapsed, the scroller's bottom padding goes, or a 0fr row shows a sliver of the first control");
  const h = window.innerHeight; window.innerHeight = 400; // a short window
  const schema = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`folder${i}`, { a: [1, 0, 10, 1], b: [2, 0, 10, 1] }]));
  const p = tweaks("Tall", schema, { floating: { x: 16, y: 120 } }); document.body.append(p.el);
  const header = p.el.querySelector(".tw-header"), controls = p.el.querySelector(".tw-body > .tw-controls");
  header.setPointerCapture = header.releasePointerCapture = () => {};
  const drag = (dx, dy) => { header.dispatchEvent(ptr("pointerdown", { clientX: 100, clientY: 20 })); header.dispatchEvent(ptr("pointermove", { clientX: 100 + dx, clientY: 20 + dy })); header.dispatchEvent(ptr("pointerup", { clientX: 100 + dx, clientY: 20 + dy, buttons: 0 })); };
  try {
    assert.equal(p.el.style.getPropertyValue("--tw-top"), "120px", "the cap's offset is written with the position");
    // jsdom lays nothing out: stand in for a panel the cap leaves 272px of on screen (400 − 120 − 8) whose controls want 1600.
    let h0 = 271; Object.defineProperty(p.el, "offsetHeight", { get: () => h0, configurable: true }); // +1 rounding slack makes 272
    Object.defineProperty(controls, "scrollHeight", { value: 1600, configurable: true });
    window.dispatchEvent(new Event("resize"));
    assert.equal(p.el.style.top, "8px", "a panel taller than the window clamps to the top margin on its natural height, not the capped one");
    assert.equal(p.el.style.getPropertyValue("--tw-top"), "8px", "and the cap follows: 100dvh − 8px − 8px");
    drag(40, 200);
    assert.equal(p.el.style.top, "8px", "dragging down can't push a too-tall panel off the bottom, however short the cap made it");
    assert.equal(p.el.style.left, "56px");
    // Collapsed, the hidden controls don't count: the title bar alone moves to the bottom margin.
    await tick(); // the click right after a drag is the drag's own, and swallowed
    p.el.querySelector(".tw-header-toggle").click(); h0 = 45;
    drag(0, 900);
    assert.equal(p.el.style.top, `${400 - 46 - 8}px`, "a collapsed panel parks at the bottom, not held up by its folded rows");
    await tick(); p.el.querySelector(".tw-header-toggle").click();
    // A panel that fits moves freely, the cap recomputed from where it lands.
    Object.defineProperty(controls, "scrollHeight", { value: 0, configurable: true });
    h0 = 100; // offsetHeight rounds a fractional layout, so the clamp allows a pixel of slack
    drag(0, -900); drag(0, 150);
    assert.equal(p.el.style.top, "158px");
    assert.equal(p.el.style.getPropertyValue("--tw-top"), "158px", "recomputed after the drag");
    drag(0, 900);
    assert.equal(p.el.style.top, `${400 - 101 - 8}px`, "parked at the bottom on the rounded-up height");
  } finally { window.innerHeight = h; p.destroy(); }
});

test("draggable: false pins a floating panel too", () => {
  const p = tweaks("Pinned", { a: 1 }, { floating: { x: 40, y: 50 }, draggable: false }); document.body.append(p.el);
  const header = p.el.querySelector(".tw-header");
  header.setPointerCapture = header.releasePointerCapture = () => {};
  header.dispatchEvent(ptr("pointerdown", { clientX: 100, clientY: 10 }));
  header.dispatchEvent(ptr("pointermove", { clientX: 200, clientY: 110 }));
  header.dispatchEvent(ptr("pointerup", { clientX: 200, clientY: 110, buttons: 0 }));
  assert.deepEqual([p.el.style.left, p.el.style.top], ["40px", "50px"], "the press moved nothing");
  assert.ok(!p.el.classList.contains("is-grabbing"));
  p.el.querySelector(".tw-header-toggle").click();
  assert.ok(p.el.classList.contains("is-collapsed"), "the title still collapses");
  p.destroy();
});

test("the floating panel touched last sits above the others", () => {
  const a = tweaks("A", { a: 1 }, { floating: true }), b = tweaks("B", { b: 1 }, { floating: true });
  document.body.append(a.el, b.el);
  drag(a, 30);
  assert.equal(a.el.style.zIndex, "99991");
  drag(b, 30);
  assert.equal(b.el.style.zIndex, "99991");
  assert.equal(a.el.style.zIndex, "", "the previous holder gives the stylesheet value back");
  a.destroy(); b.destroy();
});

test("presets and undo called before a lazy panel is ready replay in order", async () => {
  localStorage.clear();
  const spring = { type: "spring", value: { stiffness: 100, damping: 12, mass: 1 } }; // lazy, so assemble waits on ready
  const p = lazy.tweaks("LazyPresets", { x: [1, 0, 10, 1], s: spring }, { persist: "lp" });
  assert.ok(p.el.querySelector(".tw-toolbar-btn--reset").disabled, "in the lazy window");
  p.set("x", 4);
  assert.equal(p.savePreset("four"), true, "queued, not dropped");
  p.set("x", 9);
  await p.ready;
  assert.deepEqual(p.presets(), ["four"]);
  assert.equal(p.params.x, 9);
  p.loadPreset("four");
  assert.equal(p.params.x, 4, "the preset captured the value at its point in the queue");
  p.destroy();
  localStorage.setItem("tw:lp2:presets", JSON.stringify({ seven: { x: 7 } }));
  const q = lazy.tweaks("LazyLoad", { x: [1, 0, 10, 1], b: { type: "cubicbezier", value: [0.4, 0, 0.2, 1] } }, { persist: "lp2" }); // spring is registered by now — a type the process has not loaded keeps this in the lazy window
  assert.ok(q.el.querySelector(".tw-toolbar-btn--reset").disabled, "still in the lazy window");
  assert.equal(q.loadPreset("seven"), true, "a stored preset is loadable before ready");
  assert.equal(q.loadPreset("missing"), false);
  await q.ready;
  assert.equal(q.params.x, 7);
  q.destroy();
});

test("undo brings a free bag key back", async () => {
  const p = tweaks("Bag", { a: [1, 0, 10, 1] }, { undo: true });
  document.body.append(p.el);
  try {
    p.set("free", 1); await tick(400);
    p.set("free", 2); await tick(400);
    p.undo();
    assert.equal(p.params.free, 1);
  } finally { p.destroy(); }
});
