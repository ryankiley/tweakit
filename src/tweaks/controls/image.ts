// ── Image — drop-zone / file-pick → data URL. Lazy.
import { el, registerControl } from "../shared.js";
import { triggerRow } from "../heavy.js";
import type { OnChange } from "../shared.js";
import type { Meta } from "../schema.js";
import type { Control } from "../types.js";

// The trigger row is the whole target: a click opens the file dialog and the row is also the drop zone.
// Escape for a CSS string literal: the quote, the backslash and control characters (a raw newline ends a CSS string),
// so a stored `a.png"), url("https://x/p.png` is one broken image, not a second background layer and a fetch.
const cssString = (s: string) => String(s).replace(/[\\"]/g, "\\$&").replace(/[\x00-\x1f\x7f]/g, (c) => "\\" + c.charCodeAt(0).toString(16) + " ");
function createImage(meta: Meta, onChange: OnChange): Control {
  let value: string = meta.value || "";
  const { root, trigger, right } = triggerRow("tw-image", meta.label);
  trigger.removeAttribute("aria-expanded"); // opens a file dialog, not an expandable popover
  trigger.setAttribute("aria-label", `${meta.label}: choose an image`);
  const text = el("span", "tw-image-text");
  const thumb = el("span", "tw-trigger-chip tw-image-thumb");
  right.append(thumb, text); // thumb first, as every chip row
  const input = el("input", "tw-image-input"); input.type = "file"; input.accept = "image/*";
  root.append(input);
  const render = () => {
    thumb.dataset.set = value ? "true" : "false";
    thumb.style.backgroundImage = value ? `url("${cssString(value)}")` : "";
    text.textContent = value ? "Replace" : "Drop or choose";
  };
  const load = (file: File | undefined) => { if (!file || !file.type.startsWith("image/")) return; const fr = new FileReader(); fr.onload = () => { value = String(fr.result); render(); onChange(value); }; fr.readAsDataURL(file); };
  trigger.addEventListener("click", () => input.click());
  input.addEventListener("change", () => { if (input.files[0]) load(input.files[0]); });
  // dragover re-asserts each tick, so crossing the label/chip children doesn't drop the [data-over] outline.
  trigger.addEventListener("dragover", (e) => { e.preventDefault(); trigger.dataset.over = "true"; });
  trigger.addEventListener("dragleave", () => { trigger.dataset.over = "false"; });
  trigger.addEventListener("drop", (e) => { e.preventDefault(); trigger.dataset.over = "false"; if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); });
  render();
  return { el: root, set: (v: string | null | undefined) => { if (v != null && typeof v !== "string") return; value = v || ""; render(); }, get: () => value };
}

registerControl("image", createImage);
