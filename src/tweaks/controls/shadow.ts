// ── Shadow — a box-shadow editor with the kit's own picker mounted inline (popover() is single-open). The value carries
// the CSS as `css`, built only from the numbers and a colour the picker re-serialized — a host string reaching a `style`
// sink could splice in a url(). Lazy. ──
import { el, txt, popover, createSegmented, registerControl, btn, icon, isObj } from "../shared.js";
import { numField, triggerRow } from "../heavy.js";
import { createPickerBody, isColor } from "./colour.js";
import type { OnChange, NumField } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control, ShadowValue, ShadowInput } from "../types.js";

const DEF = { x: 0, y: 8, blur: 24, spread: 0, color: "rgb(0 0 0 / 0.18)" };
const num = (v: unknown, d: number) => (v != null && v !== "" && Number.isFinite(+v) ? +v : d);
const fmt = (n: number) => String(+n.toFixed(1));
// One colour function, no nesting, so a stray `)` can't extend the match.
const COLOR_RE = /#[0-9a-f]{3,8}\b|(?:oklch|oklab|rgba?|hsla?|hwb|lab|lch|color)\([^()]*\)/i;
const LEN_RE = /^(-?\d*\.?\d+)(px)?$/;
// Strict: optional `inset`, two to four px lengths, one colour, one layer; anything else is null.
const parseShadow = (s: string): ShadowInput | null => {
  const m = COLOR_RE.exec(s); if (!m || !isColor(m[0])) return null;
  const rest = (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).trim().split(/\s+/).filter(Boolean);
  const inset = rest.includes("inset"), lens = rest.filter((t) => t !== "inset");
  if (lens.length < 2 || lens.length > 4 || !lens.every((t) => LEN_RE.test(t))) return null;
  const n = lens.map((t) => +t.replace(/px$/, ""));
  return { inset, x: n[0], y: n[1], blur: n[2] ?? 0, spread: n[3] ?? 0, color: m[0] };
};

const CHEVRON = icon('<path d="M18 9s-4.4 6-6 6-6-6-6-6"/>', "tw-shadow-chevron", 2.5); // the kit's chevron; importing icons.ts splits a 4th chunk
function createShadow(meta: Meta, onChange: OnChange): Control {
  const read = (v: unknown): ShadowInput | null => (typeof v === "string" ? parseShadow(v) : isObj(v) ? v : null);
  const init = read(meta.value ?? meta) || {}; // the fields may sit on the meta itself (verbose form)
  let inset = !!init.inset, x = num(init.x, DEF.x), y = num(init.y, DEF.y), blur = Math.max(0, num(init.blur, DEF.blur)), spread = num(init.spread, DEF.spread);

  // ── Row — label, chip, summary. ──
  const { root, trigger, right } = triggerRow("tw-shadow", meta.label ?? "Shadow"); // ??: an explicit "" label renders none
  const chip = el("span", "tw-trigger-chip tw-shadow-chip"), chipTile = el("span", "tw-shadow-chip-tile"); chip.append(chipTile);
  const valueEl = el("span", "tw-trigger-value");
  right.append(chip, valueEl);

  // ── Popover — a preview card, the position switch, the four lengths, the picker. ──
  const pop = el("div", "tw-color-pop tw-shadow-pop");
  const stage = el("div", "tw-shadow-stage"), card = el("div", "tw-shadow-card"); stage.append(card);
  const insetSeg = createSegmented([{ value: "outer", label: "Outer" }, { value: "inner", label: "Inner" }], inset ? "inner" : "outer", (m: unknown) => { if ((m === "inner") !== inset) { inset = m === "inner"; update(); emit(); } }, "Shadow position");
  const insetRow = el("div", "tw-row"); insetRow.append(txt("span", "tw-row-label", "Position"), insetSeg.el);
  const fields = el("div", "tw-fields tw-shadow-fields");
  const field = (label: string, get: () => number, put: (v: number) => void, min?: number): NumField => { const f = numField({ label, value: get(), step: 1, min, unit: "px" }, (v) => { put(v); update(); emit(); }); fields.append(f.el); return f; };
  const fx = field("X", () => x, (v) => { x = v; }), fy = field("Y", () => y, (v) => { y = v; });
  const fb = field("Blur", () => blur, (v) => { blur = Math.max(0, v); }, 0), fs = field("Spread", () => spread, (v) => { spread = v; });
  // As the fields fitted them: an authored 2.5 showed "3" and emitted 2.5px.
  x = fx.get(); y = fy.get(); blur = fb.get(); spread = fs.get();
  // The colour row discloses the picker, so the pop opens compact.
  const colorRow = btn("tw-trigger tw-shadow-color"); colorRow.setAttribute("aria-expanded", "false");
  const cSwatch = el("span", "tw-trigger-chip tw-color-swatch"), cText = el("span", "tw-trigger-value"), cRight = el("span", "tw-trigger-right");
  cRight.append(cSwatch, cText); cRight.insertAdjacentHTML("beforeend", CHEVRON); colorRow.append(txt("span", "tw-trigger-label", "Colour"), cRight);
  const body = createPickerBody({ value: typeof init.color === "string" && isColor(init.color) ? init.color : DEF.color, onMode: () => update() }, () => { update(); emit(); });
  body.el.hidden = true;
  colorRow.addEventListener("click", () => { const show = body.el.hidden; body.el.hidden = !show; colorRow.setAttribute("aria-expanded", String(show)); pop_.reflow(); }); // re-place for the new height; the picker lays out now
  pop.append(stage, insetRow, fields, colorRow, body.el);
  root.append(pop);

  const cssAt = (k: number) => `${inset ? "inset " : ""}${fmt(x * k)}px ${fmt(y * k)}px ${fmt(blur * k)}px ${fmt(spread * k)}px ${body.get()}`;
  const value = (): ShadowValue => ({ inset, x: +fmt(x), y: +fmt(y), blur: +fmt(blur), spread: +fmt(spread), color: body.get(), css: cssAt(1) });
  const emit = () => onChange(value());
  const update = () => {
    card.style.boxShadow = cssAt(1); chipTile.style.boxShadow = cssAt(0.3);
    valueEl.textContent = `${inset ? "in " : ""}${fmt(x)} ${fmt(y)} ${fmt(blur)}${spread ? " " + fmt(spread) : ""}`;
    cSwatch.style.background = body.swatchCss(); cText.textContent = body.valueText();
  };
  const pop_ = popover(root, trigger, pop, { fallbackH: 300, onOpen: body.reflow, onReflow: body.reflow });
  update();

  // Set/restore: the object form or a strict box-shadow string; `css` is ignored, a colour comes back in the picker's notation.
  const set = (v: unknown) => {
    const inp = read(v); if (!inp) return;
    if (inp.inset != null) { inset = !!inp.inset; insetSeg.set(inset ? "inner" : "outer"); }
    if (inp.x != null) { fx.set(num(inp.x, x)); x = fx.get(); } // read back fitted, as above
    if (inp.y != null) { fy.set(num(inp.y, y)); y = fy.get(); }
    if (inp.blur != null) { fb.set(num(inp.blur, blur)); blur = fb.get(); } // the field's min clamps a negative blur to 0
    if (inp.spread != null) { fs.set(num(inp.spread, spread)); spread = fs.get(); }
    if (typeof inp.color === "string" && isColor(inp.color)) body.set(inp.color);
    update();
  };
  return { el: root, set, get: value };
}

registerControl("shadow", createShadow);
