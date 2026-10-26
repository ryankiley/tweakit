/* Color parsing by the engine's own math, not through a canvas: a canvas echoes 8-bit
 * `#rrggbb`, which moved a near-gray hwb's hue a whole degree on every round trip
 * (hwb(210 10% 77%) came back as 211 — the stress harness's seed 155). And the stop gate
 * (isColor) holds every color function to CSS Color 4's grammar, not a shape: hsl/hwb
 * readouts are fixed points at grays and at hue 360, infinities clamp to the slot, `none`
 * is a case-insensitive keyword, and an invalid stop never reaches a gradient. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { bundle } from "./_bundle.mjs";
import { loadSingle, near } from "./_helpers.mjs";

const { parseColor, isColor } = await bundle("src/tweaks/controls/color.ts");
const { convert, serialize } = await bundle("src/wide-gamut.ts");
const { tweaks } = await loadSingle();
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
  near(parseColor("hwb(0 80% 80%)").slice(0, 3), oklch([0, 80, 80], "hwb"), "w + b past 100% is the gray the engine computes");
});

test("isColor accepts the sRGB functions without asking a canvas", () => {
  for (const s of ["rgb(1 2 3)", "hsl(1 2% 3%)", "hwb(1 2% 3% / 0.5)", "rgba(1, 2, 3, 0.5)"]) assert.ok(isColor(s), s);
  for (const s of ["rgb(1 2 3) url(x)", "hsl(", "rgb(1 2 (3))"]) assert.ok(!isColor(s), s);
});

// ── The stop gate: CSS's grammar for every color function, like the sRGB family ──
test("the stop gate follows CSS's grammar: shape alone no longer passes", () => {
  for (const s of ["rgb(a b c)", "rgb(1 2)", "rgb(1 2 3 4 5)", "hwb(120, 0%, 0%)", "rgb(255, 0%, 0)", "rgb(255, none, 0)", "hsl(120, 100, 50)", "hsl(50% 100% 50%)", "rgb(255 0 0 0.5)", "rgb(255, 0, 0 / 0.5)", "rgb(255,0,0,)", "rgb(255 0 0 /)", "rgb(255 0 0 / 0.5 / 0.2)", "rgb(255 0 0 / 50 %)", "rgb(1\u00a02 3)"]) assert.ok(!isColor(s), `refused: ${s}`);
  for (const s of ["rgb(255 0 0 / none)", "RGB(1 2 3)", "hsla(120deg, 100%, 50%, 0.5)", "hwb(120 0% 0%)", "rgb(100%, 0%, 0%)", "hsl(120 100 50)", "rgb(1e2 0 0)", "rgb( 1 , 2 , 3 )", "rgb(1\t2\n3)"]) assert.ok(isColor(s), `accepted: ${s}`);
  const p = tweaks("G", { g: { type: "gradient", value: [["rgb(a b c)", 0], ["#000", 0.5], ["#fff", 1]] } });
  assert.equal(p.params.g.stops.length, 2, "the invalid stop never reaches the gradient");
  p.destroy();
});

test("parse: infinities clamp to the slot, invalid forms are junk (black), like a browser-backed canvas", () => {
  near(parseColor("rgb(1e999 0 0)").slice(0, 3), parseColor("rgb(255 0 0)").slice(0, 3), "an infinite channel is the slot's top");
  assert.equal(parseColor("rgb(255 0 0 / 1e999)")[3], 1);
  for (const s of ["rgb(255, 0%, 0)", "hsl(50% 100% 50%)", "rgb(255 0 0 0.5)", "rgb(1 2)"]) assert.deepEqual(parseColor(s), [0, 0, 0, 1], `${s} is junk`);
});

test("hsl and hwb readouts are fixed points, grays and hue 360 included", () => {
  const steps = (n, max) => Array.from({ length: n }, (_, i) => Math.round((i * max) / (n - 1)));
  let chromatic = 0, exactFails = [], idemFails = [];
  for (const mode of ["hsl", "hwb"]) {
    for (const h of steps(25, 360)) for (const a of steps(5, 100)) for (const b of steps(5, 100)) {
      const s = `${mode}(${h % 360} ${a}% ${b}%)`;
      const once = serialize(parseColor(s).slice(0, 3), mode, 1);
      const twice = serialize(parseColor(once).slice(0, 3), mode, 1);
      if (twice !== once) idemFails.push(`${s} → ${once} → ${twice}`);
      const gray = mode === "hsl" ? a === 0 || b === 0 || b === 100 : a + b >= 100; // a gray carries no hue, so only its normalized form can read back as itself
      if (!gray) { chromatic++; if (once !== s) exactFails.push(`${s} → ${once}`); }
    }
  }
  assert.ok(chromatic >= 500, `grid covered ${chromatic} chromatic inputs`);
  assert.deepEqual(exactFails.slice(0, 10), [], `${exactFails.length} chromatic inputs are not fixed points`);
  assert.deepEqual(idemFails.slice(0, 10), [], `${idemFails.length} inputs are not stable after one trip`);
  assert.equal(serialize(parseColor("hsl(0 100% 51%)").slice(0, 3), "hsl", 1), "hsl(0 100% 51%)", "hue 0 stays 0, never reads as 360");
  assert.equal(serialize(parseColor("hwb(0 3% 100%)").slice(0, 3), "hsl", 1), serialize(parseColor(serialize(parseColor("hwb(0 3% 100%)").slice(0, 3), "hsl", 1)).slice(0, 3), "hsl", 1), "a gray's hsl form is stable");
});

test("the stop gate holds oklch()/oklab()/lch()/lab()/color() to CSS Color 4's grammar", () => {
  for (const s of [
    "oklch(70% 0.1 20deg)", "oklch(0.7 0.1 20 / 0.5)", "oklch(none none none)", "oklch(0.5 0.1 1.5turn / 50%)", "OKLCH(0.5 0.1 20)", "oklch(\t0.5\n0.1 20 )",
    "lab(50 -20 30 / 50%)", "lab(50% 125% -125%)", "lch(50 30 1.5turn)", "lch(50% 30% none)", "oklab(0.5 0.1 -0.1)",
    "color(display-p3 1 0 0)", "color(xyz 0.5 0.5 0.5 / none)", "color(srgb-linear 100% 0% 0%)", "color(rec2020 1e999 0 0)",
  ]) assert.ok(isColor(s), `accepted: ${JSON.stringify(s)}`);
  for (const s of [
    "oklch(a b c)", "lab(x y z)", "color(foo 1 0 0)", "lch(50 0 0 0)", "oklch()", "color()", "oklch(0.5 0.1)", "oklch(0.5, 0.1, 20)",
    "lch(50 30 50%)", "lab(50deg 0 0)", "oklch(0.5 0.1 20 / 10deg)", "oklch(0.5 0.1 20 / 0.5 / 1)", "color(1 0 0)", "color(srgb 1 0 0 0)", "oklch(0.5 0.1 20)",
  ]) assert.ok(!isColor(s), `refused: ${JSON.stringify(s)}`);
});
test("an invalid oklch() stop never reaches the gradient", () => {
  const p = tweaks("R7A", { g: { type: "gradient", value: [["oklch(a b c)", 0], ["#000", 0.5], ["#fff", 1]] } });
  document.body.append(p.el);
  try { assert.deepEqual(p.params.g.stops.map((s) => s.color), ["#000", "#fff"]); } finally { p.destroy(); }
});
test("a stop's stored text is trimmed, so a non-ASCII space can't ride into the gradient", () => {
  const p = tweaks("R7B", { g: { type: "gradient", value: [[" red ", 0], [" #fff\n", 1]] } });
  document.body.append(p.el);
  try { assert.deepEqual(p.params.g.stops.map((s) => s.color), ["red", "#fff"]); } finally { p.destroy(); }
});
// CSS's <number> has no trailing dot: `1.` tokenizes as a number and a delim.
test("a number with a trailing dot is not a CSS <number>", () => {
  for (const s of ["rgb(1. 2 3)", "rgb(255 0 0 / 1.)", "hsl(1.e1deg 100% 50%)", "rgb(1.e2 2 3)", "oklch(.5 0.1 20.)"]) assert.ok(!isColor(s), `refused: ${s}`);
  for (const s of ["rgb(1.5 2 3)", "rgb(.5 0 0 / .5)", "hsl(1e1deg 100% 50%)", "oklch(.5 0.1 20.5)"]) assert.ok(isColor(s), `accepted: ${s}`);
});
test("`none` is a case-insensitive keyword, in the gate and in the parse", () => {
  assert.ok(isColor("rgb(NONE 0 0)")); assert.ok(isColor("oklch(None 0.1 20 / nOnE)"));
  near(parseColor("hsl(NONE 100% 50%)"), parseColor("hsl(0 100% 50%)"), "hsl(NONE 100% 50%) is red, not black");
  near(parseColor("oklch(0.5 NONE 20)"), parseColor("oklch(0.5 0 20)"), "oklch(0.5 NONE 20) is the gray");
});
test("an infinite hue parses the same with a unit as without one", () => {
  near(parseColor("hsl(1e999deg 100% 50%)"), parseColor("hsl(1e999 100% 50%)"), "hsl");
  near(parseColor("oklch(0.5 0.1 1e999turn)"), parseColor("oklch(0.5 0.1 1e999)"), "oklch");
  assert.ok(parseColor("hsl(1e999deg 100% 50%)").every(Number.isFinite), "finite channels");
});
