/* The sRGB-family colour functions parse by the engine's own maths, not through a canvas:
 * a canvas echoes 8-bit `#rrggbb`, which moved a near-grey hwb's hue a whole degree on
 * every round trip (hwb(210 10% 77%) came back as 211 — the stress harness's seed 155). */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { bundle } from "./_bundle.mjs";

const { parseColor, isColor } = await bundle("src/tweaks/controls/colour.ts");
const { convert, serialize } = await bundle("src/wide-gamut.ts");
const near = (a, b, msg) => { assert.equal(a.length, b.length, msg); a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${msg}: [${i}] ${v} vs ${b[i]}`)); };
const oklch = (c, space) => { const k = convert(c, space, "oklch"); return [k[0], k[1], ((k[2] % 360) + 360) % 360]; };

test("hwb and hsl round-trip exactly through the picker's canonical space", () => {
  for (const s of ["hwb(210 10% 77%)", "hsl(210 20% 80%)", "hwb(0 0% 0%)", "hsl(300 100% 50%)"]) {
    const [L, C, H, A] = parseColor(s);
    const mode = s.startsWith("hwb") ? "hwb" : "hsl";
    assert.equal(serialize([L, C, H], mode, A), s, `${s} is a fixed point`);
  }
});

test("every syntax the sRGB family allows parses to the engine's exact value", () => {
  near(parseColor("rgb(255 0 0)").slice(0, 3), oklch([1, 0, 0], "srgb"), "modern rgb");
  near(parseColor("rgba(255, 0, 0, 0.5)").slice(0, 3), oklch([1, 0, 0], "srgb"), "legacy rgba");
  assert.equal(parseColor("rgba(255, 0, 0, 0.5)")[3], 0.5);
  assert.equal(parseColor("rgb(255 0 0 / 25%)")[3], 0.25);
  near(parseColor("rgb(100% 50% 0%)").slice(0, 3), oklch([1, 0.5, 0], "srgb"), "percent channels");
  near(parseColor("rgb(12.5 20 30)").slice(0, 3), oklch([12.5 / 255, 20 / 255, 30 / 255], "srgb"), "fractional channels keep their precision");
  near(parseColor("hsl(120deg 100% 50%)").slice(0, 3), oklch([120, 100, 50], "hsl"), "hue in degrees");
  near(parseColor("hsl(0.5turn 100% 50%)").slice(0, 3), oklch([180, 100, 50], "hsl"), "hue in turns");
  near(parseColor("hsl(120, 100%, 50%)").slice(0, 3), oklch([120, 100, 50], "hsl"), "legacy hsl");
  near(parseColor("hwb(120 20% 10% / 0.5)").slice(0, 3), oklch([120, 20, 10], "hwb"), "hwb with alpha");
  assert.equal(parseColor("hwb(120 20% 10% / 0.5)")[3], 0.5);
  near(parseColor("rgb(none 0 0)").slice(0, 3), oklch([0, 0, 0], "srgb"), "none is 0");
  near(parseColor("rgb(300 -20 0)").slice(0, 3), oklch([1, 0, 0], "srgb"), "channels clamp like a canvas did");
  near(parseColor("hwb(0 80% 80%)").slice(0, 3), oklch([0, 80, 80], "hwb"), "w + b past 100% is the grey the engine computes");
});

test("isColor accepts the sRGB functions without asking a canvas", () => {
  for (const s of ["rgb(1 2 3)", "hsl(1 2% 3%)", "hwb(1 2% 3% / 0.5)", "rgba(1, 2, 3, 0.5)"]) assert.ok(isColor(s), s);
  for (const s of ["rgb(1 2 3) url(x)", "hsl(", "rgb(1 2 (3))"]) assert.ok(!isColor(s), s);
});
