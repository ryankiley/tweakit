/* The page scan on load is opt-in. Importing tweakit, tweakit/core or tweakit/single binds no [data-twk] host; the
 * tweakit/auto entry (dist/tweaks/auto.js) binds the page's hosts once it has parsed, as the bare import did up to 0.5. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSplit, loadSingle, distUrl, wait } from "./_helpers.mjs";

const host = (key) => {
  const el = document.createElement("div");
  Object.assign(el.dataset, { twk: "slider", key, value: "12", min: "0", max: "40" });
  document.body.append(el);
  return el;
};
// The markup chunk loads asynchronously on the split build, so a bound host shows up a few ticks after the scan.
const bound = async (el) => { for (let i = 0; i < 100 && !el._tw; i++) await wait(5); return !!el._tw; };

test("the bare import and the single-file build bind nothing on load", async () => {
  const a = host("a");
  const split = await loadSplit();
  const single = await loadSingle();
  await wait(50);
  assert.equal(a._tw, undefined, "a [data-twk] host in the page stays a plain div");
  assert.equal(a.childElementCount, 0);
  // enhance() still binds on request, on either build
  await split.enhance(a);
  assert.ok(a._tw && a.querySelector(".twk-slider"), "enhance() binds it");
  const b = host("b");
  await single.enhance(b);
  assert.ok(b._tw, "the single-file build's enhance() binds too");
  a.remove(); b.remove();
});

test("tweakit/auto binds the page's [data-twk] hosts on load, and re-exports the API", async () => {
  const el = host("auto");
  const auto = await import(distUrl("tweaks/auto.js"));
  assert.ok(await bound(el), "the auto entry bound the host");
  assert.equal(el._tw.ctrl.get(), 12);
  const core = await loadSplit();
  for (const name of Object.keys(core)) assert.equal(auto[name], core[name], `tweakit/auto re-exports ${name}`);
  el.remove();
});

test("tweakit/auto waits for DOMContentLoaded while the document is still loading", async () => {
  Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
  const el = host("late");
  try {
    await import(distUrl("tweaks/auto.js") + "?loading"); // a fresh copy of the entry; core stays the one module
    await wait(50);
    assert.equal(el._tw, undefined, "nothing binds before the document has parsed");
  } finally {
    delete document.readyState;
  }
  document.dispatchEvent(new window.Event("DOMContentLoaded"));
  assert.ok(await bound(el), "bound once DOMContentLoaded fired");
  el.remove();
});
