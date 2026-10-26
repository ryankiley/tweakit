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
// it becomes the param, and one within `fit` but heavier than 1.5 MB is redrawn at its size. A JPEG stays a JPEG, at `quality`. Anything else is tried as a PNG first, so a screenshot or text
// isn't smudged, and kept as one up to 1.5 MB: a photo's PNG at 2560px is several times that, while a screenshot's is not.
// (It's weighed by size, not against the JPEG: drawn down, even a screenshot's PNG runs about twice its JPEG.) Past that it
// is a JPEG, or with transparency a WebP where the browser writes one, whichever is smaller than the PNG. An SVG has no
// pixels to fit, and a GIF, an animated WebP or an APNG would keep only its first frame, so they are taken as they are.
// Resolves "" to take the file as it is: it fits and is light, its format is kept, the browser can't decode or draw it, or
// the redraw came out no smaller.
const KEEP = /^image\/(gif|svg\+xml)$/i;
const PNG_BUDGET = 1.5 * MB;
const PNG_SIG = "\x89PNG\r\n\x1a\n";
const ascii = (b: Uint8Array, at: number, s: string) => { for (let k = 0; k < s.length; k++) if (b[at + k] !== s.charCodeAt(k)) return false; return true; };
// The file says it's animated before its first frame: WebP in VP8X's animation flag or an ANIM chunk, a PNG in an acTL
// chunk ahead of its first IDAT. Only chunk headers are read, never the frames.
export const animated = async (file: Blob) => {
  const at = async (i: number, n: number) => new Uint8Array(await file.slice(i, i + n).arrayBuffer());
  const h = await at(0, 21), webp = ascii(h, 0, "RIFF") && ascii(h, 8, "WEBP");
  if (webp && ascii(h, 12, "VP8X") && h[20] & 2) return true;
  if (!webp && !ascii(h, 0, PNG_SIG)) return false;
  for (let i = webp ? 12 : 8, k = 0; k < 64; k++) {
    const c = await at(i, 8); if (c.length < 8) return false;
    const type = String.fromCharCode(...c.subarray(webp ? 0 : 4, webp ? 4 : 8));
    if (type === (webp ? "ANIM" : "acTL")) return true;
    if (webp ? /^(VP8 |VP8L|ANMF)$/.test(type) : type === "IDAT") return false; // the picture has begun
    const n = new DataView(c.buffer).getUint32(webp ? 4 : 0, webp); // a WebP chunk's size is little-endian and padded to even
    i += webp ? 8 + n + (n & 1) : 12 + n;
  }
  return false;
};
// A picture taken as it is keeps its bytes, and a phone's carry where it was taken: Exif's GPS, and XMP, which can repeat
// it. The value is stored and copied as JSON into source, so those blocks are cut from the bytes, losslessly: the ICC
// profile, which carries a wide gamut, and everything else stays. Exif's Orientation decides which way up the picture
// shows, so a turned one gets a bare Exif back holding only that tag. A redraw needs none of this: a canvas writes no Exif.
// Each parser hands back the bytes left, or null to keep the file whole: nothing to cut, or a block it can't read.
const orientation = (t: Uint8Array) => {
  const le = ascii(t, 0, "II"), v = new DataView(t.buffer, t.byteOffset, t.byteLength); if (!le && !ascii(t, 0, "MM")) return null;
  try {
    const ifd = v.getUint32(4, le);
    for (let k = 0, n = v.getUint16(ifd, le); k < n; k++) if (v.getUint16(ifd + 2 + k * 12, le) === 0x112) { const o = v.getUint16(ifd + 10 + k * 12, le); return o > 1 && o <= 8 ? o : 1; }
    return 1;
  } catch { return null; } // an offset past the end
};
// A big-endian TIFF header and one IFD with the one entry: Orientation, a SHORT.
const bareExif = (o: number) => new Uint8Array([77, 77, 0, 42, 0, 0, 0, 8, 0, 1, 1, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]);
type Bytes = Uint8Array<ArrayBuffer>; // what a Blob takes: never a SharedArrayBuffer
const crc32 = (b: Uint8Array) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const jpegCut = (b: Bytes) => {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const out: Bytes[] = []; let i = 2, from = 0, turned = 0;
  for (;;) {
    const m = b[i + 1], end = i + 2 + ((b[i + 2] << 8) | b[i + 3]);
    if (b[i] !== 0xff || m === 0xff || m === 1 || (m >= 0xd0 && m <= 0xd9) || end < i + 4 || end > b.length) return null; // fill bytes or a marker out of place
    if (m === 0xda) break; // start of scan: the picture itself, kept to the end
    const exif = m === 0xe1 && ascii(b, i + 4, "Exif\0");
    if (exif || (m === 0xe1 && ascii(b, i + 4, "http://ns.adobe.com/x"))) { // XMP, and its extension
      const o = exif ? orientation(b.subarray(i + 10, end)) : 1; if (o === null) return null;
      out.push(b.subarray(from, i)); from = end;
      if (o > 1 && !turned++) out.push(new Uint8Array([0xff, 0xe1, 0, 34, 69, 120, 105, 102, 0, 0, ...bareExif(o)]));
    }
    i = end;
  }
  return out.length ? [...out, b.subarray(from)] : null;
};
const pngCut = (b: Bytes) => {
  if (!ascii(b, 0, PNG_SIG)) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), out: Bytes[] = [];
  let i = 8, from = 0, turned = 0;
  for (let type = ""; type !== "IEND"; ) {
    const end = i + 12 > b.length ? Infinity : i + 12 + v.getUint32(i); if (end > b.length) return null;
    type = String.fromCharCode(...b.subarray(i + 4, i + 8));
    // A text chunk is metadata by its keyword: XMP's, or ImageMagick's raw Exif and XMP. Other text stays.
    const key = /^[tiz]TXt$/.test(type) ? String.fromCharCode(...b.subarray(i + 8, Math.min(end - 4, i + 88))).split("\0")[0] : "";
    if (type === "eXIf" || /^(XML:com\.adobe\.xmp|Raw profile type (exif|app1|xmp))$/i.test(key)) {
      const o = type === "eXIf" ? orientation(b.subarray(i + 8, end - 4)) : 1; if (o === null) return null;
      out.push(b.subarray(from, i)); from = end;
      if (o > 1 && !turned++) {
        const c = new Uint8Array(38), cv = new DataView(c.buffer);
        cv.setUint32(0, 26); c.set([101, 88, 73, 102], 4); c.set(bareExif(o), 8); cv.setUint32(34, crc32(c.subarray(4, 34)));
        out.push(c);
      }
    }
    i = end;
  }
  return out.length ? [...out, b.subarray(from)] : null;
};
export const strip = async (file: File): Promise<Blob> => {
  try { const b = new Uint8Array(await file.arrayBuffer()), parts = jpegCut(b) || pngCut(b); return parts ? new Blob(parts, { type: file.type }) : file; } catch { return file; }
};
const hasAlpha = (ctx: CanvasRenderingContext2D, w: number, h: number) => { const d = ctx.getImageData(0, 0, w, h).data; for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true; return false; };
// toBlob encodes off the main thread where the browser can. null when it can't write that type (it hands back a PNG instead).
const encode = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob | null>((r) => c.toBlob((b) => r(b && b.type === type ? b : null), type, q));
const dataUrl = (b: Blob) => new Promise<string>((r, j) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.onerror = j; fr.readAsDataURL(b); });
// A 2D context is sRGB unless asked, and a Display P3 photo (every iPhone's) drawn into it is flattened to sRGB. A P3
// canvas keeps the gamut, and toBlob tags what it writes with the P3 profile. A browser that doesn't know the option
// ignores it and hands back sRGB, as before; one that refuses the value throws, and gets the plain context.
const context = (c: HTMLCanvasElement) => { try { const ctx = c.getContext("2d", { colorSpace: "display-p3" }); if (ctx) return ctx; } catch { /* the plain context */ } return c.getContext("2d"); };
const shrink = async (file: File, fit: number, quality: number): Promise<string> => {
  if (!fit || KEEP.test(file.type) || typeof Image === "undefined" || typeof URL.createObjectURL !== "function") return "";
  let src = "";
  try {
    if (await animated(file)) return "";
    src = URL.createObjectURL(file);
    const img = new Image(); img.src = src; await img.decode();
    const iw = img.naturalWidth, ih = img.naturalHeight, k = Math.min(1, fit / Math.max(iw, ih));
    if (!(iw > 0 && ih > 0) || (k === 1 && file.size <= PNG_BUDGET)) return ""; // within fit and light: a picture already shrunk is never redrawn
    const c = document.createElement("canvas"), w = (c.width = Math.max(1, Math.round(iw * k))), h = (c.height = Math.max(1, Math.round(ih * k)));
    const ctx = context(c); if (!ctx) return "";
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
    // One commit, of the shrunk picture when there is one, else of the file as it is less its metadata: one change event, one save.
    const at = ++gen;
    shrink(file, fit, quality).then(async (url) => {
      if (gen !== at) return;
      if (url) return commit(url);
      const fr = new FileReader();
      fr.onload = () => { if (gen === at) commit(String(fr.result)); };
      fr.onerror = () => say("Couldn't read the file");
      fr.readAsDataURL(await strip(file));
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
  // Both forms are a trigger row with the chosen image's thumb first, as every chip row.
  const row = triggerRow("tw-image", meta.label), root = row.root;
  const thumb = el("span", "tw-trigger-chip tw-image-thumb");
  const paintThumb = () => { thumb.dataset.set = value ? "true" : "false"; thumb.style.backgroundImage = value ? urlCss(value) : ""; };

  if (!options.length) {
    // The plain row: the whole trigger is the target, a click opens the file dialog and the row is also the drop zone.
    row.trigger.removeAttribute("aria-expanded"); // opens a file dialog, not an expandable popover
    row.trigger.setAttribute("aria-label", `${meta.label}: choose an image`);
    const text = el("span", "tw-image-text");
    row.right.append(thumb, note, text);
    root.append(input, live);
    render = () => { paintThumb(); text.textContent = value ? "Replace" : "Drop or choose"; };
    row.trigger.addEventListener("click", () => input.click());
    dropZone(row.trigger, row.trigger);
  } else {
    // The gallery: the row, with the chosen image's name, opens a pane of the tiles, as one radio group, over a foot with
    // the upload button and Clear. The row names the control, so the pane doesn't repeat it. The row and the pane both
    // take a dropped file.
    const name = el("span", "tw-trigger-value"), rowNote = el("span", "tw-image-note");
    row.right.append(thumb, rowNote, name);
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
      paintThumb();
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
