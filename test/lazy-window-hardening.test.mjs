/* The lazy window's edges (dist/tweaks/core.js, before `ready`): a destroy() from inside
 * the replay, a key that can't stringify, the toolbar's disabled triggers, a load queued
 * behind its save, and the global listeners the build registers. Each test needs a lazy
 * control the earlier tests did NOT load — once a chunk is registered the next panel
 * assembles synchronously and the window closes — so each uses its own type. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks/core.js", import.meta.url));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

test("a destroy() from a listener mid-replay drops the rest of the queue and arms no save", async () => {
  localStorage.clear();
  const p = tweaks("D", { x: [1, 0, 10, 1], s: { type: "spring", value: { stiffness: 100, damping: 12, mass: 1 } } }, { persist: "lwh-destroy" });
  document.body.append(p.el);
  p.on(() => p.destroy());
  p.set("x", 3); p.set("x", 5);
  await p.ready; await tick(250);
  assert.equal(p.params.x, 3, "the write behind the destroying listener never applied");
  assert.equal(localStorage.getItem("tw:lwh-destroy"), null, "no persist write landed after destroy()");
});

test("a key that can't stringify throws at the call; the panel still becomes ready with its toolbar live", async () => {
  const p = tweaks("K", { x: [1, 0, 10, 1], b: { type: "cubicbezier", value: [0.4, 0, 0.2, 1] } });
  document.body.append(p.el);
  assert.throws(() => p.set(Object.create(null), 1), TypeError);
  p.set("x", 5);
  await p.ready;
  assert.equal(p.params.x, 5, "the write queued after the bad one still applied");
  assert.equal(p.el.querySelector(".tw-toolbar-btn--reset").disabled, false, "the toolbar came live");
  p.destroy();
});

test("a queued call that throws costs only itself", async () => {
  // A throwing opts.onReset inside a queued reset() used to throw out of the replay: ready
  // rejected, the writes behind it were lost, and the toolbar stayed disabled for good.
  const errors = []; const err = console.error; console.error = (...a) => errors.push(String(a[0]));
  try {
    const p = tweaks("T", { x: [1, 0, 10, 1], pt: { type: "point", components: [{ key: "x", value: 0 }, { key: "y", value: 0 }] } }, { onReset: () => { throw new Error("onReset boom"); } });
    document.body.append(p.el);
    p.set("x", 5); p.reset(); p.set("x", 7);
    await p.ready;
    assert.equal(p.params.x, 7, "the write behind the throwing reset still applied");
    assert.equal(p.el.querySelector(".tw-toolbar-btn--reset").disabled, false, "the toolbar came live");
    assert.ok(errors.some((m) => m.includes("queued before ready failed")), "the throw was reported");
    p.destroy();
  } finally { console.error = err; }
});

test("the disabled presets and filter triggers stay inert to a synthetic click before ready", async () => {
  localStorage.clear();
  const p = tweaks("I", { x: [1, 0, 10, 1], r: { type: "interval", value: [2, 8], min: 0, max: 10, step: 1 } }, { persist: "lwh-inert", filter: true });
  document.body.append(p.el);
  const presets = p.el.querySelector('[aria-label="Presets"]'), search = p.el.querySelector('button[aria-label="Filter controls"]');
  assert.ok(presets.disabled && search.disabled);
  click(presets); click(search);
  await tick(30);
  assert.equal(presets.getAttribute("aria-expanded"), "false");
  assert.equal(document.querySelector("body > .tw-presets-menu.is-open"), null, "no menu opened on the unbuilt panel");
  assert.ok(!p.el.classList.contains("is-searching"), "the filter did not open");
  await p.ready;
  click(presets); await tick(30);
  assert.ok(document.querySelector("body > .tw-presets-menu"), "after ready the same click opens it");
  p.destroy();
});

test("a load queued behind its save sees it; a delete queued between cancels it", async () => {
  localStorage.clear();
  const p = tweaks("S", { x: [1, 0, 10, 1], im: { type: "image" } }, { persist: "lwh-save" });
  p.set("x", 4);
  assert.equal(p.savePreset("four"), true);
  p.set("x", 9);
  assert.equal(p.loadPreset("four"), true, "the save ahead of it counts as stored");
  await p.ready;
  assert.equal(p.params.x, 4, "the load replayed after the save and restored its value");
  assert.equal(p.savePreset("gone"), true); p.deletePreset("gone");
  assert.equal(p.loadPreset("gone"), false, "a delete queued after the save cancels it");
  p.destroy();
});

test("the undo keys release after a mount-then-unmount with no event while connected", async () => {
  const counts = { add: 0, remove: 0 };
  const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
  document.addEventListener = (t, fn, o) => { if (t === "keydown") counts.add++; return add(t, fn, o); };
  document.removeEventListener = (t, fn, o) => { if (t === "keydown") counts.remove++; return remove(t, fn, o); };
  try {
    const host = document.createElement("div"); document.body.append(host);
    const p = tweaks("U", { x: [1, 0, 10, 1], pl: { type: "plot", expr: "x" } }, { undo: true });
    host.append(p.el); // mounted before ready, as a host normally does
    await p.ready;
    host.remove(); // unmounted without destroy() — an SPA route change
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
    assert.equal(counts.add, 1, "the undo listener was registered once");
    assert.equal(counts.remove, 1, "and released on the first keydown after the panel left the document");
  } finally { document.addEventListener = add; document.removeEventListener = remove; }
});

test("a chunk that fails to load leaves the API inert instead of a silent sink", async () => {
  // Build against a copy of the split build whose colour chunk is missing, so a panel that
  // needs it can never assemble.
  const { mkdtemp, cp, readdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(tmpdir(), "tw-broken-"));
  await cp(new URL("../dist/tweaks/", import.meta.url), dir, { recursive: true });
  for (const f of await readdir(dir)) if (/^colour-.*\.js$/.test(f)) await rm(path.join(dir, f));
  const { tweaks: broken } = await import(path.join(dir, "core.js"));
  const errors = []; const err = console.error; console.error = (...a) => errors.push(a);
  try {
    const p = broken("Broken", { x: [1, 0, 10, 1], c: "#7c5cff" }, { persist: "lwh-broken" });
    document.body.append(p.el);
    p.set("x", 5);
    await assert.rejects(p.ready);
    assert.equal(p.savePreset("ghost"), false, "a save after the failure is refused, not pretended");
    p.set("x", 6); p.set("x", 7);
    assert.equal(p.params.x, undefined, "nothing applied and nothing queued");
    assert.equal(p.el.querySelector(".tw-toolbar-btn--reset").disabled, true, "the toolbar stays inert");
    assert.ok(errors.some((a) => String(a[0]).includes("failed to load")), "the failure is reported once on the console");
    p.destroy();
  } finally { console.error = err; await rm(dir, { recursive: true, force: true }); }
});
