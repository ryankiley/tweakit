/* Color & gradient: color picker, gradient editor, image input. */

export const meta = {
  slug: "color-and-gradient",
  title: "Color & gradient",
  nav: "Color & gradient",
  description: "The wide-gamut OKLCH color picker, the gradient editor, the shadow editor, and the image picker, live.",
};

export const intro = `
<p>The color engine is the deepest part of the kit: a wide-gamut <strong>OKLCH</strong>
picker with CSS Color 4 gamut mapping, shared by the color control and the gradient
editor. All four controls on this page are lazy: on the code-split build their
modules load the first time a schema asks for them.</p>`;

export const examples = [
  {
    id: "color",
    title: "Color",
    prose: `<p>Any hex or CSS color-function string is recognized as a shorthand. Hex in, but the picker
      works in OKLCH and can emit hex, <code>rgb()</code>, <code>hsl()</code>, <code>oklch()</code>
      and the other wide-gamut notations (switch the format inside the picker). P3-only colors
      survive instead of clipping. The param is always a CSS-ready string.</p>
      <p>Everything in the picker takes the keyboard: Tab to the plane and arrow it
      (↑/↓ lightness, ←/→ chroma, ⇧ for ×10, Page Up / Page Down for ten lightness steps), the hue
      and alpha strips are sliders (the arrow keys, Home/End), and the channel fields type or
      arrow-step.</p>`,
    css: `
      #ex-color .ex-live { min-height: 200px; transition: background 0.1s; }`,
    run: ({ tweaks, mount }) => {
      const panel = tweaks("Color", {
        tint: "#7C5CFF",   // or { type: "color", value: "oklch(0.65 0.24 295)" }
      });
      mount.append(panel.el);

      const stage = mount.parentElement;   // the box behind the panel
      const apply = (p) => { stage.style.background = p.tint; };
      panel.on(apply);
      panel.ready.then(() => apply(panel.params));
    },
  },
  {
    id: "gradient",
    title: "Gradient",
    prose: `<p>A stop editor: drag stops along the bar (or Tab to one and nudge
      it with the arrow keys), double-click the bar (or the + button) to add, select a stop
      to recolor it with the full picker, Delete (or Backspace) to remove it, down to two. The value is
      <code>{ stops: [{ color, pos }], interpolation, easing }</code>; hand it to
      <code>gradientCss(value, angle?)</code> for the CSS. Stops can be authored in
      <code>oklch()</code> for wide-gamut ramps.</p>
      <p>The ramp blends in whichever color space you pick in the stop editor: switch the mode
      to RGB and the blend goes through sRGB (muddier; that's what <code>rgb()</code> blends
      look like); OKLCH stays perceptually even. That chosen space rides along as
      <code>interpolation</code>, so dropping it into <code>linear-gradient(in …)</code> makes
      your CSS match the preview exactly.</p>
      <p>Beside the mode, <strong>easing</strong>. A gradient blends in a straight line between
      stops, and the eye reads where a straight blend starts and stops as an edge, most
      visibly in a fade to transparent. Pick <code>ease-in-out</code> (or any CSS easing) and
      the ramp eases between each pair of stops instead; it rides along as <code>easing</code>.
      No browser eases a gradient natively, so <code>gradientCss()</code> samples the curve
      into 16 stops per segment, each a <code>color-mix()</code> in the ramp's own blend
      space. <code>gradientStops(value)</code> is the stop list alone, for a conic or radial
      gradient.</p>`,
    css: `
      #ex-gradient .ex-live { min-height: 200px; transition: background 0.15s; }`,
    run: ({ tweaks, gradientCss, mount }) => {
      const panel = tweaks("Gradient", {
        ramp: { type: "gradient", value: { stops: [
          { color: "oklch(0.72 0.19 25)", pos: 0 },
          { color: "oklch(0.86 0.17 95)", pos: 0.5 },
          { color: "oklch(0.72 0.16 280)", pos: 1 },
        ] } },
        angle: [90, 0, 360, 1],
      });
      mount.append(panel.el);

      // gradientCss honors the editor's blend space and expands its easing, so the box
      // behind the panel is the picker's preview at the chosen angle.
      const stage = mount.parentElement;
      const apply = (p) => { stage.style.background = gradientCss(p.ramp, p.angle); };
      panel.on(apply);
      panel.ready.then(() => apply(panel.params));
    },
  },
  {
    id: "shadow",
    title: "Shadow",
    prose: `<p><code>{ type: "shadow" }</code> edits a <code>box-shadow</code>: offset, blur,
      spread, inside or outside, and the color from the same picker, in one popover. The
      param is the fields plus <code>css</code>, the shadow as CSS, so
      <code>el.style.boxShadow = p.lift.css</code> is the whole wiring. Author it as fields
      or as a <code>box-shadow</code> string.</p>
      <p>The pane's preview draws the shadow on the element it's for, scaled down to fit, so it
      reads there as it will on the page. Say how big that element is with <code>size</code>, its width
      in px or <code>[width, height]</code> (in markup, <code>data-size="440,440"</code>): a shadow made
      for a 440px plate then shows as it falls on the plate, where the preview's own 64px card would
      lose a large negative spread altogether. Without <code>size</code>, the card grows from 64px only
      as far as the shadow needs to stay in view, sized as the pane opens and held while you edit.</p>`,
    target: `<div class="sh-card">Card</div>`,
    css: `
      .sh-card { display: grid; place-items: center; width: 150px; height: 100px; border-radius: 18px;
                 background: var(--demo-fill); border: 1px solid var(--demo-line); font-weight: 500;
                 transition: box-shadow 0.15s; }`,
    run: ({ tweaks, mount, target }) => {
      const card = target.querySelector(".sh-card");
      const panel = tweaks("Shadow", {
        lift: {
          type: "shadow", y: 12, blur: 32, spread: -4, color: "rgb(124 92 255 / 0.35)",
          // or the line above as value: "0 12px 32px -4px #7c5cff59"
          size: [150, 100],   // the card's, so the pane previews the shadow on it
        },
      });
      mount.append(panel.el);

      const apply = (p) => { card.style.boxShadow = p.lift.css; };
      panel.on(apply);
      panel.ready.then(() => apply(panel.params));
    },
  },
  {
    id: "image",
    title: "Image",
    prose: `<p><code>{ type: "image" }</code> is a drop zone and file picker in one row; the
      param is a data URL. Give it <code>options</code> (URLs, or <code>{ value, label }</code>)
      and it becomes a gallery: the row names the chosen image and opens a pane of tiles to pick
      from, the upload below them, and Clear, which clears the param to <code>""</code>. An upload stays in the browser and is held to 10 MB
      (<code>maxSize</code>, in bytes). A picture longer than 2560px on its long side is drawn
      down to it first (<code>fit</code>, in px, or <code>false</code> to keep uploads as they are),
      and one over 1.5 MB is redrawn at its size, so a phone photo can't fill storage. A JPEG stays a JPEG at <code>quality</code> 0.85;
      anything else stays a PNG when that comes to 1.5 MB or less, as a screenshot does, so its
      text isn't smudged, and past that is a JPEG, or a WebP when it has transparency. The redraw keeps
      Display P3 where the browser can. A GIF, an SVG, or an animated PNG or WebP is kept as it is, and a JPEG or PNG kept as it
      is loses its Exif and XMP, GPS included, so a photo's location doesn't ride into a save or a paste. An Ultra HDR photo
      keeps the XMP that holds only its gain map, so it stays HDR. <code>upload: false</code> leaves only the tiles,
      <code>clear: false</code> leaves out Clear for a choice that must keep a value, and
      <code>cols</code> sets the tiles per row, up to 6.</p>`,
    target: `<div class="img-tile"><span>Pick a texture, or drop one on the control →</span></div>`,
    css: `
      .img-tile { display: grid; place-items: center; width: 220px; height: 170px; border-radius: 16px;
                  background-color: var(--demo-fill-soft); background-size: cover; background-position: center;
                  background-repeat: no-repeat; background-origin: border-box; /* cover the border too, so no wrapped edge shows */
                  border: 1px solid var(--demo-line); }
      .img-tile span { max-width: 18ch; text-align: center; font-size: 12.5px; color: var(--demo-faint); }`,
    run: ({ tweaks, mount, target }) => {
      const tile = target.querySelector(".img-tile");
      const panel = tweaks("Image", {
        texture: {
          type: "image",
          value: "./textures/dusk.svg",
          options: ["./textures/dusk.svg", "./textures/waves.svg", "./textures/grid.svg", "./textures/dots.svg"],
        },
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
