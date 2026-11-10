/* A page of shadow panels alone has no kit stylesheet in the document, so shadow-root.ts carries the few rules that
 * must live in the page itself (PAGE_CSS): the @property registrations, the screen-reader region and a lifted panel's
 * slot. They are copies of rules in tweaks.css, and nothing else ties the two together: this fails when one is edited
 * without the other. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const squash = (s) => s.replace(/\s+/g, " ").trim();
// prelude → declarations, a selector list split so `.a, .b { … }` answers for either
const rules = (css) => {
  const out = new Map();
  for (const [, prelude, body] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g))
    for (const sel of prelude.split(",")) out.set(squash(sel), squash(body));
  return out;
};

test("the rules shadow-root.ts puts in the page match the stylesheet's own", async () => {
  const m = /const PAGE_CSS =\s*'([^']+)';/.exec(await read("src/tweaks/shadow-root.ts"));
  assert.ok(m, "PAGE_CSS is a single-quoted string literal");
  const page = rules(m[1]),
    sheet = rules(await read("src/tweaks.css"));
  assert.ok(page.size >= 6, `PAGE_CSS parsed into ${page.size} rules`);
  for (const [sel, body] of page) assert.equal(sheet.get(sel), body, `${sel} differs from tweaks.css`);
});
