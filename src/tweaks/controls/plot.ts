// ── Plot — graph y=f(x) with a safe expression evaluator (compileExpr). Lazy.
import { el, txt, clamp, onReady, onLive, quietFocus, registerControl, words } from "../shared.js";
import { svgEl } from "../heavy.js";
import type { OnChange, Built } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control } from "../types.js";

/** A compiled expression: y for an x. */
type Expr = (x: number) => number;
/** The tokens the expression lexer emits. */
type Tok = { t: "num"; v: number } | { t: "id" | "op"; v: string } | { t: "lp" | "rp" | "comma"; v?: undefined };

// ── A safe expression evaluator: recursive descent, not eval/Function, so a typed formula does only arithmetic and
// whitelisted Math calls. Null-prototype tables, so "constructor" can't parse as an identifier. ──
const PLOT_FUNCS: Record<string, (...args: number[]) => number> = Object.assign(Object.create(null), {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  exp: Math.exp,
  log: Math.log,
  ln: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  trunc: Math.trunc,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  hypot: Math.hypot,
  mod: (a: number, b: number) => a % b,
  clamp: (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi),
});
// called empty these return a number (Infinity, 0), so a slip drew nothing and flagged nothing
const PLOT_VARIADIC = ["min", "max", "hypot"];
const PLOT_CONSTS: Record<string, number> = Object.assign(Object.create(null), {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
});
/** The compiled expression, or null on any parse error. */
export function compileExpr(src: unknown): Expr | null {
  const r = parseExpr(src);
  return typeof r === "function" ? r : null;
}
/** The compiled expression, or why it doesn't parse; the reason names the fix where there is one ("write sin(…)"). */
export function parseExpr(src: unknown): Expr | string {
  if (typeof src !== "string" || !src.trim()) return "type an expression in x";
  // also bounds recursion depth, so no RangeError mid-parse
  if (src.length > 512) return "too long: 512 characters at most";
  const s = src,
    toks: Tok[] = [];
  // `5.` reads as 5, as `.5` reads as 0.5. An e is an exponent only with a digit right after it (and its sign): `2e+1` is
  // 20, while `2e+x` is the constant, 2·e + x, as `2e` alone is 2·e. Scientific notation never has a name for its power.
  const numRe = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y,
    idRe = /[A-Za-z_]\w*/y;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\t" || ch === "\n") {
      i++;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || (ch === "." && s[i + 1] >= "0" && s[i + 1] <= "9")) {
      numRe.lastIndex = i;
      const m = numRe.exec(s);
      if (!m || m.index !== i) return `unexpected "${ch}"`;
      toks.push({ t: "num", v: parseFloat(m[0]) });
      i = numRe.lastIndex;
      continue;
    }
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_") {
      idRe.lastIndex = i;
      const m = idRe.exec(s);
      toks.push({ t: "id", v: m[0] });
      i = idRe.lastIndex;
      continue;
    }
    if (ch === "*" && s[i + 1] === "*") {
      toks.push({ t: "op", v: "^" });
      i += 2;
      continue;
    }
    if ("+-*/%^".includes(ch)) {
      toks.push({ t: "op", v: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      toks.push({ t: "lp" });
      i++;
      continue;
    }
    if (ch === ")") {
      toks.push({ t: "rp" });
      i++;
      continue;
    }
    if (ch === ",") {
      toks.push({ t: "comma" });
      i++;
      continue;
    }
    return `unexpected "${ch}"`;
  }
  let p = 0,
    why = "";
  // the innermost reason wins; every caller unwinds on null
  const fail = (m: string): null => {
    why = why || m;
    return null;
  };
  const peek = () => toks[p];
  const eat = (t?: Tok["t"]) => {
    const tok = toks[p];
    if (!tok || (t && tok.t !== t)) return null;
    p++;
    return tok;
  };
  const add = (): Expr | null => {
    let a = mul();
    if (!a) return null;
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = eat("op").v,
        b = mul();
      if (!b) return null;
      const aa = a;
      a = op === "+" ? (x) => aa(x) + b(x) : (x) => aa(x) - b(x);
    }
    return a;
  };
  const mul = (): Expr | null => {
    let a = unary();
    if (!a) return null;
    for (let t = peek(); t; t = peek()) {
      // `2x`, `2pi`, `3(x+1)`, `pi x`, `3x(x)`, `(x)(x)`, `sin(x)cos(x)`: a number, x, a constant or ")" directly before
      // a name or "(" multiplies, as on paper. x and the constants are never functions, so `x(2)` is 2x; `xy` stays one
      // (unknown) name, and a number after an operand (`2 3`, `(x)2`) asks for an operator. It binds as `*` does: `2x^2` is 2·x².
      const prev = toks[p - 1].t,
        implied = (prev === "num" || prev === "id" || prev === "rp") && (t.t === "id" || t.t === "lp");
      if (!implied && !(t.t === "op" && (t.v === "*" || t.v === "/" || t.v === "%"))) break;
      const op = implied ? "*" : eat("op").v,
        b = unary();
      if (!b) return null;
      const aa = a;
      a = op === "*" ? (x) => aa(x) * b(x) : op === "/" ? (x) => aa(x) / b(x) : (x) => aa(x) % b(x);
    }
    return a;
  };
  const unary = (): Expr | null => {
    if (peek() && peek().t === "op" && (peek().v === "-" || peek().v === "+")) {
      const op = eat("op").v,
        a = unary();
      if (!a) return null;
      return op === "-" ? (x) => -a(x) : a;
    }
    return pow();
  };
  const pow = (): Expr | null => {
    const a = atom();
    if (!a) return null;
    if (peek() && peek().t === "op" && peek().v === "^") {
      eat("op");
      const b = unary();
      if (!b) return null;
      return (x) => Math.pow(a(x), b(x));
    }
    return a;
  };
  const atom = (): Expr | null => {
    const tok = peek();
    if (!tok) return null;
    if (tok.t === "num") {
      eat("num");
      return () => tok.v;
    }
    if (tok.t === "lp") {
      eat("lp");
      const e = add();
      if (!e || !eat("rp")) return null;
      return e;
    }
    if (tok.t === "id") {
      eat("id");
      const name = tok.v.toLowerCase(),
        fn = PLOT_FUNCS[name];
      // `x(2)`: a product, in mul()
      if (peek() && peek().t === "lp" && (fn || (name !== "x" && !(name in PLOT_CONSTS)))) {
        if (!fn) return fail(`unknown function "${tok.v}"`);
        eat("lp");
        const argv: Expr[] = [];
        if (peek() && peek().t !== "rp") {
          do {
            const a = add();
            if (!a) return null;
            argv.push(a);
          } while (eat("comma"));
        }
        if (!eat("rp")) return null;
        if (!argv.length && PLOT_VARIADIC.includes(name)) return fail(`${name}() needs at least one value`);
        return (x) => fn(...argv.map((a) => a(x)));
      }
      if (fn) {
        // `sin x`, `cos 2x`: a one-argument function takes a bare x, constant or number-times-name, as a calculator does.
        // Anything longer (`sin x^2`, `sin -x`, `sin 2 cos x`) reads two ways, so it asks for the parentheses instead of guessing.
        const a = fn.length === 1 ? bare() : null,
          n = peek();
        if (!a || (n && (n.t === "op" ? n.v === "^" : n.t !== "rp" && n.t !== "comma")))
          return fail(`write ${name}(…)`);
        return (x) => fn(a(x));
      }
      if (name === "x") return (x) => x;
      if (name in PLOT_CONSTS) {
        const c = PLOT_CONSTS[name];
        return () => c;
      }
      return fail(`unknown name "${tok.v}"`); // an identifier that isn't x, a constant, or a known function
    }
    return null;
  };
  const named = (t: Tok) => t && t.t === "id" && !PLOT_FUNCS[t.v.toLowerCase()];
  const bare = (): Expr | null => {
    const t = peek();
    if (t && t.t === "num") {
      eat("num");
      if (!named(peek())) return () => t.v;
      const b = atom();
      return b && ((x) => t.v * b(x));
    }
    return named(t) ? atom() : null;
  };
  const tree = add(),
    left = toks[p];
  if (tree && !left) return tree;
  if (why) return why;
  // A parse that stopped short, or tokens left over: say where.
  const last = toks[p - 1],
    unclosed = toks.slice(0, p).reduce((d, t) => d + (t.t === "lp" ? 1 : t.t === "rp" ? -1 : 0), 0);
  if (!tree && last && last.t === "op") return `"${last.v}" needs a value on each side`;
  if (!left) return unclosed > 0 ? 'missing ")"' : "not a valid expression";
  return left.t === "num"
    ? `missing an operator before ${left.v}`
    : left.t === "rp"
      ? last && last.t === "lp"
        ? "nothing inside the parentheses"
        : 'unmatched ")"'
      : left.t === "comma"
        ? '"," outside a function\'s parentheses'
        : left.t === "op"
          ? `"${left.v}" needs a value on each side`
          : "not a valid expression";
}

