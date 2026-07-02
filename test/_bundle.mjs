/* In-memory bundle of a TS source entry — esbuild (the build's own dependency)
 * compiles it, and the output imports as a data: URL module. The pure-logic tests
 * (wide-gamut maths, the plot expression parser) run against src/ directly this
 * way: no dist required, and no dependence on Node's experimental type stripping
 * (which also couldn't resolve the kit's TS-style "./shared.js" specifiers). */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function bundle(entry, define = {}) {
  const r = await build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true, format: "esm", write: false, target: "es2022",
    define: { TW_SPLIT: "false", ...define }, logLevel: "silent",
  });
  return import("data:text/javascript;base64," + Buffer.from(r.outputFiles[0].text).toString("base64"));
}
