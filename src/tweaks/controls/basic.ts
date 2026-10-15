/* The core controls — always-registered constructors (slider, toggle, radio grid, select,
 * buttons, text, folder) plus createControl. Statically imported by the entry, so basic panels build synchronously. */
import {
  el, btn, txt, clamp, stepPrecision, gridEnds, roundToStep, normalizeRange, rangeStep, overlapsText, optValue, optLabel, json,
  popover, radioButton, setRadioActive, activeIndex, navIndex, createSegmented, blade, setCollapsed,
  quietFocus, wireHoverClass, onReady, onLive, registerControl, getControl,
  EASE_SPRING, EASE_GLIDE, REDUCE_MOTION,
} from "../shared.js";
import { ICON_CHEVRON, chevronIcon } from "../icons.js";
import type { OnChange } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control, Option } from "../types.js";

// ── Slider control ──
const CLICK_THRESHOLD = 3, DEAD_ZONE = 32, MAX_CURSOR_RANGE = 200, MAX_STRETCH = 8;
function createSlider(meta: Meta, onChange: OnChange): Control {
  const label = meta.label;
  let { min, max, step } = normalizeRange(meta.min, meta.max, meta.step);
  // A hard slider's range is its reachable grid: the ends move in to the first/last grid point,
  // so notches, hashmarks, keyboard ends, aria bounds and the emitted value agree. A soft slider keeps its authored range.
  if (!meta.soft) [min, max] = gridEnds(min, max, step);
  const snap = (max - min) / step <= 6; // past ~6 stops, snapping at every step felt notchy
  const seed = Number.isFinite(+meta.value) ? +meta.value : min; // a non-finite seed → min
  // A soft slider keeps an out-of-range default, as set() does; pull is the detent's tension offset read by render().
  let value = meta.soft && !snap ? seed : clamp(seed, min, max), pull = 0;
  const decimals = stepPrecision(step);

  const wrap = el("div", "tw-slider-wrap");
  const track = el("div", "tw-slider");
  const hashes = el("div", "tw-slider-hashmarks");
  const fill = el("div", "tw-slider-fill");
  const handle = el("div", "tw-slider-handle");
  const labelEl = txt("span", "tw-slider-label", label);
  const valueEl = el("span", "tw-slider-value");
  // The readout is a text node plus a muted unit suffix; the param stays the bare number.
  const unit = typeof meta.unit === "string" ? meta.unit.trim() : "", numText = document.createTextNode("");
  const joined = !unit ? "" : /^[%°]$/.test(unit) ? unit : " " + unit; // "50%", "90°", but "24 px", "300 ms"
  valueEl.append(numText); if (unit) valueEl.append(txt("span", "tw-slider-unit", joined));
  // A format that throws or returns a non-string falls back to the digits, so it can't blank the slider.
  const format = meta.format, parse = meta.parse;
  const show = (v: number) => { if (format) { try { const s = format(v); if (typeof s === "string" && s) return s; } catch {} } return v.toFixed(decimals); };
  track.append(hashes, fill, handle, labelEl, valueEl);
  wrap.append(track);

  track.tabIndex = 0;
  track.setAttribute("role", "slider");
  track.setAttribute("aria-label", label);
  track.setAttribute("aria-valuemin", String(min));
  track.setAttribute("aria-valuemax", String(max));

  const q = (v: number) => roundToStep(v, min, step); // min/max sit on the grid, so a clamped value rounds inside
  const marks = snap ? Array.from({ length: Math.max(0, Math.round((max - min) / step) - 1) }, (_, i) => ((i + 1) * step) / (max - min) * 100) : [];
  for (const pct of marks) { const m = el("div", "tw-slider-hashmark"); m.style.left = pct + "%"; hashes.append(m); }

  // value stays continuous; only the readout + emitted value round to step.
  const render = () => {
    const pct = clamp(((value - min) / ((max - min) || 1)) * 100, 0, 100); // clamp the visual; a soft readout shows its real number
    const off = pull ? ` + ${pull.toFixed(1)}px` : "";
    const edge = `${pct}%${off}`;
    fill.style.width = pull ? `calc(${edge})` : pct + "%";
    handle.style.left = `max(5px, calc(${edge} - 9px))`; // the inset hairline rides just inside the fill edge
    const qv = q(value), qvText = show(qv);
    numText.data = qvText;
    track.setAttribute("aria-valuenow", String(qv));
    track.setAttribute("aria-valuetext", qvText + joined);
    // Value-dodge: the handle dims only while its real pixel span overlaps the label or value text.
    const trackW = wrap.offsetWidth, valueW = valueEl.offsetWidth;
    if (trackW) {
      // The label's room is what the readout leaves: 12px inset + 8px gap + the readout's 10px inset.
      if (valueW) labelEl.style.maxWidth = Math.max(0, trackW - valueW - 30) + "px";
      const hx = Math.max(5, (pct / 100) * trackW + pull - 9);
      track.classList.toggle("is-dodge", overlapsText(labelEl, valueEl, hx, 3));
    }
  };
  render();

  let rect: DOMRect | null = null, scale = 1, downPos: { x: number; y: number } | null = null, isClick = true, snapTimer: number, fineAnchor: { x: number; v: number } | null = null, downId: number | null = null;
  const GLIDE_FILL = `width 0.34s ${EASE_GLIDE}`;
  const GLIDE_HANDLE = `left 0.34s ${EASE_GLIDE}, opacity 0.15s, transform 0.2s ${EASE_SPRING}`;
  // Discrete detent: the value commits at 30% of the gap and the handle springs to the notch,
  // leaning toward the cursor. Driven by springFrame below, only while dragging or settling.
  const FINE_GAIN = 0.2;
  const valFromX = (clientX: number) => {
    if (!rect) return value;
    const native = wrap.offsetWidth || rect.width;
    const pct = clamp((clientX - rect.left) / scale / native, 0, 1);
    return clamp(min + pct * (max - min), min, max);
  };
  const rubber = (clientX: number) => {
    let s = 0;
    if (clientX < rect.left) s = -MAX_STRETCH * Math.sqrt(Math.min(Math.max(0, rect.left - clientX - DEAD_ZONE) / MAX_CURSOR_RANGE, 1));
    else if (clientX > rect.right) s = MAX_STRETCH * Math.sqrt(Math.min(Math.max(0, clientX - rect.right - DEAD_ZONE) / MAX_CURSOR_RANGE, 1));
    track.style.width = `calc(100% + ${Math.abs(s)}px)`;
    track.style.transform = s < 0 ? `translateX(${s}px)` : "";
  };
  const set = (v: number | string, fire = true) => { v = +v; if (!Number.isFinite(v)) return; value = snap ? clamp(q(v), min, max) : (meta.soft ? v : clamp(v, min, max)); render(); if (fire) onChange(q(value)); }; // a non-finite value is ignored; soft may exceed the range

  // ── Spring-commit detent (snap sliders) ──
  // Physics in step-index space (notches at integers).
  const STEPS = Math.max(1, Math.round((max - min) / step));
  const C_COMMIT = 0.2, C_LEAN = 0.3, C_K = 520, C_D = 27; // C_COMMIT = 0.5 − 0.30 (commit fraction)
  const toIdx = (v: number) => (v - min) / step;
  let sx = 0, sv = 0, sRAF = 0, sDrag = false, sPrevEi: number | null = null, cursorVal = value, sPrevT = 0;
  const springStop = () => { if (sRAF) cancelAnimationFrame(sRAF); sRAF = 0; sPrevT = 0; };
  const springFrame = (now: number) => {
    if (!track.isConnected) { springStop(); return; } // panel torn down mid-drag — bail
    const dt = sPrevT ? Math.min((now - sPrevT) / 1000, 0.05) : 1 / 60; sPrevT = now;
    const trackW = wrap.offsetWidth || (rect && rect.width) || 1;
    const ui = toIdx(clamp(cursorVal, min, max));
    const ei = clamp(Math.round(ui + C_COMMIT), 0, STEPS); // eager commit: 30% past the notch
    const tx = sDrag ? ei + C_LEAN * clamp(ui - ei, -0.5, 0.5) : ei; // lean toward the cursor, then settle on the notch
    // Reduced motion: the handle sits on its target every frame. The CSS kill-switch can't reach
    // this, since the detent drives left/width from rAF, not a transition. Read live, guarded for a matchMedia without `matches`.
    if (REDUCE_MOTION && REDUCE_MOTION.matches) { sx = tx; sv = 0; }
    else { let t = dt; const h = 1 / 240; while (t > 1e-4) { const s = Math.min(h, t); t -= s; const a = C_K * (tx - sx) - C_D * sv; sv += a * s; sx += sv * s; if (sx < 0) { sx = 0; sv = 0; } if (sx > STEPS) { sx = STEPS; sv = 0; } } }
    pull = (sx - ei) * step / ((max - min) || 1) * trackW; // spring offset from the committed notch, in px
    value = clamp(min + ei * step, min, max); render();
    if (ei !== sPrevEi) { sPrevEi = ei; onChange(q(value)); } // emit once per commit, not per frame
    if (!sDrag && Math.abs(sv) < 0.004 && Math.abs(sx - ei) < 0.004) { sx = ei; sv = 0; pull = 0; render(); springStop(); track.classList.remove("is-active"); }
    else sRAF = requestAnimationFrame(springFrame);
  };
  const springStart = (clientX: number) => { sx = toIdx(value); sv = 0; sDrag = true; sPrevEi = Math.round(toIdx(value)); cursorVal = valFromX(clientX); if (!sRAF) sRAF = requestAnimationFrame(springFrame); };

  track.addEventListener("pointerdown", (e) => {
    if (valueEl.classList.contains("is-editing")) return;
    if (e.button !== 0 || downPos) return; // primary button only; no second-pointer hijack
    e.preventDefault();
    // preventDefault suppressed click-to-focus; restore it without the keyboard ring (programmatic focus otherwise reads as keyboard).
    track.focus({ focusVisible: false });
    downId = e.pointerId;
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch {}
    clearTimeout(snapTimer); track.style.transition = "";
    downPos = { x: e.clientX, y: e.clientY }; isClick = true;
    track.classList.add("is-active");
    rect = wrap.getBoundingClientRect(); scale = rect.width / (wrap.offsetWidth || rect.width);
    // Snap springs to the pressed notch; continuous glides there, the glide cleared on the first move so dragging stays 1:1.
    if (snap) {
      fill.style.transition = ""; handle.style.transition = "";
      springStart(e.clientX);
    } else {
      fill.style.transition = GLIDE_FILL; handle.style.transition = GLIDE_HANDLE;
      set(valFromX(e.clientX));
    }
  });
  track.addEventListener("pointermove", (e) => {
    if (!downPos || e.pointerId !== downId) return;
    // Released outside the window: a captured pointerup never reaches us, so bail on the next move.
    if (e.buttons === 0) { up(); return; }
    if (isClick && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > CLICK_THRESHOLD) {
      isClick = false; track.classList.add("is-dragging");
      if (!snap) { fill.style.transition = ""; handle.style.transition = ""; }
    }
    if (!isClick) {
      rubber(e.clientX);
      if (snap) {
        cursorVal = valFromX(e.clientX); // read by the spring loop
      } else {
        // Alt = fine scrub: a low-gain relative drag, re-anchored when Alt engages.
        let raw: number;
        if (e.altKey) {
          if (!fineAnchor) fineAnchor = { x: e.clientX, v: value };
          const native = wrap.offsetWidth || rect.width;
          raw = clamp(fineAnchor.v + ((e.clientX - fineAnchor.x) / native) * (max - min) * FINE_GAIN, min, max);
        } else {
          fineAnchor = null;
          raw = valFromX(e.clientX);
        }
        set(raw);
      }
    }
    if (e.clientX >= rect.left && e.clientX <= rect.right) { track.style.width = ""; track.style.transform = ""; }
  });
  const up = (e?: PointerEvent) => {
    if (!downPos || (e && e.pointerId !== downId)) return;
    if (snap) {
      // Let the spring settle; springFrame drops is-active once it lands.
      sDrag = false; track.classList.remove("is-dragging");
      if (!sRAF) sRAF = requestAnimationFrame(springFrame);
    } else {
      // Drop the press glide once it's home.
      snapTimer = setTimeout(() => { fill.style.transition = ""; handle.style.transition = ""; }, 360);
      track.classList.remove("is-active", "is-dragging");
    }
    track.style.transition = `width 0.35s ${EASE_SPRING}, transform 0.35s ${EASE_SPRING}`;
    track.style.width = ""; track.style.transform = "";
    setTimeout(() => { track.style.transition = ""; }, 360);
    downPos = null; fineAnchor = null; downId = null;
  };
  track.addEventListener("pointerup", up);
  track.addEventListener("pointercancel", up);
  track.addEventListener("lostpointercapture", up); // capture loss ends the drag like a release
  wireHoverClass(track, render); // re-measure the dodge on first hover
  // Re-measure the dodge once fonts settle (a web-font swap shifts the widths) and on resize.
  onReady(render);
  onLive(track, [[window, "resize"]], render); // self-cleans once the panel leaves the DOM
  track.addEventListener("keydown", (e) => {
    if (e.target !== track) return; // keys typed into the inline editor are its own
    if (downPos) return; // keys don't steer a pointer drag
    const nv = rangeStep(e, value, step, min, max, (max - min) / 10 || step * 10);
    if (nv == null) return;
    e.preventDefault();
    if (snap) { springStop(); pull = 0; track.classList.remove("is-active"); } // instant step: cancel an in-flight settle + its styling
    set(clamp(nv, min, max));
  });

  // value: hover 800ms → editable; click → inline input
  let hoverTimer: number;
  valueEl.addEventListener("mouseenter", () => { hoverTimer = setTimeout(() => valueEl.classList.add("is-editable"), 800); });
  valueEl.addEventListener("mouseleave", () => { clearTimeout(hoverTimer); if (!valueEl.classList.contains("is-editing")) valueEl.classList.remove("is-editable"); });
  valueEl.addEventListener("pointerdown", (e) => {
    // Touch/pen have no hover to arm the edit gate, so a tap on the readout arms it directly.
    if (e.pointerType && e.pointerType !== "mouse") { valueEl.classList.add("is-editable"); e.stopPropagation(); }
    else if (valueEl.classList.contains("is-editable")) e.stopPropagation();
  });
  // The inline editor, reached from the armed readout's click or Enter on the focused track. Enter
  // commits and Escape cancels, both returning focus to the track; a blur commits and leaves focus where the user sent it.
  const openEditor = () => {
    if (valueEl.classList.contains("is-editing")) return;
    const input = el("input", "tw-slider-input"); input.type = "text"; input.inputMode = parse ? "text" : "decimal"; quietFocus(input); /* click-to-type stays ringless; Enter from the track rings it */
    input.value = parse ? show(q(value)) : q(value).toFixed(decimals); // with a parse, the field edits the formatted text
    const opened = input.value; input.style.width = opened.length + 1 + "ch"; // read back: a text field drops line breaks
    valueEl.classList.add("is-editing"); valueEl.replaceWith(input); input.focus(); input.select();
    const restore = () => { input.replaceWith(valueEl); valueEl.classList.remove("is-editing", "is-editable"); };
    // Typed text is read by `parse`, or else strictly as a whole number (not parseFloat, which reads
    // "1,000" as 1). Only a finite number commits, and never text left as it opened: a format coarser
    // than the step would move the value just by opening the editor.
    const commit = () => {
      const t = input.value; let p = NaN;
      if (t !== opened) try { p = parse ? parse(t) : Number(t.replace(unit, "").trim() || NaN); } catch {}
      if (Number.isFinite(p)) set(meta.soft ? p : clamp(p, min, max));
      restore();
    };
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
    input.addEventListener("blur", commit);
    // Focus moves to the track BEFORE the input leaves the DOM (blur-commit unhooked so it doesn't commit
    // twice): removing a focused node first lands focus on <body>, and a focus() in the same task was dropped.
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { input.removeEventListener("blur", commit); track.focus(); commit(); }
      else if (e.key === "Escape") { e.stopPropagation(); input.removeEventListener("blur", commit); track.focus(); restore(); } // an Escape here mustn't also close a hosting popover
    });
  };
  valueEl.addEventListener("click", () => { if (valueEl.classList.contains("is-editable")) openEditor(); });
  track.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === track && !downPos) { e.preventDefault(); openEditor(); } });

  return { el: wrap, set: (v: number | string) => set(v, false), get: () => q(value) };
}

