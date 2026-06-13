// ── Colour — wide-gamut OKLCH picker. Lazy: dynamic-imported on first use, and
// the only module that loads wide-gamut.js (so basic panels never pay for it).
import { el, txt, clamp, dragGesture, boxFrac, numField, popover, triggerRow, quietFocus, registerControl } from "../shared.js";
import { oklchGamutProbe, chromaCeil, hexByte, oklchToHex, hexToOklch, channelValues, withChannel, gamutLabel, showsGamutBoundary, readout, serialize, EDIT_MODES, MODE_LABELS, MODE_CHANNELS, convert, num } from "../../wide-gamut.js";

// ── Colour — one module: a row that opens a dropdown OKLCH picker. Ported from
// Ryan's tweakpane-plugin-wide-gamut (the real engine; see wide-gamut.js): an
// L×C plane + hue strip, all 11 colour modes with channel inputs, and the
// sRGB / P3 / wide gamut label. Canonical working space is OKLCH; the row shows
// the value in the current mode and opens the picker below.
// ── Colour-area rendering, ported from tweakpane-plugin-wide-gamut (area-compute
// + area-picker). The plane stretches to the P3 gamut and is drawn at device-pixel
// resolution (crisp boundary lines), in a Display-P3 canvas where supported (wide
// colours render true, not clamped to muddy sRGB). A solid sRGB line sits inside;
// a dashed P3 line rides the displayable edge. ──
const WIDE_CANVAS = (() => { try { return document.createElement("canvas").getContext("2d", { colorSpace: "display-p3" })?.getContextAttributes?.().colorSpace === "display-p3"; } catch { return false; } })();
const CANVAS_CS: any = WIDE_CANVAS ? { colorSpace: "display-p3" } : {}; // any: colorSpace is a runtime-feature-detected string, looser than the DOM lib's PredefinedColorSpace
const ENGINE_GAMUT = WIDE_CANVAS ? "p3" : "srgb"; // working gamut for the rasterised pixels
const sampleCurve = (curve, t) => { const last = curve.length - 1, pos = Math.max(0, Math.min(last, t * last)), i = Math.floor(pos), f = pos - i; return curve[i] * (1 - f) + curve[Math.min(i + 1, last)] * f; };
const gamutCurve = (hue, gamut) => { const probe = oklchGamutProbe(hue, gamut), c = new Float64Array(128); for (let i = 0; i < 128; i++) c[i] = chromaCeil(probe, i / 127); return c; };
// The alpha chequerboard a translucent swatch composites over — shared with the
// gradient control's trigger preview.
const CHECKER = "repeating-conic-gradient(#6b6b6b 0% 25%, #9a9a9a 0% 50%) 0 0 / 8px 8px";

