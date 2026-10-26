/* Layout in a real browser — what jsdom can't see: row heights, label insets, rows that spill out of the panel, page
 * overflow on a phone, and a header drag. Runs Playwright's Chromium against the built dist/ and the docs site, so
 * `npm run build` first. `npm run test:browser`; CI runs it as its own job. Geometry, not pixels: a design change that
 * keeps the frame passes, one that breaks it fails. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
// dist/ at the root, the fixture under /fixture/.
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = p.startsWith("/fixture/") ? path.join(ROOT, "test/browser", p.slice(9)) : path.join(ROOT, "dist", p);
  try { res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }).end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
let browser, base;
before(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server.close(); });

const open = async (url, viewport = { width: 1280, height: 900 }) => {
  const page = await browser.newPage({ viewport });
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + url);
  return { page, errors };
};
const fixture = async () => { const o = await open("/fixture/fixture.html"); await o.page.waitForSelector("body[data-ready]"); return o; };
// Every row of every panel on the page: its box, its panel's, and its own label's left edge. A tab page is a
// .tw-controls too, so its rows count; an inactive page measures 0 wide and drops out.
const rows = (page) => page.evaluate(() => [...document.querySelectorAll(".tw-panel")].flatMap((p) => {
  const pr = p.getBoundingClientRect(), panel = p.querySelector(".tw-title")?.textContent;
  return [...p.querySelectorAll(".tw-controls > *, .tw-folder-body > *")].map((r) => {
    const b = r.getBoundingClientRect(), label = r.querySelector(":scope > :is(.tw-row-label, .tw-slider .tw-slider-label, .tw-radiogrid-label), :scope > .tw-slider > .tw-slider-label, :scope > .tw-trigger > .tw-trigger-label, :scope > .tw-select-trigger > :first-child");
    return { panel, cls: r.classList[0], inTab: !!r.parentElement.closest(".tw-tabs-page"), left: b.left - pr.left, right: pr.right - b.right, height: b.height, width: b.width,
      labelIn: label && label.getBoundingClientRect().width ? label.getBoundingClientRect().left - b.left : null };
  }).filter((r) => r.width);
}));

test("every one-line control is one 32px row, its label 12px in", async () => {
  const { page, errors } = await fixture();
  const got = (await rows(page)).filter((r) => r.panel === "Rows");
  assert.equal(got.length, 14, "one row per control");
  for (const r of got) assert.equal(Math.round(r.height), 32, `${r.cls} is ${r.height}px tall`);
  const labelled = got.filter((r) => r.labelIn != null && r.cls !== "tw-button");
  assert.ok(labelled.length >= 8, `labels found on ${labelled.length} rows`);
  for (const r of labelled) assert.equal(Math.round(r.labelIn), 12, `${r.cls}'s label sits ${r.labelIn}px in`);
  assert.deepEqual(errors, []);
  await page.close();
});

test("long options, long tab titles, a wide button group and a long label stay inside a 256px panel", async () => {
  const { page, errors } = await fixture();
  const width = await page.evaluate(() => [...document.querySelectorAll(".tw-panel")].map((p) => p.getBoundingClientRect().width));
  assert.deepEqual(width, [256, 256, 256]);
  const wide = (await rows(page)).filter((r) => r.panel === "Wide");
  assert.ok(wide.some((r) => r.inTab), "the open tab page's rows are measured too");
  for (const r of wide) {
    assert.ok(r.left >= -0.5 && r.right >= -0.5, `${r.cls} spills out of its panel (${r.left.toFixed(1)} left, ${r.right.toFixed(1)} right)`);
  }
  assert.deepEqual(errors, []);
  await page.close();
});

test("a floating panel follows a header drag, and a click on the header folds it", async () => {
  const { page } = await fixture();
  const panel = page.locator(".tw-panel", { hasText: "Float" });
  const at = await panel.boundingBox(), head = await panel.locator(".tw-header").boundingBox();
  await page.mouse.move(head.x + 20, head.y + head.height / 2);
  await page.mouse.down(); await page.mouse.move(head.x + 120, head.y + head.height / 2 + 60, { steps: 8 }); await page.mouse.up();
  const moved = await panel.boundingBox();
  assert.deepEqual([Math.round(moved.x - at.x), Math.round(moved.y - at.y)], [100, 60]);
  const body = panel.locator(".tw-body");
  const open = (await body.boundingBox()).height;
  await panel.locator(".tw-title").click();
  await page.waitForTimeout(700);
  assert.ok(open > 0 && ((await body.boundingBox())?.height ?? 0) < 1, "the body folds away");
  await page.close();
});

const PAGES = (await readdir(path.join(ROOT, "dist"))).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -5)); // every docs page, a new one included
for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
  test(`docs pages at ${viewport.width}px: every row inside its panel${viewport.width < 768 ? ", and no sideways scroll" : ""}`, async () => {
    for (const name of PAGES) {
      const { page, errors } = await open(`/${name}.html`, viewport);
      await page.waitForLoadState("networkidle");
      for (const r of await rows(page)) assert.ok(r.left >= -0.5 && r.right >= -0.5, `${name}: ${r.panel} › ${r.cls} spills out of its panel`);
      if (viewport.width < 768) {
        const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
        assert.ok(scroll <= inner, `${name} scrolls sideways (${scroll}px in ${inner}px)`);
      }
      assert.deepEqual(errors, [], `${name} threw`);
      await page.close();
    }
  });
}
