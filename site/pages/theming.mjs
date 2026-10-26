/* Theming: theme option, live setTheme editor, token reference, raw vars, recipes. */

export const meta = {
  slug: "theming",
  title: "Theming",
  description: "Theme tweakit panels: the theme option, live setTheme(), every token, raw --twk-* custom properties, and ready-made recipes.",
};

export const intro = `
<p>The kit's entire appearance runs on <code>--twk-*</code> custom properties; a theme is
just a bag of overrides. Every key is optional: a partial theme moves only what it
names, and everything else keeps the default monochrome look.</p>`;

export const examples = [
  {
    id: "scheme",
    title: "Light & dark",
    prose: `<p>The kit ships both looks. Dark is the default, and panels follow the OS
      to light on their own (<code>prefers-color-scheme</code>), like this whole site
      does. To pin a subtree, set <code>data-twk-scheme="light"</code> or
      <code>"dark"</code> on any ancestor: forcing beats the OS preference, and portaled
      popovers carry the scheme with them. Flip the segmented control and the panel
      themes itself, whatever your system is set to.</p>
      <p>Each color token is a <code>light-dark()</code> pair picked by the panel's
      <code>color-scheme</code>, which needs Chrome and Edge 123, Firefox 120 or Safari 17.5.</p>`,
    run: ({ tweaks, mount }) => {
      const panel = tweaks("Scheme", {
        scheme: { type: "segmented", options: ["Auto", "Light", "Dark"], value: "Auto" },
        glow: [24, 0, 80, 1],
        tint: "#7C5CFF",
        live: true,
      });
      mount.append(panel.el);

      panel.on((p) => {
        if (p.scheme === "Auto") delete mount.dataset.twkScheme;
        else mount.dataset.twkScheme = p.scheme.toLowerCase();
      });
    },
  },
  {
    id: "construction",
    title: "Theme at construction",
    prose: `<p>Pass <code>{ theme }</code> as the third argument, keyed by token, each
      value a CSS value; <code>--twk-accent</code> is the big one (the default look is
      deliberately accentless).</p>`,
    run: ({ tweaks, mount }) => {
      const panel = tweaks("Accented", {
        warmth: [0.6, 0, 1, 0.05],
        contrast: [1.1, 0.5, 2, 0.05],
        enabled: true,
      }, {
        theme: { "--twk-accent": "#7C5CFF", "--twk-radius": "12px" },
      });
      mount.append(panel.el);
    },
  },
  {
    id: "editor",
    title: "Live retheming",
    prose: `<p><code>panel.setTheme(theme)</code> re-themes a mounted panel on the fly,
      and <code>setTheme(null)</code> reverts to the default. Here one tweakit panel
      themes another: the editor on the right drives the sample on the left.</p>`,
    target: `<div class="th-slot"></div>`,
    css: `
      .th-slot { width: 270px; }`,
    run: ({ tweaks, mount, target }) => {
      const sample = tweaks("Sample", {
        glow: [24, 0, 80, 1],
        tint: "#7C5CFF",
        mode: ["soft", "hard"],
        on: true,
      }, { draggable: false });
      target.querySelector(".th-slot").append(sample.el);

      const editor = tweaks("Theme", {
        accent: "#7C5CFF",
        base: "#242424",
        radius: [8, 0, 24, 1],
        density: { type: "slider", value: 32, min: 24, max: 44, unit: "px" },   // row height
        back: { type: "button", label: "setTheme(null)", action: () => {
          editor.reset();          // restore the editor's controls first…
          sample.setTheme(null);   // …then drop the override entirely
        } },
      });
      mount.append(editor.el);

      editor.on((t) => sample.setTheme({
        "--twk-accent": t.accent, "--twk-base": t.base,
        "--twk-radius": t.radius + "px", "--twk-row-height": t.density + "px",
      }));
    },
  },
  {
    title: "Every token",
    prose: `<p>The tokens a theme usually moves (all optional, from the
      <code>Theme</code> type):</p>
      <table>
        <tr><th>Token</th><th>Drives</th></tr>
        <tr><td><code>--twk-accent</code></td><td>slider fills, focus rings, active highlights</td></tr>
        <tr><td><code>--twk-on-accent</code></td><td>text drawn on the accent (active segment, radio label); the primary text tone when unset, so set it with a light accent</td></tr>
        <tr><td><code>--twk-base</code></td><td>panel background, reused for recessed wells</td></tr>
        <tr><td><code>--twk-dropdown-bg</code></td><td>popover / dropdown background</td></tr>
        <tr><td><code>--twk-surface</code>, <code>-hover</code>, <code>-active</code></td><td>control surfaces and their interaction steps</td></tr>
        <tr><td><code>--twk-border</code>, <code>--twk-border-hover</code></td><td>hairline borders</td></tr>
        <tr><td><code>--twk-selection</code></td><td>text-selection wash</td></tr>
        <tr><td><code>--twk-text-root</code>, <code>-section</code>, <code>-primary</code>, <code>-label</code>, <code>-secondary</code>, <code>-tertiary</code>, <code>-focus</code></td><td>the text hierarchy: title, section, values, labels, muted, faint, focus</td></tr>
        <tr><td><code>--twk-success</code>, <code>--twk-danger</code></td><td>copy-confirmation and invalid-input accents</td></tr>
        <tr><td><code>--twk-shadow-dropdown</code>, <code>--twk-shadow-panel</code>, <code>--twk-shadow-panel-lifted</code></td><td>popover, panel and floating elevations</td></tr>
        <tr><td><code>--twk-font-sans</code>, <code>--twk-font-mono</code></td><td>font stacks</td></tr>
        <tr><td><code>--twk-radius</code>, <code>--twk-row-height</code></td><td>corner radius and row height</td></tr>
        <tr><td><code>--twk-width</code></td><td>the panel's width, 256px by default</td></tr>
      </table>`,
  },
  {
    id: "raw",
    title: "Any token, or plain CSS",
    prose: `<p>Any <code>--twk-*</code> key passes straight through as a custom
      property, the ones the table leaves out too; a key that isn't a token is skipped
      with a console warning. And because the whole kit renders from these variables,
      plain page CSS works as well: set them on any ancestor and every panel inside inherits.</p>`,
    code: `
      tweaks("Raw", schema, { theme: {
        "--twk-accent": "#39d353",
        "--twk-ease-out": "ease-in-out",   // any token rides along
      } });

      /* or, in plain CSS, no JS at all: */
      .my-sidebar .twk-panel { --twk-accent: #39d353; --twk-radius: 4px; }`,
  },
  {
    id: "recipes",
    title: "Recipes",
    prose: `<p>Three starting points beyond the default monochrome. Each panel below is
      live, built with the theme object printed underneath.</p>`,
    target: `<div class="th-gallery"></div>`,
    noMount: true,
    css: `
      .th-gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 16px; align-items: start; width: 100%; max-width: 800px; }   /* up to three default-width panels */
      .th-recipe { justify-self: center; width: 100%; max-width: 256px; }
      .th-recipe .twk-panel { --twk-width: 100%; }   /* each fills its column, up to the default width: three across when they fit */`,
    run: ({ tweaks, target }) => {
      const gallery = target.querySelector(".th-gallery");
      // Dark-base recipes carry a full light text-tone set, so titles / labels / toolbar
      // icons aren't dark-on-dark on a light page; each sets the text on its accent, so the
      // active pill's label stays legible. Every tone clears WCAG AA.
      const recipes = {
        Daylight: { "--twk-base": "#f2f1ee", "--twk-accent": "#5b4dff", "--twk-on-accent": "#ffffff", "--twk-dropdown-bg": "#ffffff",
                    "--twk-surface": "rgba(0, 0, 0, 0.05)", "--twk-surface-hover": "rgba(0, 0, 0, 0.09)",
                    "--twk-border": "rgba(0, 0, 0, 0.08)", "--twk-selection": "rgba(0, 0, 0, 0.15)",
                    "--twk-text-root": "#1a1a1a", "--twk-text-primary": "rgba(0, 0, 0, 0.85)", "--twk-text-section": "rgba(0, 0, 0, 0.6)",
                    "--twk-text-label": "rgba(0, 0, 0, 0.6)", "--twk-text-secondary": "rgba(0, 0, 0, 0.58)", "--twk-text-tertiary": "rgba(0, 0, 0, 0.46)" },
        Terminal: { "--twk-base": "#0d1117", "--twk-accent": "#39d353", "--twk-on-accent": "#161616",
                    "--twk-font-sans": "ui-monospace, Menlo, monospace", "--twk-radius": "4px",
                    "--twk-surface": "rgba(57, 211, 83, 0.07)", "--twk-border": "rgba(57, 211, 83, 0.18)",
                    "--twk-text-root": "#d6ffe0", "--twk-text-primary": "rgba(201, 255, 216, 0.92)", "--twk-text-section": "rgba(201, 255, 216, 0.78)",
                    "--twk-text-label": "rgba(201, 255, 216, 0.72)", "--twk-text-secondary": "rgba(201, 255, 216, 0.64)", "--twk-text-tertiary": "rgba(201, 255, 216, 0.5)" },
        Cozy: { "--twk-base": "#241a14", "--twk-accent": "#ff8a5b", "--twk-on-accent": "#161616", "--twk-radius": "16px", "--twk-row-height": "36px",
                "--twk-surface": "rgba(255, 138, 91, 0.08)", "--twk-border": "rgba(255, 138, 91, 0.14)",
                "--twk-text-root": "#fbeada", "--twk-text-primary": "rgba(250, 235, 222, 0.92)", "--twk-text-section": "rgba(250, 235, 222, 0.76)",
                "--twk-text-label": "rgba(250, 235, 222, 0.7)", "--twk-text-secondary": "rgba(250, 235, 222, 0.62)", "--twk-text-tertiary": "rgba(250, 235, 222, 0.5)" },
      };
      for (const [name, theme] of Object.entries(recipes)) {
        const slot = document.createElement("div");
        slot.className = "th-recipe";
        gallery.append(slot);
        const panel = tweaks(name, {
          level: [60, 0, 100, 1],
          mode: ["auto", "manual"],
          on: true,
        }, { theme, draggable: false });
        slot.append(panel.el);
      }
    },
  },
];
