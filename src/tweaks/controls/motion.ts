// ── Motion — a transition's timing: an easing curve with a duration, or a spring, in one popover over one value. The
// value carries the CSS it resolves to — `duration` in ms and an `easing` string, cubic-bezier() or a sampled linear(). Lazy. ──
import {
  el,
  txt,
  clamp,
  isObj,
  createSegmented,
  getControl,
  popover,
  registerControl,
  REDUCE_MOTION,
  words,
} from "../shared.js";
import { numField, triggerRow, svgEl, springCurve, springRun, timeFromSpring, notice, SPRING_DUR } from "../heavy.js";
import { KEYWORDS } from "../easing.js";
import type { OnChange } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control, MotionValue, MotionInput } from "../types.js";

type Mode = "easing" | "spring";
type Curve = [number, number, number, number];
interface SpringOut {
  stiffness: number;
  damping: number;
  mass: number;
  visualDuration?: number;
  bounce?: number;
}

const DUR_DEF = 300,
  DUR_MAX = 10000,
  STAGE_PAD = 16; // ms; the stage's side padding (tweaks.css)
const BOUNCE_MAX = 1; // Motion's whole range: its damping-ratio floor of 0.05 keeps a bounce of 1 settling
// a number, or a numeric string — not `true`, `[]` or " "
const has = (x: unknown) =>
  typeof x === "number" ? Number.isFinite(x) : typeof x === "string" && x.trim() !== "" && Number.isFinite(+x);
const curveOf = (c: unknown): Curve | null => {
  // the CSS keywords, linear's identity included; null-prototype, so "constructor" is not one
  if (typeof c === "string") {
    const k = c === "linear" ? [0, 0, 1, 1] : KEYWORDS[c];
    return k ? (k.slice() as Curve) : null;
  }
  if (Array.isArray(c) && c.length === 4) {
    const m = c.map(Number);
    return m.every(Number.isFinite) ? (m as Curve) : null;
  }
  return null;
};
const springKeys = (v: MotionInput) =>
  has(v.stiffness) || has(v.damping) || has(v.mass) || has(v.visualDuration) || has(v.bounce);
// Physics keys map to the visualDuration + bounce Motion would resolve to them (timeFromSpring). An explicit
// duration/bounce wins.
const springTime = (v: MotionInput) => {
  const out: { mode: "time"; visualDuration?: number; bounce?: number } = { mode: "time" };
  if (has(v.stiffness)) {
    const k = +v.stiffness!,
      m = has(v.mass) ? +v.mass! : 1,
      t = timeFromSpring(k, has(v.damping) ? +v.damping! : 2 * Math.sqrt(k * m), m);
    out.visualDuration = t.visualDuration;
    if (has(v.damping)) out.bounce = clamp(t.bounce, -1, BOUNCE_MAX);
  }
  if (has(v.visualDuration)) out.visualDuration = +v.visualDuration!;
  if (has(v.bounce)) out.bounce = clamp(+v.bounce!, -1, BOUNCE_MAX);
  return out;
};
// A stiffness and damping the host wrote, kept as written rather than resolved through the editor's time pair, which
// rounds and clamps: unless a time pair rides along that isn't the one they resolve to (this control's own value back).
const exactSpring = (v: MotionInput): SpringOut | null => {
  if (!has(v.stiffness) || !has(v.damping)) return null;
  const k = +v.stiffness!,
    d = +v.damping!,
    m = has(v.mass) ? +v.mass! : 1;
  if (!(k > 0 && d >= 0 && m > 0)) return null;
  const t = timeFromSpring(k, d, m),
    off = (a: unknown, b: number) => has(a) && Math.abs(+a! - b) > 1e-6 * Math.max(1, Math.abs(b));
  return off(v.visualDuration, t.visualDuration) || off(v.bounce, t.bounce)
    ? null
    : { stiffness: k, damping: d, mass: m, ...t };
};
// a curve that doesn't parse is no reason to switch
const modeOf = (v: MotionInput, keep: Mode): Mode =>
  v.mode === "spring" || v.mode === "easing" ? v.mode : springKeys(v) ? "spring" : curveOf(v.curve) ? "easing" : keep;

