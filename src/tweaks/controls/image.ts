// ── Image — drop-zone / file-pick → data URL. Lazy.
import { el, triggerRow, registerControl } from "../shared.js";

// ── Image — a drop-zone / file-pick that returns a data URL, with a thumbnail.
// Reuses the modal-trigger row (label left, preview chip right) of color/gradient/
// point, so the WHOLE row is the target — minus the popover: a click opens the file
// dialog and the row is also the drop zone. Drag an image on, or click to choose. No
// inner pill — the thumbnail rides the shared trigger-chip, like the color swatch.
function createImage(meta, onChange) {
  let value = meta.value || "";
  const { root, trigger, right } = triggerRow("tw-image", meta.label);
  trigger.removeAttribute("aria-expanded"); // opens a file dialog, not an expandable popover
  trigger.setAttribute("aria-label", `${meta.label}: choose an image`);
  const text = el("span", "tw-image-text");
  const thumb = el("span", "tw-trigger-chip tw-image-thumb");
  right.append(text, thumb);
  const input = el("input", "tw-image-input"); input.type = "file"; input.accept = "image/*";
  root.append(input);
  const render = () => {
    thumb.dataset.set = value ? "true" : "false";
    thumb.style.backgroundImage = value ? `url("${value}")` : "";
    text.textContent = value ? "Replace" : "Drop or choose";
  };
  const load = (file) => { if (!file || !file.type.startsWith("image/")) return; const fr = new FileReader(); fr.onload = () => { value = String(fr.result); render(); onChange(value); }; fr.readAsDataURL(file); };
  trigger.addEventListener("click", () => input.click());
  input.addEventListener("change", () => { if (input.files[0]) load(input.files[0]); });
  // The drop affordance is the whole row: a dashed outline shows only while a file is
  // dragged over it (CSS, on [data-over]). dragover re-asserts each tick, so crossing
  // the label/chip children doesn't drop the state.
  trigger.addEventListener("dragover", (e) => { e.preventDefault(); trigger.dataset.over = "true"; });
  trigger.addEventListener("dragleave", () => { trigger.dataset.over = "false"; });
  trigger.addEventListener("drop", (e) => { e.preventDefault(); trigger.dataset.over = "false"; if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); });
  render();
  return { el: root, set: (v) => { value = v || ""; render(); }, get: () => value };
}

registerControl("image", createImage);
