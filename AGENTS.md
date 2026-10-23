# Tweakit for coding agents

Tweakit is a dependency-free, code-split, real-time parameter panel for the browser. Hand `tweaks(name, schema)` a plain object and it builds a live control for each value: sliders, toggles, lists, a wide-gamut color picker, gradient, shadow, motion and curve editors, folders and tabs. This file ships inside the npm package, so `node_modules/tweakit/AGENTS.md` always matches the installed version; prefer it over anything you remember about tweakit. The same guide, stamped with its version, is at https://ryankiley.github.io/tweakit/AGENTS.md, and the docs as Markdown start at https://ryankiley.github.io/tweakit/llms.txt.

- Package `tweakit` on npm. Source: https://github.com/ryankiley/tweakit. Docs: https://ryankiley.github.io/tweakit/
- Every option is documented in `node_modules/tweakit/dist/types/tweaks/types.d.ts`.

## Workflow

1. Look at the project first: its bundler or lack of one, its package manager, and the component the person wants to tune.
2. Install, then import one build and the stylesheet (below).
3. Build one panel from values the component already has. Start from their current values with sensible ranges; four to eight controls is plenty.
4. Bind the live values to the component's styles or animation in `panel.on()`, and apply `panel.params` once after `panel.ready`.
5. Append `panel.el` somewhere visible. Gate the panel behind a development flag; tweakit has no production switch of its own.
6. Run the project's build or checks and confirm the panel renders with the expected keys on `panel.params`.
7. When the person pastes values copied from the panel, change the schema's defaults in source (see "Copy and paste"). Leave the panel in place unless asked to remove it.

## Install and import

```sh
npm install tweakit
```

```js
import { tweaks } from "tweakit";        // single-file build: every control inlined, synchronous
import { tweaks } from "tweakit/core";   // code-split build: heavy controls load on first use
import "tweakit/css";                    // the stylesheet, needed by either build
```

Without a bundler, copy `dist/tweaks.js` and `dist/tweaks.css` out of the package; the script is an ES module, so load it with `<script type="module">`. Both builds share one API. On the code-split build a panel whose schema needs a lazy control (color, gradient, shadow, motion, point and others) fills in when `panel.ready` resolves; the single-file build resolves it at once.

## A first panel

```js
import { tweaks } from "tweakit";
import "tweakit/css";

const panel = tweaks("Card", {
  radius: [18, 0, 60, 1],          // [value, min, max, step] → slider
  visible: true,                   // → checkbox
  blend: ["normal", "multiply"],   // → list
  tint: "#7C5CFF",                 // → wide-gamut color picker
});
document.body.append(panel.el);

const apply = (p) => {
  card.style.borderRadius = `${p.radius}px`;
  card.style.background = p.tint;
  card.style.mixBlendMode = p.blend;
  card.style.opacity = p.visible ? 1 : 0.1;
};
panel.on(apply);
panel.ready.then(() => apply(panel.params));
```

## Shorthands: what a value's shape builds

| You write | Control | `params` value |
| --- | --- | --- |
| `24` | slider; range 0 to 1 for a value up to 1, else 0 to 3 times the value; a negative value mirrors that below 0 | number |
| `[1.2, 0, 3, 0.1]` | slider with min, max, step; `[v]`, `[v, min]` and `[v, min, max]` fill in the rest; up to four numbers are always this tuple, never a list | number |
| `[[20, 80], 0, 100]` | interval, two handles | `[lo, hi]` |
| `true` | checkbox | boolean |
| `"Hello"` | text input | string |
| `"#7C5CFF"` | color picker, for hex or a color function (`oklch(…)`, `rgb(…)`, `hsl(…)`, `color(…)`); a named color such as `"red"` or `"transparent"` builds a text input, so write it as hex | color string |
| `["a", "b"]` | list (dropdown); an option may be `{ value, label }`; numeric choices need `{ type: "list", options }` | string |
| `{ options: ["a", "b"], value: "b" }` | list with a chosen default | string |
| `{ action: fn }` | button | none |
| `{ x: 0, y: 10 }` | folder of controls | nested object |
| `{ type: "…", … }` | that control, verbatim (next table) | per control |

