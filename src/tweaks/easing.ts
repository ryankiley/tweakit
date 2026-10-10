/* Gradient easing + gradient → CSS. The one place a gradient value becomes a stop list,
 * shared by the editor (its bar and trigger preview) and by hosts (gradientCss /
 * gradientStops, re-exported by the `tweakit/gradient-css` entry — the parser and the
 * samplers here are the editor's, not public API) — so what the editor draws is, by
 * construction, what a host's CSS draws.
 *
 * Easing: a CSS gradient blends in a straight line between stops, and the eye reads
 * where a straight blend starts and stops as an edge (a fade to transparent, a two-stop
 * ramp between distant colours). The fix is Larsen's "easing gradients": sample an easing
 * curve into ~16 stops per segment. Native easing was resolved for CSS in 2021
 * (csswg-drafts#1332) but hasn't shipped, so the stops are generated here. The curve is
 * read PARAMETRICALLY — at 16 even t, x(t) is the position within the segment and y(t) the
 * blend progress — so any cubic-bezier works with no x→t solve (Larsen's published
 * ease-in-out table is exactly this read of cubic-bezier(.42, 0, .58, 1)). Each sample is
 * `color-mix(in <interpolation>, a, b y%)`: any stop colour keeps working, and the mix
 * runs in the value's own blend space, so an eased ramp blends exactly where a plain one
 * would — same space, same missing-hue and premultiplied-alpha rules.
 *
 * Pure string + number work, no DOM: it runs anywhere a host templates CSS. */
import type { GradientEasing, GradientStop, GradientValue } from "./types.js";

/** What the CSS helpers take: the emitted object form, or the stop shorthand a schema
 *  accepts — a stop array of `{ color, pos }` objects and/or `[color, pos]` tuples. */
export type GradientInput = GradientValue | Array<GradientStop | [string, number]>;

/** cubic-bezier control points [x1, y1, x2, y2]. */
type Bez = [number, number, number, number];

// The CSS easing keywords, as the cubic-bezier each is defined as. A null-prototype
// map, so a value like "constructor" can't read a function off Object.prototype.
const KEYWORDS: Record<string, Bez> = Object.assign(Object.create(null), {
  ease: [0.25, 0.1, 0.25, 1], "ease-in": [0.42, 0, 1, 1], "ease-out": [0, 0, 0.58, 1], "ease-in-out": [0.42, 0, 0.58, 1],
});
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const SAMPLES = 15; // 16 samples per segment, Larsen's count — the eye can't find the joins at that density

/** An easing's bezier control points, or null for linear. Anything unrecognised — an
 *  unknown keyword, a malformed or non-finite `cubic-bezier()` — is null too, so bad input
 *  degrades to today's straight blend rather than to broken CSS. x1/x2 clamp into [0,1] as
 *  CSS requires (it keeps the sampled positions monotonic); y may overshoot like CSS allows. */
export function parseEasing(e: unknown): Bez | null {
  if (typeof e !== "string") return null;
  const s = e.trim().toLowerCase();
  if (KEYWORDS[s]) return KEYWORDS[s];
  const m = /^cubic-bezier\(([^()]*)\)$/.exec(s); if (!m) return null;
  const n = m[1].split(",").map((x) => (x.trim() ? Number(x) : NaN)); // an empty field is NaN, not Number("") → 0
  if (n.length !== 4 || !n.every(Number.isFinite)) return null;
  return [clamp01(n[0]), n[1], clamp01(n[2]), n[3]];
}

/** The canonical name of an easing: "linear" for linear or anything unrecognised, the
 *  keyword when the bezier is one (`cubic-bezier(.42, 0, .58, 1)` reads back as
 *  "ease-in-out"), else a normalised `cubic-bezier(x1, y1, x2, y2)`. */
