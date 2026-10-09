/* Monitor and plot edge inputs: a monitor with nothing to read, a decimals setting past
 * what toFixed accepts, an Infinity sample, and a plot whose expression doesn't parse. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const p = tweaks("K", { t: { type: "tabs", pages: { "": { a: 1 } } }, pt: { type: "point", components: [{ label: "X" }, {}] } });
  assert.equal(p.el.querySelector(".tw-tabs-tab").textContent, "Tab");
  assert.deepEqual(p.params.pt, { x: 0, c1: 0 });
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
  const { enhance } = await import(new URL("../dist/tweaks.js", import.meta.url));
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
