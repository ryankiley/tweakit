// ── Color — wide-gamut OKLCH picker. Lazy: dynamic-imported on first use, and
// the only module that loads wide-gamut.js (so basic panels never pay for it).
import { el, txt, clamp, rangeStep, popover, quietFocus, escapeReverts, registerControl, announce } from "../shared.js";
import { numField, grabSurface, boxFrac, triggerRow, selectAllOnFocus } from "../heavy.js";
import { oklchGamutProbe, chromaCeil, hexByte, oklchToHex, hexToOklch, channelValues, withChannel, gamutLabel, showsGamutBoundary, readout, serialize, EDIT_MODES, MODE_LABELS, MODE_CHANNELS, MAX_CHROMA, convert, oklchToRgbFn, num } from "../../wide-gamut.js";
import type { Vec3, Space, Gamut } from "../../wide-gamut.js";
import type { OnChange, NumField } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control, ColorMode } from "../types.js";

/** A parsed color: OKLCH plus alpha. */
export type Oklcha = [number, number, number, number];
/** What the picker body is built from: the opening color, the notation, and an onMode hook for the host's trigger. */
export interface PickerOptions { value?: string; mode?: ColorMode; onMode?: () => void }
/** The picker body's handle — a Control plus the mode and trigger-painting surface. */
export interface PickerBody extends Control { el: HTMLDivElement; set(v: string): void; get(): string; mode(): ColorMode; setMode(m: ColorMode): void; reflow(): void; swatchCss(): string; valueText(): string }

// ── Color-area rendering. The plane stretches to the P3 gamut, drawn at device-pixel
// resolution in a Display-P3 canvas where supported, so wide colors render true. ──
const WIDE_CANVAS = (() => { try { return document.createElement("canvas").getContext("2d", { colorSpace: "display-p3" })?.getContextAttributes?.().colorSpace === "display-p3"; } catch { return false; } })();
const CANVAS_CS: CanvasRenderingContext2DSettings & ImageDataSettings = WIDE_CANVAS ? { colorSpace: "display-p3" } : {};
const ENGINE_GAMUT: Gamut = WIDE_CANVAS ? "p3" : "srgb"; // working gamut for the rasterized pixels
const sampleCurve = (curve: Float64Array, t: number) => { const last = curve.length - 1, pos = Math.max(0, Math.min(last, t * last)), i = Math.floor(pos), f = pos - i; return curve[i] * (1 - f) + curve[Math.min(i + 1, last)] * f; };
const gamutCurve = (hue: number, gamut: Gamut) => { const probe = oklchGamutProbe(hue, gamut), c = new Float64Array(128); for (let i = 0; i < 128; i++) c[i] = chromaCeil(probe, i / 127); return c; };
const CHECKER = "var(--tw-checker)"; // the alpha checker, a tweaks.css token

