/* Quick tour — the shorthand grammar in one scene, then the verbose escape hatch. */

export const meta = {
  slug: "quick-tour",
  title: "Quick tour",
  description: "The tweakit schema shorthands in two minutes — what each value shape becomes, and the verbose { type } escape hatch.",
};

export const intro = `
<p>The schema is the whole API. Every property becomes a control, inferred from the
<em>shape</em> of its value — no registration, no builders. This page is the grammar.</p>`;

export const examples = [
  {
    id: "scene",
    title: "One schema, one scene",
    prose: `<p>Six values, six different shapes, six controls. Everything driving the
      tile on the left is plain data on <code>panel.params</code>.</p>`,
    target: `<div class="qt-card"><span>Shorthands</span></div>`,
    css: `
      .qt-card { display: grid; place-items: center; width: 140px; height: 140px; border-radius: 22px;
                 background: #7C5CFF; transition: width 0.15s, height 0.15s; }
      .qt-card span { font-weight: 600; font-size: 14px; color: #fff; }`,
    run: ({ tweaks, mount, target }) => {
      const card = target.querySelector(".qt-card");
      const panel = tweaks("Scene", {
        size: [140, 60, 240, 1],   // [value, min, max, step] → slider
        blur: 0,                   // bare number → slider over a sensible range
        caption: "Shorthands",     // string → text input
        show: true,                // boolean → checkbox
        blend: ["normal", "screen", "overlay", "multiply"], // array → list
        glow: "#7C5CFF",           // color string → wide-gamut picker
      });
      mount.append(panel.el);

      const apply = (p) => {
        card.style.width = `${p.size}px`;
        card.style.height = `${p.size}px`;
        card.style.filter = `blur(${p.blur * 24}px)`;
        card.style.mixBlendMode = p.blend;
        card.style.background = p.glow;
        card.style.boxShadow = `0 0 70px ${p.glow}`;
        card.style.opacity = p.show ? 1 : 0.06;
        card.querySelector("span").textContent = p.caption;
      };
      panel.on(apply);
      panel.ready.then(() => apply(panel.params)); // color is lazy on the split build
    },
  },
  {
    title: "The inference table",
    prose: `<p>Everything the inference understands, in one place:</p>
      <table>
        <tr><th>You write</th><th>You get</th><th><code>params</code> value</th></tr>
        <tr><td><code>24</code></td><td>slider over a sensible range</td><td>number</td></tr>
        <tr><td><code>[1.2, 0, 3, 0.1]</code></td><td>slider with min / max / step</td><td>number</td></tr>
        <tr><td><code>[[20, 80], 0, 100]</code></td><td>interval (dual-handle range)</td><td><code>[lo, hi]</code></td></tr>
        <tr><td><code>true</code></td><td>checkbox</td><td>boolean</td></tr>
        <tr><td><code>"Hello"</code></td><td>text input</td><td>string</td></tr>
        <tr><td><code>"#7C5CFF"</code></td><td>wide-gamut color picker</td><td>color string</td></tr>
        <tr><td><code>["a", "b"]</code></td><td>dropdown list</td><td>string</td></tr>
        <tr><td><code>{ action: fn }</code></td><td>button</td><td>—</td></tr>
        <tr><td><code>{ x: 0, y: 10 }</code></td><td>folder (collapsible group)</td><td>nested object</td></tr>
        <tr><td><code>{ type: "…", … }</code></td><td>that control, verbatim</td><td>per control</td></tr>
      </table>
      <p>The <code>{ type }</code> forms unlock everything the shorthands can't say —
      the heavy controls (<a href="./color-and-gradient.html">gradient</a>,
      <a href="./motion.html">spring, cubic-bézier, plot</a>,
      <a href="./monitors.html">monitors</a>…) and per-control options.</p>`,
  },
  {
    id: "verbose",
    title: "The verbose escape hatch",
    prose: `<p>Any control can be written as <code>{ type, … }</code> to reach options the
      shorthand can't express — and every object form accepts <code>render</code>,
      <code>disabled</code> and <code>hint</code> (covered in
      <a href="./panel-api.html">the panel API</a>). Hover the ⓘ beside “Opacity”.</p>`,
    target: `<div class="qt-tile"></div>`,
    css: `
      #ex-verbose .ex-target { overflow: hidden; } /* zoom crops at the frame, like a viewport */
      .qt-tile { width: 160px; height: 160px; border-radius: 18px;
                 background: repeating-conic-gradient(#7C5CFF 0% 12.5%, #2b2440 12.5% 25%);
                 background-position: center; background-repeat: no-repeat; }`,
    run: ({ tweaks, mount, target }) => {
      const tile = target.querySelector(".qt-tile");
      const panel = tweaks("Verbose", {
        opacity: { type: "slider", value: 1, min: 0, max: 1, step: 0.05,
                   hint: "Alpha blend of the tile" },
        zoom: { type: "number", value: 100, min: 25, max: 400, step: 5 },
        fit: { type: "segmented", options: ["cover", "contain", "auto"] },
      });
      mount.append(panel.el);

      const apply = (p) => {
        tile.style.opacity = p.opacity;
        tile.style.transform = `scale(${p.zoom / 100})`;
        tile.style.backgroundSize = p.fit;
      };
      panel.on(apply);
      apply(panel.params); // every control here is built-in → params are live already
    },
  },
];
