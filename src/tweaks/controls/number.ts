// ── Number — the shared numField engine in its row chrome: a typeable field with a
// grab handle (drag to scrub), min-anchored rounding, soft support. Lazy: no shorthand
// infers it, so its engine (shared with the boxed fields of the heavy controls) stays
// out of the chunks every basic panel fetches. ──
import { registerControl } from "../shared.js";
import type { OnChange } from "../shared.js";
import { numField } from "../heavy.js";
import type { Meta } from "../schema.js";

registerControl("number", (meta: Meta, onChange?: OnChange) => numField({ ...meta, row: true }, onChange));
