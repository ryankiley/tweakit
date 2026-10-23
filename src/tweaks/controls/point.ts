// ── Point — 2D/3D/4D vector. Lazy.
import { el, clamp, stepPrecision, defaultRange, popover, registerControl, announce } from "../shared.js";
import { numField, svgEl, grabSurface, boxFrac, triggerRow } from "../heavy.js";
import type { OnChange, Built } from "../shared.js";
import type { Meta, PointComponent } from "../schema.js";
import type { Control } from "../types.js";

// A trigger row opens the 2D pad over the component fields in a popover. The fields hold the values; readout, thumb
// and emitted map read off them. `pad: false` opts out.
function createPoint(meta: Meta, onChange: OnChange): Control {
  const comps = meta.components; // [{ key, label, value, step, min, max }]

  // ── Trigger row — label + value + a mini pad preview. ──
  const { root, trigger, right } = triggerRow("tw-point", meta.label ?? "Point"); // ??: an explicit "" label renders none
  const valueEl = el("span", "tw-trigger-value");
  const preview = el("div", "tw-trigger-chip tw-point-preview");
  const previewDot = el("div", "tw-point-preview-dot");
  preview.append(previewDot);
  right.append(preview, valueEl); // chip first, as every chip row

  // ── Popover — the 2D pad over the component fields. ──
  const pop = el("div", "tw-color-pop tw-point-pop");
  const body = el("div", "tw-point-body");
  pop.append(body);

  const hasPad = meta.pad !== false && comps.length >= 2;
  // An absent bound is the unit range widened to hold the value, mirrored about the origin (5 spans ±15); an absent
  // step is the decade at or below range/200, so the pad is continuous.
  const rangeOf = (c: PointComponent) => {
    const half = defaultRange(Math.abs(Number.isFinite(+c.value) ? +c.value : 0))[1];
    const lo = c.min ?? -half, hi = c.max ?? half;
    const fine = 10 ** Math.floor(Math.log10((hi - lo) / 200));
    return { lo, hi, step: c.step ?? (fine > 0 && Number.isFinite(fine) ? fine : 1) }; // a degenerate range (hi ≤ lo, NaN) keeps a step of 1
  };
  const ranges = comps.map(rangeOf);
  const rx = ranges[0], ry = ranges[1];
  const minX = rx?.lo ?? -1, maxX = rx?.hi ?? 1, minY = ry?.lo ?? -1, maxY = ry?.hi ?? 1;
  const frac = (v: number, lo: number, hi: number) => (hi > lo ? clamp((v - lo) / (hi - lo), 0, 1) : 0.5);

  let padHost: HTMLDivElement | null = null, padThumb: HTMLDivElement | null = null, padLine: Built<SVGLineElement> | null = null;
  if (hasPad) {
    padHost = el("div", "tw-pad");
    padThumb = el("div", "tw-pad-thumb");
    // A tether from the origin to the thumb, so the point reads as a vector; the pad is square so the angle is true.
    const padSvg = svgEl("svg", "tw-pad-line"); padSvg.setAttribute("viewBox", "0 0 100 100"); padSvg.setAttribute("preserveAspectRatio", "none");
    padLine = svgEl("line"); padSvg.append(padLine);
    // The origin is fixed for the control's life: set x1/y1 once.
    const oy0 = frac(0, minY, maxY); padLine.setAttribute("x1", frac(0, minX, maxX) * 100); padLine.setAttribute("y1", (meta.invertY ? oy0 : 1 - oy0) * 100);
    padHost.append(el("div", "tw-pad-axis tw-pad-axis-x"), el("div", "tw-pad-axis tw-pad-axis-y"), padSvg, padThumb);
    body.append(padHost);
  }

  const fields = el("div", "tw-fields");
  body.append(fields);
  const sync = () => { positionPad(); paintValue(); };
  const emit = () => onChange(read());
  const flds = comps.map((c, k) => {
    const fld = numField({ label: c.label, value: c.value ?? 0, step: ranges[k].step, min: c.min, max: c.max }, () => { sync(); emit(); });
    fields.append(fld.el); return fld;
  });
  const read = () => Object.fromEntries(comps.map((c, k) => [c.key, flds[k].get()])); // the emitted map, straight off the fields

  // Readout: the components at each step's precision, so a value reads "−1.00, −0.46" (steady columns), not "−1, −0.46".
  const fmt = (v: number, step: number) => (+v).toFixed(stepPrecision(step));
  const paintValue = () => { valueEl.textContent = comps.map((c, k) => fmt(flds[k].get(), ranges[k].step)).join(", "); };
  let positionPad = () => { previewDot.style.left = "50%"; previewDot.style.top = "50%"; };

  if (hasPad) {
    // The mini preview is clipped, so inset the 5px dot: its centre travels from +2.5px at 0 to −2.5px at 1.
    const DOT = 5;
    const inset = (f: number) => `calc(${(f * 100).toFixed(2)}% + ${((0.5 - f) * DOT).toFixed(2)}px)`;
    positionPad = () => {
      const fx = frac(flds[0].get(), minX, maxX), fyv = frac(flds[1].get(), minY, maxY);
      const tyFrac = meta.invertY ? fyv : 1 - fyv;
      const tx = fx * 100, ty = tyFrac * 100;
      padThumb.style.left = tx + "%"; padThumb.style.top = ty + "%";
      previewDot.style.left = inset(fx); previewDot.style.top = inset(tyFrac); // mini pad: dot stays in bounds
      padLine.setAttribute("x2", tx); padLine.setAttribute("y2", ty);
      padHost.setAttribute("aria-description", `${comps[0].label ?? comps[0].key} ${fmt(flds[0].get(), rx.step)}, ${comps[1].label ?? comps[1].key} ${fmt(flds[1].get(), ry.step)}`); // the pad's live readout for assistive tech
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
    padHost.setAttribute("aria-label", `${meta.label ?? "Point"} pad: ${comps[0].label ?? comps[0].key} and ${comps[1].label ?? comps[1].key}`);
    // The readout rides on aria-description, which a screen reader speaks on focus and never again: say where a run of keys stopped.
    let sayT = 0;
    const say = () => { clearTimeout(sayT); sayT = setTimeout(() => { if (padHost.isConnected) announce(padHost.getAttribute("aria-description") || ""); }, 250); };
    padHost.addEventListener("keydown", (e) => {
      if (e.key === "Home") { e.preventDefault(); comps.forEach((c, k) => flds[k].set(c.value ?? 0)); sync(); emit(); say(); return; }
      const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0, dy = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
      if (!dx && !dy) return;
      e.preventDefault();
      const k = e.shiftKey ? 10 : 1;
      if (dx) flds[0].set(clamp(flds[0].get() + dx * rx.step * k, minX, maxX));
      if (dy) flds[1].set(clamp(flds[1].get() + (meta.invertY ? -dy : dy) * ry.step * k, minY, maxY));
      sync(); emit(); say();
    });
  }

  root.append(pop);
  popover(root, trigger, pop, { width: 216, fallbackH: 240, gap: 6, onOpen: sync });
  sync();

  return {
    el: root,
    set: (v: Record<string, number | string>) => { if (v) comps.forEach((c, k) => { if (v[c.key] != null) flds[k].set(v[c.key]); }); sync(); },
    get: read,
  };
}

registerControl("point", createPoint);
