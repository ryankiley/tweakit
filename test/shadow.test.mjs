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
  assert.deepEqual(
    { ...v, color: undefined, css: undefined },
    { inset: false, x: 0, y: 8, blur: 24, spread: 0, color: undefined, css: undefined },
  );
  assert.match(v.color, /^rgb\(0 0 0 \/ 0\.18\)$/, "the default color, as the control writes it");
  assert.equal(v.css, `0px 8px 24px 0px ${v.color}`);
  assert.equal(
    p.el.querySelector(".twk-shadow .twk-trigger-value").textContent,
    "0 8 24",
    "the summary skips a zero spread",
  );
  assert.equal(p.el.querySelector(".twk-shadow-card").style.boxShadow, v.css, "the preview card wears the value");
  p.destroy();
});

test("authoring: top-level fields, a nested value, or a box-shadow string; set() takes the same, ignores derived css, and keeps a clean color as written", async () => {
  const a = await mount({ s: { type: "shadow", inset: true, x: 0, y: 1, blur: 0, spread: 1, color: "#ff0000" } });
  assert.equal(a.params.s.css.startsWith("inset 0px 1px 0px 1px "), true);
  a.destroy();
  const b = await mount({ s: { type: "shadow", value: "0 12px 32px -4px rgb(124 92 255 / 0.35)" } });
  assert.deepEqual(
    [b.params.s.x, b.params.s.y, b.params.s.blur, b.params.s.spread, b.params.s.inset],
    [0, 12, 32, -4, false],
  );
  assert.match(
    b.params.s.css,
    / rgb\(124 92 255 \/ 0\.35\)$/,
    "the host's color is kept as written; only a clean single color token is (see the hostile cases)",
  );
  b.set("s", { y: 20, inset: true });
  assert.equal(b.params.s.y, 20);
  assert.equal(b.params.s.inset, true);
  assert.equal(b.params.s.blur, 32, "untouched fields stay");
  b.set("s", "inset 0 0 0 1px #00ff00");
  assert.deepEqual([b.params.s.x, b.params.s.y, b.params.s.blur, b.params.s.spread], [0, 0, 0, 1]);
  b.set("s", b.params.s); // the full value, css included, back in — a toJSON/fromJSON or changes() round-trip
  assert.equal(b.params.s.spread, 1);
  b.destroy();
});

