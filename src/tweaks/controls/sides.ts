// ── Sides — one row for a four-sided length (padding, margin, border width, or with `corners` a radius): one field
// linked; unlinked, the row opens in place and four fields sit in a line under it, in CSS order, each under its glyph.
// The value is the four numbers in CSS order plus the shorthand `css`, built only from the numbers and the unit —
// never a host string. Lazy. ──
import { el, txt, btn, icon, registerControl, stepPrecision, words } from "../shared.js";
import { numField, decimalStep } from "../heavy.js";
import type { OnChange, NumField } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control, SidesValue } from "../types.js";

// original: the four corner arcs of a rounded box, apart
const ICON_SPLIT = icon(
  '<path d="M3 9V7a4 4 0 0 1 4-4h2M15 3h2a4 4 0 0 1 4 4v2M21 15v2a4 4 0 0 1-4 4h-2M9 21H7a4 4 0 0 1-4-4v-2"/>',
);
// original: the top-left quarter of a rounded box, turned per corner in CSS
const ICON_CORNER = icon('<path d="M3 13V8a5 5 0 0 1 5-5h5"/>', "", 1.5, 16);
// original: the top of that box, two of its corners joined, turned per side
const ICON_EDGE = icon('<path d="M3 10V8a5 5 0 0 1 5-5a5 5 0 0 1 5 5v2"/>', "", 1.5, 16);
const LEN_RE = /^(-?\d*\.?\d+)([a-z%]*)$/i;
const num = (v: unknown) => (v != null && v !== "" && Number.isFinite(+v) ? +v : null);
const expand = (n: number[]) =>
  n.length === 1
    ? [n[0], n[0], n[0], n[0]]
    : n.length === 2
      ? [n[0], n[1], n[0], n[1]]
      : n.length === 3
        ? [n[0], n[1], n[2], n[1]]
        : n.slice(0, 4);
// A shorthand string as one to four [number, unit] pairs, or null for anything else: calc(), var(), five lengths, junk.
const lengths = (s: string) => {
  const m = s
    .trim()
    .split(/\s+/)
    .map((t) => LEN_RE.exec(t));
  return m.length <= 4 && m.every(Boolean)
    ? (m as RegExpExecArray[]).map((x) => [+x[1], x[2].toLowerCase()] as const)
    : null;
};
// Any form to four numbers, or null; an object fills in from `cur`, so `{ top: 4 }` moves one side.
const read = (v: unknown, cur: number[]): number[] | null => {
  if (typeof v === "number") return Number.isFinite(v) ? [v, v, v, v] : null;
  if (typeof v === "string") {
    const n = lengths(v);
    return n ? expand(n.map((x) => x[0])) : null;
  }
  if (Array.isArray(v)) {
    const n = v.map(num);
    return n.length >= 1 && n.length <= 4 && n.every((x) => x !== null) ? expand(n as number[]) : null;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>,
      out = cur.slice();
    let any = false;
    (["top", "right", "bottom", "left"] as const).forEach((k, i) => {
      const x = num(o[k]);
      if (x !== null) {
        out[i] = x;
        any = true;
      }
    });
    return any ? out : null;
  }
  return null;
};

// The unit a shorthand string says, when its sides agree: "1rem 2rem" is rem, and so is "0 1rem 2". A zero doesn't
// vote, as 0 is 0 in any unit. Mixed units can't be kept, since the control edits four numbers in one unit, so they
// warn and read as px, as every string did before; "" when the string names no unit.
const saidUnit = (v: unknown, name: string, sides: string[]) => {
  const n = typeof v === "string" && lengths(v);
  if (!n) return "";
  const said = expand(n.map((_, i) => i))
    .map((i, s) => [sides[s].toLowerCase(), n[i][0] ? n[i][1] : ""])
    .filter(([, u]) => u);
  if (new Set(said.map(([, u]) => u)).size < 2) return said.length ? said[0][1] : "";
  console.warn(
    `[tweaks] sides "${name}": "${v}" mixes units (${said.map((s) => s.join(" ")).join(", ")}) and the control edits one, so all four read as px; write one unit, or set unit`,
  );
  return "";
};

