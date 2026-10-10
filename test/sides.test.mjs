/* The sides control: four numbers in CSS order plus the shorthand they collapse to; linked
 * (one field for all four) or unlinked (four fields); every input form; hostile input;
 * markup. Runs against the built single-file bundle under jsdom. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks, enhance } = await import(new URL("../dist/tweaks.js", import.meta.url));
const mount = async (schema) => { const p = tweaks("B", schema); document.body.append(p.el); await p.ready; return p; };
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
  p.destroy();
});

test("linked by default when the four agree; the link button opens the fields; linking takes the first side", async () => {
  const p = await mount({ pad: { type: "sides", value: 8 } });
  const root = p.el.querySelector(".tw-sides"), row = root.querySelector(":scope > .tw-row"), link = row.querySelector(".tw-sides-link");
  assert.ok(root.classList.contains("is-linked")); assert.equal(link.getAttribute("aria-pressed"), "true");
  assert.equal(row.querySelector(".tw-num").value, "8"); assert.match(row.querySelector(".tw-num").getAttribute("aria-label"), /^pad/i);
  link.click();
  assert.ok(!root.classList.contains("is-linked"), "unlinked: the four fields show");
  const flds = [...root.querySelectorAll(".tw-sides-multi .tw-num")]; assert.equal(flds.length, 4); assert.deepEqual(flds.map((f) => f.value), ["8", "8", "8", "8"]);
  assert.deepEqual([...root.querySelectorAll(".tw-field-label")].map((l) => l.textContent), ["T", "R", "B", "L"]);
  assert.equal(document.activeElement, root.querySelector(".tw-sides-multi .tw-sides-link"), "focus moves to the link in the block that is now showing");
  flds[1].value = "20"; flds[1].dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.deepEqual(four(p.params.pad), [8, 20, 8, 8]); assert.equal(p.params.pad.css, "8px 20px 8px 8px"); assert.equal(root.querySelector(".tw-sides-sum").textContent, "8 20 8 8");
  root.querySelector(".tw-sides-multi .tw-sides-link").click();
  assert.ok(root.classList.contains("is-linked")); assert.deepEqual(four(p.params.pad), [8, 8, 8, 8], "linking takes the first side");
  p.destroy();
});

test("set() in any form re-judges the link; corners relabel the fields; min/max fit the value; hostile input is ignored", async () => {
  const p = await mount({ r: { type: "sides", value: 16, corners: true, min: 0, max: 48 } });
  const root = p.el.querySelector(".tw-sides");
  assert.deepEqual([...root.querySelectorAll(".tw-field-label")].map((l) => l.textContent), ["TL", "TR", "BR", "BL"]);
  p.set("r", [1, 2, 3, 4]); assert.ok(!root.classList.contains("is-linked"), "unequal sides unlink"); assert.deepEqual(four(p.params.r), [1, 2, 3, 4]);
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
  holder.innerHTML = `<div data-tw="sides" data-label="Pad" data-value="8px 16px"></div><div data-tw="sides" data-label="Round" data-corners="true" data-top="4" data-right="8" data-unit="rem"></div>`;
  await enhance(holder);
  const [a, b] = [...holder.querySelectorAll('[data-tw="sides"]')].map((h) => h._tw.ctrl.get());
  assert.deepEqual([four(a), a.css], [[8, 16, 8, 16], "8px 16px"]);
  assert.deepEqual([four(b), b.css], [[4, 8, 0, 0], "4rem 8rem 0 0"]);
  assert.deepEqual([...holder.querySelectorAll(".tw-field-label")].map((l) => l.textContent).slice(4), ["TL", "TR", "BR", "BL"]);
  holder.remove();
});
