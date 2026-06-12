// ── Plot — graph y=f(x) with a safe expression evaluator (compileExpr). Lazy.
import { el, txt, svgEl, clamp, onReady, onLive, registerControl } from "../shared.js";

// ── A tiny, safe expression evaluator for the plot control. ──────────────────
// Compiles "sin(x)/x" → a closure (x) => number. It is a hand-rolled
// recursive-descent parser, NOT eval/Function: the only things it can ever do
// are arithmetic and a fixed whitelist of Math calls on a single number. There
// is no property access, no identifier outside the whitelist, no way to reach a
// global — so a user-typed formula is harmless. Returns null on any parse error.
// Both lookup tables are null-prototype: the parser checks `PLOT_FUNCS[name]` and
// `name in PLOT_CONSTS`, and a plain object's prototype chain let "constructor" /
// "toString" parse as valid identifiers (no escape — but they violated the whitelist
// and "compiled" to garbage that silently plotted nothing).
const PLOT_FUNCS = Object.assign(Object.create(null), {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
  atan: Math.atan, atan2: Math.atan2, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp, log: Math.log, ln: Math.log,
  log10: Math.log10, log2: Math.log2, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  sign: Math.sign, trunc: Math.trunc, min: Math.min, max: Math.max, pow: Math.pow, hypot: Math.hypot,
  mod: (a, b) => a % b, clamp: (v, lo, hi) => Math.min(Math.max(v, lo), hi),
});
const PLOT_CONSTS = Object.assign(Object.create(null), { pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2 });
export function compileExpr(src) {
  if (typeof src !== "string" || !src.trim() || src.length > 512) return null; // the length cap also bounds recursion depth, so an absurdly nested formula can't overflow the stack mid-parse (a RangeError past the "null on parse error" contract — and the init call in createPlot is unguarded)
  const s = src, toks = [];
  const numRe = /\d*\.?\d+(?:[eE][+-]?\d+)?/y, idRe = /[A-Za-z_]\w*/y;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\t" || ch === "\n") { i++; continue; }
    if ((ch >= "0" && ch <= "9") || (ch === "." && s[i + 1] >= "0" && s[i + 1] <= "9")) {
      numRe.lastIndex = i; const m = numRe.exec(s); if (!m || m.index !== i) return null;
      toks.push({ t: "num", v: parseFloat(m[0]) }); i = numRe.lastIndex; continue;
    }
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_") {
      idRe.lastIndex = i; const m = idRe.exec(s); toks.push({ t: "id", v: m[0] }); i = idRe.lastIndex; continue;
    }
    if (ch === "*" && s[i + 1] === "*") { toks.push({ t: "op", v: "^" }); i += 2; continue; }
    if ("+-*/%^".includes(ch)) { toks.push({ t: "op", v: ch }); i++; continue; }
    if (ch === "(") { toks.push({ t: "lp" }); i++; continue; }
    if (ch === ")") { toks.push({ t: "rp" }); i++; continue; }
    if (ch === ",") { toks.push({ t: "comma" }); i++; continue; }
    return null; // an unrecognised character — reject the whole expression
  }
  if (!toks.length) return null;
  let p = 0;
  const peek = () => toks[p];
  const eat = (t) => { const tok = toks[p]; if (!tok || (t && tok.t !== t)) return null; p++; return tok; };
  const add = () => {
    let a = mul(); if (!a) return null;
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = eat("op").v, b = mul(); if (!b) return null; const aa = a;
      a = op === "+" ? (x) => aa(x) + b(x) : (x) => aa(x) - b(x);
    }
    return a;
  };
  const mul = () => {
    let a = unary(); if (!a) return null;
    while (peek() && peek().t === "op" && (peek().v === "*" || peek().v === "/" || peek().v === "%")) {
      const op = eat("op").v, b = unary(); if (!b) return null; const aa = a;
      a = op === "*" ? (x) => aa(x) * b(x) : op === "/" ? (x) => aa(x) / b(x) : (x) => aa(x) % b(x);
    }
    return a;
  };
  const unary = () => {
    if (peek() && peek().t === "op" && (peek().v === "-" || peek().v === "+")) {
      const op = eat("op").v, a = unary(); if (!a) return null;
      return op === "-" ? (x) => -a(x) : a;
    }
    return pow();
  };
  const pow = () => {
    const a = atom(); if (!a) return null;
    if (peek() && peek().t === "op" && peek().v === "^") { eat("op"); const b = unary(); if (!b) return null; return (x) => Math.pow(a(x), b(x)); }
    return a;
  };
  const atom = () => {
    const tok = peek(); if (!tok) return null;
    if (tok.t === "num") { eat("num"); return () => tok.v; }
    if (tok.t === "lp") { eat("lp"); const e = add(); if (!e || !eat("rp")) return null; return e; }
    if (tok.t === "id") {
      eat("id"); const name = tok.v.toLowerCase();
      if (peek() && peek().t === "lp") {
        const fn = PLOT_FUNCS[name]; if (!fn) return null;
        eat("lp"); const argv = [];
        if (peek() && peek().t !== "rp") { do { const a = add(); if (!a) return null; argv.push(a); } while (eat("comma")); }
        if (!eat("rp")) return null;
        return (x) => fn(...argv.map((a) => a(x)));
      }
      if (name === "x") return (x) => x;
      if (name in PLOT_CONSTS) { const c = PLOT_CONSTS[name]; return () => c; }
      return null; // an identifier that isn't x, a constant, or a known function
    }
    return null;
  };
  const tree = add();
  return tree && p === toks.length ? tree : null; // leftover tokens ⇒ malformed
}

