/* The panel's width is a token, 256px by default; theme-warnings.test.mjs sets it through a theme. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { distCss } from "./_helpers.mjs";

const css = distCss();

test("the default width is the --tw-width token, 256px", () => {
  assert.match(css, /--tw-width:\s*256px/);
  assert.match(css, /\.tw-panel\{[^}]*width:\s*var\(--tw-width\)/);
});
