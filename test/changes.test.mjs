/* panel.changes() — the values that have moved off their defaults, keyed by dotted path
 * in setMany()'s shape — the toolbar copy's ⇧-click, which copies that instead of the
 * full snapshot, and a picked row or folder's ⌘C / ⌘V. Runs against the built single-file
 * bundle under jsdom. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, mounter, key, ptr, distCss } from "./_helpers.mjs";

const { tweaks } = await loadSingle();
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

// ⌘C / ⌘V on `target` with a stubbed clipboard holding `text` (an Error rejects the read): what was written, whether the
// key was taken, and how it went: "ok" or "failed" from the copy icon's check, the picked band's flash, or with nothing
// picked the words a screen reader heard; "none" when nothing answered.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clipKey = async (target, k, text, props = {}) => {
  let copied = null;
  const clip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { readText: async () => { if (text instanceof Error) throw text; return text; }, writeText: async (t) => { copied = t; } }, configurable: true });
  for (const b of document.querySelectorAll(".tw-toolbar-btn--swap")) b.classList.remove("is-copied");
  for (const b of document.querySelectorAll(".is-pasted, .is-refused")) b.classList.remove("is-pasted", "is-refused");
  const sr = document.querySelector(".tw-sr"); if (sr) sr.textContent = "";
  try {
    const pick = document.querySelector(".is-picked");
    const e = key(target, { key: k, metaKey: true, ...props }); await wait(10);
    let flash = "none";
    if (k === "c") flash = document.querySelector(".tw-toolbar-btn--swap.is-copied") ? "ok" : "none";
    else if (pick && e.defaultPrevented) { // the band answers once the read and the chunk have landed
      for (let i = 0; i < 40 && !pick.matches(".is-pasted, .is-refused"); i++) await wait(5);
      flash = pick.classList.contains("is-pasted") ? "ok" : pick.classList.contains("is-refused") ? "failed" : "none";
    } else if (e.defaultPrevented) { await wait(130); const w = document.querySelector(".tw-sr")?.textContent || ""; flash = / pasted$/.test(w) ? "ok" : w ? "failed" : "none"; }
    return { copied, prevented: e.defaultPrevented, flash };
  } finally { if (clip) Object.defineProperty(globalThis.navigator, "clipboard", clip); else delete globalThis.navigator.clipboard; }
};
const scoped = () => ({ a: { x: [1, 0, 10, 1], y: [2, 0, 10, 1] }, b: { x: [5, 0, 10, 1], y: [6, 0, 10, 1] }, blur: [24, 0, 100, 1], name: { type: "text", value: "hi" } });
const mount2 = () => mountPanel(scoped());
// A press in the panel's side padding level with `node` (jsdom lays nothing out, so the row or folder header it sits in
// is given a box at the press's height for the moment of the press).
const pressBeside = (p, node, props = {}) => {
  const box = node && (node.closest(".tw-folder-header") || node.closest(".tw-controls > *"));
  if (box) box.getBoundingClientRect = () => ({ top: 40, bottom: 72, height: 32, left: 0, right: 0, width: 0 });
  try { p.el.dispatchEvent(ptr("pointerdown", { clientX: 2, clientY: 50, ...props })); } finally { if (box) delete box.getBoundingClientRect; }
};
const picked = () => [...document.querySelectorAll(".is-picked")];
const said = () => document.querySelector(".tw-sr")?.textContent;
const safety = () => ({ f: { blur: [24, 0, 100, 1], on: true, tint: "#ff0000", pick: { type: "list", value: "a", options: ["a", "b"] }, span: { type: "interval", value: [2, 8], min: 0, max: 10 }, locked: { type: "slider", value: 3, min: 0, max: 10, disabled: true }, origin: { type: "point", pad: false, components: [{ key: "x", value: 0 }, { key: "y", value: 0 }] } } });

test("a paste onto a pick lands only what fits; with nothing fitting the band flashes red and nothing changes", async () => {
  const p = await mountPanel(safety());
  const head = p.el.querySelector(".tw-folder-header"); pressBeside(p, head);
  let notified = 0; p.on(() => notified++);
  const before = JSON.stringify(p.params.f);
  const css = globalThis.CSS; globalThis.CSS = { supports: (_, v) => !/nonsense|NaN|;/.test(v) }; // what a browser's parser says
  try {
    for (const v of [{ blur: null, on: "yes", tint: "rgb(nonsense)", pick: "zzz", span: [5], locked: 9, origin: { x: 1 } }, { span: [1, 2, 3] }, { tint: "oklch(NaN 0 0)" }, { tint: "rgb(1,2,3); background:url(x)" }, "not json", "[1, 2]"])
      assert.equal((await clipKey(head, "v", typeof v === "string" ? v : JSON.stringify(v))).flash, "failed", JSON.stringify(v));
    assert.deepEqual([JSON.stringify(p.params.f), notified], [before, 0], "nothing coerced, nobody told");
    assert.equal((await clipKey(head, "v", JSON.stringify({ blur: 40, on: null, tint: "#00ff00", pick: "b", span: [3, 4], locked: 9, origin: { x: 2, y: 3 } }))).flash, "ok");
    assert.deepEqual([p.params.f.blur, p.params.f.on, p.params.f.pick, p.params.f.span, p.params.f.locked, p.params.f.origin], [40, true, "b", [3, 4], 3, { x: 2, y: 3 }], "what fits landed; a null and a disabled row stayed");
    assert.notEqual(p.params.f.tint, JSON.parse(before).tint, "a colour that parses is a colour");
  } finally { globalThis.CSS = css; p.destroy(); }
});

test("a picked paste tells a screen reader what it did, and a pasted key can't write onto Object.prototype", async () => {
  const p = await mountPanel(safety());
  const head = p.el.querySelector(".tw-folder-header"); pressBeside(p, head);
  await clipKey(head, "v", JSON.stringify({ "__proto__.polluted": "yes", "constructor.prototype.bad": 1, blur: 50 })); await wait(130);
  assert.deepEqual([said(), ({}).polluted, ({}).bad, p.params.f.blur], ["1 value pasted", undefined, undefined, 50]);
  await clipKey(head, "v", JSON.stringify({ zzz: 1 })); await wait(130);
  assert.equal(said(), "Nothing to paste");
  await clipKey(head, "v", new Error("denied")); await wait(130);
  assert.equal(said(), "Couldn't read the clipboard");
  p.destroy();
});

test("a folder whose keys hold a literal dot pastes its own copy back; a read after destroy() changes and shows nothing", async () => {
  const p = await mountPanel({ f: { "a.b": [1, 0, 10, 1], c: [1, 0, 10, 1] } });
  const head = p.el.querySelector(".tw-folder-header"); pressBeside(p, head);
  const c = await clipKey(head, "c");
  p.fromJSON({ values: { f: { "a.b": 5, c: 5 } } });
  assert.equal((await clipKey(head, "v", c.copied)).flash, "ok");
  assert.deepEqual(p.params.f, { "a.b": 1, c: 1 });
  let resolve; const clip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { readText: () => new Promise((r) => { resolve = r; }) }, configurable: true });
  const band = p.el.querySelector(".tw-folder"); band.classList.remove("is-pasted", "is-refused"); // the last paste's flash
  try { key(head, { key: "v", metaKey: true }); p.destroy(); resolve(JSON.stringify({ c: 9 })); await wait(20); }
  finally { if (clip) Object.defineProperty(globalThis.navigator, "clipboard", clip); else delete globalThis.navigator.clipboard; }
  assert.ok(!band.classList.contains("is-pasted") && !band.classList.contains("is-refused"), "the panel is gone: no flash");
});

test("⌘C on a folder copies its values object; ⌘V on a folder with the same keys takes it, in one notify and one undo step", async () => {
  const p = await mountPanel(scoped(), { undo: true });
  const heads = [...p.el.querySelectorAll(".tw-folder-header")];
  heads[0].focus();
  const c = await clipKey(heads[0], "c");
  assert.deepEqual([JSON.parse(c.copied), c.prevented, c.flash], [{ x: 1, y: 2 }, true, "ok"], "the folder's subtree, not the whole panel; the copy icon's check");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(document.querySelector(".tw-sr")?.textContent, "A copied", "and a screen reader hears what was copied");
  assert.ok(p.el.querySelector(".tw-toolbar-btn--swap").classList.contains("is-copied"), "the toolbar's copy shows the check");
  await new Promise((r) => setTimeout(r, 400)); // past the undo debounce
  let notified = 0; p.on(() => notified++);
  heads[1].focus();
  const v = await clipKey(heads[1], "v", c.copied);
  assert.deepEqual([v.prevented, v.flash, p.params.b, p.params.a, notified], [true, "ok", { x: 1, y: 2 }, { x: 1, y: 2 }, 1], "the sibling took them; the source kept its own");
  p.undo();
  assert.deepEqual(p.params.b, { x: 5, y: 6 }, "one step back");
  p.destroy();
});

test("a folder reads a whole-panel copy or a changed-only map at its own path, and only into its own rows", async () => {
  const p = await mount2();
  const head = p.el.querySelectorAll(".tw-folder-header")[1]; head.focus();
  assert.equal((await clipKey(head, "v", JSON.stringify({ a: { x: 9 }, b: { x: 3 }, blur: 70 }))).flash, "ok");
  assert.deepEqual([p.params.a.x, p.params.b.x, p.params.blur], [1, 3, 24], "B's own x from the whole-panel copy, nothing else");
  assert.equal((await clipKey(head, "v", JSON.stringify({ "b.y": 8, "a.y": 0 }))).flash, "ok");
  assert.deepEqual([p.params.a.y, p.params.b.y], [2, 8], "the dotted form too");
  assert.equal((await clipKey(head, "v", JSON.stringify({ x: 4, zzz: 1 }))).flash, "ok", "a bare values object is the folder's own");
  p.destroy();
});

test("⌘C on a row copies its value; ⌘V takes a bare value or the row's one-key object, and skips what doesn't fit", async () => {
  const p = await mount2();
  const track = p.el.querySelector(".tw-folder .tw-slider"); track.focus();
  assert.deepEqual(Object.values(await clipKey(track, "c")).slice(0, 1), ["1"]);
  let notified = 0; p.on(() => notified++);
  assert.equal((await clipKey(track, "v", "7")).flash, "ok");
  assert.equal((await clipKey(track, "v", JSON.stringify({ x: 3 }))).flash, "ok");
  assert.deepEqual([p.params.a.x, p.params.a.y, notified], [3, 2, 2], "just that slider, once per paste");
  for (const bad of ["null", "[]", "true", JSON.stringify({ x: 1, y: 2 }), "nope"]) {
    assert.equal((await clipKey(track, "v", bad)).flash, "failed", bad);
  }
  assert.deepEqual([p.params.a.x, notified], [3, 2], "nothing coerced, nobody told");
  assert.equal((await clipKey(track, "v", new Error("denied"))).flash, "failed");
  p.destroy();
});

test("a folder pastes its own copy back even when a subfolder shares its name; a copy after destroy() shows nothing", async () => {
  const p = await mountPanel({ look: { look: { x: [1, 0, 10, 1] }, y: [2, 0, 10, 1] } });
  const head = p.el.querySelector(".tw-folder-header"); head.focus();
  const c = await clipKey(head, "c");
  assert.deepEqual(JSON.parse(c.copied), { look: { x: 1 }, y: 2 });
  p.fromJSON({ values: { look: { look: { x: 7 }, y: 7 } } });
  assert.equal((await clipKey(head, "v", c.copied)).flash, "ok");
  assert.deepEqual(p.params.look, { look: { x: 1 }, y: 2 });
  const copyBtn = p.el.querySelector(".tw-toolbar-btn--swap:not(.tw-toolbar-btn--paste)"); copyBtn.classList.remove("is-copied");
  const clip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async () => {} }, configurable: true });
  try { key(head, { key: "c", metaKey: true }); p.destroy(); await new Promise((r) => setTimeout(r, 10)); }
  finally { if (clip) Object.defineProperty(globalThis.navigator, "clipboard", clip); else delete globalThis.navigator.clipboard; }
  assert.ok(!copyBtn.classList.contains("is-copied"), "the panel is gone: its icon doesn't flash");
});

test("a press beside a row picks it with an even band, and ⌘C / ⌘V act on the pick, not on focus", async () => {
  const p = await mount2();
  const [ax, , bx] = [...p.el.querySelectorAll(".tw-folder .tw-slider")], row = (t) => t.closest(".tw-folder-body > .tw-controls > *");
  p.el.querySelectorAll(".tw-folder-header")[1].focus(); // focus elsewhere in the panel: the pick wins
  pressBeside(p, ax);
  assert.deepEqual(picked(), [row(ax)], "the row level with the press is picked");
  const css = distCss();
  assert.doesNotMatch(css, /is-picked[^{]*\{[^}]*margin/, "picking moves nothing");
  assert.match(css, /\.tw-panel:not\(\[data-mode=floating\]\):has\(\.is-picked\)\{overflow:clip\}/, "an inline panel clips the band on both axes, so it follows the rounded corners");
  assert.match(css, /\.tw-panel \.is-picked:before\{[^}]*inset:-3px -100vmax/, "the band reaches 3px past the row on both sides, halfway to its neighbours, edge to edge");
  assert.match(css, /\.tw-body>\.tw-controls\{[^}]*padding-block:3px;margin-block:-3px\}/, "the body's clip edges sit 3px out, offset so nothing moves, so a first or last row's band isn't cut");
  assert.match(css, /\.tw-folder-body>\.tw-controls\{[^}]*padding:3px 0 8px;margin-top:-3px/, "and a folder's top clip edge too");
  const c = await clipKey(document.activeElement, "c");
  assert.deepEqual([c.copied, c.flash], ["1", "ok"], "its value, not the focused folder's");
  pressBeside(p, bx);
  assert.deepEqual(picked(), [row(bx)], "a new pick moves the ring");
  assert.equal((await clipKey(document.activeElement, "v", c.copied)).flash, "ok");
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

test("a pick out of sight takes nothing: filtered, hidden by its condition, folded away, or on another tab", async () => {
  const p = await mountPanel({ show: true, x: { type: "slider", value: 1, min: 0, max: 10, render: (get) => get("show") }, f: { y: [1, 0, 10, 1] }, t: { type: "tabs", pages: { One: { z: [1, 0, 10, 1] }, Two: { w: [1, 0, 10, 1] } } } }, { filter: true });
  const row = (k) => [...p.el.querySelectorAll(".tw-controls > .tw-slider-wrap")].find((r) => r.querySelector(".tw-slider-label")?.textContent === k);
  const tries = [
    ["X", () => p.set("show", false), () => p.set("show", true)],
    ["Y", () => p.el.querySelector(".tw-folder-header").click(), () => p.el.querySelector(".tw-folder-header").click()],
    ["Z", () => p.el.querySelectorAll(".tw-tabs-tab")[1].click(), () => p.el.querySelectorAll(".tw-tabs-tab")[0].click()],
  ];
  for (const [k, hide, show] of tries) {
    pressBeside(p, row(k)); assert.deepEqual(picked(), [row(k)], `${k} picked`);
    hide(); await wait(20);
    const v = await clipKey(document.body, "v", "9");
    assert.equal(v.prevented, false, `${k}: out of sight, the keys stay the browser's`);
    assert.deepEqual(picked(), [], `${k}: and the pick is dropped`);
    show(); await wait(20);
  }
  assert.deepEqual([p.params.x, p.params.f.y, p.params.t.one.z], [1, 1, 1], "nothing pasted into a row nobody could see");
  p.destroy();
});

test("picking focuses what it picked, never a text field, and drops the selection; a touch never picks; a press in a picked folder's indent picks the row", async () => {
  const p = await mount2();
  const input = p.el.querySelector(".tw-text"); input.focus();
  const sel = window.getSelection(), range = document.createRange(); range.selectNodeContents(p.el.querySelector(".tw-folder-title")); sel.removeAllRanges(); sel.addRange(range);
  const ax = p.el.querySelector(".tw-folder .tw-slider");
  pressBeside(p, ax);
  assert.deepEqual([document.activeElement === ax, String(window.getSelection())], [true, ""], "the picked row's slider has focus and the selection let go, so ⌘C / ⌘V answer to the pick");
  pressBeside(p, p.el.querySelector(".tw-folder-header"));
  assert.equal(document.activeElement, p.el.querySelector(".tw-folder-header"), "a picked folder's header has focus");
  input.focus(); pressBeside(p, input);
  assert.deepEqual([picked(), document.activeElement === input], [[input.closest(".tw-controls > *")], false], "a picked text row isn't focused, so ⌘V pastes the row, not text into it");
  pressBeside(p, ax);
  assert.equal((await clipKey(document.body, "c")).copied, "1");
  pressBeside(p, p.el.querySelectorAll(".tw-folder .tw-slider")[1], { pointerType: "touch" });
  assert.deepEqual(picked(), [], "a touch dropped the pick and picked nothing");
  pressBeside(p, p.el.querySelector(".tw-folder-header"));
  pressBeside(p, ax);
  assert.deepEqual(picked(), [ax.closest(".tw-folder-body > .tw-controls > *")], "a press beside a row inside the picked folder picks the row");
  p.destroy();
});

test("a panel that leaves the page without destroy() frees the page's pick; two quick pastes are two undo steps", async () => {
  const p = await mount2(), q = await mountPanel(scoped(), { undo: true });
  pressBeside(p, p.el.querySelector(".tw-folder .tw-slider"));
  p.el.remove();
  const qx = q.el.querySelector(".tw-folder .tw-slider"); qx.focus();
  assert.equal((await clipKey(qx, "v", "7")).flash, "ok", "the focused row in the other panel takes the keys");
  assert.equal(q.params.a.x, 7);
  await wait(400);
  pressBeside(q, qx); await clipKey(qx, "v", "5");
  pressBeside(q, q.el.querySelectorAll(".tw-folder .tw-slider")[1]); await clipKey(qx, "v", "6");
  await wait(400);
  q.undo();
  assert.deepEqual([q.params.a.x, q.params.a.y], [5, 2], "one undo takes back only the last paste");
  q.undo();
  assert.equal(q.params.a.x, 7, "and the next the one before");
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
