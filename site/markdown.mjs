/* The docs as Markdown: the same page modules the HTML comes from, rendered as text for a
 * reader that fetches rather than browses. htmlToMd() knows the tags the prose uses; a tag it
 * doesn't know fails the build, so a mirror never ships with HTML in it. */
import { dedent, codeText, extractBody, demoCaption, fillSizes } from "./code.mjs";

// the ones the prose uses; another fails the build
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " " };
const unescape = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const hex = /^#x/i.test(e); return String.fromCodePoint(parseInt(e.slice(hex ? 2 : 1), hex ? 16 : 10)); }
  if (!(e in ENTITIES)) throw new Error(`htmlToMd: no Markdown for the entity ${m}`);
  return ENTITIES[e];
});
/** Source whitespace (newlines, indentation) is one space in running text. */
const collapse = (s) => s.replace(/\s+/g, " ").trim();

/** Inline tags → Markdown; entities stay for a later pass, so a `<` can only be a real tag. */
function inline(html, link) {
  return html
    // one backtick more than the longest run inside, padded when it touches one
    .replace(/<code>([\s\S]*?)<\/code>/gi, (m, t) => {
      const f = "`".repeat(Math.max(0, ...(t.match(/`+/g) || []).map((r) => r.length)) + 1), pad = /^`|`$/.test(t) ? " " : "";
      return `${f}${pad}${t}${pad}${f}`;
    })
    .replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, t) => `[${t}](${link(href)})`)
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<em>([\s\S]*?)<\/em>/gi, "*$1*");
}

/** Block HTML (the prose the pages author) → Markdown. `link` rewrites an href. */
export function htmlToMd(html, { link = (h) => h } = {}) {
  const out = [];
  const block = /<(p|h2|h3|h4|ul|ol|table)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let last = 0, m;
  const text = (t) => collapse(inline(t, link));
  while ((m = block.exec(html))) {
    const between = html.slice(last, m.index);
    if (between.trim()) out.push(text(between));
    last = block.lastIndex;
    const [, tag, body] = m;
    if (tag === "p") out.push(text(body));
    else if (tag[0] === "h") out.push(`${"#".repeat(+tag[1])} ${text(body)}`);
    else if (tag === "ul" || tag === "ol") out.push([...body.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((li, i) => `${tag === "ol" ? `${i + 1}.` : "-"} ${text(li[1])}`).join("\n"));
    else {
      if (body.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, "").replace(/<\/?(thead|tbody|tfoot)[^>]*>/gi, "").trim()) throw new Error("htmlToMd: a table holds content outside its rows (a caption?)");
      const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) => [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => text(c[1]).replace(/\|/g, "\\|")));
      if (!rows.length) continue;
      const line = (cells) => `| ${cells.join(" | ")} |`;
      out.push([line(rows[0]), line(rows[0].map(() => "---")), ...rows.slice(1).map(line)].join("\n"));
    }
  }
  const tail = html.slice(last);
  if (tail.trim()) out.push(text(tail));
  const md = out.join("\n\n");
  const left = md.match(/<\/?[a-z][^>]*>/i);
  if (left) throw new Error(`htmlToMd: no Markdown for ${left[0]}`);
  return unescape(md);
}

/** One docs page as Markdown: title, description, intro, then each example's heading, prose and code. */
export function pageToMd(page, { site, sizes = {} }) {
  // absolute: the text travels without its URL
  const link = (href) => href.replace(/^\.\/([\w-]+)\.html/, `${site}/$1.md`).replace(/^\.\//, `${site}/`);
  const fence = (lang, text) => `\`\`\`${lang}\n${text}\n\`\`\``;
  const L = [`# ${page.meta.title}`];
  if (page.meta.description) L.push("", `> ${page.meta.description}`);
  L.push("", `The page: ${site}/${page.meta.slug}.html. Every page as Markdown: ${site}/llms.txt`);
  if (page.intro) L.push("", htmlToMd(page.intro, { link }));
  let firstRunSeen = false;
  for (const ex of [...(page.md || []), ...page.examples]) {
    const title = ex.title || ex.foldCode;
    if (title) L.push("", `## ${title}`);
    if (ex.prose) L.push("", htmlToMd(ex.prose, { link }));
    if (ex.run) {
      L.push("", fence("js", extractBody(ex.run)));
      // The same caption the page shows under its first demo: what the demo's wiring names mean.
      if (!firstRunSeen && !ex.noCaption) L.push("", htmlToMd(demoCaption(ex.target != null)));
      firstRunSeen = true;
    } else if (ex.html) L.push("", fence("html", dedent(ex.html).trim()));
    if (Array.isArray(ex.code)) for (const c of ex.code) L.push("", `${c.label}:`, "", fence(c.lang, codeText(c)));
    else if (ex.code) { const c = typeof ex.code === "string" ? { lang: "js", text: ex.code } : ex.code; L.push("", fence(c.lang, codeText(c))); }
  }
  return fillSizes(L.join("\n") + "\n", sizes);
}
