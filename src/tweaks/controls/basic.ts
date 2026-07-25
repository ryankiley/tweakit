/* The core controls — always-registered constructors (slider, toggle, radio grid,
 * select, buttons, text, number, folder) plus createControl, the degrade-to-skip
 * wrapper every builder calls. Statically imported by the entry, unlike the lazy
 * siblings in this directory, so basic panels build synchronously. */
import {
  el, btn, txt, clamp, stepPrecision, roundToStep, normalizeRange, rangeStep, overlapsText, optValue, optLabel,
  popover, radioButton, setRadioActive, navIndex, createSegmented, numField, blade,
  quietFocus, wireHoverClass, onReady, onLive, registerControl, getControl,
  EASE_SPRING, EASE_GLIDE,
} from "../shared.js";
import { ICON_CHEVRON, chevronIcon } from "../icons.js";

// ── Slider control ──
const CLICK_THRESHOLD = 3, DEAD_ZONE = 32, MAX_CURSOR_RANGE = 200, MAX_STRETCH = 8;
function createSlider(meta, onChange) {
  const label = meta.label;
  // Normalise the range before anything reads it (normalizeRange, shared with the
  // interval) — every slider source (schema shorthand, verbose form, [data-tw]
  // markup) funnels through it.
  const { min, max, step } = normalizeRange(meta.min, meta.max, meta.step);
  const snap = (max - min) / step <= 6; // snap + show rule lines only for a handful of stops; past ~6, snapping at every step felt notchy ("too many places"), so those run continuous
  const seed = Number.isFinite(+meta.value) ? +meta.value : min; // non-finite seed → min, so a NaN value / garbage data-value can't reach the readout or param
  let value = meta.soft && !snap ? seed : clamp(seed, min, max), pull = 0; // a soft slider keeps an out-of-range default — the seed is a scripted value, so it follows set()'s soft rule (only the snap slider always clamps, also like set()); pull = the discrete detent's tension offset (read by render(), called below at construction)
  const decimals = stepPrecision(step);

  const wrap = el("div", "tw-slider-wrap");
  const track = el("div", "tw-slider");
  const hashes = el("div", "tw-slider-hashmarks");
  const fill = el("div", "tw-slider-fill");
  const handle = el("div", "tw-slider-handle");
  const labelEl = txt("span", "tw-slider-label", label);
  const valueEl = el("span", "tw-slider-value");
  track.append(hashes, fill, handle, labelEl, valueEl);
  wrap.append(track);

  // Keyboard + ARIA: the track is a focusable role="slider"; value attributes are
  // refreshed in render() below. Arrow keys step (⇧ = coarse), Page jumps a tenth,
  // Home/End snap to the ends — native range semantics.
  track.tabIndex = 0;
  track.setAttribute("role", "slider");
  track.setAttribute("aria-label", label);
  track.setAttribute("aria-valuemin", String(min));
  track.setAttribute("aria-valuemax", String(max));

  // Rule lines (hashmarks) live only on the discrete slider — one per step. The
  // continuous slider has none.
  const q = (v) => roundToStep(v, min, step);
  const marks = snap ? Array.from({ length: Math.max(0, Math.round((max - min) / step) - 1) }, (_, i) => ((i + 1) * step) / (max - min) * 100) : [];
  for (const pct of marks) { const m = el("div", "tw-slider-hashmark"); m.style.left = pct + "%"; hashes.append(m); }

  // value stays continuous for smooth sliders; fill/handle track it directly,
  // only the readout + emitted value round to step (the fill + handle stay continuous).
  const render = () => {
    const pct = clamp(((value - min) / ((max - min) || 1)) * 100, 0, 100); // clamp the visual; a soft value past max still shows its real number in the readout
    // `pull` is the discrete detent's light tension — the active track stretches a
    // few px off its notch toward the cursor; the handle rides the same edge.
    const off = pull ? ` + ${pull.toFixed(1)}px` : "";
    const edge = `${pct}%${off}`;
    fill.style.width = pull ? `calc(${edge})` : pct + "%";
    handle.style.left = `max(5px, calc(${edge} - 9px))`; // the inset hairline rides just inside the fill edge
    const qv = q(value), qvText = qv.toFixed(decimals); // q(value) is pure — compute once (render() runs every drag frame)
    valueEl.textContent = qvText;
    track.setAttribute("aria-valuenow", String(qv));
    track.setAttribute("aria-valuetext", qvText);
    // Value-dodge: the handle yields only when it actually overlaps the
    // label (left) or value (right) text — comparing the handle's real pixel span
    // (it renders at pct% − 9px, 3px wide) against each text's measured edge, so it
    // dims right as it reaches the number, not a fixed fraction early.
    const trackW = wrap.offsetWidth;
    if (trackW) {
      // Dodge tracks the handle's *actual* span: the hairline renders at pct%−9px
      // (3px wide), tested for pure overlap against the live-measured label/value
      // spans (overlapsText, shared with the interval) — the handle dims only while
      // it truly covers the text and re-shows the instant it clears.
      const hx = Math.max(5, (pct / 100) * trackW + pull - 9);
      track.classList.toggle("is-dodge", overlapsText(labelEl, valueEl, hx, 3));
    }
  };
  render();

  let rect = null, scale = 1, downPos = null, isClick = true, snapTimer, fineAnchor = null, downId = null;
  const GLIDE_FILL = `width 0.34s ${EASE_GLIDE}`;
  const GLIDE_HANDLE = `left 0.34s ${EASE_GLIDE}, opacity 0.15s, transform 0.2s ${EASE_SPRING}`;
  // Discrete detent — an eager spring-commit (the "snap sooner" model picked in the slider
  // lab). The value COMMITS at 30% of the gap — sooner than a midpoint snap — and the handle
  // SPRINGS to the committed notch: magnetised to the step, it resists the pull, then breaks
  // past the commit point and springs across, leaning toward the cursor before it lets go.
  // Driven by the rAF integrator (springFrame) below, running only while dragging or settling.
  // `pull` carries the spring's px offset from the committed notch (read by render()).
  // Only FINE_GAIN survives from the old tanh model.
  const FINE_GAIN = 0.2;
  const valFromX = (clientX) => {
    if (!rect) return value;
    const native = wrap.offsetWidth || rect.width;
    const pct = clamp((clientX - rect.left) / scale / native, 0, 1);
    return clamp(min + pct * (max - min), min, max);
  };
  const rubber = (clientX) => {
    let s = 0;
    if (clientX < rect.left) s = -MAX_STRETCH * Math.sqrt(Math.min(Math.max(0, rect.left - clientX - DEAD_ZONE) / MAX_CURSOR_RANGE, 1));
    else if (clientX > rect.right) s = MAX_STRETCH * Math.sqrt(Math.min(Math.max(0, clientX - rect.right - DEAD_ZONE) / MAX_CURSOR_RANGE, 1));
    track.style.width = `calc(100% + ${Math.abs(s)}px)`;
    track.style.transform = s < 0 ? `translateX(${s}px)` : "";
  };
  const set = (v, fire = true) => { v = +v; if (!Number.isFinite(v)) return; value = snap ? clamp(q(v), min, max) : (meta.soft ? v : clamp(v, min, max)); render(); if (fire) onChange(q(value)); }; // non-finite (NaN/±∞ from a stray .set()/restore) is ignored; soft: typed/scripted values may exceed [min,max] (drag stays bounded via valFromX)

  // ── Spring-commit detent (snap sliders) ──
  // Physics in step-index space (notches at integers): a cursor spring pulls the handle
  // toward the finger while the value commits at 30% of the gap. Tuned in the lab.
  const STEPS = Math.max(1, Math.round((max - min) / step));
  const C_COMMIT = 0.2, C_LEAN = 0.3, C_K = 520, C_D = 27; // C_COMMIT = 0.5 − 0.30 (commit fraction)
  const toIdx = (v) => (v - min) / step;
  let sx = 0, sv = 0, sRAF = 0, sDrag = false, sPrevEi: number | null = null, cursorVal = value, sPrevT = 0;
  const springStop = () => { if (sRAF) cancelAnimationFrame(sRAF); sRAF = 0; sPrevT = 0; };
  const springFrame = (now: number) => {
    if (!track.isConnected) { springStop(); return; } // panel torn down mid-drag — bail
    const dt = sPrevT ? Math.min((now - sPrevT) / 1000, 0.05) : 1 / 60; sPrevT = now;
    const trackW = wrap.offsetWidth || (rect && rect.width) || 1;
    const ui = toIdx(clamp(cursorVal, min, max));
    const ei = clamp(Math.round(ui + C_COMMIT), 0, STEPS); // eager commit: 30% past the notch
    const tx = sDrag ? ei + C_LEAN * clamp(ui - ei, -0.5, 0.5) : ei; // lean toward the cursor, then settle on the notch
    let t = dt; const h = 1 / 240;
    while (t > 1e-4) { const s = Math.min(h, t); t -= s; const a = C_K * (tx - sx) - C_D * sv; sv += a * s; sx += sv * s; if (sx < 0) { sx = 0; sv = 0; } if (sx > STEPS) { sx = STEPS; sv = 0; } }
    pull = (sx - ei) * step / ((max - min) || 1) * trackW; // spring offset from the committed notch, in px
    value = clamp(min + ei * step, min, max); render();
    if (ei !== sPrevEi) { sPrevEi = ei; onChange(q(value)); } // emit once per commit, not per frame
    if (!sDrag && Math.abs(sv) < 0.004 && Math.abs(sx - ei) < 0.004) { sx = ei; sv = 0; pull = 0; render(); springStop(); track.classList.remove("is-active"); }
    else sRAF = requestAnimationFrame(springFrame);
  };
  const springStart = (clientX: number) => { sx = toIdx(value); sv = 0; sDrag = true; sPrevEi = Math.round(toIdx(value)); cursorVal = valFromX(clientX); if (!sRAF) sRAF = requestAnimationFrame(springFrame); };

  track.addEventListener("pointerdown", (e) => {
    if (valueEl.classList.contains("is-editing")) return;
    if (e.button !== 0 || downPos) return; // primary button only; a second pointer can't hijack a live drag
    e.preventDefault();
    track.focus({ focusVisible: false }); // restore click-to-focus (preventDefault suppressed it) so click-then-arrow-keys works — but WITHOUT the keyboard focus ring: a mouse press shouldn't draw :focus-visible (programmatic focus otherwise reads as keyboard to the browser). Keyboard Tab still rings. Option is ignored on browsers that lack it (no regression).
    downId = e.pointerId;
    try { e.target.setPointerCapture(e.pointerId); } catch {}
    clearTimeout(snapTimer); track.style.transition = "";
    downPos = { x: e.clientX, y: e.clientY }; isClick = true;
    track.classList.add("is-active");
    rect = wrap.getBoundingClientRect(); scale = rect.width / (wrap.offsetWidth || rect.width);
    // Snap sliders spring to the pressed notch (the detent owns width/left; CSS handles only
    // the handle reveal). Continuous sliders jump to the pressed position, gliding there — a
    // drag takes over from here, the glide cleared on the first move so dragging stays 1:1.
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
    // Released off-track (e.g. outside the window, where a captured pointerup never
    // reaches us): the button is up but we're still in the drag. Bail on the next
    // move so the slider doesn't keep following the cursor.
    if (e.buttons === 0) { up(); return; }
    if (isClick && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > CLICK_THRESHOLD) {
      isClick = false; track.classList.add("is-dragging");
      // Continuous follows the cursor 1:1; the snap detent's spring is already running.
      if (!snap) { fill.style.transition = ""; handle.style.transition = ""; }
    }
    if (!isClick) {
      rubber(e.clientX);
      if (snap) {
        cursorVal = valFromX(e.clientX); // the spring loop reads this, commits at 30%, and springs the handle across
      } else {
        // Alt = fine scrub: drop into a low-gain relative drag, re-anchored the moment Alt
        // engages, so a continuous slider can be tuned sub-pixel. Shift = coarse on the keyboard.
        let raw;
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
  const up = (e?) => {
    if (!downPos || (e && e.pointerId !== downId)) return;
    if (snap) {
      // Let the spring settle onto the committed notch — springFrame clears the pull,
      // drops is-active, and stops the loop once it lands; keep is-active until then.
      sDrag = false; track.classList.remove("is-dragging");
      if (!sRAF) sRAF = requestAnimationFrame(springFrame);
    } else {
      // Continuous: drop the press glide once it's home, and spring the edge rubber-band back.
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
  track.addEventListener("lostpointercapture", up); // implicit capture loss ends the drag like a release — no stranded is-active/is-dragging state
  // Reveal the handle on hover — JS companion to the CSS :hover.
  wireHoverClass(track, render); // re-render the value-dodge with the real track width on first hover
  // Harden the dodge against type metrics it can't predict: recompute once layout +
  // fonts settle (a web-font swap or a custom --tw-font-sans shifts the label/value
  // widths it measures), and on any track-width change. The dodge already reads the
  // real offsetWidth, so it adapts to any font — this just keeps it in sync.
  onReady(render);
  onLive(track, [[window, "resize"]], render); // self-cleans once the panel leaves the DOM
  track.addEventListener("keydown", (e) => {
    if (snap) { springStop(); pull = 0; } // keyboard steps are instant — cancel any in-flight settle + its offset
    const nv = rangeStep(e, value, step, min, max, (max - min) / 10 || step * 10); // the shared range keyboard model (arrows/⇧/Page/Home/End)
    if (nv == null) return;
    e.preventDefault();
    set(clamp(nv, min, max));
  });

  // value: hover 800ms → editable; click → inline input (ported)
  let hoverTimer;
  valueEl.addEventListener("mouseenter", () => { hoverTimer = setTimeout(() => valueEl.classList.add("is-editable"), 800); });
  valueEl.addEventListener("mouseleave", () => { clearTimeout(hoverTimer); if (!valueEl.classList.contains("is-editing")) valueEl.classList.remove("is-editable"); });
  valueEl.addEventListener("pointerdown", (e) => {
    // Touch/pen have no hover to arm the 800ms edit gate, so a deliberate tap on the
    // readout arms it directly (and is kept off the track so it doesn't jump the slider).
    if (e.pointerType && e.pointerType !== "mouse") { valueEl.classList.add("is-editable"); e.stopPropagation(); }
    else if (valueEl.classList.contains("is-editable")) e.stopPropagation();
  });
  valueEl.addEventListener("click", () => {
    if (!valueEl.classList.contains("is-editable")) return;
    const input = el("input", "tw-slider-input"); input.type = "text"; input.inputMode = "decimal"; input.value = q(value).toFixed(decimals);
    valueEl.classList.add("is-editing"); valueEl.replaceWith(input); input.focus(); input.select();
    const commit = () => { const p = parseFloat(input.value); if (!isNaN(p)) set(meta.soft ? p : clamp(p, min, max)); input.replaceWith(valueEl); valueEl.classList.remove("is-editing", "is-editable"); };
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") { input.replaceWith(valueEl); valueEl.classList.remove("is-editing", "is-editable"); } });
  });

  return { el: wrap, set: (v) => set(v, false), get: () => q(value) };
}

function createToggle(meta, onChange) {
  const row = el("div", "tw-row");
  // A boolean, shown as a two-segment Off/On pill that slides — the segmented control
  // IS the state (one source of truth); this just maps boolean ↔ "on"/"off" at the rim.
  const seg = createSegmented([{ value: "off", label: "Off" }, { value: "on", label: "On" }], meta.value ? "on" : "off", (v) => onChange(v === "on"), meta.label);
  row.append(txt("span", "tw-row-label", meta.label), seg.el);
  return { el: row, set: (v) => seg.set(v ? "on" : "off"), get: () => seg.get() === "on" };
}

// ── Radio grid — a segmented control wrapped into a 2- or 3-column grid, for a
// small set of short presets (10/25/50/100%, ratios, sizes) that won't fit
// inline on one row. Single-select; columns clamp to 2–3 (default by count). ──
function createRadiogrid(meta, onChange) {
  const options = meta.options || [];
  const cols = Math.min(3, Math.max(2, meta.cols || (options.length <= 3 ? options.length : options.length === 4 ? 2 : 3)));
  const row = el("div", "tw-radiogrid");
  const grid = el("div", "tw-radiogrid-grid"); grid.style.setProperty("--tw-rg-cols", cols);
  grid.setAttribute("role", "radiogroup"); grid.setAttribute("aria-label", meta.label);
  let value = meta.value ?? optValue(options[0]);
  const btns = options.map((o) => { const b = radioButton("tw-radiogrid-btn", o, (v) => set(v)); grid.append(b); return b; }); // lazy `set` — it's declared below
  const reflect = () => setRadioActive(btns, value);
  const set = (v, fire = true) => { value = v; reflect(); if (fire) onChange(v); };
  // Arrow keys roam the grid: ←/→ step linearly (wrapping), ↑/↓ jump a row (by
  // the column count, clamped at the edges); Home/End to the ends.
  grid.addEventListener("keydown", (e) => {
    const i = btns.findIndex((b) => b.dataset.value === String(value)); if (i < 0) return;
    const j = navIndex(e.key, i, btns.length, cols); if (j < 0) return;
    e.preventDefault(); if (j !== i) { set(btns[j]._twVal); btns[j].focus(); } // _twVal, not dataset.value — same reason as the segmented control
  });
  reflect();
  row.append(txt("span", "tw-radiogrid-label", meta.label), grid);
  return { el: row, set: (v) => set(v, false), get: () => value };
}

// ── Select ──
const CHEVRON = chevronIcon("tw-select-chevron"); // the shared chevron shape, in the select's own class
function createSelect(meta, onChange) {
  let value = meta.value;
  const opts = meta.options.map((o) => ({ value: optValue(o), label: optLabel(o) }));
  const root = el("div", "tw-select");
  const trigger = btn("tw-select-trigger"); trigger.setAttribute("aria-haspopup", "listbox"); trigger.setAttribute("aria-expanded", "false");
  const right = el("span", "tw-select-right");
  const valEl = el("span", "tw-select-value");
  right.append(valEl);
  right.insertAdjacentHTML("beforeend", CHEVRON);
  trigger.append(txt("span", "tw-select-label", meta.label), right);
  const dropdown = el("div", "tw-select-dropdown"); dropdown.setAttribute("role", "listbox");
  const optButtons = opts.map((o) => {
    const b = btn("tw-select-option"); b.setAttribute("role", "option"); b.textContent = o.label; b.dataset.value = o.value;
    b.addEventListener("click", () => { set(o.value); pop.close(); });
    dropdown.append(b); return b;
  });
  root.append(trigger, dropdown);
  const reflect = () => { valEl.textContent = (opts.find((o) => o.value === value) || {}).label ?? value; optButtons.forEach((b) => { const sel = b.dataset.value === String(value); b.dataset.selected = String(sel); b.setAttribute("aria-selected", String(sel)); }); }; // String(value): dataset stringifies, so numeric option values never matched (no selected/aria state)
  const set = (v, fire = true) => { value = v; reflect(); if (fire) onChange(v); };
  // The shared popover shell portals the dropdown to <body> (never clipped by the
  // panel's overflow or a transformed ancestor), themes + places it, and closes on
  // outside-press / Esc-back-to-trigger / scroll-away — the same machinery as the
  // colour and gradient editors, so opening the listbox closes any other popover.
  // Only the roving-focus listbox keyboarding below is select-specific.
  const pop = popover(root, trigger, dropdown, {
    width: "match", fallbackH: 200, gap: 4,
    onOpen: () => (optButtons.find((b) => b.dataset.value === String(value)) || optButtons[0])?.focus(),
  });
  // Keyboard: open from the trigger with ↑/↓; once open, roving focus moves through
  // the options (Enter/Space on a focused option selects it natively via click),
  // Escape closes back to the trigger, and Tab/click away closes the listbox.
  trigger.addEventListener("keydown", (e) => {
    if (!pop.isOpen() && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); pop.open(); }
  });
  dropdown.addEventListener("keydown", (e) => {
    const i = optButtons.indexOf(document.activeElement); let j = i;
    if (e.key === "ArrowDown") j = i < 0 ? 0 : Math.min(optButtons.length - 1, i + 1);
    else if (e.key === "ArrowUp") j = i < 0 ? optButtons.length - 1 : Math.max(0, i - 1);
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = optButtons.length - 1;
    else return;
    e.preventDefault(); optButtons[j]?.focus();
  });
  const onFocusOut = (e) => { if (pop.isOpen() && !root.contains(e.relatedTarget) && !dropdown.contains(e.relatedTarget)) pop.close(); };
  trigger.addEventListener("focusout", onFocusOut); dropdown.addEventListener("focusout", onFocusOut);
  reflect();
  return { el: root, set: (v) => set(v, false), get: () => value };
}

function createButton(meta) {
  const b = txt("button", "tw-button", meta.label); b.type = "button";
  b.addEventListener("click", () => meta.action && meta.action());
  return blade(b);
}

// ── Button group — a row of compact actions under one label, the action sibling
// to the radio grid. `buttons` is { label: fn } or [{label, action}]. ──
function createButtonGroup(meta) {
  const row = el("div", "tw-row tw-buttongroup");
  if (meta.label) row.append(txt("span", "tw-row-label", meta.label));
  const group = el("div", "tw-buttongroup-btns");
  const list = Array.isArray(meta.buttons) ? meta.buttons.map((b) => [b.label, b.action]) : Object.entries(meta.buttons || {});
  for (const [lab, fn] of list) {
    const b = txt("button", "tw-buttongroup-btn", lab); b.type = "button";
    b.addEventListener("click", () => typeof fn === "function" && fn());
    group.append(b);
  }
  row.append(group);
  return blade(row);
}

// ── Separator — a thin divider to break a long panel into sections. ──
const createSeparator = () => blade(el("div", "tw-separator"));

// ── String — a labelled text input ──
function createString(meta, onChange) {
  let value = meta.value ?? "";
  // `rows` makes it a multiline textarea: the row
  // grows to fit and aligns its label to the top instead of centring.
  const multi = meta.rows > 0;
  const row = el("div", multi ? "tw-row tw-row-multiline" : "tw-row");
  const input = el(multi ? "textarea" : "input", multi ? "tw-text tw-textarea" : "tw-text");
  if (multi) input.rows = meta.rows; else input.type = "text";
  input.value = value;
  quietFocus(input); // click-to-type stays ringless; Tab rings
  if (meta.placeholder) input.placeholder = meta.placeholder;
  input.addEventListener("input", () => { value = input.value; onChange(value); });
  row.append(txt("span", "tw-row-label", meta.label), input);
  return { el: row, set: (v) => { value = v == null ? "" : String(v); input.value = value; }, get: () => value }; // null/undefined → "", not the literal "undefined" the input renders for a raw assignment
}

// ── Number — the shared numField engine in its row chrome: a typeable field with a
// grab handle (drag to scrub), min-anchored rounding, soft support. ──
const createNumber = (meta, onChange) => numField({ ...meta, row: true }, onChange);

// ── Folder — a collapsible titled group. Returns its inner
// container as `body` so the caller fills it; collapse reuses the grid-rows trick. ──
function createFolder(meta) {
  const root = el("div", "tw-folder");
  const header = btn("tw-folder-header"); header.setAttribute("aria-expanded", "true");
  header.append(txt("span", "tw-folder-title", meta.label));
  header.insertAdjacentHTML("beforeend", ICON_CHEVRON); // chevron trails the title
  const body = el("div", "tw-folder-body");
  const inner = el("div", "tw-controls"); body.append(inner);
  root.append(header, body);
  // inert on the collapsed body takes its (still-mounted, clip-faded) controls out of the
  // tab order + a11y tree — otherwise a keyboard/SR user lands on invisible zero-height rows
  // that aria-expanded="false" claims are hidden. Synchronous, so it's correct under reduced-motion.
  const setCollapsed = (c) => { root.classList.toggle("is-collapsed", c); header.setAttribute("aria-expanded", c ? "false" : "true"); body.inert = c; };
  header.addEventListener("click", () => setCollapsed(!root.classList.contains("is-collapsed")));
  // setCollapsed lets the panel read + restore the open/closed state (toJSON/fromJSON).
  return { el: root, body: inner, setCollapsed };
}
// One bad control constructor must not abort the whole panel build — degrade to
// skipping just that control (every caller null-checks). Constructors come from
// the registry: core ones registered below, lazy ones once their module loads.
function createControl(meta, onChange) {
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
registerControl("number", createNumber);
registerControl("folder", createFolder);

export { createFolder, createControl };
