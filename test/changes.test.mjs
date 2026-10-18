/* panel.changes() — the values that have moved off their defaults, keyed by dotted path
 * in setMany()'s shape — the toolbar copy's ⇧-click, which copies that instead of the
 * full snapshot, the toolbar paste, which takes either back off the clipboard, and the
 * picked row or folder's ⌘C / ⌘V. Runs against the built single-file bundle under jsdom. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, mounter, key, ptr } from "./_helpers.mjs";

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

test("a disabled control takes nothing; a tuple must keep its length; a colour must parse", async () => {
  const p = await mountPanel({ locked: { type: "slider", value: 3, min: 0, max: 10, disabled: true }, span: { type: "interval", value: [2, 8], min: 0, max: 10 }, tint: "#ff0000", blur: [24, 0, 100, 1] });
  const css = globalThis.CSS; globalThis.CSS = { supports: (_, v) => !/nonsense|NaN|;/.test(v) }; // what a browser's parser says
  try {
    let notified = 0; p.on(() => notified++);
    for (const v of [{ locked: 9 }, { span: [] }, { span: [5] }, { span: [1, 2, 3] }, { tint: "rgb(nonsense)" }, { tint: "oklch(NaN 0 0)" }, { tint: "rgb(1,2,3); background:url(x)" }])
      assert.equal(await pasteVia(p.el, text(v)), "No values to paste", JSON.stringify(v));
    assert.deepEqual([p.params.locked, p.params.span, notified], [3, [2, 8], 0], "nothing landed, nobody told");
    assert.equal(await pasteVia(p.el, text({ locked: 9, span: [3, 4], tint: "#00ff00", blur: 50 })), "3 values pasted", "the disabled one is skipped, the rest land");
    assert.deepEqual([p.params.locked, p.params.span, p.params.blur], [3, [3, 4], 50]);
  } finally { globalThis.CSS = css; p.destroy(); }
});

test("a key with a literal dot pastes back from the panel's own copy; a layout that changes nothing is nothing pasted", async () => {
  const p = await mountPanel({ "a.b": [1, 0, 10, 1], c: [1, 0, 10, 1], f: { x: [1, 0, 10, 1] } });
  const copy = JSON.stringify(p.toJSON().values);
  p.fromJSON({ values: { "a.b": 5, c: 5 } });
  assert.equal(await pasteVia(p.el, async () => copy), "3 values pasted");
  assert.deepEqual([p.params["a.b"], p.params.c], [1, 1]);
  let notified = 0; p.on(() => notified++);
  assert.equal(await pasteVia(p.el, text({ ui: { folders: { nope: true } } })), "No values to paste");
  assert.equal(notified, 0, "and nobody was told");
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

// ⌘C / ⌘V on `target` with a stubbed clipboard holding `text` (an Error rejects the read): what was written,
// whether the key was taken, and the toast.
const clipKey = async (target, k, text, props = {}) => {
  let copied = null;
  const clip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { readText: async () => { if (text instanceof Error) throw text; return text; }, writeText: async (t) => { copied = t; } }, configurable: true });
  try { const e = key(target, { key: k, metaKey: true, ...props }); await new Promise((r) => setTimeout(r, 10)); return { copied, prevented: e.defaultPrevented, toast: document.querySelector(".tw-toast")?.textContent }; }
  finally { if (clip) Object.defineProperty(globalThis.navigator, "clipboard", clip); else delete globalThis.navigator.clipboard; }
};
const scoped = () => ({ a: { x: [1, 0, 10, 1], y: [2, 0, 10, 1] }, b: { x: [5, 0, 10, 1], y: [6, 0, 10, 1] }, blur: [24, 0, 100, 1], name: { type: "text", value: "hi" } });
const mount2 = () => mountPanel(scoped());
// A press in the panel's side padding level with `node` (jsdom lays nothing out, so the probe across the controls is stubbed).
const pressBeside = (p, node, props = {}) => {
  const probe = document.elementFromPoint; document.elementFromPoint = () => node;
  try { p.el.dispatchEvent(ptr("pointerdown", { clientX: 2, clientY: 50, ...props })); } finally { document.elementFromPoint = probe; }
};
const picked = () => [...document.querySelectorAll(".is-picked")];

test("⌘C on a folder copies its values object; ⌘V on a folder with the same keys takes it, in one notify and one undo step", async () => {
  const p = await mountPanel(scoped(), { undo: true });
  const heads = [...p.el.querySelectorAll(".tw-folder-header")];
  heads[0].focus();
  const c = await clipKey(heads[0], "c");
  assert.deepEqual([JSON.parse(c.copied), c.prevented, c.toast], [{ x: 1, y: 2 }, true, "A copied"], "the folder's subtree, not the whole panel");
  assert.ok(p.el.querySelector(".tw-toolbar-btn--swap").classList.contains("is-copied"), "the toolbar's copy shows the check");
  await new Promise((r) => setTimeout(r, 400)); // past the undo debounce
  let notified = 0; p.on(() => notified++);
  heads[1].focus();
  const v = await clipKey(heads[1], "v", c.copied);
  assert.deepEqual([v.prevented, v.toast, p.params.b, p.params.a, notified], [true, "2 values pasted into B", { x: 1, y: 2 }, { x: 1, y: 2 }, 1], "the sibling took them; the source kept its own");
  assert.equal(pasteState(p.el), "ok");
  p.undo();
  assert.deepEqual(p.params.b, { x: 5, y: 6 }, "one step back");
  p.destroy();
});

test("a folder reads a whole-panel copy or a changed-only map at its own path, and only into its own rows", async () => {
  const p = await mount2();
  const head = p.el.querySelectorAll(".tw-folder-header")[1]; head.focus();
  assert.equal((await clipKey(head, "v", JSON.stringify({ a: { x: 9 }, b: { x: 3 }, blur: 70 }))).toast, "1 value pasted into B");
  assert.deepEqual([p.params.a.x, p.params.b.x, p.params.blur], [1, 3, 24], "B's own x from the whole-panel copy, nothing else");
  assert.equal((await clipKey(head, "v", JSON.stringify({ "b.y": 8, "a.y": 0 }))).toast, "1 value pasted into B");
  assert.deepEqual([p.params.a.y, p.params.b.y], [2, 8], "the dotted form too");
  assert.equal((await clipKey(head, "v", JSON.stringify({ x: 4, zzz: 1 }))).toast, "1 value pasted into B", "a bare values object is the folder's own");
  p.destroy();
});

test("⌘C on a row copies its value; ⌘V takes a bare value or the row's one-key object, and skips what doesn't fit", async () => {
  const p = await mount2();
  const track = p.el.querySelector(".tw-folder .tw-slider"); track.focus();
  assert.deepEqual(Object.values(await clipKey(track, "c")).slice(0, 1), ["1"]);
  let notified = 0; p.on(() => notified++);
  assert.equal((await clipKey(track, "v", "7")).toast, "1 value pasted into X");
  assert.equal((await clipKey(track, "v", JSON.stringify({ x: 3 }))).toast, "1 value pasted into X");
  assert.deepEqual([p.params.a.x, p.params.a.y, notified], [3, 2, 2], "just that slider, once per paste");
  for (const bad of ["null", "[]", "true", JSON.stringify({ x: 1, y: 2 }), "nope"]) {
    assert.equal((await clipKey(track, "v", bad)).toast, "No values to paste", bad);
    assert.equal(pasteState(p.el), "failed");
  }
  assert.deepEqual([p.params.a.x, notified], [3, 2], "nothing coerced, nobody told");
  assert.equal((await clipKey(track, "v", new Error("denied"))).toast, "Couldn't read the clipboard");
  p.destroy();
});

test("a folder pastes its own copy back even when a subfolder shares its name; a copy after destroy() says nothing", async () => {
  const p = await mountPanel({ look: { look: { x: [1, 0, 10, 1] }, y: [2, 0, 10, 1] } });
  const head = p.el.querySelector(".tw-folder-header"); head.focus();
  const c = await clipKey(head, "c");
  assert.deepEqual(JSON.parse(c.copied), { look: { x: 1 }, y: 2 });
  p.fromJSON({ values: { look: { look: { x: 7 }, y: 7 } } });
  assert.equal((await clipKey(head, "v", c.copied)).toast, "2 values pasted into Look");
  assert.deepEqual(p.params.look, { look: { x: 1 }, y: 2 });
  const toast = document.querySelector(".tw-toast");
  toast.textContent = "before";
  const clip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async () => {} }, configurable: true });
  try { key(head, { key: "c", metaKey: true }); p.destroy(); await new Promise((r) => setTimeout(r, 10)); }
  finally { if (clip) Object.defineProperty(globalThis.navigator, "clipboard", clip); else delete globalThis.navigator.clipboard; }
  assert.equal(toast.textContent, "before", "the panel is gone: no toast");
});

test("a press beside a row picks it with a ring, and ⌘C / ⌘V act on the pick, not on focus", async () => {
  const p = await mount2();
  const [ax, , bx] = [...p.el.querySelectorAll(".tw-folder .tw-slider")], row = (t) => t.closest(".tw-folder-body > .tw-controls > *");
  p.el.querySelectorAll(".tw-folder-header")[1].focus(); // focus elsewhere in the panel: the pick wins
  pressBeside(p, ax);
  assert.deepEqual(picked(), [row(ax)], "the row level with the press is ringed");
  const c = await clipKey(document.activeElement, "c");
  assert.deepEqual([c.copied, c.toast], ["1", "X copied"], "its value, not the focused folder's");
  pressBeside(p, bx);
  assert.deepEqual(picked(), [row(bx)], "a new pick moves the ring");
  assert.equal((await clipKey(document.activeElement, "v", c.copied)).toast, "1 value pasted into X");
  assert.deepEqual([p.params.a.x, p.params.b.x], [1, 1]);
  key(document.activeElement, { key: "Escape" });
  assert.deepEqual(picked(), [], "Escape drops it");
  p.destroy();
});

test("beside a folder's header picks the folder; a press elsewhere drops it; the page holds one pick", async () => {
  const p = await mount2(), q = await mount2();
  pressBeside(p, p.el.querySelector(".tw-folder-header .tw-folder-title"));
  assert.deepEqual(picked(), [p.el.querySelector(".tw-folder")], "the whole folder");
  p.el.querySelectorAll(".tw-folder .tw-slider")[2].dispatchEvent(ptr("pointerdown"));
  assert.deepEqual(picked(), [], "working another row drops the pick");
  pressBeside(p, p.el.querySelector(".tw-folder-header"));
  const qx = q.el.querySelector(".tw-folder .tw-slider");
  pressBeside(q, qx);
  assert.deepEqual(picked(), [qx.closest(".tw-folder-body > .tw-controls > *")], "picking in another panel drops this one's");
  p.el.querySelector(".tw-folder .tw-slider").focus(); // focus in the other panel
  await clipKey(document.activeElement, "v", "7");
  assert.deepEqual([q.params.a.x, p.params.a.x], [7, 1], "the pick takes the paste; the focused panel doesn't too");
  document.body.dispatchEvent(ptr("pointerdown"));
  assert.deepEqual(picked(), [], "a press on the page drops it");
  pressBeside(p, null);
  pressBeside(p, p.el.querySelector(".tw-folder .tw-slider"), { button: 2 });
  assert.deepEqual(picked(), [], "beside nothing, or with another button, picks nothing");
  p.destroy(); q.destroy();
});

test("a text field, a selection, the panel header and a held key stay the browser's", async () => {
  const p = await mount2();
  const input = p.el.querySelector(".tw-text"); input.focus();
  assert.deepEqual([(await clipKey(input, "c")).prevented, (await clipKey(input, "v", "{}")).prevented], [false, false], "a text field");
  const head = p.el.querySelector(".tw-folder-header"); head.focus();
  const sel = window.getSelection(), range = document.createRange(); range.selectNodeContents(p.el.querySelector(".tw-folder-title")); sel.removeAllRanges(); sel.addRange(range);
  const c = await clipKey(head, "c"); sel.removeAllRanges();
  assert.deepEqual([c.prevented, c.copied], [false, null], "selected text copies as text");
  const title = p.el.querySelector(".tw-header-toggle"); title.focus();
  assert.equal((await clipKey(title, "c")).prevented, false, "the panel header: the toolbar buttons copy the whole panel");
  head.focus();
  assert.equal((await clipKey(head, "v", "{}", { repeat: true })).prevented, false, "a held key doesn't paste again and again");
  p.destroy();
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
