/* Panel behaviour against the built single-file bundle (dist/tweaks.js — every
 * control registered synchronously), under jsdom. `npm test` builds dist first.
 * These pin the degrade contracts and API semantics the adversarial passes
 * established — the panel must never throw on hostile schemas, and set()/on()/
 * reset() must round-trip. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));

test("a malformed verbose value degrades to a skipped control, not a thrown build", () => {
  const p = tweaks("T", {
    badPoint: { type: "point", components: [null] },
    badTabs: { type: "tabs", pages: { A: null } },
    ok: 5,
  });
  assert.equal(p.params.ok, 5);
  assert.ok(!("badPoint" in p.params));
});

test("soft slider keeps an out-of-range default; hard slider clamps it", () => {
  const soft = tweaks("S", { x: { type: "slider", value: 150, min: 0, max: 100, step: 1, soft: true } });
  assert.equal(soft.params.x, 150);
  const hard = tweaks("H", { x: { type: "slider", value: 150, min: 0, max: 100, step: 1 } });
  assert.equal(hard.params.x, 100);
});

test("set() reaches nested controls by dotted path and unambiguous bare key", () => {
  const p = tweaks("N", { folder: { y: [1, 0, 10, 1] } });
  p.set("folder.y", 7);
  assert.equal(p.params.folder.y, 7);
  p.set("y", 3);
  assert.equal(p.params.folder.y, 3);
});

test("set() refuses prototype-polluting keys", () => {
  const p = tweaks("P", { a: 1 });
  p.set("__proto__.polluted", true);
  p.set("constructor", true);
  assert.equal({}.polluted, undefined);
  assert.equal(typeof {}.constructor, "function"); // untouched
});

test("text control coerces null/undefined to the empty string", () => {
  const p = tweaks("Txt", { label: { type: "text", value: "hi" } });
  p.set("label", null);
  assert.equal(p.params.label, "");
});

test("interval without a value tuple defaults to its bounds", () => {
  const p = tweaks("I", { r: { type: "interval", min: 0, max: 10 } });
  assert.deepEqual(p.params.r, [0, 10]);
});

test("number control survives an Infinity step", () => {
  const p = tweaks("Inf", { n: { type: "number", value: 5, step: Infinity } });
  assert.equal(p.params.n, 5);
  p.set("n", 7);
  assert.equal(p.params.n, 7);
});

test("on() hears changes with the changed key; reset() restores defaults", () => {
  const p = tweaks("R", { folder: { y: [1, 0, 10, 1] } });
  let heard = null;
  p.on((params, last) => { heard = last; });
  p.set("folder.y", 9);
  assert.equal(heard, "y");
  assert.equal(p.params.folder.y, 9);
  p.reset();
  assert.equal(p.params.folder.y, 1);
});

test("a same-value set() does not notify (the echo guard)", () => {
  const p = tweaks("E", { y: [1, 0, 10, 1], pt: { type: "point", components: [{ key: "x", value: 2 }] } });
  let calls = 0;
  p.on(() => calls++);
  p.set("y", 1);                 // unchanged primitive
  p.set("pt", { x: 2 });         // structurally-equal object value
  assert.equal(calls, 0);
  p.set("y", 2);
  assert.equal(calls, 1);
});

test("destroy() inerts the API and removes the panel", () => {
  const p = tweaks("D", { a: 1 });
  document.body.append(p.el);
  p.destroy();
  assert.equal(p.el.isConnected, false);
  p.set("a", 5); // must be a silent no-op
  assert.equal(p.params.a, 1);
});

test("text-field focus is quiet after a pointer press, ringed after a key press", () => {
  const p = tweaks("F", { note: "hello" });
  document.body.append(p.el);
  const input = p.el.querySelector(".tw-text");
  // mouse path: a pointer press marks the next focus quiet (no keyboard ring)
  document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  input.focus();
  assert.ok(input.classList.contains("tw-focus-quiet"));
  input.blur();
  assert.ok(!input.classList.contains("tw-focus-quiet")); // cleared on blur
  // keyboard path: any key restores the ring for the next focus
  document.dispatchEvent(new Event("keydown", { bubbles: true }));
  input.focus();
  assert.ok(!input.classList.contains("tw-focus-quiet"));
  p.destroy();
});
