// ── Spring config — physics (stiffness/damping/mass) or a perceptual time (duration/
// bounce) mode, over one settle-curve preview. Lazy. ──
import { el, txt, numField, onReady, onLive, cssVar, accentColor, clamp, dragGesture, createSegmented, registerControl } from "../shared.js";

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
  const has = (x) => Number.isFinite(+x);

  // Two authoring modes over the SAME physics model. PHYSICS edits stiffness/damping/mass
  // directly. TIME edits a perceptual visualDuration + bounce (Motion's spring shorthand),
  // mapped onto the {k,d,m} the preview + emit share:
  //   stiffness = (2π / visualDuration)²,  ζ = 1 − bounce,  damping = 2ζ·√(k·m),  mass = 1.
  // Each mode keeps its own cache, so toggling back and forth restores its prior edits.
  const DUR_MIN = 0.1, DUR_MAX = 1;
  const clampDur = (v) => clamp(has(v) ? +v : 0.5, DUR_MIN, DUR_MAX);
  const clampBounce = (v) => clamp(has(v) ? +v : 0.2, 0, 1);
  const timeToPhysics = (t) => { const k = (2 * Math.PI / t.visualDuration) ** 2, z = 1 - t.bounce, m = 1; return { stiffness: k, damping: 2 * z * Math.sqrt(k * m), mass: m }; };

  // Initial config — accept top-level props (the inline shorthand
  // `{ type:"spring", visualDuration:0.3, bounce:0.2 }` or `{ …, stiffness, damping, mass }`)
  // as well as the legacy `value:{…}` form, with value taking precedence. Mode is explicit
  // (`meta.mode`) or inferred from which keys are present — time wins when either is given.
  const init = { stiffness: meta.stiffness, damping: meta.damping, mass: meta.mass, visualDuration: meta.visualDuration, bounce: meta.bounce, ...(meta.value || {}) };
  let mode = meta.mode === "time" || meta.mode === "physics" ? meta.mode : (has(init.visualDuration) || has(init.bounce)) ? "time" : "physics";
  const time = { visualDuration: clampDur(init.visualDuration), bounce: clampBounce(init.bounce) };
  let phys = clampS({ stiffness: init.stiffness, damping: init.damping, mass: init.mass });

  const root = el("div", "tw-spring");
  const viz = el("div", "tw-spring-viz");
  const canvas = document.createElement("canvas"); canvas.className = "tw-spring-canvas"; viz.append(canvas);
  const physFields = el("div", "tw-fields");
  const timeFields = el("div", "tw-fields");
  const ctx = canvas.getContext("2d");

  // The active mode resolves to {k,d,m}; the preview + emitted value both read it, so they
  // can never disagree (clampS on the time mapping keeps damping ≥ the field floor too).
  const resolved = () => (mode === "time" ? clampS(timeToPhysics(time)) : clampS(phys));
  const draw = () => {
    const r = viz.getBoundingClientRect(); const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height)); if (w < 2) return;
    const dpr = window.devicePixelRatio || 1; canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const s = resolved();
    // Sample ~one point per device pixel so fast oscillations stay smooth, not angular.
    const pts = springCurve(s.stiffness, s.damping, s.mass, Math.max(160, Math.round(w * dpr)));
    const peak = Math.max(1.05, ...pts), pad = 8; // matches the bezier editor's PAD (bezier.ts) — the two curve previews inset their plot identically
    const X = (i) => pad + (i / (pts.length - 1)) * (w - 2 * pad);
    const Y = (v) => h - pad - (v / peak) * (h - 2 * pad);
    ctx.strokeStyle = cssVar(root, "--tw-surface-active") || "rgba(255,255,255,0.1)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, Y(1)); ctx.lineTo(w - pad, Y(1)); ctx.stroke(); // target (=1)
    ctx.strokeStyle = accentColor(root); ctx.lineWidth = 1.5; ctx.lineJoin = ctx.lineCap = "round";
    ctx.beginPath(); pts.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.stroke();
  };
  // The full emitted/serialized value: the resolved {k,d,m} (so every consumer works without
  // a Motion runtime) PLUS visualDuration/bounce in time mode, which carry the authoring mode
  // through persistence/presets — set() infers TIME from their presence on the way back. One
  // definition feeds both emit() and get(), so the two can never drift.
  const resolvedValue = () => (mode === "time" ? { ...resolved(), visualDuration: time.visualDuration, bounce: time.bounce } : resolved());
  const emit = () => onChange(resolvedValue());

  const flds: any = {};
  [["stiffness", "Stiffness", 1], ["damping", "Damping", 0.5], ["mass", "Mass", 0.1]].forEach(([key, lab, step]: any) => {
    flds[key] = numField({ label: lab, value: phys[key], step, min: step }, (v) => { phys[key] = v; draw(); emit(); });
    physFields.append(flds[key].el);
  });
  const durFld = numField({ label: "Duration", value: time.visualDuration, step: 0.05, min: DUR_MIN, max: DUR_MAX }, (v) => { time.visualDuration = clampDur(v); draw(); emit(); });
  const bounceFld = numField({ label: "Bounce", value: time.bounce, step: 0.05, min: 0, max: 1 }, (v) => { time.bounce = clampBounce(v); draw(); emit(); });
  timeFields.append(durFld.el, bounceFld.el);

  const showMode = () => { timeFields.style.display = mode === "time" ? "" : "none"; physFields.style.display = mode === "physics" ? "" : "none"; };
  const switchMode = (m) => { if ((m !== "time" && m !== "physics") || m === mode) return; mode = m; showMode(); draw(); emit(); };
  const modeToggle = createSegmented([{ value: "time", label: "Time" }, { value: "physics", label: "Physics" }], mode, switchMode, "Spring mode");
  // The mode switch reuses the panel's row idiom (label left, segmented pill right) — the
  // same shape as the Off/On toggle and enum selectors — rather than a bespoke full-width pill.
  const modeRow = el("div", "tw-row");
  modeRow.append(txt("span", "tw-row-label", "Mode"), modeToggle.el);
  root.append(viz, modeRow, physFields, timeFields);

  // Draggable preview — drag anywhere in the curve area to tune by feel. PHYSICS: horizontal
  // sets stiffness, vertical sets damping (up = less damping = more overshoot, tracking the
  // curve's peak). TIME: horizontal sets duration (left = snappy), vertical sets bounce (up =
  // bouncier). The fields stay the precise / keyboard path; this is the direct-manipulation
  // companion (the bezier/point pattern).
  const ST_MIN = 1, ST_MAX = 500, DA_MIN = 1, DA_MAX = 40;
  let vizRect: any = null;
  const fromPointer = (e) => {
    if (!vizRect) return;
    const px = clamp((e.clientX - vizRect.left) / vizRect.width, 0, 1);
    const py = clamp((e.clientY - vizRect.top) / vizRect.height, 0, 1);
    // Set the field (which snaps to its own step grid + clamps), then read the snapped value
    // back — so the field readout, the emitted value, and the preview all agree on one number.
    if (mode === "time") {
      durFld.set(DUR_MIN + px * (DUR_MAX - DUR_MIN)); time.visualDuration = durFld.get();
      bounceFld.set(1 - py); time.bounce = bounceFld.get(); // top = bouncier
    } else {
      flds.stiffness.set(ST_MIN + px * (ST_MAX - ST_MIN)); phys.stiffness = flds.stiffness.get();
      flds.damping.set(DA_MIN + py * (DA_MAX - DA_MIN)); phys.damping = flds.damping.get(); // top = low damping
    }
    draw(); emit();
  };
  // The shared drag gesture: pointer capture, single-pointer guard, and every end
  // path (up / cancel / lost capture / buttons released off-element) in one place.
  dragGesture(viz, {
    onDown: (e) => { e.preventDefault(); vizRect = viz.getBoundingClientRect(); viz.classList.add("is-dragging"); fromPointer(e); },
    onMove: fromPointer,
    onEnd: () => { vizRect = null; viz.classList.remove("is-dragging"); },
  });
  showMode();
  onReady(draw);
  // The canvas reads theme tokens at draw time, so redraw on resize, on a tab page
  // revealing this control (tw-reflow — it built at 0×0 while hidden), when the OS
  // scheme flips, and when the host re-themes (SVG controls update via CSS, but a
  // canvas keeps a stale colour otherwise). Self-cleans once the panel is gone.
  onLive(canvas, [[window, "resize"], [window, "tw-reflow"], [matchMedia("(prefers-color-scheme: dark)"), "change"], [window, "tw-retheme"]], draw);
  return {
    el: root,
    // Programmatic set / restore — infer the mode from the value's keys (time wins when
    // visualDuration/bounce are present), update the matching cache + fields, and redraw
    // without emitting (set() is the silent path; the panel stamps + notifies itself).
    set: (v) => {
      if (!v || typeof v !== "object") return;
      const hasTime = has(v.visualDuration) || has(v.bounce), hasPhys = has(v.stiffness) || has(v.damping) || has(v.mass);
      if (!hasTime && !hasPhys) return;
      mode = hasTime ? "time" : "physics"; // time wins when both are present (it's the authoring mode)
      if (hasTime) { if (has(v.visualDuration)) time.visualDuration = clampDur(v.visualDuration); if (has(v.bounce)) time.bounce = clampBounce(v.bounce); }
      // Restore the physics cache whenever physics keys are present — even alongside time keys
      // (reset's default carries both groups), so a later toggle to Physics shows the intended
      // spring rather than a stale earlier edit. The active emitted value still follows `mode`.
      if (hasPhys) phys = clampS({ ...phys, ...v });
      modeToggle.set(mode);
      durFld.set(time.visualDuration); bounceFld.set(time.bounce);
      flds.stiffness.set(phys.stiffness); flds.damping.set(phys.damping); flds.mass.set(phys.mass);
      showMode(); draw();
    },
    get: () => resolvedValue(),
  };
}

registerControl("spring", createSpring);
