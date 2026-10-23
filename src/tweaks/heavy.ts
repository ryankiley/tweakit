/* Tweaks — what only the lazy controls use: the numeric field engine and its scrub, the
 * press-drag gesture, the SVG factory, canvas sizing and the modal-trigger row, kept out of
 * the shared chunk. It also registers the Number control, which no shorthand infers. */
import { el, btn, txt, clamp, carrySkin, quietFocus, stepPrecision, gridEnds, roundToStep, icon, registerControl } from "./shared.js";
import type { Built, NumSpec, NumField, OnChange } from "./shared.js";
import type { Meta } from "./schema.js";

const svgNS = "http://www.w3.org/2000/svg";
// The SVG twin of shared.ts's el().
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, cls?: string): Built<SVGElementTagNameMap[K]> => { const n = document.createElementNS(svgNS, tag); if (cls) n.setAttribute("class", cls); return n; };
const cssVar = (node: Element, name: string) => getComputedStyle(node).getPropertyValue(name).trim();
// One getComputedStyle for both reads — this runs in the FPS draw loop.
const accentColor = (node: Element) => { const r = getComputedStyle(node); const v = (n: string) => r.getPropertyValue(n).trim(); return v("--tw-accent") || v("--tw-text-primary") || "#fff"; };
// Select the whole value on focus (the hex field: you type a new colour, never edit a digit).
// Browsers collapse a focus-time selection on the click's own mouseup, so the first primary
// mouseup after a pointer-initiated focus is swallowed while the whole value is still selected.
const selectAllOnFocus = (input: HTMLInputElement) => {
  let swallowUp = false;
  input.addEventListener("pointerdown", (e) => { swallowUp = e.button === 0 && document.activeElement !== input; });
  input.addEventListener("focus", () => input.select());
  input.addEventListener("mouseup", (e) => {
    if (!swallowUp) return;
    swallowUp = false;
    if (e.button === 0 && document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === input.value.length) e.preventDefault();
  });
};
// Press-drag on a node: onDown on pointerdown (pointer captured), onMove per move, onEnd on
// up/cancel/lost capture or when the button releases off the node (buttons===0).
function dragGesture(node: HTMLElement, { onDown, onMove, onEnd }: { onDown?: (e: PointerEvent) => void; onMove?: (e: PointerEvent) => void; onEnd?: (e: PointerEvent) => void } = {}) {
  let activeId: number | null = null; // one captured pointer; a second finger can't fork the drag
  const end = (e: PointerEvent) => { if (activeId === null || e.pointerId !== activeId) return; activeId = null; onEnd && onEnd(e); };
  node.addEventListener("pointerdown", (e) => { if (e.button !== 0 || activeId !== null) return; activeId = e.pointerId; try { node.setPointerCapture(e.pointerId); } catch {} onDown && onDown(e); });
  node.addEventListener("pointermove", (e) => { if (e.pointerId !== activeId) return; if (e.buttons === 0) return end(e); onMove && onMove(e); });
  node.addEventListener("pointerup", end); node.addEventListener("pointercancel", end);
  node.addEventListener("lostpointercapture", end); // capture lost mid-drag (popover unmounting) ends it too
}
// Press-drag flagging .is-grabbing on the surface for the gesture's run (the thumb-lift CSS keys off it).
const grabSurface = (surface: HTMLElement, set: (e: PointerEvent) => void) => dragGesture(surface, {
  onDown: (e) => { surface.classList.add("is-grabbing"); set(e); },
  onMove: set,
  onEnd: () => surface.classList.remove("is-grabbing"),
});
// Pointer position inside a box as [x, y] fractions in 0–1.
const boxFrac = (e: MouseEvent, box: Element): [number, number] => { const r = box.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)]; };
// Size a canvas to its CSS box × devicePixelRatio (capped) and scale the context to CSS pixels; returns [cssW, cssH].
const fitCanvas = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, maxDpr = Infinity): [number, number] => {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [r.width, r.height];
};
// The modal-trigger row (colour, gradient, point): a row button, label left, a preview cluster (`right`) the caller fills.
const triggerRow = (cls: string, label: string) => {
  const root = el("div", cls);
  const trigger = btn("tw-trigger"); trigger.setAttribute("aria-expanded", "false");
  const right = el("span", "tw-trigger-right");
  trigger.append(txt("span", "tw-trigger-label", label), right);
  root.append(trigger);
  return { root, trigger, right };
};

