/* Panel behavior against the built single-file bundle (dist/tweaks.js — every
 * control registered synchronously), under jsdom. `npm test` builds dist first.
 * These pin the degrade contracts and API semantics the adversarial passes
 * established — the panel must never throw on hostile schemas, and set()/on()/
 * reset() must round-trip. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, wait, ptr, key } from "./_helpers.mjs";

const { tweaks, enhance } = await loadSingle();
const quiet = async (fn) => { const warn = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = warn; } };

test("a malformed verbose value degrades to a skipped control, not a thrown build", () => {
  const p = tweaks("T", {
    badPoint: { type: "point", components: [null] },
    badTabs: { type: "tabs", pages: { A: null } },
    ok: 5,
  });
  assert.equal(p.params.ok, 5);
  assert.ok(!("badPoint" in p.params));
});

test("soft slider keeps an out-of-range default; hard slider clamps it", () => {
  const soft = tweaks("S", { x: { type: "slider", value: 150, min: 0, max: 100, step: 1, soft: true } });
  assert.equal(soft.params.x, 150);
  const hard = tweaks("H", { x: { type: "slider", value: 150, min: 0, max: 100, step: 1 } });
  assert.equal(hard.params.x, 100);
});

test("set() reaches nested controls by dotted path and unambiguous bare key", () => {
  const p = tweaks("N", { folder: { y: [1, 0, 10, 1] } });
  p.set("folder.y", 7);
  assert.equal(p.params.folder.y, 7);
  p.set("y", 3);
  assert.equal(p.params.folder.y, 3);
});

test("set() refuses prototype-polluting keys", () => {
  const p = tweaks("P", { a: 1 });
  p.set("__proto__.polluted", true);
  p.set("constructor", true);
  assert.equal({}.polluted, undefined);
  assert.equal(typeof {}.constructor, "function"); // untouched
});

test("text control coerces null/undefined to the empty string", () => {
  const p = tweaks("Txt", { label: { type: "text", value: "hi" } });
  p.set("label", null);
  assert.equal(p.params.label, "");
});

test("interval without a value tuple defaults to its bounds", () => {
  const p = tweaks("I", { r: { type: "interval", min: 0, max: 10 } });
  assert.deepEqual(p.params.r, [0, 10]);
});

test("number control survives an Infinity step", () => {
  const p = tweaks("Inf", { n: { type: "number", value: 5, step: Infinity } });
  assert.equal(p.params.n, 5);
  p.set("n", 7);
  assert.equal(p.params.n, 7);
});

test("on() hears changes with the changed key; reset() restores defaults", () => {
  const p = tweaks("R", { folder: { y: [1, 0, 10, 1] } });
  let heard = null;
  p.on((params, last) => { heard = last; });
  p.set("folder.y", 9);
  assert.equal(heard, "folder.y", "the dotted path, as set() names it");
  assert.equal(p.params.folder.y, 9);
  p.reset();
  assert.equal(p.params.folder.y, 1);
});

test("a same-value set() does not notify (the echo guard)", () => {
  const p = tweaks("E", { y: [1, 0, 10, 1], pt: { type: "point", components: [{ key: "x", value: 2 }] } });
  let calls = 0;
  p.on(() => calls++);
  p.set("y", 1);                 // unchanged primitive
  p.set("pt", { x: 2 });         // structurally-equal object value
  assert.equal(calls, 0);
  p.set("y", 2);
  assert.equal(calls, 1);
});

test("destroy() inerts the API and removes the panel", () => {
  const p = tweaks("D", { a: 1 });
  document.body.append(p.el);
  p.destroy();
  assert.equal(p.el.isConnected, false);
  p.set("a", 5); // must be a silent no-op
  assert.equal(p.params.a, 1);
});

test("monitor: a negative `rows` doesn't spin the buffer trim into an infinite loop", async () => {
  // Regression: `while (lines.length > rows)` with rows < 0 never terminates (length
  // floors at 0, still > the negative bound) — a frozen tab on the first poll tick.
  const p = tweaks("M", { m: { type: "monitor", rows: -5, get: () => "tick", interval: 30 } });
  document.body.append(p.el);
  await new Promise((r) => setTimeout(r, 100)); // several poll ticks at the 30ms floor
  const buf = p.el.querySelector(".tw-monitor-buffer");
  assert.ok(buf, "buffer rendered");
  assert.ok(buf.textContent.split("\n").length <= 2, "buffer stayed bounded under a negative rows");
  p.destroy();
});

test("destroy() releases a monitor's poll even on a panel that never mounted", async () => {
  // Regression: the poll deliberately idles through the "built but not appended yet"
  // window, so it never saw an unmount to stop on — a panel destroyed before it ever
  // connected left the interval running for the life of the page. The control now hands
  // its teardown to the panel, so destroy() reaches it.
  const p = tweaks("MD", { m: { type: "monitor", get: () => 42, interval: 30, view: "text" } });
  p.destroy();                                  // never mounted
  document.body.append(p.el);                   // re-attach the dead node: a live poll would find it connected and tick
  await new Promise((r) => setTimeout(r, 150)); // several intervals at the 30ms floor
  assert.equal(p.el.querySelector(".tw-fps-val").textContent, "—", "the poll was released, so it never wrote a value");
  p.el.remove();
});

test("a hostile color string is skipped, not thrown, and the rest of a restore still lands", () => {
  // Regression, two halves: `color(constructor …)` resolved its space off Object.prototype
  // — truthy, so it slipped past the unknown-space guard and reached the conversion maths
  // as a non-space, throwing a TypeError out of set(); and applySnapshot ran its entries
  // unguarded, so that one throw abandoned every later value AND the notify with it.
  const p = tweaks("CX", { a: [1, 0, 10, 1], c: { type: "color", value: "#ff0000" }, z: [1, 0, 10, 1] });
  p.set("c", "color(constructor 1 0 0)");       // must not throw…
  p.set("c", "color(__proto__ 1 0 0)");         // …nor this: an unknown color() space
  const neutral = p.params.c;                   // degrades to the picker's neutral default, like any other unsupported space
  assert.match(String(neutral), /^oklch\(/, "an unrecognized space degrades to a real color");

  let calls = 0;
  p.on(() => calls++);
  p.fromJSON({ values: { a: 5, c: "color(constructor 1 0 0)", z: 9 } });
  assert.equal(p.params.a, 5);
  assert.equal(p.params.z, 9, "a bad value mid-restore doesn't abandon the entries after it");
  assert.equal(calls, 1, "the restore still notified exactly once");
});

test("a slider survives a step too fine for toFixed", () => {
  // Regression: stepPrecision(1e-101) → 101 decimals, past toFixed's 100-digit ceiling —
  // a RangeError at construction that degraded the whole control to "skipped".
  const p = tweaks("Fine", { x: { type: "slider", value: 0.5, min: 0, max: 1, step: 1e-101 } });
  assert.ok("x" in p.params, "control built");
  p.set("x", 0.25);
  assert.equal(p.params.x, 0.25);
});

test("markup mode echoes an object-valued control as its components, not [object Object]", async () => {
  // Regression: enhance() assigned ctrl.get() straight onto data-value, so the controls
  // whose value is an object (point, spring) wrote the default toString — and data-value
  // is the very attribute the markup parsers read a point back out of.
  const holder = document.createElement("div");
  holder.innerHTML = `<div data-tw="point" data-label="Offset" data-components="X,Y" data-value="3,4" data-step="1"></div>`;
  document.body.append(holder);
  await enhance(holder);
  const host = holder.querySelector('[data-tw="point"]');
  host._tw.ctrl.set({ x: 7, y: 9 });
  host._tw.ctrl.el.querySelector(".tw-num").dispatchEvent(new Event("change", { bubbles: true })); // nudge a field so the control emits
  assert.ok(!/object Object/.test(host.dataset.value), `data-value stayed parseable, got "${host.dataset.value}"`);
  assert.match(host.dataset.value, /^[\d.,-]+$/, "components, comma-joined — the form the point parser reads");
  holder.remove();
});

test("markup mode's copy keys by data-key and suffixes duplicates", async () => {
  // Regression: the copy keyed every control by its LABEL, so two same-labeled hosts
  // collided and the later one silently overwrote the earlier in the copied JSON.
  const holder = document.createElement("div");
  holder.innerHTML = `<div class="tw-panel" data-mode="inline"><div class="tw-header"><span class="tw-title">P</span></div><div class="tw-controls">
    <div data-tw="slider" data-label="Size" data-value="1" data-min="0" data-max="10"></div>
    <div data-tw="slider" data-label="Size" data-value="2" data-min="0" data-max="10"></div>
    <div data-tw="slider" data-key="depth" data-label="Size" data-value="3" data-min="0" data-max="10"></div>
  </div></div>`;
  document.body.append(holder);
  await enhance(holder);
  assert.deepEqual([...holder.querySelectorAll("[data-tw]")].map((h) => h._tw.key), ["Size", "Size", "depth"], "data-key wins over the label when present");

  // Drive the real copy button and read what it actually put on the clipboard.
  let copied = null;
  const clip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async (t) => { copied = t; } }, configurable: true });
  try {
    holder.querySelector(".tw-toolbar-btn--swap").click();
    await new Promise((r) => setTimeout(r, 0)); // the click handler awaits the write
  } finally {
    if (clip) Object.defineProperty(globalThis.navigator, "clipboard", clip);
    else delete globalThis.navigator.clipboard;
  }
  const vals = JSON.parse(copied);
  assert.deepEqual(Object.keys(vals), ["Size", "Size-2", "depth"], "all three controls survive the copy");
  assert.deepEqual(Object.values(vals), [1, 2, 3], "each keeps its own value");
  holder.remove();
});

test("opts.filter without a toolbar is refused, not built invisibly", () => {
  // Regression: the search button lives in the toolbar, so toolbar:false left the filter
  // input mounted in the header with nothing able to reveal it.
  const p = tweaks("FT", { a: [1, 0, 10, 1] }, { filter: true, toolbar: false });
  document.body.append(p.el);
  assert.equal(p.el.querySelector(".tw-search"), null);
  p.destroy();
});

test("setMany applies a batch across folders and notifies once", () => {
  const p = tweaks("SM", { a: [1, 0, 10, 1], b: [1, 0, 10, 1], folder: { c: [1, 0, 10, 1] } });
  let calls = 0, lastKey;
  p.on((params, last) => { calls++; lastKey = last; });
  p.setMany({ a: 5, b: 7, "folder.c": 9 });
  assert.equal(p.params.a, 5);
  assert.equal(p.params.b, 7);
  assert.equal(p.params.folder.c, 9);
  assert.equal(calls, 1);          // one notification for the whole batch, not one per key
  assert.equal(lastKey, undefined); // several changed at once: no one key is named, as after a restore
});

test("setMany skips reserved + no-op keys but applies the rest, still notifying once", () => {
  const p = tweaks("SM2", { a: [1, 0, 10, 1], b: [1, 0, 10, 1] });
  let calls = 0;
  p.on(() => calls++);
  p.setMany({ a: 1, b: 4, "__proto__.x": true }); // a unchanged, proto refused, b changes
  assert.equal({}.x, undefined);
  assert.equal(p.params.a, 1);
  assert.equal(p.params.b, 4);
  assert.equal(calls, 1);
});

test("setMany with no effective change does not notify (the batch echo guard)", () => {
  const p = tweaks("SM3", { a: [1, 0, 10, 1] });
  let calls = 0;
  p.on(() => calls++);
  p.setMany({ a: 1 });
  assert.equal(calls, 0);
});

test("spring defaults to physics mode and emits stiffness/damping/mass only", () => {
  const p = tweaks("Sp", { s: { type: "spring", value: { stiffness: 120, damping: 14, mass: 1 } } });
  assert.deepEqual(p.params.s, { stiffness: 120, damping: 14, mass: 1 });
});

test("spring time mode maps duration/bounce to physics and carries both through", () => {
  const p = tweaks("Sp2", { s: { type: "spring", visualDuration: 0.5, bounce: 0.2 } });
  const v = p.params.s;
  assert.equal(v.visualDuration, 0.5);
  assert.equal(v.bounce, 0.2);
  const k = (2 * Math.PI / (0.5 * 1.2)) ** 2;               // Motion's mapping: the period is visualDuration × 1.2
  assert.ok(Math.abs(v.stiffness - k) < 1e-6);             // resolved physics for runtime-agnostic consumers
  assert.ok(Math.abs(v.damping - 2 * (1 - 0.2) * Math.sqrt(k)) < 1e-6);
  assert.equal(v.mass, 1);
});

test("spring set() flips mode by the keys it receives", () => {
  const p = tweaks("Sp3", { s: { type: "spring", value: { stiffness: 100, damping: 12, mass: 1 } } });
  p.set("s", { visualDuration: 0.4, bounce: 0.1 });         // physics → time
  assert.equal(p.params.s.visualDuration, 0.4);
  assert.equal(p.params.s.bounce, 0.1);
  p.set("s", { stiffness: 200, damping: 20, mass: 2 });     // time → physics
  assert.deepEqual(p.params.s, { stiffness: 200, damping: 20, mass: 2 });
  assert.ok(!("visualDuration" in p.params.s));            // clean physics value, no authoring keys
});

test("spring set() with both key groups restores the physics cache for a later toggle", () => {
  const p = tweaks("Sp", { s: { type: "spring", value: { stiffness: 100, damping: 12, mass: 1 } } });
  document.body.append(p.el);
  // a time-mode value that ALSO carries physics keys (as reset's default does) — time wins
  // for the active value, but the physics cache must be restored too.
  p.set("s", { visualDuration: 0.5, bounce: 0.2, stiffness: 250, damping: 22, mass: 2 });
  assert.equal(p.params.s.visualDuration, 0.5);   // active = time
  const physBtn = [...p.el.querySelectorAll(".tw-spring .tw-seg-btn")].find((b) => b.textContent.trim() === "Physics");
  physBtn.click();                                  // toggle to Physics
  assert.deepEqual(p.params.s, { stiffness: 250, damping: 22, mass: 2 }); // restored, not stale {100,12,1}
  p.destroy();
});

test("toJSON captures values + folder/tab UI; fromJSON restores them; JSON.stringify uses it", () => {
  const p = tweaks("State", {
    blur: [10, 0, 100, 1],
    shadow: { radius: [4, 0, 20, 1] },
    pages: { type: "tabs", pages: { First: { x: [1, 0, 10, 1] }, Second: { y: [2, 0, 10, 1] } } },
  });
  document.body.append(p.el);
  const tabBtns = () => [...p.el.querySelectorAll(".tw-tabs-tab")];
  p.set("blur", 42);
  p.el.querySelector(".tw-folder-header").click();                       // collapse the shadow folder
  tabBtns().find((t) => t.textContent.trim() === "Second").click();      // activate page "Second" (key "second")

  const state = p.toJSON();
  assert.equal(state.values.blur, 42);
  assert.equal(state.values.shadow.radius, 4);
  assert.equal(state.ui.folders["shadow"], true);
  assert.equal(state.ui.tabs["pages"], "second");
  assert.equal(JSON.parse(JSON.stringify(p)).values.blur, 42);          // the standard toJSON hook fires through stringify

  // drift away from the saved state, then restore
  p.set("blur", 0);
  p.el.querySelector(".tw-folder-header").click();                       // expand
  tabBtns().find((t) => t.textContent.trim() === "First").click();
  assert.ok(!p.el.querySelector(".tw-folder").classList.contains("is-collapsed"));

  p.fromJSON(state);
  assert.equal(p.params.blur, 42);
  assert.ok(p.el.querySelector(".tw-folder").classList.contains("is-collapsed"));
  assert.equal(tabBtns().find((t) => t.dataset.active === "true").textContent.trim(), "Second");
  p.destroy();
});

test("fromJSON applies known value paths, skips stale ones, and notifies once", () => {
  const p = tweaks("State2", { a: [1, 0, 10, 1], b: [1, 0, 10, 1] });
  let calls = 0;
  p.on(() => calls++);
  p.fromJSON({ values: { a: 5, gone: 9 } });   // 'gone' matches no control
  assert.equal(p.params.a, 5);
  assert.equal(p.params.b, 1);                 // untouched (skip-missing)
  assert.equal(calls, 1);                      // one notification for the whole restore
});


test("a header press released off the header can't leave the panel dragging on hover", () => {
  // Regression: pointer capture is only taken once the press crosses the 4px drag
  // threshold, so a release just off the header (a hair of drift onto the body, or the
  // page scrolling under a held button) never reached endDrag and left dragId set. The
  // next plain hover then passed the threshold against the stale origin and lifted the
  // panel into a drag with no button held.
  const p = tweaks("Drag", { a: [1, 0, 10, 1] });
  document.body.append(p.el);
  const header = p.el.querySelector(".tw-header"), body = p.el.querySelector(".tw-body");
  header.setPointerCapture = header.releasePointerCapture = () => {};

  header.dispatchEvent(ptr("pointerdown", { clientX: 100, clientY: 10 }));
  header.dispatchEvent(ptr("pointermove", { clientX: 101, clientY: 12 }));   // 3px — under the threshold, so no capture
  body.dispatchEvent(ptr("pointerup", { clientX: 101, clientY: 13, buttons: 0 })); // lands off the header
  header.dispatchEvent(ptr("pointermove", { clientX: 400, clientY: 10, buttons: 0 })); // a plain hover, nothing pressed

  assert.equal(p.el.dataset.mode, "inline", "the panel stayed put instead of lifting into a floating drag");
  assert.ok(!p.el.classList.contains("is-dragging"));
  p.destroy();
});

test("double-clicking a slider readout resets it even once the hover armed the editor", async () => {
  // Regression: the readout is both the reset target and the click-to-type trigger. After
  // an 800ms hover — exactly what precedes a deliberate double-click — click #1 swapped it
  // for the inline input, so the dblclick landed on the input and the reset never fired.
  const p = tweaks("DblEdit", { x: [5, 0, 100, 1] });
  document.body.append(p.el);
  p.set("x", 42);
  const val = p.el.querySelector(".tw-slider-value");
  val.dispatchEvent(new Event("mouseenter", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 850)); // arm the hover-to-edit gate
  assert.ok(val.classList.contains("is-editable"), "editing armed");

  val.dispatchEvent(new Event("click", { bubbles: true }));      // click #1 opens the editor…
  const input = p.el.querySelector(".tw-slider-input");
  assert.ok(input, "the inline editor opened");
  input.dispatchEvent(new Event("dblclick", { bubbles: true })); // …so the dblclick retargets to it

  assert.equal(p.params.x, 5, "reset to the schema default");
  assert.equal(p.el.querySelector(".tw-slider-input"), null, "the editor closed behind it");
  p.destroy();
});


test("every button the kit renders is type=button, never a form submit", async () => {
  const p = tweaks("Btns", {
    go: { action: () => {} },
    grp: { type: "buttongroup", buttons: { A: () => {} } },
    on: true,
    pick: { type: "radiogrid", options: ["a", "b"] },
    list: ["x", "y"],
    pages: { type: "tabs", pages: { One: { a: 1 }, Two: { b: 2 } } },
  }, { persist: "t-button-types" });
  document.body.append(p.el);
  p.savePreset("button-type-probe"); // so the presets menu renders a Load + Delete row, not only "No presets yet"
  p.el.querySelector('.tw-toolbar-btn[aria-label="Presets"]').click(); // portals the presets menu to <body>
  await wait(30); // its list renders in the popover's onOpen, a frame later
  const menu = [...document.querySelectorAll(".tw-presets-menu")].find((m) => m.textContent.includes("button-type-probe"));
  assert.ok(menu, "this panel's presets menu rendered its rows");
  const buttons = [...p.el.querySelectorAll("button"), ...menu.querySelectorAll("button")];
  const kinds = new Set(buttons.map((b) => b.className.split(" ")[0]));
  for (const k of ["tw-header-toggle", "tw-toolbar-btn", "tw-button", "tw-buttongroup-btn", "tw-seg-btn", "tw-radiogrid-btn", "tw-select-trigger", "tw-select-option", "tw-tabs-tab", "tw-presets-savebtn", "tw-presets-load", "tw-presets-del"]) assert.ok(kinds.has(k), `${k} rendered`);
  for (const b of buttons) assert.equal(b.type, "button", `<button class="${b.className}"> is type=${b.type}`);
  p.destroy();
});

test("destroy() in the same tick as opening a popover leaves no stray menu, focus, or listener", async () => {
  // Regression: popover() deferred its is-open/onOpen work to the next frame and its outside-press
  // listener to a setTimeout(0), neither re-checking `open` — so a close() in between (a destroy()
  // right after the open) was undone: the dead menu re-showed, onOpen focused its input, and the
  // document listener was re-added after close() had removed it.
  const p = tweaks("Race", { a: 1 }, { persist: "t-popover-race" });
  document.body.append(p.el);
  p.el.querySelector('.tw-toolbar-btn[aria-label="Presets"]').click();
  const menu = [...document.querySelectorAll(".tw-presets-menu")].at(-1);
  assert.ok(menu && menu.isConnected, "the menu portaled to <body>");
  p.destroy(); // same tick as the open
  const added = [];
  document.addEventListener = function (type, ...rest) { added.push(type); return Object.getPrototypeOf(this).addEventListener.call(this, type, ...rest); }; // spy on listeners added behind the close
  try { await wait(40); } finally { delete document.addEventListener; } // past the rAF (16ms here) and the setTimeout(0)
  assert.ok(!menu.classList.contains("is-open"), "the dead menu did not re-open");
  assert.ok(!menu.contains(document.activeElement), "focus was not stolen into it");
  assert.ok(!added.includes("pointerdown"), "no outside-press listener was added after the close");
  await wait(220); // the portaled node is removed 200ms after close
  assert.equal(menu.isConnected, false, "the menu was removed");
});

test("the toolbar's copy emits the values snapshot (nested) and its reset restores defaults", async () => {
  const p = tweaks("Tb", { a: [1, 0, 10, 1], f: { b: [2, 0, 10, 1] } });
  document.body.append(p.el);
  p.set("a", 7); p.set("f.b", 9);
  let copied = null;
  const clip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async (t) => { copied = t; } }, configurable: true });
  try {
    p.el.querySelector(".tw-toolbar-btn--swap").click();
    await new Promise((r) => setTimeout(r, 0)); // the click handler awaits the write
  } finally {
    if (clip) Object.defineProperty(globalThis.navigator, "clipboard", clip);
    else delete globalThis.navigator.clipboard;
  }
  assert.deepEqual(JSON.parse(copied), { a: 7, f: { b: 9 } });
  p.el.querySelector(".tw-toolbar-btn--reset").click();
  assert.equal(p.params.a, 1);
  assert.equal(p.params.f.b, 2);
  p.destroy();
});

test("params holds only values: the changed key rides on on(), and _last is a key like any other", () => {
  const p = tweaks("Keys", { a: [1, 0, 10, 1], _last: [2, 0, 10, 1] });
  let seen;
  p.on((_, last) => { seen = last; });
  p.set("a", 4);
  assert.equal(seen, "a");
  assert.deepEqual(Object.keys(p.params), ["a", "_last"]);
  assert.deepEqual({ ...p.params }, { a: 4, _last: 2 });
  p.set("_last", 6);
  assert.equal(seen, "_last");
  assert.equal(p.params._last, 6);
  p.destroy();
});

test("a keyboard step during a snap slider's settle doesn't leave it lit", async () => {
  // Regression: after a press-release the discrete slider springs to its notch over ~300ms
  // and only that settle dropped .is-active; an arrow key in that window canceled the
  // settle (keyboard steps are instant) and the active styling stuck until the next press.
  const p = tweaks("Settle", { snap: [3, 0, 6, 1] });
  document.body.append(p.el);
  const track = p.el.querySelector(".tw-slider");
  track.setPointerCapture = () => {};
  track.parentNode.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 32, width: 200, height: 32 }); // jsdom lays out nothing; a press needs a real track width
  track.dispatchEvent(ptr("pointerdown", { clientX: 120 }));
  track.dispatchEvent(ptr("pointerup", { clientX: 120, buttons: 0 }));
  await wait(20); // mid-settle
  track.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  await wait(600);
  assert.ok(!track.classList.contains("is-active"), "the track is no longer lit");
  assert.ok(Number.isInteger(p.params.snap), "the value sits on a notch");
  p.destroy();
});

test("a color control given no value resets to the color it opened on, not black", () => {
  // Regression: `{ type: "color" }` built on the picker's default, but its meta carried
  // value: undefined, so reset() handed the control undefined — which parsed as black.
  const p = tweaks("Col", { c: { type: "color" } });
  const opened = p.params.c;
  assert.match(opened, /^oklch\(/);
  p.set("c", "#00ff00");
  assert.notEqual(p.params.c, opened);
  p.reset();
  assert.equal(p.params.c, opened);
});

test("reset() restores the value a control opened on, not the raw schema value it sanitized", () => {
  const p = tweaks("Def", {
    label: { type: "text", value: 5 },                 // a numeric text default
    n: { type: "number", value: "abc" },               // an unusable number default → 0
    s: { type: "spring", mode: "physics", value: { stiffness: 85, damping: 12, mass: 2, visualDuration: 0.4, bounce: 0.3 } }, // explicit physics over a time pair
  });
  const opened = p.toJSON().values;
  assert.equal(opened.label, "5");
  assert.equal(opened.n, 0);
  assert.deepEqual(opened.s, { stiffness: 85, damping: 12, mass: 2 });
  p.set("label", "x"); p.set("n", 8); p.set("s", { visualDuration: 0.6, bounce: 0.1 });
  assert.equal(p.params.s.visualDuration, 0.6);
  p.reset();                                            // used to leave "x", 8, and a time-mode spring
  assert.deepEqual(p.toJSON().values, opened);
  document.body.append(p.el);
  const timeBtn = [...p.el.querySelectorAll(".tw-spring .tw-seg-btn")].find((b) => b.textContent.trim() === "Time");
  timeBtn.click();                                      // the time cache is the schema's pair again, not the 0.6/0.1 edit
  assert.equal(p.params.s.visualDuration, 0.4);
  assert.equal(p.params.s.bounce, 0.3);
  p.destroy();
});

test("reset() re-parses the authored color exactly, whatever mode the picker is in", () => {
  // Regression: the default was the opened form alone — the readout's rounded string
  // ("oklch(87% 0.29 142)"), which re-parses a step off the authored #00ff00.
  const p = tweaks("Cx", { c: "#00ff00" });
  document.body.append(p.el);
  const mode = p.el.querySelector(".tw-color-mode");
  mode.value = "hex"; mode.dispatchEvent(new Event("change", { bubbles: true }));
  assert.equal(p.el.querySelector(".tw-color-chan-input").value, "#00ff00"); // (params keep the last emitted string until a value changes)
  p.set("c", "#123456");
  p.reset();
  assert.equal(p.params.c, "#00ff00");                  // not #29ff0e, the re-parse of the rounded readout string
  p.destroy();
});

test("reset() restores both of a spring's caches from the schema", () => {
  const p = tweaks("Sc", { s: { type: "spring", value: { stiffness: 85, damping: 12, mass: 2, visualDuration: 0.4, bounce: 0.3 } } }); // time inferred
  document.body.append(p.el);
  const btn = (t) => [...p.el.querySelectorAll(".tw-spring .tw-seg-btn")].find((b) => b.textContent.trim() === t);
  btn("Physics").click();
  assert.deepEqual(p.params.s, { stiffness: 85, damping: 12, mass: 2 });
  btn("Time").click();
  p.set("s", { visualDuration: 0.6, bounce: 0.1 });
  p.reset();
  assert.equal(p.params.s.visualDuration, 0.4);
  btn("Physics").click();                               // the physics cache used to hold the time-derived spring after a reset
  assert.deepEqual(p.params.s, { stiffness: 85, damping: 12, mass: 2 });
  p.destroy();
});

test("a hard slider's range is its reachable grid, so its ends, keys and value agree", () => {
  const p = tweaks("Ends", { x: [5, 0, 14.6, 1], s: [5, 0, 14.6, 5], soft: { type: "slider", value: 5, min: 0, max: 14.6, step: 1, soft: true } });
  document.body.append(p.el);
  const track = (k) => p.el.querySelectorAll(".tw-slider")[k];
  assert.equal(track(0).getAttribute("aria-valuemax"), "14");
  track(0).dispatchEvent(Object.assign(new Event("keydown", { bubbles: true, cancelable: true }), { key: "End" }));
  assert.equal(p.params.x, 14);
  track(0).dispatchEvent(Object.assign(new Event("keydown", { bubbles: true, cancelable: true }), { key: "ArrowLeft" }));
  assert.equal(p.params.x, 13);                         // End landed on max (14.6, reported 14): the first ArrowLeft used to be a dead press
  track(1).dispatchEvent(Object.assign(new Event("keydown", { bubbles: true, cancelable: true }), { key: "End" }));
  assert.equal(p.params.s, 10);                         // the snap slider's last notch is 10, not a phantom 14.6 that also reported 10
  assert.equal(track(1).getAttribute("aria-valuemax"), "10");
  assert.equal(track(2).getAttribute("aria-valuemax"), "14.6"); // a soft slider keeps its authored range
  p.destroy();
});

test("a range too narrow for a grid point pins to one value", () => {
  const p = tweaks("Pin", { n: { type: "number", value: 2.7, min: 2.1, max: 2.3, step: 1 } });
  assert.equal(p.params.n, 2.1);
  p.set("n", 2.3);
  assert.equal(p.params.n, 2.1);                        // used to walk 2.3 ↔ 2.1 on every set of its own value
  const s = p.toJSON(); p.fromJSON(s);
  assert.deepEqual(p.toJSON(), s);
});

test("a restore refuses a function as a control value, and a bag bigint can't break the snapshot", () => {
  const p = tweaks("Fn2", { sel: ["a", "b"] });
  const error = console.error; let logged = ""; console.error = (m) => { logged = String(m); };
  try { p.fromJSON({ values: { sel: () => 1 } }); } finally { console.error = error; }
  assert.match(logged, /restoring "sel" failed/);
  assert.equal(p.params.sel, "a");
  p.params.big = 10n;                                   // a host-parked bag value: the persist/undo timers and toJSON used to throw
  assert.equal(p.toJSON().values.big, "10");
});

test("a hint survives a leave and a blur queued within its grace, then a re-enter", async () => {
  const p = tweaks("Hint", { h: { type: "slider", value: 1, min: 0, max: 2, hint: "a hint" } });
  document.body.append(p.el);
  const mark = p.el.querySelector(".tw-hint");
  mark.dispatchEvent(new Event("pointerenter"));
  const tip = document.querySelector(".tw-tip");
  assert.ok(tip.classList.contains("is-open"));
  mark.dispatchEvent(new Event("pointerleave"));
  mark.dispatchEvent(new Event("blur"));                // a second pending hide, which the re-enter below used to leave ticking
  mark.dispatchEvent(new Event("pointerenter"));
  await wait(120);
  assert.ok(tip.classList.contains("is-open"), "still open after the grace");
  mark.dispatchEvent(new Event("pointerleave"));
  await wait(120);
  assert.ok(!tip.classList.contains("is-open"));
  p.destroy();
});

test("the grab guide carries the panel's pinned scheme like every other portal", () => {
  const host = document.createElement("div"); host.setAttribute("data-tw-scheme", "light"); document.body.append(host);
  const p = tweaks("Guide", { n: { type: "number", value: 1 } });
  host.append(p.el);
  const grab = p.el.querySelector(".tw-num-grab");
  grab.dispatchEvent(ptr("pointerdown", { clientX: 10, clientY: 10 }));
  const guide = document.querySelector(".tw-grab-guide");
  assert.ok(guide, "the guide is up during a scrub");
  assert.equal(guide.getAttribute("data-tw-scheme"), "light");
  grab.dispatchEvent(ptr("pointerup", { buttons: 0 }));
  assert.ok(!document.querySelector(".tw-grab-guide"));
  p.destroy(); host.remove();
});

test("the hex field catches up on blur after a plane tap while it was focused", () => {
  const p = tweaks("Stale", { c: "#ff0000" });
  document.body.append(p.el);
  const mode = p.el.querySelector(".tw-color-mode");
  mode.value = "hex"; mode.dispatchEvent(new Event("change", { bubbles: true }));
  const inp = p.el.querySelector(".tw-color-chan-input");
  inp.focus();
  const hue = p.el.querySelector(".tw-wg-hue");
  hue.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 10, right: 100, bottom: 10 });
  hue.dispatchEvent(ptr("pointerdown", { clientX: 50, clientY: 5 }));
  hue.dispatchEvent(ptr("pointerup", { clientX: 50, clientY: 5, buttons: 0 }));
  assert.notEqual(p.params.c, "#ff0000");
  assert.equal(inp.value, "#ff0000");                   // refresh() skips the focused field (a typed edit must not be clobbered)
  inp.blur();
  assert.equal(inp.value, p.params.c);                  // used to stay stale until the next edit
  p.destroy();
});

test("numeric values stay on their step grid: a null bound is unbounded, an off-grid max is the last grid point under it", () => {
  const p = tweaks("Grid", {
    size: { type: "number", value: 27.44, min: 14.45, max: null, step: null }, // a JSON'd schema — null is absent
    cap: { type: "number", value: 20, min: 0, max: 14.45, step: 1 },
    half: { type: "number", value: 3, min: 0.5, step: 1 },                     // a min half a step off the readout's rounding
    rot: [0, -Math.PI, Math.PI, 0.01],                                          // a computed bound keeps the step's readout
    s: [5, 0, 14.6, 1], iv: [[2, 8], 0, 14.6, 1],
  });
  assert.equal(p.params.size, 27);      // max: null used to read as 0 and swap in as the floor, clamping to 14.45
  assert.equal(p.params.cap, 14);       // not 14.45, which the field can't show and its own set() re-rounded
  assert.equal(p.params.half, 3);       // not 4 (and 5, 6, … on every set of its own value)
  assert.ok(p.params.rot === 0);        // on the 0.01 grid, not -0.0016 (the min-anchored point) or -0
  p.set("cap", 14.45); p.set("half", 3); p.set("s", 100); p.set("iv", [0, 100]);
  assert.equal(p.params.cap, 14);
  assert.equal(p.params.half, 3);
  assert.equal(p.params.s, 14);         // the track's end reported 15, past max
  assert.deepEqual(p.params.iv, [0, 14]);
  p.set("half", 0); p.set("s", -1);
  assert.equal(p.params.half, 1);       // the first grid point at or above min, not 0.5 (which its own set() then moved to 1)
  assert.equal(p.params.s, 0);
  const s = p.toJSON(); p.fromJSON(s);
  assert.deepEqual(p.toJSON(), s);      // a round trip is a fixed point
});

test("set() refuses a function as a control value (JSON can't carry it, so every snapshot dropped the key)", () => {
  const p = tweaks("Fn", { sel: ["a", "b"], free: 1 });
  const warn = console.warn; let warned = ""; console.warn = (m) => { warned = m; };
  try { p.set("sel", () => 1); } finally { console.warn = warn; }
  assert.match(warned, /a function is not a control value/);
  assert.equal(p.params.sel, "a");
  p.params.hook = () => 2;                      // bag keys stay free
  assert.deepEqual(p.toJSON().values, { sel: "a", free: 1 });
});

test("a control holding undefined serializes as null, so undo/redo and the copy carry it", async () => {
  const p = tweaks("Undef", { sel: ["a", "b"] }, { undo: true });
  document.body.append(p.el);
  p.set("sel", null); await wait(400);          // one history step: null
  p.set("sel", undefined); await wait(400);     // the next: undefined — JSON dropped the key, so undo had no step to return to
  assert.equal(p.toJSON().values.sel, null);
  assert.ok("sel" in JSON.parse(JSON.stringify(p)).values); // the key is present, not dropped
  const cur = p.toJSON().values;
  p.undo(); p.redo();
  assert.deepEqual(p.toJSON().values, cur);     // redo used to leave the null from the earlier step behind
  p.destroy();
});

test("a click into the color picker's hex field selects the whole value", () => {
  const p = tweaks("Hex", { c: "#ff0000" });
  document.body.append(p.el);
  const mode = p.el.querySelector(".tw-color-mode");
  mode.value = "hex"; mode.dispatchEvent(new Event("change", { bubbles: true }));
  const inp = p.el.querySelector(".tw-color-chan-input");
  assert.equal(inp.value, "#ff0000");
  const mid = ptr("mouseup", { button: 1 });
  inp.dispatchEvent(ptr("pointerdown", { button: 1 }));                    // a middle click into the unfocused field: its mouseup carries the X11 paste
  inp.focus(); inp.dispatchEvent(mid);
  assert.ok(!mid.defaultPrevented, "a middle button's mouseup is left alone");
  inp.blur();
  inp.dispatchEvent(ptr("pointerdown"));                                   // a fresh click: the field isn't focused yet
  inp.focus();                                                              // the press's default action
  const up = new window.MouseEvent("mouseup", { bubbles: true, cancelable: true });
  inp.dispatchEvent(up);
  assert.equal(inp.selectionStart, 0);
  assert.equal(inp.selectionEnd, inp.value.length);
  assert.ok(up.defaultPrevented, "the click's own mouseup can't collapse the selection");
  const again = new window.MouseEvent("mouseup", { bubbles: true, cancelable: true });
  inp.dispatchEvent(ptr("pointerdown")); inp.dispatchEvent(again);         // a second click inside the focused field places the caret as usual
  assert.ok(!again.defaultPrevented);
  p.destroy();
});

test("text-field focus is quiet after a pointer press, ringed after a key press", () => {
  const p = tweaks("F", { note: "hello" });
  document.body.append(p.el);
  const input = p.el.querySelector(".tw-text");
  // mouse path: a pointer press marks the next focus quiet (no keyboard ring)
  document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  input.focus();
  assert.ok(input.classList.contains("tw-focus-quiet"));
  input.blur();
  assert.ok(!input.classList.contains("tw-focus-quiet")); // cleared on blur
  // keyboard path: any key restores the ring for the next focus
  document.dispatchEvent(new Event("keydown", { bubbles: true }));
  input.focus();
  assert.ok(!input.classList.contains("tw-focus-quiet"));
  p.destroy();
});

// ── Lifecycle and interaction regressions a stress pass turned up in panel.ts / shared.ts /
// feedback.ts: the persist flush on destroy, native text undo under the panel's own ⌘Z, the
// per-control reset target, the radio group's tab stop, reveal re-measurement, bare-key
// resolution, the onReset re-entrancy guard, and a destroy() that stays out of another
// panel's popover. ──
test("destroy() flushes a pending persist write instead of dropping the last edit", () => {
  // Regression: set() schedules a 150ms debounced save and destroy() cleared the timer,
  // so the last edit before a teardown (an SPA route change) never reached storage.
  localStorage.removeItem("tw:t-flush");
  const p = tweaks("Flush", { a: [1, 0, 10, 1] }, { persist: "t-flush" });
  p.set("a", 7);
  p.destroy();
  assert.deepEqual(JSON.parse(localStorage.getItem("tw:t-flush")), { a: 7 }, "the pending write landed on destroy");
});

test("⌘Z inside a text field is left to the field's native undo", () => {
  // Regression: the panel-level keydown preventDefaulted every ⌘Z with focus anywhere
  // inside the panel — including the text control, where it killed the field's own undo.
  const p = tweaks("Undo", { label: { type: "text", value: "hi" }, x: [1, 0, 10, 1] }, { undo: true });
  document.body.append(p.el);
  const input = p.el.querySelector(".tw-text");
  input.focus();
  assert.equal(document.activeElement, input);
  const inField = key(input, { key: "z", metaKey: true });
  assert.equal(inField.defaultPrevented, false, "the field keeps its native undo");
  const track = p.el.querySelector(".tw-slider");
  track.focus();
  const onControl = key(track, { key: "z", metaKey: true });
  assert.equal(onControl.defaultPrevented, true, "the panel still owns ⌘Z on a non-text control");
  p.destroy();
});

test("double-clicking inside the plot's expression box selects a word, not a reset", () => {
  // Regression: the per-control reset's label list lacked .tw-plot-label, so the plot's
  // reset target fell back to the whole control root — and a dblclick in the expression
  // input bubbled up to it and wiped the expression.
  const p = tweaks("Plot", { f: { type: "plot", expr: "x*x", label: "Curve" } });
  document.body.append(p.el);
  const root = p.el.querySelector(".tw-plot");
  assert.ok(root.querySelector(".tw-plot-label").classList.contains("tw-resettable"), "the label is the reset target");
  assert.ok(!root.classList.contains("tw-resettable"), "the control root is not");
  p.set("f", "sin(x)");
  root.querySelector(".tw-plot-input").dispatchEvent(new Event("dblclick", { bubbles: true, cancelable: true }));
  assert.equal(p.params.f, "sin(x)", "the expression survived the dblclick");
  root.querySelector(".tw-plot-label").dispatchEvent(new Event("dblclick", { bubbles: true, cancelable: true }));
  assert.equal(p.params.f, "x*x", "the label still resets");
  p.destroy();
});

test("a radio group whose value matches no option still has a tab stop and a keyboard start", () => {
  // Regression: setRadioActive put every button at tabIndex -1 when nothing matched, and
  // the keydown handler bailed on the missing active index — the group fell out of the
  // tab order entirely and arrow keys did nothing.
  const p = tweaks("Radio", { pick: { type: "radiogrid", options: ["a", "b", "c"], value: "zzz" } });
  document.body.append(p.el);
  const btns = [...p.el.querySelectorAll(".tw-radiogrid-btn")];
  assert.deepEqual(btns.map((b) => b.tabIndex), [0, -1, -1], "the first button is the tab stop");
  assert.deepEqual(btns.map((b) => b.getAttribute("aria-checked")), ["false", "false", "false"], "nothing reads as checked");
  key(p.el.querySelector(".tw-radiogrid-grid"), { key: "ArrowRight" });
  assert.equal(p.params.pick, "b", "arrow keys start from the first button");
  p.destroy();
});

test("a control revealed by a render condition or a cleared filter asks for a re-measure", async () => {
  // Regression: tabs dispatch tw-reflow when a page shows, but a control hidden by
  // tw-cond-hidden or the filter was revealed silently — a bezier/plot/segmented built
  // while hidden kept its zero-width measurements.
  let reflows = 0; const count = () => reflows++;
  window.addEventListener("tw-reflow", count);
  const p = tweaks("Reveal", { show: false, b: { type: "slider", value: 1, min: 0, max: 2, render: (get) => get("show") }, c: [1, 0, 10, 1] }, { filter: true });
  document.body.append(p.el);
  const hidden = p.el.querySelectorAll(".tw-slider")[0].closest(".tw-cond-hidden");
  assert.ok(hidden, "b starts hidden");
  await wait(40); reflows = 0;
  p.set("show", true);
  await wait(40);
  assert.ok(!p.el.querySelector(".tw-cond-hidden"), "b is revealed");
  assert.equal(reflows, 1, "one tw-reflow for the reveal");
  p.set("show", false); await wait(40);
  assert.equal(reflows, 1, "hiding does not reflow");

  const search = p.el.querySelector(".tw-search");
  search.value = "zzz"; search.dispatchEvent(new Event("input", { bubbles: true }));
  assert.ok(p.el.querySelectorAll(".tw-filter-hidden").length > 0, "the filter hid something");
  await wait(40); reflows = 0;
  search.value = ""; search.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(40);
  assert.equal(p.el.querySelectorAll(".tw-filter-hidden").length, 0, "the filter cleared");
  assert.equal(reflows, 1, "one tw-reflow for the cleared filter");
  window.removeEventListener("tw-reflow", count);
  p.destroy();
});

test("a global listener on a panel built before it mounted survives an event in that window", () => {
  // Regression: onLive dropped its whole listener set on the first event that found the
  // owner disconnected — including the window between tweaks() and the host's append,
  // so a resize there permanently unsubscribed the floating panel's viewport clamp.
  const p = tweaks("Live", { a: 1 }, { floating: { x: 500, y: 16 } });
  assert.equal(p.el.style.getPropertyValue("--tw-float-x"), "500px");
  window.dispatchEvent(new Event("resize"));      // fires while the panel is not yet connected
  document.body.append(p.el);
  const w = window.innerWidth;
  window.innerWidth = 100;
  try { window.dispatchEvent(new Event("resize")); } finally { window.innerWidth = w; }
  assert.equal(p.el.style.getPropertyValue("--tw-float-x"), "92px", "the clamp still listens after mount");
  p.destroy();
});

test("a bare key that names a top-level control wins over a nested namesake", () => {
  // Regression: set("x") warned "ambiguous" and did nothing when a folder also had an x —
  // but a top-level key has no dotted form, so there was no way to reach it at all.
  const p = tweaks("Bare", { x: [1, 0, 10, 1], f: { x: [2, 0, 10, 1] } });
  const warn = console.warn; let warned = ""; console.warn = (m) => { warned += m; };
  try { p.set("x", 5); } finally { console.warn = warn; }
  assert.equal(warned, "", "no ambiguity warning");
  assert.equal(p.params.x, 5);
  assert.equal(p.params.f.x, 2, "the nested one is untouched");
  p.set("f.x", 8);
  assert.equal(p.params.f.x, 8, "the dotted path still reaches the nested one");
  const q = tweaks("Bare2", { f: { x: [2, 0, 10, 1] }, g: { x: [3, 0, 10, 1] } });
  warned = ""; console.warn = (m) => { warned += m; };
  try { q.set("x", 5); } finally { console.warn = warn; }
  assert.match(warned, /ambiguous/, "two nested namesakes and no top-level one still warn");
  assert.equal(q.params.f.x, 2); assert.equal(q.params.g.x, 3);
});

test("an onReset that calls panel.reset() performs the default reset instead of recursing", () => {
  // Regression: doReset → opts.onReset → api.reset → doReset → … until the stack blew.
  let calls = 0, p;
  p = tweaks("OnReset", { a: [1, 0, 10, 1] }, { onReset: () => { calls++; p.reset(); } });
  p.set("a", 5);
  p.reset();
  assert.equal(calls, 1, "onReset ran once");
  assert.equal(p.params.a, 1, "the nested reset() restored the defaults");
  p.reset();
  assert.equal(calls, 2, "the guard lifts after the hook returns");
});

test("destroy() closes its own popover and hint, not another panel's", async () => {
  // Regression: popovers are globally single-open and destroy() closed whichever was up —
  // tearing down panel A dismissed the presets menu (or color picker) open on panel B.
  const a = tweaks("A", { a: 1, h: { type: "slider", value: 1, min: 0, max: 2, hint: "a hint" } }, { persist: "t-popover-a" });
  const b = tweaks("B", { b: 1, h: { type: "slider", value: 1, min: 0, max: 2, hint: "b hint" } }, { persist: "t-popover-b" });
  document.body.append(a.el, b.el);
  const presets = (p) => p.el.querySelector('.tw-toolbar-btn[aria-label="Presets"]');
  presets(b).click();
  assert.equal(presets(b).getAttribute("aria-expanded"), "true", "B's menu is open");
  b.el.querySelector(".tw-hint").dispatchEvent(new Event("pointerenter"));
  const tip = document.querySelector(".tw-tip");
  assert.ok(tip.classList.contains("is-open"), "B's hint is up");
  a.destroy();
  assert.equal(presets(b).getAttribute("aria-expanded"), "true", "destroying A left B's menu open");
  assert.ok(tip.classList.contains("is-open"), "and B's hint");
  b.destroy();
  assert.equal(presets(b).getAttribute("aria-expanded"), "false", "destroying B closed its own menu");
  assert.ok(!tip.classList.contains("is-open"), "and its own hint");
  await wait(220); // the portaled menu node is removed 200ms after close
});

// With no toast, a screen reader hears what a click did from one visually hidden status region instead.
test("copy and presets announce what they did to a screen reader, from one hidden status region", async () => {
  localStorage.clear();
  const p = tweaks("Heard", { blur: [24, 0, 100, 1] }, { persist: true });
  document.body.append(p.el); await p.ready;
  const said = async (act) => { act(); await new Promise((r) => setTimeout(r, 150)); return document.querySelector(".tw-sr[role=status]")?.textContent; };
  const clip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  const copy = p.el.querySelector(".tw-toolbar-btn--swap");
  try {
    Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async () => {} }, configurable: true });
    assert.equal(await said(() => copy.click()), "Values copied");
    assert.equal(await said(() => copy.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }))), "Nothing has changed");
    p.set("blur", 40);
    assert.equal(await said(() => copy.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }))), "1 changed value copied");
  } finally { if (clip) Object.defineProperty(globalThis.navigator, "clipboard", clip); else delete globalThis.navigator.clipboard; }
  p.el.querySelector('[aria-label="Presets"]').click(); await new Promise((r) => setTimeout(r, 30));
  const input = document.querySelector(".tw-presets-input"); input.value = "Warm";
  assert.equal(await said(() => document.querySelector(".tw-presets-savebtn").click()), "Saved preset Warm");
  assert.equal(await said(() => document.querySelector(".tw-presets-load").click()), "Loaded preset Warm");
  const sr = document.querySelector(".tw-sr[role=status]");
  assert.deepEqual([sr.getAttribute("role"), sr.classList.contains("tw-portal"), document.querySelectorAll(".tw-sr[role=status]").length], ["status", false, 1], "one status region for the page, not a visible surface");
  p.destroy(); localStorage.clear();
});

// panel.setName() retitles a live panel: the header follows, the storage key
// does not (a rename never moves persisted values or presets).
test("setName() moves the header, and leaves the storage key on the built-with name", async () => {
  localStorage.clear();
  const p = tweaks("Card", { blur: [24, 0, 100, 1] }, { persist: true });
  document.body.append(p.el); await p.ready;
  assert.equal(p.el.querySelector(".tw-title").textContent, "Card");
  p.setName("Lock screen");
  assert.equal(p.el.querySelector(".tw-title").textContent, "Lock screen", "the header follows");
  let copied = null;
  const clip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async (t) => { copied = t; } }, configurable: true });
  try { p.el.querySelector(".tw-toolbar-btn--swap").click(); await new Promise((r) => setTimeout(r, 0)); }
  finally { if (clip) Object.defineProperty(globalThis.navigator, "clipboard", clip); else delete globalThis.navigator.clipboard; }
  assert.ok(copied, "the copy still writes");
  assert.equal(document.querySelector(".tw-toast"), null, "and shows no toast");
  // Persisted values stay under the original key.
  p.set("blur", 40); await new Promise((r) => setTimeout(r, 200)); // past the persist debounce
  assert.equal(JSON.parse(localStorage.getItem("tw:Card")).blur, 40, "saved under the built-with name");
  assert.equal(localStorage.getItem("tw:Lock screen"), null, "nothing moved to the new name");
  p.destroy();
  p.setName("Gone");
  assert.equal(p.el.querySelector(".tw-title").textContent, "Lock screen", "inert after destroy");
  localStorage.clear();
});

test("the copy button survives a bag value JSON can't take", () => quiet(async () => {
  const p = tweaks("R7F", { x: [1, 0, 10, 1] });
  document.body.append(p.el);
  const loop = {}; loop.self = loop; p.params.loop = loop;
  const rejections = []; const onRej = (e) => rejections.push(e);
  process.on("unhandledRejection", onRej);
  try {
    p.el.querySelector(".tw-toolbar-btn--swap").click();
    await wait(30);
    assert.deepEqual(rejections.map((e) => String((e && e.message) || e)), [], "the copy click handler rejected");
  } finally { process.off("unhandledRejection", onRej); p.destroy(); }
}));

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

test("a setMany() batch isolates a key it refuses", () => {
  const p = tweaks("RFB", { x: [1, 0, 10, 1] });
  let calls = 0; p.on(() => calls++);
  const loop = {}; loop.self = loop;
  const warned = []; const warn = console.warn; console.warn = (...a) => warned.push(String(a[0]));
  try { p.setMany({ x: 5, bag: loop }); } finally { console.warn = warn; }
  assert.equal(p.params.x, 5); assert.equal(calls, 1, "the good key still notifies");
  assert.ok(warned.some((m) => m.includes('set("bag") ignored')));
  p.destroy();
});

// on() reported the bare leaf, so size, card.size and btn.size all arrived as "size" and a listener couldn't tell them apart.
test("on() names a nested control by its dotted path, from the control and from set()", () => {
  const p = tweaks("Paths", { size: [1, 0, 10, 1], card: { size: [2, 0, 10, 1] }, btn: { size: [3, 0, 10, 1] } });
  const seen = []; p.on((_, k) => seen.push(k));
  p.set("size", 4); p.set("card.size", 5); p.set("btn.size", 6); p.setMany({ "card.size": 7 });
  assert.deepEqual(seen, ["size", "card.size", "btn.size", "card.size"]);
  assert.deepEqual(Object.keys(p.changes()), ["size", "card.size", "btn.size"], "the names changes() uses");
  p.destroy();
});

// Clamping a set() into range is right, but silent it reads as the value not taking (`set("level", 99)` gave 15).
test("a set() past a hard range clamps and warns once a key; a soft slider and an in-range value don't", () => {
  const p = tweaks("Clamp", { level: [5, 0, 15, 1], free: { type: "slider", value: 5, min: 0, max: 10, soft: true }, span: [[2, 8], 0, 10] });
  const warn = console.warn, warned = []; console.warn = (...a) => warned.push(a.join(" "));
  try {
    p.set("level", 7); assert.equal(warned.length, 0);
    p.set("level", 99); assert.equal(p.params.level, 15);
    assert.equal(warned.length, 1); assert.match(warned[0], /set\("level", 99\) clamped to 0–15/);
    p.set("level", -4); assert.equal(warned.length, 1, "once a key");
    p.set("free", 40); assert.equal(p.params.free, 40); assert.equal(warned.length, 1, "soft keeps it, quietly");
    p.set("span", [-5, 8]); assert.equal(warned.length, 2);
  } finally { console.warn = warn; p.destroy(); }
});
