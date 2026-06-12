# Changelog

## Unreleased

### Added
- Test suite (`npm test`, Node's built-in runner): wide-gamut conversion round-trips,
  the plot expression parser's whitelist/precedence/caps, and jsdom behaviour tests
  against both built bundles — schema degrade contracts, `set()`/`on()`/`reset()`
  round-trips, prototype-pollution refusal, and the code-split lazy-window replay.
- CI runs build + tests on pull requests (deploys still happen only from `main`).
- npm metadata (`repository` / `homepage` / `bugs` / `keywords`); `prepublishOnly`
  now also runs the tests.
- README: browser-support statement.

### Fixed (adversarial review pass 7, #29)
- A malformed verbose schema value (e.g. `{ type: "point", components: [null] }`)
  degrades to a skipped control instead of throwing the whole `tweaks()` build away.
- `panel.set()` during the code-split lazy window queues and replays once the
  controls exist — dotted/nested sets used to be dropped, bare nested keys minted
  top-level orphans.
- A soft slider keeps an out-of-range schema default (it clamped to `max`).
- The interval slider self-heals on `lostpointercapture` (a lost capture
  permanently blocked future drags) and tolerates a missing value tuple.
- `numField` / the number control reject negative and `Infinity` steps.
- The text control renders `set(null/undefined)` as `""`, not `"undefined"`.
- Tabs support Home/End (the ARIA tabs pattern).

## 0.0.1

Initial development: the full control kit (sliders, toggles, lists, radio grids,
text, number scrubs, folders, tabs, the wide-gamut OKLCH colour picker, gradients,
intervals, point pads, cubic-bézier and spring editors, plots, monitors, images),
the panel API (`on`/`set`/`reset`/themes/presets/undo/persistence), `[data-tw]`
markup enhancement, the code-split and single-file builds, and the docs site.
