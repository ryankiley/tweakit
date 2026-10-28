/* Schema defaults + labels against the built single-file bundle (dist/tweaks.js),
 * under jsdom. These pin what a verbose `{ type }` value derives when it leaves
 * things out — the range a bare value implies, the label every control shows (or
 * hides on an explicit ""), and the clamps the object-valued controls apply at
 * build, not only on set(). */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, distCss, wait, quiet, warnings } from "./_helpers.mjs";

const { tweaks, enhance } = await loadSingle();
const css = distCss();

// Every class a control renders its own label into (not .twk-field-label — those are the
// inner captions of a picker's channels or a point's components, never the control's label).
const LABELS =
  ".twk-slider-label, .twk-row-label, .twk-select-label, .twk-radiogrid-label, .twk-trigger-label, .twk-fps-label, .twk-plot-label, .twk-spring-label, .twk-bezier-label, .twk-folder-title";
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
  for (const h of [i0, i1]) {
    assert.equal(h.getAttribute("aria-valuemin"), "0");
    assert.equal(h.getAttribute("aria-valuemax"), "240");
  }
  p.set("i", [0, 200]);
  assert.deepEqual(p.params.i, [0, 200]);
  // The markup path agrees: one meta derivation for every entry point.
  const host = document.createElement("div");
  host.innerHTML = '<div data-twk="slider" data-value="50"></div>';
  document.body.append(host);
  enhance(host);
  const m = host.querySelector("[role=slider]");
  assert.equal(m.getAttribute("aria-valuenow"), "50");
  assert.equal(m.getAttribute("aria-valuemax"), "150");
  host.remove();
  const ih = document.createElement("div");
  ih.innerHTML = '<div data-twk="interval" data-value="20,80"></div>';
  document.body.append(ih);
  enhance(ih);
  for (const h of ih.querySelectorAll("[role=slider]")) assert.equal(h.getAttribute("aria-valuemax"), "240");
  ih.remove();
});

