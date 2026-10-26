/* Lazy-control loading — the dynamic-import map behind the code-split build, plus the schema
 * scan that preloads what a panel needs before it assembles. */
import { getControl } from "./shared.js";
import type { Meta } from "./schema.js";

/** What the preload scan reads off a meta. */
type MetaNode = Pick<Meta, "type" | "children" | "pages">;

// ── Lazy controls — each import registers its constructor(s) into the shared registry ──
// TW_SPLIT is an esbuild `define`: `false` for the single-file bundle, where single.ts imports
// every control statically, so this map is empty and esbuild drops the import()s.
declare const TW_SPLIT: boolean;
const LAZY_IMPORT: Record<string, () => Promise<unknown>> = TW_SPLIT ? {
  number: () => import("./heavy.js"), // heavy.js registers the Number control itself
  interval: () => import("./controls/interval.js"),
  color: () => import("./controls/color.js"),
  gradient: () => import("./controls/gradient.js"),
  shadow: () => import("./controls/shadow.js"),
  sides: () => import("./controls/sides.js"),
  tabs: () => import("./controls/tabs.js"),
  image: () => import("./controls/image.js"),
  fpsgraph: () => import("./controls/monitor.js"),
  monitor: () => import("./controls/monitor.js"),
  spring: () => import("./controls/spring.js"),
  cubicbezier: () => import("./controls/bezier.js"),
  // motion registers last, so a failed editor chunk leaves it unregistered for the next panel to retry.
  motion: () => Promise.all([import("./controls/bezier.js"), import("./controls/spring.js")]).then(() => import("./controls/motion.js")),
  point: () => import("./controls/point.js"),
  plot: () => import("./controls/plot.js"),
} : {};
const loading: Record<string, Promise<unknown>> = {};
const ensure = (type: string) => (getControl(type) || !LAZY_IMPORT[type]) ? null : (loading[type] ||= LAZY_IMPORT[type]().catch((e) => { delete loading[type]; console.error(`[tweaks] control chunk "${type}" failed to load:`, e); throw e; })); // a rejection isn't cached, so a later panel retries
const scanTypes = (metas: MetaNode[], set = new Set<string>()) => {
  for (const m of metas) {
    if (!m) continue;
    if (LAZY_IMPORT[m.type]) set.add(m.type);
    if (m.children) scanTypes(m.children, set);
    if (m.pages) for (const pg of m.pages) scanTypes(pg.children, set);
  }
  return set;
};
const ensureForMetas = (metas: MetaNode[]) => {
  const pend = [...scanTypes(metas)].map(ensure).filter(Boolean);
  return pend.length ? Promise.all(pend) : null;
};

export { ensureForMetas, LAZY_IMPORT }; // LAZY_IMPORT is exported for the registry sync test only
