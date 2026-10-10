/* Tweaks — what only the lazy (heavy) controls use: the numeric field engine (numField,
 * its drag-to-scrub and grab guide), the press-drag gesture and the plane/pad drag
 * surface built on it, the SVG factory, canvas sizing and accent reads, select-on-focus
 * for the hex field, and the modal-trigger row. Kept out of shared.ts so it rides in a
 * lazy chunk instead of the shared chunk every basic panel fetches up front. It also
 * registers the Number control — numField in its row chrome — which no shorthand infers,
 * so the lazy map loads this module for it directly. */
import { el, btn, txt, clamp, carrySkin, quietFocus, stepPrecision, gridEnds, roundToStep, icon, registerControl } from "./shared.js";
import type { Built, NumSpec, NumField, OnChange } from "./shared.js";
import type { Meta } from "./schema.js";

const svgNS = "http://www.w3.org/2000/svg";
// The SVG twin of shared.ts's el().
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, cls?: string): Built<SVGElementTagNameMap[K]> => { const n = document.createElementNS(svgNS, tag); if (cls) n.setAttribute("class", cls); return n; };
// A resolved custom property off a node; accentColor picks the panel accent and
// falls back to the primary text colour then white (canvas strokes need a literal).
const cssVar = (node: Element, name: string) => getComputedStyle(node).getPropertyValue(name).trim();
// Resolve the computed style once and read both custom props off it — cssVar would call
// getComputedStyle a second time on the fallback, and accentColor runs in the FPS draw loop.
const accentColor = (node: Element) => { const r = getComputedStyle(node); const v = (n: string) => r.getPropertyValue(n).trim(); return v("--tw-accent") || v("--tw-text-primary") || "#fff"; };
// Select the whole value when a text field takes focus, so a click into it replaces the
// value on the first keystroke instead of inserting at the caret (the hex field: you
// paste or type a new colour, never edit one digit). Browsers collapse a focus-time
// selection on the click's own mouseup, so the first primary-button mouseup after a
// pointer-initiated focus is swallowed while the whole value is still selected — its only
// default is that caret placement (a middle button's mouseup carries the X11 paste, so it
// is left alone, and a press that ended elsewhere leaves nothing to protect). Keyboard
// focus selects natively, and a later click inside an already-focused field places the
// caret as usual. As with any select-on-focus field, a drag on that first press moves the
// selected text rather than selecting a range; the second press drag-selects natively.
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
// Press-drag on a node: onDown fires on pointerdown (pointer captured), onMove on
// each move; it ends on pointerup/cancel/lost capture or when the button releases off
// the node (buttons===0), then onEnd runs. The shape behind the colour plane/strips,
// the point pad, the bezier handles, the gradient stops, the interval, and the number
// scrub — only the slider (its spring detent) and the panel header (its click-vs-drag
// threshold) keep bespoke loops.
function dragGesture(node: HTMLElement, { onDown, onMove, onEnd }: { onDown?: (e: PointerEvent) => void; onMove?: (e: PointerEvent) => void; onEnd?: (e: PointerEvent) => void } = {}) {
  let activeId: number | null = null; // the one captured pointer — a second finger / other-button press can't hijack or fork the drag
  const end = (e: PointerEvent) => { if (activeId === null || e.pointerId !== activeId) return; activeId = null; onEnd && onEnd(e); };
  node.addEventListener("pointerdown", (e) => { if (e.button !== 0 || activeId !== null) return; activeId = e.pointerId; try { node.setPointerCapture(e.pointerId); } catch {} onDown && onDown(e); });
  node.addEventListener("pointermove", (e) => { if (e.pointerId !== activeId) return; if (e.buttons === 0) return end(e); onMove && onMove(e); });
  node.addEventListener("pointerup", end); node.addEventListener("pointercancel", end);
  node.addEventListener("lostpointercapture", end); // implicit capture loss (the popover unmounting mid-drag) ends the gesture too, so grab state can't strand
}
// Press-drag that flags .is-grabbing on the surface for the gesture's run (the thumb-lift
// CSS keys off it) — the colour plane/strips and the point pad share this exact shape.
// (Spring/bezier keep their own dragGesture: they use .is-dragging and capture a rect on down.)
const grabSurface = (surface: HTMLElement, set: (e: PointerEvent) => void) => dragGesture(surface, {
  onDown: (e) => { surface.classList.add("is-grabbing"); set(e); },
  onMove: set,
  onEnd: () => surface.classList.remove("is-grabbing"),
});
// Pointer position inside a box as [x, y] fractions in 0–1 — read off the box's own
// rect (the colour plane/strips and the point pad).
const boxFrac = (e: MouseEvent, box: Element): [number, number] => { const r = box.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)]; };
// Size a canvas to its CSS box × devicePixelRatio (capped at maxDpr) and scale the
// context to draw in CSS pixels; returns [cssW, cssH]. The fps + monitor graphs.
const fitCanvas = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, maxDpr = Infinity): [number, number] => {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [r.width, r.height];
};
// The modal-trigger row shared by the colour, gradient, and point controls: a
// full-width row button — label left, a preview cluster (`right`) the caller fills —
// that opens the control's popover. The caller appends its pop and wires popover().
const triggerRow = (cls: string, label: string) => {
  const root = el("div", cls);
  const trigger = btn("tw-trigger"); trigger.setAttribute("aria-expanded", "false");
  const right = el("span", "tw-trigger-right");
  trigger.append(txt("span", "tw-trigger-label", label), right);
  root.append(trigger);
  return { root, trigger, right };
};

