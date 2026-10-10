/* The kit's tokens are declared once for .tw-panel and for everything that lives outside a
 * panel under .tw-portal (popovers, standalone controls, bare markup hosts). A token the
 * panel has and the portal scope lacks left a bare control with no row height. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { window } from "./_setup-dom.mjs";

const css = await readFile(new URL("../dist/tweaks.css", import.meta.url), "utf8");
// Minified CSS: every `selector{declarations}` pair, outermost level only is enough here.
const tokensFor = (cls) => {
  const out = new Set();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(",").map((x) => x.trim());
    if (!sels.some((x) => x === cls || x.startsWith(cls + ":"))) continue;
    for (const d of m[2].matchAll(/--tw-[\w-]+(?=\s*:)/g)) out.add(d[0]);
  }
  return out;
};

test("every token the panel declares is declared for .tw-portal too", () => {
  const panel = tokensFor(".tw-panel"), portal = tokensFor(".tw-portal");
  assert.ok(panel.has("--tw-row-height"), "sanity: the panel declares the row height");
  const missing = [...panel].filter((t) => !portal.has(t));
  assert.deepEqual(missing, []);
});

test("a bare [data-tw] host outside a panel gets the token scope; one inside a panel doesn't", async () => {
  const { enhance } = await import(new URL("../dist/tweaks.js", import.meta.url));
  const bare = window.document.createElement("div"); bare.dataset.tw = "slider"; bare.dataset.value = "5"; bare.dataset.min = "0"; bare.dataset.max = "10";
  const panel = window.document.createElement("div"); panel.className = "tw-panel";
  const inner = window.document.createElement("div"); inner.dataset.tw = "slider"; inner.dataset.value = "5"; inner.dataset.min = "0"; inner.dataset.max = "10";
  panel.append(inner); window.document.body.append(bare, panel);
  await enhance(window.document.body);
  assert.ok(bare.classList.contains("tw-portal"));
  assert.ok(!inner.classList.contains("tw-portal"));
  bare.remove(); panel.remove();
});

test("no token is defined in terms of itself", () => {
  // `--x: var(--x)` is a cycle: the property computes to the guaranteed-invalid value, and
  // every declaration that reads it (a swatch's `background: …, var(--x)`) drops to its
  // initial value. The alpha checker went blank across the kit this way.
  const cycles = [...css.matchAll(/(--tw-[\w-]+)\s*:([^;}]*)/g)]
    .filter(([, name, value]) => new RegExp(`var\\(\\s*${name}\\s*[,)]`).test(value))
    .map(([, name]) => name);
  assert.deepEqual([...new Set(cycles)], []);
});
