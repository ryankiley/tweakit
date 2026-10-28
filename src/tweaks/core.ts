/* Tweaks — a dependency-free real-time parameter panel. The public entry: tweaks() builds a
 * live panel from a plain schema object, enhance() turns [data-twk] markup into live controls,
 * and mountControl() / createColorPicker() / gradientCss() are the controls without the panel. */
export { tweaks } from "./panel.js";
export { enhance } from "./enhance.js";
export { mountControl, createColorPicker } from "./standalone.js";
export { gradientCss, gradientStops } from "./easing.js";
// The public types, so `import type { Schema } from "tweakit"` works from either entry.
export type * from "./types.js";
