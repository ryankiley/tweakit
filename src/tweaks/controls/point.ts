// ── Point — 2D/3D/4D component fields with an optional drag pad. Lazy.
import { el, svgEl, numField, dragGesture, boxFrac, clamp, registerControl } from "../shared.js";

// ── Point — a row of labelled numeric components (Tweakpane's point2d/3d/4d).
// The grouped grab-handle fields you see on Spring, made a control of its own. ──
function createPoint(meta, onChange) {
  const comps = meta.components; // [{ key, label, value, step, min, max }]
  const out = {};
  const root = el("div", "tw-point");
  // Optional 2D drag pad (meta.pad, 2 components only) — a square plane driving the
  // first two components at once (leva's joystick / Tweakpane's point2d picker).
  // Right = +X; up = +Y by default (set invertY for screen-space, where down = +Y).
  // Modelled on the colour area's drag; falls back to the numeric fields when off.
  let positionPad = () => {};
  const hasPad = !!meta.pad && comps.length === 2;
  const padHost = hasPad ? el("div", "tw-pad") : null;
  if (padHost) root.append(padHost); // the pad sits above the numeric fields
  const fields = el("div", "tw-fields");
  root.append(fields);
  const flds = comps.map((c) => {
    const fld = numField({ label: c.label, value: c.value ?? 0, step: c.step ?? 1, min: c.min, max: c.max }, (val) => { out[c.key] = val; positionPad(); onChange({ ...out }); });
    out[c.key] = fld.get(); // mirror the field's sanitized value, not the raw c.value (which may be non-finite)
    fields.append(fld.el); return fld;
  });
  if (hasPad) {
    const cx = comps[0], cy = comps[1];
    const minX = cx.min ?? -1, maxX = cx.max ?? 1, minY = cy.min ?? -1, maxY = cy.max ?? 1;
    const padThumb = el("div", "tw-pad-thumb");
    // A polar tether — a line from the origin (where 0,0 maps) to the thumb, so the
    // point reads as a vector (magnitude + angle). The pad is square so the angle is true.
    const padSvg = svgEl("svg", "tw-pad-line"); padSvg.setAttribute("viewBox", "0 0 100 100"); padSvg.setAttribute("preserveAspectRatio", "none");
    const padLine = svgEl("line"); padSvg.append(padLine);
    padHost.append(el("div", "tw-pad-axis tw-pad-axis-x"), el("div", "tw-pad-axis tw-pad-axis-y"), padSvg, padThumb);
    const frac = (v, lo, hi) => (hi > lo ? clamp((v - lo) / (hi - lo), 0, 1) : 0.5);
    positionPad = () => {
      const fx = frac(out[cx.key], minX, maxX), fyv = frac(out[cy.key], minY, maxY);
      const tx = fx * 100, ty = (meta.invertY ? fyv : 1 - fyv) * 100;
      padThumb.style.left = tx + "%"; padThumb.style.top = ty + "%";
      const ox = frac(0, minX, maxX) * 100, oyv = frac(0, minY, maxY), oy = (meta.invertY ? oyv : 1 - oyv) * 100;
      padLine.setAttribute("x1", ox); padLine.setAttribute("y1", oy); padLine.setAttribute("x2", tx); padLine.setAttribute("y2", ty);
    };
    const padXY = (e) => boxFrac(e, padHost);
    const padSet = (e) => {
      const [fx, fy] = padXY(e); const yFrac = meta.invertY ? fy : 1 - fy;
      flds[0].set(minX + fx * (maxX - minX)); flds[1].set(minY + yFrac * (maxY - minY));
      out[cx.key] = flds[0].get(); out[cy.key] = flds[1].get();
      positionPad(); onChange({ ...out });
    };
    // .is-grabbing scales the thumb on press (CSS, spring) — the pad's echo of the slider lift.
    dragGesture(padHost, {
      onDown: (e) => { padHost.classList.add("is-grabbing"); padSet(e); },
      onMove: padSet,
      onEnd: () => padHost.classList.remove("is-grabbing"),
    });
  }
  positionPad();
  return { el: root, set: (v) => { if (v) comps.forEach((c, k) => { if (v[c.key] != null) { flds[k].set(v[c.key]); out[c.key] = flds[k].get(); } }); positionPad(); }, get: () => ({ ...out }) };
}

registerControl("point", createPoint);

