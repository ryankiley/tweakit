/* Schema defaults + labels against the built single-file bundle (dist/tweaks.js),
 * under jsdom. These pin what a verbose `{ type }` value derives when it leaves
 * things out — the range a bare value implies, the label every control shows (or
 * hides on an explicit ""), and the clamps the object-valued controls apply at
 * build, not only on set(). */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, distCss } from "./_helpers.mjs";

const { tweaks, enhance } = await loadSingle();
const css = distCss();

// Every class a control renders its own label into (not .tw-field-label — those are the
// inner captions of a picker's channels or a point's components, never the control's label).
const LABELS = ".tw-slider-label, .tw-row-label, .tw-select-label, .tw-radiogrid-label, .tw-trigger-label, .tw-fps-label, .tw-plot-label, .tw-spring-label, .tw-bezier-label, .tw-folder-title";
const labelText = (root) => [...root.querySelectorAll(LABELS)].map((e) => e.textContent);

test("a verbose slider / interval without min/max derives its range from the value, like the shorthand", () => {
  const p = tweaks("R", {
    s: { type: "slider", value: 50 },
    i: { type: "interval", value: [20, 80] },
    neg: { type: "slider", value: -5 },
    unit: { type: "slider", value: 0.5 },
  });
  assert.equal(p.params.s, 50);
  assert.deepEqual(p.params.i, [20, 80]);
  assert.equal(p.params.neg, -5);
  assert.equal(p.params.unit, 0.5);
  const [s, i0, i1] = p.el.querySelectorAll("[role=slider]");
  assert.equal(s.getAttribute("aria-valuemin"), "0");
  assert.equal(s.getAttribute("aria-valuemax"), "150"); // the shorthand's 0–3×value
  // The interval's ends each widen its range (0–240 for [20, 80]), so both handles can move out;
  // a range locked to the value tuple pinned them at the ends.
  for (const h of [i0, i1]) { assert.equal(h.getAttribute("aria-valuemin"), "0"); assert.equal(h.getAttribute("aria-valuemax"), "240"); }
  p.set("i", [0, 200]);
  assert.deepEqual(p.params.i, [0, 200]);
  // The markup path agrees: one meta derivation for every entry point.
  const host = document.createElement("div");
  host.innerHTML = '<div data-tw="slider" data-value="50"></div>';
  document.body.append(host); enhance(host);
  const m = host.querySelector("[role=slider]");
  assert.equal(m.getAttribute("aria-valuenow"), "50");
  assert.equal(m.getAttribute("aria-valuemax"), "150");
  host.remove();
  const ih = document.createElement("div");
  ih.innerHTML = '<div data-tw="interval" data-value="20,80"></div>';
  document.body.append(ih); enhance(ih);
  for (const h of ih.querySelectorAll("[role=slider]")) assert.equal(h.getAttribute("aria-valuemax"), "240");
  ih.remove();
});

test("a negative default spans either side of zero, so it can cross it", () => {
  const p = tweaks("N", { rotate: -45, nudge: -0.5, tilt: [-10], v: { type: "slider", value: -5 }, i: { type: "interval", value: [-20, 10] } });
  const [rotate, nudge, tilt, v, i0] = p.el.querySelectorAll("[role=slider]");
  const range = (h) => [h.getAttribute("aria-valuemin"), h.getAttribute("aria-valuemax")];
  assert.deepEqual(range(rotate), ["-135", "135"]);
  assert.deepEqual(range(nudge), ["-1", "1"]);
  assert.deepEqual(range(tilt), ["-30", "30"]);
  assert.deepEqual(range(v), ["-15", "15"]);
  assert.deepEqual(range(i0), ["-60", "60"]);
  p.set("rotate", 45);
  assert.equal(p.params.rotate, 45, "a positive value is in range now");
  p.destroy();
});

