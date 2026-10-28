// ── Gradient — a wide-gamut OKLCH gradient editor. Lazy; depends on the color
// module (reuses its picker body, parseColor, and oklchStr).
import { el, btn, clamp, popover, registerControl, icon, words } from "../shared.js";
import { dragGesture, triggerRow, arrowStep } from "../heavy.js";
import { createPickerBody, parseColor, isColor, oklchStr, CHECKER } from "./color.js";
import { modeInterpolation, interpolationMode } from "../../wide-gamut.js";
import { gradientCss, parseEasing, easingSamples } from "../easing.js";
import type { Bez } from "../easing.js";
import type { Oklcha } from "./color.js";
import type { OnChange } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control, GradientStop, GradientEasing } from "../types.js";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
/** The name an easing is stored under: trimmed and lowercased when parseEasing knows it, else "linear". */
const easingName = (e: unknown): GradientEasing => (parseEasing(e) ? (e as string).trim().toLowerCase() as GradientEasing : "linear");

/** The blend progress at a position, linear between samples exactly as the browser draws the
 *  stops, so a stop inserted at x takes the color the ramp really shows. Null is the identity. */
function easingAt(b: Bez | null, x: number): number {
  x = clamp01(x); // outside the segment is its end; never extrapolate
  if (!b) return x;
  const s = easingSamples(b);
  for (let k = 1; k < s.length; k++) {
    if (x <= s[k][0]) { const [x0, y0] = s[k - 1], [x1, y1] = s[k]; return x1 > x0 ? y0 + (y1 - y0) * (x - x0) / (x1 - x0) : y1; }
  }
  return 1;
}

/** A stop handle on the rail, carrying the stop it moves. */
interface StopHandle extends HTMLButtonElement { _stop?: GradientStop }

// ICON_PLUS — adapted from Hugeicons `add-01` (MIT), two paths merged. See ../../../THIRD-PARTY-NOTICES.md.
const ICON_PLUS = icon('<path d="M12 5v14m7-7H5"/>', "", 2.5);

