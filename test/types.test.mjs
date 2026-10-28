/* The schema-typed params: tsc checks test/types/params.ts against the built declarations,
 * so every inferred type it pins holds and every @ts-expect-error in it is a real error. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("params are typed from the schema", async () => {
  const args = [
    "node_modules/typescript/bin/tsc",
    "--ignoreConfig",
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--target",
    "ES2020",
    "--module",
    "ESNext",
    "--moduleResolution",
    "bundler",
    "--lib",
    "ES2020,DOM",
    "test/types/params.ts",
  ];
  const out = await promisify(execFile)("node", args, { cwd: ROOT }).then(
    () => "",
    (e) => String(e.stdout || e.message),
  );
  assert.equal(out.trim(), "");
});
