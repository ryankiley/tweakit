/* Landing page: the name, set large, is the specimen; one panel beside it
 * drives its type, fill, shadow and motion. The docs live on the other pages. */
import { codeTabs } from "../code.mjs";
import { installTabs } from "../install.mjs";

export const meta = {
  slug: "index",
  title: "Tweakit: a dependency-free, real-time parameter panel",
  nav: "Overview",
  hero: true,
  wide: true,
  description: "A dependency-free, code-split, real-time parameter panel. Hand it a plain schema and it builds a live control for each value.",
};

export const intro = "";

// Opening the schema: the top spacer is pinned at its closed size (measured just before the
// fold opens) while the pane's slot gives up its height, so the word stays put and the schema
// lands under its toggle. The site's fold handler opens and closes the body; this follows it.
export const script = () => {
  const grid = document.getElementById("ex-specimen"), body = grid.querySelector(".ex-fold-body");
  const desktop = matchMedia("(min-width: 1001px)");          // the phone layout has no top spacer to pin
  let top = "";
  const measure = () => { if (body.hidden) top = desktop.matches ? getComputedStyle(grid).gridTemplateRows.split(" ")[0] : ""; };
  // Capturing on ancestors, so these run before the fold's own handlers in every engine.
  grid.querySelector(".ex-fold").addEventListener("click", measure, true);
  grid.addEventListener("beforematch", measure, true);       // find-in-page opens it the same way
  addEventListener("resize", () => { if (!body.hidden) grid.style.removeProperty("--row-top"); }); // the pin was the old layout's
  new MutationObserver(() => {
    grid.classList.toggle("is-open", !body.hidden);
    if (!body.hidden) { if (top) grid.style.setProperty("--row-top", top); return; }
    grid.style.removeProperty("--row-top");
    dispatchEvent(new Event("resize"));                      // the slot is whole again: the pane re-centers in it
  }).observe(body, { attributes: true, attributeFilter: ["hidden"] });
};

// What the hero says: the page sets it inside the demo, and the Markdown mirror as prose.
const ABOUT = `A dependency-free, code-split, real-time parameter panel. Hand it a plain schema;
  it builds a live control for each value: sliders, color, curves, springs, and more.`;
const PILLS = ["No framework", "{{size-split}} gzip code-split", "TypeScript types included"];

export const md = [
  { prose: `<p>${ABOUT}</p><ul>${PILLS.map((p) => `<li>${p}</li>`).join("")}</ul>` },
  { title: "Install", code: installTabs },
];

