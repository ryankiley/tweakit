/* opts.strings: every word the kit shows or says comes from one catalog (types.ts Strings), each key has its English
 * default in the source, and a panel built with other words shows none of the defaults, panes and sub-editors included. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { window } from "./_setup-dom.mjs";
import { loadSingle, wait, armPresets } from "./_helpers.mjs";
globalThis.MutationObserver = window.MutationObserver;

const { tweaks, mountControl, createColorPicker, enhance } = await loadSingle();
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const types = read("src/tweaks/types.ts"), catalog = types.slice(types.indexOf("export interface Strings {"), types.indexOf("\n}", types.indexOf("export interface Strings {")));
const KEYS = new Map([...catalog.matchAll(/\/\*\* "((?:[^"\\]|\\.)*)"[^*]*\*\/ (\w+)\?:/g)].map((m) => [m[2], m[1]]));

test("the catalog and the source agree: every key the source asks for is in Strings, with the same default, and back", () => {
  const src = ["src/tweaks", "src/tweaks/controls"].flatMap((d) => readdirSync(new URL(`../${d}`, import.meta.url)).filter((f) => f.endsWith(".ts")).map((f) => read(`${d}/${f}`))).join("\n");
  const asked = new Map([...src.matchAll(/(?:\btr|words\(\))\(\s*"(\w+)",\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => [m[1], m[2]]));
  const easings = read("src/tweaks/controls/gradient.ts").match(/const EASINGS[^\n]*/)[0];
  for (const m of easings.matchAll(/\["[\w-]+", "(\w+)", "([^"]+)"\]/g)) asked.set(m[1], m[2]); // gradient's easing table
  for (const m of src.matchAll(/\["(\w+)", "([A-Z][a-z]+)", [\d.]+\]/g)) asked.set(m[1], m[2]); // spring's physics fields
  for (const m of src.matchAll(/\["(interval\w+)", "([^"]+)", h\w+\]/g)) asked.set(m[1], m[2]);
  for (const n of ["Top-left", "Top-right", "Bottom-right", "Bottom-left", "Top", "Right", "Bottom", "Left"]) asked.set(n.toLowerCase().replace(/-(\w)/, (_, c) => c.toUpperCase()), n); // sides: keys from the names
  for (const k of ["copiedChanged", "pasted", "stops", "stopAt", "stopAtSelected"]) asked.set(k, KEYS.get(k)); // a plural function or a ternary
  for (const [k, d] of asked) { assert.ok(KEYS.has(k), `"${k}" is asked for but missing from Strings`); assert.equal(KEYS.get(k), d, `"${k}"'s default`); }
  for (const k of KEYS.keys()) assert.ok(asked.has(k), `Strings lists "${k}", which nothing asks for`);
});

// Every control and every pane, built with strings that replace each word by its key.
const asked = new Set();
const marks = new Proxy({}, { get: (_, k) => (typeof k === "string" ? (asked.add(k), `«${k}»`) : undefined), has: () => true });
const schema = {
  k1: [5, 0, 10, 1], k2: { type: "number", value: 3 }, k3: true, k4: ["o1", "o2"], k5: { type: "color", value: "#7c5cff" }, k6: "t1",
  k7: { type: "segmented", options: ["o1", "o2"] }, k8: { type: "radiogrid", options: ["o1", "o2", "o3"] },
  k9: { type: "image", options: ["/a.png", "/b.png"] }, k10: { type: "image" }, k11: { type: "gradient", stops: [["#000", 0], ["#fff", 1]] },
  k12: { type: "shadow" }, k13: { type: "sides", value: 8 }, k14: { type: "sides", corners: true, value: 4 }, k15: { type: "motion" },
  k16: { type: "point", components: [{ key: "x" }, { key: "y" }] }, k17: { type: "interval", value: [2, 8], min: 0, max: 10 },
  k18: { type: "cubicbezier" }, k19: { type: "spring" }, k20: { type: "plot", expr: "x" }, k21: { type: "monitor", get: () => 1 },
  k22: { type: "fpsgraph" }, k23: { type: "buttongroup", buttons: [{ action: () => {} }] }, k24: { action: () => {} },
  f1: { k25: 1 }, t9: { type: "tabs", pages: { p1: { k26: 1 }, p2: { k27: 2 } } },
  k28: { type: "color", value: "#336699", label: undefined }, k29: { type: "monitor", get: () => 2, label: undefined },
};
const shown = (roots) => roots.flatMap((r) => [r, ...r.querySelectorAll("*")]).flatMap((n) => [
  ...[...n.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent),
  ...["aria-label", "title", "placeholder", "aria-description", "aria-roledescription"].map((a) => n.getAttribute?.(a)),
]).filter((t) => t && t.trim());

