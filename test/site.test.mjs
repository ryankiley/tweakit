/* The built docs site, checked against dist/ and the site sources: every page shows the
 * package version (filled from package.json at build time, so a release rebuild carries the
 * new number without anyone editing a page); every page that runs the kit preloads the whole
 * code-split build (the controls arrive in one round trip instead of the four the import
 * chain takes), and a page without a module script preloads nothing; the prose carries no em
 * or en dashes (a colon, semicolon, comma, period or parenthesis instead; an en dash between
 * two digits and the quick tour's empty table cell are allowed); and the snippet copy button's
 * hand-copied icon strings (site.js stays unbundled) match the kit's. */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);
const read = (p) => readFile(new URL(p, root), "utf8");
const { version } = JSON.parse(await read("package.json"));
const htmlPages = (await readdir(dist)).filter((f) => f.endsWith(".html"));
const chunks = (await readdir(new URL("tweaks/", dist))).filter((f) => f.endsWith(".js"));
const sourcePages = (await readdir(new URL("site/pages/", root))).filter((f) => f.endsWith(".mjs")).sort();

test("every docs page shows the package version, linked to its release notes", async () => {
  assert.ok(htmlPages.length > 1, "sanity: the site built");
  for (const f of htmlPages) {
    const html = await read(`dist/${f}`);
    assert.ok(!html.includes("{{version}}"), `${f}: unfilled version token`);
    assert.ok(
      html.includes(`href="https://github.com/ryankiley/tweakit/releases/tag/v${version}"`),
      `${f}: no link to the v${version} release`,
    );
    assert.ok(html.includes(`>v${version}</a>`), `${f}: version not shown`);
  }
});

test("every docs page that runs the kit preloads every split file; a page that doesn't, preloads none", async () => {
  assert.ok(
    chunks.includes("core.js") && chunks.length > 5,
    `a code-split build in dist/tweaks (${chunks.length} files)`,
  );
  let scripted = 0;
  for (const file of htmlPages) {
    const html = await read(`dist/${file}`);
    const preloads = [...html.matchAll(/<link rel="modulepreload" href="\.\/tweaks\/([^"]+)" \/>/g)].map((m) => m[1]);
    if (html.includes('<script type="module">')) {
      scripted++;
      assert.deepEqual(preloads.sort(), [...chunks].sort(), `${file}: preloads the whole build`);
    } else assert.deepEqual(preloads, [], `${file}: nothing to preload`);
    assert.ok(!html.includes("{{preload}}"), `${file}: the preload slot was filled`);
  }
  assert.ok(scripted > 0, "at least one page runs the kit");
});

const files = [...sourcePages.map((f) => `site/pages/${f}`), "README.md", "AGENTS.md"];
const EMPTY_CELL = "<td>—</td>";
const strip = (line) => line.replaceAll(EMPTY_CELL, "").replace(/(?<=\d)–(?=\d)/g, "-");

test("docs prose has no em or en dashes outside a numeric range and the empty table cell", async () => {
  const offenders = [];
  for (const file of files) {
    const lines = (await read(file)).split("\n");
    lines.forEach((line, i) => {
      const at = strip(line).search(/[—–]/);
      if (at < 0) return;
      const text = line.trim();
      offenders.push(`${file}:${i + 1}: ${text.length > 120 ? text.slice(Math.max(0, at - 50), at + 70) : text}`);
    });
  }
  assert.ok(
    offenders.length === 0,
    `em or en dash in docs prose (write a colon, semicolon, comma or period instead):\n  ${offenders.join("\n  ")}`,
  );
});

// The statement declaring `name`, from `const` to its semicolon, however it wraps.
const line = (src, name) => {
  const at = src.search(new RegExp(`const ${name} =\\s`));
  assert.ok(at >= 0, `${name} not found`);
  return src.slice(at, src.indexOf(";", at));
};
// Compare what draws: the markup inside the <svg> (class hooks aside) and the stroke width.
const unhooked = (body) => body.replace(/ class="[^"]*"/g, "");
const kitIcon = (src, name) => {
  const [, body, width = "2"] = line(src, name).match(/icon\(\s*'([^']*)'(?:,\s*"[^"]*")?(?:,\s*([\d.]+))?,?\s*\)/);
  return { body: unhooked(body), width };
};
const siteIcon = (src, name) => {
  const [, width, body] = line(src, name).match(/stroke-width="([\d.]+)"[^>]*>(.*)<\/svg>/);
  return { body: unhooked(body), width };
};

test("the docs site's copy/check icons match the kit's", async () => {
  const [kit, site] = await Promise.all([read("src/tweaks/icons.ts"), read("site/site.js")]);
  for (const name of ["ICON_COPY", "ICON_CHECK"]) assert.deepEqual(siteIcon(site, name), kitIcon(kit, name), name);
});
