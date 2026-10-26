// ── Shadow — a box-shadow editor with the kit's own picker mounted inline (popover() is single-open). The value carries
// the CSS as `css`, built only from the numbers and a color the picker accepted as one color token (isColor) — a host
// string reaching a `style` sink could splice in a url(). Lazy. ──
import { el, txt, popover, createSegmented, registerControl, btn, icon, isObj, words } from "../shared.js";
import { numField, triggerRow } from "../heavy.js";
import { createPickerBody, isColor } from "./color.js";
import type { OnChange, NumField } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control, ShadowValue, ShadowInput } from "../types.js";

const DEF = { x: 0, y: 8, blur: 24, spread: 0, color: "rgb(0 0 0 / 0.18)" };
const num = (v: unknown, d: number) => (v != null && v !== "" && Number.isFinite(+v) ? +v : d);
const fmt = (n: number) => String(+n.toFixed(1));
// One color function, no nesting, so a stray `)` can't extend the match.
const COLOR_RE = /#[0-9a-f]{3,8}\b|(?:oklch|oklab|rgba?|hsla?|hwb|lab|lch|color)\([^()]*\)/i;
const LEN_RE = /^(-?\d*\.?\d+)(px)?$/;
// Strict: optional `inset`, two to four px lengths, one color, one layer; anything else is null.
const parseShadow = (s: string): ShadowInput | null => {
  const m = COLOR_RE.exec(s); if (!m || !isColor(m[0])) return null;
  const rest = (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).trim().split(/\s+/).filter(Boolean);
  const inset = rest.includes("inset"), lens = rest.filter((t) => t !== "inset");
  if (lens.length < 2 || lens.length > 4 || !lens.every((t) => LEN_RE.test(t))) return null;
  const n = lens.map((t) => +t.replace(/px$/, ""));
  return { inset, x: n[0], y: n[1], blur: n[2] ?? 0, spread: n[3] ?? 0, color: m[0] };
};

const CHEVRON = icon('<path d="M18 9s-4.4 6-6 6-6-6-6-6"/>', "twk-shadow-chevron", 2.5); // the kit's chevron; importing icons.ts splits a 4th chunk
function createShadow(meta: Meta, onChange: OnChange): Control {
  const tr = words();
  const read = (v: unknown): ShadowInput | null => (typeof v === "string" ? parseShadow(v) : isObj(v) ? v : null);
  const init = read(meta.value ?? meta) || {}; // the fields may sit on the meta itself (verbose form)
  let inset = !!init.inset;

  // ── Row — label, chip, summary. ──
  const { root, trigger, right } = triggerRow("twk-shadow", meta.label ?? tr("shadow", "Shadow")); // ??: an explicit "" label renders none
  const chip = el("span", "twk-trigger-chip twk-shadow-chip"), chipTile = el("span", "twk-shadow-chip-tile"); chip.append(chipTile);
  const valueEl = el("span", "twk-trigger-value");
  right.append(chip, valueEl);

  // ── Popover — a preview card, the position switch, the four lengths, the picker. ──
  const pop = el("div", "twk-color-pop twk-shadow-pop");
  const stage = el("div", "twk-shadow-stage"), card = el("div", "twk-shadow-card"); stage.append(card);
  const insetSeg = createSegmented([{ value: "outer", label: tr("outer", "Outer") }, { value: "inner", label: tr("inner", "Inner") }], inset ? "inner" : "outer", (m: unknown) => { if ((m === "inner") !== inset) { inset = m === "inner"; update(); emit(); } }, tr("shadowPosition", "Shadow position"));
  const insetRow = el("div", "twk-row"); insetRow.append(txt("span", "twk-row-label", tr("position", "Position")), insetSeg.el);
  const fields = el("div", "twk-fields twk-shadow-fields");
  // The four lengths live in their fields, read as the fields fit them: an authored 2.5 shows "3" and emits 3px, and the
  // blur's min clamps a negative one to 0.
  const field = (label: string, value: number, min?: number): NumField => { const f = numField({ label, value, step: 1, min, unit: "px" }, () => { update(); emit(); }); fields.append(f.el); return f; };
  const fx = field("X", num(init.x, DEF.x)), fy = field("Y", num(init.y, DEF.y)), fb = field(tr("blur", "Blur"), num(init.blur, DEF.blur), 0), fs = field(tr("spread", "Spread"), num(init.spread, DEF.spread));
  const lengths = () => [fx, fy, fb, fs].map((f) => f.get());
  // The color row discloses the picker, so the pop opens compact.
  const colorRow = btn("twk-trigger twk-shadow-color"); colorRow.setAttribute("aria-expanded", "false");
  const cSwatch = el("span", "twk-trigger-chip twk-color-swatch"), cText = el("span", "twk-trigger-value"), cRight = el("span", "twk-trigger-right");
  cRight.append(cSwatch, cText); cRight.insertAdjacentHTML("beforeend", CHEVRON); colorRow.append(txt("span", "twk-trigger-label", tr("color", "Color")), cRight);
  const body = createPickerBody({ value: typeof init.color === "string" && isColor(init.color) ? init.color : DEF.color, onMode: () => update() }, () => { update(); emit(); });
  body.el.hidden = true;
  colorRow.addEventListener("click", () => { const show = body.el.hidden; body.el.hidden = !show; colorRow.setAttribute("aria-expanded", String(show)); pop_.reflow(); }); // re-place for the new height; the picker lays out now
  pop.append(stage, insetRow, fields, colorRow, body.el);
  root.append(pop);

  const cssAt = (k: number) => `${inset ? "inset " : ""}${lengths().map((n) => `${fmt(n * k)}px`).join(" ")} ${body.get()}`;
  const value = (): ShadowValue => { const [x, y, blur, spread] = lengths().map((n) => +fmt(n)); return { inset, x, y, blur, spread, color: body.get(), css: cssAt(1) }; };
  const emit = () => onChange(value());
  const update = () => {
    card.style.boxShadow = cssAt(1); chipTile.style.boxShadow = cssAt(0.3);
    const [x, y, blur, spread] = lengths();
    valueEl.textContent = `${inset ? "in " : ""}${fmt(x)} ${fmt(y)} ${fmt(blur)}${spread ? " " + fmt(spread) : ""}`;
    cSwatch.style.background = body.swatchCss(); cText.textContent = body.valueText();
  };
  const pop_ = popover(root, trigger, pop, { fallbackH: 300, onOpen: body.reflow, onReflow: body.reflow });
  update();

  // Set/restore: the object form or a strict box-shadow string; `css` is ignored, and the color goes through the picker.
  const set = (v: unknown) => {
    const inp = read(v); if (!inp) return;
    if (inp.inset != null) { inset = !!inp.inset; insetSeg.set(inset ? "inner" : "outer"); }
    ([["x", fx], ["y", fy], ["blur", fb], ["spread", fs]] as const).forEach(([k, f]) => { if (inp[k] != null) f.set(num(inp[k], f.get())); });
    if (typeof inp.color === "string" && isColor(inp.color)) body.set(inp.color);
    update();
  };
  return { el: root, set, get: value };
}

registerControl("shadow", createShadow);
