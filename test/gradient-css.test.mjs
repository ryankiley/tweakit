/* Gradient → CSS — the easing parser and the stop expansion behind gradientCss(). Pure
 * string + number work, bundled straight from src/ (no DOM, no dist). The reference
 * numbers are Larsen's published ease-in-out samples (larsenwork.com/easing-gradients),
 * which the parametric read of cubic-bezier(.42, 0, .58, 1) must reproduce. */
import test from "node:test";
import assert from "node:assert/strict";
import { bundle } from "./_bundle.mjs";
import { close } from "./_helpers.mjs";

const { parseEasing, easingSamples, gradientStops, gradientCss } = await bundle("src/tweaks/easing.ts");
// the editor's own, beside the parser they read
const { easingName, easingAt } = await bundle("src/tweaks/controls/gradient.ts");

const LARSEN = [
  [0, 0],
  [0.081, 0.013],
  [0.155, 0.049],
  [0.225, 0.104],
  [0.29, 0.175],
  [0.353, 0.259],
  [0.412, 0.352],
  [0.471, 0.45],
  [0.529, 0.55],
  [0.588, 0.648],
  [0.647, 0.741],
  [0.71, 0.825],
  [0.775, 0.896],
  [0.845, 0.951],
  [0.919, 0.987],
  [1, 1],
];
const RED_BLUE = {
  stops: [
    { color: "red", pos: 0 },
    { color: "blue", pos: 1 },
  ],
  interpolation: "oklch",
};

test("ease-in-out sampled parametrically reproduces Larsen's 16 published stops", () => {
  const s = easingSamples(parseEasing("ease-in-out"));
  assert.equal(s.length, 16);
  s.forEach(([x, y], i) =>
    assert.ok(close(x, LARSEN[i][0]) && close(y, LARSEN[i][1]), `sample ${i}: ${x},${y} vs ${LARSEN[i]}`),
  );
});

test("parseEasing: keywords, cubic-bezier() with x clamped, and garbage → linear (null)", () => {
  assert.deepEqual(parseEasing("ease-in-out"), [0.42, 0, 0.58, 1]);
  assert.deepEqual(parseEasing(" Ease-In "), [0.42, 0, 1, 1]); // case + whitespace tolerant, like CSS
  assert.deepEqual(parseEasing("cubic-bezier(1.5, -0.3, -2, 1.4)"), [1, -0.3, 0, 1.4]); // x into [0,1], y may overshoot
  for (const bad of [
    "linear",
    "",
    "constructor",
    "__proto__",
    "cubic-bezier(1,2,3)",
    "cubic-bezier(a,b,c,d)",
    "cubic-bezier(1,,2,3)",
    "cubic-bezier(1,2,3,Infinity)",
    "cubic-bezier(0,0,1,1) url(x)",
    42,
    null,
    undefined,
    ["ease"],
  ]) {
    assert.equal(parseEasing(bad), null, `${String(bad)} should be linear`);
  }
});

test("easingName keeps a known easing (trimmed, lowercased) and reads anything else as linear", () => {
  assert.equal(easingName(" EASE-in "), "ease-in");
  assert.equal(easingName("cubic-bezier(0.3, 0, 0.7, 1)"), "cubic-bezier(0.3, 0, 0.7, 1)");
  assert.equal(easingName("nonsense"), "linear");
  assert.equal(easingName(undefined), "linear");
});

test("easingAt reads progress off the sampled ramp — identity for linear, the curve's y at a sample's x", () => {
  assert.equal(easingAt(null, 0.37), 0.37);
  const b = parseEasing("ease-in-out");
  assert.equal(easingAt(b, 0), 0);
  assert.equal(easingAt(b, 1), 1);
  assert.ok(close(easingAt(b, 0.5), 0.5));
  assert.ok(close(easingAt(b, 0.225), 0.104)); // Larsen's 4th sample, hit exactly
  assert.ok(easingAt(b, 0.1) < 0.1 && easingAt(b, 0.9) > 0.9, "ease-in-out lags early and leads late");
  assert.equal(easingAt(b, 2), 1);
  assert.equal(easingAt(b, -1), 0); // outside the segment clamps to its ends
});

