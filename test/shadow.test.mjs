/* The shadow control — offset, blur, spread, inset and a colour from the kit's picker,
 * mounted inline; the value is structured and carries its box-shadow CSS, built only from
 * the numbers and the picker's own colour notation. Runs against the built single-file
 * bundle under jsdom. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks, enhance } = await import(new URL("../dist/tweaks.js", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mount = async (schema) => { const p = tweaks("S", schema); document.body.append(p.el); await p.ready; return p; };
const HOSTILE = "red 0%), url(https://x/p.png), linear-gradient(red";

test("defaults, the value shape, and the CSS it resolves to", async () => {
  const p = await mount({ s: { type: "shadow" } });
  const v = p.params.s;
  assert.deepEqual({ ...v, color: undefined, css: undefined }, { inset: false, x: 0, y: 8, blur: 24, spread: 0, color: undefined, css: undefined });
  assert.match(v.color, /^oklch\(/, "the colour is the picker's own notation");
  assert.equal(v.css, `0px 8px 24px 0px ${v.color}`);
  assert.equal(p.el.querySelector(".tw-shadow .tw-trigger-value").textContent, "0 8 24", "the summary skips a zero spread");
  assert.equal(p.el.querySelector(".tw-shadow-card").style.boxShadow, v.css, "the preview card wears the value");
  p.destroy();
});

test("authoring: top-level fields, a nested value, or a box-shadow string; set() takes the same, ignores derived css, and re-serialises the colour", async () => {
  const a = await mount({ s: { type: "shadow", inset: true, x: 0, y: 1, blur: 0, spread: 1, color: "#ff0000" } });
  assert.equal(a.params.s.css.startsWith("inset 0px 1px 0px 1px "), true); a.destroy();
  const b = await mount({ s: { type: "shadow", value: "0 12px 32px -4px rgb(124 92 255 / 0.35)" } });
  assert.deepEqual([b.params.s.x, b.params.s.y, b.params.s.blur, b.params.s.spread, b.params.s.inset], [0, 12, 32, -4, false]);
  assert.doesNotMatch(b.params.s.css, /rgb\(124 92 255/, "the host's colour string is re-serialised, not echoed");
  b.set("s", { y: 20, inset: true });
  assert.equal(b.params.s.y, 20); assert.equal(b.params.s.inset, true); assert.equal(b.params.s.blur, 32, "untouched fields stay");
  b.set("s", "inset 0 0 0 1px #00ff00");
  assert.deepEqual([b.params.s.x, b.params.s.y, b.params.s.blur, b.params.s.spread], [0, 0, 0, 1]);
  b.set("s", b.params.s); // the full value, css included, back in — a toJSON/fromJSON or changes() round-trip
  assert.equal(b.params.s.spread, 1);
  b.destroy();
});

test("hostile input never reaches the CSS: extra layers, url(), named colours, calc(), em, garbage, null", async () => {
  const p = await mount({ s: { type: "shadow", x: 1, y: 2, blur: 3 } });
  const before = p.params.s.css;
  for (const bad of [`0 0 4px ${HOSTILE}`, "0 0 4px #000, 0 0 8px #fff", "0 0 4px red", "0 0 calc(1px + 2px) #000", "0 0 1em #000", "0 0 4px #000 inset extra", "garbage", "", null, 7, [], { color: HOSTILE }, { x: NaN }]) p.set("s", bad);
  const v = p.params.s;
  assert.equal(v.css.split(",").length, 1, "one layer"); assert.doesNotMatch(v.css, /url\(|calc\(|em\b|red/);
  assert.deepEqual([v.x, v.y, v.blur], [1, 2, 3], "nothing above moved the numbers");
  assert.equal(before, v.css);
  p.set("s", { blur: -40 }); assert.equal(p.params.s.blur, 0, "a negative blur clamps to 0 — CSS rejects it");
  p.destroy();
});

test("the popover: one editor surface with the picker inline, the position switch emits, changes() and reset see it", async () => {
  const p = await mount({ s: { type: "shadow" } });
  const trigger = p.el.querySelector(".tw-shadow .tw-trigger"); trigger.focus(); trigger.click(); await wait(40);
  const pop = document.body.querySelector(".tw-shadow-pop.is-open");
  assert.ok(pop, "the popover is open"); assert.ok(pop.querySelector(".tw-color-body"), "the picker body sits inside it");
  assert.equal(document.body.querySelectorAll(".tw-color-pop.is-open").length, 1, "no nested popover");
  [...pop.querySelectorAll(".tw-seg-btn")].find((b) => b.textContent.trim() === "Inner").click();
  assert.equal(p.params.s.inset, true); assert.deepEqual(Object.keys(p.changes()), ["s"]);
  p.reset(); assert.equal(p.params.s.inset, false); assert.equal(p.changes().s, undefined);
  document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await wait(220); p.destroy();
});

test("markup: data-value as a box-shadow string, or the fields as attributes", async () => {
  const holder = document.createElement("div");
  holder.innerHTML = `<div data-tw="shadow" data-label="Lift" data-value="0 8px 24px #0003"></div><div data-tw="shadow" data-label="Inner" data-inset="true" data-y="1" data-blur="0" data-color="#fff"></div>`;
  document.body.append(holder);
  await enhance(holder);
  const [a, b] = [...holder.querySelectorAll('[data-tw="shadow"]')].map((h) => h._tw.ctrl.get());
  assert.deepEqual([a.x, a.y, a.blur, a.spread], [0, 8, 24, 0]);
  assert.equal(b.inset, true); assert.equal(b.y, 1); assert.equal(b.blur, 0);
  holder.remove();
});

test("review follow-up: a fractional length is emitted as the field fitted it, so the value, the CSS and the field agree", async () => {
  const p = await mount({ s: { type: "shadow", x: 2.5, blur: 24.4 } });
  const fields = () => [...p.el.querySelectorAll(".tw-shadow-pop .tw-fields .tw-num")].map((i) => i.value);
  assert.deepEqual([p.params.s.x, p.params.s.blur], [3, 24]); assert.deepEqual(fields(), ["3", "8", "24", "0"]);
  p.set("s", { y: 7.4, spread: -0.6 });
  assert.deepEqual([p.params.s.y, p.params.s.spread], [7, -1]); assert.deepEqual(fields(), ["3", "7", "24", "-1"]);
  assert.equal(p.params.s.css.startsWith("3px 7px 24px -1px "), true);
  p.destroy();
});
