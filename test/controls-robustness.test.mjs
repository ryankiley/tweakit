/* Monitor and plot edge inputs: a monitor with nothing to read, a decimals setting past
 * what toFixed accepts, an Infinity sample, and a plot whose expression doesn't parse. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, tick, key } from "./_helpers.mjs";

const { tweaks } = await loadSingle();

test("a monitor with no get and no value reads as a dash, not 'undefined'", async () => {
  const p = tweaks("M", { m: { type: "monitor", interval: 30 } });
  document.body.append(p.el);
  try {
    await tick(80);
    assert.equal(p.el.querySelector(".tw-fps-val").textContent, "—");
  } finally { p.destroy(); }
});

test("decimals past toFixed's limit don't throw on every tick", async () => {
  const errors = [];
  const onError = (e) => errors.push(String(e.error || e.message));
  window.addEventListener("error", onError);
  const p = tweaks("M", { m: { type: "monitor", get: () => 1.5, decimals: 500, view: "text", interval: 30 } });
  document.body.append(p.el);
  try {
    await tick(80);
    assert.deepEqual(errors, []);
    assert.equal(p.el.querySelector(".tw-fps-val").textContent, "1.5" + "0".repeat(19));
  } finally { window.removeEventListener("error", onError); p.destroy(); }
});

test("an Infinity sample shows in the readout and leaves the graph's range alone", async () => {
  let n = 0;
  const p = tweaks("M", { m: { type: "monitor", get: () => (n++ === 1 ? Infinity : 2), interval: 30 } });
  document.body.append(p.el);
  try {
    await tick(130);
    const text = p.el.querySelector(".tw-fps-val").textContent;
    assert.ok(text === "2" || text === "Infinity", `readout was ${text}`);
  } finally { p.destroy(); }
});

test("a plot expression that doesn't parse flags aria-invalid on its input", async () => {
  const p = tweaks("P", { f: { type: "plot", expr: "sin(x)" } });
  document.body.append(p.el);
  try {
    await p.ready;
    const input = p.el.querySelector(".tw-plot-input");
    assert.equal(input.getAttribute("aria-invalid"), "false");
    p.set("f", "sin(");
    assert.equal(input.getAttribute("aria-invalid"), "true");
  } finally { p.destroy(); }
});

test("option controls ignore a set() value that matches no option", () => {
  const p = tweaks("O", { l: ["a", "b"], r: { type: "radiogrid", options: ["x", "y"] }, s: { type: "segmented", options: ["low", "high"] } });
  p.set("l", -Infinity); p.set("r", { stiffness: NaN }); p.set("s", NaN);
  assert.equal(p.params.l, "a"); assert.equal(p.params.r, "x"); assert.equal(p.params.s, "low");
  p.set("l", "b"); assert.equal(p.params.l, "b");
});

test("the image control ignores a non-string value and clears on null", () => {
  const p = tweaks("I", { i: { type: "image", value: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" } });
  p.set("i", new Date(0)); assert.equal(typeof p.params.i, "string");
  p.set("i", null); assert.equal(p.params.i, "");
});

test("a soft slider keeps a huge finite set() finite", () => {
  const p = tweaks("S", { x: { type: "slider", value: 2, min: 0, max: 10, step: 0.5, soft: true } });
  p.set("x", 1e308);
  assert.ok(Number.isFinite(p.params.x), `got ${p.params.x}`);
});

// ── Stress pass 10: the small degrades that read as bugs ──
const quiet = async (fn) => { const errors = []; const orig = console.error; console.error = (...a) => errors.push(a.join(" ")); try { return [await fn(), errors]; } finally { console.error = orig; } };

test("a malformed verbose control is skipped with a console error, not rendered as a folder", async () => {
  const [p, errors] = await quiet(() => tweaks("M", { pt: { type: "point", components: null }, t: { type: "tabs", pages: null }, e: { type: "tabs", pages: {} }, ok: 1 }));
  assert.deepEqual(Object.keys(p.params), ["ok"]);
  assert.equal(p.el.querySelector(".tw-folder, .tw-tabs"), null);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /malformed "point"/);
});

test("a tab titled '' still shows a tab; a point component without a key gets one", () => {
  const p = tweaks("K", { t: { type: "tabs", pages: { "": { a: 1 }, "  ": { b: 1 } } }, pt: { type: "point", components: [{ label: "X" }, {}, { label: "" }, { key: "x" }] } });
  assert.deepEqual([...p.el.querySelectorAll(".tw-tabs-tab")].map((t) => t.textContent), ["Tab", "Tab"]);
  assert.deepEqual(p.params.pt, { x: 0, c1: 0, c2: 0, "x-2": 0 }, "an empty label falls to the index; a label-derived key dedupes against an explicit one");
});

test("a folder with a child named `type` is still a folder; only a present-but-unusable form is skipped", async () => {
  const [p, errors] = await quiet(() => tweaks("F", { marker: { type: "point", size: 3 }, grid: { type: "list", rows: 2 }, bad: { type: "point", components: null } }));
  assert.deepEqual(p.params.marker, { type: "point", size: 3 });
  assert.deepEqual(p.params.grid, { type: "list", rows: 2 });
  assert.equal(p.el.querySelectorAll(".tw-folder").length, 2);
  assert.ok(!("bad" in p.params));
  assert.equal(errors.length, 1);
});

test("a circular object still renders rather than dropping the control", () => {
  const c = { a: 1 }; c.self = c;
  const p = tweaks("C", { t: { type: "text", value: c }, l: { type: "list", options: [c, "a"] } });
  assert.equal(p.el.querySelector(".tw-text").value, "[object Object]");
  assert.equal(p.el.querySelector(".tw-select-value").textContent, "[object Object]");
  assert.ok("t" in p.params && "l" in p.params);
});

test("a fine but representable step keeps its grid", () => {
  const p = tweaks("G", { s: [0, 0, 1000, 1e-13], iv: [[1, 2], 0, 1e18, 1] });
  p.set("s", 123.4567);
  assert.equal(p.params.s, 123.4567);
  assert.deepEqual(p.params.iv, [1, 2]);
});

test("odd values show as JSON, never 'undefined' or '[object Object]'", async () => {
  const p = tweaks("J", { l: [["1", "9"], "a"], t: { type: "text", value: { a: 1 } }, m: { type: "monitor", get: () => ({ a: 1 }), view: "text", interval: 30 }, g: { type: "buttongroup", buttons: [{ action() {} }] } });
  document.body.append(p.el);
  try {
    assert.equal(p.el.querySelector(".tw-select-value").textContent, '["1","9"]');
    assert.equal(p.el.querySelector(".tw-text").value, '{"a":1}');
    assert.equal(p.el.querySelector(".tw-buttongroup-btn").textContent, "Button");
    await tick(80);
    assert.equal(p.el.querySelector(".tw-fps-val").textContent, '{"a":1}');
  } finally { p.destroy(); }
});

test("a hint on a separator adds no marker to the divider", () => {
  const p = tweaks("H", { s: { type: "separator", hint: "x" } });
  assert.equal(p.el.querySelector(".tw-separator .tw-hint"), null);
});

test("a markup bound that isn't a number counts as absent", async () => {
  const { enhance } = await loadSingle();
  const host = document.createElement("div"); host.dataset.tw = "interval"; host.dataset.value = "8,2"; host.dataset.min = "abc";
  document.body.append(host);
  try {
    await enhance(host);
    assert.deepEqual(host._tw.ctrl.get(), [2, 8]);
  } finally { host.remove(); }
});

test("a default gradient blends in oklch, the space new stops are interpolated in", () => {
  const p = tweaks("G", { g: { type: "gradient" }, h: { type: "gradient", value: [["#000", 0], ["#fff", 1]] } });
  assert.equal(p.params.g.interpolation, "oklch");
  assert.equal(p.params.h.interpolation, "oklch");
});

test("a step the range can't count in falls back to a sane grid", () => {
  const p = tweaks("T", { s: [5, 0, 10, 1e-120], iv: [[2, 8], 0, 10, 5e-324] });
  assert.ok(p.el.querySelector(".tw-slider-value").textContent.length < 25, "no hundred-digit readout");
  assert.deepEqual(p.params.iv, [2, 8]);
  for (const h of p.el.querySelectorAll(".tw-interval .tw-slider-handle")) assert.doesNotMatch(h.style.left, /NaN/);
});

test("an image with options is a gallery: tiles pick, Remove clears, an off-list value shows as a last tile", () => {
  const p = tweaks("I", { pic: { type: "image", options: ["/a.png", { value: "/b.png", label: "Bee" }, 7, "", null], value: "/b.png" } });
  const root = p.el.querySelector(".tw-image-gallery"); assert.ok(root, "the gallery form");
  const tiles = () => [...root.querySelectorAll(".tw-image-tile")];
  assert.equal(tiles().length, 2, "a non-string and an empty option are skipped");
  assert.deepEqual(tiles().map((t) => t.getAttribute("aria-label")), ["a", "Bee"], "a label, else the URL's file stem");
  assert.deepEqual(tiles().map((t) => t.getAttribute("aria-checked")), ["false", "true"]);
  const remove = root.querySelector(".tw-image-remove");
  assert.equal(remove.hidden, false);
  tiles()[0].click(); assert.equal(p.params.pic, "/a.png");
  remove.click(); assert.equal(p.params.pic, ""); assert.equal(remove.hidden, true, "nothing to remove, no button");
  assert.deepEqual(tiles().map((t) => t.getAttribute("aria-checked")), ["false", "false"]);
  p.set("pic", "data:image/gif;base64,R0lGODlhAQABAAAAACw=");
  assert.equal(tiles().length, 3, "an off-list value is a third, selected tile");
  assert.equal(tiles()[2].getAttribute("aria-checked"), "true");
  assert.equal(tiles()[2].getAttribute("data-value"), null, "a data URL is not copied into an attribute");
  assert.equal(remove.hidden, false);
  p.set("pic", "/a.png"); assert.equal(tiles().length, 2, "back on the list, the extra tile leaves");
  p.set("pic", new Date(0)); assert.equal(p.params.pic, "/a.png", "a non-string is ignored");
  p.set("pic", null); assert.equal(p.params.pic, "");
});

test("the gallery's tiles are one radio group: arrows move and pick, Delete clears", () => {
  const p = tweaks("I", { pic: { type: "image", options: ["/a.png", "/b.png", "/c.png"], value: "/a.png" } });
  document.body.append(p.el);
  const tiles = [...p.el.querySelectorAll(".tw-image-tile")];
  assert.deepEqual(tiles.map((t) => t.tabIndex), [0, -1, -1], "the chosen tile is the tab stop");
  assert.equal(p.el.querySelector(".tw-image-grid").style.getPropertyValue("--tw-img-cols"), "3");
  tiles[0].focus(); key(tiles[0], { key: "ArrowRight" });
  assert.equal(p.params.pic, "/b.png"); assert.equal(document.activeElement, tiles[1]);
  key(tiles[1], { key: "End" }); assert.equal(p.params.pic, "/c.png");
  key(tiles[2], { key: "Delete" }); assert.equal(p.params.pic, "");
  assert.deepEqual(tiles.map((t) => t.tabIndex), [0, -1, -1], "with nothing chosen the first tile is the tab stop");
  p.destroy();
});

test("an upload over maxSize, or not an image, is refused with a note; a fitting one lands as a data URL", async () => {
  globalThis.FileReader ??= window.FileReader; // the kit reads files through the page's FileReader; jsdom's is on window only
  const p = tweaks("I", { pic: { type: "image", options: ["/a.png"], maxSize: 2048 } });
  const upload = p.el.querySelector(".tw-image-upload"), note = p.el.querySelector(".tw-image-note");
  const drop = (file) => { const e = new Event("drop", { bubbles: true, cancelable: true }); e.dataTransfer = { files: [file] }; upload.dispatchEvent(e); };
  drop(new window.File(["x".repeat(3000)], "big.png", { type: "image/png" }));
  assert.equal(note.textContent, "3 KB, max 2 KB"); assert.equal(p.params.pic, "");
  drop(new window.File(["hello"], "a.txt", { type: "text/plain" }));
  assert.equal(note.textContent, "Not an image");
  drop(new window.File(["GIF89a"], "ok.gif", { type: "image/gif" }));
  await tick(30);
  assert.match(p.params.pic, /^data:image\/gif;base64,/);
  assert.equal(p.el.querySelector(".tw-image-custom").getAttribute("aria-checked"), "true", "the upload is the selected last tile");
});

test("upload: false leaves a gallery of tiles alone, with no button and no file input", () => {
  const p = tweaks("I", { pic: { type: "image", options: ["/a.png", "/b.png"], upload: false } });
  assert.equal(p.el.querySelector(".tw-image-upload"), null);
  assert.equal(p.el.querySelector(".tw-image-input"), null);
  assert.equal(p.el.querySelectorAll(".tw-image-tile").length, 2);
  assert.ok(p.el.querySelector(".tw-image-remove").hidden, "no value, no Remove");
  assert.equal(p.params.pic, "", "no value until a tile is picked");
});
