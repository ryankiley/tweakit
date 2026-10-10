/* panel.setName() — retitles a live panel: the header and the copy toast follow, the
 * storage key does not (a rename never moves persisted values or presets). Runs against
 * the built single-file bundle under jsdom. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));

test("setName() moves the header and the copy toast, and leaves the storage key on the built-with name", async () => {
  localStorage.clear();
  const p = tweaks("Card", { blur: [24, 0, 100, 1] }, { persist: true });
  document.body.append(p.el); await p.ready;
  assert.equal(p.el.querySelector(".tw-title").textContent, "Card");
  p.setName("Lock screen");
  assert.equal(p.el.querySelector(".tw-title").textContent, "Lock screen", "the header follows");
  // The copy toast names the panel as it is now.
  let copied = null;
  const clip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async (t) => { copied = t; } }, configurable: true });
  try { p.el.querySelector(".tw-toolbar-btn--swap").click(); await new Promise((r) => setTimeout(r, 0)); }
  finally { if (clip) Object.defineProperty(globalThis.navigator, "clipboard", clip); else delete globalThis.navigator.clipboard; }
  assert.ok(copied, "the copy still writes");
  assert.equal(document.querySelector(".tw-toast").textContent, "Lock screen values copied", "the toast follows");
  // Persisted values stay under the original key.
  p.set("blur", 40); await new Promise((r) => setTimeout(r, 200)); // past the persist debounce
  assert.equal(JSON.parse(localStorage.getItem("tw:Card")).blur, 40, "saved under the built-with name");
  assert.equal(localStorage.getItem("tw:Lock screen"), null, "nothing moved to the new name");
  p.destroy();
  p.setName("Gone");
  assert.equal(p.el.querySelector(".tw-title").textContent, "Lock screen", "inert after destroy");
  localStorage.clear();
});