test("hostile input never reaches the CSS: extra layers, url(), named colors, calc(), em, garbage, null", async () => {
  const p = await mount({ s: { type: "shadow", x: 1, y: 2, blur: 3 } });
  const before = p.params.s.css;
  for (const bad of [
    `0 0 4px ${HOSTILE}`,
    "0 0 4px #000, 0 0 8px #fff",
    "0 0 4px red",
    "0 0 calc(1px + 2px) #000",
    "0 0 1em #000",
    "0 0 4px #000 inset extra",
    "garbage",
    "",
    null,
    7,
    [],
    { color: HOSTILE },
    { x: NaN },
  ])
    p.set("s", bad);
  const v = p.params.s;
  assert.equal(v.css.split(",").length, 1, "one layer");
  assert.doesNotMatch(v.css, /url\(|calc\(|em\b|red/);
  assert.deepEqual([v.x, v.y, v.blur], [1, 2, 3], "nothing above moved the numbers");
  assert.equal(before, v.css);
  p.set("s", { blur: -40 });
  assert.equal(p.params.s.blur, 0, "a negative blur clamps to 0 — CSS rejects it");
  p.destroy();
});

test("the popover: one editor surface with the picker inline, the position switch emits, changes() and reset see it", async () => {
  const p = await mount({ s: { type: "shadow" } });
  const trigger = p.el.querySelector(".twk-shadow .twk-trigger");
  trigger.focus();
  trigger.click();
  await wait(40);
  const pop = document.body.querySelector(".twk-shadow-pop.is-open");
  assert.ok(pop, "the popover is open");
  assert.ok(pop.querySelector(".twk-color-body"), "the picker body sits inside it");
  assert.equal(document.body.querySelectorAll(".twk-color-pop.is-open").length, 1, "no nested popover");
  [...pop.querySelectorAll(".twk-seg-btn")].find((b) => b.textContent.trim() === "Inner").click();
  assert.equal(p.params.s.inset, true);
  assert.deepEqual(Object.keys(p.changes()), ["s"]);
  p.reset();
  assert.equal(p.params.s.inset, false);
  assert.equal(p.changes().s, undefined);
  document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(220);
  p.destroy();
});

test("markup: data-value as a box-shadow string, or the fields as attributes", async () => {
  const holder = document.createElement("div");
  holder.innerHTML = `<div data-twk="shadow" data-label="Lift" data-value="0 8px 24px #0003"></div><div data-twk="shadow" data-label="Inner" data-inset="true" data-y="1" data-blur="0" data-color="#fff"></div>`;
  document.body.append(holder);
  await enhance(holder);
  const [a, b] = [...holder.querySelectorAll('[data-twk="shadow"]')].map((h) => h._tw.ctrl.get());
  assert.deepEqual([a.x, a.y, a.blur, a.spread], [0, 8, 24, 0]);
  assert.equal(b.inset, true);
  assert.equal(b.y, 1);
  assert.equal(b.blur, 0);
  holder.remove();
});

test("review follow-up: a fractional length is emitted as the field fitted it, so the value, the CSS and the field agree", async () => {
  const p = await mount({ s: { type: "shadow", x: 2.5, blur: 24.4 } });
  const fields = () => [...p.el.querySelectorAll(".twk-shadow-pop .twk-fields .twk-num")].map((i) => i.value);
  assert.deepEqual([p.params.s.x, p.params.s.blur], [3, 24]);
  assert.deepEqual(fields(), ["3", "8", "24", "0"]);
  p.set("s", { y: 7.4, spread: -0.6 });
  assert.deepEqual([p.params.s.y, p.params.s.spread], [7, -1]);
  assert.deepEqual(fields(), ["3", "7", "24", "-1"]);
  assert.equal(p.params.s.css.startsWith("3px 7px 24px -1px "), true);
  p.destroy();
});

test("the color is a row that discloses the picker; the row reads the picker's color", async () => {
  const p = tweaks("S", { lift: { type: "shadow", color: "#ff0000" } });
  document.body.append(p.el);
  await p.ready;
  const root = p.el.querySelector(".twk-shadow"),
    pop = root.querySelector(".twk-shadow-pop"),
    row = pop.querySelector(".twk-shadow-color"),
    body = pop.querySelector(".twk-color-body");
  assert.ok(row && body, "a color row and the picker body are in the pop");
  assert.equal(body.hidden, true, "the picker starts disclosed away");
  assert.equal(row.getAttribute("aria-expanded"), "false");
  assert.ok(
    row.querySelector(".twk-color-swatch").compareDocumentPosition(row.querySelector(".twk-trigger-value")) & 4,
    "swatch before the readout",
  );
  assert.match(row.querySelector(".twk-trigger-value").textContent, /\S/, "the row shows a readout");
  row.click();
  assert.equal(body.hidden, false);
  assert.equal(row.getAttribute("aria-expanded"), "true");
  const before = row.querySelector(".twk-trigger-value").textContent;
  p.set("lift", { color: "#00ff00" });
  assert.notEqual(row.querySelector(".twk-trigger-value").textContent, before, "set() repaints the row");
  row.click();
  assert.equal(body.hidden, true);
  p.destroy();
});

test("the four length fields sit two by two (X Y / Blur Spread), not four across the popover", async () => {
  const p = await mount({ s: { type: "shadow" } });
  const fields = document.querySelector(".twk-shadow-pop .twk-shadow-fields");
  assert.ok(fields, "the shadow's field row carries its own class");
  assert.deepEqual(
    [...fields.querySelectorAll(".twk-field-label")].map((l) => l.textContent),
    ["X", "Y", "Blur", "Spread"],
  );
  // It has to win the cascade, not just exist: the generic .twk-fields rule (four across) comes
  // later in the sheet, so the 2×2 rule needs more classes than it, or a later place. (jsdom's
  // getComputedStyle doesn't settle this the way a browser does, so the test reasons it out.)
  const css = distCss().replace(/@media[^{]*\{([^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body], i) => ({
    i,
    sels: sel.split(",").map((x) => x.trim()),
    body,
  }));
  const classes = (sel) => (sel.match(/\.[\w-]+/g) || []).length;
  // Each property on its own: whichever matching rule wins it must be the 2×2 one, so a later
  // rule that only resets the columns (or only the flow) fails here too.
  const beats = (a, b) => a.n > b.n || (a.n === b.n && a.i > b.i);
  for (const [prop, want] of [
    ["grid-auto-flow", "row"],
    ["grid-template-columns", "1fr 1fr"],
  ]) {
    const hits = rules.flatMap((r) => {
      const m = r.body.match(new RegExp(`(?:^|;)${prop}:([^;]+)`));
      return m
        ? r.sels.filter((sel) => fields.matches(sel)).map((sel) => ({ i: r.i, n: classes(sel), v: m[1].trim() }))
        : [];
    });
    assert.ok(hits.length, `some rule sets ${prop} on the field row`);
    const winner = hits.reduce((w, h) => (beats(h, w) ? h : w));
    assert.equal(winner.v, want, `${prop} resolves to ${want}`);
  }
  p.destroy();
});

// The preview's card and the chip's tile, as drawn: the box's size, its shift, and the lengths of the shadow it wears.
const geom = (node) => {
  const [, tx, ty] = /translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(node.style.transform);
  return {
    w: parseFloat(node.style.width),
    h: parseFloat(node.style.height),
    tx: +tx,
    ty: +ty,
    lens: [...node.style.boxShadow.matchAll(/(-?[\d.]+)px/g)].map((m) => +m[1]),
  };
};
const drawn = (p, i) => {
  const root = [...p.el.querySelectorAll(".twk-shadow")][i];
  const card = root.querySelector(".twk-shadow-card");
  return { root, card, cardG: geom(card), chipG: geom(root.querySelector(".twk-shadow-chip-tile")) };
};
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} ≠ ${b}`);
// The scale a drawn box shows the value at: its shadow's lengths against the value's, the larger ones (fmt rounds to 0.1).
const scaleOf = (g, v) => g.lens[2] / v.blur;
const PLATE = "0 40px 90px -28px rgba(0, 0, 0, 0.72)"; // a 440px plate's, which 0.7.1's 64px card lost to its spread

test("the preview is the element the shadow is for (size), scaled to fit, in its shadow scaled as much", async () => {
  const p = await mount({
    sq: { type: "shadow", value: PLATE, size: [440, 440] },
    wide: { type: "shadow", value: PLATE, size: 440 },
    small: { type: "shadow", y: 2, blur: 6, size: [24, 24] },
  });
  const sq = drawn(p, 0),
    v = p.params.sq;
  assert.deepEqual([sq.cardG.w, sq.cardG.h], [40, 40], "the square plate, fit to the stage's 64 × 40");
  near(scaleOf(sq.cardG, v), 40 / 440, "its shadow scaled as much", 0.01);
  assert.ok(sq.cardG.h + 2 * sq.cardG.lens[3] > 0, "so the spread leaves a shape to cast");
  assert.equal(sq.card.style.transform.includes("scale"), false, "no scale() transform: WebKit tiles a scaled shadow");
  assert.deepEqual([sq.chipG.w, sq.chipG.h], [7.5, 7.5], "the chip's tile is the card at 12/64");
  near(scaleOf(sq.chipG, v), (40 / 440) * 0.1875, "in the card's shadow at 12/64", 0.01);
  const wide = drawn(p, 1);
  assert.deepEqual([wide.cardG.w, wide.cardG.h], [64, 40], "a bare width keeps the card's 8:5");
  near(scaleOf(wide.cardG, v), 64 / 440, "scaled to the card's 64px", 0.01);
  const small = drawn(p, 2);
  assert.deepEqual([small.cardG.w, small.cardG.h], [24, 24], "a subject smaller than the card shows at its own size");
  assert.equal(small.card.style.boxShadow, p.params.small.css, "in the shadow as the host applies it");
  p.destroy();
});

test("without size, a small shadow's card is as before: 64 × 40 in the value's own CSS; the chip is it at 12/64", async () => {
  const p = await mount({ s: { type: "shadow" }, docs: { type: "shadow", y: 12, blur: 32, spread: -4 } });
  for (const [i, key] of [
    [0, "s"],
    [1, "docs"],
  ]) {
    const { card, cardG, chipG } = drawn(p, i);
    assert.deepEqual([cardG.w, cardG.h], [64, 40]);
    assert.equal(card.style.boxShadow, p.params[key].css);
    assert.deepEqual([chipG.w, chipG.h], [12, 7.5]);
    near(scaleOf(chipG, p.params[key]), 0.1875, "the chip's shadow at 12/64", 0.01);
  }
  p.destroy();
});

test("without size, the card fits the shadow it's given, from any source, and holds still while the pane edits it", async () => {
  const p = await mount({ authored: { type: "shadow", value: PLATE }, later: { type: "shadow" } });
  const a = drawn(p, 0);
  near(
    scaleOf(a.cardG, p.params.authored),
    64 / (6.4 * 28),
    "the spread's need: a quarter of the height at most",
    0.01,
  );
  assert.ok(a.cardG.h + 2 * a.cardG.lens[3] >= 20, "the shadow's shape is at least half the card");
  assert.ok(a.cardG.lens[1] <= 22, "its offset ends inside the stage");
  p.set("later", PLATE); // a restore, a preset, a paste: the same value, the same preview
  assert.deepEqual(drawn(p, 1).cardG, a.cardG);
  // An edit in the pane holds the card still, so the preview shows the edit, until the pane next opens.
  const { root } = drawn(p, 1);
  const spread = [...root.querySelectorAll(".twk-shadow-pop .twk-fields .twk-num")][3];
  spread.value = "-80";
  spread.dispatchEvent(new window.Event("change"));
  assert.equal(p.params.later.spread, -80);
  near(scaleOf(drawn(p, 1).cardG, p.params.later), scaleOf(a.cardG, p.params.authored), "held", 0.01);
  const { card } = drawn(p, 1); // the pane leaves the row as it opens
  root.querySelector(".twk-trigger").click();
  await wait(40);
  near(scaleOf(geom(card), p.params.later), 64 / (6.4 * 80), "refit as it opens", 0.01);
  document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(220);
  p.destroy();
});

test("a size that names no element in 1 to 1e5 px falls back to the fit; nothing it holds can break the row", async () => {
  const hostile = [
    Object.create(null),
    {
      toString: () => {
        throw new Error("no");
      },
    },
  ];
  for (const size of [0, 0.5, -440, 1e8, "big", "440px", [0, 10], [440, -1], Infinity, NaN, null, {}, ...hostile]) {
    const p = await mount({ s: { type: "shadow", size } });
    const { card, cardG } = drawn(p, 0);
    assert.deepEqual(
      [cardG.w, cardG.h],
      [64, 40],
      `size: ${String(size?.constructor ? JSON.stringify(size) : "hostile")}`,
    );
    assert.doesNotMatch(card.getAttribute("style"), /NaN|Infinity|e\+/);
    p.destroy();
  }
});

test("the card is centred with its shadow, half the offset back in whole px, at most to the stage's edge; an inset stays put", async () => {
  const p = await mount({
    def: { type: "shadow" },
    long: { type: "shadow", x: -100, y: 100, size: 64 },
    inner: { type: "shadow", inset: true, y: 10 },
  });
  assert.deepEqual([drawn(p, 0).cardG.tx, drawn(p, 0).cardG.ty], [0, -4]);
  assert.deepEqual([drawn(p, 0).chipG.tx, drawn(p, 0).chipG.ty], [0, -1], "the chip's, rounded to a whole px");
  assert.deepEqual([drawn(p, 1).cardG.tx, drawn(p, 1).cardG.ty], [22, -22]);
  assert.deepEqual([drawn(p, 2).cardG.tx, drawn(p, 2).cardG.ty], [0, 0]);
  p.set("inner", { inset: false });
  assert.equal(drawn(p, 2).cardG.ty, -5, "the shift follows the value");
  p.destroy();
});

test("markup: data-size is the width, or the width and height", async () => {
  const holder = document.createElement("div");
  holder.innerHTML = `<div data-twk="shadow" data-size="440,440" data-value="${PLATE}"></div><div data-twk="shadow" data-size="150,100"></div><div data-twk="shadow" data-size="440"></div>`;
  document.body.append(holder);
  await enhance(holder);
  const cards = [...holder.querySelectorAll(".twk-shadow-card")];
  assert.deepEqual(
    cards.map((c) => [c.style.width, c.style.height]),
    [
      ["40px", "40px"],
      ["60px", "40px"],
      ["64px", "40px"],
    ],
  );
  assert.match(cards[2].style.boxShadow, /^0px 1\.2px 3\.5px 0px /, "the default shadow, scaled to a 440px subject");
  holder.remove();
});