// ── Plot — y = f(x) across a range with an editable expression, or a fixed `fn`. Y auto-ranges unless yMin/yMax are
// given; the line breaks across asymptotes. ──
function createPlot(meta: Meta, onChange: OnChange): Control {
  const tr = words();
  // Non-finite bounds take the defaults, an inverted pair swaps, an equal pair pads out (÷0 drew nothing); a degenerate y-range falls back to auto.
  // min/max are the verbose form's aliases
  let xMin = Number(meta.xMin ?? meta.min),
    xMax = Number(meta.xMax ?? meta.max);
  if (!Number.isFinite(xMin)) xMin = -10;
  if (!Number.isFinite(xMax)) xMax = 10;
  if (xMax < xMin) {
    const t = xMin;
    xMin = xMax;
    xMax = t;
  }
  if (xMax === xMin) {
    xMin -= 1;
    xMax += 1;
  }
  // capped: 1e8 samples per keystroke froze the tab
  const samples = Math.max(2, Math.min(4096, meta.samples | 0 || 256));
  const fixedY = Number.isFinite(meta.yMin) && Number.isFinite(meta.yMax) && +meta.yMax > +meta.yMin;
  const fn = typeof meta.fn === "function" ? meta.fn : null;
  const editable = meta.editable !== false && !fn;
  let expr = meta.expr != null ? String(meta.expr) : fn ? "" : "sin(x)"; // a sine to start from
  let compiled = fn || parseExpr(expr); // a string is the reason it doesn't parse

  const root = el("div", "twk-plot");
  if (meta.label) root.append(txt("div", "twk-plot-label", meta.label));
  const graph = el("div", "twk-plot-graph");
  const svg = svgEl("svg", "twk-plot-svg");
  svg.setAttribute("preserveAspectRatio", "none");
  const axisX = svgEl("line", "twk-plot-axis"),
    axisY = svgEl("line", "twk-plot-axis"),
    curve = svgEl("path", "twk-plot-curve");
  svg.append(axisX, axisY, curve);
  graph.append(svg);
  root.append(graph);

  let input: HTMLInputElement | null = null;
  if (editable) {
    const field = el("div", "twk-plot-field");
    input = el("input", "twk-plot-input");
    input.type = "text";
    input.value = expr;
    input.spellcheck = false;
    input.autocapitalize = "off";
    quietFocus(input);
    /* click-to-edit stays ringless; Tab rings the field */ input.setAttribute(
      "aria-label",
      tr("expression", "{label} — expression in x", { label: meta.label || tr("plot", "Plot") }),
    );
    input.setAttribute("aria-invalid", "false");
    // txt, not el(…, html): el's third arg is innerHTML
    field.append(txt("span", "twk-plot-fx", "y ="), input);
    root.append(field);
  }

  const PAD = 6;
  const draw = () => {
    // Flag invalid before the size guard, so a hidden tab page still reports a bad expression.
    const f = typeof compiled === "function" ? compiled : null,
      ok = !!f;
    root.classList.toggle("is-invalid", editable && !ok);
    // the title says why, and names the fix
    if (input) {
      input.setAttribute("aria-invalid", ok ? "false" : "true");
      input.title = ok ? "" : String(compiled);
    }
    const r = graph.getBoundingClientRect(),
      W = r.width,
      H = r.height;
    if (W < 2) return;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const ys: number[] = [];
    let yLo = Infinity,
      yHi = -Infinity;
    if (ok)
      for (let k = 0; k < samples; k++) {
        const x = xMin + (xMax - xMin) * (k / (samples - 1));
        let y: number;
        try {
          y = f(x);
        } catch {
          y = NaN;
        }
        ys.push(y);
        if (Number.isFinite(y)) {
          if (y < yLo) yLo = y;
          if (y > yHi) yHi = y;
        }
      }
    let lo = meta.yMin,
      hi = meta.yMax;
    if (!fixedY) {
      if (!Number.isFinite(yLo) || yLo === yHi) {
        const c = Number.isFinite(yLo) ? yLo : 0;
        lo = c - 1;
        hi = c + 1;
      } else {
        const pad = (yHi - yLo) * 0.12;
        lo = yLo - pad;
        hi = yHi + pad;
      }
    }
    const xPx = (x: number) => PAD + ((x - xMin) / (xMax - xMin)) * (W - 2 * PAD);
    const yPx = (y: number) => H - PAD - ((y - lo) / (hi - lo)) * (H - 2 * PAD);
    const axis = (ln: Built<SVGLineElement>, ax: number, ay: number, bx: number, by: number, show: boolean) => {
      ln.style.display = show ? "" : "none";
      if (show) {
        ln.setAttribute("x1", ax);
        ln.setAttribute("y1", ay);
        ln.setAttribute("x2", bx);
        ln.setAttribute("y2", by);
      }
    };
    axis(axisX, PAD, yPx(0), W - PAD, yPx(0), lo <= 0 && hi >= 0);
    axis(axisY, xPx(0), PAD, xPx(0), H - PAD, xMin <= 0 && xMax >= 0);
    let d = "",
      pen = false;
    if (ok)
      for (let k = 0; k < samples; k++) {
        const y = ys[k];
        if (!Number.isFinite(y)) {
          pen = false;
          continue;
        }
        const px = xPx(xMin + (xMax - xMin) * (k / (samples - 1))),
          py = clamp(yPx(y), -1e4, 1e4);
        d += (pen ? "L" : "M") + px.toFixed(1) + "," + py.toFixed(1) + " ";
        pen = true;
      }
    curve.setAttribute("d", d);
  };

  if (editable)
    input.addEventListener("input", () => {
      expr = input.value;
      compiled = parseExpr(expr); // a reason string on a parse error → draw flags is-invalid
      draw();
      onChange(expr);
    });

  onReady(draw);
  // twk-reflow: a tab page revealing this re-measures it
  onLive(
    root,
    [
      [window, "resize"],
      [window, "twk-reflow"],
    ],
    draw,
  );

  return {
    el: root,
    get: () => expr,
    // an invalid expression flags, as typing does
    set: (v: unknown) => {
      if (v == null) return;
      expr = String(v);
      if (input) input.value = expr;
      if (!fn) compiled = parseExpr(expr);
      draw();
    },
  };
}

registerControl("plot", createPlot);
