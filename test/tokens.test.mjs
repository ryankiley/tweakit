/* The kit's tokens are declared once for .tw-panel and for everything that lives outside a
 * panel under .tw-portal (popovers, standalone controls, bare markup hosts). A token the
 * panel has and the portal scope lacks left a bare control with no row height. */
import test from "node:test";
import assert from "node:assert/strict";
import { window } from "./_setup-dom.mjs";
import { loadSingle, distCss } from "./_helpers.mjs";

const css = distCss();
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
  const { enhance } = await loadSingle();
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

// Secondary, tertiary, label and section text style the 10–12px labels, so each has to clear WCAG 4.5:1 on the base it
// sits on, in both schemes. Read from the source sheet: the minifier may rewrite a colour, the tokens are plain there.
test("secondary, tertiary, label and section text clear 4.5:1 on the base in both schemes", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../src/tweaks.css", import.meta.url), "utf8");
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const rgba = (s) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)|#([0-9a-f]{6})\b/i.exec(s); assert.ok(m, `a colour: ${s}`); return m[5] ? [...[0, 2, 4].map((i) => parseInt(m[5].slice(i, i + 2), 16)), 1] : [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]]; };
  const ratio = ([r, g, b, a], bg) => { const c = [r, g, b].map((v, i) => v * a + bg[i] * (1 - a)); const [h, l] = [lum(c), lum(bg)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };
  const blocks = [...src.matchAll(/([^{}]+)\{([^{}]*--tw-base:[^{}]*)\}/g)];
  assert.equal(blocks.length, 2, "a dark and a light token block declare --tw-base");
  for (const [, sel, decl] of blocks) {
    const tok = (n) => rgba(new RegExp(`${n}:\\s*([^;]+)`).exec(decl)[1]);
    const base = tok("--tw-base").slice(0, 3);
    for (const n of ["--tw-text-secondary", "--tw-text-tertiary", "--tw-text-label", "--tw-text-section"]) {
      const r = ratio(tok(n), base);
      assert.ok(r >= 4.5, `${n} in ${sel.trim().slice(0, 24)}… is ${r.toFixed(2)}:1 on the base`);
    }
  }
});