A missing step is 0.01 for a range up to 1, 0.1 up to 10, 1 up to 100, else 10. Keys become labels, title-cased; `label` overrides on a `{ type }` form and on `{ action }`, not on the `{ options, value }` shorthand. `_last` is reserved and cannot be a key.

## Every control, as `{ type, … }`, and what it returns

Every `{ type }` form also takes `label`, `hint` (a tooltip), `render: (get) => boolean` (show by another value, `get("key")`), `disabled: boolean | (get) => boolean`, and `persist: false`. In a plain folder object those names are children, not options. Nested values read as `params.folder.key`.

| `type` | Options | `params` value |
| --- | --- | --- |
| `slider` | `value, min, max, step, unit, soft, format, parse` | number |
| `number` | `value, min, max, step, unit, soft` | number |
| `interval` | `value: [lo, hi], min, max, step` | `[lo, hi]` |
| `sides` | `value` (one number, a CSS-order array, or `"8px 16px"`), `unit, step, min, max, corners` | `{ top, right, bottom, left, css }`; `css` is ready for `padding`, `margin` or `border-radius` |
| `point` | `components: [{ key, label, value, min, max, step }], pad, invertY` | an object keyed by component, such as `{ x, y }` |
| `checkbox` | `value` | boolean |
| `text` | `value, rows, placeholder` | string |
| `list` | `options, value` | string |
| `segmented` | `options, value, cols` | string |
| `radiogrid` | `options, value, cols` | string |
| `color` | `value` | color string in the picker's notation: `oklch(60% 0.23 286)` by default, whatever you wrote; `#rrggbb` once the user picks hex |
| `gradient` | `stops: [[color, position], …]` | `{ stops: [{ color, pos }], interpolation, easing }`, which goes back in whole as `value`; `gradientCss(value, angle)` makes the CSS |
| `shadow` | `x, y, blur, spread, color, inset`, or `value` as a `box-shadow` string | `{ x, y, blur, spread, color, inset, css }`; `css` is ready for `box-shadow` |
| `image` | `value` | a URL or data URL string, empty when none |
| `motion` | `mode: "easing"` with `curve` and `duration` (ms), or `mode: "spring"` with `stiffness, damping, mass` or `visualDuration, bounce` | `{ mode, …, duration, easing }`; `easing` is a `cubic-bezier(…)` or sampled `linear(…)` string for a CSS transition; a spring's `duration` is its settle time |
| `spring` | `mode: "time"` or `"physics"`, `visualDuration, bounce, stiffness, damping, mass` | `{ stiffness, damping, mass }`, plus the time pair when tuned by feel |
| `cubicbezier` | `value: [x1, y1, x2, y2]` | `[x1, y1, x2, y2]` |
| `plot` | `expr` or `fn`, `xMin, xMax, yMin, yMax, samples, editable` | the expression string, `""` when drawn from `fn` |
| `monitor` | `get: () => number` (or a string), or `value`, `graph, view, min, max, interval, rows, decimals` | none; it watches |
| `fpsgraph` | none | none; a frame-rate graph |
| `button` | `action, label` | none |
| `buttongroup` | `buttons: { Label: fn }` or `[{ label, action }]` | none |
| `separator` | none | none |
| `tabs` | `pages: { Title: schema }`, keyed by the tab's title | nested under each title's slug, lower-case with other characters as `-`: `pages: { Layout: { gap } }` reads as `params.tabs.layout.gap` |

## The panel

`tweaks(name, schema, options?)` returns synchronously.

- `panel.el`: append it. `panel.params`: live values, nested like the schema, updated in place; `params._last` is the last changed key, the bare leaf (`blur`, not `shadow.blur`).
- `panel.on((params, changedKey) => …)`: fires on every change; returns an unsubscribe function. `changedKey` is that same leaf, so read nested values off `params` rather than switching on the key.
- `panel.ready`: resolves once lazy controls have built.
- `panel.set("folder.key", value)` and `panel.setMany({ "folder.key": v, other: w })`: write from code; dotted paths reach nested controls; `{ silent: true }` skips your listeners.
- `panel.changes()`: the values that differ from their defaults, keyed by dotted path. `panel.reset()` restores the defaults.
- `panel.toJSON()` and `panel.fromJSON(state)`: every value, nested, plus folder and tab UI state, JSON-safe; `JSON.stringify(panel)` uses it.
- `panel.setTheme(theme)`, `panel.setName(name)`; `panel.undo()` and `panel.redo()` with `undo: true`; `savePreset`, `loadPreset`, `deletePreset` and `presets()` with `persist`.
- `panel.destroy()`: removes it and releases every listener.

