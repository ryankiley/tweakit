/* Every lazy chunk of the code-split build must load and register its control.
 * dist/tweaks/core.js imports the heavy controls on demand through hash-named chunks;
 * a chunk that fails to resolve degrades to a skipped control, so nothing else in the
 * suite would notice. This builds one panel that needs all of them. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks, mountControl, enhance } = await import(new URL("../dist/tweaks/core.js", import.meta.url));

test("every lazy control loads from the split build and registers", async () => {
  const p = tweaks("All", {
    number: { type: "number", value: 1 },
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
    for (const key of ["number", "interval", "color", "gradient", "image", "spring", "bezier", "point", "plot", "tabs"]) assert.ok(key in p.params, `${key} built`);
    for (const cls of ["tw-plot", "tw-monitor", "tw-fps", "tw-tabs"]) assert.ok(p.el.querySelector("." + cls), `${cls} rendered`);
  } finally {
    p.destroy(); // the monitor loops would otherwise outlive a failed assertion and pin the process open
  }
});

// esbuild splits per module: a module imported by the core entry AND by a lazy control is
// hoisted into its own shared chunk. The kit keeps exactly three — shared.ts (core + every
// control), the colour engine (colour + gradient) and heavy.ts (the helpers only lazy
// controls use) — and core imports only the first, so a basic panel fetches core plus one
// chunk. A lazy control importing a core-only module (icons, feedback, schema) would
// mint a fourth, and every basic panel would fetch one more file while the build's size
// report quietly stopped describing what a basic panel loads. (heavy.ts is also the Number
// control's lazy entry, so esbuild adds a re-export stub for it beside its chunk.)
test("the split build has exactly three shared chunks, and core imports exactly one of them", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const dir = new URL("../dist/tweaks/", import.meta.url);
  const chunks = (await readdir(dir)).filter((f) => /^chunk-[\w-]+\.js$/.test(f));
  assert.equal(chunks.length, 3, `shared chunks: ${chunks.join(", ")} — a core-only module is being imported from a lazy control`);
  const core = await readFile(new URL("core.js", dir), "utf8");
  const staticImports = [...core.matchAll(/from\s*"\.\/(chunk-[\w-]+\.js)"/g)].map((m) => m[1]);
  assert.equal(staticImports.length, 1, `core.js statically imports: ${staticImports.join(", ")}`);
});

// The budget a basic panel's download is held to: core.js + the shared chunk it statically
// imports, gzipped — the figure build.mjs reports as the code-split size. It drifted from
// 19.6 KB to 21.6 KB one small fix at a time with nothing watching; an overrun here means
// finding something to move into a lazy chunk (heavy.ts is where lazy-only helpers live).
// Raised 20 → 21 KiB for the gradient's easing (#101): gradientCss() is a core export so a
// host templates from one place, and it is ~700 B gzip of pure string work.
test("a basic panel's code-split download stays under 21 KiB gzip", async () => {
  const { readFile } = await import("node:fs/promises");
  const { gzipSync } = await import("node:zlib");
  const dir = new URL("../dist/tweaks/", import.meta.url);
  const core = await readFile(new URL("core.js", dir));
  let bytes = gzipSync(core).length;
  for (const [, c] of String(core).matchAll(/from\s*"\.\/(chunk-[\w-]+\.js)"/g)) bytes += gzipSync(await readFile(new URL(c, dir))).length;
  assert.ok(bytes < 21504, `core + shared chunk is ${bytes} B gzip — over the 21 KiB budget`);
});

// Number is lazy on the split build (no shorthand infers it): the standalone and markup
// paths must wait for its chunk the way they do for colour, not skip it.
test("the split build's number control mounts standalone and from markup once its chunk lands", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const h = mountControl(host, { type: "number", value: 3, min: 0, max: 10 });
  await h.ready;
  assert.ok(host.querySelector(".tw-num"), "mountControl built the number field");
  assert.equal(h.get(), 3);
  h.destroy(); host.remove();
  const mk = document.createElement("div");
  mk.dataset.tw = "number"; mk.dataset.key = "n"; mk.dataset.value = "4";
  document.body.append(mk);
  await enhance(mk);
  assert.ok(mk.querySelector(".tw-num"), "a [data-tw=number] host built its field");
  assert.equal(mk._tw.ctrl.get(), 4);
  mk.remove();
});
