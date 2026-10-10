/* Every keyboard-reachable element in the kit shows a focus ring: each focusable node of a
 * panel built with every control (popover contents included, they are in the DOM closed)
 * must be matched by some `:focus-visible` rule in the built stylesheet, directly or as the
 * inner part of a `:has(…:focus-visible)` rule on an ancestor. Runs against dist/ (the
 * single-file bundle and tweaks.css) under jsdom, so it is a coverage check, not a paint check. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));
const css = readFileSync(new URL("../dist/tweaks.css", import.meta.url), "utf8");

// Every selector list in the stylesheet that names :focus-visible, split into its selectors.
const selectors = [...css.matchAll(/([^{}]+)\{[^}]*\}/g)].map((m) => m[1]).filter((s) => s.includes(":focus-visible"))
  .flatMap((s) => s.split(",").map((x) => x.trim()).filter((x) => x.includes(":focus-visible")));
const strip = (s) => s.replace(/:focus-visible/g, "").replace(/:not\([^)]*\)/g, "").trim();
// A selector covers an element when the element matches it with the pseudo-classes removed,
// or, for `outer:has(inner:focus-visible)`, when the element matches inner inside an outer.
const covers = (sel, el) => {
  const has = sel.indexOf(":has(");
  if (has < 0) { try { return el.matches(strip(sel)); } catch { return false; } }
  const outer = sel.slice(0, has).trim(), inner = strip(sel.slice(has + 5, sel.lastIndexOf(")"))).replace(/^>\s*/, "").trim();
  try { return el.matches(inner) && !!el.closest(outer); } catch { return false; }
};
const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

test("every focusable element in a panel with every control has a :focus-visible rule", async () => {
  const p = tweaks("Rings", {
    level: [40, 0, 100, 1], count: { type: "number", value: 3 }, on: true, pick: { options: ["a", "b"] },
    grid: { type: "radiogrid", options: ["x", "y", "z"] }, seg: { type: "segmented", options: ["l", "r"] },
    tint: "#ff0000", name: "hi", notes: { type: "text", value: "a\nb", rows: 3 }, span: { type: "interval", min: 0, max: 1 },
    spring: { type: "spring" }, curve: { type: "cubicbezier" }, move: { type: "motion" }, pos: { type: "point", components: [{ key: "x" }, { key: "y" }] },
    ramp: { type: "gradient" }, lift: { type: "shadow" }, wave: { type: "plot", expr: "x" }, fps: { type: "fpsgraph" }, mon: { type: "monitor", value: 1 },
    pic: { type: "image" }, pad: { type: "sides", value: [4, 8] }, go: { type: "button", action() {} }, grp: { type: "buttongroup", buttons: { A() {}, B() {} } }, sep: { type: "separator" },
    pages: { type: "tabs", pages: { One: { a: 1 }, Two: { b: 2 } } }, folder: { inner: 1 },
  }, { persist: true, filter: true, undo: true, rename: true });
  document.body.append(p.el); await p.ready;
  const nodes = [...p.el.querySelectorAll(FOCUSABLE), ...document.body.querySelectorAll(".tw-portal " + FOCUSABLE.split(", ").join(", .tw-portal "))]
    .filter((el) => el.getAttribute("aria-hidden") !== "true" && el.type !== "file" && el.type !== "hidden");
  assert.ok(nodes.length > 40, `found ${nodes.length} focusable elements`);
  const bare = nodes.filter((el) => !selectors.some((s) => covers(s, el)));
  const describe = (el) => `<${el.tagName.toLowerCase()} class="${el.className}"${el.getAttribute("role") ? ` role=${el.getAttribute("role")}` : ""}>`;
  assert.deepEqual([...new Set(bare.map(describe))], [], "focusable elements no :focus-visible rule reaches");
  p.destroy();
});
