/* Single-file build entry. Statically imports every control so each self-registers
 * into the shared registry on load; with the esbuild define TW_SPLIT=false, core's
 * dynamic-import map is empty, so esbuild inlines the whole kit into one self-contained,
 * synchronous file — a drop-in that needs no bundler. The code-split build uses core.ts
 * directly (TW_SPLIT=true) and loads these controls on demand instead. */
import "./controls/colour.js";
import "./controls/gradient.js";
import "./controls/interval.js";
import "./controls/tabs.js";
import "./controls/image.js";
import "./controls/monitor.js";
import "./controls/spring.js";
import "./controls/bezier.js";
import "./controls/point.js";
import "./controls/plot.js";
import "./controls/knob.js";

export { tweaks, enhance } from "./core.js";