// Parse any CSS colour (hex / oklch / oklab / lab / lch / color() / rgb / hsl / named) → [L, C, H, alpha].
// The CSS Color 4 functions are parsed by regex + the engine — channel handling ported
// from the wide-gamut plugin's parser (tweakpane-plugin-wide-gamut core/parse.ts):
// signs, exponents, `none` (→ 0), real angle units (deg/grad/rad/turn), and per-slot
// `%` scaling (oklch/oklab C·a·b 100% ↔ 0.4, lab a/b ↔ ±125, lch C ↔ 150). The canvas
// fallback below is only safe for sRGB-family colours: its fillStyle getter echoes wide
// colours back in their own notation, and an rgb-shaped parse of that echo mangled them
// (the "3" in "display-p3" read as a channel + alpha 0; lab() channels read as 0–255;
// a `deg` unit or negative hue fell off the old regex onto the same path).
const COLOR_FN_SPACES = { srgb: "srgb", "display-p3": "p3", rec2020: "rec2020", "prophoto-rgb": "prophoto-rgb" };
const parseAngle = (t) => { const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(deg|grad|rad|turn)$/i.exec(t); if (!m) return num(parseFloat(t)); const n = parseFloat(m[1]); return m[2].toLowerCase() === "turn" ? n * 360 : m[2].toLowerCase() === "grad" ? n * 0.9 : m[2].toLowerCase() === "rad" ? (n * 180) / Math.PI : n; };
function parseColor(str) {
  str = String(str == null ? "" : str).trim();
  if (/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(str)) { // 3/4/6/8 digits only (the hex field's gate) — a 5/7-digit string is junk, not a colour
    let hx = str.replace("#", ""), A = 1;
    if (hx.length === 4) { A = parseInt(hx[3] + hx[3], 16) / 255; hx = hx.slice(0, 3); }
    else if (hx.length === 8) { A = parseInt(hx.slice(6, 8), 16) / 255; hx = hx.slice(0, 6); }
    const [L, C, H] = hexToOklch("#" + hx); return [L, C, H, A];
  }
  const m = str.match(/^(oklch|oklab|lch|lab|color)\(\s*([^)]*?)\s*\)$/i);
  if (m) {
    const fn = m[1].toLowerCase();
    const [body, aRaw] = m[2].split("/").map((s) => s.trim());
    let toks = body.split(/\s+/).filter(Boolean), space = fn;
    if (fn === "color") { space = COLOR_FN_SPACES[(toks[0] || "").toLowerCase()]; toks = toks.slice(1); if (!space) return [0.7, 0.1, 280, 1]; } // an unsupported color() space (xyz, a98-rgb, …) degrades to the neutral default, never to mangled channels
    // One channel: `none` → 0, `%` scales by the slot's own ratio, num() keeps a
    // degenerate-but-matching token from leaking NaN downstream (the kit's idiom —
    // a picker seed degrades, it doesn't reject).
    const ch = (t, pctScale = 1) => (!t || t === "none" ? 0 : num(parseFloat(t)) * (/%$/.test(t) ? pctScale : 1));
    const A = aRaw ? clamp(ch(aRaw, 0.01), 0, 1) : 1;
    // L and chroma clamp at parse time, as CSS Color 4 does — picker state never holds
    // a negative chroma or an out-of-range lightness.
    const c =
      fn === "lab" ? [clamp(ch(toks[0]), 0, 100), ch(toks[1], 1.25), ch(toks[2], 1.25)]                          // L% is 0–100 as-is; a/b 100% ↔ ±125
      : fn === "lch" ? [clamp(ch(toks[0]), 0, 100), Math.max(0, ch(toks[1], 1.5)), parseAngle(toks[2] || "0")]   // C 100% ↔ 150; H takes angle units
      : fn === "color" ? [ch(toks[0], 0.01), ch(toks[1], 0.01), ch(toks[2], 0.01)]
      : fn === "oklab" ? [clamp(ch(toks[0], 0.01), 0, 1), ch(toks[1], 0.004), ch(toks[2], 0.004)]                // L% → 0–1; a/b 100% ↔ ±0.4
      : [clamp(ch(toks[0], 0.01), 0, 1), Math.max(0, ch(toks[1], 0.004)), parseAngle(toks[2] || "0")];           // oklch
    const k = space === "oklch" ? c : convert(c, space, "oklch");
    return [num(k[0]), num(k[1]), ((num(k[2]) % 360) + 360) % 360, A]; // hue normalised to [0,360) so a negative input can't strand the strip thumb
  }
  // sRGB-family (rgb / hsl / hwb / named / transparent): normalise via a canvas — its
  // fillStyle getter returns "#rrggbb" (opaque) or "rgba(r,g,b,a)" for these, then parse
  // that. Wide colours never reach here (handled above); an unrecognised echo or plain
  // junk parses as black, matching the old "junk leaves fillStyle at #000" behaviour.
  const c2d = ((parseColor as any)._c2d ||= document.createElement("canvas").getContext("2d"));
  c2d.fillStyle = "#000"; c2d.fillStyle = str;
  const norm = c2d.fillStyle;
  if (norm[0] === "#") return parseColor(norm); // opaque → the hex branch above
  const rm = norm.match(/^rgba?\(([^)]*)\)/i);
  const cm = ((rm ? rm[1] : "").match(/-?[\d.]+(?:e[+-]?\d+)?/gi) || [0, 0, 0]).map(Number);
  const k = convert([cm[0] / 255, cm[1] / 255, cm[2] / 255], "srgb", "oklch");
  return [num(k[0]), num(k[1]), num(k[2]), cm[3] != null ? clamp(num(cm[3]), 0, 1) : 1];
}

