/* The core controls — always-registered constructors (slider, toggle, radio grid, select,
 * buttons, text, folder) plus createControl. Statically imported by the entry, so basic panels build synchronously. */
import {
  el,
  btn,
  txt,
  clamp,
  stepPrecision,
  gridEnds,
  roundToStep,
  normalizeRange,
  rangeStep,
  overlapsText,
  optValue,
  optLabel,
  json,
  popover,
  radioButton,
  setRadioActive,
  activeIndex,
  navIndex,
  createSegmented,
  blade,
  foldBody,
  quietFocus,
  activeIn,
  words,
  wireHoverClass,
  onReady,
  onLive,
  registerControl,
  getControl,
  rubberBand,
  rubberRelease,
  EASE_SPRING,
  EASE_GLIDE,
  REDUCE_MOTION,
} from "../shared.js";
import { ICON_CHEVRON, chevronIcon } from "../icons.js";
import type { OnChange } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control, Option } from "../types.js";

// ── Slider control ──
const CLICK_THRESHOLD = 3;
function createSlider(meta: Meta, onChange: OnChange): Control {
  const label = meta.label;
  let { min, max, step } = normalizeRange(meta.min, meta.max, meta.step, [+(meta.value as number)], label);
  // A hard slider's range is its reachable grid: the ends move in to the first/last grid point,
  // so notches, hashmarks, keyboard ends, aria bounds and the emitted value agree. A soft slider keeps its authored
  // range.
  if (!meta.soft) [min, max] = gridEnds(min, max, step);
  const snap = (max - min) / step <= 6; // past ~6 stops, snapping at every step felt notchy
  const seed = Number.isFinite(+meta.value) ? +meta.value : min; // a non-finite seed → min
  // A soft slider keeps an out-of-range default, as set() does; pull is the detent's tension offset read by render().
  let value = meta.soft && !snap ? seed : clamp(seed, min, max),
    pull = 0;
  const decimals = stepPrecision(step);

  const wrap = el("div", "twk-slider-wrap");
  const track = el("div", "twk-slider");
  const hashes = el("div", "twk-slider-hashmarks");
  const fill = el("div", "twk-slider-fill");
  const handle = el("div", "twk-slider-handle");
  const labelEl = txt("span", "twk-slider-label", label);
  const valueEl = el("span", "twk-slider-value");
  // The readout is a text node plus a muted unit suffix; the param stays the bare number.
  const unit = typeof meta.unit === "string" ? meta.unit.trim() : "",
    numText = document.createTextNode("");
  const joined = !unit ? "" : /^[%°]$/.test(unit) ? unit : " " + unit; // "50%", "90°", but "24 px", "300 ms"
  valueEl.append(numText);
  if (unit) valueEl.append(txt("span", "twk-slider-unit", joined));
  // A format that throws or returns a non-string falls back to the digits, so it can't blank the slider.
  const format = meta.format,
    parse = meta.parse;
  const show = (v: number) => {
    if (format) {
      try {
        const s = format(v);
        if (typeof s === "string" && s) return s;
      } catch {}
    }
    return v.toFixed(decimals);
  };
  track.append(hashes, fill, handle, labelEl, valueEl);
  wrap.append(track);

  track.tabIndex = 0;
  track.setAttribute("role", "slider");
  track.setAttribute("aria-label", label);
  track.setAttribute("aria-valuemin", String(min));
  track.setAttribute("aria-valuemax", String(max));

  const q = (v: number) => roundToStep(v, min, step); // min/max sit on the grid, so a clamped value rounds inside
  const marks = snap
    ? Array.from(
        { length: Math.max(0, Math.round((max - min) / step) - 1) },
        (_, i) => (((i + 1) * step) / (max - min)) * 100,
      )
    : [];
  for (const pct of marks) {
    const m = el("div", "twk-slider-hashmark");
    m.style.left = pct + "%";
    hashes.append(m);
  }

  // value stays continuous; only the readout + emitted value round to step.
  const render = () => {
    // clamp the visual; a soft readout shows its real number
    const pct = clamp(((value - min) / (max - min || 1)) * 100, 0, 100);
    const off = pull ? ` + ${pull.toFixed(1)}px` : "";
    const edge = `${pct}%${off}`;
    fill.style.width = pull ? `calc(${edge})` : pct + "%";
    handle.style.left = `max(5px, calc(${edge} - 9px))`; // the inset hairline rides just inside the fill edge
    const qv = q(value),
      qvText = show(qv);
    numText.data = qvText;
    track.setAttribute("aria-valuenow", String(qv));
    track.setAttribute("aria-valuetext", qvText + joined);
    // Value-dodge: the handle dims only while its real pixel span overlaps the label or value text.
    const trackW = wrap.offsetWidth,
      valueW = valueEl.offsetWidth;
    if (trackW) {
      // The label's room is what the readout leaves: 12px inset + 8px gap + the readout's 10px inset.
      if (valueW) labelEl.style.maxWidth = Math.max(0, trackW - valueW - 30) + "px";
      const hx = Math.max(5, (pct / 100) * trackW + pull - 9);
      track.classList.toggle("is-dodge", overlapsText(labelEl, valueEl, hx, 3));
    }
  };
  render();

  let rect: DOMRect | null = null,
    scale = 1,
    downPos: { x: number; y: number } | null = null,
    isClick = true,
    snapTimer: number,
    fineAnchor: { x: number; v: number } | null = null,
    downId: number | null = null;
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
  // a non-finite value is ignored; soft may exceed the range
  const set = (v: number | string, fire = true) => {
    v = +v;
    if (!Number.isFinite(v)) return;
    value = snap ? clamp(q(v), min, max) : meta.soft ? v : clamp(v, min, max);
    render();
    if (fire) onChange(q(value));
  };

  // ── Spring-commit detent (snap sliders) ──
  // Physics in step-index space (notches at integers).
  const STEPS = Math.max(1, Math.round((max - min) / step));
  const C_COMMIT = 0.2,
    C_LEAN = 0.3,
    C_K = 520,
    C_D = 27; // C_COMMIT = 0.5 − 0.30 (commit fraction)
  const toIdx = (v: number) => (v - min) / step;
  let sx = 0,
    sv = 0,
    sRAF = 0,
    sDrag = false,
    sPrevEi: number | null = null,
    cursorVal = value,
    sPrevT = 0;
  const springStop = () => {
    if (sRAF) cancelAnimationFrame(sRAF);
    sRAF = 0;
    sPrevT = 0;
  };
  const springFrame = (now: number) => {
    // panel torn down mid-drag — bail
    if (!track.isConnected) {
      springStop();
      return;
    }
    const dt = sPrevT ? Math.min((now - sPrevT) / 1000, 0.05) : 1 / 60;
    sPrevT = now;
    const trackW = wrap.offsetWidth || (rect && rect.width) || 1;
    const ui = toIdx(clamp(cursorVal, min, max));
    const ei = clamp(Math.round(ui + C_COMMIT), 0, STEPS); // eager commit: 30% past the notch
    const tx = sDrag ? ei + C_LEAN * clamp(ui - ei, -0.5, 0.5) : ei; // lean toward the cursor, then settle on the notch
    // Reduced motion: the handle sits on its target every frame. The CSS kill-switch can't reach
    // this, since the detent drives left/width from rAF, not a transition. Read live.
    if (REDUCE_MOTION.matches) {
      sx = tx;
      sv = 0;
    } else {
      let t = dt;
      const h = 1 / 240;
      while (t > 1e-4) {
        const s = Math.min(h, t);
        t -= s;
        const a = C_K * (tx - sx) - C_D * sv;
        sv += a * s;
        sx += sv * s;
        if (sx < 0) {
          sx = 0;
          sv = 0;
        }
        if (sx > STEPS) {
          sx = STEPS;
          sv = 0;
        }
      }
    }
    pull = (((sx - ei) * step) / (max - min || 1)) * trackW; // spring offset from the committed notch, in px
    value = clamp(min + ei * step, min, max);
    render();
    // emit once per commit, not per frame
    if (ei !== sPrevEi) {
      sPrevEi = ei;
      onChange(q(value));
    }
    if (!sDrag && Math.abs(sv) < 0.004 && Math.abs(sx - ei) < 0.004) {
      sx = ei;
      sv = 0;
      pull = 0;
      render();
      springStop();
      track.classList.remove("is-active");
    } else sRAF = requestAnimationFrame(springFrame);
  };
  const springStart = (clientX: number) => {
    sx = toIdx(value);
    sv = 0;
    sDrag = true;
    sPrevEi = Math.round(toIdx(value));
    cursorVal = valFromX(clientX);
    if (!sRAF) sRAF = requestAnimationFrame(springFrame);
  };

  track.addEventListener("pointerdown", (e) => {
    if (valueEl.classList.contains("is-editing")) return;
    if (e.button !== 0 || downPos) return; // primary button only; no second-pointer hijack
    e.preventDefault();
    // preventDefault suppressed click-to-focus; restore it without the keyboard ring (programmatic focus otherwise
    // reads as keyboard).
    track.focus({ focusVisible: false });
    downId = e.pointerId;
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {}
    clearTimeout(snapTimer);
    track.style.transition = "";
    downPos = { x: e.clientX, y: e.clientY };
    isClick = true;
    track.classList.add("is-active");
    rect = wrap.getBoundingClientRect();
    scale = rect.width / (wrap.offsetWidth || rect.width);
    // Snap springs to the pressed notch; continuous glides there, the glide cleared on the first move so dragging stays
    // 1:1.
    if (snap) {
      fill.style.transition = "";
      handle.style.transition = "";
      springStart(e.clientX);
    } else {
      fill.style.transition = GLIDE_FILL;
      handle.style.transition = GLIDE_HANDLE;
      set(valFromX(e.clientX));
    }
  });
  track.addEventListener("pointermove", (e) => {
    if (!downPos || e.pointerId !== downId) return;
    // Released outside the window: a captured pointerup never reaches us, so bail on the next move.
    if (e.buttons === 0) {
      up();
      return;
    }
    if (isClick && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > CLICK_THRESHOLD) {
      isClick = false;
      track.classList.add("is-dragging");
      if (!snap) {
        fill.style.transition = "";
        handle.style.transition = "";
      }
    }
    if (!isClick) {
      rubberBand(track, rect, e.clientX);
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
  });
  const up = (e?: PointerEvent) => {
    if (!downPos || (e && e.pointerId !== downId)) return;
    if (snap) {
      // Let the spring settle; springFrame drops is-active once it lands.
      sDrag = false;
      track.classList.remove("is-dragging");
      if (!sRAF) sRAF = requestAnimationFrame(springFrame);
    } else {
      // Drop the press glide once it's home.
      snapTimer = setTimeout(() => {
        fill.style.transition = "";
        handle.style.transition = "";
      }, 360);
      track.classList.remove("is-active", "is-dragging");
    }
    rubberRelease(track);
    downPos = null;
    fineAnchor = null;
    downId = null;
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
    if (e.key === "Enter") {
      e.preventDefault();
      return openEditor();
    }
    const nv = rangeStep(e, value, step, min, max, (max - min) / 10 || step * 10);
    if (nv == null) return;
    e.preventDefault();
    // instant step: cancel an in-flight settle + its styling
    if (snap) {
      springStop();
      pull = 0;
      track.classList.remove("is-active");
    }
    set(clamp(nv, min, max));
  });

  // value: hover 800ms → editable; click → inline input
  let hoverTimer: number;
  valueEl.addEventListener("mouseenter", () => {
    hoverTimer = setTimeout(() => valueEl.classList.add("is-editable"), 800);
  });
  valueEl.addEventListener("mouseleave", () => {
    clearTimeout(hoverTimer);
    if (!valueEl.classList.contains("is-editing")) valueEl.classList.remove("is-editable");
  });
  valueEl.addEventListener("pointerdown", (e) => {
    // Touch/pen have no hover to arm the edit gate, so a tap on the readout arms it directly.
    if (e.pointerType && e.pointerType !== "mouse") {
      valueEl.classList.add("is-editable");
      e.stopPropagation();
    } else if (valueEl.classList.contains("is-editable")) e.stopPropagation();
  });
  // The inline editor, reached from the armed readout's click or Enter on the focused track. Enter
  // commits and Escape cancels, both returning focus to the track; a blur commits and leaves focus where the user sent
  // it.
  const openEditor = () => {
    if (valueEl.classList.contains("is-editing")) return;
    const input = el("input", "twk-slider-input");
    input.type = "text";
    input.inputMode = parse ? "text" : "decimal";
    quietFocus(input); /* click-to-type stays ringless; Enter from the track rings it */
    // with a parse, the field edits the formatted text
    input.value = parse ? show(q(value)) : q(value).toFixed(decimals);
    // read back: a text field drops line breaks
    const opened = input.value;
    input.style.width = opened.length + 1 + "ch";
    valueEl.classList.add("is-editing");
    valueEl.replaceWith(input);
    input.focus();
    input.select();
    const restore = () => {
      input.replaceWith(valueEl);
      valueEl.classList.remove("is-editing", "is-editable");
    };
    // Typed text is read by `parse`, or else strictly as a whole number (not parseFloat, which reads
    // "1,000" as 1). Only a finite number commits, and never text left as it opened: a format coarser
    // than the step would move the value just by opening the editor.
    const commit = () => {
      const t = input.value;
      let p = NaN;
      if (t !== opened)
        try {
          p = parse ? parse(t) : Number(t.replace(unit, "").trim() || NaN);
        } catch {}
      if (Number.isFinite(p)) set(meta.soft ? p : clamp(p, min, max));
      restore();
    };
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
    input.addEventListener("blur", commit);
    // Focus moves to the track BEFORE the input leaves the DOM (blur-commit unhooked so it doesn't commit
    // twice): removing a focused node first lands focus on <body>, and a focus() in the same task was dropped.
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        input.removeEventListener("blur", commit);
        track.focus();
        commit();
      }
      // an Escape here mustn't also close a hosting popover
      else if (e.key === "Escape") {
        e.stopPropagation();
        input.removeEventListener("blur", commit);
        track.focus();
        restore();
      }
    });
  };
  valueEl.addEventListener("click", () => {
    if (valueEl.classList.contains("is-editable")) openEditor();
  });

  return { el: wrap, set: (v: number | string) => set(v, false), get: () => q(value), range: [min, max] };
}

