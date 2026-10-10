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
      #ex-specimen { margin-bottom: 0; }
      #ex-specimen .ex-live { min-height: calc(100svh - 150px); margin: 0; padding: 0;
                              border: none; background: none; box-shadow: none; }
      #ex-specimen .ex-target { container-type: inline-size; padding: 0; }
      #ex-specimen .ex-mount { align-self: center; }
      .sp-stage { display: flex; flex-direction: column; width: 100%; }
      .doc .sp-text { align-self: flex-start; max-width: 100%; min-width: 1ch; margin: 0 0 22px;
                      outline: none; color: var(--demo-ink); caret-color: var(--demo-ink);
                      font-family: system-ui, -apple-system, sans-serif;
                      text-wrap: balance; overflow-wrap: anywhere;
                      -webkit-background-clip: text; background-clip: text; }
      .doc .sp-about { max-width: 52ch; margin: 0; font-size: 16px; }
      .sp-stage .hero-meta { margin-top: 18px; }
      @media (max-width: 1000px) { #ex-specimen .ex-live { min-height: 0; gap: 36px; } }`,
    run: ({ tweaks, gradientCss, mount, target }) => {
      const text = target.querySelector(".sp-text");
      const when = (mode) => (get) => get("mode") === mode;   // show a row for one fill mode
      const panel = tweaks("Tweakit", {
        size: { type: "slider", value: 20, min: 4, max: 30, step: 0.25, unit: "cqi" },
        weight: [300, 100, 900, 10],
        tracking: { type: "slider", value: -0.04, min: -0.1, max: 0.25, step: 0.005, unit: "em" },
        leading: [1, 0.8, 1.8, 0.01],
        align: { type: "segmented", options: ["left", "center", "right"], value: "left" },
        fill: {
          mode: { type: "segmented", options: ["ink", "gradient"], value: "gradient" },
          ink: { type: "color", value: "#7C5CFF", render: when("ink") },
          ramp: { type: "gradient", stops: [["oklch(0.78 0.19 30)", 0], ["oklch(0.68 0.22 295)", 1]], render: when("gradient") },
          angle: { type: "slider", value: 90, min: 0, max: 360, step: 1, unit: "°", render: when("gradient") },
        },
        shadow: { type: "shadow", y: 10, blur: 30, color: "rgb(124 92 255 / 0.35)" },
        motion: { type: "motion", visualDuration: 0.5, bounce: 0.35 },
        actions: {
          bounce: { type: "button", label: "Bounce", action: () => bounce() },
        },
      });
      mount.append(panel.el);

      const apply = ({ size, weight, tracking, leading, align, fill, shadow }) => {
        const s = text.style, gradient = fill.mode === "gradient";
        s.fontSize = `${size}cqi`;
        s.fontWeight = weight;
        s.letterSpacing = `${tracking}em`;
        s.lineHeight = leading;
        s.textAlign = align;
        s.alignSelf = { left: "flex-start", center: "center", right: "flex-end" }[align];
        s.backgroundImage = gradient && fill.ramp ? gradientCss(fill.ramp, fill.angle) : "none";
        s.color = gradient ? "transparent" : fill.ink;
        // drop-shadow, not text-shadow: a text-shadow paints over the clipped gradient
        s.filter = shadow && (shadow.x || shadow.y || shadow.blur)
          ? `drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur / 2}px ${shadow.color})`
          : "none";
      };
      function bounce() {
        const { duration, easing } = panel.params.motion;  // a spring resolves to linear(…)
        text.animate([{ transform: "scale(0.9)" }, { transform: "none" }], { duration, easing });
      }
      panel.on(apply);
      panel.ready.then(() => apply(panel.params));
    },
  },
];
