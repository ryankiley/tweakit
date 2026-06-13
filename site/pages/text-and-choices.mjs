/* Text & choices — text, checkbox, list, radiogrid. */

export const meta = {
  slug: "text-and-choices",
  title: "Text & choices",
  description: "Tweakit's text input, checkbox, dropdown list and radio grid, each driving a live target.",
};

export const intro = `
<p>Strings, booleans and one-of-N choices. All four of these are built-in controls —
they ship in the core bundle and are live the moment <code>tweaks()</code> returns.</p>`;

export const examples = [
  {
    id: "text",
    title: "Text",
    prose: `<p>A bare string is a text input. The verbose form adds
      <code>placeholder</code>, or <code>rows</code> to turn it into a textarea.</p>`,
    target: `<div class="txt-card"><h3>Synthesizers</h3><p>Voltage in, music out.</p></div>`,
    css: `
      .txt-card { max-width: 260px; padding: 22px 26px; border-radius: 16px;
                  background: var(--demo-fill-soft); border: 1px solid var(--demo-line);
                  overflow-wrap: anywhere; }
      .txt-card h3 { margin: 0 0 6px; font-size: 17px; letter-spacing: -0.01em; color: var(--demo-ink); }
      .txt-card p { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--demo-muted); }`,
    run: ({ tweaks, mount, target }) => {
      const card = target.querySelector(".txt-card");
      const panel = tweaks("Text", {
        headline: "Synthesizers",
        body: { type: "text", value: "Voltage in, music out.", rows: 3,
                placeholder: "Card body…" },
      });
      mount.append(panel.el);

      const apply = (p) => {
        card.querySelector("h3").textContent = p.headline;
        card.querySelector("p").textContent = p.body;
      };
      panel.on(apply);
      apply(panel.params);
    },
  },
  {
    id: "checkbox",
    title: "Checkbox",
    prose: `<p><code>true</code> or <code>false</code> is all it takes. The control
      renders as an inline toggle pill; the param is a plain boolean.</p>`,
    target: `<div class="chk-badge"><span class="chk-dot"></span>Live</div>`,
    css: `
      .chk-badge { display: flex; align-items: center; gap: 10px; padding: 14px 26px; border-radius: 999px;
                   background: var(--demo-fill); border: 1px solid var(--demo-line);
                   color: var(--demo-ink); font-weight: 600; font-size: 15px; transition: filter 0.2s, opacity 0.2s; }
      .chk-dot { width: 10px; height: 10px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 12px #4ade80; }`,
    run: ({ tweaks, mount, target }) => {
      const badge = target.querySelector(".chk-badge");
      const panel = tweaks("Checkbox", {
        enabled: true,
        color: true,
      });
      mount.append(panel.el);

      const apply = (p) => {
        badge.style.opacity = p.enabled ? 1 : 0.25;
        badge.style.filter = p.color ? "none" : "grayscale(1)";
      };
      panel.on(apply);
      apply(panel.params);
    },
  },
  {
    id: "list",
    title: "List",
    prose: `<p>An array of strings is a dropdown. Options can also be
      <code>{ value, label }</code> pairs when the displayed text shouldn't be the value.
      Here the value lands on <code>mix-blend-mode</code>.</p>`,
    target: `<div class="lst-stage"><div class="lst-circle lst-a"></div><div class="lst-circle lst-b"></div></div>`,
    css: `
      .lst-stage { position: relative; width: 220px; height: 170px; }
      .lst-circle { position: absolute; width: 120px; height: 120px; border-radius: 50%; top: 25px; }
      .lst-a { left: 10px; background: #7C5CFF; }
      .lst-b { left: 90px; background: #ff8a5b; }`,
    run: ({ tweaks, mount, target }) => {
      const top = target.querySelector(".lst-b");
      const panel = tweaks("List", {
        blend: ["normal", "screen", "overlay", "multiply", "difference",
                { value: "plus-lighter", label: "add (plus-lighter)" }],
      });
      mount.append(panel.el);

      const apply = (p) => { top.style.mixBlendMode = p.blend; };
      panel.on(apply);
      apply(panel.params);
    },
  },
  {
    id: "radiogrid",
    title: "Radio grid",
    prose: `<p>A single-select laid out as buttons — <code>{ type: "radiogrid" }</code>
      (alias <code>"segmented"</code>) with <code>cols</code> to shape the grid. Nine
      alignment options, three columns, and the value drops straight into
      <code>place-items</code>.</p>`,
    target: `<div class="rg-frame"><div class="rg-chip"></div></div>`,
    css: `
      .rg-frame { display: grid; place-items: center center; width: 220px; height: 180px; padding: 14px;
                  border-radius: 16px; border: 1px dashed var(--demo-line-strong); }
      .rg-chip { width: 44px; height: 44px; border-radius: 12px; background: #7C5CFF;
                 box-shadow: 0 6px 22px var(--demo-shadow); }`,
    run: ({ tweaks, mount, target }) => {
      const frame = target.querySelector(".rg-frame");
      const panel = tweaks("Radio grid", {
        align: { type: "radiogrid", cols: 3, value: "center center", options: [
          { value: "start start", label: "↖" }, { value: "start center", label: "↑" }, { value: "start end", label: "↗" },
          { value: "center start", label: "←" }, { value: "center center", label: "·" }, { value: "center end", label: "→" },
          { value: "end start", label: "↙" }, { value: "end center", label: "↓" }, { value: "end end", label: "↘" },
        ] },
      });
      mount.append(panel.el);

      const apply = (p) => { frame.style.placeItems = p.align; };
      panel.on(apply);
      apply(panel.params);
    },
  },
];
