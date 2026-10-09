/* Schema defaults + labels against the built single-file bundle (dist/tweaks.js),
 * under jsdom. These pin what a verbose `{ type }` value derives when it leaves
 * things out — the range a bare value implies, the label every control shows (or
 * hides on an explicit ""), and the clamps the object-valued controls apply at
 * build, not only on set(). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./_setup-dom.mjs";

const { tweaks, enhance } = await import(new URL("../dist/tweaks.js", import.meta.url));
const css = readFileSync(new URL("../dist/tweaks.css", import.meta.url), "utf8");

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
  const [s] = p.el.querySelectorAll("[role=slider]");
  assert.equal(s.getAttribute("aria-valuemin"), "0");
  assert.equal(s.getAttribute("aria-valuemax"), "150"); // the shorthand's 0–3×value
  // The markup path agrees: one meta derivation for every entry point.
  const host = document.createElement("div");
  host.innerHTML = '<div data-tw="slider" data-value="50"></div>';
  document.body.append(host); enhance(host);
  const m = host.querySelector("[role=slider]");
  assert.equal(m.getAttribute("aria-valuenow"), "50");
  assert.equal(m.getAttribute("aria-valuemax"), "150");
  host.remove();
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
  assert.ok(top > 0 && top < 50, `the thumb should sit inside the pad, above centre (top=${thumb.style.top})`);
});
