/* Panel options a host reaches for once a panel is part of an app: a write that doesn't
 * echo to on() ({ silent }), saving values without the Presets menu (presets: false), and
 * a control left out of the saved session (persist: false). Runs against the built
 * single-file bundle under jsdom. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, wait, key, saved as stored, quiet, warnings } from "./_helpers.mjs";

const { tweaks } = await loadSingle();

test("a silent set, setMany or fromJSON skips on() but still runs conditionals, persistence and undo", async () => {
  localStorage.clear();
  const p = tweaks("Silent", { live: true, time: { type: "slider", value: 450, min: 300, max: 1725, step: 15, render: (get) => !get("live") }, zoom: [100, 25, 300, 1] }, { persist: true, undo: true });
  let calls = 0; p.on(() => { calls++; });
  p.set("live", false, { silent: true });
  assert.ok(!p.el.querySelector(".twk-slider-wrap").classList.contains("twk-cond-hidden"), "the conditional still follows");
  p.setMany({ time: 600 }, { silent: true });
  p.fromJSON({ values: { zoom: 90 } }, { silent: true });
  assert.equal(calls, 0, "no echo");
  await wait(200); // past the persist debounce
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
  localStorage.setItem("tw:Session", JSON.stringify({ v: 1, values: { media: true, name: "Ana", look: { media2: true } } }));
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
  localStorage.setItem("tw:Odd", JSON.stringify({ v: 1, values: { F: [true] } })); // a hand-edited store: the folder saved as an array, whose length can't be deleted
  let p; assert.doesNotThrow(() => { p = tweaks("Odd", { F: { length: { type: "checkbox", value: false, persist: false } } }, { persist: true }); });
  p.destroy(); localStorage.clear();
});

test("a plain folder object's persist is its child, not an option", () => {
  const p = tweaks("Child", { group: { persist: false, size: [2, 0, 4, 1] } });
  assert.equal(p.params.group.persist, false, "built as a checkbox, as before");
  p.destroy();
});

// A preset carries its image whole, so storage can refuse it: the menu must say so and keep the typed name.
test("a preset storage refuses is announced from the menu as not saved, and keeps its name", async () => {
  localStorage.clear();
  const p = tweaks("Pre", { zoom: [100, 25, 300, 1] }, { persist: true });
  document.body.append(p.el); await p.ready;
  const proto = Object.getPrototypeOf(localStorage), setItem = proto.setItem;
  proto.setItem = () => { throw new Error("QuotaExceededError"); };
  try {
    await quiet(async () => {
      p.el.querySelector('[aria-label="Presets"]').click(); await wait(30);
      const input = document.querySelector(".twk-presets-input"); input.value = "C";
      document.querySelector(".twk-presets-savebtn").click(); await wait(150);
      assert.equal(document.querySelector(".twk-sr[role=status]").textContent, "Preset C not saved: storage is full");
      assert.equal(input.value, "C", "the name stays, to try again");
    });
  } finally { proto.setItem = setItem; }
  p.destroy(); localStorage.clear();
});

// jsdom has no IndexedDB, as some locked-down browsers don't: there an upload can't be saved, and the rest still is.
test("without IndexedDB an upload saves inline when it fits, as 0.5 did, and is left out with a note when it doesn't", async () => {
  localStorage.clear();
  const big = "data:image/gif;base64," + "A".repeat(2048);
  const p = tweaks("NoDB", { x: [1, 0, 10, 1], im: { type: "image" }, url: { type: "image" } }, { persist: "t-nodb" });
  await p.ready;
  const [note] = p.el.querySelectorAll(".twk-image-note");
  p.setMany({ x: 6, im: big, url: "/b.png" }); await wait(250);
  assert.deepEqual(stored("tw:t-nodb"), { x: 6, im: big, url: "/b.png" }, "the upload saves inline");
  assert.equal(note.textContent, "");
  p.destroy();
  const q = tweaks("NoDB", { x: [1, 0, 10, 1], im: { type: "image" }, url: { type: "image" } }, { persist: "t-nodb" });
  await q.ready;
  assert.equal(q.params.im, big, "and comes back");
  q.set("x", 7); await wait(250);
  assert.equal(stored("tw:t-nodb").im, big, "a later save keeps it, so 0.5's inline images survive too");
  const setItem = window.Storage.prototype.setItem;
  window.Storage.prototype.setItem = function (k, v) { if (String(v).includes(big)) throw new DOMException("quota", "QuotaExceededError"); return setItem.call(this, k, v); };
  try {
    q.set("x", 8); await wait(250);
    assert.deepEqual(stored("tw:t-nodb"), { x: 8, url: "/b.png" }, "storage refused it: the image is left out, the rest saves");
    assert.equal(q.el.querySelector(".twk-image-note").textContent, "Not saved");
  } finally { window.Storage.prototype.setItem = setItem; q.destroy(); localStorage.clear(); }
});

// Two persist: true panels named alike shared tw:<name>, and the second's save silently replaced the first's values.
test("a second live panel on the same persist key warns; one after destroy() doesn't", async () => {
  await warnings(async (warned) => {
    const a = tweaks("Twin", { x: [1, 0, 10, 1] }, { persist: true });
    assert.equal(warned.length, 0);
    const b = tweaks("Twin", { y: [1, 0, 10, 1] }, { persist: true });
    await wait(10); // a notice's words come from a lazy chunk
    assert.equal(warned.length, 1);
    assert.match(warned[0], /another live panel already saves under "Twin"/);
    a.destroy(); b.destroy();
    const c = tweaks("Twin", { x: [1, 0, 10, 1] }, { persist: true });
    await wait(10); assert.equal(warned.length, 1, "a remount after destroy() is quiet");
    c.destroy();
  });
  localStorage.clear();
});

// jsdom has no cascade to speak of, so a stand-in getComputedStyle plays the host: inside #slot the panel computes the
// host's accent and font size, under <body> the kit's own. Inline values win, as they would in a browser.
test("the first drag's lift carries what the slot's context gave the panel, and the panel's theme stays on top", () => {
  const real = globalThis.getComputedStyle, host = document.createElement("div"); document.body.append(host);
  const slot = { "--twk-accent": "tomato", "font-size": "19px" }, bodyCtx = { "--twk-accent": "", "font-size": "13px" };
  globalThis.getComputedStyle = (node, ...rest) => {
    if (!node.classList?.contains("twk-panel")) return real(node, ...rest);
    const ctx = () => (host.contains(node) ? slot : bodyCtx);
    return Object.assign(["--twk-accent"], { getPropertyValue: (k) => node.style.getPropertyValue(k) || (ctx()[k] ?? "") });
  };
  try {
    const p = tweaks("Carry", { a: [1, 0, 10, 1] }, { theme: { "--twk-radius": "4px" } });
    host.append(p.el);
    const title = p.el.querySelector(".twk-header-toggle"); title.focus();
    key(title, { key: "ArrowRight", altKey: true }); // the keyboard's drag lifts as a pointer drag does
    assert.equal(p.el.parentElement, document.body, "lifted under <body>");
    assert.equal(p.el.style.getPropertyValue("--twk-accent"), "tomato", "the host's token rode along, inline");
    assert.equal(p.el.style.getPropertyValue("font-size"), "19px", "and its font size");
    assert.equal(p.el.style.getPropertyValue("--twk-radius"), "4px", "the panel's own theme is still applied");
    p.setTheme({ "--twk-accent": "#00ff00" });
    assert.equal(p.el.style.getPropertyValue("--twk-accent"), "#00ff00", "a later setTheme() wins over the carried token");
    assert.equal(p.el.style.getPropertyValue("--twk-radius"), "", "and drops what the old theme set");
    p.setTheme(null);
    assert.equal(p.el.style.getPropertyValue("--twk-accent"), "tomato", "a key the theme drops falls back to the host's value");
    assert.equal(p.el.style.getPropertyValue("--twk-on-accent"), "", "with no derived on-accent left behind");
    p.destroy();
    assert.ok(!p.el.isConnected && !host.querySelector(".twk-lift-slot"), "destroy() removes the panel and its placeholder");
  } finally { globalThis.getComputedStyle = real; host.remove(); }
});
