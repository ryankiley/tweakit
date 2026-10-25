/* State machinery — the subsystems with the most intricate logic and (previously)
 * no coverage: persistence + presets, undo/redo, toJSON/fromJSON (including the
 * JSON-pointer path escaping), setMany batching, and the gradient's value
 * normalisation. Runs against the built single-file bundle under jsdom, like
 * panel.test.mjs. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { window } from "./_setup-dom.mjs";
import { loadSingle, tick } from "./_helpers.mjs";

const { tweaks } = await loadSingle();

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

test("a restore reads only a snapshot's own keys: a control named for an Object.prototype member is left alone", () => {
  // Regression: applySnapshot's path reader followed inherited keys, so a control keyed toString / valueOf /
  // hasOwnProperty read the prototype's function out of any snapshot that lacked the key — a fromJSON({ values }) from
  // before the key existed, an older preset — and logged a spurious "restoring … failed". (clip.ts's reader had the
  // own-key guard; the panel's did not.)
  const errors = [], orig = console.error; console.error = (...a) => errors.push(a.join(" "));
  try {
    const p = tweaks("OK", { toString: [5, 0, 10, 1], valueOf: "hi", hasOwnProperty: true, blur: [3, 0, 10, 1] });
    p.fromJSON({ values: { blur: 7 } });
    assert.deepEqual([p.params.toString, p.params.valueOf, p.params.hasOwnProperty, p.params.blur], [5, "hi", true, 7]);
    assert.deepEqual(errors, [], "no restore error for the keys the snapshot lacks");
  } finally { console.error = orig; }
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

test("a persist write storage refuses is retried without the image values, so the rest still saves", async () => {
  const big = "data:image/gif;base64," + "A".repeat(4096);
  const setItem = window.Storage.prototype.setItem; // the instance can't be patched: Storage's named setter would store the function as a key
  let refusals = 0;
  window.Storage.prototype.setItem = function (k, v) { if (String(v).includes(big)) { refusals++; throw new DOMException("quota", "QuotaExceededError"); } return setItem.call(this, k, v); };
  const warn = console.warn, warned = []; console.warn = (...a) => warned.push(a.join(" "));
  try {
    const p = tweaks("P", { x: [1, 0, 10, 1], im: { type: "image" } }, { persist: "t-quota" });
    p.set("x", 7); p.set("im", big);
    await tick(250);
    const stored = JSON.parse(localStorage.getItem("tw:t-quota"));
    assert.equal(stored.x, 7, "the slider value was saved");
    assert.equal("im" in stored, false, "the image that didn't fit was left out");
    assert.equal(warned.length, 1, "and the host was told once");
    assert.equal(p.el.querySelector(".tw-image-note").textContent, "Too big to save", "and the person, on the image's row");
    assert.equal(refusals, 1);
    p.set("x", 8); await tick(250);
    assert.equal(JSON.parse(localStorage.getItem("tw:t-quota")).x, 8);
    assert.equal(warned.length, 1, "told once, not on every save");
    assert.equal(refusals, 1, "a value storage refused is not offered again until it changes");
    p.set("im", big + "B"); await tick(250);
    assert.equal(refusals, 2, "a new image value is tried once more");
    assert.equal(p.savePreset("big"), false, "a preset carries its image whole, so storage refuses it and the call says so");
    assert.equal(localStorage.getItem("tw:t-quota:presets"), null, "nothing claimed to be stored");
    assert.equal(warned.length, 2, "and the host was told which preset");
    p.destroy();
  } finally { window.Storage.prototype.setItem = setItem; console.warn = warn; }
});

test("only an image storage left out says so on its row: not an empty one, and none when storage is off", async () => {
  const big = "data:image/gif;base64," + "A".repeat(4096);
  const setItem = window.Storage.prototype.setItem;
  let off = false;
  window.Storage.prototype.setItem = function (k, v) { if (off || String(v).includes(big)) throw new DOMException("quota", "QuotaExceededError"); return setItem.call(this, k, v); };
  const warn = console.warn; console.warn = () => {};
  try {
    const p = tweaks("N", { x: [1, 0, 10, 1], im: { type: "image" }, empty: { type: "image" } }, { persist: "t-note" });
    const [im, empty] = p.el.querySelectorAll(".tw-image-note");
    p.set("im", big); await tick(250);
    assert.equal(im.textContent, "Too big to save");
    assert.equal(empty.textContent, "", "an empty image row has nothing that went unsaved");
    im.textContent = ""; off = true; p.set("im", big + "B"); await tick(250);
    assert.equal(im.textContent, "", "refused without the image too: no note");
    const q = tweaks("M", { x: [1, 0, 10, 1], im: { type: "image", value: "/a.png" } }, { persist: "t-note-off" });
    q.set("x", 2); await tick(250);
    assert.equal(q.el.querySelector(".tw-image-note").textContent, "", "storage is off: the image isn't to blame");
    p.destroy(); q.destroy();
  } finally { window.Storage.prototype.setItem = setItem; console.warn = warn; }
});

// Each undo step was a deep clone of every value, so after an upload every later step held its own copy of it: a 4 MB image
// and 20 slider edits grew the heap by ~80 MB, and history keeps 200 steps. A step now shares what didn't change with the one before.
test("undo history keeps one copy of an unchanged big value, not one per step", () => {
  const SETUP = new URL("./_setup-dom.mjs", import.meta.url).href, BUNDLE = new URL("../dist/tweaks.js", import.meta.url).href;
  const r = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", `
    await import(${JSON.stringify(SETUP)});
    const { tweaks } = await import(${JSON.stringify(BUNDLE)});
    const p = tweaks("U", { x: [0, 0, 100, 1], pic: { type: "image" } }, { undo: true });
    await p.ready;
    const big = "data:image/png;base64," + "A".repeat(4 << 20);
    p.set("pic", big); p.undo(); p.redo(); // undo() flushes the pending step first, so the upload is one step
    gc(); const before = process.memoryUsage().heapUsed;
    for (let i = 1; i <= 20; i++) { p.set("x", i); p.undo(); p.redo(); }
    gc(); const grew = process.memoryUsage().heapUsed - before;
    if (p.params.x !== 20 || p.params.pic !== big) throw new Error("redo lost a value");
    p.undo(); if (p.params.x !== 19 || p.params.pic !== big) throw new Error("undo lost a value");
    for (let i = 0; i < 19; i++) p.undo();
    if (p.params.x !== 0 || p.params.pic !== big) throw new Error("undo to the upload step lost it");
    p.undo(); if (p.params.pic !== "") throw new Error("undo past the upload kept it");
    console.log(Math.round(grew / (1 << 20)));
  `], { timeout: 30000, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const mb = +r.stdout.trim();
  assert.ok(mb < 16, `20 edits after a 4 MB upload grew the heap by ${mb} MB`);
});
