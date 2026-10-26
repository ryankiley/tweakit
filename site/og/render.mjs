// Shoots site/og/card.html to site/static/og.png at 2x with the local Chrome. Run after a build
// (the card loads dist/), then commit the PNG; the site build copies static/ into the docs.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "site/static/og.png");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer(async (req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  let body;
  try { body = await readFile(file); } catch { return res.writeHead(404).end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }).end(body);
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));

try {
  await promisify(execFile)(CHROME, [  // async: the page is fetched from this process
    "--headless=new", "--hide-scrollbars", "--force-device-scale-factor=2", "--window-size=1200,630",
    "--virtual-time-budget=3000", `--screenshot=${OUT}`,
    `http://127.0.0.1:${server.address().port}/site/og/card.html`,
  ]);
} finally { server.close(); }
// oxipng, when it's installed, shaves about a quarter off losslessly
const squeezed = await promisify(execFile)("oxipng", ["-o", "max", "--strip", "safe", OUT]).then(() => true, () => false);
console.log(`og → ${path.relative(ROOT, OUT)}${squeezed ? " (oxipng)" : ""}`);
