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
// undefined stands for no clipboard API at all. Returns what its icon flashed: "ok", "failed" or "none".
const pasteVia = async (root, read) => {
  const clip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", { value: read === undefined ? undefined : { readText: read }, configurable: true });
  root.querySelector(".tw-toolbar-btn--paste").classList.remove("is-copied", "is-failed");
  try { root.querySelector(".tw-toolbar-btn--paste").click(); await new Promise((r) => setTimeout(r, 10)); }
  finally { if (clip) Object.defineProperty(globalThis.navigator, "clipboard", clip); else delete globalThis.navigator.clipboard; }
  return pasteState(root);
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
  assert.equal(await pasteVia(p.el, text(state)), "ok");
  assert.equal(pasteState(p.el), "ok", "the check swaps in, as copy's does");
  assert.deepEqual([p.params.blur, p.params.shape.radius, notified], [60, 20, 1], "the values landed in one notify");
  assert.ok(p.el.querySelector(".tw-folder").classList.contains("is-collapsed"), "the ui came too");
  p.undo();
  assert.deepEqual([p.params.blur, p.params.shape.radius], [24, 8], "one step back is the state before the paste");
  assert.equal(await pasteVia(p.el, text({ ui: { folders: { shape: false } } })), "ok", "a state with only its ui still lands");
  assert.ok(!p.el.querySelector(".tw-folder").classList.contains("is-collapsed"));
  p.destroy();
});

test("paste takes a copy's values or ⇧-copy's dotted map; keys with no control are skipped", async () => {
  const p = await mount();
  assert.equal(await pasteVia(p.el, text({ blur: 50, shape: { radius: 5, ghost: 1 }, nope: 3 })), "ok");
  assert.deepEqual([p.params.blur, p.params.shape.radius, p.params.nope, p.params.shape.ghost], [50, 5, undefined, undefined]);
  assert.equal(await pasteVia(p.el, text({ "shape.radius": 9, blur: 1 })), "ok");
  assert.deepEqual(p.changes(), { blur: 1, "shape.radius": 9 }, "the dotted form lands where setMany would put it, and ⇧-copy hands it straight back");
  p.destroy();
});

test("a value lands only where it fits; one set() would coerce is skipped, and none at all shows the cross", async () => {
  const p = await mountPanel({ ...schema(), tint: "#ff0000", pick: { type: "select", value: "a", options: ["a", "b"] } });
  let notified = 0; p.on(() => notified++);
  const before = JSON.stringify(p.toJSON().values);
  assert.equal(await pasteVia(p.el, text({ blur: null, on: "yes", shape: { radius: "abc", origin: { x: 1 } }, tint: "notacolor", pick: "zzz" })), "failed");
  assert.deepEqual([pasteState(p.el), JSON.stringify(p.toJSON().values), notified], ["failed", before, 0], "nothing coerced, nobody told");
  assert.equal(await pasteVia(p.el, text({ blur: 40, on: null, tint: "#00ff00", pick: "b", shape: { origin: { x: 2, y: 3 } } })), "ok");
  assert.deepEqual([p.params.blur, p.params.on, p.params.pick, p.params.shape.origin], [40, true, "b", { x: 2, y: 3 }], "the ones that fit landed; the null left its control alone");
  assert.notEqual(p.params.tint, JSON.parse(before).tint, "a colour string is a colour");
  p.destroy();
});

test("a pasted key can't write onto Object.prototype, nor over a bag key the host parked", async () => {
  const p = await mount();
  const canvas = { live: true }; p.params.canvas = canvas;
  assert.equal(await pasteVia(p.el, text({ "__proto__.polluted": "yes", "constructor.prototype.bad": 1, blur: 50, canvas: {} })), "ok");
  assert.deepEqual([({}).polluted, ({}).bad, p.params.blur, p.params.canvas], [undefined, undefined, 50, canvas]);
  p.destroy();
});

