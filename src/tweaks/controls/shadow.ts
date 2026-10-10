// ── Shadow — a box-shadow editor: offset, blur, spread, inset, and a colour from the kit's
// own picker, mounted inline (the gradient's rule: one editor surface, never a nested
// popover — popover() is single-open). The value is structured, { inset, x, y, blur, spread,
// color }, and carries the CSS it resolves to as `css`, built only from the numbers and a
// colour the picker re-serialized — never a host string verbatim (the gradient's lesson: a
// string that reaches a `style` sink can splice in a url()). Lazy; depends on the colour
// module. ──
import { el, txt, popover, createSegmented, registerControl } from "../shared.js";
import { numField, triggerRow } from "../heavy.js";
import { createPickerBody, isColor } from "./colour.js";
import type { OnChange, NumField } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control, ShadowValue, ShadowInput } from "../types.js";

const DEF = { x: 0, y: 8, blur: 24, spread: 0, color: "rgb(0 0 0 / 0.18)" };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const num = (v: unknown, d: number) => (v != null && v !== "" && Number.isFinite(+v) ? +v : d);
const fmt = (n: number) => String(+n.toFixed(1));
// A colour token the kit recognises: a hex, or one colour function (no nesting, so a
// `color(display-p3 …)` is one match and a stray `)` can't extend it).
const COLOR_RE = /#[0-9a-f]{3,8}\b|(?:oklch|oklab|rgba?|hsla?|hwb|lab|lch|color)\([^()]*\)/i;
const LEN_RE = /^(-?\d*\.?\d+)(px)?$/;
// A box-shadow string, strictly: optional `inset`, two to four px lengths (a bare 0 passes),
// one colour, one layer. Anything else is null and the caller ignores it — `em`, `calc()`,
// `var()`, named colours and extra layers never round-trip through px fields anyway.
const parseShadow = (s: string): ShadowInput | null => {
  const m = COLOR_RE.exec(s); if (!m || !isColor(m[0])) return null;
  const rest = (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).trim().split(/\s+/).filter(Boolean);
  const inset = rest.includes("inset"), lens = rest.filter((t) => t !== "inset");
  if (lens.length < 2 || lens.length > 4 || !lens.every((t) => LEN_RE.test(t))) return null;
  const n = lens.map((t) => +t.replace(/px$/, ""));
  return { inset, x: n[0], y: n[1], blur: n[2] ?? 0, spread: n[3] ?? 0, color: m[0] };
};

function createShadow(meta: Meta, onChange: OnChange): Control {
  const read = (v: unknown): ShadowInput | null => (typeof v === "string" ? parseShadow(v) : isObj(v) ? v : null);
  const init = read(meta.value) || {};
  let inset = !!init.inset, x = num(init.x, DEF.x), y = num(init.y, DEF.y), blur = Math.max(0, num(init.blur, DEF.blur)), spread = num(init.spread, DEF.spread);

  // ── Row — label, a chip with the shadow on a small tile (scaled down), a summary. ──
  const { root, trigger, right } = triggerRow("tw-shadow", meta.label ?? "Shadow"); // ??: an explicit "" label renders none
  const chip = el("span", "tw-trigger-chip tw-shadow-chip"), chipTile = el("span", "tw-shadow-chip-tile"); chip.append(chipTile);
  const valueEl = el("span", "tw-trigger-value");
  right.append(chip, valueEl);

  // ── Popover — a preview card, the position switch, the four lengths, the picker. Carries
  // the colour popover's class so it inherits its shell, tokens, and short-viewport scroll. ──
  const pop = el("div", "tw-color-pop tw-shadow-pop");
  const stage = el("div", "tw-shadow-stage"), card = el("div", "tw-shadow-card"); stage.append(card);
  const insetSeg = createSegmented([{ value: "outer", label: "Outer" }, { value: "inner", label: "Inner" }], inset ? "inner" : "outer", (m: unknown) => { if ((m === "inner") !== inset) { inset = m === "inner"; update(); emit(); } }, "Shadow position");
  const insetRow = el("div", "tw-row"); insetRow.append(txt("span", "tw-row-label", "Position"), insetSeg.el);
  const fields = el("div", "tw-fields");
  const field = (label: string, get: () => number, put: (v: number) => void, min?: number): NumField => { const f = numField({ label, value: get(), step: 1, min, unit: "px" }, (v) => { put(v); update(); emit(); }); fields.append(f.el); return f; };
  const fx = field("X", () => x, (v) => { x = v; }), fy = field("Y", () => y, (v) => { y = v; });
  const fb = field("Blur", () => blur, (v) => { blur = Math.max(0, v); }, 0), fs = field("Spread", () => spread, (v) => { spread = v; });
  // As the fields fitted them (whole px, blur ≥ 0), so the value, the CSS and the fields never disagree — an authored 2.5 showed "3" and emitted 2.5px.
  x = fx.get(); y = fy.get(); blur = fb.get(); spread = fs.get();
  const body = createPickerBody({ value: typeof init.color === "string" && isColor(init.color) ? init.color : DEF.color }, () => { update(); emit(); });
  pop.append(stage, insetRow, fields, body.el);
  root.append(pop);

  // The CSS, at a scale: 1 for the value and the preview card, a fraction for the chip's tile.
  const cssAt = (k: number) => `${inset ? "inset " : ""}${fmt(x * k)}px ${fmt(y * k)}px ${fmt(blur * k)}px ${fmt(spread * k)}px ${body.get()}`;
  const value = (): ShadowValue => ({ inset, x: +fmt(x), y: +fmt(y), blur: +fmt(blur), spread: +fmt(spread), color: body.get(), css: cssAt(1) });
  const emit = () => onChange(value());
  const update = () => {
    card.style.boxShadow = cssAt(1); chipTile.style.boxShadow = cssAt(0.3);
    valueEl.textContent = `${inset ? "in " : ""}${fmt(x)} ${fmt(y)} ${fmt(blur)}${spread ? " " + fmt(spread) : ""}`;
  };
  popover(root, trigger, pop, { width: 260, fallbackH: 480, gap: 6, onOpen: body.reflow, onReflow: body.reflow });
  update();

  // Programmatic set / restore: the object form (any subset of the fields) or a box-shadow
  // string in the strict grammar above. The derived `css` is ignored; a colour goes through
  // the picker, so it comes back out in the picker's own notation.
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
