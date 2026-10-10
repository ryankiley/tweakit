/* A popover rides with its row while the page scrolls: it keeps the offset place() chose
 * on open (no re-flip, no re-clamp, so it never drifts off its row as the row nears a
 * viewport edge), and closes once the row has scrolled out of view. A resize re-places.
 * jsdom lays out nothing, so the trigger's rect is stubbed and the pop sizes from its fallbacks. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
