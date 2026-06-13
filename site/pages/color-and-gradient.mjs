/* Color & gradient — color picker, gradient editor, image input. */

export const meta = {
  slug: "color-and-gradient",
  title: "Color & gradient",
  nav: "Color & gradient",
  description: "The wide-gamut OKLCH color picker, the gradient editor, and the image drop zone — live.",
};

export const intro = `
<p>The color engine is the deepest part of the kit: a wide-gamut <strong>OKLCH</strong>
picker with CSS Color 4 gamut mapping, shared by the color control and the gradient
editor. All three controls on this page are lazy — on the code-split build their
modules load the first time a schema asks for them.</p>`;

export const examples = [
  {
    id: "color",
    title: "Color",
    prose: `<p>Any hex or CSS color-function string is recognized as a shorthand — hex in, but the picker
      works in OKLCH and can emit <code>oklch()</code>, hex, <code>rgb()</code> or
      <code>hsl()</code> (switch the format inside the picker). P3-only colors survive
      instead of clipping. The param is always a CSS-ready string.</p>`,
    target: `
      <div class="col-wrap">
        <svg class="col-blob" viewBox="0 0 200 200" width="170" height="170" aria-hidden="true">
          <path fill="#7C5CFF" d="M86,0C86,77.4 77.4,86 0,86C-77.4,86 -86,77.4 -86,0C-86,-77.4 -77.4,-86 0,-86C77.4,-86 86,-77.4 86,0Z" transform="translate(100 100)"/>
        </svg>
        <code class="col-readout">#7C5CFF</code>
      </div>`,
    css: `
      .col-wrap { display: flex; flex-direction: column; align-items: center; gap: 14px; }
      .col-blob path { transition: fill 0.1s; }
      .col-readout { font-size: 12.5px; color: var(--demo-muted); background: var(--demo-fill);
                     border: 1px solid var(--demo-line); border-radius: 7px; padding: 3px 10px; }`,
    run: ({ tweaks, mount, target }) => {
      const blob = target.querySelector(".col-blob path");
      const readout = target.querySelector(".col-readout");
      const panel = tweaks("Color", {
        tint: "#7C5CFF",   // or { type: "color", value: "oklch(0.65 0.24 295)" }
      });
      mount.append(panel.el);

      const apply = (p) => {
        blob.setAttribute("fill", p.tint);
        readout.textContent = p.tint;
      };
      panel.on(apply);
      panel.ready.then(() => apply(panel.params));
    },
  },
  {
    id: "gradient",
    title: "Gradient",
    prose: `<p>A Figma-style stop editor: drag stops along the bar, double-click the bar
      (or the + button) to add, select a stop to recolor it with the full picker. The value is
      <code>{ stops: [{ color, pos }], interpolation }</code> — ready to template into any CSS
      gradient. Stops can be authored in <code>oklch()</code> for wide-gamut ramps.</p>
      <p>The ramp blends in whichever colour space you pick in the stop editor: switch the mode
      to RGB and the blend goes through sRGB (muddier — that's what <code>rgb()</code> blends
      look like); OKLCH stays perceptually even. That chosen space rides along as
      <code>interpolation</code>, so dropping it into <code>linear-gradient(in …)</code> makes
      your CSS match the preview exactly.</p>`,
    target: `<div class="grad-swatch"></div>`,
    css: `
      .grad-swatch { width: 100%; height: 120px; border-radius: 14px; align-self: center;
                     box-shadow: inset 0 0 0 1px var(--demo-line); }`,
    run: ({ tweaks, mount, target }) => {
      const swatch = target.querySelector(".grad-swatch");
      const panel = tweaks("Gradient", {
        ramp: { type: "gradient", value: { stops: [
          { color: "oklch(0.72 0.19 25)", pos: 0 },
          { color: "oklch(0.86 0.17 95)", pos: 0.5 },
          { color: "oklch(0.72 0.16 280)", pos: 1 },
        ] } },
        angle: [90, 0, 360, 1],
      });
      mount.append(panel.el);

      const apply = (p) => {
        const stops = p.ramp.stops.map((s) => `${s.color} ${s.pos * 100}%`).join(", ");
        const space = p.ramp.interpolation || "oklch"; // honor the editor's blend space so the swatch matches the picker
        swatch.style.background = `linear-gradient(in ${space} ${p.angle}deg, ${stops})`;
      };
      panel.on(apply);
      panel.ready.then(() => apply(panel.params));
    },
  },
  {
    id: "image",
    title: "Image",
    prose: `<p><code>{ type: "image" }</code> is a drop zone and file picker in one row.
      The param is a data URL — drop a file on the control (or click it) and the tile
      picks it up as its background.</p>`,
    target: `<div class="img-tile"><span>Drop an image on the control →</span></div>`,
    css: `
      .img-tile { display: grid; place-items: center; width: 220px; height: 170px; border-radius: 16px;
                  background-color: var(--demo-fill-soft); background-size: cover; background-position: center;
                  border: 1px solid var(--demo-line); }
      .img-tile span { max-width: 18ch; text-align: center; font-size: 12.5px; color: var(--demo-faint); }`,
    run: ({ tweaks, mount, target }) => {
      const tile = target.querySelector(".img-tile");
      const panel = tweaks("Image", {
        texture: { type: "image" },
      });
      mount.append(panel.el);

      const apply = (p) => {
        tile.style.backgroundImage = p.texture ? `url(${p.texture})` : "none";
        tile.querySelector("span").style.opacity = p.texture ? 0 : 1;
      };
      panel.on(apply);
      panel.ready.then(() => apply(panel.params));
    },
  },
];
