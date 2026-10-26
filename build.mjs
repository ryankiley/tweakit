/* Tweakit build. One TypeScript source, several outputs:
 *   dist/tweaks/      minified code-split chunks (TW_SPLIT=true), and auto.js, core plus the on-load markup scan
 *   dist/tweaks.js    one self-contained file, every control inlined (TW_SPLIT=false)
 *   dist/tweaks.css   minified panel CSS
 *   dist/types/       .d.ts declarations
 *   dist/*.html       the docs site, from site/
 * TW_SPLIT is an esbuild define that picks the code path in core.ts. Every script ships a linked .map pointing into the
 * package's src/, so a stack trace from a user's app names the kit's source lines; it adds to the npm download, not to an
 * app's bundle. */
import { mkdir, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const p = (...s) => path.join(ROOT, ...s);
const fail = (msg) => { console.error("✗ " + msg); process.exit(1); };

await rm(p("dist"), { recursive: true, force: true });
await mkdir(p("dist"), { recursive: true });

const esbuild = await import("esbuild");
const sourcemap = "linked"; // a .map beside each script, in the package too: a user's stack trace names src/ lines
// The package ships src/ once, which the maps point at, rather than a copy of it inside every map (two builds, ~825 KB).
const sourcesContent = false;

// 1) code-split chunks → dist/tweaks/; the metafile finds the shared chunk for the size report
const splitBuild = await esbuild.build({
  entryPoints: [p("src/tweaks/core.ts")],
  outdir: p("dist/tweaks"),
  bundle: true, splitting: true, format: "esm", minify: true, target: "es2020",
  legalComments: "none", define: { TW_SPLIT: "true" }, metafile: true, sourcemap, sourcesContent,
});

// 1b) tweakit/auto → dist/tweaks/auto.js: core re-exported, plus enhance(document) on load. Unbundled, so it imports
// ./core.js as written and leaves the split build's chunks as they are.
await esbuild.build({
  entryPoints: [p("src/tweaks/auto.ts")],
  outfile: p("dist/tweaks/auto.js"),
  bundle: false, format: "esm", minify: true, target: "es2020", legalComments: "none", sourcemap, sourcesContent,
});

// 2) single self-contained file → dist/tweaks.js, the drop-in that needs no bundler
await esbuild.build({
  entryPoints: [p("src/tweaks/single.ts")],
  outfile: p("dist/tweaks.js"),
  bundle: true, splitting: false, format: "esm", minify: true, target: "es2020",
  legalComments: "none", define: { TW_SPLIT: "false" }, sourcemap, sourcesContent,
  // The copyable file carries the notice the MIT license requires in every copy.
  banner: { js: "/* tweakit — MIT © Ryan Kiley. Toolbar and control icons from Hugeicons (MIT); see THIRD-PARTY-NOTICES.md in the tweakit package. */" },
});

// 3) panel CSS → dist/tweaks.css, minified. Both schemes live in one token block as light-dark() pairs.
{
  const { code } = await esbuild.transform(await readFile(p("src/tweaks.css"), "utf8"), { minify: true, loader: "css" });
  await writeFile(p("dist/tweaks.css"), code);
  // So a TS consumer can `import "tweakit/css"` without TS2307; a subpath isn't matched by a *.css ambient.
  await writeFile(
    p("dist/tweaks.css.d.ts"),
    '// tweakit/css — the panel stylesheet, imported for its side effect:\n//   import "tweakit/css";\nexport {};\n'
  );
}

// 4) .d.ts declarations → dist/types/
try {
  await run("node", ["node_modules/typescript/bin/tsc"], { cwd: ROOT });
  console.log("emitted .d.ts → dist/types/");
} catch (e) {
  fail("tsc failed — the declarations would be wrong or partial:\n" + String(e.stdout || e.message || "").trimEnd());
}
// Keep only the declarations the public entry (core) reaches; the internal modules' would read
// as public API. Paths stay in readdir()'s OS-native form so the keep-set matches on every platform.
{
  const keep = new Set();
  const walk = async (rel) => {
    if (keep.has(rel)) return; keep.add(rel);
    for (const m of (await readFile(p("dist/types", rel), "utf8")).matchAll(/from "(\.[^"]+)"/g)) await walk(path.join(path.dirname(rel), m[1].replace(/\.js$/, ".d.ts")));
  };
  await walk(path.join("tweaks", "core.d.ts"));
  for (const f of await readdir(p("dist/types"), { recursive: true })) if (f.endsWith(".d.ts") && !keep.has(f)) await rm(p("dist/types", f));
}

// 4b) gzip sizes for the docs site's {{size-*}} tokens. Split = core + the shared chunk it
// statically imports; dynamic imports aren't counted.
const gz = async (rel) => gzipSync(await readFile(p(rel))).length;
const coreOut = Object.keys(splitBuild.metafile.outputs).find((k) => k.endsWith("tweaks/core.js"));
const sharedChunks = (splitBuild.metafile.outputs[coreOut].imports || []).filter((im) => im.kind === "import-statement").map((im) => im.path);
let splitBytes = await gz(coreOut);
for (const c of sharedChunks) splitBytes += await gz(c);
const kb = (b) => `~${Math.round(b / 1024)} KB`;
const sizes = { split: kb(splitBytes), single: kb(await gz("dist/tweaks.js")), css: kb(await gz("dist/tweaks.css")) };
console.log(`sizes (gzip): code-split ${sizes.split} (core + shared chunk) · single ${sizes.single} · css ${sizes.css}`);

// 5) docs site → dist/*.html. Page modules are imported raw, never through esbuild: each run
// function is toString()-serialized into both the snippet and the page script.
const { buildSite } = await import("./site/build-site.mjs");
const chunks = [...Object.keys(splitBuild.metafile.outputs).filter((k) => k.endsWith(".js")).map((k) => path.basename(k)), "auto.js"]; // every split file; the pages preload them
const { version, homepage } = JSON.parse(await readFile(p("package.json"), "utf8")); // the sidebar shows the version; the Markdown files link by the homepage
await buildSite({ outDir: p("dist"), esbuild, sizes, chunks, version, site: (homepage || "").replace(/\/$/, "") });

console.log("Built tweakit → dist/");
