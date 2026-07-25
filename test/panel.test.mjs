/* Panel behaviour against the built single-file bundle (dist/tweaks.js — every
 * control registered synchronously), under jsdom. `npm test` builds dist first.
 * These pin the degrade contracts and API semantics the adversarial passes
 * established — the panel must never throw on hostile schemas, and set()/on()/
 * reset() must round-trip. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks, enhance } = await import(new URL("../dist/tweaks.js", import.meta.url));

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
  assert.equal(heard, "y");
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

test("a hostile colour string is skipped, not thrown, and the rest of a restore still lands", () => {
  // Regression, two halves: `color(constructor …)` resolved its space off Object.prototype
  // — truthy, so it slipped past the unknown-space guard and reached the conversion maths
  // as a non-space, throwing a TypeError out of set(); and applySnapshot ran its entries
  // unguarded, so that one throw abandoned every later value AND the notify with it.
  const p = tweaks("CX", { a: [1, 0, 10, 1], c: { type: "color", value: "#ff0000" }, z: [1, 0, 10, 1] });
  p.set("c", "color(constructor 1 0 0)");       // must not throw…
  p.set("c", "color(__proto__ 1 0 0)");         // …nor this: an unknown color() space
  const neutral = p.params.c;                   // degrades to the picker's neutral default, like any other unsupported space
  assert.match(String(neutral), /^oklch\(/, "an unrecognised space degrades to a real colour");

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
  // Regression: the copy keyed every control by its LABEL, so two same-labelled hosts
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
  assert.equal(lastKey, "c");      // _last reflects the final applied key
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
  const k = (2 * Math.PI / 0.5) ** 2;                       // perceptual mapping
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

// Synthetic pointer event — jsdom has no PointerEvent constructor, and the drag paths
// only read pointerId / button / buttons / clientX / clientY off it.
const ptr = (type, props) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), { pointerId: 1, button: 0, buttons: 1, pointerType: "mouse", ...props });

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
