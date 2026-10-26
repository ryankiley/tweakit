/* The panel shell's own wiring doesn't depend on the lazy chunks, so it must work in the lazy window
 * too (dist/tweaks/core.js, before `ready`). It used to be wired inside the deferred assemble(), so
 * until the first chunk landed a header drag did nothing. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSplit } from "./_helpers.mjs";

const { tweaks } = await loadSplit();

const pointer = (type, target, x, y, extra = {}) => target.dispatchEvent(Object.assign(new window.Event(type, { bubbles: true }), { pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y, isPrimary: true, ...extra }));

test("a header drag lifts the panel before the lazy chunks have landed", async () => {
  // spring is lazy, so assemble() waits on panel.ready — this drag happens before it
  const p = tweaks("Early", { x: [1, 0, 10, 1], s: { type: "spring", value: { stiffness: 100, damping: 12, mass: 1 } } });
  document.body.append(p.el);
  assert.ok(p.el.querySelector(".tw-toolbar-btn--reset").disabled, "in the lazy window");
  const header = p.el.querySelector(".tw-header");
  pointer("pointerdown", header, 10, 10);
  pointer("pointermove", header, 40, 30);
  pointer("pointerup", header, 40, 30, { buttons: 0 });
  assert.equal(p.el.dataset.mode, "floating", "the drag lifted the panel into the floating layer");
  await p.ready;
  assert.equal(p.el.dataset.mode, "floating", "and ready didn't undo it");
  p.destroy();
});