// Parsing: any CSS color (hex / oklch / oklab / lab / lch / color() / rgb / hsl / named) → [L, C, H, alpha].
// The CSS Color 4 functions are parsed by regex + the engine; the canvas fallback is only safe
// for sRGB-family colors, since its fillStyle getter echoes wide colors in their own notation.
// Null-prototype: the space name comes from the parsed string, so `color(constructor …)` must
// miss rather than resolve to a member of Object.prototype and reach convert().
const COLOR_FN_SPACES: Record<string, Space> = Object.assign(Object.create(null), { srgb: "srgb", "display-p3": "p3", rec2020: "rec2020", "prophoto-rgb": "prophoto-rgb" });
const SRGB_FN_RE = /^(rgba?|hsla?|hwb)\([ \t\n\r\f]*([^)]*?)[ \t\n\r\f]*\)$/i; // sRGB-family functions; no nested parens
const ENGINE_FN_RE = /^(oklch|oklab|lch|lab|color)\([ \t\n\r\f]*([^)]*?)[ \t\n\r\f]*\)$/i; // the engine's own functions
const CSS_SPACES = /^(srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65)$/i; // color()'s predefined spaces
const HEX_RE = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i; // 3/4/6/8 digits only; 5/7 is junk
// The one scratch 2D context; null where the DOM has no canvas (jsdom), and that is cached too.
let c2dCache: CanvasRenderingContext2D | null;
const canvas2d = () => (c2dCache === undefined ? (c2dCache = document.createElement("canvas").getContext("2d")) : c2dCache);
// Shape first, then grammar: a stop's text is concatenated into a `linear-gradient()`, where a
// stray ")" could splice in a url(), and a color-shaped `oklch(a b c)` makes a browser drop the
// whole gradient. A bare keyword is put to the canvas against two sentinels, so a legitimate
// `black` isn't mistaken for the "junk leaves fillStyle unchanged" echo.
const COLOR_TOKEN = /^(#[0-9a-f]{3,8}|[a-z][a-z-]*(?:\([\w\s.,%+\-\/]*\))?)$/i;
/** Is `str` one CSS color token and nothing more? The gate a gradient stop passes before it reaches a style sink. */
export function isColor(str: string | null | undefined) {
  str = String(str == null ? "" : str).trim();
  if (!COLOR_TOKEN.test(str)) return false;
  if (HEX_RE.test(str)) return true;
  if (ENGINE_FN_RE.test(str)) return engineFn(str);
  if (SRGB_FN_RE.test(str)) return srgbFn(str) !== null;
  const c2d = canvas2d(); if (!c2d) return true;
  return ["#000", "#fff"].some((sentinel) => { c2d.fillStyle = sentinel; const before = c2d.fillStyle; c2d.fillStyle = str; return c2d.fillStyle !== before; });
}
// The sRGB-family functions by CSS Color 4's own grammar — modern and legacy syntax, `none`,
// percentages, angle units — and nothing looser, so a color-shaped string CSS would reject
// (`rgb(a b c)`, a mixed legacy `rgb(255, 0%, 0)`) is null here. Channels clamp where CSS clamps.
const CSS_NUM = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[+-]?\\d+)?"; // CSS's <number>; a trailing dot ("1.") is not one
const TOK_NUM = new RegExp("^" + CSS_NUM + "$", "i"), TOK_PCT = new RegExp("^" + CSS_NUM + "%$", "i"), TOK_ANGLE = new RegExp("^(" + CSS_NUM + ")(deg|grad|rad|turn)$", "i"), CSS_WS = /[ \t\n\r\f]+/, NONE = /^none$/i; // keywords are ASCII case-insensitive
const cssTrim = (t: string) => t.replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, "");
const one = (t: string) => !!t && !CSS_WS.test(t); // exactly one token in the slot
const tokKind = (t: string) => (NONE.test(t) ? "none" : TOK_NUM.test(t) ? "num" : TOK_PCT.test(t) ? "pct" : TOK_ANGLE.test(t) ? "angle" : null);
// num() on both paths: Infinity % 360 is NaN, which would zero every channel.
const parseAngle = (t: string) => { const m = TOK_ANGLE.exec(t); if (!m) return num(parseFloat(t)); const n = parseFloat(m[1]), u = m[2].toLowerCase(); return num(u === "turn" ? n * 360 : u === "grad" ? n * 0.9 : u === "rad" ? (n * 180) / Math.PI : n); };
function srgbFn(str: string): [Vec3, number] | null {
  const m = SRGB_FN_RE.exec(str); if (!m) return null;
  const fn = m[1].toLowerCase().replace(/a$/, "") as "rgb" | "hsl" | "hwb", body = m[2];
  let ch: string[], alpha: string | undefined, kinds: Array<ReturnType<typeof tokKind>>;
  if (body.includes(",")) { // legacy: rgb()/hsl() only, no none, no mixed units
    if (fn === "hwb") return null;
    const parts = body.split(",").map(cssTrim);
    if (parts.length < 3 || parts.length > 4 || !parts.every(one)) return null;
    ch = parts.slice(0, 3); alpha = parts[3]; kinds = ch.map(tokKind);
    if (fn === "rgb" ? !(kinds.every((k) => k === "num") || kinds.every((k) => k === "pct")) : !((kinds[0] === "num" || kinds[0] === "angle") && kinds[1] === "pct" && kinds[2] === "pct")) return null;
    if (alpha !== undefined && tokKind(alpha) !== "num" && tokKind(alpha) !== "pct") return null;
  } else {
    const slash = body.split("/"); if (slash.length > 2) return null;
    ch = slash[0].split(CSS_WS).filter(Boolean); if (ch.length !== 3) return null;
    if (slash.length === 2) { alpha = cssTrim(slash[1]); const ak = one(alpha) ? tokKind(alpha) : null; if (!ak || ak === "angle") return null; }
    kinds = ch.map(tokKind);
    if (fn === "rgb" ? !kinds.every((k) => k && k !== "angle") : !(kinds[0] && kinds[0] !== "pct" && kinds[1] && kinds[1] !== "angle" && kinds[2] && kinds[2] !== "angle")) return null;
  }
  const n = (t: string, max: number) => (NONE.test(t) ? 0 : /%$/.test(t) ? (parseFloat(t) / 100) * max : parseFloat(t)); // never NaN; ±Infinity meets the clamp below
  const A = alpha === undefined ? 1 : clamp(n(alpha, 1), 0, 1);
  const k = fn === "rgb"
    ? convert([clamp(n(ch[0], 255) / 255, 0, 1), clamp(n(ch[1], 255) / 255, 0, 1), clamp(n(ch[2], 255) / 255, 0, 1)], "srgb", "oklch")
    : convert([kinds[0] === "none" ? 0 : parseAngle(ch[0]), clamp(n(ch[1], 100), 0, 100), clamp(n(ch[2], 100), 0, 100)], fn, "oklch");
  return [k, A];
}
// The engine's own functions by the same standard: three channel tokens (the hue slot of
// lch()/oklch() takes an angle, not a percentage), an optional `/ alpha`, and for color() a predefined space first.
const engineFn = (str: string) => {
  const m = ENGINE_FN_RE.exec(str); if (!m) return false;
  const fn = m[1].toLowerCase(), slash = m[2].split("/"); if (slash.length > 2) return false;
  const toks = slash[0].split(CSS_WS).filter(Boolean);
  if (fn === "color" && !CSS_SPACES.test(toks.shift() || "")) return false;
  if (toks.length !== 3) return false;
  const hue = fn === "lch" || fn === "oklch";
  if (!toks.every((t, i) => { const k = tokKind(t); return k && (hue && i === 2 ? k !== "pct" : k !== "angle"); })) return false;
  if (slash.length === 2) { const a = cssTrim(slash[1]), ak = one(a) ? tokKind(a) : null; if (!ak || ak === "angle") return false; }
  return true;
};
function parseColor(str: string | null | undefined): Oklcha {
  str = String(str == null ? "" : str).trim();
  if (HEX_RE.test(str)) {
    let hx = str.replace("#", ""), A = 1;
    if (hx.length === 4) { A = parseInt(hx[3] + hx[3], 16) / 255; hx = hx.slice(0, 3); }
    else if (hx.length === 8) { A = parseInt(hx.slice(6, 8), 16) / 255; hx = hx.slice(0, 6); }
    const [L, C, H] = hexToOklch("#" + hx); return [L, C, H, A];
  }
  const m = ENGINE_FN_RE.exec(str);
  if (m) {
    const fn = m[1].toLowerCase();
    const [body, aRaw] = m[2].split("/").map((s) => s.trim());
    let toks = body.split(/\s+/).filter(Boolean), space = fn as Space;
    if (fn === "color") { space = COLOR_FN_SPACES[(toks[0] || "").toLowerCase()]; toks = toks.slice(1); if (!space) return [0.7, 0.1, 280, 1]; } // an unsupported color() space degrades to the default
    // One channel: `none` → 0, `%` scales by the slot's ratio, num() keeps NaN out (a seed degrades, it doesn't reject).
    const ch = (t: string | undefined, pctScale = 1) => (!t || NONE.test(t) ? 0 : num(parseFloat(t)) * (/%$/.test(t) ? pctScale : 1));
    const A = aRaw ? clamp(ch(aRaw, 0.01), 0, 1) : 1;
    // L and chroma clamp at parse time, as CSS Color 4 does.
    const c: Vec3 =
      fn === "lab" ? [clamp(ch(toks[0]), 0, 100), ch(toks[1], 1.25), ch(toks[2], 1.25)]                          // L% is 0–100 as-is; a/b 100% ↔ ±125
      : fn === "lch" ? [clamp(ch(toks[0]), 0, 100), Math.max(0, ch(toks[1], 1.5)), parseAngle(toks[2] || "0")]   // C 100% ↔ 150; H takes angle units
      : fn === "color" ? [ch(toks[0], 0.01), ch(toks[1], 0.01), ch(toks[2], 0.01)]
      : fn === "oklab" ? [clamp(ch(toks[0], 0.01), 0, 1), ch(toks[1], 0.004), ch(toks[2], 0.004)]                // L% → 0–1; a/b 100% ↔ ±0.4
      : [clamp(ch(toks[0], 0.01), 0, 1), Math.max(0, ch(toks[1], 0.004)), parseAngle(toks[2] || "0")];           // oklch
    const k = space === "oklch" ? c : convert(c, space, "oklch");
    // Chroma is capped at MAX_CHROMA: `oklch(0.5 1e999 0)` parsed to C = Infinity and hung the gamut map's bisection.
    return [num(k[0]), clamp(num(k[1]), 0, MAX_CHROMA), ((num(k[2]) % 360) + 360) % 360, A]; // hue in [0,360) so a negative input can't strand the thumb
  }
  // rgb() / hsl() / hwb() by CSS's own grammar; a string it rejects parses as black like any junk.
  if (SRGB_FN_RE.test(str)) {
    const sf = srgbFn(str); if (!sf) return [0, 0, 0, 1];
    const [k, A] = sf;
    return [num(k[0]), clamp(num(k[1]), 0, MAX_CHROMA), ((num(k[2]) % 360) + 360) % 360, A];
  }
  // Named colors and `transparent` normalize via a canvas, whose fillStyle getter echoes
  // "#rrggbb" or "rgba(r,g,b,a)". Junk, or no canvas at all (a headless DOM), parses as black.
  const c2d = canvas2d(); if (!c2d) return [0, 0, 0, 1];
  c2d.fillStyle = "#000"; c2d.fillStyle = str;
  const norm = c2d.fillStyle as string; // a string was set, so the getter echoes a string
  if (HEX_RE.test(norm)) return parseColor(norm); // gated on the hex shape, so the recursion is bounded
  const rm = norm.match(/^rgba?\(([^)]*)\)/i);
  const cm = ((rm ? rm[1] : "").match(/-?[\d.]+(?:e[+-]?\d+)?/gi) || [0, 0, 0]).map(Number);
  const k = convert([cm[0] / 255, cm[1] / 255, cm[2] / 255], "srgb", "oklch");
  return [num(k[0]), num(k[1]), num(k[2]), cm[3] != null ? clamp(num(cm[3]), 0, 1) : 1];
}