// ── Plot — graph y = f(x) across a range, with a live, editable expression.
// The formula is parsed by compileExpr (no eval), so typing is safe. Pass `fn`
// for a fixed JS function instead of an editable string. Y auto-ranges unless
// yMin/yMax are given; the line breaks across asymptotes (non-finite samples). ──
function createPlot(meta, onChange) {
  // Domain guard: non-finite bounds take the defaults, an inverted pair swaps, and an
  // equal pair pads out — xMin === xMax used to divide the x-mapping into an all-NaN
  // path (a silently blank plot). Same for a pinned y-range: equal/inverted falls back
  // to auto-range rather than a ÷0.
  let xMin = Number(meta.xMin), xMax = Number(meta.xMax);
  if (!Number.isFinite(xMin)) xMin = -10;
  if (!Number.isFinite(xMax)) xMax = 10;
  if (xMax < xMin) { const t = xMin; xMin = xMax; xMax = t; }
  if (xMax === xMin) { xMin -= 1; xMax += 1; }
  const samples = Math.max(2, Math.min(4096, (meta.samples | 0) || 256)); // capped: the curve redraws on every resize + expression keystroke, so an absurd sample count (1e8+) froze the tab
  const fixedY = Number.isFinite(meta.yMin) && Number.isFinite(meta.yMax) && +meta.yMax > +meta.yMin;
  const editable = meta.editable !== false && !meta.fn;
  let expr = meta.expr != null ? String(meta.expr) : "";
  let compiled = typeof meta.fn === "function" ? meta.fn : compileExpr(expr);

  const root = el("div", "tw-plot");
  if (meta.label) root.append(txt("div", "tw-plot-label", meta.label));
  const graph = el("div", "tw-plot-graph");
  const svg = svgEl("svg", "tw-plot-svg"); svg.setAttribute("preserveAspectRatio", "none");
  const axisX = svgEl("line", "tw-plot-axis"), axisY = svgEl("line", "tw-plot-axis"), curve = svgEl("path", "tw-plot-curve");
  svg.append(axisX, axisY, curve); graph.append(svg); root.append(graph);

  let input = null;
  if (editable) {
    const field = el("div", "tw-plot-field");
    input = el("input", "tw-plot-input"); input.type = "text"; input.value = expr; input.spellcheck = false;
    input.autocapitalize = "off"; input.autocomplete = "off"; input.setAttribute("aria-label", `${meta.label || "Plot"} — expression in x`);
    field.append(el("span", "tw-plot-fx", "y ="), input); root.append(field);
  }

  const PAD = 6;
  const draw = () => {
    const r = graph.getBoundingClientRect(), W = r.width, H = r.height; if (W < 2) return;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const ok = typeof compiled === "function";
    const ys = []; let yLo = Infinity, yHi = -Infinity;
    if (ok) for (let k = 0; k < samples; k++) {
      const x = xMin + (xMax - xMin) * (k / (samples - 1));
      let y; try { y = compiled(x); } catch { y = NaN; }
      ys.push(y);
      if (Number.isFinite(y)) { if (y < yLo) yLo = y; if (y > yHi) yHi = y; }
    }
    let lo = meta.yMin, hi = meta.yMax;
    if (!fixedY) {
      if (!Number.isFinite(yLo) || yLo === yHi) { const c = Number.isFinite(yLo) ? yLo : 0; lo = c - 1; hi = c + 1; }
      else { const pad = (yHi - yLo) * 0.12; lo = yLo - pad; hi = yHi + pad; }
    }
    const xPx = (x) => PAD + ((x - xMin) / (xMax - xMin)) * (W - 2 * PAD);
    const yPx = (y) => (H - PAD) - ((y - lo) / (hi - lo)) * (H - 2 * PAD);
    const axis = (ln, ax, ay, bx, by, show) => { ln.style.display = show ? "" : "none"; if (show) { ln.setAttribute("x1", ax); ln.setAttribute("y1", ay); ln.setAttribute("x2", bx); ln.setAttribute("y2", by); } };
    axis(axisX, PAD, yPx(0), W - PAD, yPx(0), lo <= 0 && hi >= 0);
    axis(axisY, xPx(0), PAD, xPx(0), H - PAD, xMin <= 0 && xMax >= 0);
    let d = "", pen = false;
    if (ok) for (let k = 0; k < samples; k++) {
      const y = ys[k];
      if (!Number.isFinite(y)) { pen = false; continue; }
      const px = xPx(xMin + (xMax - xMin) * (k / (samples - 1))), py = clamp(yPx(y), -1e4, 1e4);
      d += (pen ? "L" : "M") + px.toFixed(1) + "," + py.toFixed(1) + " "; pen = true;
    }
    curve.setAttribute("d", d);
    root.classList.toggle("is-invalid", editable && !ok);
  };

  if (editable) input.addEventListener("input", () => {
    expr = input.value; const c = compileExpr(expr);
    if (c) compiled = c; else compiled = null;
    draw(); onChange(expr);
  });

  onReady(draw);
  onLive(root, [[window, "resize"], [window, "tw-reflow"]], draw); // tw-reflow: a tab page revealing this control re-measures it (it built at 0×0 while hidden); self-cleans once the panel is gone

  return {
    el: root,
    get: () => expr,
    set: (v) => { if (v == null) return; expr = String(v); if (input) input.value = expr; if (!meta.fn) compiled = compileExpr(expr); draw(); }, // an invalid expression nulls compiled + flags is-invalid via draw — same contract as typing, never silently keeps plotting the old one
  };
}

registerControl("plot", createPlot);

