/* Gradient → CSS — the easing parser and the stop expansion behind gradientCss(). Pure
 * string + number work, bundled straight from src/ (no DOM, no dist). The reference
 * numbers are Larsen's published ease-in-out samples (larsenwork.com/easing-gradients),
 * which the parametric read of cubic-bezier(.42, 0, .58, 1) must reproduce. */
import test from "node:test";
import assert from "node:assert/strict";
import { bundle } from "./_bundle.mjs";

const { parseEasing, easingName, easingSamples, easingAt, gradientStops, gradientCss } = await bundle("src/tweaks/easing.ts");

const close = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;
const LARSEN = [[0, 0], [.081, .013], [.155, .049], [.225, .104], [.29, .175], [.353, .259], [.412, .352], [.471, .45], [.529, .55], [.588, .648], [.647, .741], [.71, .825], [.775, .896], [.845, .951], [.919, .987], [1, 1]];
const RED_BLUE = { stops: [{ color: "red", pos: 0 }, { color: "blue", pos: 1 }], interpolation: "oklch" };

test("ease-in-out sampled parametrically reproduces Larsen's 16 published stops", () => {
  const s = easingSamples(parseEasing("ease-in-out"));
  assert.equal(s.length, 16);
  s.forEach(([x, y], i) => assert.ok(close(x, LARSEN[i][0]) && close(y, LARSEN[i][1]), `sample ${i}: ${x},${y} vs ${LARSEN[i]}`));
});

test("parseEasing: keywords, cubic-bezier() with x clamped, and garbage → linear (null)", () => {
  assert.deepEqual(parseEasing("ease-in-out"), [0.42, 0, 0.58, 1]);
  assert.deepEqual(parseEasing(" Ease-In "), [0.42, 0, 1, 1]); // case + whitespace tolerant, like CSS
  assert.deepEqual(parseEasing("cubic-bezier(1.5, -0.3, -2, 1.4)"), [1, -0.3, 0, 1.4]); // x into [0,1], y may overshoot
  for (const bad of ["linear", "", "constructor", "__proto__", "cubic-bezier(1,2,3)", "cubic-bezier(a,b,c,d)", "cubic-bezier(1,,2,3)", "cubic-bezier(1,2,3,Infinity)", "cubic-bezier(0,0,1,1) url(x)", 42, null, undefined, ["ease"]]) {
    assert.equal(parseEasing(bad), null, `${String(bad)} should be linear`);
  }
});

test("easingName canonicalises: a keyword's bezier reads back as the keyword, others as cubic-bezier(…)", () => {
  assert.equal(easingName("cubic-bezier(0.42, 0, 0.58, 1)"), "ease-in-out");
  assert.equal(easingName("EASE"), "ease");
  assert.equal(easingName("cubic-bezier(0.3, 0, 0.7, 1)"), "cubic-bezier(0.3, 0, 0.7, 1)");
  assert.equal(easingName("nonsense"), "linear");
  assert.equal(easingName(undefined), "linear");
});

test("easingAt reads progress off the sampled ramp — identity for linear, the curve's y at a sample's x", () => {
  assert.equal(easingAt(null, 0.37), 0.37);
  const b = parseEasing("ease-in-out");
  assert.equal(easingAt(b, 0), 0); assert.equal(easingAt(b, 1), 1);
  assert.ok(close(easingAt(b, 0.5), 0.5));
  assert.ok(close(easingAt(b, 0.225), 0.104)); // Larsen's 4th sample, hit exactly
  assert.ok(easingAt(b, 0.1) < 0.1 && easingAt(b, 0.9) > 0.9, "ease-in-out lags early and leads late");
  assert.equal(easingAt(b, 2), 1); assert.equal(easingAt(b, -1), 0); // outside the segment clamps to its ends
});

test("linear (or no) easing gives today's plain stop list, byte for byte", () => {
  assert.equal(gradientStops(RED_BLUE), "red 0%, blue 100%");
  assert.equal(gradientStops({ ...RED_BLUE, easing: "linear" }), "red 0%, blue 100%");
  assert.equal(gradientStops({ ...RED_BLUE, easing: "garbage" }), "red 0%, blue 100%");
  assert.equal(gradientCss(RED_BLUE), "linear-gradient(in oklch to right, red 0%, blue 100%)");
  assert.equal(gradientCss(RED_BLUE, 135), "linear-gradient(in oklch 135deg, red 0%, blue 100%)");
  assert.equal(gradientCss({ stops: RED_BLUE.stops }, "to bottom"), "linear-gradient(in oklch to bottom, red 0%, blue 100%)"); // no interpolation → oklch, the editor's default
});

