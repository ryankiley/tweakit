/* Markup-driven enhancement, core's side: enhance() and its auto-run on load. The work lives in markup.ts, a lazy chunk of
 * the code-split build that only a page with markup fetches; core lends it what it shares with the panel, as a kit. */
import { getMarkup } from "./shared.js";
import { metaFor, restoreDefault, hasOwn, valueChanged, SPRING_KEYS } from "./schema.js";
import { ensureForMetas, LAZY_IMPORT } from "./lazy.js";
import { createFolder, createControl } from "./controls/basic.js";
import { makeCopyBtn, makeResetBtn, addHintMarker } from "./feedback.js";
import type { MarkupKit } from "./markup.js";

declare const TW_SPLIT: boolean;
const kit: MarkupKit = { metaFor, restoreDefault, hasOwn, valueChanged, SPRING_KEYS, ensureForMetas, LAZY_IMPORT, createFolder, createControl, makeCopyBtn, makeResetBtn, addHintMarker };

/** Bind every unbound [data-tw] host under `root` (the document by default). */
export function enhance(root: Document | Element = document): Promise<void> {
  const run = getMarkup<MarkupKit>();
  if (run || !TW_SPLIT) return run ? run(root, kit) : Promise.resolve(); // the single-file build registered it on load: synchronous, as ever
  // A chunk that fails to load skips the markup, as a failed control chunk skips its control, instead of rejecting.
  return import("./markup.js").then(() => getMarkup<MarkupKit>()!(root, kit), (e) => console.error("[tweaks] markup chunk failed to load:", e));
}

// A page with nothing to bind doesn't fetch the chunk: no [data-tw] host, and no static showcase panel (enhance() wraps one).
if (typeof document !== "undefined") {
  const run = () => { if (document.querySelector('[data-tw], .tw-panel[data-mode="inline"] > .tw-controls')) enhance(document); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
}
