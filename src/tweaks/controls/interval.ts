// ── Interval / range slider — dual-handle [lo,hi]. Lazy.
import { el, txt, clamp, roundToStep, stepPrecision, gridEnds, normalizeRange, rangeStep, defaultRange, overlapsText, wireHoverClass, onReady, onLive, registerControl, rubberBand, rubberRelease } from "../shared.js";
import { dragGesture } from "../heavy.js";
import type { OnChange } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control } from "../types.js";

function createInterval(meta: Meta, onChange: OnChange): Control {
  const label = meta.label;
  // normalizeRange, the slider's guard: non-finite bounds fall back and an inverted pair swaps, so data-min="abc" can't ride in as NaN.
  const t0 = +(meta.value && meta.value[0]), t1 = +(meta.value && meta.value[1]);
  const lo0 = Number.isFinite(t0) ? t0 : 0, hi0 = Number.isFinite(t1) ? t1 : 1;
  // An absent bound derives from the values, each end widening it: [20, 80] spans 0–240, not 20–80 (which pinned both handles).
  const [a, b] = [defaultRange(lo0), defaultRange(hi0)];
  const given = (n: unknown) => n != null && n !== "" && Number.isFinite(+n!);
  let { min, max, step } = normalizeRange(given(meta.min) ? meta.min : Math.min(a[0], b[0]), given(meta.max) ? meta.max : Math.max(a[1], b[1]), meta.step, lo0, hi0);
  [min, max] = gridEnds(min, max, step); // the slider's rule: no value past an off-grid bound
  const decimals = stepPrecision(step);
  const q = (v: number) => roundToStep(v, min, step);
  // Missing tuple entries fall back to the bounds, as .set does: value:[5] gives [5, max], not [5, NaN].
  let lo = clamp(q(Number.isFinite(t0) ? t0 : min), min, max), hi = clamp(q(Number.isFinite(t1) ? t1 : max), min, max);
  if (lo > hi) { const t = lo; lo = hi; hi = t; }

  const wrap = el("div", "tw-slider-wrap");
  const track = el("div", "tw-slider tw-interval");
  const fill = el("div", "tw-slider-fill");
  const hLo = el("div", "tw-slider-handle"), hHi = el("div", "tw-slider-handle");
  const labelEl = txt("span", "tw-slider-label", label);
  const valueEl = el("span", "tw-slider-value");
  track.append(fill, hLo, hHi, labelEl, valueEl);
  wrap.append(track);

  ([["minimum", hLo], ["maximum", hHi]] as const).forEach(([lab, h]) => {
    h.tabIndex = 0; h.setAttribute("role", "slider"); h.setAttribute("aria-label", `${label} ${lab}`);
    h.setAttribute("aria-valuemin", String(min)); h.setAttribute("aria-valuemax", String(max));
  });

  const pctOf = (v: number) => ((v - min) / ((max - min) || 1)) * 100;
  const handleLeft = (pct: number) => `clamp(5px, calc(${pct}% - 1.5px), calc(100% - 9px))`; // stay inset at the extremes, like the slider handle
  const render = () => {
    const a = pctOf(lo), b = pctOf(hi);
    fill.style.left = a + "%"; fill.style.width = Math.max(0, b - a) + "%";
    hLo.style.left = handleLeft(a); hHi.style.left = handleLeft(b);
    valueEl.textContent = `${lo.toFixed(decimals)} – ${hi.toFixed(decimals)}`;
    hLo.setAttribute("aria-valuenow", String(lo)); hHi.setAttribute("aria-valuenow", String(hi));
    // Value-dodge (overlapsText), per handle: one sliding under the label or the readout yields so the text stays legible.
    const trackW = wrap.offsetWidth;
    if (trackW) {
      // The label's room is what the dual readout leaves, measured: 12px label inset + 8px gap + the readout's right inset.
      labelEl.style.maxWidth = Math.max(0, trackW - valueEl.offsetWidth - 12 - 8 - 10) + "px";
      const dodges = (pct: number) => overlapsText(labelEl, valueEl, (pct / 100) * trackW - 1.5, 3);
      hLo.classList.toggle("is-dodge", dodges(pctOf(lo)));
      hHi.classList.toggle("is-dodge", dodges(pctOf(hi)));
    }
  };
  render();

  const emit = () => onChange([lo, hi]);
  const setLo = (v: number) => { lo = clamp(Math.min(q(v), hi), min, max); render(); };
  const setHi = (v: number) => { hi = clamp(Math.max(q(v), lo), min, max); render(); };

  let rect: DOMRect | null = null, scale = 1, active: "lo" | "hi" | null = null;
  // Divide out any ancestor CSS transform (rect is visual px, offsetWidth layout px), as the single slider does.
  const valFromX = (x: number) => { const native = wrap.offsetWidth || rect.width; const p = clamp((x - rect.left) / scale / native, 0, 1); return clamp(min + p * (max - min), min, max); };
  const grab = (x: number) => {
    const v = valFromX(x);
    if (!active) active = v < lo ? "lo" : v > hi ? "hi" : (Math.abs(v - lo) <= Math.abs(v - hi) ? "lo" : "hi");
    active === "lo" ? setLo(v) : setHi(v); emit();
  };
  dragGesture(track, {
    onDown: (e) => {
      e.preventDefault();
      rect = wrap.getBoundingClientRect(); scale = rect.width / (wrap.offsetWidth || rect.width);
      track.style.transition = ""; // a re-press mid spring-home stretches 1:1
      track.classList.add("is-active", "is-dragging"); active = null;
      grab(e.clientX);
      (active === "lo" ? hLo : hHi).focus({ focusVisible: false }); // preventDefault killed click-to-focus; focus without a ring
    },
    onMove: (e) => { grab(e.clientX); rubberBand(track, rect, e.clientX); },
    onEnd: () => { rubberRelease(track); rect = null; active = null; track.classList.remove("is-active", "is-dragging"); },
  });
  wireHoverClass(track, render); // re-run the dodge with the real track width on hover
  // Recompute once layout and fonts settle (a web-font swap shifts the widths the dodge measures) and on track-width change.
  onReady(render);
  onLive(track, [[window, "resize"], [window, "tw-reflow"]], render); // tw-reflow: a tab page revealing this re-measures it

  // Home/End snap a handle to its neighbour-or-limit, so the two can't cross.
  const onKey = (which: "lo" | "hi") => (e: KeyboardEvent) => {
    const nv = which === "lo" ? rangeStep(e, lo, step, min, hi) : rangeStep(e, hi, step, lo, max);
    if (nv == null) return;
    e.preventDefault(); which === "lo" ? setLo(nv) : setHi(nv); emit();
  };
  hLo.addEventListener("keydown", onKey("lo")); hHi.addEventListener("keydown", onKey("hi"));

  return {
    el: wrap,
    set: (v: unknown) => { if (Array.isArray(v)) { const a = +v[0], b = +v[1]; if (!Number.isFinite(a) || !Number.isFinite(b)) return; lo = clamp(q(Math.min(a, b)), min, max); hi = clamp(q(Math.max(a, b)), min, max); render(); } },
    get: () => [lo, hi],
  };
}

registerControl("interval", createInterval);

