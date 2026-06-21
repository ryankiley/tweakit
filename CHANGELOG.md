# Changelog

## 0.2.0 — 2026-06-20

### Added
- The spring control gains a **Time** mode alongside Physics. Physics keeps the
  stiffness / damping / mass fields; Time exposes a perceptual `visualDuration` + `bounce`
  pair (Motion's spring shorthand) mapped onto the same settle-curve preview
  (`stiffness = (2π/visualDuration)²`, `ζ = 1 − bounce`). A Time | Physics segment switches
  them, and each mode keeps its own edits across the toggle. Either mode resolves to a
  `{ stiffness, damping, mass }` value so every consumer works without a motion runtime;
  Time mode carries `visualDuration` / `bounce` alongside the resolved physics, and the mode
  is inferred back from those keys — so presets / persistence round-trip. Authored as
  `{ type: "spring", visualDuration, bounce }` (or an explicit `mode: "time" | "physics"`),
  including via `[data-tw]` markup.
- `panel.setMany({ key: v, "folder.child": w })` — a batch write that resolves each key
  like `set()` (dotted paths, no-op / reserved / bad-path guards) but fires listeners and
  persists **once** for the whole batch, where N separate `set()` calls would fire N times.
- `panel.toJSON()` / `panel.fromJSON(state)` — whole-panel state as a plain JSON-safe object:
  every control value **plus** UI state (which folders are collapsed, which tab is active),
  decoupled from the localStorage preset system. Persist it however you like — a file, a
  query-string share link, a server. `fromJSON` applies values where their path still exists
  (missing keys skipped, like a preset load) then restores the folder/tab state, firing
  listeners once. `JSON.stringify(panel)` goes through `toJSON` too, so the panel object is
  safely stringifiable. The `PanelState` type is exported.

### Changed
- Folders now carry a hairline above the group (using the border token), so each folder
  reads as a section under its own rule — clearer separation in panels that mix top-level
  controls with grouped sections. The leading group in a container skips the rule (it has
  the panel header's divider, or its parent folder's, above it already).

### Fixed
- A segmented control (the Off/On toggle, the spring's new mode switch) built inside a
  non-default tab page measured its active pill while the page was `display:none`, leaving
  the pill stranded at the left edge (0×0) until the next edit or resize. It now re-measures
  on the tab-reveal `tw-reflow` event, the same hook the canvas controls already used.

## 0.1.0 — 2026-06-13

First public release.

### Added (release polish)
- The gradient blends in the colour space of the mode picked in its stop editor, instead
  of always OKLCH: switch the editor to RGB and the ramp blends through sRGB (muddy — the
  honest preview of an `rgb()` blend), HSL spins the hue wheel, OKLCH stays perceptually
  even, and so on across all eleven modes. The chosen space is written into the value as
  `interpolation` (a CSS `<color-interpolation-method>` like `"srgb"` or `"display-p3"`),
  so templating `linear-gradient(in ${interpolation} …)` reproduces the editor's preview
  exactly. The value is now `{ stops, interpolation }`; the array shorthand and the legacy
  `{ stops }` form still load (they default to OKLCH).

### Changed (release polish)
- Colour control emits one consistent value: a single `serialize()` that's faithful to
  the active mode at display precision, with alpha appended in that mode's own syntax for
  both opaque and translucent colours. sRGB-bound modes (rgb / hsl / hwb) now chroma-reduce
  an out-of-gamut colour the same way hex does, so every mode agrees on the colour shown.
- New `--tw-on-accent` token (and `onAccent` theme key): the active segment / radio-grid
  label colour is auto-derived from the accent's luminance, so a bright accent keeps a
  legible label without the theme having to specify one.

### Fixed (release polish)
- Popovers re-carry the panel's scheme and theme if either changes while they are open
  (a mid-open dark/light flip or `setTheme()` no longer strands a mismatched surface).
- The hint ⓘ marker no longer nests a `<button>` inside a control's own button — inside
  one it is a non-interactive marker and the hint rides the host control's
  `aria-description`, so a screen reader announces it with the control.
- Multiline (textarea) rows align their label and field with the single-line rows.

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
- The reset arrow no longer spins twice per press. Its settle step renormalises
  the accumulated rotation to 0 behind a `transition: none` guard, but the guard
  was committed with `void svg.offsetWidth` — and SVG elements have no
  `offsetWidth`, so nothing flushed, the browser never saw the suppressed
  transition, and the −360° → 0 cleanup animated as a full visible unwind right
  after every spin. The flush is now `getBoundingClientRect()`, which works on
  SVG; a second click mid-spin still rolls into the next turn.

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