function createToggle(meta: Meta, onChange: OnChange): Control {
  const row = el("div", "twk-row");
  // The segmented control IS the state; this maps boolean ↔ "on"/"off" at the rim.
  const tr = words(),
    seg = createSegmented(
      [
        { value: "off", label: tr("off", "Off") },
        { value: "on", label: tr("on", "On") },
      ],
      meta.value ? "on" : "off",
      (v) => onChange(v === "on"),
      meta.label,
      "on",
    );
  row.append(txt("span", "twk-row-label", meta.label), seg.el);
  return { el: row, set: (v: unknown) => seg.set(v ? "on" : "off"), get: () => seg.get() === "on" };
}

// ── Radio grid — a segmented control wrapped into a 2- or 3-column grid for a small set of short presets. ──
function createRadiogrid(meta: Meta, onChange: OnChange): Control {
  const options: Option[] = meta.options || [];
  const cols = Math.min(
    3,
    Math.max(2, meta.cols || (options.length <= 3 ? options.length : options.length === 4 ? 2 : 3)),
  );
  // several rows keep equal columns
  const row = el("div", options.length > cols ? "twk-radiogrid is-grid" : "twk-radiogrid");
  const grid = el("div", "twk-radiogrid-grid");
  grid.style.setProperty("--twk-rg-cols", cols);
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-label", meta.label);
  let value = meta.value ?? optValue(options[0]);
  // lazy `set` — it's declared below
  const btns = options.map((o) => {
    const b = radioButton("twk-radiogrid-btn", o, (v) => set(v));
    grid.append(b);
    return b;
  });
  const reflect = () => setRadioActive(btns, value);
  // null clears the selection; an unknown value is ignored, bar the default written off the options, so reset()
  // restores it
  const set = (v: unknown, fire = true) => {
    if (v != null && v !== meta.value && !btns.some((b) => b._twVal === v)) return;
    value = v;
    reflect();
    if (fire) onChange(v);
  };
  grid.addEventListener("keydown", (e) => {
    const i = activeIndex(btns, value);
    if (i < 0) return;
    const j = navIndex(e.key, i, btns.length, cols);
    if (j < 0) return;
    // _twVal, not dataset.value (which stringifies)
    e.preventDefault();
    if (j !== i) {
      set(btns[j]._twVal);
      btns[j].focus();
    }
  });
  reflect();
  row.append(txt("span", "twk-radiogrid-label", meta.label), grid);
  return { el: row, set: (v: unknown) => set(v, false), get: () => value };
}

