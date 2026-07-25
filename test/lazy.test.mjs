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

test("during the lazy window, a later fromJSON() beats an earlier set() (replay keeps call order)", async () => {
  // spring is a lazy control unused above, so assemble() defers behind ready — set() and
  // fromJSON() both queue, and must replay in the order they were called (last write wins).
  const p = tweaks("Order", { x: [1, 0, 10, 1], s: { type: "spring", value: { stiffness: 100, damping: 12, mass: 1 } } });
  p.set("x", 4);                     // queued first
  p.fromJSON({ values: { x: 9 } });  // queued later → must win
  await p.ready;
  assert.equal(p.params.x, 9);
});

test("during the lazy window, setMany() replays as ONE batch — a single notify", async () => {
  // spring is lazy → assemble() defers; the whole setMany batch queues as one tagged entry
  // and must replay as a single setMany (one notify), not one set() per key.
  const p = tweaks("Batch", { a: [1, 0, 10, 1], b: [1, 0, 10, 1], s: { type: "spring", value: { stiffness: 100, damping: 12, mass: 1 } } });
  let calls = 0, lastKey;
  p.on((params, last) => { calls++; lastKey = last; });
  p.setMany({ a: 5, b: 7 });
  await p.ready;
  assert.equal(p.params.a, 5);
  assert.equal(p.params.b, 7);
  assert.equal(calls, 1);     // ONE notify for the batch on replay, not one per key
  assert.equal(lastKey, "b"); // _last reflects the final applied key
});

test("reset() during the lazy window replays, in order with the sets around it", async () => {
  // Regression: reset() forwarded to the toolbar button, and the toolbar is disabled until
  // assemble() — .click() is a no-op on a disabled control, so every reset() made in the
  // lazy window vanished silently while set()/setMany()/fromJSON() all queued.
  const p = tweaks("Reset", { x: [1, 0, 10, 1], s: { type: "spring", value: { stiffness: 100, damping: 12, mass: 1 } } });
  p.set("x", 7);
  p.reset();      // queued after the set → must win
  await p.ready;
  assert.equal(p.params.x, 1, "the queued reset replayed after the set it followed");

  const q = tweaks("Reset2", { x: [1, 0, 10, 1], s: { type: "spring", value: { stiffness: 100, damping: 12, mass: 1 } } });
  q.reset();
  q.set("x", 7);  // queued after the reset → must win
  await q.ready;
  assert.equal(q.params.x, 7, "call order is preserved both ways");
});

test("ready resolves with the api on the warmed-up synchronous path too", async () => {
  const p = tweaks("Warm", { r: { type: "interval", value: [2, 8], min: 0, max: 10, step: 1 } });
  const api = await p.ready;
  assert.equal(api, p);
  assert.deepEqual(p.params.r, [2, 8]);
});
