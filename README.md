# Tweakability

A dependency-free, code-split, real-time **parameter panel**. Hand it a plain schema and
it builds a live control for every value — sliders, toggles, dropdowns, a wide-gamut OKLCH
color picker, gradient and cubic-bézier editors, a spring tuner, an expression grapher,
monitors, a 2D point pad, and more. No framework, no runtime dependencies.

Spun out of a personal design system, where it's the kit behind every playground.

## Use

```js
import { tweaks } from "tweakability";       // one self-contained file
// …or the code-split entry, which loads heavy controls on first use:
import { tweaks } from "tweakability/core";

const panel = tweaks("Card", {
  blur: [24, 0, 100, 1],          // [value, min, max, step] → slider
  visible: true,                   // → checkbox
  blend: ["normal", "multiply"],   // → list
  tint: "#7C5CFF",                 // → wide-gamut color picker
  motion: { type: "spring", stiffness: 220, damping: 18, mass: 1 },
});
document.body.append(panel.el);
panel.on((values) => { /* values.blur, values.tint, … */ });
```

Add the styles with `tweakability/css`. Drag the panel by its header to reposition it
(`{ draggable: false }` to opt out, `{ floating: true }` to start it floated).

The default look follows the visitor's OS scheme; `data-tw-scheme="dark"` / `"light"`
on any ancestor pins it (full story on the docs site's theming page).

`tweaks()` returns synchronously — the panel and its API are ready at once; on the
code-split build, heavy controls fill in behind `panel.ready`. `enhance(root)` upgrades
`[data-tw]` markup in place.

**Size:** ~16 KB gzip code-split (the color engine and heavy controls load on demand),
~30 KB with everything inlined.

## Build

```
npm install
npm run build      # → dist/
```

`dist/` holds the split chunks, the single file, the CSS, the type declarations, and the
docs/examples site (one page per control category, every control live) — all built from
the one source tree in `src/` + `site/`. `npm run serve` builds and serves it on :4330.

## Layout

- `src/tweaks/` — the kit: `shared.ts` (DOM/math helpers, drag/scrub, the numeric field,
  theming, the popover shell, the control registry), `core.ts` (schema inference, the
  light always-loaded controls, the panel, `enhance`), `types.ts` (public types), and
  `controls/*.ts` (the heavy controls, dynamic-imported on first use).
- `src/wide-gamut.ts` — the OKLCH / wide-gamut color engine.
- `src/tweaks.css` — panel styling, entirely on `--tw-*` custom properties.
- `site/` — the docs/examples site: `pages/*.mjs` (one module per page; each example's
  code is executed *and* displayed from the same source, so snippets can't drift) and
  `build-site.mjs` (the zero-dependency generator that assembles them into `dist/`).

## Credits

Inspired by [Tweakpane](https://tweakpane.github.io) by [cocopon](https://github.com/cocopon)
and [dialkit](https://github.com/joshpuckett/dialkit) by [Josh Puckett](https://github.com/joshpuckett).
The toolbar and control icons are inline SVGs from [Lucide](https://lucide.dev) (ISC) and,
upstream, [Feather](https://feathericons.com) (MIT) — per-icon origins and full license
texts are in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
