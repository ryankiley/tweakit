/* The controls without a panel: mountControl() and createColorPicker() from the public
 * surface, and the markup path's change channel — a [data-tw] host dispatches tw:change
 * (and writes data-value) on an edit, on its handle's set(), and on the toolbar reset;
 * enhance(el) enhances el itself. Runs against the built single-file bundle, plus the
 * code-split core for the lazy window (the picker must load the colour chunk first). */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { mountControl, createColorPicker, enhance } = await import(new URL("../dist/tweaks.js", import.meta.url));
const split = await import(new URL("../dist/tweaks/core.js", import.meta.url));
const key = (target, props) => target.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...props }));

test("mountControl mounts one control into a host; set() fires onChange; destroy() removes it", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const seen = [];
  const h = mountControl(host, [5, 0, 10, 1], { key: "size", onChange: (v, k) => seen.push([k, v]) });
  await h.ready;
  assert.ok(h.el && h.el.parentNode === host, "the control is in the host");
  assert.ok(host.querySelector(".tw-slider"), "and it is a slider");
  assert.equal(h.get(), 5);
  h.set(7);
  assert.equal(h.get(), 7);
  assert.deepEqual(seen, [["size", 7]], "set() ran the change callback once, with the key");
  h.set(7);
  assert.equal(seen.length, 1, "a same-value set() stays silent");
  key(host.querySelector(".tw-slider"), { key: "ArrowRight" });
  assert.deepEqual(seen.at(-1), ["size", 8], "a hand edit reaches the same callback");
  h.destroy();
  assert.equal(host.childElementCount, 0, "destroy() took the control out of the host");
  host.remove();
});

test("mountControl takes the verbose forms too, honors label, and refuses a folder", async () => {
  const host = document.createElement("div");
  const h = mountControl(host, { type: "color", value: "#ff0000" }, { label: "" });
  await h.ready;
  assert.ok(host.querySelector(".tw-color"), "a verbose colour value builds the colour control");
  assert.equal(host.querySelector(".tw-trigger-label").textContent, "", 'label: "" shows no label');
  assert.throws(() => mountControl(host, { a: 1, b: 2 }), /not a single-control/);
  h.destroy();
});

test("createColorPicker hands out the editor surface alone; set()/get() round-trip through onChange", async () => {
  const seen = [];
  const p = createColorPicker({ value: "#ff0000", mode: "hex", onChange: (v) => seen.push(v) });
  document.body.append(p.el);
  await p.ready;
  assert.ok(p.el.classList.contains("tw-color-picker"));
  assert.ok(p.el.querySelector(".tw-color-body"), "the picker body is inside");
  assert.ok(!p.el.querySelector(".tw-trigger-chip"), "no trigger row of the kit's own");
  assert.equal(p.get(), "#ff0000");
  p.set("#00ff00");
  assert.equal(p.get(), "#00ff00", "get() reads back what set() put in");
  assert.deepEqual(seen, ["#00ff00"], "set() fired onChange");
  p.setMode("oklch");
  assert.equal(p.mode(), "oklch");
  assert.match(p.get(), /^oklch\(/, "the emitted form follows the mode");
  assert.equal(seen.length, 1, "a mode switch is formatting only — nothing fires");
  p.destroy();
  assert.ok(!p.el.isConnected);
});

test("on the code-split build the picker loads the colour chunk first; set() in the lazy window applies on ready", async () => {
  const seen = [];
  const p = split.createColorPicker({ value: "#ff0000", mode: "hex", onChange: (v) => seen.push(v) });
  document.body.append(p.el);
  assert.ok(p.el, "the element exists before the chunk lands");
  p.set("#0000ff");
  assert.equal(p.get(), "#0000ff", "get() reports the queued value meanwhile");
  await p.ready;
  assert.ok(p.el.querySelector(".tw-color-body"), "the body filled in once the chunk loaded");
  assert.equal(p.get(), "#0000ff");
  assert.deepEqual(seen, ["#0000ff"], "the queued set() announced once it applied");
  p.destroy();
});

test("on the code-split build mountControl waits for a lazy control's chunk", async () => {
  const host = document.createElement("div");
  const h = split.mountControl(host, { type: "interval", value: [2, 8], min: 0, max: 10, step: 1 });
  assert.ok(h.el.parentNode === host && h.el.classList.contains("tw-portal"), "the token-scoped wrapper is in the host from the start");
  assert.equal(h.el.childElementCount, 0, "and stays empty until the chunk lands");
  await h.ready;
  assert.ok(host.querySelector(".tw-interval"), "the interval built after its chunk loaded");
  assert.deepEqual(h.get(), [2, 8]);
  h.destroy();
});

test("a [data-tw] host dispatches tw:change and writes data-value on an edit, on handle set(), and on reset", async () => {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="tw-panel" data-mode="inline">
      <div class="tw-header"><span class="tw-title">Static</span></div>
      <div class="tw-controls">
        <div data-tw="slider" data-key="blur" data-value="12" data-min="0" data-max="40" data-step="1"></div>
      </div>
    </div>`;
  document.body.append(wrap);
  const events = [];
  wrap.addEventListener("tw:change", (e) => events.push([e.target.dataset.tw, e.detail.key, e.detail.value])); // listened on an ancestor: the event bubbles
  await enhance(wrap);
  const host = wrap.querySelector("[data-tw]");
  key(host.querySelector(".tw-slider"), { key: "ArrowRight" });
  assert.deepEqual(events, [["slider", "blur", 13]], "a hand edit announces the key + value");
  assert.equal(host.dataset.value, "13", "and echoes the value onto data-value");
  host._tw.ctrl.set(30);
  assert.deepEqual(events.at(-1), ["slider", "blur", 30], "the handle's set() announces too");
  assert.equal(host.dataset.value, "30", "and writes data-value");
  assert.equal(host._tw.ctrl.get(), 30);
  host._tw.ctrl.set(30);
  assert.equal(events.length, 2, "a same-value set() is silent");
  wrap.querySelector(".tw-toolbar-btn--reset").click();
  assert.equal(host.dataset.value, "12", "the toolbar reset restores the markup's value");
  assert.deepEqual(events.at(-1), ["slider", "blur", 12], "through the same announcing path");
  assert.equal(events.length, 3, "once");
  wrap.remove();
});

test("enhance(el) enhances el itself when it carries [data-tw]", async () => {
  const host = document.createElement("div");
  host.dataset.tw = "checkbox";
  host.dataset.key = "on";
  host.dataset.checked = "true";
  document.body.append(host);
  await enhance(host);
  assert.ok(host.hasAttribute("data-tw-bound"), "the root itself was claimed");
  assert.ok(host._tw && host._tw.ctrl.get() === true, "and built its control");
  await enhance(host);
  assert.equal(host.querySelectorAll(".tw-row").length, 1, "re-running is still idempotent");
  host.remove();
});
