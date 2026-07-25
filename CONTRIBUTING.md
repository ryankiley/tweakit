# Contributing

Thanks for your interest in Tweakit. It's a dependency-free, code-split parameter
panel built from a single TypeScript source tree — `dist/` is generated, never edited by
hand.

## Setup

```
npm install
npm run build      # → dist/ (split chunks, single file, CSS, .d.ts, docs site)
npm test           # build, then the suite (Node's runner + jsdom)
npm run serve      # build + serve the docs site on :4330
```

Node 20+. There are no runtime dependencies and only three dev ones (esbuild, jsdom,
typescript).

## Where things live

- `src/tweaks/` — the kit. `core.ts` is the public entry (re-exports only); the
  implementation is split by job: `shared.ts` (helpers, drag/scrub, the numeric field,
  theming, the popover shell, the control registry), `schema.ts` (schema value /
  `[data-tw]` dataset → control meta), `panel.ts` (`tweaks()` and the panel API),
  `enhance.ts` (markup enhancement + its on-load auto-run), `feedback.ts` (toast, hint
  tooltip, toolbar buttons), `icons.ts`, `lazy.ts` (the dynamic-import map),
  `types.ts` (the public type surface), `controls/basic.ts` (the light always-loaded
  controls) and `controls/*.ts` (the heavy controls, dynamic-imported on first use).
- `src/wide-gamut.ts` — the OKLCH / wide-gamut colour engine.
- `src/tweaks.css` — panel styling, entirely on `--tw-*` custom properties.
- `site/` — the docs/examples site and its zero-dependency generator.
- `test/` — the `npm test` suite.

## Conventions worth knowing

A few things aren't obvious from the file tree and will trip you up otherwise:

- **One source, two builds.** The same `src/` produces both the code-split chunks and the
  single inlined file via an esbuild `TW_SPLIT` define — don't fork logic per build.
- **Adding a control** = a `TYPED_META` table entry (typed against `SchemaObject["type"]`,
  so `types.ts` must declare the type too) + a `registerControl` constructor, and (for a
  heavy control) a `LAZY_IMPORT` key + a static import in `single.ts`. The
  schema-shorthand and `[data-tw]` markup paths both derive from the same verbose meta,
  so a control wired once works on every entry point. `test/registry.test.mjs`
  cross-checks all of these tables — add your type's minimal fixture there and it will
  tell you about any table you missed.
- **The docs examples are self-verifying.** Each example's `run` function is
  `toString()`-serialized — the exact text is *both* the displayed snippet and the script
  that runs the demo, so they can't drift. Consequences: `site/pages/*.mjs` must never pass
  through esbuild, and example code must avoid nested template literals and regex literals
  (the tiny highlighter can't parse them). Scope per-example CSS with an example-unique
  class prefix; nothing auto-scopes.
- **Theming runs entirely on `--tw-*`.** New visual values go through tokens, not
  hardcoded colours. The light token block must exist twice in the shipped CSS (CSS can't
  share a block across a media query and a selector), but only the media-driven block is
  authored: the build **generates** the `[data-tw-scheme="light"]` twin from it, and fails
  if it finds a hand-written forced-light rule or an underivable rule in the media block.
- **Site copy is American English** (color, not colour). The kit's public API keeps the
  `color` type string too.

## Before you open a PR

- `npm test` is green (build + tsc + the jsdom suite — the build fails on `tsc` errors,
  so a green build is meaningful).
- Keep PRs focused; the project squash-merges, so one logical change per PR reads best.
- If you change behaviour or sizes, update the [README](README.md). There's no changelog
  file — release notes live in each version's [GitHub Release](https://github.com/ryankiley/tweakit/releases),
  written when the release is cut.

## Reporting bugs

Open an [issue](https://github.com/ryankiley/tweakit/issues) with a minimal schema
that reproduces it and the browser/version. For security issues, see
[SECURITY.md](SECURITY.md) instead.
