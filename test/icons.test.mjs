/* The docs site's snippet copy button draws the kit's copy/check icons from its own
 * hand-copied strings (site.js stays unbundled, so it can't import them). Hold those
 * copies to the kit's source so an icon change can't leave the site behind. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const paths = (src, name) => {
  const line = src.split("\n").find((l) => l.includes(`const ${name} = `));
  assert.ok(line, `${name} not found`);
  return [...line.matchAll(/ d="([^"]*)"/g)].map((m) => m[1]);
};

test("the docs site's copy/check icons match the kit's", async () => {
  const [kit, site] = await Promise.all([read("../src/tweaks/icons.ts"), read("../site/site.js")]);
  for (const name of ["ICON_COPY", "ICON_CHECK"]) assert.deepEqual(paths(site, name), paths(kit, name), name);
});
