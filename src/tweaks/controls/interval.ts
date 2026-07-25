// ── Interval / range slider — dual-handle [lo,hi]. Lazy.
import { el, txt, clamp, roundToStep, stepPrecision, normalizeRange, rangeStep, overlapsText, dragGesture, wireHoverClass, onReady, onLive, registerControl } from "../shared.js";

// ── Interval / range slider — a dual-handle slider bound to [lo, hi] inside
// [min, max]. Reuses the
// slider's track + fill + handle, so the range segment picks up the accent on
// drag just like the single slider. Both handles are focusable role="slider"s. ──
function createInterval(meta, onChange) {
  const label = meta.label;
  // Normalise the range first (normalizeRange — the slider's guard, shared):
  // non-finite bounds fall back to the value tuple then 0/1, an inverted pair
  // swaps, and a degenerate step re-infers — so markup like data-min="abc"
  // can't ride in as NaN ("NaN – NaN").
  const t0 = +(meta.value && meta.value[0]), t1 = +(meta.value && meta.value[1]);
  const { min, max, step } = normalizeRange(meta.min, meta.max, meta.step, Number.isFinite(t0) ? t0 : 0, Number.isFinite(t1) ? t1 : 1);
  const decimals = stepPrecision(step);
  const q = (v) => roundToStep(v, min, step);
  // Missing/non-finite tuple entries fall back to the bounds (the .set path already
  // guards this — match it at construction so e.g. value:[5] gives [5, max], not [5, NaN]).
  // t0/t1 already read the tuple null-safely above — reuse them rather than re-reading
  // meta.value[0] unguarded (a missing tuple threw here, dropping the whole control).
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

  // Keyboard: Tab to a handle, arrows move it (⇧ = coarse ×10), Home/End snap it
  // to its neighbour-or-limit. The two handles can't cross.
  [["minimum", hLo], ["maximum", hHi]].forEach(([lab, h]) => {
    h.tabIndex = 0; h.setAttribute("role", "slider"); h.setAttribute("aria-label", `${label} ${lab}`);
    h.setAttribute("aria-valuemin", String(min)); h.setAttribute("aria-valuemax", String(max));
  });

  const pctOf = (v) => ((v - min) / ((max - min) || 1)) * 100;
  const render = () => {
    const a = pctOf(lo), b = pctOf(hi);
    fill.style.left = a + "%"; fill.style.width = Math.max(0, b - a) + "%";
    hLo.style.left = `clamp(5px, calc(${a}% - 1.5px), calc(100% - 9px))`; hHi.style.left = `clamp(5px, calc(${b}% - 1.5px), calc(100% - 9px))`; // stay inset at the extremes, like the slider handle
    valueEl.textContent = `${lo.toFixed(decimals)} – ${hi.toFixed(decimals)}`;
    hLo.setAttribute("aria-valuenow", String(lo)); hHi.setAttribute("aria-valuenow", String(hi));
    // Value-dodge, the slider's shared overlap test (overlapsText) — per handle here:
    // a handle that slides under the label (left) or the readout (right) yields so
    // the text stays legible.
    const trackW = wrap.offsetWidth;
    if (trackW) {
      const dodges = (pct) => overlapsText(labelEl, valueEl, (pct / 100) * trackW - 1.5, 3);
      hLo.classList.toggle("is-dodge", dodges(pctOf(lo)));
      hHi.classList.toggle("is-dodge", dodges(pctOf(hi)));
    }
  };
  render();

  const emit = () => onChange([lo, hi]);
  const setLo = (v) => { lo = clamp(Math.min(q(v), hi), min, max); render(); };
  const setHi = (v) => { hi = clamp(Math.max(q(v), lo), min, max); render(); };

  let rect = null, scale = 1, active = null;
  // Divide out any ancestor CSS transform (rect is visual px, offsetWidth layout px) —
  // same correction as the single slider, so a scaled panel still tracks the cursor 1:1.
  const valFromX = (x) => { const native = wrap.offsetWidth || rect.width; const p = clamp((x - rect.left) / scale / native, 0, 1); return clamp(min + p * (max - min), min, max); };
  const grab = (x) => {
    const v = valFromX(x);
    if (!active) active = v < lo ? "lo" : v > hi ? "hi" : (Math.abs(v - lo) <= Math.abs(v - hi) ? "lo" : "hi");
    active === "lo" ? setLo(v) : setHi(v); emit();
  };
  // The shared drag gesture: pointer capture, the single-pointer guard, and every
  // end path (up / cancel / lost capture / buttons released off-element) in one
  // place — the hand-rolled listener set this replaced re-implemented all of it.
  dragGesture(track, {
    onDown: (e) => {
      e.preventDefault();
      rect = wrap.getBoundingClientRect(); scale = rect.width / (wrap.offsetWidth || rect.width);
      track.classList.add("is-active", "is-dragging"); active = null;
      grab(e.clientX);
      (active === "lo" ? hLo : hHi).focus({ focusVisible: false }); // hand keyboard to the grabbed handle (preventDefault suppressed click-to-focus) without the keyboard ring on a mouse press; Tab still rings
    },
    onMove: (e) => grab(e.clientX),
    onEnd: () => { rect = null; active = null; track.classList.remove("is-active", "is-dragging"); },
  });
  wireHoverClass(track, render); // re-render the value-dodge with the real track width on first hover
  // Harden the dodge against type metrics it can't predict: recompute once layout +
  // fonts settle (a web-font swap or a custom --tw-font-sans shifts the label/value
  // widths it measures), and on any track-width change. The dodge already reads the
  // real offsetWidth, so it adapts to any font — this just keeps it in sync.
  onReady(render);
  onLive(track, [[window, "resize"], [window, "tw-reflow"]], render); // tw-reflow: a tab page revealing this control re-measures the value-dodge (it built at 0 width while hidden); self-cleans once the panel is gone

  // The shared range keyboard model, bounded per handle: Home/End snap a handle to
  // its neighbour-or-limit, so the two can't cross.
  const onKey = (which) => (e) => {
    const nv = which === "lo" ? rangeStep(e, lo, step, min, hi) : rangeStep(e, hi, step, lo, max);
    if (nv == null) return;
    e.preventDefault(); which === "lo" ? setLo(nv) : setHi(nv); emit();
  };
  hLo.addEventListener("keydown", onKey("lo")); hHi.addEventListener("keydown", onKey("hi"));

  return {
    el: wrap,
    set: (v) => { if (Array.isArray(v)) { const a = +v[0], b = +v[1]; if (!Number.isFinite(a) || !Number.isFinite(b)) return; lo = clamp(q(Math.min(a, b)), min, max); hi = clamp(q(Math.max(a, b)), min, max); render(); } },
    get: () => [lo, hi],
  };
}

registerControl("interval", createInterval);

