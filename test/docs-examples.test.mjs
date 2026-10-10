/* Every live example on the docs site runs under jsdom against the built bundle. The
 * site generator only stringifies each example's run function, so a renamed option or
 * a removed method would build green and break on the page. Each run gets the same
 * { tweaks, enhance, gradientCss, mount, target } the page script passes, and every panel it builds
 * is destroyed afterward so no monitor loop outlives the test.
 *
 * Beyond "no uncaught error", each example's state after `ready` — every panel's
 * toJSON(), or a markup example's data-values — is compared with test/docs-snapshot.json,
 * so a default that drifts (a changed blend space, a re-derived range) shows up as a diff
 * instead of passing silently. When a change is intended, rewrite the baseline:
 *   TW_UPDATE_DOCS_SNAPSHOT=1 node --test test/docs-examples.test.mjs */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import "./_setup-dom.mjs";

const { tweaks, enhance, gradientCss } = await import(new URL("../dist/tweaks.js", import.meta.url));
const pagesDir = new URL("../site/pages/", import.meta.url);
const files = (await readdir(pagesDir)).filter((f) => f.endsWith(".mjs")).sort();

const snapFile = new URL("./docs-snapshot.json", import.meta.url);
const update = !!process.env.TW_UPDATE_DOCS_SNAPSHOT;
let baseline = {};
try { baseline = JSON.parse(await readFile(snapFile, "utf8")); } catch { if (!update) throw new Error("test/docs-snapshot.json is missing — write it with TW_UPDATE_DOCS_SNAPSHOT=1 node --test test/docs-examples.test.mjs"); }
const fresh = {};

for (const file of files) {
  const page = await import(new URL(file, pagesDir));
  for (const ex of page.examples || []) {
    if (!ex.run && !ex.html) continue;
    const name = `${file} › ${ex.id}`;
    test(name, async () => {
      const stage = document.createElement("div");
      stage.innerHTML = `<div class="ex-target">${ex.html ?? ex.target ?? ""}</div>${ex.noMount ? "" : '<div class="ex-mount"></div>'}`;
      document.body.append(stage);
      const made = [];
      const tw = (...a) => { const p = tweaks(...a); made.push(p); return p; };
      const errors = [];
      const onError = (e) => errors.push(e.error || e.message);
      window.addEventListener("error", onError);
      try {
        if (ex.run) ex.run({ tweaks: tw, enhance, gradientCss, mount: stage.querySelector(".ex-mount"), target: stage.querySelector(".ex-target") });
        else await enhance(stage);
        await Promise.all(made.map((p) => p.ready));
        await new Promise((r) => setTimeout(r, 40)); // a couple of frames for measure passes and first draws
        assert.deepEqual(errors, [], "no uncaught errors while the example ran");
        // The example's state once settled: every panel's toJSON(), or the markup hosts' values.
        const state = ex.run
          ? made.map((p) => p.toJSON())
          : [...stage.querySelectorAll("[data-tw]")].map((h) => ({ key: h.dataset.key ?? h.dataset.label ?? h.dataset.tw, value: h.dataset.value ?? null }));
        fresh[name] = JSON.parse(JSON.stringify(state));
        if (!update) assert.deepEqual(fresh[name], baseline[name], `${name}: the example's settled state changed — if that is intended, rewrite the baseline with TW_UPDATE_DOCS_SNAPSHOT=1`);
      } finally {
        window.removeEventListener("error", onError);
        for (const p of made) p.destroy();
        for (const el of document.querySelectorAll(".tw-panel")) el.remove(); // panels built straight into body (floating examples)
        stage.remove();
      }
    });
  }
}

after(async () => { if (update) await writeFile(snapFile, JSON.stringify(fresh, null, 2) + "\n"); });
