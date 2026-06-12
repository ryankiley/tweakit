// ── Image — drop-zone / file-pick → data URL. Lazy.
import { el, btn, txt, registerControl } from "../shared.js";

// ── Image — a drop-zone / file-pick that returns a data URL, with a thumbnail
// (leva's image input). Drag an image on, or click to choose. ──
function createImage(meta, onChange) {
  let value = meta.value || "";
  const row = el("div", "tw-row tw-image-row");
  const drop = btn("tw-image-drop"); drop.setAttribute("aria-label", `${meta.label}: choose an image`);
  const thumb = el("span", "tw-image-thumb");
  const text = el("span", "tw-image-text");
  drop.append(thumb, text);
  const input = el("input", "tw-image-input"); input.type = "file"; input.accept = "image/*";
  row.append(txt("span", "tw-row-label", meta.label), drop, input);
  const render = () => {
    drop.dataset.set = value ? "true" : "false";
    thumb.style.backgroundImage = value ? `url("${value}")` : "";
    text.textContent = value ? "Replace" : "Drop or choose";
  };
  const load = (file) => { if (!file || !file.type.startsWith("image/")) return; const fr = new FileReader(); fr.onload = () => { value = String(fr.result); render(); onChange(value); }; fr.readAsDataURL(file); };
  drop.addEventListener("click", () => input.click());
  input.addEventListener("change", () => { if (input.files[0]) load(input.files[0]); });
  // The drop affordance is the whole row: a dashed outline shows only while a file is
  // dragged over it (CSS, on [data-over]) — no resting border on the chip. dragover
  // re-asserts each tick, so crossing the label/chip children doesn't drop the state.
  row.addEventListener("dragover", (e) => { e.preventDefault(); row.dataset.over = "true"; });
  row.addEventListener("dragleave", () => { row.dataset.over = "false"; });
  row.addEventListener("drop", (e) => { e.preventDefault(); row.dataset.over = "false"; if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); });
  render();
  return { el: row, set: (v) => { value = v || ""; render(); }, get: () => value };
}

registerControl("image", createImage);

