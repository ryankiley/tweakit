/* Keyboard access — the paths a keyboard-only user takes through the heavier
 * controls: focus moving into a popover on open and the popover closing when focus
 * leaves, arrow keys on the bezier handles and the point pad, Enter opening the
 * slider's inline editor, arrow stepping on every numeric field, the Alt+Backspace
 * per-control reset, and focus-selects on a gradient stop. Runs against the built
 * single-file bundle under jsdom, like panel.test.mjs. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, wait, key } from "./_helpers.mjs";

const { tweaks, mountControl } = await loadSingle();
const mount = (schema, opts) => { const p = tweaks("K", schema, opts); document.body.append(p.el); return p; };
// Focus the color row's trigger and click it, as Enter would, then wait past the open rAF.
const openPicker = async (p) => { const trigger = p.el.querySelector(".twk-color .twk-trigger"); trigger.focus(); trigger.click(); await wait(40); const pop = document.body.querySelector(".twk-color-pop.is-open"); assert.ok(pop, "the popover is open"); return pop; };

test("opening the color popover moves focus inside it, and Tab-out closes it", async () => {
  const p = mount({ tint: "#7c5cff" });
  const outside = document.createElement("button"); document.body.append(outside);
  const trigger = p.el.querySelector(".twk-color .twk-trigger");
  trigger.focus();
  // Enter on a focused button is a click — jsdom has no key activation, so the test fires the click the key would
  trigger.click();
  await wait(40); // past the open rAF (16ms here), where the pop renders at real size and takes focus
  const pop = document.body.querySelector(".twk-color-pop.is-open");
  assert.ok(pop, "the popover is open");
  assert.notEqual(document.activeElement, trigger, "focus left the trigger");
  assert.ok(pop.contains(document.activeElement), "focus moved into the popover");
  key(document.activeElement, { key: "Tab" }); // the modality note: the next focus move is a keyboard one
  outside.focus(); // what Tab does once it runs out of focusables in the pop
  await wait(10);
  assert.equal(trigger.getAttribute("aria-expanded"), "false", "focus leaving the pop and its trigger closed it");
  assert.equal(document.activeElement, trigger, "a keyboard move out of the panel comes back to the trigger (the pop's place in the tab order), not the top of the page");
  await wait(220); // the portaled node is removed 200ms after close
  outside.remove(); p.destroy();
});

test("Escape closes the color popover and returns focus to the trigger", async () => {
  const p = mount({ tint: "#7c5cff" });
  const trigger = p.el.querySelector(".twk-color .twk-trigger"), pop = await openPicker(p);
  assert.ok(pop.contains(document.activeElement));
  key(document.activeElement, { key: "Escape" });
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, trigger);
  await wait(220); p.destroy();
});

test("bezier handles: arrows nudge by 0.01, Shift by 0.1, Home resets, Escape blurs", () => {
  const p = mount({ curve: { type: "cubicbezier", value: [0.25, 0.1, 0.25, 1] } });
  const [h1] = p.el.querySelectorAll(".twk-bezier-handle");
  h1.focus();
  const e = key(h1, { key: "ArrowRight" });
  assert.equal(e.defaultPrevented, true, "the handle owns its arrow keys");
  assert.equal(p.params.curve[0], 0.26);
  key(h1, { key: "ArrowRight", shiftKey: true });
  assert.equal(p.params.curve[0], 0.36);
  key(h1, { key: "ArrowUp" });
  assert.equal(p.params.curve[1], 0.11);
  key(h1, { key: "ArrowDown", shiftKey: true });
  assert.equal(p.params.curve[1], 0.01);
  assert.equal(p.el.querySelector(".twk-bezier-fields .twk-num").value, "0.36", "the X1 field follows the handle");
  key(h1, { key: "Home" });
  assert.deepEqual(p.params.curve, [0.25, 0.1, 0.25, 1], "Home restores the schema default");
  key(h1, { key: "Escape" });
  assert.notEqual(document.activeElement, h1, "Escape blurs the handle");
  p.destroy();
});

test("point pad: focusable group, arrows move one step on the matching axis, Shift x10, Home resets, and a run of keys is spoken", async () => {
  const p = mount({ pos: { type: "point", components: [{ key: "x", value: 0 }, { key: "y", value: 0 }] } });
  const pad = p.el.querySelector(".twk-pad");
  assert.equal(pad.tabIndex, 0, "the pad is a tab stop");
  assert.equal(pad.getAttribute("role"), "group");
  assert.ok(pad.getAttribute("aria-label"), "the pad is named");
  pad.focus();
  key(pad, { key: "ArrowUp" });
  assert.equal(p.params.pos.y, 0.01, "one step on the y axis (the derived pad step over ±1 is 0.01)");
  assert.equal(p.params.pos.x, 0, "x untouched");
  key(pad, { key: "ArrowRight", shiftKey: true });
  assert.equal(p.params.pos.x, 0.1, "Shift is ten steps");
  key(pad, { key: "ArrowLeft" });
  assert.equal(p.params.pos.x, 0.09);
  key(pad, { key: "Home" });
  assert.deepEqual(p.params.pos, { x: 0, y: 0 }, "Home restores the schema default");
  // spoken 250ms after the last key, written 100ms after that: aria-description is read on focus and never again
  await wait(400);
  assert.equal(document.querySelector(".twk-sr").textContent, pad.getAttribute("aria-description"), "a run of keys ends with the pad's readout spoken");
  p.destroy();
});

test("slider: Enter on the focused track opens the inline editor, Escape cancels it", () => {
  const p = mount({ a: [3, 0, 100, 1] });
  const track = p.el.querySelector(".twk-slider");
  track.focus();
  key(track, { key: "Enter" });
  const input = p.el.querySelector(".twk-slider-input");
  assert.ok(input, "the inline input is up");
  assert.equal(document.activeElement, input, "and focused");
  assert.equal(input.value, "3");
  key(input, { key: "Escape" });
  assert.equal(p.el.querySelector(".twk-slider-input"), null, "Escape removed it");
  assert.ok(p.el.querySelector(".twk-slider-value"), "the readout is back");
  assert.equal(p.params.a, 3, "and nothing changed");
  assert.equal(document.activeElement, track, "focus returns to the track");
  track.focus();
  key(track, { key: "Enter" });
  const input2 = p.el.querySelector(".twk-slider-input");
  input2.value = "42";
  key(input2, { key: "ArrowUp" });
  assert.equal(p.params.a, 3, "an arrow typed into the editor does not step the track underneath");
  key(input2, { key: "Enter" });
  assert.equal(p.params.a, 42, "Enter commits the typed value");
  assert.equal(p.el.querySelector(".twk-slider-input"), null, "and closes the editor (the track's own Enter must not reopen it)");
  assert.equal(document.activeElement, track);
  p.destroy();
});

test("number fields step with ArrowUp/ArrowDown (Shift x10)", () => {
  const p = mount({ n: { type: "number", value: 1, step: 0.5 } });
  const inp = p.el.querySelector(".twk-num");
  inp.focus();
  const e = key(inp, { key: "ArrowUp" });
  assert.equal(e.defaultPrevented, true, "the field owns the arrow (no caret jump)");
  assert.equal(p.params.n, 1.5);
  assert.equal(inp.value, "1.5");
  key(inp, { key: "ArrowDown", shiftKey: true });
  assert.equal(p.params.n, -3.5);
  p.destroy();
});

test("Alt+Backspace / Alt+Delete with focus inside a control resets it; plain Backspace does not", () => {
  const p = mount({ a: [1, 0, 10, 1], name: { type: "text", value: "hi" } });
  p.set("a", 7);
  const track = p.el.querySelector(".twk-slider");
  track.focus();
  key(track, { key: "Backspace" });
  assert.equal(p.params.a, 7, "plain Backspace is not a reset");
  const e = key(track, { key: "Backspace", altKey: true });
  assert.equal(e.defaultPrevented, true);
  assert.equal(p.params.a, 1, "Alt+Backspace reset the slider to its schema default");
  p.set("a", 5);
  key(track, { key: "Delete", altKey: true });
  assert.equal(p.params.a, 1, "Alt+Delete too");
  const text = p.el.querySelector(".twk-text");
  text.focus(); text.value = "hello"; text.dispatchEvent(new window.Event("input", { bubbles: true })); text.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(p.params.name, "hello");
  key(text, { key: "Backspace" });
  assert.equal(p.params.name, "hello", "plain Backspace in a text field is left to the field");
  key(text, { key: "Backspace", altKey: true });
  assert.equal(p.params.name, "hi", "Alt+Backspace resets the text control too");
  p.destroy();
});

test("gradient: focusing a stop selects it, and its label carries position + selection", async () => {
  const p = mount({ ramp: { type: "gradient", value: { stops: [{ color: "#ff0000", pos: 0 }, { color: "#00ff00", pos: 0.5 }, { color: "#0000ff", pos: 1 }] } } });
  const stops = p.el.querySelectorAll(".twk-gradient-stop");
  assert.equal(stops.length, 3);
  assert.equal(stops[0].dataset.sel, "true", "the first stop starts selected");
  assert.match(stops[1].getAttribute("aria-label"), /50%/, "the label names the stop's position");
  assert.doesNotMatch(stops[1].getAttribute("aria-label"), /selected/i);
  stops[1].focus();
  assert.equal(stops[1].dataset.sel, "true", "focus selected the stop");
  assert.equal(stops[0].dataset.sel, "false");
  assert.match(stops[1].getAttribute("aria-label"), /selected/i, "and the label says so");
  // Delete now removes the focused stop (it acts on the selected one).
  key(stops[1], { key: "Delete" });
  assert.equal(p.params.ramp.stops.length, 2, "Delete removed the focused stop");
  assert.deepEqual(p.params.ramp.stops.map((s) => s.pos), [0, 1]);
  p.destroy();
});

// The color control emits in the picker's edit mode (OKLCH unless the schema says
// otherwise): read L / C / H back out of the string, L as a fraction whether it was
// written as one or as a percentage.
const oklch = (s) => { const m = String(s).match(/^oklch\(([\d.]+)(%?) ([\d.]+) ([\d.]+)/); assert.ok(m, `an oklch() string, got ${s}`); return [m[2] ? +m[1] / 100 : +m[1], +m[3], +m[4]]; };
const closePicker = async (p) => { key(document.activeElement, { key: "Escape" }); await wait(220); p.destroy(); };

test("color hue strip: a focusable slider — arrows step 1°, Shift x10, Home/End snap to the ends", async () => {
  const p = mount({ tint: { type: "color", value: "oklch(0.6 0.2 120)" } });
  const pop = await openPicker(p);
  const hue = pop.querySelector(".twk-wg-hue");
  assert.equal(hue.tabIndex, 0, "the strip is a tab stop");
  assert.equal(hue.getAttribute("role"), "slider");
  assert.equal(hue.getAttribute("aria-valuenow"), "120");
  hue.focus();
  const e = key(hue, { key: "ArrowRight" });
  assert.equal(e.defaultPrevented, true, "the strip owns its arrow keys");
  assert.equal(oklch(p.params.tint)[2], 121);
  key(hue, { key: "ArrowLeft", shiftKey: true });
  assert.equal(oklch(p.params.tint)[2], 111);
  assert.equal(hue.getAttribute("aria-valuenow"), "111", "the slider value follows");
  assert.equal(hue.getAttribute("aria-valuetext"), "111°");
  key(hue, { key: "Home" });
  assert.equal(oklch(p.params.tint)[2], 0);
  key(hue, { key: "End" });
  assert.equal(oklch(p.params.tint)[2], 0, "End is 360°, which reads back as 0 — the same hue");
  assert.equal(hue.getAttribute("aria-valuenow"), "360", "but the slider announces the top of its range, not its bottom");
  assert.equal(hue.getAttribute("aria-valuetext"), "360°");
  await closePicker(p);
});

test("a closed color popover is inert — its plane is not in the tab order before it opens or after it closes", async () => {
  const p = mount({ tint: "#7c5cff" });
  const pop = p.el.querySelector(".twk-color-pop");
  assert.equal(pop.inert, true, "never opened: inert");
  const trigger = p.el.querySelector(".twk-color .twk-trigger");
  trigger.focus(); trigger.click();
  await wait(40);
  assert.equal(pop.inert, false, "open: live");
  assert.equal(document.activeElement, pop.querySelector(".twk-wg-area"), "a keyboard open lands on the plane, the first thing in the pop");
  key(document.activeElement, { key: "Escape" });
  assert.equal(pop.inert, true, "closed: inert again through the fade-out");
  await wait(220); p.destroy();
});

test("a host mirroring values back through set() keeps the picker open while the plane is focused", async () => {
  const p = mount({ tint: { type: "color", value: "oklch(0.5 0.2 200)" } });
  p.on((v, last) => p.set(last, v[last])); // the echo a two-way binding makes on every change
  const pop = await openPicker(p);
  const plane = pop.querySelector(".twk-wg-area"), trigger = p.el.querySelector(".twk-color .twk-trigger");
  plane.focus();
  key(plane, { key: "ArrowUp" });
  assert.equal(oklch(p.params.tint)[0], 0.51, "the step landed");
  assert.equal(trigger.getAttribute("aria-expanded"), "true", "the echo's set() did not close the popover");
  assert.equal(document.activeElement, plane, "and focus stayed on the plane");
  await closePicker(p);
});

test("color plane: a focusable group — up/down step lightness by 0.01, left/right step chroma by 1% of the row's ceiling, Shift x10", async () => {
  const p = mount({ tint: { type: "color", value: "oklch(0.5 0.2 200)" } });
  const pop = await openPicker(p);
  const plane = pop.querySelector(".twk-wg-area");
  assert.equal(plane.tabIndex, 0, "the plane is a tab stop");
  assert.equal(plane.getAttribute("role"), "group");
  assert.ok(plane.getAttribute("aria-label"), "the plane is named");
  assert.equal(plane.getAttribute("aria-description"), "lightness 50%, chroma 0.2", "the live readout");
  plane.focus();
  const thumb = pop.querySelector(".twk-wg-thumb"), x0 = thumb.style.left;
  const e = key(plane, { key: "ArrowUp" });
  assert.equal(e.defaultPrevented, true, "the plane owns its arrow keys");
  assert.equal(oklch(p.params.tint)[0], 0.51);
  assert.equal(thumb.style.left, x0, "a vertical step keeps the thumb's x: chroma re-fits the new row's ceiling (under jsdom every row's ceiling is the 0.4 fallback, so chroma itself reads unchanged)");
  assert.equal(oklch(p.params.tint)[1], 0.2);
  key(plane, { key: "ArrowDown", shiftKey: true });
  assert.equal(oklch(p.params.tint)[0], 0.41);
  key(plane, { key: "PageUp" });
  assert.equal(oklch(p.params.tint)[0], 0.51, "PageUp is ten lightness steps");
  key(plane, { key: "PageDown" });
  assert.equal(oklch(p.params.tint)[0], 0.41);
  const home = key(plane, { key: "Home" });
  assert.equal(home.defaultPrevented, true, "Home/End are swallowed, not left to scroll the page");
  assert.equal(oklch(p.params.tint)[0], 0.41, "and change nothing");
  key(plane, { key: "ArrowRight" });
  assert.equal(plane.getAttribute("aria-description"), "lightness 41%, chroma 0.204", "one step is 1% of the row's ceiling (0.4 under jsdom)");
  key(plane, { key: "ArrowRight", shiftKey: true });
  assert.equal(oklch(p.params.tint)[1], 0.244); // the param keeps a digit past the readout
  key(plane, { key: "ArrowLeft", shiftKey: true }); key(plane, { key: "ArrowLeft", shiftKey: true });
  assert.equal(oklch(p.params.tint)[1], 0.164);
  await closePicker(p);
});

test("color plane: a run of arrow keys ends with the plane's readout spoken", async () => {
  const p = mount({ tint: "#7c5cff" });
  const trigger = p.el.querySelector(".twk-color .twk-trigger");
  trigger.focus(); trigger.click();
  await wait(40);
  const area = document.body.querySelector(".twk-wg-area");
  assert.ok(area, "the plane is up");
  area.focus();
  key(area, { key: "ArrowUp" }); key(area, { key: "ArrowUp" });
  await wait(400); // spoken 250ms after the last key, written 100ms after that
  const said = document.querySelector(".twk-sr").textContent;
  assert.equal(said, area.getAttribute("aria-description"), "the readout the description carries");
  assert.match(said, /^lightness \d+%, chroma /);
  key(area, { key: "Escape" });
  await wait(220); p.destroy();
});

test("number fields read typed text strictly: trailing text or a thousands comma leaves the value alone; the unit may be typed", () => {
  const p = mount({ n: { type: "number", value: 1, step: 0.5 }, w: { type: "number", value: 24, unit: "px" } });
  const [n, w] = p.el.querySelectorAll(".twk-num");
  const type = (inp, text) => { inp.value = text; inp.dispatchEvent(new window.Event("change", { bubbles: true })); };
  type(n, "12abc");
  assert.equal(p.params.n, 1, "trailing text is not a number (parseFloat would read 12)");
  assert.equal(n.value, "1.0", "the field shows the kept value again");
  type(n, "1,000");
  assert.equal(p.params.n, 1, "a thousands comma is not a number (parseFloat would read 1)");
  type(n, "2.5");
  assert.equal(p.params.n, 2.5, "a number commits");
  n.value = "4x"; key(n, { key: "ArrowUp" });
  assert.equal(p.params.n, 3, "an arrow over unreadable text steps from the current value");
  type(w, "32px");
  assert.equal(p.params.w, 32, "the field's own unit may be typed with the number");
  type(w, "32 px");
  assert.equal(p.params.w, 32);
  p.destroy();
});

test("a number field fires no change for rejected text or for the value it already holds", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const seen = [];
  const h = mountControl(host, { type: "number", value: 3 }, { onChange: (v) => seen.push(v) });
  await h.ready;
  const f = host.querySelector(".twk-num");
  const type = (text) => { f.value = text; f.dispatchEvent(new window.Event("change", { bubbles: true })); };
  type("abc");
  assert.deepEqual(seen, [], "rejected text fires nothing");
  assert.equal(f.value, "3", "and the field shows the kept value");
  type("3");
  assert.deepEqual(seen, [], "the value it already holds fires nothing");
  type("3.2");
  assert.deepEqual(seen, [], "a number that rounds to the held value fires nothing");
  assert.equal(f.value, "3", "but the field is tidied");
  type("4");
  assert.deepEqual(seen, [4], "a new value fires once");
  h.destroy(); host.remove();
});

test("Alt+arrows on the focused title move the panel, the keyboard's drag: 10px a step, 50px with Shift, clamped to the viewport", () => {
  const p = mount({ a: [1, 0, 10, 1] });
  const title = p.el.querySelector(".twk-header-toggle");
  const x = () => parseFloat(p.el.style.getPropertyValue("--twk-float-x")), y = () => parseFloat(p.el.style.getPropertyValue("--twk-float-y"));
  title.focus();
  key(title, { key: "ArrowRight" });
  assert.equal(p.el.dataset.mode, "inline", "a bare arrow is not a move");
  const e = key(title, { key: "ArrowRight", altKey: true });
  assert.equal(e.defaultPrevented, true, "the title owns Alt+arrow");
  assert.equal(p.el.dataset.mode, "floating", "the panel lifted into the floating layer, as a first drag does");
  assert.equal(document.activeElement, title, "and the title kept focus through the lift (moving it to <body> would drop it), so the next step lands");
  const x1 = x();
  key(title, { key: "ArrowRight", altKey: true });
  assert.equal(x(), x1 + 10, "one step is 10px");
  key(title, { key: "ArrowDown", altKey: true, shiftKey: true });
  const y1 = y();
  key(title, { key: "ArrowDown", altKey: true, shiftKey: true });
  assert.equal(y(), y1 + 50, "Shift is 50px");
  for (let i = 0; i < 40; i++) key(title, { key: "ArrowUp", altKey: true, shiftKey: true });
  assert.equal(y(), 8, "the move clamps at the viewport margin, as the drag does");
  p.destroy();
});

test("the panel is a labeled region, renamed by setName", () => {
  const p = mount({ a: 1 });
  assert.equal(p.el.getAttribute("role"), "region");
  assert.equal(p.el.getAttribute("aria-label"), "K");
  p.setName("Lights");
  assert.equal(p.el.getAttribute("aria-label"), "Lights");
  p.setName("   ");
  assert.equal(p.el.getAttribute("aria-label"), "Tweaks", "a blank name falls back, since an unnamed region is no landmark");
  p.destroy();
  const blank = tweaks("", { a: 1 });
  assert.equal(blank.el.getAttribute("aria-label"), "Tweaks");
  blank.destroy();
});

// The Off/On toggle read as two radio buttons ("radio button, On, 2 of 2"); a toggle is a switch.
test("a boolean toggle is one switch: role, aria-checked, one tab stop, Space and Enter flip it", () => {
  const p = mount({ on: true });
  const sw = p.el.querySelector('.twk-seg[role="switch"]');
  assert.ok(sw, "the row is a switch");
  assert.equal(sw.getAttribute("aria-checked"), "true"); assert.equal(sw.getAttribute("aria-label"), "On");
  assert.equal(sw.tabIndex, 0);
  assert.ok([...sw.querySelectorAll("button")].every((b) => b.tabIndex === -1 && b.getAttribute("aria-hidden") === "true"), "its segments are the pointer's, not tab stops");
  key(sw, { key: " " }); assert.equal(p.params.on, false); assert.equal(sw.getAttribute("aria-checked"), "false");
  key(sw, { key: "Enter" }); assert.equal(p.params.on, true);
  key(sw, { key: "ArrowRight" }); assert.equal(p.params.on, true, "→ on On stays On, it doesn't wrap");
  key(sw, { key: "ArrowLeft" }); key(sw, { key: "ArrowLeft" }); assert.equal(p.params.on, false, "← goes to Off and stays");
  key(sw, { key: "End" }); assert.equal(p.params.on, true);
  sw.querySelector("button").focus(); assert.equal(document.activeElement, sw, "a segment that takes focus hands it to the switch");
  sw.querySelector("button").click(); assert.equal(p.params.on, false, "a click on Off still sets it");
  assert.ok([...sw.querySelectorAll("button")].every((b) => b.tabIndex === -1), "and leaves no tab stop behind");
  p.destroy();
});
