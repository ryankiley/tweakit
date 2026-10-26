/* Tweaks — what only the lazy controls use: the numeric field engine and its scrub, the
 * press-drag gesture, the SVG factory, canvas sizing and the modal-trigger row, kept out of
 * the shared chunk. It also registers the Number control, which no shorthand infers. */
import { el, btn, txt, clamp, carrySkin, quietFocus, stepPrecision, gridEnds, roundToStep, icon, registerControl, TYPE_ALIASES, announce, sayNow } from "./shared.js";
import type { Built, NumSpec, NumField, OnChange } from "./shared.js";
import type { Meta } from "./schema.js";

const svgNS = "http://www.w3.org/2000/svg";
// The SVG twin of shared.ts's el().
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, cls?: string): Built<SVGElementTagNameMap[K]> => { const n = document.createElementNS(svgNS, tag); if (cls) n.setAttribute("class", cls); return n; };
const cssVar = (node: Element, name: string) => getComputedStyle(node).getPropertyValue(name).trim();
// One getComputedStyle for both reads — this runs in the FPS draw loop.
const accentColor = (node: Element) => { const r = getComputedStyle(node); const v = (n: string) => r.getPropertyValue(n).trim(); return v("--tw-accent") || v("--tw-text-primary") || "#fff"; };
// Select the whole value on focus (the hex field: you type a new color, never edit a digit).
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
// Escape in an edited field restores `kept` and stops; otherwise it passes on and closes the pane. Without this,
// closing blurred the field and committed the half-typed value.
const escapeReverts = (input: HTMLInputElement, kept: () => string) => input.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key !== "Escape" || input.value === kept()) return;
  e.preventDefault(); e.stopPropagation(); input.value = kept();
});
// Drag a pane by its edge (padding, or a gap between parts) to uncover what's beneath; it keeps that offset from its row
// while open (st.moved), and the next open resets it. Bound by popover() on a movable pane's first open.
const dragPane = (pop: HTMLElement, st: { open: boolean; moved: boolean }, place: () => void) => pop.addEventListener("pointerdown", (e: PointerEvent) => {
  if (e.target !== pop || e.button !== 0 || !st.open) return;
  e.preventDefault(); // no text selection, and focus stays where it was
  const id = e.pointerId, sx = e.clientX, sy = e.clientY, ox = parseFloat(pop.style.left), oy = parseFloat(pop.style.top), wasMoved = st.moved;
  let going = false;
  try { pop.setPointerCapture(id); } catch {}
  const move = (m: PointerEvent) => {
    if (m.pointerId !== id) return;
    if (!going) { if (Math.hypot(m.clientX - sx, m.clientY - sy) < 4) return; going = st.moved = true; pop.classList.add("is-moving"); }
    pop.style.left = ox + m.clientX - sx + "px"; pop.style.top = oy + m.clientY - sy + "px"; place();
  };
  const end = (m: PointerEvent) => { if (m.pointerId === id) stop(); };
  // Escape mid-move puts it back and keeps it open. Capture phase, so it beats the pane's own Escape.
  const key = (k: KeyboardEvent) => {
    if (k.key !== "Escape" || !going) return;
    k.preventDefault(); k.stopPropagation();
    pop.style.left = ox + "px"; pop.style.top = oy + "px"; st.moved = wasMoved; place(); stop();
    try { pop.releasePointerCapture(id); } catch {}
  };
  const stop = () => {
    pop.removeEventListener("pointermove", move); pop.removeEventListener("pointerup", end); pop.removeEventListener("pointercancel", end); pop.removeEventListener("lostpointercapture", end);
    document.removeEventListener("keydown", key, true); pop.classList.remove("is-moving");
  };
  pop.addEventListener("pointermove", move); pop.addEventListener("pointerup", end); pop.addEventListener("pointercancel", end); pop.addEventListener("lostpointercapture", end); // lost: the node left mid-press
  document.addEventListener("keydown", key, true);
});
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
// An arrow key as a [dx, dy] step, ↑ positive as on screen; [0, 0] for any other key.
const arrowStep = (e: KeyboardEvent): [number, number] => [e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0, e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0];
// A 2D surface's readout rides on aria-description, which a screen reader speaks on focus and never again: the returned
// function says it once a run of keys stops.
const sayWhenKeysStop = (node: HTMLElement) => { let t = 0; return () => { clearTimeout(t); t = setTimeout(() => { if (node.isConnected) announce(node.getAttribute("aria-description") || ""); }, 250); }; };
// Size a canvas to its CSS box × devicePixelRatio (capped) and scale the context to CSS pixels; returns [cssW, cssH].
const fitCanvas = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, maxDpr = Infinity): [number, number] => {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [r.width, r.height];
};
// The modal-trigger row (color, gradient, point): a row button, label left, a preview cluster (`right`) the caller fills.
const triggerRow = (cls: string, label: string) => {
  const root = el("div", cls);
  const trigger = btn("tw-trigger"); trigger.setAttribute("aria-expanded", "false");
  const right = el("span", "tw-trigger-right");
  trigger.append(txt("span", "tw-trigger-label", label), right);
  root.append(trigger);
  return { root, trigger, right };
};

