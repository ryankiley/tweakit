/* Panel options a host reaches for once a panel is part of an app: a write that doesn't
 * echo to on() ({ silent }), saving values without the Presets menu (presets: false), and
 * a control left out of the saved session (persist: false). Runs against the built
 * single-file bundle under jsdom. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle } from "./_helpers.mjs";

const { tweaks } = await loadSingle();
const stored = (k) => JSON.parse(localStorage.getItem(k));

test("a silent set, setMany or fromJSON skips on() but still runs conditionals, persistence and undo", async () => {
  localStorage.clear();
  const p = tweaks("Silent", { live: true, time: { type: "slider", value: 450, min: 300, max: 1725, step: 15, render: (get) => !get("live") }, zoom: [100, 25, 300, 1] }, { persist: true, undo: true });
  let calls = 0; p.on(() => { calls++; });
  p.set("live", false, { silent: true });
  assert.ok(!p.el.querySelector(".tw-slider-wrap").classList.contains("tw-cond-hidden"), "the conditional still follows");
  p.setMany({ time: 600 }, { silent: true });
  p.fromJSON({ values: { zoom: 90 } }, { silent: true });
  assert.equal(calls, 0, "no echo");
  await new Promise((r) => setTimeout(r, 200)); // past the persist debounce
  assert.equal(stored("tw:Silent").zoom, 90, "still saved");
  p.undo(); // flushes the pending history step the silent writes made
  assert.equal(p.params.zoom, 100, "silent writes are in the undo history");
  p.destroy(); localStorage.clear();
});

test("a silent write made inside on() doesn't change the key the other listeners hear", () => {
  const p = tweaks("Last", { a: [0, 0, 10, 1], b: [0, 0, 10, 1] });
  p.on((v, last) => { if (last === "a") p.set("b", v.a, { silent: true }); });
  const heard = []; p.on((v, last) => heard.push(last));
  p.set("a", 7);
  assert.deepEqual([heard, p.params.b], [["a"], 7]);
  p.destroy();
});

test("presets: false keeps persistence without the Presets menu", () => {
  localStorage.clear();
  const p = tweaks("NoPresets", { blur: [24, 0, 100, 1] }, { persist: true, presets: false });
  assert.equal(p.el.querySelector('[aria-label="Presets"]'), null, "no menu");
  assert.equal(p.savePreset("a"), true, "the presets API still works");
  p.set("blur", 40); p.destroy(); // destroy() flushes the pending save
  assert.equal(stored("tw:NoPresets").blur, 40, "values still saved");
  localStorage.clear();
});

test("persist: false keeps a control out of what is saved and what is restored", () => {
  localStorage.clear();
  localStorage.setItem("tw:Session", JSON.stringify({ media: true, name: "Ana", look: { media2: true } }));
  const off = { type: "checkbox", value: false, persist: false };
  const p = tweaks("Session", { media: off, name: "Maya", look: { media2: off }, fx: { glow: { on: off } } }, { persist: true }); // fx: a folder the stored session predates
  assert.deepEqual([p.params.media, p.params.look.media2, p.params.name], [false, false, "Ana"], "stored values for it don't come back; the rest do");
  p.setMany({ media: true, name: "Bo", "look.media2": true });
  assert.equal(p.toJSON().values.media, true, "toJSON still carries it");
  p.destroy();
  assert.deepEqual(stored("tw:Session"), { name: "Bo", look: {}, fx: { glow: {} } }, "not saved, nested either");
  localStorage.clear();
});

test("a stored value that can't drop a persist: false key doesn't break the build", () => {
  localStorage.setItem("tw:Odd", JSON.stringify({ F: [true] })); // a hand-edited store: the folder saved as an array, whose length can't be deleted
  let p; assert.doesNotThrow(() => { p = tweaks("Odd", { F: { length: { type: "checkbox", value: false, persist: false } } }, { persist: true }); });
  p.destroy(); localStorage.clear();
});

test("a plain folder object's persist is its child, not an option", () => {
  const p = tweaks("Child", { group: { persist: false, size: [2, 0, 4, 1] } });
  assert.equal(p.params.group.persist, false, "built as a checkbox, as before");
  p.destroy();
});

// A 10 MB image upload is a legitimate value, but localStorage holds ~5 MB in all: once one such value is in the
// session, the write throws, the bare catch swallowed it, and nothing in the panel persisted again, silently.
test("a string value past 256 KB stays out of the saved session, and a refused write is reported once", async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const big = "data:image/png;base64," + "A".repeat(300 * 1024);
  localStorage.clear();
  localStorage.setItem("tw:Big", JSON.stringify({ pic: big, look: { zoom: 120 } }));
  const p = tweaks("Big", { pic: { type: "image" }, look: { zoom: [100, 25, 300, 1] } }, { persist: true });
  assert.equal(p.params.pic, "", "a stored value that size is not restored either");
  assert.equal(p.params.look.zoom, 120);
  p.set("pic", big); p.set("look.zoom", 150);
  await wait(200); // past the debounce
  assert.deepEqual(stored("tw:Big"), { look: { zoom: 150 } }, "the image stays out; the rest is saved");
  assert.equal(p.toJSON().values.pic, big, "toJSON still carries it");

  const warns = []; const warn = console.warn; console.warn = (...a) => warns.push(a.join(" "));
  const proto = Object.getPrototypeOf(localStorage), setItem = proto.setItem;
  proto.setItem = () => { throw new Error("QuotaExceededError"); };
  try {
    p.set("look.zoom", 160); await wait(200);
    p.set("look.zoom", 170); await wait(200);
    assert.equal(warns.length, 1, "said once, not per edit");
    assert.match(warns[0], /couldn't store "tw:Big"/);
  } finally { proto.setItem = setItem; console.warn = warn; }
  p.set("look.zoom", 180); await wait(200);
  assert.equal(stored("tw:Big").look.zoom, 180, "writes resume once the store takes them");
  p.destroy(); localStorage.clear();
});

// Presets live in localStorage too: a preset holding a big upload failed to save while the menu said it had.
test("a preset leaves out a big string, and a refused preset write returns false and says so", async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  localStorage.clear();
  const big = "data:image/png;base64," + "A".repeat(300 * 1024);
  const p = tweaks("Pre", { pic: { type: "image" }, zoom: [100, 25, 300, 1] }, { persist: true });
  document.body.append(p.el); await p.ready;
  p.set("pic", big); p.set("zoom", 150);
  assert.equal(p.savePreset("A"), true);
  assert.deepEqual(stored("tw:Pre:presets").A, { zoom: 150 }, "the upload stays out of the stored preset");

  const warns = []; const warn = console.warn; console.warn = (...a) => warns.push(a.join(" "));
  const proto = Object.getPrototypeOf(localStorage), setItem = proto.setItem;
  proto.setItem = () => { throw new Error("QuotaExceededError"); };
  try {
    assert.equal(p.savePreset("B"), false, "the API says the write failed");
    p.el.querySelector('[aria-label="Presets"]').click(); await wait(30);
    const input = document.querySelector(".tw-presets-input"); input.value = "C";
    document.querySelector(".tw-presets-savebtn").click(); await wait(150);
    assert.equal(document.querySelector(".tw-sr[role=status]").textContent, "Couldn't save preset C");
    assert.equal(input.value, "C", "the name stays, to try again");
    p.set("zoom", 160); await wait(200);
    assert.equal(warns.length, 2, `one warning per key, the presets' and the session's: ${warns.join(" | ")}`);
    p.set("zoom", 170); await wait(200);
    assert.equal(warns.length, 2, "and not again per edit");
  } finally { proto.setItem = setItem; console.warn = warn; }
  p.destroy(); localStorage.clear();
});
