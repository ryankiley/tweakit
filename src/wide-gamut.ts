/* Wide-gamut colour engine + mode model — the maths backbone for the Tweaks
 * OKLCH colour picker. Ported directly (not from memory) from Ryan's
 * tweakpane-plugin-wide-gamut: core/convert.ts (every space, CSS Color 4
 * reference matrices, hub through CIE XYZ), core/gamut.ts (in-gamut + the
 * CSS Color 4 chroma-reduction map), and the channel/mode model from
 * model/color.ts. Pure functions, zero dependencies. */

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const mul = (m, v) => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
const mulMat = (a, b) => {
  const o = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return o;
};
export const num = (x) => (x == null || Number.isNaN(x) ? 0 : x);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ── transfer functions ──
const srgbLin = (c) => { const a = Math.abs(c); return a <= 0.04045 ? c / 12.92 : Math.sign(c) * ((a + 0.055) / 1.055) ** 2.4; };
const srgbGam = (c) => { const a = Math.abs(c); return a <= 0.0031308 ? c * 12.92 : Math.sign(c) * (1.055 * a ** (1 / 2.4) - 0.055); };
const REC_A = 1.09929682680944, REC_B = 0.018053968510807; // BT.2020 piecewise OETF constants (CSS Color 4), not a pure 2.4 gamma
const rec2020Lin = (c) => { const a = Math.abs(c); return a < REC_B * 4.5 ? c / 4.5 : Math.sign(c) * ((a + REC_A - 1) / REC_A) ** (1 / 0.45); };
const rec2020Gam = (c) => { const a = Math.abs(c); return a < REC_B ? c * 4.5 : Math.sign(c) * (REC_A * a ** 0.45 - (REC_A - 1)); };
const PRO_ET = 1 / 512;
const prophotoLin = (c) => { const a = Math.abs(c); return a <= PRO_ET * 16 ? c / 16 : Math.sign(c) * a ** 1.8; };
const prophotoGam = (c) => { const a = Math.abs(c); return a >= PRO_ET ? Math.sign(c) * a ** (1 / 1.8) : 16 * c; };

// ── matrices (D65 unless noted) ──
const LIN_SRGB_TO_XYZ = [[0.41239079926595934, 0.357584339383878, 0.1804807884018343], [0.21263900587151027, 0.715168678767756, 0.07219231536073371], [0.01933081871559182, 0.11919477979462598, 0.9505321522496607]];
const XYZ_TO_LIN_SRGB = [[3.2409699419045226, -1.537383177570094, -0.4986107602930034], [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559], [0.05563007969699366, -0.20397695888897652, 1.0569715142428786]];
const LIN_P3_TO_XYZ = [[0.4865709486482162, 0.26566769316909306, 0.19821728523436247], [0.2289745640697488, 0.6917385218365064, 0.079286914093745], [0, 0.04511338185890264, 1.043944368900976]];
const XYZ_TO_LIN_P3 = [[2.493496911941425, -0.9313836179191239, -0.40271078445071684], [-0.8294889695615747, 1.7626640603183463, 0.023624685841943577], [0.03584583024378447, -0.07617238926804182, 0.9568845240076872]];
const LIN_REC2020_TO_XYZ = [[0.6369580483012914, 0.14461690358620832, 0.16888097516417205], [0.2627002120112671, 0.6779980715188708, 0.05930171646986196], [0, 0.028072693049087428, 1.060985057710791]];
const XYZ_TO_LIN_REC2020 = [[1.7166511879712674, -0.35567078377639233, -0.25336628137365974], [-0.6666843518324892, 1.6164812366349395, 0.01576854581391113], [0.017639857445310783, -0.042770613257808524, 0.9421031212354738]];
const LIN_PRO_TO_XYZ_D50 = [[0.7977604896723027, 0.13518583717574031, 0.0313493495815248], [0.2880711282292934, 0.7118432178101014, 0.00008565396060525902], [0, 0, 0.8251046025104601]];
const XYZ_D50_TO_LIN_PRO = [[1.3457989731028281, -0.25558010007997534, -0.05110628506753401], [-0.5446224939028347, 1.5082327413132781, 0.02053603239147973], [0, 0, 1.2119675456389454]];
const XYZ_D65_TO_D50 = [[1.0479298208405488, 0.022946793341019088, -0.05019222954313557], [0.029627815688159344, 0.990434484573249, -0.01707382502938514], [-0.009243058152591178, 0.015055144896577895, 0.7518742899580008]];
const XYZ_D50_TO_D65 = [[0.9554734527042182, -0.023098536874261423, 0.0632593086610217], [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008], [0.012314001688319899, -0.020507696433477912, 1.3303659366080753]];
const XYZ_TO_LMS = [[0.819022437996703, 0.3619062600528904, -0.1288737815209879], [0.0329836539323885, 0.9292868615863434, 0.0361446663506424], [0.0481771893596242, 0.2642395317527308, 0.6335478284694309]];
const LMS_TO_XYZ = [[1.2268798758459243, -0.5578149944602171, 0.2813910456659647], [-0.0405757452148008, 1.112286803280317, -0.0717110580655164], [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816]];
const LMS_TO_OKLAB = [[0.210454268309314, 0.7936177747023054, -0.0040720430116193], [1.9779985324311684, -2.42859224204858, 0.450593709617411], [0.0259040424655478, 0.7827717124575296, -0.8086757549230774]];
const OKLAB_TO_LMS = [[1.0, 0.3963377773761749, 0.2158037573099136], [1.0, -0.1055613458156586, -0.0638541728258133], [1.0, -0.0894841775298119, -1.2914855480194092]];
const LAB_E = 216 / 24389, LAB_K = 24389 / 27;
const WHITE_D50 = [0.3457 / 0.3585, 1.0, (1.0 - 0.3457 - 0.3585) / 0.3585];

