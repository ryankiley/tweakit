// ── Gradient — a wide-gamut OKLCH gradient editor. Lazy; depends on the colour
// module (reuses its picker body, parseColor, and oklchStr).
import { el, btn, clamp, popover, registerControl, icon } from "../shared.js";
import { dragGesture, triggerRow } from "../heavy.js";
import { createPickerBody, parseColor, isColor, oklchStr, CHECKER } from "./colour.js";
import { modeInterpolation, interpolationMode } from "../../wide-gamut.js";
import { gradientCss, parseEasing, easingName, easingAt } from "../easing.js";
import type { Oklcha } from "./colour.js";
import type { OnChange } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control, GradientStop, GradientEasing } from "../types.js";

/** A stop handle on the rail, carrying the stop it moves. */
interface StopHandle extends HTMLButtonElement { _stop?: GradientStop }

// ICON_PLUS — adapted from Hugeicons `add-01` (MIT), two paths merged. See ../../../THIRD-PARTY-NOTICES.md.
const ICON_PLUS = icon('<path d="M12 5v14m7-7H5"/>', "", 2.5);

// ── Gradient — a Figma-style editor: the panel shows a swatch-trigger row (the
// gradient preview + stop count, mirroring the colour row), and clicking it opens a
// popover holding the stop bar over a reused colour picker body. The bar is a row of
// colour stops, each a full OKLCH colour; selecting one re-points the picker body at
// it — one editor surface, no nested popover. Drag a stop to move it, drag it clear of
// the bar (or double-click / Delete) to remove it (min 2), + to add one. The bar blends
// in the colour space of the mode picked in the editor — switch the stop editor to RGB
// and the ramp blends through sRGB (muddy, but honest); OKLCH gives a true wide-gamut
// ramp no sRGB picker makes. That chosen space rides along in the value as `interpolation`
// (a CSS `<color-interpolation-method>`) so a host's `linear-gradient(in … )` matches the
// editor exactly. The same goes for `easing` — linear (CSS's own straight blend) or a CSS
// easing sampled into stops, picked beside the mode; the bar and preview draw the eased
// ramp through the exported gradientCss(), so a host templating through it gets the same
// pixels. Value: { stops: [{ color, pos }], interpolation, easing }. ──
// Pull the blend space / easing out of a value: an explicit string on the object form,
// else null (the array shorthand and legacy `{ stops }` carry none → OKLCH / linear default).
// `value` is the host's gradient value — the object form, a stop array, or anything a
// restore hands over — inspected field by field, so the normalizers take it as `any`.
const field = (value: any, key: string): string | null => (value && !Array.isArray(value) && typeof value[key] === "string" ? value[key] : null);
const parseInterp = (value: any) => field(value, "interpolation");
const parseEase = (value: any) => field(value, "easing");
// The easing menu: CSS's keywords, labelled. A stored cubic-bezier() that isn't one of
// them shows as a "Custom" option that exists only while it's the value.
const EASINGS: Array<[GradientEasing, string]> = [["linear", "Linear"], ["ease", "Ease"], ["ease-in", "Ease in"], ["ease-out", "Ease out"], ["ease-in-out", "Ease in-out"]];
function normalizeStops(value: any): GradientStop[] {
  const DEF: GradientStop[] = [{ color: "oklch(0.72 0.19 25)", pos: 0 }, { color: "oklch(0.72 0.16 280)", pos: 1 }];
  const arr = Array.isArray(value) ? value : (value && Array.isArray(value.stops) ? value.stops : null);
  // Map each entry defensively — a [color, pos] tuple or a { color, pos } object — and
  // drop anything else (a null / garbage element would throw on `.color`); coerce a
  // non-finite pos to 0 and clamp into [0,1] (an out-of-range pos rendered its handle
  // outside the popover — the drag clamps, so input does too). A stop whose color isn't
  // a single color token is dropped the same way: stop text goes straight into the
  // preview's `linear-gradient(…)`, so an unparsed string there could splice in further
  // background layers (a `url()` — a network fetch from a preset or persisted state).
  // Fewer than two usable stops falls back to the default pair.
  const stop = (color: string, pos: unknown): GradientStop | null => (isColor(color) ? { color: String(color).trim(), pos: clamp(+pos || 0, 0, 1) } : null); // trimmed as the gate trims it: a non-ASCII space, which the CSS tokeniser reads as part of a name, must not ride into the gradient
  const out = (arr || []).map((s: any) => {
    if (Array.isArray(s)) return stop(s[0], s[1]);
    if (s && typeof s === "object") return stop(s.color, s.pos);
    return null;
  }).filter(Boolean);
  return out.length >= 2 ? out : DEF;
}
function createGradient(meta: Meta, onChange: OnChange): Control {
  let stops = normalizeStops(meta.value);
  let selStop = stops[0];
  let easing = easingName(parseEase(meta.value)); // anything unrecognised reads as linear, as the CSS helper treats it

  // ── Trigger row — a wide gradient preview that opens the editor (the shared
  // modal-trigger row the colour control uses). The strip is the readout; the stop
  // count rides along for the accessibility tree only. ──
  const { root, trigger, right } = triggerRow("tw-gradient", meta.label ?? "Gradient"); // ??: an explicit "" label renders none
  const preview = el("span", "tw-trigger-chip tw-gradient-preview"); preview.setAttribute("role", "img");
  right.append(preview);

  // ── Editor popover — the stop bar (+ add) over the reused picker body. Carries the
  // colour popover's class so it inherits its tokens, shell, and short-viewport scroll. ──
  const pop = el("div", "tw-color-pop tw-gradient-pop");
  const barRow = el("div", "tw-gradient-bar-row");
  const bar = el("div", "tw-gradient-bar");
  const grad = el("div", "tw-gradient-grad");
  const rail = el("div", "tw-gradient-rail");
  bar.append(grad, rail);
  const addBtn = btn("tw-gradient-add", ICON_PLUS); addBtn.title = "Add a stop after the selected one"; addBtn.setAttribute("aria-label", "Add a colour stop after the selected one");
  barRow.append(bar, addBtn);

  const sorted = () => [...stops].sort((a, b) => a.pos - b.pos);
  // The blend space tracks the editor's mode (the picked colour technology); body.mode()
  // is the single source of truth, so the bar, the trigger preview, and the emitted
  // `interpolation` can never drift apart. (Stops keep their own per-stop notation — CSS
  // lets a `linear-gradient(in srgb …)` carry `oklch()` stops, only the blend is sRGB.)
  const interp = () => modeInterpolation(body.mode());
  const value = () => ({ stops: sorted().map((s) => ({ color: s.color, pos: +s.pos.toFixed(4) })), interpolation: interp(), easing });
  // The bar and the trigger preview draw gradientCss(value()) — the exported helper, fed
  // the emitted value — so the editor can't show a ramp a host templating through it won't get.
  const paint = () => { const css = gradientCss(value()); grad.style.background = css; preview.style.background = `${css}, ${CHECKER}`; };
  const reflectCount = () => { preview.setAttribute("aria-label", `${stops.length} stop${stops.length === 1 ? "" : "s"}`); };
  const emit = () => onChange(value());

  const handleFor = (s: GradientStop) => [...(rail.children as HTMLCollectionOf<StopHandle>)].find((h) => h._stop === s); // the rail holds only stop handles
  // The picker body edits whichever stop is selected. It opens in the mode the stored
  // blend was authored in, and a mode switch repaints the bar + re-emits — unlike the
  // standalone colour control, where a mode switch is formatting-only: here the mode IS
  // the blend, so changing it is a real change to the gradient's output and its value.
  const body = createPickerBody({ value: selStop.color, mode: interpolationMode(parseInterp(meta.value) || "oklch"), onMode: () => { paint(); emit(); } }, (c) => { // oklch: the default the docs name, the space colorAt blends new stops in, and the one the default pair is authored in — it opened in OKLab, so a default gradient emitted `interpolation: "oklab"` and an inserted stop sat off its own ramp
    selStop.color = c;
    handleFor(selStop)?.style.setProperty("--stop", c);
    paint(); emit();
  });
  // Easing sits beside the mode in the body's mode row: both are "how the ramp blends",
  // one the space, the other the curve. Styled as the mode select; the picker's gamut tag
  // keeps the row's far end.
  const easeSel = el("select", "tw-color-mode tw-gradient-ease"); easeSel.setAttribute("aria-label", "Easing between stops"); easeSel.title = "How the ramp blends between stops";
  for (const [v, label] of EASINGS) { const o = document.createElement("option"); o.value = v; o.textContent = label; easeSel.append(o); }
  const reflectEase = () => {
    let custom = easeSel.querySelector<HTMLOptionElement>("option[data-custom]");
    if (EASINGS.some(([v]) => v === easing)) custom?.remove();
    else { if (!custom) { custom = document.createElement("option"); custom.dataset.custom = ""; custom.textContent = "Custom"; easeSel.append(custom); } custom.value = easing; }
    easeSel.value = easing;
  };
  easeSel.addEventListener("change", () => { easing = easeSel.value as GradientEasing; reflectEase(); paint(); emit(); }); // reflect: picking a keyword retires the Custom option
  body.el.querySelector(".tw-color-mode")!.after(easeSel); // after the mode select, before the gamut tag
  reflectEase();
  pop.append(barRow, body.el);
  root.append(pop);

  // A stop's accessible name carries its position and whether it's the selected one —
  // the state the ring shows sighted users. Refreshed on every select + move.
  const labelStop = (h: StopHandle) => h.setAttribute("aria-label", `Colour stop at ${Math.round(h._stop.pos * 100)}%${h._stop === selStop ? ", selected" : ""}`);
  const reflectSel = () => { for (const h of rail.children as HTMLCollectionOf<StopHandle>) { h.dataset.sel = String(h._stop === selStop); labelStop(h); } };
  const renderHandles = () => {
    rail.replaceChildren();
    for (const s of stops) {
      const h: StopHandle = btn("tw-gradient-stop"); h._stop = s;
      h.style.left = s.pos * 100 + "%"; h.style.setProperty("--stop", s.color);
      h.dataset.sel = String(s === selStop); labelStop(h);
      // Focus is selection: tabbing onto a stop points the picker at it and makes it the
      // one Delete removes — before, Tab reached a stop the editor wasn't editing.
      h.addEventListener("focus", () => select(s, false));
      let offBar = false;
      dragGesture(h, {
        // preventDefault suppresses click-to-focus on the button — focus explicitly so
        // keyboard can take over after a grab. The focus also blurs a dirty channel
        // field while the old stop is still selected, so its commit lands there.
        onDown: (e) => { e.preventDefault(); e.stopPropagation(); h.focus({ focusVisible: false }); select(s, false); offBar = false; }, // focus for keyboard + to commit a dirty channel field, but no keyboard ring on a mouse press; Tab still rings
        onMove: (e) => {
          // One rail rect for both the X position and the off-bar Y test, so the move
          // doesn't force a second layout read; the X math is posFromX inlined verbatim.
          const r = rail.getBoundingClientRect();
          s.pos = clamp((e.clientX - r.left) / (r.width || 1), 0, 1); h.style.left = s.pos * 100 + "%"; labelStop(h); paint(); emit();
          // Drag a stop clear of the bar (past ~24px above/below) to remove it — the
          // touch-friendly removal path; floored at two stops. The stop fades as a cue.
          offBar = stops.length > 2 && (e.clientY < r.top - 24 || e.clientY > r.bottom + 24);
          h.dataset.removing = String(offBar);
        },
        onEnd: () => { if (offBar) removeStop(s); else h.dataset.removing = "false"; },
      });
      h.addEventListener("dblclick", (e) => { e.preventDefault(); removeStop(s); });
      // Keyboard path for position: arrows nudge the focused stop by 0.01 (⇧ = 0.1),
      // clamped — the same paint + emit a drag move does. Delete stays on the popover.
      h.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0; if (!d) return;
        e.preventDefault();
        s.pos = clamp(s.pos + d * (e.shiftKey ? 0.1 : 0.01), 0, 1);
        h.style.left = s.pos * 100 + "%"; labelStop(h); paint(); emit();
      });
      rail.append(h);
    }
  };
  // During a drag we only flip the selected flag (no re-render), so the dragged
  // handle element stays live; full re-render happens on add / remove / external set.
  // body.set runs before selStop switches: re-pointing blurs a dirty channel field,
  // and its commit must land on the stop the user was editing, not the new one.
  const select = (s: GradientStop, rerender: boolean) => { if (s !== selStop) { body.set(s.color); selStop = s; } rerender ? renderHandles() : reflectSel(); };

  // Stop drag rides the shared dragGesture (pointer capture + automatic pointercancel
  // cleanup), wired per handle in renderHandles — so a touch-drag the browser interrupts
  // with a scroll can't leak a document listener or strand the drag. (.tw-gradient-stop is
  // touch-action:none, like every other drag surface, so it drags cleanly on touch.)
  const posFromX = (x: number) => { const r = rail.getBoundingClientRect(); return clamp((x - r.left) / (r.width || 1), 0, 1); };

  // Colour for a new stop: interpolate the two bracketing stops in OKLCH (short-way hue),
  // at the EASED progress for that position — so with easing on, the new stop still lands
  // invisibly on the ramp the bar is drawing, not on the straight blend underneath it.
  const colorAt = (pos: number) => {
    const ss = sorted(); let lo = ss[0], hi = ss[ss.length - 1];
    for (let k = 0; k < ss.length - 1; k++) if (pos >= ss[k].pos && pos <= ss[k + 1].pos) { lo = ss[k]; hi = ss[k + 1]; break; }
    const t = easingAt(parseEasing(easing), hi.pos > lo.pos ? clamp((pos - lo.pos) / (hi.pos - lo.pos), 0, 1) : 0); // clamped: a pos outside the outermost stops takes the nearest stop exactly, never extrapolates
    const a = parseColor(lo.color), b = parseColor(hi.color);
    // CSS missing-hue handling for `in oklch`: a ~zero-chroma stop carries no hue of
    // its own, so the other stop's hue holds across the segment (white→red stays red).
    const ach = (c: Oklcha) => c[1] < 1e-4;
    let dh = b[2] - a[2]; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
    if (ach(a) || ach(b)) dh = 0;
    const H = ((((ach(a) && !ach(b) ? b[2] : a[2]) + dh * t) % 360) + 360) % 360; // normalise to [0,360) so the picker reads it cleanly
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
  // Add a stop next to the SELECTED one, so where it lands is predictable: midway toward
  // the next stop on its right — or, when the selected stop is the last, midway toward the
  // one on its left. (Was the widest gap, which felt arbitrary — you couldn't tell where
  // the new stop would appear.) It samples the gradient there; drag it to taste. No
  // click-to-add on the bar: that fought with grabbing a stop to reposition it.
  // Insert a stop at `pos`, coloured by sampling the gradient exactly there — so it lands
  // invisibly on the existing ramp — and select it. Shared by the + button (a computed
  // midpoint) and double-click on the bar (the clicked position).
  const insertStopAt = (pos: number) => {
    const s = { color: colorAt(pos), pos: clamp(pos, 0, 1) };
    stops.push(s); paint(); select(s, true); reflectCount(); emit();
    return s;
  };
  const addStop = () => {
    const ss = sorted();
    let i = ss.indexOf(selStop); if (i < 0) i = 0;
    const at = i < ss.length - 1 ? (ss[i].pos + ss[i + 1].pos) / 2   // midway toward the next stop
             : i > 0             ? (ss[i - 1].pos + ss[i].pos) / 2   // selected is last → midway toward the previous
             : clamp(ss[i].pos + 0.1, 0, 1);                         // lone stop (floor is 2, so a safety net)
    insertStopAt(at);
  };
  addBtn.addEventListener("click", (e) => { e.stopPropagation(); addStop(); });
  // Double-click the bar to drop a new stop right at the pointer, taking the gradient's
  // exact tone there. Double-click (not single) so it never fights grabbing a stop to drag
  // it; a double-click on a stop falls through to that stop's own handler, which removes it.
  bar.addEventListener("dblclick", (e) => {
    if ((e.target as Element).closest(".tw-gradient-stop")) return;
    e.preventDefault();
    insertStopAt(posFromX(e.clientX));
  });

  // Delete / Backspace removes the selected stop (min 2). Ignored while typing in a field
  // (a channel input), and with Alt held (the panel's reset chord, so it never reads as
  // a stop removal). Lives on the popover, where the stop handles + picker now sit.
  pop.tabIndex = -1;
  pop.addEventListener("keydown", (e) => {
    if ((e.key === "Delete" || e.key === "Backspace") && !e.altKey && !/^(input|textarea|select)$/i.test((e.target as Element).tagName) && stops.length > 2) { e.preventDefault(); removeStop(selStop); }
  });

  // Open the editor under the trigger; reflow the picker body once it's at real size.
  // Focus lands on the selected stop (not the first in DOM order — focus is selection,
  // so that would re-point the picker on every open).
  popover(root, trigger, pop, { width: 260, fallbackH: 392, gap: 6, onOpen: body.reflow, onReflow: body.reflow, initialFocus: () => handleFor(selStop) });

  renderHandles(); paint(); reflectCount();
  return {
    el: root,
    set: (v: unknown) => {
      // Re-point the blend if the incoming value names one (mirror-backs from on() carry
      // the same interpolation we emitted, so this is usually a no-op); absent → leave the
      // mode as the user left it, never silently reset it to OKLCH on a stops-only set.
      const ip = parseInterp(v); if (ip) body.setMode(interpolationMode(ip));
      const es = parseEase(v); if (es !== null) { easing = easingName(es); reflectEase(); } // same rule as the blend: named → applied, absent → left as the user set it
      const next = normalizeStops(v).sort((a, b) => a.pos - b.pos);
      if (next.length === stops.length) {
        // Same count — the common case: a host mirroring values back via on(). Update
        // the existing stop objects + handles in place, paired in position order (the
        // emitted value is sorted), so a live drag keeps its handle element and the
        // picker stays pointed at the stop it was on, not reset to stops[0].
        sorted().forEach((s, i) => {
          s.color = next[i].color; s.pos = next[i].pos;
          const h = handleFor(s); if (h) { h.style.left = s.pos * 100 + "%"; h.style.setProperty("--stop", s.color); }
        });
      } else {
        const selPos = selStop.pos;
        stops = next;
        selStop = stops.reduce((b, s) => (Math.abs(s.pos - selPos) < Math.abs(b.pos - selPos) ? s : b), stops[0]); // re-select the nearest position, not index 0
        renderHandles();
      }
      paint(); reflectCount(); body.set(selStop.color);
    },
    get: () => value(),
  };
}

registerControl("gradient", createGradient);