function createToggle(meta: Meta, onChange: OnChange): Control {
  const row = el("div", "tw-row");
  // The segmented control IS the state; this maps boolean ↔ "on"/"off" at the rim.
  const seg = createSegmented([{ value: "off", label: "Off" }, { value: "on", label: "On" }], meta.value ? "on" : "off", (v) => onChange(v === "on"), meta.label);
  row.append(txt("span", "tw-row-label", meta.label), seg.el);
  return { el: row, set: (v: unknown) => seg.set(v ? "on" : "off"), get: () => seg.get() === "on" };
}

// ── Radio grid — a segmented control wrapped into a 2- or 3-column grid for a small set of short presets. ──
function createRadiogrid(meta: Meta, onChange: OnChange): Control {
  const options: Option[] = meta.options || [];
  const cols = Math.min(3, Math.max(2, meta.cols || (options.length <= 3 ? options.length : options.length === 4 ? 2 : 3)));
  const row = el("div", "tw-radiogrid");
  const grid = el("div", "tw-radiogrid-grid"); grid.style.setProperty("--tw-rg-cols", cols);
  grid.setAttribute("role", "radiogroup"); grid.setAttribute("aria-label", meta.label);
  let value = meta.value ?? optValue(options[0]);
  const btns = options.map((o) => { const b = radioButton("tw-radiogrid-btn", o, (v) => set(v)); grid.append(b); return b; }); // lazy `set` — it's declared below
  const reflect = () => setRadioActive(btns, value);
  const set = (v: unknown, fire = true) => { if (v != null && !btns.some((b) => b._twVal === v)) return; value = v; reflect(); if (fire) onChange(v); }; // null clears the selection; an unknown value is ignored
  grid.addEventListener("keydown", (e) => {
    const i = activeIndex(btns, value); if (i < 0) return;
    const j = navIndex(e.key, i, btns.length, cols); if (j < 0) return;
    e.preventDefault(); if (j !== i) { set(btns[j]._twVal); btns[j].focus(); } // _twVal, not dataset.value (which stringifies)
  });
  reflect();
  row.append(txt("span", "tw-radiogrid-label", meta.label), grid);
  return { el: row, set: (v: unknown) => set(v, false), get: () => value };
}