export function easingName(e: unknown): GradientEasing {
  const b = parseEasing(e); if (!b) return "linear";
  for (const k in KEYWORDS) if (KEYWORDS[k].every((v, i) => v === b[i])) return k as GradientEasing;
  return `cubic-bezier(${b.join(", ")})`;
}

/** The curve at 16 even t: [x, y] pairs — x the position within the segment (0→1), y the
 *  blend progress, clamped to [0,1] since it becomes a color-mix percentage. */
export function easingSamples(b: Bez): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 0; k <= SAMPLES; k++) {
    const t = k / SAMPLES, u = 1 - t, p1 = 3 * u * u * t, p2 = 3 * u * t * t, p3 = t * t * t;
    out.push([p1 * b[0] + p2 * b[2] + p3, clamp01(p1 * b[1] + p2 * b[3] + p3)]);
  }
  return out;
}

/** The blend progress at a position within a segment, read off the sampled ramp — linear
 *  between samples, exactly as the browser draws the generated stops — so a stop inserted
 *  at x takes the colour the ramp really shows there. Null (linear) is the identity. */
export function easingAt(b: Bez | null, x: number): number {
  x = clamp01(x); // outside the segment is its end — never extrapolate the first/last sample
  if (!b) return x;
  const s = easingSamples(b);
  for (let k = 1; k < s.length; k++) {
    if (x <= s[k][0]) { const [x0, y0] = s[k - 1], [x1, y1] = s[k]; return x1 > x0 ? y0 + (y1 - y0) * (x - x0) / (x1 - x0) : y1; }
  }
  return 1;
}

const pct = (n: number) => +(n * 100).toFixed(2);

/** A gradient value's `<color-stop-list>` — `"red 0%, color-mix(…) 8.1%, …, blue 100%"` — with
 *  the value's easing expanded into sampled stops. Linear (or no) easing gives the plain
 *  list. For a `linear-gradient` use gradientCss; this is for templating a conic / radial
 *  gradient, or any other place a stop list goes. */
export function gradientStops(value: GradientInput): string {
  // The shorthand a host authors its schema with is a value too: a bare stop array (no
  // blend space, no easing → OKLCH, linear) and tuple stops, so a host can paint from the
  // value it wrote before the panel's first emit without crashing on `.stops`.
  const v: GradientValue = Array.isArray(value) ? { stops: value as GradientStop[] } : value;
  const stops = (Array.isArray(v?.stops) ? v.stops : []).map((s: GradientStop | [string, number]) => (Array.isArray(s) ? { color: s[0], pos: s[1] } : s)).sort((a, b) => a.pos - b.pos);
  const plain = (s: GradientStop) => `${s.color} ${pct(s.pos)}%`;
  const bez = parseEasing(v?.easing);
  if (!bez || stops.length < 2) return stops.map(plain).join(", ");
  const samples = easingSamples(bez), space = v.interpolation || "oklch";
  const out = [plain(stops[0])];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i], span = b.pos - a.pos;
    // Two stops at one position are a hard edge — no samples between (they'd all land
    // on that edge, 14 stops that draw nothing).
    if (span > 1e-6) for (let k = 1; k < SAMPLES; k++) {
      const [x, y] = samples[k];
      out.push(`color-mix(in ${space}, ${a.color}, ${b.color} ${pct(y)}%) ${pct(a.pos + span * x)}%`);
    }
    out.push(plain(b));
  }
  return out.join(", ");
}

/** The CSS for a gradient value: `linear-gradient(in <interpolation> <direction>, <stops>)`,
 *  easing expanded, blend space honoured — paste it straight into `background`. `direction`
 *  is an angle in degrees or any CSS direction (`"to right"`, the default, is what the
 *  editor's own preview draws). */
export function gradientCss(value: GradientInput, direction: number | string = "to right"): string {
  const space = (!Array.isArray(value) && value?.interpolation) || "oklch";
  return `linear-gradient(in ${space} ${typeof direction === "number" ? `${direction}deg` : direction}, ${gradientStops(value)})`;
}
