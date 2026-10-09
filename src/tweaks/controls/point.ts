// ── Point — 2D/3D/4D vector. Lazy.
import { el, svgEl, numField, grabSurface, boxFrac, clamp, stepPrecision, defaultRange, popover, triggerRow, registerControl } from "../shared.js";

// ── Point — a compact trigger row (label + value readout + a mini pad preview) that
// opens the 2D pad over the component number fields in a portaled popover, the way the
// colour control opens its picker. The pad drives the first
// two components; the rest are field-only. Opt out of the pad with `pad: false`.
// The component fields hold the values — everything else (readout, pad thumb, the
// emitted map) reads off them, so there's one source of truth. ──
function createPoint(meta, onChange) {
  const comps = meta.components; // [{ key, label, value, step, min, max }]

  // ── Trigger row — label + value + a mini pad preview (the colour swatch's analog). ──
  const { root, trigger, right } = triggerRow("tw-point", meta.label ?? "Point"); // ??: an explicit "" label renders none
  const valueEl = el("span", "tw-trigger-value");
  const preview = el("div", "tw-trigger-chip tw-point-preview");
  const previewDot = el("div", "tw-point-preview-dot");
  preview.append(previewDot);
  right.append(valueEl, preview);

  // ── Popover — the 2D pad over the component fields. Carries the colour popover's
  // class so it inherits its shell, tokens, and short-viewport scroll. ──
  const pop = el("div", "tw-color-pop tw-point-pop");
  const body = el("div", "tw-point-body");
  pop.append(body);

  const hasPad = meta.pad !== false && comps.length >= 2;
  // Each component's pad range + step. An absent bound defaults to the unit range widened
  // to hold the value (the slider's defaultRange rule, mirrored about the origin: a value
  // of 5 spans ±15 rather than pinning the thumb to the edge of ±1). An absent step is the
  // decade at or below range/200, so the pad is continuous — a step of 1 over ±1 only ever
  // yielded −1/0/1, and rounded an authored 0.3 to 0 on build. The fields keep only the
  // authored bounds (unbounded otherwise); the derived range is the pad's mapping.
  const rangeOf = (c) => {
    const half = defaultRange(Math.abs(Number.isFinite(+c.value) ? +c.value : 0))[1];
    const lo = c.min ?? -half, hi = c.max ?? half;
    const fine = 10 ** Math.floor(Math.log10((hi - lo) / 200));
    return { lo, hi, step: c.step ?? (fine > 0 && Number.isFinite(fine) ? fine : 1) }; // a degenerate/garbage range (hi ≤ lo, NaN bounds) keeps the old step of 1
  };
  const ranges = comps.map(rangeOf);
  const rx = ranges[0], ry = ranges[1];
  const minX = rx?.lo ?? -1, maxX = rx?.hi ?? 1, minY = ry?.lo ?? -1, maxY = ry?.hi ?? 1;
  const frac = (v, lo, hi) => (hi > lo ? clamp((v - lo) / (hi - lo), 0, 1) : 0.5);

  let padHost = null, padThumb = null, padLine = null;
  if (hasPad) {
    padHost = el("div", "tw-pad");
    padThumb = el("div", "tw-pad-thumb");
    // A polar tether from the origin (where 0,0 maps) to the thumb, so the point reads
    // as a vector (magnitude + angle). The pad is square so the angle is true.
    const padSvg = svgEl("svg", "tw-pad-line"); padSvg.setAttribute("viewBox", "0 0 100 100"); padSvg.setAttribute("preserveAspectRatio", "none");
    padLine = svgEl("line"); padSvg.append(padLine);
    // The tether origin (where 0,0 maps) is fixed for the control's life — set x1/y1 once.
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

  // Value readout for the row — the components joined, trimmed; the preview dot shows
  // the first two on a square (right = +X, up = +Y by default; set invertY for screen-space).
  // Match each component's number field: format to the step's decimal precision, so a
  // value reads "−1.00, −0.46" (steady columns), not "−1, −0.46" (trailing zeros trimmed).
  const fmt = (v, step) => (+v).toFixed(stepPrecision(step));
  const paintValue = () => { valueEl.textContent = comps.map((c, k) => fmt(flds[k].get(), ranges[k].step)).join(", "); };
  let positionPad = () => { previewDot.style.left = "50%"; previewDot.style.top = "50%"; };

  if (hasPad) {
    // The row's mini preview is tiny + clipped, so inset the dot (5px wide) to keep it
    // fully in bounds at the corners — the slider handle's "ride inside the track" trick /
    // the colour strips' inside(): the centre travels from +2.5px at 0 to −2.5px at 1.
    const DOT = 5;
    const inset = (f) => `calc(${(f * 100).toFixed(2)}% + ${((0.5 - f) * DOT).toFixed(2)}px)`;
    positionPad = () => {
      const fx = frac(flds[0].get(), minX, maxX), fyv = frac(flds[1].get(), minY, maxY);
      const tyFrac = meta.invertY ? fyv : 1 - fyv;
      const tx = fx * 100, ty = tyFrac * 100;
      padThumb.style.left = tx + "%"; padThumb.style.top = ty + "%";
      previewDot.style.left = inset(fx); previewDot.style.top = inset(tyFrac); // mini pad: dot stays in bounds
      padLine.setAttribute("x2", tx); padLine.setAttribute("y2", ty); // origin (x1,y1) is fixed — set once at setup
      padHost.setAttribute("aria-description", `${comps[0].label ?? comps[0].key} ${fmt(flds[0].get(), rx.step)}, ${comps[1].label ?? comps[1].key} ${fmt(flds[1].get(), ry.step)}`); // the pad's live readout for assistive tech
    };
    const padSet = (e) => {
      const [fx, fy] = boxFrac(e, padHost); const yFrac = meta.invertY ? fy : 1 - fy;
      flds[0].set(minX + fx * (maxX - minX)); flds[1].set(minY + yFrac * (maxY - minY));
      sync(); emit();
    };
    // .is-grabbing scales the thumb on press (CSS, spring) — the pad's echo of the slider lift.
    grabSurface(padHost, padSet);
    // Keyboard: the pad is a focusable group (no ARIA role fits a 2D point; the live
    // readout rides on aria-description). Arrows move one pad step on the matching axis
    // (⇧ = ten), inside the pad's own range like a drag; ↑ always moves the thumb up on
    // screen, so under invertY it lowers Y. Home restores the schema default. Escape is
    // the popover's (close, focus back on the trigger) — a blur here would close it
    // through focusout first and strand focus on <body>.
    padHost.tabIndex = 0; padHost.setAttribute("role", "group");
    padHost.setAttribute("aria-label", `${meta.label ?? "Point"} pad: ${comps[0].label ?? comps[0].key} and ${comps[1].label ?? comps[1].key}`);
    padHost.addEventListener("keydown", (e) => {
      if (e.key === "Home") { e.preventDefault(); comps.forEach((c, k) => flds[k].set(c.value ?? 0)); sync(); emit(); return; }
      const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0, dy = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
      if (!dx && !dy) return;
      e.preventDefault();
      const k = e.shiftKey ? 10 : 1;
      if (dx) flds[0].set(clamp(flds[0].get() + dx * rx.step * k, minX, maxX));
      if (dy) flds[1].set(clamp(flds[1].get() + (meta.invertY ? -dy : dy) * ry.step * k, minY, maxY));
      sync(); emit();
    });
  }

  root.append(pop);
  popover(root, trigger, pop, { width: 216, fallbackH: 240, gap: 6, onOpen: sync });
  sync();

  return {
    el: root,
    set: (v) => { if (v) comps.forEach((c, k) => { if (v[c.key] != null) flds[k].set(v[c.key]); }); sync(); },
    get: read,
  };
}

registerControl("point", createPoint);
