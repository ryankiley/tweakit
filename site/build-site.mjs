/* Tweakability docs site generator — zero dependencies (esbuild is passed in, only
 * to minify site.css / site.js). Pages are ES modules in site/pages/, imported RAW
 * by Node at build time.
 *
 * ⚠ Page modules must NEVER pass through esbuild/minification: each example's `run`
 * function is serialized with Function.prototype.toString(), and that exact text is
 * BOTH displayed as the snippet and inlined into the page's <script type="module">
 * for execution. One source, zero drift.
 *
 * A page module exports:
 *   meta     — { slug, title, nav?, description?, hero? }  (hero: page renders its own h1)
 *   intro    — HTML string placed under the h1
 *   examples — array of blocks; each block:
 *     id      anchor id (required when run/html present; unique per page)
 *     title   h2 heading (optional)
 *     prose   HTML string (optional)
 *     target  HTML injected as the demo surface (optional; run-mode only)
 *     css     page-scoped CSS — use example-unique class names, nothing auto-scopes
 *     run     ({ tweaks, enhance, mount, target }) => {}  — live example, single source
 *     html    string — [data-tw] markup-mode example: injected verbatim AND displayed
 *     code    extra display-only snippet: string (js) or { lang: "js"|"html"|"css"|"sh", text }
 *     noCaption  suppress the mount/target caption (it auto-shows on a page's first run)
 *     noMount    omit the panel slot — for runs that build panels into the target/body
 */
