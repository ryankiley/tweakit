/* No --tw-* custom property may reference itself: a cycle makes the token invalid at
 * computed-value time, and every declaration that reads it (a swatch's whole background,
 * not just its checker layer) silently drops — jsdom paints nothing, so only this check
 * sees it. Runs against the built stylesheet. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../dist/tweaks.css", import.meta.url), "utf8");

test("no custom property is defined in terms of itself", () => {
  const cycles = [...css.matchAll(/(--tw-[\w-]+)\s*:([^;}]*)/g)].filter(([, name, value]) => value.includes(`var(${name})`) || value.includes(`var(${name},`)).map(([decl]) => decl.trim());
  assert.deepEqual(cycles, []);
});

test("the alpha checker token is a real pattern", () => {
  const m = /--tw-checker\s*:([^;}]*)/.exec(css);
  assert.ok(m, "--tw-checker is defined"); assert.match(m[1], /repeating-conic-gradient\(/);
});
