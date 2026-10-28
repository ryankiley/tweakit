/* A slider's `format` and `parse`: the readout drawn from the value and a typed one read
 * back, display only (the param stays the number). A format that fails falls back to the
 * digits, and text the parse can't read leaves the value where it was. Runs against the
 * built single-file bundle under jsdom. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle } from "./_helpers.mjs";

const { tweaks } = await loadSingle();

// Minutes of the day as a clock, and back.
const clock = (m) => {
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const unclock = (s) => {
  const [hm, ap] = s.trim().toUpperCase().split(/\s+/);
  const [h, m = "0"] = hm.split(":");
  return ((+h % 12) + (ap === "PM" ? 12 : 0)) * 60 + +m;
};

const build = async (opts) => {
  const p = tweaks("Format", { time: { type: "slider", value: 450, min: 0, max: 1425, step: 15, ...opts } });
  document.body.append(p.el);
  await p.ready;
  const track = p.el.querySelector(".twk-slider"),
    readout = () => p.el.querySelector(".twk-slider-value").textContent;
  return { p, track, readout };
};
const typeIn = (track, text) => {
  track.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  const input = track.querySelector(".twk-slider-input");
  const opened = { shown: input.value, mode: input.inputMode, width: input.style.width };
  input.value = text;
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  return opened;
};

test("format draws the readout and its aria-valuetext; the param stays the number", async () => {
  const { p, track, readout } = await build({ format: clock, parse: unclock });
  assert.equal(readout(), "7:30 AM");
  assert.equal(track.getAttribute("aria-valuetext"), "7:30 AM");
  assert.equal(track.getAttribute("aria-valuenow"), "450");
  assert.equal(p.params.time, 450);
  p.set("time", 1147);
  assert.equal(readout(), "7:00 PM", "format sees the stepped value, as the param does");
  p.destroy();
});

test("with parse, the editor shows the formatted text and reads a typed one back", async () => {
  const { p, track, readout } = await build({ format: clock, parse: unclock });
  assert.deepEqual(
    typeIn(track, "9:15 am"),
    { shown: "7:30 AM", mode: "text", width: "8ch" },
    "the field opens on the readout, sized to it",
  );
  assert.equal(p.params.time, 555);
  assert.equal(readout(), "9:15 AM");
  p.destroy();
});

test("with only format, the editor edits the digits", async () => {
  const { p, track, readout } = await build({ format: clock });
  assert.deepEqual(typeIn(track, "600"), { shown: "450", mode: "decimal", width: "4ch" });
  assert.equal(p.params.time, 600);
  assert.equal(readout(), "10:00 AM");
  p.destroy();
});

test("a format that throws, or returns anything but a non-empty string, falls back to the digits", async () => {
  for (const format of [
    () => {
      throw new Error("no");
    },
    () => 12,
    () => "",
  ]) {
    const { p, track, readout } = await build({ format });
    assert.equal(readout(), "450", `format ${format}`);
    assert.equal(track.getAttribute("aria-valuetext"), "450");
    p.destroy();
  }
});

test("text the parse can't read leaves the value where it was", async () => {
  // A parse's answer is final: a throw, NaN, Infinity, a null "can't tell" or a numeric
  // string is not a value, and the typed text is not read as a plain number instead.
  for (const parse of [
    () => {
      throw new Error("no");
    },
    () => NaN,
    () => Infinity,
    () => null,
    () => "300",
  ]) {
    const { p, track, readout } = await build({ format: clock, parse });
    typeIn(track, "300");
    assert.equal(p.params.time, 450, `parse ${parse}`);
    assert.equal(readout(), "7:30 AM");
    p.destroy();
  }
});

test("opening the editor and leaving it untouched doesn't move the value", async () => {
  // A format coarser than the step: 450 minutes reads "8 h", which parses back to 480.
  const { p, track } = await build({ format: (m) => Math.round(m / 60) + " h", parse: (s) => parseFloat(s) * 60 });
  assert.equal(typeIn(track, "8 h").shown, "8 h");
  assert.equal(p.params.time, 450);
  p.destroy();
});

test("a format that isn't a function is ignored", async () => {
  const { p, track, readout } = await build({ format: "h:mm", parse: 3 });
  assert.equal(readout(), "450");
  assert.deepEqual(typeIn(track, "600"), { shown: "450", mode: "decimal", width: "4ch" });
  assert.equal(p.params.time, 600);
  p.destroy();
});

test("without a parse, typed text must all be a number; the unit is dropped", async () => {
  const { p, track } = await build({ unit: "min" });
  for (const text of ["1,000", "7:30", "12abc", "", " "]) {
    typeIn(track, text);
    assert.equal(p.params.time, 450, JSON.stringify(text));
  }
  typeIn(track, " 615 min ");
  assert.equal(p.params.time, 615);
  typeIn(track, "600");
  assert.equal(p.params.time, 600);
  p.destroy();
});

test("a unit still follows a formatted readout", async () => {
  const { p, track, readout } = await build({
    format: (v) => v.toLocaleString("en-US"),
    unit: "ms",
    value: 1500,
    max: 3000,
    step: 100,
  });
  assert.equal(readout(), "1,500 ms");
  assert.equal(track.getAttribute("aria-valuetext"), "1,500 ms");
  p.destroy();
});
