# Contributing

Thanks for your interest in Tweakit. It's a dependency-free, code-split parameter
panel built from a single TypeScript source tree — `dist/` is generated, never edited by
hand.

## Setup

```
npm install
npm run build      # → dist/ (split chunks, single file, CSS, .d.ts, docs site)
npm test           # build, then the suite (Node's runner + jsdom)
npm run test:browser  # build, then layout in Playwright's Chromium (npx playwright install chromium once)
npm run serve      # build + serve the docs site on :4330
```

Node 22 (what CI runs; the build itself works on 20+, but the jsdom test suite needs 22.22, 24.15 or newer). There are no runtime dependencies; the dev ones are only
for the build (esbuild, typescript) and the tests (jsdom, fake-indexeddb, and Playwright for the browser checks).

## Where things live

- `src/tweaks/` — the kit. `core.ts` is the public entry (re-exports only); the
  implementation is split by job: `shared.ts` (helpers, theming, the popover shell, the
  control registry), `schema.ts` (schema value → control meta), `panel.ts` (`tweaks()` and
  the panel API), `standalone.ts` (`mountControl()` and `createColorPicker()`),
  `feedback.ts` (the copy / reset buttons, the hint tooltip, the screen-reader announcer),
  `icons.ts`, `lazy.ts` (the dynamic-import map), `easing.ts` (gradient easing and
  `gradientCss()`), `types.ts` (the public type surface), `controls/basic.ts` (the light
  always-loaded controls) and `controls/*.ts` (the heavy controls, dynamic-imported on
  first use). Five more modules are lazy chunks of the code-split build, so a basic panel
  never fetches them: `heavy.ts` (the numeric field, scrub and canvas helpers only the
  heavy controls use, plus the Number control), `markup.ts` (the `[data-twk]` parsers and
  the binding behind `enhance()`; `enhance.ts` is core's side of it, and `auto.ts`, the
  `tweakit/auto` entry, its opt-in run on load), `clip.ts` (a picked row's paste),
  `image-store.ts` (uploaded images in IndexedDB) and `fold.ts` (the conditional row's fold).
- `src/wide-gamut.ts` — the OKLCH / wide-gamut color engine.
- `src/tweaks.css` — panel styling, entirely on `--twk-*` custom properties.
- `site/` — the docs/examples site and its zero-dependency generator.
- `test/` — the `npm test` suite; `test/browser/` the layout checks jsdom can't make (row heights, label insets, overflow, drag).

## Conventions worth knowing

A few things aren't obvious from the file tree and will trip you up otherwise:

- **One source, two builds.** The same `src/` produces both the code-split chunks and the
  single inlined file via an esbuild `TW_SPLIT` define — don't fork logic per build.
- **`sideEffects` in package.json** leaves out only the two entries, `dist/tweaks/core.js`
  and `dist/tweaks.js`, so a bundler can drop an unused import of the kit. Every other file
  counts as having effects, `src/` included: the build bundles `src/` under the same field, and
  a side-effect-free `src/` drops single.ts's bare control imports. A new entry that acts on
  import belongs in the list; `test/side-effects.test.mjs` checks it against `dist/`.
- **Adding a control** = a type in `types.ts` (`SchemaObject`), a `registerControl`
  constructor, and (for a heavy control) a `LAZY_IMPORT` key + a static import in
  `single.ts`. A lazy control's verbose form passes through `metaFor` as given, so its
  constructor reads and validates its own fields off the meta; add a `TYPED_META` entry
  only when the form needs reshaping before the constructor sees it (a derived `value`
  for reset, nested metas, a required field whose absence means "this is a folder"), and
  a `DATA_VALUE` entry when the `[data-twk]` dataset's strings need parsing (numbers,
  flags, lists). Both entry points derive the same verbose meta, so a control wired once
  works on every one. `test/registry.test.mjs` cross-checks the tables and the lazy map —
  add your type's minimal fixture there and it will tell you about any table you missed.
- **The docs examples are self-verifying.** Each example's `run` function is
  `toString()`-serialized — the exact text is *both* the displayed snippet and the script
  that runs the demo, so they can't drift. Consequences: `site/pages/*.mjs` must never pass
  through esbuild, and example code must avoid nested template literals and regex literals
  (the tiny highlighter can't parse them). Scope per-example CSS with an example-unique
  class prefix; nothing auto-scopes.
  An example's `code` may be an array of `{ label, lang, text }`, shown as tabs; a `text`
  block is prose and soft-wraps. A page may export `script`, a function run once on that
  page and shown nowhere. The build also writes a Markdown mirror of every page, `llms.txt`
  and `llms-full.txt`, and a version-stamped copy of `AGENTS.md`; `test/agents-md.test.mjs`
  holds the guide to the control registry and the README to the install prompt.
- **Theming runs entirely on `--twk-*`.** New visual values go through tokens, not
  hardcoded colors. A color that differs by scheme is one `light-dark(light, dark)` value in
  the token block; the panel's `color-scheme` picks the arm, and `[data-twk-scheme]` pins only
  set that. A value that isn't a color (a shadow) takes `light-dark()` on each layer's color;
  only a shadow that exists in one scheme alone (the slider handle's edge) needs its own rule.
- **Site copy is American English** (color, not colour). The kit's public API keeps the
  `color` type string too.

## The stress harness

`test/stress.test.mjs` is a seeded fuzzer that runs as part of `npm test`: each seed grows a
random schema (every control type, shorthand and verbose, folders and tabs, a slice of
hostile values), builds it under jsdom and drives the panel API, keyboard and clicks through
a few dozen random operations, checking the invariants after each one. A failure names its
seed; replay it alone with `TW_STRESS_SEED=17 node --test test/stress.test.mjs` (add
`TW_STRESS_TRACE=1` to print every operation). The default is 40 seeds — run more with
`TW_STRESS_SEEDS=500 node --test test/stress.test.mjs`, or bump the fallback in the
`SEED_COUNT` line at the top of the file to make it permanent. A seed that reproduces a
known, unfixed bug goes in the file's `KNOWN_BUGS` map with its symptom, which skips it
until the fix lands; `TW_STRESS_UNSKIP=1` runs those seeds anyway, to check that a fix holds.

## Before you open a PR

- `npm test` is green (build + tsc + the jsdom suite — the build fails on `tsc` errors,
  so a green build is meaningful).
- Keep PRs focused; the project squash-merges, so one logical change per PR reads best.
- If you change behavior, update the [README](README.md) and AGENTS.md. There's no changelog
  file — release notes live in each version's [GitHub Release](https://github.com/ryankiley/tweakit/releases),
  written when the release is cut.

## Reporting bugs

Open an [issue](https://github.com/ryankiley/tweakit/issues) with a minimal schema
that reproduces it and the browser/version. For security issues, see
[SECURITY.md](SECURITY.md) instead.
