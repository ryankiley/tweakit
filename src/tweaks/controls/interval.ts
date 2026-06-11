// ── Interval / range slider — dual-handle [lo,hi]. Lazy.
import { el, clamp, roundToStep, stepPrecision, inferStep, wireHoverClass, onReady, registerControl } from "../shared.js";

// ── Interval / range slider — a dual-handle slider bound to [lo, hi] inside
// [min, max] (Tweakpane-essentials' Interval; leva's `interval`). Reuses the
// slider's track + fill + handle, so the range segment picks up the accent on
// drag just like the single slider. Both handles are focusable role="slider"s. ──
function createInterval(meta, onChange) {
  const label = meta.label;
  // Normalise the range first (the slider's guard, mirrored): non-finite bounds fall
  // back to the value tuple then 0/1, an inverted pair swaps, and a degenerate step
  // re-infers — so markup like data-min="abc" can't ride in as NaN ("NaN – NaN").
  let min = +meta.min, max = +meta.max, step = +meta.step;
  const t0 = +(meta.value && meta.value[0]), t1 = +(meta.value && meta.value[1]);
  if (!Number.isFinite(min)) min = Number.isFinite(t0) ? t0 : 0;
  if (!Number.isFinite(max)) max = Number.isFinite(t1) ? t1 : 1;
  if (max < min) { const t = min; min = max; max = t; }
  if (!(step > 0) || step > max - min) step = inferStep(min, max);
  const decimals = stepPrecision(step);
  const q = (v) => roundToStep(v, min, step);
  // Missing/non-finite tuple entries fall back to the bounds (the .set path already
  // guards this — match it at construction so e.g. value:[5] gives [5, max], not [5, NaN]).
  const v0 = +meta.value[0], v1 = +meta.value[1];
  let lo = clamp(q(Number.isFinite(v0) ? v0 : min), min, max), hi = clamp(q(Number.isFinite(v1) ? v1 : max), min, max);
  if (lo > hi) { const t = lo; lo = hi; hi = t; }

  const wrap = el("div", "tw-slider-wrap");
  const track = el("div", "tw-slider tw-interval");
  const fill = el("div", "tw-slider-fill");
  const hLo = el("div", "tw-slider-handle"), hHi = el("div", "tw-slider-handle");
  const labelEl = el("span", "tw-slider-label"); labelEl.textContent = label;
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
    // Value-dodge, same as the single slider: a handle that slides under the label
    // (left) or the readout (right) yields so the text stays legible. Per-handle here.
    const trackW = wrap.offsetWidth;
    if (trackW) {
      const labelLeft = labelEl.offsetLeft, labelRight = labelLeft + labelEl.offsetWidth, valueLeft = valueEl.offsetLeft, valueRight = valueLeft + valueEl.offsetWidth; // read live, tracks the CSS/font
      const dodges = (pct) => { const cx = (pct / 100) * trackW, l = cx - 1.5, r = cx + 1.5; return (l < labelRight && r > labelLeft) || (l < valueRight && r > valueLeft); };
      hLo.classList.toggle("is-dodge", dodges(pctOf(lo)));
      hHi.classList.toggle("is-dodge", dodges(pctOf(hi)));
    }
  };
  render();

  const emit = () => onChange([lo, hi]);
  const setLo = (v) => { lo = clamp(Math.min(q(v), hi), min, max); render(); };
  const setHi = (v) => { hi = clamp(Math.max(q(v), lo), min, max); render(); };

  let rect = null, scale = 1, active = null, pid = null;
  // Divide out any ancestor CSS transform (rect is visual px, offsetWidth layout px) —
  // same correction as the single slider, so a scaled panel still tracks the cursor 1:1.
  const valFromX = (x) => { const native = wrap.offsetWidth || rect.width; const p = clamp((x - rect.left) / scale / native, 0, 1); return clamp(min + p * (max - min), min, max); };
  const grab = (x) => {
    const v = valFromX(x);
    if (!active) active = v < lo ? "lo" : v > hi ? "hi" : (Math.abs(v - lo) <= Math.abs(v - hi) ? "lo" : "hi");
    active === "lo" ? setLo(v) : setHi(v); emit();
  };
  track.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || rect) return; // primary button only; a second pointer can't hijack a live drag
    e.preventDefault(); try { e.target.setPointerCapture(e.pointerId); } catch {}
    pid = e.pointerId;
    rect = wrap.getBoundingClientRect(); scale = rect.width / (wrap.offsetWidth || rect.width);
    track.classList.add("is-active", "is-dragging"); active = null;
    grab(e.clientX);
    (active === "lo" ? hLo : hHi).focus(); // preventDefault suppressed click-to-focus — hand keyboard to the grabbed handle
  });
  track.addEventListener("pointermove", (e) => { if (!rect || e.pointerId !== pid) return; if (e.buttons === 0) { up(); return; } grab(e.clientX); });
  const up = (e?) => { if (e && e.pointerId !== pid) return; rect = null; active = null; pid = null; track.classList.remove("is-active", "is-dragging"); };
  track.addEventListener("pointerup", up); track.addEventListener("pointercancel", up);
  wireHoverClass(track, render); // re-render the value-dodge with the real track width on first hover
  // Harden the dodge against type metrics it can't predict: recompute once layout +
  // fonts settle (a web-font swap or a custom --tw-font-sans shifts the label/value
  // widths it measures), and on any track-width change. The dodge already reads the
  // real offsetWidth, so it adapts to any font — this just keeps it in sync.
  onReady(render);
  const onResize = () => { if (!track.isConnected) { window.removeEventListener("resize", onResize); window.removeEventListener("tw-reflow", onResize); return; } render(); }; // panel removed → drop the listeners (matches fps/bezier self-cleanup)
  window.addEventListener("resize", onResize);
  window.addEventListener("tw-reflow", onResize); // a tab page revealing this control re-measures the value-dodge (it built at 0 width while hidden)

  const onKey = (which) => (e) => {
    const coarse = e.shiftKey ? 10 : 1;
    let nv = which === "lo" ? lo : hi;
    switch (e.key) {
      case "ArrowRight": case "ArrowUp": nv += step * coarse; break;
      case "ArrowLeft": case "ArrowDown": nv -= step * coarse; break;
      case "Home": nv = which === "lo" ? min : lo; break;
      case "End": nv = which === "lo" ? hi : max; break;
      default: return;
    }
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