import { readFile, writeFile, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { highlightJS, highlightHTML } from "./highlight.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Single source for the sidebar: section grouping + page order (also prev/next order).
const NAV = [
  { section: "Guide", slugs: ["index", "getting-started", "quick-tour"] },
  { section: "Controls", slugs: ["numbers", "text-and-choices", "color-and-gradient", "motion", "monitors", "structure"] },
  { section: "Panel", slugs: ["panel-api", "theming", "markup", "imports"] },
];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const href = (slug) => `./${slug}.html`;

export async function buildSite({ outDir, esbuild, sizes }) {
  const shell = await readFile(path.join(HERE, "shell.html"), "utf8");

  for (const [file, loader] of [["site.css", "css"], ["site.js", "js"]]) {
    const { code } = await esbuild.transform(await readFile(path.join(HERE, file), "utf8"), { minify: true, loader });
    await writeFile(path.join(outDir, file), code);
  }
  if (existsSync(path.join(HERE, "static"))) await cp(path.join(HERE, "static"), outDir, { recursive: true });

  // Import every page up front — any syntax error fails the build before files write.
  const pages = [];
  for (const group of NAV) {
    for (const slug of group.slugs) {
      const mod = await import(pathToFileURL(path.join(HERE, "pages", `${slug}.mjs`)).href);
      if (mod.meta?.slug !== slug) throw new Error(`pages/${slug}.mjs: meta.slug "${mod.meta?.slug}" must match the filename`);
      pages.push({ meta: mod.meta, intro: mod.intro || "", examples: mod.examples || [], section: group.section });
    }
  }

  for (let i = 0; i < pages.length; i++) {
    // Build-measured bundle sizes (hyphenated tokens, so the shell's {{\w+}} pass leaves
    // them for here). A leaked token means buildSite was called without sizes — fail loud
    // rather than ship "{{size-split}}" to a reader.
    let html = renderPage(shell, pages, i);
    if (sizes) html = html.replaceAll("{{size-split}}", sizes.split).replaceAll("{{size-single}}", sizes.single);
    const leak = html.match(/\{\{size-[\w-]+\}\}/);
    if (leak) throw new Error(`pages/${pages[i].meta.slug}.mjs: unsubstituted ${leak[0]} — pass sizes to buildSite()`);
    await writeFile(path.join(outDir, `${pages[i].meta.slug}.html`), html);
  }
  console.log(`site → ${pages.length} pages: ${pages.map((p) => p.meta.slug + ".html").join(", ")}`);
}

function renderPage(shell, pages, idx) {
  const page = pages[idx];
  const { meta } = page;
  const title = meta.slug === "index" ? meta.title : `${meta.title} · Tweakability`;

  const ids = new Set();
  let firstRunSeen = false;
  const blocks = page.examples.map((ex) => {
    const captioned = ex.run && !firstRunSeen && !ex.noCaption;
    if (ex.run) firstRunSeen = true;
    return renderExample(ex, ids, captioned);
  });

  for (const ex of page.examples) {
    if (ex.css && /<\/style/i.test(ex.css)) throw new Error(`example "${ex.id || ex.title || "?"}": "</style" cannot appear in example CSS (it would close the page's <style> block)`);
  }
  const css = page.examples.map((ex) => ex.css || "").filter(Boolean).join("\n");
  const content = (meta.hero ? "" : `<h1>${esc(meta.title)}</h1>`) + page.intro + blocks.join("\n");

  // Single-pass substitution: the function replacement disarms `$`-sequences in the
  // values, and substituted content is never rescanned — so "{{content}}" inside page
  // copy stays literal instead of acting as a reserved word.
  const values = {
    title: esc(title),
    description: esc(meta.description || "Tweakability — a dependency-free, code-split, real-time parameter panel."),
    styles: css ? `  <style>${css}</style>` : "",
    nav: renderNav(pages, meta.slug),
    content,
    footnav: renderFootnav(pages, idx),
    script: renderScript(page),
  };
  return shell.replace(/\{\{(\w+)\}\}/g, (m, k) => (Object.hasOwn(values, k) ? values[k] : m));
}

function renderNav(pages, currentSlug) {
  let out = "";
  for (const group of NAV) {
    out += `<div class="sb-group"><div class="sb-section">${esc(group.section)}</div>`;
    for (const slug of group.slugs) {
      const p = pages.find((pg) => pg.meta.slug === slug);
      const cur = slug === currentSlug;
      out += `<a class="sb-link${cur ? " sb-current" : ""}"${cur ? ' aria-current="page"' : ""} href="${href(slug)}">${esc(p.meta.nav || p.meta.title)}</a>`;
    }
    out += `</div>`;
  }
  return out;
}

function renderFootnav(pages, idx) {
  const prev = pages[idx - 1], next = pages[idx + 1];
  if (!prev && !next) return "";
  return `<nav class="doc-footnav">` +
    (prev ? `<a class="fn-prev" href="${href(prev.meta.slug)}"><span>Previous</span>${esc(prev.meta.nav || prev.meta.title)}</a>` : "") +
    (next ? `<a class="fn-next" href="${href(next.meta.slug)}"><span>Next</span>${esc(next.meta.nav || next.meta.title)}</a>` : "") +
    `</nav>`;
}

function renderExample(ex, ids, captioned) {
  if (ex.run || ex.html) {
    if (!ex.id) throw new Error(`example "${ex.title || "?"}": run/html examples need an id`);
    if (ids.has(ex.id)) throw new Error(`duplicate example id "${ex.id}"`);
    ids.add(ex.id);
  }
  const heading = ex.title ? `<h2>${esc(ex.title)}</h2>` : "";

  let live = "";
  if (ex.run) {
    const target = ex.target != null ? `<div class="ex-target">${ex.target}</div>` : "";
    const mount = ex.noMount ? "" : `<div class="ex-mount"></div>`;
    live = `<div class="ex-live${target ? "" : " ex-live-solo"}">${target}${mount}</div>`;
  } else if (ex.html) {
    live = `<div class="ex-live ex-live-markup"><div class="ex-target">${ex.html}</div></div>`;
  }

  let code = "";
  if (ex.run) code = codeBlock(highlightJS(extractBody(ex.run)), "js");
  else if (ex.html) code = codeBlock(highlightHTML(dedent(ex.html).trim()), "html");
  if (ex.code) {
    const c = typeof ex.code === "string" ? { lang: "js", text: ex.code } : ex.code;
    const text = dedent(c.text).trim();
    code += codeBlock(c.lang === "html" ? highlightHTML(text) : c.lang === "js" ? highlightJS(text) : esc(text), c.lang);
  }

  const note = captioned
    ? `<p class="ex-note"><code>mount</code> is the panel's slot inside the stage; <code>target</code> is the demo surface it controls. In your own page you'd just <code>document.body.append(panel.el)</code>.</p>`
    : "";
  return `<section class="ex"${ex.id ? ` id="ex-${ex.id}"` : ""}>${heading}${ex.prose || ""}${live}${code}${note}</section>`;
}

const codeBlock = (html, lang) => `<div class="ex-codewrap"><pre class="ex-code" data-lang="${lang}"><code>${html}</code></pre></div>`;

// The single-source trick: the displayed snippet is the run function's own body.
function extractBody(fn) {
  const src = fn.toString();
  const arrow = src.indexOf("=>");
  const open = src.indexOf("{", arrow);
  if (arrow < 0 || open < 0) throw new Error("example `run` must be an arrow function with a braced body");
  return dedent(src.slice(open + 1, src.lastIndexOf("}")));
}

function dedent(text) {
  const lines = String(text).replace(/^\n+/, "").replace(/\s+$/, "").split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join("\n");
}

function renderScript(page) {
  const runs = page.examples.filter((ex) => ex.run);
  const hasMarkup = page.examples.some((ex) => ex.html);
  if (!runs.length && !hasMarkup) return "";
  // Importing core also auto-runs enhance(document) on DOMContentLoaded — that alone
  // powers the [data-tw] markup-mode examples; run-mode examples wire up below it.
  let js = `import { tweaks, enhance } from "./tweaks/core.js";\n`;
  if (runs.length) {
    js += `const wire = (id, fn) => { const ex = document.getElementById(id); fn({ tweaks, enhance, mount: ex.querySelector(".ex-mount"), target: ex.querySelector(".ex-target") }); };\n`;
    for (const ex of runs) {
      const src = ex.run.toString();
      // "</script" closes the inline module; "<!--" flips the parser into the
      // script-data-double-escape state — both corrupt the page, so refuse at build.
      if (/<\/script|<!--/i.test(src)) throw new Error(`example "${ex.id}": "</script" and "<!--" cannot appear in run source`);
      js += `wire(${JSON.stringify(`ex-${ex.id}`)}, ${src});\n`;
    }
  }
  return `<script type="module">\n${js}</script>`;
}
