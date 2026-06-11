/* Tiny build-time syntax highlighter — JS + HTML modes, zero dependencies.
 * Scope is deliberately small: it colors the code WE author for the docs site.
 * No regex literals, no nested template literals — keep the examples plain.
 * Emits <span class="tok-*"> wrappers; token text is HTML-escaped on output. */

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const KEYWORDS = new Set(
  ("const let var function return if else for while do new class extends import from export default " +
   "await async of in typeof instanceof void delete this super null undefined true false try catch " +
   "finally throw switch case break continue yield").split(" "),
);

// One alternation, longest-wins: comments | strings (incl. templates) | numbers | identifiers.
const JS_TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:[^`\\]|\\[\s\S])*`|"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*')|(\b0x[\da-fA-F]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/g;

export function highlightJS(src) {
  let out = "", last = 0, m;
  JS_TOKEN.lastIndex = 0;
  while ((m = JS_TOKEN.exec(src))) {
    out += esc(src.slice(last, m.index));
    const text = m[0];
    if (m[1]) out += `<span class="tok-cm">${esc(text)}</span>`;
    else if (m[2]) out += `<span class="tok-str">${esc(text)}</span>`;
    else if (m[3]) out += `<span class="tok-num">${esc(text)}</span>`;
    else {
      const after = src.slice(m.index + text.length);
      const before = src.slice(0, m.index);
      if (KEYWORDS.has(text)) out += `<span class="tok-kw">${esc(text)}</span>`;
      else if (/^\s*\(/.test(after)) out += `<span class="tok-fn">${esc(text)}</span>`;
      else if (/\.\s*$/.test(before)) out += `<span class="tok-prop">${esc(text)}</span>`;
      else if (/^:/.test(after)) out += `<span class="tok-key">${esc(text)}</span>`;
      else out += esc(text);
    }
    last = m.index + text.length;
  }
  return out + esc(src.slice(last));
}

// HTML: comments | whole tags (sub-tokenized) | text between.
const HTML_TOKEN = /(<!--[\s\S]*?-->)|(<\/?[a-zA-Z][^>]*>)/g;

export function highlightHTML(src) {
  let out = "", last = 0, m;
  HTML_TOKEN.lastIndex = 0;
  while ((m = HTML_TOKEN.exec(src))) {
    out += esc(src.slice(last, m.index));
    out += m[1] ? `<span class="tok-cm">${esc(m[1])}</span>` : tag(m[2]);
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}

function tag(t) {
  const m = t.match(/^(<\/?)([a-zA-Z][\w-]*)([\s\S]*?)(\/?>)$/);
  if (!m) return esc(t);
  const [, open, name, rest, close] = m;
  // Escape the attribute region first (it can carry & in values), then color
  // name="value" pairs — escaping leaves no < or >, so the attr regex stays valid.
  const attrs = esc(rest).replace(/([\w-]+)(=)(&quot;.*?&quot;|'[^']*')?/g, (s, an, eq, av) =>
    `<span class="tok-attr">${an}</span>${eq}${av ? `<span class="tok-str">${av}</span>` : ""}`);
  return `<span class="tok-pn">${esc(open)}</span><span class="tok-tag">${name}</span>${attrs}<span class="tok-pn">${esc(close)}</span>`;
}
