/* Tweaks — a dependency-free real-time parameter panel.
 *
 * Hand it a plain schema object and it builds a live control panel — sliders,
 * toggles, dropdowns, wide-gamut colour pickers, curve editors and more — with
 * zero runtime dependencies. Two ways in, one code path:
 *   • tweaks(name, schema, opts) — build an inline panel, returns { params, on, set, reset, el }
 *   • enhance(root)             — turn [data-tw] markup into a live control (the showcase)
 * Plus the controls on their own, without panel chrome:
 *   • mountControl(host, value, opts) — one control from a schema value, into your element
 *   • createColorPicker(opts)         — the colour editor surface alone, for your own swatch
 *
 * Schema shorthands:
 *   [default, min, max, step?] → slider     true|false → checkbox
 *   ["a","b"] | {options,value}→ list       "#rrggbb"  → colour
 *   { action: fn, label? }     → button
 *
 * This file is the public entry; the implementation lives in focused modules:
 *   schema.ts          — schema value / [data-tw] dataset → control meta
 *   controls/basic.ts  — the always-registered core controls
 *   panel.ts           — tweaks(), the panel factory + its API
 *   enhance.ts         — [data-tw] markup enhancement (auto-runs on load)
 *   feedback.ts        — toast, hint tooltip, toolbar buttons
 *   lazy.ts            — the dynamic-import map for the code-split build
 *   standalone.ts      — mountControl() + createColorPicker(), the controls without a panel
 */
export { tweaks } from "./panel.js";
export { enhance } from "./enhance.js";
export { mountControl, createColorPicker } from "./standalone.js";
// Re-export the public types so `import type { Schema, Panel } from "tweakit"`
// works from either entry (single.ts re-exports this module) — they erase at build time.
export type * from "./types.js";
