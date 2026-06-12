// ── Cubic bezier — interactive easing-curve editor. Lazy.
import { el, btn, svgEl, numField, dragGesture, clamp, onReady, onLive, registerControl } from "../shared.js";

// ── Cubic bezier — an interactive curve editor (Tweakpane's plugin-essentials
// CubicBezier): two draggable control points over a unit box, value [x1,y1,x2,y2]
// like CSS cubic-bezier(). x is clamped to [0,1]; y may overshoot for bounce. ──
function createBezier(meta, onChange) {
  const DEF = [0.25, 0.1, 0.25, 1];
  let v = Array.isArray(meta.value) && meta.value.length === 4 ? meta.value.map(Number) : DEF.slice();
  if (v.some((n) => !Number.isFinite(n))) v = DEF.slice(); // a non-finite init (e.g. data-value="oops") would show "NaN" + a blank curve; set() already guards this
  const YMIN = -0.25, YMAX = 1.25, RANGE = YMAX - YMIN, PAD = 8;

  const root = el("div", "tw-bezier");
  const graph = el("div", "tw-bezier-graph");
  const svg = svgEl("svg", "tw-bezier-svg"); svg.setAttribute("preserveAspectRatio", "none");
  const unitBot = svgEl("line", "tw-bezier-guide"), unitTop = svgEl("line", "tw-bezier-guide");
  const diag = svgEl("line", "tw-bezier-diag"), line1 = svgEl("line", "tw-bezier-ctl"), line2 = svgEl("line", "tw-bezier-ctl");
  const curve = svgEl("path", "tw-bezier-curve");
  svg.append(unitBot, unitTop, diag, line1, line2, curve);
  const h1 = btn("tw-bezier-handle"); h1.setAttribute("aria-label", "Control point 1");
  const h2 = btn("tw-bezier-handle"); h2.setAttribute("aria-label", "Control point 2");
  graph.append(svg, h1, h2);
  const fields = el("div", "tw-fields tw-bezier-fields");
  root.append(graph, fields);

  let W = 0, H = 0;
  const xPx = (x) => PAD + x * (W - 2 * PAD);
  const yPx = (y) => (H - PAD) - ((y - YMIN) / RANGE) * (H - 2 * PAD);
  const setLine = (ln, ax, ay, bx, by) => { ln.setAttribute("x1", ax); ln.setAttribute("y1", ay); ln.setAttribute("x2", bx); ln.setAttribute("y2", by); };
  // draw just the curve + handles from v (the fields update separately, so a
  // field edit doesn't recursively re-set itself)
  const drawGraph = () => {
    // Layout px, not getBoundingClientRect (visual px): the handles are positioned with
    // style.left in layout space, so under an ancestor CSS scale the rect-derived sizes
    // sat them off the curve.
    W = graph.offsetWidth; H = graph.offsetHeight; if (W < 2) return;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const [x1, y1, x2, y2] = v;
    const ax = xPx(0), ay = yPx(0), bx = xPx(1), by = yPx(1), p1x = xPx(x1), p1y = yPx(y1), p2x = xPx(x2), p2y = yPx(y2);
    setLine(unitBot, PAD, ay, W - PAD, ay); setLine(unitTop, PAD, by, W - PAD, by);
    setLine(diag, ax, ay, bx, by); setLine(line1, ax, ay, p1x, p1y); setLine(line2, bx, by, p2x, p2y);
    curve.setAttribute("d", `M${ax},${ay} C${p1x},${p1y} ${p2x},${p2y} ${bx},${by}`);
    h1.style.left = p1x + "px"; h1.style.top = p1y + "px"; h2.style.left = p2x + "px"; h2.style.top = p2y + "px";
  };

  // editable value fields (X1, Y1, X2, Y2) — Tweakpane's "something like this":
  // x clamps to [0,1], y is free to overshoot. Drag a handle and they update.
  const SPECS = [{ label: "X1", i: 0, lo: 0, hi: 1 }, { label: "Y1", i: 1, lo: YMIN, hi: YMAX }, { label: "X2", i: 2, lo: 0, hi: 1 }, { label: "Y2", i: 3, lo: YMIN, hi: YMAX }];
  const flds = SPECS.map((sp) => {
    const fld = numField({ label: sp.label, value: v[sp.i], step: 0.01, min: sp.lo, max: sp.hi }, (val) => { v[sp.i] = val; drawGraph(); onChange(v.slice()); });
    fields.append(fld.el); return fld;
  });
  const syncFields = () => flds.forEach((fld, k) => fld.set(v[SPECS[k].i]));

  const drag = (handle, idx) => {
    let rect = null, gw = 0, gh = 0, scale = 1;
    dragGesture(handle, {
      // Divide out any ancestor CSS transform (rect is visual px, offsetWidth layout px) —
      // interval's valFromX correction. preventDefault suppresses click-to-focus on the
      // button, so focus explicitly and keyboard can take over after a grab.
      onDown: (e) => { e.preventDefault(); rect = graph.getBoundingClientRect(); gw = graph.offsetWidth || rect.width; gh = graph.offsetHeight || rect.height; scale = rect.width / gw; handle.classList.add("is-dragging"); handle.focus({ focusVisible: false }); }, // focus for keyboard nudging, but no keyboard ring on a mouse press; Tab still rings
      onMove: (e) => {
        const gx = (e.clientX - rect.left) / scale, gy = (e.clientY - rect.top) / scale;
        const x = clamp((gx - PAD) / (gw - 2 * PAD), 0, 1);
        const y = clamp(YMIN + ((gh - PAD) - gy) / (gh - 2 * PAD) * RANGE, YMIN, YMAX);
        v[idx * 2] = +x.toFixed(2); v[idx * 2 + 1] = +y.toFixed(2); drawGraph(); syncFields(); onChange(v.slice());
      },
      onEnd: () => { rect = null; handle.classList.remove("is-dragging"); },
    });
  };
  drag(h1, 0); drag(h2, 1);

  onReady(drawGraph);
  onLive(root, [[window, "resize"], [window, "tw-reflow"]], drawGraph); // tw-reflow: a tab page revealing this control re-measures it (it built at 0×0 while hidden); self-cleans once the panel is gone
  return { el: root, set: (nv) => { if (Array.isArray(nv) && nv.length === 4) { const m = nv.map(Number); if (m.some((n) => !Number.isFinite(n))) return; v = m.map((n, i) => clamp(n, SPECS[i].lo, SPECS[i].hi)); drawGraph(); syncFields(); } }, get: () => v.slice() }; // clamp each to its field range so get() agrees with the handles + fields
}

registerControl("cubicbezier", createBezier);

