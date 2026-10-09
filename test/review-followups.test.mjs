/* Follow-ups from the adversarial review of the merged pass-10 work: a standalone control
 * honours the per-control options its type admits, the markup toolbar's copy survives a
 * data-key of "__proto__", and a preset load queued behind a delete is refused. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { mountControl, enhance } = await import(new URL("../dist/tweaks.js", import.meta.url));
const lazy = await import(new URL("../dist/tweaks/core.js", import.meta.url));

test("mountControl honours disabled and render on a verbose value, resolved once", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const a = mountControl(host, { type: "slider", value: 1, min: 0, max: 10, disabled: true });
  const b = mountControl(host, { type: "slider", value: 1, min: 0, max: 10, disabled: () => true });
  const c = mountControl(host, { type: "slider", value: 1, min: 0, max: 10, render: () => false });
  const d = mountControl(host, { type: "slider", value: 1, min: 0, max: 10, disabled: () => { throw new Error("boom"); } });
  await Promise.all([a.ready, b.ready, c.ready, d.ready]);
  for (const h of [a, b]) { const el = h.el.firstElementChild; assert.ok(el.classList.contains("is-disabled") && el.inert, "disabled control is greyed and inert"); }
  assert.ok(c.el.firstElementChild.classList.contains("tw-cond-hidden"), "render:false hides it");
  assert.ok(!d.el.firstElementChild.classList.contains("is-disabled"), "a throwing predicate leaves the control as-is");
  for (const h of [a, b, c, d]) h.destroy();
});

test("the markup toolbar's copy keeps a host keyed __proto__", async () => {
  const holder = document.createElement("div");
  holder.innerHTML = `<div class="tw-panel" data-mode="inline"><div class="tw-header"><span class="tw-title">P</span></div><div class="tw-controls">
    <div data-tw="slider" data-key="__proto__" data-label="Size" data-value="1" data-min="0" data-max="10"></div>
    <div data-tw="slider" data-key="a" data-label="Size" data-value="2" data-min="0" data-max="10"></div>
  </div></div>`;
  document.body.append(holder);
  await enhance(holder);
  let copied = null;
  const clip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async (t) => { copied = t; } }, configurable: true });
  try {
    holder.querySelector(".tw-toolbar-btn--swap").click();
    await new Promise((r) => setTimeout(r, 0));
  } finally {
    if (clip) Object.defineProperty(globalThis.navigator, "clipboard", clip); else delete globalThis.navigator.clipboard;
  }
  assert.deepEqual(Object.keys(JSON.parse(copied)), ["__proto__", "a"]);
  holder.remove();
});

test("a preset load queued behind a delete of the same name is refused", async () => {
  localStorage.clear();
  localStorage.setItem("tw:rf:presets", JSON.stringify({ a: { x: 7 } }));
  const p = lazy.tweaks("RF", { x: [1, 0, 10, 1], r: { type: "interval", value: [2, 8], min: 0, max: 10, step: 1 } }, { persist: "rf" });
  assert.ok(p.el.querySelector(".tw-toolbar-btn--reset").disabled, "in the lazy window");
  p.deletePreset("a");
  assert.equal(p.loadPreset("a"), false, "the delete queued ahead of it wins");
  assert.equal(p.savePreset("a"), true);
  assert.equal(p.loadPreset("a"), true, "a save queued after the delete brings it back");
  await p.ready;
  assert.equal(p.params.x, 1, "the restored save was the (default) value at that point in the queue");
  assert.deepEqual(p.presets(), ["a"]);
  p.destroy();
});

const { tweaks: sync } = await import(new URL("../dist/tweaks.js", import.meta.url));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const spring = { type: "spring", value: { stiffness: 100, damping: 12, mass: 1 } };

test("a listener that destroys the panel on the persisted restore leaves no listener behind", async () => {
  localStorage.clear(); localStorage.setItem("tw:rf-d", JSON.stringify({ x: 4 }));
  const counts = { add: 0, remove: 0 };
  const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
  document.addEventListener = (t, fn, o) => { if (t === "keydown") counts.add++; return add(t, fn, o); };
  document.removeEventListener = (t, fn, o) => { if (t === "keydown") counts.remove++; return remove(t, fn, o); };
  try {
    const p = lazy.tweaks("RFD", { x: [1, 0, 10, 1], s: spring }, { persist: "rf-d", undo: true, floating: true });
    document.body.append(p.el);
    p.on(() => p.destroy());
    await p.ready;
    assert.equal(counts.add, 0, "the undo listener never registered on the panel the restore's listener had destroyed"); // (the hint teardown removes a keydown listener unconditionally, so removes are not a usable count)
  } finally { document.addEventListener = add; document.removeEventListener = remove; }
});

test("a resize during the lazy window is applied once the panel is ready", async () => {
  const w0 = window.innerWidth;
  const p = lazy.tweaks("RFR", { x: [1, 0, 10, 1], b: { type: "cubicbezier", value: [0.4, 0, 0.2, 1] } }, { floating: { x: 900, y: 10 } });
  document.body.append(p.el);
  assert.ok(p.el.querySelector(".tw-toolbar-btn--reset").disabled, "in the lazy window");
  try {
    window.innerWidth = 500; window.dispatchEvent(new window.Event("resize"));
    await p.ready;
    assert.equal(p.el.style.left, "492px", "clamped into the narrowed viewport at ready");
  } finally { window.innerWidth = w0; p.destroy(); }
});

test("a bag value no snapshot can take doesn't break the build; snapshots carry the controls' values", async () => {
  const warns = []; const warn = console.warn; console.warn = (...a) => warns.push(String(a[0]));
  try {
    const p = lazy.tweaks("RFT", { x: [1, 0, 10, 1], pt: { type: "point", components: [{ key: "x", value: 0 }, { key: "y", value: 0 }] } }, { undo: true, persist: "rf-t" });
    const loop = {}; loop.self = loop; p.params.loop = loop; // parked before ready; the undo seed, the persist timer and toJSON all snapshot it
    await p.ready;
    p.set("x", 5);
    assert.equal(p.params.x, 5, "the panel works");
    assert.deepEqual(p.toJSON().values.x, 5, "toJSON carries the controls' values");
    assert.equal(warns.filter((m) => m.includes("can't be serialised")).length, 1, "said once");
    p.destroy();
  } finally { console.warn = warn; }
});

test("a destroyed panel says nothing when its chunk later fails", async () => {
  const { mkdtemp, cp, readdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(tmpdir(), "tw-broken-"));
  await cp(new URL("../dist/tweaks/", import.meta.url), dir, { recursive: true });
  for (const f of await readdir(dir)) if (/^plot-.*\.js$/.test(f)) await rm(path.join(dir, f));
  const { tweaks: broken } = await import(path.join(dir, "core.js"));
  const warns = []; const warn = console.warn; console.warn = (...a) => warns.push(String(a[0]));
  const errs = []; const err = console.error; console.error = (...a) => errs.push(String(a[0]));
  try {
    const p = broken("Gone", { x: [1, 0, 10, 1], pl: { type: "plot", expr: "x" } });
    p.destroy();
    await assert.rejects(p.ready);
    assert.ok(!warns.some((m) => m.includes("inert")), "no inert warning for a panel the host already tore down");
  } finally { console.warn = warn; console.error = err; await rm(dir, { recursive: true, force: true }); }
});

test("a setMany() batch isolates a key whose change check throws", () => {
  const p = sync("RFB", { x: [1, 0, 10, 1] });
  let calls = 0; p.on(() => calls++);
  p.params.bag = { a: 1 };
  const loop = {}; loop.self = loop;
  const errs = []; const err = console.error; console.error = (...a) => errs.push(String(a[0]));
  try { p.setMany({ x: 5, bag: loop }); } finally { console.error = err; }
  assert.equal(p.params.x, 5); assert.equal(calls, 1, "the good key still notifies");
  assert.ok(errs.some((m) => m.includes('setMany("bag")')));
  p.destroy();
});

test("a preset saved under a number loads under its string name before ready, as it does after", async () => {
  localStorage.clear();
  const p = lazy.tweaks("RFN", { x: [1, 0, 10, 1], t: { type: "tabs", pages: { A: { a: 1 } } } }, { persist: "rf-n" });
  assert.equal(p.savePreset(5), true);
  assert.equal(p.loadPreset("5"), true);
  await p.ready;
  assert.deepEqual(p.presets(), ["5"]);
  p.destroy();
});