// -45 spans -135–135 in steps of 10 counted from -135 (…, -5, 5, …), so 0 was out of reach; 0.5.2's -135 to -5 couldn't reach it either.
test("an inferred step across zero puts 0 on the grid", () => {
  const p = tweaks("Zero", { a: -45, b: -25, c: [-45], d: { type: "slider", value: -45 }, e: [5, -15, 105], f: 45 });
  for (const k of ["a", "b", "c", "d", "e", "f"]) { p.set(k, 0); assert.equal(p.params[k], 0, `${k} reaches 0`); }
  p.set("a", -45); assert.equal(p.params.a, -45, "and its default");
  const i = tweaks("ZeroI", { r: { type: "interval", value: [-45, 15] } });
  i.set("r", [0, 15]); assert.deepEqual(i.params.r, [0, 15]);
  p.destroy(); i.destroy();
});

test("an inferred step fits the default, so a value is never snapped off what was written", () => {
  const p = tweaks("Fit", { neg: -23, dec: -2.3, size: 37, big: 1234, tup: [37, 0, 200], v: { type: "slider", value: -23 }, i: { type: "interval", value: [-23, 37] }, e: [[-2.3, 7.7], -10, 10], pi: 3.14159, round: 40 });
  assert.deepEqual([p.params.neg, p.params.dec, p.params.size, p.params.big, p.params.tup, p.params.v], [-23, -2.3, 37, 1234, 37, -23]);
  assert.deepEqual(p.params.i, [-23, 37]);
  assert.deepEqual(p.params.e, [-2.3, 7.7]);
  assert.equal(p.params.pi, 3.142, "a value finer than two tenths of the span's step still rounds");
  const [neg] = p.el.querySelectorAll("[role=slider]");
  assert.deepEqual([neg.getAttribute("aria-valuemin"), neg.getAttribute("aria-valuemax")], ["-69", "69"], "and the range stays whole");
  const round = [...p.el.querySelectorAll("[role=slider]")].at(-1); // 40 sits on the span's own grid: the step stays 10
  round.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(p.params.round, 50);
  p.destroy();
});

// 2.3 × 3 is 6.8999… in floating point, and the grid's top trimmed it to 6.8.
test("a derived range reaches three times the default, float error and all", () => {
  const p = tweaks("X3", { up: 2.3, down: -2.3, odd: 4.1 });
  const range = (h) => [h.getAttribute("aria-valuemin"), h.getAttribute("aria-valuemax")];
  assert.deepEqual([...p.el.querySelectorAll("[role=slider]")].map(range), [["0", "6.9"], ["-6.9", "6.9"], ["0", "12.3"]]);
  p.destroy();
});

test("an explicit min/max still wins over the derived range", () => {
  const p = tweaks("E", { s: { type: "slider", value: 50, min: 0, max: 10 }, i: { type: "interval", value: [2, 8], min: 0, max: 10 } });
  assert.equal(p.params.s, 10);
  assert.deepEqual(p.params.i, [2, 8]);
  assert.equal(p.el.querySelector("[role=slider]").getAttribute("aria-valuemax"), "10");
});

test("every verbose form honors `label`, and `label: \"\"` shows no label text", () => {
  const custom = {
    slider: { type: "slider", value: 0.5 },
    number: { type: "number", value: 1 },
    checkbox: { type: "checkbox", value: true },
    list: { type: "list", options: ["a", "b"] },
    radiogrid: { type: "radiogrid", options: ["a", "b"] },
    color: { type: "color", value: "#fff" },
    text: { type: "text", value: "hi" },
    interval: { type: "interval", value: [0.2, 0.8] },
    point: { type: "point", components: [{ key: "x" }, { key: "y" }] },
    gradient: { type: "gradient" },
    image: { type: "image" },
    plot: { type: "plot", expr: "x" },
    monitor: { type: "monitor", value: 1, view: "text" }, // text view: the sparkline's first-frame measure outlives destroy() and jsdom has no 2D context to give it
    fpsgraph: { type: "fpsgraph" },
    buttongroup: { type: "buttongroup", buttons: { Go() {} } },
  };
  const withLabel = (label) => Object.fromEntries(Object.entries(custom).map(([k, v]) => [k, { ...v, label: typeof label === "function" ? label(k) : label }]));
  // destroy() in finally: the monitor + FPS graph own loops that would otherwise keep
  // the process alive after a failed assertion.
  const p = tweaks("L", withLabel((k) => `Custom ${k}`));
  try {
    const shown = labelText(p.el);
    for (const k of Object.keys(custom)) assert.ok(shown.includes(`Custom ${k}`), `${k} should show its label (saw ${JSON.stringify(shown)})`);
    assert.equal(p.el.querySelector("[role=slider]").getAttribute("aria-label"), "Custom slider");
  } finally { p.destroy(); }

  const blank = tweaks("B", withLabel(""));
  try {
    const leaked = labelText(blank.el).filter((t) => t.trim() && t !== "Mode"); // the spring's mode row is the control's own caption, not its label
    assert.deepEqual(leaked, [], "an explicit empty label must not fall back to the title-cased key");
    // The empty label element takes no space: the stylesheet hides it, and the control it
    // sat beside keeps the row's right edge.
    assert.match(css, /\.tw-row-label:empty/);
    assert.match(css, /\.tw-trigger-label:empty/);
  } finally { blank.destroy(); }
});

