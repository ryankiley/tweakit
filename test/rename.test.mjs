/* opts.rename: a toolbar pencil swaps the title for a field. Enter or leaving the field
 * commits the trimmed name (through the same path as setName, so the copy toast follows and
 * the storage key keeps the built-with name), Escape cancels, an empty field keeps the name.
 * The shown name rides in toJSON().ui.name when it differs and fromJSON restores it. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

test("the pencil, Enter, Escape, blur and the empty field", async () => {
  const names = []; const p = tweaks("Scene", { a: 1 }, { rename: true, onRename: (n) => names.push(n) }); document.body.append(p.el); await p.ready;
  const btn = p.el.querySelector('.tw-toolbar-btn[aria-label="Rename panel"]'), input = p.el.querySelector(".tw-rename"), title = () => p.el.querySelector(".tw-title").textContent;
  assert.ok(btn && input, "a rename button and its field");
  btn.click(); assert.ok(p.el.classList.contains("is-renaming")); assert.equal(input.value, "Scene"); assert.equal(document.activeElement, input, "the field takes focus with the name selected");
  input.value = "Hero"; key(input, "Enter");
  assert.equal(title(), "Hero"); assert.deepEqual(names, ["Hero"]); assert.ok(!p.el.classList.contains("is-renaming")); assert.equal(document.activeElement, btn, "focus returns to the button");
  assert.equal(p.toJSON().ui.name, "Hero", "the rename rides in the UI state");
  btn.click(); input.value = "Nope"; key(input, "Escape"); assert.equal(title(), "Hero"); assert.deepEqual(names, ["Hero"], "Escape cancels");
  btn.click(); input.value = "  Stage  "; input.blur(); assert.equal(title(), "Stage"); assert.deepEqual(names, ["Hero", "Stage"], "leaving the field commits, trimmed");
  btn.click(); input.value = "   "; key(input, "Enter"); assert.equal(title(), "Stage"); assert.equal(names.length, 2, "an empty field keeps the name");
  btn.click(); input.value = "Stage"; key(input, "Enter"); assert.equal(names.length, 2, "the same name is not a rename");
  p.destroy();
});

test("without the option there is no button; fromJSON restores a name; a fresh panel carries none", async () => {
  const plain = tweaks("Plain", { a: 1 }); document.body.append(plain.el); await plain.ready;
  assert.equal(plain.el.querySelector(".tw-rename"), null); assert.equal(plain.toJSON().ui.name, undefined, "no name until it differs");
  plain.fromJSON({ ui: { name: "Restored" } }); await wait(30);
  assert.equal(plain.el.querySelector(".tw-title").textContent, "Restored"); assert.equal(plain.toJSON().ui.name, "Restored");
  plain.setName("Plain"); assert.equal(plain.toJSON().ui.name, undefined, "back to the built-with name drops it again");
  plain.destroy();
  const bare = tweaks("Bare", { a: 1 }, { rename: true, toolbar: false }); document.body.append(bare.el); await bare.ready;
  assert.equal(bare.el.querySelector(".tw-rename"), null, "no toolbar, no rename field"); bare.destroy();
});
