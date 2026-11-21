/* Escape mid-drag takes the drag back: every control a pointer drags (slider, number scrub, color plane and strips,
 * point pad, interval, curve handles, gradient stops, the spring's preview) puts back the value the press began from,
 * ends the press, and leaves an open pane open. jsdom lays out nothing, so each surface's rect is stubbed. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, wait, ptr } from "./_helpers.mjs";

const { tweaks, mountControl } = await loadSingle();
const box =
  (w = 100, h = 100) =>
  () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0 });
const esc = (target = document.body) => {
  const e = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, composed: true });
  target.dispatchEvent(e);
  return e;
};
const mount = async (schema) => {
  const p = tweaks("Drag", schema);
  document.body.append(p.el);
  await p.ready;
  const heard = [];
  p.on((params, k) => heard.push(k));
  return { p, heard };
};
const openPane = async (p, sel) => {
  const trigger = p.el.querySelector(sel);
  trigger.getBoundingClientRect = () => ({ top: 100, left: 50, width: 200, height: 32, bottom: 132, right: 250 });
  trigger.click();
  await wait(60);
};

test("a slider: Escape mid-drag puts back where the press began, and the release after it changes nothing", async () => {
  const { p, heard } = await mount({ r: [50, 0, 100, 1] });
  try {
    const track = p.el.querySelector(".twk-slider");
    track.parentElement.getBoundingClientRect = box();
    track.dispatchEvent(ptr("pointerdown", { clientX: 20, clientY: 0 }));
    track.dispatchEvent(ptr("pointermove", { clientX: 80, clientY: 0 }));
    assert.equal(p.params.r, 80);
    const e = esc(track);
    assert.ok(e.defaultPrevented, "the Escape is the drag's");
    assert.equal(p.params.r, 50, "back to where it began");
    assert.equal(heard.at(-1), "r", "a listener heard it come back");
    track.dispatchEvent(ptr("pointermove", { clientX: 90, clientY: 0 }));
    track.dispatchEvent(ptr("pointerup", { clientX: 90, clientY: 0, buttons: 0 }));
    assert.equal(p.params.r, 50, "the press is over: a later move or release moves nothing");
    assert.equal(esc(track).defaultPrevented, false, "with no drag, Escape isn't the slider's");
  } finally {
    p.destroy();
  }
});

test("a number's scrub: Escape puts the number back and ends the scrub", async () => {
  const { p } = await mount({ n: { type: "number", value: 10, min: 0, max: 100, step: 1 } });
  try {
    const grab = p.el.querySelector(".twk-num-grab");
    grab.dispatchEvent(ptr("pointerdown", { clientX: 0, clientY: 0 }));
    grab.dispatchEvent(ptr("pointermove", { clientX: 15, clientY: 0 }));
    assert.equal(p.params.n, 25);
    esc();
    assert.equal(p.params.n, 10);
    assert.equal(grab.classList.contains("is-dragging"), false, "the scrub ended");
    assert.equal(p.el.querySelector(".twk-num").value, "10");
    grab.dispatchEvent(ptr("pointermove", { clientX: 40, clientY: 0 }));
    assert.equal(p.params.n, 10, "a move after it scrubs nothing");
  } finally {
    p.destroy();
  }
});

test("the color plane and hue strip: Escape gives the color back exactly as written, and the pane stays open", async () => {
  const { p } = await mount({ tint: "#7C5CFF" });
  try {
    await openPane(p, ".twk-color .twk-trigger");
    const pop = document.body.querySelector(".twk-color-pop.is-open");
    const area = pop.querySelector(".twk-wg-area"),
      hue = pop.querySelector(".twk-wg-hue");
    area.getBoundingClientRect = box(200, 100);
    hue.getBoundingClientRect = box(200, 12);
    area.dispatchEvent(ptr("pointerdown", { clientX: 150, clientY: 20 }));
    area.dispatchEvent(ptr("pointermove", { clientX: 160, clientY: 30 }));
    assert.notEqual(p.params.tint, "#7C5CFF");
    esc(area);
    assert.equal(p.params.tint, "#7C5CFF", "the written string, not a re-serialization of it");
    assert.ok(pop.classList.contains("is-open"), "the Escape took the drag back, not the pane");
    hue.dispatchEvent(ptr("pointerdown", { clientX: 20, clientY: 5 }));
    assert.notEqual(p.params.tint, "#7C5CFF");
    esc(hue);
    assert.equal(p.params.tint, "#7C5CFF");
    esc(area);
    assert.ok(!pop.classList.contains("is-open"), "with no drag, Escape closes the pane as before");
  } finally {
    p.destroy();
  }
});

test("a point's pad, an interval and a curve handle each come back on Escape", async () => {
  const { p } = await mount({
    at: { type: "point", value: { x: 0, y: 0 } },
    span: [[20, 80], 0, 100, 1],
    ease: { type: "cubicbezier", value: [0.25, 0.1, 0.25, 1] },
  });
  try {
    const span = p.el.querySelector(".twk-interval");
    span.parentElement.getBoundingClientRect = box();
    span.dispatchEvent(ptr("pointerdown", { clientX: 10, clientY: 0 }));
    span.dispatchEvent(ptr("pointermove", { clientX: 5, clientY: 0 }));
    assert.deepEqual(p.params.span, [5, 80]);
    esc();
    assert.deepEqual(p.params.span, [20, 80]);

    const graph = p.el.querySelector(".twk-bezier-graph"),
      handle = p.el.querySelector(".twk-bezier-handle");
    graph.getBoundingClientRect = box(200, 200);
    handle.dispatchEvent(ptr("pointerdown", { clientX: 100, clientY: 100 }));
    handle.dispatchEvent(ptr("pointermove", { clientX: 150, clientY: 40 }));
    assert.notDeepEqual(p.params.ease, [0.25, 0.1, 0.25, 1]);
    esc();
    assert.deepEqual(p.params.ease, [0.25, 0.1, 0.25, 1]);

    await openPane(p, ".twk-point .twk-trigger");
    const pad = document.body.querySelector(".twk-pad");
    pad.getBoundingClientRect = box();
    pad.dispatchEvent(ptr("pointerdown", { clientX: 90, clientY: 10 }));
    assert.notDeepEqual(p.params.at, { x: 0, y: 0 });
    esc(pad);
    assert.deepEqual(p.params.at, { x: 0, y: 0 });
  } finally {
    p.destroy();
  }
});

test("a gradient stop dragged off the bar comes back on Escape and isn't removed", async () => {
  const { p } = await mount({
    g: {
      type: "gradient",
      stops: [
        ["#ff0000", 0],
        ["#00ff00", 0.5],
        ["#0000ff", 1],
      ],
    },
  });
  try {
    await openPane(p, ".twk-gradient .twk-trigger");
    const pop = document.body.querySelector(".twk-gradient-pop.is-open");
    const rail = pop.querySelector(".twk-gradient-rail");
    rail.getBoundingClientRect = box(200, 12);
    const stop = rail.children[1];
    stop.dispatchEvent(ptr("pointerdown", { clientX: 100, clientY: 6 }));
    stop.dispatchEvent(ptr("pointermove", { clientX: 160, clientY: 90 }));
    assert.equal(stop.dataset.removing, "true", "far enough off the bar to drop");
    esc(stop);
    assert.equal(stop.dataset.removing, "false");
    stop.dispatchEvent(ptr("pointerup", { clientX: 160, clientY: 90, buttons: 0 }));
    assert.deepEqual(
      p.params.g.stops.map((s) => s.pos),
      [0, 0.5, 1],
      "three stops, the middle one where it was",
    );
    assert.ok(pop.classList.contains("is-open"));
  } finally {
    p.destroy();
  }
});

test("the spring's preview: Escape puts the spring back", async () => {
  const { p } = await mount({ s: { type: "spring", visualDuration: 0.5, bounce: 0.2 } });
  try {
    const viz = p.el.querySelector(".twk-spring-viz");
    viz.getBoundingClientRect = box(200, 100);
    const was = { ...p.params.s };
    viz.dispatchEvent(ptr("pointerdown", { clientX: 180, clientY: 10 }));
    assert.notDeepEqual(p.params.s, was);
    esc();
    assert.deepEqual(p.params.s, was);
  } finally {
    p.destroy();
  }
});

// A field's scrub, pressed and moved, then Escape: the owner's exact value comes back, not the field's rounding of it.
const scrubThenEscape = (grab) => {
  grab.dispatchEvent(ptr("pointerdown", { clientX: 0, clientY: 0 }));
  grab.dispatchEvent(ptr("pointermove", { clientX: 6, clientY: 0 }));
  esc();
};

test("a field's scrub puts back its owner's exact value: a color channel, a spring field, a curve field", async () => {
  const { p } = await mount({
    tint: { type: "color", value: "oklch(0.6234 0.1234 290.5)" },
    s: { type: "spring", visualDuration: 0.505, bounce: 0.22 },
    ease: { type: "cubicbezier", value: [0.215, 0.61, 0.355, 1] },
  });
  try {
    const spring = { ...p.params.s };
    scrubThenEscape(p.el.querySelectorAll(".twk-spring .twk-num-grab")[1]);
    assert.deepEqual(p.params.s, spring, "the spring, not its bounce rounded to the field's step");
    scrubThenEscape(p.el.querySelector(".twk-bezier .twk-num-grab"));
    assert.deepEqual(p.params.ease, [0.215, 0.61, 0.355, 1]);
    await openPane(p, ".twk-color .twk-trigger");
    scrubThenEscape(document.body.querySelector(".twk-color-pop.is-open .twk-num-grab"));
    assert.equal(p.params.tint, "oklch(0.6234 0.1234 290.5)", "the color as written");
  } finally {
    p.destroy();
  }
});

test("a scrub pressed and let go with Escape before it moved sends nothing", async () => {
  const seen = [];
  const host = document.createElement("div");
  document.body.append(host);
  const c = mountControl(host, { type: "number", value: 3.25, step: 1 }, { onChange: (v) => seen.push(v) });
  await c.ready;
  const grab = host.querySelector(".twk-num-grab");
  grab.dispatchEvent(ptr("pointerdown", { clientX: 0, clientY: 0 }));
  esc();
  assert.deepEqual(seen, []);
  c.destroy();
  host.remove();
});

test("a listener that throws on the put-back still lets the drag end: no guide or drag class is left", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  let armed = false;
  const c = mountControl(
    host,
    { type: "number", value: 10 },
    {
      onChange: () => {
        if (armed) throw new Error("listener");
      },
    },
  );
  await c.ready;
  const grab = host.querySelector(".twk-num-grab");
  grab.dispatchEvent(ptr("pointerdown", { clientX: 0, clientY: 0 }));
  grab.dispatchEvent(ptr("pointermove", { clientX: 5, clientY: 0 }));
  armed = true;
  const onError = (e) => e.preventDefault(); // jsdom reports a listener's throw; it's the point here
  window.addEventListener("error", onError);
  try {
    esc();
  } catch {}
  window.removeEventListener("error", onError);
  assert.equal(grab.classList.contains("is-dragging"), false);
  assert.equal(document.querySelectorAll(".twk-grab-guide").length, 0);
  c.destroy();
  host.remove();
});

test("Escape after its control was destroyed mid-drag puts nothing back and leaves the Escape alone", async () => {
  const seen = [];
  const host = document.createElement("div");
  document.body.append(host);
  const c = mountControl(
    host,
    { type: "interval", value: [20, 80], min: 0, max: 100 },
    { onChange: (v) => seen.push(v) },
  );
  await c.ready;
  const track = host.querySelector(".twk-interval");
  track.parentElement.getBoundingClientRect = box();
  track.dispatchEvent(ptr("pointerdown", { clientX: 10, clientY: 0 }));
  track.dispatchEvent(ptr("pointermove", { clientX: 5, clientY: 0 }));
  const before = seen.length;
  c.destroy();
  host.remove();
  assert.equal(esc().defaultPrevented, false);
  assert.equal(seen.length, before, "nothing emitted after destroy");
});

test("undo: a drag is one step on release, and one Escape took back is none", async () => {
  const p = tweaks("Undo", { r: [50, 0, 100, 1] }, { undo: true });
  document.body.append(p.el);
  await p.ready;
  try {
    const track = p.el.querySelector(".twk-slider");
    track.parentElement.getBoundingClientRect = box();
    track.dispatchEvent(ptr("pointerdown", { clientX: 50, clientY: 0 }));
    track.dispatchEvent(ptr("pointermove", { clientX: 90, clientY: 0 }));
    await wait(450); // held still past the step grain
    esc(track);
    track.dispatchEvent(ptr("pointerup", { clientX: 90, clientY: 0, buttons: 0 }));
    await wait(400);
    p.undo();
    assert.equal(p.params.r, 50, "⌘Z after the cancel doesn't bring back 90");
    track.dispatchEvent(ptr("pointerdown", { clientX: 50, clientY: 0 }));
    track.dispatchEvent(ptr("pointermove", { clientX: 70, clientY: 0 }));
    await wait(450);
    track.dispatchEvent(ptr("pointermove", { clientX: 80, clientY: 0 }));
    track.dispatchEvent(ptr("pointerup", { clientX: 80, clientY: 0, buttons: 0 }));
    await wait(400);
    assert.equal(p.params.r, 80);
    p.undo();
    assert.equal(p.params.r, 50, "the whole drag is one step, not the pause at 70");
  } finally {
    p.destroy();
  }
});

test("undo: a second finger's release mid-drag doesn't end the step, and a right-click doesn't hold one open", async () => {
  const p = tweaks("Undo2", { r: [50, 0, 100, 1] }, { undo: true });
  document.body.append(p.el);
  await p.ready;
  try {
    const track = p.el.querySelector(".twk-slider");
    track.parentElement.getBoundingClientRect = box();
    track.dispatchEvent(ptr("pointerdown", { clientX: 50, clientY: 0 }));
    track.dispatchEvent(ptr("pointermove", { clientX: 90, clientY: 0 }));
    document.body.dispatchEvent(ptr("pointerdown", { pointerId: 2, clientX: 10, clientY: 0 }));
    document.body.dispatchEvent(ptr("pointerup", { pointerId: 2, clientX: 10, clientY: 0, buttons: 0 }));
    await wait(450);
    esc(track);
    track.dispatchEvent(ptr("pointerup", { clientX: 90, clientY: 0, buttons: 0 }));
    await wait(400);
    p.undo();
    assert.equal(p.params.r, 50, "the cancelled 90 doesn't come back");
    document.body.dispatchEvent(ptr("pointerdown", { pointerId: 3, button: 2, buttons: 2 })); // its release never comes
    p.set("r", 60);
    await wait(400);
    p.set("r", 70);
    await wait(400);
    p.undo();
    assert.equal(p.params.r, 60, "two edits are still two steps");
  } finally {
    p.destroy();
  }
});
