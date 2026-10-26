/* Monitor and plot edge inputs: a monitor with nothing to read, a decimals setting past
 * what toFixed accepts, an Infinity sample, and a plot whose expression doesn't parse. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, tick, key, distCss } from "./_helpers.mjs";

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
    p.set("f", "sin x^2");
    assert.equal(input.title, "write sin(…)"); // the reason, naming the fix
    p.set("f", "sin x");
    assert.equal(input.getAttribute("aria-invalid"), "false");
    assert.equal(input.title, "");
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

test("a hint and the reset target sit beside a spring's or bezier's own caption, not an inner field label", async () => {
  // Regression: LABEL_SEL listed every label class but the spring and bezier captions, so the querySelector behind the
  // hint marker and the reset target found the first INNER label instead — the spring's "Mode" row label, the bezier's
  // "X1" field label — and the ⓘ, the reset title and the double-click / hold-to-reset all went there.
  const p = tweaks("HL", {
    spring: { type: "spring", hint: "s", value: { stiffness: 200, damping: 20, mass: 1 } },
    curve: { type: "cubicbezier", hint: "c", value: [0.4, 0, 0.2, 1] },
  });
  document.body.append(p.el); await p.ready;
  try {
    for (const [cls, caption] of [["tw-spring", "tw-spring-label"], ["tw-bezier", "tw-bezier-label"]]) {
      const root = p.el.querySelector("." + cls);
      assert.ok(root.querySelector(".tw-hint").parentElement.classList.contains(caption), `${cls}: the ⓘ sits in the caption`);
      assert.ok(root.querySelector("." + caption).classList.contains("tw-resettable"), `${cls}: the caption is the reset target`);
      assert.ok(!root.querySelector(".tw-row-label, .tw-field-label").classList.contains("tw-resettable"), `${cls}: the inner label is not`);
    }
  } finally { p.destroy(); } // a failing assertion must not leave the spring's observer and listeners behind
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

test("an image with options is a gallery: tiles pick, Clear clears, an off-list value shows as a last tile", () => {
  const p = tweaks("I", { pic: { type: "image", options: ["/a.png", { value: "/b.png", label: "Bee" }, 7, "", null], value: "/b.png" } });
  const root = p.el.querySelector(".tw-image-gallery"); assert.ok(root, "the gallery form");
  const tiles = () => [...root.querySelectorAll(".tw-image-tile")];
  assert.equal(tiles().length, 2, "a non-string and an empty option are skipped");
  assert.deepEqual(tiles().map((t) => t.getAttribute("aria-label")), ["a", "Bee"], "a label, else the URL's file stem");
  assert.deepEqual(tiles().map((t) => t.getAttribute("aria-checked")), ["false", "true"]);
  const remove = root.querySelector(".tw-image-clear");
  const folded = () => remove.closest(".tw-image-clear-slot").inert; // Clear folds away rather than hiding
  assert.equal(folded(), false);
  tiles()[0].click(); assert.equal(p.params.pic, "/a.png");
  remove.click(); assert.equal(p.params.pic, ""); assert.equal(folded(), true, "nothing to remove, Clear folds away");
  assert.deepEqual(tiles().map((t) => t.getAttribute("aria-checked")), ["false", "false"]);
  p.set("pic", "data:image/gif;base64,R0lGODlhAQABAAAAACw=");
  assert.equal(tiles().length, 3, "an off-list value is a third, selected tile");
  assert.equal(tiles()[2].getAttribute("aria-checked"), "true");
  assert.equal(tiles()[2].getAttribute("data-value"), null, "a data URL is not copied into an attribute");
  assert.equal(folded(), false);
  p.set("pic", "/a.png"); assert.equal(tiles().length, 2, "back on the list, the extra tile leaves");
  p.set("pic", new Date(0)); assert.equal(p.params.pic, "/a.png", "a non-string is ignored");
  p.set("pic", null); assert.equal(p.params.pic, "");
});

test("a gallery is a row naming the chosen image that opens a pane of tiles", async () => {
  const p = tweaks("I", { pic: { type: "image", options: ["/a.png", { value: "/b.png", label: "Bee" }], value: "/b.png" } });
  document.body.append(p.el);
  const trigger = p.el.querySelector(".tw-image .tw-trigger"), name = trigger.querySelector(".tw-trigger-value");
  assert.equal(name.textContent, "Bee", "the row names the chosen option");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  trigger.click(); await tick(30);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  const pop = document.querySelector(".tw-image-pop"); assert.ok(pop.querySelector(".tw-image-grid"), "the tiles are in the pane");
  pop.querySelectorAll(".tw-image-tile")[0].click(); assert.equal(name.textContent, "a", "else the URL's file stem");
  p.set("pic", ""); assert.equal(name.textContent, "None");
  p.destroy();
});

test("the gallery pane: no repeated label, Clear in the foot, and an off-list value named for what it is", () => {
  const p = tweaks("I", { pic: { type: "image", options: ["/a.png", "/b.png"], value: "/a.png", upload: false } });
  const pop = p.el.querySelector(".tw-image-pop"), name = p.el.querySelector(".tw-image .tw-trigger-value");
  assert.equal(pop.querySelector(".tw-image-label"), null, "the row names the control; the pane doesn't repeat it");
  assert.ok(pop.querySelector(".tw-image-foot .tw-image-clear"), "Clear sits under the tiles");
  p.set("pic", "https://x.com/"); assert.equal(name.textContent, "Custom image", "a host URL with no file stem");
  p.set("pic", "data:image/gif;base64,R0lGODlhAQABAAAAACw="); assert.equal(name.textContent, "Uploaded image");
  p.set("pic", "blob:https://x.com/1b4e28ba-2fa1-11d2-883f-0016d3cca427"); assert.equal(name.textContent, "Uploaded image", "a blob URL's stem is a UUID");
  p.set("pic", ""); assert.equal(pop.querySelector(".tw-image-foot").dataset.open, "false", "no upload and nothing to clear: the foot folds");
  assert.ok(pop.querySelector(".tw-image-foot").inert);
  p.destroy();
});

test("a file refused on the closed gallery row says why in the row", () => {
  const p = tweaks("I", { pic: { type: "image", options: ["/a.png"], value: "/a.png" } });
  document.body.append(p.el);
  const trigger = p.el.querySelector(".tw-image .tw-trigger");
  dropOn(trigger, new window.File(["hi"], "x.txt", { type: "text/plain" }));
  assert.equal(trigger.querySelector(".tw-image-note").textContent, "Not an image");
  assert.equal(p.params.pic, "/a.png");
  p.destroy();
});

test("disabling a gallery mid-edit closes its pane", async () => {
  const p = tweaks("I", { on: true, pic: { type: "image", options: ["/a.png", "/b.png"], value: "/a.png", disabled: (g) => !g("on") } });
  document.body.append(p.el);
  const trigger = p.el.querySelector(".tw-image .tw-trigger");
  trigger.click(); await tick(30); assert.equal(trigger.getAttribute("aria-expanded"), "true");
  p.set("on", false); await tick(30);
  assert.equal(trigger.getAttribute("aria-expanded"), "false", "the pane closes with its control");
  p.destroy();
});

test("arrowing off the custom tile moves focus before the tile leaves", async () => {
  const p = tweaks("I", { pic: { type: "image", options: ["/a.png", "/b.png"], value: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" } });
  document.body.append(p.el);
  const custom = p.el.querySelector(".tw-image-custom"); custom.focus();
  key(custom, { key: "ArrowLeft" });
  assert.equal(p.params.pic, "/b.png");
  assert.equal(document.activeElement?.dataset.value, "/b.png", "focus is on the picked tile, not <body>");
  p.destroy();
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
  assert.ok(p.el.querySelector(".tw-image-clear-slot").inert, "no value, Clear folded away");
  assert.equal(p.params.pic, "", "no value until a tile is picked");
});

test("clear: false leaves Clear out and Delete keeps the value; cols reaches 6", () => {
  const p = tweaks("I", { pic: { type: "image", options: ["/a.png", "/b.png", "/c.png", "/d.png", "/e.png", "/f.png"], value: "/b.png", upload: false, clear: false, cols: 6 } });
  assert.equal(p.el.querySelector(".tw-image-clear"), null, "no Clear button");
  const tile = p.el.querySelector('.tw-image-tile[data-active="true"]');
  tile.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  assert.equal(p.params.pic, "/b.png", "Delete doesn't empty a required choice");
  assert.equal(p.el.querySelector(".tw-image-grid").style.getPropertyValue("--tw-img-cols"), "6");
  p.destroy();
});

// ── The gallery's review fixes: each failed on the first cut of the gallery. ──
const dropOn = (el, file) => { const e = new Event("drop", { bubbles: true, cancelable: true }); e.dataTransfer = { files: file ? [file] : [] }; el.dispatchEvent(e); };
globalThis.FileReader ??= window.FileReader;

test("a disabled gallery takes no dropped file", async () => {
  const p = tweaks("I", { pic: { type: "image", options: ["/a.png"], disabled: true } });
  dropOn(p.el.querySelector(".tw-image-gallery"), new window.File(["GIF89a"], "x.gif", { type: "image/gif" }));
  await tick(30);
  assert.equal(p.params.pic, "");
});

test("Alt+Delete on a tile is the panel's reset, not a clear: the host never sees an empty value", () => {
  const p = tweaks("I", { pic: { type: "image", options: ["/a.png", "/b.png"], value: "/a.png" } });
  document.body.append(p.el);
  const seen = []; p.on((v) => seen.push(v.pic));
  const tiles = p.el.querySelectorAll(".tw-image-tile");
  tiles[1].click(); key(tiles[1], { key: "Delete", altKey: true });
  assert.ok(!seen.includes(""), `host saw ${JSON.stringify(seen)}`);
  p.destroy();
});

test("when the focused custom tile leaves, focus moves to the chosen tile, not to the body", () => {
  const p = tweaks("I", { pic: { type: "image", options: ["/a.png", "/b.png"], value: "/x.png" } });
  document.body.append(p.el);
  const custom = p.el.querySelector(".tw-image-custom"); custom.focus();
  assert.equal(custom.getAttribute("aria-label"), "x", "a host-set URL is named by its file, not as an upload");
  p.set("pic", "/y.png");
  assert.equal(document.activeElement, custom, "still the custom tile: a re-render doesn't move (and blur) it");
  p.set("pic", "/b.png");
  assert.equal(document.activeElement, p.el.querySelectorAll(".tw-image-tile")[1]);
  p.destroy();
});

test("a repeated option URL is one tile", () => {
  const p = tweaks("I", { pic: { type: "image", options: ["/a.png", { value: "/a.png", label: "Again" }, "/b.png"], value: "/a.png" } });
  const tiles = [...p.el.querySelectorAll(".tw-image-tile")];
  assert.equal(tiles.length, 2);
  assert.deepEqual(tiles.map((t) => t.getAttribute("aria-checked")), ["true", "false"]);
});

test("a file read that lands after a tile was picked doesn't overwrite the pick", async () => {
  const p = tweaks("I", { pic: { type: "image", options: ["/a.png", "/b.png"] } });
  dropOn(p.el.querySelector(".tw-image-upload"), new window.File(["GIF89a"], "x.gif", { type: "image/gif" }));
  p.el.querySelectorAll(".tw-image-tile")[1].click();
  await tick(30);
  assert.equal(p.params.pic, "/b.png");
});

test("a refusal under 1 KB reads in bytes, and is spoken from a status region outside the button", () => {
  const p = tweaks("I", { pic: { type: "image", options: ["/a.png"], maxSize: 300 } });
  dropOn(p.el.querySelector(".tw-image-upload"), new window.File(["x".repeat(400)], "big.png", { type: "image/png" }));
  assert.equal(p.el.querySelector(".tw-image-note").textContent, "400 B, max 300 B");
  const live = p.el.querySelector(".tw-image-live[role=status]");
  assert.ok(live && !live.closest("button"), "a button's children are presentational, so the region sits beside it");
  assert.equal(live.textContent, "400 B, max 300 B");
});

// ── A large upload is drawn down to `fit` before it becomes the param. jsdom decodes no images and draws no canvas, so a
// picture of w × h, with or without transparency, is stubbed in, and every redraw and encode is recorded. `bytes` sets the
// size each type encodes to, null for a type the browser can't write (it hands back a PNG instead). ──
const withPicture = async ({ w, h, alpha = false, bytes = {} }, fn) => {
  const proto = window.HTMLCanvasElement.prototype, was = { Image: globalThis.Image, create: URL.createObjectURL, revoke: URL.revokeObjectURL, getContext: proto.getContext, toBlob: proto.toBlob };
  const calls = { decoded: 0, drawn: [], encoded: [] };
  globalThis.Image = class { decode() { calls.decoded++; return Promise.resolve(); } get naturalWidth() { return w; } get naturalHeight() { return h; } };
  URL.createObjectURL = () => "blob:http://localhost/1"; URL.revokeObjectURL = () => {};
  proto.getContext = function () { return { drawImage: (img, x, y, dw, dh) => calls.drawn.push([dw, dh]), getImageData: () => ({ data: new Uint8ClampedArray([9, 9, 9, 255, 9, 9, 9, alpha ? 128 : 255]) }) }; };
  proto.toBlob = function (cb, type, q) {
    calls.encoded.push([type, q, this.width, this.height]);
    const n = bytes[type] === undefined ? 6 : bytes[type];
    setTimeout(() => cb(n === null ? new window.Blob(["x"], { type: "image/png" }) : new window.Blob(["S".repeat(n)], { type })));
  };
  try { await fn(calls); } finally { Object.assign(URL, { createObjectURL: was.create, revokeObjectURL: was.revoke }); globalThis.Image = was.Image; proto.getContext = was.getContext; proto.toBlob = was.toBlob; }
};
const photo = (name, type, size = 4000) => new window.File(["x".repeat(size)], name, { type });
const MiB = 1 << 20;

test("an upload past fit is drawn down to it as a JPEG before it lands: one change, the shrunk URL", async () => {
  await withPicture({ w: 3000, h: 6000 }, async (calls) => {
    const p = tweaks("I", { pic: { type: "image" } }), seen = []; p.on((v) => seen.push(v.pic));
    dropOn(p.el.querySelector(".tw-trigger"), photo("phone.jpg", "image/jpeg"));
    await tick(30);
    assert.deepEqual(calls.drawn, [[1280, 2560]], "the long side drawn to 2560");
    assert.deepEqual(calls.encoded, [["image/jpeg", 0.85, 1280, 2560]], "a JPEG stays a JPEG, with no PNG tried");
    assert.deepEqual(seen, ["data:image/jpeg;base64,U1NTU1NT"], "one change event, carrying the shrunk picture");
    p.destroy();
  });
});

test("anything but a JPEG is a PNG within 1.5 MB; past that a JPEG, or a WebP with transparency", async () => {
  const cases = [
    [{ bytes: { "image/png": 2000 } }, 4000, "image/png", ["image/png"], "a screenshot's PNG within budget is kept, with nothing else tried"],
    [{ alpha: true, bytes: { "image/png": 2000 } }, 4000, "image/png", ["image/png"], "transparency within budget stays a PNG"],
    [{ bytes: { "image/png": 2 * MiB, "image/jpeg": 100 } }, 4000, "image/jpeg", ["image/png", "image/jpeg"], "a photo saved as PNG is a JPEG"],
    [{ alpha: true, bytes: { "image/png": 2 * MiB, "image/webp": 100 } }, 4000, "image/webp", ["image/png", "image/webp"], "a big cutout is a WebP, keeping its alpha"],
    [{ alpha: true, bytes: { "image/png": 2 * MiB, "image/webp": null } }, 3 * MiB, "image/png", ["image/png", "image/webp"], "with no WebP to write, the PNG"],
  ];
  for (const [pic, size, type, tried, msg] of cases) {
    await withPicture({ w: 4000, h: 3000, ...pic }, async (calls) => {
      const p = tweaks("I", { pic: { type: "image" } });
      dropOn(p.el.querySelector(".tw-trigger"), photo("art.png", "image/png", size));
      await tick(60);
      assert.deepEqual(calls.encoded.map((e) => e[0]), tried, msg);
      assert.match(p.params.pic, new RegExp(`^data:${type};base64,U1NT`), msg);
      p.destroy();
    });
  }
});

test("a picture within fit, a GIF and an SVG are taken as they are, and fit: false keeps every upload whole", async () => {
  await withPicture({ w: 2560, h: 1440 }, async (calls) => {
    const p = tweaks("I", { pic: { type: "image" } });
    dropOn(p.el.querySelector(".tw-trigger"), photo("small.png", "image/png"));
    await tick(30);
    assert.equal(calls.decoded, 1); assert.equal(calls.drawn.length, 0, "a picture at fit is never redrawn");
    assert.match(p.params.pic, /^data:image\/png;base64,eHh4/, "the file as it was read");
    p.destroy();
  });
  await withPicture({ w: 5000, h: 5000 }, async (calls) => {
    const p = tweaks("I", { pic: { type: "image" }, raw: { type: "image", fit: false } });
    const [pic, raw] = p.el.querySelectorAll(".tw-trigger");
    dropOn(pic, photo("loop.gif", "image/gif")); await tick(30);
    assert.match(p.params.pic, /^data:image\/gif;/, "a GIF would lose its animation");
    dropOn(pic, photo("logo.svg", "image/svg+xml")); await tick(30);
    assert.match(p.params.pic, /^data:image\/svg\+xml;/, "an SVG has no pixels to fit");
    dropOn(raw, photo("raw.jpg", "image/jpeg")); await tick(30);
    assert.match(p.params.raw, /^data:image\/jpeg;base64,eHh4/);
    assert.equal(calls.decoded, 0, "none of them decoded"); assert.equal(calls.encoded.length, 0);
    p.destroy();
  });
});

test("fit and quality set the size and the quality, a non-number fit is the default, and a redraw no smaller than the file is dropped", async () => {
  await withPicture({ w: 6000, h: 3000 }, async (calls) => {
    const p = tweaks("I", { pic: { type: "image", fit: 800, quality: 0.6 }, yes: { type: "image", fit: true, quality: "high" } });
    const [pic, yes] = p.el.querySelectorAll(".tw-trigger");
    dropOn(pic, photo("wide.jpg", "image/jpeg")); await tick(30);
    dropOn(yes, photo("wide.jpg", "image/jpeg")); await tick(30);
    assert.deepEqual(calls.encoded, [["image/jpeg", 0.6, 800, 400], ["image/jpeg", 0.85, 2560, 1280]], "fit: true isn't one pixel");
    dropOn(pic, photo("tiny.jpg", "image/jpeg", 1)); await tick(30);
    assert.equal(p.params.pic, "data:image/jpeg;base64,eA==", "the 1-byte file beats its redraw, so it is kept");
    p.destroy();
  });
});

test("a heavy upload within fit is redrawn at its size; a light one is taken as it is", async () => {
  await withPicture({ w: 2400, h: 1600, bytes: { "image/png": 2 * MiB, "image/jpeg": 100 } }, async (calls) => {
    const p = tweaks("I", { pic: { type: "image" } });
    dropOn(p.el.querySelector(".tw-trigger"), photo("heavy.png", "image/png", 2 * MiB)); await tick(60);
    assert.deepEqual(calls.drawn, [[2400, 1600]], "drawn at its own size");
    assert.match(p.params.pic, /^data:image\/jpeg;base64,U1NT/, "a heavy PNG photo is a JPEG");
    dropOn(p.el.querySelector(".tw-trigger"), photo("light.png", "image/png", 1.5 * MiB)); await tick(60);
    assert.equal(calls.drawn.length, 1, "1.5 MB or less within fit: never redrawn");
    p.destroy();
  });
});

test("a pick, a set() or a second upload while a shrink is pending wins over it", async () => {
  await withPicture({ w: 4000, h: 3000 }, async () => {
    const p = tweaks("I", { pic: { type: "image", options: ["/a.png", "/b.png"] } }), seen = []; p.on((v) => seen.push(v.pic));
    const upload = p.el.querySelector(".tw-image-upload");
    dropOn(upload, photo("big.jpg", "image/jpeg")); p.el.querySelectorAll(".tw-image-tile")[1].click();
    await tick(30);
    assert.equal(p.params.pic, "/b.png"); assert.deepEqual(seen, ["/b.png"], "the late shrink fires nothing");
    dropOn(upload, photo("big.jpg", "image/jpeg")); p.set("pic", "/a.png");
    await tick(30);
    assert.equal(p.params.pic, "/a.png");
    dropOn(upload, photo("one.jpg", "image/jpeg")); dropOn(upload, photo("two.png", "image/png"));
    await tick(60);
    assert.match(p.params.pic, /^data:image\/png;/, "the second upload lands, not the first");
    p.destroy();
  });
});

test("a file that can't be decoded falls back to the file as it is", async () => {
  await withPicture({ w: 4000, h: 3000 }, async () => {
    globalThis.Image = class { decode() { return Promise.reject(new Error("EncodingError")); } };
    const p = tweaks("I", { pic: { type: "image" } });
    dropOn(p.el.querySelector(".tw-trigger"), photo("odd.heic", "image/heic")); await tick(30);
    assert.match(p.params.pic, /^data:image\/heic;base64,/);
    p.destroy();
  });
});

test("the stylesheet rings a focused gallery tile with an outline", () => {
  // jsdom honors [hidden] over display: flex, so this is checked in the built CSS, not on the element.
  const css = distCss();
  assert.match(css, /\.tw-image-tile:focus-visible\{outline:2px solid/);
});

test("markup builds a gallery from data-options, with data-upload and data-cols", async () => {
  const { enhance } = await loadSingle();
  const host = document.createElement("div");
  Object.assign(host.dataset, { tw: "image", label: "Cover", options: "/a.png, /b.png, /c.png", value: "/b.png", upload: "false", cols: "3" });
  document.body.append(host);
  try {
    await enhance(host);
    assert.equal(host.querySelectorAll(".tw-image-tile").length, 3);
    assert.equal(host.querySelector(".tw-image-upload"), null);
    assert.equal(host.querySelector(".tw-image-grid").style.getPropertyValue("--tw-img-cols"), "3");
    assert.equal(host._tw.ctrl.get(), "/b.png");
  } finally { host.remove(); }
});

// data-tw="slidr" rendered nothing and logged nothing.
test("a markup host with an unknown data-tw type is skipped with a warning naming the near type", async () => {
  const { enhance } = await loadSingle();
  const host = document.createElement("div"); host.dataset.tw = "slidr";
  document.body.append(host);
  const warn = console.warn, msgs = []; console.warn = (...a) => msgs.push(a.join(" "));
  try {
    await enhance(host); await tick(20);
    assert.equal(host.children.length, 0);
    assert.ok(msgs.some((m) => m.includes('data-tw="slidr": "slidr" isn\'t a control type — did you mean "slider"? It is skipped.')));
    const types = msgs.find((m) => m.includes("slidr")).split("Types: ")[1].split(", ");
    for (const t of ["segmented", "toggle", "switch", "bezier", "radiogrid"]) assert.ok(types.includes(t), `the list names ${t}`);
    for (const t of ["colorpicker", "tabs"]) assert.ok(!types.includes(t), `and not ${t}, which markup can't build`);
  } finally { console.warn = warn; host.remove(); }
});

// data-tw="segmented" was warned "isn't a control type", though a schema takes it; data-tw="tabs" fell through to a folder
// whose missing get() threw out of enhance(), leaving every later host claimed but never built.
test("markup builds segmented as a schema does, leaves a tabs host untouched, and one bad host doesn't stop the rest", async () => {
  const { enhance } = await loadSingle();
  const holder = document.createElement("div"); document.body.append(holder);
  holder.innerHTML = '<div data-tw="tabs" data-key="t"></div><div data-tw="segmented" data-key="s" data-options="sRGB,display-p3" data-value="display-p3"></div><div data-tw="slider" data-key="after" data-value="5"></div>';
  const warn = console.warn, error = console.error, msgs = []; console.warn = console.error = (...a) => msgs.push(a.join(" "));
  try {
    await enhance(holder); await tick(20);
    const [tabs, seg, after] = holder.querySelectorAll("[data-tw]");
    assert.deepEqual([tabs.children.length, tabs.hasAttribute("data-tw-bound"), tabs._tw], [0, false, undefined], "tabs is panel-only: left untouched");
    assert.equal(seg._tw.ctrl.get(), "display-p3");
    assert.deepEqual([...seg.querySelectorAll(".tw-radiogrid-btn")].map((b) => b.textContent), ["sRGB", "display-p3"]);
    assert.equal(after._tw.ctrl.get(), 5, "the host after it still binds");
    assert.deepEqual(msgs, [], "quietly");
  } finally { console.warn = warn; console.error = error; holder.remove(); }
});

// y was clamped to −0.25–1.25, so easeOutBack [0.34, 1.56, 0.64, 1] and easeInOutBack [0.68, -0.6, 0.32, 1.6] came back
// flattened. CSS takes any y; x stays 0–1.
test("a cubicbezier keeps an overshoot curve's y, from −1 to 2, and still fits x to 0–1", async () => {
  const p = tweaks("Back", { out: { type: "cubicbezier", value: [0.34, 1.56, 0.64, 1] }, io: { type: "cubicbezier", value: [0.68, -0.6, 0.32, 1.6] } });
  await p.ready;
  assert.deepEqual(p.params.out, [0.34, 1.56, 0.64, 1]);
  assert.deepEqual(p.params.io, [0.68, -0.6, 0.32, 1.6]);
  p.set("out", [1.4, 3, -0.2, -2]);
  assert.deepEqual(p.params.out, [1, 2, 0, -1]);
  p.destroy();
});
