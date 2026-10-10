/* A dropdown option may carry a colour: it shows as a swatch before the label in the list
 * and, for the chosen option, on the row; options without one render as before. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));

test("coloured options get a swatch in the list and on the row; plain ones do not", async () => {
  const p = tweaks("S", { tone: { options: [{ value: "n10", label: "Neutral 10", color: "#f4f4f5" }, { value: "n90", label: "Neutral 90", color: "rgb(24 24 27 / 0.8)" }, "plain"], value: "n90" } });
  document.body.append(p.el); await p.ready;
  const sel = p.el.querySelector(".tw-select"), options = [...sel.querySelectorAll(".tw-select-option")];
  assert.deepEqual(options.map((o) => !!o.querySelector(".tw-option-swatch")), [true, true, false]);
  assert.deepEqual(options.map((o) => o.textContent), ["Neutral 10", "Neutral 90", "Plain"], "labels are text, the swatch adds none");
  assert.match(options[1].querySelector(".tw-option-swatch").style.background, /rgba?\(24,? 24,? 27,? ?\/? ?0\.8\)/);
  const rowSwatch = sel.querySelector(".tw-select-right .tw-option-swatch");
  assert.equal(rowSwatch.style.display, "", "the chosen option's swatch shows on the row"); assert.equal(sel.querySelector(".tw-select-value").textContent, "Neutral 90");
  assert.equal(rowSwatch.compareDocumentPosition(sel.querySelector(".tw-select-value")) & 4, 4, "swatch before the text, as every chip row");
  p.set("tone", "plain"); assert.equal(rowSwatch.style.display, "none", "a plain option hides the row swatch");
  p.set("tone", "n10"); assert.equal(rowSwatch.style.display, ""); assert.match(rowSwatch.style.background, /#f4f4f5|rgb\(244, 244, 245\)/);
  p.destroy();
});

test("a hostile colour string neither throws nor leaks into the label", async () => {
  const p = tweaks("S", { tone: { options: [{ value: "x", label: "X", color: "</style><img src=x onerror=alert(1)>" }, { value: "y", color: 42 }], value: "x" } });
  document.body.append(p.el); await p.ready;
  const options = [...p.el.querySelectorAll(".tw-select-option")];
  assert.equal(options[0].textContent, "X"); assert.equal(p.el.querySelector("img"), null, "a colour is only ever an inline background value");
  assert.equal(options[1].querySelector(".tw-option-swatch"), null, "a non-string colour is ignored");
  p.destroy();
});
