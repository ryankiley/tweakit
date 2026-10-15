/* onLive (shared.ts) releases a global listener on the first event after its owner has
 * LEFT the document — which it can only tell apart from "not mounted yet" once it has seen
 * the owner connected. A host appends a panel right after building it, before any event
 * can arrive, so the mount is noted a frame later; without that, a panel appended and then
 * unmounted without destroy() (an SPA route change) with no event in between kept every
 * control's resize listener for the page's life. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle } from "./_helpers.mjs";

const { tweaks, mountControl } = await loadSingle();
const frame = () => new Promise((r) => setTimeout(r, 40));

test("a listener registered before the mount still releases after an unmount with no event in between", async () => {
  const counts = { add: 0, remove: 0 };
  const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  window.addEventListener = (t, fn, o) => { if (t === "resize") counts.add++; return add(t, fn, o); };
  window.removeEventListener = (t, fn, o) => { if (t === "resize") counts.remove++; return remove(t, fn, o); };
  try {
    const host = document.createElement("div"); document.body.append(host);
    const p = tweaks("Slider", { x: [1, 0, 10, 1] }); // the slider registers its resize listener while still detached
    host.append(p.el);
    await frame(); // the mount is noted next frame
    host.remove(); // unmounted without destroy(), no resize while connected
    window.dispatchEvent(new window.Event("resize"));
    assert.ok(counts.add >= 1, "the slider registered a resize listener");
    assert.equal(counts.remove, counts.add, "every resize listener released on the first event after the unmount");
  } finally { window.addEventListener = add; window.removeEventListener = remove; }
});

test("an event before the mount is still skipped, not fatal", async () => {
  const p = tweaks("Early", { x: [1, 0, 10, 1] });
  window.dispatchEvent(new window.Event("resize")); // never mounted yet: ignored
  document.body.append(p.el);
  await frame();
  const track = p.el.querySelector(".tw-slider");
  window.dispatchEvent(new window.Event("resize"));
  assert.ok(track.isConnected, "the panel is live and the listener still bound");
  p.destroy();
});

test("a destroy() within a frame of the build still releases the controls' window listeners", async () => {
  // Track the listeners by identity: panels earlier tests destroyed release theirs on these
  // same resize events, which a bare count would mistake for ours.
  const added = new Set(), removed = new Set();
  const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  window.addEventListener = (t, fn, o) => { if (t === "resize") added.add(fn); return add(t, fn, o); };
  window.removeEventListener = (t, fn, o) => { if (t === "resize") removed.add(fn); return remove(t, fn, o); };
  const leftover = () => [...added].filter((fn) => !removed.has(fn)).length;
  try {
    const p = tweaks("R6D", { x: [1, 0, 10, 1], s: { type: "spring", value: { stiffness: 100, damping: 12, mass: 1 } } });
    document.body.append(p.el);
    p.destroy(); // same frame: onLive never saw the panel connected
    window.dispatchEvent(new window.Event("resize")); window.dispatchEvent(new window.Event("resize"));
    assert.ok(added.size >= 2); assert.equal(leftover(), 0, "every control listener released on the first event after the destroy");
    const host = document.createElement("div"); document.body.append(host);
    const m = mountControl(host, [1, 0, 10, 1]); await m.ready;
    m.destroy(); window.dispatchEvent(new window.Event("resize"));
    assert.equal(leftover(), 0, "the standalone control's listener released too");
  } finally { window.addEventListener = add; window.removeEventListener = remove; }
});