test("a negative default spans either side of zero, so it can cross it", () => {
  const p = tweaks("N", {
    rotate: -45,
    nudge: -0.5,
    tilt: [-10],
    v: { type: "slider", value: -5 },
    i: { type: "interval", value: [-20, 10] },
  });
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

// -45 spans -135–135 in steps of 10 counted from -135 (…, -5, 5, …), so 0 was out of reach; 0.5.2's -135 to -5 couldn't
// reach it either.
test("an inferred step across zero puts 0 on the grid", () => {
  const p = tweaks("Zero", { a: -45, b: -25, c: [-45], d: { type: "slider", value: -45 }, e: [5, -15, 105], f: 45 });
  for (const k of ["a", "b", "c", "d", "e", "f"]) {
    p.set(k, 0);
    assert.equal(p.params[k], 0, `${k} reaches 0`);
  }
  p.set("a", -45);
  assert.equal(p.params.a, -45, "and its default");
  const i = tweaks("ZeroI", { r: { type: "interval", value: [-45, 15] } });
  i.set("r", [0, 15]);
  assert.deepEqual(i.params.r, [0, 15]);
  p.destroy();
  i.destroy();
});

test("an inferred step fits the default, so a value is never snapped off what was written", () => {
  const p = tweaks("Fit", {
    neg: -23,
    dec: -2.3,
    size: 37,
    big: 1234,
    tup: [37, 0, 200],
    v: { type: "slider", value: -23 },
    i: { type: "interval", value: [-23, 37] },
    e: [[-2.3, 7.7], -10, 10],
    pi: 3.14159,
    round: 40,
  });
  assert.deepEqual(
    [p.params.neg, p.params.dec, p.params.size, p.params.big, p.params.tup, p.params.v],
    [-23, -2.3, 37, 1234, 37, -23],
  );
  assert.deepEqual(p.params.i, [-23, 37]);
  assert.deepEqual(p.params.e, [-2.3, 7.7]);
  assert.equal(p.params.pi, 3.142, "a value finer than two tenths of the span's step still rounds");
  const [neg] = p.el.querySelectorAll("[role=slider]");
  assert.deepEqual(
    [neg.getAttribute("aria-valuemin"), neg.getAttribute("aria-valuemax")],
    ["-69", "69"],
    "and the range stays whole",
  );
  const round = [...p.el.querySelectorAll("[role=slider]")].at(-1); // 40 sits on the span's own grid: the step stays 10
  round.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(p.params.round, 50);
  p.destroy();
});

// The bands' finest step is 0.0001, so a written span under it had a step past its own width and collapsed to 0–0.
test("an explicit range narrower than the finest band steps within itself", () => {
  const p = tweaks("Tiny", { t: [5e-6, 0, 1e-5], i: [[2e-6, 8e-6], 0, 1e-5], keep: [0.0003, 0, 0.001] });
  const [t, i0, i1, keep] = p.el.querySelectorAll("[role=slider]");
  assert.equal(p.params.t, 5e-6);
  assert.deepEqual([t.getAttribute("aria-valuemin"), t.getAttribute("aria-valuemax")], ["0", "0.00001"]);
  assert.deepEqual(p.params.i, [2e-6, 8e-6]);
  for (const h of [i0, i1]) assert.equal(h.getAttribute("aria-valuemax"), "0.00001");
  p.set("t", 7e-6);
  assert.equal(p.params.t, 7e-6);
  t.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.ok(p.params.t > 7e-6 && p.params.t <= 1e-5, `an arrow moves within the span (${p.params.t})`);
  assert.equal(keep.getAttribute("aria-valuemax"), "0.001", "a span the bands reach steps as before");
  p.set("keep", 0.00042);
  assert.equal(p.params.keep, 0.0004);
  p.destroy();
});

// 2.3 × 3 is 6.8999… in floating point, and the grid's top trimmed it to 6.8.
test("a derived range reaches three times the default, float error and all", () => {
  const p = tweaks("X3", { up: 2.3, down: -2.3, odd: 4.1 });
  const range = (h) => [h.getAttribute("aria-valuemin"), h.getAttribute("aria-valuemax")];
  assert.deepEqual([...p.el.querySelectorAll("[role=slider]")].map(range), [
    ["0", "6.9"],
    ["-6.9", "6.9"],
    ["0", "12.3"],
  ]);
  p.destroy();
});

test("an explicit min/max still wins over the derived range", () => {
  const p = tweaks("E", {
    s: { type: "slider", value: 50, min: 0, max: 10 },
    i: { type: "interval", value: [2, 8], min: 0, max: 10 },
  });
  assert.equal(p.params.s, 10);
  assert.deepEqual(p.params.i, [2, 8]);
  assert.equal(p.el.querySelector("[role=slider]").getAttribute("aria-valuemax"), "10");
});

test('every verbose form honors `label`, and `label: ""` shows no label text', () => {
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
    // text view: the sparkline's first-frame measure outlives destroy() and jsdom has no 2D context to give it
    monitor: { type: "monitor", value: 1, view: "text" },
    fpsgraph: { type: "fpsgraph" },
    buttongroup: { type: "buttongroup", buttons: { Go() {} } },
  };
  const withLabel = (label) =>
    Object.fromEntries(
      Object.entries(custom).map(([k, v]) => [k, { ...v, label: typeof label === "function" ? label(k) : label }]),
    );
  // destroy() in finally: the monitor + FPS graph own loops that would otherwise keep
  // the process alive after a failed assertion.
  const p = tweaks(
    "L",
    withLabel((k) => `Custom ${k}`),
  );
  try {
    const shown = labelText(p.el);
    for (const k of Object.keys(custom))
      assert.ok(shown.includes(`Custom ${k}`), `${k} should show its label (saw ${JSON.stringify(shown)})`);
    assert.equal(p.el.querySelector("[role=slider]").getAttribute("aria-label"), "Custom slider");
  } finally {
    p.destroy();
  }

  const blank = tweaks("B", withLabel(""));
  try {
    // the spring's mode row is the control's own caption, not its label
    const leaked = labelText(blank.el).filter((t) => t.trim() && t !== "Mode");
    assert.deepEqual(leaked, [], "an explicit empty label must not fall back to the title-cased key");
    // The empty label element takes no space: the stylesheet hides it, and the control it
    // sat beside keeps the row's right edge.
    assert.match(css, /\.twk-row-label:empty/);
    assert.match(css, /\.twk-trigger-label:empty/);
  } finally {
    blank.destroy();
  }
});

test("the derived title-case label stays the default when `label` is undefined", () => {
  const p = tweaks("D", { blurRadius: { type: "slider", value: 0.5 }, tint: { type: "color", value: "#fff" } });
  const shown = labelText(p.el);
  assert.ok(shown.includes("Blur Radius"), JSON.stringify(shown));
  assert.ok(shown.includes("Tint"), JSON.stringify(shown));
});

test("spring and cubic-bezier render a label row", () => {
  const p = tweaks("S", {
    sp: { type: "spring", label: "Bouncy" },
    bz: { type: "cubicbezier", label: "Ease" },
    wobble: { type: "spring" },
  });
  assert.equal(p.el.querySelector(".twk-spring .twk-spring-label")?.textContent, "Bouncy");
  assert.equal(p.el.querySelector(".twk-bezier .twk-bezier-label")?.textContent, "Ease");
  const springLabels = [...p.el.querySelectorAll(".twk-spring-label")].map((e) => e.textContent);
  assert.deepEqual(springLabels, ["Bouncy", "Wobble"]); // two springs in one panel can be told apart
});

test("cubic-bezier clamps its initial value the way set() does", () => {
  const p = tweaks("Bz", { bz: { type: "cubicbezier", value: [1.5, 3, -0.2, -2] } });
  assert.deepEqual(p.params.bz, [1, 2, 0, -1]); // x to [0,1], y to the editor's range, −1 to 2
  const fields = [...p.el.querySelectorAll(".twk-bezier .twk-num")].map((i) => +i.value);
  assert.deepEqual(fields, [1, 2, 0, -1]); // the fields agree with get()
});

test("a point without min/max/step is continuous, not a -1/0/1 grid", () => {
  const p = tweaks("Pt", {
    pt: {
      type: "point",
      components: [
        { key: "x", value: 0.3 },
        { key: "y", value: 0.47 },
      ],
    },
  });
  assert.deepEqual(p.params.pt, { x: 0.3, y: 0.47 }); // a step of 1 used to round these to 0
  p.set("pt", { x: 0.37, y: -0.52 });
  assert.deepEqual(p.params.pt, { x: 0.37, y: -0.52 });
});

test("a point value outside the default pad range widens the range instead of pinning to the edge", () => {
  const p = tweaks("Pw", {
    pt: {
      type: "point",
      components: [
        { key: "x", value: 0 },
        { key: "y", value: 5 },
      ],
    },
  });
  assert.deepEqual(p.params.pt, { x: 0, y: 5 });
  const thumb = p.el.querySelector(".twk-pad-thumb");
  const top = parseFloat(thumb.style.top);
  assert.ok(top > 0 && top < 50, `the thumb should sit inside the pad, above center (top=${thumb.style.top})`);
});

// A string option is text the author wrote, so it shows as written: title-casing made "sRGB"
// "S RGB", "macOS" "Mac OS" and "px" "Px". Its value is the same string either way.
test("string option labels show as written, in every option control and in markup", async () => {
  const opts = ["sRGB", "display-p3", "iOS", "macOS", "px", "fontSize", "XS"];
  for (const type of ["radiogrid", "segmented", "list"]) {
    const p = tweaks("L", { space: { type, options: opts, value: "px" } });
    document.body.append(p.el);
    await p.ready;
    const shown = [...p.el.querySelectorAll(".twk-radiogrid-btn, .twk-seg-btn, .twk-select-option")].map(
      (b) => b.textContent,
    );
    assert.deepEqual(shown, opts, type);
    assert.equal(p.params.space, "px", "the value is unchanged");
    p.destroy();
  }
  const host = document.createElement("div");
  host.innerHTML = '<div data-twk="radiogrid" data-key="space" data-options="sRGB,display-p3,px"></div>';
  document.body.append(host);
  enhance(host);
  assert.deepEqual(
    [...host.querySelectorAll(".twk-radiogrid-btn")].map((b) => b.textContent),
    ["sRGB", "display-p3", "px"],
  );
  host.remove();
});

// A key still becomes a label: camel humps split, a run of capitals or a digit before one does
// not ("XS", "2XL", "HTML Parser"), and a lowercase word ending in capitals is a name kept whole.
test("key labels: camel humps split, capital runs stay together, sRGB and macOS stay as written", async () => {
  const keys = {
    XS: 1,
    "2XL": 1,
    RGB: 1,
    fontSize: 1,
    small: 1,
    myURLParser: 1,
    level2Up: 1,
    HTMLParser: 1,
    x1: 1,
    offsetX: 1,
    sRGB: 1,
    iOS: 1,
    macOS: 1,
    aOK: 1,
  };
  const p = tweaks("K", keys);
  document.body.append(p.el);
  await p.ready;
  assert.deepEqual(
    [...p.el.querySelectorAll(".twk-slider-label")].map((l) => l.textContent),
    [
      "XS",
      "2XL",
      "RGB",
      "Font Size",
      "Small",
      "My URL Parser",
      "Level2 Up",
      "HTML Parser",
      "X1",
      "Offset X",
      "sRGB",
      "iOS",
      "macOS",
      "aOK",
    ],
  );
  p.destroy();
});

// Every lowercase word ending in capitals was kept whole, so showFPS and baseURL stayed raw, and a name opening a
// longer key split inside it ("iOSVersion" read "I OS Version").
test("key labels: a word ending in an acronym splits, and sRGB or iOS opening a key stays whole", async () => {
  const keys = {
    showFPS: 1,
    useHDR: 1,
    baseURL: 1,
    maxDPR: 1,
    enableGPU: 1,
    isOK: 1,
    useSRGB: 1,
    iOSVersion: 1,
    sRGBGamut: 1,
    macOSVersion: 1,
    tvOS: 1,
    watchOS: 1,
    iPadOS: 1,
    visionOS: 1,
  };
  const p = tweaks("K2", keys);
  document.body.append(p.el);
  await p.ready;
  assert.deepEqual(
    [...p.el.querySelectorAll(".twk-slider-label")].map((l) => l.textContent),
    [
      "Show FPS",
      "Use HDR",
      "Base URL",
      "Max DPR",
      "Enable GPU",
      "Is OK",
      "Use SRGB",
      "iOS Version",
      "sRGB Gamut",
      "macOS Version",
      "tvOS",
      "watchOS",
      "iPadOS",
      "visionOS",
    ],
  );
  p.destroy();
});

// A typo in `type` built a folder of `type` and `value` rows without a word.
test("an unknown type warns, naming the near type and the real ones; with no field a control reads, it still builds a folder", async () => {
  let p;
  const msgs = await warnings(() => {
    p = tweaks("Types", { typo: { type: "slidr", value: 1 }, font: { type: "Inter", size: [12, 8, 40, 1] } });
  });
  assert.deepEqual(p.params.font, { type: "Inter", size: 12 });
  assert.ok(
    msgs.some(
      (m) =>
        m.includes('"typo": "slidr" isn\'t a control type — did you mean "slider"? It is skipped') &&
        m.includes("Types: button, buttongroup"),
    ),
  );
  const types = msgs
    .find((m) => m.includes('"typo"'))
    .split("Types: ")[1]
    .split(", ");
  for (const t of ["segmented", "checkbox", "cubicbezier", "tabs"]) assert.ok(types.includes(t), `the list names ${t}`);
  assert.ok(!types.includes("colorpicker") && !types.includes("folder"), "and not the picker body or a folder");
  assert.ok(msgs.some((m) => m.includes('"font": "Inter" isn\'t a control type. It builds a folder')));
  p.destroy();
});

// { type: "bezier", value: [...] } built a folder whose value array read as a slider's [value, min, max] and warned of
// a swap, with no suggestion, as bezier is more than one edit from cubicbezier.
test("another library's type name is skipped with the type it means, and its value can't cascade into other warnings", async () => {
  let p;
  const msgs = await warnings(() => {
    p = tweaks("Syn", {
      b: { type: "bezier", value: [0.34, 1.56, 0.64, 1] },
      t: { type: "Toggle", value: true },
      d: { type: "dropdown", options: ["a", "b"] },
      s: { type: "select", options: ["a"], value: "a" },
      ok: 1,
    });
  });
  assert.deepEqual(Object.keys(p.params), ["ok"]);
  for (const [k, t, near] of [
    ["b", "bezier", "cubicbezier"],
    ["t", "Toggle", "checkbox"],
    ["d", "dropdown", "list"],
    ["s", "select", "list"],
  ])
    assert.ok(
      msgs.some((m) => m.includes(`"${k}": "${t}" isn't a control type — did you mean "${near}"? It is skipped`)),
      `${t} → ${near}`,
    );
  assert.equal(msgs.length, 4, "one warning each, and no swap");
  p.destroy();
});

// Names on Object.prototype ("toString", "constructor") read as registered controls and threw out of tweaks(), and a
// folder or the picker body, registered but not types to write, built or threw.
test("a type named like an Object method, folder or colorpicker is an unknown type, not a crash", async () => {
  let p;
  const msgs = await warnings(() => {
    p = tweaks("Proto", {
      a: { type: "toString", value: 1 },
      b: { type: "constructor", size: 12 },
      c: { type: "folder", n: 1 },
      d: { type: "colorpicker", value: "#fff" },
      ok: 1,
    });
  });
  assert.deepEqual(p.params, { b: { type: "constructor", size: 12 }, c: { type: "folder", n: 1 }, ok: 1 });
  for (const t of ["toString", "constructor", "folder", "colorpicker"])
    assert.ok(
      msgs.some((m) => m.includes(`"${t}" isn't a control type`)),
      t,
    );
  p.destroy();
});

// { type: "list", value: "a" } has no options, so the list handler returns nothing; it built a folder of type and value
// rows.
test("a known type missing its required field is skipped when it holds a value, and stays a folder when it doesn't", async () => {
  const errors = [],
    error = console.error;
  console.error = (...a) => errors.push(a.join(" "));
  try {
    const p = tweaks("Req", { l: { type: "list", value: "a" }, marker: { type: "point", size: 3 } });
    assert.deepEqual(p.params, { marker: { type: "point", size: 3 } });
    assert.deepEqual(errors, ['[tweaks] malformed "list" schema value for "l" — it needs options; control skipped']);
    p.destroy();
  } finally {
    console.error = error;
  }
});

// An inverted pair swaps, which is right, but silently: { min: 10, max: 0 } and data-min="40" data-max="0" built
// quietly.
test("a min above max still swaps, and says so", async () => {
  await warnings(async (msgs) => {
    const p = tweaks("Inv", {
      s: { type: "slider", value: 5, min: 10, max: 0 },
      r: { type: "interval", value: [2, 4], min: 9, max: 1 },
      ok: { type: "slider", value: 5, min: 0, max: 10 },
    });
    await p.ready;
    const h = p.el.querySelector("[role=slider]");
    assert.deepEqual([h.getAttribute("aria-valuemin"), h.getAttribute("aria-valuemax")], ["0", "10"]);
    await wait(10); // a notice's words come from a lazy chunk
    assert.ok(msgs.some((m) => m.includes('"S": min 10 is above max 0, so they were swapped')));
    assert.ok(msgs.some((m) => m.includes('"R": min 9 is above max 1')));
    assert.equal(msgs.filter((m) => m.includes("swapped")).length, 2, "a pair in order says nothing");
    p.destroy();
  });
});

// ── Ranges and steps: a default the author wrote comes back unchanged, the range holds it, and a key steps the inferred grid. ──
const press = (el, key = "ArrowRight") =>
  el.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const ends = (h) => [h.getAttribute("aria-valuemin"), h.getAttribute("aria-valuemax")];
const sliders = (p) => [...p.el.querySelectorAll("[role=slider]")];

// -1 ≤ v < 0 spans -1–1, a span of 2, and stepped by 0.1 where 0.5 steps by 0.01; -30's -90–90 stepped by 10 where 30's
// by 1.
test("a negative's derived range steps like its positive twin", () => {
  const p = tweaks("Mirror", { nudge: -0.5, half: 0.5, two: -2, thirty: -30, v: { type: "slider", value: -0.5 } });
  assert.deepEqual(
    [p.params.nudge, p.params.half, p.params.two, p.params.thirty, p.params.v],
    [-0.5, 0.5, -2, -30, -0.5],
  );
  const [nudge, half, two, thirty, v] = sliders(p);
  assert.deepEqual(
    [ends(nudge), ends(two), ends(thirty), ends(v)],
    [
      ["-1", "1"],
      ["-6", "6"],
      ["-90", "90"],
      ["-1", "1"],
    ],
  );
  for (const h of [nudge, half, two, thirty, v]) press(h);
  assert.deepEqual(
    [p.params.nudge, p.params.half, p.params.two, p.params.thirty, p.params.v],
    [-0.49, 0.51, -1.9, -29, -0.49],
  );
  p.set("nudge", 0);
  assert.equal(p.params.nudge, 0, "0 stays on the grid");
  p.destroy();
});

// The grid is anchored at min rounded to the step's decimals: 0.25 over a step of 0.1 anchored at 0.3, so 1.25 came
// back 1.2.
test("an inferred step fits the min too, and the max when a finer step reaches it", async () => {
  const p = tweaks("Anchor", {
    a: [1.25, 0.25, 4],
    b: [3.25, 0.25, 50],
    c: [0.375, 0.125, 1],
    d: [1, 0, 2.25],
    i: [[1.25, 2.25], 0.25, 4],
  });
  await p.ready;
  assert.deepEqual([p.params.a, p.params.b, p.params.c, p.params.d], [1.25, 3.25, 0.375, 1]);
  assert.deepEqual(p.params.i, [1.25, 2.25]);
  const [a, b, c, d, i0, i1] = sliders(p);
  assert.deepEqual(
    [ends(a), ends(b), ends(c), ends(d), ends(i0), ends(i1)],
    [
      ["0.25", "4"],
      ["0.25", "50"],
      ["0.125", "1"],
      ["0", "2.25"],
      ["0.25", "4"],
      ["0.25", "4"],
    ],
  );
  for (const h of [a, b, c, d, i0]) press(h);
  assert.deepEqual([p.params.a, p.params.b, p.params.c, p.params.d], [1.26, 3.26, 0.376, 1.01]);
  assert.deepEqual(p.params.i, [1.26, 2.25]);
  p.destroy();
});

// 0.1 * 3 is 0.30000000000000004; its grid's first point, 0.3, sat a hair under it and the trim moved the floor to
// 0.31.
test("float noise in a bound doesn't cost a step", async () => {
  const p = tweaks("Noise", { s: [0.3, 0.1 * 3, 1], i: [[0.1 + 0.2, 0.7]], j: [[0.3, 0.7], 0.1 * 3, 1] });
  await p.ready;
  assert.equal(p.params.s, 0.3);
  assert.deepEqual(
    [p.params.i, p.params.j],
    [
      [0.3, 0.7],
      [0.3, 0.7],
    ],
  );
  const [s, i0, , j0] = sliders(p);
  assert.deepEqual(
    [ends(s), ends(i0), ends(j0)],
    [
      ["0.3", "1"],
      ["0", "1"],
      ["0.3", "1"],
    ],
  );
  press(s);
  press(i0);
  press(j0);
  assert.deepEqual([p.params.s, p.params.i, p.params.j], [0.31, [0.31, 0.7], [0.31, 0.7]]);
  p.destroy();
});

// One written bound past the default: the other derived from the value alone and swapped in, so [5, 20] slid 15–20 with
// a warning about a max nobody wrote, and [10, 30] or { value: 2, min: 10 } couldn't slide at all.
test("a lone bound past the default derives the other from itself, so the range is never empty or swapped", async () => {
  await warnings(async (msgs) => {
    const p = tweaks("Lone", {
      a: [5, 20],
      b: [0.5, 1],
      c: [10, 30],
      d: [100, 300],
      e: { type: "slider", value: 2, min: 10 },
      f: [5, undefined, -3],
      g: [5, undefined, 0],
      h: [[20, 80], 500],
      i: [50, 10],
      j: [5, 10, 0],
      k: {
        type: "point",
        components: [
          { key: "x", value: 0, min: 5 },
          { key: "y", value: 0, max: -3 },
        ],
      },
    });
    await p.ready;
    await wait(20); // a swap notice comes from a lazy chunk
    const [a, b, c, d, e, f, g, h0, h1, i, j] = sliders(p);
    assert.deepEqual([a, b, c, d, e, f, g, h0, h1].map(ends), [
      ["20", "60"],
      ["1", "2"],
      ["30", "90"],
      ["300", "900"],
      ["10", "30"],
      ["-9", "-3"],
      ["-1", "0"],
      ["500", "1500"],
      ["500", "1500"],
    ]);
    assert.deepEqual(
      [p.params.a, p.params.c, p.params.e, p.params.f, p.params.h],
      [20, 30, 10, -3, [500, 500]],
      "the default clamps to the written bound",
    );
    press(c);
    assert.equal(p.params.c, 31, "it slides");
    assert.deepEqual(p.params.k, { x: 5, y: -3 }, "a point component's lone bound too");
    p.set("k", { x: 30, y: -15 });
    assert.deepEqual(p.params.k, { x: 30, y: -15 });
    assert.deepEqual(
      [ends(i), ends(j)],
      [
        ["10", "150"],
        ["0", "10"],
      ],
      "a bound the value is past already, and two written ones, as before",
    );
    assert.equal(msgs.filter((m) => m.includes("swapped")).length, 1, "only the pair written inverted says so");
    p.destroy();
  });
});

// The number control's step defaulted to 1, so 0.5 came back 1 and 3.14159 came back 3, from a schema and from markup.
test("a number with no step infers one its default sits on, 1 for a whole number", async () => {
  const p = tweaks("Num", {
    half: { type: "number", value: 0.5 },
    pi: { type: "number", value: 3.14159 },
    whole: { type: "number", value: 7 },
    given: { type: "number", value: 0.5, step: 1 },
  });
  await p.ready;
  assert.deepEqual(
    [p.params.half, p.params.pi, p.params.whole, p.params.given],
    [0.5, 3.14159, 7, 1],
    "an explicit step still wins",
  );
  const [half, pi, whole] = p.el.querySelectorAll(".twk-num");
  press(half, "ArrowUp");
  press(pi, "ArrowUp");
  press(whole, "ArrowUp");
  assert.deepEqual([p.params.half, p.params.pi, p.params.whole], [0.6, 3.1416, 8]);
  p.destroy();
  const host = document.createElement("div");
  host.innerHTML = '<div data-twk="number" data-value="0.5"></div>';
  document.body.append(host);
  await enhance(host);
  assert.equal(host.querySelector(".twk-num").value, "0.5");
  host.remove();
});

// A computed default fitted exactly at 12 digits: 1/3 stepped by 1e-12, so an arrow showed "0.333333333334".
test("a number or point with a computed default steps at its fourth digit, as a slider rounds it", async () => {
  const p = tweaks("Rep", {
    third: { type: "number", value: 1 / 3 },
    pi: { type: "number", value: Math.PI },
    big: { type: "number", value: 200 / 3 },
    kept: { type: "number", value: 1234.5678 },
    pt: { type: "point", value: { x: 1 / 3, y: 0 } },
    s: 1 / 3,
  });
  await p.ready;
  assert.deepEqual(
    [p.params.third, p.params.pi, p.params.big, p.params.kept, p.params.pt.x, p.params.s],
    [0.3333, 3.142, 66.67, 1234.5678, 0.3333, 0.3333],
    "eight written digits still fit exactly",
  );
  const [third, pi, big] = p.el.querySelectorAll(".twk-row .twk-num");
  press(third, "ArrowUp");
  press(pi, "ArrowUp");
  press(big, "ArrowUp");
  assert.deepEqual([p.params.third, p.params.pi, p.params.big, third.value], [0.3334, 3.143, 66.68, "0.3334"]);
  p.destroy();
});

// A point's step was the decade at or below range/200, whatever the default: 337 over ±1011 stepped by 10 to 340.
test("a point component's derived step keeps its default", async () => {
  const p = tweaks("PtStep", {
    pt: {
      type: "point",
      components: [
        { key: "a", value: 337 },
        { key: "b", value: 1234 },
        { key: "c", value: 3.14159 },
      ],
    },
  });
  await p.ready;
  assert.deepEqual(p.params.pt, { a: 337, b: 1234, c: 3.14159 });
  const [a] = p.el.querySelectorAll(".twk-point .twk-num");
  press(a, "ArrowUp");
  assert.equal(p.params.pt.a, 338);
  p.destroy();
});

// The shorthand fell back to the tuple itself, pinning both handles at the ends, while the verbose form and markup
// derived a range.
test("the interval shorthand derives missing bounds as the verbose form does; given ones still win", async () => {
  const p = tweaks("IvShort", {
    a: [[20, 80]],
    b: { type: "interval", value: [20, 80] },
    c: [[-20, 10]],
    d: { type: "interval", value: [-20, 10] },
    e: [[20, 80], 10, 90, 5],
  });
  await p.ready;
  const hs = sliders(p);
  assert.deepEqual(hs.filter((_, k) => k % 2 === 0).map(ends), [
    ["0", "240"],
    ["0", "240"],
    ["-60", "60"],
    ["-60", "60"],
    ["10", "90"],
  ]);
  for (const k of [0, 2, 4, 6, 8]) press(hs[k]);
  assert.deepEqual(
    [p.params.a, p.params.b, p.params.c, p.params.d, p.params.e],
    [
      [30, 80],
      [30, 80],
      [-19, 10],
      [-19, 10],
      [25, 80],
    ],
  );
  p.destroy();
});

// [5, NaN] inferred a step of 10 on a NaN span, and 5 rounded to 10 over 0–10; [5, 20] inferred 0.01 over 15–20.
test("a bound that isn't a number derives, and the step infers after the range is whole", async () => {
  await quiet(async () => {
    const p = tweaks("Hostile", {
      a: [5, NaN],
      b: [5, "abc"],
      c: { type: "slider", value: 5, min: NaN },
      d: [5, 20],
      e: [-5, NaN],
    });
    assert.deepEqual([p.params.a, p.params.b, p.params.c, p.params.e], [5, 5, 5, -5]);
    const hs = sliders(p);
    assert.deepEqual(hs.map(ends), [
      ["0", "15"],
      ["0", "15"],
      ["0", "15"],
      ["20", "60"],
      ["-15", "15"],
    ]);
    for (const h of hs) press(h);
    assert.deepEqual([p.params.a, p.params.b, p.params.c, p.params.d, p.params.e], [6, 6, 6, 21, -4]);
    p.destroy();
  });
});

test("the interval takes PageUp and PageDown, a tenth of its range", async () => {
  const p = tweaks("IvPage", { r: [[20, 60], 0, 100] });
  await p.ready;
  const [lo, hi] = sliders(p);
  press(lo, "PageUp");
  assert.deepEqual(p.params.r, [30, 60]);
  press(hi, "PageDown");
  assert.deepEqual(p.params.r, [30, 50]);
  press(lo, "PageUp");
  press(lo, "PageUp");
  assert.deepEqual(p.params.r, [50, 50], "a handle stops at the other");
  p.destroy();
});

// defaultRange(NaN) was NaN–NaN: a bare NaN got 0–100 by 10, where a verbose one got 0–1 by 0.01.
test("a non-finite default reads as 0 everywhere", () => {
  const p = tweaks("NaN", { a: NaN, b: { type: "slider", value: NaN }, c: [Infinity] });
  assert.deepEqual([p.params.a, p.params.b, p.params.c], [0, 0, 0]);
  const hs = sliders(p);
  assert.deepEqual(hs.map(ends), [
    ["0", "1"],
    ["0", "1"],
    ["0", "1"],
  ]);
  for (const h of hs) press(h);
  assert.deepEqual([p.params.a, p.params.b, p.params.c], [0.01, 0.01, 0.01]);
  p.destroy();
});

// { type: "point", value: { x: 0, y: 0 } } built a folder, though { x, y } is exactly the value the point returns.
test("a point takes its components from value: { x, y }, and a value beside components sets their defaults", async () => {
  const p = tweaks("Pt", {
    at: { type: "point", value: { x: 0.2, y: -0.4 } },
    both: { type: "point", components: [{ key: "x", min: -1, max: 1 }, { key: "y" }], value: { x: 0.5 } },
    marker: { type: "point", size: 3 },
  });
  await p.ready;
  assert.deepEqual(p.params.at, { x: 0.2, y: -0.4 });
  assert.deepEqual(p.params.both, { x: 0.5, y: 0 });
  assert.deepEqual(
    p.params.marker,
    { type: "point", size: 3 },
    "with neither, still a folder holding a child named type",
  );
  p.destroy();
});

// null and true read as 0 and 1, "abc" dropped its component without a word, and a JSON "__proto__" became a component.
test("a point's value components are numbers: a numeric string parses, junk starts at 0 with one notice, reserved keys are skipped", async () => {
  const warns = [],
    orig = console.warn;
  console.warn = (...a) => warns.push(a.join(" "));
  try {
    const p = tweaks("PtV", {
      a: { type: "point", value: { x: null, y: true } },
      b: { type: "point", value: { x: "3", y: "abc" } },
      c: { type: "point", value: JSON.parse('{"x":1,"__proto__":5,"constructor":2}') },
      d: { type: "point", components: [{ key: "x" }, { key: "__proto__" }], value: { x: " " } },
    });
    await p.ready;
    await new Promise((r) => setTimeout(r, 20)); // the message comes from a lazy chunk
    assert.deepEqual(p.params.a, { x: 0, y: 0 });
    assert.deepEqual(p.params.b, { x: 3, y: 0 });
    assert.deepEqual(Object.keys(p.params.c), ["x"]);
    assert.equal(p.params.c.x, 1);
    assert.deepEqual(Object.keys(p.params.d), ["x"]);
    assert.equal(p.params.d.x, 0);
    assert.equal(warns.length, 3, warns.join("\n"));
    assert.match(warns[0], /"a".*isn't a number.*\(x, y\)/);
    assert.match(warns[1], /"b".*\(y\)/);
    p.destroy();
  } finally {
    console.warn = orig;
  }
});