export const examples = [
  {
    id: "specimen",
    noCaption: true,
    foldCode: "The schema behind this pane",
    target: `
      <div class="sp-stage">
        <h1 class="sp-text" aria-label="Tweakit">Tweakit</h1>
        <p class="sp-about">${ABOUT}</p>
        <div class="hero-meta">${PILLS.map((p) => `<span class="hero-pill">${p}</span>`).join("")}</div>
        ${codeTabs("install", installTabs, "Install")}
      </div>`,
    css: `
      /* One grid for the whole example. The pane spans the right; the word, the copy and the
       * schema toggle sit between two equal flexible rows beside it. The schema itself opens in a
       * full-width row under both. While it is open the top spacer is pinned at its closed size
       * (--row-top, set by the page's script) and the pane's slot gives up its first-screen
       * height, so the schema opens right under its toggle and nothing above it moves. */
      #ex-specimen { display: grid; grid-template-columns: minmax(0, 1fr) minmax(256px, auto); /* the panel's default --twk-width, or a theme's wider one */
                     grid-template-rows: var(--row-top, minmax(0, 1fr)) auto auto minmax(0, 1fr) auto; /* zero floor on the spacers, or they pad themselves from the pane */
                     column-gap: clamp(40px, 6vw, 80px); margin: 0; }
      #ex-specimen .ex-live { display: contents; }
      #ex-specimen .ex-target { grid-column: 1; grid-row: 2; min-height: 0; padding: 0; display: block; container-type: inline-size; }
      /* The pane's slot fills the first screen (less the column's 44px top padding and as much
       * below); the run centers the pane in it once, so its top stays put when a folder closes.
       * The stack's flexible rows span the same slot, so the stack centers there too. */
      #ex-specimen .ex-mount { grid-column: 2; grid-row: 1 / 5; align-self: stretch; min-height: calc(100svh - 88px); }
      #ex-specimen.is-open .ex-mount { min-height: 0; } /* the pane keeps its padding-top, so it stays put */
      /* Opening and closing the schema never scrolls the page: the browser's scroll anchoring would
       * follow the fold's move on a reopen (measured: +180px in Chromium), so this page opts out of it. */
      html { overflow-anchor: none; }
      #ex-specimen .ex-fold { grid-column: 1; grid-row: 3; margin: 26px 0 0; }
      #ex-specimen .ex-fold-body { grid-column: 1 / -1; grid-row: 5; min-width: 0; }
      #ex-specimen .ex-fold-body:not([hidden]) { margin-top: 32px; }
      .sp-stage { display: flex; flex-direction: column; width: 100%; }
      .doc .sp-text { align-self: flex-start; max-width: 100%; line-height: 1; font-size: max(48px, 100cqi / 3.4); /* the run's start size, before it runs */
                      /* the box is trimmed to the caps (below), and a gradient fill only paints inside the
                       * box, so pad it back out over the ascenders and cancel the pad with margins */
                      padding-block: 0.25em; margin: -0.25em 0 calc(30px - 0.25em);
                      text-box: trim-both cap alphabetic; /* the box is the letters: the pane's top meets the cap line */
                      color: var(--demo-ink);
                      font-family: system-ui, -apple-system, sans-serif; font-weight: 300; letter-spacing: -0.04em;
                      text-wrap: balance; overflow-wrap: normal;
                      white-space: nowrap; -webkit-background-clip: text; background-clip: text; }
      /* a letter for the run: padded past its glyph all round, without moving the line or its
       * neighbors, since a sliced gradient only paints inside the box and tight tracking overhangs it */
      .doc .sp-text span { display: inline-block; box-sizing: content-box; padding: 0.25em 0.1em; margin: -0.25em -0.1em; background-repeat: no-repeat; -webkit-background-clip: text; background-clip: text; }
      .doc .sp-about { max-width: 52ch; margin: 0; font-size: 16px; }
      .sp-stage .hero-meta { margin-top: 16px; }
      .sp-stage .ex-tabs { width: 100%; max-width: 52ch; margin: 28px 0 0; } /* the install line, as wide as the copy */
      @media (max-width: 1000px) {
        #ex-specimen { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; row-gap: 0; margin-top: 40px; } /* room for the ripple under the top bar */
        #ex-specimen .ex-target { grid-row: 1; }
        #ex-specimen .ex-fold { grid-row: 2; margin: 22px 0 0; text-align: center; }
        #ex-specimen .ex-fold-body { grid-row: 3; }
        #ex-specimen .ex-mount { grid-column: 1; grid-row: 4; justify-self: center; margin-top: 32px; min-height: 0; padding-top: 0 !important; }
        #ex-specimen .ex-fold-body:not([hidden]) { margin-top: 24px; }
        .doc .sp-text { align-self: center; text-align: center; }
        .doc .sp-about { margin-inline: auto; text-align: center; }
        .sp-stage .hero-meta { justify-content: center; }
        .sp-stage .ex-tabs { margin-inline: auto; }
        .sp-stage .ex-tablist { justify-content: center; }
      }`,
    run: ({ tweaks, gradientCss, mount, target }) => {
      const text = target.querySelector(".sp-text"), word = text.textContent;
      const when = (style) => (get) => get("style") === style;   // show a row for one fill style
      const start = Math.max(48, Math.round(target.clientWidth / 3.4)); // most of the column
      const pageColor = () => getComputedStyle(target).color;          // the page's text color, per theme
      text.style.fontSize = `${start}px`;                               // the CSS size below, pinned
      const panel = tweaks("Tweakit", {
        text: {
          size: { type: "slider", label: "Font size", value: start, min: 16, max: 480, step: 1, unit: "px" },
          weight: [300, 100, 900, 10],
          tracking: { type: "slider", value: -0.04, min: -0.1, max: 0.25, step: 0.005, unit: "em" },
        },
        fill: {
          style: { type: "segmented", options: ["solid", "gradient"], value: "solid" },
          color: { type: "color", value: pageColor(), render: when("solid") },
          gradient: { type: "gradient", stops: [["oklch(0.78 0.19 30)", 0], ["oklch(0.68 0.22 295)", 1]], render: when("gradient") },
          angle: { type: "slider", value: 90, min: 0, max: 360, step: 1, unit: "°", render: when("gradient") },
        },
        effects: {
          shadow: { type: "shadow", y: 6, blur: 20, color: "rgb(0 0 0 / 0.14)" },
          ripple: { type: "motion", visualDuration: 0.6, bounce: 0.5 },   // edit it and the word ripples on it
        },
        actions: {
          play: { type: "button", label: "Ripple", action: () => ripple() },
        },
      });
      mount.append(panel.el);

      const apply = ({ text: { size, weight, tracking }, fill, effects: { shadow } }) => {
        rest();                                            // a run mid-air is sized for the old word
        const s = text.style, gradient = fill.style === "gradient";
        s.fontSize = `${size}px`;
        s.fontWeight = weight;
        s.letterSpacing = `${tracking}em`;
        // a word never breaks: one too wide for its column shrinks to fit (a few passes, since
        // glyph widths don't scale exactly with size)
        for (let i = 0; i < 4 && text.scrollWidth > text.clientWidth; i++) {
          s.fontSize = `${parseFloat(s.fontSize) * text.clientWidth / text.scrollWidth}px`;
        }
        s.backgroundImage = gradient && fill.gradient ? gradientCss(fill.gradient, fill.angle) : "none";
        s.color = gradient ? "transparent" : fromPage.has(fill.color) ? "" : fill.color; // a color from the page follows its theme
        // drop-shadow, not text-shadow: a text-shadow paints over the clipped gradient
        s.filter = shadow && !shadow.inset && (shadow.x || shadow.y || shadow.blur)   // a drop-shadow can't be inset
          ? `drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur / 2}px ${shadow.color})`
          : "none";
      };
      // The word ripples on the motion row: each letter lifts in turn and settles on the row's curve.
      // The letters are split only for the run, each as wide as it stood so the kerning holds, and a
      // gradient goes on them in slices, since a word's fill can't follow a moved letter.
      let letters = [], fill = "", again = false;          // an edit mid-run replays it after
      const rest = () => {                                 // the plain word back, mid-run or after
        if (!letters.length) return;
        letters.forEach((l) => l.getAnimations().forEach((run) => run.cancel()));
        letters = [];
        text.textContent = word;
        text.style.backgroundImage = fill;
      };
      async function ripple() {
        if (!text.animate) return;
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) {        // a fade, not a ripple
          text.animate([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], { duration: 500, easing: "ease-in-out" });
          return;
        }
        if (letters.length) { again = true; return; }
        const box = text.getBoundingClientRect(), cs = getComputedStyle(text), range = document.createRange();
        const spots = [...word].map((_, i) => {
          range.setStart(text.firstChild, i); range.setEnd(text.firstChild, i + 1);
          return range.getBoundingClientRect();
        });
        fill = text.style.backgroundImage;
        text.textContent = "";
        text.style.backgroundImage = "none";
        letters = spots.map(({ left, right }, i) => {
          const l = document.createElement("span");
          l.textContent = word[i];
          l.style.width = `${(spots[i + 1]?.left ?? right) - left}px`;
          return l;
        });
        text.append(...letters);
        if (fill && fill !== "none") for (const l of letters) {
          const { left, top } = l.getBoundingClientRect();
          l.style.backgroundImage = fill;
          l.style.backgroundSize = `${box.width}px ${box.height}px`;
          l.style.backgroundPosition = `${box.left - left}px ${box.top - top}px`;
        }
        // lift about a third of the word's height, but never up under the phone's sticky top bar
        // (when it shows): the room runs from the cap line (the box is padded above it) to 9px under it
        const bar = document.querySelector(".topbar"), barBottom = bar && bar.offsetHeight ? bar.getBoundingClientRect().bottom : -Infinity;
        const room = box.top + parseFloat(cs.paddingTop) - (barBottom + 9);
        const up = `0 -${Math.min(0.3 * parseFloat(cs.fontSize), Math.max(8, room))}px`;
        const { duration, easing } = panel.params.effects.ripple, rise = 140;
        const runs = letters.map((l, i) => l.animate([
          { translate: "0 0", easing: "ease-out" },
          { translate: up, offset: rise / (rise + duration), easing },
          { translate: "0 0" },
        ], { duration: rise + duration, delay: i * 48 }).finished);
        try { await Promise.all(runs); } catch {}          // a canceled run has already put the word back
        rest();
        if (again) { again = false; ripple(); }
      }
      panel.on((p, changed) => { if (changed === "effects.ripple") ripple(); else apply(p); });
      // The pane at the slot's middle, on its fullest height: measured only while it sits open in
      // the slot (not collapsed, not floated out), so a closed folder or a drag can't shift it.
      let fullHeight = 0;
      const center = () => {
        if (mount.closest(".is-open")) return;                     // the schema is open and the slot shorter for now: stay put
        const inSlot = panel.el.parentElement === mount, open = panel.el.querySelector(".twk-header-toggle")?.getAttribute("aria-expanded") !== "false";
        if (inSlot && open) fullHeight = Math.max(fullHeight, panel.el.offsetHeight);
        mount.style.paddingTop = "0px";
        mount.style.paddingTop = `${Math.max(0, (mount.clientHeight - fullHeight) / 2)}px`;
      };
      const fromPage = new Set();                                     // the page colors the panel has held
      panel.ready.then(() => {                                        // the values exist from here
        fromPage.add(panel.params.fill.color);
        apply(panel.params); center(); ripple();
        setTimeout(center, 400);                                     // again once the folders finish opening
        window.addEventListener("resize", () => { apply(panel.params); center(); });
        // the device theme flips: a color still taken from the page moves to the new one;
        // a color you picked stays
        matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
          if (!fromPage.has(panel.params.fill.color)) return;
          panel.set("fill.color", pageColor());
          fromPage.add(panel.params.fill.color);
          apply(panel.params);
        });
      });
    },
  },
];
