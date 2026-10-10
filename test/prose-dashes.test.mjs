/* The docs prose carries no em or en dashes: where one would go, the sentence takes a
 * colon, a semicolon, a comma, a period or a parenthesis instead. Every site page (intro,
 * prose, descriptions, placeholders and the displayed snippets alike) and the README are
 * checked. Two uses are allowed: an en dash between two digits (a range like 0–1), and the
 * quick tour's empty-value table cell for the button row. */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const pages = (await readdir(new URL("site/pages/", root))).filter((f) => f.endsWith(".mjs")).sort();
const files = [...pages.map((f) => `site/pages/${f}`), "README.md"];

const EMPTY_CELL = "<td>—</td>";
const strip = (line) => line.replaceAll(EMPTY_CELL, "").replace(/(?<=\d)–(?=\d)/g, "-");

test("docs prose has no em or en dashes outside a numeric range and the empty table cell", async () => {
  const offenders = [];
  for (const file of files) {
    const lines = (await readFile(new URL(file, root), "utf8")).split("\n");
    lines.forEach((line, i) => {
      const at = strip(line).search(/[—–]/);
      if (at < 0) return;
      const text = line.trim();
      offenders.push(`${file}:${i + 1}: ${text.length > 120 ? text.slice(Math.max(0, at - 50), at + 70) : text}`);
    });
  }
  assert.ok(offenders.length === 0, `em or en dash in docs prose (write a colon, semicolon, comma or period instead):\n  ${offenders.join("\n  ")}`);
});
