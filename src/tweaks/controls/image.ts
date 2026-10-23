// ── Image — a drop zone / file pick that yields a data URL; with `options`, a gallery of supplied URLs over the upload. Lazy.
import { el, txt, btn, icon, optValue, radioButton, navIndex, registerControl } from "../shared.js";
import { triggerRow } from "../heavy.js";
import type { OnChange, RadioBtn } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control } from "../types.js";

// Escape for a CSS string literal: the quote, the backslash and control characters (a raw newline ends a CSS string),
// so a stored `a.png"), url("https://x/p.png` is one broken image, not a second background layer and a fetch.
const cssString = (s: string) => String(s).replace(/[\\"]/g, "\\$&").replace(/[\x00-\x1f\x7f]/g, (c) => "\\" + c.charCodeAt(0).toString(16) + " ");
const urlCss = (s: string) => `url("${cssString(s)}")`;
const MB = 1 << 20;
const size = (n: number) => (n >= MB ? `${Math.round((n / MB) * 10) / 10} MB` : `${Math.round(n / 1024)} KB`);
// A tile's accessible name when its option has no label: the URL's file stem; a data URL has none.
const stem = (url: string) => { if (/^data:/i.test(url)) return ""; const s = url.split(/[?#]/)[0].split("/").pop()!.replace(/\.\w+$/, ""); try { return decodeURIComponent(s); } catch { return s; } };
const ICON_X = icon('<path d="M18 6 6 18m12 0L6 6"/>', "", 2.2); // the kit's cancel glyph, local to this lazy chunk
const ICON_UPLOAD = icon('<path d="M12 15V4m-4.5 4.5L12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>');

function createImage(meta: Meta, onChange: OnChange): Control {
  let value = typeof meta.value === "string" ? meta.value : "";
  // Options: URLs, or { value, label }; anything but a non-empty string value is skipped.
  const options = (Array.isArray(meta.options) ? meta.options : []).map((o) => ({ value: optValue(o), label: o && typeof o === "object" && o.label != null ? String(o.label) : "" })).filter((o): o is { value: string; label: string } => typeof o.value === "string" && !!o.value);
  const canUpload = meta.upload !== false || !options.length; // the plain row is the upload: there is nothing else to leave
  const maxSize = +meta.maxSize! > 0 ? +meta.maxSize! : 10 * MB;
  const input = el("input", "tw-image-input"); input.type = "file"; input.accept = "image/*";
  // A refused file's reason takes the button text's place for a moment, and is announced.
  const note = el("span", "tw-image-note"); note.setAttribute("role", "status");
  let noteTimer: ReturnType<typeof setTimeout>;
  const say = (msg: string) => { note.textContent = msg; clearTimeout(noteTimer); noteTimer = setTimeout(() => { note.textContent = ""; }, 2600); };
  let render: () => void;
  const commit = (v: string, fire = true) => { value = v; render(); if (fire) onChange(value); };
  const load = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return say("Not an image");
    if (file.size > maxSize) return say(`${size(file.size)}, max ${size(maxSize)}`);
    const fr = new FileReader();
    fr.onload = () => commit(String(fr.result));
    fr.onerror = () => say("Couldn't read the file");
    fr.readAsDataURL(file);
  };
  // `zone` takes the drop and `over` wears [data-over] meanwhile. dragover re-asserts each tick, so crossing the children doesn't drop the outline.
  const dropZone = (zone: HTMLElement, over: HTMLElement) => {
    zone.addEventListener("dragover", (e) => { e.preventDefault(); over.dataset.over = "true"; });
    zone.addEventListener("dragleave", () => { over.dataset.over = "false"; });
    zone.addEventListener("drop", (e) => { e.preventDefault(); over.dataset.over = "false"; load(e.dataTransfer?.files[0]); });
  };
  input.addEventListener("change", () => { load(input.files?.[0]); input.value = ""; }); // cleared, so the same file picked again fires change
  let root: HTMLElement;

  if (!options.length) {
    // The plain row: the whole trigger is the target, a click opens the file dialog and the row is also the drop zone.
    const row = triggerRow("tw-image", meta.label); root = row.root;
    row.trigger.removeAttribute("aria-expanded"); // opens a file dialog, not an expandable popover
    row.trigger.setAttribute("aria-label", `${meta.label}: choose an image`);
    const text = el("span", "tw-image-text");
    const thumb = el("span", "tw-trigger-chip tw-image-thumb");
    row.right.append(thumb, note, text); // thumb first, as every chip row
    root.append(input);
    render = () => {
      thumb.dataset.set = value ? "true" : "false";
      thumb.style.backgroundImage = value ? urlCss(value) : "";
      text.textContent = value ? "Replace" : "Drop or choose";
    };
    row.trigger.addEventListener("click", () => input.click());
    dropZone(row.trigger, row.trigger);
  } else {
    // The gallery: a label row with Remove, the tiles as one radio group, and the upload button, which is the block's drop zone.
    root = el("div", "tw-image tw-image-gallery");
    const upload = canUpload ? btn("tw-button tw-image-upload", ICON_UPLOAD) : null;
    const remove = btn("tw-image-remove", ICON_X); remove.setAttribute("aria-label", `${meta.label}: remove the image`);
    const head = el("div", "tw-image-head"); head.append(txt("span", "tw-image-label", meta.label), remove);
    const grid = el("div", "tw-image-grid"); grid.setAttribute("role", "radiogroup"); grid.setAttribute("aria-label", meta.label);
    const n = options.length;
    const cols = Math.min(4, Math.max(1, (meta.cols! | 0) || (n <= 3 ? Math.max(2, n) : n === 4 ? 2 : 3)));
    grid.style.setProperty("--tw-img-cols", String(cols));
    const tile = (v: string, label: string) => { const b = radioButton("tw-image-tile", v, (x) => commit(x)); b.textContent = ""; b.setAttribute("aria-label", label); b.style.backgroundImage = urlCss(v); return b; };
    const tiles = options.map((o, i) => { const b = tile(o.value, o.label || stem(o.value) || `Image ${i + 1}`); grid.append(b); return b; });
    // A value that is none of the options (an upload, or a host-set URL) shows as a last tile, selected. Its URL rides
    // on _twVal only: a data URL is megabytes, and an attribute would hold a second copy.
    const custom: RadioBtn = btn("tw-image-tile tw-image-custom"); custom.setAttribute("role", "radio"); custom.setAttribute("aria-label", "Uploaded image");
    const all = () => (custom.parentNode ? [...tiles, custom] : tiles); // parentNode, not isConnected: a panel not yet in the document has no connected nodes
    render = () => {
      if (value && !tiles.some((b) => b._twVal === value)) { custom._twVal = value; custom.style.backgroundImage = urlCss(value); grid.append(custom); } else custom.remove();
      const btns = all(), stop = Math.max(0, btns.findIndex((b) => b._twVal === value)); // the roving tab stop: the chosen tile, else the first
      btns.forEach((b, k) => { const on = !!value && b._twVal === value; b.dataset.active = String(on); b.setAttribute("aria-checked", String(on)); b.tabIndex = k === stop ? 0 : -1; });
      remove.hidden = !value; // nothing to remove, no button
    };
    grid.addEventListener("keydown", (e) => {
      const btns = all(), i = btns.indexOf(e.target as RadioBtn); if (i < 0) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); commit(""); tiles[0].focus(); return; } // the custom tile leaves with its value, so focus moves first
      const j = navIndex(e.key, i, btns.length, cols); if (j < 0) return;
      e.preventDefault(); if (j !== i) { commit(btns[j]._twVal!); btns[j].focus(); }
    });
    remove.addEventListener("click", () => { commit(""); (upload || tiles[0]).focus(); }); // Remove hides itself: hand focus on, not to the body
    root.append(head, grid);
    if (upload) {
      upload.setAttribute("aria-label", `${meta.label}: upload an image`);
      upload.append(note, txt("span", "tw-image-text", "Upload image"));
      upload.addEventListener("click", () => input.click());
      root.append(upload, input);
      dropZone(root, root);
    }
  }
  render();
  return { el: root, set: (v: string | null | undefined) => { if (v != null && typeof v !== "string") return; commit(v || "", false); }, get: () => value };
}

registerControl("image", createImage);
