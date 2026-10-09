/* Every lazy chunk of the code-split build must load and register its control.
 * dist/tweaks/core.js imports the heavy controls on demand through hash-named chunks;
 * a chunk that fails to resolve degrades to a skipped control, so nothing else in the
 * suite would notice. This builds one panel that needs all of them. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks/core.js", import.meta.url));

test("every lazy control loads from the split build and registers", async () => {
  const p = tweaks("All", {
    interval: { type: "interval", value: [2, 8], min: 0, max: 10, step: 1 },
    color: "#7c5cff",
    gradient: { type: "gradient", value: [["#000", 0], ["#fff", 1]] },
    image: { type: "image" },
    fps: { type: "fpsgraph" },
    monitor: { type: "monitor", value: 1 },
    spring: { type: "spring", value: { stiffness: 100, damping: 12, mass: 1 } },
    bezier: { type: "cubicbezier", value: [0.4, 0, 0.2, 1] },
    point: { type: "point", components: [{ key: "x", value: 0 }, { key: "y", value: 0 }] },
    plot: { type: "plot", expr: "sin(x)" },
    tabs: { type: "tabs", pages: { A: { a: 1 }, B: { b: 2 } } },
  });
  document.body.append(p.el);
  try {
    await p.ready;
    for (const key of ["interval", "color", "gradient", "image", "spring", "bezier", "point", "plot", "tabs"]) assert.ok(key in p.params, `${key} built`);
    for (const cls of ["tw-plot", "tw-monitor", "tw-fps", "tw-tabs"]) assert.ok(p.el.querySelector("." + cls), `${cls} rendered`);
  } finally {
    p.destroy(); // the monitor loops would otherwise outlive a failed assertion and pin the process open
  }
});