Options, the third argument: `theme` (token overrides), `persist` (a localStorage key, or `true` to key by name; turns presets on), `presets: false`, `filter: true` (a search field; needs the toolbar), `floating: true` or `{ x, y, corner }`, `draggable: false` to pin, `toolbar: false`, `undo: true`, `onReset`, `onEditStart` and `onEditEnd`.

Every panel drags by its header and lifts into a floating layer on the first drag; `floating` starts it there, inset from a corner. Its placement is plain `.tw-panel` CSS, so a class of yours loaded after `tweakit/css` overrides it.

## Copy and paste: how tuned values come back to you

The panel's toolbar copy button puts JSON on the clipboard. A click copies the full values snapshot, nested like the schema. Shift-click copies only what changed, as a flat map keyed by dotted path, the shape `setMany()` takes:

```json
{ "radius": 22, "shadow.blur": 28, "tint": "oklch(72% 0.14 290)" }
```

Tweakit never writes to source files. The person pastes that JSON to you; then:

1. Find the `tweaks(name, …)` call whose schema holds those keys. The panel's title is its name.
2. For each key, change the default in the schema: the first element of a slider tuple, the bare value, or `value:` in a `{ type }` form. A key like `shadow.blur` is `blur` inside the `shadow` folder. A control whose value is an object (shadow, sides, gradient, motion, spring, point) comes back whole under its own key: copy its fields onto the `{ type }` form and drop the derived ones (`css`, `easing`, a spring's `duration`).
3. Leave the panel code in place and run the build.

## Markup instead of a schema

The core module also upgrades `[data-tw]` elements in place: `<div data-tw="slider" data-label="Blur" data-value="12" data-min="0" data-max="40"></div>`, inside a `.tw-panel` shell for the header and toolbar or bare anywhere in your layout, a control's options as `data-*` attributes. Each host dispatches a bubbling `tw:change` event with `{ key, value }`; `enhance(root)` binds hosts added later. Details: https://ryankiley.github.io/tweakit/markup.md

## One control without a panel

`mountControl(host, value, { key, label, onChange })` builds one control from any single-control schema value (not a folder or tabs) into your element and returns `{ el, set, get, destroy, ready }`. `createColorPicker({ value, mode, onChange })` is the color editor alone, for a swatch of your own. `gradientCss(value, angle?)` and `gradientStops(value)` turn a gradient value into CSS.

## Theming

The panel is dark by default and follows the system scheme; `data-tw-scheme="light"` or `"dark"` on any ancestor pins it. `theme` takes friendly keys (`accent`, `base`, `surface`, `border`, `text`, `radius`, `density`, `width`, `font` and more) or raw `--tw-*` tokens. Details: https://ryankiley.github.io/tweakit/theming.md

## What tweakit does not do

- It never edits source files, and it persists only to localStorage when `persist` is set. Values leave through the clipboard, `panel.changes()` or `panel.toJSON()`.
- It has no production switch. Gate the panel in your code, for example behind `import.meta.env.DEV`.
- It is not a framework component. In React, Vue, Svelte or Solid, create the panel once in a mount effect, append `panel.el` to a ref, update state in `panel.on()`, and call `panel.destroy()` on unmount.
- `params` is a plain object updated in place. Subscribe with `on()`; do not poll it.

## Example requests

- "Add a tweakit panel to this card so I can tune its shadow, corner radius and background color live. Keep the shadow's fields in a folder. Bind the values to the card's styles."
- "This hover animation uses a spring. Add a tweakit panel with a motion control for the spring and a slider for the hover scale, and drive the animation from the panel's values."
- "These values were copied from a tweakit panel. Apply them as the new defaults in the schema in source, and leave the panel in place."

## Checks

The build passes. The stylesheet is imported once. After `panel.ready`, `panel.params` has the keys the schema declares, and moving a control changes the component.
