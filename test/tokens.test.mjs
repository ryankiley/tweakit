/* The kit's tokens are declared once for .twk-panel and for everything that lives outside a
 * panel under .twk-portal (popovers, standalone controls, bare markup hosts). A token the
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
    // the token rule, shadow panels aside
    const sels = m[1].replace(/:where\(([^)]*)\):not\(\.twk-in-shadow\)/, "$1").split(",").map((x) => x.trim());
    if (!sels.some((x) => x === cls || x.startsWith(cls + ":"))) continue;
    for (const d of m[2].matchAll(/--twk-[\w-]+(?=\s*:)/g)) out.add(d[0]);
  }
  return out;
};

test("every token the panel declares is declared for .twk-portal too", () => {
  const panel = tokensFor(".twk-panel"), portal = tokensFor(".twk-portal");
  assert.ok(panel.has("--twk-row-height"), "sanity: the panel declares the row height");
  const missing = [...panel].filter((t) => !portal.has(t));
  assert.deepEqual(missing, []);
});

test("a bare [data-twk] host outside a panel gets the token scope; one inside a panel doesn't", async () => {
  const { enhance } = await loadSingle();
  const bare = window.document.createElement("div"); bare.dataset.twk = "slider"; bare.dataset.value = "5"; bare.dataset.min = "0"; bare.dataset.max = "10";
  const panel = window.document.createElement("div"); panel.className = "twk-panel";
  const inner = window.document.createElement("div"); inner.dataset.twk = "slider"; inner.dataset.value = "5"; inner.dataset.min = "0"; inner.dataset.max = "10";
  panel.append(inner); window.document.body.append(bare, panel);
  await enhance(window.document.body);
  assert.ok(bare.classList.contains("twk-portal"));
  assert.ok(!inner.classList.contains("twk-portal"));
  bare.remove(); panel.remove();
});

test("no token is defined in terms of itself", () => {
  // `--x: var(--x)` is a cycle: the property computes to the guaranteed-invalid value, and
  // every declaration that reads it (a swatch's `background: …, var(--x)`) drops to its
  // initial value. The alpha checker went blank across the kit this way.
  const cycles = [...css.matchAll(/(--twk-[\w-]+)\s*:([^;}]*)/g)]
    .filter(([, name, value]) => new RegExp(`var\\(\\s*${name}\\s*[,)]`).test(value))
    .map(([, name]) => name);
  assert.deepEqual([...new Set(cycles)], []);
});

// Secondary, tertiary, label and section text style the 10–12px labels, so each has to clear WCAG 4.5:1 on the base it
// sits on, in both schemes. Read from the source sheet: the minifier may rewrite a color, the tokens are plain there.
test("secondary, tertiary, label and section text clear 4.5:1 on the base in both schemes", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../src/tweaks.css", import.meta.url), "utf8");
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const rgba = (s) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)|#([0-9a-f]{6})\b/i.exec(s); assert.ok(m, `a color: ${s}`); return m[5] ? [...[0, 2, 4].map((i) => parseInt(m[5].slice(i, i + 2), 16)), 1] : [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]]; };
  const ratio = ([r, g, b, a], bg) => { const c = [r, g, b].map((v, i) => v * a + bg[i] * (1 - a)); const [h, l] = [lum(c), lum(bg)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };
  const blocks = [...src.matchAll(/([^{}]+)\{([^{}]*--twk-base:[^{}]*)\}/g)];
  assert.equal(blocks.length, 1, "one token block declares --twk-base, both schemes in light-dark() pairs");
  const decl = blocks[0][2];
  // light-dark(light, dark): arm 0 is the light scheme's color, arm 1 the dark's.
  const tok = (n, arm) => {
    const m = new RegExp(`${n}:\\s*light-dark\\(((?:[^(),]|\\([^()]*\\))+),((?:[^(),]|\\([^()]*\\))+)\\)`).exec(decl);
    assert.ok(m, `${n} is a light-dark() pair`);
    return rgba(m[1 + arm]);
  };
  for (const [arm, scheme] of [[0, "light"], [1, "dark"]]) {
    const base = tok("--twk-base", arm).slice(0, 3);
    for (const n of ["--twk-text-secondary", "--twk-text-tertiary", "--twk-text-label", "--twk-text-section"]) {
      const r = ratio(tok(n, arm), base);
      assert.ok(r >= 4.5, `${n} in ${scheme} is ${r.toFixed(2)}:1 on the base`);
    }
  }
});

// The scheme is the panel's color-scheme: the OS by default, a [data-twk-scheme] pin on the node or an ancestor
// otherwise, and a light pin outranks a dark one, by coming later at the same specificity.
test("pins set color-scheme on the kit's nodes, the light pin after the dark", () => {
  const at = (s) => css.indexOf(s);
  const dark = at('.twk-panel:where([data-twk-scheme=dark],[data-twk-scheme=dark] *),.twk-portal:where([data-twk-scheme=dark],[data-twk-scheme=dark] *){color-scheme:dark}');
  const light = at('.twk-panel:where([data-twk-scheme=light],[data-twk-scheme=light] *),.twk-portal:where([data-twk-scheme=light],[data-twk-scheme=light] *){color-scheme:light}');
  assert.ok(dark > 0 && light > dark, "both pin rules ship, light last");
  assert.ok(/\.twk-panel,\.twk-portal\{[^}]*color-scheme:light dark/.test(css), "unpinned, the kit follows the OS");
  // The slider handle's light-only edge is the one scheme rule left outside light-dark(): a shadow can't come and go by color.
  assert.deepEqual([...css.matchAll(/@media ?\(prefers-color-scheme: ?light\)\{([^{}]+)\{/g)].map((m) => m[1]), ['.twk-slider-handle:where(:not([data-twk-scheme=dark] *))'], "no media-driven token block is left");
});
