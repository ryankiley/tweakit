// ── Spring config — stiffness/damping/mass + settle-curve preview. Lazy.
import { el, numField, onReady, onLive, cssVar, accentColor, clamp, dragGesture, registerControl } from "../shared.js";

// ── Spring config — stiffness / damping / mass + a live settle-curve preview.
// Closed-form step response of a damped harmonic oscillator (under/critical/over). ──
function springCurve(k, d, m, N = 64) {
  const w0 = Math.sqrt(k / m), z = d / (2 * Math.sqrt(k * m));
  const T = Math.min(2.2, 9 / Math.max(z * w0, 0.5));
  const out = [];
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * T; let x;
    if (z < 1 - 1e-4) { const wd = w0 * Math.sqrt(1 - z * z); x = 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t)); }
    else if (z <= 1 + 1e-4) { x = 1 - Math.exp(-w0 * t) * (1 + w0 * t); }
    else { const s = Math.sqrt(z * z - 1), a = w0 * (z + s), b = w0 * (z - s); x = 1 - (a * Math.exp(-b * t) - b * Math.exp(-a * t)) / (a - b); }
    out.push(x);
  }
  return out;
}

function createSpring(meta, onChange) {
  // Clamp the config to the same floors the fields enforce (stiffness ≥1, damping ≥0.5,
  // mass ≥0.1), dropping non-finite values to the defaults — so a degenerate stiffness/
  // mass:0 can't divide the settle curve to NaN (a blank preview) and .get() agrees with
  // what the fields display.
  const cl = (v, lo, def) => (Number.isFinite(+v) ? Math.max(lo, +v) : def);
  const clampS = (o) => ({ stiffness: cl(o.stiffness, 1, 300), damping: cl(o.damping, 0.5, 26), mass: cl(o.mass, 0.1, 1) });
  let s = clampS({ stiffness: 300, damping: 26, mass: 1, ...(meta.value || {}) });
  const root = el("div", "tw-spring");
  const viz = el("div", "tw-spring-viz");
  const canvas = document.createElement("canvas"); canvas.className = "tw-spring-canvas"; viz.append(canvas);
  const fields = el("div", "tw-fields");
  root.append(viz, fields);
  const ctx = canvas.getContext("2d");
  const draw = () => {
    const r = viz.getBoundingClientRect(); const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height)); if (w < 2) return;
    const dpr = window.devicePixelRatio || 1; canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Sample ~one point per device pixel so fast oscillations stay smooth, not angular.
    const pts = springCurve(s.stiffness, s.damping, s.mass, Math.max(160, Math.round(w * dpr)));
    const peak = Math.max(1.05, ...pts), pad = 6;
    const X = (i) => pad + (i / (pts.length - 1)) * (w - 2 * pad);
    const Y = (v) => h - pad - (v / peak) * (h - 2 * pad);
    ctx.strokeStyle = cssVar(root, "--tw-surface-active") || "rgba(255,255,255,0.1)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, Y(1)); ctx.lineTo(w - pad, Y(1)); ctx.stroke(); // target (=1)
    ctx.strokeStyle = accentColor(root); ctx.lineWidth = 1.5; ctx.lineJoin = ctx.lineCap = "round";
    ctx.beginPath(); pts.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.stroke();
  };
  const emit = () => onChange({ ...s });
  const flds = {};
  [["stiffness", "Stiffness", 1], ["damping", "Damping", 0.5], ["mass", "Mass", 0.1]].forEach(([key, lab, step]) => {
    flds[key] = numField({ label: lab, value: s[key], step, min: step }, (v) => { s[key] = v; draw(); emit(); });
    fields.append(flds[key].el);
  });
  // Draggable preview — drag anywhere in the curve area to tune by feel: horizontal sets
  // stiffness, vertical sets damping (drag up = less damping = more overshoot, so the
  // pointer tracks the curve's peak). The fields stay the precise / keyboard path; this is
  // the direct-manipulation companion (the bezier/point pattern). Mass keeps to its field.
  const ST_MIN = 1, ST_MAX = 500, DA_MIN = 1, DA_MAX = 40;
  let vizRect: any = null;
  const fromPointer = (e) => {
    if (!vizRect) return;
    const px = clamp((e.clientX - vizRect.left) / vizRect.width, 0, 1);
    const py = clamp((e.clientY - vizRect.top) / vizRect.height, 0, 1);
    s.stiffness = Math.round(ST_MIN + px * (ST_MAX - ST_MIN));
    s.damping = Math.round((DA_MIN + py * (DA_MAX - DA_MIN)) * 10) / 10; // top = low damping
    flds["stiffness"].set(s.stiffness); flds["damping"].set(s.damping);
    draw(); emit();
  };
  // The shared drag gesture: pointer capture, single-pointer guard, and every end
  // path (up / cancel / lost capture / buttons released off-element) in one place.
  dragGesture(viz, {
    onDown: (e) => { e.preventDefault(); vizRect = viz.getBoundingClientRect(); viz.classList.add("is-dragging"); fromPointer(e); },
    onMove: fromPointer,
    onEnd: () => { vizRect = null; viz.classList.remove("is-dragging"); },
  });
  onReady(draw);
  // The canvas reads theme tokens at draw time, so redraw on resize, on a tab page
  // revealing this control (tw-reflow — it built at 0×0 while hidden), when the OS
  // scheme flips, and when the host re-themes (SVG controls update via CSS, but a
  // canvas keeps a stale colour otherwise). Self-cleans once the panel is gone.
  onLive(canvas, [[window, "resize"], [window, "tw-reflow"], [matchMedia("(prefers-color-scheme: dark)"), "change"], [window, "tw-retheme"]], draw);
  return { el: root, set: (v) => { s = clampS({ ...s, ...(v || {}) }); Object.keys(flds).forEach((k) => flds[k].set(s[k])); draw(); }, get: () => ({ ...s }) };
}

registerControl("spring", createSpring);

