/* The panel's width is a token: 256px by default, and `width` in a theme sets it (a bare
 * number is px), at build or through setTheme(), and setTheme(null) puts the default back. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));
const css = readFileSync(new URL("../dist/tweaks.css", import.meta.url), "utf8");

test("the default width is the --tw-width token, 256px", () => {
  assert.match(css, /--tw-width:\s*256px/);
  assert.match(css, /\.tw-panel\{[^}]*width:\s*var\(--tw-width\)/);
});

test("theme width: a number is px, a string passes through, setTheme(null) clears it", async () => {
  const p = tweaks("W", { a: 1 }, { theme: { width: 300 } }); document.body.append(p.el); await p.ready;
  assert.equal(p.el.style.getPropertyValue("--tw-width"), "300px");
  p.setTheme({ width: "20rem" }); assert.equal(p.el.style.getPropertyValue("--tw-width"), "20rem");
  p.setTheme(null); assert.equal(p.el.style.getPropertyValue("--tw-width"), "");
  p.destroy();
});
