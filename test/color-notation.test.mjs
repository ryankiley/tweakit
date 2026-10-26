/* A color keeps the notation it was written in and the precision it needs. "#ff0000" read back as oklch(63% 0.26 29):
 * code expecting hex broke, pasted values drifted, and the rounding changed 98% of colors (#939796's faint green read as
 * grey). A grey's hue came out as float noise (white as hue 180, cyan), which bends every oklch gradient through it. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, key } from "./_helpers.mjs";

const { tweaks, createColorPicker } = await loadSingle();

test("a color reads back exactly as it was written, in any notation the picker edits", async () => {
  const written = { hex: "#ff0000", short: "#7C5CFF", rgb: "rgb(10 20 30)", legacy: "rgba(10, 20, 30, 0.5)", hsl: "hsl(200 50% 40%)", ok: "oklch(0.6 0.2 280)", p3: "color(display-p3 1 0 0)" };
  const p = tweaks("W", written); await p.ready;
  assert.deepEqual({ ...p.params }, written);
  p.set("hex", "#00ff00"); assert.equal(p.params.hex, "#00ff00", "set() keeps the string too");
  p.destroy();
});

test("an edit writes the color's own notation, a digit finer than the readout", async () => {
  const hex = createColorPicker({ value: "#7c5cff", onChange: () => {} }); document.body.append(hex.el); await hex.ready;
  key(hex.el.querySelector(".tw-wg-hue"), { key: "ArrowRight" }); // a hue-strip step, the smallest edit from the keyboard
  assert.match(hex.get(), /^#[0-9A-F]{6}$/, `hex stays hex, upper-case (${hex.get()})`);
  const picker = createColorPicker({ value: "oklch(62% 0.0047 165)", onChange: () => {} }); document.body.append(picker.el); await picker.ready;
  const plane = picker.el.querySelector(".tw-wg-hue"); key(plane, { key: "ArrowRight" });
  assert.match(picker.get(), /^oklch\(62% 0\.005 166\)$/, `a faint tint keeps its chroma (${picker.get()})`);
  picker.el.remove(); hex.el.remove();
});

test("a grey's hue is written none, so a gradient through it doesn't bend", async () => {
  const picker = createColorPicker({ value: "#ffffff", mode: "oklch", onChange: () => {} }); document.body.append(picker.el); await picker.ready;
  key(picker.el.querySelector(".tw-wg-hue"), { key: "ArrowRight" });
  assert.equal(picker.get(), "oklch(100% 0 none)");
  const hsl = createColorPicker({ value: "#808080", mode: "hsl", onChange: () => {} }); document.body.append(hsl.el); await hsl.ready;
  key(hsl.el.querySelector(".tw-wg-hue"), { key: "ArrowRight" });
  assert.match(hsl.get(), /^hsl\(none 0% 50\.\d%\)$/);
  picker.el.remove(); hsl.el.remove();
});

test("a hostile number isn't handed back as written: it reads as the picker normalizes it", async () => {
  const p = tweaks("H", { c: "#ff0000" }); await p.ready;
  p.set("c", "oklab(0.5 1e999 -1e999)");
  assert.ok(!/e999/.test(p.params.c), p.params.c);
  p.destroy();
});

test("a color row opens in the mode its schema names, and in its notation without one", async () => {
  const p = tweaks("M", { seeded: { type: "color", value: "#7c5cff", mode: "oklch" }, plain: "#7c5cff" }); await p.ready; document.body.append(p.el);
  const modes = [...p.el.querySelectorAll(".tw-color-pop .tw-color-mode")].map((sel) => sel.value);
  assert.deepEqual(modes, ["oklch", "hex"]);
  assert.equal(p.params.seeded, "#7c5cff", "the mode changes the editor, not the value");
  p.destroy();
});

test("a hex's digits and a color() space name aren't read as numbers, so they read back as written too", async () => {
  // #1E40AF scanned as 1e40 and rec2020 as 2020, both past the hostile-number cut, so each came back rewritten unedited.
  const written = { a: "#1E40AF", b: "#2E8B57", c: "#9e9", d: "#3e4", e: "color(rec2020 0.12345 0.5 0.25)", f: "#1e5000" };
  const p = tweaks("D", written); await p.ready;
  assert.deepEqual({ ...p.params }, written);
  p.set("a", "color(rec2020 1e999 0 0)"); assert.ok(!/e999/.test(p.params.a), `a hostile argument is still normalized (${p.params.a})`);
  p.destroy();
});