test("an eased two-stop ramp expands to 16 stops: the ends verbatim, 14 color-mix samples in the value's blend space", () => {
  const css = gradientStops({ ...RED_BLUE, interpolation: "srgb", easing: "ease-in-out" });
  const stops = css.split(/, (?![^(]*\))/); // split on the top-level commas only
  assert.equal(stops.length, 16);
  assert.equal(stops[0], "red 0%"); assert.equal(stops[15], "blue 100%");
  assert.equal(stops[1], "color-mix(in srgb, red, blue 1.27%) 8.07%"); // Larsen's .081 → .013, at two decimals
  assert.equal(stops[8], "color-mix(in srgb, red, blue 54.99%) 52.9%"); // his .529 → .55
  const pos = stops.map((s) => parseFloat(s.slice(s.lastIndexOf(" ") + 1)));
  pos.forEach((p, i) => i && assert.ok(p > pos[i - 1], "positions strictly increase"));
  assert.equal((css.match(/color-mix\(/g) || []).length, 14);
});

test("easing is per segment, positions scale into each span, and a zero-width segment gets no samples", () => {
  const three = gradientStops({ stops: [{ color: "red", pos: 0 }, { color: "lime", pos: 0.25 }, { color: "blue", pos: 1 }], easing: "ease" });
  assert.equal((three.match(/color-mix\(/g) || []).length, 28);
  assert.ok(three.includes("lime 25%") && !three.includes("lime 25%, lime"), "the shared stop is emitted once");
  const positions = [...three.matchAll(/\) ([\d.]+)%/g)].map((m) => +m[1]);
  assert.ok(positions.slice(0, 14).every((p) => p > 0 && p < 25) && positions.slice(14).every((p) => p > 25 && p < 100), "samples stay inside their segment");
  const hard = gradientStops({ stops: [{ color: "red", pos: 0 }, { color: "lime", pos: 0.5 }, { color: "blue", pos: 0.5 }, { color: "white", pos: 1 }], easing: "ease" });
  assert.equal((hard.match(/color-mix\(/g) || []).length, 28, "no samples inside the hard edge");
  assert.ok(hard.includes("lime 50%, blue 50%"));
});

test("y overshoot clamps into color-mix's 0–100% and the stops still sort by position", () => {
  const css = gradientStops({ ...RED_BLUE, easing: "cubic-bezier(0.3, -0.8, 0.7, 1.8)" });
  for (const m of css.matchAll(/blue ([\d.]+)%\)/g)) assert.ok(+m[1] >= 0 && +m[1] <= 100, `mix % in range: ${m[1]}`);
  const pos = [...css.matchAll(/ ([\d.]+)%(?:,|$)/g)].map((m) => +m[1]);
  pos.forEach((p, i) => i && assert.ok(p >= pos[i - 1], "monotonic"));
});

test("the helpers take the schema's shorthand too: a bare stop array, tuple stops, and a missing stops field", () => {
  assert.equal(gradientCss([["#000", 0], ["#fff", 1]]), "linear-gradient(in oklch to right, #000 0%, #fff 100%)");
  assert.equal(gradientStops({ stops: [["red", 0], { color: "blue", pos: 1 }], easing: "ease" }).split(/, (?![^(]*\))/).length, 16);
  assert.equal(gradientStops({}), ""); assert.equal(gradientStops(null), ""); assert.equal(gradientCss(undefined), "linear-gradient(in oklch to right, )"); // garbage never throws
});

test("stops are sorted by position before expansion, whatever order the value holds them in", () => {
  const css = gradientStops({ stops: [{ color: "blue", pos: 1 }, { color: "red", pos: 0 }], easing: "ease-in-out" });
  assert.ok(css.startsWith("red 0%, color-mix(in oklch, red, blue") && css.endsWith("blue 100%"));
});