// A 2-bar drag handle (the icon sets' grips are dots).
const ICON_GRIP = icon('<path d="M6 4v8M10 4v8"/>', "", 1.5, 16);

// Grab guide — a dotted line from the grab point to the cursor plus a value bubble, portaled
// to <body> for a drag. Its four spans (line, dot, arrow, bubble) are addressed by index.
interface GuideEl extends HTMLDivElement { readonly children: HTMLCollectionOf<HTMLSpanElement> }
function makeGrabGuide() {
  let g: GuideEl | null = null, y = 0, x0 = 0, bx = 0;
  return {
    show(x: number, atY: number, bubbleX: number | undefined, anchor: Element) {
      g = el("div", "tw-grab-guide tw-portal") as GuideEl;
      g.innerHTML = `<span class="tw-grab-line"></span><span class="tw-grab-dot"></span><span class="tw-grab-arrow"></span><span class="tw-grab-bubble"></span>`;
      y = atY; x0 = x; bx = bubbleX ?? x; // bubble anchors over the field centre, not the cursor
      g.children[1].style.cssText = `left:${x}px;top:${y}px`;
      carrySkin(g, anchor); // the anchor panel's theme + scheme, like every portal
      document.body.appendChild(g);
    },
    move(x: number, text: string) {
      if (!g) return;
      g.children[0].style.cssText = `left:${Math.min(x0, x)}px;top:${y}px;width:${Math.abs(x - x0)}px`;
      g.children[2].style.cssText = `left:${x}px;top:${y}px;transform:translate(-50%,-50%) scaleX(${x >= x0 ? 1 : -1})`; // arrowhead at the cursor, pointing in the drag direction
      g.children[3].style.cssText = `left:${bx}px;top:${y - 16}px`; g.children[3].textContent = text;
    },
    hide() { if (g) { g.remove(); g = null; } },
  };
}

// Drag-to-scrub on a grab handle: 1px ≈ one step (Shift ×10, Alt ×0.1), re-anchoring on a
// modifier change so the value never jumps. read() is the live value, text() the bubble label.
function attachScrub(grab: HTMLElement, wrap: HTMLElement, step: number, read: () => number, apply: (v: number) => void, text: () => string) {
  let downX = 0, downV = 0, curK = 1; const gd = makeGrabGuide();
  // Every end path matters: capture lost mid-scrub must still hide the full-screen guide.
  dragGesture(grab, {
    onDown: (e) => { e.preventDefault(); downX = e.clientX; downV = read(); curK = 1; grab.classList.add("is-dragging"); const br = wrap.getBoundingClientRect(); gd.show(e.clientX, br.top + br.height / 2, br.left + br.width / 2, wrap); gd.move(e.clientX, text()); },
    onMove: (e) => { const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1; if (k !== curK) { curK = k; downX = e.clientX; downV = read(); } apply(downV + (e.clientX - downX) * step * k); gd.move(e.clientX, text()); },
    onEnd: () => { grab.classList.remove("is-dragging"); gd.hide(); },
  });
}

