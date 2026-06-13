/* The panel API — events, set/reset, conditional controls, undo, presets, floating. */

export const meta = {
  slug: "panel-api",
  title: "The panel API",
  nav: "Panel API",
  description: "Everything tweaks() returns: events, programmatic set/reset, conditional controls, undo/redo, presets and floating panels.",
};

export const intro = `
<p><code>tweaks()</code> returns synchronously — <code>panel.el</code> to mount,
<code>panel.params</code> for live values, and the methods on this page. On the
code-split build, a panel that needs lazy modules builds its controls behind
<code>panel.ready</code>; the element, params and methods work immediately.</p>`;

export const examples = [
  {
    id: "events",
    title: "Events",
    prose: `<p><code>panel.on(fn)</code> subscribes to every change; the callback gets
      the params bag and the key that changed (also available as
      <code>params._last</code>). It returns an unsubscribe function. Move things and
      watch the feed.</p>`,
    target: `<pre class="pa-log">— change something —</pre>`,
    css: `
      .pa-log { width: 100%; align-self: stretch; margin: 0; padding: 14px 16px; border-radius: 10px;
                background: var(--demo-well); border: 1px solid var(--demo-well-line); font-size: 12px; line-height: 1.8;
                color: var(--demo-well-ink); white-space: pre-wrap; }`,
    run: ({ tweaks, mount, target }) => {
      const log = target.querySelector(".pa-log");
      const lines = [];
      const panel = tweaks("Events", {
        radius: [12, 0, 40, 1],
        mode: ["calm", "wild"],
        armed: false,
      });
      mount.append(panel.el);

      panel.on((p, changed) => {
        lines.unshift(changed ? `${changed} → ${JSON.stringify(p[changed])}` : "(reset)");
        log.textContent = lines.slice(0, 8).join("\n");
      });
    },
  },
  {
    id: "set-reset",
    title: "set & reset",
    prose: `<p>The panel is just another consumer of its own state:
      <code>panel.set(key, value)</code> moves a control programmatically (listeners
      fire, the UI follows), and <code>panel.reset()</code> restores every default —
      the same thing the toolbar's reset button does.</p>`,
    target: `
      <div class="pa-remote">
        <div class="pa-tile"></div>
        <div class="pa-remote-row">
          <button class="pa-btn pa-shuffle" type="button">panel.set(…) random</button>
          <button class="pa-btn pa-restore" type="button">panel.reset()</button>
        </div>
      </div>`,
    css: `
      .pa-remote { display: flex; flex-direction: column; align-items: center; gap: 18px; }
      .pa-tile { width: 120px; height: 120px; border-radius: 18px; background: oklch(0.65 0.2 260);
                 transition: background 0.15s, transform 0.2s; }
      .pa-remote-row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
      .pa-btn { padding: 7px 14px; border-radius: 9px; border: 1px solid var(--demo-line-strong);
                background: var(--demo-fill); color: var(--demo-ink); font-weight: 600; font-size: 12.5px;
                line-height: 1.4; font-family: inherit; cursor: pointer; }
      .pa-btn:hover { background: var(--demo-bar); }`,
    run: ({ tweaks, mount, target }) => {
      const tile = target.querySelector(".pa-tile");
      const panel = tweaks("Remote", {
        hue: [260, 0, 360, 1],
        lift: [0, 0, 40, 1],
      });
      mount.append(panel.el);

      const apply = (p) => {
        tile.style.background = `oklch(0.65 0.2 ${p.hue})`;
        tile.style.transform = `translateY(${-p.lift}px)`;
      };
      panel.on(apply);
      apply(panel.params);

      target.querySelector(".pa-shuffle").addEventListener("click", () => {
        panel.set("hue", Math.round(Math.random() * 360));
        panel.set("lift", Math.round(Math.random() * 40));
      });
      target.querySelector(".pa-restore").addEventListener("click", () => panel.reset());
    },
  },
  {
    id: "conditional",
    title: "render, disabled & hint",
    prose: `<p>Any object-form control can carry a <code>render</code> predicate
      (show/hide on sibling values), a <code>disabled</code> flag or predicate
      (gray out + lock), and a <code>hint</code> tooltip behind an ⓘ marker.
      Flip “Glow” and watch the other two rows.</p>`,
    target: `<div class="pa-chip">Glow me</div>`,
    css: `
      .pa-chip { display: grid; place-items: center; width: 130px; height: 130px; border-radius: 20px;
                 background: #26262b; color: #ededed; font-weight: 600; transition: box-shadow 0.2s; }`,
    run: ({ tweaks, mount, target }) => {
      const chip = target.querySelector(".pa-chip");
      const panel = tweaks("Conditional", {
        glow: false,
        color: { type: "color", value: "#7C5CFF",
                 render: (get) => get("glow"),          // hidden until glow is on
                 hint: "Only rendered while glow is on" },
        strength: { type: "slider", value: 36, min: 0, max: 90,
                    disabled: (get) => !get("glow") },  // grayed out instead
      });
      mount.append(panel.el);

      const apply = (p) => {
        chip.style.boxShadow = p.glow ? `0 0 ${p.strength}px ${p.color}` : "none";
      };
      panel.on(apply);
      panel.ready.then(() => apply(panel.params));
    },
  },
  {
    id: "undo",
    title: "Undo & redo",
    prose: `<p>Pass <code>{ undo: true }</code> and the panel keeps a debounced history:
      ⌘Z / ⇧⌘Z work while the panel is hovered or focused (so it never hijacks the
      page's own undo), a continuous drag coalesces into one step, and
      <code>panel.undo()</code> / <code>panel.redo()</code> drive it from outside.</p>`,
    target: `
      <div class="ud-remote">
        <div class="ud-card"></div>
        <div class="ud-remote-row">
          <button class="ud-btn ud-undo-btn" type="button">⌘Z undo</button>
          <button class="ud-btn ud-redo-btn" type="button">⇧⌘Z redo</button>
        </div>
      </div>`,
    css: `
      .ud-remote { display: flex; flex-direction: column; align-items: center; gap: 18px; }
      .ud-remote-row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
      .ud-btn { padding: 7px 14px; border-radius: 9px; border: 1px solid var(--demo-line-strong);
                background: var(--demo-fill); color: var(--demo-ink); font-weight: 600; font-size: 12.5px;
                line-height: 1.4; font-family: inherit; cursor: pointer; }
      .ud-btn:hover { background: var(--demo-bar); }
      .ud-card { width: 160px; height: 100px; border-radius: 18px; background: #7C5CFF;
                 transition: width 0.15s, border-radius 0.15s; }`,
    run: ({ tweaks, mount, target }) => {
      const card = target.querySelector(".ud-card");
      const panel = tweaks("History", {
        width: [160, 60, 260, 1],
        round: [18, 0, 50, 1],
      }, { undo: true });
      mount.append(panel.el);

      const apply = (p) => {
        card.style.width = `${p.width}px`;
        card.style.borderRadius = `${p.round}px`;
      };
      panel.on(apply);
      apply(panel.params);

      target.querySelector(".ud-undo-btn").addEventListener("click", () => panel.undo());
      target.querySelector(".ud-redo-btn").addEventListener("click", () => panel.redo());
    },
  },
  {
    id: "presets",
    title: "Persistence & presets",
    prose: `<p><code>{ persist: "key" }</code> saves values to localStorage (reload this
      page — the panel comes back as you left it) and unlocks presets: a presets menu
      appears in the toolbar, and <code>savePreset</code> / <code>loadPreset</code> /
      <code>deletePreset</code> / <code>presets()</code> drive the same store from code.</p>`,
    target: `
      <div class="ps-remote">
        <div class="ps-tile"></div>
        <div class="ps-remote-row">
          <button class="ps-btn ps-save" type="button">savePreset("mine")</button>
          <button class="ps-btn ps-load" type="button">loadPreset("mine")</button>
        </div>
        <div class="ps-note">&nbsp;</div>
      </div>`,
    css: `
      .ps-remote { display: flex; flex-direction: column; align-items: center; gap: 18px; }
      .ps-remote-row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
      .ps-btn { padding: 7px 14px; border-radius: 9px; border: 1px solid var(--demo-line-strong);
                background: var(--demo-fill); color: var(--demo-ink); font-weight: 600; font-size: 12.5px;
                line-height: 1.4; font-family: inherit; cursor: pointer; }
      .ps-btn:hover { background: var(--demo-bar); }
      .ps-tile { width: 120px; height: 120px; border-radius: 18px; background: oklch(0.6 0.18 260);
                 transition: all 0.15s; }
      .ps-note { font-size: 12px; color: var(--demo-faint); min-height: 1em; }`,
    run: ({ tweaks, mount, target }) => {
      const tile = target.querySelector(".ps-tile");
      const note = target.querySelector(".ps-note");
      const panel = tweaks("Presets", {
        hue: [260, 0, 360, 1],
        size: [120, 40, 190, 1],
      }, { persist: "tweakit-docs" });
      mount.append(panel.el);

      const apply = (p) => {
        tile.style.background = `oklch(0.6 0.18 ${p.hue})`;
        tile.style.width = `${p.size}px`;
        tile.style.height = `${p.size}px`;
      };
      panel.on(apply);
      apply(panel.params);

      target.querySelector(".ps-save").addEventListener("click", () => {
        panel.savePreset("mine");
        note.textContent = `presets: ${panel.presets().join(", ")}`;
      });
      target.querySelector(".ps-load").addEventListener("click", () => {
        note.textContent = panel.loadPreset("mine") ? "loaded “mine”" : "no preset saved yet";
      });
    },
  },
  {
    id: "floating",
    title: "Floating & draggable",
    prose: `<p>Every panel is draggable by its header — an inline panel lifts into a
      floating layer on first drag (<code>draggable: false</code> pins it). Pass
      <code>floating: true</code> or <code>{ x, y }</code> to start it floated, like a
      classic debug overlay.</p>`,
    target: `<button class="fl-btn fl-spawn" type="button">Spawn a floating panel</button>`,
    css: `
      .fl-btn { padding: 7px 14px; border-radius: 9px; border: 1px solid var(--demo-line-strong);
                background: var(--demo-fill); color: var(--demo-ink); font-weight: 600; font-size: 12.5px;
                line-height: 1.4; font-family: inherit; cursor: pointer; }
      .fl-btn:hover { background: var(--demo-bar); }`,
    noMount: true,
    run: ({ tweaks, target }) => {
      const btn = target.querySelector(".fl-spawn");
      let floater = null;
      btn.addEventListener("click", () => {
        if (floater) { floater.el.remove(); floater = null; btn.textContent = "Spawn a floating panel"; return; }
        floater = tweaks("Floating", {
          note: "Drag my header",
          hue: [280, 0, 360, 1],
        }, { floating: { x: 24, y: 96 } });
        document.body.append(floater.el);
        btn.textContent = "Dismiss it";
      });
    },
  },
  {
    title: "The rest of the options",
    prose: `<p>The full third argument, for reference:</p>
      <table>
        <tr><th>Option</th><th>Does</th></tr>
        <tr><td><code>theme</code></td><td>token overrides — see <a href="./theming.html">Theming</a></td></tr>
        <tr><td><code>persist</code></td><td>localStorage key (or <code>true</code> to key by panel name); enables presets</td></tr>
        <tr><td><code>filter</code></td><td>adds a fuzzy search toggle to the toolbar (the field swaps in for the title)</td></tr>
        <tr><td><code>floating</code></td><td>start floated: <code>true</code> or <code>{ x, y }</code></td></tr>
        <tr><td><code>draggable</code></td><td>header dragging — on by default, <code>false</code> pins</td></tr>
        <tr><td><code>toolbar</code></td><td><code>false</code> for a bare panel (no copy / reset / presets)</td></tr>
        <tr><td><code>undo</code></td><td>debounced undo/redo history</td></tr>
        <tr><td><code>onReset</code></td><td>replace the default reset behavior</td></tr>
        <tr><td><code>onEditStart</code> / <code>onEditEnd</code></td><td>bracket a continuous drag — pause expensive work mid-scrub</td></tr>
      </table>`,
  },
];
