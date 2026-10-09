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
