/* Rules the two authored stylesheets must keep. A touch screen applies :hover on tap
 * and keeps it until the next tap somewhere else, so every :hover rule has to sit
 * inside `@media (hover: hover) and (pointer: fine)` — otherwise a lit button or a
 * swollen chip sticks after a tap. This walks each file's nesting and names any
 * :hover selector that is not under that query. */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const FILES = ["src/tweaks.css", "site/site.css"];

// The docs examples carry their own CSS (`examples[].css` in site/pages/*.mjs), which the
// build puts into each page's <style>. It follows the same rule.
async function examplesCss() {
  const dir = new URL("../site/pages/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".mjs")).sort();
  let css = "";
  for (const file of files) {
    const { examples = [] } = await import(new URL(file, dir));
    for (const ex of examples) if (ex.css) css += `\n/* ${file} ${ex.id || ex.title || ""} */\n${ex.css}\n`;
  }
  return css;
}
// Both features, in either order, joined by `and` only. A comma (`…, print`) would apply
// the rules to every printer, `or` to any device with either feature, and `not` to
// exactly the devices the guard is meant to exclude.
const isHoverGuard = (prelude) =>
  /\(hover:\s*hover\)/.test(prelude) &&
  /\(pointer:\s*fine\)/.test(prelude) &&
  !prelude.includes(",") &&
  !/\b(not|or)\b/.test(prelude);

// Every selector in `css` that contains :hover, each with the at-rule preludes it sits
// under (outermost first). Comments and strings are blanked first so a brace or a
// colon inside one is never read as structure.
function hoverSelectors(css) {
  const quiet = css.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|url\([^)]*\)/g, (m) => m.replace(/[^\n]/g, " "));
  const found = [];
  const stack = []; // at-rule preludes open at this point
  let prelude = "";
  for (const ch of quiet) {
    if (ch === "{") {
      const head = prelude.trim();
      if (head.startsWith("@")) stack.push(head);
      else {
        stack.push(null); // a style rule — its body holds declarations, not rules
        if (head.includes(":hover")) found.push({ selector: head.replace(/\s+/g, " "), atRules: stack.filter(Boolean) });
      }
      prelude = "";
    } else if (ch === "}") {
      stack.pop();
      prelude = "";
    } else if (ch === ";" && !stack.length) {
      prelude = ""; // a top-level @import / @layer statement
    } else prelude += ch;
  }
  return found;
}

// The two stylesheets are known to hold hover rules, so finding none there means the
// walker broke. The examples may legitimately end up with none.
const SOURCES = [
  ...FILES.map((file) => [file, () => readFile(new URL(`../${file}`, import.meta.url), "utf8"), true]),
  ["site/pages/*.mjs examples[].css", examplesCss, false],
];

for (const [file, read, expectSome] of SOURCES) {
  test(`${file}: every :hover rule sits inside @media (hover: hover) and (pointer: fine)`, async () => {
    const rules = hoverSelectors(await read());
    if (expectSome) assert.ok(rules.length > 0, `${file} has no :hover rules — the parser found nothing, which is not what this file looks like`);
    const bare = rules.filter((r) => !r.atRules.some((a) => a.startsWith("@media") && isHoverGuard(a)));
    assert.deepEqual(bare.map((r) => r.selector), [], `unguarded :hover in ${file}`);
  });
}

test("the hover walker reads nesting, not just presence", () => {
  const guarded = `@media (hover: hover) and (pointer: fine) { .a:hover { color: red; } }\n.b:hover { color: blue; }`;
  const rules = hoverSelectors(guarded);
  assert.deepEqual(rules.map((r) => [r.selector, r.atRules.length]), [[".a:hover", 1], [".b:hover", 0]]);
  // A :hover inside a comment or a string is not a rule.
  assert.equal(hoverSelectors(`/* .x:hover {} */ .y::after { content: ":hover"; }`).length, 0);
  // A nested media (the mobile block wraps its own hover guard) still counts as guarded.
  const nested = `@media (max-width: 1000px) { @media (hover: hover) and (pointer: fine) { .c:hover { color: red; } } }`;
  assert.deepEqual(hoverSelectors(nested)[0].atRules.length, 2);
});

test("the guard check accepts either feature order and rejects a comma list", () => {
  assert.ok(isHoverGuard("@media (hover: hover) and (pointer: fine)"));
  assert.ok(isHoverGuard("@media (pointer: fine) and (hover: hover)"));
  assert.ok(!isHoverGuard("@media (hover: hover)"));
  assert.ok(!isHoverGuard("@media (hover: hover) and (pointer: fine), print"));
  assert.ok(!isHoverGuard("@media not all and (hover: hover) and (pointer: fine)"));
  assert.ok(!isHoverGuard("@media (hover: hover) or (pointer: fine)"));
  assert.ok(isHoverGuard("@media(hover:hover)and (pointer:fine)")); // as esbuild emits it
});