// ── Select ──
// An option's colour: one token, no nesting, so a `)` can't close it early and splice a url() into the background shorthand.
const COLOR_TOKEN = /^(?:#[0-9a-f]{3,8}|[a-z]+|(?:oklch|oklab|rgba?|hsla?|hwb|lab|lch|color|var)\([^()]*\))$/i;
const CHEVRON = chevronIcon("tw-select-chevron");
function createSelect(meta: Meta, onChange: OnChange): Control {
  let value = meta.value;
  const opts = meta.options.map((o) => ({ value: optValue(o), label: optLabel(o), color: o && typeof o === "object" && typeof o.color === "string" && COLOR_TOKEN.test(o.color.trim()) ? o.color.trim() : "" }));
  const root = el("div", "tw-select");
  const trigger = btn("tw-select-trigger"); trigger.setAttribute("aria-haspopup", "listbox"); trigger.setAttribute("aria-expanded", "false");
  const right = el("span", "tw-select-right");
  // Option swatches sit over a checker so alpha reads.
  const swatchCss = (c: string) => `linear-gradient(${c}, ${c}), var(--tw-checker)`;
  const swatch = (c: string) => { const s = el("span", "tw-option-swatch"); s.style.background = swatchCss(c); return s; };
  const valSwatch = el("span", "tw-option-swatch"), valEl = el("span", "tw-select-value");
  right.append(valSwatch, valEl);
  right.insertAdjacentHTML("beforeend", CHEVRON);
  trigger.append(txt("span", "tw-select-label", meta.label), right);
  const dropdown = el("div", "tw-select-dropdown"); dropdown.setAttribute("role", "listbox");
  const optButtons = opts.map((o) => {
    const b = btn("tw-select-option"); b.setAttribute("role", "option"); if (o.color) b.append(swatch(o.color)); b.append(txt("span", "tw-option-label", o.label)); b.dataset.value = o.value;
    b.addEventListener("click", () => { set(o.value); pop.close(); });
    dropdown.append(b); return b;
  });
  root.append(trigger, dropdown);
  const reflect = () => { const cur = opts.find((o) => o.value === value); valEl.textContent = cur?.label ?? value; valSwatch.style.display = cur?.color ? "" : "none"; if (cur?.color) valSwatch.style.background = swatchCss(cur.color); optButtons.forEach((b) => { const sel = b.dataset.value === String(value); b.dataset.selected = String(sel); b.setAttribute("aria-selected", String(sel)); }); }; // dataset stringifies, so compare as strings
  const set = (v: unknown, fire = true) => { if (v != null && !opts.some((o) => o.value === v)) return; value = v; reflect(); if (fire) onChange(v); }; // null clears the selection; an unknown value is ignored
  // The shared popover shell: portaled to <body>, closes on outside-press / Esc / scroll-away,
  // and opening it closes any other popover.
  const pop = popover(root, trigger, dropdown, {
    width: "match", fallbackH: 200, gap: 4,
    onOpen: () => (optButtons.find((b) => b.dataset.value === String(value)) || optButtons[0])?.focus(),
  });
  // Enter/Space on a focused option selects it natively via click; Tab away closes by the shell's focusout rule.
  trigger.addEventListener("keydown", (e) => {
    if (!pop.isOpen() && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); pop.open(); }
  });
  dropdown.addEventListener("keydown", (e) => {
    const i = optButtons.indexOf(document.activeElement as HTMLButtonElement); let j = i;
    if (e.key === "ArrowDown") j = i < 0 ? 0 : Math.min(optButtons.length - 1, i + 1);
    else if (e.key === "ArrowUp") j = i < 0 ? optButtons.length - 1 : Math.max(0, i - 1);
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = optButtons.length - 1;
    else return;
    e.preventDefault(); optButtons[j]?.focus();
  });
  reflect();
  return { el: root, set: (v: unknown) => set(v, false), get: () => value };
}

