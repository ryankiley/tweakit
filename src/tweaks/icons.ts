/* Inline SVG icons for the kit's core chrome (toolbar, folder chevron, select,
 * hint marker). Kept in one module so the licence notice below covers them all
 * and so chrome modules don't re-declare markup. */
// ── Icons for the toolbar ──
// Inline SVGs adapted from Hugeicons' free set (https://hugeicons.com, MIT), stroke-rounded
// style. Path data is rounded to two decimals, and an icon's paths are merged into ONE
// path: the kit's icon colour is translucent, and separate paths double-composite where
// they cross (a bright hotspot where they meet), while a single path's stroke paints as
// one union — uniform alpha throughout. Stroke widths are the kit's, not Hugeicons' 1.5.
// ICON_GRIP (shared.ts) is original. Per-icon origins and the MIT notice:
// ../../THIRD-PARTY-NOTICES.md.
import { icon } from "./shared.js";
const ICON_COPY = icon('<path d="M7.5 14.5C7.5 11.2 7.5 9.55 8.53 8.53C9.55 7.5 11.2 7.5 14.5 7.5C17.8 7.5 19.45 7.5 20.47 8.53C21.5 9.55 21.5 11.2 21.5 14.5C21.5 17.8 21.5 19.45 20.47 20.47C19.45 21.5 17.8 21.5 14.5 21.5C11.2 21.5 9.55 21.5 8.53 20.47C7.5 19.45 7.5 17.8 7.5 14.5ZM7.5 16.5C6.1 16.5 5.41 16.5 4.84 16.3C3.84 15.95 3.05 15.16 2.7 14.16C2.5 13.59 2.5 12.9 2.5 11.5V9.5C2.5 6.2 2.5 4.55 3.53 3.53C4.55 2.5 6.2 2.5 9.5 2.5H11.5C12.9 2.5 13.59 2.5 14.16 2.7C15.16 3.05 15.95 3.84 16.3 4.84C16.5 5.41 16.5 6.1 16.5 7.5"/>', "tw-toolbar-btn__copy");
const ICON_CHECK = icon('<path d="M5 14L8.5 17.5L19 6.5"/>', "tw-toolbar-btn__check", 2.4);
// Reset is Hugeicons' undo: a near-full circle with the arrowhead at its upper left,
// so the spin on click reads as a turn about the centre.
const ICON_RESET = icon('<path d="M3 12C3 16.97 7.03 21 12 21C16.97 21 21 16.97 21 12C21 7.03 16.97 3 12 3C8.79 3 5.98 4.68 4.38 7.2M3.29 3L3.47 5.05C3.59 6.53 3.65 7.27 4.13 7.69C4.62 8.1 5.33 8.03 6.75 7.89L8.79 7.68"/>');
const ICON_SEARCH = icon('<path d="M17 17L21 21M19 11C19 6.58 15.42 3 11 3C6.58 3 3 6.58 3 11C3 15.42 6.58 19 11 19C15.42 19 19 15.42 19 11Z"/>');
// One chevron shape, parameterised by class — the folder header (tw-chevron) and the
// select trigger (tw-select-chevron) carry the identical glyph under different hooks.
const chevronIcon = (cls: string) => icon('<path d="M18 9C18 9 13.58 15 12 15C10.42 15 6 9 6 9"/>', cls, 2.5);
const ICON_CHEVRON = chevronIcon("tw-chevron");
const ICON_PRESETS = icon('<path d="M9.61 4.81C10.79 4.27 11.38 4 12 4C12.62 4 13.21 4.27 14.39 4.81L19.29 7.06C21.1 7.89 22 8.31 22 9C22 9.69 21.1 10.11 19.29 10.94L14.39 13.19C13.21 13.73 12.62 14 12 14C11.38 14 10.79 13.73 9.61 13.19L4.71 10.94C2.9 10.11 2 9.69 2 9C2 8.31 2.9 7.89 4.71 7.06L9.61 4.81ZM20.23 13.5C21.41 14.06 22 14.44 22 15C22 15.69 21.1 16.11 19.29 16.94L14.39 19.19C13.21 19.73 12.62 20 12 20C11.38 20 10.79 19.73 9.61 19.19L4.71 16.94C2.9 16.11 2 15.69 2 15C2 14.44 2.59 14.06 3.77 13.5"/>');
const ICON_X = icon('<path d="M18 6L6 18M18 18L6 6"/>', "", 2.2);
const ICON_INFO = icon('<circle cx="12" cy="12" r="10"/><path d="M12 16V12M12.13 8.25H12M12.25 8.25C12.25 8.11 12.14 8 12 8C11.86 8 11.75 8.11 11.75 8.25C11.75 8.39 11.86 8.5 12 8.5C12.14 8.5 12.25 8.39 12.25 8.25Z"/>');

export { ICON_COPY, ICON_CHECK, ICON_RESET, ICON_SEARCH, ICON_CHEVRON, ICON_PRESETS, ICON_X, ICON_INFO, chevronIcon };