// ── Select ──
// An option's color: one token, no nesting, so a `)` can't close it early and splice a url() into the background
// shorthand.
const COLOR_TOKEN = /^(?:#[0-9a-f]{3,8}|[a-z]+|(?:oklch|oklab|rgba?|hsla?|hwb|lab|lch|color|var)\([^()]*\))$/i;
const CHEVRON = chevronIcon("twk-select-chevron");
function createSelect(meta: Meta, onChange: OnChange): Control {
  let value = meta.value;
  const opts = meta.options.map((o) => ({
    value: optValue(o),
    label: optLabel(o),
    color:
      o && typeof o === "object" && typeof o.color === "string" && COLOR_TOKEN.test(o.color.trim())
        ? o.color.trim()
        : "",
  }));
  const root = el("div", "twk-select");
  const trigger = btn("twk-select-trigger");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const right = el("span", "twk-select-right");
  // Option swatches sit over a checker so alpha reads.
  const swatchCss = (c: string) => `linear-gradient(${c}, ${c}), var(--twk-checker)`;
  const swatch = (c: string) => {
    const s = el("span", "twk-option-swatch");
    s.style.background = swatchCss(c);
    return s;
  };
  const valSwatch = el("span", "twk-option-swatch"),
    valEl = el("span", "twk-select-value");
  right.append(valSwatch, valEl);
  right.insertAdjacentHTML("beforeend", CHEVRON);
  trigger.append(txt("span", "twk-select-label", meta.label), right);
  const dropdown = el("div", "twk-select-dropdown");
  dropdown.setAttribute("role", "listbox");
  const optButtons = opts.map((o) => {
    const b = btn("twk-select-option");
    b.setAttribute("role", "option");
    if (o.color) b.append(swatch(o.color));
    b.append(txt("span", "twk-option-label", o.label));
    b.dataset.value = String(o.value);
    b.addEventListener("click", () => {
      set(o.value);
      pop.close();
    });
    dropdown.append(b);
    return b;
  });
  root.append(trigger, dropdown);
  // dataset stringifies, so compare as strings
  const reflect = () => {
    const cur = opts.find((o) => o.value === value);
    valEl.textContent = cur?.label ?? value;
    valSwatch.style.display = cur?.color ? "" : "none";
    if (cur?.color) valSwatch.style.background = swatchCss(cur.color);
    optButtons.forEach((b) => {
      const sel = b.dataset.value === String(value);
      b.dataset.selected = String(sel);
      b.setAttribute("aria-selected", String(sel));
    });
  };
  // null clears the selection; an unknown value is ignored, bar the default written off the options, so reset()
  // restores it
  const set = (v: unknown, fire = true) => {
    if (v != null && v !== meta.value && !opts.some((o) => o.value === v)) return;
    value = v;
    reflect();
    if (fire) onChange(v);
  };
  // The shared popover shell: portaled to <body>, closes on outside-press / Esc / scroll-away,
  // and opening it closes any other popover.
  let typed = "",
    typedAt = 0; // the type-ahead buffer; a fresh open starts it over, as a native popup does
  const pop = popover(root, trigger, dropdown, {
    fallbackH: 200,
    movable: false, // a menu: it closes on a pick, so it never stays in the way
    onOpen: () => {
      typed = "";
      (optButtons.find((b) => b.dataset.value === String(value)) || optButtons[0])?.focus();
    },
  });
  // Enter/Space on a focused option selects it natively via click; Tab away closes by the shell's focusout rule.
  trigger.addEventListener("keydown", (e) => {
    if (!pop.isOpen() && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      pop.open();
    }
  });
  dropdown.addEventListener("keydown", (e) => {
    const i = optButtons.indexOf(activeIn(dropdown) as HTMLButtonElement);
    let j = i;
    // monotonic, so a wall-clock step can't pin the beat open
    const inBeat = !!typed && performance.now() - typedAt < 600;
    if (e.key === "ArrowDown") j = i < 0 ? 0 : Math.min(optButtons.length - 1, i + 1);
    else if (e.key === "ArrowUp") j = i < 0 ? optButtons.length - 1 : Math.max(0, i - 1);
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = optButtons.length - 1;
    else if (
      e.key.length === 1 &&
      (e.key !== " " || inBeat) &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.isComposing
    ) {
      // Type-ahead, as a native select: keys within a beat form a prefix that moves focus to the first label starting
      // with it, the same key over and over cycles its matches, and no match leaves focus where it is. A space joins a
      // prefix under way and is never also the option's activation; on its own it stays the option's.
      const k = e.key.toLowerCase();
      typed = (inBeat ? typed : "") + k;
      typedAt = performance.now();
      // compared per key, since "İ" lowercases to two code units
      const one = typed === k.repeat(typed.length / k.length),
        needle = one ? k : typed;
      const hit = (lo: number) =>
        opts.findIndex((o, n) => n >= lo && String(o.label).toLowerCase().trimStart().startsWith(needle));
      // a lone key moves past the focused option, a growing prefix re-tests it; the second pass wraps
      j = hit(one ? i + 1 : i);
      if (j < 0) j = hit(0);
      if (j < 0 && e.key !== " ") return; // a prefix's space is swallowed even unmatched, so it never also picks
    } else return;
    e.preventDefault();
    optButtons[j]?.focus();
  });
  reflect();
  return { el: root, set: (v: unknown) => set(v, false), get: () => value };
}

function createButton(meta: Meta) {
  const b = txt("button", "twk-button", meta.label);
  // a verbose form can carry a non-function action; as the group does, ignore it
  b.addEventListener("click", () => typeof meta.action === "function" && meta.action());
  return blade(b);
}

// ── Button group — a row of compact actions under one label. `buttons` is { label: fn } or [{label, action}]. ──
function createButtonGroup(meta: Meta) {
  const row = el("div", "twk-row twk-buttongroup");
  if (meta.label) row.append(txt("span", "twk-row-label", meta.label));
  const group = el("div", "twk-buttongroup-btns");
  // an entry with no label is still a button, not an empty pill
  const list: [string, () => void][] = Array.isArray(meta.buttons)
    ? meta.buttons.map((b) => [b.label ?? words()("button", "Button"), b.action])
    : Object.entries(meta.buttons || {});
  for (const [lab, fn] of list) {
    const b = txt("button", "twk-buttongroup-btn", lab);
    b.addEventListener("click", () => typeof fn === "function" && fn());
    group.append(b);
  }
  row.append(group);
  return blade(row);
}

// ── Separator — a thin divider to break a long panel into sections. ──
const createSeparator = () => blade(el("div", "twk-separator"));

// ── String — a labeled text input ──
function createString(meta: Meta, onChange: OnChange): Control {
  // A non-string default holds its string form so get() and reset() agree with the input.
  const str = (v: unknown) => (v == null ? "" : typeof v === "object" ? json(v) : String(v));
  let value = str(meta.value);
  const multi = meta.rows > 0;
  const row = el("div", multi ? "twk-row twk-row-multiline" : "twk-row");
  const input = el(multi ? "textarea" : "input", multi ? "twk-text twk-textarea" : "twk-text");
  if (multi) (input as HTMLTextAreaElement).rows = meta.rows;
  else (input as HTMLInputElement).type = "text";
  input.value = value;
  quietFocus(input); // click-to-type stays ringless; Tab rings
  if (meta.placeholder) input.placeholder = meta.placeholder;
  input.addEventListener("input", () => {
    value = input.value;
    onChange(value);
  });
  // Long text clips softly: the edge with more past it fades (a mask, so the fade is the panel's own backdrop).
  const clip = () => {
    const more = input.scrollHeight - input.clientHeight > 1;
    input.classList.toggle("is-clip-top", more && input.scrollTop > 1);
    input.classList.toggle("is-clip-bottom", more && input.scrollTop + input.clientHeight < input.scrollHeight - 1);
  };
  if (multi) {
    input.addEventListener("scroll", clip);
    input.addEventListener("input", clip);
    if (typeof ResizeObserver === "function") new ResizeObserver(clip).observe(input);
  }
  row.append(txt("span", "twk-row-label", meta.label), input);
  // null → "", not the literal "undefined"
  return {
    el: row,
    set: (v: unknown) => {
      value = str(v);
      input.value = value;
      if (multi) clip();
    },
    get: () => value,
  };
}

// ── Folder — a collapsible titled group; `body` is the inner container the caller fills. ──
function createFolder(meta: { label: string }) {
  const root = el("div", "twk-folder");
  const header = btn("twk-folder-header");
  header.setAttribute("aria-expanded", "true");
  header.append(txt("span", "twk-folder-title", meta.label));
  header.insertAdjacentHTML("beforeend", ICON_CHEVRON); // chevron trails the title
  const body = el("div", "twk-folder-body");
  const inner = el("div", "twk-controls");
  body.append(inner);
  root.append(header, body);
  // the shared fold: class + aria-expanded + inert on the body
  const collapse = (c: boolean) => foldBody(root, header, body, c);
  header.addEventListener("click", () => collapse(!root.classList.contains("is-collapsed")));
  return { el: root, body: inner, setCollapsed: collapse };
}
/** Builds a control from the registry; a constructor that throws degrades to null so one bad control can't abort the
 * panel. */
function createControl(meta: Meta, onChange: OnChange): Control | null {
  const make = getControl(meta.type);
  if (!make) return null;
  try {
    return make(meta, onChange);
  } catch (e) {
    console.error("[tweaks] control failed to build:", meta && meta.type, e);
    return null;
  }
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
