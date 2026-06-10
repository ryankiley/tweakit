// ── Colour — wide-gamut OKLCH picker. Lazy: dynamic-imported on first use, and
// the only module that loads wide-gamut.js (so basic panels never pay for it).
import { el, clamp, dragGesture, boxFrac, numField, popover, registerControl } from "../shared.js";
import { oklchGamutProbe, oklchToHex, hexToOklch, channelValues, withChannel, gamutLabel, showsGamutBoundary, readout, EDIT_MODES, MODE_LABELS, MODE_CHANNELS, convert, num } from "../../wide-gamut.js";

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
const chromaCeil = (probe, L, hi = 0.5) => { if (!probe(L, 0)) return 0; let lo = 0; for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2; probe(L, m) ? (lo = m) : (hi = m); } return lo; };
const gamutCurve = (hue, gamut) => { const probe = oklchGamutProbe(hue, gamut), c = new Float64Array(128); for (let i = 0; i < 128; i++) c[i] = chromaCeil(probe, i / 127); return c; };
const wrapCss = (t, mode) =>
  mode === "hex" ? t : mode === "srgb" ? `rgb(${t})` : mode === "css" ? `rgba(${t}, 1)` :
  mode === "hsl" ? `hsl(${t})` : mode === "hwb" ? `hwb(${t})` :
  mode === "p3" ? `color(display-p3 ${t})` : mode === "rec2020" ? `color(rec2020 ${t})` : `${mode}(${t})`;
// One alpha byte → 2-digit hex, so hex mode emits #RRGGBBAA (valid CSS) for a
// translucent colour instead of the invalid "#rrggbb / a".
const hexByte = (a) => Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, "0");

