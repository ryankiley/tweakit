// ── Image — a drop zone / file pick that yields a data URL; with `options`, a gallery of supplied URLs over the upload. Lazy.
import { el, txt, btn, icon, optValue, radioButton, navIndex, popover, registerControl } from "../shared.js";
import { triggerRow } from "../heavy.js";
import type { OnChange, RadioBtn } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control } from "../types.js";

// Escape for a CSS string literal: the quote, the backslash and control characters (a raw newline ends a CSS string),
// so a stored `a.png"), url("https://x/p.png` is one broken image, not a second background layer and a fetch.
const cssString = (s: string) => String(s).replace(/[\\"]/g, "\\$&").replace(/[\x00-\x1f\x7f]/g, (c) => "\\" + c.charCodeAt(0).toString(16) + " ");
const urlCss = (s: string) => `url("${cssString(s)}")`;
const MB = 1 << 20;
const size = (n: number) => (n >= MB ? `${Math.round((n / MB) * 10) / 10} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
// A tile's accessible name when its option has no label: the URL's file stem; a data URL has none.
const stem = (url: string) => { if (/^data:/i.test(url)) return ""; const s = url.split(/[?#]/)[0].split("/").pop()!.replace(/\.\w+$/, ""); try { return decodeURIComponent(s); } catch { return s; } };
// Pixels, not bytes, are what make an upload heavy: a phone photo is ~4 MB as a data URL, and storage holds ~5 MB an origin,
// so one upload could keep every value from saving. A picture longer than `fit` on its long side is drawn down to it before
// it becomes the param. A JPEG stays a JPEG, at `quality`. Anything else is tried as a PNG first, so a screenshot or text
// isn't smudged, and kept as one up to 1.5 MB: a photo's PNG at 2560px is several times that, while a screenshot's is not.
// (It's weighed by size, not against the JPEG: drawn down, even a screenshot's PNG runs about twice its JPEG.) Past that it
// is a JPEG, or with transparency a WebP where the browser writes one, whichever is smaller than the PNG. An SVG has no
// pixels to fit and a GIF would lose its animation, so both are taken as they are. Resolves "" to take the file as it is:
// it fits, its format is kept, the browser can't decode or draw it, or the redraw came out no smaller.
const KEEP = /^image\/(gif|svg\+xml)$/i;
const PNG_BUDGET = 1.5 * MB;
const hasAlpha = (ctx: CanvasRenderingContext2D, w: number, h: number) => { const d = ctx.getImageData(0, 0, w, h).data; for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true; return false; };
// toBlob encodes off the main thread where the browser can. null when it can't write that type (it hands back a PNG instead).
const encode = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob | null>((r) => c.toBlob((b) => r(b && b.type === type ? b : null), type, q));
const dataUrl = (b: Blob) => new Promise<string>((r, j) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.onerror = j; fr.readAsDataURL(b); });
const shrink = async (file: File, fit: number, quality: number): Promise<string> => {
  if (!fit || KEEP.test(file.type) || typeof Image === "undefined" || typeof URL.createObjectURL !== "function") return "";
  let src = "";
  try {
    src = URL.createObjectURL(file);
    const img = new Image(); img.src = src; await img.decode();
    const k = fit / Math.max(img.naturalWidth, img.naturalHeight);
    if (!(k < 1)) return ""; // within fit (or no size to read): a picture already shrunk is never redrawn
    const c = document.createElement("canvas"), w = (c.width = Math.max(1, Math.round(img.naturalWidth * k))), h = (c.height = Math.max(1, Math.round(img.naturalHeight * k)));
    const ctx = c.getContext("2d"); if (!ctx) return "";
    ctx.imageSmoothingQuality = "high"; ctx.drawImage(img, 0, 0, w, h);
    const jpeg = /^image\/jpe?g$/i.test(file.type);
    let out = jpeg ? null : await encode(c, "image/png");
    if (!out || out.size > PNG_BUDGET) {
      const alt = await encode(c, !jpeg && hasAlpha(ctx, w, h) ? "image/webp" : "image/jpeg", quality);
      if (alt && (!out || alt.size < out.size)) out = alt;
    }
    return out && out.size < file.size ? await dataUrl(out) : "";
  } catch { return ""; } finally { if (src) URL.revokeObjectURL(src); }
};
const ICON_UPLOAD = icon('<path d="M12 15V4m-4.5 4.5L12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>');

function createImage(meta: Meta, onChange: OnChange): Control {
  let value = typeof meta.value === "string" ? meta.value : "";
  // Options: URLs, or { value, label }; anything but a non-empty string value is skipped, and a repeated URL keeps its first.
  const seen = new Set<string>();
  const options = (Array.isArray(meta.options) ? meta.options : []).map((o) => ({ value: optValue(o), label: o && typeof o === "object" && o.label != null ? String(o.label) : "" })).filter((o): o is { value: string; label: string } => typeof o.value === "string" && !!o.value && !seen.has(o.value) && !!seen.add(o.value));
  const canUpload = meta.upload !== false || !options.length; // the plain row is the upload: there is nothing else to leave
  const canClear = meta.clear !== false; // false: a required choice, with no Clear and no Delete to empty it
  const maxSize = +meta.maxSize! > 0 ? +meta.maxSize! : 10 * MB;
  // A number only: `fit: true` would read as 1 and draw every upload as one pixel.
  const fit = meta.fit === false || meta.fit === 0 ? 0 : typeof meta.fit === "number" && meta.fit >= 1 ? Math.round(meta.fit) : 2560; // false or 0: uploads as they are
  const quality = typeof meta.quality === "number" && meta.quality > 0 && meta.quality <= 1 ? meta.quality : 0.85;
  const input = el("input", "tw-image-input"); input.type = "file"; input.accept = "image/*";
  // A refused file's reason takes the button text's place for a moment. It is spoken from a status region beside the
  // button, not inside it: a button's children are presentational, so a live region there is never read.
  const note = el("span", "tw-image-note"), live = el("span", "tw-image-live"); live.setAttribute("role", "status");
  const notes = [note, live]; // a gallery adds its row's note, so a file refused on the closed row still shows why
  let noteTimer: ReturnType<typeof setTimeout>;
  const say = (msg: string) => { for (const n of notes) n.textContent = msg; clearTimeout(noteTimer); noteTimer = setTimeout(() => { for (const n of notes) n.textContent = ""; }, 2600); };
  // An off-list value's name: its file stem, else what it is. A blob: URL's stem is a UUID, so it counts as an upload.
  const customName = (v: string) => (/^blob:/i.test(v) ? "" : stem(v)) || (/^(data|blob):/i.test(v) ? "Uploaded image" : "Custom image");
  let render: () => void;
  // Every commit bumps gen, so a file read that lands after a tile was picked, a reset or a host set() is dropped.
  let gen = 0;
  const commit = (v: string, fire = true) => { gen++; value = v; render(); if (fire) onChange(value); };
  const load = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return say("Not an image");
    if (file.size > maxSize) return say(`${size(file.size)}, max ${size(maxSize)}`);
    // One commit, of the shrunk picture when there is one: one change event, one save.
    const at = ++gen;
    shrink(file, fit, quality).then((url) => {
      if (gen !== at) return;
      if (url) return commit(url);
      const fr = new FileReader();
      fr.onload = () => { if (gen === at) commit(String(fr.result)); };
      fr.onerror = () => say("Couldn't read the file");
      fr.readAsDataURL(file);
    });
  };
  // `zone` takes the drop and `over` wears [data-over] meanwhile. dragover re-asserts each tick, so crossing the children doesn't drop the outline.
  // A disabled control's root stays hit-testable (only its children go inert), so the zone checks for itself; on the
  // control's root, since the gallery's pane is portaled out of the panel while open.
  const dropZone = (zone: HTMLElement, over: HTMLElement) => {
    const off = () => !!root.closest(".is-disabled");
    zone.addEventListener("dragover", (e) => { if (off()) return; e.preventDefault(); over.dataset.over = "true"; });
    zone.addEventListener("dragleave", () => { over.dataset.over = "false"; });
    zone.addEventListener("drop", (e) => { over.dataset.over = "false"; if (off()) return; e.preventDefault(); load(e.dataTransfer?.files[0]); });
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
    root.append(input, live);
    render = () => {
      thumb.dataset.set = value ? "true" : "false";
      thumb.style.backgroundImage = value ? urlCss(value) : "";
      text.textContent = value ? "Replace" : "Drop or choose";
    };
    row.trigger.addEventListener("click", () => input.click());
    dropZone(row.trigger, row.trigger);
  } else {
    // The gallery: a trigger row with the chosen image's thumb and name opens a pane of the tiles, as one radio group,
    // over a foot with the upload button and Clear. The row names the control, so the pane doesn't repeat it. The row and
    // the pane both take a dropped file.
    const row = triggerRow("tw-image", meta.label); root = row.root;
    const name = el("span", "tw-trigger-value"), rowNote = el("span", "tw-image-note");
    const thumb = el("span", "tw-trigger-chip tw-image-thumb");
    row.right.append(thumb, rowNote, name); // thumb first, as every chip row
    notes.push(rowNote);
    // The pane is the gallery, with no wrapper: its padding and the gaps between tiles and foot are its drag edge.
    const pop = el("div", "tw-color-pop tw-image-pop tw-image-gallery");
    const upload = canUpload ? btn("tw-button tw-image-upload", ICON_UPLOAD) : null;
    const clear = txt("button", "tw-image-clear", "Clear"); clear.type = "button"; clear.setAttribute("aria-label", `${meta.label}: clear the image`);
    // The foot folds like a folder: a row track holds the upload button and a column track holds Clear, so either can
    // ease shut without measuring. Clear folds away when there's nothing to clear; the foot folds when it's empty.
    const foot = el("div", "tw-image-foot"), footRow = el("div", "tw-image-foot-row"), slot = el("div", "tw-image-clear-slot");
    foot.append(footRow); slot.append(clear);
    const grid = el("div", "tw-image-grid"); grid.setAttribute("role", "radiogroup"); grid.setAttribute("aria-label", meta.label);
    const n = options.length;
    const cols = Math.min(6, Math.max(1, (meta.cols! | 0) || (n <= 3 ? Math.max(2, n) : n === 4 ? 2 : 3)));
    grid.style.setProperty("--tw-img-cols", String(cols));
    const tile = (v: string, label: string) => { const b = radioButton("tw-image-tile", v, (x) => commit(x)); b.textContent = ""; b.setAttribute("aria-label", label); b.style.backgroundImage = urlCss(v); return b; };
    const names = options.map((o, i) => o.label || stem(o.value) || `Image ${i + 1}`);
    const tiles = options.map((o, i) => { const b = tile(o.value, names[i]); grid.append(b); return b; });
    // A value that is none of the options (an upload, or a host-set URL) shows as a last tile, selected. Its URL rides
    // on _twVal, not data-value: the inline style already holds one copy of a data URL, and data-value would be a second.
    const custom: RadioBtn = btn("tw-image-tile tw-image-custom"); custom.setAttribute("role", "radio");
    const all = () => (custom.parentNode ? [...tiles, custom] : tiles); // parentNode, not isConnected: a panel not yet in the document has no connected nodes
    render = () => {
      const k = tiles.findIndex((b) => b._twVal === value);
      if (value && k < 0) {
        custom._twVal = value; custom.style.backgroundImage = urlCss(value); custom.setAttribute("aria-label", customName(value));
        if (!custom.parentNode) grid.append(custom); // re-appending an attached node moves it, and a move blurs it
      } else {
        // The focused tile is leaving (undo, a preset, set()): focus moves on first, since removing a focused node blurs
        // it to <body>, and that blur closes the pane.
        if (custom.matches(":focus")) tiles[Math.max(0, k)].focus();
        custom.remove();
      }
      const btns = all(), stop = Math.max(0, btns.findIndex((b) => b._twVal === value)); // the roving tab stop: the chosen tile, else the first
      btns.forEach((b, j) => { const on = !!value && b._twVal === value; b.dataset.active = String(on); b.setAttribute("aria-checked", String(on)); b.tabIndex = j === stop ? 0 : -1; });
      slot.dataset.open = String(!!value); slot.inert = !value; // nothing to clear: Clear folds away, out of the tab order
      foot.dataset.open = String(!!upload || (canClear && !!value)); foot.inert = foot.dataset.open === "false"; // an empty foot folds to nothing
      thumb.dataset.set = value ? "true" : "false";
      thumb.style.backgroundImage = value ? urlCss(value) : "";
      name.textContent = !value ? "None" : k >= 0 ? names[k] : customName(value);
    };
    grid.addEventListener("keydown", (e) => {
      const btns = all(), i = btns.indexOf(e.target as RadioBtn); if (i < 0) return;
      // Focus moves before the commit: the commit can remove the focused tile (the custom one) or hide Clear.
      if (canClear && (e.key === "Delete" || e.key === "Backspace") && !e.altKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); tiles[0].focus(); commit(""); return; } // a modifier+Delete is the panel's reset, not a clear
      const j = navIndex(e.key, i, btns.length, cols); if (j < 0) return;
      e.preventDefault(); if (j !== i) { btns[j].focus(); commit(btns[j]._twVal!); }
    });
    clear.addEventListener("click", () => { (upload || tiles[0]).focus(); commit(""); }); // Clear hides itself: hand focus on first, not to the body
    pop.append(grid, foot);
    root.append(pop, live);
    if (upload) {
      upload.setAttribute("aria-label", `${meta.label}: upload an image`);
      upload.append(note, txt("span", "tw-image-text", "Upload image"));
      upload.addEventListener("click", () => input.click());
      footRow.append(upload); root.append(input);
      dropZone(row.trigger, row.trigger); dropZone(pop, pop);
    }
    if (canClear) footRow.append(slot);
    popover(root, row.trigger, pop, { fallbackH: 220, initialFocus: () => all().find((b) => b.tabIndex === 0) });
  }
  render();
  return { el: root, set: (v: string | null | undefined) => { if (v != null && typeof v !== "string") return; commit(v || "", false); }, get: () => value, note: say };
}

registerControl("image", createImage);
