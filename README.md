# Tweakability

A dependency-free, code-split real-time **parameter panel**. Hand it a plain schema
and it builds a live control for every value — sliders, toggles, dropdowns, a
wide-gamut OKLCH colour picker, gradient and cubic-bézier editors, a spring tuner,
an expression grapher (with its own safe evaluator), monitors, a 2D point pad, and
more. No framework, no runtime dependencies.

Spun out of a personal design system, where it's the kit behind every playground.

## Use

```js
import { tweaks } from "tweakability";        // one minified, self-contained file (everything inline)
// …or the code-split entry — leanest on the wire, loads heavy controls on first use:
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

Drag the panel by its header to reposition it — an inline panel lifts into a floating
layer on the first drag and parks against the nearest edge on release (opt out with
`{ draggable: false }`; `{ floating: true }` starts it floated). Size on the wire: the
code-split entry is ~12 KB gzip for a basic panel — the colour engine and each heavier
control load only when first used; the single file is ~30 KB gzip with everything inlined.

Add the styles too: `tweakability/css` (i.e. `dist/tweaks.css`).

`tweaks()` returns synchronously — the panel and its API are ready immediately; on
the code-split build, heavy controls fill in behind `panel.ready`. There's also a
markup path: `enhance(root)` upgrades `[data-tw]` hosts in place.

## Build

```
npm install
npm run build      # → dist/
```

`dist/` contains the minified split chunks (`tweaks/`), the minified single file
(`tweaks.js`), the panel CSS (`tweaks.css`), the type declarations (`types/`), and
the demo (`index.html`). Both builds come from the one readable source tree in `src/`.
`npm run serve` builds and serves it on :4330.

## Layout

- `src/tweaks/` — the kit. `shared.ts` (DOM/math helpers, drag/scrub, the numeric
  field, theming, the popover shell, a control registry), `core.ts` (schema → meta
  inference, the cheap always-loaded controls, the panel, `enhance`), `types.ts` (the
  public type surface), and `controls/*.ts` (the heavy controls, dynamic-imported on
  first use; `colour` is the only one that pulls in the engine, so basic panels never
  pay for it).
- `src/wide-gamut.ts` — the OKLCH / wide-gamut colour engine.
- `src/tweaks.css` — the panel styling (runs entirely on `--tw-*` custom properties).

## Credits

No runtime dependencies. The toolbar and control icons are inline SVGs adapted from
[Lucide](https://lucide.dev) (ISC) and, upstream, [Feather](https://feathericons.com)
(MIT); the drag handle is original. Per-icon origins and the full license texts are in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

## License

[MIT](LICENSE) © Ryan Kiley. The bundled icons keep their original ISC/MIT licenses —
see [Credits](#credits) and [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
