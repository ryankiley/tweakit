/* Seventh adversarial review (of #93). Each test failed on bd88507 before its fix. Run one
 * file at a time: node --test test/review-7.test.mjs — three tests below need a lazy type
 * no earlier test in this process has loaded (spring, cubicbezier, point), in that order. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { bundle } from "./_bundle.mjs";

globalThis.MutationObserver ??= window.MutationObserver; // the lift watchdog feature-detects it by bare identifier (panel-lifecycle.test.mjs does the same)
const { parseColor, isColor } = await bundle("src/tweaks/controls/colour.ts");
const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));
const lazy = await import(new URL("../dist/tweaks/core.js", import.meta.url));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, msg) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${msg}: [${i}] ${v} vs ${b[i]}`));
// Synthetic pointer event — jsdom has no PointerEvent constructor; the drag paths only read
// pointerId / button / buttons / clientX / clientY off it (panel-lifecycle.test.mjs's idiom).
const ptr = (type, props) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), { pointerId: 1, button: 0, buttons: 1, pointerType: "mouse", ...props });
const drag = (p, dx) => {
  const header = p.el.querySelector(".tw-header");
  header.setPointerCapture = header.releasePointerCapture = () => {};
  header.dispatchEvent(ptr("pointerdown", { clientX: 100, clientY: 10 }));
  header.dispatchEvent(ptr("pointermove", { clientX: 100 + dx, clientY: 10 }));
  header.dispatchEvent(ptr("pointerup", { clientX: 100 + dx, clientY: 10, buttons: 0 }));
};
// A value no control's set() can coerce: `+Object.create(null)` throws (no toString/valueOf),
// and the number field's set() does exactly that first. Parked on params before `ready`, it
// reaches build() through `ctrl.set(target[m.key])` — the "build threw" path fail() covers.
const uncoercible = () => Object.create(null);
const quiet = async (fn) => { const warn = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = warn; } };

// ── The gradient-stop gate: the engine's own functions by CSS's grammar, like the sRGB family ──
test("the stop gate holds oklch()/oklab()/lch()/lab()/color() to CSS Color 4's grammar", () => {
  for (const s of [
    "oklch(70% 0.1 20deg)", "oklch(0.7 0.1 20 / 0.5)", "oklch(none none none)", "oklch(0.5 0.1 1.5turn / 50%)", "OKLCH(0.5 0.1 20)", "oklch(\t0.5\n0.1 20 )",
    "lab(50 -20 30 / 50%)", "lab(50% 125% -125%)", "lch(50 30 1.5turn)", "lch(50% 30% none)", "oklab(0.5 0.1 -0.1)",
    "color(display-p3 1 0 0)", "color(xyz 0.5 0.5 0.5 / none)", "color(srgb-linear 100% 0% 0%)", "color(rec2020 1e999 0 0)",
  ]) assert.ok(isColor(s), `accepted: ${JSON.stringify(s)}`);
  for (const s of [
    "oklch(a b c)", "lab(x y z)", "color(foo 1 0 0)", "lch(50 0 0 0)", "oklch()", "color()", "oklch(0.5 0.1)", "oklch(0.5, 0.1, 20)",
    "lch(50 30 50%)", "lab(50deg 0 0)", "oklch(0.5 0.1 20 / 10deg)", "oklch(0.5 0.1 20 / 0.5 / 1)", "color(1 0 0)", "color(srgb 1 0 0 0)", "oklch(0.5 0.1 20)",
  ]) assert.ok(!isColor(s), `refused: ${JSON.stringify(s)}`);
});
test("an invalid oklch() stop never reaches the gradient", () => {
  const p = tweaks("R7A", { g: { type: "gradient", value: [["oklch(a b c)", 0], ["#000", 0.5], ["#fff", 1]] } });
  document.body.append(p.el);
  try { assert.deepEqual(p.params.g.stops.map((s) => s.color), ["#000", "#fff"]); } finally { p.destroy(); }
});
test("a stop's stored text is trimmed, so a non-ASCII space can't ride into the gradient", () => {
  const p = tweaks("R7B", { g: { type: "gradient", value: [[" red ", 0], [" #fff\n", 1]] } });
  document.body.append(p.el);
  try { assert.deepEqual(p.params.g.stops.map((s) => s.color), ["red", "#fff"]); } finally { p.destroy(); }
});
// CSS's <number> has no trailing dot: `1.` tokenises as a number and a delim.
test("a number with a trailing dot is not a CSS <number>", () => {
  for (const s of ["rgb(1. 2 3)", "rgb(255 0 0 / 1.)", "hsl(1.e1deg 100% 50%)", "rgb(1.e2 2 3)", "oklch(.5 0.1 20.)"]) assert.ok(!isColor(s), `refused: ${s}`);
  for (const s of ["rgb(1.5 2 3)", "rgb(.5 0 0 / .5)", "hsl(1e1deg 100% 50%)", "oklch(.5 0.1 20.5)"]) assert.ok(isColor(s), `accepted: ${s}`);
});
test("`none` is a case-insensitive keyword, in the gate and in the parse", () => {
  assert.ok(isColor("rgb(NONE 0 0)")); assert.ok(isColor("oklch(None 0.1 20 / nOnE)"));
  near(parseColor("hsl(NONE 100% 50%)"), parseColor("hsl(0 100% 50%)"), "hsl(NONE 100% 50%) is red, not black");
  near(parseColor("oklch(0.5 NONE 20)"), parseColor("oklch(0.5 0 20)"), "oklch(0.5 NONE 20) is the grey");
});
test("an infinite hue parses the same with a unit as without one", () => {
  near(parseColor("hsl(1e999deg 100% 50%)"), parseColor("hsl(1e999 100% 50%)"), "hsl");
  near(parseColor("oklch(0.5 0.1 1e999turn)"), parseColor("oklch(0.5 0.1 1e999)"), "oklch");
  assert.ok(parseColor("hsl(1e999deg 100% 50%)").every(Number.isFinite), "finite channels");
});

// ── The failure path ──
test("a failed build's controls release their window listeners once the panel is destroyed", () => quiet(async () => {
  const added = new Set(), removed = new Set();
  const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  window.addEventListener = (t, fn, o) => { if (t === "resize") added.add(fn); return add(t, fn, o); };
  window.removeEventListener = (t, fn, o) => { if (t === "resize") removed.add(fn); return remove(t, fn, o); };
  const leftover = () => [...added].filter((fn) => !removed.has(fn)).length;
  try {
    const p = lazy.tweaks("R7C", { s: { type: "spring", value: { stiffness: 100, damping: 12, mass: 1 } }, n: { type: "number", value: 1 } });
    document.body.append(p.el);
    p.params.n = uncoercible(); // the spring builds and registers its window listener; the number field's set() then throws out of build()
    await assert.rejects(p.ready, TypeError);
    assert.ok(added.size >= 1, "the spring registered a resize listener before the build threw");
    p.destroy();
    window.dispatchEvent(new window.Event("resize"));
    assert.equal(leftover(), 0, "the spring's resize listener is still registered after the failed build and destroy()");
  } finally { window.addEventListener = add; window.removeEventListener = remove; }
}));
test("a build that throws at its first control is reported as a build that threw", async () => {
  const warns = []; const warn = console.warn; console.warn = (...a) => warns.push(String(a[0]));
  try {
    const p = lazy.tweaks("R7D", { n: { type: "number", value: 1 }, b: { type: "cubicbezier", value: [0.4, 0, 0.2, 1] } });
    document.body.append(p.el);
    p.params.n = uncoercible();
    await assert.rejects(p.ready, TypeError);
    const msg = warns.find((m) => m.includes("could not be built")) || "(no warning)";
    assert.ok(msg.includes("the build threw"), `expected the cause "the build threw", got: ${msg}`);
    p.destroy();
  } finally { console.warn = warn; }
});
// The lift watchdog (the MutationObserver that pulls a dragged-out panel off <body> when its
// host slot leaves the document) is one of the shell's own cleanups; a failed build must
// leave those to destroy().
test("a failed build keeps the shell's own attachments: a lifted panel still leaves with its host", () => quiet(async () => {
  const host = document.createElement("div"); document.body.append(host);
  try {
    const p = lazy.tweaks("R7E", { n: { type: "number", value: 1 }, pt: { type: "point", components: [{ key: "x", value: 0 }, { key: "y", value: 0 }] } });
    host.append(p.el);
    drag(p, 40); // lift before ready: the header is live from the shell
    assert.equal(p.el.parentNode, document.body, "lifted to body");
    p.params.n = uncoercible();
    await assert.rejects(p.ready, TypeError);
    host.remove();
    await tick(30);
    assert.ok(!p.el.isConnected, "the panel is stranded on <body> after its host slot left the document");
    p.destroy();
  } finally { host.remove(); }
}));
test("the copy button survives a bag value JSON can't take", () => quiet(async () => {
  const p = tweaks("R7F", { x: [1, 0, 10, 1] });
  document.body.append(p.el);
  const loop = {}; loop.self = loop; p.params.loop = loop;
  const rejections = []; const onRej = (e) => rejections.push(e);
  process.on("unhandledRejection", onRej);
  try {
    p.el.querySelector(".tw-toolbar-btn--swap").click();
    await tick(30);
    assert.deepEqual(rejections.map((e) => String((e && e.message) || e)), [], "the copy click handler rejected");
  } finally { process.off("unhandledRejection", onRej); p.destroy(); }
}));
