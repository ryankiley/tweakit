/* Every live example on the docs site runs under jsdom against the built bundle. The
 * site generator only stringifies each example's run function, so a renamed option or
 * a removed method would build green and break on the page. Each run gets the same
 * { tweaks, enhance, mount, target } the page script passes, and every panel it builds
 * is destroyed afterward so no monitor loop outlives the test. */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import "./_setup-dom.mjs";

const { tweaks, enhance } = await import(new URL("../dist/tweaks.js", import.meta.url));
const pagesDir = new URL("../site/pages/", import.meta.url);
const files = (await readdir(pagesDir)).filter((f) => f.endsWith(".mjs")).sort();

for (const file of files) {
  const page = await import(new URL(file, pagesDir));
  for (const ex of page.examples || []) {
    if (!ex.run && !ex.html) continue;
    test(`${file} › ${ex.id}`, async () => {
      const stage = document.createElement("div");
      stage.innerHTML = `<div class="ex-target">${ex.html ?? ex.target ?? ""}</div>${ex.noMount ? "" : '<div class="ex-mount"></div>'}`;
      document.body.append(stage);
      const made = [];
      const tw = (...a) => { const p = tweaks(...a); made.push(p); return p; };
      const errors = [];
      const onError = (e) => errors.push(e.error || e.message);
      window.addEventListener("error", onError);
      try {
        if (ex.run) ex.run({ tweaks: tw, enhance, mount: stage.querySelector(".ex-mount"), target: stage.querySelector(".ex-target") });
        else await enhance(stage);
        await Promise.all(made.map((p) => p.ready));
        await new Promise((r) => setTimeout(r, 40)); // a couple of frames for measure passes and first draws
        assert.deepEqual(errors, [], "no uncaught errors while the example ran");
      } finally {
        window.removeEventListener("error", onError);
        for (const p of made) p.destroy();
        for (const el of document.querySelectorAll(".tw-panel")) el.remove(); // panels built straight into body (floating examples)
        stage.remove();
      }
    });
  }
}
