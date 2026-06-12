/* The code-split build's lazy window (dist/tweaks/core.js): tweaks() returns
 * before the lazy chunks land, and set() calls made in that window must replay
 * once assemble() builds the controls — dotted paths, bare nested keys, and no
 * orphan top-level params. `npm test` builds dist first. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks/core.js", import.meta.url));

test("set() during the lazy window replays once ready", async () => {
  // interval is a lazy control, so assemble defers behind panel.ready
  const p = tweaks("Lazy", { folder: { r: { type: "interval", value: [2, 8], min: 0, max: 10, step: 1 }, y: [1, 0, 10, 1] } });
  p.set("folder.y", 7); // dotted — used to warn + drop
  p.set("r", [3, 6]);   // bare nested — used to mint a top-level orphan
  await p.ready;
  assert.equal(p.params.folder.y, 7);
  assert.deepEqual(p.params.folder.r, [3, 6]);
  assert.ok(!("r" in p.params), "no orphan top-level key");
});

test("ready resolves with the api on the warmed-up synchronous path too", async () => {
  const p = tweaks("Warm", { r: { type: "interval", value: [2, 8], min: 0, max: 10, step: 1 } });
  const api = await p.ready;
  assert.equal(api, p);
  assert.deepEqual(p.params.r, [2, 8]);
});