// ── The labelled numeric field — ONE numeric engine: a sanitized step, min-anchored
// round-to-step, optional `soft`, a text input committing on change/Enter, and the grab
// handle. Two chromes: the boxed field, and with `spec.row` the row that IS the Number control. ──
function numField(spec: NumSpec, onChange?: (v: number) => void): NumField {
  // A 0/negative/non-finite step breaks round-to-step (reachable via a point component's step).
  const step = Number.isFinite(+spec.step) && +spec.step > 0 ? +spec.step : 1;
  const bound = (b: unknown) => (b == null ? NaN : +b); // null → NaN → unbounded (a null max coerced to 0)
  let min = bound(spec.min), max = bound(spec.max);
  if (Number.isFinite(min) && Number.isFinite(max) && max < min) { const t = min; min = max; max = t; } // an inverted pair would clamp every value to one end
  const anchor = Number.isFinite(min) ? min : 0, decimals = stepPrecision(step); // min-anchored, like the slider
  const [lo, hi] = gridEnds(Number.isFinite(min) ? min : -Infinity, Number.isFinite(max) ? max : Infinity, step, anchor); // on-grid ends, so fit(fit(x)) === fit(x)
  const fit = (val: number) => { const n = roundToStep(val, anchor, step); return spec.soft ? n : clamp(n, lo, hi); };
  let value = fit(Number.isFinite(+spec.value) ? +spec.value : 0);
  const root = el("div", spec.row ? "tw-row" : "tw-field");
  const wrap = el("div", "tw-num-wrap");
  const grab = el("span", "tw-num-grab", ICON_GRIP); grab.setAttribute("aria-hidden", "true"); grab.title = "Drag to adjust";
  const inp = el("input", "tw-num"); inp.type = "text"; inp.inputMode = "decimal"; inp.setAttribute("aria-label", spec.unit ? `${spec.label} (${spec.unit})` : spec.label); inp.value = value.toFixed(decimals);
  quietFocus(inp); // click-to-edit stays ringless; Tab rings
  wrap.append(grab, inp); if (spec.unit) wrap.append(txt("span", "tw-num-unit", spec.unit)); root.append(txt("span", spec.row ? "tw-row-label" : "tw-field-label", spec.label), wrap);
  const set = (val: number | string, fire = true) => { val = +val; if (!Number.isFinite(val)) return; value = fit(val); inp.value = value.toFixed(decimals); if (fire && onChange) onChange(value); };
  // Typed text is read strictly as a whole number, as the slider's editor reads it (not parseFloat, which takes "1,000"
  // as 1 and "12abc" as 12); the field's unit may be typed along. NaN for anything else.
  const typed = () => Number(inp.value.replace(spec.unit || "", "").trim() || NaN);
  // Only a readable number that lands on a new value commits; otherwise the field shows the kept value again and fires nothing.
  inp.addEventListener("change", () => { const n = typed(); if (Number.isFinite(n) && fit(n) !== value) set(n); else inp.value = value.toFixed(decimals); });
  // ↑/↓ step off the half-typed value (a typed "4" then ↑ reads 5), the keyboard twin of the scrub.
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") return inp.blur();
    const d = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0; if (!d) return;
    e.preventDefault();
    const n = typed();
    set((Number.isFinite(n) ? n : value) + d * step * (e.shiftKey ? 10 : 1));
  });
  attachScrub(grab, wrap, step, () => value, set, () => inp.value);
  return { el: root, set: (val: number | string) => set(val, false), get: () => value };
}

// ── Number — numField in its row chrome. ──
registerControl("number", (meta: Meta, onChange?: OnChange) => numField({ ...meta, row: true }, onChange));

// ── Spring step response — shared by the spring and motion controls. The window runs to the
// settle, capped at 2.2 s. ──
const springSpan = (k: number, d: number, m: number) => { const w0 = Math.sqrt(k / m), z = d / (2 * Math.sqrt(k * m)); return Math.min(2.2, 9 / Math.max(z * w0, 0.5)); };
// Closed-form step response of a damped harmonic oscillator (under/critical/over), N samples over the span.
function springCurve(k: number, d: number, m: number, N = 64, T = springSpan(k, d, m)) {
  const w0 = Math.sqrt(k / m), z = d / (2 * Math.sqrt(k * m));
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * T; let x: number;
    if (z < 1 - 1e-4) { const wd = w0 * Math.sqrt(1 - z * z); x = 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t)); }
    else if (z <= 1 + 1e-4) { x = 1 - Math.exp(-w0 * t) * (1 + w0 * t); }
    else { const s = Math.sqrt(z * z - 1), a = w0 * (z + s), b = w0 * (z - s); x = 1 - (a * Math.exp(-b * t) - b * Math.exp(-a * t)) / (a - b); }
    out.push(x);
  }
  return out;
}

export { numField, dragGesture, svgEl, cssVar, accentColor, selectAllOnFocus, grabSurface, boxFrac, fitCanvas, triggerRow, springCurve, springSpan };
