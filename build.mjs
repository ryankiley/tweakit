/* Tweakability — build the kit (TypeScript source). One source, several outputs:
 *   • dist/tweaks/      minified, esbuild code-split chunks (TW_SPLIT=true) — the
 *                       core entry + a chunk per lazy control + a shared chunk; basic
 *                       panels fetch core + shared, heavy controls load on demand.
 *   • dist/tweaks.js    one self-contained file (TW_SPLIT=false → every control inlined,
 *                       synchronous) — the drop-in / copyable build, no bundler needed.
 *   • dist/tweaks.css   minified panel CSS.
 *   • dist/types/       .d.ts declarations (tsc) — consumers get full types.
 *   • dist/index.html   the demo (GitHub Pages root).
 * TW_SPLIT is an esbuild `define` that picks the split vs inlined code path in core.ts.
 */
import { mkdir, rm, cp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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

// 1) code-split, minified chunks → dist/tweaks/
await esbuild.build({
  entryPoints: [p("src/tweaks/core.ts")],
  outdir: p("dist/tweaks"),
  bundle: true, splitting: true, format: "esm", minify: true, target: "es2020",
  legalComments: "none", define: { TW_SPLIT: "true" },
});

// 2) single self-contained file → dist/tweaks.js (every control inlined, synchronous —
// the drop-in that needs no bundler). Minified: it's the default `tweakability` import,
// so it ships small; the readable reference is the src/ tree it's built from.
await esbuild.build({
  entryPoints: [p("src/tweaks/single.ts")],
  outfile: p("dist/tweaks.js"),
  bundle: true, splitting: false, format: "esm", minify: true, target: "es2020",
  legalComments: "none", define: { TW_SPLIT: "false" },
});

// 3) minified panel CSS → dist/tweaks.css
{
  const { code } = await esbuild.transform(await readFile(p("src/tweaks.css"), "utf8"), { minify: true, loader: "css" });
  await writeFile(p("dist/tweaks.css"), code);
}

// 4) .d.ts declarations → dist/types/ (consumer types; tsc, declaration-only)
try {
  await run("node", ["node_modules/typescript/bin/tsc"], { cwd: ROOT });
  console.log("emitted .d.ts → dist/types/");
} catch (e) {
  console.warn("⚠ tsc reported type errors (declarations emitted where possible):", String(e.stdout || e.message || "").split("\n").slice(0, 4).join(" "));
}

// 5) demo → dist/index.html (GitHub Pages serves dist/)
if (existsSync(p("demo/index.html"))) await cp(p("demo/index.html"), p("dist/index.html"));

console.log("Built tweakability → dist/");
