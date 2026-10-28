/* The motion control — one row for a transition's timing: an easing curve with a
 * duration, or a spring, switched inside its popover over one value that always carries
 * the CSS it resolves to. Runs against the built single-file bundle under jsdom; the
 * preview box is checked through a stubbed animate(). */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, wait, mounter, warnings, ptr } from "./_helpers.mjs";

const { tweaks, enhance } = await loadSingle();
let runs = [];
window.HTMLElement.prototype.animate = function (frames, opts) { runs.push({ el: this, frames, ...opts }); return { cancel() {} }; };
const mountPanel = mounter(tweaks, "M");
const mount = (schema) => { runs = []; return mountPanel(schema); };
const open = async (p) => { const t = p.el.querySelector(".twk-motion .twk-trigger"); t.focus(); t.click(); await wait(40); const pop = document.body.querySelector(".twk-color-pop.is-open"); assert.ok(pop, "the popover is open"); return pop; };
const close = async (p) => { document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await wait(220); p.destroy(); };
const EASE = "cubic-bezier(0.25, 0.1, 0.25, 1)";

test("defaults: easing mode, the `ease` curve, 300 ms, and the CSS it resolves to", async () => {
  const p = await mount({ t: { type: "motion" } });
  assert.deepEqual(p.params.t, { mode: "easing", curve: [0.25, 0.1, 0.25, 1], duration: 300, easing: EASE });
  assert.equal(p.el.querySelector(".twk-motion .twk-trigger-value").textContent, "Easing · 300 ms");
  assert.match(p.el.querySelector(".twk-motion-chip path").getAttribute("d"), /^M10\.0,90\.0 L/, "the chip draws the curve from the origin");
  p.destroy();
});

test("a keyword curve and a duration author the easing; spring keys author a spring whose easing is a sampled linear()", async () => {
  const e = await mount({ t: { type: "motion", curve: "ease-out", duration: 240 } });
  assert.deepEqual(e.params.t, { mode: "easing", curve: [0, 0, 0.58, 1], duration: 240, easing: "cubic-bezier(0, 0, 0.58, 1)" });
  e.destroy();
  const s = await mount({ t: { type: "motion", stiffness: 300, damping: 26, mass: 1 } });
  const v = s.params.t;
  // Physics keys map to the duration + bounce Motion would resolve them from (its period is visualDuration × 1.2), and the value carries the resolved physics back out.
  assert.equal(v.mode, "spring"); assert.ok(Math.abs(v.stiffness - 300) < 1e-6 && Math.abs(v.damping - 26) < 1e-6 && v.mass === 1, `the physics round-trips (${v.stiffness}, ${v.damping}, ${v.mass})`);
  assert.ok(Math.abs(v.visualDuration - 2 * Math.PI / (1.2 * Math.sqrt(300))) < 1e-9 && Math.abs(v.bounce - (1 - 26 / (2 * Math.sqrt(300)))) < 1e-9, `as a duration + bounce (${v.visualDuration}, ${v.bounce})`);
  const shown = [...s.el.querySelectorAll(".twk-spring .twk-fields")].find((f) => f.style.display !== "none");
  assert.match(shown.textContent, /Duration/); assert.match(shown.textContent, /Bounce/); assert.doesNotMatch(shown.textContent, /Stiffness/, "the spring inside is tuned by feel only — duration + bounce");
  assert.equal(v.duration, Math.round(7 / (26 / 2) * 1000), "the run lasts to within e^-7 of settled: 7 / (ζ·ω₀), uncapped");
  const stops = v.easing.match(/^linear\((.+)\)$/)[1].split(", ").map(parseFloat);
  assert.ok(stops.length >= 48, `${stops.length} stops`); assert.ok(Math.abs(stops[0]) < 0.01 && Math.abs(stops.at(-1) - 1) < 0.05, "from rest to settled");
  assert.equal(s.el.querySelector(".twk-motion .twk-trigger-value").textContent, `Spring · ${Math.round(v.visualDuration * 1000)} ms`, "the summary shows the authored duration, as the field does");
  s.destroy();
});