// ICON_GRIP — original 2-bar drag handle, not from an icon set (the icon sets' grips are dots).
const ICON_GRIP = icon('<path d="M6 4v8M10 4v8"/>', "", 1.5, 16);

// Grab guide — a dotted line from the grab point to the cursor
// plus a floating value bubble, portaled to <body> for the duration of a drag.
// Shared by every numField (the Number control, Spring / Point / Bezier / the colour channels).
// The guide node's four parts (line, dot, arrow, bubble) are the spans its innerHTML
// below sets, addressed by index.
interface GuideEl extends HTMLDivElement { readonly children: HTMLCollectionOf<HTMLSpanElement> }
function makeGrabGuide() {
  let g: GuideEl | null = null, y = 0, x0 = 0, bx = 0;
  return {
    show(x: number, atY: number, bubbleX: number | undefined, anchor: Element) {
      g = el("div", "tw-grab-guide tw-portal") as GuideEl;
      g.innerHTML = `<span class="tw-grab-line"></span><span class="tw-grab-dot"></span><span class="tw-grab-arrow"></span><span class="tw-grab-bubble"></span>`;
      y = atY; x0 = x; bx = bubbleX ?? x; // bubble anchors over the field centre, not the cursor
      g.children[1].style.cssText = `left:${x}px;top:${y}px`;
      carrySkin(g, anchor); // the anchor panel's theme + winning scheme, like every portal (a light-pinned panel's guide used to follow the OS scheme)
      document.body.appendChild(g);
    },
    move(x: number, text: string) {
      if (!g) return;
      g.children[0].style.cssText = `left:${Math.min(x0, x)}px;top:${y}px;width:${Math.abs(x - x0)}px`;
      g.children[2].style.cssText = `left:${x}px;top:${y}px;transform:translate(-50%,-50%) scaleX(${x >= x0 ? 1 : -1})`; // arrowhead at the cursor, pointing in the drag direction
      // bubble holds its place centred over the field, so the readout doesn't slide away with the cursor
      g.children[3].style.cssText = `left:${bx}px;top:${y - 16}px`; g.children[3].textContent = text;
    },
    hide() { if (g) { g.remove(); g = null; } },
  };
}

// Drag-to-scrub on a grab handle: 1px ≈ one step (Shift ×10, Alt ×0.1), re-anchoring
// on a modifier change so the value never jumps, with the shared grab guide drawn
// from the field. read() returns the live value, apply(v) commits it, text() the
// bubble label. numField's grab handle.
function attachScrub(grab: HTMLElement, wrap: HTMLElement, step: number, read: () => number, apply: (v: number) => void, text: () => string) {
  let downX = 0, downV = 0, curK = 1; const gd = makeGrabGuide();
  // The shared press-drag shape — its every end path matters here: capture lost mid-scrub
  // (the popover hosting the field closing) must still hide the full-screen guide, whose
  // singleton ref is overwritten on the next show and would otherwise orphan the node.
  dragGesture(grab, {
    onDown: (e) => { e.preventDefault(); downX = e.clientX; downV = read(); curK = 1; grab.classList.add("is-dragging"); const br = wrap.getBoundingClientRect(); gd.show(e.clientX, br.top + br.height / 2, br.left + br.width / 2, wrap); gd.move(e.clientX, text()); },
    // Shift = coarse (×10), Alt = fine (×0.1); re-anchor on a modifier change so the value doesn't jump.
    onMove: (e) => { const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1; if (k !== curK) { curK = k; downX = e.clientX; downV = read(); } apply(downV + (e.clientX - downX) * step * k); gd.move(e.clientX, text()); },
    onEnd: () => { grab.classList.remove("is-dragging"); gd.hide(); },
  });
}

