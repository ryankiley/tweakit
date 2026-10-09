/* A touch screen applies :hover on tap and keeps it until the next tap somewhere else,
 * so every :hover rule in the kit, the docs shell and the docs examples has to sit
 * inside `@media (hover: hover) and (pointer: fine)`. This walks each source's nesting
 * and names any :hover selector that is not under exactly that query. */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const GUARD = "@media (hover: hover) and (pointer: fine)";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

// The examples' CSS (`examples[].css` in site/pages/*.mjs) goes into each page's <style>.
async function examplesCss() {
  const dir = new URL("../site/pages/", import.meta.url);
  let css = "";
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".mjs")).sort()) {
    const { examples = [] } = await import(new URL(file, dir));
    for (const ex of examples) css += `\n/* ${file} ${ex.id || ex.title || ""} */\n${ex.css || ""}\n`;
  }
  return css;
}

// Every selector containing :hover, with the at-rule preludes it sits under. Comments,
// strings and url() are blanked first so nothing inside them reads as structure.
function hoverSelectors(css) {
  const quiet = css.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|url\([^)]*\)/g, (m) => m.replace(/[^\n]/g, " "));
  const found = [];
  const stack = []; // open at-rule preludes; null for a style rule
  let prelude = "";
  for (const ch of quiet) {
    if (ch === "{") {
      const head = prelude.trim().replace(/\s+/g, " ");
      stack.push(head.startsWith("@") ? head : null);
      if (!head.startsWith("@") && head.includes(":hover")) found.push({ selector: head, atRules: stack.filter(Boolean) });
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

const SOURCES = [
  ["src/tweaks.css", () => read("src/tweaks.css")],
  ["site/site.css", () => read("site/site.css")],
  ["site/pages/*.mjs examples[].css", examplesCss],
];

for (const [name, source] of SOURCES) {
  test(`${name}: every :hover rule sits inside ${GUARD}`, async () => {
    const bare = hoverSelectors(await source()).filter((r) => !r.atRules.includes(GUARD));
    assert.deepEqual(bare.map((r) => r.selector), []);
  });
}

test("the hover walker reads nesting, not just presence", () => {
  const css = `${GUARD} { .a:hover { color: red; } }
    .b:hover { color: blue; }
    @media (max-width: 1000px) { ${GUARD} { .c:hover { color: red; } } }
    /* .x:hover {} */ .y::after { content: ":hover"; }`;
  assert.deepEqual(
    hoverSelectors(css).map((r) => [r.selector, r.atRules.includes(GUARD)]),
    [[".a:hover", true], [".b:hover", false], [".c:hover", true]],
  );
});

// The control stack is a grid item holding a flex column; without zero floors, one nowrap
// child (a long selected option, a wide tab bar, an eight-button group) widened every row
// past the panel and over its neighbours. This keeps the floors in place.
test("src/tweaks.css: the control stack and its children can shrink below their content", async () => {
  const css = (await read("src/tweaks.css")).replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector) => { const m = css.match(new RegExp(`(^|[\\n}])\\s*${selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&")}\\s*\\{([^}]*)\\}`)); return m ? m[2] : ""; };
  for (const sel of [".tw-body > .tw-controls", ".tw-controls > *", ".tw-folder-body > .tw-controls", ".tw-tabs-bar", ".tw-select-value"]) {
    assert.match(rule(sel), /min-width:\s*0\b/, `${sel} needs min-width: 0`);
  }
});