test("set(): infers the mode from the keys, takes a bare keyword, ignores derived fields, and keeps the easing duration across a spring round-trip", async () => {
  const p = await mount({ t: { type: "motion", duration: 500 } });
  p.set("t", { visualDuration: 0.3, bounce: 0.6 });
  assert.equal(p.params.t.mode, "spring");
  assert.ok(Math.max(...p.params.t.easing.match(/^linear\((.+)\)$/)[1].split(", ").map(parseFloat)) > 1.1, "bounce 0.6 overshoots");
  // the full value, derived fields included, back in — a toJSON/fromJSON or changes() round-trip
  p.set("t", p.params.t);
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
  // the mode switch is the body's first child (the spring editor below has its own Time | Physics pill)
  const seg = [...pop.querySelector(".twk-motion-body").children[0].querySelectorAll(".twk-seg-btn")];
  assert.deepEqual(seg.map((b) => b.textContent.trim()), ["Easing", "Spring"]);
  assert.equal(pop.querySelector(".twk-spring").closest(".twk-motion-pane").style.display, "none", "only the easing editor shows");
  const opened = runs.at(-1);
  assert.equal(opened.el, pop.querySelector(".twk-motion-box")); assert.equal(opened.easing, EASE); assert.equal(opened.duration, 300);
  seg[1].click();
  assert.equal(p.params.t.mode, "spring");
  assert.equal(pop.querySelector(".twk-bezier").closest(".twk-motion-pane").style.display, "none", "now only the spring editor shows");
  assert.match(runs.at(-1).easing, /^linear\(/, "the preview replayed with the spring's easing");
  assert.deepEqual(Object.keys(p.changes()), ["t"], "a mode switch is a change");
  p.reset();
  assert.equal(p.params.t.mode, "easing", "reset restores the authored mode");
  assert.equal(p.changes().t, undefined);
  await close(p);
});

test("markup: data-curve takes four numbers or a keyword, and the value is the same shape", async () => {
  const holder = document.createElement("div");
  holder.innerHTML = `<div data-twk="motion" data-label="Press" data-curve="0.42,0,1,1" data-duration="200"></div><div data-twk="motion" data-label="Pop" data-curve="ease-out"></div><div data-twk="motion" data-label="Boing" data-visual-duration="0.4" data-bounce="0.3"></div>`;
  document.body.append(holder);
  await enhance(holder);
  const [a, b, c] = [...holder.querySelectorAll('[data-twk="motion"]')].map((h) => h._tw.ctrl.get());
  assert.deepEqual(a, { mode: "easing", curve: [0.42, 0, 1, 1], duration: 200, easing: "cubic-bezier(0.42, 0, 1, 1)" });
  assert.deepEqual(b.curve, [0, 0, 0.58, 1], "a keyword curve");
  assert.equal(c.mode, "spring"); assert.equal(c.visualDuration, 0.4); assert.equal(c.bounce, 0.3);
  holder.remove();
});

test("review follow-ups: an out-of-range curve is emitted fitted, an off-grid duration snapped, a bad curve string keeps the mode, a bare 4-array is a curve", async () => {
  const p = await mount({ t: { type: "motion", curve: [2, 0, 0, 1], duration: 245 } });
  assert.deepEqual(p.params.t.curve, [1, 0, 0, 1], "x fitted into [0, 1]"); assert.equal(p.params.t.easing, "cubic-bezier(1, 0, 0, 1)");
  assert.equal(p.params.t.duration, 250, "snapped to the field's 10 ms grid");
  p.set("t", { curve: [0, 0, 1, 3] }); assert.equal(p.params.t.curve[3], 2, "y fitted into the editor's range, −1 to 2");
  p.set("t", { duration: 1234.5 }); assert.equal(p.params.t.duration, 1230);
  p.set("t", [0.42, 0, 1, 1]); assert.deepEqual(p.params.t.curve, [0.42, 0, 1, 1]);
  p.set("t", { visualDuration: 0.3 }); assert.equal(p.params.t.mode, "spring");
  for (const bad of ["nonsense", { curve: "constructor" }, { curve: {} }, { duration: true }]) p.set("t", bad);
  assert.equal(p.params.t.mode, "spring", "a curve that doesn't parse is no reason to switch");
  p.destroy();
});

test("review follow-ups: a set() while the popover is closed shows on reopen, and set() no longer broadcasts twk-reflow", async () => {
  const p = await mount({ t: { type: "motion", curve: "ease", duration: 300 } });
  let reflows = 0; const count = () => reflows++; window.addEventListener("twk-reflow", count);
  let pop = await open(p);
  // closed, node detached
  document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await wait(230);
  p.set("t", { curve: "ease-in", duration: 500 });
  assert.equal(reflows, 0, "no page-wide reflow on a set()");
  pop = await open(p);
  assert.deepEqual([...pop.querySelectorAll(".twk-bezier-fields .twk-num")].map((i) => i.value), ["0.42", "0.00", "1.00", "1.00"], "the editor shows the value set while it was closed");
  assert.equal(pop.querySelector(".twk-num[aria-label^=Duration]").value, "500");
  window.removeEventListener("twk-reflow", count);
  await close(p);
});

test("review follow-ups: reset restores the mode you weren't looking at; the summary shows the authored duration", async () => {
  const p = await mount({ t: { type: "motion", curve: "ease-out", duration: 240 } });
  p.set("t", { mode: "spring", bounce: 0.9 }); p.set("t", { mode: "easing", duration: 400 });
  p.reset();
  assert.equal(p.params.t.duration, 240);
  p.set("t", { mode: "spring" });
  assert.equal(p.params.t.bounce, 0.2, "the spring side went back to its default too");
  assert.equal(p.el.querySelector(".twk-motion .twk-trigger-value").textContent, "Spring · 500 ms");
  p.destroy();
});

test("review follow-ups: the preview keeps its direction and finishes a run on edits, flips on a click; a bouncy spring's linear() ends at rest; the stage is a button; focus lands on the checked option", async () => {
  window.HTMLElement.prototype.animate = function (frames, opts) { runs.push({ el: this, frames, ...opts }); return { cancel() {}, playState: "running" }; };
  const p = await mount({ t: { type: "motion", visualDuration: 1, bounce: 0.9 } });
  const stops = p.params.t.easing.match(/^linear\((.+)\)$/)[1].split(", ").map(parseFloat);
  assert.ok(Math.abs(stops.at(-1) - 1) < 0.002, `ends settled (${stops.at(-1)})`); assert.ok(stops.length > 48, `more stops for a long run (${stops.length})`);
  assert.ok(p.params.t.duration > 2200, "longer than the drawn window");
  const pop = await open(p);
  assert.equal(document.activeElement.getAttribute("aria-checked"), "true", "the checked Type option takes focus on open");
  const n = runs.length, lastFrom = runs.at(-1).frames[0].transform;
  p.set("t", { bounce: 0.5 }); p.set("t", { bounce: 0.4 });
  assert.equal(runs.length, n, "edits don't restart a run in flight");
  const stage = pop.querySelector(".twk-motion-stage");
  // jsdom lays out nothing: give the stage a width so the two directions differ
  Object.defineProperty(stage, "clientWidth", { value: 200 });
  assert.equal(stage.getAttribute("role"), "button"); assert.equal(stage.tabIndex, 0);
  stage.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.equal(runs.length, n + 1, "Enter on the stage replays"); assert.notEqual(runs.at(-1).frames[0].transform, lastFrom, "and flips the direction");
  window.HTMLElement.prototype.animate = function (frames, opts) { runs.push({ el: this, frames, ...opts }); return { cancel() {} }; };
  await close(p);
});

test("review follow-up: `value` as a bare keyword or 4-tuple is the curve on the schema path, as set() takes it", async () => {
  const k = await mount({ t: { type: "motion", value: "ease-out", duration: 200 } });
  assert.deepEqual(k.params.t, { mode: "easing", curve: [0, 0, 0.58, 1], duration: 200, easing: "cubic-bezier(0, 0, 0.58, 1)" });
  k.destroy();
  const a = await mount({ t: { type: "motion", value: [0.42, 0, 1, 1] } });
  assert.deepEqual(a.params.t.curve, [0.42, 0, 1, 1]);
  a.destroy();
});

test("a spring's physics round-trips clean: stiffness 300 comes back 300, not 300.00000000000006", async () => {
  const p = tweaks("Noise", { m: { type: "motion", stiffness: 300, damping: 20 }, s: { type: "spring", stiffness: 300, damping: 20 } });
  document.body.append(p.el); await p.ready;
  for (const k of ["m", "s"]) {
    assert.equal(p.params[k].stiffness, 300, `${k}: stiffness`);
    assert.equal(p.params[k].damping, 20, `${k}: damping`);
  }
  p.set("m", { stiffness: 500, damping: 25 });
  const c = p.changes().m;
  assert.equal(c.stiffness, 500, "changes() carries the stiffness as set");
  assert.equal(c.damping, 25, "and the damping");
  p.destroy();
});

// Time mode mapped visualDuration to stiffness without Motion's ×1.2, so a spring tuned here played ~18% faster than the same
// { visualDuration, bounce } in Motion, and it clamped bounce to 0–1 and the result through the physics pad's limits.
// The expected numbers come from running motion-dom's own spring.ts (bounceToDampingRatio, overdampedFreqScale and the
// visualDuration branch of getSpringOptions) on each pair, not from this kit's code.
const MOTION = [[0.3, 0, 304.6174198, 34.90658504], [0.5, 0.2, 109.6622711, 16.75516082], [0.8, 0.4, 42.83682466, 7.853981634],
  [0.5, 0.97, 109.6622711, 1.047197551], [0.4, -0.5, 1054.319822, 129.8811655], [0.6, -1, 51503.17038, 9077.723977]];
const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.abs(b);
test("a time-mode spring resolves to the stiffness and damping Motion gives the same visualDuration and bounce", async () => {
  for (const [visualDuration, bounce, k, d] of MOTION) {
    const p = tweaks("M", { s: { type: "spring", mode: "time", visualDuration, bounce } }); await p.ready;
    const v = p.params.s;
    assert.ok(near(v.stiffness, k) && near(v.damping, d) && v.mass === 1, `${visualDuration}s, bounce ${bounce}: got k ${v.stiffness}, d ${v.damping}; Motion ${k}, ${d}`);
    assert.equal(v.bounce, bounce, "a negative bounce and one near 1 are kept, as Motion takes them");
    p.destroy();
  }
});
// Past ±0.95 the damping ratio sits at its floor, so a bounce there reads back as ±0.95.
test("physics keys handed to a motion control read back as the visualDuration and bounce Motion resolves them from", async () => {
  for (const [visualDuration, bounce, stiffness, damping] of MOTION.filter(([, b]) => Math.abs(b) < 0.95)) {
    const p = tweaks("M", { m: { type: "motion", mode: "spring", stiffness, damping } }); await p.ready;
    const v = p.params.m;
    assert.ok(Math.abs(v.visualDuration - visualDuration) < 1e-6 && Math.abs(v.bounce - bounce) < 1e-6, `k ${stiffness}, d ${damping}: got ${v.visualDuration}s, bounce ${v.bounce}`);
    p.destroy();
  }
});

// A spring's linear() took its stops from the duration alone, so the bouncier the spring the fewer each wobble got: 3.4 a
// cycle and 36% off at the extreme, over a 14 s run. Checked here against the closed-form response, at 2000 points.
const exact = (k, d, m) => { const w0 = Math.sqrt(k / m), z = d / (2 * Math.sqrt(k * m)), wd = w0 * Math.sqrt(1 - z * z); return (t) => 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t)); };
const easeAt = (easing, f) => { const pts = easing.slice(7, -1).split(", ").map((s) => s.split(" ").map(parseFloat)); for (let i = 1; i < pts.length; i++) if (f <= pts[i][1] / 100) { const [y0, p0] = pts[i - 1], [y1, p1] = pts[i]; return y0 + ((y1 - y0) * (f * 100 - p0)) / (p1 - p0 || 1); } return pts.at(-1)[0]; };
test("a spring's linear() easing follows the spring within 1% however bouncy, and the run stops at 10 s", async () => {
  for (const bounce of [0.2, 0.6, 0.8, 0.95]) {
    const p = tweaks("Run", { m: { type: "motion", mode: "spring", visualDuration: 0.5, bounce } }); await p.ready;
    const v = p.params.m, x = exact(v.stiffness, v.damping, v.mass), T = v.duration / 1000;
    let worst = 0; for (let i = 0; i <= 2000; i++) { const f = i / 2000; if (f < 0.999) worst = Math.max(worst, Math.abs(easeAt(v.easing, f) - x(f * T))); }
    assert.ok(worst < 0.01, `bounce ${bounce}: off by ${(worst * 100).toFixed(2)}%`);
    assert.ok(v.duration <= 10000, `bounce ${bounce}: ${v.duration} ms`);
    assert.match(v.easing, /, 1 100%\)$/, "and it ends at rest");
    p.destroy();
  }
});

