/* A color keeps the notation it was written in and the precision it needs. "#ff0000" read back as oklch(63% 0.26 29):
 * code expecting hex broke, pasted values drifted, and the rounding changed 98% of colors (#939796's faint green read as
 * gray). A gray's hue came out as float noise (white as hue 180, cyan), which bends every oklch gradient through it. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, key } from "./_helpers.mjs";
import { bundle } from "./_bundle.mjs";

const { tweaks, createColorPicker } = await loadSingle();
const { serialize, convert } = await bundle("src/wide-gamut.ts");

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

test("a gray's hue is written none, so a gradient through it doesn't bend", async () => {
  const picker = createColorPicker({ value: "#ffffff", mode: "oklch", onChange: () => {} }); document.body.append(picker.el); await picker.ready;
  key(picker.el.querySelector(".tw-wg-hue"), { key: "ArrowRight" });
  assert.equal(picker.get(), "oklch(100% 0 none)");
  const hsl = createColorPicker({ value: "#808080", mode: "hsl", onChange: () => {} }); document.body.append(hsl.el); await hsl.ready;
  key(hsl.el.querySelector(".tw-wg-hue"), { key: "ArrowRight" });
  assert.match(hsl.get(), /^hsl\(none 0% 50\.\d%\)$/);
  picker.el.remove(); hsl.el.remove();
});

test("HSL's black and white have no hue, whatever float noise makes of S", async () => {
  // S divides by min(L, 1 - L), so a breath off black read as hsl(247 100% 0%) and bent an `in hsl` gradient through it.
  assert.equal(serialize(convert([1, 1, 0.99999], "srgb", "oklch"), "hsl", 1), "hsl(none 0% 100%)", "white was hsl(60 100% 100%)");
  assert.equal(serialize([0.99999, 0.0001, 350], "hsl", 1), "hsl(none 0% 100%)", "white was hsl(300 100% 100%)");
  assert.equal(serialize(convert([0.00001, 0, 0.00002], "srgb", "oklch"), "hsl", 1), "hsl(none 0% 0%)", "black was hsl(270 100% 0%)");
  const p = createColorPicker({ value: "oklch(0.1% 0.1 256)", mode: "hsl", onChange: () => {} }); document.body.append(p.el); await p.ready;
  const hue = p.el.querySelector(".tw-wg-hue"); key(hue, { key: "ArrowRight" });
  assert.equal(p.get(), "hsl(none 0% 0%)", "an edit next to black was hsl(247 100% 0%)");
  p.set(p.get()); key(hue, { key: "ArrowRight" });
  assert.equal(p.get(), "hsl(none 0% 0%)", "and it reads back in without drifting");
  p.el.remove();
  // LCH and OKLCH test chroma, which doesn't blow up at either end: a real chroma at L 0 keeps its hue.
  assert.equal(serialize([0, 0.1, 256], "oklch", 1), "oklch(0% 0.1 256)");
  assert.match(serialize([0, 0.1, 256], "lch", 1), /^lch\(0% [1-9][\d.]* \d[\d.]*\)$/);
});

test("an edit keeps the written flavor of its notation: color(srgb), legacy commas, the rgba and hsla names", async () => {
  // color(srgb 1 0 0) came back rgb(255 0 0) after one hue nudge, and hsla(200, 50%, 40%, 0.5) as hsl(… / 0.5).
  const nudged = async (value, then) => {
    const p = createColorPicker({ value, onChange: () => {} }); document.body.append(p.el); await p.ready;
    if (then) then(p);
    key(p.el.querySelector(".tw-wg-hue"), { key: "ArrowRight" }); const out = p.get(); p.el.remove(); return out;
  };
  assert.match(await nudged("color(srgb 1 0 0)"), /^color\(srgb 1 0\.\d+ 0\)$/);
  assert.match(await nudged("color(srgb 0.2 0.4 0.6 / 0.5)"), /^color\(srgb [\d.]+ [\d.]+ [\d.]+ \/ 0\.5\)$/);
  assert.match(await nudged("hsla(200, 50%, 40%, 0.5)"), /^hsla\([\d.]+, [\d.]+%, [\d.]+%, 0\.5\)$/);
  assert.match(await nudged("hsl(200, 50%, 40%)"), /^hsl\([\d.]+, [\d.]+%, [\d.]+%\)$/);
  assert.match(await nudged("rgba(10, 20, 30, 0.5)"), /^rgba\([\d.]+, [\d.]+, [\d.]+, 0\.5\)$/);
  assert.match(await nudged("rgb(10, 20, 30)"), /^rgb\([\d.]+, [\d.]+, [\d.]+\)$/, "no alpha slot it didn't have");
  assert.match(await nudged("rgba(10 20 30 / 0.5)"), /^rgba\([\d.]+ [\d.]+ [\d.]+ \/ 0\.5\)$/);
  assert.equal(await nudged("hsl(0, 0%, 50%)"), "hsl(0, 0%, 50%)", "legacy syntax can't carry none, so a gray's hue writes 0");
  // Picking a mode from the dropdown is picking its notation: the flavor goes with it.
  const pick = (m) => (p) => { const sel = p.el.querySelector(".tw-color-mode"); sel.value = m; sel.dispatchEvent(new window.Event("change")); };
  assert.match(await nudged("hsla(200, 50%, 40%, 0.5)", pick("oklch")), /^oklch\(.* \/ 0\.5\)$/);
  assert.match(await nudged("color(srgb 1 0 0)", (p) => { pick("hsl")(p); pick("srgb")(p); }), /^rgb\(\d/);
  // set() takes the new string's flavor, and a seeded mode (a gradient's blend space) never takes one.
  assert.match(await nudged("#7c5cff", (p) => p.set("rgba(10, 20, 30, 0.5)")), /^rgba\([\d.]+, [\d.]+, [\d.]+, 0\.5\)$/);
  const seeded = createColorPicker({ value: "hsla(200, 50%, 40%, 0.5)", mode: "hsl", onChange: () => {} }); document.body.append(seeded.el); await seeded.ready;
  key(seeded.el.querySelector(".tw-wg-hue"), { key: "ArrowRight" });
  assert.match(seeded.get(), /^hsl\([\d.]+ [\d.]+% [\d.]+% \/ 0\.5\)$/);
  seeded.el.remove();
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

// With no canvas to ask (jsdom, a worker), any word passed as a color and parsed as black: a stored "junk" loaded #000000.
test("a stored or set color that can't be read keeps the default, and says so, even with no canvas", async () => {
  const warns = [], warn = console.warn; console.warn = (...a) => warns.push(a.join(" "));
  try {
    localStorage.setItem("tw:t-junk-color", JSON.stringify({ v: 1, values: { c: "junk" } }));
    const p = tweaks("J", { c: "#ff0000" }, { persist: "t-junk-color" }); await p.ready;
    assert.equal(p.params.c, "#ff0000");
    p.set("c", "nope"); assert.equal(p.params.c, "#ff0000");
    assert.equal(warns.filter((w) => /isn't a color — kept #ff0000/.test(w)).length, 2, warns.join("\n"));
    p.destroy();
  } finally { console.warn = warn; localStorage.removeItem("tw:t-junk-color"); }
});

test("every color() space isColor() takes is read, and kept as written until an edit", async () => {
  // xyz, xyz-d50, xyz-d65, srgb-linear and a98-rgb loaded as the kit default oklch(70% 0.1 280), and prophoto-rgb as
  // OKLCH, each overwriting the param without a word. Each here is sRGB red, in published coordinates for its space.
  const red = { xyz: "color(xyz 0.41239 0.21264 0.01933)", d65: "color(xyz-d65 0.41239 0.21264 0.01933)", d50: "color(xyz-d50 0.4360 0.2225 0.0139)",
    lin: "color(srgb-linear 1 0 0)", a98: "color(a98-rgb 0.8586 0 0)", pro: "color(prophoto-rgb 0.7022 0.2757 0.1036)" };
  const p = tweaks("X", red); await p.ready; document.body.append(p.el);
  assert.deepEqual({ ...p.params }, red);
  const [L, C, H] = convert([1, 0, 0], "srgb", "oklch");
  const hues = [...p.el.querySelectorAll(".tw-wg-hue")]; // each row's closed popover, in schema order
  assert.equal(hues.length, 6);
  hues.forEach((h) => key(h, { key: "ArrowRight" })); // one hue step each
  const want = `oklch(${+(L * 100).toFixed(1)}% ${+C.toFixed(3)} ${+(H + 1).toFixed(1)})`;
  for (const k of Object.keys(red)) assert.equal(p.params[k], want, `${k}: read as sRGB red, then edited in OKLCH`);
  p.destroy();
});