test("linear (or no) easing gives today's plain stop list, byte for byte", () => {
  assert.equal(gradientStops(RED_BLUE), "red 0%, blue 100%");
  assert.equal(gradientStops({ ...RED_BLUE, easing: "linear" }), "red 0%, blue 100%");
  assert.equal(gradientStops({ ...RED_BLUE, easing: "garbage" }), "red 0%, blue 100%");
  assert.equal(gradientCss(RED_BLUE), "linear-gradient(in oklch to right, red 0%, blue 100%)");
  assert.equal(gradientCss(RED_BLUE, 135), "linear-gradient(in oklch 135deg, red 0%, blue 100%)");
  // no interpolation → oklch, the editor's default
  assert.equal(
    gradientCss({ stops: RED_BLUE.stops }, "to bottom"),
    "linear-gradient(in oklch to bottom, red 0%, blue 100%)",
  );
});

test("a value that can't make a gradient still makes valid CSS, and says why once", async (t) => {
  const words = () => new Promise((r) => setTimeout(r, 0)); // the warning's words load with the lazy chunk
  const warn = t.mock.method(console, "warn", () => {});
  // No usable stops → "none" for background-image, and a stop list that is still a stop list.
  for (const bad of [null, undefined, {}, 42, { stops: [] }, { stops: [{ pos: 0 }, null] }]) {
    assert.equal(gradientCss(bad), "none", `gradientCss(${JSON.stringify(bad)})`);
    assert.equal(gradientStops(bad), "transparent, transparent", `gradientStops(${JSON.stringify(bad)})`);
  }
  await words();
  assert.ok(
    warn.mock.calls.length > 0 &&
      warn.mock.calls.every((c) => /^\[tweaks\] gradient(Css|Stops)\(\): /.test(c.arguments[0])),
  );
  assert.ok(
    warn.mock.calls.some((c) => c.arguments[0].includes("got null")) &&
      warn.mock.calls.some((c) => c.arguments[0].includes("no stops")),
  );
  // One stop is no <color-stop-list>; doubled, it's a solid fill, eased or not.
  const one = { stops: [{ color: "red", pos: 0.3 }], easing: "ease" };
  assert.equal(gradientCss(one), "linear-gradient(in oklch to right, red, red)");
  assert.equal(gradientStops(one), "red, red");
  // A broken stop beside good ones is skipped, not printed as "undefined NaN%".
  warn.mock.resetCalls();
  assert.equal(
    gradientCss({ stops: [...RED_BLUE.stops, { color: "lime" }] }),
    "linear-gradient(in oklch to right, red 0%, blue 100%)",
  );
  await words();
  assert.equal(warn.mock.calls.length, 1, "one warning per call, though gradientCss draws the stop list too");
  assert.match(warn.mock.calls[0].arguments[0], /skipped 1 of 3 stops/);
  gradientCss({ stops: [...RED_BLUE.stops, { color: "lime" }] });
  await words();
  assert.equal(warn.mock.calls.length, 1, "the same fault again, as in a render loop, doesn't warn again");
});

