// ── Gradient — a wide-gamut OKLCH gradient editor. Lazy; depends on the colour
// module (reuses its picker body, parseColor, and oklchStr).
import { el, btn, dragGesture, clamp, popover, triggerRow, registerControl } from "../shared.js";
import { createPickerBody, parseColor, oklchStr, CHECKER } from "./colour.js";
import { modeInterpolation, interpolationMode } from "../../wide-gamut.js";

// ICON_PLUS — adapted from Lucide/Feather `plus` (MIT). See ../../../THIRD-PARTY-NOTICES.md.
const ICON_PLUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;

// ── Gradient — a Figma-style editor: the panel shows a swatch-trigger row (the
// gradient preview + stop count, mirroring the colour row), and clicking it opens a
// popover holding the stop bar over a reused colour picker body. The bar is a row of
// colour stops, each a full OKLCH colour; selecting one re-points the picker body at
// it — one editor surface, no nested popover. Drag a stop to move it, drag it clear of
// the bar (or double-click / Delete) to remove it (min 2), + to add one. The bar blends
// in the colour space of the mode picked in the editor — switch the stop editor to RGB
// and the ramp blends through sRGB (muddy, but honest); OKLCH gives a true wide-gamut
// ramp no sRGB picker makes. That chosen space rides along in the value as `interpolation`
// (a CSS `<color-interpolation-method>`) so a host's `linear-gradient(in … )` matches the
// editor exactly. Value: { stops: [{ color, pos }], interpolation }. ──
// Pull the blend space out of a value: an explicit `interpolation` on the object form,
// else null (the array shorthand and legacy `{ stops }` carry none → OKLCH default).
const parseInterp = (value) => (value && !Array.isArray(value) && typeof value.interpolation === "string" ? value.interpolation : null);
function normalizeStops(value) {
  const DEF = [{ color: "oklch(0.72 0.19 25)", pos: 0 }, { color: "oklch(0.72 0.16 280)", pos: 1 }];
  const arr = Array.isArray(value) ? value : (value && Array.isArray(value.stops) ? value.stops : null);
  // Map each entry defensively — a [color, pos] tuple or a { color, pos } object — and
  // drop anything else (a null / garbage element would throw on `.color`); coerce a
  // non-finite pos to 0 and clamp into [0,1] (an out-of-range pos rendered its handle
  // outside the popover — the drag clamps, so input does too). Fewer than two usable
  // stops falls back to the default pair.
  const out = (arr || []).map((s) => {
    if (Array.isArray(s)) return { color: String(s[0]), pos: clamp(+s[1] || 0, 0, 1) };
    if (s && typeof s === "object") return { color: String(s.color), pos: clamp(+s.pos || 0, 0, 1) };
    return null;
  }).filter(Boolean);
  return out.length >= 2 ? out : DEF;
}
function createGradient(meta, onChange) {
  let stops = normalizeStops(meta.value);
  let selStop = stops[0];

  // ── Trigger row — a gradient preview + stop count that opens the editor (the
  // shared modal-trigger row the colour control uses). ──
  const { root, trigger, right } = triggerRow("tw-gradient", meta.label || "Gradient");
  const countEl = el("span", "tw-gradient-count");
  const preview = el("span", "tw-trigger-chip tw-gradient-preview");
  right.append(countEl, preview);

  // ── Editor popover — the stop bar (+ add) over the reused picker body. Carries the
  // colour popover's class so it inherits its tokens, shell, and short-viewport scroll. ──
  const pop = el("div", "tw-color-pop tw-gradient-pop");
  const barRow = el("div", "tw-gradient-bar-row");
  const bar = el("div", "tw-gradient-bar");
  const grad = el("div", "tw-gradient-grad");
  const rail = el("div", "tw-gradient-rail");
  bar.append(grad, rail);
  const addBtn = btn("tw-gradient-add", ICON_PLUS); addBtn.title = "Add a stop after the selected one"; addBtn.setAttribute("aria-label", "Add a colour stop after the selected one");
  barRow.append(bar, addBtn);

  const sorted = () => [...stops].sort((a, b) => a.pos - b.pos);
  const cssStops = () => sorted().map((s) => `${s.color} ${(s.pos * 100).toFixed(1)}%`).join(", ");
  // The blend space tracks the editor's mode (the picked colour technology); body.mode()
  // is the single source of truth, so the bar, the trigger preview, and the emitted
  // `interpolation` can never drift apart. (Stops keep their own per-stop notation — CSS
  // lets a `linear-gradient(in srgb …)` carry `oklch()` stops, only the blend is sRGB.)
  const interp = () => modeInterpolation(body.mode());
  const gradientCss = () => `linear-gradient(in ${interp()} to right, ${cssStops()})`;
  const paint = () => { const css = gradientCss(); grad.style.background = css; preview.style.background = `${css}, ${CHECKER}`; };
  const reflectCount = () => { countEl.textContent = `${stops.length} stop${stops.length === 1 ? "" : "s"}`; };
  const value = () => ({ stops: sorted().map((s) => ({ color: s.color, pos: +s.pos.toFixed(4) })), interpolation: interp() });
  const emit = () => onChange(value());

  const handleFor = (s) => [...rail.children].find((h: any) => h._stop === s);
  // The picker body edits whichever stop is selected. It opens in the mode the stored
  // blend was authored in, and a mode switch repaints the bar + re-emits — unlike the
  // standalone colour control, where a mode switch is formatting-only: here the mode IS
  // the blend, so changing it is a real change to the gradient's output and its value.
  const body = createPickerBody({ value: selStop.color, mode: interpolationMode(parseInterp(meta.value) || "oklab"), onMode: () => { paint(); emit(); } }, (c) => {
    selStop.color = c;
    handleFor(selStop)?.style.setProperty("--stop", c);
    paint(); emit();
  });
  pop.append(barRow, body.el);
  root.append(pop);

  const reflectSel = () => { for (const h of rail.children) h.dataset.sel = String(h._stop === selStop); };
  const renderHandles = () => {
    rail.replaceChildren();
    for (const s of stops) {
      const h = btn("tw-gradient-stop"); h._stop = s;
      h.style.left = s.pos * 100 + "%"; h.style.setProperty("--stop", s.color);
      h.dataset.sel = String(s === selStop); h.setAttribute("aria-label", "Colour stop");
      let offBar = false;
      dragGesture(h, {
        // preventDefault suppresses click-to-focus on the button — focus explicitly so
        // keyboard can take over after a grab. The focus also blurs a dirty channel
        // field while the old stop is still selected, so its commit lands there.
        onDown: (e) => { e.preventDefault(); e.stopPropagation(); h.focus({ focusVisible: false }); select(s, false); offBar = false; }, // focus for keyboard + to commit a dirty channel field, but no keyboard ring on a mouse press; Tab still rings
        onMove: (e) => {
          // One rail rect for both the X position and the off-bar Y test, so the move
          // doesn't force a second layout read; the X math is posFromX inlined verbatim.
          const r = rail.getBoundingClientRect();
          s.pos = clamp((e.clientX - r.left) / (r.width || 1), 0, 1); h.style.left = s.pos * 100 + "%"; paint(); emit();
          // Drag a stop clear of the bar (past ~24px above/below) to remove it — the
          // touch-friendly removal path; floored at two stops. The stop fades as a cue.
          offBar = stops.length > 2 && (e.clientY < r.top - 24 || e.clientY > r.bottom + 24);
          h.dataset.removing = String(offBar);
        },
        onEnd: () => { if (offBar) removeStop(s); else h.dataset.removing = "false"; },
      });
      h.addEventListener("dblclick", (e) => { e.preventDefault(); removeStop(s); });
      // Keyboard path for position: arrows nudge the focused stop by 0.01 (⇧ = 0.1),
      // clamped — the same paint + emit a drag move does. Delete stays on the popover.
      h.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0; if (!d) return;
        e.preventDefault();
        s.pos = clamp(s.pos + d * (e.shiftKey ? 0.1 : 0.01), 0, 1);
        h.style.left = s.pos * 100 + "%"; paint(); emit();
      });
      rail.append(h);
    }
  };
  // During a drag we only flip the selected flag (no re-render), so the dragged
  // handle element stays live; full re-render happens on add / remove / external set.
  // body.set runs before selStop switches: re-pointing blurs a dirty channel field,
  // and its commit must land on the stop the user was editing, not the new one.
  const select = (s, rerender) => { if (s !== selStop) { body.set(s.color); selStop = s; } rerender ? renderHandles() : reflectSel(); };

  // Stop drag rides the shared dragGesture (pointer capture + automatic pointercancel
  // cleanup), wired per handle in renderHandles — so a touch-drag the browser interrupts
  // with a scroll can't leak a document listener or strand the drag. (.tw-gradient-stop is
  // touch-action:none, like every other drag surface, so it drags cleanly on touch.)
  const posFromX = (x) => { const r = rail.getBoundingClientRect(); return clamp((x - r.left) / (r.width || 1), 0, 1); };

  // Colour for a new stop: interpolate the two bracketing stops in OKLCH (short-way hue).
  const colorAt = (pos) => {
    const ss = sorted(); let lo = ss[0], hi = ss[ss.length - 1];
    for (let k = 0; k < ss.length - 1; k++) if (pos >= ss[k].pos && pos <= ss[k + 1].pos) { lo = ss[k]; hi = ss[k + 1]; break; }
    const t = hi.pos > lo.pos ? clamp((pos - lo.pos) / (hi.pos - lo.pos), 0, 1) : 0; // clamped: a pos outside the outermost stops takes the nearest stop exactly, never extrapolates
    const a = parseColor(lo.color), b = parseColor(hi.color);
    // CSS missing-hue handling for `in oklch`: a ~zero-chroma stop carries no hue of
    // its own, so the other stop's hue holds across the segment (white→red stays red).
    const ach = (c) => c[1] < 1e-4;
    let dh = b[2] - a[2]; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
    if (ach(a) || ach(b)) dh = 0;
    const H = ((((ach(a) && !ach(b) ? b[2] : a[2]) + dh * t) % 360) + 360) % 360; // normalise to [0,360) so the picker reads it cleanly
    return oklchStr(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, H, a[3] + (b[3] - a[3]) * t);
  };
  const removeStop = (s) => {
    if (stops.length <= 2) return;
    const i = stops.indexOf(s); if (i < 0) return; // a stale reference (rebuilt via set) must not splice(-1)
    stops.splice(i, 1);
    const next = selStop === s ? stops[Math.max(0, i - 1)] : selStop;
    paint(); select(next, true); reflectCount(); emit();
    handleFor(selStop)?.focus(); // keep focus on a handle so Delete can chain
  };
  // Add a stop next to the SELECTED one, so where it lands is predictable: midway toward
  // the next stop on its right — or, when the selected stop is the last, midway toward the
  // one on its left. (Was the widest gap, which felt arbitrary — you couldn't tell where
  // the new stop would appear.) It samples the gradient there; drag it to taste. No
  // click-to-add on the bar: that fought with grabbing a stop to reposition it.
  // Insert a stop at `pos`, coloured by sampling the gradient exactly there — so it lands
  // invisibly on the existing ramp — and select it. Shared by the + button (a computed
  // midpoint) and double-click on the bar (the clicked position).
  const insertStopAt = (pos) => {
    const s = { color: colorAt(pos), pos: clamp(pos, 0, 1) };
    stops.push(s); paint(); select(s, true); reflectCount(); emit();
    return s;
  };
  const addStop = () => {
    const ss = sorted();
    let i = ss.indexOf(selStop); if (i < 0) i = 0;
    const at = i < ss.length - 1 ? (ss[i].pos + ss[i + 1].pos) / 2   // midway toward the next stop
             : i > 0             ? (ss[i - 1].pos + ss[i].pos) / 2   // selected is last → midway toward the previous
             : clamp(ss[i].pos + 0.1, 0, 1);                         // lone stop (floor is 2, so a safety net)
    insertStopAt(at);
  };
  addBtn.addEventListener("click", (e) => { e.stopPropagation(); addStop(); });
  // Double-click the bar to drop a new stop right at the pointer, taking the gradient's
  // exact tone there. Double-click (not single) so it never fights grabbing a stop to drag
  // it; a double-click on a stop falls through to that stop's own handler, which removes it.
  bar.addEventListener("dblclick", (e) => {
    if ((e.target as Element).closest(".tw-gradient-stop")) return;
    e.preventDefault();
    insertStopAt(posFromX(e.clientX));
  });

  // Delete / Backspace removes the selected stop (min 2). Ignored while typing in a field
  // (a channel input). Lives on the popover, where the stop handles + picker now sit.
  pop.tabIndex = -1;
  pop.addEventListener("keydown", (e) => {
    if ((e.key === "Delete" || e.key === "Backspace") && !/^(input|textarea|select)$/i.test(e.target.tagName) && stops.length > 2) { e.preventDefault(); removeStop(selStop); }
  });

  // Open the editor under the trigger; reflow the picker body once it's at real size.
  popover(root, trigger, pop, { width: 260, fallbackH: 392, gap: 6, onOpen: () => body.reflow(), onReflow: () => body.reflow() });

  renderHandles(); paint(); reflectCount();
  return {
    el: root,
    set: (v) => {
      // Re-point the blend if the incoming value names one (mirror-backs from on() carry
      // the same interpolation we emitted, so this is usually a no-op); absent → leave the
      // mode as the user left it, never silently reset it to OKLCH on a stops-only set.
      const ip = parseInterp(v); if (ip) body.setMode(interpolationMode(ip));
      const next = normalizeStops(v).sort((a, b) => a.pos - b.pos);
      if (next.length === stops.length) {
        // Same count — the common case: a host mirroring values back via on(). Update
        // the existing stop objects + handles in place, paired in position order (the
        // emitted value is sorted), so a live drag keeps its handle element and the
        // picker stays pointed at the stop it was on, not reset to stops[0].
        sorted().forEach((s, i) => {
          s.color = next[i].color; s.pos = next[i].pos;
          const h = handleFor(s); if (h) { h.style.left = s.pos * 100 + "%"; h.style.setProperty("--stop", s.color); }
        });
      } else {
        const selPos = selStop.pos;
        stops = next;
        selStop = stops.reduce((b, s) => (Math.abs(s.pos - selPos) < Math.abs(b.pos - selPos) ? s : b), stops[0]); // re-select the nearest position, not index 0
        renderHandles();
      }
      paint(); reflectCount(); body.set(selStop.color);
    },
    get: () => value(),
  };
}

registerControl("gradient", createGradient);
