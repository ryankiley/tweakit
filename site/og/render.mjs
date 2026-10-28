// Shoots site/og/card.html to site/static/og.png at 1x (1200×630, what link previews draw) with Playwright's Chromium,
// once the card says it's ready. Run after a build (the card loads dist/), then commit the PNG; the site build
// copies static/ into the docs. On a Mac, so the word is set in SF Pro.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "site/static/og.png");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer(async (req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  let body;
  try {
    body = await readFile(file);
  } catch {
    return res.writeHead(404).end();
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }).end(body);
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/site/og/card.html`);
  await page.waitForSelector("body[data-ready]", { state: "attached", timeout: 10_000 });
  if (errors.length) throw new Error(`card.html threw: ${errors.join("; ")}`);
  await page.screenshot({ path: OUT });
} finally {
  await browser.close();
  server.close();
}
// oxipng, when it's installed, shaves about a quarter off losslessly
const squeezed = await promisify(execFile)("oxipng", ["-o", "max", "--strip", "safe", OUT]).then(
  () => true,
  () => false,
);
console.log(`og → ${path.relative(ROOT, OUT)}${squeezed ? " (oxipng)" : ""}`);