test("the derived title-case label stays the default when `label` is undefined", () => {
  const p = tweaks("D", { blurRadius: { type: "slider", value: 0.5 }, tint: { type: "color", value: "#fff" } });
  const shown = labelText(p.el);
  assert.ok(shown.includes("Blur Radius"), JSON.stringify(shown));
  assert.ok(shown.includes("Tint"), JSON.stringify(shown));
});

test("spring and cubic-bezier render a label row", () => {
  const p = tweaks("S", { sp: { type: "spring", label: "Bouncy" }, bz: { type: "cubicbezier", label: "Ease" }, wobble: { type: "spring" } });
  assert.equal(p.el.querySelector(".tw-spring .tw-spring-label")?.textContent, "Bouncy");
  assert.equal(p.el.querySelector(".tw-bezier .tw-bezier-label")?.textContent, "Ease");
  const springLabels = [...p.el.querySelectorAll(".tw-spring-label")].map((e) => e.textContent);
  assert.deepEqual(springLabels, ["Bouncy", "Wobble"]); // two springs in one panel can be told apart
});

test("cubic-bezier clamps its initial value the way set() does", () => {
  const p = tweaks("Bz", { bz: { type: "cubicbezier", value: [1.5, 2, -0.2, -1] } });
  assert.deepEqual(p.params.bz, [1, 1.25, 0, -0.25]); // x to [0,1], y to the editor's range
  const fields = [...p.el.querySelectorAll(".tw-bezier .tw-num")].map((i) => +i.value);
  assert.deepEqual(fields, [1, 1.25, 0, -0.25]); // the fields agree with get()
});

test("a point without min/max/step is continuous, not a -1/0/1 grid", () => {
  const p = tweaks("Pt", { pt: { type: "point", components: [{ key: "x", value: 0.3 }, { key: "y", value: 0.47 }] } });
  assert.deepEqual(p.params.pt, { x: 0.3, y: 0.47 }); // a step of 1 used to round these to 0
  p.set("pt", { x: 0.37, y: -0.52 });
  assert.deepEqual(p.params.pt, { x: 0.37, y: -0.52 });
});

test("a point value outside the default pad range widens the range instead of pinning to the edge", () => {
  const p = tweaks("Pw", { pt: { type: "point", components: [{ key: "x", value: 0 }, { key: "y", value: 5 }] } });
  assert.deepEqual(p.params.pt, { x: 0, y: 5 });
  const thumb = p.el.querySelector(".tw-pad-thumb");
  const top = parseFloat(thumb.style.top);
  assert.ok(top > 0 && top < 50, `the thumb should sit inside the pad, above center (top=${thumb.style.top})`);
});

