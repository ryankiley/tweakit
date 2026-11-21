/* A pane places itself within the part of the page on screen (window.visualViewport), which pinch zoom or an
 * on-screen keyboard leaves smaller than the window, and one bigger than that room keeps its top-left corner on it.
 * jsdom has no visualViewport and lays out nothing, so both are stubbed; the pane sizes from its fallbacks. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, wait } from "./_helpers.mjs";

const { tweaks } = await loadSingle();

const openAt = async (rect, viewport) => {
  window.visualViewport = viewport;
  const p = tweaks("V", { tint: "#7c5cff" });
  document.body.append(p.el);
  await p.ready;
  const trigger = p.el.querySelector(".twk-color .twk-trigger");
  trigger.getBoundingClientRect = () => ({
    ...rect,
    bottom: rect.top + 32,
    right: rect.left + 200,
    width: 200,
    height: 32,
  });
  trigger.click();
  await wait(60);
  return [p, document.body.querySelector(".twk-color-pop.is-open")];
};

test("a pane taller and wider than the room on screen keeps its top-left corner on it", async () => {
  const [p, pop] = await openAt({ top: 100, left: 50 }, { offsetLeft: 0, offsetTop: 0, width: 195, height: 300 });
  try {
    assert.equal(pop.style.top, "6px", "not pushed up past the top");
    assert.equal(pop.style.left, "8px", "not pushed off the left");
  } finally {
    p.destroy();
    delete window.visualViewport;
  }
});

test("a pane places itself by the part of the page on screen, not the window", async () => {
  const [p, pop] = await openAt({ top: 450, left: 0 }, { offsetLeft: 20, offsetTop: 400, width: 300, height: 500 });
  try {
    assert.equal(pop.style.left, "28px", "8px in from the visible left edge, not the window's");
    assert.equal(pop.style.top, "488px", "under its row, which has room below on screen");
  } finally {
    p.destroy();
    delete window.visualViewport;
  }
});
