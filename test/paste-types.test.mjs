/* Copy and paste across every valued row type: a row copied from one folder pastes onto the same row in a folder with
 * the same keys and lands exactly; a whole folder does the same; and a value pasted onto a row of another type is refused
 * without moving anything. Drives the real pick (a press beside the row, the probe across the controls stubbed: jsdom
 * lays nothing out) and the real ⌘C / ⌘V against a stubbed clipboard, on the single-file bundle under jsdom. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, key, ptr } from "./_helpers.mjs";

const { tweaks } = await loadSingle();
// One of each valued type, in two settings: the second differs in every value.
const all = (b) => ({
  slider: [b ? 7 : 5, 0, 10, 1],
  number: { type: "number", value: b ? 9 : 3, min: 0, max: 10 },
  toggle: !b,
  segmented: { type: "segmented", value: b ? "c" : "a", options: ["a", "b", "c"] },
  radiogrid: { type: "radiogrid", value: b ? "d" : "a", options: ["a", "b", "c", "d"], cols: 2 },
  list: { type: "list", value: b ? "c" : "a", options: ["a", "b", "c"] },
  text: b ? "bye" : "hello",
  multiline: { type: "text", value: b ? "x\ny" : "one\ntwo", rows: 3 },
  colour: b ? "#00ff00" : "#7c5cff",
  gradient: { type: "gradient", value: b ? [["#ff0000", 0], ["#0000ff", 1]] : [["#000000", 0], ["#ffffff", 1]] },
  image: { type: "image", value: b ? "https://example.test/b.png" : "https://example.test/a.png" },
  pad: { type: "point", pad: true, components: [{ key: "x", value: b ? 0.5 : 0, min: -1, max: 1 }, { key: "y", value: b ? -0.5 : 0, min: -1, max: 1 }] },
  fields: { type: "point", pad: false, components: [{ key: "x", value: b ? 3 : 1 }, { key: "y", value: b ? 4 : 2 }] },
  interval: { type: "interval", value: b ? [1, 9] : [2, 8], min: 0, max: 10 },
  curve: { type: "cubicbezier", value: b ? [0.4, 0, 0.2, 1] : [0.25, 0.1, 0.25, 1] },
  spring: { type: "spring", stiffness: b ? 200 : 300, damping: b ? 20 : 26, mass: 1 },
  motion: { type: "motion", curve: b ? "linear" : "ease", duration: b ? 500 : 300 },
  shadow: { type: "shadow", value: { x: 0, y: b ? 8 : 4, blur: b ? 24 : 12, spread: 0, color: b ? "#112233" : "#000000" } },
  sides: { type: "sides", value: b ? [5, 6, 7, 8] : [1, 2, 3, 4] },
  plot: { type: "plot", expr: b ? "cos(x)" : "sin(x)", editable: true },
});
const KEYS = Object.keys(all(false));
const mount = async () => { const p = tweaks("Types", { A: all(false), B: all(true) }); document.body.append(p.el); await p.ready; return p; };
const rowOf = (p, folder, k) => p.el.querySelectorAll(".tw-folder")[folder === "A" ? 0 : 1].querySelectorAll(".tw-folder-body > .tw-controls > *")[KEYS.indexOf(k)];
const pressBeside = (p, node) => {
  const probe = document.elementFromPoint; document.elementFromPoint = () => node;
  try { p.el.dispatchEvent(ptr("pointerdown", { clientX: 2, clientY: 50 })); } finally { document.elementFromPoint = probe; }
};
// ⌘C / ⌘V with a stubbed clipboard; returns how the picked band flashed for a paste: "ok", "failed" or "none".
let board = null;
const press = async (k) => {
  const clip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { readText: async () => board, writeText: async (t) => { board = t; } }, configurable: true });
  const band = document.querySelector(".is-picked"); band?.classList.remove("is-pasted", "is-refused");
  try {
    key(document.body, { key: k, metaKey: true }); await new Promise((r) => setTimeout(r, 10));
    for (let i = 0; k === "v" && band && i < 40 && !band.matches(".is-pasted, .is-refused"); i++) await new Promise((r) => setTimeout(r, 5)); // the band answers once the read lands
  }
  finally { if (clip) Object.defineProperty(globalThis.navigator, "clipboard", clip); else delete globalThis.navigator.clipboard; }
  return band?.classList.contains("is-pasted") ? "ok" : band?.classList.contains("is-refused") ? "failed" : "none";
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

test("every type's row copies from one folder and pastes onto its twin, landing exactly", async () => {
  const p = await mount();
  for (const k of KEYS) {
    assert.ok(!same(p.params.A[k], p.params.B[k]), `${k}: the two settings differ to start with`);
    pressBeside(p, rowOf(p, "A", k)); await press("c");
    pressBeside(p, rowOf(p, "B", k));
    assert.equal(await press("v"), "ok", `${k}: pasted`);
    assert.deepEqual(p.params.B[k], p.params.A[k], `${k}: landed exactly`);
  }
  p.destroy();
});

test("a whole folder of every type pastes onto its twin in one step", async () => {
  const p = await mount();
  pressBeside(p, p.el.querySelectorAll(".tw-folder-header")[0]); await press("c");
  pressBeside(p, p.el.querySelectorAll(".tw-folder-header")[1]);
  let notified = 0; p.on(() => notified++);
  assert.equal(await press("v"), "ok");
  assert.deepEqual([p.params.B, notified], [p.params.A, 1], "every type landed, in one notify");
  p.destroy();
});

test("a value pasted onto a row of another type is refused and moves nothing", async () => {
  const p = await mount();
  let refused = 0, landed = [];
  for (const from of KEYS) {
    pressBeside(p, rowOf(p, "A", from)); await press("c");
    for (const to of KEYS) {
      if (to === from) continue;
      const before = JSON.stringify(p.params.B);
      pressBeside(p, rowOf(p, "B", to));
      const flash = await press("v");
      if (flash === "failed") { refused++; assert.equal(JSON.stringify(p.params.B), before, `${from} → ${to}: refused, nothing moved`); }
      else landed.push(`${from} → ${to}`);
    }
  }
  // A value crosses only to a row holding the same kind of value (a number to a number, a string to a free string, an
  // object carrying every key the target holds); never into a colour or gradient, nor onto a row with fixed options from
  // anything but another option.
  const kind = (v) => (Array.isArray(v) ? "array" : typeof v), COLOURED = new Set(["colour", "gradient"]), OPTIONED = new Set(["segmented", "radiogrid", "list"]);
  const unexpected = landed.map((l) => l.split(" → ")).filter(([f, t]) => kind(p.params.A[f]) !== kind(p.params.B[t]) || COLOURED.has(t) || (OPTIONED.has(t) && !OPTIONED.has(f)));
  assert.deepEqual(unexpected, [], `crossings that broke the rule, of ${landed.length} that landed: ${landed.join(", ")}`);
  assert.ok(refused > 300, `refused ${refused} of ${KEYS.length * (KEYS.length - 1)} cross-type pastes`);
  p.destroy();
});
