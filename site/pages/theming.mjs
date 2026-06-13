/* Theming — theme option, live setTheme editor, token reference, raw vars, recipes. */

export const meta = {
  slug: "theming",
  title: "Theming",
  description: "Theme tweakit panels: the theme option, live setTheme(), every token, raw --tw-* custom properties, and ready-made recipes.",
};

export const intro = `
<p>The kit's entire appearance runs on <code>--tw-*</code> custom properties; a theme is
just a bag of overrides. Every key is optional — a partial theme moves only what it
names, and everything else keeps the default monochrome look.</p>`;

export const examples = [
  {
    id: "scheme",
    title: "Light & dark",
    prose: `<p>The kit ships both looks. Dark is the default, and panels follow the OS
      to light on their own (<code>prefers-color-scheme</code>) — like this whole site
      does. To pin a subtree, set <code>data-tw-scheme="light"</code> or
      <code>"dark"</code> on any ancestor: forcing beats the OS preference, and portaled
      popovers carry the scheme with them. Flip the segmented control — the panel
      themes itself, whatever your system is set to.</p>`,
    run: ({ tweaks, mount }) => {
      const panel = tweaks("Scheme", {
        scheme: { type: "segmented", options: ["Auto", "Light", "Dark"], value: "Auto" },
        glow: [24, 0, 80, 1],
        tint: "#7C5CFF",
        live: true,
      });
      mount.append(panel.el);

      panel.on((p) => {
        if (p.scheme === "Auto") delete mount.dataset.twScheme;
        else mount.dataset.twScheme = p.scheme.toLowerCase();
      });
    },
  },
  {
    id: "construction",
    title: "Theme at construction",
    prose: `<p>Pass <code>{ theme }</code> as the third argument. Friendly names cover
      the common moves — <code>accent</code> is the big one (the default look is
      deliberately accentless).</p>`,
    run: ({ tweaks, mount }) => {
      const panel = tweaks("Accented", {
        warmth: [0.6, 0, 1, 0.05],
        contrast: [1.1, 0.5, 2, 0.05],
        enabled: true,
      }, {
        theme: { accent: "#7C5CFF", radius: 12 },   // bare numbers are px
      });
      mount.append(panel.el);
    },
  },
  {
    id: "editor",
    title: "Live retheming",
    prose: `<p><code>panel.setTheme(theme)</code> re-themes a mounted panel on the fly —
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
        density: [32, 24, 44, 1],     // row height, px
        back: { type: "button", label: "setTheme(null)", action: () => {
          editor.reset();          // restore the editor's controls first…
          sample.setTheme(null);   // …then drop the override entirely
        } },
      });
      mount.append(editor.el);

      editor.on((t) => sample.setTheme({
        accent: t.accent, base: t.base, radius: t.radius, density: t.density,
      }));
    },
  },
  {
    title: "Every token",
    prose: `<p>The full friendly-name surface (all optional, from the
      <code>Theme</code> type):</p>
      <table>
        <tr><th>Token</th><th>Drives</th></tr>
        <tr><td><code>accent</code></td><td>slider fills, focus rings, active highlights</td></tr>
        <tr><td><code>base</code></td><td>panel background, reused for recessed wells</td></tr>
        <tr><td><code>dropdownBg</code></td><td>popover / dropdown background</td></tr>
        <tr><td><code>surface</code>, <code>surfaceHover</code>, <code>surfaceActive</code></td><td>control surfaces and their interaction steps</td></tr>
        <tr><td><code>border</code>, <code>borderHover</code></td><td>hairline borders</td></tr>
        <tr><td><code>selection</code></td><td>text-selection wash</td></tr>
        <tr><td><code>title</code>, <code>section</code>, <code>text</code>, <code>label</code>, <code>textMuted</code>, <code>textFaint</code>, <code>focus</code></td><td>the text hierarchy</td></tr>
        <tr><td><code>success</code></td><td>copy-confirmation accent</td></tr>
        <tr><td><code>danger</code></td><td>invalid-input accent</td></tr>
        <tr><td><code>shadow</code>, <code>shadowPanel</code>, <code>shadowPanelLifted</code></td><td>popover, panel and floating elevations</td></tr>
        <tr><td><code>font</code></td><td>font stack</td></tr>
        <tr><td><code>fontMono</code></td><td>monospace font stack</td></tr>
        <tr><td><code>radius</code>, <code>density</code></td><td>corner radius and row height — numbers are px</td></tr>
      </table>`,
  },
  {
    id: "raw",
    title: "The raw escape hatch",
    prose: `<p>Any raw <code>--tw-*</code> key passes straight through as a custom
      property (unknown bare names are ignored) — and because the whole kit renders
      from <code>--tw-*</code> variables, plain page CSS works too: set them on any
      ancestor and every panel inside inherits.</p>`,
    code: `
      tweaks("Raw", schema, { theme: {
        accent: "#39d353",
        "--tw-ease-out": "ease-in-out",   // any raw token rides along
      } });

      /* or, in plain CSS — no JS at all: */
      .my-sidebar .tw-panel { --tw-accent: #39d353; --tw-radius: 4px; }`,
  },
  {
    id: "recipes",
    title: "Recipes",
    prose: `<p>Three starting points beyond the default monochrome — each panel below is
      live, built with the theme object printed underneath.</p>`,
    target: `<div class="th-gallery"></div>`,
    noMount: true,
    css: `
      .th-gallery { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; justify-content: center; width: 100%; }
      .th-recipe { width: 230px; flex: none; }`,
    run: ({ tweaks, target }) => {
      const gallery = target.querySelector(".th-gallery");
      // Dark-base recipes carry a full light text-tone set, so titles / labels / toolbar
      // icons aren't dark-on-dark on a light page; the accent stays vivid because the
      // active pill's label is auto-contrasted (--tw-on-accent). Every tone clears WCAG AA.
      const recipes = {
        Daylight: { base: "#f2f1ee", accent: "#5b4dff", dropdownBg: "#ffffff",
                    surface: "rgba(0, 0, 0, 0.05)", surfaceHover: "rgba(0, 0, 0, 0.09)",
                    border: "rgba(0, 0, 0, 0.08)", selection: "rgba(0, 0, 0, 0.15)",
                    title: "#1a1a1a", text: "rgba(0, 0, 0, 0.85)", section: "rgba(0, 0, 0, 0.6)",
                    label: "rgba(0, 0, 0, 0.6)", textMuted: "rgba(0, 0, 0, 0.58)", textFaint: "rgba(0, 0, 0, 0.46)" },
        Terminal: { base: "#0d1117", accent: "#39d353", font: "ui-monospace, Menlo, monospace", radius: 4,
                    surface: "rgba(57, 211, 83, 0.07)", border: "rgba(57, 211, 83, 0.18)",
                    title: "#d6ffe0", text: "rgba(201, 255, 216, 0.92)", section: "rgba(201, 255, 216, 0.78)",
                    label: "rgba(201, 255, 216, 0.72)", textMuted: "rgba(201, 255, 216, 0.64)", textFaint: "rgba(201, 255, 216, 0.5)" },
        Cozy: { base: "#241a14", accent: "#ff8a5b", radius: 16, density: 36,
                surface: "rgba(255, 138, 91, 0.08)", border: "rgba(255, 138, 91, 0.14)",
                title: "#fbeada", text: "rgba(250, 235, 222, 0.92)", section: "rgba(250, 235, 222, 0.76)",
                label: "rgba(250, 235, 222, 0.7)", textMuted: "rgba(250, 235, 222, 0.62)", textFaint: "rgba(250, 235, 222, 0.5)" },
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
