/* The docs site's snippet copy button draws the kit's copy/check icons from its own
 * hand-copied strings (site.js stays unbundled, so it can't import them). Hold those
 * copies to the kit's source so an icon change can't leave the site behind. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const line = (src, name) => {
  const l = src.split("\n").find((x) => x.includes(`const ${name} = `));
  assert.ok(l, `${name} not found`);
  return l;
};
// Compare what draws: the markup inside the <svg> (class hooks aside) and the stroke width.
const unhooked = (body) => body.replace(/ class="[^"]*"/g, "");
const kitIcon = (src, name) => {
  const [, body, width = "2"] = line(src, name).match(/icon\('([^']*)'(?:, *"[^"]*")?(?:, *([\d.]+))?\)/);
  return { body: unhooked(body), width };
};
const siteIcon = (src, name) => {
  const [, width, body] = line(src, name).match(/stroke-width="([\d.]+)"[^>]*>(.*)<\/svg>/);
  return { body: unhooked(body), width };
};

test("the docs site's copy/check icons match the kit's", async () => {
  const [kit, site] = await Promise.all([read("../src/tweaks/icons.ts"), read("../site/site.js")]);
  for (const name of ["ICON_COPY", "ICON_CHECK"]) assert.deepEqual(siteIcon(site, name), kitIcon(kit, name), name);
});
