/* Panel options a host reaches for once a panel is part of an app: a write that doesn't
 * echo to on() ({ silent }), saving values without the Presets menu (presets: false), and
 * a control left out of the saved session (persist: false). Runs against the built
 * single-file bundle under jsdom. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));
const stored = (k) => JSON.parse(localStorage.getItem(k));

test("a silent set, setMany or fromJSON skips on() but still runs conditionals, persistence and undo", async () => {
  localStorage.clear();
  const p = tweaks("Silent", { live: true, time: { type: "slider", value: 450, min: 300, max: 1725, step: 15, render: (get) => !get("live") }, zoom: [100, 25, 300, 1] }, { persist: true, undo: true });
  let calls = 0; p.on(() => { calls++; });
  p.set("live", false, { silent: true });
  assert.ok(!p.el.querySelector(".tw-slider-wrap").classList.contains("tw-cond-hidden"), "the conditional still follows");
  p.setMany({ time: 600 }, { silent: true });
  p.fromJSON({ values: { zoom: 90 } }, { silent: true });
  assert.equal(calls, 0, "no echo");
  await new Promise((r) => setTimeout(r, 200)); // past the persist debounce
  assert.equal(stored("tw:Silent").zoom, 90, "still saved");
  p.undo(); // flushes the pending history step the silent writes made
  assert.equal(p.params.zoom, 100, "silent writes are in the undo history");
  p.destroy(); localStorage.clear();
});

test("a silent write made inside on() doesn't change the key the other listeners hear", () => {
  const p = tweaks("Last", { a: [0, 0, 10, 1], b: [0, 0, 10, 1] });
  p.on((v, last) => { if (last === "a") p.set("b", v.a, { silent: true }); });
  const heard = []; p.on((v, last) => heard.push(last));
  p.set("a", 7);
  assert.deepEqual([heard, p.params.b], [["a"], 7]);
  p.destroy();
});

test("presets: false keeps persistence without the Presets menu", () => {
  localStorage.clear();
  const p = tweaks("NoPresets", { blur: [24, 0, 100, 1] }, { persist: true, presets: false });
  assert.equal(p.el.querySelector('[aria-label="Presets"]'), null, "no menu");
  assert.equal(p.savePreset("a"), true, "the presets API still works");
  p.set("blur", 40); p.destroy(); // destroy() flushes the pending save
  assert.equal(stored("tw:NoPresets").blur, 40, "values still saved");
  localStorage.clear();
});

test("persist: false keeps a control out of what is saved and what is restored", () => {
  localStorage.clear();
  localStorage.setItem("tw:Session", JSON.stringify({ media: true, name: "Ana", look: { media2: true } }));
  const off = { type: "checkbox", value: false, persist: false };
  const p = tweaks("Session", { media: off, name: "Maya", look: { media2: off }, fx: { glow: { on: off } } }, { persist: true }); // fx: a folder the stored session predates
  assert.deepEqual([p.params.media, p.params.look.media2, p.params.name], [false, false, "Ana"], "stored values for it don't come back; the rest do");
  p.setMany({ media: true, name: "Bo", "look.media2": true });
  assert.equal(p.toJSON().values.media, true, "toJSON still carries it");
  p.destroy();
  assert.deepEqual(stored("tw:Session"), { name: "Bo", look: {}, fx: { glow: {} } }, "not saved, nested either");
  localStorage.clear();
});

test("a stored value that can't drop a persist: false key doesn't break the build", () => {
  localStorage.setItem("tw:Odd", JSON.stringify({ F: [true] })); // a hand-edited store: the folder saved as an array, whose length can't be deleted
  let p; assert.doesNotThrow(() => { p = tweaks("Odd", { F: { length: { type: "checkbox", value: false, persist: false } } }, { persist: true }); });
  p.destroy(); localStorage.clear();
});

test("a plain folder object's persist is its child, not an option", () => {
  const p = tweaks("Child", { group: { persist: false, size: [2, 0, 4, 1] } });
  assert.equal(p.params.group.persist, false, "built as a checkbox, as before");
  p.destroy();
});
