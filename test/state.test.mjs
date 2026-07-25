/* State machinery — the subsystems with the most intricate logic and (previously)
 * no coverage: persistence + presets, undo/redo, toJSON/fromJSON (including the
 * JSON-pointer path escaping), setMany batching, and the gradient's value
 * normalisation. Runs against the built single-file bundle under jsdom, like
 * panel.test.mjs. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test("persist round-trips values through localStorage (debounced save, restore on build)", async () => {
  const a = tweaks("P", { x: [1, 0, 10, 1] }, { persist: "t-persist" });
  a.set("x", 7);
  await tick(250); // save debounce is 150ms
  const b = tweaks("P", { x: [1, 0, 10, 1] }, { persist: "t-persist" });
  assert.equal(b.params.x, 7);
});

test("presets save, list, load, and delete", () => {
  const p = tweaks("P", { x: [1, 0, 10, 1] }, { persist: "t-presets" });
  p.set("x", 9);
  assert.equal(p.savePreset("nine"), true);
  p.set("x", 2);
  assert.deepEqual(p.presets(), ["nine"]);
  assert.equal(p.loadPreset("nine"), true);
  assert.equal(p.params.x, 9);
  p.deletePreset("nine");
  assert.deepEqual(p.presets(), []);
  assert.equal(p.loadPreset("nine"), false);
});

test("a preset named __proto__ stays an ordinary key", () => {
  const p = tweaks("P", { x: 1 }, { persist: "t-proto" });
  assert.equal(p.savePreset("__proto__"), true);
  assert.ok(p.presets().includes("__proto__"));
  assert.equal({}.polluted, undefined);
});

test("undo/redo step through edits; a new edit drops the redo branch", async () => {
  const p = tweaks("U", { x: [1, 0, 10, 1] }, { undo: true });
  p.set("x", 5);
  await tick(400); // history commit debounce is 350ms
  p.set("x", 8);
  p.undo(); // flush commits the pending 8 first, then steps back to it -> 5
  assert.equal(p.params.x, 5);
  p.undo();
  assert.equal(p.params.x, 1);
  p.redo();
  assert.equal(p.params.x, 5);
  p.set("x", 3); // new edit -> redo branch (8) is gone
  p.redo();
  assert.equal(p.params.x, 3);
});

test("toJSON escapes dotted folder keys injectively; fromJSON restores values + UI", () => {
  const p = tweaks("J", { "a.b": { x: [1, 0, 10, 1] } });
  p.set("x", 4); // the folder key contains a literal dot, so a dotted path can't reach x — the unambiguous bare key does
  const state = p.toJSON();
  assert.equal(state.values["a.b"].x, 4);
  assert.deepEqual(Object.keys(state.ui.folders), ["a~0b"]); // "." -> ~0, so a literal dot can't collide with the separator
  const q = tweaks("J", { "a.b": { x: [1, 0, 10, 1] } });
  q.fromJSON({ values: { "a.b": { x: 6 } }, ui: { folders: { "a~0b": true } } });
  assert.equal(q.params["a.b"].x, 6);
  assert.ok(q.el.querySelector(".tw-folder").classList.contains("is-collapsed"));
});

test("fromJSON skips values whose path no longer exists", () => {
  const p = tweaks("J2", { x: [1, 0, 10, 1] });
  p.fromJSON({ values: { x: 9, gone: 5 } });
  assert.equal(p.params.x, 9);
  assert.ok(!("gone" in p.params) || p.params.gone === undefined);
});

test("setMany applies a batch and notifies once", () => {
  const p = tweaks("M", { x: [1, 0, 10, 1], f: { y: [2, 0, 10, 1] } });
  let notifies = 0;
  p.on(() => notifies++);
  p.setMany({ x: 5, "f.y": 7 });
  assert.equal(p.params.x, 5);
  assert.equal(p.params.f.y, 7);
  assert.equal(notifies, 1);
});

test("gradient normalises its value: default pair, clamped positions, tuple stops", () => {
  const p = tweaks("G", {
    def: { type: "gradient" },
    tup: { type: "gradient", value: [["#ff0000", -0.5], ["#0000ff", 2]] },
  });
  assert.equal(p.params.def.stops.length, 2);
  assert.ok(typeof p.params.def.interpolation === "string");
  const pos = p.params.tup.stops.map((s) => s.pos);
  assert.deepEqual(pos, [0, 1]); // out-of-range positions clamp into [0,1]
});