// ── Picker body — the editor surface itself: the L×C plane, the hue + alpha strips,
// the mode dropdown + gamut label, and the per-mode channel inputs. No trigger and no
// popover of its own — just the controls, wired to a colour and an onChange. The
// colour control mounts one inside its popover; the gradient editor mounts one and
// re-points it at whichever stop is selected (so there's one editor surface, never a
// nested popover). `reflow()` re-renders + re-positions once it's mounted at real size;
// swatchCss()/valueText() expose the readout so the host can paint its own trigger. ──
function createPickerBody(meta, onChange) {
  let [L, C, H, A] = parseColor(meta.value || "#7c5cff");
  let mode = "oklch", paintedHue = NaN, chromaCurve = null, chanFields = [];
  // Emitted value: mode-faithful at display precision, alpha appended in-mode (the
  // engine's serialize — one form for opaque and translucent, round-trips through parse).
  const colorStr = () => serialize([L, C, H], mode, A);

  const root = el("div", "tw-color-body");
  const area = el("div", "tw-wg-area"); const areaCanvas = document.createElement("canvas"); areaCanvas.className = "tw-wg-canvas"; const areaThumb = el("div", "tw-wg-thumb"); area.append(areaCanvas, areaThumb);
  const hueBar = el("div", "tw-wg-hue"); const hueCanvas = document.createElement("canvas"); hueCanvas.className = "tw-wg-hue-canvas"; const hueThumb = el("div", "tw-wg-hue-thumb"); hueBar.append(hueCanvas, hueThumb);
  const alphaBar = el("div", "tw-wg-alpha"); const alphaGrad = el("div", "tw-wg-alpha-grad"); const alphaThumb = el("div", "tw-wg-hue-thumb"); alphaBar.append(alphaGrad, alphaThumb);
  // Keyboard-operable alpha strip (the interval handles' slider idiom): Tab to it, arrows
  // nudge (⇧ = coarse ×10), Home/End snap to transparent/opaque.
  alphaBar.tabIndex = 0; alphaBar.setAttribute("role", "slider"); alphaBar.setAttribute("aria-label", "Alpha");
  alphaBar.setAttribute("aria-valuemin", "0"); alphaBar.setAttribute("aria-valuemax", "1");
  const modeRow = el("div", "tw-color-mode-row");
  const modeSel = el("select", "tw-color-mode"); modeSel.setAttribute("aria-label", "Color mode");
  EDIT_MODES.forEach((m) => { const o = document.createElement("option"); o.value = m; o.textContent = MODE_LABELS[m]; modeSel.append(o); });
  modeSel.value = mode;
  const gamut2 = el("span", "tw-color-gamut");
  modeRow.append(modeSel, gamut2);
  const channels = el("div", "tw-color-channels");
  root.append(area, hueBar, alphaBar, modeRow, channels);

  const actx = areaCanvas.getContext("2d", CANVAS_CS) as CanvasRenderingContext2D;
  const hctx = hueCanvas.getContext("2d");

  // One offscreen raster canvas per body, reused across repaints — a hue drag
  // repaints every move, so don't allocate a canvas + pixel buffer per frame.
  const off = document.createElement("canvas");
  const octx = off.getContext("2d", CANVAS_CS) as CanvasRenderingContext2D;
  let offData: ImageData | null = null;
  const renderArea = () => {
    const r = area.getBoundingClientRect(); const cssW = Math.round(r.width), cssH = Math.round(r.height); if (cssW < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const stretch = showsGamutBoundary(mode) ? "p3" : "srgb"; // wide modes show the P3 plane; sRGB modes the sRGB plane
    const curve = gamutCurve(H, stretch); chromaCurve = curve; // per-lightness chroma ceiling of the plane gamut
    const backingW = Math.round(cssW * dpr), backingH = Math.round(cssH * dpr);
    const W = Math.max(1, Math.round(backingW / 4)), Hh = Math.max(1, Math.round(backingH / 4)); // gradient rasterised at 1/4 res
    if (off.width !== W || off.height !== Hh) { off.width = W; off.height = Hh; offData = new ImageData(W, Hh, CANVAS_CS); }
    const data = offData.data;
    const invH = Hh > 1 ? 1 / (Hh - 1) : 0, invW = W > 1 ? 1 / (W - 1) : 0;
    for (let y = 0; y < Hh; y++) { const Lp = 1 - y * invH, rowMax = sampleCurve(curve, Lp); for (let x = 0; x < W; x++) { const rgb = convert([Lp, x * invW * rowMax, H], "oklch", ENGINE_GAMUT); const o = (y * W + x) * 4; data[o] = Math.round(clamp(rgb[0], 0, 1) * 255); data[o + 1] = Math.round(clamp(rgb[1], 0, 1) * 255); data[o + 2] = Math.round(clamp(rgb[2], 0, 1) * 255); data[o + 3] = 255; } }
    octx.putImageData(offData, 0, 0);
    areaCanvas.width = backingW; areaCanvas.height = backingH; actx.imageSmoothingEnabled = true; actx.drawImage(off, 0, 0, backingW, backingH);
    // Gamut boundaries on the dpr-backed canvas → crisp: solid sRGB line inside,
    // dashed P3 line riding the displayable edge (wide modes only).
    if (stretch !== "srgb") {
      const trace = (gamut, color, width, dash) => {
        const probe = oklchGamutProbe(H, gamut), pts = [];
        for (let s = 0; s <= 100; s++) { const Lp = s / 100, edge = sampleCurve(curve, Lp); if (edge <= 0) continue; const c = chromaCeil(probe, Lp, edge); if (c <= 0) continue; pts.push([Math.min((c / edge) * backingW, backingW - (width * dpr) / 2), (1 - Lp) * backingH]); }
        if (pts.length < 2) return;
        actx.save(); actx.strokeStyle = color; actx.lineWidth = width * dpr; actx.lineJoin = actx.lineCap = "round"; actx.setLineDash(dash.map((d) => d * dpr)); actx.beginPath(); pts.forEach((p, i) => (i ? actx.lineTo(p[0], p[1]) : actx.moveTo(p[0], p[1]))); actx.stroke(); actx.restore();
      };
      trace("srgb", "rgba(255,255,255,0.7)", 1.5, []);
      trace("p3", "rgba(255,255,255,0.4)", 1, [3, 3]);
    }
    paintedHue = H;
  };
  // Hue-strip lightness — the strip raster and the hue-thumb fill both use it, so the
  // filled ring matches the strip column behind it seamlessly.
  const STRIP_L = 0.7;
  let hueW = 0;
  const renderHue = () => {
    const r = hueBar.getBoundingClientRect(); const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height)); if (w < 2) return;
    if (w === hueW && hueCanvas.width === w) return; // the strip only depends on width — cache it (re-placing on scroll/resize won't re-rasterise)
    hueW = w; hueCanvas.width = w; hueCanvas.height = h;
    // Full-vibrancy hue: each column rides the sRGB chroma ceiling for its hue at a
    // fixed lightness, so every hue shows at its most saturated displayable form
    // (the wide-gamut plugin's look) rather than a flat, washed-out low chroma.
    const Lh = STRIP_L;
    for (let x = 0; x < w; x++) {
      const hue = (x / (w - 1)) * 360;
      const rgb = convert([Lh, chromaCeil(oklchGamutProbe(hue, "srgb"), Lh), hue], "oklch", "srgb");
      hctx.fillStyle = `rgb(${clamp(rgb[0] * 255, 0, 255) | 0},${clamp(rgb[1] * 255, 0, 255) | 0},${clamp(rgb[2] * 255, 0, 255) | 0})`; hctx.fillRect(x, 0, 1, h);
    }
  };
  const positionThumbs = () => {
    const ceil = chromaCurve ? sampleCurve(chromaCurve, L) : 0.4; // thumb x is C as a fraction of the row's ceiling
    // The area thumb centres on the true edge (0%/100%) and is free to overhang, so a
    // colour right at the gamut boundary reads as fully selected — the way Figma lets
    // the ring pass the container edge. The plane is overflow-visible, so it shows.
    const at = (frac) => `${clamp(frac, 0, 1) * 100}%`;
    // The 1D strip thumbs instead stay fully inside their track: the centre travels
    // from +w/2 at 0 to −w/2 at 1, so the ring's edge meets the rounded track end
    // rather than spilling past it (a full-opacity handle hanging off the right edge).
    const inside = (frac, w) => { const f = clamp(frac, 0, 1); return `calc(${f * 100}% + ${(0.5 - f) * w}px)`; };
    areaThumb.style.left = at(ceil > 0 ? C / ceil : 0); areaThumb.style.top = at(1 - L);
    hueThumb.style.left = inside(H / 360, 16); alphaThumb.style.left = inside(A, 16);
    alphaBar.setAttribute("aria-valuenow", String(+A.toFixed(2))); // drag + keyboard + external set all pass through here
    alphaGrad.style.background = `linear-gradient(to right, oklch(${L} ${C} ${H} / 0), oklch(${L} ${C} ${H}))`;
    // Filled rings, not see-through: each ring carries its own colour, so a grabbed thumb
    // (scaled up past its track's height) stays solid to its edge instead of revealing the
    // dropdown bg in the slivers above/below the strip. Area ring → the picked colour;
    // alpha ring → that colour at the current opacity over the panel surface (an opaque
    // tone, no checker inside, so it dims as opacity drops); hue ring → the strip's
    // full-vibrancy hue at this H, matched to the strip raster so the fill is seamless.
    areaThumb.style.background = `oklch(${L} ${C} ${H})`;
    alphaThumb.style.background = `linear-gradient(oklch(${L} ${C} ${H} / ${A}), oklch(${L} ${C} ${H} / ${A})), var(--tw-dropdown-bg)`;
    const hueRgb = convert([STRIP_L, chromaCeil(oklchGamutProbe(H, "srgb"), STRIP_L), H], "oklch", "srgb");
    hueThumb.style.background = `rgb(${clamp(hueRgb[0] * 255, 0, 255) | 0} ${clamp(hueRgb[1] * 255, 0, 255) | 0} ${clamp(hueRgb[2] * 255, 0, 255) | 0})`;
  };
  const refresh = () => {
    gamut2.textContent = gamutLabel([L, C, H], mode); // gamut shows in the picker only
    if (mode === "hex") { const hx = channels.querySelector(".tw-color-chan-input"); if (hx && document.activeElement !== hx) hx.value = oklchToHex(L, C, H) + (A < 0.999 ? hexByte(A) : ""); }
    else { const vals = channelValues([L, C, H], mode); chanFields.forEach((f, i) => { if (!f.el.contains(document.activeElement)) f.set(vals[i]); }); }
  };
  const reflow = () => { renderHue(); renderArea(); positionThumbs(); }; // mounted at real size → rasterise + place the thumbs
  const emit = () => onChange(colorStr());
  // renderArea self-guards on width (a detached/hidden body bails at getBoundingClientRect),
  // so no `open` flag is needed — when the body is offscreen the repaint is a cheap no-op.
  const sync = (repaint) => { if (repaint && H !== paintedHue) renderArea(); positionThumbs(); refresh(); };

  const renderChannels = () => {
    channels.replaceChildren(); chanFields = [];
    if (mode === "hex") {
      channels.classList.add("tw-color-channels--hex");
      const wrap = el("div", "tw-color-chan");
      const inp = el("input", "tw-color-chan-input"); inp.type = "text"; inp.spellcheck = false; inp.setAttribute("aria-label", "Hex color"); quietFocus(inp);
      inp.addEventListener("change", () => { const v = inp.value.trim(); if (/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) { [L, C, H, A] = parseColor(v); sync(true); emit(); } });
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
      wrap.append(txt("span", "tw-color-chan-label", "HEX"), inp); channels.append(wrap);
    } else {
      // Numeric channels use the same point-style field as Point/Spring — so the
      // grab handle + grab guide work for dragging colour values too.
      channels.classList.remove("tw-color-channels--hex");
      const vals = channelValues([L, C, H], mode);
      MODE_CHANNELS[mode].forEach((ch, i) => {
        const f = numField({ label: ch.k, value: vals[i], min: ch.min, max: ch.max, step: ch.step }, (v) => { [L, C, H] = withChannel([L, C, H], mode, i, clamp(v, ch.min, ch.max)); sync(true); emit(); });
        chanFields.push(f); channels.append(f.el);
      });
    }
    refresh();
  };

  // Grab feedback: the surface flags .is-grabbing for its run so the thumb scales up
  // (CSS, spring-eased) the moment you press — the picker's echo of the slider handle's lift.
  const grabbable = (surface, set) => dragGesture(surface, {
    onDown: (e) => { surface.classList.add("is-grabbing"); set(e); },
    onMove: set,
    onEnd: () => surface.classList.remove("is-grabbing"),
  });
  const areaXY = (e) => boxFrac(e, area);
  const setArea = (e) => { const [fx, fy] = areaXY(e); L = 1 - fy; C = fx * (chromaCurve ? sampleCurve(chromaCurve, L) : 0.4); positionThumbs(); refresh(); emit(); };
  grabbable(area, setArea);
  const hueAt = (e) => boxFrac(e, hueBar)[0] * 360;
  const setHue = (e) => { H = hueAt(e); sync(true); emit(); };
  grabbable(hueBar, setHue);
  const alphaAt = (e) => boxFrac(e, alphaBar)[0];
  const setAlpha = (e) => { A = alphaAt(e); positionThumbs(); refresh(); emit(); };
  grabbable(alphaBar, setAlpha);
  alphaBar.addEventListener("keydown", (e) => {
    const d = e.shiftKey ? 0.1 : 0.01;
    let nv = A;
    switch (e.key) {
      case "ArrowRight": case "ArrowUp": nv += d; break;
      case "ArrowLeft": case "ArrowDown": nv -= d; break;
      case "Home": nv = 0; break;
      case "End": nv = 1; break;
      default: return;
    }
    e.preventDefault(); A = clamp(nv, 0, 1); positionThumbs(); refresh(); emit();
  });

  // A mode switch is formatting-only: re-render the fields/plane/thumbs and let the host
  // repaint its trigger row (meta.onMode), but never emit — notifying would push a
  // no-op change into undo and rewrite a gradient's stored stop strings. positionThumbs
  // runs after renderArea because sRGB↔wide modes re-stretch the plane (the thumb's
  // chroma fraction is stale against the new ceiling).
  modeSel.addEventListener("change", () => { mode = modeSel.value; renderChannels(); renderArea(); positionThumbs(); meta.onMode && meta.onMode(); }); // renderArea self-guards when the body is offscreen

  renderChannels();

  return {
    el: root,
    // Blur a focused body input before re-pointing: its change handler commits typed-but-
    // uncommitted text against the OLD state, so stop-hopping can't land stop A's text on stop B.
    set: (v) => { const ae = document.activeElement as any; if (ae && root.contains(ae)) ae.blur(); [L, C, H, A] = parseColor(v); sync(true); }, // repaint the plane only if the hue moved (gradient stop-hopping at the same hue skips the raster); renderArea self-guards offscreen
    get: () => colorStr(),
    reflow,
    // The host paints its own trigger from these — the body carries no swatch/value of its own.
    swatchCss: () => `linear-gradient(oklch(${L} ${C} ${H} / ${A}), oklch(${L} ${C} ${H} / ${A})), ${CHECKER}`,
    valueText: () => readout([L, C, H], mode) + (A < 0.999 ? (mode === "hex" ? hexByte(A) : ` / ${+A.toFixed(2)}`) : ""),
  };
}

