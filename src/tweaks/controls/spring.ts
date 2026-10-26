// ── Spring config — physics (stiffness/damping/mass) or a perceptual time (duration/bounce) mode, over one settle-curve preview. Lazy. ──
import { el, txt, onReady, onLive, clamp, createSegmented, registerControl } from "../shared.js";
import { dragGesture, numField, cssVar, accentColor, springCurve, springFromTime, boxFrac, notice, SPRING_DUR } from "../heavy.js";
import type { OnChange, NumField } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control } from "../types.js";

type SpringMode = "time" | "physics";
/** The physics triple every emitted value carries. */
interface Phys { stiffness: number; damping: number; mass: number }
type PhysKey = keyof Phys;
/** The perceptual pair the time mode edits. */
interface SpringTime { visualDuration: number; bounce: number }
/** What set() accepts: any subset of the physics, the time pair and an explicit mode. */
type SpringValue = Partial<Phys & SpringTime & { mode: SpringMode }>;

function createSpring(meta: Meta, onChange: OnChange): Control {
  // The fields' floors, non-finite to the defaults: a stiffness or mass of 0 would divide the settle curve to NaN.
  const cl = (v: unknown, lo: number, def: number) => (Number.isFinite(+v) ? Math.max(lo, +v) : def);
  const clampS = (o: { stiffness?: unknown; damping?: unknown; mass?: unknown }): Phys => ({ stiffness: cl(o.stiffness, 1, 300), damping: cl(o.damping, 0.5, 26), mass: cl(o.mass, 0.1, 1) });
  const has = (x: unknown) => Number.isFinite(+x);

  // Time mode edits visualDuration + bounce (Motion's spring shorthand), mapped onto the physics the preview and emit share
  // exactly as Motion resolves them (springFromTime): stiffness = (2π / (visualDuration × 1.2))², ζ from bounce floored at
  // 0.05, a negative bounce overdamped. Not through the physics pad's clamps, which would cut a short spring's stiffness.
  // An authored duration past the editor's range is clamped, and the console says so once.
  const [DUR_MIN, DUR_MAX] = SPRING_DUR;
  let said = false;
  const clampDur = (v: unknown) => {
    const n = has(v) ? +v : 0.5, c = clamp(n, DUR_MIN, DUR_MAX);
    if (c !== n && !said) { said = true; notice("springDur", [meta.key, n, c]); }
    return c;
  };
  const clampBounce = (v: unknown) => clamp(has(v) ? +v : 0.2, -1, 1); // Motion takes a negative bounce: overdamped
  // Ten significant figures: the trig round trip otherwise hands back 300.00000000000006 for a stiffness of 300.
  const sig = (x: number) => +x.toPrecision(10);
  const timeToPhysics = (t: SpringTime): Phys => { const p = springFromTime(t.visualDuration, t.bounce); return { stiffness: sig(p.stiffness), damping: sig(p.damping), mass: p.mass }; };

  // Top-level props (the inline shorthand) or the `value:{…}` form, value winning; the mode is explicit or inferred, time winning.
  const explicit = (m: unknown): SpringMode | null => (m === "time" || m === "physics" ? m : null);
  const init = { stiffness: meta.stiffness, damping: meta.damping, mass: meta.mass, visualDuration: meta.visualDuration, bounce: meta.bounce, ...(meta.value || {}) };
  let mode: SpringMode = explicit(init.mode) ?? explicit(meta.mode) ?? ((has(init.visualDuration) || has(init.bounce)) ? "time" : "physics");
  const time: SpringTime = { visualDuration: clampDur(init.visualDuration), bounce: clampBounce(init.bounce) };
  let phys = clampS({ stiffness: init.stiffness, damping: init.damping, mass: init.mass });

  const root = el("div", "tw-spring");
  const viz = el("div", "tw-spring-viz");
  const canvas = document.createElement("canvas"); canvas.className = "tw-spring-canvas"; viz.append(canvas);
  const physFields = el("div", "tw-fields");
  const timeFields = el("div", "tw-fields");
  const ctx = canvas.getContext("2d");

  // The preview and the emitted value both read this, so they can never disagree.
  const resolved = () => (mode === "time" ? timeToPhysics(time) : clampS(phys));
  const draw = () => {
    // Layout size: getBoundingClientRect includes the pop's entrance scale.
    const w = Math.max(1, viz.clientWidth), h = Math.max(1, viz.clientHeight); if (w < 2) return;
    const dpr = window.devicePixelRatio || 1; canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const s = resolved();
    // Sample ~one point per device pixel so fast oscillations stay smooth, not angular.
    const pts = springCurve(s.stiffness, s.damping, s.mass, Math.max(160, Math.round(w * dpr)));
    const peak = Math.max(1.05, ...pts), pad = 8; // the bezier editor's PAD, so the two previews inset alike
    const X = (i: number) => pad + (i / (pts.length - 1)) * (w - 2 * pad);
    const Y = (v: number) => h - pad - (v / peak) * (h - 2 * pad);
    ctx.strokeStyle = cssVar(root, "--tw-surface-active") || "rgba(255,255,255,0.1)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, Y(1)); ctx.lineTo(w - pad, Y(1)); ctx.stroke(); // target (=1)
    ctx.strokeStyle = accentColor(root); ctx.lineWidth = 1.5; ctx.lineJoin = ctx.lineCap = "round";
    ctx.beginPath(); pts.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.stroke();
  };
  // The resolved {k,d,m} plus, in time mode, visualDuration/bounce, from which set() infers the mode back from persistence.
  const resolvedValue = (): Phys & Partial<SpringTime> => (mode === "time" ? { ...resolved(), visualDuration: time.visualDuration, bounce: time.bounce } : resolved());
  const emit = () => onChange(resolvedValue());

  const flds: Partial<Record<PhysKey, NumField>> = {};
  ([["stiffness", "Stiffness", 1], ["damping", "Damping", 0.5], ["mass", "Mass", 0.1]] as const).forEach(([key, lab, step]) => {
    flds[key] = numField({ label: lab, value: phys[key], step, min: step }, (v) => { phys[key] = v; draw(); emit(); });
    physFields.append(flds[key].el);
  });
  // The field shows ms; the value stays Motion's visualDuration in seconds.
  const durFld = numField({ label: "Duration", value: time.visualDuration * 1000, step: 10, min: DUR_MIN * 1000, max: DUR_MAX * 1000, unit: "ms" }, (v) => { time.visualDuration = clampDur(v / 1000); draw(); emit(); });
  const bounceFld = numField({ label: "Bounce", value: time.bounce * 100, step: 5, min: -100, max: 100, unit: "%" }, (v) => { time.bounce = clampBounce(v / 100); draw(); emit(); }); // shown as a percentage; the value stays Motion's −1–1
  timeFields.append(durFld.el, bounceFld.el);

  const showMode = () => { timeFields.style.display = mode === "time" ? "" : "none"; physFields.style.display = mode === "physics" ? "" : "none"; };
  const switchMode = (m: unknown) => { if ((m !== "time" && m !== "physics") || m === mode) return; mode = m; showMode(); draw(); emit(); };
  const modeToggle = createSegmented([{ value: "time", label: "Time" }, { value: "physics", label: "Physics" }], mode, switchMode, "Spring mode");
  const modeRow = el("div", "tw-row");
  modeRow.append(txt("span", "tw-row-label", "Mode"), modeToggle.el);
  // A caption, so two springs in one panel can be told apart and the filter matches shown text.
  if (meta.label) root.append(txt("div", "tw-spring-label", meta.label));
  root.append(viz, modeRow, physFields, timeFields);

  // Drag the preview to tune by feel: horizontal sets stiffness or duration, vertical sets damping or bounce.
  const ST_MIN = 1, ST_MAX = 500, DA_MIN = 1, DA_MAX = 40, DRAG_DUR_MIN = 0.1, DRAG_DUR_MAX = 1; // the feel-tuning span; the fields reach further
  const fromPointer = (e: PointerEvent) => {
    const [px, py] = boxFrac(e, viz);
    // Set the field (it snaps and clamps), then read back, so readout, value and preview agree.
    if (mode === "time") {
      durFld.set((DRAG_DUR_MIN + px * (DRAG_DUR_MAX - DRAG_DUR_MIN)) * 1000); time.visualDuration = durFld.get() / 1000;
      bounceFld.set((1 - 2 * py) * 100); time.bounce = bounceFld.get() / 100; // top = bounce 100%, the middle 0, the bottom −100% (overdamped)
    } else {
      flds.stiffness.set(ST_MIN + px * (ST_MAX - ST_MIN)); phys.stiffness = flds.stiffness.get();
      flds.damping.set(DA_MIN + py * (DA_MAX - DA_MIN)); phys.damping = flds.damping.get(); // top = low damping
    }
    draw(); emit();
  };
  dragGesture(viz, {
    onDown: (e) => { e.preventDefault(); viz.classList.add("is-dragging"); fromPointer(e); },
    onMove: fromPointer,
    onEnd: () => viz.classList.remove("is-dragging"),
  });
  showMode();
  onReady(draw);
  // The canvas reads theme tokens at draw time: redraw on resize, on a tab page revealing it (tw-reflow; it built at
  // 0×0 while hidden), on an OS scheme flip and on a host re-theme — CSS re-themes the SVG controls, a canvas keeps a stale color.
  onLive(canvas, [[window, "resize"], [window, "tw-reflow"], [matchMedia("(prefers-color-scheme: dark)"), "change"], [window, "tw-retheme"]], draw);
  // A host flipping [data-tw-scheme] re-themes through CSS alone; the canvas needs a redraw. Let go once mounted and removed.
  let schemeObs: MutationObserver | null = null, wasMounted = false;
  if (typeof MutationObserver === "function") {
    schemeObs = new MutationObserver(() => {
      if (canvas.isConnected) { wasMounted = true; draw(); }
      else if (wasMounted) { schemeObs.disconnect(); schemeObs = null; }
    });
    schemeObs.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-tw-scheme"] });
  }
  return {
    el: root,
    destroy: () => { if (schemeObs) { schemeObs.disconnect(); schemeObs = null; } },
    // Silent set/restore: infer the mode from the keys, update caches and fields, redraw without emitting.
    set: (v: SpringValue) => {
      if (!v || typeof v !== "object") return;
      const ex = explicit(v.mode), hasTime = has(v.visualDuration) || has(v.bounce), hasPhys = has(v.stiffness) || has(v.damping) || has(v.mass);
      if (!hasTime && !hasPhys && !ex) return;
      mode = ex ?? (hasTime ? "time" : "physics"); // an explicit mode wins; else time, the authoring mode
      if (hasTime) { if (has(v.visualDuration)) time.visualDuration = clampDur(v.visualDuration); if (has(v.bounce)) time.bounce = clampBounce(v.bounce); }
      // Restore the physics cache even alongside time keys (reset's default carries both), so a later toggle to Physics shows the intended spring.
      if (hasPhys) phys = clampS({ ...phys, ...v });
      modeToggle.set(mode);
      durFld.set(time.visualDuration * 1000); bounceFld.set(time.bounce * 100);
      flds.stiffness.set(phys.stiffness); flds.damping.set(phys.damping); flds.mass.set(phys.mass);
      showMode(); draw();
    },
    get: () => resolvedValue(),
  };
}

registerControl("spring", createSpring);
