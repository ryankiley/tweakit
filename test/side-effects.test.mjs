/* package.json's sideEffects lets a bundler drop an unused import of the kit whole, so it must name every file whose
 * import does something: the stylesheet, the auto entry, every hashed chunk of the split build (a lazy control registers
 * itself, and esbuild emits bare imports between chunks to keep their order), and src/, which the kit's own build bundles
 * under this same package.json (without it the single-file build silently loses every control single.ts imports for
 * effect). Only the two entries, core.js and tweaks.js, are left out: their registrations run whenever an export is used.
 * Then a consumer bundled by esbuild, which honors the field, still builds every control. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import "./_setup-dom.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { sideEffects } = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const glob = (p) => new RegExp("^" + p.replace(/^\.\//, "").replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*") + "$");
const effectful = (rel) => sideEffects.some((p) => glob(p).test(rel));

test("sideEffects names every file whose import does something, and leaves only the two entries out", () => {
  assert.ok(Array.isArray(sideEffects), "package.json has a sideEffects list");
  const split = readdirSync(path.join(ROOT, "dist/tweaks")).filter((f) => f.endsWith(".js")).map((f) => `dist/tweaks/${f}`);
  for (const f of split) assert.equal(effectful(f), f !== "dist/tweaks/core.js", `${f} ${effectful(f) ? "is" : "isn't"} listed`);
  assert.ok(effectful("dist/tweaks.css"), "the stylesheet");
  assert.ok(!effectful("dist/tweaks.js"), "the single-file build is an entry");
  for (const f of readdirSync(path.join(ROOT, "src"), { recursive: true }).filter((f) => /\.(ts|css)$/.test(f))) assert.ok(effectful(`src/${f.split(path.sep).join("/")}`), `src/${f}`);
});

// Bundle `contents` as a consumer of the package would, minified and tree-shaken, with dynamic imports inlined.
const consumer = async (contents) => {
  const r = await build({
    stdin: { contents, resolveDir: path.join(ROOT, "test"), sourcefile: "consumer.js" },
    bundle: true, format: "esm", platform: "browser", minify: true, treeShaking: true, write: false, logLevel: "silent",
  });
  return r.outputFiles[0].text;
};

test("a bundled consumer of tweakit and of tweakit/single builds a slider, a color and a gradient", async () => {
  for (const entry of ["tweakit", "tweakit/single"]) {
    const js = await consumer(`import { tweaks } from "${entry}"; export { tweaks };`);
    const { tweaks } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
    const warn = console.warn, warns = []; console.warn = (...a) => warns.push(a.join(" "));
    const p = tweaks("Bundled", { size: [12, 0, 40, 1], tint: "#7c5cff", fill: { type: "gradient", value: [["#000000", 0], ["#ffffff", 1]] } });
    document.body.append(p.el);
    try {
      await p.ready;
      assert.deepEqual(warns, [], `${entry}: no control went missing`);
      assert.equal(p.params.size, 12);
      assert.equal(p.params.tint, "#7c5cff", `${entry}: the color control registered`);
      assert.equal(p.params.fill.stops.length, 2, `${entry}: the gradient control registered`);
    } finally { console.warn = warn; p.destroy(); }
  }
});

test("an unused import of the kit bundles to nothing; tweakit/auto keeps its scan", async () => {
  const unused = await consumer(`import { tweaks } from "tweakit"; import { enhance } from "tweakit/single"; console.log(1);`);
  assert.ok(unused.length < 100, `an unused import left ${unused.length} B`);
  const auto = await consumer(`import "tweakit/auto";`);
  assert.ok(auto.includes("DOMContentLoaded"), "the auto entry's on-load scan survives a bare import");
});