function createButton(meta: Meta) {
  const b = txt("button", "tw-button", meta.label);
  b.addEventListener("click", () => meta.action && meta.action());
  return blade(b);
}

// ── Button group — a row of compact actions under one label. `buttons` is { label: fn } or [{label, action}]. ──
function createButtonGroup(meta: Meta) {
  const row = el("div", "tw-row tw-buttongroup");
  if (meta.label) row.append(txt("span", "tw-row-label", meta.label));
  const group = el("div", "tw-buttongroup-btns");
  const list: [string, () => void][] = Array.isArray(meta.buttons) ? meta.buttons.map((b) => [b.label ?? "Button", b.action]) : Object.entries(meta.buttons || {}); // an entry with no label is still a button, not an empty pill
  for (const [lab, fn] of list) {
    const b = txt("button", "tw-buttongroup-btn", lab);
    b.addEventListener("click", () => typeof fn === "function" && fn());
    group.append(b);
  }
  row.append(group);
  return blade(row);
}

// ── Separator — a thin divider to break a long panel into sections. ──
const createSeparator = () => blade(el("div", "tw-separator"));

// ── String — a labelled text input ──
function createString(meta: Meta, onChange: OnChange): Control {
  // A non-string default holds its string form so get() and reset() agree with the input.
  const str = (v: unknown) => (v == null ? "" : typeof v === "object" ? json(v) : String(v));
  let value = str(meta.value);
  const multi = meta.rows > 0;
  const row = el("div", multi ? "tw-row tw-row-multiline" : "tw-row");
  const input = el(multi ? "textarea" : "input", multi ? "tw-text tw-textarea" : "tw-text");
  if (multi) (input as HTMLTextAreaElement).rows = meta.rows; else (input as HTMLInputElement).type = "text";
  input.value = value;
  quietFocus(input); // click-to-type stays ringless; Tab rings
  if (meta.placeholder) input.placeholder = meta.placeholder;
  input.addEventListener("input", () => { value = input.value; onChange(value); });
  // Long text clips softly: the edge with more past it fades (a mask, so the fade is the panel's own backdrop).
  const clip = () => { const more = input.scrollHeight - input.clientHeight > 1; input.classList.toggle("is-clip-top", more && input.scrollTop > 1); input.classList.toggle("is-clip-bottom", more && input.scrollTop + input.clientHeight < input.scrollHeight - 1); };
  if (multi) { input.addEventListener("scroll", clip); input.addEventListener("input", clip); if (typeof ResizeObserver === "function") new ResizeObserver(clip).observe(input); }
  row.append(txt("span", "tw-row-label", meta.label), input);
  return { el: row, set: (v: unknown) => { value = str(v); input.value = value; if (multi) clip(); }, get: () => value }; // null → "", not the literal "undefined"
}