// A 2-bar drag handle (the icon sets' grips are dots).
const ICON_GRIP = icon('<path d="M6 4v8M10 4v8"/>', "", 2, 16); // 1.5px bars at the 12px it is drawn at

// Grab guide — a dotted line from the grab point to the cursor plus a value bubble, portaled
// to <body> for a drag. Its four spans (line, dot, arrow, bubble) are addressed by index.
interface GuideEl extends HTMLDivElement { readonly children: HTMLCollectionOf<HTMLSpanElement> }
function makeGrabGuide() {
  let g: GuideEl | null = null, y = 0, x0 = 0, bx = 0;
  return {
    show(x: number, atY: number, bubbleX: number | undefined, anchor: Element) {
      g = el("div", "tw-grab-guide tw-portal") as GuideEl;
      g.innerHTML = `<span class="tw-grab-line"></span><span class="tw-grab-dot"></span><span class="tw-grab-arrow"></span><span class="tw-grab-bubble"></span>`;
      y = atY; x0 = x; bx = bubbleX ?? x; // bubble anchors over the field center, not the cursor
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

// ── The labeled numeric field — ONE numeric engine: a sanitized step, min-anchored
// round-to-step, optional `soft`, a text input committing on change/Enter, and the grab
// handle. Two chromes: the boxed field, and with `spec.row` the row that IS the Number control. ──
function numField(spec: NumSpec, onChange?: (v: number) => void): NumField {
  // A 0/negative/non-finite step breaks round-to-step (reachable via a point component's step).
  const step = Number.isFinite(+spec.step) && +spec.step > 0 ? +spec.step : 1;
  const bound = (b: unknown) => (b == null ? NaN : +b); // null → NaN → unbounded (a null max coerced to 0)
  let min = bound(spec.min), max = bound(spec.max);
  if (Number.isFinite(min) && Number.isFinite(max) && max < min) { notice("swap", [spec.label ?? "number", min, max]); const t = min; min = max; max = t; } // an inverted pair would clamp every value to one end
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
  escapeReverts(inp, () => value.toFixed(decimals));
  // ↑/↓ step off the half-typed value (a typed "4" then ↑ reads 5), the keyboard twin of the scrub.
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") return inp.blur();
    const d = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0; if (!d) return;
    e.preventDefault();
    const n = typed();
    set((Number.isFinite(n) ? n : value) + d * step * (e.shiftKey ? 10 : 1));
  });
  attachScrub(grab, wrap, step, () => value, set, () => inp.value);
  return { el: root, set: (val: number | string) => set(val, false), get: () => value, range: [lo, hi] };
}

// ── Number — numField in its row chrome. ──
// The coarsest power of ten a number sits on (0.5 → 0.1, 3.14159 → 0.00001, 1230 → 10), read at 12 significant digits so
// 0.1 + 0.2 counts as 0.3; Infinity for 0 or a non-number, which constrains nothing. A step no coarser keeps it exactly.
// Past eight significant digits a number was computed, not written (1/3, Math.PI): it steps at its fourth digit, as a slider
// rounds it, so an arrow moves it by 0.0001, not by 1e-12.
const decimalStep = (v: unknown) => {
  const n = Number(Math.abs(+(v as number)).toPrecision(12)); if (!n || !Number.isFinite(n)) return Infinity;
  const d = stepPrecision(n), e = Math.floor(Math.log10(n)); if (d) return Number(`1e${e + d + 1 > 8 ? e - 3 : -d}`);
  let k = 0; while (k < 15 && n % 10 ** (k + 1) === 0) k++;
  return 10 ** k;
};
// A number with no step takes 1, or finer when its default or min has decimals (0.5 steps by 0.5): decided here, in the
// lazy chunk, so the basic panel carries none of it.
registerControl("number", (meta: Meta, onChange?: OnChange) => numField({ ...meta, step: meta.step ?? Math.min(1, decimalStep(meta.value), decimalStep(meta.min)), row: true }, onChange));

// ── Spring step response — shared by the spring and motion controls. The window runs to the
// settle, capped at 2.2 s. ──
// Motion's visualDuration + bounce, resolved as motion-dom's spring generator does (mass 1): a bounce maps to a damping ratio
// as SwiftUI's does, floored at 0.05 either way; the period is visualDuration × 1.2; and an overdamped (negative) bounce
// scales the frequency by a Newton solve so it arrives when the critically damped spring would. Copied value for value, so
// what's tuned here plays the same in Motion.
const CRIT = (2 * Math.PI) / 1.2;
const bounceRatio = (b: number) => (b < 0 ? 1 / Math.max(1 + b, 0.05) : Math.max(1 - b, 0.05));
const overdampedScale = (z: number) => {
  if (!(z > 1)) return 1;
  const r = Math.sqrt(z * z - 1), slow = z - r, fast = z + r, target = 2 * r * Math.exp(-CRIT) * (1 + CRIT);
  let x = CRIT;
  for (let i = 1; i < 12; i++) x -= (fast * Math.exp(-slow * x) - slow * Math.exp(-fast * x) - target) / (Math.exp(-fast * x) - Math.exp(-slow * x));
  return x / CRIT;
};
const springFromTime = (visualDuration: number, bounce: number) => {
  const z = bounceRatio(bounce), root = (CRIT / visualDuration) * overdampedScale(z), k = root * root;
  return { stiffness: k, damping: 2 * z * Math.sqrt(k), mass: 1 };
};
// Its inverse, for physics keys handed to a time-mode editor: the visualDuration + bounce Motion would resolve to them.
const timeFromSpring = (k: number, d: number, m = 1) => {
  const z = d / (2 * Math.sqrt(k * m));
  return { visualDuration: (CRIT * overdampedScale(z)) / Math.sqrt(k / m), bounce: z > 1 ? 1 / z - 1 : 1 - z };
};
// How fast the slowest mode dies out: ζω₀, or an overdamped spring's slow root (ζω₀ is its fast one, so the preview
// window shrank to milliseconds and drew a near-flat line).
const decayRate = (w0: number, z: number) => (z > 1 ? w0 * (z - Math.sqrt(z * z - 1)) : z * w0);
const springSpan = (k: number, d: number, m: number) => Math.min(2.2, 9 / Math.max(decayRate(Math.sqrt(k / m), d / (2 * Math.sqrt(k * m))), 0.5));
// Closed-form step response of a damped harmonic oscillator (under/critical/over): position at time t.
const springAt = (k: number, d: number, m: number) => {
  const w0 = Math.sqrt(k / m), z = d / (2 * Math.sqrt(k * m));
  if (z < 1 - 1e-4) { const wd = w0 * Math.sqrt(1 - z * z); return (t: number) => 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t)); }
  if (z <= 1 + 1e-4) return (t: number) => 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const s = Math.sqrt(z * z - 1), a = w0 * (z + s), b = w0 * (z - s);
  return (t: number) => 1 - (a * Math.exp(-b * t) - b * Math.exp(-a * t)) / (a - b);
};
// N samples over the span, for drawing.
function springCurve(k: number, d: number, m: number, N = 64, T = springSpan(k, d, m)) {
  const x = springAt(k, d, m), out: number[] = [];
  for (let i = 0; i < N; i++) out.push(x((i / (N - 1)) * T));
  return out;
}
// The run as a CSS transition: how long, and a linear() easing. It lasts until within e⁻⁷ of rest, by the slowest mode
// (an overdamped spring's slow root, not ζω₀), capped at 10 s, where the last stop is 1 so it ends at rest. Stops were
// spaced by duration alone, so a bouncy spring got three a wobble and missed its peaks by a third; now there are at least
// 24 a wobble plus one on every peak and trough, each at its own percentage, so the overshoots land where they are.
const springRun = (k: number, d: number, m: number) => {
  const w0 = Math.sqrt(k / m), z = d / (2 * Math.sqrt(k * m)), x = springAt(k, d, m);
  const span = Math.min(7 / Math.max(decayRate(w0, z), 1e-3), 10);
  const wd = z < 1 ? w0 * Math.sqrt(1 - z * z) : 0, n = Math.min(Math.max(48, Math.ceil(wd ? (24 * span * wd) / (2 * Math.PI) : span * 40)), 800);
  const ts = Array.from({ length: n }, (_, i) => (i / (n - 1)) * span);
  if (wd) for (let t = Math.PI / wd; t < span; t += Math.PI / wd) ts.push(t); // every extremum of the underdamped response
  ts.sort((a, b) => a - b);
  const stops = ts.filter((t, i) => i === 0 || t - ts[i - 1] > 1e-6).map((t, i, a) => `${i === a.length - 1 ? 1 : +x(t).toFixed(3)} ${+((t / span) * 100).toFixed(2)}%`);
  return { duration: Math.round(span * 1000), easing: `linear(${stops.join(", ")})` };
};

