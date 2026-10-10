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
