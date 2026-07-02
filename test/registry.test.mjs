/* The control tables must stay aligned: TYPED_META (verbose schema forms),
 * DATA_VALUE ([data-tw] markup forms), the constructor registry (core controls),
 * and LAZY_IMPORT (the code-split chunk map). Adding a control touches several of
 * these — this test is the cross-check that catches a missed one, by deriving a
 * meta from a minimal fixture of every declared type and asserting the meta's
 * control type is either registered (core) or lazily loadable. Bundled from src in
 * split mode, so the lazy map is populated without loading any chunk. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { bundle } from "./_bundle.mjs";

const { metaFor, TYPED_META, DATA_VALUE, VALUELESS, LAZY_IMPORT, getControl } =
  await bundle("test/_registry-entry.mjs", { TW_SPLIT: "true" });

// A minimal well-formed value per declared type — must grow when a control is added
// (the fixture-exists assertion below fails otherwise, on purpose).
const FIXTURES = {
  slider: { type: "slider", value: 1, min: 0, max: 10 },
  number: { type: "number", value: 1 },
  checkbox: { type: "checkbox", value: true },
  list: { type: "list", options: ["a", "b"] },
  radiogrid: { type: "radiogrid", options: ["a", "b"] },
  segmented: { type: "segmented", options: ["a", "b"] },
  color: { type: "color", value: "#ff0000" },
  text: { type: "text", value: "hi" },
  interval: { type: "interval", min: 0, max: 1 },
  spring: { type: "spring" },
  cubicbezier: { type: "cubicbezier" },
  point: { type: "point", components: [{ key: "x" }, { key: "y" }] },
  gradient: { type: "gradient" },
  plot: { type: "plot", expr: "x" },
  fpsgraph: { type: "fpsgraph" },
  monitor: { type: "monitor", value: 1 },
  image: { type: "image" },
  button: { type: "button", action: () => {} },
  buttongroup: { type: "buttongroup", buttons: { A: () => {} } },
  separator: { type: "separator" },
  tabs: { type: "tabs", pages: { A: { x: 1 } } },
};

const declared = new Set([...Object.keys(TYPED_META), ...Object.keys(DATA_VALUE), "button"]);

test("every declared control type has a fixture here", () => {
  for (const t of declared) assert.ok(t in FIXTURES, `add a minimal fixture for new control type "${t}"`);
});

test("every declared type derives a meta whose control is registered or lazily loadable", () => {
  for (const t of declared) {
    const meta = metaFor("k", FIXTURES[t]);
    assert.ok(meta, `metaFor rejected the minimal "${t}" fixture`);
    assert.ok(
      getControl(meta.type) || LAZY_IMPORT[meta.type] || meta.type === "folder" || meta.type === "tabs",
      `"${t}" derives meta.type "${meta.type}", which no core registration or LAZY_IMPORT entry provides`
    );
    if (meta.type === "tabs") assert.ok(LAZY_IMPORT.tabs, "tabs must stay in LAZY_IMPORT — build() ensures it before assembling");
  }
});

test("every LAZY_IMPORT key is a declared control type (no orphan chunks)", () => {
  for (const t of Object.keys(LAZY_IMPORT)) assert.ok(declared.has(t), `LAZY_IMPORT["${t}"] has no TYPED_META/DATA_VALUE entry`);
});

test("VALUELESS names only declared types", () => {
  for (const t of VALUELESS) assert.ok(declared.has(t), `VALUELESS names unknown type "${t}"`);
});

test("core and lazy registration don't overlap", () => {
  for (const t of Object.keys(LAZY_IMPORT)) assert.equal(getControl(t), undefined, `"${t}" is both core-registered and lazy`);
});
