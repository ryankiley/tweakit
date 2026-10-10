/* `unit` on sliders and number fields — a display-only suffix ("24 px", "300 ms") on the
 * readout, the field and the accessible value; the param stays the bare number. Runs
 * against the built single-file bundle under jsdom. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks, enhance } = await import(new URL("../dist/tweaks.js", import.meta.url));
const mount = async (schema) => { const p = tweaks("U", schema); document.body.append(p.el); await p.ready; return p; };

test("slider: the readout and aria-valuetext carry the unit; the param, the inline editor and the emitted value do not", async () => {
  const p = await mount({ blur: { type: "slider", value: 24, min: 0, max: 100, step: 1, unit: "px" }, plain: [3, 0, 10, 1] });
  const track = p.el.querySelector(".tw-slider"), readout = track.querySelector(".tw-slider-value");
  assert.equal(readout.textContent, "24 px");
  assert.equal(readout.querySelector(".tw-slider-unit").textContent, " px", "the unit is its own muted span");
  assert.equal(track.getAttribute("aria-valuetext"), "24 px");
  assert.equal(track.getAttribute("aria-valuenow"), "24", "the numeric value stays bare");
  assert.equal(p.params.blur, 24);
  p.set("blur", 31);
  assert.equal(readout.textContent, "31 px", "follows a set()");
  const plain = p.el.querySelectorAll(".tw-slider")[1];
  assert.equal(plain.querySelector(".tw-slider-value").textContent, "3", "no unit, no suffix, no stray space");
  assert.equal(plain.getAttribute("aria-valuetext"), "3");
  p.destroy();
});

test("number: the field shows the unit and its accessible name names it; a bad unit is dropped", async () => {
  const p = await mount({ delay: { type: "number", value: 300, unit: "ms" }, odd: { type: "number", value: 1, unit: 42 }, long: { type: "number", value: 1, unit: "  kilometres per hour  " } });
  const [delay, odd, long] = [...p.el.querySelectorAll(".tw-num-wrap")];
  assert.equal(delay.querySelector(".tw-num-unit").textContent, "ms");
  assert.equal(delay.querySelector(".tw-num").getAttribute("aria-label"), "Delay (ms)");
  assert.equal(p.params.delay, 300);
  assert.equal(odd.querySelector(".tw-num-unit"), null, "a non-string unit is ignored");
  assert.equal(long.querySelector(".tw-num-unit").textContent, "kilometres p", "trimmed and capped at 12 characters");
  p.destroy();
});

test("markup: data-unit on a slider and a number", async () => {
  const holder = document.createElement("div");
  holder.innerHTML = `<div data-tw="slider" data-label="Blur" data-value="24" data-min="0" data-max="100" data-unit="px"></div><div data-tw="number" data-label="Delay" data-value="300" data-unit="ms"></div>`;
  document.body.append(holder);
  await enhance(holder);
  assert.equal(holder.querySelector(".tw-slider-value").textContent, "24 px");
  assert.equal(holder.querySelector(".tw-num-unit").textContent, "ms");
  holder.remove();
});