test("a panel whose own folder is called values pastes its own copy back", async () => {
  const p = await mountPanel({ values: { a: [1, 0, 10, 1] } });
  const copy = { values: { a: 1 } };
  p.set("values.a", 5);
  assert.equal(await pasteVia(p.el, text(copy)), "ok");
  assert.equal(p.params.values.a, 1);
  p.destroy();
});

test("a disabled control takes nothing; a tuple must keep its length; a colour must parse", async () => {
  const p = await mountPanel({ locked: { type: "slider", value: 3, min: 0, max: 10, disabled: true }, span: { type: "interval", value: [2, 8], min: 0, max: 10 }, tint: "#ff0000", blur: [24, 0, 100, 1] });
  const css = globalThis.CSS; globalThis.CSS = { supports: (_, v) => !/nonsense|NaN|;/.test(v) }; // what a browser's parser says
  try {
    let notified = 0; p.on(() => notified++);
    for (const v of [{ locked: 9 }, { span: [] }, { span: [5] }, { span: [1, 2, 3] }, { tint: "rgb(nonsense)" }, { tint: "oklch(NaN 0 0)" }, { tint: "rgb(1,2,3); background:url(x)" }])
      assert.equal(await pasteVia(p.el, text(v)), "failed", JSON.stringify(v));
    assert.deepEqual([p.params.locked, p.params.span, notified], [3, [2, 8], 0], "nothing landed, nobody told");
    assert.equal(await pasteVia(p.el, text({ locked: 9, span: [3, 4], tint: "#00ff00", blur: 50 })), "ok", "the disabled one is skipped, the rest land");
    assert.deepEqual([p.params.locked, p.params.span, p.params.blur], [3, [3, 4], 50]);
  } finally { globalThis.CSS = css; p.destroy(); }
});

test("a key with a literal dot pastes back from the panel's own copy; a layout that changes nothing is nothing pasted", async () => {
  const p = await mountPanel({ "a.b": [1, 0, 10, 1], c: [1, 0, 10, 1], f: { x: [1, 0, 10, 1] } });
  const copy = JSON.stringify(p.toJSON().values);
  p.fromJSON({ values: { "a.b": 5, c: 5 } });
  assert.equal(await pasteVia(p.el, async () => copy), "ok");
  assert.deepEqual([p.params["a.b"], p.params.c], [1, 1]);
  let notified = 0; p.on(() => notified++);
  assert.equal(await pasteVia(p.el, text({ ui: { folders: { nope: true } } })), "failed");
  assert.equal(notified, 0, "and nobody was told");
  p.destroy();
});

test("bad JSON, a non-object, a rejected read and no clipboard API change nothing and show the cross", async () => {
  const p = await mount();
  let notified = 0; p.on(() => notified++);
  const before = JSON.stringify(p.toJSON());
  for (const [read, flash] of [
    [async () => "not json", "failed"],
    [async () => "[1, 2]", "failed"],
    [text({ zzz: 1 }), "failed"],
    [async () => { throw new Error("denied"); }, "failed"],
    [undefined, "failed"],
  ]) {
    assert.equal(await pasteVia(p.el, read), flash);
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
    const btn = p.el.querySelector(".tw-toolbar-btn--paste");
    p.destroy(); resolve(JSON.stringify({ blur: 50 })); await new Promise((r) => setTimeout(r, 10));
    assert.equal(pasteState({ querySelector: () => btn }), "none", "no check, no cross");
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
  assert.equal(await pasteVia(holder, text({ size: 7, "size-2": 8, other: 1 })), "ok");
  assert.deepEqual([hosts.map((h) => h._tw.ctrl.get()), hosts.map((h) => h.dataset.value)], [[7, 8], ["7", "8"]], "the suffixed duplicate is addressed as the copy names it, and each host echoes it");
  assert.equal(await pasteVia(holder, text({ size: "zz", "size-2": null })), "failed");
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
