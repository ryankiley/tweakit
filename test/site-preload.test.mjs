/* The docs site preloads the whole code-split build on every page that runs the kit,
 * so the controls arrive in one round trip instead of the four the import chain takes
 * (core → shared chunk → a lazy control → its chunk). A page without a module script
 * preloads nothing. Checks the built dist/ HTML against the files actually in dist/tweaks/. */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
const chunks = (await readdir(new URL("tweaks/", dist))).filter((f) => f.endsWith(".js"));
const pages = (await readdir(dist)).filter((f) => f.endsWith(".html"));

test("every docs page that runs the kit preloads every split file; a page that doesn't, preloads none", async () => {
  assert.ok(chunks.includes("core.js") && chunks.length > 5, `a code-split build in dist/tweaks (${chunks.length} files)`);
  let scripted = 0;
  for (const file of pages) {
    const html = await readFile(new URL(file, dist), "utf8");
    const preloads = [...html.matchAll(/<link rel="modulepreload" href="\.\/tweaks\/([^"]+)" \/>/g)].map((m) => m[1]);
    if (html.includes('<script type="module">')) { scripted++; assert.deepEqual(preloads.sort(), [...chunks].sort(), `${file}: preloads the whole build`); }
    else assert.deepEqual(preloads, [], `${file}: nothing to preload`);
    assert.ok(!html.includes("{{preload}}"), `${file}: the preload slot was filled`);
  }
  assert.ok(scripted > 0, "at least one page runs the kit");
});
