// ── Cubic bezier — interactive easing-curve editor. Lazy.
import { el, btn, txt, clamp, onReady, onLive, registerControl, words } from "../shared.js";
import { dragGesture, numField, svgEl, arrowStep } from "../heavy.js";
import { parseEasing } from "../easing.js";
import type { OnChange, Built } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control } from "../types.js";

function createBezier(meta: Meta, onChange: OnChange): Control {
  const tr = words();
  const DEF = [0.25, 0.1, 0.25, 1];
  // x must stay 0–1 for a valid cubic-bezier(); y may be anything in CSS, and −1–2 holds the overshoot curves people reach
  // for (easeOutBack's 1.56, easeInOutBack's −0.6 and 1.6), which a −0.25–1.25 clamp flattened without a word.
  const YMIN = -1,
    YMAX = 2,
    PAD = 8;
  // Fit on build as well as in set(), so an authored [1.5, 0, -0.2, 1] can't reach get() as an invalid cubic-bezier().
  const fit = (m: number[]) => m.map((n, i) => clamp(n, i % 2 ? YMIN : 0, i % 2 ? YMAX : 1));
  // The drawn y range: −0.25–1.25, grown to fit the handles. A drag holds it still, so the curve doesn't slide under the
  // pointer, and the graph fits again when the drag ends.
  let view = [-0.25, 1.25],
    held = false;
  const fitView = () => {
    if (!held) view = [Math.min(-0.25, v[1] - 0.1, v[3] - 0.1), Math.max(1.25, v[1] + 0.1, v[3] + 0.1)];
  };
  // Four numbers, or what CSS writes: a keyword (`ease-in-out`) or `cubic-bezier(…)`. Anything else opens on `ease`.
  // parseEasing reads linear as null
  const read = (x: unknown) =>
    Array.isArray(x) && x.length === 4 ? x.map(Number) : x === "linear" ? [0, 0, 1, 1] : parseEasing(x)?.slice();
  let v: number[] = read(meta.value) || DEF.slice();
  if (v.some((n) => !Number.isFinite(n))) v = DEF.slice(); // a non-finite init would show NaN and a blank curve
  v = fit(v);
  const def = v.slice(); // fitted default; Home on a handle returns to it

  const root = el("div", "twk-bezier");
  if (meta.label) root.append(txt("div", "twk-bezier-label", meta.label)); // a caption; an explicit "" skips it
  const graph = el("div", "twk-bezier-graph");
  const svg = svgEl("svg", "twk-bezier-svg");
  svg.setAttribute("preserveAspectRatio", "none");
  const unitBot = svgEl("line", "twk-bezier-guide"),
    unitTop = svgEl("line", "twk-bezier-guide");
  const diag = svgEl("line", "twk-bezier-diag"),
    line1 = svgEl("line", "twk-bezier-ctl"),
    line2 = svgEl("line", "twk-bezier-ctl");
  const curve = svgEl("path", "twk-bezier-curve");
  svg.append(unitBot, unitTop, diag, line1, line2, curve);
  const h1 = btn("twk-bezier-handle");
  h1.setAttribute("aria-label", tr("controlPoint", "Control point {n}", { n: 1 }));
  const h2 = btn("twk-bezier-handle");
  h2.setAttribute("aria-label", tr("controlPoint", "Control point {n}", { n: 2 }));
  graph.append(svg, h1, h2);
  const fields = el("div", "twk-fields twk-bezier-fields");
  root.append(graph, fields);

  let W = 0,
    H = 0;
  const xPx = (x: number) => PAD + x * (W - 2 * PAD);
  const yPx = (y: number) => H - PAD - ((y - view[0]) / (view[1] - view[0])) * (H - 2 * PAD);
  const setLine = (ln: Built<SVGLineElement>, ax: number, ay: number, bx: number, by: number) => {
    ln.setAttribute("x1", ax);
    ln.setAttribute("y1", ay);
    ln.setAttribute("x2", bx);
    ln.setAttribute("y2", by);
  };
  // The curve and handles only; the fields update separately, so a field edit doesn't re-set itself.
  const drawGraph = () => {
    // No ARIA role fits a 2D point, so the labels carry the coordinates; set before the size guard for hidden tab pages.
    h1.setAttribute("aria-label", tr("controlPointAt", "Control point {n}, x {x}, y {y}", { n: 1, x: v[0], y: v[1] }));
    h2.setAttribute("aria-label", tr("controlPointAt", "Control point {n}, x {x}, y {y}", { n: 2, x: v[2], y: v[3] }));
    // Layout px, not getBoundingClientRect: under an ancestor CSS scale the rect sat the handles off the curve.
    W = graph.offsetWidth;
    H = graph.offsetHeight;
    if (W < 2) return;
    fitView();
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const [x1, y1, x2, y2] = v;
    const ax = xPx(0),
      ay = yPx(0),
      bx = xPx(1),
      by = yPx(1),
      p1x = xPx(x1),
      p1y = yPx(y1),
      p2x = xPx(x2),
      p2y = yPx(y2);
    setLine(unitBot, PAD, ay, W - PAD, ay);
    setLine(unitTop, PAD, by, W - PAD, by);
    setLine(diag, ax, ay, bx, by);
    setLine(line1, ax, ay, p1x, p1y);
    setLine(line2, bx, by, p2x, p2y);
    curve.setAttribute("d", `M${ax},${ay} C${p1x},${p1y} ${p2x},${p2y} ${bx},${by}`);
    h1.style.left = p1x + "px";
    h1.style.top = p1y + "px";
    h2.style.left = p2x + "px";
    h2.style.top = p2y + "px";
  };

  const SPECS = [
    { label: "X1", i: 0, lo: 0, hi: 1 },
    { label: "Y1", i: 1, lo: YMIN, hi: YMAX },
    { label: "X2", i: 2, lo: 0, hi: 1 },
    { label: "Y2", i: 3, lo: YMIN, hi: YMAX },
  ];
  const flds = SPECS.map((sp) => {
    const fld = numField({ label: sp.label, value: v[sp.i], step: 0.01, min: sp.lo, max: sp.hi }, (val) => {
      v[sp.i] = val;
      drawGraph();
      onChange(v.slice());
    });
    fields.append(fld.el);
    return fld;
  });
  const syncFields = () => flds.forEach((fld, k) => fld.set(v[SPECS[k].i]));

  const drag = (handle: HTMLButtonElement, idx: number) => {
    let rect: DOMRect | null = null,
      gw = 0,
      gh = 0,
      scale = 1;
    dragGesture(handle, {
      // Divide out any ancestor CSS transform (rect is visual px, offsetWidth layout px); preventDefault killed click-to-focus.
      onDown: (e) => {
        e.preventDefault();
        rect = graph.getBoundingClientRect();
        gw = graph.offsetWidth || rect.width;
        gh = graph.offsetHeight || rect.height;
        scale = rect.width / gw;
        handle.classList.add("is-dragging");
        handle.focus({ focusVisible: false });
        held = true;
      },
      onMove: (e) => {
        const gx = (e.clientX - rect.left) / scale,
          gy = (e.clientY - rect.top) / scale;
        const x = clamp((gx - PAD) / (gw - 2 * PAD), 0, 1);
        const y = clamp(view[0] + ((gh - PAD - gy) / (gh - 2 * PAD)) * (view[1] - view[0]), YMIN, YMAX);
        v[idx * 2] = +x.toFixed(2);
        v[idx * 2 + 1] = +y.toFixed(2);
        drawGraph();
        syncFields();
        onChange(v.slice());
      },
      onEnd: () => {
        rect = null;
        handle.classList.remove("is-dragging");
        held = false;
        drawGraph();
      },
    });
    // Keyboard: arrows nudge by 0.01 (⇧ = 0.1) on the drag's clamps and grid, Home restores the default, Escape drops focus.
    handle.addEventListener("keydown", (e) => {
      if (e.key === "Escape") return handle.blur();
      if (e.key === "Home") {
        e.preventDefault();
        v = def.slice();
        drawGraph();
        syncFields();
        onChange(v.slice());
        return;
      }
      const [dx, dy] = arrowStep(e);
      if (!dx && !dy) return;
      e.preventDefault();
      const k = e.shiftKey ? 0.1 : 0.01,
        i = idx * 2;
      if (dx) v[i] = +clamp(v[i] + dx * k, 0, 1).toFixed(2);
      if (dy) v[i + 1] = +clamp(v[i + 1] + dy * k, YMIN, YMAX).toFixed(2);
      drawGraph();
      syncFields();
      onChange(v.slice());
    });
  };
  drag(h1, 0);
  drag(h2, 1);

  onReady(drawGraph);
  // twk-reflow: a tab page revealing this re-measures it
  onLive(
    root,
    [
      [window, "resize"],
      [window, "twk-reflow"],
    ],
    drawGraph,
  );
  // the build's clamp, so get() agrees with the handles
  return {
    el: root,
    set: (nv: unknown) => {
      const m = read(nv);
      if (m) {
        if (m.some((n) => !Number.isFinite(n))) return;
        v = fit(m);
        drawGraph();
        syncFields();
      }
    },
    get: () => v.slice(),
  };
}

registerControl("cubicbezier", createBezier);
