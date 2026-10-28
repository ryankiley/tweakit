/* opts.shadow — dresses a panel tweaks() built in a shadow root: the kit's stylesheet in it, a second host on <body>
 * whose
 * root takes its portals (a pane, a hint, the drag guide), and the page's scheme pin and tokens carried across both
 * boundaries. Its own chunk, loaded only by a shadow panel. */
import { el, carryScheme, requestReflow } from "./shared.js";

declare const TW_SPLIT: boolean;
type Host = HTMLElement & {
  _twPortal?: ShadowRoot;
  _twSync?: () => void;
  _twSlot?: Element;
  _twOn?: (on: boolean) => void;
};
// Once a page: the kit's rules that must live outside any shadow root. A browser ignores @property inside one, and the
// live region, the clipboard field and a lifted panel's slot sit in the page, which a page of shadow panels alone
// doesn't style.
let pageRules = false;
const PAGE_CSS =
  '@property --twk-float-gap { syntax: "<length>"; inherits: true; initial-value: -1px; } .twk-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; } .twk-lift-slot { display: block; flex: none; pointer-events: none; }';
const addPageRules = () => {
  if (pageRules) return;
  pageRules = true;
  // no <style>: a strict CSP allows a constructed sheet
  try {
    const s = new CSSStyleSheet();
    s.replaceSync(PAGE_CSS);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, s];
  } catch {
    const s = el("style");
    s.textContent = PAGE_CSS;
    document.head.append(s);
  }
};
// The kit's rules as the page already has them (tweakit/css imported or linked), copied into a sheet every shadow root
// adopts: no download, and a bundler's dev server that moves the module can't lose the file. A rule comes along when it
// names the kit (twk-): the kit's own, inside @media, @supports and @layer and through @import, and any of the page's
// rules aimed at the kit's classes, which then style a shadow panel too; a rule aimed at the page's own elements
// (`#app button`) can't reach in. A @keyframes block comes whole. It's this build's when it has the :host copy of the
// tokens. Looked for again by each panel until found, so a stylesheet that arrives later is still used.
let kitSheet: CSSStyleSheet | null = null;
const kitRules = (rules: CSSRuleList, found: { host: boolean }): string[] =>
  [...rules].flatMap((r) => {
    if ("styleSheet" in r) {
      try {
        return kitRules((r as CSSImportRule).styleSheet!.cssRules, found);
      } catch {
        return [];
      }
    }
    if (!r.cssText.includes("twk-")) return [];
    // appendRule: a @keyframes, kept whole
    if (r instanceof CSSStyleRule || !("cssRules" in r) || "appendRule" in r) {
      if (r.cssText.startsWith(":host")) found.host = true;
      return [r.cssText];
    }
    const inner = kitRules((r as CSSGroupingRule).cssRules, found);
    return inner.length ? [`${r.cssText.slice(0, r.cssText.indexOf("{"))}{${inner.join("")}}`] : [];
  });
const pageKit = () => {
  if (kitSheet || typeof CSSStyleSheet !== "function" || !("adoptedStyleSheets" in ShadowRoot.prototype))
    return kitSheet;
  const out: string[] = [],
    found = { host: false };
  // a cross-origin sheet can't be read
  for (const s of document.styleSheets) {
    try {
      out.push(...kitRules(s.cssRules, found));
    } catch {}
  }
  if (found.host) {
    kitSheet = new CSSStyleSheet();
    kitSheet.replaceSync(out.join("\n"));
  }
  return kitSheet;
};
// tweaks.css in a root: the page's copy when it has one, else a <link> to `href`, by default the file beside this
// module (dist/tweaks.css). A bundler that rewrites `new URL(…, import.meta.url)` copies it as an asset;
// `shadow: { href }` else.
const styled = (root: ShadowRoot, href: string, done?: () => void) => {
  const kit = pageKit();
  if (kit) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, kit];
    done?.();
    return;
  }
  const link = el("link");
  link.rel = "stylesheet";
  link.href = href;
  if (done) {
    link.addEventListener("load", done);
    link.addEventListener("error", () => {
      console.warn(`[tweaks] shadow: the stylesheet at ${href} didn't load — the panel is unstyled`);
      done();
    });
  }
  root.prepend(link);
};
// The host is a <twk-host>, defined here, so it hears when the page connects and disconnects it: the scheme pin is read
// again where it lands, and a host the page drops without destroy() lets go of its observer and portal root, as a
// light panel's listeners do (onLive). A page that took the name first keeps it, and its panels keep both until
// destroy().
if (typeof customElements !== "undefined" && !customElements.get("twk-host"))
  customElements.define(
    "twk-host",
    class extends HTMLElement {
      connectedCallback() {
        (this as Host)._twOn?.(true);
      }
      disconnectedCallback() {
        (this as Host)._twOn?.(false);
      }
    },
  );

/** Style `host`'s shadow panel and open its portal root; returns the teardown destroy() runs. */
export const dress = (host: Host, panel: HTMLElement, opt: boolean | { href?: string } | undefined) => {
  const href =
    (typeof opt === "object" && opt?.href) ||
    new URL(TW_SPLIT ? "../tweaks.css" : "./tweaks.css", import.meta.url).href;
  addPageRules();
  // Transitions are held while the stylesheet lands, or the panel's first show would animate from its unstyled layout.
  // The controls measured themselves in that layout (a segmented pill, a slider's marks), so they measure again.
  const settle = () => {
    host.style.visibility = "";
    requestReflow();
    requestAnimationFrame(() => requestAnimationFrame(() => host.removeAttribute("data-twk-settling")));
  };
  host.setAttribute("data-twk-settling", "");
  styled(host.shadowRoot!, href, settle);
  // Portals go to a root of their own on <body>, as a light panel's go to <body>: a transformed or clipping ancestor of
  // the host would otherwise capture their fixed position. It's put (back) on <body> whenever a portal asks for it.
  const portalHost = el("div", "twk-portal-host"),
    portals = portalHost.attachShadow({ mode: "open" });
  styled(portals, href);
  Object.defineProperty(host, "_twPortal", {
    configurable: true,
    get: () => {
      if (!portalHost.isConnected) document.body.append(portalHost);
      return portals;
    },
  });
  // A portal's tokens: the panel's own, which page CSS may have set on the host, written on its root's host each time
  // one opens (carrySkin), so a pane matches its panel; what the panel no longer has goes too. The panel's theme is
  // carried per portal as before.
  host._twSync = () => {
    const cs = getComputedStyle(panel),
      s = portalHost.style;
    for (const k of [...s]) if (k.startsWith("--twk-")) s.removeProperty(k);
    for (let i = 0; i < cs.length; i++) {
      const k = cs[i];
      if (k.startsWith("--twk-")) s.setProperty(k, cs.getPropertyValue(k));
    }
  };
  // The scheme pin on the host or an ancestor can't reach in: mirror it onto the panel, and keep it as the page
  // changes.
  // A lifted panel reads it at the slot it left, as a light one carries it on the lift.
  const pin = () => carryScheme(panel, host._twSlot || host);
  const obs = typeof MutationObserver === "function" ? new MutationObserver(pin) : null;
  // A move disconnects and reconnects in one task, so letting go waits a microtask to see whether the host came back.
  host._twOn = (on) => {
    if (on) {
      pin();
      obs?.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-twk-scheme"] });
    } else
      queueMicrotask(() => {
        if (!host.isConnected) {
          obs?.disconnect();
          portalHost.remove();
        }
      });
  };
  host._twOn(host.isConnected);
  return () => {
    host._twOn = undefined;
    obs?.disconnect();
    portalHost.remove();
  };
};
