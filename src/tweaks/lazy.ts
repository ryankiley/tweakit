/* Lazy-control loading — the dynamic-import map behind the code-split build, plus
 * the schema scan that preloads whatever lazy modules a panel (or an enhance pass)
 * needs before it assembles. */
import { getControl } from "./shared.js";
import type { Meta } from "./schema.js";

/** What the preload scan reads off a meta: its type, and the metas nested under it. */
type MetaNode = Pick<Meta, "type" | "children" | "pages">;

// ── Lazy controls — each maps to a dynamic import of its module, which registers
// its constructor(s) into the shared registry on load. ensure() kicks the import
// (deduped); scanTypes walks a schema (into folders + tabs pages) for the lazy
// types it uses, so the panel can preload them before it assembles.
// TW_SPLIT is an esbuild `define`: `true` for the code-split build (each control loads
// on demand via these dynamic imports), `false` for the single-file bundle — where
// single.ts statically imports every control so they self-register, leaving this map
// empty so esbuild drops the import()s and the whole kit inlines, synchronous.
declare const TW_SPLIT: boolean;
const LAZY_IMPORT: Record<string, () => Promise<unknown>> = TW_SPLIT ? {
  number: () => import("./heavy.js"), // the numField engine registers the Number control itself
  interval: () => import("./controls/interval.js"),
  color: () => import("./controls/colour.js"),
  gradient: () => import("./controls/gradient.js"),
  tabs: () => import("./controls/tabs.js"),
  image: () => import("./controls/image.js"),
  fpsgraph: () => import("./controls/monitor.js"),
  monitor: () => import("./controls/monitor.js"),
  spring: () => import("./controls/spring.js"),
  cubicbezier: () => import("./controls/bezier.js"),
  motion: () => Promise.all([import("./controls/bezier.js"), import("./controls/spring.js")]).then(() => import("./controls/motion.js")), // hosts both editors, taken from the registry — and registers last, so a failed editor chunk leaves "motion" unregistered for the next panel to retry rather than registered and unbuildable
  point: () => import("./controls/point.js"),
  plot: () => import("./controls/plot.js"),
} : {};
const loading: Record<string, Promise<unknown>> = {};
const ensure = (type: string) => (getControl(type) || !LAZY_IMPORT[type]) ? null : (loading[type] ||= LAZY_IMPORT[type]().catch((e) => { delete loading[type]; console.error(`[tweaks] control chunk "${type}" failed to load:`, e); throw e; })); // a rejection isn't cached — a later panel retries the chunk
const scanTypes = (metas: MetaNode[], set = new Set<string>()) => {
  for (const m of metas) {
    if (!m) continue;
    if (LAZY_IMPORT[m.type]) set.add(m.type);
    if (m.children) scanTypes(m.children, set);
    if (m.pages) for (const pg of m.pages) scanTypes(pg.children, set);
  }
  return set;
};
// Returns a Promise once all lazy modules a schema needs are loaded, or null if
// none are missing (the synchronous fast path: monolith, or already warmed up).
const ensureForMetas = (metas: MetaNode[]) => {
  const pend = [...scanTypes(metas)].map(ensure).filter(Boolean);
  return pend.length ? Promise.all(pend) : null;
};

export { ensureForMetas, LAZY_IMPORT }; // LAZY_IMPORT is exported for the registry sync test only