// ── The labelled numeric field — ONE numeric engine for the kit: a sanitized step,
// min-anchored round-to-step, optional `soft` (typed/scripted values may exceed the
// clamp), a text input committing on change/Enter, and the grab handle (drag to
// scrub). Two chromes off the same engine: the boxed field (uppercase caption over
// the input — Spring, Point, Cubic-bezier, the colour channels) and, with
// `spec.row`, the labelled row that IS the Number control. ──
function numField(spec: NumSpec, onChange?: (v: number) => void): NumField {
  // A 0/negative/non-finite step breaks round-to-step (NaN out of Infinity, inverted
  // scrub + keyboard from a negative — reachable via a point component's user-supplied
  // step); a non-finite seed shows literal "NaN". Default both to sane values.
  const step = Number.isFinite(+spec.step) && +spec.step > 0 ? +spec.step : 1;
  const bound = (b: unknown) => (b == null ? NaN : +b); // absent/null/garbage → NaN → unbounded (a null max coerced to 0 and swapped in as the floor)
  let min = bound(spec.min), max = bound(spec.max);
  if (Number.isFinite(min) && Number.isFinite(max) && max < min) { const t = min; min = max; max = t; } // an inverted pair would clamp every value to one end
  const anchor = Number.isFinite(min) ? min : 0, decimals = stepPrecision(step); // min-anchored, like the slider — the value grid starts at the floor
  const [lo, hi] = gridEnds(Number.isFinite(min) ? min : -Infinity, Number.isFinite(max) ? max : Infinity, step, anchor); // the value never leaves the grid, so fit(fit(x)) === fit(x): reset() and fromJSON(toJSON()) hold still
  const fit = (val: number) => { const n = roundToStep(val, anchor, step); return spec.soft ? n : clamp(n, lo, hi); };
  let value = fit(Number.isFinite(+spec.value) ? +spec.value : 0);
  const root = el("div", spec.row ? "tw-row" : "tw-field");
  const wrap = el("div", "tw-num-wrap");
  const grab = el("span", "tw-num-grab", ICON_GRIP); grab.setAttribute("aria-hidden", "true"); grab.title = "Drag to adjust";
  const inp = el("input", "tw-num"); inp.type = "text"; inp.inputMode = "decimal"; inp.setAttribute("aria-label", spec.unit ? `${spec.label} (${spec.unit})` : spec.label); inp.value = value.toFixed(decimals);
  quietFocus(inp); // click-to-edit stays ringless; Tab rings
  wrap.append(grab, inp); if (spec.unit) wrap.append(txt("span", "tw-num-unit", spec.unit)); root.append(txt("span", spec.row ? "tw-row-label" : "tw-field-label", spec.label), wrap);
  const set = (val: number | string, fire = true) => { val = +val; if (!Number.isFinite(val)) return; value = fit(val); inp.value = value.toFixed(decimals); if (fire && onChange) onChange(value); };
  inp.addEventListener("change", () => { const p = parseFloat(inp.value); set(isNaN(p) ? value : p); });
  // Enter commits (blur → change). ↑/↓ step the value in place (⇧ = ×10), the keyboard
  // twin of the grab handle's scrub — off a half-typed value, so a typed "4" then ↑ reads
  // 5, not the committed value plus one.
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") return inp.blur();
    const d = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0; if (!d) return;
    e.preventDefault();
    const p = parseFloat(inp.value);
    set((isNaN(p) ? value : p) + d * step * (e.shiftKey ? 10 : 1));
  });
  attachScrub(grab, wrap, step, () => value, set, () => inp.value);
  return { el: root, set: (val: number | string) => set(val, false), get: () => value };
}

// ── Number — numField in its row chrome: a typeable field with a grab handle (drag to
// scrub), min-anchored rounding, soft support. ──
registerControl("number", (meta: Meta, onChange?: OnChange) => numField({ ...meta, row: true }, onChange));

export { numField, dragGesture, svgEl, cssVar, accentColor, selectAllOnFocus, grabSurface, boxFrac, fitCanvas, triggerRow };