// A string option's label title-cases a camel hump ("fontSize" → "Font Size") and leaves a
// run of capitals or a digit before one alone ("XS", "2XL", "RGB" used to render "X S",
// "2 X L", "R G B").
test("string option labels: camel humps split, capital runs and digits do not", async () => {
  const p = tweaks("L", { size: { type: "radiogrid", options: ["XS", "2XL", "RGB", "fontSize", "small", "myURLParser", "level2Up"] } }); document.body.append(p.el); await p.ready;
  assert.deepEqual([...p.el.querySelectorAll(".tw-radiogrid-btn")].map((b) => b.textContent), ["XS", "2XL", "RGB", "Font Size", "Small", "My URL Parser", "Level2 Up"]);
  p.destroy();
});

// A typo in `type` built a folder of `type` and `value` rows without a word.
test("an unknown type warns, naming the near type and the real ones; it still builds a folder, as a child named type may mean", async () => {
  const warn = console.warn, msgs = []; console.warn = (...a) => msgs.push(a.join(" "));
  try {
    const p = tweaks("Types", { typo: { type: "slidr", value: 1 }, font: { type: "Inter", size: [12, 8, 40, 1] } });
    assert.deepEqual(p.params.font, { type: "Inter", size: 12 });
    await new Promise((r) => setTimeout(r, 20)); // the message comes from a lazy chunk
    assert.ok(msgs.some((m) => m.includes('"typo": "slidr" isn\'t a control type — did you mean "slider"?') && m.includes("Types: button")));
    assert.ok(msgs.some((m) => m.includes('"font": "Inter" isn\'t a control type. It builds a folder')));
    p.destroy();
  } finally { console.warn = warn; }
});

// An inverted pair swaps, which is right, but silently: { min: 10, max: 0 } and data-min="40" data-max="0" built quietly.
test("a min above max still swaps, and says so", async () => {
  const warn = console.warn, msgs = []; console.warn = (...a) => msgs.push(a.join(" "));
  try {
    const p = tweaks("Inv", { s: { type: "slider", value: 5, min: 10, max: 0 }, r: { type: "interval", value: [2, 4], min: 9, max: 1 }, ok: { type: "slider", value: 5, min: 0, max: 10 } });
    await p.ready;
    const h = p.el.querySelector("[role=slider]");
    assert.deepEqual([h.getAttribute("aria-valuemin"), h.getAttribute("aria-valuemax")], ["0", "10"]);
    assert.ok(msgs.some((m) => m.includes('"S": min 10 is above max 0, so they were swapped')));
    assert.ok(msgs.some((m) => m.includes('"R": min 9 is above max 1')));
    assert.equal(msgs.filter((m) => m.includes("swapped")).length, 2, "a pair in order says nothing");
    p.destroy();
  } finally { console.warn = warn; }
});

// ── Ranges and steps: a default the author wrote comes back unchanged, the range holds it, and a key steps the inferred grid. ──
const press = (el, key = "ArrowRight") => el.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const ends = (h) => [h.getAttribute("aria-valuemin"), h.getAttribute("aria-valuemax")];
const sliders = (p) => [...p.el.querySelectorAll("[role=slider]")];

// -1 ≤ v < 0 spans -1–1, a span of 2, and stepped by 0.1 where 0.5 steps by 0.01; -30's -90–90 stepped by 10 where 30's by 1.
test("a negative's derived range steps like its positive twin", () => {
  const p = tweaks("Mirror", { nudge: -0.5, half: 0.5, two: -2, thirty: -30, v: { type: "slider", value: -0.5 } });
  assert.deepEqual([p.params.nudge, p.params.half, p.params.two, p.params.thirty, p.params.v], [-0.5, 0.5, -2, -30, -0.5]);
  const [nudge, half, two, thirty, v] = sliders(p);
  assert.deepEqual([ends(nudge), ends(two), ends(thirty), ends(v)], [["-1", "1"], ["-6", "6"], ["-90", "90"], ["-1", "1"]]);
  for (const h of [nudge, half, two, thirty, v]) press(h);
  assert.deepEqual([p.params.nudge, p.params.half, p.params.two, p.params.thirty, p.params.v], [-0.49, 0.51, -1.9, -29, -0.49]);
  p.set("nudge", 0); assert.equal(p.params.nudge, 0, "0 stays on the grid");
  p.destroy();
});

