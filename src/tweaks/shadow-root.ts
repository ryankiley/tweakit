/* opts.shadow — dresses a panel tweaks() built in a shadow root: the kit's stylesheet in it, a second host on <body> whose
 * root takes its portals (a pane, a hint, the drag guide), and the page's scheme pin and tokens carried across both
 * boundaries. Its own chunk, loaded only by a shadow panel. */
import { el, carryScheme } from "./shared.js";

declare const TW_SPLIT: boolean;
// Once a page: the kit's rules that must live outside any shadow root. A browser ignores @property inside one, and the
// visually hidden live region and clipboard field sit on <body>, where a page with only shadow panels has no tweaks.css.
let pageRules = false;
const PAGE_CSS = '@property --twk-float-gap { syntax: "<length>"; inherits: true; initial-value: -1px; } .twk-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }';
const addPageRules = () => {
  if (pageRules) return; pageRules = true;
  try { const s = new CSSStyleSheet(); s.replaceSync(PAGE_CSS); document.adoptedStyleSheets = [...document.adoptedStyleSheets, s]; } // no <style>: a strict CSP allows a constructed sheet
  catch { const s = el("style"); s.textContent = PAGE_CSS; document.head.append(s); }
};
// The kit's rules as the page already has them (tweakit/css imported or linked), copied once into a sheet every shadow
// root adopts: no download, no unstyled frame, and a bundler's dev server that moves the module can't lose the file.
// Only rules naming the kit (twk-) come along, inside @media and @supports too, so a stylesheet a bundler merged with the
// app's own brings none of the app's. It's this build's when it has the :host copy of the tokens. Null when the page
// has none, or can't share a sheet across roots.
let kitSheet: CSSStyleSheet | null | undefined;
const kitRules = (rules: CSSRuleList): string[] => [...rules].flatMap((r) => {
  if (!r.cssText.includes("twk-")) return [];
  if (r instanceof CSSStyleRule || !("cssRules" in r)) return [r.cssText];
  const inner = kitRules((r as CSSGroupingRule).cssRules);
  return inner.length ? [`${r.cssText.slice(0, r.cssText.indexOf("{"))}{${inner.join("")}}`] : [];
});
const pageKit = () => {
  if (kitSheet !== undefined) return kitSheet;
  kitSheet = null;
  if (typeof CSSStyleSheet !== "function" || !("adoptedStyleSheets" in ShadowRoot.prototype)) return kitSheet;
  const out: string[] = [];
  for (const s of document.styleSheets) { try { out.push(...kitRules(s.cssRules)); } catch {} } // a cross-origin sheet can't be read
  if (out.some((t) => t.startsWith(":host"))) { kitSheet = new CSSStyleSheet(); kitSheet.replaceSync(out.join("\n")); }
  return kitSheet;
};
// tweaks.css in a root: the page's copy when it has one, else a <link> to `href`, by default the file beside this module
// (dist/tweaks.css). A bundler that rewrites `new URL(…, import.meta.url)` copies it as an asset; `shadow: { href }` else.
const styled = (root: ShadowRoot, href: string, done?: () => void) => {
  const kit = pageKit();
  if (kit) { root.adoptedStyleSheets = [...root.adoptedStyleSheets, kit]; done?.(); return; }
  const link = el("link"); link.rel = "stylesheet"; link.href = href;
  if (done) { link.addEventListener("load", done); link.addEventListener("error", () => { console.warn(`[tweaks] shadow: the stylesheet at ${href} didn't load — the panel is unstyled`); done(); }); }
  root.prepend(link);
};

/** Style `host`'s shadow panel and open its portal root; returns the teardown destroy() runs. */
export const dress = (host: HTMLElement & { _twPortal?: ShadowRoot; _twSync?: () => void; _twSlot?: Element }, panel: HTMLElement, opt: boolean | { href?: string } | undefined) => {
  const href = (typeof opt === "object" && opt?.href) || new URL(TW_SPLIT ? "../tweaks.css" : "./tweaks.css", import.meta.url).href;
  addPageRules();
  styled(host.shadowRoot!, href, () => { host.style.visibility = ""; });
  // Portals go to a root of their own on <body>, as a light panel's go to <body>: a transformed or clipping ancestor of
  // the host would otherwise capture their fixed position.
  const portalHost = el("div", "twk-portal-host"), portals = portalHost.attachShadow({ mode: "open" });
  styled(portals, href);
  document.body.append(portalHost);
  host._twPortal = portals;
  // A portal's tokens: the panel's own, which page CSS may have set on the host or an ancestor, written on its root's
  // host each time one opens (carrySkin), so a pane matches its panel; the panel's theme is carried per portal as before.
  host._twSync = () => {
    const cs = getComputedStyle(panel), s = portalHost.style;
    for (let i = 0; i < cs.length; i++) { const k = cs[i]; if (k.startsWith("--twk-")) s.setProperty(k, cs.getPropertyValue(k)); }
  };
  // The scheme pin on the host or an ancestor can't reach in: mirror it onto the panel, and keep it as the page changes.
  // A lifted panel reads it at the slot it left, as a light one carries it on the lift.
  const pin = () => carryScheme(panel, host._twSlot || host);
  pin();
  const obs = typeof MutationObserver === "function" ? new MutationObserver(pin) : null;
  obs?.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-twk-scheme"] });
  return () => { obs?.disconnect(); portalHost.remove(); };
};
