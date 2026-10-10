// ── Sides — one row for a four-sided length: padding, margin, border width, or (corners:
// true) a border radius. Linked, it is one number field for all four; the link button
// beside it opens four fields in CSS order (top, right, bottom, left; or the corners from
// top-left round). The value is the four numbers plus the shorthand they collapse to,
// `css`, built only from the numbers and the control's unit — never a host string. Lazy. ──
import { el, txt, btn, icon, registerControl } from "../shared.js";
import { numField } from "../heavy.js";
import type { OnChange, NumField } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control, SidesValue } from "../types.js";

const ICON_LINK = icon('<path d="M10.5 13.5a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1.5 1.5M13.5 10.5a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1.5-1.5"/>'); // original: two links of a chain, one path
const LEN_RE = /^(-?\d*\.?\d+)([a-z%]*)$/i;
const num = (v: unknown) => (v != null && v !== "" && Number.isFinite(+v) ? +v : null);
const fmt = (n: number) => String(+n.toFixed(2));
// CSS's expansion: one for all, [vertical, horizontal], [top, horizontal, bottom], the four.
const expand = (n: number[]) => (n.length === 1 ? [n[0], n[0], n[0], n[0]] : n.length === 2 ? [n[0], n[1], n[0], n[1]] : n.length === 3 ? [n[0], n[1], n[2], n[1]] : n.slice(0, 4));
// Any of the input forms → four numbers, or null when nothing in it parses (the caller then
// ignores it). An object fills in from `cur`, so `{ top: 4 }` moves one side.
const read = (v: unknown, cur: number[]): number[] | null => {
  if (typeof v === "number") return Number.isFinite(v) ? [v, v, v, v] : null;
  if (typeof v === "string") { const n = v.trim().split(/\s+/).map((t) => { const m = LEN_RE.exec(t); return m ? +m[1] : NaN; }); return n.length >= 1 && n.length <= 4 && n.every(Number.isFinite) ? expand(n) : null; }
  if (Array.isArray(v)) { const n = v.map(num); return n.length >= 1 && n.length <= 4 && n.every((x) => x !== null) ? expand(n as number[]) : null; }
  if (v && typeof v === "object") { const o = v as Record<string, unknown>, out = cur.slice(); let any = false; (["top", "right", "bottom", "left"] as const).forEach((k, i) => { const x = num(o[k]); if (x !== null) { out[i] = x; any = true; } }); return any ? out : null; }
  return null;
};

function createSides(meta: Meta, onChange: OnChange): Control {
  const unit = typeof meta.unit === "string" && meta.unit.trim() ? meta.unit.trim() : "px", corners = !!meta.corners;
  const spec = { step: meta.step ?? 1, min: meta.min, max: meta.max, unit };
  let v = read(meta.value, [0, 0, 0, 0]) || [0, 0, 0, 0], linked = v.every((x) => x === v[0]);
  const root = el("div", "tw-sides");
  // Linked: a number row with the link button between the label and the field.
  const all = numField({ label: meta.label, value: v[0], row: true, ...spec }, (n) => { v = [n, n, n, n]; update(); emit(); });
  const linkBtn = (): HTMLButtonElement => { const b = btn("tw-sides-link", ICON_LINK); b.setAttribute("aria-label", "Link all sides"); b.title = "Same on all sides"; b.addEventListener("click", () => toggle()); return b; };
  const link1 = linkBtn(); all.el.insertBefore(link1, all.el.lastChild);
  // Unlinked: a header line (label, summary, link) over the four fields.
  const multi = el("div", "tw-sides-multi"), head = el("div", "tw-sides-head"), sum = el("span", "tw-sides-sum"), link2 = linkBtn();
  head.append(txt("span", "tw-row-label", meta.label), sum, link2);
  const fields = el("div", "tw-fields");
  const names = corners ? ["TL", "TR", "BR", "BL"] : ["T", "R", "B", "L"];
  const flds: NumField[] = names.map((n, i) => { const f = numField({ label: n, value: v[i], ...spec }, (x) => { v[i] = x; update(); emit(); }); fields.append(f.el); return f; });
  multi.append(head, fields); root.append(all.el, multi);
  // As the fields fitted them (step, min, max), so the value and the fields agree.
  v = flds.map((f) => f.get());

  const css = () => { const [t, r, b, l] = v.map(fmt), u = (s: string) => (s === "0" ? "0" : s + unit); return (t === b && r === l ? (t === r ? [t] : [t, r]) : r === l ? [t, r, b] : [t, r, b, l]).map(u).join(" "); };
  const value = (): SidesValue => ({ top: v[0], right: v[1], bottom: v[2], left: v[3], css: css() });
  const emit = () => onChange(value());
  const update = () => {
    root.classList.toggle("is-linked", linked);
    for (const b of [link1, link2]) b.setAttribute("aria-pressed", String(linked));
    all.set(v[0]); flds.forEach((f, i) => f.set(v[i]));
    sum.textContent = v.map(fmt).join(" ");
  };
  // Linking takes the first side for all four (the convention); unlinking keeps the four.
  const toggle = () => { linked = !linked; if (linked) v = [v[0], v[0], v[0], v[0]]; update(); emit(); (linked ? link1 : link2).focus(); };
  update();

  // Programmatic set / restore: any input form. Equal sides re-link; unequal ones unlink,
  // so a restored "8 16 8 16" opens the fields it needs.
  const set = (x: unknown) => { const n = read(x, v); if (!n) return; flds.forEach((f, i) => f.set(n[i])); v = flds.map((f) => f.get()); linked = v.every((s) => s === v[0]); update(); };
  return { el: root, set, get: value };
}

registerControl("sides", createSides);