// The grid is anchored at min rounded to the step's decimals: 0.25 over a step of 0.1 anchored at 0.3, so 1.25 came back 1.2.
test("an inferred step fits the min too, and the max when a finer step reaches it", async () => {
  const p = tweaks("Anchor", { a: [1.25, 0.25, 4], b: [3.25, 0.25, 50], c: [0.375, 0.125, 1], d: [1, 0, 2.25], i: [[1.25, 2.25], 0.25, 4] });
  await p.ready;
  assert.deepEqual([p.params.a, p.params.b, p.params.c, p.params.d], [1.25, 3.25, 0.375, 1]);
  assert.deepEqual(p.params.i, [1.25, 2.25]);
  const [a, b, c, d, i0, i1] = sliders(p);
  assert.deepEqual([ends(a), ends(b), ends(c), ends(d), ends(i0), ends(i1)], [["0.25", "4"], ["0.25", "50"], ["0.125", "1"], ["0", "2.25"], ["0.25", "4"], ["0.25", "4"]]);
  for (const h of [a, b, c, d, i0]) press(h);
  assert.deepEqual([p.params.a, p.params.b, p.params.c, p.params.d], [1.26, 3.26, 0.376, 1.01]);
  assert.deepEqual(p.params.i, [1.26, 2.25]);
  p.destroy();
});

// 0.1 * 3 is 0.30000000000000004; its grid's first point, 0.3, sat a hair under it and the trim moved the floor to 0.31.
test("float noise in a bound doesn't cost a step", async () => {
  const p = tweaks("Noise", { s: [0.3, 0.1 * 3, 1], i: [[0.1 + 0.2, 0.7]], j: [[0.3, 0.7], 0.1 * 3, 1] });
  await p.ready;
  assert.equal(p.params.s, 0.3);
  assert.deepEqual([p.params.i, p.params.j], [[0.3, 0.7], [0.3, 0.7]]);
  const [s, i0, , j0] = sliders(p);
  assert.deepEqual([ends(s), ends(i0), ends(j0)], [["0.3", "1"], ["0", "1"], ["0.3", "1"]]);
  press(s); press(i0); press(j0);
  assert.deepEqual([p.params.s, p.params.i, p.params.j], [0.31, [0.31, 0.7], [0.31, 0.7]]);
  p.destroy();
});

// The number control's step defaulted to 1, so 0.5 came back 1 and 3.14159 came back 3, from a schema and from markup.
test("a number with no step infers one its default sits on, 1 for a whole number", async () => {
  const p = tweaks("Num", { half: { type: "number", value: 0.5 }, pi: { type: "number", value: 3.14159 }, whole: { type: "number", value: 7 }, given: { type: "number", value: 0.5, step: 1 } });
  await p.ready;
  assert.deepEqual([p.params.half, p.params.pi, p.params.whole, p.params.given], [0.5, 3.14159, 7, 1], "an explicit step still wins");
  const [half, pi, whole] = p.el.querySelectorAll(".tw-num");
  press(half, "ArrowUp"); press(pi, "ArrowUp"); press(whole, "ArrowUp");
  assert.deepEqual([p.params.half, p.params.pi, p.params.whole], [0.6, 3.1416, 8]);
  p.destroy();
  const host = document.createElement("div");
  host.innerHTML = '<div data-tw="number" data-value="0.5"></div>';
  document.body.append(host); await enhance(host);
  assert.equal(host.querySelector(".tw-num").value, "0.5");
  host.remove();
});

// A point's step was the decade at or below range/200, whatever the default: 337 over ±1011 stepped by 10 to 340.
test("a point component's derived step keeps its default", async () => {
  const p = tweaks("PtStep", { pt: { type: "point", components: [{ key: "a", value: 337 }, { key: "b", value: 1234 }, { key: "c", value: 3.14159 }] } });
  await p.ready;
  assert.deepEqual(p.params.pt, { a: 337, b: 1234, c: 3.14159 });
  const [a] = p.el.querySelectorAll(".tw-point .tw-num");
  press(a, "ArrowUp");
  assert.equal(p.params.pt.a, 338);
  p.destroy();
});

