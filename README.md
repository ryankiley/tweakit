# Tweakability

A dependency-free, code-split, real-time **parameter panel**. Hand it a plain schema and
it builds a live control for each value — sliders, toggles, dropdowns, a wide-gamut OKLCH
color picker, gradient and cubic-bézier editors, a spring tuner, monitors, a 2D point pad,
and more.

**[Docs & live examples →](https://ryankiley.github.io/tweakability/)**

## Use

```js
import { tweaks } from "tweakability";
import "tweakability/css";

const panel = tweaks("Card", {
  blur: [24, 0, 100, 1],          // slider
  visible: true,                   // checkbox
  blend: ["normal", "multiply"],   // list
  tint: "#7C5CFF",                 // wide-gamut color picker
});
document.body.append(panel.el);
panel.on((values) => { /* values.blur, values.tint, … */ });
```

Everything else — every control live, the panel API, theming, markup-driven panels, and
the two builds (one inlined file vs the code-split entry) — is on the
**[docs site](https://ryankiley.github.io/tweakability/)**.

## Develop

```
npm install
npm run build
npm test
```

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md); report security issues per
[SECURITY.md](SECURITY.md).

## Credits

Inspired by Tweakpane and dialkit. Toolbar and control icons from Lucide / Feather — see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
