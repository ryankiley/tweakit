/* The sides control: four numbers in CSS order plus the shorthand they collapse to; linked
 * (one field for all four) or unlinked (four fields); every input form; hostile input;
 * markup. Runs against the built single-file bundle under jsdom. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, mounter, distCss } from "./_helpers.mjs";

const { tweaks, enhance } = await loadSingle();
const mount = mounter(tweaks, "B");
const four = (v) => [v.top, v.right, v.bottom, v.left];

test("every input form, and the CSS shorthand the four collapse to", async () => {
  const p = await mount({ a: { type: "sides" }, b: { type: "sides", value: 16 }, c: { type: "sides", value: [8, 16] }, d: { type: "sides", value: [8, 16, 24] }, e: { type: "sides", value: [1, 2, 3, 4] }, f: { type: "sides", value: "8px 16px" }, g: { type: "sides", top: 4 }, h: { type: "sides", value: [1, 2], unit: "rem" }, i: { type: "sides", value: "0 12" } });
  const v = p.params;
  assert.deepEqual([four(v.a), v.a.css], [[0, 0, 0, 0], "0"]);
  assert.deepEqual([four(v.b), v.b.css], [[16, 16, 16, 16], "16px"]);
  assert.deepEqual([four(v.c), v.c.css], [[8, 16, 8, 16], "8px 16px"]);
  assert.deepEqual([four(v.d), v.d.css], [[8, 16, 24, 16], "8px 16px 24px"]);
  assert.deepEqual([four(v.e), v.e.css], [[1, 2, 3, 4], "1px 2px 3px 4px"]);
  assert.deepEqual([four(v.f), v.f.css], [[8, 16, 8, 16], "8px 16px"], "a CSS string, read in the control's unit");
  assert.deepEqual([four(v.g), v.g.css], [[4, 0, 0, 0], "4px 0 0"], "one side off the top level; a bare 0 stays bare");
  assert.deepEqual(v.h.css, "1rem 2rem");
  assert.deepEqual(v.i.css, "0 12px");
  p.set("a", -5); assert.equal(p.params.a.css, "-5px", "a side with no min may go negative, as a margin does");
  p.destroy();
  const q = await mount({ c: { type: "sides", corners: true, value: 4 }, d: { type: "sides", corners: true, value: 4, min: -2 } });
  q.set("c", -5); assert.equal(q.params.c.css, "0", "corners floor at 0 unless min says otherwise");
  q.set("d", -5); assert.equal(q.params.d.css, "-2px");
  q.destroy();
});

// Collect the warnings fn raises.
const warnings = async (fn) => {
  const warn = console.warn, msgs = []; console.warn = (...a) => msgs.push(a.join(" "));
  try { await fn(); return msgs; } finally { console.warn = warn; }
};

test("a string keeps its unit when its sides agree; an explicit unit wins; mixed units warn and read as px", async () => {
  let p;
  const quiet = await warnings(async () => { p = await mount({ a: { type: "sides", value: "1rem 2rem" }, b: { type: "sides", value: "0 3em" }, c: { type: "sides", value: "1rem 2" }, d: { type: "sides", value: "1rem", unit: "px" }, e: { type: "sides", value: "8PX 0" }, f: { type: "sides", value: "0px 2rem" } }); });
  assert.deepEqual(quiet, [], "one unit, however it's spelled, is no mistake");
  const v = p.params;
  assert.deepEqual([four(v.a), v.a.css], [[1, 2, 1, 2], "1rem 2rem"], "a 2rem padding stays 2rem");
  assert.equal(v.b.css, "0 3em", "a bare 0 doesn't vote");
  assert.equal(v.c.css, "1rem 2rem", "a unitless side takes the string's unit");
  assert.equal(v.d.css, "1px", "an explicit unit wins over the string's");
  assert.equal(v.e.css, "8px 0");
  assert.equal(v.f.css, "0 2rem", "0px is 0 in any unit, so it doesn't disagree");
  const a = p.el.querySelectorAll(".tw-sides")[0];
  assert.equal(a.querySelector(".tw-sides-sum").textContent, "1 2 1 2rem"); assert.equal(a.querySelector(".tw-sides-multi .tw-num").getAttribute("aria-label"), "Top (rem)", "the fields edit in the string's unit");
  p.set("a", "4px"); assert.equal(p.params.a.css, "4rem", "set() reads numbers in the control's unit, as before");
  p.destroy();
  const mixed = await warnings(async () => { p = await mount({ m: { type: "sides", value: "1rem 2em 3% 4" } }); });
  assert.deepEqual([four(p.params.m), p.params.m.css], [[1, 2, 3, 4], "1px 2px 3px 4px"], "the numbers keep, in one unit");
  assert.equal(mixed.length, 1); assert.match(mixed[0], /"M".*top rem, right em, bottom %\).*read as px/);
  p.destroy();
});

test("a default it can't read warns and starts at 0", async () => {
  let p;
  const msgs = await warnings(async () => { p = await mount({ a: { type: "sides", value: [1, 2, 3, 4, 5] }, b: { type: "sides", value: "calc(1px + 2px)" }, c: { type: "sides", value: "var(--pad)" }, d: { type: "sides", value: "wide" }, e: { type: "sides" } }); });
  assert.deepEqual(["a", "b", "c", "d", "e"].map((k) => p.params[k].css), ["0", "0", "0", "0", "0"]);
  assert.equal(msgs.length, 4, "one each; no value is no mistake");
  [/"A": can't read \[1,2,3,4,5\]/, /"B": can't read "calc\(1px \+ 2px\)"/, /"C": can't read "var\(--pad\)"/, /"D": can't read "wide"/].forEach((re, i) => assert.match(msgs[i], re));
  assert.ok(msgs.every((m) => m.includes("starts at 0")), "each says what it did");
  p.destroy();
});

test("linked by default when the four agree; the toggle opens the fields; linking takes the first side", async () => {
  const p = await mount({ pad: { type: "sides", value: 8 } });
  const root = p.el.querySelector(".tw-sides"), row = root.querySelector(":scope > .tw-row"), link = row.querySelector(".tw-sides-link");
  assert.ok(root.classList.contains("is-linked")); assert.equal(link.getAttribute("aria-pressed"), "false", "pressed means the four are open");
  assert.deepEqual([link.getAttribute("aria-label"), link.title], ["Independent sides", "Independent sides"]);
  assert.equal(row.querySelector(".tw-num").value, "8"); assert.match(row.querySelector(".tw-num").getAttribute("aria-label"), /^pad/i);
  assert.equal(row.lastElementChild, link, "the link is the row's last child, after the field");
  link.click();
  assert.ok(!root.classList.contains("is-linked"), "unlinked: the four fields show");
  const flds = [...root.querySelectorAll(".tw-sides-multi .tw-num")]; assert.equal(flds.length, 4); assert.deepEqual(flds.map((f) => f.value), ["8", "8", "8", "8"]);
  assert.deepEqual([...root.querySelectorAll(".tw-field-label")].map((l) => [l.textContent, l.title, l.dataset.at, !!l.querySelector("svg[aria-hidden]")]), [["", "Top", "top", true], ["", "Right", "right", true], ["", "Bottom", "bottom", true], ["", "Left", "left", true]], "a glyph on screen, the full name as the tooltip");
  assert.deepEqual(flds.map((i) => i.getAttribute("aria-label")), ["Top (px)", "Right (px)", "Bottom (px)", "Left (px)"]);
  assert.equal(root.querySelector(".tw-sides-sum").textContent, "8 8 8 8px", "the readout carries the unit once");
  assert.equal(root.querySelector(".tw-sides-head").lastElementChild, root.querySelector(".tw-sides-multi .tw-sides-link"), "the toggle is last in the head, as it is last in the row");
  assert.equal(link.getAttribute("aria-pressed"), "true");
  assert.equal(document.activeElement, root.querySelector(".tw-sides-multi .tw-sides-link"), "focus moves to the link in the block that is now showing");
  flds[1].value = "20"; flds[1].dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.deepEqual(four(p.params.pad), [8, 20, 8, 8]); assert.equal(p.params.pad.css, "8px 20px 8px 8px"); assert.equal(root.querySelector(".tw-sides-sum").textContent, "8 20 8 8px");
  root.querySelector(".tw-sides-multi .tw-sides-link").click();
  assert.ok(root.classList.contains("is-linked")); assert.deepEqual(four(p.params.pad), [8, 8, 8, 8], "linking takes the first side");
  const tabular = [...distCss().matchAll(/([^{}]+)\{[^}]*font-variant-numeric:\s*tabular-nums[^}]*\}/g)].map((m) => m[1]);
  assert.ok(tabular.some((sel) => sel.includes(".tw-sides-sum")), "the readout joins the kit's tabular-figure rule");
  p.destroy();
});

test("set() in any form re-judges the link; corners wear corner glyphs, clockwise like the shorthand; min/max fit the value; hostile input is ignored", async () => {
  const p = await mount({ r: { type: "sides", value: 16, corners: true, min: 0, max: 48 } });
  const root = p.el.querySelector(".tw-sides");
  assert.equal(root.querySelector(".tw-sides-link").getAttribute("aria-label"), "Independent corners");
  const labels = [...root.querySelectorAll(".tw-field-label")];
  assert.deepEqual(labels.map((l) => l.dataset.at), ["top-left", "top-right", "bottom-right", "bottom-left"], "the line reads clockwise, the order the shorthand is written in");
  assert.ok(labels.every((l) => l.textContent === "" && l.querySelector("svg[aria-hidden]")), "each label is a glyph");
  assert.deepEqual(labels.map((l) => l.title), ["Top-left", "Top-right", "Bottom-right", "Bottom-left"], "named by its tooltip");
  assert.deepEqual([...root.querySelectorAll(".tw-sides-multi .tw-num")].map((i) => i.getAttribute("aria-label")), ["Top-left (px)", "Top-right (px)", "Bottom-right (px)", "Bottom-left (px)"]);
  p.set("r", [1, 2, 3, 4]); assert.ok(!root.classList.contains("is-linked"), "unequal sides unlink"); assert.deepEqual(four(p.params.r), [1, 2, 3, 4]);
  assert.deepEqual([...root.querySelectorAll(".tw-sides-multi .tw-num")].map((i) => i.value), ["1", "2", "3", "4"], "the fields, the readout and the shorthand share one order");
  assert.equal(root.querySelector(".tw-sides-sum").textContent, "1 2 3 4px"); assert.equal(p.params.r.css, "1px 2px 3px 4px");
  p.set("r", "24px"); assert.ok(root.classList.contains("is-linked")); assert.equal(p.params.r.css, "24px");
  p.set("r", { left: 99 }); assert.deepEqual(four(p.params.r), [24, 24, 24, 48], "an object moves one side; max fits it");
  p.set("r", -5); assert.equal(p.params.r.css, "0", "min fits it");
  const before = p.params.r.css;
  for (const bad of ["nonsense", { top: "x" }, [NaN], [], null, undefined, "1px 2px 3px 4px 5px", { nope: 1 }, "<b>"]) p.set("r", bad);
  assert.equal(p.params.r.css, before, "nothing that fails to parse moves it");
  p.reset(); assert.equal(p.params.r.css, "16px"); assert.ok(root.classList.contains("is-linked"), "reset re-links");
  p.destroy();
});

test("markup: data-value as a shorthand, or the sides as attributes", async () => {
  const holder = document.createElement("div"); document.body.append(holder);
  holder.innerHTML = `<div data-tw="sides" data-label="Pad" data-value="8px 16px"></div><div data-tw="sides" data-label="Round" data-corners="true" data-top="4" data-right="8" data-unit="rem"></div><div data-tw="sides" data-label="Gap" data-value="1rem 2rem"></div><div data-tw="sides" data-label="None"></div>`;
  const msgs = await warnings(() => enhance(holder));
  const [a, b, c, d] = [...holder.querySelectorAll('[data-tw="sides"]')].map((h) => h._tw.ctrl.get());
  assert.deepEqual([four(a), a.css], [[8, 16, 8, 16], "8px 16px"]);
  assert.deepEqual([four(b), b.css], [[4, 8, 0, 0], "4rem 8rem 0 0"]);
  assert.equal(c.css, "1rem 2rem", "data-value's unit, as a schema string's");
  assert.deepEqual([d.css, msgs], ["0", []], "a host with no sides at all starts at 0, quietly");
  assert.deepEqual([...holder.querySelectorAll(".tw-field-label")].map((l) => l.dataset.at).slice(0, 8), ["top", "right", "bottom", "left", "top-left", "top-right", "bottom-right", "bottom-left"]);
  holder.remove();
});

// The step defaulted to 1, so "0.5rem 1.25rem" came back "1rem" and "1.5em" "2em", from a schema and from markup.
test("no step: 1, or fine enough for each side's decimals, so a fractional default keeps its value", async () => {
  const p = await mount({ a: { type: "sides", value: "0.5rem 1.25rem" }, b: { type: "sides", value: "1.5em" }, c: { type: "sides", value: ".5rem" }, d: { type: "sides", value: "0.125rem" }, e: { type: "sides", value: 8 }, f: { type: "sides", value: "0.5rem", step: 1 } });
  const v = p.params;
  assert.deepEqual([four(v.a), v.a.css], [[0.5, 1.25, 0.5, 1.25], "0.5rem 1.25rem"]);
  assert.deepEqual([v.b.css, v.c.css, v.d.css], ["1.5em", "0.5rem", "0.125rem"]);
  const linked = p.el.querySelectorAll(".tw-sides")[1].querySelector(".tw-row .tw-num");
  linked.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  assert.equal(p.params.b.css, "1.6em", "an arrow moves by the inferred step");
  assert.deepEqual([v.e.css, v.f.css], ["8px", "1rem"], "whole sides step by 1, and an explicit step still wins");
  p.destroy();
  const holder = document.createElement("div"); document.body.append(holder);
  holder.innerHTML = '<div data-tw="sides" data-value="0.5rem 1rem"></div>';
  await enhance(holder);
  assert.equal(holder.querySelector('[data-tw="sides"]')._tw.ctrl.get().css, "0.5rem 1rem");
  holder.remove();
});
