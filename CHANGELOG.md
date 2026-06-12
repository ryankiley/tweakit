# Changelog

## Unreleased

### Changed (consolidation pass)
- One numeric engine: the Number control is now the shared `numField` in row chrome.
  Its readout formats to the step's decimal precision like the slider/point readouts
  (step 0.25 shows `5.00`, not `5`), and the whole family rounds on a min-anchored
  grid (the boxed fields used to anchor at 0 — with `min: 0.5, step: 1` the two
  produced different value sets).
- The colour, gradient, and point controls share one modal-trigger row
  (`tw-trigger` / `-label` / `-right` / `-value` / `-chip` classes replace the three
  per-control sets), with one CSS block behind it. Side effects, all wins: the
  gradient trigger gains the focus ring it was missing, double-click/hold-to-reset
  and the hint marker now land on the point control's label (its label was missing
  from both selector lists, so reset armed on the whole row), the point row's right
  padding aligns with the other chips (12→10), and the point readout joins the
  word-spaced column convention.
- Portaled tip + toast take their tokens from the shared portal block like every
  other portaled surface, instead of per-rule `var()` fallbacks (which had already
  drifted: border `0.05` vs the canonical `0.045`).
- Markup (`[data-tw]`) metas now parse into the same verbose values the schema path
  consumes — one derivation, so the two entry points can't drift again.
- Focus-visible rules consolidated to one block (one ring, three offsets).
- Numeric field inputs and the picker's mode select / hex input carry aria-labels.
- The spring preview's drag (curve-area tuning) rides the shared `dragGesture` —
  same behaviour, plus the single-pointer guard (a second finger could fork the
  hand-rolled drag) and the buttons-released-off-element self-heal.

### Fixed
- Clicking into a text field (the text control, textarea, number fields, search,
  preset name, hex) no longer draws the keyboard focus ring — `:focus-visible`
  always matches a focused text field whatever moved focus there, so the typeable
  fields' ring fired on plain mouse clicks. A one-page modality note (`quietFocus`)
  keeps pointer-origin focus quiet; Tab still rings, and the ring is now rounded
  on the borderless fields instead of a sharp rectangle.

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
