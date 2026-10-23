// ── Sides — one row for a four-sided length (padding, margin, border width, or with `corners` a radius): one field
// linked; unlinked, the row opens in place and four fields sit in a line under it, in CSS order, each under its glyph.
// The value is the four numbers in CSS order plus the shorthand `css`, built only from the numbers and the unit —
// never a host string. Lazy. ──
import { el, txt, btn, icon, registerControl } from "../shared.js";
import { numField } from "../heavy.js";
import type { OnChange, NumField } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control, SidesValue } from "../types.js";

const ICON_LINK = icon('<path d="M10.5 13.5a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1.5 1.5M13.5 10.5a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1.5-1.5"/>'); // original: two links of a chain, one path
const ICON_CORNER = icon('<path d="M3 13V8a5 5 0 0 1 5-5h5"/>', "", 1.5, 16); // original: the top-left quarter of a rounded box, turned per corner in CSS
const ICON_EDGE = icon('<path d="M3 10V8a5 5 0 0 1 5-5a5 5 0 0 1 5 5v2"/>', "", 1.5, 16); // original: the top of that box, two of its corners joined, turned per side
const LEN_RE = /^(-?\d*\.?\d+)([a-z%]*)$/i;
const num = (v: unknown) => (v != null && v !== "" && Number.isFinite(+v) ? +v : null);
const fmt = (n: number) => String(+n.toFixed(2));
const expand = (n: number[]) => (n.length === 1 ? [n[0], n[0], n[0], n[0]] : n.length === 2 ? [n[0], n[1], n[0], n[1]] : n.length === 3 ? [n[0], n[1], n[2], n[1]] : n.slice(0, 4));
// Any form to four numbers, or null; an object fills in from `cur`, so `{ top: 4 }` moves one side.
const read = (v: unknown, cur: number[]): number[] | null => {
  if (typeof v === "number") return Number.isFinite(v) ? [v, v, v, v] : null;
  if (typeof v === "string") { const n = v.trim().split(/\s+/).map((t) => { const m = LEN_RE.exec(t); return m ? +m[1] : NaN; }); return n.length >= 1 && n.length <= 4 && n.every(Number.isFinite) ? expand(n) : null; }
  if (Array.isArray(v)) { const n = v.map(num); return n.length >= 1 && n.length <= 4 && n.every((x) => x !== null) ? expand(n as number[]) : null; }
  if (v && typeof v === "object") { const o = v as Record<string, unknown>, out = cur.slice(); let any = false; (["top", "right", "bottom", "left"] as const).forEach((k, i) => { const x = num(o[k]); if (x !== null) { out[i] = x; any = true; } }); return any ? out : null; }
  return null;
};

function createSides(meta: Meta, onChange: OnChange): Control {
  const unit = typeof meta.unit === "string" && meta.unit.trim() ? meta.unit.trim() : "px", corners = !!meta.corners;
  const spec = { step: meta.step ?? 1, min: meta.min ?? (corners ? 0 : undefined), max: meta.max, unit }; // a radius can't go negative; a margin can
  let v = read(meta.value ?? meta, [0, 0, 0, 0]) || [0, 0, 0, 0], linked = v.every((x) => x === v[0]);
  const root = el("div", "tw-sides");
  const all = numField({ label: meta.label, value: v[0], row: true, ...spec }, (n) => { v = [n, n, n, n]; update(); emit(); });
  // One link button, moved to whichever block is showing; last in both, so it sits on the same pixels either way.
  const link = btn("tw-sides-link", ICON_LINK); link.setAttribute("aria-label", "Link all sides"); link.title = "Same on all sides"; link.addEventListener("click", () => toggle());
  // The head has the row's geometry, so opening moves nothing: the readout takes the field's place, with the unit once.
  const multi = el("div", "tw-sides-multi"), head = el("div", "tw-sides-head"), sum = el("span", "tw-sides-sum"), nums = document.createTextNode("");
  sum.append(nums, txt("span", "tw-sides-unit", unit)); head.append(txt("span", "tw-row-label", meta.label), sum);
  const fields = el("div", "tw-fields");
  const names = corners ? ["Top-left", "Top-right", "Bottom-right", "Bottom-left"] : ["Top", "Right", "Bottom", "Left"];
  const flds: NumField[] = names.map((n, i) => numField({ label: n, value: v[i], ...spec }, (x) => { v[i] = x; update(); emit(); }));
  // The input and the tooltip carry the full name; on screen each field wears its glyph, one drawing turned per place.
  flds.forEach((f, i) => { const lab = f.el.querySelector<HTMLElement>(".tw-field-label")!; lab.title = names[i]; lab.classList.add("tw-sides-glyph"); lab.dataset.at = names[i].toLowerCase(); lab.innerHTML = corners ? ICON_CORNER : ICON_EDGE; fields.append(f.el); });
  multi.append(head, fields); root.append(all.el, multi);
  // As the fields fitted them.
  v = flds.map((f) => f.get());

  const css = () => { const [t, r, b, l] = v.map(fmt), u = (s: string) => (s === "0" ? "0" : s + unit); return (t === b && r === l ? (t === r ? [t] : [t, r]) : r === l ? [t, r, b] : [t, r, b, l]).map(u).join(" "); };
  const value = (): SidesValue => ({ top: v[0], right: v[1], bottom: v[2], left: v[3], css: css() });
  const emit = () => onChange(value());
  const update = () => {
    root.classList.toggle("is-linked", linked); link.setAttribute("aria-pressed", String(linked));
    (linked ? all.el : head).append(link);
    all.set(v[0]); flds.forEach((f, i) => f.set(v[i]));
    nums.data = v.map(fmt).join(" ");
  };
  const toggle = () => { linked = !linked; if (linked) v = [v[0], v[0], v[0], v[0]]; update(); emit(); link.focus(); };
  update();

  // Set/restore: equal sides re-link, unequal ones unlink, so a restored "8 16 8 16" opens the fields it needs.
  const set = (x: unknown) => { const n = read(x, v); if (!n) return; flds.forEach((f, i) => f.set(n[i])); v = flds.map((f) => f.get()); linked = v.every((s) => s === v[0]); update(); };
  return { el: root, set, get: value };
}

registerControl("sides", createSides);
