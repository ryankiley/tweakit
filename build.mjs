/* Tweakit — build the kit (TypeScript source). One source, several outputs:
 *   • dist/tweaks/      minified, esbuild code-split chunks (TW_SPLIT=true) — the
 *                       core entry + a chunk per lazy control + a shared chunk; basic
 *                       panels fetch core + shared, heavy controls load on demand.
 *   • dist/tweaks.js    one self-contained file (TW_SPLIT=false → every control inlined,
 *                       synchronous) — the drop-in / copyable build, no bundler needed.
 *   • dist/tweaks.css   minified panel CSS.
 *   • dist/types/       .d.ts declarations (tsc) — consumers get full types.
 *   • dist/*.html       the docs/examples site (GitHub Pages root) — see site/.
 * TW_SPLIT is an esbuild `define` that picks the split vs inlined code path in core.ts.
 */
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const p = (...s) => path.join(ROOT, ...s);

await rm(p("dist"), { recursive: true, force: true });
await mkdir(p("dist"), { recursive: true });

const esbuild = await import("esbuild");

// 1) code-split, minified chunks → dist/tweaks/ (metafile: so we can find the shared
// chunk core statically imports, to report the real code-split size below)
const splitBuild = await esbuild.build({
  entryPoints: [p("src/tweaks/core.ts")],
  outdir: p("dist/tweaks"),
  bundle: true, splitting: true, format: "esm", minify: true, target: "es2020",
  legalComments: "none", define: { TW_SPLIT: "true" }, metafile: true,
});

// 2) single self-contained file → dist/tweaks.js (every control inlined, synchronous —
// the drop-in that needs no bundler). Minified: it's the default `tweakit` import,
// so it ships small; the readable reference is the src/ tree it's built from.
await esbuild.build({
  entryPoints: [p("src/tweaks/single.ts")],
  outfile: p("dist/tweaks.js"),
  bundle: true, splitting: false, format: "esm", minify: true, target: "es2020",
  legalComments: "none", define: { TW_SPLIT: "false" },
});

// 3) minified panel CSS → dist/tweaks.css — after the light-twin check. The light
// palette exists twice in tweaks.css (media-driven and attribute-forced — CSS can't
// share one block across a media query and a selector); the copies must stay
// declaration-identical, so diff them (comments/whitespace aside) and fail the build
// the moment they drift.
{
  const css = await readFile(p("src/tweaks.css"), "utf8");
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const mediaDriven = [], forced = [];
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (!sel.includes("data-tw-scheme")) continue;
    if (!sel.includes(":where(")) {
      console.error(`✗ src/tweaks.css: scheme-conditional rule outside :where() — it would bypass the twin drift check. Keep every data-tw-scheme rule in the :where() form.\n  selector: ${sel.replace(/\s+/g, " ")}`);
      process.exit(1);
    }
    const rule = (sel.slice(0, sel.indexOf(":where(")) + " { " + m[2] + " }").replace(/\s+/g, " ").trim();
    (sel.includes('[data-tw-scheme="light"]') ? forced : mediaDriven).push(rule);
  }
  // 3 pairs exist today; if both twins of a pair leave the :where() shape they vanish
  // from the buckets and the diff passes vacuously — pin the floor so that can't happen.
  const MIN_TWIN_PAIRS = 3;
  if (mediaDriven.length < MIN_TWIN_PAIRS) {
    console.error(`✗ src/tweaks.css: only ${mediaDriven.length} media-driven scheme rule(s) found (expected ≥ ${MIN_TWIN_PAIRS}) — a twin pair dropped out of the checked :where() system. If a pair was removed on purpose, lower MIN_TWIN_PAIRS in build.mjs.`);
    process.exit(1);
  }
  const at = mediaDriven.length !== forced.length ? Math.min(mediaDriven.length, forced.length)
    : mediaDriven.findIndex((r, i) => r !== forced[i]);
  if (mediaDriven.length !== forced.length || at !== -1) {
    console.error(`✗ src/tweaks.css: the light-theme twins have drifted (rule ${at + 1}).`);
    console.error("  media-driven: " + (mediaDriven[at] || "(missing)") + "\n  forced:       " + (forced[at] || "(missing)"));
    process.exit(1);
  }
  const { code } = await esbuild.transform(css, { minify: true, loader: "css" });
  await writeFile(p("dist/tweaks.css"), code);
}

// 4) .d.ts declarations → dist/types/ (consumer types; tsc, declaration-only)
try {
  await run("node", ["node_modules/typescript/bin/tsc"], { cwd: ROOT });
  console.log("emitted .d.ts → dist/types/");
} catch (e) {
  console.error("✗ tsc failed — the declarations would be wrong or partial:\n" + String(e.stdout || e.message || "").trimEnd());
  process.exit(1);
}

// 4b) measured gzip sizes → the docs site fills {{size-split}} / {{size-single}} with
// these, so the figures can't drift from the build. Split = the core entry + the shared
// chunk it statically imports (what a basic panel fetches); single = the inlined drop-in.
// Heavy controls dynamic-import (kind "dynamic-import") and aren't counted.
const gz = async (rel) => gzipSync(await readFile(p(rel))).length;
const coreOut = Object.keys(splitBuild.metafile.outputs).find((k) => k.endsWith("tweaks/core.js"));
const sharedChunks = (splitBuild.metafile.outputs[coreOut].imports || []).filter((im) => im.kind === "import-statement").map((im) => im.path);
let splitBytes = await gz(coreOut);
for (const c of sharedChunks) splitBytes += await gz(c);
const kb = (b) => `~${Math.round(b / 1024)} KB`;
const sizes = { split: kb(splitBytes), single: kb(await gz("dist/tweaks.js")) };
console.log(`sizes (gzip): code-split ${sizes.split} (core + shared chunk) · single ${sizes.single}`);

// 5) docs site → dist/*.html + site.css/site.js (GitHub Pages serves dist/). The
// generator imports site/pages/*.mjs raw — they never pass through esbuild (each
// example's run function is toString()-serialized into both the snippet and the page
// script, so transpiling would break snippet/runtime parity).
const { buildSite } = await import("./site/build-site.mjs");
await buildSite({ outDir: p("dist"), esbuild, sizes });

console.log("Built tweakit → dist/");
