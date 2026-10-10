/* Keyboard access — the paths a keyboard-only user takes through the heavier
 * controls: focus moving into a popover on open and the popover closing when focus
 * leaves, arrow keys on the bezier handles and the point pad, Enter opening the
 * slider's inline editor, arrow stepping on every numeric field, the Alt+Backspace
 * per-control reset, and focus-selects on a gradient stop. Runs against the built
 * single-file bundle under jsdom, like panel.test.mjs. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (target, props) => { const e = new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...props }); target.dispatchEvent(e); return e; };
const mount = (schema, opts) => { const p = tweaks("K", schema, opts); document.body.append(p.el); return p; };

test("opening the colour popover moves focus inside it, and Tab-out closes it", async () => {
  const p = mount({ tint: "#7c5cff" });
  const outside = document.createElement("button"); document.body.append(outside);
  const trigger = p.el.querySelector(".tw-color .tw-trigger");
  trigger.focus();
  trigger.click(); // Enter on a focused button is a click — jsdom has no key activation, so the test fires the click the key would
  await wait(40); // past the open rAF (16ms here), where the pop renders at real size and takes focus
  const pop = document.body.querySelector(".tw-color-pop.is-open");
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

test("Escape closes the colour popover and returns focus to the trigger", async () => {
  const p = mount({ tint: "#7c5cff" });
  const trigger = p.el.querySelector(".tw-color .tw-trigger");
  trigger.focus(); trigger.click();
  await wait(40);
  const pop = document.body.querySelector(".tw-color-pop.is-open");
  assert.ok(pop.contains(document.activeElement));
  key(document.activeElement, { key: "Escape" });
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, trigger);
  await wait(220); p.destroy();
});

test("bezier handles: arrows nudge by 0.01, Shift by 0.1, Home resets, Escape blurs", () => {
  const p = mount({ curve: { type: "cubicbezier", value: [0.25, 0.1, 0.25, 1] } });
  const [h1] = p.el.querySelectorAll(".tw-bezier-handle");
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
  assert.equal(p.el.querySelector(".tw-bezier-fields .tw-num").value, "0.36", "the X1 field follows the handle");
  key(h1, { key: "Home" });
  assert.deepEqual(p.params.curve, [0.25, 0.1, 0.25, 1], "Home restores the schema default");
  key(h1, { key: "Escape" });
  assert.notEqual(document.activeElement, h1, "Escape blurs the handle");
  p.destroy();
});

test("point pad: focusable group, arrows move one step on the matching axis, Shift x10, Home resets", () => {
  const p = mount({ pos: { type: "point", components: [{ key: "x", value: 0 }, { key: "y", value: 0 }] } });
  const pad = p.el.querySelector(".tw-pad");
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
  p.destroy();
});

test("slider: Enter on the focused track opens the inline editor, Escape cancels it", () => {
  const p = mount({ a: [3, 0, 100, 1] });
  const track = p.el.querySelector(".tw-slider");
  track.focus();
  key(track, { key: "Enter" });
  const input = p.el.querySelector(".tw-slider-input");
  assert.ok(input, "the inline input is up");
  assert.equal(document.activeElement, input, "and focused");
  assert.equal(input.value, "3");
  key(input, { key: "Escape" });
  assert.equal(p.el.querySelector(".tw-slider-input"), null, "Escape removed it");
  assert.ok(p.el.querySelector(".tw-slider-value"), "the readout is back");
  assert.equal(p.params.a, 3, "and nothing changed");
  assert.equal(document.activeElement, track, "focus returns to the track");
  track.focus();
  key(track, { key: "Enter" });
  const input2 = p.el.querySelector(".tw-slider-input");
  input2.value = "42";
  key(input2, { key: "ArrowUp" });
  assert.equal(p.params.a, 3, "an arrow typed into the editor does not step the track underneath");
  key(input2, { key: "Enter" });
  assert.equal(p.params.a, 42, "Enter commits the typed value");
  assert.equal(p.el.querySelector(".tw-slider-input"), null, "and closes the editor (the track's own Enter must not reopen it)");
  assert.equal(document.activeElement, track);
  p.destroy();
});

test("number fields step with ArrowUp/ArrowDown (Shift x10)", () => {
  const p = mount({ n: { type: "number", value: 1, step: 0.5 } });
  const inp = p.el.querySelector(".tw-num");
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
  const track = p.el.querySelector(".tw-slider");
  track.focus();
  key(track, { key: "Backspace" });
  assert.equal(p.params.a, 7, "plain Backspace is not a reset");
  const e = key(track, { key: "Backspace", altKey: true });
  assert.equal(e.defaultPrevented, true);
  assert.equal(p.params.a, 1, "Alt+Backspace reset the slider to its schema default");
  p.set("a", 5);
  key(track, { key: "Delete", altKey: true });
  assert.equal(p.params.a, 1, "Alt+Delete too");
  const text = p.el.querySelector(".tw-text");
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
  const stops = p.el.querySelectorAll(".tw-gradient-stop");
  assert.equal(stops.length, 3);
  assert.equal(stops[0].dataset.sel, "true", "the first stop starts selected");
  assert.match(stops[1].getAttribute("aria-label"), /50%/, "the label names the stop's position");
  assert.doesNotMatch(stops[1].getAttribute("aria-label"), /selected/i);
  stops[1].focus();
  assert.equal(stops[1].dataset.sel, "true", "focus selected the stop");
  assert.equal(stops[0].dataset.sel, "false");
  assert.match(stops[1].getAttribute("aria-label"), /selected/i, "and the label says so");
  // Delete now removes the focused stop (it acts on the selected one).
  const pop = p.el.querySelector(".tw-gradient .tw-color-pop");
  key(stops[1], { key: "Delete" });
  assert.equal(p.params.ramp.stops.length, 2, "Delete removed the focused stop");
  assert.deepEqual(p.params.ramp.stops.map((s) => s.pos), [0, 1]);
  void pop;
  p.destroy();
});

// The colour control emits in the picker's edit mode (OKLCH unless the schema says
// otherwise): read L / C / H back out of the string, L as a fraction whether it was
// written as one or as a percentage.
const oklch = (s) => { const m = String(s).match(/^oklch\(([\d.]+)(%?) ([\d.]+) ([\d.]+)/); assert.ok(m, `an oklch() string, got ${s}`); return [m[2] ? +m[1] / 100 : +m[1], +m[3], +m[4]]; };
const openPicker = async (p) => { const trigger = p.el.querySelector(".tw-color .tw-trigger"); trigger.focus(); trigger.click(); await wait(40); const pop = document.body.querySelector(".tw-color-pop.is-open"); assert.ok(pop, "the popover is open"); return pop; };
const closePicker = async (p) => { key(document.activeElement, { key: "Escape" }); await wait(220); p.destroy(); };

test("colour hue strip: a focusable slider — arrows step 1°, Shift x10, Home/End snap to the ends", async () => {
  const p = mount({ tint: { type: "color", value: "oklch(0.6 0.2 120)" } });
  const pop = await openPicker(p);
  const hue = pop.querySelector(".tw-wg-hue");
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
  assert.equal(hue.getAttribute("aria-valuenow"), "0");
  await closePicker(p);
});

test("colour plane: a focusable group — up/down step lightness by 0.01, left/right step chroma by 1% of the row's ceiling, Shift x10", async () => {
  const p = mount({ tint: { type: "color", value: "oklch(0.5 0.2 200)" } });
  const pop = await openPicker(p);
  const plane = pop.querySelector(".tw-wg-area");
  assert.equal(plane.tabIndex, 0, "the plane is a tab stop");
  assert.equal(plane.getAttribute("role"), "group");
  assert.ok(plane.getAttribute("aria-label"), "the plane is named");
  assert.equal(plane.getAttribute("aria-description"), "lightness 50%, chroma 0.2", "the live readout");
  plane.focus();
  const e = key(plane, { key: "ArrowUp" });
  assert.equal(e.defaultPrevented, true, "the plane owns its arrow keys");
  assert.equal(oklch(p.params.tint)[0], 0.51);
  assert.equal(oklch(p.params.tint)[1], 0.2, "a vertical step keeps the thumb's x — under jsdom the row ceiling is the 0.4 fallback on every row, so chroma itself is unchanged");
  key(plane, { key: "ArrowDown", shiftKey: true });
  assert.equal(oklch(p.params.tint)[0], 0.41);
  key(plane, { key: "ArrowRight" });
  assert.equal(plane.getAttribute("aria-description"), "lightness 41%, chroma 0.204", "one step is 1% of the row's ceiling (0.4 under jsdom)");
  key(plane, { key: "ArrowRight", shiftKey: true });
  assert.equal(oklch(p.params.tint)[1], 0.24);
  key(plane, { key: "ArrowLeft", shiftKey: true }); key(plane, { key: "ArrowLeft", shiftKey: true });
  assert.equal(oklch(p.params.tint)[1], 0.16);
  await closePicker(p);
});