// The name a typo is a single edit from (a letter added, dropped or changed). It and the notices below are lazy, as
// only a mistake needs them. unknownType: a schema or markup `type` no control answers to. Its list holds the aliases
// (toggle, bezier) and not the color module's picker body, which is registered as a control but isn't a type to write.
const nearest = (s: string, names: string[]) => {
  const a = s.toLowerCase(); // case-blind, so "textmuted" finds "textMuted"
  return names.find((n) => { const k = n.toLowerCase(); let i = 0; while (i < a.length && a[i] === k[i]) i++; return [[1, 1], [0, 1], [1, 0]].some(([x, y]) => a.slice(i + x) === k.slice(i + y)); });
};
const unknownType = (where: string, type: string, known: string[], then: string) => {
  const names = [...new Set([...known, ...Object.keys(TYPE_ALIASES)])].filter((t) => t !== "folder" && t !== "colorpicker").sort(), near = nearest(type, names);
  console.warn(`[tweaks] ${where}: "${type}" isn't a control type${near ? ` — did you mean "${near}"?` : "."} It ${then}. Types: ${names.join(", ")}`);
};
// A theme key resolveTheme skipped: kind is what its value failed to be ("color", "length"), or "" for a key it doesn't know.
const badTheme = (key: string, v: unknown, kind: string, keys: string[]) => {
  const near = !kind && nearest(key, keys);
  console.warn(kind ? `[tweaks] theme: ${key} ${JSON.stringify(v)} isn't a CSS ${kind}${kind === "length" ? " or a number of px" : ""} — skipped`
    : `[tweaks] theme: "${key}" isn't a theme key${near ? ` — did you mean "${near}"?` : "."} It is skipped. Keys: ${keys.join(", ")}, or any raw --tw-* token`);
};

