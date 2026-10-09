/* Hostile stored input — values that arrive through a schema, set(), fromJSON() or a
 * persisted restore and used to hang the panel or reach a style unescaped. Each test
 * failed on the pre-fix source with the symptom named in its comment. The hang tests
 * run in a timed child process: an in-process assertion can't observe a loop that
 * never returns. The rest run the built single-file bundle under jsdom, like panel.test. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));

const SETUP = new URL("./_setup-dom.mjs", import.meta.url).href;
const DIST = new URL("../dist/tweaks.js", import.meta.url).href;
const BUNDLE = new URL("./_bundle.mjs", import.meta.url).href;
// Run an ES-module snippet in a child node, killed after 5 s. Returns the result for the
// caller to assert on (exit 0 and no signal = it finished).
const child = (code) => spawnSync(process.execPath, ["--input-type=module", "-e", code], { timeout: 5000, encoding: "utf8" });
const finished = (r, what) => {
  assert.equal(r.signal, null, `${what}: the child was killed (${r.signal}) — it never finished\n${r.stderr}`);
  assert.equal(r.status, 0, `${what}: the child exited ${r.status}\n${r.stderr}`);
};

test("an infinite chroma can't hang the color control — schema, set(), or fromJSON()", () => {
  // Pre-fix: the child hangs in toGamut's bisection (max = Infinity) and is killed by
  // the 5 s timeout: signal SIGTERM, status null.
  const r = child(`
    await import(${JSON.stringify(SETUP)});
    const { tweaks } = await import(${JSON.stringify(DIST)});
    const p = tweaks("H", { c: { type: "color", value: "oklch(0.5 1e999 0)" }, z: [1, 0, 10, 1] });
    if (!/^oklch\\(/.test(String(p.params.c))) throw new Error("schema value: " + p.params.c);
    for (const v of ["oklab(0.5 1e999 -1e999)", "lch(50 1e999 0)", "color(srgb 1e999 0 0)", "oklch(0.5 1e999 0 / 50%)"]) {
      p.set("c", v);
      if (!Number.isFinite(parseFloat(String(p.params.c).split(" ")[1]))) throw new Error("set(" + v + "): " + p.params.c);
    }
    p.fromJSON({ values: { c: "oklch(0.5 1e999 0)", z: 2 } });
    if (p.params.z !== 2) throw new Error("the restore didn't land after the bad color");
  `);
  finished(r, "infinite chroma");
});

test("the engine bails out of an unbounded gamut map instead of bisecting forever", () => {
  // Pre-fix: num() passed Infinity through (only NaN was caught) and toGamut's loop
  // never ended — the child is killed by the timeout.
  const r = child(`
    const { bundle } = await import(${JSON.stringify(BUNDLE)});
    const { toGamut, num, oklchToHex } = await bundle("src/wide-gamut.ts");
    const rgb = toGamut([0.5, Infinity, 0], "srgb");
    if (!rgb.every(Number.isFinite)) throw new Error("toGamut: " + rgb);
    if (!/^#[0-9a-f]{6}$/.test(oklchToHex(0.5, Infinity, 120))) throw new Error("hex: " + oklchToHex(0.5, Infinity, 120));
    if (num(Infinity) !== 0 || num(-Infinity) !== 0 || num(NaN) !== 0 || num(null) !== 0) throw new Error("num() passes a non-finite value");
    if (num(0.25) !== 0.25) throw new Error("num() damaged a finite value");
  `);
  finished(r, "toGamut with infinite chroma");
});

// Exactly one color token: a hex, a keyword, or one function with no nested parens.
const ONE_TOKEN = /^(#[0-9a-f]{3,8}|[a-z][a-z-]*(?:\([\w\s.,%+\-\/]*\))?)$/i;
const HOSTILE_STOP = "red 0%), url(https://x/p.png), linear-gradient(red";
const gradCss = (p) => String(p.el.querySelector(".tw-gradient-grad").style.background);

test("a gradient stop that isn't a single color token never reaches the preview's CSS", () => {
  // Pre-fix: the stop's text was concatenated as-is, and the preview's background became
  // three layers — the gradient, a url() fetch, and a second gradient. Params carried it too.
  const p = tweaks("G1", { g: { type: "gradient", value: [["#ff0000", 0], [HOSTILE_STOP, 0.5], ["#0000ff", 1]] } });
  assert.ok(p.params.g, "the control built");
  for (const s of p.params.g.stops) assert.match(s.color, ONE_TOKEN, `stop reached params: ${s.color}`);
  assert.equal(p.params.g.stops.length, 2, "the hostile stop is dropped, the two good ones stay");
  assert.doesNotMatch(gradCss(p), /url\(/, "no url() layer in the preview");
  assert.equal(gradCss(p).split("linear-gradient(").length - 1, 1, "exactly one gradient layer");

  // The same through set() and fromJSON() (the persisted-state and preset paths).
  p.set("g", { stops: [{ color: "#00ff00", pos: 0 }, { color: HOSTILE_STOP, pos: 0.3 }, { color: "#000000", pos: 1 }], interpolation: "srgb" });
  assert.equal(p.params.g.stops.length, 2);
  assert.doesNotMatch(gradCss(p), /url\(/);
  p.fromJSON({ values: { g: [["oklch(0.7 0.1 20)", 0], ["url(https://x/p.png)", 0.5], ["#fff", 1]] } });
  assert.equal(p.params.g.stops.length, 2);
  assert.doesNotMatch(gradCss(p), /url\(/);

  // Fewer than two usable stops falls back to the default pair, never to an empty ramp.
  p.set("g", [[HOSTILE_STOP, 0], ["#fff) , url(https://x/q.png", 1]]);
  assert.equal(p.params.g.stops.length, 2);
  for (const s of p.params.g.stops) assert.match(s.color, ONE_TOKEN);
  assert.doesNotMatch(gradCss(p), /url\(/);
});

test("a hostile first stop is dropped too, and a keyword stop still builds without a canvas", () => {
  // Pre-fix: the first stop seeds the picker body, whose sRGB-family parse ran into
  // jsdom's missing 2D context and threw — the whole control was skipped (params.g
  // undefined), so under jsdom the injection hid behind a TypeError.
  const p = tweaks("G0", { g: { type: "gradient", value: [[HOSTILE_STOP, 0], ["#0000ff", 1], ["red", 0.5]] } });
  assert.ok(p.params.g, "the control built");
  assert.deepEqual(p.params.g.stops.map((s) => s.color), ["red", "#0000ff"], "sorted by position, the hostile stop gone");
  assert.doesNotMatch(gradCss(p), /url\(/);
});

// Count the comma-separated layers of a CSS value, honoring quoted strings and escapes.
const layers = (css) => {
  let n = 1, q = null;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (q) { if (c === "\\") i++; else if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === ",") n++;
  }
  return n;
};

test("an image value is escaped as a CSS string — one url(), however it's shaped", () => {
  // Pre-fix: the value closed the url("…") itself, and the thumbnail's background-image
  // became two layers: url("a.png"), url("https://x/p.png").
  const BAD = 'a.png"), url("https://x/p.png';
  const p = tweaks("I", { img: { type: "image", value: BAD } });
  const thumb = p.el.querySelector(".tw-image-thumb");
  assert.equal(layers(thumb.style.backgroundImage), 1, `got ${thumb.style.backgroundImage}`);
  assert.match(thumb.style.backgroundImage, /^url\("a\.png\\"\), url\(\\"https:\/\/x\/p\.png"\)$/);
  assert.equal(p.params.img, BAD, "the value itself is untouched — only the style is escaped");

  // set() takes the same path; a backslash and a newline can't end the string early either.
  p.set("img", 'x\\"), url("https://x/q.png');
  assert.equal(layers(thumb.style.backgroundImage), 1, `got ${thumb.style.backgroundImage}`);
  p.set("img", "a.png\n), url(https://x/r.png)");
  assert.equal(layers(thumb.style.backgroundImage), 1, `got ${thumb.style.backgroundImage}`);
  assert.doesNotMatch(thumb.style.backgroundImage, /\n/);

  // A plain URL still shows as one — that's what an image control legitimately holds.
  p.set("img", "https://example.com/a.png");
  assert.equal(thumb.style.backgroundImage, 'url("https://example.com/a.png")');
  p.set("img", "");
  assert.equal(thumb.style.backgroundImage, "");
});
