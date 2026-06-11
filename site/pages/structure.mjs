/* Structure — folder, tabs, button, buttongroup, separator. */

export const meta = {
  slug: "structure",
  title: "Structure",
  description: "Organising a panel: folders, tabs, buttons, button groups and separators — live.",
};

export const intro = `
<p>Past a handful of controls, a flat panel stops scanning. Folders and tabs group;
buttons and separators punctuate. Folders, buttons, button groups and separators are
built in; tabs load lazily.</p>`;

export const examples = [
  {
    id: "folder",
    title: "Folder",
    prose: `<p>Any nested plain object becomes a collapsible folder, and its children
      land on <code>params</code> as a nested object — here the whole
      <code>shadow</code> folder composes one <code>box-shadow</code>. Folders nest
      arbitrarily deep.</p>`,
    target: `<div class="fld-card">Stacked</div>`,
    css: `
      #ex-folder .ex-target { min-height: 300px; } /* headroom so big shadows fade, not clip */
      .fld-card { display: grid; place-items: center; width: 150px; height: 150px; border-radius: 20px;
                  background: #2a2a2e; color: #ededed; font-weight: 600;
                  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5); }`,
    run: ({ tweaks, mount, target }) => {
      const card = target.querySelector(".fld-card");
      const panel = tweaks("Folder", {
        label: "Stacked",
        shadow: {                    // nested object → folder
          x: [0, -40, 40, 1],
          y: [12, -40, 40, 1],
          blur: [32, 0, 90, 1],
          alpha: [0.5, 0, 1, 0.01],
        },
      });
      mount.append(panel.el);

      const apply = (p) => {
        card.textContent = p.label;
        card.style.boxShadow = `${p.shadow.x}px ${p.shadow.y}px ${p.shadow.blur}px rgba(0, 0, 0, ${p.shadow.alpha})`;
      };
      panel.on(apply);
      apply(panel.params);
    },
  },
  {
    id: "tabs",
    title: "Tabs",
    prose: `<p><code>{ type: "tabs", pages: { … } }</code> splits a panel into pages —
      each page is just another schema. Params nest by page:
      <code>params.look.fill.color</code>, <code>params.look.stroke.width</code>.</p>`,
    target: `
      <svg class="tab-shape" viewBox="0 0 200 200" width="180" height="180" aria-hidden="true">
        <path d="M100 14 L186 100 L100 186 L14 100 Z" fill="#7C5CFF" fill-opacity="1"
              stroke="#ffffff" stroke-width="2" stroke-dasharray="0" stroke-linejoin="round"/>
      </svg>`,
    run: ({ tweaks, mount, target }) => {
      const shape = target.querySelector(".tab-shape path");
      const panel = tweaks("Tabs", {
        look: { type: "tabs", pages: {
          Fill: { color: "#7C5CFF", opacity: [1, 0, 1, 0.01] },
          Stroke: { color: "#FFFFFF", width: [2, 0, 14, 1], dashed: false },
        } },
      });
      mount.append(panel.el);

      const apply = (p) => {
        shape.setAttribute("fill", p.look.fill.color);
        shape.setAttribute("fill-opacity", p.look.fill.opacity);
        shape.setAttribute("stroke", p.look.stroke.color);
        shape.setAttribute("stroke-width", p.look.stroke.width);
        shape.setAttribute("stroke-dasharray", p.look.stroke.dashed ? "10 8" : "0");
      };
      panel.on(apply);
      panel.ready.then(() => apply(panel.params)); // tabs (and colour) load lazily
    },
  },
  {
    id: "actions",
    title: "Button, button group & separator",
    prose: `<p>A bare <code>{ action: fn }</code> is a button; <code>buttongroup</code>
      packs several into one row; <code>{ type: "separator" }</code> draws the line
      between concerns. Buttons don't produce params — they just fire.</p>`,
    target: `<div class="act-orbit"><div class="act-planet"></div></div>`,
    css: `
      .act-orbit { position: relative; width: 170px; height: 170px; border-radius: 50%;
                   border: 1px dashed rgba(255, 255, 255, 0.16);
                   animation: act-turn 6s linear infinite; }
      .act-planet { position: absolute; top: -11px; left: 50%; width: 22px; height: 22px; margin-left: -11px;
                    border-radius: 50%; background: #7C5CFF; box-shadow: 0 0 18px rgba(124, 92, 255, 0.7); }
      @keyframes act-turn { to { transform: rotate(360deg) } }
      .act-pulse { animation: act-pop 0.45s ease-out; }
      @keyframes act-pop { 30% { box-shadow: 0 0 0 18px rgba(124, 92, 255, 0.25) } }`,
    run: ({ tweaks, mount, target }) => {
      const orbit = target.querySelector(".act-orbit");
      const planet = target.querySelector(".act-planet");
      const panel = tweaks("Actions", {
        pulse: { type: "button", label: "Pulse", action: () => {
          planet.classList.remove("act-pulse");
          requestAnimationFrame(() => planet.classList.add("act-pulse"));
        } },
        playback: { type: "buttongroup", buttons: {
          Play: () => { orbit.style.animationPlayState = "running"; },
          Pause: () => { orbit.style.animationPlayState = "paused"; },
        } },
        line: { type: "separator" },
        seconds: [6, 1, 12, 0.5],
      });
      mount.append(panel.el);

      const apply = (p) => { orbit.style.animationDuration = `${p.seconds}s`; };
      panel.on(apply);
      apply(panel.params);
    },
  },
];
