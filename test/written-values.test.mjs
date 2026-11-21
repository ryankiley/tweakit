/* A control's default is kept as written, on the step grid or off it, and so is a write of that same value (a reset, a
 * restore), until it's touched: a press, a drag, a scrub or a key puts it on the grid, an arrow at the next grid point
 * that way. Any other write lands on the grid. A value only float noise off the grid snaps to it, and an off-grid
 * readout shows ten significant digits. Slider, number, interval and point. jsdom lays out nothing, so each track's rect
 * is stubbed. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, wait, ptr, key } from "./_helpers.mjs";

const { tweaks } = await loadSingle();
const box =
  (w = 300) =>
  () => ({ left: 0, top: 0, width: w, height: 20, right: w, bottom: 20, x: 0, y: 0 });
const mount = async (schema, opts) => {
  const p = tweaks("Written", schema, opts);
  document.body.append(p.el);
  await p.ready;
  return p;
};

test("a slider keeps its default as written until it's touched", async () => {
  const p = await mount({
    s: { type: "slider", value: 576.5, min: 1, max: 2000, step: 1 },
    noise: { type: "slider", value: 0.1 * 3, min: 0, max: 1, step: 0.1 },
    f32: { type: "slider", value: Math.fround(0.1), min: 0, max: 1, step: 0.01 },
  });
  try {
    const [s, , f32] = p.el.querySelectorAll(".twk-slider");
    const readout = (t) => t.querySelector(".twk-slider-value").textContent;
    assert.equal(p.params.s, 576.5);
    assert.equal(readout(s), "576.5");
    assert.deepEqual(p.changes(), {}, "a written default is no change");
    assert.equal(p.params.noise, 0.3, "float noise off the grid snaps to it");
    assert.equal(p.params.f32, Math.fround(0.1), "a float is kept exactly");
    assert.equal(readout(f32), "0.1000000015", "and reads to ten significant digits");
    key(s, { key: "ArrowRight" });
    assert.equal(p.params.s, 577, "an arrow goes to the next grid point that way");
    p.set("s", 576.5);
    key(s, { key: "ArrowLeft" });
    assert.equal(p.params.s, 576);
    p.set("s", 576.5);
    s.parentElement.getBoundingClientRect = box();
    s.dispatchEvent(ptr("pointerdown", { clientX: 77, clientY: 0 }));
    s.dispatchEvent(ptr("pointermove", { clientX: 113, clientY: 0 }));
    assert.equal(p.params.s, Math.round(p.params.s), `a drag lands on the grid, not ${p.params.s}`);
    s.dispatchEvent(ptr("pointerup", { clientX: 113, clientY: 0, buttons: 0 }));
  } finally {
    p.destroy();
  }
});

test("a notched slider keeps a written value between notches, and Escape mid-drag gives it back as written", async () => {
  const p = await mount({ s: { type: "slider", value: 2.5, min: 0, max: 5, step: 1 } });
  try {
    const s = p.el.querySelector(".twk-slider");
    assert.equal(p.params.s, 2.5);
    s.parentElement.getBoundingClientRect = box();
    s.dispatchEvent(ptr("pointerdown", { clientX: 270, clientY: 0 }));
    s.dispatchEvent(ptr("pointermove", { clientX: 290, clientY: 0 }));
    await wait(50);
    s.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await wait(50);
    assert.equal(p.params.s, 2.5);
  } finally {
    p.destroy();
  }
});

test("a number keeps its default as written; typed text, a scrub and an arrow land on the grid", async () => {
  const p = await mount({ n: { type: "number", value: 576.5, min: 1, max: 2000, step: 1 } });
  try {
    const field = p.el.querySelector(".twk-num"),
      grab = p.el.querySelector(".twk-num-grab");
    assert.equal(p.params.n, 576.5);
    assert.equal(field.value, "576.5");
    field.value = "12.345";
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.equal(p.params.n, 12, "typed, it lands on the grid like any write but the default");
    field.focus();
    key(field, { key: "ArrowUp" });
    assert.equal(p.params.n, 13);
    p.set("n", 576.5);
    grab.dispatchEvent(ptr("pointerdown", { clientX: 0, clientY: 0 }));
    grab.dispatchEvent(ptr("pointermove", { clientX: 3, clientY: 0 }));
    grab.dispatchEvent(ptr("pointerup", { clientX: 3, clientY: 0, buttons: 0 }));
    assert.equal(p.params.n, Math.round(p.params.n), `a scrub lands on the grid, not ${p.params.n}`);
  } finally {
    p.destroy();
  }
});

test("an interval and a point keep written values; a key or a press on the pad puts them on the grid", async () => {
  const p = await mount({
    span: [[20.5, 79.5], 0, 100, 1],
    at: {
      type: "point",
      components: [
        { key: "x", value: 0.55, min: 0, max: 1, step: 0.1 },
        { key: "y", value: 0, min: 0, max: 1, step: 0.1 },
      ],
    },
  });
  try {
    assert.deepEqual(p.params.span, [20.5, 79.5]);
    assert.equal(p.el.querySelector(".twk-interval .twk-slider-value").textContent, "20.5 – 79.5");
    const [lo] = p.el.querySelectorAll(".twk-interval [role=slider]");
    key(lo, { key: "ArrowRight" });
    assert.deepEqual(p.params.span, [21, 79.5]);
    assert.equal(p.params.at.x, 0.55);
    const trigger = p.el.querySelector(".twk-point .twk-trigger");
    trigger.getBoundingClientRect = () => ({ top: 100, left: 50, width: 200, height: 32, bottom: 132, right: 250 });
    trigger.click();
    await wait(60);
    const pad = document.body.querySelector(".twk-pad");
    pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 });
    pad.dispatchEvent(ptr("pointerdown", { clientX: 33, clientY: 50 }));
    pad.dispatchEvent(ptr("pointerup", { clientX: 33, clientY: 50, buttons: 0 }));
    assert.deepEqual(p.params.at, { x: 0.3, y: 0.5 }, "a press on the pad lands on the grid");
  } finally {
    p.destroy();
  }
});

test("a saved value that is the default comes back as written; any other lands on the grid", async () => {
  localStorage.setItem("tw:written", JSON.stringify({ v: 1, values: { s: 42.5, t: 42.5 } }));
  const p = await mount(
    {
      s: { type: "slider", value: 42.5, min: 0, max: 100, step: 1 },
      t: { type: "slider", value: 10, min: 0, max: 100, step: 1 },
    },
    { persist: "written" },
  );
  try {
    assert.equal(p.params.s, 42.5);
    assert.equal(p.params.t, 43);
  } finally {
    p.destroy();
    localStorage.removeItem("tw:written");
  }
});

test("Home and End from a written value go to the bounds, on a slider and an interval", async () => {
  const p = await mount({
    s: { type: "slider", value: 576.5, min: 1, max: 2000, step: 1 },
    span: [[20.5, 79.7], 0, 100, 1],
  });
  try {
    const s = p.el.querySelector(".twk-slider:not(.twk-interval)");
    key(s, { key: "Home" });
    assert.equal(p.params.s, 1);
    p.set("s", 576.7);
    key(s, { key: "End" });
    assert.equal(p.params.s, 2000);
    const [lo, hi] = p.el.querySelectorAll(".twk-interval [role=slider]");
    key(lo, { key: "Home" });
    key(hi, { key: "End" });
    assert.deepEqual(p.params.span, [0, 100]);
  } finally {
    p.destroy();
  }
});

test("a notched slider pressed from a written value between notches reports the notch it lands on", async () => {
  const p = await mount({ s: { type: "slider", value: 2.5, min: 0, max: 5, step: 1 } });
  const heard = [];
  p.on((params) => heard.push(params.s));
  try {
    const s = p.el.querySelector(".twk-slider");
    s.parentElement.getBoundingClientRect = box(300);
    s.dispatchEvent(ptr("pointerdown", { clientX: 180, clientY: 0 })); // notch 3, the one 2.5 rounds to
    s.dispatchEvent(ptr("pointerup", { clientX: 180, clientY: 0, buttons: 0 }));
    await wait(50);
    assert.equal(p.params.s, 3);
    assert.deepEqual(heard, [3]);
    assert.equal(s.getAttribute("aria-valuenow"), "3");
  } finally {
    p.destroy();
  }
});

test("a set() while a notch is still settling wins over the spring", async () => {
  const p = await mount({ s: { type: "slider", value: 1, min: 0, max: 5, step: 1 } });
  try {
    const s = p.el.querySelector(".twk-slider");
    s.parentElement.getBoundingClientRect = box(300);
    s.dispatchEvent(ptr("pointerdown", { clientX: 240, clientY: 0 }));
    s.dispatchEvent(ptr("pointerup", { clientX: 240, clientY: 0, buttons: 0 }));
    p.set("s", 2.5);
    await wait(80);
    assert.equal(p.params.s, 3);
    assert.equal(s.getAttribute("aria-valuenow"), "3", "not the notch the spring was settling on");
  } finally {
    p.destroy();
  }
});

test("a point reads a written value as written, and its pad keys stop at the next grid point", async () => {
  const p = await mount({
    at: {
      type: "point",
      components: [
        { key: "x", value: 0.53, min: 0, max: 1, step: 0.1 },
        { key: "y", value: 0.57, min: 0, max: 1, step: 0.1 },
      ],
    },
  });
  try {
    assert.equal(p.el.querySelector(".twk-point .twk-trigger-value").textContent, "0.53, 0.57");
    const trigger = p.el.querySelector(".twk-point .twk-trigger");
    trigger.getBoundingClientRect = () => ({ top: 100, left: 50, width: 200, height: 32, bottom: 132, right: 250 });
    trigger.click();
    await wait(60);
    const pad = document.body.querySelector(".twk-pad");
    key(pad, { key: "ArrowUp" });
    key(pad, { key: "ArrowLeft" });
    assert.deepEqual(p.params.at, { x: 0.5, y: 0.6 });
  } finally {
    p.destroy();
  }
});

test("a large written value keeps its fraction", async () => {
  const p = await mount({
    n: { type: "number", value: 1e9 + 0.5, step: 1 },
    m: { type: "number", value: 600000.0004, step: 0.001 },
  });
  try {
    assert.equal(p.params.n, 1e9 + 0.5);
    assert.equal(p.params.m, 600000.0004);
  } finally {
    p.destroy();
  }
});
