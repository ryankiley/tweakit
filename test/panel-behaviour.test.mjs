/* Panel behaviour regressions — the lifecycle and interaction edges a stress pass
 * turned up in panel.ts / shared.ts / feedback.ts: the persist flush on destroy,
 * native text undo under the panel's own ⌘Z, the per-control reset target, the
 * radio group's tab stop, reveal re-measurement, bare-key resolution, the onReset
 * re-entrancy guard, and a destroy() that stays out of another panel's popover.
 * Runs against the built single-file bundle under jsdom, like panel.test.mjs. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (target, props) => { const e = new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...props }); target.dispatchEvent(e); return e; };

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
  assert.equal(p.el.style.left, "500px");
  window.dispatchEvent(new Event("resize"));      // fires while the panel is not yet connected
  document.body.append(p.el);
  const w = window.innerWidth;
  window.innerWidth = 100;
  try { window.dispatchEvent(new Event("resize")); } finally { window.innerWidth = w; }
  assert.equal(p.el.style.left, "92px", "the clamp still listens after mount");
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
  // tearing down panel A dismissed the presets menu (or colour picker) open on panel B.
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