const warned = new Set<string>();
const badGradient = (fn: string, value: unknown, all: unknown, n: number) => {
  const why = !Array.isArray(all) ? `expected { stops: [{ color, pos }] }, got ${value === null ? "null" : typeof value === "object" ? "an object without a stops array" : typeof value}`
    : n < all.length ? `skipped ${all.length - n} of ${all.length} stops without a CSS color and a numeric pos` : "the gradient has no stops";
  if (!warned.has(fn + why)) { warned.add(fn + why); console.warn(`[tweaks] ${fn}(): ${why}`); }
};
// The words for the core's notices (shared.ts notice()): what went wrong and the way out, downloaded only when one fires.
const NOTICES: Record<string, (...a: any[]) => string> = {
  clamp: (key, v, min, max, type) => `set("${key}", ${JSON.stringify(v)}) clamped to ${min > -Infinity ? min : "−∞"}–${max < Infinity ? max : "∞"}; widen min/max${type === "slider" || type === "number" ? ", or set soft: true to allow it" : ""}`,
  sharedKey: (k) => `persist: another live panel already saves under "${k}", so each overwrites the other's values; give one its own persist key`,
  pointValue: (key, comps) => `"${key}": a point value that isn't a number starts at 0 (${comps})`,
  swap: (label, min, max) =>`"${label}": min ${min} is above max ${max}, so they were swapped`,
  ambiguousPath: (key, n) => `set("${key}") is ambiguous — ${n} controls read as that path (a key holding "." beside a folder); rename one`,
  filter: () => "opts.filter needs the toolbar (its search button lives there) — ignored alongside toolbar:false",
  presetFull: (nm) => `preset "${nm}" didn't fit in storage — not saved`,
  reserved: (key) => `set("${key}") ignored — reserved key`,
  noPath: (key) => `set("${key}") — no control at that path`,
  ambiguousKey: (key, n, eg) => `set("${key}") is ambiguous — ${n} controls share that key; use a dotted path (e.g. "${eg}")`,
  notAValue: (key, kind) => `set("${key}") ignored — a ${kind} is not a control value`,
  noControl: (key, group) => (group ? `set("${key}") ignored — it's a folder/tabs group; set its children instead` : `set("${key}") ignored — no control has that key`),
};
const notice = (kind: string, args: unknown[]) => { const say = NOTICES[kind]; if (say) console.warn(`[tweaks] ${say(...args)}`); };
sayNow(notice);

export { escapeReverts, dragPane, badGradient, notice, decimalStep, unknownType, badTheme, numField, dragGesture, svgEl, cssVar, accentColor, selectAllOnFocus, grabSurface, boxFrac, fitCanvas, triggerRow, springCurve, springSpan, springRun, springFromTime, timeFromSpring, arrowStep, sayWhenKeysStop };