// The preview window ran to the settle of ζω₀, an overdamped spring's fast root: at bounce −1 it spanned 1.6 ms and the
// chip drew a flat line ending at 0.011. With no overshoot the chip scales y from 90 (at 0) to 10 (at rest), so it ends near 10.
test("an overdamped spring's preview curve runs until it settles, as a critically damped one's does", async () => {
  for (const bounce of [-1, -0.5, -0.05, 0]) {
    const p = tweaks("Pre", { m: { type: "motion", mode: "spring", visualDuration: 0.5, bounce } }); await p.ready;
    const end = +p.el.querySelector(".twk-motion-chip path").getAttribute("d").split(",").at(-1);
    assert.ok(end < 11, `bounce ${bounce}: the curve ends at y ${end}, short of rest`);
    p.destroy();
  }
});

// The editor clamped visualDuration to 0.1–1 s, so a motion's physics came back rewritten (stiffness 15 as 27.4, 5000 as
// 2741) and a spring's visualDuration 2 as 1, without a word.
test("authored springs survive: physics a host wrote come back as written, and a visualDuration up to 10 s is kept", async () => {
  const w = await warnings(async () => {
    for (const [stiffness, damping, mass] of [[15, 3, 1], [5000, 100, 1], [300, 20, 2], [100, 0.5, 1], [0.1, 0.2, 1]]) {
      const p = await mount({ m: { type: "motion", stiffness, damping, mass } });
      const v = p.params.m;
      assert.deepEqual([v.stiffness, v.damping, v.mass], [stiffness, damping, mass], `k ${stiffness}, d ${damping}, m ${mass}`);
      p.set("m", JSON.parse(JSON.stringify(v))); // its own value back, as a restore hands it
      assert.deepEqual([p.params.m.stiffness, p.params.m.damping, p.params.m.mass], [stiffness, damping, mass], "and after a round trip");
      p.destroy();
    }
  });
  assert.equal(w.length, 2, `one notice each for the two the editor can't draw: ${w.join(" | ")}`);
  assert.match(w[0], /"m": a spring of stiffness 100, damping 0\.5, mass 1 is past what the editor draws.*keeps it as written/);
  for (const visualDuration of [2, 9.5]) {
    const p = await mount({ m: { type: "motion", visualDuration, bounce: 0.2 }, s: { type: "spring", visualDuration } });
    assert.equal(p.params.m.visualDuration, visualDuration); assert.equal(p.params.s.visualDuration, visualDuration);
    assert.ok(Math.abs(p.params.s.stiffness - (2 * Math.PI / (1.2 * visualDuration)) ** 2) < 1e-6, "resolved from the duration as written");
    p.destroy();
  }
  let p;
  const past = await warnings(async () => { p = await mount({ s: { type: "spring", visualDuration: 20 } }); });
  assert.equal(p.params.s.visualDuration, 10); assert.equal(past.length, 1); assert.match(past[0], /"s": a spring visualDuration of 20 s is past the editor's 0\.01–10 s, so it uses 10 s/);
  p.destroy();
  // An edit in the editor tunes from what it shows, dropping the kept physics.
  p = await mount({ m: { type: "motion", stiffness: 15, damping: 3 } });
  const bounce = p.el.querySelector('.twk-spring input[aria-label="Bounce (%)"]');
  bounce.value = "10"; bounce.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(p.params.m.bounce, 0.1); assert.ok(Math.abs(p.params.m.visualDuration - 1.3519262) < 1e-6, "at the kept spring's duration");
  p.reset(); assert.equal(p.params.m.stiffness, 15, "reset brings the written physics back");
  p.destroy();
});

// The drag mapped the preview's height to bounce 0–100% only, though a negative bounce (overdamped) is valid since #222.
test("dragging a time-mode spring's preview spans bounce −100% to 100%, the middle 0", async () => {
  const p = await mount({ s: { type: "spring", visualDuration: 0.5, bounce: 0.2 } });
  const viz = p.el.querySelector(".twk-spring-viz");
  viz.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 });
  viz.setPointerCapture = () => {};
  const at = (y) => { viz.dispatchEvent(ptr("pointerdown", { clientX: 100, clientY: y })); viz.dispatchEvent(ptr("pointerup", { clientX: 100, clientY: y })); return p.params.s.bounce; };
  assert.equal(at(0), 1, "top"); assert.equal(at(50), 0, "middle"); assert.equal(at(100), -1, "bottom");
  assert.equal(at(75), -0.5); assert.ok(p.params.s.damping > 2 * Math.sqrt(p.params.s.stiffness), "a negative bounce overdamps");
  p.destroy();
});
