/* The agent guide (AGENTS.md) must stay true to the kit, and the README to the site's install
 * prompt. Every control type the kit declares or registers appears in the guide's control table
 * and every type the table names exists; the guide's JavaScript examples run against the built
 * kit under jsdom; the guide stays under 16 KB, one agent read; the built site carries the stamped
 * guide, llms.txt, a Markdown mirror of every page, and llms-full.txt under the 100,000-character
 * cap most fetchers truncate at.
 * A runnable example is a ```js fence that calls tweaks(): it gets `tweaks`, `card` (an element to
 * style) and `document`, may await, must assign its panel to `panel`, and must style `card`. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import "./_setup-dom.mjs";
import { bundle } from "./_bundle.mjs";
import { loadSingle, distUrl, wait } from "./_helpers.mjs";

const root = (rel) => new URL(`../${rel}`, import.meta.url);
const read = (url) => readFileSync(url, "utf8");
const guide = read(root("AGENTS.md"));
const { TYPED_META, DATA_VALUE, LAZY_IMPORT } = await bundle("test/_registry-entry.mjs", { TW_SPLIT: "true" });
// The registry is module-private, so read its registrations from source: every call names its type literally.
const srcFiles = readdirSync(root("src/tweaks"), { recursive: true }).filter((f) => f.endsWith(".ts")).map((f) => read(root(`src/tweaks/${f}`)));
const calls = srcFiles.flatMap((s) => s.match(/\bregisterControl\(/g) || []).length; // its definition reads "registerControl = (", so only calls count
const registered = srcFiles.flatMap((s) => [...s.matchAll(/\bregisterControl\("([a-z0-9-]+)"/g)].map((m) => m[1]));
const INTERNAL = new Set(["folder", "colorpicker"]); // registered, but built by the kit itself, never named in a schema
const declared = new Set([...Object.keys(TYPED_META), ...Object.keys(DATA_VALUE), ...Object.keys(LAZY_IMPORT), ...registered].filter((t) => !INTERNAL.has(t)));
// The control table: rows of "| `type` | options | value |" under its heading.
const table = guide.slice(guide.indexOf("## Every control"), guide.indexOf("## The panel"));
const tableTypes = [...table.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]).filter((t) => t !== "type"); // minus the header row
const slugs = readdirSync(root("site/pages")).filter((f) => f.endsWith(".mjs")).map((f) => f.slice(0, -4));

test("every control registration names its type literally, so this file can read it", () => {
  assert.equal(registered.length, calls, "a registerControl() call without a string literal type");
});

test("every declared control type is in the guide's control table", () => {
  assert.ok(tableTypes.length > 10, "found the control table");
  for (const t of declared) assert.ok(tableTypes.includes(t), `AGENTS.md's control table is missing "${t}"`);
});

test("every type the guide's control table names is a declared control", () => {
  for (const t of tableTypes) assert.ok(declared.has(t), `AGENTS.md names "${t}", which the kit doesn't declare`);
});

test("the guide fits one agent read and ships in the package", () => {
  assert.ok(Buffer.byteLength(guide) <= 16 * 1024, `AGENTS.md is ${Buffer.byteLength(guide)} bytes; keep it under 16 KB`);
  assert.ok(!/^> Built from the tweakit source/m.test(guide), "the source guide carries no version stamp; the build adds one to the site copy");
  const { files } = JSON.parse(read(root("package.json")));
  assert.ok(files.includes("/AGENTS.md"), "package.json files must ship /AGENTS.md (anchored: a bare name also packs dist/AGENTS.md)");
});

test("the guide's JavaScript examples run against the built kit", async () => {
  const { tweaks } = await loadSingle();
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const fences = [...guide.matchAll(/```(?:js|javascript)\n([\s\S]*?)```/g)].map((m) => m[1]).filter((src) => /\btweaks\(/.test(src));
  assert.ok(fences.length >= 1, "the guide has a runnable example");
  for (const src of fences) {
    const card = document.createElement("div");
    document.body.append(card);
    // the kit and the element to style come in as arguments; the fence's imports are the test's job
    const run = new AsyncFunction("tweaks", "card", "document", src.replace(/^import .*$/gm, "") + '\nreturn typeof panel === "undefined" ? undefined : panel;');
    const panel = await run(tweaks, card, document);
    assert.ok(panel, "a runnable fence must assign its panel to `panel`");
    await panel.ready;
    await wait(0);
    assert.ok(Object.keys(panel.params).some((k) => k !== "_last"), "the example's panel has values");
    assert.ok(card.style.cssText, "the example bound its values to the element");
    panel.destroy();
    card.remove();
  }
});

test("the README carries the site's install prompt and points at the guide", async () => {
  const { installTabs } = await import("../site/install.mjs");
  const { codeText } = await import("../site/code.mjs");
  const words = (s) => s.replace(/\s+/g, " ");   // wrapping is the file's own business
  const prompt = words(codeText(installTabs.find((t) => t.label === "agent")));
  const readme = read(root("README.md"));
  assert.ok(words(readme).includes(prompt), "the README's agent prompt differs from site/install.mjs");
  assert.ok(readme.includes("node_modules/tweakit/AGENTS.md"), "the README points agents at the packaged guide");
});

test("the built site carries the stamped guide, llms.txt and a Markdown mirror of every page", () => {
  const { version } = JSON.parse(read(root("package.json")));
  const stamped = read(distUrl("AGENTS.md"));
  assert.ok(stamped.includes(`> Built from the tweakit source at v${version} on `), "dist/AGENTS.md says which version it was built from");
  assert.ok(read(distUrl("index.md")).includes("npm install tweakit"), "the landing page's mirror carries the install block");
  const llms = read(distUrl("llms.txt"));
  assert.ok(llms.startsWith("# Tweakit\n\n> "), "llms.txt opens with the spec's title and summary");
  assert.ok(llms.includes("/AGENTS.md)"), "llms.txt links the guide");
  const full = read(distUrl("llms-full.txt"));
  assert.ok(full.length <= 100_000, `llms-full.txt is ${full.length} characters; agents truncate past 100,000`);
  for (const slug of slugs) {
    const md = read(distUrl(`${slug}.md`));
    assert.ok(md.startsWith("# "), `${slug}.md is Markdown`);
    assert.ok(llms.includes(`/${slug}.md)`), `llms.txt lists ${slug}.md`);
    assert.ok(full.includes(md.trim()), `llms-full.txt carries ${slug}.md`);
    const html = read(distUrl(`${slug}.html`));
    assert.ok(html.includes(`<link rel="alternate" type="text/markdown" href="./${slug}.md" />`), `${slug}.html points at its Markdown`);
    assert.ok(html.includes(`<link rel="describedby" href="./llms.txt" />`), `${slug}.html points at llms.txt`);
  }
});
