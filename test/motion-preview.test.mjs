/* The motion puck under the spring and bezier editors: a dot the Web Animations API
 * runs on the browser's own easing — cubic-bezier() for the bezier, a sampled linear()
 * for the spring — replayed on every edit and on hover, never on a loop of its own.
 * jsdom has no animate(); a stub records what each replay asked for. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (target, props) => target.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...props }));
let runs = [], cancelled = 0;
window.HTMLElement.prototype.animate = function (frames, opts) { runs.push({ el: this, frames, ...opts }); return { cancel() { cancelled++; } }; };
const mount = async (schema) => { runs = []; cancelled = 0; const p = tweaks("M", schema); document.body.append(p.el); await p.ready; await wait(40); return p; };

test("bezier: the puck runs cubic-bezier() over 800 ms on build, on each edit, and on hover; a replay cancels the run before it", async () => {
  const p = await mount({ curve: { type: "cubicbezier", value: [0.25, 0.1, 0.25, 1] } });
  const lane = p.el.querySelector(".tw-bezier .tw-motion-lane"), puck = lane.querySelector(".tw-motion-puck");
  assert.ok(lane && puck, "the lane sits under the graph");
  assert.equal(runs.length, 1, "one run on build");
  assert.equal(runs[0].el, puck); assert.equal(runs[0].easing, "cubic-bezier(0.25, 0.1, 0.25, 1)"); assert.equal(runs[0].duration, 800); assert.equal(runs[0].fill, "forwards");
  const [h1] = p.el.querySelectorAll(".tw-bezier-handle");
  h1.focus(); key(h1, { key: "ArrowRight" });
  assert.equal(runs.length, 2, "an edit replays");
  assert.equal(runs[1].easing, "cubic-bezier(0.26, 0.1, 0.25, 1)", "with the edited curve");
  assert.equal(cancelled, 1, "the previous run was cancelled first");
  lane.dispatchEvent(new window.PointerEvent("pointerenter"));
  assert.equal(runs.length, 3, "hover replays");
  assert.equal(runs[2].easing, runs[1].easing, "the same curve");
  p.set("curve", [0.5, 0, 0.5, 1]);
  assert.equal(runs[3].easing, "cubic-bezier(0.5, 0, 0.5, 1)", "a host set() replays too");
  await wait(120);
  assert.equal(runs.length, 4, "nothing runs on its own");
  p.destroy();
});

test("spring: the puck runs a sampled linear() over the settle window; a bouncier spring overshoots past 1", async () => {
  const p = await mount({ s: { type: "spring", stiffness: 300, damping: 26, mass: 1 } });
  assert.equal(runs.length, 1, "one run on build");
  const stops = (r) => { const m = r.easing.match(/^linear\((.+)\)$/); assert.ok(m, `a linear() easing, got ${r.easing}`); return m[1].split(", ").map(Number); };
  const s0 = stops(runs[0]);
  assert.ok(s0.length >= 32, `enough stops to follow the curve (${s0.length})`);
  assert.ok(Math.abs(s0[0]) < 0.01 && Math.abs(s0[s0.length - 1] - 1) < 0.05, "from rest to settled");
  const w0 = Math.sqrt(300), z = 26 / (2 * Math.sqrt(300));
  assert.equal(runs[0].duration, Math.round(Math.min(2.2, 9 / (z * w0)) * 1000), "the drawn window, in ms");
  p.set("s", { visualDuration: 0.3, bounce: 0.6 });
  assert.equal(runs.length, 2, "a host set() replays");
  assert.ok(Math.max(...stops(runs[1])) > 1.1, "bounce 0.6 overshoots, and the easing carries it");
  p.el.querySelector(".tw-spring .tw-motion-lane").dispatchEvent(new window.PointerEvent("pointerenter"));
  assert.equal(runs.length, 3, "hover replays");
  p.destroy();
});