test("with every word replaced, a panel with every control and every pane open shows no default word", async () => {
  const p = tweaks("", schema, { strings: marks, persist: "t-strings" }); document.body.append(p.el); await p.ready;
  try {
    // Open what opens: every trigger row, the list, the presets menu, the sides' split toggles.
    for (const t of p.el.querySelectorAll(".twk-trigger, .twk-select-trigger")) { t.click(); await wait(30); }
    (await armPresets(p)).click(); await wait(30);
    for (const b of p.el.querySelectorAll(".twk-sides-link")) b.click();
    const texts = shown([p.el, ...document.querySelectorAll(".twk-portal")]).map((t) => t.replace(/«\w+»/g, "")); // a marker's own key isn't a word shown
    const defaults = [...KEYS.values()].flatMap((d) => d.split(/\{\w+\}/)).map((s) => s.trim()).filter((s) => /[A-Za-z]{3}/.test(s));
    const left = texts.filter((t) => defaults.some((d) => t.includes(d)));
    assert.deepEqual(left, [], "a default word is still showing");
    const neverAsked = [...KEYS.keys()].filter((k) => !asked.has(k));
    // What only an event or a rarer build says: a copy, a paste, a refused file or save, a preset loaded, a stop selected, a
    // value storage refused; and a control's name when it has no label of its own, an easing off the menu, an unnamed image.
    const eventOnly = ["monitor", "fps", "plot", "point", "gradient", "motion", "shadow", "custom", "imageN", "copied", "copiedChanged", "nothingChanged", "copyFailed", "rowCopied", "notSaved", "pasted", "nothingToPaste", "clipboardUnread", "presetLoaded", "presetSaved", "presetFull", "presetDelete", "notAnImage", "unreadable", "tooLarge", "folder", "customImage", "uploadedImage", "stopAtSelected", "replace", "dropOrChoose", "springSummary", "button"];
    assert.deepEqual(neverAsked.filter((k) => !eventOnly.includes(k)), [], "every word a build shows was asked for");
  } finally { p.destroy(); await wait(220); }
});

test("a key's placeholders are filled, a function gets the values, and a key left out keeps its English", async () => {
  localStorage.clear();
  const heard = [];
  const p = tweaks("De", { size: [2, 0, 10, 1], n: [1, 0, 10, 1] }, { persist: "t-strings-de", strings: {
    reset: "Zurücksetzen", presetSaved: "Voreinstellung {name} gespeichert",
    copiedChanged: (v) => (v.n === 1 ? "1 Wert kopiert" : `${v.n} Werte kopiert`),
  } });
  document.body.append(p.el); await p.ready;
  try {
    const btn = (l) => p.el.querySelector(`.twk-toolbar-btn[aria-label="${l}"]`);
    assert.ok(btn("Zurücksetzen"), "the reset button's label");
    assert.ok(btn("Copy values (⇧: changed only)"), "a key left out keeps its default");
    const sr = () => document.querySelector(".twk-sr[role=status]")?.textContent;
    (await armPresets(p)).click(); await wait(30);
    const input = document.querySelector(".twk-presets-input"); input.value = "Hell"; input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await wait(120); heard.push(sr());
    assert.equal(heard[0], "Voreinstellung Hell gespeichert");
  } finally { p.destroy(); await wait(220); }
});

test("mountControl, createColorPicker and enhance() take strings too", async () => {
  const where = document.createElement("div"); document.body.append(where);
  const c = mountControl(where, true, { strings: { on: "An", off: "Aus" } }); await c.ready;
  const picker = createColorPicker({ strings: { hue: "Farbton" } }); where.append(picker.el); await picker.ready;
  const host = document.createElement("div"); host.dataset.twk = "checkbox"; host.dataset.key = "m"; where.append(host);
  await enhance(where, { strings: { on: "Ja" } });
  try {
    assert.deepEqual([...c.el.querySelectorAll(".twk-seg-btn")].map((b) => b.textContent), ["Aus", "An"]);
    assert.ok(picker.el.querySelector('[aria-label^="Farbton"]'), "the picker's hue strip");
    assert.deepEqual([...host.querySelectorAll(".twk-seg-btn")].map((b) => b.textContent), ["Off", "Ja"]);
  } finally { c.destroy(); picker.destroy(); where.remove(); }
});
