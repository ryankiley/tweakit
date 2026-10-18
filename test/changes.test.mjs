/* panel.changes() — the values that have moved off their defaults, keyed by dotted path
 * in setMany()'s shape — the toolbar copy's ⇧-click, which copies that instead of the
 * full snapshot, and the toolbar paste, which takes either back off the clipboard.
 * Runs against the built single-file bundle under jsdom. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, mounter } from "./_helpers.mjs";

const { tweaks, enhance } = await loadSingle();
const schema = () => ({ blur: [24, 0, 100, 1], on: true, shape: { radius: [8, 0, 40, 1], origin: { type: "point", pad: false, components: [{ key: "x", value: 0 }, { key: "y", value: 0 }] } } });
const mount = () => mountPanel(schema());
const mountPanel = mounter(tweaks, "C");
// Drive the real copy button with a stubbed clipboard; returns what it wrote (null = nothing).
const copyVia = async (p, init) => {
  let copied = null;
  const clip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async (t) => { copied = t; } }, configurable: true });
  try { p.el.querySelector(".tw-toolbar-btn--swap").dispatchEvent(new window.MouseEvent("click", { bubbles: true, ...init })); await new Promise((r) => setTimeout(r, 0)); }
  finally { if (clip) Object.defineProperty(globalThis.navigator, "clipboard", clip); else delete globalThis.navigator.clipboard; }
  return copied;
};

// Drive the real paste button under `root` with a stubbed clipboard: `read` is readText (resolving or rejecting);
// undefined stands for no clipboard API at all. Returns the toast's text.
const pasteVia = async (root, read) => {
  const clip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", { value: read === undefined ? undefined : { readText: read }, configurable: true });
  try { root.querySelector(".tw-toolbar-btn--paste").click(); await new Promise((r) => setTimeout(r, 10)); }
  finally { if (clip) Object.defineProperty(globalThis.navigator, "clipboard", clip); else delete globalThis.navigator.clipboard; }
  return document.querySelector(".tw-toast")?.textContent;
};
const pasteState = (root) => { const c = root.querySelector(".tw-toolbar-btn--paste").classList; return c.contains("is-copied") ? "ok" : c.contains("is-failed") ? "failed" : "none"; };
const text = (v) => async () => JSON.stringify(v);

test("paste takes a toJSON() state back: values and ui, one notify, one undo step", async () => {
  const p = await mountPanel(schema(), { undo: true });
  p.set("blur", 60); p.set("shape.radius", 20); p.fromJSON({ ui: { folders: { shape: true } } });
  const state = p.toJSON();
  p.reset(); p.fromJSON({ ui: { folders: { shape: false } } });
  await new Promise((r) => setTimeout(r, 400)); // past the undo history's debounce: the reset is its own step
  let notified = 0; p.on(() => notified++);
  assert.equal(await pasteVia(p.el, text(state)), "4 values pasted");
  assert.equal(pasteState(p.el), "ok", "the check swaps in, as copy's does");
  assert.deepEqual([p.params.blur, p.params.shape.radius, notified], [60, 20, 1], "the values landed in one notify");
  assert.ok(p.el.querySelector(".tw-folder").classList.contains("is-collapsed"), "the ui came too");
  p.undo();
  assert.deepEqual([p.params.blur, p.params.shape.radius], [24, 8], "one step back is the state before the paste");
  assert.equal(await pasteVia(p.el, text({ ui: { folders: { shape: false } } })), "Layout pasted", "a state with only its ui still lands");
  assert.ok(!p.el.querySelector(".tw-folder").classList.contains("is-collapsed"));
  p.destroy();
});

test("paste takes a copy's values or ⇧-copy's dotted map; keys with no control are skipped", async () => {
  const p = await mount();
  assert.equal(await pasteVia(p.el, text({ blur: 50, shape: { radius: 5, ghost: 1 }, nope: 3 })), "2 values pasted");
  assert.deepEqual([p.params.blur, p.params.shape.radius, p.params.nope, p.params.shape.ghost], [50, 5, undefined, undefined]);
  assert.equal(await pasteVia(p.el, text({ "shape.radius": 9, blur: 1 })), "2 values pasted");
  assert.deepEqual(p.changes(), { blur: 1, "shape.radius": 9 }, "the dotted form lands where setMany would put it, and ⇧-copy hands it straight back");
  p.destroy();
});

test("a value lands only where it fits; one set() would coerce is skipped, and none at all shows the cross", async () => {
  const p = await mountPanel({ ...schema(), tint: "#ff0000", pick: { type: "select", value: "a", options: ["a", "b"] } });
  let notified = 0; p.on(() => notified++);
  const before = JSON.stringify(p.toJSON().values);
  assert.equal(await pasteVia(p.el, text({ blur: null, on: "yes", shape: { radius: "abc", origin: { x: 1 } }, tint: "notacolor", pick: "zzz" })), "No values to paste");
  assert.deepEqual([pasteState(p.el), JSON.stringify(p.toJSON().values), notified], ["failed", before, 0], "nothing coerced, nobody told");
  assert.equal(await pasteVia(p.el, text({ blur: 40, on: null, tint: "#00ff00", pick: "b", shape: { origin: { x: 2, y: 3 } } })), "4 values pasted");
  assert.deepEqual([p.params.blur, p.params.on, p.params.pick, p.params.shape.origin], [40, true, "b", { x: 2, y: 3 }], "the ones that fit landed; the null left its control alone");
  assert.notEqual(p.params.tint, JSON.parse(before).tint, "a colour string is a colour");
  p.destroy();
});

test("a pasted key can't write onto Object.prototype, nor over a bag key the host parked", async () => {
  const p = await mount();
  const canvas = { live: true }; p.params.canvas = canvas;
  assert.equal(await pasteVia(p.el, text({ "__proto__.polluted": "yes", "constructor.prototype.bad": 1, blur: 50, canvas: {} })), "1 value pasted");
  assert.deepEqual([({}).polluted, ({}).bad, p.params.blur, p.params.canvas], [undefined, undefined, 50, canvas]);
  p.destroy();
});

test("a panel whose own folder is called values pastes its own copy back", async () => {
  const p = await mountPanel({ values: { a: [1, 0, 10, 1] } });
  const copy = { values: { a: 1 } };
  p.set("values.a", 5);
  assert.equal(await pasteVia(p.el, text(copy)), "1 value pasted");
  assert.equal(p.params.values.a, 1);
  p.destroy();
});

test("bad JSON, a non-object, a rejected read and no clipboard API change nothing and show the cross", async () => {
  const p = await mount();
  let notified = 0; p.on(() => notified++);
  const before = JSON.stringify(p.toJSON());
  for (const [read, toast] of [
    [async () => "not json", "No values to paste"],
    [async () => "[1, 2]", "No values to paste"],
    [text({ zzz: 1 }), "No values to paste"],
    [async () => { throw new Error("denied"); }, "Couldn't read the clipboard"],
    [undefined, "Couldn't read the clipboard"],
  ]) {
    assert.equal(await pasteVia(p.el, read), toast);
    assert.equal(pasteState(p.el), "failed");
  }
  assert.deepEqual([JSON.stringify(p.toJSON()), notified], [before, 0], "nothing moved, nobody told");
  p.destroy();
});

test("a read that resolves after destroy() reports nothing", async () => {
  const p = await mount();
  let resolve; const read = () => new Promise((r) => { resolve = r; });
  const clip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { readText: read }, configurable: true });
  try {
    p.el.querySelector(".tw-toolbar-btn--paste").click();
    const btn = p.el.querySelector(".tw-toolbar-btn--paste"), toast = document.querySelector(".tw-toast")?.textContent;
    p.destroy(); resolve(JSON.stringify({ blur: 50 })); await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual([pasteState({ querySelector: () => btn }), document.querySelector(".tw-toast")?.textContent], ["none", toast]);
  } finally { if (clip) Object.defineProperty(globalThis.navigator, "clipboard", clip); else delete globalThis.navigator.clipboard; }
});

test("the markup toolbar pastes over its hosts by the keys its copy writes, and skips what doesn't fit", async () => {
  const holder = document.createElement("div");
  holder.innerHTML = `<div class="tw-panel" data-mode="inline"><div class="tw-header"><span class="tw-title">M</span></div><div class="tw-controls">
    <div data-tw="slider" data-key="size" data-value="1" data-min="0" data-max="10"></div>
    <div data-tw="slider" data-key="size" data-value="2" data-min="0" data-max="10"></div>
  </div></div>`;
  document.body.append(holder);
  await enhance(holder);
  const hosts = [...holder.querySelectorAll("[data-tw]")];
  assert.equal(await pasteVia(holder, text({ size: 7, "size-2": 8, other: 1 })), "2 values pasted");
  assert.deepEqual([hosts.map((h) => h._tw.ctrl.get()), hosts.map((h) => h.dataset.value)], [[7, 8], ["7", "8"]], "the suffixed duplicate is addressed as the copy names it, and each host echoes it");
  assert.equal(await pasteVia(holder, text({ size: "zz", "size-2": null })), "No values to paste");
  assert.deepEqual(hosts.map((h) => h._tw.ctrl.get()), [7, 8]);
  holder.remove();
});

test("changes() is empty at the defaults, lists moved values by dotted path, and empties again on reset", async () => {
  const p = await mount();
  assert.deepEqual(p.changes(), {}, "nothing has moved");
  p.set("shape.radius", 28); p.set("on", false);
  assert.deepEqual(p.changes(), { "shape.radius": 28, on: false }, "setMany's shape — a flat, dotted map");
  p.setMany(p.changes()); // round-trips through setMany as-is
  assert.deepEqual(p.changes(), { "shape.radius": 28, on: false });
  p.set("shape.origin", { x: 0, y: 0 });
  assert.deepEqual(p.changes(), { "shape.radius": 28, on: false }, "an object value equal to its default (structurally) is not a change");
  p.set("on", true);
  assert.deepEqual(p.changes(), { "shape.radius": 28 }, "a value put back to its default drops out");
  p.reset();
  assert.deepEqual(p.changes(), {});
  p.destroy();
  assert.deepEqual(p.changes(), {}, "inert after destroy");
});

test("the toolbar copy: plain click copies the full snapshot, Shift-click only the changes, and a Shift-click with nothing changed copies nothing", async () => {
  const p = await mount();
  assert.equal(await copyVia(p, { shiftKey: true }), null, "nothing changed → nothing written");
  p.set("blur", 31);
  assert.deepEqual(JSON.parse(await copyVia(p, { shiftKey: true })), { blur: 31 }, "Shift-click: the changes only");
  const full = JSON.parse(await copyVia(p, {}));
  assert.deepEqual(full, { blur: 31, on: true, shape: { radius: 8, origin: { x: 0, y: 0 } } }, "plain click: the nested snapshot, defaults included — unchanged behaviour");
  p.destroy();
});
