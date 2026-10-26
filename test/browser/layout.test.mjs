/* Layout in a real browser — what jsdom can't see: row heights, label insets, content that spills out of the panel, page
 * overflow on a phone, and a header drag. Runs Playwright's Chromium against the built dist/ and the docs site;
 * `npm run test:browser` builds first, and CI runs it as its own job. Geometry, not pixels: a design change that keeps
 * the frame passes, one that breaks it fails. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
const panelOf = (page, name) => page.locator(".tw-panel", { has: page.locator(".tw-title", { hasText: new RegExp(`^${name}$`) }) });
// Every row of every panel on the page: its height and its own label's left edge. A tab page is a .tw-controls too, so
// its rows count; an inactive page measures 0 wide and drops out. A folder's .tw-controls is its rows' box, not a row.
const rows = (page) => page.evaluate(() => [...document.querySelectorAll(".tw-panel")].flatMap((p) => {
  const panel = p.querySelector(".tw-title")?.textContent;
  return [...p.querySelectorAll(".tw-controls > *, .tw-folder-body > :not(.tw-controls)")].map((r) => {
    const b = r.getBoundingClientRect(), label = r.querySelector(":scope > :is(.tw-row-label, .tw-radiogrid-label), :scope > .tw-slider > .tw-slider-label, :scope > .tw-trigger > .tw-trigger-label, :scope > .tw-select-trigger > :first-child");
    return { panel, cls: r.classList[0], height: b.height, width: b.width,
      labelIn: label && label.getBoundingClientRect().width ? label.getBoundingClientRect().left - b.left : null };
  }).filter((r) => r.width);
}));
// Every visible element in every panel against its panel's content box, so text or buttons that run out of a row that
// itself fits are caught too. Sideways only: the draggable header reaches up into the padding by design. An element
// under an ancestor that clips sideways, or clipped itself (the 1px screen-reader regions), is skipped, as clipped
// overflow is fine; so is a portaled pop, which sits on the page, not in the panel. An icon may hang its side-bearing
// out (a folder's chevron is pulled 1.75px past the edge so its glyph lines up), up to the 15px chevron's 3.75px.
const spills = (page) => page.evaluate(() => [...document.querySelectorAll(".tw-panel")].flatMap((p) => {
  const pr = p.getBoundingClientRect(), cs = getComputedStyle(p), panel = p.querySelector(".tw-title")?.textContent;
  const lo = pr.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft), hi = pr.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
  const clipped = (e) => { if (getComputedStyle(e).clipPath !== "none") return true; for (let a = e.parentElement; a && a !== p; a = a.parentElement) { const s = getComputedStyle(a); if (s.overflowX !== "visible" || s.clipPath !== "none") return true; } return false; };
  return [...p.querySelectorAll("*")].flatMap((e) => {
    const b = e.getBoundingClientRect(), out = Math.max(lo - b.left, b.right - hi);
    if (!b.width || !b.height || out <= (e instanceof SVGSVGElement ? 3.75 : 0.5) || e.closest(".tw-portal") || clipped(e)) return [];
    return [`${panel} › ${typeof e.className === "string" && e.className.split(" ")[0] || e.tagName.toLowerCase()} runs ${out.toFixed(1)}px out`];
  });
}));
// offsetHeight: the layout box, not a popover's scale-in transform.
const boxes = (page, sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetHeight)
  .map((e) => ({ cls: e.classList[0], h: e.offsetHeight, lh: getComputedStyle(e).lineHeight })), sel);
// A height set by `line-height: normal` follows the font: the Linux CI's fonts, an author's on the Mac. A px one doesn't.
const pinned = (list, h) => { for (const b of list) { assert.equal(b.h, h, `${b.cls} is ${b.h}px tall`); assert.match(b.lh, /px$/, `${b.cls} sizes from line-height ${b.lh}`); } };

test("every one-line control is one 32px row, its label 12px in", async () => {
  const { page, errors } = await fixture();
  const got = (await rows(page)).filter((r) => r.panel === "Rows");
  assert.equal(got.length, 15, "one row per control");
  for (const r of got) assert.equal(Math.round(r.height), 32, `${r.cls} is ${r.height}px tall`);
  const labeled = got.filter((r) => r.labelIn != null && r.cls !== "tw-button");
  assert.ok(labeled.length >= 9, `labels found on ${labeled.length} rows`);
  for (const r of labeled) assert.equal(Math.round(r.labelIn), 12, `${r.cls}'s label sits ${r.labelIn}px in`);
  assert.deepEqual(errors, []);
  await page.close();
});

test("every chip (segment, radio cell, group button, tab, the motion editor's mode toggle) is 24px on a px line-height", async () => {
  const { page, errors } = await fixture();
  await panelOf(page, "Rows").locator(".tw-motion .tw-trigger").click();
  await page.waitForFunction(() => document.querySelectorAll(".tw-motion-pop.is-open .tw-seg-btn").length >= 2);
  for (const sel of [".tw-seg-btn", ".tw-motion-pop .tw-seg-btn", ".tw-radiogrid-btn", ".tw-buttongroup-btn", ".tw-tabs-tab"]) {
    const got = await boxes(page, sel);
    assert.ok(got.length >= 2, `found ${got.length} ${sel}`);
    pinned(got, 24);
  }
  assert.deepEqual(errors, []);
  await page.close();
});

test("headers, a graphless monitor, list options, the color mode select and numeric fields keep their heights on px line-heights", async () => {
  const { page, errors } = await fixture();
  const heads = await page.evaluate(() => [...document.querySelectorAll(".tw-panel")].map((p) => [p.querySelector(".tw-title").textContent, p.querySelector(".tw-header").offsetHeight]));
  assert.deepEqual(heads, [["Rows", 44], ["Wide", 44], ["Float", 44], ["Bare", 37]], "44 with the toolbar's 24px buttons, 37 without");
  pinned(await boxes(page, ".tw-title"), 17);
  pinned(await boxes(page, ".tw-fps"), 33);
  await panelOf(page, "Rows").locator(".tw-select-trigger").click();
  await page.waitForSelector(".tw-select-dropdown.is-open .tw-select-option");
  pinned(await boxes(page, ".tw-select-dropdown.is-open .tw-select-option"), 30);
  await page.keyboard.press("Escape");
  await panelOf(page, "Rows").locator(".tw-color .tw-trigger").click();
  await page.waitForSelector(".tw-color-pop.is-open .tw-color-mode");
  pinned(await boxes(page, ".tw-color-pop.is-open .tw-color-mode"), 24);
  const fields = await page.evaluate(() => [...document.querySelectorAll(".tw-color-pop.is-open .tw-field")].filter((f) => f.querySelector(".tw-field-label").offsetHeight)
    .map((f) => ({ cls: "tw-field", h: f.offsetHeight, lh: [".tw-field-label", ".tw-num, .tw-color-chan-input"].map((s) => getComputedStyle(f.querySelector(s)).lineHeight).find((l) => !l.endsWith("px")) ?? "px" })));
  assert.ok(fields.length >= 3, `found ${fields.length} labeled fields`);
  pinned(fields, 42);
  assert.deepEqual(errors, []);
  await page.close();
});

test("long options, long tab titles, a wide button group and a long label stay inside a 256px panel", async () => {
  const { page, errors } = await fixture();
  const width = await page.evaluate(() => [...document.querySelectorAll(".tw-panel")].map((p) => p.getBoundingClientRect().width));
  assert.deepEqual(width, [256, 256, 256, 256]);
  assert.ok(await page.evaluate(() => [...document.querySelectorAll(".tw-tabs-page")].some((t) => t.offsetWidth && t.querySelector(".tw-slider"))), "the open tab page's rows are measured too");
  assert.deepEqual(await spills(page), []);
  assert.deepEqual(errors, []);
  await page.close();
});

test("a floating panel follows a header drag, and a click on the header folds it", async () => {
  const { page, errors } = await fixture();
  const panel = panelOf(page, "Float");
  const at = await panel.boundingBox(), head = await panel.locator(".tw-header").boundingBox();
  await page.mouse.move(head.x + 20, head.y + head.height / 2);
  await page.mouse.down(); await page.mouse.move(head.x + 120, head.y + head.height / 2 + 60, { steps: 8 }); await page.mouse.up();
  const moved = await panel.boundingBox();
  assert.deepEqual([Math.round(moved.x - at.x), Math.round(moved.y - at.y)], [100, 60]);
  const body = panel.locator(".tw-body");
  assert.ok((await body.boundingBox()).height > 0, "the body starts open");
  await panel.locator(".tw-title").click();
  await body.evaluate((b) => new Promise((done) => { const check = () => (b.getBoundingClientRect().height < 1 ? done() : requestAnimationFrame(check)); check(); })); // the body folds away
  assert.deepEqual(errors, []);
  await page.close();
});

// Read when the file loads, so the tests below register with the rest and --test-name-pattern can pick them.
const PAGES = readdirSync(path.join(ROOT, "dist")).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -5)); // every docs page, a new one included
for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
  test(`docs pages at ${viewport.width}px: everything inside its panel${viewport.width < 768 ? ", and no sideways scroll" : ""}`, async () => {
    for (const name of PAGES) {
      const { page, errors } = await open(`/${name}.html`, viewport);
      try {
        await page.waitForLoadState("networkidle");
        assert.deepEqual(await spills(page), [], `${name}: content runs out of a panel`);
        if (viewport.width < 768) {
          const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
          assert.ok(scroll <= inner, `${name} scrolls sideways (${scroll}px in ${inner}px)`);
        }
        assert.deepEqual(errors, [], `${name} threw`);
      } finally { await page.close(); }
    }
  });
}