// ── Colour — a trigger row (label + swatch + value readout) that opens a picker body
// in a portaled popover. A thin wrapper: the body does the editing, this paints the
// row and drives open/close through the shared popover() shell. ──
function createColor(meta, onChange) {
  const { root, trigger, right } = triggerRow("tw-color", meta.label || "Colour");
  const swatch = el("span", "tw-trigger-chip tw-color-swatch");
  const valueEl = el("span", "tw-trigger-value");
  right.append(swatch, valueEl);

  const pop = el("div", "tw-color-pop");
  const paintTrigger = () => { swatch.style.background = body.swatchCss(); valueEl.textContent = body.valueText(); };
  const body = createPickerBody({ value: meta.value, onMode: () => paintTrigger() }, (c) => { paintTrigger(); onChange(c); });
  pop.append(body.el);
  root.append(pop);

  // The popover portals `pop` to <body> on open — escaping the panel's overflow and
  // any transformed/filtered ancestor — and reflows the body once it's at real size.
  popover(root, trigger, pop, { width: 240, fallbackH: 340, gap: 6, onOpen: body.reflow, onReflow: body.reflow });
  paintTrigger();

  return { el: root, set: (v) => { body.set(v); paintTrigger(); }, get: () => body.get() };
}

const oklchStr = (L, C, H, A) => A < 0.999
  ? `oklch(${+L.toFixed(4)} ${+C.toFixed(4)} ${+H.toFixed(2)} / ${+A.toFixed(3)})`
  : `oklch(${+L.toFixed(4)} ${+C.toFixed(4)} ${+H.toFixed(2)})`;

export { createColor, createPickerBody, parseColor, oklchStr, CHECKER };
registerControl("color", createColor);

