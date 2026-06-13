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

See the **Layout** section of the [README](README.md) for the full map. In short:

- `src/tweaks/` — the kit. `shared.ts` (helpers, drag/scrub, the numeric field, theming,
  the popover shell, the control registry), `core.ts` (schema inference, the light
  always-loaded controls, the panel, `enhance`), `types.ts` (the public type surface),
  `controls/*.ts` (the heavy controls, dynamic-imported on first use).
- `src/wide-gamut.ts` — the OKLCH / wide-gamut colour engine.
- `src/tweaks.css` — panel styling, entirely on `--tw-*` custom properties.
- `site/` — the docs/examples site and its zero-dependency generator.
- `test/` — the `npm test` suite.

## Conventions worth knowing

A few things aren't obvious from the file tree and will trip you up otherwise:

- **One source, two builds.** The same `src/` produces both the code-split chunks and the
  single inlined file via an esbuild `TW_SPLIT` define — don't fork logic per build.
- **Adding a control** = a `TYPED_META` table entry + a `registerControl` constructor, and
  (for a heavy control) a `LAZY_IMPORT` key. The schema-shorthand and `[data-tw]` markup
  paths both derive from the same verbose meta, so a control wired once works on every
  entry point.
- **The docs examples are self-verifying.** Each example's `run` function is
  `toString()`-serialized — the exact text is *both* the displayed snippet and the script
  that runs the demo, so they can't drift. Consequences: `site/pages/*.mjs` must never pass
  through esbuild, and example code must avoid nested template literals and regex literals
  (the tiny highlighter can't parse them). Scope per-example CSS with an example-unique
  class prefix; nothing auto-scopes.
- **Theming runs entirely on `--tw-*`.** New visual values go through tokens, not
  hardcoded colours. The light/dark token blocks are intentionally duplicated (CSS can't
  share a block across a media query and a selector) and a **twin drift check** in the
  build fails if the two copies diverge — keep both in sync.
- **Site copy is American English** (color, not colour). The kit's public API keeps the
  `color` type string too.

## Before you open a PR

- `npm test` is green (build + tsc + the jsdom suite — the build fails on `tsc` errors and
  on twin drift, so a green build is meaningful).
- Keep PRs focused; the project squash-merges, so one logical change per PR reads best.
- If you change behaviour or sizes, update the [README](README.md) and
  [CHANGELOG.md](CHANGELOG.md) (`Unreleased` section).

## Reporting bugs

Open an [issue](https://github.com/ryankiley/tweakit/issues) with a minimal schema
that reproduces it and the browser/version. For security issues, see
[SECURITY.md](SECURITY.md) instead.
