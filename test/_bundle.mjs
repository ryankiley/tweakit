/* In-memory esbuild bundle of a TS entry, imported as a data: URL. */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Bundle `entry` from src/ so pure-logic tests need no dist and no Node type stripping. */
export async function bundle(entry, define = {}) {
  const r = await build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true, format: "esm", write: false, target: "es2022",
    define: { TW_SPLIT: "false", ...define }, logLevel: "silent",
  });
  return import("data:text/javascript;base64," + Buffer.from(r.outputFiles[0].text).toString("base64"));
}
