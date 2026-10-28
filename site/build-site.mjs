/* Tweakit docs site generator. Pages are ES modules in site/pages/, imported raw by Node and
 * never transpiled: each example's `run` function is toString()-serialized into both the
 * snippet and the page's module script, so the two can't drift.
 * A page exports meta { slug, title, nav?, description?, hero?, wide? }, intro (HTML under the
 * h1) and examples, blocks of { id, title, prose, target, css, run, html, code, noCaption, noMount, foldCode };
 * `code` is a string, { lang, text }, or an array of { label, lang, text } shown as tabs.
 * A page may also export `script`, a function the page runs once (page-only behavior, shown nowhere;
 * toString()-serialized like `run`, so it can't reach the module's imports or constants), and
 * `md`, blocks shaped like examples that only its Markdown mirror shows (for a page whose
 * content lives in demo markup the mirror can't read). */
import { readFile, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { highlightJS, highlightHTML } from "./highlight.mjs";
import { esc, dedent, codeBlock, renderCode, codeTabs, extractBody, demoCaption, fillSizes } from "./code.mjs";
import { pageToMd } from "./markdown.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Sidebar sections and page order (also prev/next).
const NAV = [
  { section: "Guide", slugs: ["index", "getting-started", "quick-tour"] },
  { section: "Controls", slugs: ["numbers", "text-and-choices", "color-and-gradient", "motion", "monitors", "structure"] },
  { section: "Panel", slugs: ["panel-api", "theming", "markup", "imports"] },
];

const href = (slug) => `./${slug}.html`;

/** Build the site into outDir. `chunks` is every file of the code-split build; a page that
 * runs examples preloads them all, so the kit arrives in one round trip instead of four.
 * `site` is the published origin and path, for the absolute links in the Markdown files. */
export async function buildSite({ outDir, esbuild, sizes, chunks = [], version, site }) {
  if (!version) throw new Error("buildSite: pass the package version (the sidebar shows it)");
  if (!site) throw new Error("buildSite: pass the site URL (the Markdown mirrors link by it)");
  const shell = await readFile(path.join(HERE, "shell.html"), "utf8");

  for (const [file, loader] of [["site.css", "css"], ["site.js", "js"]]) {
    const { code } = await esbuild.transform(await readFile(path.join(HERE, file), "utf8"), { minify: true, loader });
    await writeFile(path.join(outDir, file), code);
  }
  await cp(path.join(HERE, "static"), outDir, { recursive: true });

  // Import every page up front, so a syntax error fails before any file writes.
  const pages = [];
  for (const group of NAV) {
    for (const slug of group.slugs) {
      const mod = await import(pathToFileURL(path.join(HERE, "pages", `${slug}.mjs`)).href);
      if (mod.meta?.slug !== slug) throw new Error(`pages/${slug}.mjs: meta.slug "${mod.meta?.slug}" must match the filename`);
      if (mod.script !== undefined && typeof mod.script !== "function") throw new Error(`pages/${slug}.mjs: script must be a function`);
      pages.push({ meta: mod.meta, intro: mod.intro || "", examples: mod.examples || [], script: mod.script, md: mod.md || [], section: group.section });
    }
  }

  for (let i = 0; i < pages.length; i++) {
    // Hyphenated size tokens survive the shell's {{\w+}} pass; a leaked one means no sizes were passed.
    const html = fillSizes(renderPage(shell, pages, i, chunks, version), sizes);
    const leak = html.match(/\{\{size-[\w-]+\}\}/);
    if (leak) throw new Error(`pages/${pages[i].meta.slug}.mjs: unsubstituted ${leak[0]} — pass sizes to buildSite()`);
    await writeFile(path.join(outDir, `${pages[i].meta.slug}.html`), html);
  }
  console.log(`site → ${pages.length} pages: ${pages.map((p) => p.meta.slug + ".html").join(", ")}`);
  await writeAgentFiles({ outDir, pages, sizes, version, site });
}

/** The site for a reader that fetches: a Markdown mirror of every page (the same modules, the
 * same examples), `llms.txt` as its map, `llms-full.txt` as one file, and the agent guide
 * stamped with the version it documents. The guide's own source carries no version: the copy
 * in the npm package matches the package by construction, and this copy says which one it is. */
async function writeAgentFiles({ outDir, pages, sizes, version, site }) {
  const stamp = `Built from the tweakit source at v${version} on ${new Date().toISOString().slice(0, 10)} UTC.`;
  const guide = await readFile(path.join(HERE, "..", "AGENTS.md"), "utf8");
  const stamped = guide.replace(/^(# [^\n]+\n)\n*/, `$1\n> ${stamp} The copy inside the installed package, node_modules/tweakit/AGENTS.md, matches whatever version you have.\n\n`);
  if (stamped === guide) throw new Error("AGENTS.md must open with an H1 line (the build stamps the site copy under it)");
  await writeFile(path.join(outDir, "AGENTS.md"), stamped);

  const mirrors = [];
  for (const page of pages) {
    const md = pageToMd(page, { site, sizes });
    await writeFile(path.join(outDir, `${page.meta.slug}.md`), md);
    mirrors.push(md);
  }

  const line = (p) => `- [${p.meta.nav || p.meta.title}](${site}/${p.meta.slug}.md): ${p.meta.description || p.meta.title}\n`;
  let llms = "# Tweakit\n\n> A dependency-free, code-split, real-time parameter panel for the browser. `npm install tweakit`, then hand `tweaks(name, schema)` a plain object and it builds a live control for each value.\n\n";
  llms += `${stamp} Start with the agent guide; the rest is the docs site, one Markdown file per page.\n`;
  for (const group of NAV) {
    llms += `\n## ${group.section}\n`;
    if (group.section === "Guide") llms += `- [Agent guide](${site}/AGENTS.md): every control and the value it returns, the panel API, how copied values come back; the same file ships inside the npm package.\n`;
    for (const slug of group.slugs) llms += line(pages.find((p) => p.meta.slug === slug));
  }
  llms += `\n## Optional\n- [Everything in one file](${site}/llms-full.txt): the guide and every page above, concatenated.\n- [Type declarations](https://unpkg.com/tweakit/dist/types/tweaks/types.d.ts): every option, with its doc comment.\n`;
  await writeFile(path.join(outDir, "llms.txt"), llms);

  // One fetch reads it whole only under 100,000 characters (the common cap); past that, trim the docs or drop the file.
  const full = [stamped, ...mirrors].join("\n\n---\n\n");
  if (full.length > 100_000) throw new Error(`llms-full.txt would be ${full.length} characters; agents truncate past 100,000`);
  await writeFile(path.join(outDir, "llms-full.txt"), full);
  console.log(`agents → AGENTS.md, llms.txt, llms-full.txt (${full.length} chars), ${mirrors.length} .md mirrors`);
}

const GITHUB_ICON = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';

function renderPage(shell, pages, idx, chunks = [], version = "") {
  const page = pages[idx];
  const { meta } = page;
  const title = meta.slug === "index" ? meta.title : `${meta.title} · Tweakit`;

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

  // The function replacement disarms `$` in values and never rescans substituted content.
  const values = {
    title: esc(title),
    slug: esc(meta.slug),
    url: `https://ryankiley.github.io/tweakit/${meta.slug === "index" ? "" : esc(meta.slug) + ".html"}`,
    description: esc(meta.description || "Tweakit — a dependency-free, code-split, real-time parameter panel."),
    styles: css ? `  <style>${css}</style>` : "",
    nav: renderNav(pages, meta.slug),
    version: esc(version),
    // Topbar and sidebar both carry these; written once here.
    versionLink: `<a class="site-version" href="https://github.com/ryankiley/tweakit/releases/tag/v${esc(version)}" rel="noopener" title="Release notes for v${esc(version)}">v${esc(version)}</a>`,
    github: GITHUB_ICON,
    docClass: meta.wide ? " doc-wide" : "",
    content,
    footnav: renderFootnav(pages, idx),
    script: renderScript(page),
  };
  // only pages that run the kit
  values.preload = values.script ? chunks.map((f) => `  <link rel="modulepreload" href="./tweaks/${f}" />`).join("\n") : "";
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
  if ((ex.run || ex.html) && !ex.id) throw new Error(`example "${ex.title || "?"}": run/html examples need an id`);
  // every id is a page id (ex-*, tab-*, fold-*), so each must be unique
  if (ex.id) {
    if (ids.has(ex.id)) throw new Error(`duplicate example id "${ex.id}"`);
    ids.add(ex.id);
  }
  const heading = ex.title ? `<h2>${esc(ex.title)}</h2>` : "";

  let code = "";
  if (ex.run) code = codeBlock(highlightJS(extractBody(ex.run)), "js");
  else if (ex.html) code = codeBlock(highlightHTML(dedent(ex.html).trim()), "html");
  // An array of { label, lang, text } renders as tabs over one block at a time.
  if (Array.isArray(ex.code)) {
    if (!ex.id) throw new Error(`example "${ex.title || "?"}": code tabs need an id`);
    code += codeTabs(ex.id, ex.code, ex.title);
  } else if (ex.code) {
    code += renderCode(typeof ex.code === "string" ? { lang: "js", text: ex.code } : ex.code);
  }

  // A fold is a toggle plus a separate body (not one <details>) so the toggle can sit inside the
  // stage; site.js wires them. hidden="until-found" keeps find-in-page able to open the code.
  if (ex.foldCode && !ex.id) throw new Error(`example "${ex.title || "?"}": foldCode needs an id (the toggle points at its body by it)`);
  let toggle = "";
  if (code && ex.foldCode) {
    toggle = `<div class="ex-fold"><button class="ex-fold-toggle" type="button" aria-expanded="false" aria-controls="fold-${ex.id}">${esc(ex.foldCode)}</button></div>`;
    code = `<div class="ex-fold-body" id="fold-${ex.id}" hidden="until-found">${code}</div>`;
  }

  let live = "";
  if (ex.run) {
    const target = ex.target != null ? `<div class="ex-target">${ex.target}</div>` : "";
    const mount = ex.noMount ? "" : `<div class="ex-mount"></div>`;
    live = `<div class="ex-live${target ? "" : " ex-live-solo"}">${target}${toggle}${mount}</div>`;
    toggle = "";
  } else if (ex.html) {
    live = `<div class="ex-live ex-live-markup"><div class="ex-target">${ex.html}</div></div>`;
  }
  code = toggle + code;

  const note = captioned ? demoCaption(ex.target != null) : "";
  return `<section class="ex"${ex.id ? ` id="ex-${ex.id}"` : ""}>${heading}${ex.prose || ""}${live}${code}${note}</section>`;
}



function renderScript(page) {
  const runs = page.examples.filter((ex) => ex.run);
  const hasMarkup = page.examples.some((ex) => ex.html);
  if (!runs.length && !hasMarkup && !page.script) return "";
  // A page with [data-twk] markup imports the auto entry, whose enhance(document) on load alone powers those examples.
  let js = `import { tweaks, enhance, gradientCss } from "./tweaks/${hasMarkup ? "auto" : "core"}.js";\n`;
  if (runs.length) {
    js += `const wire = (id, fn) => { const ex = document.getElementById(id); fn({ tweaks, enhance, gradientCss, mount: ex.querySelector(".ex-mount"), target: ex.querySelector(".ex-target") }); };\n`;
    for (const ex of runs) {
      const src = ex.run.toString();
      // "</script" closes the inline module and "<!--" corrupts the parser, so refuse at build.
      if (/<\/script|<!--/i.test(src)) throw new Error(`example "${ex.id}": "</script" and "<!--" cannot appear in run source`);
      js += `wire(${JSON.stringify(`ex-${ex.id}`)}, ${src});\n`;
    }
  }
  if (page.script) {
    const src = page.script.toString();
    if (/<\/script|<!--/i.test(src)) throw new Error(`pages/${page.meta.slug}.mjs: "</script" and "<!--" cannot appear in script source`);
    js += `(${src})();\n`;
  }
  return `<script type="module">\n${js}</script>`;
}
