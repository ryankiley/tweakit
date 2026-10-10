/* Landing page: the name, set large, is the specimen; one panel beside it
 * drives its type, fill, shadow and motion. The docs live on the other pages. */

export const meta = {
  slug: "index",
  title: "Tweakit: a dependency-free, real-time parameter panel",
  nav: "Overview",
  hero: true,
  wide: true,
  description: "A dependency-free, code-split, real-time parameter panel. Hand it a plain schema and it builds a live control for each value.",
};

export const intro = "";

export const examples = [
  {
    id: "specimen",
    noCaption: true,
    foldCode: "The schema behind this pane",
    target: `
      <div class="sp-stage">
        <h1 class="sp-text">Tweakit</h1>
        <p class="sp-about">A dependency-free, code-split, real-time <strong>parameter panel</strong>.
        Hand it a plain schema; it builds a live control for each value: sliders,
        color, curves, springs, and more.</p>
        <div class="hero-meta">
          <span class="hero-pill">No framework</span>
          <span class="hero-pill">{{size-split}} gzip code-split</span>
          <span class="hero-pill">TypeScript types included</span>
        </div>
      </div>`,
    css: `
      /* One grid for the whole example. The pane spans the right; the word, the copy and the
       * schema toggle sit between two equal flexible rows beside it. The schema itself opens in a
       * full-width row under both, so opening it moves nothing above. */
      #ex-specimen { display: grid; grid-template-columns: minmax(0, 1fr) minmax(256px, auto); /* the panel's default --tw-width, or a theme's wider one */
                     grid-template-rows: minmax(0, 1fr) auto auto minmax(0, 1fr) auto; /* zero floor on the spacers, or they pad themselves from the pane */
                     column-gap: clamp(40px, 6vw, 80px); margin: 0; }
      #ex-specimen .ex-live { display: contents; }
      #ex-specimen .ex-target { grid-column: 1; grid-row: 2; min-height: 0; padding: 0; display: block; }
      /* The pane's slot fills the first screen (less the column's 44px top padding and as much
       * below); the run centres the pane in it once, so its top stays put when a folder closes.
       * The stack's flexible rows span the same slot, so the stack centres there too. */
      #ex-specimen .ex-mount { grid-column: 2; grid-row: 1 / 5; align-self: stretch; min-height: calc(100svh - 88px); }
      #ex-specimen .ex-fold { grid-column: 1; grid-row: 3; margin: 26px 0 0; }
      #ex-specimen .ex-fold-body { grid-column: 1 / -1; grid-row: 5; min-width: 0; }
      #ex-specimen .ex-fold-body:not([hidden]) { margin-top: 32px; }
      .sp-stage { display: flex; flex-direction: column; width: 100%; }
      .doc .sp-text { align-self: flex-start; max-width: 100%; line-height: 1;
                      /* the box is trimmed to the caps (below), and a gradient fill only paints inside the
                       * box, so pad it back out over the ascenders and cancel the pad with margins */
                      padding-block: 0.25em; margin: -0.25em 0 calc(30px - 0.25em);
                      text-box: trim-both cap alphabetic; /* the box is the letters: the pane's top meets the cap line */
                      color: var(--demo-ink);
                      font-family: system-ui, -apple-system, sans-serif; font-weight: 300; letter-spacing: -0.04em;
                      text-wrap: balance; overflow-wrap: normal;
                      -webkit-background-clip: text; background-clip: text; transform-origin: 50% 100%; }
      .doc .sp-about { max-width: 52ch; margin: 0; font-size: 16px; }
      .sp-stage .hero-meta { margin-top: 16px; }
      @media (max-width: 1000px) {
        #ex-specimen { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; row-gap: 0; margin-top: 40px; } /* room for the hop under the top bar */
        #ex-specimen .ex-target { grid-row: 1; }
        #ex-specimen .ex-fold { grid-row: 2; margin: 22px 0 0; text-align: center; }
        #ex-specimen .ex-mount { grid-column: 1; grid-row: 3; justify-self: center; margin-top: 32px; min-height: 0; padding-top: 0 !important; }
        #ex-specimen .ex-fold-body { grid-row: 4; }
        #ex-specimen .ex-fold-body:not([hidden]) { margin-top: 24px; }
        .doc .sp-text { align-self: center; text-align: center; }
        .doc .sp-about { margin-inline: auto; text-align: center; }
        .sp-stage .hero-meta { justify-content: center; }
      }`,
    run: ({ tweaks, gradientCss, mount, target }) => {
      const text = target.querySelector(".sp-text");
      const when = (style) => (get) => get("style") === style;   // show a row for one fill style
      const start = Math.max(48, Math.round(target.clientWidth / 3.4)); // most of the column
      const pageColor = () => getComputedStyle(target).color;          // the page's text colour, per theme
      text.style.fontSize = `${start}px`;                               // sized now, not on ready: no jump
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
          bounce: { type: "motion", visualDuration: 0.6, bounce: 0.5 },   // edit it and the word hops on it
        },
        actions: {
          play: { type: "button", label: "Bounce", action: () => hop() },
        },
      });
      mount.append(panel.el);

      const apply = ({ text: { size, weight, tracking }, fill, effects: { shadow } }) => {
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
        s.color = gradient ? "transparent" : fromPage.has(fill.color) ? "" : fill.color; // a colour from the page follows its theme
        // drop-shadow, not text-shadow: a text-shadow paints over the clipped gradient
        s.filter = shadow && !shadow.inset && (shadow.x || shadow.y || shadow.blur)   // a drop-shadow can't be inset
          ? `drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur / 2}px ${shadow.color})`
          : "none";
      };
      let hopping = false, again = false;                  // an edit mid-hop replays it after
      async function hop() {
        if (!text.animate || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        if (hopping) { again = true; return; }
        hopping = true;
        try {
          const { duration, easing } = panel.params.effects.bounce;  // a spring resolves to linear(…)
          // when the spring first reaches the ground: its first stop at or past 1 (the stops are evenly spaced)
          const stops = easing.startsWith("linear(") ? easing.slice(7, -1).split(",").map(Number) : [];
          const at = stops.findIndex((v) => v >= 1), land = duration * (at > 0 ? at / (stops.length - 1) : 1);
          // hop about half the word's height, but never up under the phone's top bar: the room is
          // from the cap line (the box is padded above it) to 64px down, less the 10% stretch
          const cs = getComputedStyle(text), box = text.getBoundingClientRect();
          const room = box.top + parseFloat(cs.paddingTop) - 64 - box.height * 0.1;
          const lift = Math.min(0.45 * parseFloat(cs.fontSize), Math.max(8, room));
          const up = `0 -${lift}px`;
          await text.animate([                             // crouch, then spring up stretched
            { translate: "0 0", scale: "1 1" },
            { translate: "0 0", scale: "1.1 0.88", offset: 0.35 },
            { translate: up, scale: "0.92 1.1" },
          ], { duration: 320, easing: "ease-out" }).finished;
          const fall = text.animate([{ translate: up }, { translate: "0 0" }], { duration, easing });
          const squash = land + 320;                       // squash at impact, then 320 ms to recover
          await Promise.all([fall.finished, text.animate([
            { scale: "0.92 1.1" },
            { scale: "1 1", offset: (land * 0.8) / squash },
            { scale: "1.14 0.84", offset: land / squash, easing: "cubic-bezier(0.3, 1.6, 0.5, 1)" },
            { scale: "1 1" },
          ], { duration: squash }).finished]);
        } catch {} finally {                               // a cancelled run still frees the next one
          hopping = false;
          if (again) { again = false; hop(); }
        }
      }
      panel.on((p, changed) => { apply(p); if (changed === "bounce") hop(); });
      const centre = () => {                                          // the pane at the slot's middle, set once
        mount.style.paddingTop = "0px";
        mount.style.paddingTop = `${Math.max(0, (mount.clientHeight - panel.el.offsetHeight) / 2)}px`;
      };
      const fromPage = new Set();                                     // the page colours the panel has held
      panel.ready.then(() => {                                        // the values exist from here
        fromPage.add(panel.params.fill.color);
        apply(panel.params); centre(); hop();
        window.addEventListener("resize", () => { apply(panel.params); centre(); });
        // the device theme flips: a colour still taken from the page moves to the new one;
        // a colour you picked stays
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
