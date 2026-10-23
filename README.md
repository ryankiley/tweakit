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

## Coding agents

Read `node_modules/tweakit/AGENTS.md` before writing tweakit code. It is the guide for
agents (every control and the value it returns, the panel API, how copied values come back),
version-matched to the installed package, and also at
[ryankiley.github.io/tweakit/AGENTS.md](https://ryankiley.github.io/tweakit/AGENTS.md).
To keep it in reach, add to your project's `AGENTS.md` or `CLAUDE.md`:

```md
This project uses tweakit. Explore the code first, then read node_modules/tweakit/AGENTS.md
before writing tweakit code; prefer it over what you remember. Values tuned in a panel arrive
as JSON from its copy button; apply them to the schema defaults in source, not to the panel.
```

Or hand your agent the whole job:

```text
Install tweakit in this repo. Read https://ryankiley.github.io/tweakit/AGENTS.md first.
Install it with this project's package manager, import "tweakit/css", and add one panel with
a few controls to an existing component so I can tune it live. Bind the values to its styles.
Verify the build.
```

## Floating panel

Every panel drags by its header and lifts into a fixed layer on the first drag. Pass `floating`
to start it there, and `draggable: false` to pin it:

```js
tweaks("Settings", schema, { floating: { x: 16, y: 16, corner: "top-right" }, draggable: false });
```

- `floating: true` sits 16px in from the top-left. `{ x, y, corner }` sets the insets in px
  from the edges of `corner`: `"top-left"` (the default), `"top-right"`, `"bottom-left"` or
  `"bottom-right"`. The panel keeps that corner as the window resizes, and a drag moves it from there.
  A bottom-anchored panel keeps its bottom edge when it collapses, so its header drops.
- A draggable panel with `persist` remembers where it was dropped. A pinned one always sits at
  its `floating` placement.
- The height caps at the window, with a gap at the far edge equal to `y` while the panel sits
  at its placement (8px once dragged). In a window too short for both, a pinned panel's inset and
  gap shrink together. Past the cap the whole panel scrolls, header included, with its scrollbar hidden.

The placement lives in CSS at plain `.tw-panel` specificity, so a class of your own, loaded
after `tweakit/css`, overrides any part of it without `!important`. If your bundler might load
it first, write the selector as `.tw-panel.my-panel`:

```css
.my-panel {
  --tw-float-gap: 1.5rem;          /* the far-edge gap the height cap leaves, in any length */
  max-height: 60vh;                /* or replace the cap outright */
  top: 72px; right: 16px; left: auto; /* the inset, on a pinned panel */
  z-index: 2;                      /* 99990 by default; a drag raises it while it lasts */
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
