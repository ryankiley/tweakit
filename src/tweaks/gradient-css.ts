/* tweakit/gradient-css — a gradient value → CSS, its easing expanded into sampled stops.
 * Its own entry rather than core's: a basic panel's code-split download is held to 20 KiB
 * and had no room for it (the single-file build exports these from its root as well). Only
 * these two are public; the easing parser and samplers in easing.ts are the editor's. */
export { gradientCss, gradientStops } from "./easing.js";
export type { GradientInput } from "./easing.js";
