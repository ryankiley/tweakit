// ── Motion — a transition's timing: an easing curve with a duration, or a spring, in one popover over one value. The
// value carries the CSS it resolves to — `duration` in ms and an `easing` string, cubic-bezier() or a sampled linear(). Lazy. ──
import { el, txt, clamp, isObj, createSegmented, getControl, popover, registerControl, REDUCE_MOTION } from "../shared.js";
import { numField, triggerRow, svgEl, springCurve, springRun, timeFromSpring } from "../heavy.js";
import type { OnChange } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control, MotionValue, MotionInput } from "../types.js";

type Mode = "easing" | "spring";
type Curve = [number, number, number, number];
interface SpringOut { stiffness: number; damping: number; mass: number; visualDuration?: number; bounce?: number }

const EASES: Record<string, Curve> = { ease: [0.25, 0.1, 0.25, 1], linear: [0, 0, 1, 1], "ease-in": [0.42, 0, 1, 1], "ease-out": [0, 0, 0.58, 1], "ease-in-out": [0.42, 0, 0.58, 1] };
const DUR_DEF = 300, DUR_MAX = 10000, STAGE_PAD = 16; // ms; the stage's side padding (tweaks.css)
const BOUNCE_MAX = 1; // Motion's whole range: its damping-ratio floor of 0.05 keeps a bounce of 1 settling
const has = (x: unknown) => (typeof x === "number" ? Number.isFinite(x) : typeof x === "string" && x.trim() !== "" && Number.isFinite(+x)); // a number, or a numeric string — not `true`, `[]` or " "
const curveOf = (c: unknown): Curve | null => {
  if (typeof c === "string") return Object.prototype.hasOwnProperty.call(EASES, c) ? (EASES[c].slice() as Curve) : null; // own key only — "constructor" is not an easing
  if (Array.isArray(c) && c.length === 4) { const m = c.map(Number); return m.every(Number.isFinite) ? (m as Curve) : null; }
  return null;
};
const springKeys = (v: MotionInput) => has(v.stiffness) || has(v.damping) || has(v.mass) || has(v.visualDuration) || has(v.bounce);
// Physics keys map to the visualDuration + bounce Motion would resolve to them (timeFromSpring). An explicit duration/bounce wins.
const springTime = (v: MotionInput) => {
  const out: { mode: "time"; visualDuration?: number; bounce?: number } = { mode: "time" };
  if (has(v.stiffness)) { const k = +v.stiffness!, m = has(v.mass) ? +v.mass! : 1, t = timeFromSpring(k, has(v.damping) ? +v.damping! : 2 * Math.sqrt(k * m), m); out.visualDuration = t.visualDuration; if (has(v.damping)) out.bounce = clamp(t.bounce, -1, BOUNCE_MAX); }
  if (has(v.visualDuration)) out.visualDuration = +v.visualDuration!;
  if (has(v.bounce)) out.bounce = clamp(+v.bounce!, -1, BOUNCE_MAX);
  return out;
};
const modeOf = (v: MotionInput, keep: Mode): Mode => (v.mode === "spring" || v.mode === "easing" ? v.mode : springKeys(v) ? "spring" : curveOf(v.curve) ? "easing" : keep); // a curve that doesn't parse is no reason to switch

