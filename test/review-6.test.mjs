/* Sixth review (of #91 and #92): the gradient-stop gate must follow CSS's grammar, not a
 * shape; hsl/hwb readouts must be fixed points at greys and at hue 360; a bag value no
 * snapshot can take must not throw from timers or the build; a destroy() within a frame
 * of the build must still release the controls' global listeners. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { bundle } from "./_bundle.mjs";

const { parseColor, isColor } = await bundle("src/tweaks/controls/colour.ts");
const { serialize } = await bundle("src/wide-gamut.ts");
const { tweaks, mountControl } = await import(new URL("../dist/tweaks.js", import.meta.url));
const lazy = await import(new URL("../dist/tweaks/core.js", import.meta.url));
const near = (a, b, msg) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${msg}: [${i}] ${v} vs ${b[i]}`));

test("the stop gate follows CSS's grammar: shape alone no longer passes", () => {
  for (const s of ["rgb(a b c)", "rgb(1 2)", "rgb(1 2 3 4 5)", "hwb(120, 0%, 0%)", "rgb(255, 0%, 0)", "rgb(255, none, 0)", "hsl(120, 100, 50)", "hsl(50% 100% 50%)", "rgb(255 0 0 0.5)", "rgb(255, 0, 0 / 0.5)", "rgb(255,0,0,)", "rgb(255 0 0 /)", "rgb(255 0 0 / 0.5 / 0.2)", "rgb(255 0 0 / 50 %)", "rgb(1\u00a02 3)"]) assert.ok(!isColor(s), `refused: ${s}`);
  for (const s of ["rgb(255 0 0 / none)", "RGB(1 2 3)", "hsla(120deg, 100%, 50%, 0.5)", "hwb(120 0% 0%)", "rgb(100%, 0%, 0%)", "hsl(120 100 50)", "rgb(1e2 0 0)", "rgb( 1 , 2 , 3 )", "rgb(1\t2\n3)"]) assert.ok(isColor(s), `accepted: ${s}`);
  const p = tweaks("G", { g: { type: "gradient", value: [["rgb(a b c)", 0], ["#000", 0.5], ["#fff", 1]] } });
  assert.equal(p.params.g.stops.length, 2, "the invalid stop never reaches the gradient");
  p.destroy();
});

test("parse: infinities clamp to the slot, invalid forms are junk (black), like a browser-backed canvas", () => {
  near(parseColor("rgb(1e999 0 0)").slice(0, 3), parseColor("rgb(255 0 0)").slice(0, 3), "an infinite channel is the slot's top");
  assert.equal(parseColor("rgb(255 0 0 / 1e999)")[3], 1);
  for (const s of ["rgb(255, 0%, 0)", "hsl(50% 100% 50%)", "rgb(255 0 0 0.5)", "rgb(1 2)"]) assert.deepEqual(parseColor(s), [0, 0, 0, 1], `${s} is junk`);
});

test("hsl and hwb readouts are fixed points, greys and hue 360 included", () => {
  const steps = (n, max) => Array.from({ length: n }, (_, i) => Math.round((i * max) / (n - 1)));
  let chromatic = 0, exactFails = [], idemFails = [];
  for (const mode of ["hsl", "hwb"]) {
    for (const h of steps(25, 360)) for (const a of steps(5, 100)) for (const b of steps(5, 100)) {
      const s = `${mode}(${h % 360} ${a}% ${b}%)`;
      const once = serialize(parseColor(s).slice(0, 3), mode, 1);
      const twice = serialize(parseColor(once).slice(0, 3), mode, 1);
      if (twice !== once) idemFails.push(`${s} → ${once} → ${twice}`);
      const grey = mode === "hsl" ? a === 0 || b === 0 || b === 100 : a + b >= 100; // a grey carries no hue, so only its normalised form can read back as itself
      if (!grey) { chromatic++; if (once !== s) exactFails.push(`${s} → ${once}`); }
    }
  }
  assert.ok(chromatic >= 500, `grid covered ${chromatic} chromatic inputs`);
  assert.deepEqual(exactFails.slice(0, 10), [], `${exactFails.length} chromatic inputs are not fixed points`);
  assert.deepEqual(idemFails.slice(0, 10), [], `${idemFails.length} inputs are not stable after one trip`);
  assert.equal(serialize(parseColor("hsl(0 100% 51%)").slice(0, 3), "hsl", 1), "hsl(0 100% 51%)", "hue 0 stays 0, never reads as 360");
  assert.equal(serialize(parseColor("hwb(0 3% 100%)").slice(0, 3), "hsl", 1), serialize(parseColor(serialize(parseColor("hwb(0 3% 100%)").slice(0, 3), "hsl", 1)).slice(0, 3), "hsl", 1), "a grey's hsl form is stable");
});

test("a getter-only bag key in a persisted snapshot costs only itself", async () => {
  localStorage.clear(); localStorage.setItem("tw:r6-ro", JSON.stringify({ x: 4, ro: 9 }));
  const p = lazy.tweaks("R6", { x: [1, 0, 10, 1], b: { type: "cubicbezier", value: [0.4, 0, 0.2, 1] } }, { persist: "r6-ro" });
  Object.defineProperty(p.params, "ro", { get: () => 1, configurable: true, enumerable: true });
  const errs = []; const err = console.error; console.error = (...a) => errs.push(String(a[0]));
  try { await p.ready; } finally { console.error = err; }
  assert.equal(p.params.x, 4, "the restore still landed the control's value");
  assert.ok(errs.some((m) => m.includes('restoring "ro" failed')));
  p.destroy();
});

test("a destroy() within a frame of the build still releases the controls' window listeners", async () => {
  // Track the listeners by identity: panels earlier tests destroyed release theirs on these
  // same resize events, which a bare count would mistake for ours.
  const added = new Set(), removed = new Set();
  const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  window.addEventListener = (t, fn, o) => { if (t === "resize") added.add(fn); return add(t, fn, o); };
  window.removeEventListener = (t, fn, o) => { if (t === "resize") removed.add(fn); return remove(t, fn, o); };
  const leftover = () => [...added].filter((fn) => !removed.has(fn)).length;
  try {
    const p = tweaks("R6D", { x: [1, 0, 10, 1], s: { type: "spring", value: { stiffness: 100, damping: 12, mass: 1 } } });
    document.body.append(p.el);
    p.destroy(); // same frame: onLive never saw the panel connected
    window.dispatchEvent(new window.Event("resize")); window.dispatchEvent(new window.Event("resize"));
    assert.ok(added.size >= 2); assert.equal(leftover(), 0, "every control listener released on the first event after the destroy");
    const host = document.createElement("div"); document.body.append(host);
    const m = mountControl(host, [1, 0, 10, 1]); await m.ready;
    m.destroy(); window.dispatchEvent(new window.Event("resize"));
    assert.equal(leftover(), 0, "the standalone control's listener released too");
  } finally { window.addEventListener = add; window.removeEventListener = remove; }
});

test("mountControl keeps a literal disabled when the render predicate throws", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const h = mountControl(host, { type: "slider", value: 1, min: 0, max: 10, disabled: true, render: () => { throw new Error("boom"); } });
  await h.ready;
  assert.ok(h.el.firstElementChild.classList.contains("is-disabled"));
  h.destroy();
});