const rgbToXyz = (c, lin, m) => mul(m, [lin(c[0]), lin(c[1]), lin(c[2])]);
const xyzToRgb = (xyz, gam, m) => { const l = mul(m, xyz); return [gam(l[0]), gam(l[1]), gam(l[2])]; };
const oklabToXyz = (lab) => { const p = mul(OKLAB_TO_LMS, lab); return mul(LMS_TO_XYZ, [p[0] ** 3, p[1] ** 3, p[2] ** 3]); };
const xyzToOklab = (xyz) => { const lms = mul(XYZ_TO_LMS, xyz); return mul(LMS_TO_OKLAB, [Math.cbrt(lms[0]), Math.cbrt(lms[1]), Math.cbrt(lms[2])]); };
function labToXyz(lab) {
  const [L, a, b] = lab; const fy = (L + 16) / 116, fx = a / 500 + fy, fz = fy - b / 200;
  const x = fx ** 3 > LAB_E ? fx ** 3 : (116 * fx - 16) / LAB_K;
  const y = L > LAB_K * LAB_E ? fy ** 3 : L / LAB_K;
  const z = fz ** 3 > LAB_E ? fz ** 3 : (116 * fz - 16) / LAB_K;
  return mul(XYZ_D50_TO_D65, [x * WHITE_D50[0], y * WHITE_D50[1], z * WHITE_D50[2]]);
}
function xyzToLab(xyz) {
  const d50 = mul(XYZ_D65_TO_D50, xyz); const f = (t) => (t > LAB_E ? Math.cbrt(t) : (LAB_K * t + 16) / 116);
  const fx = f(d50[0] / WHITE_D50[0]), fy = f(d50[1] / WHITE_D50[1]), fz = f(d50[2] / WHITE_D50[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const toPolar = (r) => { const C = Math.hypot(r[1], r[2]); let h = Math.atan2(r[2], r[1]) * DEG; if (h < 0) h += 360; return [r[0], C, h]; };
const toRect = (p) => [p[0], p[1] * Math.cos(p[2] * RAD), p[1] * Math.sin(p[2] * RAD)];
function hslToSrgb(hsl) {
  const h = (((Number.isNaN(hsl[0]) ? 0 : hsl[0]) % 360) + 360) % 360, s = hsl[1] / 100, l = hsl[2] / 100;
  const f = (n) => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}
function srgbHue(rgb) {
  const max = Math.max(...rgb), min = Math.min(...rgb), d = max - min;
  if (d === 0) return NaN;
  let h; if (max === rgb[0]) h = (rgb[1] - rgb[2]) / d + (rgb[1] < rgb[2] ? 6 : 0); else if (max === rgb[1]) h = (rgb[2] - rgb[0]) / d + 2; else h = (rgb[0] - rgb[1]) / d + 4;
  return h * 60;
}
function srgbToHsl(rgb) {
  const max = Math.max(...rgb), min = Math.min(...rgb), l = (min + max) / 2;
  let h = srgbHue(rgb), s = max === min || l === 0 || l === 1 ? 0 : (max - l) / Math.min(l, 1 - l);
  if (s < 0) { h += 180; s = -s; } if (h >= 360) h -= 360;
  return [h, s * 100, l * 100];
}
function hwbToSrgb(hwb) {
  const w = hwb[1] / 100, b = hwb[2] / 100; if (w + b >= 1) { const g = w / (w + b); return [g, g, g]; }
  const rgb = hslToSrgb([hwb[0], 100, 50]), scale = 1 - w - b; return [rgb[0] * scale + w, rgb[1] * scale + w, rgb[2] * scale + w];
}
const srgbToHwb = (rgb) => [srgbHue(rgb), Math.min(...rgb) * 100, (1 - Math.max(...rgb)) * 100];

function toXyz(c, space) {
  switch (space) {
    case "srgb": return rgbToXyz(c, srgbLin, LIN_SRGB_TO_XYZ);
    case "p3": return rgbToXyz(c, srgbLin, LIN_P3_TO_XYZ);
    case "rec2020": return rgbToXyz(c, rec2020Lin, LIN_REC2020_TO_XYZ);
    case "prophoto-rgb": return mul(XYZ_D50_TO_D65, rgbToXyz(c, prophotoLin, LIN_PRO_TO_XYZ_D50));
    case "oklab": return oklabToXyz(c);
    case "oklch": return oklabToXyz(toRect(c));
    case "lab": return labToXyz(c);
    case "lch": return labToXyz(toRect(c));
    case "hsl": return rgbToXyz(hslToSrgb(c), srgbLin, LIN_SRGB_TO_XYZ);
    case "hwb": return rgbToXyz(hwbToSrgb(c), srgbLin, LIN_SRGB_TO_XYZ);
  }
}
function fromXyz(xyz, space) {
  switch (space) {
    case "srgb": return xyzToRgb(xyz, srgbGam, XYZ_TO_LIN_SRGB);
    case "p3": return xyzToRgb(xyz, srgbGam, XYZ_TO_LIN_P3);
    case "rec2020": return xyzToRgb(xyz, rec2020Gam, XYZ_TO_LIN_REC2020);
    case "prophoto-rgb": return xyzToRgb(mul(XYZ_D65_TO_D50, xyz), prophotoGam, XYZ_D50_TO_LIN_PRO);
    case "oklab": return xyzToOklab(xyz);
    case "oklch": return toPolar(xyzToOklab(xyz));
    case "lab": return xyzToLab(xyz);
    case "lch": return toPolar(xyzToLab(xyz));
    case "hsl": return srgbToHsl(xyzToRgb(xyz, srgbGam, XYZ_TO_LIN_SRGB));
    case "hwb": return srgbToHwb(xyzToRgb(xyz, srgbGam, XYZ_TO_LIN_SRGB));
  }
}
export function convert(coords, from, to) {
  if (from === to) return [coords[0], coords[1], coords[2]];
  if (from === "oklch" && to === "oklab") return toRect(coords);
  if (from === "oklab" && to === "oklch") return toPolar(coords);
  if (from === "lch" && to === "lab") return toRect(coords);
  if (from === "lab" && to === "lch") return toPolar(coords);
  return fromXyz(toXyz(coords, from), to);
}

// ── gamut ──
const SLACK = 0.000075;
function inGamut(oklch, gamut) { const rgb = convert(oklch, "oklch", gamut); return rgb.every((c) => c >= -SLACK && c <= 1 + SLACK); }
const clip = (rgb) => rgb.map((c) => Math.min(1, Math.max(0, c)));
const deltaEOK = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Map OKLCH into an RGB gamut (CSS Color 4 chroma reduction + local clip). */
export function toGamut(oklch, dest) {
  if (inGamut(oklch, dest)) return convert(oklch, "oklch", dest);
  const L = oklch[0]; if (L >= 1) return [1, 1, 1]; if (L <= 0) return [0, 0, 0];
  const JND = 0.02, EPS = 0.0001; const cur = [oklch[0], oklch[1], oklch[2]];
  let min = 0, max = oklch[1], minIn = true, clipped = clip(convert(cur, "oklch", dest));
  if (deltaEOK(convert(clipped, dest, "oklab"), convert(oklch, "oklch", "oklab")) < JND) return clipped;
  while (max - min > EPS) {
    const chroma = (min + max) / 2; cur[1] = chroma; const inDest = convert(cur, "oklch", dest);
    if (minIn && inDest.every((c) => c >= -SLACK && c <= 1 + SLACK)) { min = chroma; continue; }
    clipped = clip(inDest); const e = deltaEOK(convert(clipped, dest, "oklab"), convert(cur, "oklch", "oklab"));
    if (e < JND) { if (JND - e < EPS) return clipped; minIn = false; min = chroma; } else max = chroma;
  }
  return clipped;
}
/** Fast in-gamut probe at a fixed hue — `(L,C)=>inside?` (his chroma-boundary loop). */
export function oklchGamutProbe(hue, gamut) {
  const h = hue * RAD, cos = Math.cos(h), sin = Math.sin(h);
  const d0 = cos * OKLAB_TO_LMS[0][1] + sin * OKLAB_TO_LMS[0][2];
  const d1 = cos * OKLAB_TO_LMS[1][1] + sin * OKLAB_TO_LMS[1][2];
  const d2 = cos * OKLAB_TO_LMS[2][1] + sin * OKLAB_TO_LMS[2][2];
  const F = mulMat(gamut === "p3" ? XYZ_TO_LIN_P3 : gamut === "rec2020" ? XYZ_TO_LIN_REC2020 : XYZ_TO_LIN_SRGB, LMS_TO_XYZ);
  const gam = gamut === "rec2020" ? rec2020Gam : srgbGam; const lo = -SLACK, hi = 1 + SLACK;
  return (L, C) => {
    const p0 = L + C * d0, p1 = L + C * d1, p2 = L + C * d2, c0 = p0 ** 3, c1 = p1 ** 3, c2 = p2 ** 3;
    const r = gam(F[0][0] * c0 + F[0][1] * c1 + F[0][2] * c2); if (r < lo || r > hi) return false;
    const g = gam(F[1][0] * c0 + F[1][1] * c1 + F[1][2] * c2); if (g < lo || g > hi) return false;
    const b = gam(F[2][0] * c0 + F[2][1] * c1 + F[2][2] * c2); return b >= lo && b <= hi;
  };
}
/** Bisect the chroma ceiling at lightness L for an `oklchGamutProbe` — the highest
 * in-gamut C. The picker traces its plane gamut, boundary lines, and hue strip with it. */
export function chromaCeil(probe, L, hi = 0.5) {
  if (!probe(L, 0)) return 0;
  let lo = 0; for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2; probe(L, m) ? (lo = m) : (hi = m); }
  return lo;
}

// ── hex ──
/** One 0–1 channel → a 2-digit hex byte (also the alpha suffix for #RRGGBBAA). */
export const hexByte = (n) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, "0");
const rgbToHex = (rgb) => `#${hexByte(rgb[0])}${hexByte(rgb[1])}${hexByte(rgb[2])}`;
export const oklchToHex = (L, C, H) => rgbToHex(toGamut([L, C, H], "srgb"));
export function hexToOklch(hex) {
  let h = String(hex).replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length < 6) return [0.7, 0.1, 280];
  const rgb = [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  return convert(rgb, "srgb", "oklch").map(num);
}

// ── mode model (from model/color.ts) ──
export const EDIT_MODES = ["hex", "srgb", "css", "hsl", "hwb", "oklch", "oklab", "lch", "lab", "p3", "rec2020"];
export const MODE_LABELS = { hex: "HEX", srgb: "RGB", css: "CSS", hsl: "HSL", hwb: "HWB", oklch: "OKLCH", oklab: "OKLab", lch: "LCH", lab: "Lab", p3: "P3", rec2020: "Rec2020" };
const SRGB_BOUND = ["srgb", "css", "hsl", "hwb", "hex"];
export const showsGamutBoundary = (mode) => !SRGB_BOUND.includes(mode);
const modeSpaceId = (mode) => (mode === "hex" || mode === "css" ? "srgb" : mode);
const MAX_CHROMA = 0.5;
export const MODE_CHANNELS = {
  oklch: [{ k: "L", min: 0, max: 100, step: 1, scale: 100 }, { k: "C", min: 0, max: MAX_CHROMA, step: 0.01, scale: 1 }, { k: "H", min: 0, max: 360, step: 1, scale: 1 }],
  oklab: [{ k: "L", min: 0, max: 100, step: 1, scale: 100 }, { k: "a", min: -0.4, max: 0.4, step: 0.01, scale: 1 }, { k: "b", min: -0.4, max: 0.4, step: 0.01, scale: 1 }],
  lch: [{ k: "L", min: 0, max: 100, step: 1, scale: 1 }, { k: "C", min: 0, max: 150, step: 1, scale: 1 }, { k: "H", min: 0, max: 360, step: 1, scale: 1 }],
  lab: [{ k: "L", min: 0, max: 100, step: 1, scale: 1 }, { k: "a", min: -125, max: 125, step: 1, scale: 1 }, { k: "b", min: -125, max: 125, step: 1, scale: 1 }],
  srgb: [{ k: "R", min: 0, max: 255, step: 1, scale: 255 }, { k: "G", min: 0, max: 255, step: 1, scale: 255 }, { k: "B", min: 0, max: 255, step: 1, scale: 255 }],
  css: [{ k: "R", min: 0, max: 255, step: 1, scale: 255 }, { k: "G", min: 0, max: 255, step: 1, scale: 255 }, { k: "B", min: 0, max: 255, step: 1, scale: 255 }],
  hsl: [{ k: "H", min: 0, max: 360, step: 1, scale: 1 }, { k: "S", min: 0, max: 100, step: 1, scale: 1 }, { k: "L", min: 0, max: 100, step: 1, scale: 1 }],
  hwb: [{ k: "H", min: 0, max: 360, step: 1, scale: 1 }, { k: "W", min: 0, max: 100, step: 1, scale: 1 }, { k: "B", min: 0, max: 100, step: 1, scale: 1 }],
  p3: [{ k: "R", min: 0, max: 1, step: 0.01, scale: 1 }, { k: "G", min: 0, max: 1, step: 0.01, scale: 1 }, { k: "B", min: 0, max: 1, step: 0.01, scale: 1 }],
  rec2020: [{ k: "R", min: 0, max: 1, step: 0.01, scale: 1 }, { k: "G", min: 0, max: 1, step: 0.01, scale: 1 }, { k: "B", min: 0, max: 1, step: 0.01, scale: 1 }],
};
const digitsFor = (step) => (step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3);

// The display coords for `mode` from canonical OKLCH. sRGB-bound modes (rgb / css /
// hsl / hwb) read off the CSS Color 4 chroma-reduced sRGB — the SAME map hex uses —
// so every narrow-gamut mode agrees on the colour (the per-channel clip here used to
// disagree with hex's chroma-reduce: one out-of-gamut OKLCH, two emitted colours).
// Wide modes (oklch/oklab/lab/lch/p3/rec2020) stay faithful — that's the whole point.
const modeCoords = (oklch, sid, mode) =>
  sid === "oklch" ? [oklch[0], oklch[1], oklch[2]]
  : SRGB_BOUND.includes(mode) ? (sid === "srgb" ? toGamut(oklch, "srgb") : convert(toGamut(oklch, "srgb"), "srgb", sid))
  : convert(oklch, "oklch", sid);
/** Display-unit channel values for `mode` from canonical OKLCH. */
export function channelValues(oklch, mode) {
  const c = modeCoords(oklch, modeSpaceId(mode), mode);
  return MODE_CHANNELS[mode].map((ch, i) => { const v = num(c[i]) * ch.scale; return clamp(Math.abs(v) < 0.5 * ch.step ? 0 : v, ch.min, ch.max); });
}
/** New OKLCH with channel `index` of `mode` set to `displayValue`. */
export function withChannel(oklch, mode, index, displayValue) {
  const sid = modeSpaceId(mode);
  const c = modeCoords(oklch, sid, mode).map(num);
  c[index] = displayValue / MODE_CHANNELS[mode][index].scale;
  const k = convert(c, sid, "oklch");
  return [num(k[0]), num(k[1]), num(k[2])];
}
/** Plain-text gamut label: sRGB / P3 / wide. */
export function gamutLabel(oklch, mode) {
  if (!showsGamutBoundary(mode)) return "sRGB";
  const shown = toGamut(oklch, "srgb");
  if (Math.max(...shown) < 0.03 || Math.min(...shown) > 0.97) return "sRGB";
  if (inGamut(oklch, "srgb")) return "sRGB";
  if (inGamut(oklch, "p3")) return "P3";
  return "wide";
}
/** The collapsed-row value string for `mode` (bare channels w/ units, or hex). */
export function readout(oklch, mode) {
  if (mode === "hex") return oklchToHex(oklch[0], oklch[1], oklch[2]);
  const chans = MODE_CHANNELS[mode], v = channelValues(oklch, mode);
  const s = (i) => v[i].toFixed(digitsFor(chans[i].step));
  if (mode === "css") return `${s(0)}, ${s(1)}, ${s(2)}`;
  if (mode === "oklch" || mode === "oklab" || mode === "lch" || mode === "lab") return `${s(0)}% ${s(1)} ${s(2)}`;
  if (mode === "hsl" || mode === "hwb") return `${s(0)} ${s(1)}% ${s(2)}%`;
  return `${s(0)} ${s(1)} ${s(2)}`; // srgb / p3 / rec2020
}
// Wrap bare channels in the mode's CSS function. css = legacy comma rgba (always an
// explicit alpha slot); every other functional form takes modern space syntax.
const wrapCss = (t, mode) =>
  mode === "hex" ? t : mode === "srgb" ? `rgb(${t})` : mode === "css" ? `rgba(${t}, 1)` :
  mode === "hsl" ? `hsl(${t})` : mode === "hwb" ? `hwb(${t})` :
  mode === "p3" ? `color(display-p3 ${t})` : mode === "rec2020" ? `color(rec2020 ${t})` : `${mode}(${t})`;
/** The colour control's emitted CSS value — `mode`-faithful at the mode's display
 * precision, alpha appended in that mode's own syntax. One form for opaque and
 * translucent: a translucent rgb stays `rgb(… / a)` (it used to jump to `oklch()` at
 * a different precision), and an opaque value reads back identically through parse. */
export function serialize(oklch, mode, alpha) {
  const a = num(alpha);
  if (mode === "hex") return oklchToHex(oklch[0], oklch[1], oklch[2]) + (a < 0.999 ? hexByte(a) : "");
  const t = readout(oklch, mode);
  if (a >= 0.999) return wrapCss(t, mode);
  const av = +a.toFixed(3);
  return mode === "css" ? `rgba(${t}, ${av})` : wrapCss(`${t} / ${av}`, mode); // legacy comma carries comma alpha; everything else, modern slash
}
