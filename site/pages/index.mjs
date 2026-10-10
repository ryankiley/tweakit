/* Landing page: the name, set large and editable, is the specimen; one panel beside it
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
        <h1 class="sp-text" contenteditable="plaintext-only" spellcheck="false">Tweakit</h1>
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
      /* One grid for the whole example: the word, the copy and the folded schema stack in the
       * left column, the pane spans the right. The schema's row takes the pane's spare height,
       * so its summary sits right under the chips and the code opens down past the pane. */
      #ex-specimen { display: grid; grid-template-columns: minmax(0, 1fr) 248px; grid-template-rows: auto 1fr;
                     column-gap: clamp(40px, 6vw, 80px); margin: max(6vh, calc(50svh - 340px)) 0 0; } /* near the middle of a tall screen */
      #ex-specimen .ex-live { display: contents; }
      #ex-specimen .ex-target { grid-column: 1; grid-row: 1; min-height: 0; padding: 0; display: block; }
      #ex-specimen .ex-mount { grid-column: 2; grid-row: 1 / span 2; align-self: start; }
      #ex-specimen .ex-fold { grid-column: 1; grid-row: 2; align-self: start; margin: 26px 0 0; min-width: 0; }
      .sp-stage { display: flex; flex-direction: column; width: 100%; }
      .doc .sp-text { align-self: flex-start; max-width: 100%; min-width: 1ch; margin: 0 0 22px;
                      outline: none; color: var(--demo-ink); caret-color: var(--demo-ink);
                      font-family: system-ui, -apple-system, sans-serif;
                      text-wrap: balance; overflow-wrap: normal;
                      -webkit-background-clip: text; background-clip: text; transform-origin: 50% 100%; }
      .doc .sp-about { max-width: 52ch; margin: 0; font-size: 16px; }
      .sp-stage .hero-meta { margin-top: 16px; }
      @media (max-width: 1000px) {
        #ex-specimen { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; row-gap: 32px; margin-top: 8px; }
        #ex-specimen .ex-mount { grid-column: 1; grid-row: 2; justify-self: center; }
        #ex-specimen .ex-fold { grid-row: 3; margin: 0; text-align: center; }
        #ex-specimen .ex-fold .ex-codewrap { text-align: left; }
        .doc .sp-about { margin-inline: auto; text-align: center; }
        .sp-stage .hero-meta { justify-content: center; }
      }`,
    run: ({ tweaks, gradientCss, mount, target }) => {
      const text = target.querySelector(".sp-text");
      const when = (style) => (get) => get("style") === style;   // show a row for one fill style
      const phone = matchMedia("(max-width: 1000px)");         // phones centre the word
      const panel = tweaks("Tweakit", {
        text: {
          size: { type: "slider", label: "Font size", value: Math.max(48, Math.round(target.clientWidth / 3.4)), min: 16, max: 480, step: 1, unit: "px" }, // starts filling most of the column
          weight: [300, 100, 900, 10],
          tracking: { type: "slider", value: -0.04, min: -0.1, max: 0.25, step: 0.005, unit: "em" },
          leading: [1, 0.8, 1.8, 0.01],
          align: { type: "segmented", options: ["left", "center", "right"], value: phone.matches ? "center" : "left" },
        },
        fill: {
          style: { type: "segmented", options: ["solid", "gradient"], value: "solid" },
          color: { type: "color", value: getComputedStyle(text).color || "#1b1b1b", render: when("solid") }, // the page's ink
          gradient: { type: "gradient", stops: [["oklch(0.78 0.19 30)", 0], ["oklch(0.68 0.22 295)", 1]], render: when("gradient") },
          angle: { type: "slider", value: 90, min: 0, max: 360, step: 1, unit: "°", render: when("gradient") },
        },
        effects: {
          shadow: { type: "shadow", y: 6, blur: 20, color: "rgb(0 0 0 / 0.14)" },
          bounce: { type: "motion", visualDuration: 0.6, bounce: 0.5 },   // edit it and the word hops on it
        },
      });
      mount.append(panel.el);

      const apply = ({ text: { size, weight, tracking, leading, align }, fill, effects: { shadow } }) => {
        const s = text.style, gradient = fill.style === "gradient";
        s.fontSize = `${size}px`;
        s.fontWeight = weight;
        s.letterSpacing = `${tracking}em`;
        const over = text.scrollWidth / text.clientWidth;  // a word never breaks: one too wide for the stage shrinks to fit
        if (over > 1) s.fontSize = `${size / over}px`;
        s.lineHeight = leading;
        s.textAlign = align;
        s.alignSelf = { left: "flex-start", center: "center", right: "flex-end" }[align];
        s.backgroundImage = gradient && fill.gradient ? gradientCss(fill.gradient, fill.angle) : "none";
        s.color = gradient ? "transparent" : fill.color;
        // drop-shadow, not text-shadow: a text-shadow paints over the clipped gradient
        s.filter = shadow && (shadow.x || shadow.y || shadow.blur)
          ? `drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur / 2}px ${shadow.color})`
          : "none";
      };
      let hopping = false, again = false;                  // an edit mid-hop replays it after
      async function hop() {
        if (!text.animate || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        if (hopping) { again = true; return; }
        hopping = true;
        const { duration, easing } = panel.params.effects.bounce;  // a spring resolves to linear(…)
        // when the spring first reaches the ground: its first sample at or past 1
        const hit = [...easing.matchAll(/([\d.]+) ([\d.]+)%/g)].find(([, v]) => v >= 1)?.[2] / 100 || 1;
        await text.animate([                               // crouch, then spring up stretched
          { translate: "0 0", scale: "1 1" },
          { translate: "0 0", scale: "1.1 0.88", offset: 0.35 },
          { translate: "0 -0.45em", scale: "0.92 1.1" },
        ], { duration: 320, easing: "ease-out" }).finished;
        text.animate([{ translate: "0 -0.45em" }, { translate: "0 0" }], { duration, easing });
        await text.animate([                               // squash on landing, wobble back
          { scale: "0.92 1.1" },
          { scale: "1 1", offset: hit * 0.8 },
          { scale: "1.14 0.84", offset: hit, easing: "cubic-bezier(0.3, 1.6, 0.5, 1)" },
          { scale: "1 1" },
        ], { duration }).finished;
        hopping = false;
        if (again) { again = false; hop(); }
      }
      panel.on((p, changed) => { apply(p); if (changed === "bounce") hop(); });
      panel.ready.then(() => { apply(panel.params); hop(); });
      phone.addEventListener("change", (e) => {              // follow the breakpoint, unless you picked one
        if (panel.params.text.align === (e.matches ? "left" : "center")) panel.set("text.align", e.matches ? "center" : "left");
      });
      window.addEventListener("resize", () => apply(panel.params));
    },
  },
];
