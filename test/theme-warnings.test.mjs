/* A theme is --tw-* tokens: each applies as given, and a key that isn't one warns and is
 * skipped rather than vanishing. setTheme(null) clears what a theme set. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, warnings } from "./_helpers.mjs";

const { tweaks } = await loadSingle();

const vars = (p) => [...p.el.style].filter((k) => k.startsWith("--tw-")).sort().map((k) => `${k}: ${p.el.style.getPropertyValue(k)}`);

test("a key that isn't a --tw-* token warns once and is skipped", async () => {
  let p;
  const msgs = await warnings(() => { p = tweaks("T", { a: 1 }, { theme: { accent: "#f00", "--tw-base": "#111" } }); });
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /theme: "accent" isn't a --tw-\* token \("--tw-accent", say\) — skipped/);
  assert.deepEqual(vars(p), ["--tw-base: #111"]);
  p.destroy();
});

test("tokens apply unchanged and silently, at build and through setTheme(), and setTheme(null) clears them", async () => {
  let p;
  const msgs = await warnings(() => {
    p = tweaks("T", { a: 1 }, { theme: { "--tw-accent": "oklch(70% 0.2 290)", "--tw-width": "300px", "--tw-anything": "banana", "--tw-radius": undefined } });
  });
  assert.deepEqual(msgs, []);
  assert.deepEqual(vars(p), ["--tw-accent: oklch(70% 0.2 290)", "--tw-anything: banana", "--tw-width: 300px"]);
  p.setTheme({ "--tw-width": "20rem" }); assert.deepEqual(vars(p), ["--tw-width: 20rem"]);
  p.setTheme(null); assert.deepEqual(vars(p), []);
  p.destroy();
});
