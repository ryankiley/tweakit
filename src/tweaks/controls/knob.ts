// ── Knob / dial — a rotary value control. Lazy. ──
import { el, svgEl, clamp, roundToStep, stepPrecision, onReady, registerControl } from "../shared.js";

// ── Knob — a 270° rotary dial (the gap centred at the bottom), the kind of input that
// rotary/audio kits lean on (dialkit, Tweakpane's knob plugins) and which the kit was
// missing. Drag vertically to turn it — up increases — wheel or arrow to nudge, Alt for a
// fine drag (re-anchored on the modifier the way the slider/number scrub are). The filled
// arc + the pointer dot sweep with the value; a drag tracks the pointer 1:1, while every
// non-drag change (keyboard, wheel, reset, .set) springs to its target the way the slider
// glides — so the dial always settles, never snaps. Value is a plain number in [min, max]. ──
const SWEEP = 270, START = -135; // degrees from 12 o'clock — the dial spans [−135°, +135°]
const TURN = 200; // px of vertical travel that covers the full range on a normal drag
const R = 38, CX = 50, CY = 50; // SVG geometry (100×100 viewBox)
const pt = (deg) => { const a = (deg - 90) * Math.PI / 180; return [CX + R * Math.cos(a), CY + R * Math.sin(a)]; };
const arcD = (a0, a1) => { const [x0, y0] = pt(a0), [x1, y1] = pt(a1); const large = Math.abs(a1 - a0) > 180 ? 1 : 0; return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };

function createKnob(meta, onChange) {
  const { label, min, max, step } = meta;
  const decimals = stepPrecision(step);
  const q = (v) => roundToStep(v, min, step);
  let value = clamp(Number.isFinite(+meta.value) ? +meta.value : min, min, max);
  let shown = value, raf = 0; // `shown` is the animated arc position; `value` is the truth the readout + emit use

  const root = el("div", "tw-knob");
  const dial = el("div", "tw-knob-dial"); dial.tabIndex = 0;
  dial.setAttribute("role", "slider"); dial.setAttribute("aria-label", label);
  dial.setAttribute("aria-valuemin", String(min)); dial.setAttribute("aria-valuemax", String(max));
  const svg = svgEl("svg", "tw-knob-svg"); svg.setAttribute("viewBox", "0 0 100 100");
  const track = svgEl("path", "tw-knob-track"); track.setAttribute("d", arcD(START, START + SWEEP));
  const arc = svgEl("path", "tw-knob-value-arc");
  const dot = svgEl("circle", "tw-knob-dot"); dot.setAttribute("r", "5.5");
  svg.append(track, arc, dot);
  const readout = el("span", "tw-knob-readout");
  dial.append(svg, readout);
  const labelEl = el("span", "tw-knob-label"); labelEl.textContent = label;
  root.append(dial, labelEl);

  const render = () => {
    const frac = (max - min) ? clamp((shown - min) / (max - min), 0, 1) : 0;
    const ang = START + frac * SWEEP;
    arc.setAttribute("d", frac > 0.001 ? arcD(START, ang) : ""); // empty at the floor so the round cap doesn't show a stub
    const [dx, dy] = pt(ang); dot.setAttribute("cx", dx.toFixed(2)); dot.setAttribute("cy", dy.toFixed(2));
    readout.textContent = q(shown).toFixed(decimals); // tracks the (animated) arc, so the number rolls in step with the sweep
    dial.setAttribute("aria-valuenow", String(q(value)));
    dial.setAttribute("aria-valuetext", q(value).toFixed(decimals));
  };
  render();

  // Non-drag changes spring the arc to their target (the slider's glide, for a dial);
  // a drag sets `shown` directly so it stays 1:1. Reduced-motion jumps straight there.
  const REDUCE = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)");
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const animateTo = (to) => {
    if (REDUCE && REDUCE.matches) { shown = to; render(); return; }
    cancelAnimationFrame(raf); const from = shown, t0 = performance.now(), D = 280;
    const tick = (now) => { const k = Math.min(1, (now - t0) / D); shown = from + (to - from) * easeOut(k); render(); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  };
  const set = (v, fire = true, animate = false) => {
    v = +v; if (!Number.isFinite(v)) return; // non-finite (NaN/±∞ from a stray .set()/restore) is ignored
    value = clamp(v, min, max);
    if (animate) animateTo(value); else { cancelAnimationFrame(raf); shown = value; render(); }
    if (fire) onChange(q(value));
  };

  // Vertical drag, up = increase. Alt drops into a fine drag, re-anchored the moment Alt
  // toggles so the value never jumps (matching the slider's Alt-fine + the number scrub).
  let downY = 0, downV = 0, dragging = false, fine = false;
  dial.addEventListener("pointerdown", (e) => {
    e.preventDefault(); dragging = true; downY = e.clientY; downV = value; fine = e.altKey;
    dial.classList.add("is-active"); try { dial.setPointerCapture(e.pointerId); } catch {}
  });
  dial.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    if (e.buttons === 0) return up(); // released off-dial (pointerup never reached us) — bail on the next move
    if (e.altKey !== fine) { fine = e.altKey; downY = e.clientY; downV = value; }
    const gain = (fine ? 0.25 : 1) * (max - min) / TURN;
    set(downV - (e.clientY - downY) * gain);
  });
  const up = () => { if (!dragging) return; dragging = false; dial.classList.remove("is-active"); };
  dial.addEventListener("pointerup", up); dial.addEventListener("pointercancel", up);

  // Wheel nudges the dial a step (⇧ ×10), springing to the new value — the scroll-to-turn
  // most rotary controls support. Non-passive so it adjusts the dial instead of the page.
  dial.addEventListener("wheel", (e) => { e.preventDefault(); const d = e.deltaY < 0 ? 1 : -1; set(clamp(value + d * step * (e.shiftKey ? 10 : 1), min, max), true, true); }, { passive: false });

  dial.addEventListener("keydown", (e) => {
    const coarse = e.shiftKey ? 10 : 1, page = (max - min) / 10 || step * 10;
    let nv = value;
    switch (e.key) {
      case "ArrowRight": case "ArrowUp": nv = value + step * coarse; break;
      case "ArrowLeft": case "ArrowDown": nv = value - step * coarse; break;
      case "PageUp": nv = value + page; break;
      case "PageDown": nv = value - page; break;
      case "Home": nv = min; break; case "End": nv = max; break;
      default: return;
    }
    e.preventDefault(); set(clamp(nv, min, max), true, true);
  });

  onReady(render);
  return { el: root, set: (v) => set(v, false, true), get: () => q(value) };
}

registerControl("knob", createKnob);
