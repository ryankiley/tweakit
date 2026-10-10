/* The docs sidebar shows the package version, filled from package.json at build time, so a
 * release rebuild of the site carries the new number without anyone editing a page. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const { version } = JSON.parse(await readFile(new URL("package.json", root), "utf8"));

test("every docs page shows the package version, linked to its release notes", async () => {
  const pages = (await readdir(new URL("dist/", root))).filter((f) => f.endsWith(".html"));
  assert.ok(pages.length > 1, "sanity: the site built");
  for (const f of pages) {
    const html = await readFile(new URL(`dist/${f}`, root), "utf8");
    assert.ok(!html.includes("{{version}}"), `${f}: unfilled version token`);
    assert.ok(html.includes(`href="https://github.com/ryankiley/tweakit/releases/tag/v${version}"`), `${f}: no link to the v${version} release`);
    assert.ok(html.includes(`>v${version}</a>`), `${f}: version not shown`);
  }
});
