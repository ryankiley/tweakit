/* The list control: an option may carry a color, shown as a swatch before its label in the list and, for the chosen
 * option, on the row; and with the dropdown open, typing moves focus to the option whose label starts with the typed
 * keys, as a native select does: keys within a beat form a prefix, the same key again moves on to the next match
 * (wrapping), a key that matches nothing leaves focus where it is, a space continues a prefix under way but on its own
 * stays the focused option's, and every open starts the buffer fresh. The type-ahead fixture's Avalon and numeric label
 * exist to catch a search that skips the focused option on a growing prefix, or assumes string labels. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, mounter, key, wait } from "./_helpers.mjs";

const { tweaks } = await loadSingle();

test("colored options get a swatch in the list and on the row; plain ones do not", async () => {
  const p = tweaks("S", {
    tone: {
      options: [
        { value: "n10", label: "Neutral 10", color: "#f4f4f5" },
        { value: "n90", label: "Neutral 90", color: "rgb(24 24 27 / 0.8)" },
        "plain",
      ],
      value: "n90",
    },
  });
  document.body.append(p.el);
  await p.ready;
  const sel = p.el.querySelector(".twk-select"),
    options = [...sel.querySelectorAll(".twk-select-option")];
  assert.deepEqual(
    options.map((o) => !!o.querySelector(".twk-option-swatch")),
    [true, true, false],
  );
  assert.deepEqual(
    options.map((o) => o.textContent),
    ["Neutral 10", "Neutral 90", "plain"],
    "labels are text, the swatch adds none",
  );
  assert.match(options[1].querySelector(".twk-option-swatch").style.background, /rgba?\(24,? 24,? 27,? ?\/? ?0\.8\)/);
  const rowSwatch = sel.querySelector(".twk-select-right .twk-option-swatch");
  assert.equal(rowSwatch.style.display, "", "the chosen option's swatch shows on the row");
  assert.equal(sel.querySelector(".twk-select-value").textContent, "Neutral 90");
  assert.equal(
    rowSwatch.compareDocumentPosition(sel.querySelector(".twk-select-value")) & 4,
    4,
    "swatch before the text, as every chip row",
  );
  p.set("tone", "plain");
  assert.equal(rowSwatch.style.display, "none", "a plain option hides the row swatch");
  p.set("tone", "n10");
  assert.equal(rowSwatch.style.display, "");
  assert.match(rowSwatch.style.background, /#f4f4f5|rgb\(244, 244, 245\)/);
  p.destroy();
});

test("a hostile color string neither throws nor leaks into the label", async () => {
  const p = tweaks("S", {
    tone: {
      options: [
        { value: "x", label: "X", color: "</style><img src=x onerror=alert(1)>" },
        { value: "y", color: 42 },
      ],
      value: "x",
    },
  });
  document.body.append(p.el);
  await p.ready;
  const options = [...p.el.querySelectorAll(".twk-select-option")];
  assert.equal(options[0].textContent, "X");
  assert.equal(p.el.querySelector("img"), null, "a color is only ever an inline background value");
  assert.equal(options[1].querySelector(".twk-option-swatch"), null, "a non-string color is ignored");
  p.destroy();
});

test("a color is one token; a string that would splice layers into the background is dropped, a var() is kept", async () => {
  const p = tweaks("S", {
    tone: {
      options: [
        { value: "a", color: "red), url(https://x/p.png), linear-gradient(red" },
        { value: "b", color: "var(--accent)" },
        { value: "c", color: " color(display-p3 1 0 0) " },
        { value: "d", color: "rgb(1 2 3) rgb(4 5 6)" },
      ],
      value: "a",
    },
  });
  document.body.append(p.el);
  await p.ready;
  const [a, b, c, d] = [...p.el.querySelectorAll(".twk-select-option")].map((o) =>
    o.querySelector(".twk-option-swatch"),
  );
  assert.equal(a, null, "a spliced string gets no swatch");
  assert.equal(p.el.querySelector(".twk-select-right .twk-option-swatch").style.display, "none", "and none on the row");
  assert.ok(b && c, "var() and a trimmed color() are one token each");
  assert.equal(d, null, "two tokens are not a color");
  assert.doesNotMatch(p.el.innerHTML, /url\(https:\/\/x/, "the string never reaches a style attribute");
  p.destroy();
});

const focused = () => document.activeElement.textContent;
// the shell focuses an option a frame after opening
const open = async (p) => {
  p.el.querySelector(".twk-select-trigger").click();
  await wait(40);
  return document.querySelector(".twk-select-dropdown.is-open");
};

test("type-ahead in an open list", async () => {
  const p = await mounter(
    tweaks,
    "L",
  )({ fruit: ["Apple", "Avocado", "Avalon", "Banana", "Blueberry", "Cherry", { value: "n7", label: 7 }] });
  try {
    const dropdown = await open(p);
    assert.equal(focused(), "Apple", "opening focuses the chosen option");
    assert.equal(key(dropdown, { key: "b" }).defaultPrevented, true, "a matched key is consumed");
    assert.equal(focused(), "Banana");
    key(dropdown, { key: "b" });
    assert.equal(focused(), "Blueberry", "the same letter again moves to the next match");
    key(dropdown, { key: "b" });
    assert.equal(focused(), "Banana", "and wraps");
    await wait(650);
    key(dropdown, { key: "c" });
    assert.equal(focused(), "Cherry", "after the beat a letter starts over");
    await wait(650);
    key(dropdown, { key: "a" });
    assert.equal(focused(), "Apple", "wrapping past the end");
    await wait(650);
    key(dropdown, { key: "a" });
    assert.equal(focused(), "Avocado", "a lone letter moves past the focused option");
    key(dropdown, { key: "v" });
    assert.equal(focused(), "Avocado", "a growing prefix re-tests the focused option before moving on");
    key(dropdown, { key: "x" });
    assert.equal(focused(), "Avocado", "no match: focus stays");
    key(dropdown, { key: "c", ctrlKey: true });
    assert.equal(focused(), "Avocado", "a shortcut is not a letter");
    key(dropdown, { key: "c", isComposing: true });
    assert.equal(focused(), "Avocado", "nor is a composition keystroke");
    assert.equal(
      key(dropdown, { key: " " }).defaultPrevented,
      true,
      "a space inside a prefix is typed, not the option's activation",
    );
    assert.equal(focused(), "Avocado");
    assert.equal(p.params.fruit, "Apple", "moving focus selects nothing");
    await wait(650);
    assert.equal(
      key(dropdown, { key: " " }).defaultPrevented,
      false,
      "a space on its own is left to activate the option",
    );
    key(dropdown, { key: "c", metaKey: true });
    assert.equal(focused(), "Avocado", "a shortcut after the beat is still not a letter");
    key(dropdown, { key: "e" });
    assert.equal(focused(), "Avocado", "a letter inside labels but starting none matches nothing");
    await wait(650); // the unmatched e still sits in the buffer for a beat
    key(dropdown, { key: "7" });
    assert.equal(focused(), "7", "a numeric label is matched as text");
  } finally {
    p.destroy();
  }
});

test("a fresh open starts over, a space continues a prefix, a leading space and a two-code-unit lowercase are matched", async () => {
  const p = await mounter(
    tweaks,
    "L",
  )({ place: ["Apple", { value: "sp", label: " Spaced" }, "New York", "New Jersey", "İstanbul", "İzmir"] });
  try {
    let dropdown = await open(p);
    key(dropdown, { key: "n" });
    assert.equal(focused(), "New York");
    key(dropdown, { key: "Escape" });
    dropdown = await open(p);
    assert.equal(focused(), "Apple");
    key(dropdown, { key: "e" });
    assert.equal(focused(), "Apple", "the last open's prefix is gone, so this is a lone e with no match");
    await wait(650);
    for (const k of ["n", "e", "w", " ", "j"]) key(dropdown, { key: k });
    assert.equal(focused(), "New Jersey", "a space inside the beat is part of the prefix");
    await wait(650);
    key(dropdown, { key: "s" });
    assert.equal(focused(), " Spaced", "a label's leading space is skipped");
    await wait(650);
    key(dropdown, { key: "İ" });
    assert.equal(focused(), "İstanbul");
    key(dropdown, { key: "İ" });
    assert.equal(focused(), "İzmir", "a repeated key whose lowercase is two code units still cycles");
  } finally {
    p.destroy();
  }
});
