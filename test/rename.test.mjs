/* opts.rename: a click on the title swaps it for a field. Enter or leaving the field commits
 * the trimmed name (through the same path as setName, so the copy toast follows and the
 * storage key keeps the built-with name), Escape cancels, an empty field keeps the name. The
 * chevron beside the title takes over collapsing. The shown name rides in toJSON().ui.name
 * when it differs and fromJSON restores it. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

test("click the title to rename: Enter, Escape, blur and the empty field; the chevron collapses", async () => {
  const names = []; const p = tweaks("Scene", { a: 1 }, { rename: true, onRename: (n) => names.push(n) }); document.body.append(p.el); await p.ready;
  const titleBtn = p.el.querySelector(".tw-header-toggle"), chev = p.el.querySelector(".tw-header-chevron"), input = p.el.querySelector(".tw-rename-input"), title = () => p.el.querySelector(".tw-title").textContent;
  assert.ok(chev && input, "a chevron and the field"); assert.equal(p.el.querySelector('[aria-label="Rename panel"]'), null, "no toolbar button");
  assert.equal(titleBtn.getAttribute("aria-label"), "Rename Scene"); assert.equal(titleBtn.getAttribute("aria-expanded"), null, "the title no longer collapses");
  assert.equal(chev.getAttribute("aria-expanded"), "true"); assert.equal(chev.compareDocumentPosition(titleBtn) & 4, 4, "the chevron leads the title");
  titleBtn.click(); assert.ok(p.el.classList.contains("is-renaming")); assert.ok(!p.el.classList.contains("is-collapsed"), "a title click renames, it does not collapse");
  assert.equal(input.value, "Scene"); assert.equal(document.activeElement, input, "the field takes focus with the name selected");
  input.value = "Hero"; input.dispatchEvent(new window.Event("input")); assert.equal(p.el.querySelector(".tw-rename-mirror").textContent, "Hero", "the mirror follows the text, so the field hugs it"); key(input, "Enter");
  assert.equal(title(), "Hero"); assert.deepEqual(names, ["Hero"]); assert.ok(!p.el.classList.contains("is-renaming")); assert.equal(document.activeElement, titleBtn, "focus returns to the title");
  assert.equal(titleBtn.getAttribute("aria-label"), "Rename Hero"); assert.equal(p.toJSON().ui.name, "Hero", "the rename rides in the UI state");
  titleBtn.click(); input.value = "Nope"; key(input, "Escape"); assert.equal(title(), "Hero"); assert.deepEqual(names, ["Hero"], "Escape cancels");
  titleBtn.click(); input.value = "  Stage  "; input.blur(); assert.equal(title(), "Stage"); assert.deepEqual(names, ["Hero", "Stage"], "leaving the field commits, trimmed");
  titleBtn.click(); input.value = "   "; key(input, "Enter"); assert.equal(title(), "Stage"); assert.equal(names.length, 2, "an empty field keeps the name");
  chev.click(); assert.ok(p.el.classList.contains("is-collapsed")); assert.equal(chev.getAttribute("aria-expanded"), "false");
  chev.click(); assert.ok(!p.el.classList.contains("is-collapsed"));
  p.destroy();
});

test("without the option the title collapses and there is no chevron; fromJSON restores a name; toolbar: false still renames", async () => {
  const plain = tweaks("Plain", { a: 1 }); document.body.append(plain.el); await plain.ready;
  assert.equal(plain.el.querySelector(".tw-rename-input"), null); assert.equal(plain.el.querySelector(".tw-header-chevron"), null);
  plain.el.querySelector(".tw-header-toggle").click(); assert.ok(plain.el.classList.contains("is-collapsed"), "the title is the toggle, as before"); plain.el.querySelector(".tw-header-toggle").click();
  assert.equal(plain.toJSON().ui.name, undefined, "no name until it differs");
  plain.fromJSON({ ui: { name: "Restored" } }); await wait(30);
  assert.equal(plain.el.querySelector(".tw-title").textContent, "Restored"); assert.equal(plain.toJSON().ui.name, "Restored");
  plain.setName("Plain"); assert.equal(plain.toJSON().ui.name, undefined, "back to the built-with name drops it again");
  plain.destroy();
  const bare = tweaks("Bare", { a: 1 }, { rename: true, toolbar: false }); document.body.append(bare.el); await bare.ready;
  assert.ok(bare.el.querySelector(".tw-rename-input") && bare.el.querySelector(".tw-header-chevron"), "the title is always there, so a bare panel renames too"); bare.destroy();
});
