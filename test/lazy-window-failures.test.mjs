/* The lazy window's failure paths (dist/tweaks/core.js, before `ready`): a build that throws
 * at a control, a chunk that never lands, a restore whose listener destroys the panel, bag
 * values no snapshot can take, and the preset and resize calls queued before ready. Like
 * lazy-window-hardening.test.mjs, each test needs a lazy type no earlier test in this file
 * has loaded (a registered chunk closes the window), so each uses its own; where a test
 * doesn't care which, it takes whatever type is still unloaded. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, loadSplit, tick, ptr } from "./_helpers.mjs";

globalThis.MutationObserver ??= window.MutationObserver; // the lift watchdog feature-detects it by bare identifier
const { tweaks } = await loadSingle();
const lazy = await loadSplit();
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

// A color value: a chunk nothing above has loaded.
test("a listener that destroys the panel on the persisted restore leaves no listener behind", async () => {
  localStorage.clear(); localStorage.setItem("tw:rf-d", JSON.stringify({ x: 4 }));
  const counts = { add: 0, remove: 0 };
  const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
  document.addEventListener = (t, fn, o) => { if (t === "keydown") counts.add++; return add(t, fn, o); };
  document.removeEventListener = (t, fn, o) => { if (t === "keydown") counts.remove++; return remove(t, fn, o); };
  try {
    const p = lazy.tweaks("RFD", { x: [1, 0, 10, 1], c: "#7c5cff" }, { persist: "rf-d", undo: true, floating: true });
    document.body.append(p.el);
    p.on(() => p.destroy());
    await p.ready;
    assert.equal(counts.add, 0, "the undo listener never registered on the panel the restore's listener had destroyed"); // (the hint teardown removes a keydown listener unconditionally, so removes are not a usable count)
  } finally { document.addEventListener = add; document.removeEventListener = remove; }
});

test("a resize during the lazy window is applied once the panel is ready", async () => {
  const w0 = window.innerWidth;
  const p = lazy.tweaks("RFR", { x: [1, 0, 10, 1], g: { type: "gradient", value: [["#000", 0], ["#fff", 1]] } }, { floating: { x: 900, y: 10 } });
  document.body.append(p.el);
  assert.ok(p.el.querySelector(".tw-toolbar-btn--reset").disabled, "in the lazy window");
  try {
    window.innerWidth = 500; window.dispatchEvent(new window.Event("resize"));
    await p.ready;
    assert.equal(p.el.style.getPropertyValue("--tw-float-x"), "492px", "clamped into the narrowed viewport at ready");
  } finally { window.innerWidth = w0; p.destroy(); }
});

test("a value parked on params stays out of every snapshot, so one JSON can't take breaks none", async () => {
  const warns = []; const warn = console.warn; console.warn = (...a) => warns.push(String(a[0]));
  try {
    const p = lazy.tweaks("RFT", { x: [1, 0, 10, 1], im: { type: "image" } }, { undo: true, persist: "rf-t" });
    const loop = {}; loop.self = loop; p.params.loop = loop; // parked before ready; the undo seed, the persist timer and toJSON all snapshot
    await p.ready;
    p.set("x", 5);
    assert.equal(p.params.x, 5, "the panel works");
    assert.deepEqual(Object.keys(p.toJSON().values), ["x", "im"], "toJSON carries the controls' values only");
    assert.deepEqual(warns, []);
    p.destroy();
  } finally { console.warn = warn; }
});

test("a stored key no control has is left alone by a restore", async () => {
  localStorage.clear(); localStorage.setItem("tw:r6-ro", JSON.stringify({ x: 4, ro: 9 }));
  const p = lazy.tweaks("R6", { x: [1, 0, 10, 1], sh: { type: "shadow" } }, { persist: "r6-ro" });
  Object.defineProperty(p.params, "ro", { get: () => 1, configurable: true, enumerable: true });
  const errs = []; const err = console.error; console.error = (...a) => errs.push(String(a[0]));
  try { await p.ready; } finally { console.error = err; }
  assert.equal(p.params.x, 4, "the restore landed the control's value");
  assert.equal(p.params.ro, 1, "and never wrote the key no control owns");
  assert.deepEqual(errs, []);
  p.destroy();
});
