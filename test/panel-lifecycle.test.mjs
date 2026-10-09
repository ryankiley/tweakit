/* Panel lifecycle edges: a lifted panel whose host container goes away, two floating
 * panels fighting for the top, presets and undo called before a lazy panel is ready, and
 * free bag keys surviving an undo. */
import test from "node:test";
import assert from "node:assert/strict";
import { window } from "./_setup-dom.mjs";
globalThis.MutationObserver = window.MutationObserver; // the kit guards on the global; the shared setup doesn't expose it

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));
const lazy = await import(new URL("../dist/tweaks/core.js", import.meta.url));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
// Synthetic pointer event — jsdom has no PointerEvent constructor; the drag paths only read
// pointerId / button / buttons / clientX / clientY off it.
const ptr = (type, props) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), { pointerId: 1, button: 0, buttons: 1, pointerType: "mouse", ...props });
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
  const q = lazy.tweaks("LazyLoad", { x: [1, 0, 10, 1], s: spring }, { persist: "lp2" });
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
