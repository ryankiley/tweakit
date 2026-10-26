/* State machinery — the subsystems with the most intricate logic and (previously)
 * no coverage: persistence + presets, undo/redo, toJSON/fromJSON (including the
 * JSON-pointer path escaping), setMany batching, and the gradient's value
 * normalization. Runs against the built single-file bundle under jsdom, like
 * panel.test.mjs. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { window } from "./_setup-dom.mjs";
import { indexedDB as fakeIDB, IDBKeyRange as FakeKeyRange } from "fake-indexeddb";
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

test("gradient normalizes its value: default pair, clamped positions, tuple stops", () => {
  const p = tweaks("G", {
    def: { type: "gradient" },
    tup: { type: "gradient", value: [["#ff0000", -0.5], ["#0000ff", 2]] },
  });
  assert.equal(p.params.def.stops.length, 2);
  assert.ok(typeof p.params.def.interpolation === "string");
  const pos = p.params.tup.stops.map((s) => s.pos);
  assert.deepEqual(pos, [0, 1]); // out-of-range positions clamp into [0,1]
});

// IndexedDB in memory (on globalThis, where the bundle looks): an uploaded image persists there, and storage holds its ref.
Object.assign(globalThis, { indexedDB: fakeIDB, IDBKeyRange: FakeKeyRange });
const records = () => new Promise((done) => { const r = indexedDB.open("tweakit", 1); r.onsuccess = () => { const keys = r.result.transaction("images").objectStore("images").getAllKeys(); keys.onsuccess = () => { r.result.close(); done(keys.result); }; }; });

test("an uploaded image persists through IndexedDB: storage holds its ref, and the next panel has the image by ready", async () => {
  const big = "data:image/gif;base64," + "A".repeat(4096);
  const p = tweaks("P", { x: [1, 0, 10, 1], im: { type: "image" } }, { persist: "t-idb" });
  await p.ready;
  p.set("x", 7); p.set("im", big);
  await tick(250);
  const stored = JSON.parse(localStorage.getItem("tw:t-idb"));
  assert.equal(stored.x, 7);
  assert.match(stored.im, /^tw-image:\w+$/, "storage holds a short ref, not the data URL");
  assert.equal((await records()).filter(([k]) => k === "tw:t-idb").length, 1, "and IndexedDB the image, once");
  p.destroy();
  const q = tweaks("P", { x: [1, 0, 10, 1], im: { type: "image" } }, { persist: "t-idb" });
  await q.ready;
  assert.equal(q.params.im, big, "the image is back by ready");
  assert.equal(q.params.x, 7);
  q.destroy();
});

test("presets carry images by ref, and a record nothing names any more is pruned", async () => {
  const one = "data:image/gif;base64," + "A".repeat(2048), two = "data:image/gif;base64," + "B".repeat(2048);
  const ours = async () => (await records()).filter(([k]) => k === "tw:t-idb-pre");
  const p = tweaks("Pre", { im: { type: "image" } }, { persist: "t-idb-pre" });
  await p.ready;
  p.set("im", one); await tick(250);
  assert.equal(p.savePreset("first"), true);
  assert.match(JSON.parse(localStorage.getItem("tw:t-idb-pre:presets")).first.im, /^tw-image:/, "the preset holds the ref");
  p.set("im", two); await tick(250);
  assert.equal((await ours()).length, 2, "the preset still names the first image, so both are kept");
  p.loadPreset("first");
  assert.equal(p.params.im, one, "and loading it brings the image back");
  p.set("im", two); await tick(250);
  p.deletePreset("first"); await tick(50);
  assert.equal((await ours()).length, 1, "deleting the preset prunes the image only it named");
  p.destroy();
});

test("a ref whose record is gone leaves the image at its schema value", async () => {
  localStorage.setItem("tw:t-idb-gone", JSON.stringify({ x: 3, im: "tw-image:nothing" }));
  const p = tweaks("Gone", { x: [1, 0, 10, 1], im: { type: "image", value: "/a.png" } }, { persist: "t-idb-gone" });
  await p.ready;
  assert.equal(p.params.im, "/a.png");
  assert.equal(p.params.x, 3, "the other values still restore");
  p.destroy();
});

// Two tabs on one key: the tab without the upload saved, pruned the record it had never seen, and the tab that saved last
// with the image still held its ref, so the reload came back empty.
test("a save prunes only the records its own panel knows, so another tab's upload survives it", async () => {
  const S = { x: [1, 0, 10, 1], im: { type: "image" } }, img = "data:image/gif;base64," + "C".repeat(2048);
  const a = tweaks("Tabs", S, { persist: "t-idb-tabs" }), b = tweaks("Tabs", S, { persist: "t-idb-tabs" });
  await Promise.all([a.ready, b.ready]);
  a.set("im", img); await tick(250);
  b.set("x", 5); await tick(250);
  a.set("x", 9); await tick(250);
  a.destroy(); b.destroy();
  const c = tweaks("Tabs", S, { persist: "t-idb-tabs" });
  await c.ready;
  assert.equal(c.params.im, img, "the last save named the image, so it comes back");
  c.destroy();
});

// A persisted image made the panel wait for IndexedDB before building, so on the single build every value read undefined
// until ready, not only the image.
test("a persisted image doesn't hold up the rest: the single build restores every other value at once", async () => {
  const S = { x: [1, 0, 10, 1], im: { type: "image" } }, img = "data:image/gif;base64," + "D".repeat(2048);
  const a = tweaks("Sync", S, { persist: "t-idb-sync", undo: true });
  await a.ready;
  a.setMany({ x: 7, im: img }); await tick(250);
  a.destroy();
  const b = tweaks("Sync", S, { persist: "t-idb-sync", undo: true }), heard = [];
  b.on((p, k) => heard.push([p.im === img, k]));
  assert.equal(b.params.x, 7, "restored as the panel builds");
  assert.equal(b.params.im, "", "the image waits for the store");
  b.set("x", 8); await tick(250); // a save while the store loads keeps the stored image
  assert.match(JSON.parse(localStorage.getItem("tw:t-idb-sync")).im, /^tw-image:/);
  await b.ready;
  assert.equal(b.params.im, img, "and is in by ready");
  assert.deepEqual(heard.at(-1), [true, undefined], "listeners hear it arrive");
  b.undo(); await tick(50);
  assert.equal(b.params.im, img, "its arrival isn't an undo step");
  b.destroy();
});

test("an image the person replaced while the store loaded isn't overwritten by the stored one", async () => {
  const S = { im: { type: "image" } }, one = "data:image/gif;base64," + "E".repeat(2048);
  const a = tweaks("Mine", S, { persist: "t-idb-mine" }); await a.ready; a.set("im", one); await tick(250); a.destroy();
  const b = tweaks("Mine", S, { persist: "t-idb-mine" });
  b.set("im", "/picked.png");
  await b.ready;
  assert.equal(b.params.im, "/picked.png");
  b.destroy();
});

// The record write ran in the background and its failure was ignored: storage named an image IndexedDB never took.
test("an image IndexedDB refuses is left out of the save, and its row says so", async () => {
  const { IDBObjectStore } = await import("fake-indexeddb"), put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { throw new DOMException("full", "QuotaExceededError"); };
  try {
    const p = tweaks("Full", { x: [1, 0, 10, 1], im: { type: "image" } }, { persist: "t-idb-full" });
    await p.ready;
    p.setMany({ x: 4, im: "data:image/gif;base64," + "F".repeat(2048) }); await tick(250);
    await tick(250); // the refused write, then the save that leaves it out
    assert.deepEqual(JSON.parse(localStorage.getItem("tw:t-idb-full")), { x: 4 });
    assert.equal(p.el.querySelector(".tw-image-note").textContent, "Not saved");
    p.destroy();
  } finally { IDBObjectStore.prototype.put = put; }
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

// parseColor reads junk as black, so a stale or hand-edited stored color loaded as oklch(0% 0 0) instead of the schema's.
test("a stored color that isn't one falls back to the schema's, as a stale list option does", async () => {
  const warn = console.warn, warned = []; console.warn = (...a) => warned.push(a.join(" "));
  try {
    localStorage.setItem("tw:t-badcolor", JSON.stringify({ a: "not a color", b: "rgb(nope)", c: "#zzzzzz", d: "oklch(50% 0.1 200)" }));
    const p = tweaks("Bad", { a: "#ff0000", b: "#00ff00", c: "#0000ff", d: "#000000" }, { persist: "t-badcolor" });
    await p.ready;
    const before = { ...p.params };
    assert.equal(before.d, "oklch(50% 0.10 200)", "a real stored color still restores");
    const fresh = tweaks("Fresh", { a: "#ff0000", b: "#00ff00", c: "#0000ff" }); await fresh.ready;
    for (const k of ["a", "b", "c"]) assert.equal(before[k], fresh.params[k], `${k} keeps its schema color`);
    p.set("a", "nope nope"); assert.equal(p.params.a, before.a, "set() with junk keeps the color too");
    assert.ok(warned.some((w) => /isn't a color/.test(w)), "and says so");
    p.destroy(); fresh.destroy();
  } finally { console.warn = warn; localStorage.removeItem("tw:t-badcolor"); }
});
