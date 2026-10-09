/* The panel shell's own wiring — the header drag, the presets menu, the undo keys, the
 * edit-lifecycle hooks — doesn't depend on the lazy chunks, so it must work in the lazy
 * window too (dist/tweaks/core.js, before `ready`). It used to be wired inside the
 * deferred assemble(), so until the first chunk landed a header drag did nothing. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks/core.js", import.meta.url));

const pointer = (type, target, x, y, extra = {}) => target.dispatchEvent(Object.assign(new window.Event(type, { bubbles: true }), { pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y, isPrimary: true, ...extra }));

test("a header drag lifts the panel before the lazy chunks have landed", async () => {
  // spring is lazy, so assemble() waits on panel.ready — this drag happens before it
  const p = tweaks("Early", { x: [1, 0, 10, 1], s: { type: "spring", value: { stiffness: 100, damping: 12, mass: 1 } } });
  document.body.append(p.el);
  const header = p.el.querySelector(".tw-header");
  pointer("pointerdown", header, 10, 10);
  pointer("pointermove", header, 40, 30);
  pointer("pointerup", header, 40, 30, { buttons: 0 });
  assert.equal(p.el.dataset.mode, "floating", "the drag lifted the panel into the floating layer");
  assert.ok(p.el.querySelector(".tw-grabber"), "the grabber pill is part of the shell, not the build");
  await p.ready;
  assert.equal(p.el.dataset.mode, "floating", "and ready didn't undo it");
  p.destroy();
});

test("the edit-lifecycle hooks fire before the lazy chunks have landed", async () => {
  let started = 0, ended = 0;
  const p = tweaks("Edit", { x: [1, 0, 10, 1], s: { type: "spring", value: { stiffness: 100, damping: 12, mass: 1 } } }, { onEditStart: () => started++, onEditEnd: () => ended++ });
  document.body.append(p.el);
  // The slider is a core control, but nothing is built yet — exercise the hook through the
  // relay the popovers use, the same path a drag on any surface takes once built.
  const fake = document.createElement("div"); fake.className = "tw-slider"; p.el.append(fake);
  pointer("pointerdown", fake, 5, 5);
  document.dispatchEvent(Object.assign(new window.Event("pointerup", { bubbles: true }), { pointerId: 1 }));
  assert.equal(started, 1); assert.equal(ended, 1);
  await p.ready;
  p.destroy();
});
