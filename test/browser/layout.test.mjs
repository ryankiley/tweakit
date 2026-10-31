/* Layout in a real browser — what jsdom can't see: row heights, label insets, content that spills out of the panel,
 * page
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
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
// dist/ at the root, the fixture under /fixture/.
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = p.startsWith("/fixture/") ? path.join(ROOT, "test/browser", p.slice(9)) : path.join(ROOT, "dist", p);
  try {
    res
      .writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" })
      .end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
let browser, base;
before(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server.close();
});

const open = async (url, viewport = { width: 1280, height: 900 }) => {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + url);
  return { page, errors };
};
const fixture = async () => {
  const o = await open("/fixture/fixture.html");
  await o.page.waitForSelector("body[data-ready]");
  return o;
};
const panelOf = (page, name) =>
  page.locator(".twk-panel", { has: page.locator(".twk-title", { hasText: new RegExp(`^${name}$`) }) });
// Every row of every panel on the page: its height and its own label's left edge. A tab page is a .twk-controls too, so
// its rows count; an inactive page measures 0 wide and drops out. A folder's .twk-controls is its rows' box, not a row.
const rows = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".twk-panel")].flatMap((p) => {
      const panel = p.querySelector(".twk-title")?.textContent;
      return [...p.querySelectorAll(".twk-controls > *, .twk-folder-body > :not(.twk-controls)")]
        .map((r) => {
          const b = r.getBoundingClientRect(),
            label = r.querySelector(
              ":scope > :is(.twk-row-label, .twk-radiogrid-label), :scope > .twk-slider > .twk-slider-label, :scope > .twk-trigger > .twk-trigger-label, :scope > .twk-select-trigger > :first-child",
            );
          return {
            panel,
            cls: r.classList[0],
            height: b.height,
            width: b.width,
            labelIn: label && label.getBoundingClientRect().width ? label.getBoundingClientRect().left - b.left : null,
          };
        })
        .filter((r) => r.width);
    }),
  );
// Every visible element in every panel against its panel's content box, so text or buttons that run out of a row that
// itself fits are caught too. Sideways only: the draggable header reaches up into the padding by design. An element
// under an ancestor that clips sideways, or clipped itself (the 1px screen-reader regions), is skipped, as clipped
// overflow is fine; so is a portaled pop, which sits on the page, not in the panel. An icon may hang its side-bearing
// out (a folder's chevron is pulled 1.75px past the edge so its glyph lines up), up to the 15px chevron's 3.75px.
const spills = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".twk-panel")].flatMap((p) => {
      const pr = p.getBoundingClientRect(),
        cs = getComputedStyle(p),
        panel = p.querySelector(".twk-title")?.textContent;
      const lo = pr.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
        hi = pr.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
      const clipped = (e) => {
        if (getComputedStyle(e).clipPath !== "none") return true;
        for (let a = e.parentElement; a && a !== p; a = a.parentElement) {
          const s = getComputedStyle(a);
          if (s.overflowX !== "visible" || s.clipPath !== "none") return true;
        }
        return false;
      };
      return [...p.querySelectorAll("*")].flatMap((e) => {
        const b = e.getBoundingClientRect(),
          out = Math.max(lo - b.left, b.right - hi);
        if (
          !b.width ||
          !b.height ||
          out <= (e instanceof SVGSVGElement ? 3.75 : 0.5) ||
          e.closest(".twk-portal") ||
          clipped(e)
        )
          return [];
        return [
          `${panel} › ${(typeof e.className === "string" && e.className.split(" ")[0]) || e.tagName.toLowerCase()} runs ${out.toFixed(1)}px out`,
        ];
      });
    }),
  );
// offsetHeight: the layout box, not a popover's scale-in transform.
const boxes = (page, sel) =>
  page.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)]
        .filter((e) => e.offsetHeight)
        .map((e) => ({ cls: e.classList[0], h: e.offsetHeight, lh: getComputedStyle(e).lineHeight })),
    sel,
  );
// A height set by `line-height: normal` follows the font: the Linux CI's fonts, an author's on the Mac. A px one
// doesn't.
// An empty list passes every check, so a selector that stops matching would turn its check off: it fails instead.
const pinned = (list, h) => {
  assert.ok(list.length, `nothing to measure for ${h}px`);
  for (const b of list) {
    assert.equal(b.h, h, `${b.cls} is ${b.h}px tall`);
    assert.match(b.lh, /px$/, `${b.cls} sizes from line-height ${b.lh}`);
  }
};

test("every one-line control is one 32px row, its label 12px in", async () => {
  const { page, errors } = await fixture();
  const got = (await rows(page)).filter((r) => r.panel === "Rows");
  assert.equal(got.length, 15, "one row per control");
  for (const r of got) assert.equal(Math.round(r.height), 32, `${r.cls} is ${r.height}px tall`);
  const labeled = got.filter((r) => r.labelIn != null && r.cls !== "twk-button");
  assert.ok(labeled.length >= 9, `labels found on ${labeled.length} rows`);
  for (const r of labeled) assert.equal(Math.round(r.labelIn), 12, `${r.cls}'s label sits ${r.labelIn}px in`);
  assert.deepEqual(errors, []);
  await page.close();
});

test("every chip (segment, radio cell, group button, tab, the motion editor's mode toggle) is 24px on a px line-height", async () => {
  const { page, errors } = await fixture();
  await panelOf(page, "Rows").locator(".twk-motion .twk-trigger").click();
  await page.waitForFunction(() => document.querySelectorAll(".twk-motion-pop.is-open .twk-seg-btn").length >= 2);
  for (const sel of [
    ".twk-seg-btn",
    ".twk-motion-pop .twk-seg-btn",
    ".twk-radiogrid-btn",
    ".twk-buttongroup-btn",
    ".twk-tabs-tab",
  ]) {
    const got = await boxes(page, sel);
    assert.ok(got.length >= 2, `found ${got.length} ${sel}`);
    pinned(got, 24);
  }
  assert.deepEqual(errors, []);
  await page.close();
});

test("headers, a graphless monitor, list options, the color mode select and numeric fields keep their heights on px line-heights", async () => {
  const { page, errors } = await fixture();
  const heads = await page.evaluate(() =>
    [...document.querySelectorAll(".twk-panel")].map((p) => [
      p.querySelector(".twk-title").textContent,
      p.querySelector(".twk-header").offsetHeight,
    ]),
  );
  assert.deepEqual(
    heads,
    [
      ["Rows", 44],
      ["Wide", 44],
      ["Float", 44],
      ["Bare", 37],
    ],
    "44 with the toolbar's 24px buttons, 37 without",
  );
  pinned(await boxes(page, ".twk-title"), 17);
  pinned(await boxes(page, ".twk-fps"), 33);
  await panelOf(page, "Rows").locator(".twk-select-trigger").click();
  await page.waitForSelector(".twk-select-dropdown.is-open .twk-select-option");
  pinned(await boxes(page, ".twk-select-dropdown.is-open .twk-select-option"), 30);
  await page.keyboard.press("Escape");
  await panelOf(page, "Rows").locator(".twk-color .twk-trigger").click();
  await page.waitForSelector(".twk-color-pop.is-open .twk-color-mode");
  pinned(await boxes(page, ".twk-color-pop.is-open .twk-color-mode"), 24);
  const fields = await page.evaluate(() =>
    [...document.querySelectorAll(".twk-color-pop.is-open .twk-field")]
      .filter((f) => f.querySelector(".twk-field-label").offsetHeight)
      .map((f) => ({
        cls: "twk-field",
        h: f.offsetHeight,
        lh:
          [".twk-field-label", ".twk-num, .twk-color-chan-input"]
            .map((s) => getComputedStyle(f.querySelector(s)).lineHeight)
            .find((l) => !l.endsWith("px")) ?? "px",
      })),
  );
  assert.ok(fields.length >= 3, `found ${fields.length} labeled fields`);
  pinned(fields, 42);
  assert.deepEqual(errors, []);
  await page.close();
});

test("long options, long tab titles, a wide button group and a long label stay inside a 256px panel", async () => {
  const { page, errors } = await fixture();
  const width = await page.evaluate(() =>
    [...document.querySelectorAll(".twk-panel")].map((p) => p.getBoundingClientRect().width),
  );
  assert.deepEqual(width, [256, 256, 256, 256]);
  assert.ok(
    await page.evaluate(() =>
      [...document.querySelectorAll(".twk-tabs-page")].some((t) => t.offsetWidth && t.querySelector(".twk-slider")),
    ),
    "the open tab page's rows are measured too",
  );
  assert.deepEqual(await spills(page), []);
  assert.deepEqual(errors, []);
  await page.close();
});

// A panel of its own on the fixture page, built by the test so the shared panels the others count stay as they are.
const build = (page, name, schema, opts) =>
  page.evaluate(
    async ([n, s, o]) => {
      const { tweaks } = await import("/tweaks/core.js");
      const p = tweaks(n, s, o);
      document.body.append(p.el);
      await p.ready;
      (window.built ||= {})[n] = p;
    },
    [name, schema, opts],
  );

test("a radio grid's pill lands on the picked cell, along a row and down the grid; a label-less row fills it in equal cells", async () => {
  const { page, errors } = await fixture();
  await build(page, "Grids", {
    align: { type: "radiogrid", cols: 3, options: ["TL", "T", "TR", "L", "C", "R", "BL", "B", "BR"], value: "C" },
    ratio: { type: "segmented", label: "", options: ["16:9", "1:1", "9:16", "Free"], value: "1:1" },
  });
  const grids = panelOf(page, "Grids");
  // the pill's box against the picked cell's, once the slide has settled
  const off = () =>
    grids.locator(".twk-radiogrid-grid").evaluateAll((gs) =>
      gs.map((g) => {
        const a = g.querySelector(".twk-radiogrid-pill").getBoundingClientRect(),
          b = g.querySelector('[data-active="true"]').getBoundingClientRect();
        return Math.max(...[a.left - b.left, a.top - b.top, a.width - b.width, a.height - b.height].map(Math.abs));
      }),
    );
  for (const cell of ["TR", "BL", "9:16"]) {
    await grids.getByRole("radio", { name: cell, exact: true }).click();
    await page.waitForTimeout(400);
    for (const d of await off()) assert.ok(d <= 0.5, `after ${cell}, the pill is ${d}px off its cell`);
  }
  // a cleared pick shows no pill
  const shown = () =>
    grids.locator(".twk-radiogrid-pill").evaluateAll((ps) => ps.map((p) => getComputedStyle(p).display));
  await page.evaluate(() => window.built.Grids.set("align", null));
  assert.deepEqual(await shown(), ["none", "block"]);
  await page.evaluate(() => window.built.Grids.set("align", "C"));
  assert.deepEqual(await shown(), ["block", "block"]);
  const ratio = await grids
    .locator(".twk-radiogrid", { has: page.getByRole("radio", { name: "Free" }) })
    .evaluate((r) => [
      r.getBoundingClientRect().width,
      ...[...r.querySelectorAll(".twk-radiogrid-btn")].map((b) => b.getBoundingClientRect().width),
    ]);
  assert.equal(ratio.length, 5, "four cells on one line");
  for (const w of ratio.slice(2)) assert.ok(Math.abs(w - ratio[1]) <= 0.5, `equal cells: ${ratio.slice(1)}`);
  assert.ok(
    ratio.slice(1).reduce((a, b) => a + b) + 3 * 4 >= ratio[0] - 8 - 0.5,
    "the cells fill the row inside its 4px frame",
  );
  // Set while their tab page was hidden, a grid's pill and a toggle's are on the pick the frame the page shows, not
  // growing to it.
  await build(page, "Paged", {
    tabs: {
      type: "tabs",
      pages: { One: { x: [1, 0, 2, 0.1] }, Two: { pick: { type: "radiogrid", options: ["a", "b", "c"] }, on: false } },
    },
  });
  const revealed = await panelOf(page, "Paged").evaluate(async (p) => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const tabs = p.querySelectorAll(".twk-tabs-tab");
    tabs[1].click();
    await frame();
    tabs[0].click();
    await frame();
    window.built.Paged.setMany({ "tabs.two.pick": "c", "tabs.two.on": true });
    tabs[1].click();
    await frame();
    return [".twk-radiogrid", ".twk-seg"].map((g) => {
      const a = p.querySelector(`${g} [class$="-pill"]`).getBoundingClientRect(),
        b = p.querySelector(`${g} [data-active="true"]`).getBoundingClientRect();
      return Math.max(...[a.left - b.left, a.width - b.width].map(Math.abs));
    });
  });
  for (const d of revealed) assert.ok(d <= 0.5, `a pill is ${d}px off its pick as the page shows: ${revealed}`);
  assert.deepEqual(errors, []);
  await page.close();
});

test("a floating panel that scrolls pins its header, and the open folder's header under its hairline, a nested one a row lower", async () => {
  const { page, errors } = await open("/fixture/fixture.html", { width: 1280, height: 420 });
  await page.waitForSelector("body[data-ready]");
  const sliders = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`s${i}`, [i, 0, 20, 1]]));
  // long enough to scroll in a 420px window, with a nested folder at its end
  await build(
    page,
    "Pinned",
    { a: sliders, b: sliders, c: { k: [1, 0, 2, 0.1], d: sliders } },
    { floating: { x: 1000, y: 16 } },
  );
  const at = (scroll) =>
    panelOf(page, "Pinned").evaluate(async (p, s) => {
      p.scrollTop = s;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const top = p.getBoundingClientRect().top,
        head = p.querySelector(":scope > .twk-header").getBoundingClientRect(),
        // the folder headers in view below the header, top first
        folders = [...p.querySelectorAll(".twk-folder-header")]
          .map((f) => [f.textContent.trim(), f.getBoundingClientRect().top - top])
          .filter(([, y]) => y >= head.bottom - top - 0.5)
          .sort((a, b) => a[1] - b[1]);
      return { scrolled: p.scrollTop, head: [head.top - top, head.bottom - top], folders };
    }, scroll);
  const rest = await at(0);
  assert.equal(Math.round(rest.head[0]), 0, "the header reaches the panel's top edge");
  const mid = await at(120);
  assert.ok(mid.scrolled > 0, "the panel scrolls");
  assert.deepEqual(mid.head.map(Math.round), rest.head.map(Math.round), "the header stays put");
  assert.equal(mid.folders[0][0], "A", "folder A's header is pinned");
  assert.ok(Math.abs(mid.folders[0][1] - mid.head[1]) <= 0.5, `right under the hairline, at ${mid.folders[0][1]}`);
  // a toolbar-less header is shorter, and its folders pin under it all the same
  await build(page, "Plain", { a: sliders, b: sliders }, { floating: { x: 700, y: 16 }, toolbar: false });
  const plain = await panelOf(page, "Plain").evaluate(async (p) => {
    p.scrollTop = 120;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const head = p.querySelector(":scope > .twk-header").getBoundingClientRect(),
      a = p.querySelector(".twk-folder-header").getBoundingClientRect();
    return [head.height, a.top - head.bottom];
  });
  assert.deepEqual(plain.map(Math.round), [37, 0]);
  const end = await at(1e5);
  assert.deepEqual(
    end.folders.slice(0, 2).map(([t, y]) => [t, Math.round(y - end.head[1])]),
    [
      ["C", 0],
      ["D", 32],
    ],
    "at the end, C pins under the header and its nested D a row lower",
  );
  assert.deepEqual(errors, []);
  await page.close();
});

test("a floating panel follows a header drag, and a click on the header folds it", async () => {
  const { page, errors } = await fixture();
  const panel = panelOf(page, "Float");
  const at = await panel.boundingBox(),
    head = await panel.locator(".twk-header").boundingBox();
  await page.mouse.move(head.x + 20, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + 120, head.y + head.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  const moved = await panel.boundingBox();
  assert.deepEqual([Math.round(moved.x - at.x), Math.round(moved.y - at.y)], [100, 60]);
  const body = panel.locator(".twk-body");
  assert.ok((await body.boundingBox()).height > 0, "the body starts open");
  await panel.locator(".twk-title").click();
  // the body folds away
  await body.evaluate(
    (b) =>
      new Promise((done) => {
        const check = () => (b.getBoundingClientRect().height < 1 ? done() : requestAnimationFrame(check));
        check();
      }),
  );
  assert.deepEqual(errors, []);
  await page.close();
});

// The first drag moves an inline panel under <body>; it must look the same there. The host here themes it three ways
// the lift used to drop: a token on an ancestor, a token and a font through an ancestor selector on the panel, and text
// properties the kit leaves to inheritance. The panel's own theme still layers on top afterwards, and falls back to
// them.
test("a panel lifted by its first drag keeps the host's tokens and type, under its own theme", async () => {
  const { page, errors } = await fixture();
  await page.evaluate(async () => {
    const style = document.createElement("style");
    style.textContent =
      "#lift-host { --twk-accent: rgb(255, 99, 71); font-size: 19px; letter-spacing: 2px; transform: translateZ(0); } #lift-host .twk-panel { --twk-radius: 3px; font-family: Georgia, serif; }";
    const host = document.createElement("div");
    host.id = "lift-host";
    document.head.append(style);
    document.body.append(host);
    const { tweaks } = await import("/tweaks/core.js");
    const p = tweaks("Lift", { x: [1, 0, 2, 0.1] }, { theme: { "--twk-surface": "rgb(51, 0, 0)" } });
    host.append(p.el);
    window.liftPanel = p;
    await p.ready;
  });
  const panel = panelOf(page, "Lift");
  const look = () =>
    panel.evaluate((p) => {
      const s = getComputedStyle(p),
        label = getComputedStyle(p.querySelector(".twk-slider-label"));
      return {
        accent: s.getPropertyValue("--twk-accent").trim(),
        radius: s.getPropertyValue("--twk-radius").trim(),
        surface: s.getPropertyValue("--twk-surface").trim(),
        font: label.fontFamily,
        size: s.fontSize,
        spacing: label.letterSpacing,
      };
    });
  const before = await look();
  assert.deepEqual(
    before,
    {
      accent: "rgb(255, 99, 71)",
      radius: "3px",
      surface: "rgb(51, 0, 0)",
      font: "Georgia, serif",
      size: "19px",
      spacing: "2px",
    },
    "sanity: the host's context reaches the inline panel",
  );
  const head = await panel.locator(".twk-title").boundingBox();
  await page.mouse.move(head.x + 10, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + 110, head.y + head.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  assert.equal(
    await panel.evaluate((p) => p.parentElement === document.body && p.dataset.mode),
    "floating",
    "the drag lifted it under <body>",
  );
  assert.deepEqual(await look(), before, "the lifted panel looks as it did in its slot");
  await page.evaluate(() => window.liftPanel.setTheme({ "--twk-accent": "#00ff00", "--twk-radius": "12px" }));
  const themed = await look();
  assert.deepEqual(
    [themed.accent, themed.radius, themed.font, themed.size],
    ["#00ff00", "12px", before.font, before.size],
    "a later setTheme() still wins on the lifted panel, over the carried values",
  );
  assert.notEqual(themed.surface, before.surface, "and the old theme's surface, which the new one drops, is gone");
  await page.evaluate(() => window.liftPanel.setTheme(null));
  const reverted = await look();
  assert.deepEqual(
    [reverted.accent, reverted.radius],
    ["rgb(255, 99, 71)", "3px"],
    "and a key it drops falls back to the host's value, not the kit's",
  );
  assert.deepEqual(errors, []);
  await page.close();
});

// Read when the file loads, so the tests below register with the rest and --test-name-pattern can pick them.
// every docs page, a new one included
const PAGES = readdirSync(path.join(ROOT, "dist"))
  .filter((f) => f.endsWith(".html"))
  .map((f) => f.slice(0, -5));
for (const viewport of [
  { width: 1280, height: 900 },
  { width: 375, height: 812 },
]) {
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
      } finally {
        await page.close();
      }
    }
  });
}

// The reviewer's bleed: #app button / input / span rules restyle a light panel mounted in #app. The same panel built
// with shadow: true matches one under a wrapper that passes down the same inherited text styles without those rules,
// while tokens set on its host theme it and its list pane, which opens styled in its own root.
test("a shadow panel inside a styled #app matches an unstyled one; a light panel there doesn't; its host's tokens theme it", async () => {
  const { page, errors } = await open("/fixture/bleed.html");
  await page.waitForSelector("body[data-ready]");
  await page.waitForFunction(() => window.panels.shadow.el.style.visibility === ""); // its stylesheet applied
  const looks = await page.evaluate(() => {
    const props = [
      "padding-top",
      "text-transform",
      "height",
      "display",
      "line-height",
      "letter-spacing",
      "font-size",
      "width",
    ];
    const panelOf = (p) => p.el.shadowRoot?.querySelector(".twk-panel") || p.el;
    const of = (p) =>
      [...panelOf(p).querySelectorAll("button, input, span")].map((n) =>
        props.map((k) => getComputedStyle(n).getPropertyValue(k)).join(" "),
      );
    const { ref, light, shadow } = window.panels;
    return {
      ref: of(ref),
      light: of(light),
      shadow: of(shadow),
      accent: getComputedStyle(panelOf(shadow)).getPropertyValue("--twk-accent").trim(),
      refAccent: getComputedStyle(panelOf(ref)).getPropertyValue("--twk-accent").trim(),
      radius: getComputedStyle(panelOf(shadow)).borderTopLeftRadius,
    };
  });
  assert.ok(looks.ref.length > 10, "sanity: the panel has buttons, inputs and spans");
  assert.notDeepEqual(looks.light, looks.ref, "the light panel in #app is restyled: the bleed reproduces");
  assert.deepEqual(looks.shadow, looks.ref, "the shadow panel in #app looks like the clean one");
  // A control that measured itself before the styles landed measures again: the switch's pill sits on its On.
  const pill = await page.evaluate(() => {
    const r = window.panels.shadow.el.shadowRoot,
      a = r.querySelector(".twk-seg-pill").getBoundingClientRect(),
      b = r.querySelector('.twk-seg-btn[data-active="true"]').getBoundingClientRect();
    return [Math.abs(a.left - b.left), Math.abs(a.width - b.width)];
  });
  assert.ok(pill[0] <= 2 && pill[1] <= 2, `the pill is on its segment (off by ${pill})`);
  assert.equal(looks.accent, "rgb(255, 0, 0)", "the host's --twk-accent themes the shadow panel");
  assert.equal(looks.radius, "13px", "and its --twk-radius, a token with a default (3px + the panel's 10px)");
  assert.notEqual(looks.refAccent, "rgb(255, 0, 0)");
  // Its list pane opens in the portal root on <body>, styled like the clean panel's, in #app's accent.
  const pane = async (name) => {
    await page.evaluate((n) => {
      const p = window.panels[n];
      (p.el.shadowRoot || p.el).querySelector(".twk-select-trigger").click();
    }, name);
    await page.waitForTimeout(300);
    const out = await page.evaluate(() => {
      const dd =
        document.querySelector(".twk-select-dropdown.is-open") ||
        document.querySelector(".twk-portal-host")?.shadowRoot.querySelector(".twk-select-dropdown.is-open");
      const r = dd.getBoundingClientRect(),
        b = dd.querySelector("button"),
        cs = getComputedStyle(b);
      return {
        inShadow: dd.getRootNode() !== document,
        w: r.width,
        h: r.height,
        btn: [cs.height, cs.paddingTop, cs.textTransform, cs.fontSize].join(" "),
        bg: getComputedStyle(dd).backgroundColor,
        accent: getComputedStyle(dd).getPropertyValue("--twk-accent").trim(),
      };
    });
    await page.mouse.click(5, 5);
    await page.waitForTimeout(250);
    return out;
  };
  const refPane = await pane("ref"),
    shadowPane = await pane("shadow");
  assert.equal(shadowPane.inShadow, true, "the shadow panel's pane lives in a shadow root");
  assert.deepEqual(
    [shadowPane.w, shadowPane.h, shadowPane.btn, shadowPane.bg],
    [refPane.w, refPane.h, refPane.btn, refPane.bg],
    "and is styled like the clean panel's",
  );
  assert.equal(shadowPane.accent, "rgb(255, 0, 0)", "carrying the host's accent across");
  assert.deepEqual(errors, []);
});

// The :host rules are the kit's own hosts': `hidden` hides a shadow panel, and a page's web component that loads
// tweaks.css to hold a light panel keeps its own :host display, or the browser's when it has none, `hidden` included.
// The page's @keyframes come along with the copied rules, so a shadow panel's tab page animates in.
test("hidden hides a shadow panel, a page's component keeps its own :host, and a shadow tab page animates", async () => {
  const { page, errors } = await open("/fixture/bleed.html");
  await page.waitForSelector("body[data-ready]");
  const r = await page.evaluate(async () => {
    const { tweaks } = await import("/tweaks/core.js");
    const holder = (name, own) =>
      customElements.define(
        name,
        class extends HTMLElement {
          connectedCallback() {
            const root = this.attachShadow({ mode: "open" });
            root.innerHTML = `${own}<link rel="stylesheet" href="/tweaks.css">`;
            root.append(tweaks("In", { a: 1 }).el);
          }
        },
      );
    holder("my-tuner", "<style>:host { display: inline-flex }</style>");
    holder("my-plain", "");
    const tuner = document.createElement("my-tuner"),
      plain = document.createElement("my-plain");
    const tabs = tweaks("Tabs", { t: { type: "tabs", pages: { One: { a: 1 }, Two: { b: 2 } } } }, { shadow: true });
    // out of <body>'s flex, which blockifies
    const wrap = document.createElement("div");
    wrap.append(tuner, plain);
    document.body.append(wrap, tabs.el);
    await tabs.ready;
    await new Promise((f) => setTimeout(f, 300));
    const display = (n) => getComputedStyle(n).display,
      shadow = window.panels.shadow.el;
    const before = [display(tuner), display(plain), display(shadow)];
    plain.hidden = true;
    shadow.hidden = true;
    tabs.el.shadowRoot.querySelectorAll(".twk-tabs-tab")[1].click();
    await new Promise((f) => setTimeout(f, 30));
    const anim = tabs.el.shadowRoot
      .querySelector(".twk-tabs-page[data-active=true]")
      .getAnimations()
      .map((a) => a.animationName);
    return { before, after: [display(plain), display(shadow)], anim };
  });
  assert.deepEqual(
    r.before,
    ["inline-flex", "inline", "block"],
    "the components keep their own or the browser's display; the shadow host is a block",
  );
  assert.deepEqual(r.after, ["none", "none"], "hidden hides the plain component and the shadow panel");
  assert.deepEqual(r.anim, ["twk-page-in"], "the page-in keyframes came with the copied rules");
  assert.deepEqual(errors, []);
});
