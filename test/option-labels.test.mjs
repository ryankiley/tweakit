/* A string option's label title-cases a camel hump ("fontSize" → "Font Size") and leaves a
 * run of capitals or a digit before one alone ("XS", "2XL", "RGB" used to render "X S",
 * "2 X L", "R G B"). */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));

test("string option labels: camel humps split, capital runs and digits do not", async () => {
  const p = tweaks("L", { size: { type: "radiogrid", options: ["XS", "2XL", "RGB", "fontSize", "small"] } }); document.body.append(p.el); await p.ready;
  assert.deepEqual([...p.el.querySelectorAll(".tw-radiogrid-btn")].map((b) => b.textContent), ["XS", "2XL", "RGB", "Font Size", "Small"]);
  p.destroy();
});