function createMotion(meta: Meta, onChange: OnChange): Control {
  const Bezier = getControl("cubicbezier"), Spring = getControl("spring");
  if (!Bezier || !Spring) throw new Error("[tweaks] motion: the bezier and spring controls are not loaded");
  const init: MotionInput = isObj(meta.value) ? meta.value : {};
  let mode = modeOf(init, "easing");
  let curve = curveOf(init.curve) ?? (EASES.ease.slice() as Curve), dur = has(init.duration) ? clamp(+init.duration!, 0, DUR_MAX) : DUR_DEF;

  // ── Row — label, a mini curve, a summary. ──
  const { root, trigger, right } = triggerRow("tw-motion", meta.label ?? "Motion"); // ??: an explicit "" label renders none
  const chip = el("span", "tw-trigger-chip tw-motion-chip");
  const chipSvg = svgEl("svg"); chipSvg.setAttribute("viewBox", "0 0 100 100"); chipSvg.setAttribute("preserveAspectRatio", "none");
  const chipPath = svgEl("path"); chipSvg.append(chipPath); chip.append(chipSvg);
  const valueEl = el("span", "tw-trigger-value");
  right.append(chip, valueEl);

  // ── Popover — the mode switch, the preview, one editor at a time. ──
  const pop = el("div", "tw-color-pop tw-motion-pop"), body = el("div", "tw-motion-body"); pop.append(body);
  const bezier = Bezier({ ...meta, type: "cubicbezier", label: "", value: curve.slice() } as Meta, (v) => { curve = v as Curve; update(); emit(); });
  curve = bezier.get() as Curve; // as the editor fitted it, so no invalid cubic-bezier()
  const spring = Spring({ ...meta, type: "spring", label: "", value: springTime(init) } as Meta, () => { update(); emit(); }); // time mode only; its Mode row is hidden (tweaks.css)
  const durFld = numField({ label: "Duration", value: dur, step: 10, min: 0, max: DUR_MAX, unit: "ms" }, (v) => { dur = clamp(v, 0, DUR_MAX); update(); emit(); });
  dur = durFld.get(); // as the field snapped it
  const easingPane = el("div", "tw-motion-pane"), springPane = el("div", "tw-motion-pane"), durRow = el("div", "tw-fields");
  durRow.append(durFld.el); easingPane.append(bezier.el, durRow); springPane.append(spring.el);
  const stage = el("div", "tw-motion-stage"), box = el("div", "tw-motion-box"); stage.append(box);
  const modeSeg = createSegmented([{ value: "easing", label: "Easing" }, { value: "spring", label: "Spring" }], mode, (m: unknown) => { if ((m === "easing" || m === "spring") && m !== mode) { mode = m; showMode(); update(); emit(); } }, "Motion type");
  const typeRow = el("div", "tw-row"); typeRow.append(txt("span", "tw-row-label", "Type"), modeSeg.el);
  body.append(typeRow, easingPane, springPane, stage);
  root.append(pop);

  const value = (): MotionValue => {
    if (mode === "easing") return { mode, curve: curve.slice() as Curve, duration: dur, easing: `cubic-bezier(${curve.join(", ")})` };
    // The run lasts until the spring is at rest (the drawn curve stops at 2.2 s): springRun.
    const s = spring.get() as SpringOut;
    return { mode, ...s, ...springRun(s.stiffness, s.damping, s.mass) };
  };
  const emit = () => onChange(value());

  // Web Animations, no frame loop to own. A click or an open flips direction and restarts; an edit lets a run in flight
  // finish — a handle drag fires per pointer move, and restarting each strobed the box.
  let far = false, anim: Animation | null = null;
  const replay = (flip: boolean) => {
    if (flip) far = !far; else if (anim && anim.playState === "running") return;
    const v = value();
    const travel = Math.max(0, stage.clientWidth - box.offsetWidth - 2 * STAGE_PAD); // measured now: the stage is 0 wide until the pop opens
    const from = `translateX(${far ? 0 : travel}px)`, to = `translateX(${far ? travel : 0}px)`;
    if (REDUCE_MOTION.matches || typeof box.animate !== "function") { box.style.transform = to; return; }
    anim?.cancel();
    const frames = [{ transform: from }, { transform: to }];
    try { anim = box.animate(frames, { duration: v.duration, easing: v.easing, fill: "forwards" }); }
    catch { anim = box.animate(frames, { duration: v.duration, fill: "forwards" }); } // no linear() support: a plain run rather than nothing
  };
  stage.addEventListener("click", () => replay(true));
  stage.tabIndex = 0; stage.setAttribute("role", "button"); stage.setAttribute("aria-label", "Replay the motion");
  stage.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); replay(true); } });

  // The chip's mini curve, y up, scaled so an overshoot still fits.
  const curvePath = () => {
    let pts: [number, number][];
    if (mode === "easing") { const [x1, y1, x2, y2] = curve; pts = []; for (let i = 0; i <= 24; i++) { const t = i / 24, u = 1 - t, a = 3 * u * u * t, b = 3 * u * t * t, c = t * t * t; pts.push([a * x1 + b * x2 + c, a * y1 + b * y2 + c]); } }
    else { const s = spring.get() as SpringOut; pts = springCurve(s.stiffness, s.damping, s.mass, 32).map((y, i) => [i / 31, y]); }
    const hi = Math.max(1, ...pts.map((p) => p[1])), lo = Math.min(0, ...pts.map((p) => p[1]));
    return pts.map(([x, y], i) => `${i ? "L" : "M"}${(10 + x * 80).toFixed(1)},${(90 - ((y - lo) / (hi - lo)) * 80).toFixed(1)}`).join(" ");
  };
  // The revealed editor built at 0×0 and onLive may have dropped its resize listener while the pop was detached, so
  // re-point it at its own value, which redraws at real size.
  const resync = () => { if (mode === "easing") bezier.set(curve.slice()); else spring.set(spring.get()); };
  const showMode = () => { easingPane.style.display = mode === "easing" ? "" : "none"; springPane.style.display = mode === "spring" ? "" : "none"; resync(); };
  // The summary shows the authored duration; a spring's emitted run (its settle) is longer.
  const summary = () => (mode === "easing" ? `Easing · ${dur} ms` : `Spring · ${Math.round(((spring.get() as SpringOut).visualDuration ?? 0) * 1000)} ms`);
  const update = () => { chipPath.setAttribute("d", curvePath()); valueEl.textContent = summary(); replay(false); };

  popover(root, trigger, pop, { fallbackH: 380, onOpen: () => { modeSeg.set(mode); resync(); replay(true); }, initialFocus: () => modeSeg.el.querySelector<HTMLElement>('[tabindex="0"]') }); // hidden until open: measure now; focus the checked option
  showMode(); update();

  // Set/restore: either mode's shape or a bare keyword; derived fields (easing, a spring's duration) are ignored.
  const set = (v: unknown) => {
    const inp: MotionInput | null = typeof v === "string" ? { curve: v } : Array.isArray(v) && v.length === 4 ? { curve: v as Curve } : isObj(v) ? v : null; // a bare 4-array is the bezier's own shape
    if (!inp) return;
    mode = modeOf(inp, mode);
    const c = curveOf(inp.curve); if (c) { bezier.set(c.slice()); curve = bezier.get() as Curve; } // read back fitted
    if (mode === "easing" && has(inp.duration)) { durFld.set(clamp(+inp.duration!, 0, DUR_MAX)); dur = durFld.get(); } // read back snapped
    if (springKeys(inp)) spring.set(springTime(inp));
    modeSeg.set(mode); showMode(); update();
  };
  return { el: root, set, get: value, destroy: () => spring.destroy && spring.destroy() };
}

registerControl("motion", createMotion);
