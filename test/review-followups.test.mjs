/* Follow-ups from the adversarial review of the merged pass-10 work: a standalone control
 * honours the per-control options its type admits, the markup toolbar's copy survives a
 * data-key of "__proto__", and a preset load queued behind a delete is refused. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { mountControl, enhance } = await import(new URL("../dist/tweaks.js", import.meta.url));
const lazy = await import(new URL("../dist/tweaks/core.js", import.meta.url));

test("mountControl honours disabled and render on a verbose value, resolved once", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const a = mountControl(host, { type: "slider", value: 1, min: 0, max: 10, disabled: true });
  const b = mountControl(host, { type: "slider", value: 1, min: 0, max: 10, disabled: () => true });
  const c = mountControl(host, { type: "slider", value: 1, min: 0, max: 10, render: () => false });
  const d = mountControl(host, { type: "slider", value: 1, min: 0, max: 10, disabled: () => { throw new Error("boom"); } });
  await Promise.all([a.ready, b.ready, c.ready, d.ready]);
  for (const h of [a, b]) { const el = h.el.firstElementChild; assert.ok(el.classList.contains("is-disabled") && el.inert, "disabled control is greyed and inert"); }
  assert.ok(c.el.firstElementChild.classList.contains("tw-cond-hidden"), "render:false hides it");
  assert.ok(!d.el.firstElementChild.classList.contains("is-disabled"), "a throwing predicate leaves the control as-is");
  for (const h of [a, b, c, d]) h.destroy();
});

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

test("a preset load queued behind a delete of the same name is refused", async () => {
  localStorage.clear();
  localStorage.setItem("tw:rf:presets", JSON.stringify({ a: { x: 7 } }));
  const p = lazy.tweaks("RF", { x: [1, 0, 10, 1], r: { type: "interval", value: [2, 8], min: 0, max: 10, step: 1 } }, { persist: "rf" });
  assert.ok(p.el.querySelector(".tw-toolbar-btn--reset").disabled, "in the lazy window");
  p.deletePreset("a");
  assert.equal(p.loadPreset("a"), false, "the delete queued ahead of it wins");
  assert.equal(p.savePreset("a"), true);
  assert.equal(p.loadPreset("a"), true, "a save queued after the delete brings it back");
  await p.ready;
  assert.equal(p.params.x, 1, "the restored save was the (default) value at that point in the queue");
  assert.deepEqual(p.presets(), ["a"]);
  p.destroy();
});
