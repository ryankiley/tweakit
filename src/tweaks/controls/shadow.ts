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
  const m = COLOR_RE.exec(s);
  if (!m || !isColor(m[0])) return null;
  const rest = (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).trim().split(/\s+/).filter(Boolean);
  const inset = rest.includes("inset"),
    lens = rest.filter((t) => t !== "inset");
  if (lens.length < 2 || lens.length > 4 || !lens.every((t) => LEN_RE.test(t))) return null;
  const n = lens.map((t) => +t.replace(/px$/, ""));
  return { inset, x: n[0], y: n[1], blur: n[2] ?? 0, spread: n[3] ?? 0, color: m[0] };
};

// the kit's chevron; importing icons.ts splits a 4th chunk
const CHEVRON = icon('<path d="M18 9s-4.4 6-6 6-6-6-6-6"/>', "twk-shadow-chevron", 2.5);
function createShadow(meta: Meta, onChange: OnChange): Control {
  const tr = words();
  const read = (v: unknown): ShadowInput | null => (typeof v === "string" ? parseShadow(v) : isObj(v) ? v : null);
  const init = read(meta.value ?? meta) || {}; // the fields may sit on the meta itself (verbose form)
  let inset = !!init.inset;

  // ── Row — label, chip, summary. ──
  // ??: an explicit "" label renders none
  const { root, trigger, chip, valueEl } = triggerRow(
    "twk-shadow",
    meta.label ?? tr("shadow", "Shadow"),
    "twk-shadow-chip",
  );
  const chipTile = el("span", "twk-shadow-chip-tile");
  chip.append(chipTile);

  // ── Popover — a preview card, the position switch, the four lengths, the picker. ──
  const pop = el("div", "twk-color-pop twk-shadow-pop");
  const stage = el("div", "twk-shadow-stage"),
    card = el("div", "twk-shadow-card");
  stage.append(card);
  const insetSeg = createSegmented(
    [
      { value: "outer", label: tr("outer", "Outer") },
      { value: "inner", label: tr("inner", "Inner") },
    ],
    inset ? "inner" : "outer",
    (m: unknown) => {
      if ((m === "inner") !== inset) {
        inset = m === "inner";
        update();
        emit();
      }
    },
    tr("shadowPosition", "Shadow position"),
  );
  const insetRow = el("div", "twk-row");
  insetRow.append(txt("span", "twk-row-label", tr("position", "Position")), insetSeg.el);
  const fields = el("div", "twk-fields twk-shadow-fields");
  // The four lengths live in their fields, read as the fields fit them: an authored 2.5 shows "3" and emits 3px, and
  // the blur's min clamps a negative one to 0.
  const field = (label: string, value: number, min?: number): NumField => {
    const f = numField({ label, value, step: 1, min, unit: "px" }, () => {
      update();
      emit();
    });
    fields.append(f.el);
    return f;
  };
  // keyed as the value names them, in box-shadow's order
  const F = {
    x: field("X", num(init.x, DEF.x)),
    y: field("Y", num(init.y, DEF.y)),
    blur: field(tr("blur", "Blur"), num(init.blur, DEF.blur), 0),
    spread: field(tr("spread", "Spread"), num(init.spread, DEF.spread)),
  };
  const lengths = () => Object.values(F).map((f) => f.get());
  // The subject, w × h: the element the shadow is for. The card draws it at that size and scales it into 64 × 40, since a
  // transform scales the box-shadow with the box; lengths scaled on a small box lose a negative spread, which empties
  // it. `size` is its width (at the card's 8:5) or `[w, h]`, markup's "w,h"; without one, the smallest from 64 wide up
  // that keeps the authored shadow in view, so a small one looks as it always has.
  let [w, h = w * 0.625] = String(meta.size).split(",").map(Number),
    k = Math.min(64 / w, 40 / h);
  if (!(Math.min(w, h, k) > 0 && k < 1 / 0)) {
    // a spread up to a quarter of its height, an offset and blur to about the stage's edge
    const [x, y, blur, spread] = lengths().map(Math.abs);
    w = Math.max(64, 6.4 * spread, 2 * Math.max(x, y) + blur);
    h = w * 0.625;
    k = 64 / w;
  }
  // The color row discloses the picker, so the pop opens compact.
  const colorRow = btn("twk-trigger twk-shadow-color");
  colorRow.setAttribute("aria-expanded", "false");
  const cSwatch = el("span", "twk-trigger-chip twk-color-swatch"),
    cText = el("span", "twk-trigger-value"),
    cRight = el("span", "twk-trigger-right");
  cRight.append(cSwatch, cText);
  cRight.insertAdjacentHTML("beforeend", CHEVRON);
  colorRow.append(txt("span", "twk-trigger-label", tr("color", "Color")), cRight);
  const body = createPickerBody(
    { value: typeof init.color === "string" && isColor(init.color) ? init.color : DEF.color, onMode: () => update() },
    () => {
      update();
      emit();
    },
  );
  body.el.hidden = true;
  // re-place for the new height; the picker lays out now
  colorRow.addEventListener("click", () => {
    const show = body.el.hidden;
    body.el.hidden = !show;
    colorRow.setAttribute("aria-expanded", String(show));
    pop_.reflow();
  });
  pop.append(stage, insetRow, fields, colorRow, body.el);
  root.append(pop);

  const css = () =>
    `${inset ? "inset " : ""}${lengths()
      .map((n) => `${fmt(n)}px`)
      .join(" ")} ${body.get()}`;
  const value = (): ShadowValue => {
    const [x, y, blur, spread] = lengths().map((n) => +fmt(n));
    return { inset, x, y, blur, spread, color: body.get(), css: css() };
  };
  const emit = () => onChange(value());
  // Sizes node as the subject × f, scaled by s to show with an r px radius; its painter centres it with its shadow, half
  // the offset back (at most `room`), so a long offset stays in the frame. An inset shadow stays inside, so stays put.
  const draw = (node: HTMLElement, f: number, s: number, r: number, room: number) => {
    Object.assign(node.style, { width: `${w * f}px`, height: `${h * f}px`, borderRadius: `${r / s}px` });
    return (x: number, y: number, c: string) => {
      const mid = (n: number) => (inset ? 0 : Math.max(-room, Math.min(room, (-n * s) / 2)));
      node.style.boxShadow = c;
      node.style.transform = `translate(${mid(x)}px, ${mid(y)}px) scale(${s})`;
    };
  };
  // The chip's tile draws the subject at 5/8 size, so its shadow reads at 12px wide, as the lengths × 0.3 did.
  const paint = [draw(card, 1, k, 9, 22), draw(chipTile, 0.625, k * 0.3, 2, 5)];
  const update = () => {
    const [x, y, blur, spread] = lengths();
    const c = css();
    for (const p of paint) p(x, y, c);
    valueEl.textContent = `${inset ? tr("inset", "in") + " " : ""}${fmt(x)} ${fmt(y)} ${fmt(blur)}${spread ? " " + fmt(spread) : ""}`;
    cSwatch.style.background = body.swatchCss();
    cText.textContent = body.valueText();
  };
  const pop_ = popover(root, trigger, pop, { fallbackH: 300, onOpen: body.reflow, onReflow: body.reflow });
  update();

  // Set/restore: the object form or a strict box-shadow string; `css` is ignored, and the color goes through the
  // picker.
  const set = (v: unknown) => {
    const inp = read(v);
    if (!inp) return;
    if (inp.inset != null) {
      inset = !!inp.inset;
      insetSeg.set(inset ? "inner" : "outer");
    }
    for (const k of Object.keys(F) as (keyof typeof F)[]) if (inp[k] != null) F[k].set(num(inp[k], F[k].get()));
    if (typeof inp.color === "string" && isColor(inp.color)) body.set(inp.color);
    update();
  };
  return { el: root, set, get: value };
}

registerControl("shadow", createShadow);
