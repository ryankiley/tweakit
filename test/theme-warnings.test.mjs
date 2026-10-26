/* A theme mistake warns and is skipped rather than vanishing: an unknown friendly key (with the
 * key a typo is one letter off), a color key holding no color, a length key holding no length.
 * Raw --tw-* tokens stay unchecked, and a valid theme resolves as it always has. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, warnings } from "./_helpers.mjs";

const { tweaks } = await loadSingle();

const vars = (p) => [...p.el.style].filter((k) => k.startsWith("--tw-")).sort().map((k) => `${k}: ${p.el.style.getPropertyValue(k)}`);

test("an unknown theme key warns once, naming the near key and the valid ones", async () => {
  let p;
  const msgs = await warnings(() => { p = tweaks("T", { a: 1 }, { theme: { acent: "#f00" } }); });
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /theme: "acent" isn't a theme key — did you mean "accent"\? It is skipped\. Keys: accent, onAccent, /);
  assert.deepEqual(vars(p), []);
  p.destroy();
});

test("a length key holding no length warns and is skipped; numbers and CSS lengths still apply", async () => {
  const p = tweaks("T", { a: 1 });
  const msgs = await warnings(() => p.setTheme({ radius: "banana", width: 300, density: "2rem" }));
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /theme: radius "banana" isn't a CSS length or a number of px — skipped/);
  assert.equal(p.el.style.getPropertyValue("--tw-radius"), "");
  assert.equal(p.el.style.getPropertyValue("--tw-width"), "300px");
  assert.equal(p.el.style.getPropertyValue("--tw-row-height"), "2rem");
  p.destroy();
});

test("a color key holding no color warns and is skipped where CSS.supports can judge it", async () => {
  // jsdom has no CSS.supports, so stand one in that knows hex only.
  globalThis.CSS = { supports: (prop, v) => prop === "color" && /^#[0-9a-f]{3,8}$/i.test(v) };
  try {
    const p = tweaks("T", { a: 1 });
    const msgs = await warnings(() => p.setTheme({ accent: "notacolor", base: "#111" }));
    assert.equal(msgs.length, 1);
    assert.match(msgs[0], /theme: accent "notacolor" isn't a CSS color — skipped/);
    assert.equal(p.el.style.getPropertyValue("--tw-accent"), "");
    assert.equal(p.el.style.getPropertyValue("--tw-base"), "#111");
    p.destroy();
  } finally { delete globalThis.CSS; }
});

test("a valid theme and raw tokens resolve unchanged, silently, and setTheme(null) clears them", async () => {
  let p;
  const msgs = await warnings(() => {
    p = tweaks("T", { a: 1 }, { theme: { accent: "oklch(70% 0.2 290)", radius: 8, width: "20rem", font: "Inter, sans-serif", shadow: "0 1px 2px #0004", "--tw-anything": "banana" } });
  });
  assert.deepEqual(msgs, []);
  assert.deepEqual(vars(p), [
    "--tw-accent: oklch(70% 0.2 290)", "--tw-anything: banana", "--tw-font-sans: Inter, sans-serif",
    "--tw-on-accent: #ffffff", "--tw-radius: 8px", "--tw-shadow-dropdown: 0 1px 2px #0004", "--tw-width: 20rem",
  ]);
  p.setTheme(null); assert.deepEqual(vars(p), []);
  p.destroy();
});
