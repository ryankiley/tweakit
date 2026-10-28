// ── Point — 2D/3D/4D vector. Lazy.
import { el, clamp, stepPrecision, defaultRange, popover, registerControl, words } from "../shared.js";
import { numField, svgEl, grabSurface, boxFrac, arrowStep, sayWhenKeysStop, triggerRow, decimalStep } from "../heavy.js";
import type { OnChange, Built } from "../shared.js";
import type { Meta, PointComponent } from "../schema.js";
import type { Control } from "../types.js";

// A trigger row opens the 2D pad over the component fields in a popover. The fields hold the values; readout, thumb
// and emitted map read off them. `pad: false` opts out.
function createPoint(meta: Meta, onChange: OnChange): Control {
  const tr = words();
  const comps = meta.components; // [{ key, label, value, step, min, max }]

  // ── Trigger row — label + value + a mini pad preview. ──
  // ??: an explicit "" label renders none
  const { root, trigger, right } = triggerRow("twk-point", meta.label ?? tr("point", "Point"));
  const valueEl = el("span", "twk-trigger-value");
  const preview = el("div", "twk-trigger-chip twk-point-preview");
  const previewDot = el("div", "twk-point-preview-dot");
  preview.append(previewDot);
  right.append(preview, valueEl); // chip first, as every chip row

  // ── Popover — the 2D pad over the component fields. ──
  const pop = el("div", "twk-color-pop twk-point-pop");
  const body = el("div", "twk-point-body");
  pop.append(body);

  const hasPad = meta.pad !== false && comps.length >= 2;
  // An absent bound is the unit range widened to hold the value, mirrored about the origin (5 spans ±15); an absent
  // step is the decade at or below range/200, so the pad is continuous, and finer when the default or min sits between
  // its steps (337 over ±1011 stepped by 10 to 340), as the slider's step fits its default.
  const rangeOf = (c: PointComponent) => {
    const half = defaultRange(Math.abs(Number.isFinite(+c.value) ? +c.value : 0))[1];
    let lo = c.min ?? -half, hi = c.max ?? half;
    // A lone bound at or past the other end spans from itself instead, as the slider's does (min 5 over 0 spans 5–35, not 5–1, swapped).
    if ((c.min == null) !== (c.max == null) && !(hi > lo)) { const w = 2 * defaultRange(Math.abs(+(c.min ?? c.max)!))[1]; if (c.min == null) lo = hi - w; else hi = lo + w; }
    // a degenerate range (hi ≤ lo, NaN) keeps a step of 1
    const fine = 10 ** Math.floor(Math.log10((hi - lo) / 200)), nudge = c.step ?? (fine > 0 && Number.isFinite(fine) ? fine : 1);
    // the pad's arrows keep the decade: 3.14159's 0.00001 would crawl
    return { lo, hi, nudge, step: c.step ?? Math.min(nudge, decimalStep(c.value), decimalStep(c.min)) };
  };
  const ranges = comps.map(rangeOf);
  const rx = ranges[0], ry = ranges[1];
  const minX = rx?.lo ?? -1, maxX = rx?.hi ?? 1, minY = ry?.lo ?? -1, maxY = ry?.hi ?? 1;
  const frac = (v: number, lo: number, hi: number) => (hi > lo ? clamp((v - lo) / (hi - lo), 0, 1) : 0.5);

  let padHost: HTMLDivElement | null = null, padThumb: HTMLDivElement | null = null, padLine: Built<SVGLineElement> | null = null;
  if (hasPad) {
    padHost = el("div", "twk-pad");
    padThumb = el("div", "twk-pad-thumb");
    // A tether from the origin to the thumb, so the point reads as a vector; the pad is square so the angle is true.
    const padSvg = svgEl("svg", "twk-pad-line"); padSvg.setAttribute("viewBox", "0 0 100 100"); padSvg.setAttribute("preserveAspectRatio", "none");
    padLine = svgEl("line"); padSvg.append(padLine);
    // The origin is fixed for the control's life: set x1/y1 once.
    const oy0 = frac(0, minY, maxY); padLine.setAttribute("x1", frac(0, minX, maxX) * 100); padLine.setAttribute("y1", (meta.invertY ? oy0 : 1 - oy0) * 100);
    padHost.append(el("div", "twk-pad-axis twk-pad-axis-x"), el("div", "twk-pad-axis twk-pad-axis-y"), padSvg, padThumb);
    body.append(padHost);
  }

  const fields = el("div", "twk-fields");
  body.append(fields);
  const sync = () => { positionPad(); paintValue(); };
  const emit = () => onChange(read());
  const flds = comps.map((c, k) => {
    const fld = numField({ label: c.label ?? c.key, value: c.value ?? 0, step: ranges[k].step, min: c.min, max: c.max }, () => { sync(); emit(); });
    fields.append(fld.el); return fld;
  });
  // the emitted map, straight off the fields
  const read = () => Object.fromEntries(comps.map((c, k) => [c.key, flds[k].get()]));

  // Readout: the components at each step's precision, so a value reads "−1.00, −0.46" (steady columns), not "−1, −0.46".
  const fmt = (v: number, step: number) => (+v).toFixed(stepPrecision(step));
  const paintValue = () => { valueEl.textContent = flds.map((f, k) => fmt(f.get(), ranges[k].step)).join(", "); };
  let positionPad = () => { previewDot.style.left = "50%"; previewDot.style.top = "50%"; };

  if (hasPad) {
    // The mini preview is clipped, so inset the 5px dot: its center travels from +2.5px at 0 to −2.5px at 1.
    const DOT = 5;
    const inset = (f: number) => `calc(${(f * 100).toFixed(2)}% + ${((0.5 - f) * DOT).toFixed(2)}px)`;
    positionPad = () => {
      const fx = frac(flds[0].get(), minX, maxX), fyv = frac(flds[1].get(), minY, maxY);
      const tyFrac = meta.invertY ? fyv : 1 - fyv;
      const tx = fx * 100, ty = tyFrac * 100;
      padThumb.style.left = tx + "%"; padThumb.style.top = ty + "%";
      previewDot.style.left = inset(fx); previewDot.style.top = inset(tyFrac); // mini pad: dot stays in bounds
      padLine.setAttribute("x2", tx); padLine.setAttribute("y2", ty);
      // the pad's live readout for assistive tech
      padHost.setAttribute("aria-description", `${comps[0].label ?? comps[0].key} ${fmt(flds[0].get(), rx.step)}, ${comps[1].label ?? comps[1].key} ${fmt(flds[1].get(), ry.step)}`);
    };
    const padSet = (e: PointerEvent) => {
      const [fx, fy] = boxFrac(e, padHost); const yFrac = meta.invertY ? fy : 1 - fy;
      flds[0].set(minX + fx * (maxX - minX)); flds[1].set(minY + yFrac * (maxY - minY));
      sync(); emit();
    };
    grabSurface(padHost, padSet);
    // Keyboard: a focusable group (no ARIA role fits a 2D point; the readout rides on aria-description). Arrows move a
    // pad step (⇧ = ten), ↑ always up on screen; Home restores the default. Escape is the popover's — a blur here would close it first.
    padHost.tabIndex = 0; padHost.setAttribute("role", "group");
    padHost.setAttribute("aria-label", tr("pointPad", "{label} pad: {x} and {y}", { label: meta.label ?? tr("point", "Point"), x: comps[0].label ?? comps[0].key, y: comps[1].label ?? comps[1].key }));
    const say = sayWhenKeysStop(padHost);
    padHost.addEventListener("keydown", (e) => {
      if (e.key === "Home") { e.preventDefault(); comps.forEach((c, k) => flds[k].set(c.value ?? 0)); sync(); emit(); say(); return; }
      const [dx, dy] = arrowStep(e);
      if (!dx && !dy) return;
      e.preventDefault();
      const k = e.shiftKey ? 10 : 1;
      if (dx) flds[0].set(clamp(flds[0].get() + dx * rx.nudge * k, minX, maxX));
      if (dy) flds[1].set(clamp(flds[1].get() + (meta.invertY ? -dy : dy) * ry.nudge * k, minY, maxY));
      sync(); emit(); say();
    });
  }

  root.append(pop);
  popover(root, trigger, pop, { fallbackH: 240, onOpen: sync });
  sync();

  return {
    el: root,
    set: (v: Record<string, number | string>) => { if (v) comps.forEach((c, k) => { if (v[c.key] != null) flds[k].set(v[c.key]); }); sync(); },
    get: read,
    range: Object.fromEntries(comps.map((c, k) => [c.key, flds[k].range])),
  };
}

registerControl("point", createPoint);
