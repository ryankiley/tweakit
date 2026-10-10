/* The motion control — one row for a transition's timing: an easing curve with a
 * duration, or a spring, switched inside its popover over one value that always carries
 * the CSS it resolves to. Runs against the built single-file bundle under jsdom; the
 * preview box is checked through a stubbed animate(). */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks, enhance } = await import(new URL("../dist/tweaks.js", import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let runs = [];
window.HTMLElement.prototype.animate = function (frames, opts) { runs.push({ el: this, frames, ...opts }); return { cancel() {} }; };
const mount = async (schema) => { runs = []; const p = tweaks("M", schema); document.body.append(p.el); await p.ready; return p; };
const open = async (p) => { const t = p.el.querySelector(".tw-motion .tw-trigger"); t.focus(); t.click(); await wait(40); const pop = document.body.querySelector(".tw-color-pop.is-open"); assert.ok(pop, "the popover is open"); return pop; };
const close = async (p) => { document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await wait(220); p.destroy(); };
const EASE = "cubic-bezier(0.25, 0.1, 0.25, 1)";

test("defaults: easing mode, the `ease` curve, 300 ms, and the CSS it resolves to", async () => {
  const p = await mount({ t: { type: "motion" } });
  assert.deepEqual(p.params.t, { mode: "easing", curve: [0.25, 0.1, 0.25, 1], duration: 300, easing: EASE });
  assert.equal(p.el.querySelector(".tw-motion .tw-trigger-value").textContent, "Easing · 300 ms");
  assert.match(p.el.querySelector(".tw-motion-chip path").getAttribute("d"), /^M10\.0,90\.0 L/, "the chip draws the curve from the origin");
  p.destroy();
});

test("a keyword curve and a duration author the easing; spring keys author a spring whose easing is a sampled linear()", async () => {
  const e = await mount({ t: { type: "motion", curve: "ease-out", duration: 240 } });
  assert.deepEqual(e.params.t, { mode: "easing", curve: [0, 0, 0.58, 1], duration: 240, easing: "cubic-bezier(0, 0, 0.58, 1)" });
  e.destroy();
  const s = await mount({ t: { type: "motion", stiffness: 300, damping: 26, mass: 1 } });
  const v = s.params.t;
  // Physics keys map to the nearest duration + bounce (exact when mass is 1), and the value carries the resolved physics back out.
  assert.equal(v.mode, "spring"); assert.ok(Math.abs(v.stiffness - 300) < 1e-6 && Math.abs(v.damping - 26) < 1e-6 && v.mass === 1, `the physics round-trips (${v.stiffness}, ${v.damping}, ${v.mass})`);
  assert.ok(Math.abs(v.visualDuration - 2 * Math.PI / Math.sqrt(300)) < 1e-9 && Math.abs(v.bounce - (1 - 26 / (2 * Math.sqrt(300)))) < 1e-9, `as a duration + bounce (${v.visualDuration}, ${v.bounce})`);
  const shown = [...s.el.querySelectorAll(".tw-spring .tw-fields")].find((f) => f.style.display !== "none");
  assert.match(shown.textContent, /Duration/); assert.match(shown.textContent, /Bounce/); assert.doesNotMatch(shown.textContent, /Stiffness/, "the spring inside is tuned by feel only — duration + bounce");
  assert.equal(v.duration, Math.round(7 / (26 / 2) * 1000), "the run lasts to within e^-7 of settled: 7 / (ζ·ω₀), uncapped");
  const stops = v.easing.match(/^linear\((.+)\)$/)[1].split(", ").map(Number);
  assert.equal(stops.length, 48); assert.ok(Math.abs(stops[0]) < 0.01 && Math.abs(stops[47] - 1) < 0.05, "from rest to settled");
  assert.equal(s.el.querySelector(".tw-motion .tw-trigger-value").textContent, `Spring · ${Math.round(v.visualDuration * 1000)} ms`, "the summary shows the authored duration, as the field does");
  s.destroy();
});

test("set(): infers the mode from the keys, takes a bare keyword, ignores derived fields, and keeps the easing duration across a spring round-trip", async () => {
  const p = await mount({ t: { type: "motion", duration: 500 } });
  p.set("t", { visualDuration: 0.3, bounce: 0.6 });
  assert.equal(p.params.t.mode, "spring");
  assert.ok(Math.max(...p.params.t.easing.match(/^linear\((.+)\)$/)[1].split(", ").map(Number)) > 1.1, "bounce 0.6 overshoots");
  p.set("t", p.params.t); // the full value, derived fields included, back in — a toJSON/fromJSON or changes() round-trip
  assert.equal(p.params.t.mode, "spring");
  p.set("t", "ease-in-out");
  assert.deepEqual(p.params.t, { mode: "easing", curve: [0.42, 0, 0.58, 1], duration: 500, easing: "cubic-bezier(0.42, 0, 0.58, 1)" }, "back to easing with the authored 500 ms, not the spring's derived duration");
  p.set("t", "garbage"); p.set("t", null); p.set("t", { curve: [NaN, 0, 1, 1] }); p.set("t", { mode: "nope" });
  assert.equal(p.params.t.easing, "cubic-bezier(0.42, 0, 0.58, 1)", "hostile input leaves the value alone");
  p.destroy();
});

test("the popover: Easing | Spring switches the editor and the mode; the preview box runs the value's easing on open and on every edit; reset restores the mode", async () => {
  const p = await mount({ t: { type: "motion", curve: "ease", duration: 300 } });
  const pop = await open(p);
  const seg = [...pop.querySelector(".tw-motion-body").children[0].querySelectorAll(".tw-seg-btn")]; // the mode switch is the body's first child (the spring editor below has its own Time | Physics pill)
  assert.deepEqual(seg.map((b) => b.textContent.trim()), ["Easing", "Spring"]);
  assert.equal(pop.querySelector(".tw-spring").closest(".tw-motion-pane").style.display, "none", "only the easing editor shows");
  const opened = runs.at(-1);
  assert.equal(opened.el, pop.querySelector(".tw-motion-box")); assert.equal(opened.easing, EASE); assert.equal(opened.duration, 300);
  seg[1].click();
  assert.equal(p.params.t.mode, "spring");
  assert.equal(pop.querySelector(".tw-bezier").closest(".tw-motion-pane").style.display, "none", "now only the spring editor shows");
  assert.match(runs.at(-1).easing, /^linear\(/, "the preview replayed with the spring's easing");
  assert.deepEqual(Object.keys(p.changes()), ["t"], "a mode switch is a change");
  p.reset();
  assert.equal(p.params.t.mode, "easing", "reset restores the authored mode");
  assert.equal(p.changes().t, undefined);
  await close(p);
});

test("markup: data-curve takes four numbers or a keyword, and the value is the same shape", async () => {
  const holder = document.createElement("div");
  holder.innerHTML = `<div data-tw="motion" data-label="Press" data-curve="0.42,0,1,1" data-duration="200"></div><div data-tw="motion" data-label="Pop" data-curve="ease-out"></div><div data-tw="motion" data-label="Boing" data-visual-duration="0.4" data-bounce="0.3"></div>`;
  document.body.append(holder);
  await enhance(holder);
  const [a, b, c] = [...holder.querySelectorAll('[data-tw="motion"]')].map((h) => h._tw.ctrl.get());
  assert.deepEqual(a, { mode: "easing", curve: [0.42, 0, 1, 1], duration: 200, easing: "cubic-bezier(0.42, 0, 1, 1)" });
  assert.deepEqual(b.curve, [0, 0, 0.58, 1], "a keyword curve");
  assert.equal(c.mode, "spring"); assert.equal(c.visualDuration, 0.4); assert.equal(c.bounce, 0.3);
  holder.remove();
});

test("review follow-ups: an out-of-range curve is emitted fitted, an off-grid duration snapped, a bad curve string keeps the mode, a bare 4-array is a curve", async () => {
  const p = await mount({ t: { type: "motion", curve: [2, 0, 0, 1], duration: 245 } });
  assert.deepEqual(p.params.t.curve, [1, 0, 0, 1], "x fitted into [0, 1]"); assert.equal(p.params.t.easing, "cubic-bezier(1, 0, 0, 1)");
  assert.equal(p.params.t.duration, 250, "snapped to the field's 10 ms grid");
  p.set("t", { curve: [0, 0, 1, 2] }); assert.equal(p.params.t.curve[3], 1.25, "y fitted into the editor's range");
  p.set("t", { duration: 1234.5 }); assert.equal(p.params.t.duration, 1230);
  p.set("t", [0.42, 0, 1, 1]); assert.deepEqual(p.params.t.curve, [0.42, 0, 1, 1]);
  p.set("t", { visualDuration: 0.3 }); assert.equal(p.params.t.mode, "spring");
  for (const bad of ["nonsense", { curve: "constructor" }, { curve: {} }, { duration: true }]) p.set("t", bad);
  assert.equal(p.params.t.mode, "spring", "a curve that doesn't parse is no reason to switch");
  p.destroy();
});

test("review follow-ups: a set() while the popover is closed shows on reopen, and set() no longer broadcasts tw-reflow", async () => {
  const p = await mount({ t: { type: "motion", curve: "ease", duration: 300 } });
  let reflows = 0; const count = () => reflows++; window.addEventListener("tw-reflow", count);
  let pop = await open(p);
  document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await wait(230); // closed, node detached
  p.set("t", { curve: "ease-in", duration: 500 });
  assert.equal(reflows, 0, "no page-wide reflow on a set()");
  pop = await open(p);
  assert.deepEqual([...pop.querySelectorAll(".tw-bezier-fields .tw-num")].map((i) => i.value), ["0.42", "0.00", "1.00", "1.00"], "the editor shows the value set while it was closed");
  assert.equal(pop.querySelector(".tw-num[aria-label^=Duration]").value, "500");
  window.removeEventListener("tw-reflow", count);
  await close(p);
});

test("review follow-ups: reset restores the mode you weren't looking at; the summary shows the authored duration", async () => {
  const p = await mount({ t: { type: "motion", curve: "ease-out", duration: 240 } });
  p.set("t", { mode: "spring", bounce: 0.9 }); p.set("t", { mode: "easing", duration: 400 });
  p.reset();
  assert.equal(p.params.t.duration, 240);
  p.set("t", { mode: "spring" });
  assert.equal(p.params.t.bounce, 0.2, "the spring side went back to its default too");
  assert.equal(p.el.querySelector(".tw-motion .tw-trigger-value").textContent, "Spring · 500 ms");
  p.destroy();
});

test("review follow-ups: the preview keeps its direction and finishes a run on edits, flips on a click; a bouncy spring's linear() ends at rest; the stage is a button; focus lands on the checked option", async () => {
  window.HTMLElement.prototype.animate = function (frames, opts) { runs.push({ el: this, frames, ...opts }); return { cancel() {}, playState: "running" }; };
  const p = await mount({ t: { type: "motion", visualDuration: 1, bounce: 0.9 } });
  const stops = p.params.t.easing.match(/^linear\((.+)\)$/)[1].split(", ").map(Number);
  assert.ok(Math.abs(stops.at(-1) - 1) < 0.002, `ends settled (${stops.at(-1)})`); assert.ok(stops.length > 48, `more stops for a long run (${stops.length})`);
  assert.ok(p.params.t.duration > 2200, "longer than the drawn window");
  const pop = await open(p);
  assert.equal(document.activeElement.getAttribute("aria-checked"), "true", "the checked Type option takes focus on open");
  const n = runs.length, lastFrom = runs.at(-1).frames[0].transform;
  p.set("t", { bounce: 0.5 }); p.set("t", { bounce: 0.4 });
  assert.equal(runs.length, n, "edits don't restart a run in flight");
  const stage = pop.querySelector(".tw-motion-stage");
  Object.defineProperty(stage, "clientWidth", { value: 200 }); // jsdom lays out nothing: give the stage a width so the two directions differ
  assert.equal(stage.getAttribute("role"), "button"); assert.equal(stage.tabIndex, 0);
  stage.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.equal(runs.length, n + 1, "Enter on the stage replays"); assert.notEqual(runs.at(-1).frames[0].transform, lastFrom, "and flips the direction");
  window.HTMLElement.prototype.animate = function (frames, opts) { runs.push({ el: this, frames, ...opts }); return { cancel() {} }; };
  await close(p);
});