// Parse any CSS colour (hex / oklch / rgb / hsl / named / oklab / lab / lch / color()) → [L, C, H, alpha].
function parseColor(str) {
  str = String(str == null ? "" : str).trim();
  const m = str.match(/oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)/i);
  if (m) { let L = parseFloat(m[1]); if (m[2]) L /= 100; let A = m[5] != null ? parseFloat(m[5]) : 1; if (m[6]) A /= 100; return [num(L), num(parseFloat(m[3])), num(parseFloat(m[4])), clamp(num(A), 0, 1)]; } // num() keeps a degenerate-but-matching string (e.g. "oklch(. . .)") from leaking NaN downstream
  // oklab → oklch is just the polar form (C = hypot(a,b), H = atan2(b,a)); do it directly,
  // because the canvas fallback below can't be relied on to parse CSS Color 4 spaces in
  // every browser — an unsupported oklab() silently falls back to black there.
  const ml = str.match(/oklab\(\s*([\d.]+)(%?)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)/i);
  if (ml) { let L = parseFloat(ml[1]); if (ml[2]) L /= 100; const a = num(parseFloat(ml[3])), b = num(parseFloat(ml[4])); let A = ml[5] != null ? parseFloat(ml[5]) : 1; if (ml[6]) A /= 100; return [num(L), Math.hypot(a, b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360, clamp(num(A), 0, 1)]; }
  if (/^#?[0-9a-f]{3,8}$/i.test(str)) {
    let hx = str.replace("#", ""), A = 1;
    if (hx.length === 4) { A = parseInt(hx[3] + hx[3], 16) / 255; hx = hx.slice(0, 3); }
    else if (hx.length === 8) { A = parseInt(hx.slice(6, 8), 16) / 255; hx = hx.slice(0, 6); }
    const [L, C, H] = hexToOklch("#" + hx); return [L, C, H, A];
  }
  // Anything else (rgb / hsl / named): normalise via a canvas — its fillStyle getter
  // returns "#rrggbb" (opaque) or "rgba(r,g,b,a)" for sRGB-family colours, then parse
  // that. (oklch/oklab are handled above by regex precisely because a canvas/computed
  // probe can't be trusted to round-trip CSS Color 4 spaces in every browser.)
  const c2d = ((parseColor as any)._c2d ||= document.createElement("canvas").getContext("2d"));
  c2d.fillStyle = "#000"; c2d.fillStyle = str;
  const norm = c2d.fillStyle;
  if (norm[0] === "#") return parseColor(norm); // opaque → the hex branch above
  const cm = (norm.match(/[\d.]+/g) || [0, 0, 0]).map(Number);
  const k = convert([cm[0] / 255, cm[1] / 255, cm[2] / 255], "srgb", "oklch");
  return [num(k[0]), num(k[1]), num(k[2]), cm[3] != null ? cm[3] : 1];
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
  const colorStr = () =>
    mode === "hex" ? oklchToHex(L, C, H) + (A < 0.999 ? hexByte(A) : "")
    : A < 0.999 ? oklchStr(L, C, H, A)
    : wrapCss(readout([L, C, H], mode), mode);
  const CHECKER = "repeating-conic-gradient(#6b6b6b 0% 25%, #9a9a9a 0% 50%) 0 0 / 8px 8px";

  const root = el("div", "tw-color-body");
  const area = el("div", "tw-wg-area"); const areaCanvas = document.createElement("canvas"); areaCanvas.className = "tw-wg-canvas"; const areaThumb = el("div", "tw-wg-thumb"); area.append(areaCanvas, areaThumb);
  const hueBar = el("div", "tw-wg-hue"); const hueCanvas = document.createElement("canvas"); hueCanvas.className = "tw-wg-hue-canvas"; const hueThumb = el("div", "tw-wg-hue-thumb"); hueBar.append(hueCanvas, hueThumb);
  const alphaBar = el("div", "tw-wg-alpha"); const alphaGrad = el("div", "tw-wg-alpha-grad"); const alphaThumb = el("div", "tw-wg-hue-thumb"); alphaBar.append(alphaGrad, alphaThumb);
  const modeRow = el("div", "tw-color-mode-row");
  const modeSel = el("select", "tw-color-mode");
  EDIT_MODES.forEach((m) => { const o = document.createElement("option"); o.value = m; o.textContent = MODE_LABELS[m]; modeSel.append(o); });
  modeSel.value = mode;
  const gamut2 = el("span", "tw-color-gamut tw-color-gamut--pop");
  modeRow.append(modeSel, gamut2);
  const channels = el("div", "tw-color-channels");
  root.append(area, hueBar, alphaBar, modeRow, channels);

  const actx = areaCanvas.getContext("2d", CANVAS_CS) as CanvasRenderingContext2D;
  const hctx = hueCanvas.getContext("2d");

  const renderArea = () => {
    const r = area.getBoundingClientRect(); const cssW = Math.round(r.width), cssH = Math.round(r.height); if (cssW < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const stretch = showsGamutBoundary(mode) ? "p3" : "srgb"; // wide modes show the P3 plane; sRGB modes the sRGB plane
    const curve = gamutCurve(H, stretch); chromaCurve = curve; // per-lightness chroma ceiling of the plane gamut
    const backingW = Math.round(cssW * dpr), backingH = Math.round(cssH * dpr);
    const W = Math.max(1, Math.round(backingW / 4)), Hh = Math.max(1, Math.round(backingH / 4)); // gradient rasterised at 1/4 res
    const off = document.createElement("canvas"); off.width = W; off.height = Hh;
    const octx = off.getContext("2d", CANVAS_CS) as CanvasRenderingContext2D; const data = new Uint8ClampedArray(W * Hh * 4);
    const invH = Hh > 1 ? 1 / (Hh - 1) : 0, invW = W > 1 ? 1 / (W - 1) : 0;
    for (let y = 0; y < Hh; y++) { const Lp = 1 - y * invH, rowMax = sampleCurve(curve, Lp); for (let x = 0; x < W; x++) { const rgb = convert([Lp, x * invW * rowMax, H], "oklch", ENGINE_GAMUT); const o = (y * W + x) * 4; data[o] = Math.round(clamp(rgb[0], 0, 1) * 255); data[o + 1] = Math.round(clamp(rgb[1], 0, 1) * 255); data[o + 2] = Math.round(clamp(rgb[2], 0, 1) * 255); data[o + 3] = 255; } }
    octx.putImageData(new ImageData(data, W, Hh, CANVAS_CS), 0, 0);
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
  let hueW = 0;
  const renderHue = () => {
    const r = hueBar.getBoundingClientRect(); const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height)); if (w < 2) return;
    if (w === hueW && hueCanvas.width === w) return; // the strip only depends on width — cache it (re-placing on scroll/resize won't re-rasterise)
    hueW = w; hueCanvas.width = w; hueCanvas.height = h;
    // Full-vibrancy hue: each column rides the sRGB chroma ceiling for its hue at a
    // fixed lightness, so every hue shows at its most saturated displayable form
    // (the wide-gamut plugin's look) rather than a flat, washed-out low chroma.
    const Lh = 0.7;
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
    alphaGrad.style.background = `linear-gradient(to right, oklch(${L} ${C} ${H} / 0), oklch(${L} ${C} ${H}))`;
    // Filled rings, not see-through: the area ring carries the picked colour; the alpha
    // ring carries that colour at the current opacity composited over the panel surface
    // — an opaque tone (no checker pattern inside the ring), so it dims as opacity drops
    // without the busy chequerboard. (The hue ring still shows the strip hue through it.)
    areaThumb.style.background = `oklch(${L} ${C} ${H})`;
    alphaThumb.style.background = `linear-gradient(oklch(${L} ${C} ${H} / ${A}), oklch(${L} ${C} ${H} / ${A})), var(--tw-dropdown-bg)`;
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
      const wrap = el("div", "tw-color-chan"); const lab = el("span", "tw-color-chan-label"); lab.textContent = "HEX";
      const inp = el("input", "tw-color-chan-input"); inp.type = "text"; inp.spellcheck = false;
      inp.addEventListener("change", () => { const v = inp.value.trim(); if (/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) { [L, C, H, A] = parseColor(v); sync(true); emit(); } });
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
      wrap.append(lab, inp); channels.append(wrap);
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

  modeSel.addEventListener("change", () => { mode = modeSel.value; renderChannels(); renderArea(); emit(); }); // renderArea self-guards when the body is offscreen

  renderChannels();

  return {
    el: root,
    set: (v) => { [L, C, H, A] = parseColor(v); reflow(); refresh(); }, // reflow self-guards offscreen; refresh keeps the channel inputs in sync
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
  const root = el("div", "tw-color");
  const trigger = el("button", "tw-color-trigger"); trigger.type = "button"; trigger.setAttribute("aria-expanded", "false");
  const labelEl = el("span", "tw-color-label"); labelEl.textContent = meta.label || "Colour";
  const right = el("span", "tw-color-right");
  const swatch = el("span", "tw-color-swatch");
  const valueEl = el("span", "tw-color-value");
  right.append(swatch, valueEl);
  trigger.append(labelEl, right);

  const pop = el("div", "tw-color-pop");
  const paintTrigger = () => { swatch.style.background = body.swatchCss(); valueEl.textContent = body.valueText(); };
  const body = createPickerBody({ value: meta.value }, (c) => { paintTrigger(); onChange(c); });
  pop.append(body.el);
  root.append(trigger, pop);

  // The popover portals `pop` to <body> on open — escaping the panel's overflow and
  // any transformed/filtered ancestor — and reflows the body once it's at real size.
  popover(root, trigger, pop, { width: 240, fallbackH: 340, gap: 6, onOpen: body.reflow, onReflow: body.reflow });
  paintTrigger();

  return { el: root, set: (v) => { body.set(v); paintTrigger(); }, get: () => body.get() };
}

const oklchStr = (L, C, H, A) => A < 0.999
  ? `oklch(${+L.toFixed(4)} ${+C.toFixed(4)} ${+H.toFixed(2)} / ${+A.toFixed(3)})`
  : `oklch(${+L.toFixed(4)} ${+C.toFixed(4)} ${+H.toFixed(2)})`;

export { createColor, createPickerBody, parseColor, oklchStr };
registerControl("color", createColor);

