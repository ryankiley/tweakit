/* Code blocks for the docs: one block, or a row of tabs over several. Shared by the site
 * generator and any page that sets a block inside its own markup (the landing's install line). */
import { highlightJS, highlightHTML } from "./highlight.mjs";

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function dedent(text) {
  const lines = String(text).replace(/^\n+/, "").replace(/\s+$/, "").split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join("\n");
}

export const codeBlock = (html, lang, attrs = "") => `<div class="ex-codewrap"${attrs}><pre class="ex-code" data-lang="${lang}"><code>${html}</code></pre></div>`;

/** The text of a { lang, text } block. A "text" block is prose (a prompt): single newlines are
 *  source wrapping, so they join; blank lines stay. */
export const codeText = (c) => (c.lang === "text" ? dedent(c.text).trim().replace(/(\S)\n(?=(?![-*+] |\d+\. )\S)/g, "$1 ") : dedent(c.text).trim()); // a list item keeps its line

/** One block from { lang, text }. */
export function renderCode(c, attrs = "") {
  const text = codeText(c);
  return codeBlock(c.lang === "html" ? highlightHTML(text) : c.lang === "js" ? highlightJS(text) : esc(text), c.lang, attrs);
}

/** The displayed snippet of an example's `run`: the function's own body. */
export function extractBody(fn) {
  const src = fn.toString();
  const arrow = src.indexOf("=>");
  const open = src.indexOf("{", arrow);
  if (arrow < 0 || open < 0) throw new Error("example `run` must be an arrow function with a braced body");
  return dedent(src.slice(open + 1, src.lastIndexOf("}")));
}

/** Tabs over one block at a time, from [{ label, lang, text }]; site.js wires the switching.
 *  `id` keys the tab and panel ids, so it is unique on its page; `label` names the tab list. */
export function codeTabs(id, tabs, label) {
  if (!tabs.length) throw new Error(`code tabs "${id}": no tabs`);
  const row = tabs.map((c, i) => `<button class="ex-tab" type="button" role="tab" id="tab-${id}-${i}" aria-selected="${i === 0}" aria-controls="tabpanel-${id}-${i}"${i ? ' tabindex="-1"' : ""}>${esc(c.label)}</button>`).join("");
  const panels = tabs.map((c, i) => renderCode(c, ` role="tabpanel" id="tabpanel-${id}-${i}" aria-labelledby="tab-${id}-${i}"${i ? " hidden" : ""}`)).join("");
  return `<div class="ex-tabs"><div class="ex-tablist" role="tablist"${label ? ` aria-label="${esc(label)}"` : ""}>${row}</div>${panels}</div>`;
}

/** The note under a page's first demo: what the demo's wiring names mean. HTML; the Markdown
 *  mirror converts this same string, so the page and the mirror say the same thing. */
export const demoCaption = (hasTarget) =>
  `<p class="ex-note"><code>mount</code> is the panel's slot inside the stage${hasTarget ? "; <code>target</code> is the demo surface it controls" : ""}. In your own page you'd just <code>document.body.append(panel.el)</code>.</p>`;
