/* Wide-gamut engine — conversion round-trips across every space, reference
 * values, and the gamut machinery (toGamut / probe / chromaCeil). Pure maths,
 * bundled straight from src/ (no DOM, no dist). */
import test from "node:test";
import assert from "node:assert/strict";
import { bundle } from "./_bundle.mjs";

const { convert, toGamut, oklchToHex, hexToOklch, channelValues, withChannel, chromaCeil, oklchGamutProbe, serialize } = await bundle("src/wide-gamut.ts");

const close = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;
const tripleClose = (got, want, eps = 1e-3) => got.every((c, i) => close(c, want[i], eps));

test("sRGB red round-trips through OKLCH to the CSS Color 4 reference values", () => {
  const red = convert([1, 0, 0], "srgb", "oklch");
  assert.ok(close(red[0], 0.62796) && close(red[1], 0.25768) && close(red[2], 29.234, 0.05), `got ${red}`);
  assert.ok(tripleClose(convert(red, "oklch", "srgb"), [1, 0, 0]));
});

test("sRGB white maps to Lab 100,0,0", () => {
  const w = convert([1, 1, 1], "srgb", "lab");
  assert.ok(close(w[0], 100, 0.01) && close(w[1], 0, 0.01) && close(w[2], 0, 0.01), `got ${w}`);
});

test("every RGB space round-trips through OKLCH", () => {
  for (const space of ["srgb", "p3", "rec2020", "prophoto-rgb"]) {
    const c = [0.3, 0.6, 0.9];
    const back = convert(convert(c, space, "oklch"), "oklch", space);
    assert.ok(tripleClose(back, c), `${space}: got ${back}`);
  }
});

test("hsl and hwb round-trip", () => {
  const viaHsl = convert(convert([0.2, 0.4, 0.6], "srgb", "hsl"), "hsl", "srgb");
  assert.ok(tripleClose(viaHsl, [0.2, 0.4, 0.6]));
  const viaHwb = convert(convert([0.2, 0.4, 0.6], "srgb", "hwb"), "hwb", "srgb");
  assert.ok(tripleClose(viaHwb, [0.2, 0.4, 0.6]));
});

test("hex helpers round-trip", () => {
  assert.equal(oklchToHex(...hexToOklch("#3366cc")), "#3366cc");
});

test("toGamut maps out-of-gamut chroma into the destination range", () => {
  const rgb = toGamut([0.7, 0.4, 150], "srgb"); // far outside sRGB
  assert.ok(rgb.every((c) => c >= 0 && c <= 1), `got ${rgb}`);
});

test("chromaCeil agrees with a known boundary colour", () => {
  // sRGB red sits ON the sRGB gamut boundary: its chroma is the ceiling at its L/H.
  const probe = oklchGamutProbe(29.234, "srgb");
  assert.ok(close(chromaCeil(probe, 0.62796), 0.25768, 0.01));
});

test("channelValues / withChannel respect each mode's display scale", () => {
  assert.ok(close(withChannel([0.5, 0.1, 200], "oklch", 0, 80)[0], 0.8)); // L edits in 0–100
  const rgb = channelValues([0.62796, 0.25768, 29.234], "srgb");
  assert.ok(close(rgb[0], 255, 1.5) && close(rgb[1], 0, 1.5) && close(rgb[2], 0, 1.5), `got ${rgb}`);
});

test("serialize stays in-mode for opaque and translucent alike", () => {
  const c = convert([0.4, 0.5, 0.6], "srgb", "oklch"); // in-gamut
  assert.match(serialize(c, "srgb", 1), /^rgb\(/);
  assert.match(serialize(c, "srgb", 0.5), /^rgb\(.* \/ 0\.5\)$/); // translucent stays rgb (it used to jump to oklch())
  assert.match(serialize(c, "hsl", 0.5), /^hsl\(.* \/ 0\.5\)$/);
  assert.match(serialize(c, "css", 0.5), /^rgba\(.*, 0\.5\)$/);   // legacy comma form keeps comma alpha
  assert.match(serialize(c, "oklch", 0.5), /^oklch\(.* \/ 0\.5\)$/);
  assert.equal(serialize(c, "hex", 1).length, 7);                 // #rrggbb
  assert.equal(serialize(c, "hex", 0.5).length, 9);               // #rrggbbaa
});

test("narrow-gamut modes agree with hex on an out-of-gamut colour (chroma-reduce, not per-channel clip)", () => {
  const oog = [0.7, 0.4, 150]; // far outside sRGB
  const rgb = channelValues(oog, "srgb").map((v) => Math.round(v));
  const hex = oklchToHex(oog[0], oog[1], oog[2]);
  const fromHex = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  assert.ok(rgb.every((v, i) => Math.abs(v - fromHex[i]) <= 1), `rgb ${rgb} vs hex ${fromHex}`);
});
