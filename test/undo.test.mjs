/* undo.ts on its own: the history against a plain state object, no panel. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { bundle } from "./_bundle.mjs";
import { key, wait } from "./_helpers.mjs";

const { createUndo } = await bundle("src/tweaks/undo.ts");
const atPath = (o, path) => path.reduce((x, k) => (x == null ? undefined : x[k]), o);
// A state the history reads and writes, and the change hook a panel would call after each write.
const rig = (state) => {
  let fire = () => {};
  const panel = document.createElement("div"); document.body.append(panel);
  const h = createUndo(panel, () => JSON.parse(JSON.stringify(state)), (s) => { for (const k in s) state[k] = s[k]; }, atPath, (t) => !!t?.matches?.("input"), (fn) => { fire = fn; });
  h.arm();
  return { h, panel, edit: (k, v) => { state[k] = v; fire(); } };
};

test("undo and redo walk the steps; an edit right before undo is its own step; a new edit drops the redo branch", () => {
  const state = { x: 1, y: "a" }, { h, edit } = rig(state);
  edit("x", 2); h.flush(); edit("x", 3); // the second edit is still in its debounce when undo runs
  h.undo(); assert.equal(state.x, 2);
  h.undo(); assert.equal(state.x, 1);
  h.undo(); assert.equal(state.x, 1, "the base is as far back as it goes");
  h.redo(); assert.equal(state.x, 2);
  edit("y", "b"); h.flush();
  h.redo(); assert.deepEqual(state, { x: 2, y: "b" }, "the edit dropped the redo of x = 3");
});

test("a write the history makes itself isn't a step, and an unchanged state commits none", async () => {
  const state = { x: 1 }, { h, edit } = rig(state);
  edit("x", 2); h.flush(); h.undo();
  await wait(400); // past the debounce: the undo's own write must not have queued a step
  h.redo(); assert.equal(state.x, 2, "redo still reaches 2");
  edit("x", 2); h.flush(); h.undo(); assert.equal(state.x, 1, "rewriting the same value was no new step");
});

test("patch writes a late restore into every step that still held the row's old value", () => {
  const state = { im: null, x: 1 }, { h, edit } = rig(state);
  edit("x", 2); h.flush();
  h.patch(["im"], null, "data:image/png;base64,AAAA");
  state.im = "data:image/png;base64,AAAA";
  h.undo(); assert.deepEqual(state, { im: "data:image/png;base64,AAAA", x: 1 }, "undo kept the restored image");
});

test("⌘Z and ⌘⇧Z belong to the panel while it's focused, and not inside an editable field", () => {
  const state = { x: 1 }, { h, panel, edit } = rig(state);
  const field = document.createElement("input"), item = document.createElement("button"); panel.append(field, item);
  edit("x", 2); h.flush();
  document.addEventListener("keydown", h.onKey);
  try {
    field.focus(); assert.equal(key(field, { key: "z", metaKey: true }).defaultPrevented, false, "a field keeps its own undo");
    item.focus(); assert.equal(key(item, { key: "z", metaKey: true }).defaultPrevented, true); assert.equal(state.x, 1);
    key(item, { key: "z", metaKey: true, shiftKey: true }); assert.equal(state.x, 2, "⌘⇧Z redoes");
    item.blur(); key(document.body, { key: "z", metaKey: true }); assert.equal(state.x, 2, "unfocused, the page's ⌘Z is its own");
  } finally { document.removeEventListener("keydown", h.onKey); panel.remove(); }
});
