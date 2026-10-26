// ── Gradient — a wide-gamut OKLCH gradient editor. Lazy; depends on the color
// module (reuses its picker body, parseColor, and oklchStr).
import { el, btn, clamp, popover, registerControl, icon } from "../shared.js";
import { dragGesture, triggerRow } from "../heavy.js";
import { createPickerBody, parseColor, isColor, oklchStr, CHECKER } from "./color.js";
import { modeInterpolation, interpolationMode } from "../../wide-gamut.js";
import { gradientCss, parseEasing, easingName, easingAt } from "../easing.js";
import type { Oklcha } from "./color.js";
import type { OnChange } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control, GradientStop, GradientEasing } from "../types.js";

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
const EASINGS: Array<[GradientEasing, string]> = [["linear", "Linear"], ["ease", "Ease"], ["ease-in", "Ease in"], ["ease-out", "Ease out"], ["ease-in-out", "Ease in-out"]];
function normalizeStops(value: any): GradientStop[] {
  const DEF: GradientStop[] = [{ color: "oklch(0.72 0.19 25)", pos: 0 }, { color: "oklch(0.72 0.16 280)", pos: 1 }];
  const arr = Array.isArray(value) ? value : (value && Array.isArray(value.stops) ? value.stops : null);
  // A stop's color must be a single color token: stop text goes straight into the preview's
  // `linear-gradient(…)`, where an unparsed string could splice in further layers (a url() fetch
  // from persisted state). A non-finite pos → 0, clamped into [0,1]; fewer than two usable stops → the default pair.
  // Trimmed as the gate trims it: the CSS tokeniser reads a non-ASCII space as part of a name.
  const stop = (color: string, pos: unknown): GradientStop | null => (isColor(color) ? { color: String(color).trim(), pos: clamp(+pos || 0, 0, 1) } : null);
  const out = (arr || []).map((s: any) => {
    if (Array.isArray(s)) return stop(s[0], s[1]);
    if (s && typeof s === "object") return stop(s.color, s.pos);
    return null;
  }).filter(Boolean);
  return out.length >= 2 ? out : DEF;
}
function createGradient(meta: Meta, onChange: OnChange): Control {
  meta.value ??= meta.stops; // the verbose form's `stops` aliases `value`
  let stops = normalizeStops(meta.value);
  let selStop = stops[0];
  let easing = easingName(parseEase(meta.value)); // unrecognised reads as linear

  // ── Trigger row — the strip is the readout; the stop count rides along for the accessibility tree. ──
  const { root, trigger, right } = triggerRow("tw-gradient", meta.label ?? "Gradient"); // ??: an explicit "" label renders none
  const preview = el("span", "tw-trigger-chip tw-gradient-preview"); preview.setAttribute("role", "img");
  right.append(preview);

  // ── Editor popover — carries the color popover's class so it inherits its tokens and shell. ──
  const pop = el("div", "tw-color-pop tw-gradient-pop");
  const barRow = el("div", "tw-gradient-bar-row");
  const bar = el("div", "tw-gradient-bar");
  const grad = el("div", "tw-gradient-grad");
  const rail = el("div", "tw-gradient-rail");
  bar.append(grad, rail);
  const addBtn = btn("tw-gradient-add", ICON_PLUS); addBtn.title = "Add a stop after the selected one"; addBtn.setAttribute("aria-label", "Add a color stop after the selected one");
  barRow.append(bar, addBtn);

  const sorted = () => [...stops].sort((a, b) => a.pos - b.pos);
  // body.mode() is the single source of truth for the blend space, so the bar, preview and emitted
  // interpolation can't drift. (Stops keep their own notation; CSS lets `in srgb` carry oklch() stops.)
  const interp = () => modeInterpolation(body.mode());
  const value = () => ({ stops: sorted().map((s) => ({ color: s.color, pos: +s.pos.toFixed(4) })), interpolation: interp(), easing });
  // Both draw gradientCss(value()), so the editor can't show a ramp a host templating through it won't get.
  const paint = () => { const css = gradientCss(value()); grad.style.background = css; preview.style.background = `${css}, ${CHECKER}`; };
  const reflectCount = () => { preview.setAttribute("aria-label", `${stops.length} stop${stops.length === 1 ? "" : "s"}`); };
  const emit = () => onChange(value());

  const handleFor = (s: GradientStop) => [...(rail.children as HTMLCollectionOf<StopHandle>)].find((h) => h._stop === s); // the rail holds only stop handles
  // Unlike the standalone color control, a mode switch here IS a change to the gradient's output, so it repaints and re-emits.
  const body = createPickerBody({ value: selStop.color, mode: interpolationMode(parseInterp(meta.value) || "oklch"), onMode: () => { paint(); emit(); } }, (c) => { // oklch: the documented default and colorAt's blend space
    selStop.color = c;
    handleFor(selStop)?.style.setProperty("--stop", c);
    paint(); emit();
  });
  // Easing sits beside the mode: both are "how the ramp blends".
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

  // A stop's accessible name carries its position and selection, the state the ring shows sighted users.
  const labelStop = (h: StopHandle) => h.setAttribute("aria-label", `Color stop at ${Math.round(h._stop.pos * 100)}%${h._stop === selStop ? ", selected" : ""}`);
  const reflectSel = () => { for (const h of rail.children as HTMLCollectionOf<StopHandle>) { h.dataset.sel = String(h._stop === selStop); labelStop(h); } };
  const renderHandles = () => {
    rail.replaceChildren();
    for (const s of stops) {
      const h: StopHandle = btn("tw-gradient-stop"); h._stop = s;
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
          s.pos = clamp((e.clientX - r.left) / (r.width || 1), 0, 1); h.style.left = s.pos * 100 + "%"; labelStop(h); paint(); emit();
          // Dragging ~24px clear of the bar removes the stop (floored at two).
          offBar = stops.length > 2 && (e.clientY < r.top - 24 || e.clientY > r.bottom + 24);
          h.dataset.removing = String(offBar);
        },
        onEnd: () => { if (offBar) removeStop(s); else h.dataset.removing = "false"; },
      });
      h.addEventListener("dblclick", (e) => { e.preventDefault(); removeStop(s); });
      // Arrows nudge by 0.01 (⇧ = 0.1); Delete stays on the popover.
      h.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0; if (!d) return;
        e.preventDefault();
        s.pos = clamp(s.pos + d * (e.shiftKey ? 0.1 : 0.01), 0, 1);
        h.style.left = s.pos * 100 + "%"; labelStop(h); paint(); emit();
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
    const t = easingAt(parseEasing(easing), hi.pos > lo.pos ? clamp((pos - lo.pos) / (hi.pos - lo.pos), 0, 1) : 0); // a pos outside the outermost stops never extrapolates
    const a = parseColor(lo.color), b = parseColor(hi.color);
    // CSS missing-hue: a ~zero-chroma stop carries no hue, so the other's holds (white→red stays red).
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
  // Insert a stop at `pos`, colored by sampling the gradient there, and select it. Shared by the +
  // button (midway toward the selected stop's neighbour, so where it lands is predictable) and double-click on the bar.
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
  // Double-click, not single, so it never fights grabbing a stop; a double-click on a stop falls through to its own handler.
  bar.addEventListener("dblclick", (e) => {
    if ((e.target as Element).closest(".tw-gradient-stop")) return;
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
        selStop = stops.reduce((b, s) => (Math.abs(s.pos - selPos) < Math.abs(b.pos - selPos) ? s : b), stops[0]); // re-select the nearest position, not index 0
        renderHandles();
      }
      paint(); reflectCount(); body.set(selStop.color);
    },
    get: () => value(),
  };
}

registerControl("gradient", createGradient);
