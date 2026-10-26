/* Inline SVG icons for the kit's core chrome (toolbar, folder chevron, select, hint marker),
 * kept in one module so the license notice below covers them all. */
// ── Icons for the toolbar ──
// Adapted from Hugeicons' free set (MIT; per-icon origins in ../../THIRD-PARTY-NOTICES.md), path
// data compacted. The icon color is translucent, so strokes that cross double-composite into a
// bright hotspot: each icon is one path. Copy and presets keep separate parts so the hover can
// move them (tweaks.css), drawn to abut rather than overlap.
import { icon } from "./shared.js";
const ICON_COPY = icon('<path class="tw-copy-back" d="m5.5 16.5-.7-.2q-1.5-.6-2.1-2.1-.2-.7-.2-2.7v-2c0-3.3 0-5 1-6s2.7-1 6-1h2c1.4 0 2 0 2.7.2q1.6.5 2.1 2.1l.2.7"/><path class="tw-copy-front" d="M7.5 14.5c0-3.3 0-5 1-6s2.7-1 6-1 5 0 6 1 1 2.7 1 6 0 5-1 6-2.7 1-6 1-5 0-6-1-1-2.7-1-6"/>', "tw-toolbar-btn__copy");
const ICON_CHECK = icon('<path d="m5 14 3.5 3.5L19 6.5"/>', "tw-toolbar-btn__check", 2.4);
// Reset is Hugeicons' undo, a near-full circle, so the spin on click reads as a turn about the center.
const ICON_RESET = icon('<path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-7.6 4.2M3.3 3l.2 2q0 2.2.6 2.7t2.7.2l2-.2"/>');
const chevronIcon = (cls: string) => icon('<path d="M18 9s-4.4 6-6 6-6-6-6-6"/>', cls, 2.5);
const ICON_CHEVRON = chevronIcon("tw-chevron");
const ICON_PRESETS = icon('<path d="M20.2 13.5q1.8.8 1.8 1.5 0 .8-2.7 2l-5 2.2Q13 20 12 20q-.7 0-2.4-.8l-4.9-2.3Q2 16 2 15t1.8-1.5"/><path class="tw-layer-top" d="M9.6 4.8Q11.3 4 12 4t2.4.8l4.9 2.3Q22 8 22 9c0 .7-.9 1.1-2.7 2l-5 2.2Q13 14 12 14q-.7 0-2.4-.8l-4.9-2.3Q2 10 2 9c0-.7.9-1.1 2.7-2z"/>');
const ICON_X = icon('<path d="M18 6 6 18m12 0L6 6"/>', "", 2.2);
const ICON_INFO = icon('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4m-.25-3.75a.25.25 0 0 0 .5 0 .25.25 0 0 0-.5 0"/>');

export { ICON_COPY, ICON_CHECK, ICON_RESET, ICON_CHEVRON, ICON_PRESETS, ICON_X, ICON_INFO, chevronIcon };
