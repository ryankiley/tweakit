/* The FPS graph is the monitor's per-frame variant: same blade, same loop, same teardown.
 * jsdom has no canvas 2D context, so the graph degrades to the text readout — which is
 * exactly the shared path these checks exercise. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("the FPS graph reads out a whole frame rate once mounted, and stops with the panel", async () => {
  const p = tweaks("F", { fps: { type: "fpsgraph" } });
  const val = p.el.querySelector(".tw-fps-val");
  assert.equal(val.textContent, "—", "nothing to show before a frame");
  assert.equal(p.el.querySelector(".tw-fps-label").textContent, "Fps");
  document.body.append(p.el);
  await wait(120); // a handful of polyfilled frames
  assert.match(val.textContent, /^\d+$/, `a whole number, got "${val.textContent}"`);
  const seen = val.textContent;
  p.destroy();
  await wait(60);
  assert.equal(val.textContent, seen, "destroy() stopped the loop");
});

test("destroy() before the FPS graph ever mounts releases its frame loop", async () => {
  const p = tweaks("F2", { fps: { type: "fpsgraph" } });
  const val = p.el.querySelector(".tw-fps-val");
  p.destroy();
  await wait(60);
  assert.equal(val.textContent, "—");
});

test("a markup FPS graph keeps its default label and an explicit empty label renders none", async () => {
  const q = tweaks("F3", { fps: { type: "fpsgraph", label: "" } });
  assert.equal(q.el.querySelector(".tw-fps-label").textContent, "");
  q.destroy();
});
