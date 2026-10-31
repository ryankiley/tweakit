/* The radio grid (and its "segmented" alias): its column count and its name, with a label and without. Runs against the
 * built single-file bundle under jsdom; the pill and the label-less row's fill are the browser layout test's. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, mounter } from "./_helpers.mjs";

const { tweaks } = await loadSingle();
const mount = mounter(tweaks, "R");
const FOUR = ["16:9", "1:1", "9:16", "Free"];

test('label: "" puts four options on one line, the group named by its key; a labeled four wraps to 2×2', async () => {
  const p = await mount({
    ratio: { type: "segmented", label: "", options: FOUR },
    sized: { type: "segmented", options: FOUR },
    many: { type: "segmented", label: "", options: [...FOUR, "Wide"] },
  });
  const got = [...p.el.querySelectorAll(".twk-radiogrid")].map((r) => {
    const g = r.querySelector(".twk-radiogrid-grid");
    return [g.getAttribute("aria-label"), g.style.getPropertyValue("--twk-rg-cols"), r.classList.contains("is-grid")];
  });
  assert.deepEqual(got, [
    ["Ratio", "4", false],
    ["Sized", "2", true],
    ["Many", "3", true],
  ]);
  p.destroy();
});
