/* The shadow control — offset, blur, spread, inset and a color from the kit's picker,
 * mounted inline; the value is structured and carries its box-shadow CSS, built only from
 * the numbers and the picker's own color notation. Runs against the built single-file
 * bundle under jsdom. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, wait, mounter, distCss } from "./_helpers.mjs";

const { tweaks, enhance } = await loadSingle();
const mount = mounter(tweaks, "S");
const HOSTILE = "red 0%), url(https://x/p.png), linear-gradient(red";

test("defaults, the value shape, and the CSS it resolves to", async () => {
  const p = await mount({ s: { type: "shadow" } });
  const v = p.params.s;
  assert.deepEqual({ ...v, color: undefined, css: undefined }, { inset: false, x: 0, y: 8, blur: 24, spread: 0, color: undefined, css: undefined });
  assert.match(v.color, /^rgb\(0 0 0 \/ 0\.18\)$/, "the default color, as the control writes it");
  assert.equal(v.css, `0px 8px 24px 0px ${v.color}`);
  assert.equal(p.el.querySelector(".twk-shadow .twk-trigger-value").textContent, "0 8 24", "the summary skips a zero spread");
  assert.equal(p.el.querySelector(".twk-shadow-card").style.boxShadow, v.css, "the preview card wears the value");
  p.destroy();
});

test("authoring: top-level fields, a nested value, or a box-shadow string; set() takes the same, ignores derived css, and keeps a clean color as written", async () => {
  const a = await mount({ s: { type: "shadow", inset: true, x: 0, y: 1, blur: 0, spread: 1, color: "#ff0000" } });
  assert.equal(a.params.s.css.startsWith("inset 0px 1px 0px 1px "), true); a.destroy();
  const b = await mount({ s: { type: "shadow", value: "0 12px 32px -4px rgb(124 92 255 / 0.35)" } });
  assert.deepEqual([b.params.s.x, b.params.s.y, b.params.s.blur, b.params.s.spread, b.params.s.inset], [0, 12, 32, -4, false]);
  assert.match(b.params.s.css, / rgb\(124 92 255 \/ 0\.35\)$/, "the host's color is kept as written; only a clean single color token is (see the hostile cases)");
  b.set("s", { y: 20, inset: true });
  assert.equal(b.params.s.y, 20); assert.equal(b.params.s.inset, true); assert.equal(b.params.s.blur, 32, "untouched fields stay");
  b.set("s", "inset 0 0 0 1px #00ff00");
  assert.deepEqual([b.params.s.x, b.params.s.y, b.params.s.blur, b.params.s.spread], [0, 0, 0, 1]);
  b.set("s", b.params.s); // the full value, css included, back in — a toJSON/fromJSON or changes() round-trip
  assert.equal(b.params.s.spread, 1);
  b.destroy();
});

test("hostile input never reaches the CSS: extra layers, url(), named colors, calc(), em, garbage, null", async () => {
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
  const trigger = p.el.querySelector(".twk-shadow .twk-trigger"); trigger.focus(); trigger.click(); await wait(40);
  const pop = document.body.querySelector(".twk-shadow-pop.is-open");
  assert.ok(pop, "the popover is open"); assert.ok(pop.querySelector(".twk-color-body"), "the picker body sits inside it");
  assert.equal(document.body.querySelectorAll(".twk-color-pop.is-open").length, 1, "no nested popover");
  [...pop.querySelectorAll(".twk-seg-btn")].find((b) => b.textContent.trim() === "Inner").click();
  assert.equal(p.params.s.inset, true); assert.deepEqual(Object.keys(p.changes()), ["s"]);
  p.reset(); assert.equal(p.params.s.inset, false); assert.equal(p.changes().s, undefined);
  document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await wait(220); p.destroy();
});

test("markup: data-value as a box-shadow string, or the fields as attributes", async () => {
  const holder = document.createElement("div");
  holder.innerHTML = `<div data-twk="shadow" data-label="Lift" data-value="0 8px 24px #0003"></div><div data-twk="shadow" data-label="Inner" data-inset="true" data-y="1" data-blur="0" data-color="#fff"></div>`;
  document.body.append(holder);
  await enhance(holder);
  const [a, b] = [...holder.querySelectorAll('[data-twk="shadow"]')].map((h) => h._tw.ctrl.get());
  assert.deepEqual([a.x, a.y, a.blur, a.spread], [0, 8, 24, 0]);
  assert.equal(b.inset, true); assert.equal(b.y, 1); assert.equal(b.blur, 0);
  holder.remove();
});

test("review follow-up: a fractional length is emitted as the field fitted it, so the value, the CSS and the field agree", async () => {
  const p = await mount({ s: { type: "shadow", x: 2.5, blur: 24.4 } });
  const fields = () => [...p.el.querySelectorAll(".twk-shadow-pop .twk-fields .twk-num")].map((i) => i.value);
  assert.deepEqual([p.params.s.x, p.params.s.blur], [3, 24]); assert.deepEqual(fields(), ["3", "8", "24", "0"]);
  p.set("s", { y: 7.4, spread: -0.6 });
  assert.deepEqual([p.params.s.y, p.params.s.spread], [7, -1]); assert.deepEqual(fields(), ["3", "7", "24", "-1"]);
  assert.equal(p.params.s.css.startsWith("3px 7px 24px -1px "), true);
  p.destroy();
});

test("the color is a row that discloses the picker; the row reads the picker's color", async () => {
  const p = tweaks("S", { lift: { type: "shadow", color: "#ff0000" } }); document.body.append(p.el); await p.ready;
  const root = p.el.querySelector(".twk-shadow"), pop = root.querySelector(".twk-shadow-pop"), row = pop.querySelector(".twk-shadow-color"), body = pop.querySelector(".twk-color-body");
  assert.ok(row && body, "a color row and the picker body are in the pop");
  assert.equal(body.hidden, true, "the picker starts disclosed away"); assert.equal(row.getAttribute("aria-expanded"), "false");
  assert.ok(row.querySelector(".twk-color-swatch").compareDocumentPosition(row.querySelector(".twk-trigger-value")) & 4, "swatch before the readout");
  assert.match(row.querySelector(".twk-trigger-value").textContent, /\S/, "the row shows a readout");
  row.click(); assert.equal(body.hidden, false); assert.equal(row.getAttribute("aria-expanded"), "true");
  const before = row.querySelector(".twk-trigger-value").textContent;
  p.set("lift", { color: "#00ff00" }); assert.notEqual(row.querySelector(".twk-trigger-value").textContent, before, "set() repaints the row");
  row.click(); assert.equal(body.hidden, true);
  p.destroy();
});

test("the four length fields sit two by two (X Y / Blur Spread), not four across the popover", async () => {
  const p = await mount({ s: { type: "shadow" } });
  const fields = document.querySelector(".twk-shadow-pop .twk-shadow-fields");
  assert.ok(fields, "the shadow's field row carries its own class");
  assert.deepEqual([...fields.querySelectorAll(".twk-field-label")].map((l) => l.textContent), ["X", "Y", "Blur", "Spread"]);
  // It has to win the cascade, not just exist: the generic .twk-fields rule (four across) comes
  // later in the sheet, so the 2×2 rule needs more classes than it, or a later place. (jsdom's
  // getComputedStyle doesn't settle this the way a browser does, so the test reasons it out.)
  const css = (distCss()).replace(/@media[^{]*\{([^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body], i) => ({ i, sels: sel.split(",").map((x) => x.trim()), body }));
  const classes = (sel) => (sel.match(/\.[\w-]+/g) || []).length;
  // Each property on its own: whichever matching rule wins it must be the 2×2 one, so a later
  // rule that only resets the columns (or only the flow) fails here too.
  const beats = (a, b) => a.n > b.n || (a.n === b.n && a.i > b.i);
  for (const [prop, want] of [["grid-auto-flow", "row"], ["grid-template-columns", "1fr 1fr"]]) {
    const hits = rules.flatMap((r) => { const m = r.body.match(new RegExp(`(?:^|;)${prop}:([^;]+)`)); return m ? r.sels.filter((sel) => fields.matches(sel)).map((sel) => ({ i: r.i, n: classes(sel), v: m[1].trim() })) : []; });
    assert.ok(hits.length, `some rule sets ${prop} on the field row`);
    const winner = hits.reduce((w, h) => (beats(h, w) ? h : w));
    assert.equal(winner.v, want, `${prop} resolves to ${want}`);
  }
  p.destroy();
});
