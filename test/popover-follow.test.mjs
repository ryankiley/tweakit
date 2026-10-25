/* A popover rides with its row while the page scrolls: it keeps the offset place() chose
 * on open (no re-flip, no re-clamp, so it never drifts off its row as the row nears a
 * viewport edge), and closes once the row has scrolled out of view. A resize re-places.
 * jsdom lays out nothing, so the trigger's rect is stubbed and the pop sizes from its fallbacks. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, wait, ptr } from "./_helpers.mjs";

const { tweaks } = await loadSingle();
const rect = (top, left = 50, w = 200, h = 32) => ({ top, left, width: w, height: h, bottom: top + h, right: left + w, x: left, y: top, toJSON() {} });

test("a scroll carries the popover with its row; the row leaving the viewport closes it", async () => {
  const p = tweaks("F", { tint: "#ff0000" }); document.body.append(p.el); await p.ready;
  const root = p.el.querySelector(".tw-color"), trigger = root.querySelector(".tw-trigger");
  let r = rect(100); trigger.getBoundingClientRect = () => r;
  trigger.click(); await wait(60);
  const pop = document.body.querySelector(".tw-color-pop.is-open"); assert.ok(pop, "open");
  assert.equal(pop.style.top, "138px", "placed under the row: bottom 132 + gap 6"); assert.equal(pop.style.left, "50px");
  r = rect(60); window.dispatchEvent(new window.Event("scroll")); // the page scrolled 40px
  assert.equal(pop.style.top, "98px", "moved with the row by exactly the scroll");
  r = rect(2); window.dispatchEvent(new window.Event("scroll")); // the row is at the very top; the pop would once have re-clamped itself to the top edge and drifted off the row
  assert.equal(pop.style.top, "40px", "still glued, even though a fresh placement would have moved it");
  r = rect(-20); window.dispatchEvent(new window.Event("scroll")); // row partly out (bottom 12): still attached
  assert.ok(root.classList.contains("is-open"), "a row still partly in view keeps its pop");
  r = rect(400); window.dispatchEvent(new window.Event("resize")); // a resize re-places from scratch: 340 + 12 no longer fits below (768 - 432), so it flips above
  assert.equal(pop.style.top, "54px", "resize re-placed, above the row: 400 - 340 - 6");
  r = rect(-100); window.dispatchEvent(new window.Event("scroll")); // bottom -68: gone
  assert.ok(!root.classList.contains("is-open"), "the row scrolled out of view closes its pop");
  await wait(230); assert.ok(!pop.isConnected, "and the node is removed after the fade");
  p.destroy();
});

test("a row scrolled out of a floating panel closes its pop, though it's still in the viewport", async () => {
  const p = tweaks("FS", { tint: "#0000ff" }, { floating: { x: 16, y: 16 } }); document.body.append(p.el); await p.ready;
  const root = p.el.querySelector(".tw-color"), trigger = root.querySelector(".tw-trigger");
  p.el.getBoundingClientRect = () => rect(60, 16, 236, 300); // the scrolling panel shows 60..360
  let r = rect(100); trigger.getBoundingClientRect = () => r;
  trigger.click(); await wait(60);
  r = rect(40); p.el.dispatchEvent(new window.Event("scroll")); // partly past the panel's top edge (bottom 72): still attached
  assert.ok(root.classList.contains("is-open"), "a row still partly in the panel keeps its pop");
  r = rect(10); p.el.dispatchEvent(new window.Event("scroll")); // bottom 42, above the panel's top: scrolled out
  assert.ok(!root.classList.contains("is-open"), "the row left the panel's view: its pop closes");
  p.destroy();
});

test("an inner scroller's scroll (capture) is heard too, and a hidden row closes", async () => {
  const p = tweaks("F", { tint: "#00ff00" }); const box = document.createElement("div"); box.append(p.el); document.body.append(box); await p.ready;
  const root = p.el.querySelector(".tw-color"), trigger = root.querySelector(".tw-trigger");
  let r = rect(300); trigger.getBoundingClientRect = () => r;
  trigger.click(); await wait(60);
  const pop = document.body.querySelector(".tw-color-pop.is-open"); assert.ok(pop, "open");
  r = rect(250); box.dispatchEvent(new window.Event("scroll")); // a scroll event that doesn't bubble, from an element: capture on window sees it
  assert.equal(pop.style.top, "288px");
  r = rect(0, 0, 0, 0); box.dispatchEvent(new window.Event("scroll")); // the row went display:none (a tab switch, a collapsed folder)
  assert.ok(!root.classList.contains("is-open"), "a zero-rect row closes rather than parking its pop in the viewport corner");
  p.destroy(); box.remove();
});

test("a list records the side it opened on and its height, so its entrance grows out of the trigger", async () => {
  const p = tweaks("S", { pick: ["a", "b", "c"] }); document.body.append(p.el); await p.ready;
  const trigger = p.el.querySelector(".tw-select-trigger");
  let r = rect(100); trigger.getBoundingClientRect = () => r;
  trigger.click(); await wait(60);
  const pop = document.body.querySelector(".tw-select-dropdown.is-open"); assert.ok(pop, "open");
  assert.equal(pop.dataset.side, "below"); assert.equal(pop.style.getPropertyValue("--tw-pop-h"), "200", "jsdom has no layout, so the list's fallback height");
  assert.equal(pop.style.transition, "", "the transition-free placement handed the transition back");
  trigger.click(); await wait(230);
  r = rect(700); trigger.click(); await wait(60); // 200 + 12 doesn't fit under 732 in a 768 viewport
  assert.equal(pop.dataset.side, "above", "flipped above the trigger");
  p.destroy();
});

test("a popover reopened as it fades out stays where it is and turns around; only its last close removes it", async () => {
  const p = tweaks("R", { pick: ["a", "b"] }); document.body.append(p.el); await p.ready;
  const trigger = p.el.querySelector(".tw-select-trigger"); trigger.getBoundingClientRect = () => rect(100);
  trigger.click(); await wait(60);
  const pop = document.body.querySelector(".tw-select-dropdown.is-open"); assert.ok(pop, "open");
  trigger.click(); await wait(60); // closing, 60ms into the fade
  const append = document.body.appendChild; let moved = 0;
  document.body.appendChild = function (n) { if (n === pop) moved++; return append.call(this, n); };
  try { trigger.click(); } finally { document.body.appendChild = append; }
  assert.equal(moved, 0, "not moved, which would drop its running transition");
  await wait(200); assert.ok(pop.isConnected && pop.classList.contains("is-open"), "the first close's removal didn't fire");
  trigger.click(); await wait(100); assert.ok(pop.isConnected, "a close fades out in full");
  await wait(140); assert.ok(!pop.isConnected, "then the node goes");
  p.destroy();
});

test("an editor's pane takes its trigger's width, as the list's does, and the same gap below it", async () => {
  const p = tweaks("M", { tint: "#7C5CFF", pick: ["a", "b"] }); document.body.append(p.el); await p.ready;
  for (const sel of [".tw-color .tw-trigger", ".tw-select-trigger"]) {
    const trigger = p.el.querySelector(sel); trigger.getBoundingClientRect = () => rect(100, 50, 300);
    trigger.click(); await wait(60);
    const pop = document.body.querySelector(".tw-portal.is-open");
    assert.equal(pop.style.width, "300px", `${sel}: matched`); assert.equal(pop.style.top, "138px", `${sel}: 6px under the 132 bottom`);
    trigger.click(); await wait(230);
  }
  p.destroy();
});

test("a pane held at its floor by a nested folder's narrower row keeps the row's right edge and grows left", async () => {
  const p = tweaks("N", { tint: "#7C5CFF" }); document.body.append(p.el); await p.ready;
  const trigger = p.el.querySelector(".tw-color .tw-trigger");
  trigger.getBoundingClientRect = () => rect(100, 50, 236); trigger.click(); await wait(60);
  const pop = document.body.querySelector(".tw-color-pop.is-open"); trigger.click(); await wait(230);
  Object.defineProperty(pop, "offsetWidth", { get: () => Math.max(236, parseFloat(pop.style.width) || 0), configurable: true }); // jsdom has no min-width
  trigger.getBoundingClientRect = () => rect(100, 70, 216); // two folders in: 20px of indent
  trigger.click(); await wait(60);
  assert.equal(pop.style.left, "50px", "right edge on the row's (286), so the pane spans the panel's 50–286");
  trigger.click(); await wait(230);
  trigger.getBoundingClientRect = () => rect(100, 50, 300); trigger.click(); await wait(60);
  assert.equal(pop.style.left, "50px", "a row the pane can match starts at its left edge as before");
  p.destroy();
});

test("Escape in a field with a typed edit puts it back and stops; the next closes the pane, and neither reaches the host", async () => {
  const p = tweaks("E", { drop: { type: "shadow", x: 0, y: 4, blur: 12, spread: 0, color: "#00000066" }, label: "Hello" }); document.body.append(p.el); await p.ready;
  let host = 0; const onHost = (e) => { if (e.key === "Escape") host++; }; window.addEventListener("keydown", onHost);
  const esc = (t) => t.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  try {
    const trigger = p.el.querySelector(".tw-shadow .tw-trigger"); trigger.getBoundingClientRect = () => rect(100);
    trigger.click(); await wait(60);
    const pop = document.body.querySelector(".tw-color-pop.is-open"), field = pop.querySelector("input");
    const kept = field.value; field.focus(); field.value = "40"; field.dispatchEvent(new window.Event("input", { bubbles: true }));
    esc(field);
    assert.equal(field.value, kept, "the typed edit is put back"); assert.ok(pop.classList.contains("is-open"), "and the pane stays");
    esc(field);
    assert.ok(!pop.classList.contains("is-open"), "the second Escape closes it"); assert.equal(p.params.drop.x, 0, "nothing was committed");
    assert.equal(host, 0, "and the host heard neither");
    const text = p.el.querySelector(".tw-text"); text.dispatchEvent(new window.Event("focus"));
    text.value = "Bye"; text.dispatchEvent(new window.Event("input", { bubbles: true })); assert.equal(p.params.label, "Bye", "a text field takes its edit live");
    esc(text); assert.equal(text.value, "Hello"); assert.equal(p.params.label, "Hello", "so Escape takes the whole edit back");
    p.set("label", "Set"); text.value = "Typed"; text.dispatchEvent(new window.Event("input", { bubbles: true }));
    esc(text); assert.equal(p.params.label, "Set", "a set() while focused is what Escape goes back to, not the text at focus");
  } finally { window.removeEventListener("keydown", onHost); p.destroy(); }
});

test("a pane drags by its edge and keeps that offset while open; a press on its parts doesn't move it; reopening puts it back", async () => {
  const p = tweaks("D", { tint: "#7C5CFF" }); document.body.append(p.el); await p.ready;
  const trigger = p.el.querySelector(".tw-color .tw-trigger"); let r = rect(100); trigger.getBoundingClientRect = () => r;
  try {
    trigger.click(); await wait(60);
    const pop = document.body.querySelector(".tw-color-pop.is-open"); pop.setPointerCapture = () => {};
    const at = () => [pop.style.left, pop.style.top];
    assert.deepEqual(at(), ["50px", "138px"]);
    const drag = (target, dx, dy) => { target.dispatchEvent(ptr("pointerdown", { clientX: 60, clientY: 140 })); pop.dispatchEvent(ptr("pointermove", { clientX: 60 + dx, clientY: 140 + dy })); pop.dispatchEvent(ptr("pointerup", { clientX: 60 + dx, clientY: 140 + dy, buttons: 0 })); };
    drag(pop, 200, 100);
    assert.deepEqual(at(), ["250px", "238px"], "moved by the drag");
    drag(pop.querySelector(".tw-color-body"), 50, 50);
    assert.deepEqual(at(), ["250px", "238px"], "a press on the picker's parts never moves it");
    drag(pop, 2, 1);
    assert.deepEqual(at(), ["250px", "238px"], "under 4px is a press, not a move");
    pop.dispatchEvent(ptr("pointerdown", { clientX: 60, clientY: 140 })); pop.dispatchEvent(ptr("lostpointercapture", {}));
    pop.dispatchEvent(ptr("pointermove", { clientX: 160, clientY: 240 }));
    assert.deepEqual(at(), ["250px", "238px"], "a lost capture ends the press: a later move carries nothing");
    r = rect(60); window.dispatchEvent(new window.Event("scroll"));
    assert.deepEqual(at(), ["250px", "198px"], "a scroll carries it at its new offset from the row");
    window.dispatchEvent(new window.Event("resize"));
    assert.deepEqual(at(), ["250px", "198px"], "a resize keeps it where it was moved to");
    trigger.click(); await wait(230); r = rect(100); trigger.click(); await wait(60);
    assert.deepEqual(at(), ["50px", "138px"], "the next open is under the row again");
  } finally { p.destroy(); } // an open pane's frame watchdog would keep a failed run alive
});
