/* Landing page — hero + the kitchen-sink demo panel driving a live scene. */

export const meta = {
  slug: "index",
  title: "Tweakability — a dependency-free, real-time parameter panel",
  nav: "Overview",
  hero: true,
  description: "A dependency-free, code-split, real-time parameter panel. Hand it a plain schema and it builds a live control for every value.",
};

export const intro = `
<div class="hero">
  <h1>Tweakability</h1>
  <p>A dependency-free, code-split, real-time <strong>parameter panel</strong>.
  Hand it a plain schema and it builds a live control for every value —
  sliders, toggles, dropdowns, a wide-gamut OKLCH color picker, gradient and
  cubic-bézier editors, a spring tuner, an expression grapher, monitors, a 2D
  point pad, and more. No framework, no runtime dependencies.</p>
  <div class="hero-meta">
    <span class="hero-pill">Zero dependencies</span>
    <span class="hero-pill">No framework</span>
    <span class="hero-pill">~12 KB gzip code-split</span>
    <span class="hero-pill">TypeScript types included</span>
  </div>
</div>`;

export const examples = [
  {
    id: "showcase",
    title: "Schema in, panel out",
    prose: `<p>The panel below is built from the one schema object under it — nothing
      else. Shorthands infer the light controls (<code>[value, min, max, step]</code> →
      slider, <code>[[lo, hi], …]</code> → interval, <code>true</code> → checkbox, a hex
      string → the wide-gamut color picker); the <code>{ type }</code> forms opt into the
      heavy ones. Scrub the sliders, open the popovers, drag it around by the header.</p>`,
    noCaption: true,
    run: ({ tweaks, mount }) => {
      const panel = tweaks("Demo", {
        intensity: [0.65, 0, 1, 0.01],
        range: [[20, 80], 0, 100, 1],
        quality: { type: "segmented", options: ["Low", "Med", "High"], value: "Med" },
        accent: "#7C5CFF",
        origin: { type: "point", pad: true, components: [
          { key: "x", label: "X", value: 0, min: -1, max: 1, step: 0.01 },
          { key: "y", label: "Y", value: 0, min: -1, max: 1, step: 0.01 },
        ] },
        motion: { type: "spring", stiffness: 220, damping: 18, mass: 1 },
        live: true,
        fps: { type: "fpsgraph", label: "FPS" },
      });
      mount.append(panel.el);
    },
  },
  {
    title: "Where next",
    prose: `<ul>
      <li><a href="./getting-started.html">Getting started</a> — install, import, build your first panel.</li>
      <li><a href="./quick-tour.html">Quick tour</a> — the schema shorthands in two minutes.</li>
      <li>Every control, live: <a href="./numbers.html">numbers</a>,
        <a href="./text-and-choices.html">text &amp; choices</a>,
        <a href="./color-and-gradient.html">color &amp; gradient</a>,
        <a href="./motion.html">motion &amp; curves</a>,
        <a href="./monitors.html">monitors</a>,
        <a href="./structure.html">structure</a>.</li>
      <li><a href="./panel-api.html">The panel API</a>, <a href="./theming.html">theming</a>,
        <a href="./markup.html">markup-driven panels</a> and
        <a href="./imports.html">the two builds</a>.</li>
    </ul>
    <p>Inspired by <a href="https://tweakpane.github.io" rel="noopener">Tweakpane</a> and
    <a href="https://github.com/joshpuckett/dialkit" rel="noopener">dialkit</a>. Source on
    <a href="https://github.com/ryankiley/tweakability" rel="noopener">GitHub</a> (MIT).</p>`,
  },
];
