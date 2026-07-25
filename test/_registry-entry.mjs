/* Test-only bundle entry for the registry sync test: the dispatch tables, the lazy
 * map, and the live registry with the core (basic) controls registered — bundled in
 * split mode (TW_SPLIT=true) so LAZY_IMPORT is populated. */
export { metaFor, TYPED_META, DATA_VALUE, VALUELESS } from "../src/tweaks/schema.js";
export { LAZY_IMPORT } from "../src/tweaks/lazy.js";
export { getControl } from "../src/tweaks/shared.js";
import "../src/tweaks/controls/basic.js"; // registers the core set; lazy modules stay unloaded
