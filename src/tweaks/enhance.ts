/* Markup-driven enhancement, core's side: enhance(). The work lives in markup.ts, a lazy chunk of the code-split build that
 * only a page with markup fetches; core lends it what it shares with the panel, as a kit. Importing core binds nothing:
 * the page scan on load is opt-in, in auto.ts (tweakit/auto), so the package can declare core free of side effects. */
import { getMarkup } from "./shared.js";
import { metaFor } from "./schema.js";
import { ensureForMetas, LAZY_IMPORT } from "./lazy.js";
import { createFolder, createControl } from "./controls/basic.js";
import { makeCopyBtn, makeResetBtn, addHintMarker } from "./feedback.js";
import type { MarkupKit } from "./markup.js";

declare const TW_SPLIT: boolean;
const kit: MarkupKit = { metaFor, ensureForMetas, LAZY_IMPORT, createFolder, createControl, makeCopyBtn, makeResetBtn, addHintMarker };

/** Bind every unbound [data-tw] host under `root` (the document by default). */
export function enhance(root: Document | Element = document): Promise<void> {
  const run = getMarkup<MarkupKit>();
  if (run || !TW_SPLIT) return run ? run(root, kit) : Promise.resolve(); // the single-file build registered it on load: synchronous, as ever
  // A chunk that fails to load skips the markup, as a failed control chunk skips its control, instead of rejecting.
  return import("./markup.js").then(() => getMarkup<MarkupKit>()!(root, kit), (e) => console.error("[tweaks] markup chunk failed to load:", e));
}
