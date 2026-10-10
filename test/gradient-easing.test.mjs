/* The gradient control's easing — the menu beside the mode, the value it emits, what
 * set() / reset do with it, and the guarantee that the bar draws exactly what gradientCss()
 * returns for the emitted value. Runs against the built single-file bundle under jsdom. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks, gradientCss } = await import(new URL("../dist/tweaks.js", import.meta.url));
// jsdom's CSS parser doesn't know color-mix(), so an eased ramp assigned to style.background
// reads back as "" there (a browser takes it). Capture the assignment itself instead: the
// bar's painter writes `grad.style.background = css`, so an own-property accessor on that
// style object sees exactly the string the editor drew with.
const barCss = (p) => {
  const style = p.el.querySelector(".tw-gradient-grad").style;
  if (!Object.getOwnPropertyDescriptor(style, "background")) {
    let last = style.background; Object.defineProperty(style, "background", { configurable: true, get: () => last, set: (v) => { last = v; } });
    p.el.querySelector(".tw-gradient-ease").dispatchEvent(new Event("change", { bubbles: true })); // repaint through the accessor
  }
  return String(style.background);
};
const easeSel = (p) => p.el.querySelector(".tw-gradient-ease");
const pick = (sel, v) => { sel.value = v; sel.dispatchEvent(new Event("change", { bubbles: true })); };

test("the tweakit/gradient-css entry builds, exports exactly the two helpers, and ships its types", async () => {
  const { readFile } = await import("node:fs/promises");
  const entry = await import(new URL("../dist/gradient-css.js", import.meta.url));
  assert.deepEqual(Object.keys(entry).sort(), ["gradientCss", "gradientStops"]);
  assert.equal(entry.gradientCss({ stops: [{ color: "red", pos: 0 }, { color: "blue", pos: 1 }] }), gradientCss({ stops: [{ color: "red", pos: 0 }, { color: "blue", pos: 1 }] }), "the entry and the single-file export agree");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const exp = pkg.exports["./gradient-css"];
  for (const rel of [exp.import, exp.default, exp.types]) await readFile(new URL("../" + rel, import.meta.url)); // every mapped path exists in the build
  assert.ok(pkg.files.includes("dist/gradient-css.js"), "the entry ships in the tarball");
  const dts = await readFile(new URL("../" + exp.types, import.meta.url), "utf8");
  assert.ok(/gradientCss/.test(dts) && !/easingSamples/.test(dts), "the entry's types expose the two helpers, not the editor's samplers");
});

test("an unrecognised easing warns once and reads as linear", () => {
  const warned = []; const orig = console.warn; console.warn = (...a) => { const m = a.join(" "); if (m.startsWith("[tweaks]")) warned.push(m); }; // the kit's own warnings only — jsdom's CSS parser also warns when it gives up on the long eased background
  try {
    const p = tweaks("G", { g: { type: "gradient", value: { stops: [{ color: "red", pos: 0 }, { color: "blue", pos: 1 }], easing: "steps(4)" } } });
    assert.equal(p.params.g.easing, "linear");
    assert.equal(warned.length, 1); assert.match(warned[0], /unrecognised easing "steps\(4\)"/);
    tweaks("G", { g: { type: "gradient", value: { stops: [{ color: "red", pos: 0 }, { color: "blue", pos: 1 }], easing: "Linear" } } });
    tweaks("G", { g: { type: "gradient", value: { stops: [{ color: "red", pos: 0 }, { color: "blue", pos: 1 }], easing: "cubic-bezier(.42,0,.58,1)" } } });
    assert.equal(warned.length, 1, "a spelled-out linear and a valid bezier don't warn");
  } finally { console.warn = orig; }
});

test("a gradient emits easing: linear by default, and its bar is gradientCss(value) verbatim", () => {
  const p = tweaks("G", { g: { type: "gradient" } });
  assert.equal(p.params.g.easing, "linear");
  assert.equal(barCss(p), gradientCss(p.params.g));
  assert.equal((barCss(p).match(/color-mix\(/g) || []).length, 0, "linear draws the plain stops");
});

test("the easing menu sits beside the mode select, lists the CSS keywords, and a pick re-emits + repaints", () => {
  const p = tweaks("G", { g: { type: "gradient", value: [["#ff0000", 0], ["#0000ff", 1]] } });
  const sel = easeSel(p);
  assert.ok(sel && sel.tagName === "SELECT");
  assert.equal(sel.previousElementSibling.className, "tw-color-mode", "right after the mode select, in the picker's mode row");
  assert.deepEqual([...sel.options].map((o) => o.value), ["linear", "ease", "ease-in", "ease-out", "ease-in-out"]);
  let emitted = 0; p.on(() => emitted++);
  pick(sel, "ease-in-out");
  assert.equal(emitted, 1);
  assert.equal(p.params.g.easing, "ease-in-out");
  assert.equal(barCss(p), gradientCss(p.params.g), "the bar draws the eased ramp the host gets");
  assert.equal((barCss(p).match(/color-mix\(/g) || []).length, 14);
  assert.ok(barCss(p).includes("color-mix(in oklch, #ff0000, #0000ff"), "samples mix in the value's blend space");
});

test("a value carrying easing opens on it; a keyword's bezier canonicalises; an unknown bezier shows as Custom", () => {
  const p = tweaks("G", {
    a: { type: "gradient", value: { stops: [{ color: "red", pos: 0 }, { color: "blue", pos: 1 }], easing: "ease-out" } },
    b: { type: "gradient", value: { stops: [{ color: "red", pos: 0 }, { color: "blue", pos: 1 }], easing: "cubic-bezier(0.42,0,0.58,1)" } },
    c: { type: "gradient", value: { stops: [{ color: "red", pos: 0 }, { color: "blue", pos: 1 }], easing: "cubic-bezier(0.3, 0, 0.7, 1)" } },
    d: { type: "gradient", value: { stops: [{ color: "red", pos: 0 }, { color: "blue", pos: 1 }], easing: "bogus) url(x" } },
  });
  assert.equal(p.params.a.easing, "ease-out"); assert.equal(p.el.querySelectorAll(".tw-gradient-ease")[0].value, "ease-out");
  assert.equal(p.params.b.easing, "ease-in-out");
  assert.equal(p.params.c.easing, "cubic-bezier(0.3, 0, 0.7, 1)");
  const selC = p.el.querySelectorAll(".tw-gradient-ease")[2];
  assert.equal(selC.value, "cubic-bezier(0.3, 0, 0.7, 1)");
  assert.equal(selC.selectedOptions[0].textContent, "Custom");
  assert.equal(p.params.d.easing, "linear", "garbage reads as linear");
  assert.ok(!barCss({ el: p.el.querySelectorAll(".tw-gradient")[3] }).includes("url("), "and never reaches the CSS");
  // Picking a keyword on the custom one drops the Custom option; it comes back only for a custom value.
  pick(selC, "ease");
  assert.equal(p.params.c.easing, "ease");
  assert.equal([...selC.options].length, 5);
});

test("set() applies an easing it names and leaves one it doesn't; reset returns to the opened form", () => {
  const p = tweaks("G", { g: { type: "gradient", value: [["#ff0000", 0], ["#0000ff", 1]] } });
  p.set("g", { stops: [{ color: "red", pos: 0 }, { color: "blue", pos: 1 }], easing: "ease-in" });
  assert.equal(p.params.g.easing, "ease-in"); assert.equal(easeSel(p).value, "ease-in");
  p.set("g", { stops: [{ color: "lime", pos: 0 }, { color: "blue", pos: 1 }] }); // stops only — a host mirror-back without easing
  assert.equal(p.params.g.easing, "ease-in", "left as set, not silently reset");
  assert.equal(p.params.g.stops[0].color, "lime");
  p.reset();
  assert.equal(p.params.g.easing, "linear", "reset restores the form the control opened on");
  assert.equal(easeSel(p).value, "linear");
});

test("toJSON / fromJSON round-trip easing", () => {
  const a = tweaks("G", { g: { type: "gradient" } });
  pick(easeSel(a), "ease-in-out");
  const b = tweaks("G", { g: { type: "gradient" } });
  b.fromJSON(a.toJSON());
  assert.equal(b.params.g.easing, "ease-in-out"); assert.equal(easeSel(b).value, "ease-in-out");
});

test("a stop added to an eased ramp samples the eased colour, so it lands on the ramp the bar draws", () => {
  // Black → white, ease-in-out: at 25% the eased ramp is well below the straight blend's 25% grey.
  const lin = tweaks("G", { g: { type: "gradient", value: { stops: [{ color: "#000000", pos: 0 }, { color: "#ffffff", pos: 1 }] } } });
  const eas = tweaks("G", { g: { type: "gradient", value: { stops: [{ color: "#000000", pos: 0 }, { color: "#ffffff", pos: 1 }], easing: "ease-in-out" } } });
  const L = (p) => +/oklch\(([\d.]+)/.exec(p.params.g.stops[1].color)[1];
  for (const p of [lin, eas]) {
    const first = p.el.querySelector(".tw-gradient-stop"); first.focus(); // select the first stop
    const bar = p.el.querySelector(".tw-gradient-bar");
    bar.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, bottom: 28, right: 100, height: 28 });
    p.el.querySelector(".tw-gradient-rail").getBoundingClientRect = bar.getBoundingClientRect;
    bar.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true, clientX: 25, clientY: 14 }));
    assert.equal(p.params.g.stops.length, 3);
    assert.ok(Math.abs(p.params.g.stops[1].pos - 0.25) < 1e-6);
  }
  assert.ok(L(eas) < L(lin) - 0.08, `eased insert ${L(eas)} should be darker than linear ${L(lin)}`);
});
