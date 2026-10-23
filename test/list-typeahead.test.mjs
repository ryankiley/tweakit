/* With the dropdown open, typing moves focus to the option whose label starts with the typed keys, as a native
 * select does: keys within a beat form a prefix, the same key again moves on to the next match (wrapping), a key
 * that matches nothing leaves focus where it is, a space continues a prefix under way but on its own stays the
 * focused option's, and every open starts the buffer fresh. The fixture's Avalon and numeric label exist to
 * catch a search that skips the focused option on a growing prefix, or assumes string labels. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, mounter, key, wait } from "./_helpers.mjs";

const { tweaks } = await loadSingle();
const focused = () => document.activeElement.textContent;
const open = async (p) => { p.el.querySelector(".tw-select-trigger").click(); await wait(40); return document.querySelector(".tw-select-dropdown.is-open"); }; // the shell focuses an option a frame after opening

test("type-ahead in an open list", async () => {
  const p = await mounter(tweaks, "L")({ fruit: ["Apple", "Avocado", "Avalon", "Banana", "Blueberry", "Cherry", { value: "n7", label: 7 }] });
  try {
    const dropdown = await open(p);
    assert.equal(focused(), "Apple", "opening focuses the chosen option");
    assert.equal(key(dropdown, { key: "b" }).defaultPrevented, true, "a matched key is consumed"); assert.equal(focused(), "Banana");
    key(dropdown, { key: "b" }); assert.equal(focused(), "Blueberry", "the same letter again moves to the next match");
    key(dropdown, { key: "b" }); assert.equal(focused(), "Banana", "and wraps");
    await wait(650);
    key(dropdown, { key: "c" }); assert.equal(focused(), "Cherry", "after the beat a letter starts over");
    await wait(650);
    key(dropdown, { key: "a" }); assert.equal(focused(), "Apple", "wrapping past the end");
    await wait(650);
    key(dropdown, { key: "a" }); assert.equal(focused(), "Avocado", "a lone letter moves past the focused option");
    key(dropdown, { key: "v" }); assert.equal(focused(), "Avocado", "a growing prefix re-tests the focused option before moving on");
    key(dropdown, { key: "x" }); assert.equal(focused(), "Avocado", "no match: focus stays");
    key(dropdown, { key: "c", ctrlKey: true }); assert.equal(focused(), "Avocado", "a shortcut is not a letter");
    key(dropdown, { key: "c", isComposing: true }); assert.equal(focused(), "Avocado", "nor is a composition keystroke");
    assert.equal(key(dropdown, { key: " " }).defaultPrevented, true, "a space inside a prefix is typed, not the option's activation");
    assert.equal(focused(), "Avocado"); assert.equal(p.params.fruit, "Apple", "moving focus selects nothing");
    await wait(650);
    assert.equal(key(dropdown, { key: " " }).defaultPrevented, false, "a space on its own is left to activate the option");
    key(dropdown, { key: "c", metaKey: true }); assert.equal(focused(), "Avocado", "a shortcut after the beat is still not a letter");
    key(dropdown, { key: "e" }); assert.equal(focused(), "Avocado", "a letter inside labels but starting none matches nothing");
    await wait(650); // the unmatched e still sits in the buffer for a beat
    key(dropdown, { key: "7" }); assert.equal(focused(), "7", "a numeric label is matched as text");
  } finally { p.destroy(); }
});

test("review follow-ups: a fresh open starts over, a space continues a prefix, a leading space and a two-code-unit lowercase are matched", async () => {
  const p = await mounter(tweaks, "L")({ place: ["Apple", { value: "sp", label: " Spaced" }, "New York", "New Jersey", "İstanbul", "İzmir"] });
  try {
    let dropdown = await open(p);
    key(dropdown, { key: "n" }); assert.equal(focused(), "New York");
    key(dropdown, { key: "Escape" }); dropdown = await open(p);
    assert.equal(focused(), "Apple");
    key(dropdown, { key: "e" }); assert.equal(focused(), "Apple", "the last open's prefix is gone, so this is a lone e with no match");
    await wait(650);
    for (const k of ["n", "e", "w", " ", "j"]) key(dropdown, { key: k });
    assert.equal(focused(), "New Jersey", "a space inside the beat is part of the prefix");
    await wait(650);
    key(dropdown, { key: "s" }); assert.equal(focused(), " Spaced", "a label's leading space is skipped");
    await wait(650);
    key(dropdown, { key: "İ" }); assert.equal(focused(), "İstanbul");
    key(dropdown, { key: "İ" }); assert.equal(focused(), "İzmir", "a repeated key whose lowercase is two code units still cycles");
  } finally { p.destroy(); }
});
