# Tweakit

[![npm](https://img.shields.io/npm/v/tweakit)](https://www.npmjs.com/package/tweakit)

A dependency-free, code-split, real-time **parameter panel**. Hand it a plain schema and
it builds a live control for each value: sliders, toggles, dropdowns, a wide-gamut OKLCH
color picker, gradient, shadow, cubic-bézier and motion editors, a spring tuner, a four-sided
length (padding, margin or radii) on one row, monitors, a 2D point pad, and more.

**[Docs & live examples →](https://ryankiley.github.io/tweakit/)**

## Why tweakit

Tweakpane, lil-gui and Leva are all good panels: Tweakpane for its plugin ecosystem, lil-gui for the
smallest footprint, Leva if your app is React hooks throughout. Tweakit is for when the values you're
tuning are color and motion:

- **Wide-gamut color.** An OKLCH picker that reaches past sRGB into Display P3 and Rec. 2020 and says
  which gamut a color is in, eleven notations, and the value handed back exactly as you wrote it until
  you edit it.
- **Motion editors that match Motion.** Easing, cubic-bézier and spring editors; a time-mode spring
  (`visualDuration`, `bounce`) resolves exactly as Motion does, and every one hands back a ready
  `transition` easing, a sampled `linear()` for springs.
- **Markup mode.** `[data-tw]` elements become controls in place, no script per control.
- **CSP-safe.** The plot control parses its expressions itself, with no `eval` or `new Function`.
- **Values back into source.** The copy button puts the tuned values on the clipboard as JSON, and
  [AGENTS.md](https://ryankiley.github.io/tweakit/AGENTS.md) tells a coding agent how to apply them.

## Install

```
npm install tweakit
```

tweakit is an ES module only. In a CommonJS project, set `"type": "module"` in package.json, or load it
with `await import("tweakit")`; TypeScript under `moduleResolution: node16` needs the same. There, a `.cts` file
imports the types as `import type { Schema } from "tweakit" with { "resolution-mode": "import" }` (TS1541 without it;
`nodenext` on current TypeScript does without it).

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

Panels can also come from `[data-tw]` markup, bound by `enhance()`. Importing `tweakit` binds
nothing on its own; import `tweakit/auto` instead (the same API) to bind the page's markup once it
has parsed.

### In React (or Vue, Svelte, Solid)

The panel isn't a component: create it once in a mount effect, append `panel.el` to a ref, and
destroy it on unmount. `params` is updated in place, so copy it into state.

```jsx
import { useEffect, useRef, useState } from "react";
import { tweaks } from "tweakit";
import "tweakit/css";

function Card() {
  const host = useRef(null);
  const [p, setP] = useState({ radius: 18, tint: "#7C5CFF" });
  useEffect(() => {
    const panel = tweaks("Card", { radius: [18, 0, 60, 1], tint: "#7C5CFF" });
    host.current.append(panel.el);
    panel.on((values) => setP({ ...values }));
    return () => panel.destroy();
  }, []);
  return (<><div ref={host} /><div style={{ borderRadius: p.radius, background: p.tint }} /></>);
}
```

Gate it behind a development flag (`import.meta.env.DEV`): tweakit has no production switch of its own.

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
to start it there (`true` sits 16px in from the top-left; `{ x, y }` sets the insets), and
`draggable: false` to pin it. A draggable panel with `persist` remembers where it was dropped.
Its placement is plain `.tw-panel` CSS, so a class of yours overrides it; the
[panel API page](https://ryankiley.github.io/tweakit/panel-api.html#floating) has the recipe.

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
