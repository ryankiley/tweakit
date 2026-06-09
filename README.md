# Tweakability

A dependency-free, code-split real-time **parameter panel**. Hand it a plain schema
and it builds a live control for every value — sliders, toggles, dropdowns, a
wide-gamut OKLCH colour picker, gradient and cubic-bézier editors, a spring tuner,
an expression grapher (with its own safe evaluator), monitors, a 2D point pad, and
more. No framework, no runtime dependencies.

Spun out of a personal design system, where it's the kit behind every playground.

## Use

```js
import { tweaks } from "tweakability";        // the readable single file (everything inline)
// …or the code-split entry, which loads heavy controls on first use:
import { tweaks } from "tweakability/core";

const panel = tweaks("Card", {
  blur: [24, 0, 100, 1],          // [value, min, max, step] → slider
  visible: true,                   // → toggle
  blend: ["normal", "multiply"],   // → dropdown
  tint: "#7C5CFF",                 // → wide-gamut colour picker
  motion: { type: "spring", stiffness: 220, damping: 18, mass: 1 },
});
document.body.append(panel.el);
panel.on((values) => { /* values.blur, values.tint, … */ });
```

Add the styles too: `tweakability/css` (i.e. `dist/tweaks.css`).

`tweaks()` returns synchronously — the panel and its API are ready immediately; on
the code-split build, heavy controls fill in behind `panel.ready`. There's also a
markup path: `enhance(root)` upgrades `[data-tw]` hosts in place.

## Build

```
npm install
npm run build      # → dist/
```

`dist/` contains the minified split chunks (`tweaks/`), the readable single file
(`tweaks.js`), the panel CSS (`tweaks.css`), the type declarations (`types/`), and
the demo (`index.html`). `npm run serve` builds and serves it on :4330.

## Layout

- `src/tweaks/` — the kit. `shared.ts` (DOM/math helpers, drag/scrub, the numeric
  field, theming, the popover shell, a control registry), `core.ts` (schema → meta
  inference, the cheap always-loaded controls, the panel, `enhance`), `types.ts` (the
  public type surface), and `controls/*.ts` (the heavy controls, dynamic-imported on
  first use; `colour` is the only one that pulls in the engine, so basic panels never
  pay for it).
- `src/wide-gamut.ts` — the OKLCH / wide-gamut colour engine.
- `src/tweaks.css` — the panel styling (runs entirely on `--tw-*` custom properties).
