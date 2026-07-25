/* Inline SVG icons for the kit's core chrome (toolbar, folder chevron, select,
 * hint marker). Kept in one module so the licence notice below covers them all
 * and so chrome modules don't re-declare markup. */
// ── Icons for the toolbar ──
// Inline SVGs adapted from Lucide (https://lucide.dev, ISC) and, upstream, Feather
// (https://feathericons.com, MIT). A few are lightly modified — two paths merged into
// one, a radius nudged, a polygon redrawn as a path. ICON_GRIP (shared.ts) is original.
// Per-icon origins and the full ISC + MIT notices: ../../THIRD-PARTY-NOTICES.md.
const ICON_COPY = `<svg class="tw-toolbar-btn__copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const ICON_CHECK = `<svg class="tw-toolbar-btn__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
// Reset uses Lucide's full rotate-ccw geometry (the 9.75-radius blend into the head —
// an earlier straight-chord simplification flattened the circle's upper-left, reading
// as off-centre), merged into ONE path: the kit's icon colour is translucent, and
// separate paths double-composite where they cross (a bright hotspot at the arrowhead),
// while a single path's stroke paints as one union — uniform alpha throughout.
const ICON_RESET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5"/></svg>`;
const ICON_SEARCH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`;
const ICON_CHEVRON = `<svg class="tw-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
const ICON_PRESETS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>`;
const ICON_X = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
const ICON_INFO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`;

export { ICON_COPY, ICON_CHECK, ICON_RESET, ICON_SEARCH, ICON_CHEVRON, ICON_PRESETS, ICON_X, ICON_INFO };