function createSides(meta: Meta, onChange: OnChange): Control {
  const corners = !!meta.corners,
    names = corners ? ["Top-left", "Top-right", "Bottom-right", "Bottom-left"] : ["Top", "Right", "Bottom", "Left"];
  // topLeft …; `names` stays the glyph's data-at
  const tr = words(),
    shown = names.map((n) =>
      tr(
        n.toLowerCase().replace(/-(\w)/, (_, c) => c.toUpperCase()),
        n,
      ),
    );
  const name = meta.label || meta.key,
    init = meta.value ?? meta;
  // an explicit unit wins over the string's
  const unit = (typeof meta.unit === "string" && meta.unit.trim()) || saidUnit(init, name, names) || "px";
  let v = read(init, [0, 0, 0, 0]);
  // No step: 1, or finer when a side has decimals, so "0.5rem 1.25rem" keeps its quarter rem (decimalStep, as the
  // number's).
  // a radius can't go negative; a margin can
  const spec = {
    step: meta.step ?? Math.min(1, ...(v || []).map(decimalStep)),
    min: meta.min ?? (corners ? 0 : undefined),
    max: meta.max,
    unit,
  };
  // the readout and css at the step's decimals, so 0.125rem isn't 0.13rem
  const fmt = (n: number) => String(+n.toFixed(Math.max(2, stepPrecision(+spec.step))));
  // A default it can't read still starts at 0, but says so: a padding that quietly lost its value looks like the page's
  // bug.
  // An object naming no side stays quiet, as markup hands its whole dataset over when there's no data-value.
  if (!v && meta.value != null && (typeof meta.value !== "object" || Array.isArray(meta.value)))
    console.warn(
      `[tweaks] sides "${name}": can't read ${JSON.stringify(meta.value)?.slice(0, 60)}, so it starts at 0; it takes one to four numbers or plain lengths, like "8px 16px"`,
    );
  v = v || [0, 0, 0, 0];
  let linked = v.every((x) => x === v[0]);
  const root = el("div", "twk-sides");
  const all = numField({ label: meta.label, value: v[0], row: true, ...spec }, (n) => {
    v = [n, n, n, n];
    update();
    emit();
  });
  // One toggle, moved to whichever block is showing; last in both, so it sits on the same pixels either way. It says
  // what a click opens — each corner or side on its own — and is pressed while they are.
  const split = corners ? tr("splitCorners", "Independent corners") : tr("splitSides", "Independent sides");
  const link = btn("twk-sides-link", ICON_SPLIT);
  link.setAttribute("aria-label", split);
  link.title = split;
  link.addEventListener("click", () => toggle());
  // The head has the row's geometry, so opening moves nothing: the readout takes the field's place, with the unit once.
  const multi = el("div", "twk-sides-multi"),
    head = el("div", "twk-sides-head"),
    sum = el("span", "twk-sides-sum"),
    nums = document.createTextNode("");
  sum.append(nums, txt("span", "twk-sides-unit", unit));
  head.append(txt("span", "twk-row-label", meta.label), sum);
  const fields = el("div", "twk-fields");
  const flds: NumField[] = shown.map((n, i) =>
    numField({ label: n, value: v[i], ...spec }, (x) => {
      v[i] = x;
      update();
      emit();
    }),
  );
  // The input and the tooltip carry the full name; on screen each field wears its glyph, one drawing turned per place.
  flds.forEach((f, i) => {
    const lab = f.el.querySelector<HTMLElement>(".twk-field-label")!;
    lab.title = shown[i];
    lab.classList.add("twk-sides-glyph");
    lab.dataset.at = names[i].toLowerCase();
    lab.innerHTML = corners ? ICON_CORNER : ICON_EDGE;
    fields.append(f.el);
  });
  multi.append(head, fields);
  root.append(all.el, multi);
  // As the fields fitted them.
  v = flds.map((f) => f.get());

  const css = () => {
    const [t, r, b, l] = v.map(fmt),
      u = (s: string) => (s === "0" ? "0" : s + unit);
    return (t === b && r === l ? (t === r ? [t] : [t, r]) : r === l ? [t, r, b] : [t, r, b, l]).map(u).join(" ");
  };
  const value = (): SidesValue => ({ top: v[0], right: v[1], bottom: v[2], left: v[3], css: css() });
  const emit = () => onChange(value());
  const update = () => {
    root.classList.toggle("is-linked", linked);
    link.setAttribute("aria-pressed", String(!linked));
    (linked ? all.el : head).append(link);
    all.set(v[0]);
    flds.forEach((f, i) => f.set(v[i]));
    nums.data = v.map(fmt).join(" ");
  };
  const toggle = () => {
    linked = !linked;
    if (linked) v = [v[0], v[0], v[0], v[0]];
    update();
    emit();
    link.focus();
  };
  update();

  // Set/restore: equal sides re-link, unequal ones unlink, so a restored "8 16 8 16" opens the fields it needs.
  const set = (x: unknown) => {
    const n = read(x, v);
    if (!n) return;
    flds.forEach((f, i) => f.set(n[i]));
    v = flds.map((f) => f.get());
    linked = v.every((s) => s === v[0]);
    update();
  };
  return { el: root, set, get: value, range: all.range };
}

registerControl("sides", createSides);