// ── Gradient — a Figma-style editor: a swatch-trigger row opens a popover holding the stop bar
// over a reused color picker body; selecting a stop re-points the body at it. The bar blends in
// the space of the editor's mode, which rides along as `interpolation`, and `easing` likewise, so a
// host's `linear-gradient(in …)` through gradientCss() gets the same pixels. ──
// A value's blend space / easing: an explicit string on the object form, else null (the array
// shorthand carries none). Inspected field by field, so the normalizers take `any`.
const field = (value: any, key: string): string | null => (value && !Array.isArray(value) && typeof value[key] === "string" ? value[key] : null);
const parseInterp = (value: any) => field(value, "interpolation");
const parseEase = (value: any) => field(value, "easing");
// The easing menu; a stored cubic-bezier() not among them shows as a "Custom" option while it's the value.
// value, strings key, word
const EASINGS: Array<[GradientEasing, string, string]> = [["linear", "easeLinear", "Linear"], ["ease", "ease", "Ease"], ["ease-in", "easeIn", "Ease in"], ["ease-out", "easeOut", "Ease out"], ["ease-in-out", "easeInOut", "Ease in-out"]];
function normalizeStops(value: any): GradientStop[] {
  const DEF: GradientStop[] = [{ color: "oklch(0.72 0.19 25)", pos: 0 }, { color: "oklch(0.72 0.16 280)", pos: 1 }];
  const arr = Array.isArray(value) ? value : (value && Array.isArray(value.stops) ? value.stops : null);
  // A stop's color must be a single color token: stop text goes straight into the preview's
  // `linear-gradient(…)`, where an unparsed string could splice in further layers (a url() fetch
  // from persisted state). A non-finite pos → 0, clamped into [0,1]; fewer than two usable stops → the default pair.
  // Trimmed as the gate trims it: the CSS tokenizer reads a non-ASCII space as part of a name.
  const stop = (color: string, pos: unknown): GradientStop | null => (isColor(color) ? { color: String(color).trim(), pos: clamp(+pos || 0, 0, 1) } : null);
  const out = (arr || []).map((s: any) => {
    if (Array.isArray(s)) return stop(s[0], s[1]);
    if (s && typeof s === "object") return stop(s.color, s.pos);
    return null;
  }).filter(Boolean);
  return out.length >= 2 ? out : DEF;
}
function createGradient(meta: Meta, onChange: OnChange): Control {
  const tr = words();
  meta.value ??= meta.stops; // the verbose form's `stops` aliases `value`
  // The blend and easing read off `value: {…}` first, else the verbose form's top level, where a pasted value's fields land.
  const interp0 = parseInterp(meta.value) ?? parseInterp(meta), ease0 = parseEase(meta.value) ?? parseEase(meta);
  let stops = normalizeStops(meta.value);
  let selStop = stops[0];
  let easing = easingName(ease0); // unrecognized reads as linear

  // ── Trigger row — the strip is the readout; the stop count rides along for the accessibility tree. ──
  // ??: an explicit "" label renders none
  const { root, trigger, right } = triggerRow("twk-gradient", meta.label ?? tr("gradient", "Gradient"));
  const preview = el("span", "twk-trigger-chip twk-gradient-preview"); preview.setAttribute("role", "img");
  right.append(preview);

  // ── Editor popover — carries the color popover's class so it inherits its tokens and shell. ──
  const pop = el("div", "twk-color-pop twk-gradient-pop");
  const barRow = el("div", "twk-gradient-bar-row");
  const bar = el("div", "twk-gradient-bar");
  const grad = el("div", "twk-gradient-grad");
  const rail = el("div", "twk-gradient-rail");
  bar.append(grad, rail);
  const addBtn = btn("twk-gradient-add", ICON_PLUS); addBtn.title = tr("addStop", "Add a stop after the selected one"); addBtn.setAttribute("aria-label", tr("addStopAria", "Add a color stop after the selected one"));
  barRow.append(bar, addBtn);

  const sorted = () => [...stops].sort((a, b) => a.pos - b.pos);
  // body.mode() is the single source of truth for the blend space, so the bar, preview and emitted
  // interpolation can't drift. (Stops keep their own notation; CSS lets `in srgb` carry oklch() stops.)
  const interp = () => modeInterpolation(body.mode());
  const value = () => ({ stops: sorted().map((s) => ({ color: s.color, pos: +s.pos.toFixed(4) })), interpolation: interp(), easing });
  // Both draw gradientCss(value()), so the editor can't show a ramp a host templating through it won't get.
  const paint = () => { const css = gradientCss(value()); grad.style.background = css; preview.style.background = `${css}, ${CHECKER}`; };
  const reflectCount = () => { preview.setAttribute("aria-label", tr("stops", (v) => `${v.n} stop${v.n === 1 ? "" : "s"}`, { n: stops.length })); };
  const emit = () => onChange(value());

  // the rail holds only stop handles
  const handleFor = (s: GradientStop) => [...(rail.children as HTMLCollectionOf<StopHandle>)].find((h) => h._stop === s);
  // Unlike the standalone color control, a mode switch here IS a change to the gradient's output, so it repaints and re-emits.
  // oklch: the documented default and colorAt's blend space
  const body = createPickerBody({ value: selStop.color, mode: interpolationMode(interp0 || "oklch"), onMode: () => { paint(); emit(); } }, (c) => {
    selStop.color = c;
    handleFor(selStop)?.style.setProperty("--stop", c);
    paint(); emit();
  });
  // Easing sits beside the mode: both are "how the ramp blends".
  const easeSel = el("select", "twk-color-mode twk-gradient-ease"); easeSel.setAttribute("aria-label", tr("stopEasing", "Easing between stops")); easeSel.title = tr("stopEasingHint", "How the ramp blends between stops");
  for (const [v, k, label] of EASINGS) { const o = document.createElement("option"); o.value = v; o.textContent = tr(k, label); easeSel.append(o); }
  const reflectEase = () => {
    let custom = easeSel.querySelector<HTMLOptionElement>("option[data-custom]");
    if (EASINGS.some(([v]) => v === easing)) custom?.remove();
    else { if (!custom) { custom = document.createElement("option"); custom.dataset.custom = ""; custom.textContent = tr("custom", "Custom"); easeSel.append(custom); } custom.value = easing; }
    easeSel.value = easing;
  };
  // reflect: picking a keyword retires the Custom option
  easeSel.addEventListener("change", () => { easing = easeSel.value as GradientEasing; reflectEase(); paint(); emit(); });
  body.el.querySelector(".twk-color-mode")!.after(easeSel); // after the mode select, before the gamut tag
  reflectEase();
  pop.append(barRow, body.el);
  root.append(pop);

  // A stop's accessible name carries its position and selection, the state the ring shows sighted users.
  const labelStop = (h: StopHandle) => h.setAttribute("aria-label", tr(h._stop === selStop ? "stopAtSelected" : "stopAt", h._stop === selStop ? "Color stop at {pos}%, selected" : "Color stop at {pos}%", { pos: Math.round(h._stop.pos * 100) }));
  const reflectSel = () => { for (const h of rail.children as HTMLCollectionOf<StopHandle>) { h.dataset.sel = String(h._stop === selStop); labelStop(h); } };
  // A drag or an arrow moving a stop: its spot on the rail, its name, the ramp and the value follow.
  const moveStop = (h: StopHandle, pos: number) => { h._stop.pos = clamp(pos, 0, 1); h.style.left = h._stop.pos * 100 + "%"; labelStop(h); paint(); emit(); };
  const renderHandles = () => {
    rail.replaceChildren();
    for (const s of stops) {
      const h: StopHandle = btn("twk-gradient-stop"); h._stop = s;
      h.style.left = s.pos * 100 + "%"; h.style.setProperty("--stop", s.color);
      h.dataset.sel = String(s === selStop); labelStop(h);
      // Focus is selection: tabbing onto a stop points the picker at it.
      h.addEventListener("focus", () => select(s, false));
      let offBar = false;
      dragGesture(h, {
        // preventDefault suppresses click-to-focus, so focus explicitly (ringless); that also blurs
        // a dirty channel field while the old stop is still selected, so its commit lands there.
        onDown: (e) => { e.preventDefault(); e.stopPropagation(); h.focus({ focusVisible: false }); select(s, false); offBar = false; },
        onMove: (e) => {
          // One rail rect for X and the off-bar Y test; the X math is posFromX inlined.
          const r = rail.getBoundingClientRect();
          moveStop(h, (e.clientX - r.left) / (r.width || 1));
          // Dragging ~24px clear of the bar removes the stop (floored at two).
          offBar = stops.length > 2 && (e.clientY < r.top - 24 || e.clientY > r.bottom + 24);
          h.dataset.removing = String(offBar);
        },
        onEnd: () => { if (offBar) removeStop(s); else h.dataset.removing = "false"; },
      });
      h.addEventListener("dblclick", (e) => { e.preventDefault(); removeStop(s); });
      // Arrows nudge by 0.01 (⇧ = 0.1); Delete stays on the popover.
      h.addEventListener("keydown", (e) => {
        const [d] = arrowStep(e); if (!d) return;
        e.preventDefault(); moveStop(h, s.pos + d * (e.shiftKey ? 0.1 : 0.01));
      });
      rail.append(h);
    }
  };
  // A drag only flips the selected flag, so the dragged handle stays live. body.set runs before
  // selStop switches: re-pointing blurs a dirty channel field, whose commit must land on the old stop.
  const select = (s: GradientStop, rerender: boolean) => { if (s !== selStop) { body.set(s.color); selStop = s; } rerender ? renderHandles() : reflectSel(); };

  const posFromX = (x: number) => { const r = rail.getBoundingClientRect(); return clamp((x - r.left) / (r.width || 1), 0, 1); };

  // A new stop's color: the bracketing stops interpolated in OKLCH at the EASED progress, so it lands invisibly on the ramp the bar draws.
  const colorAt = (pos: number) => {
    const ss = sorted(); let lo = ss[0], hi = ss[ss.length - 1];
    for (let k = 0; k < ss.length - 1; k++) if (pos >= ss[k].pos && pos <= ss[k + 1].pos) { lo = ss[k]; hi = ss[k + 1]; break; }
    // a pos outside the outermost stops never extrapolates
    const t = easingAt(parseEasing(easing), hi.pos > lo.pos ? clamp((pos - lo.pos) / (hi.pos - lo.pos), 0, 1) : 0);
    const a = parseColor(lo.color), b = parseColor(hi.color);
    // CSS missing-hue: a ~zero-chroma stop carries no hue, so the other's holds (white→red stays red).
    const ach = (c: Oklcha) => c[1] < 1e-4;
    let dh = b[2] - a[2]; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
    if (ach(a) || ach(b)) dh = 0;
    // normalize to [0,360) so the picker reads it cleanly
    const H = ((((ach(a) && !ach(b) ? b[2] : a[2]) + dh * t) % 360) + 360) % 360;
    return oklchStr(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, H, a[3] + (b[3] - a[3]) * t);
  };
  const removeStop = (s: GradientStop) => {
    if (stops.length <= 2) return;
    const i = stops.indexOf(s); if (i < 0) return; // a stale reference (rebuilt via set) must not splice(-1)
    stops.splice(i, 1);
    const next = selStop === s ? stops[Math.max(0, i - 1)] : selStop;
    paint(); select(next, true); reflectCount(); emit();
    handleFor(selStop)?.focus(); // keep focus on a handle so Delete can chain
  };
  // Insert a stop at `pos`, colored by sampling the gradient there, and select it. Shared by the +
  // button (midway toward the selected stop's neighbor, so where it lands is predictable) and double-click on the bar.
  const insertStopAt = (pos: number) => {
    const s = { color: colorAt(pos), pos: clamp(pos, 0, 1) };
    stops.push(s); paint(); select(s, true); reflectCount(); emit();
  };
  // Midway toward the next stop, or toward the previous from the last. There are always two stops at least (the
  // normalizer's default pair, removeStop's floor), and the selected one is always among them.
  const addStop = () => {
    const ss = sorted(), i = ss.indexOf(selStop);
    insertStopAt(i < ss.length - 1 ? (ss[i].pos + ss[i + 1].pos) / 2 : (ss[i - 1].pos + ss[i].pos) / 2);
  };
  addBtn.addEventListener("click", (e) => { e.stopPropagation(); addStop(); });
  // Double-click, not single, so it never fights grabbing a stop; a double-click on a stop falls through to its own handler.
  bar.addEventListener("dblclick", (e) => {
    if ((e.target as Element).closest(".twk-gradient-stop")) return;
    e.preventDefault();
    insertStopAt(posFromX(e.clientX));
  });

  // Delete / Backspace removes the selected stop, ignored while typing in a field and with Alt held (the panel's reset chord).
  pop.tabIndex = -1;
  pop.addEventListener("keydown", (e) => {
    if ((e.key === "Delete" || e.key === "Backspace") && !e.altKey && !/^(input|textarea|select)$/i.test((e.target as Element).tagName) && stops.length > 2) { e.preventDefault(); removeStop(selStop); }
  });

  // Focus lands on the selected stop, not the first: focus is selection, so that would re-point the picker on every open.
  popover(root, trigger, pop, { fallbackH: 392, onOpen: body.reflow, onReflow: body.reflow, initialFocus: () => handleFor(selStop) });

  renderHandles(); paint(); reflectCount();
  return {
    el: root,
    set: (v: unknown) => {
      // Named → applied; absent → left as the user set it, never reset to OKLCH on a stops-only set.
      const ip = parseInterp(v); if (ip) body.setMode(interpolationMode(ip));
      const es = parseEase(v); if (es !== null) { easing = easingName(es); reflectEase(); } // same rule as the blend
      const next = normalizeStops(v).sort((a, b) => a.pos - b.pos);
      if (next.length === stops.length) {
        // Same count (a host mirroring values back): update the stop objects in place, paired in
        // position order, so a live drag keeps its handle and the picker its stop.
        sorted().forEach((s, i) => {
          s.color = next[i].color; s.pos = next[i].pos;
          const h = handleFor(s); if (h) { h.style.left = s.pos * 100 + "%"; h.style.setProperty("--stop", s.color); }
        });
      } else {
        const selPos = selStop.pos;
        stops = next;
        // re-select the nearest position, not index 0
        selStop = stops.reduce((b, s) => (Math.abs(s.pos - selPos) < Math.abs(b.pos - selPos) ? s : b), stops[0]);
        renderHandles();
      }
      paint(); reflectCount(); body.set(selStop.color);
    },
    get: () => value(),
  };
}

registerControl("gradient", createGradient);

// For test/gradient-css.test.mjs, which checks them beside the easing parser.
export { easingName, easingAt };
