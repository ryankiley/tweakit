/* Gradient easing + gradient → CSS: the one place a gradient value becomes a stop list, so
 * the editor draws what a host's CSS draws. Pure string + number work, no DOM.
 * The eye reads a straight blend's ends as an edge and native easing hasn't shipped
 * (csswg-drafts#1332), so Larsen's "easing gradients" are generated here: the curve sampled
 * PARAMETRICALLY at 16 even t (x the position, y the blend), so any cubic-bezier works with
 * no x→t solve; each sample is a color-mix in the value's own blend space. */
import type { GradientEasing, GradientStop, GradientValue } from "./types.js";

/** cubic-bezier control points [x1, y1, x2, y2]. */
type Bez = [number, number, number, number];

// The CSS easing keywords as cubic-beziers. Null-prototype, so "constructor" can't read a function off Object.prototype.
const KEYWORDS: Record<string, Bez> = Object.assign(Object.create(null), {
  ease: [0.25, 0.1, 0.25, 1], "ease-in": [0.42, 0, 1, 1], "ease-out": [0, 0, 0.58, 1], "ease-in-out": [0.42, 0, 0.58, 1],
});
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const SAMPLES = 15; // 16 per segment, Larsen's count; the joins vanish

/** Bezier control points, or null for linear and anything unrecognised (bad input degrades to a
 *  straight blend). x1/x2 clamp into [0,1] as CSS requires; y may overshoot. */
export function parseEasing(e: unknown): Bez | null {
  if (typeof e !== "string") return null;
  const s = e.trim().toLowerCase();
  if (KEYWORDS[s]) return KEYWORDS[s];
  const m = /^cubic-bezier\(([^()]*)\)$/.exec(s); if (!m) return null;
  const n = m[1].split(",").map((x) => (x.trim() ? Number(x) : NaN)); // an empty field is NaN, not Number("") → 0
  if (n.length !== 4 || !n.every(Number.isFinite)) return null;
  return [clamp01(n[0]), n[1], clamp01(n[2]), n[3]];
}

/** The name an easing is stored under: trimmed and lowercased when parseEasing knows it, else "linear". */
export const easingName = (e: unknown): GradientEasing => (parseEasing(e) ? (e as string).trim().toLowerCase() as GradientEasing : "linear");

/** The curve at 16 even t: [x, y] pairs, y clamped to [0,1] since it becomes a color-mix percentage. */
export function easingSamples(b: Bez): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 0; k <= SAMPLES; k++) {
    const t = k / SAMPLES, u = 1 - t, p1 = 3 * u * u * t, p2 = 3 * u * t * t, p3 = t * t * t;
    out.push([p1 * b[0] + p2 * b[2] + p3, clamp01(p1 * b[1] + p2 * b[3] + p3)]);
  }
  return out;
}

/** The blend progress at a position, linear between samples exactly as the browser draws the
 *  stops, so a stop inserted at x takes the colour the ramp really shows. Null is the identity. */
export function easingAt(b: Bez | null, x: number): number {
  x = clamp01(x); // outside the segment is its end; never extrapolate
  if (!b) return x;
  const s = easingSamples(b);
  for (let k = 1; k < s.length; k++) {
    if (x <= s[k][0]) { const [x0, y0] = s[k - 1], [x1, y1] = s[k]; return x1 > x0 ? y0 + (y1 - y0) * (x - x0) / (x1 - x0) : y1; }
  }
  return 1;
}

const pct = (n: number) => +(n * 100).toFixed(2);

/** A gradient value's `<color-stop-list>` with the easing expanded; for a conic / radial gradient. */
export function gradientStops(value: GradientValue): string {
  const stops = [...value.stops].sort((a, b) => a.pos - b.pos);
  const plain = (s: GradientStop) => `${s.color} ${pct(s.pos)}%`;
  const bez = parseEasing(value.easing);
  if (!bez || stops.length < 2) return stops.map(plain).join(", ");
  const samples = easingSamples(bez), space = value.interpolation || "oklch";
  const out = [plain(stops[0])];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i], span = b.pos - a.pos;
    // Two stops at one position are a hard edge: no samples between.
    if (span > 1e-6) for (let k = 1; k < SAMPLES; k++) {
      const [x, y] = samples[k];
      out.push(`color-mix(in ${space}, ${a.color}, ${b.color} ${pct(y)}%) ${pct(a.pos + span * x)}%`);
    }
    out.push(plain(b));
  }
  return out.join(", ");
}

/** The `linear-gradient(…)` for a gradient value; `direction` is degrees or any CSS direction. */
export function gradientCss(value: GradientValue, direction: number | string = "to right"): string {
  return `linear-gradient(in ${value.interpolation || "oklch"} ${typeof direction === "number" ? `${direction}deg` : direction}, ${gradientStops(value)})`;
}