test("an eased two-stop ramp expands to 16 stops: the ends verbatim, 14 color-mix samples in the value's blend space", () => {
  const css = gradientStops({ ...RED_BLUE, interpolation: "srgb", easing: "ease-in-out" });
  const stops = css.split(/, (?![^(]*\))/); // split on the top-level commas only
  assert.equal(stops.length, 16);
  assert.equal(stops[0], "red 0%");
  assert.equal(stops[15], "blue 100%");
  assert.equal(stops[1], "color-mix(in srgb, red, blue 1.27%) 8.07%"); // Larsen's .081 → .013, at two decimals
  assert.equal(stops[8], "color-mix(in srgb, red, blue 54.99%) 52.9%"); // his .529 → .55
  const pos = stops.map((s) => parseFloat(s.slice(s.lastIndexOf(" ") + 1)));
  pos.forEach((p, i) => i && assert.ok(p > pos[i - 1], "positions strictly increase"));
  assert.equal((css.match(/color-mix\(/g) || []).length, 14);
});

test("easing is per segment, positions scale into each span, and a zero-width segment gets no samples", () => {
  const three = gradientStops({
    stops: [
      { color: "red", pos: 0 },
      { color: "lime", pos: 0.25 },
      { color: "blue", pos: 1 },
    ],
    easing: "ease",
  });
  assert.equal((three.match(/color-mix\(/g) || []).length, 28);
  assert.ok(three.includes("lime 25%") && !three.includes("lime 25%, lime"), "the shared stop is emitted once");
  const positions = [...three.matchAll(/\) ([\d.]+)%/g)].map((m) => +m[1]);
  assert.ok(
    positions.slice(0, 14).every((p) => p > 0 && p < 25) && positions.slice(14).every((p) => p > 25 && p < 100),
    "samples stay inside their segment",
  );
  const hard = gradientStops({
    stops: [
      { color: "red", pos: 0 },
      { color: "lime", pos: 0.5 },
      { color: "blue", pos: 0.5 },
      { color: "white", pos: 1 },
    ],
    easing: "ease",
  });
  assert.equal((hard.match(/color-mix\(/g) || []).length, 28, "no samples inside the hard edge");
  assert.ok(hard.includes("lime 50%, blue 50%"));
});

test("y overshoot clamps into color-mix's 0–100% and the stops still sort by position", () => {
  const css = gradientStops({ ...RED_BLUE, easing: "cubic-bezier(0.3, -0.8, 0.7, 1.8)" });
  for (const m of css.matchAll(/blue ([\d.]+)%\)/g)) assert.ok(+m[1] >= 0 && +m[1] <= 100, `mix % in range: ${m[1]}`);
  const pos = [...css.matchAll(/ ([\d.]+)%(?:,|$)/g)].map((m) => +m[1]);
  pos.forEach((p, i) => i && assert.ok(p >= pos[i - 1], "monotonic"));
});

// A stop's color and the blend space went into the CSS unchecked: `in junk`, `in 5`, and a color holding a comma
// spliced a url() layer the browser fetches. A stop that isn't one color token is skipped; an unknown space falls to
// oklch.
test("a stop that isn't one color token is skipped, and an unknown blend space falls to oklch", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  for (const color of [
    "red, url(https://x/a.png) 0%",
    "url(a.png)",
    "var(--c)",
    "rgb(1 2 3)) , url(a.png",
    "#12345",
    "",
  ]) {
    assert.equal(
      gradientCss({ stops: [{ color, pos: 0 }, ...RED_BLUE.stops] }),
      "linear-gradient(in oklch to right, red 0%, blue 100%)",
      JSON.stringify(color),
    );
    assert.equal(
      gradientStops({ stops: [{ color, pos: 0 }, ...RED_BLUE.stops] }),
      "red 0%, blue 100%",
      JSON.stringify(color),
    );
  }
  await new Promise((r) => setTimeout(r, 0)); // the warning's words load with the lazy chunk
  assert.ok(warn.mock.calls.some((c) => /skipped 1 of 3 stops without a CSS color/.test(c.arguments[0])));
  // Every color the editor's picker writes still passes, legacy commas and color-mix() included.
  const kept = [
    "#1E40AF",
    "#fff8",
    "rebeccapurple",
    "rgba(10, 20, 30, 0.5)",
    "oklch(62% 0.005 none)",
    "color(display-p3 1 0 0 / 50%)",
    "color-mix(in oklch, red 40%, blue)",
  ];
  assert.equal(
    gradientStops({ stops: kept.map((color, i) => ({ color, pos: i / 10 })) }),
    kept.map((c, i) => `${c} ${i * 10}%`).join(", "),
  );
  for (const interpolation of ["junk", 5, "oklch) , url(a.png", "srgb longer hue", null]) {
    assert.match(
      gradientCss({ ...RED_BLUE, interpolation }),
      /^linear-gradient\(in oklch to right, /,
      JSON.stringify(interpolation),
    );
    assert.ok(
      gradientStops({ ...RED_BLUE, interpolation, easing: "ease" }).includes("color-mix(in oklch, red, blue "),
      JSON.stringify(interpolation),
    );
  }
  for (const interpolation of ["srgb", "display-p3", "rec2020", "hsl longer hue", "oklch increasing hue"])
    assert.match(
      gradientCss({ ...RED_BLUE, interpolation }),
      new RegExp(`^linear-gradient\\(in ${interpolation} to right, `),
    );
});