// The shorthand fell back to the tuple itself, pinning both handles at the ends, while the verbose form and markup derived a range.
test("the interval shorthand derives missing bounds as the verbose form does; given ones still win", async () => {
  const p = tweaks("IvShort", { a: [[20, 80]], b: { type: "interval", value: [20, 80] }, c: [[-20, 10]], d: { type: "interval", value: [-20, 10] }, e: [[20, 80], 10, 90, 5] });
  await p.ready;
  const hs = sliders(p);
  assert.deepEqual(hs.filter((_, k) => k % 2 === 0).map(ends), [["0", "240"], ["0", "240"], ["-60", "60"], ["-60", "60"], ["10", "90"]]);
  for (const k of [0, 2, 4, 6, 8]) press(hs[k]);
  assert.deepEqual([p.params.a, p.params.b, p.params.c, p.params.d, p.params.e], [[30, 80], [30, 80], [-19, 10], [-19, 10], [25, 80]]);
  p.destroy();
});

// [5, NaN] inferred a step of 10 on a NaN span, and 5 rounded to 10 over 0–10; [5, 20] inferred 0.01 over 15–20.
test("a bound that isn't a number derives, and the step infers after the range is whole", async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const p = tweaks("Hostile", { a: [5, NaN], b: [5, "abc"], c: { type: "slider", value: 5, min: NaN }, d: [5, 20], e: [-5, NaN] });
    assert.deepEqual([p.params.a, p.params.b, p.params.c, p.params.e], [5, 5, 5, -5]);
    const hs = sliders(p);
    assert.deepEqual(hs.map(ends), [["0", "15"], ["0", "15"], ["0", "15"], ["15", "20"], ["-15", "15"]]);
    for (const h of hs) press(h);
    assert.deepEqual([p.params.a, p.params.b, p.params.c, p.params.d, p.params.e], [6, 6, 6, 15.1, -4]);
    p.destroy();
  } finally { console.warn = warn; }
});

test("the interval takes PageUp and PageDown, a tenth of its range", async () => {
  const p = tweaks("IvPage", { r: [[20, 60], 0, 100] });
  await p.ready;
  const [lo, hi] = sliders(p);
  press(lo, "PageUp"); assert.deepEqual(p.params.r, [30, 60]);
  press(hi, "PageDown"); assert.deepEqual(p.params.r, [30, 50]);
  press(lo, "PageUp"); press(lo, "PageUp"); assert.deepEqual(p.params.r, [50, 50], "a handle stops at the other");
  p.destroy();
});

// defaultRange(NaN) was NaN–NaN: a bare NaN got 0–100 by 10, where a verbose one got 0–1 by 0.01.
test("a non-finite default reads as 0 everywhere", () => {
  const p = tweaks("NaN", { a: NaN, b: { type: "slider", value: NaN }, c: [Infinity] });
  assert.deepEqual([p.params.a, p.params.b, p.params.c], [0, 0, 0]);
  const hs = sliders(p);
  assert.deepEqual(hs.map(ends), [["0", "1"], ["0", "1"], ["0", "1"]]);
  for (const h of hs) press(h);
  assert.deepEqual([p.params.a, p.params.b, p.params.c], [0.01, 0.01, 0.01]);
  p.destroy();
});

// { type: "bezier" } and { type: "toggle" } built folders, the bezier's curve mangled into a slider, where the source file is
// bezier.ts and the checkbox draws as an Off/On toggle.
test("bezier, toggle and switch name the cubicbezier and checkbox controls, in a schema and in markup", async () => {
  const p = tweaks("Alias", { back: { type: "bezier", value: [0.42, 0, 0.58, 1] }, on: { type: "toggle", value: true }, flag: { type: "switch" } });
  await p.ready;
  assert.deepEqual(p.params, { back: [0.42, 0, 0.58, 1], on: true, flag: false });
  const host = document.createElement("div"); host.dataset.tw = "toggle"; host.dataset.checked = "true"; document.body.append(host);
  try { await enhance(host); assert.equal(host._tw.ctrl.get(), true); } finally { host.remove(); }
  p.destroy();
});