function createMotion(meta: Meta, onChange: OnChange): Control {
  const tr = words();
  const Bezier = getControl("cubicbezier"),
    Spring = getControl("spring");
  if (!Bezier || !Spring) throw new Error("[tweaks] motion: the bezier and spring controls are not loaded");
  const init: MotionInput = isObj(meta.value) ? meta.value : {};
  let mode = modeOf(init, "easing");
  let curve = curveOf(init.curve) ?? (KEYWORDS.ease.slice() as Curve),
    dur = has(init.duration) ? clamp(+init.duration!, 0, DUR_MAX) : DUR_DEF;

  // ── Row — label, a mini curve, a summary. ──
  // ??: an explicit "" label renders none
  const { root, trigger, right } = triggerRow("twk-motion", meta.label ?? tr("motion", "Motion"));
  const chip = el("span", "twk-trigger-chip twk-motion-chip");
  const chipSvg = svgEl("svg");
  chipSvg.setAttribute("viewBox", "0 0 100 100");
  chipSvg.setAttribute("preserveAspectRatio", "none");
  const chipPath = svgEl("path");
  chipSvg.append(chipPath);
  chip.append(chipSvg);
  const valueEl = el("span", "twk-trigger-value");
  right.append(chip, valueEl);

  // ── Popover — the mode switch, the preview, one editor at a time. ──
  const pop = el("div", "twk-color-pop twk-motion-pop"),
    body = el("div", "twk-motion-body");
  pop.append(body);
  const bezier = Bezier({ ...meta, type: "cubicbezier", label: "", value: curve.slice() } as Meta, (v) => {
    curve = v as Curve;
    update();
    emit();
  });
  curve = bezier.get() as Curve; // as the editor fitted it, so no invalid cubic-bezier()
  // Host-written physics the editor can't draw exactly: it shows the nearest, clamped here so it doesn't warn as well.
  let exact: SpringOut | null = null,
    said = false;
  const editorTime = (inp: MotionInput) => {
    exact = exactSpring(inp);
    if (!exact) return springTime(inp);
    const vd = clamp(exact.visualDuration!, SPRING_DUR[0], SPRING_DUR[1]),
      z = exact.damping / (2 * Math.sqrt(exact.stiffness * exact.mass));
    if ((vd !== exact.visualDuration || z < 0.05 || z > 20) && !said) {
      said = true;
      notice("springKept", [meta.key, exact.stiffness, exact.damping, exact.mass]);
    }
    return { mode: "time" as const, visualDuration: vd, bounce: exact.bounce };
  };
  // Time mode only; its Mode row is hidden (tweaks.css). An edit there drops the kept physics.
  const spring = Spring({ ...meta, type: "spring", label: "", value: editorTime(init) } as Meta, () => {
    exact = null;
    update();
    emit();
  });
  const springNow = () => exact ?? (spring.get() as SpringOut);
  const durFld = numField(
    { label: tr("duration", "Duration"), value: dur, step: 10, min: 0, max: DUR_MAX, unit: "ms" },
    (v) => {
      dur = clamp(v, 0, DUR_MAX);
      update();
      emit();
    },
  );
  dur = durFld.get(); // as the field snapped it
  const easingPane = el("div", "twk-motion-pane"),
    springPane = el("div", "twk-motion-pane"),
    durRow = el("div", "twk-fields");
  durRow.append(durFld.el);
  easingPane.append(bezier.el, durRow);
  springPane.append(spring.el);
  const stage = el("div", "twk-motion-stage"),
    box = el("div", "twk-motion-box");
  stage.append(box);
  const modeSeg = createSegmented(
    [
      { value: "easing", label: tr("easing", "Easing") },
      { value: "spring", label: tr("spring", "Spring") },
    ],
    mode,
    (m: unknown) => {
      if ((m === "easing" || m === "spring") && m !== mode) {
        mode = m;
        showMode();
        update();
        emit();
      }
    },
    tr("motionType", "Motion type"),
  );
  const typeRow = el("div", "twk-row");
  typeRow.append(txt("span", "twk-row-label", tr("type", "Type")), modeSeg.el);
  body.append(typeRow, easingPane, springPane, stage);
  root.append(pop);

  const value = (): MotionValue => {
    if (mode === "easing")
      return { mode, curve: curve.slice() as Curve, duration: dur, easing: `cubic-bezier(${curve.join(", ")})` };
    // The run lasts until the spring is at rest (the drawn curve stops at 2.2 s): springRun.
    const s = springNow();
    return { mode, ...s, ...springRun(s.stiffness, s.damping, s.mass) };
  };
  const emit = () => onChange(value());

  // Web Animations, no frame loop to own. A click or an open flips direction and restarts; an edit lets a run in flight
  // finish — a handle drag fires per pointer move, and restarting each strobed the box.
  let far = false,
    anim: Animation | null = null;
  const replay = (flip: boolean) => {
    if (flip) far = !far;
    else if (anim && anim.playState === "running") return;
    const v = value();
    // measured now: the stage is 0 wide until the pop opens
    const travel = Math.max(0, stage.clientWidth - box.offsetWidth - 2 * STAGE_PAD);
    const from = `translateX(${far ? 0 : travel}px)`,
      to = `translateX(${far ? travel : 0}px)`;
    if (REDUCE_MOTION.matches || typeof box.animate !== "function") {
      box.style.transform = to;
      return;
    }
    anim?.cancel();
    const frames = [{ transform: from }, { transform: to }];
    try {
      anim = box.animate(frames, { duration: v.duration, easing: v.easing, fill: "forwards" });
    } catch {
      // no linear() support: a plain run rather than nothing
      anim = box.animate(frames, { duration: v.duration, fill: "forwards" });
    }
  };
  stage.addEventListener("click", () => replay(true));
  stage.tabIndex = 0;
  stage.setAttribute("role", "button");
  stage.setAttribute("aria-label", tr("replay", "Replay the motion"));
  stage.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      replay(true);
    }
  });

  // The chip's mini curve, y up, scaled so an overshoot still fits.
  const curvePath = () => {
    let pts: [number, number][];
    if (mode === "easing") {
      const [x1, y1, x2, y2] = curve;
      pts = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24,
          u = 1 - t,
          a = 3 * u * u * t,
          b = 3 * u * t * t,
          c = t * t * t;
        pts.push([a * x1 + b * x2 + c, a * y1 + b * y2 + c]);
      }
    } else {
      const s = springNow();
      pts = springCurve(s.stiffness, s.damping, s.mass, 32).map((y, i) => [i / 31, y]);
    }
    const hi = Math.max(1, ...pts.map((p) => p[1])),
      lo = Math.min(0, ...pts.map((p) => p[1]));
    return pts
      .map(
        ([x, y], i) => `${i ? "L" : "M"}${(10 + x * 80).toFixed(1)},${(90 - ((y - lo) / (hi - lo)) * 80).toFixed(1)}`,
      )
      .join(" ");
  };
  // The revealed editor built at 0×0 and onLive may have dropped its resize listener while the pop was detached, so
  // re-point it at its own value, which redraws at real size.
  const resync = () => {
    if (mode === "easing") bezier.set(curve.slice());
    else spring.set(spring.get());
  };
  const showMode = () => {
    easingPane.style.display = mode === "easing" ? "" : "none";
    springPane.style.display = mode === "spring" ? "" : "none";
    resync();
  };
  // The summary shows the authored duration; a spring's emitted run (its settle) is longer.
  const summary = () =>
    mode === "easing"
      ? tr("easingSummary", "Easing · {ms} ms", { ms: dur })
      : tr("springSummary", "Spring · {ms} ms", { ms: Math.round((springNow().visualDuration ?? 0) * 1000) });
  const update = () => {
    chipPath.setAttribute("d", curvePath());
    valueEl.textContent = summary();
    replay(false);
  };

  // hidden until open: measure now; focus the checked option
  popover(root, trigger, pop, {
    fallbackH: 380,
    onOpen: () => {
      modeSeg.set(mode);
      resync();
      replay(true);
    },
    initialFocus: () => modeSeg.el.querySelector<HTMLElement>('[tabindex="0"]'),
  });
  showMode();
  update();

  // Set/restore: either mode's shape or a bare keyword; derived fields (easing, a spring's duration) are ignored.
  const set = (v: unknown) => {
    // a bare 4-array is the bezier's own shape
    const inp: MotionInput | null =
      typeof v === "string"
        ? { curve: v }
        : Array.isArray(v) && v.length === 4
          ? { curve: v as Curve }
          : isObj(v)
            ? v
            : null;
    if (!inp) return;
    mode = modeOf(inp, mode);
    const c = curveOf(inp.curve);
    // read back fitted
    if (c) {
      bezier.set(c.slice());
      curve = bezier.get() as Curve;
    }
    // read back snapped
    if (mode === "easing" && has(inp.duration)) {
      durFld.set(clamp(+inp.duration!, 0, DUR_MAX));
      dur = durFld.get();
    }
    if (springKeys(inp)) spring.set(editorTime(inp));
    modeSeg.set(mode);
    showMode();
    update();
  };
  return { el: root, set, get: value, destroy: () => spring.destroy && spring.destroy() };
}

registerControl("motion", createMotion);
