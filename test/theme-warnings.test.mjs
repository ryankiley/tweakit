/* A theme is --twk-* tokens: each applies as given, and a key that isn't one warns and is
 * skipped rather than vanishing. setTheme(null) clears what a theme set. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, warnings } from "./_helpers.mjs";

const { tweaks } = await loadSingle();

const vars = (p) =>
  [...p.el.style]
    .filter((k) => k.startsWith("--twk-"))
    .sort()
    .map((k) => `${k}: ${p.el.style.getPropertyValue(k)}`);

test("a key that isn't a --twk-* token warns once and is skipped", async () => {
  let p;
  const msgs = await warnings(() => {
    p = tweaks("T", { a: 1 }, { theme: { accent: "#f00", "--twk-base": "#111" } });
  });
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /theme: "accent" isn't a --twk-\* token \("--twk-accent", say\) — skipped/);
  assert.deepEqual(vars(p), ["--twk-base: #111"]);
  p.destroy();
});

// 0.6's --tw-* keys were applied as inline custom properties no rule reads: the theme vanished without a word.
test("a 0.6 --tw-* key warns with its new name, and another page variable isn't a token either", async () => {
  let p;
  const msgs = await warnings(() => {
    p = tweaks("T", { a: 1 }, { theme: { "--tw-accent": "#f00", "--brand": "#0f0", "--twk-base": "#111" } });
  });
  assert.equal(msgs.length, 2);
  assert.match(msgs[0], /theme: "--tw-accent" isn't a --twk-\* token \(renamed "--twk-accent" in 0\.7\) — skipped/);
  assert.match(msgs[1], /theme: "--brand" isn't a --twk-\* token/);
  assert.deepEqual(vars(p), ["--twk-base: #111"]);
  p.destroy();
});

test("tokens apply unchanged and silently, at build and through setTheme(), and setTheme(null) clears them", async () => {
  let p;
  const msgs = await warnings(() => {
    p = tweaks(
      "T",
      { a: 1 },
      {
        theme: {
          "--twk-accent": "oklch(70% 0.2 290)",
          "--twk-width": "300px",
          "--twk-anything": "banana",
          "--twk-radius": undefined,
        },
      },
    );
  });
  assert.deepEqual(msgs, []);
  assert.deepEqual(vars(p), ["--twk-accent: oklch(70% 0.2 290)", "--twk-anything: banana", "--twk-width: 300px"]);
  p.setTheme({ "--twk-width": "20rem" });
  assert.deepEqual(vars(p), ["--twk-width: 20rem"]);
  p.setTheme(null);
  assert.deepEqual(vars(p), []);
  p.destroy();
});