// Whether a written color is handed back as written: a color in a notation the picker edits, with every number a plain
// one. Anything else (1e999, a named color) is normalized, as the picker reads it.
const verbatim = (v: unknown): v is string => typeof v === "string" && isColor(v) && notationOf(v) !== null && (v.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []).every((n) => Math.abs(+n) <= 1000);
// The edit mode a written color's notation maps to; null for one with no mode of its own (a named color, lab() with
// alpha in a form the picker can't echo), which opens in OKLCH.
const notationOf = (v: unknown): ColorMode | null => {
  const t = String(v ?? "").trim().toLowerCase();
  if (HEX_RE.test(t)) return "hex";
  const fn = /^([a-z]+)\(\s*([a-z0-9-]*)/.exec(t);
  if (!fn) return null;
  if (fn[1] === "rgb" || fn[1] === "rgba") return t.includes(",") ? "css" : "srgb";
  if (fn[1] === "color") return fn[2] === "display-p3" ? "p3" : fn[2] === "rec2020" ? "rec2020" : fn[2] === "srgb" ? "srgb" : null;
  return (["hsl", "hwb", "oklch", "oklab", "lch", "lab"] as const).find((m) => m === fn[1] || fn[1] === "hsla" && m === "hsl") ?? null;
};

// ── Picker body ──
/** The editor surface: L×C plane, hue + alpha strips, mode dropdown + gamut label, and per-mode channel inputs.
 *  No trigger or popover of its own: the color control mounts one in its popover, the gradient editor re-points one at the selected stop. */
function createPickerBody(meta: PickerOptions, onChange: (c: string) => void): PickerBody {
  let [L, C, H, A] = parseColor(isColor(meta.value) ? meta.value : "#7c5cff"); // the kit's default color, for none or junk (parseColor reads junk as black)
  // It opens in the notation the color was written in, unless the host seeds a mode, and hands back that exact string
  // until it's edited: "#ff0000" read back as oklch(63% 0.26 29), so code expecting hex broke and pasted values drifted.
  const seeded = EDIT_MODES.includes(meta.mode); // a host's mode (the gradient's blend space) holds; only an unseeded picker follows a color's notation
  let mode = seeded ? meta.mode : notationOf(meta.value) ?? "oklch";
  let raw: string | null = verbatim(meta.value) ? meta.value.trim() : null;
  let paintedHue = NaN, chromaCurve: Float64Array | null = null, chanFields: NumField[] = [];
  let hueRingH = NaN, hueRingBg = ""; // the hue ring depends only on H; cached
  const colorStr = () => raw ?? serialize([L, C, H], mode, A);

  const root = el("div", "tw-color-body");
  const area = el("div", "tw-wg-area"); const areaCanvas = document.createElement("canvas"); areaCanvas.className = "tw-wg-canvas"; const areaThumb = el("div", "tw-wg-thumb"); area.append(areaCanvas, areaThumb);
  const hueBar = el("div", "tw-wg-hue"); const hueCanvas = document.createElement("canvas"); hueCanvas.className = "tw-wg-hue-canvas"; const hueThumb = el("div", "tw-wg-hue-thumb"); hueBar.append(hueCanvas, hueThumb);
  const alphaBar = el("div", "tw-wg-alpha"); const alphaGrad = el("div", "tw-wg-alpha-grad"); const alphaThumb = el("div", "tw-wg-hue-thumb"); alphaBar.append(alphaGrad, alphaThumb);
  // The rasters are decoration; the plane and strips carry the names and live values.
  areaCanvas.setAttribute("aria-hidden", "true"); hueCanvas.setAttribute("aria-hidden", "true");
  // Keyboard-operable plane: a focusable group (no ARIA role fits a 2D value; the readout rides on aria-description).
  area.tabIndex = 0; area.setAttribute("role", "group"); area.setAttribute("aria-label", "Color plane: chroma across, lightness up");
  hueBar.tabIndex = 0; hueBar.setAttribute("role", "slider"); hueBar.setAttribute("aria-label", "Hue");
  hueBar.setAttribute("aria-valuemin", "0"); hueBar.setAttribute("aria-valuemax", "360");
  alphaBar.tabIndex = 0; alphaBar.setAttribute("role", "slider"); alphaBar.setAttribute("aria-label", "Alpha");
  alphaBar.setAttribute("aria-valuemin", "0"); alphaBar.setAttribute("aria-valuemax", "1");
  const modeRow = el("div", "tw-color-mode-row");
  const modeSel = el("select", "tw-color-mode"); modeSel.setAttribute("aria-label", "Color mode");
  EDIT_MODES.forEach((m) => { const o = document.createElement("option"); o.value = m; o.textContent = MODE_LABELS[m]; modeSel.append(o); });
  modeSel.value = mode;
  const gamut2 = el("span", "tw-color-gamut");
  modeRow.append(modeSel, gamut2);
  const channels = el("div", "tw-color-channels");
  root.append(area, hueBar, alphaBar, modeRow, channels);

  const actx = areaCanvas.getContext("2d", CANVAS_CS);
  const hctx = hueCanvas.getContext("2d");

  // One offscreen raster per body: a hue drag repaints every move.
  const off = document.createElement("canvas");
  const octx = off.getContext("2d", CANVAS_CS);
  let offData: ImageData | null = null;
  const renderArea = () => {
    // Layout size: getBoundingClientRect includes the pop's entrance scale.
    const cssW = area.clientWidth, cssH = area.clientHeight; if (cssW < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const stretch = showsGamutBoundary(mode) ? "p3" : "srgb";
    const curve = gamutCurve(H, stretch); chromaCurve = curve; // per-lightness chroma ceiling of the plane gamut
    const backingW = Math.round(cssW * dpr), backingH = Math.round(cssH * dpr);
    const W = Math.max(1, Math.round(backingW / 4)), Hh = Math.max(1, Math.round(backingH / 4)); // gradient rasterized at 1/4 res
    if (off.width !== W || off.height !== Hh) { off.width = W; off.height = Hh; offData = new ImageData(W, Hh, CANVAS_CS); }
    const data = offData.data;
    const invH = Hh > 1 ? 1 / (Hh - 1) : 0, invW = W > 1 ? 1 / (W - 1) : 0;
    // H is constant for the raster, so fold the oklch→RGB chain once instead of a per-pixel convert().
    const toRgb = oklchToRgbFn(H, ENGINE_GAMUT), rgb = [0, 0, 0];
    for (let y = 0; y < Hh; y++) { const Lp = 1 - y * invH, rowMax = sampleCurve(curve, Lp); for (let x = 0; x < W; x++) { toRgb(Lp, x * invW * rowMax, rgb); const o = (y * W + x) * 4; data[o] = Math.round(clamp(rgb[0], 0, 1) * 255); data[o + 1] = Math.round(clamp(rgb[1], 0, 1) * 255); data[o + 2] = Math.round(clamp(rgb[2], 0, 1) * 255); data[o + 3] = 255; } }
    octx.putImageData(offData, 0, 0);
    areaCanvas.width = backingW; areaCanvas.height = backingH; actx.imageSmoothingEnabled = true; actx.drawImage(off, 0, 0, backingW, backingH);
    // Gamut boundaries: solid sRGB line inside, dashed P3 line on the displayable edge.
    if (stretch !== "srgb") {
      const trace = (gamut: Gamut, color: string, width: number, dash: number[]) => {
        const probe = oklchGamutProbe(H, gamut), pts: [number, number][] = [];
        for (let s = 0; s <= 100; s++) { const Lp = s / 100, edge = sampleCurve(curve, Lp); if (edge <= 0) continue; const c = chromaCeil(probe, Lp, edge); if (c <= 0) continue; pts.push([Math.min((c / edge) * backingW, backingW - (width * dpr) / 2), (1 - Lp) * backingH]); }
        if (pts.length < 2) return;
        actx.save(); actx.strokeStyle = color; actx.lineWidth = width * dpr; actx.lineJoin = actx.lineCap = "round"; actx.setLineDash(dash.map((d) => d * dpr)); actx.beginPath(); pts.forEach((p, i) => (i ? actx.lineTo(p[0], p[1]) : actx.moveTo(p[0], p[1]))); actx.stroke(); actx.restore();
      };
      trace("srgb", "rgba(255,255,255,0.7)", 1.5, []);
      trace("p3", "rgba(255,255,255,0.4)", 1, [3, 3]);
    }
    paintedHue = H;
  };
  // The strip's color at a hue: the sRGB chroma ceiling at a fixed lightness, so every hue
  // shows at its most saturated displayable form; the same fill paints the hue thumb's ring.
  const STRIP_L = 0.7;
  const vividHue = (hue: number) => { const rgb = convert([STRIP_L, chromaCeil(oklchGamutProbe(hue, "srgb"), STRIP_L), hue], "oklch", "srgb"); return `rgb(${clamp(rgb[0] * 255, 0, 255) | 0},${clamp(rgb[1] * 255, 0, 255) | 0},${clamp(rgb[2] * 255, 0, 255) | 0})`; };
  let hueW = 0;
  const renderHue = () => {
    const w = Math.max(1, hueBar.clientWidth), h = Math.max(1, hueBar.clientHeight); if (w < 2) return; // layout size, as above
    if (w === hueW && hueCanvas.width === w) return; // the strip depends only on width
    hueW = w; hueCanvas.width = w; hueCanvas.height = h;
    for (let x = 0; x < w; x++) { hctx.fillStyle = vividHue((x / (w - 1)) * 360); hctx.fillRect(x, 0, 1, h); }
  };
  const positionThumbs = () => {
    const ceil = chromaCurve ? sampleCurve(chromaCurve, L) : 0.4; // thumb x is C as a fraction of the row's ceiling
    // The area thumb may overhang, so a color at the gamut boundary reads as fully selected.
    const at = (frac: number) => `${clamp(frac, 0, 1) * 100}%`;
    // The strip thumbs stay inside their track: the center runs from +w/2 at 0 to −w/2 at 1.
    const inside = (frac: number, w: number) => { const f = clamp(frac, 0, 1); return `calc(${f * 100}% + ${(0.5 - f) * w}px)`; };
    areaThumb.style.left = at(ceil > 0 ? C / ceil : 0); areaThumb.style.top = at(1 - L);
    hueThumb.style.left = inside(H / 360, 16); alphaThumb.style.left = inside(A, 16);
    alphaBar.setAttribute("aria-valuenow", String(+A.toFixed(2)));
    const hDeg = Math.round(H); hueBar.setAttribute("aria-valuenow", String(hDeg)); hueBar.setAttribute("aria-valuetext", `${hDeg}°`); // H may be 360: End reads as the top of the range
    area.setAttribute("aria-description", `lightness ${Math.round(L * 100)}%, chroma ${+C.toFixed(3)}`);
    alphaGrad.style.background = `linear-gradient(to right, oklch(${L} ${C} ${H} / 0), oklch(${L} ${C} ${H}))`;
    // Filled rings: a grabbed thumb scales past its track, so each ring carries its own
    // color instead of revealing the dropdown bg in the slivers above and below the strip.
    areaThumb.style.background = `oklch(${L} ${C} ${H})`;
    alphaThumb.style.background = `linear-gradient(oklch(${L} ${C} ${H} / ${A}), oklch(${L} ${C} ${H} / ${A})), var(--tw-dropdown-bg)`;
    if (H !== hueRingH) { hueRingBg = vividHue(H); hueRingH = H; }
    hueThumb.style.background = hueRingBg;
  };
  const hexText = () => oklchToHex(L, C, H) + (A < 0.999 ? hexByte(A) : "");
  const refresh = () => {
    gamut2.textContent = gamutLabel([L, C, H], mode);
    if (mode === "hex") { const hx = channels.querySelector<HTMLInputElement>(".tw-color-chan-input"); if (hx && document.activeElement !== hx) hx.value = hexText(); }
    else { const vals = channelValues([L, C, H], mode); chanFields.forEach((f, i) => { if (!f.el.contains(document.activeElement)) f.set(vals[i]); }); }
  };
  const reflow = () => { renderHue(); renderArea(); positionThumbs(); }; // mounted at real size → rasterize + place the thumbs
  const emit = () => onChange(colorStr());
  // renderArea bails on zero width, so an offscreen repaint is a cheap no-op.
  const sync = (repaint: boolean) => { if (repaint && H !== paintedHue) renderArea(); positionThumbs(); refresh(); };
  const commit = (repaint: boolean) => { raw = null; sync(repaint); emit(); }; // an edit writes the picker's own notation

  const renderChannels = () => {
    channels.replaceChildren(); chanFields = [];
    if (mode === "hex") {
      channels.classList.add("tw-color-channels--hex");
      const wrap = el("div", "tw-color-chan");
      const inp = el("input", "tw-color-chan-input"); inp.type = "text"; inp.spellcheck = false; inp.setAttribute("aria-label", "Hex color"); quietFocus(inp); selectAllOnFocus(inp); // select all: you replace a color, not a digit
      inp.addEventListener("change", () => { const v = inp.value.trim(); if (HEX_RE.test(v)) { [L, C, H, A] = parseColor(v); commit(true); } });
      // refresh() skips a focused field; catch up on blur (change fires first, so a typed edit is in).
      inp.addEventListener("blur", refresh);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
      escapeReverts(inp, hexText);
      wrap.append(txt("span", "tw-color-chan-label", "HEX"), inp); channels.append(wrap);
    } else {
      // The same field as Point/Spring, so the grab handle works for color values too.
      channels.classList.remove("tw-color-channels--hex");
      const vals = channelValues([L, C, H], mode);
      MODE_CHANNELS[mode].forEach((ch, i) => {
        const f = numField({ label: ch.k, value: vals[i], min: ch.min, max: ch.max, step: ch.step }, (v) => { [L, C, H] = withChannel([L, C, H], mode, i, clamp(v, ch.min, ch.max)); commit(true); });
        f.el.addEventListener("focusout", refresh); // as the hex field: catch up on the way out
        chanFields.push(f); channels.append(f.el);
      });
    }
    refresh();
  };

  const ceilAt = (l: number) => (chromaCurve ? sampleCurve(chromaCurve, l) : 0.4);
  const areaXY = (e: PointerEvent) => boxFrac(e, area);
  const setArea = (e: PointerEvent) => { const [fx, fy] = areaXY(e); L = 1 - fy; C = fx * ceilAt(L); commit(false); };
  grabSurface(area, setArea);
  // Arrows move the thumb, not the raw channels: chroma steps as a fraction of its row, so a
  // vertical step stays in gamut. Home/End mean nothing for a 2D point and are swallowed so they don't scroll the page.
  let sayT = 0;
  area.addEventListener("keydown", (e) => {
    if (e.key === "Home" || e.key === "End") { e.preventDefault(); return; }
    const k = e.shiftKey ? 10 : 1;
    const dx = e.key === "ArrowRight" ? k : e.key === "ArrowLeft" ? -k : 0, dy = e.key === "ArrowUp" ? k : e.key === "ArrowDown" ? -k : e.key === "PageUp" ? 10 : e.key === "PageDown" ? -10 : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    const c0 = ceilAt(L), fx = clamp((c0 > 0 ? C / c0 : 0) + dx * 0.01, 0, 1);
    L = clamp(L + dy * 0.01, 0, 1); C = fx * ceilAt(L);
    commit(false);
    // The readout rides on aria-description, which a screen reader speaks on focus and never again: say where a run of keys stopped.
    clearTimeout(sayT); sayT = setTimeout(() => { if (area.isConnected) announce(area.getAttribute("aria-description") || ""); }, 250);
  });
  const hueAt = (e: PointerEvent) => boxFrac(e, hueBar)[0] * 360;
  const setHue = (e: PointerEvent) => { H = hueAt(e); commit(true); };
  grabSurface(hueBar, setHue);
  hueBar.addEventListener("keydown", (e) => {
    const nv = rangeStep(e, H, 1, 0, 360);
    if (nv == null) return;
    e.preventDefault(); H = clamp(nv, 0, 360); commit(true);
  });
  const alphaAt = (e: PointerEvent) => boxFrac(e, alphaBar)[0];
  const setAlpha = (e: PointerEvent) => { A = alphaAt(e); commit(false); };
  grabSurface(alphaBar, setAlpha);
  alphaBar.addEventListener("keydown", (e) => {
    const nv = rangeStep(e, A, 0.01, 0, 1);
    if (nv == null) return;
    e.preventDefault(); A = clamp(nv, 0, 1); commit(false);
  });

  // A mode switch is formatting-only and never emits: notifying would push a no-op change into
  // undo and rewrite a gradient's stored stop strings. The dropdown also repaints the host's trigger (meta.onMode); setMode is the host pushing a mode in, so it fires neither.
  const remode = (m: ColorMode) => { mode = m; raw = null; modeSel.value = m; renderChannels(); renderArea(); positionThumbs(); };
  modeSel.addEventListener("change", () => { remode(modeSel.value as ColorMode); meta.onMode && meta.onMode(); }); // the dropdown only holds EDIT_MODES

  renderChannels();

  return {
    el: root,
    // Blur a focused text field before re-pointing: its change handler commits typed text against
    // the OLD state, so stop-hopping can't land stop A's text on stop B. Only text fields: blurring the plane reads as focus leaving the popover, which closes it.
    set: (v: string) => { if (!isColor(v)) { console.warn(`[tweaks] color: "${String(v).slice(0, 40)}" isn't a color — kept ${colorStr()}`); return; } const ae = document.activeElement as HTMLElement; if (ae && root.contains(ae) && ae.matches("input")) ae.blur(); [L, C, H, A] = parseColor(v); const m = seeded ? null : notationOf(v); if (m && m !== mode) remode(m); raw = verbatim(v) ? v.trim() : null; sync(true); }, // remode() first: it clears raw
    get: () => colorStr(),
    // The gradient reads the mode to choose its blend space and re-points it on a stored ramp.
    mode: () => mode,
    setMode: (m: ColorMode) => { if (m !== mode && EDIT_MODES.includes(m)) remode(m); },
    reflow,
    // The host paints its own trigger from these — the body carries no swatch/value of its own.
    swatchCss: () => `linear-gradient(oklch(${L} ${C} ${H} / ${A}), oklch(${L} ${C} ${H} / ${A})), ${CHECKER}`,
    valueText: () => readout([L, C, H], mode) + (A < 0.999 ? (mode === "hex" ? hexByte(A) : ` / ${+A.toFixed(2)}`) : ""),
  };
}

// ── Color control — a trigger row (label + swatch + value readout) that opens a picker body in a popover. ──
function createColor(meta: Meta, onChange: OnChange): Control {
  const { root, trigger, right } = triggerRow("tw-color", meta.label ?? "Color"); // ??: an explicit "" label renders none
  const swatch = el("span", "tw-trigger-chip tw-color-swatch");
  const valueEl = el("span", "tw-trigger-value");
  right.append(swatch, valueEl);

  const pop = el("div", "tw-color-pop");
  const paintTrigger = () => { swatch.style.background = body.swatchCss(); valueEl.textContent = body.valueText(); };
  const body = createPickerBody({ value: meta.value, mode: meta.mode as ColorMode, onMode: () => paintTrigger() }, (c) => { paintTrigger(); onChange(c); });
  pop.append(body.el);
  root.append(pop);

  popover(root, trigger, pop, { fallbackH: 340, onOpen: body.reflow, onReflow: body.reflow });
  paintTrigger();

  return { el: root, set: (v: string) => { if (v == null) return; body.set(v); paintTrigger(); }, get: () => body.get() };
}

/** An oklch() string at display precision, alpha appended only when translucent. */
const oklchStr = (L: number, C: number, H: number, A: number) => A < 0.999
  ? `oklch(${+L.toFixed(4)} ${+C.toFixed(4)} ${+H.toFixed(2)} / ${+A.toFixed(3)})`
  : `oklch(${+L.toFixed(4)} ${+C.toFixed(4)} ${+H.toFixed(2)})`;

export { createPickerBody, parseColor, oklchStr, CHECKER };
registerControl("color", createColor);
// Registered beside its control so createColorPicker() (standalone.ts) reaches it through the
// registry without a static import that would pull the color engine into the basic bundle.
registerControl("colorpicker", createPickerBody);