// ── Folder — a collapsible titled group; `body` is the inner container the caller fills. ──
function createFolder(meta: { label: string }) {
  const root = el("div", "tw-folder");
  const header = btn("tw-folder-header"); header.setAttribute("aria-expanded", "true");
  header.append(txt("span", "tw-folder-title", meta.label));
  header.insertAdjacentHTML("beforeend", ICON_CHEVRON); // chevron trails the title
  const body = el("div", "tw-folder-body");
  const inner = el("div", "tw-controls"); body.append(inner);
  root.append(header, body);
  const collapse = (c: boolean) => setCollapsed(root, header, body, c); // the shared fold: class + aria-expanded + inert on the body
  header.addEventListener("click", () => collapse(!root.classList.contains("is-collapsed")));
  return { el: root, body: inner, setCollapsed: collapse };
}
/** Builds a control from the registry; a constructor that throws degrades to null so one bad control can't abort the panel. */
function createControl(meta: Meta, onChange: OnChange): Control | null {
  const make = getControl(meta.type);
  if (!make) return null;
  try { return make(meta, onChange); }
  catch (e) { console.error("[tweaks] control failed to build:", meta && meta.type, e); return null; }
}
// Core controls register synchronously; lazy ones register when imported.
registerControl("slider", createSlider);
registerControl("checkbox", createToggle);
registerControl("radiogrid", createRadiogrid);
registerControl("list", createSelect);
registerControl("button", createButton);
registerControl("buttongroup", createButtonGroup);
registerControl("separator", createSeparator);
registerControl("text", createString);
registerControl("folder", createFolder);

export { createFolder, createControl };
