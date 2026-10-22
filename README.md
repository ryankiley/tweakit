# Tweakit

[![npm](https://img.shields.io/npm/v/tweakit)](https://www.npmjs.com/package/tweakit)

A dependency-free, code-split, real-time **parameter panel**. Hand it a plain schema and
it builds a live control for each value: sliders, toggles, dropdowns, a wide-gamut OKLCH
color picker, gradient, shadow, cubic-bézier and motion editors, a spring tuner, a four-sided
length (padding, margin or radii) on one row, monitors, a 2D point pad, and more.

**[Docs & live examples →](https://ryankiley.github.io/tweakit/)**

## Install

```
npm install tweakit
```

## Use

```js
import { tweaks } from "tweakit";
import "tweakit/css";

const panel = tweaks("Card", {
  blur: [24, 0, 100, 1],          // slider
  visible: true,                   // checkbox
  blend: ["normal", "multiply"],   // list
  tint: "#7C5CFF",                 // wide-gamut color picker
});
document.body.append(panel.el);
panel.on((values) => { /* values.blur, values.tint, … */ });
```

Everything else is on the **[docs site](https://ryankiley.github.io/tweakit/)**: every
control live, the panel API, theming, markup-driven panels, and the two builds (the
single-file build vs the code-split entry).

## Floating panel

Every panel drags by its header and lifts into a fixed layer on the first drag. Pass `floating`
to start it there, and `draggable: false` to pin it:

```js
tweaks("Settings", schema, { floating: { x: 16, y: 16, corner: "top-right" }, draggable: false });
```

- `floating: true` sits 16px in from the top-left. `{ x, y, corner }` sets the insets in px
  from the edges of `corner`: `"top-left"` (the default), `"top-right"`, `"bottom-left"` or
  `"bottom-right"`. The panel keeps that corner as the window resizes, and a drag moves it from there.
- A draggable panel with `persist` remembers where it was dropped. A pinned one always sits at
  its `floating` placement.
- The height caps at the window, with a gap at the far edge equal to `y` (8px for a panel
  lifted by a drag). Past the cap the whole panel scrolls, header included, with its scrollbar hidden.

The placement lives in CSS at plain `.tw-panel` specificity, so a class of your own, loaded
after `tweakit/css`, overrides any part of it without `!important`:

```css
.my-panel {
  --tw-float-gap: 24px;            /* the far-edge gap the height cap leaves */
  max-height: 60vh;                /* or replace the cap outright */
  top: 72px; right: 16px; left: auto; /* the inset, on a pinned panel */
  z-index: 2;                      /* 99990 by default; a drag still raises it */
  box-shadow: none;                /* var(--tw-shadow-panel-lifted) by default */
}
```

## Develop

```
npm install
npm run build
npm test
```

CI runs Node 22. The build works on Node 20+, but the test suite runs under jsdom, which
needs Node 22.22, 24.15 or newer.

Contributions welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues per
[SECURITY.md](SECURITY.md).

## Credits

Inspired by Tweakpane and dialkit. Toolbar and control icons from Hugeicons; see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
