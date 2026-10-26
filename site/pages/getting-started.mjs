/* Getting started: install, import, first panel, reading values. */

export const meta = {
  slug: "getting-started",
  title: "Getting started",
  description: "Install tweakit, import a build, add the styles, and wire your first live parameter panel.",
};

export const intro = `
<p>Tweakit is a single npm package with no runtime dependencies. Install it,
pick one of the two builds, add the stylesheet, and hand <code>tweaks()</code> a schema.</p>`;

export const examples = [
  {
    title: "Install",
    prose: `<p>From npm. Or, since there's nothing else to install, copy
      <code>dist/tweaks.js</code> and <code>dist/tweaks.css</code> straight into a project
      that has no build step at all.</p>`,
    code: { lang: "sh", text: `npm install tweakit` },
  },
  {
    title: "Import a build",
    prose: `<p>Two entries, one API: the default import is code-split and loads heavy controls on
      first use; <code>/single</code> is the single-file build, self-contained and fully
      synchronous. <a href="./imports.html">Sizes and what loads when →</a></p>`,
    code: `
      import { tweaks } from "tweakit";          // heavy controls load on first use
      // or the single-file build: everything inlined, synchronous
      import { tweaks } from "tweakit/single";`,
  },
  {
    title: "Add the styles",
    prose: `<p>The panel's whole appearance lives in one stylesheet, built entirely on
      <code>--tw-*</code> custom properties (see <a href="./theming.html">Theming</a>).
      Import it through your bundler, or link the file directly.</p>`,
    code: `
      import "tweakit/css";   // bundler
      // or:
      // <link rel="stylesheet" href="node_modules/tweakit/dist/tweaks.css" />`,
  },
  {
    id: "first-panel",
    title: "Your first panel",
    prose: `<p><code>tweaks(name, schema)</code> returns the panel synchronously;
      append <code>panel.el</code> wherever you like. Each schema value becomes a control,
      inferred from its shape.</p>`,
    target: `<div class="gs-chip">Tweak me</div>`,
    css: `
      .gs-chip { padding: 26px 40px; border-radius: 18px; background: #7C5CFF; color: #fff;
                 font-weight: 600; font-size: 17px; letter-spacing: -0.01em;
                 box-shadow: 0 12px 40px var(--demo-shadow); }`,
    run: ({ tweaks, mount, target }) => {
      const chip = target.querySelector(".gs-chip");
      const panel = tweaks("Chip", {
        radius: [18, 0, 60, 1],     // [value, min, max, step] → slider
        visible: true,              // → checkbox
        tint: "#7C5CFF",            // → wide-gamut color picker
      });
      mount.append(panel.el);

      panel.on((p) => {
        chip.style.borderRadius = `${p.radius}px`;
        chip.style.background = p.tint;
        chip.style.opacity = p.visible ? 1 : 0.08;
      });
    },
  },
  {
    id: "reading-values",
    title: "Reading values",
    prose: `<p>Live values sit on <code>panel.params</code>: plain properties, updated in
      place. Subscribe with <code>panel.on(fn)</code>; the callback receives the params bag
      and the key that changed. Move a slider and watch the log.</p>`,
    target: `<pre class="gs-log">Move a control</pre>`,
    css: `
      .gs-log { width: 100%; margin: 0; padding: 14px 16px; border-radius: 10px; background: var(--demo-well);
                border: 1px solid var(--demo-well-line); font-size: 12px; line-height: 1.7; color: var(--demo-well-ink);
                white-space: pre-wrap; word-break: break-all; align-self: stretch; }`,
    run: ({ tweaks, mount, target }) => {
      const log = target.querySelector(".gs-log");
      const panel = tweaks("State", {
        size: [40, 0, 100, 1],
        speed: 1.5,                 // a bare number works too: slider, 0–1 for a value ≤ 1, else 0–3×value
        mode: ["calm", "wild"],
      });
      mount.append(panel.el);

      const unsubscribe = panel.on((params, changed) => {
        log.textContent =
          `changed: ${changed}\n` + JSON.stringify(params, null, 2);
      });
      // call unsubscribe() to stop listening; panel.params stays live either way
    },
  },
  {
    id: "prompts",
    title: "Ask your coding agent",
    prose: `<p>The quickest way in is to describe what you want and let your agent wire it up.
      The guide it reads is <a href="./AGENTS.md">AGENTS.md</a>, which also ships inside the
      package, so an installed copy always matches the installed version. A few prompts to try;
      each one copies. The last takes the JSON the panel's copy button puts on the clipboard,
      pasted under it.</p>`,
    code: [
      { label: "Add controls", lang: "text", text: `
        Add a tweakit panel to this card so I can tune its shadow, corner radius and background
        color live. Keep the shadow's fields in a folder. Bind the values to the card's styles.` },
      { label: "Tune a motion", lang: "text", text: `
        This hover animation uses a spring. Add a tweakit panel with a motion control for the
        spring and a slider for the hover scale, and drive the animation from the panel's values.` },
      { label: "Apply copied values", lang: "text", text: `
        These values were copied from a tweakit panel. Apply them as the new defaults in the
        schema in source, and leave the panel in place.

        { "radius": 22, "shadow.blur": 28, "tint": "oklch(72% 0.14 290)" }` },
    ],
  },
];
