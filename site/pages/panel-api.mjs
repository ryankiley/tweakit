/* The panel API: events, set/reset, conditional controls, undo, presets, floating, teardown. */

export const meta = {
  slug: "panel-api",
  title: "The panel API",
  nav: "Panel API",
  description: "Everything tweaks() returns: events, programmatic set/reset, conditional controls, undo/redo, presets and floating panels.",
};

export const intro = `
<p><code>tweaks()</code> returns synchronously: <code>panel.el</code> to mount,
<code>panel.params</code> for live values, and the methods on this page. On the
code-split build, lazy controls build behind
<a href="./imports.html#ex-ready"><code>panel.ready</code></a>.</p>`;

export const examples = [
  {
    id: "events",
    title: "Events",
    prose: `<p><code>panel.on(fn)</code> fires on every change with the params bag and the
      changed key, and returns an unsubscribe function.
      Move things and watch the feed.</p>`,
    target: `<pre class="demo-well pa-log">Change something</pre>`,
    css: `
      .pa-log { width: 100%; align-self: stretch; padding: 14px 16px; line-height: 1.8; }`,
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
    title: "set, setMany, changes & reset",
    prose: `<p>The panel is just another consumer of its own state:
      <code>panel.set(key, value)</code> moves a control programmatically (listeners
      fire, the UI follows), and <code>panel.reset()</code> restores every default,
      the same thing the toolbar's reset button does. To move several at once, hand
      <code>panel.setMany({ key: v, "folder.child": w })</code> a flat map: it applies the
      whole batch and notifies once, not once per key (the shuffle below sets two). Pass
      <code>{ silent: true }</code> as the last argument to <code>set</code>,
      <code>setMany</code> or <code>fromJSON</code> to apply a value without calling your
      <code>on()</code> listeners, for mirroring a change the host already made so it
      doesn't echo back; conditional controls, persistence and undo still follow it. Each
      control resets on its own too: double-click its label (or a slider's readout), hold
      it on touch, or press ⌥+Backspace with focus inside it.</p>
      <p>The reverse, <code>panel.changes()</code>, is a flat map of every value that has
      moved off its default, in the same shape (what you paste to bake tuned values into
      source). ⇧-click the toolbar's copy button to copy that instead of the full snapshot
      (copying one row or folder has its own section below).
      <code>panel.setName(name)</code> retitles the panel live; the name it was built with
      stays its storage key, so saved values and
      presets survive a rename.</p>`,
    target: `
      <div class="demo-remote">
        <div class="pa-tile"></div>
        <div class="demo-remote-row">
          <button class="demo-btn pa-shuffle" type="button">panel.set(…) random</button>
          <button class="demo-btn pa-restore" type="button">panel.reset()</button>
        </div>
      </div>`,
    css: `
      .pa-tile { width: 120px; height: 120px; border-radius: 18px; background: oklch(0.65 0.2 260);
                 transition: background 0.15s, transform 0.2s; }`,
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
        panel.setMany({ hue: Math.round(Math.random() * 360), lift: Math.round(Math.random() * 40) });
      });
      target.querySelector(".pa-restore").addEventListener("click", () => panel.reset());
    },
  },
  {
    id: "copy-paste",
    title: "Copy & paste",
    prose: `<p>A row or folder copies on its own. Press in the space beside it, in the panel's
      side padding, to pick it (it fills), then press ⌘C (Ctrl on Windows and Linux); pick
      another and press ⌘V. A row copies its value and pastes one back; a folder copies its
      values object and pastes it into its own keys, so two folders with the same keys trade
      values. Try it below: pick Key by pressing beside its title, ⌘C, pick Fill, ⌘V, and
      the second light takes the first's look.</p>
      <p>A paste goes through <code>fromJSON</code>, so it's one undo step, saved and
      announced like any load, and the band flashes as it lands. A value only lands where it
      fits, the same type as the control holds (a color for a color, one of a list's
      options); if nothing fits, the band flashes red and nothing changes. With nothing
      picked, the keys act on the row holding focus; Escape or a press elsewhere drops the
      pick, and in a text field or over selected text the keys stay the browser's.</p>`,
    target: `<div class="cp-stage"><div class="cp-light"></div><div class="cp-light"></div></div>`,
    css: `
      .cp-stage { display: flex; align-items: center; justify-content: center; gap: 36px; min-height: 140px; }
      .cp-light { border-radius: 50%; transition: width 0.15s, height 0.15s, background 0.15s, filter 0.15s; }`,
    run: ({ tweaks, mount, target }) => {
      const lights = target.querySelectorAll(".cp-light");
      const light = (hue, size, soft) => ({ hue: [hue, 0, 360, 1], size: [size, 40, 120, 1], soft: [soft, 0, 30, 1] });
      const panel = tweaks("Lights", { key: light(40, 96, 4), fill: light(220, 60, 18) });
      mount.append(panel.el);

      const paint = (el, l) => {
        el.style.width = el.style.height = `${l.size}px`;
        el.style.background = `oklch(0.78 0.14 ${l.hue})`;
        el.style.filter = `blur(${l.soft}px)`;
      };
      const apply = (p) => { paint(lights[0], p.key); paint(lights[1], p.fill); };
      panel.on(apply);
      apply(panel.params);
    },
  },
  {
    id: "save-load",
    title: "Save & load state",
    prose: `<p><code>panel.toJSON()</code> serializes the whole panel, every value
      <strong>plus</strong> UI state (which folders are collapsed, which tab is open), to a
      plain object, separate from the localStorage presets. Persist it your own way: a file,
      a URL, a server. <code>panel.fromJSON(state)</code> restores it (unknown paths skipped).
      It takes part of one too: <code>panel.fromJSON({ ui: { folders: { shadow: true } } })</code>
      right after <code>tweaks()</code> starts that folder closed, by dotted path.
      Tweak things, collapse the folder, <strong>Save</strong>, change more, then
      <strong>Load</strong> to snap back.</p>`,
    target: `
      <div class="pa-save">
        <div class="pa-save-row">
          <button class="demo-btn pa-do-save" type="button">panel.toJSON()</button>
          <button class="demo-btn pa-do-load" type="button">panel.fromJSON(…)</button>
        </div>
        <pre class="demo-well pa-state">Save to capture state</pre>
      </div>`,
    css: `
      .pa-save { display: flex; flex-direction: column; gap: 10px; width: 100%; align-self: stretch; }
      .pa-save-row { display: flex; flex-wrap: wrap; gap: 8px; }
      .pa-state { font-size: 11px; max-height: 180px; overflow: auto; }`,
    run: ({ tweaks, mount, target }) => {
      const out = target.querySelector(".pa-state");
      let saved = null;
      const panel = tweaks("Card", {
        blur: [12, 0, 40, 1],
        accent: "#7C5CFF",
        shadow: {
          radius: [16, 0, 64, 1],
          opacity: [0.4, 0, 1, 0.05],
        },
      });
      mount.append(panel.el);

      target.querySelector(".pa-do-save").addEventListener("click", () => {
        saved = panel.toJSON();
        out.textContent = JSON.stringify(saved, null, 2);
      });
      target.querySelector(".pa-do-load").addEventListener("click", () => {
        if (saved) panel.fromJSON(saved);
      });
    },
  },
  {
    id: "conditional",
    title: "render, disabled & hint",
    prose: `<p>Any object-form control can carry a <code>render</code> predicate
      (show/hide on sibling values; the row folds in and out as a folder does), a <code>disabled</code> flag or predicate
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
        strength: { type: "slider", value: 36, min: 0, max: 90, unit: "px",
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
      ⌘Z / ⇧⌘Z (Ctrl on Windows and Linux) work while the panel is hovered or focused (so it never hijacks the
      page's own undo), a continuous drag coalesces into one step, and
      <code>panel.undo()</code> / <code>panel.redo()</code> drive it from outside.</p>`,
    target: `
      <div class="demo-remote">
        <div class="ud-card"></div>
        <div class="demo-remote-row">
          <button class="demo-btn ud-undo-btn" type="button">⌘Z undo</button>
          <button class="demo-btn ud-redo-btn" type="button">⇧⌘Z redo</button>
        </div>
      </div>`,
    css: `
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
    prose: `<p><code>{ persist: "key" }</code> saves values, and a floated panel's position,
      to localStorage (reload this page and the panel comes back as you left it) and unlocks
      presets: a presets menu
      appears in the toolbar, and <code>savePreset</code> / <code>loadPreset</code> /
      <code>deletePreset</code> / <code>presets()</code> drive the same store from code.
      <code>presets: false</code> keeps the saving and leaves the menu out. A control
      with <code>persist: false</code> is left out of the saved session, so it opens on its
      schema value every load (a “playing” toggle that should start off). An uploaded
      image is too big for localStorage, so it goes to IndexedDB under the same key, and a
      panel that persists one has it back by <code>panel.ready</code>; the other values don't wait for it.
      With no IndexedDB, an upload saves inline in localStorage when it fits.</p>`,
    target: `
      <div class="demo-remote">
        <div class="ps-tile"></div>
        <div class="demo-remote-row">
          <button class="demo-btn ps-save" type="button">savePreset("mine")</button>
          <button class="demo-btn ps-load" type="button">loadPreset("mine")</button>
        </div>
        <div class="ps-note">&nbsp;</div>
      </div>`,
    css: `
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
    prose: `<p>Every panel is draggable by its header: an inline panel lifts into a
      floating layer on first drag (<code>draggable: false</code> pins it). Pass
      <code>floating: true</code> or <code>{ x, y }</code> to start it floated, like a
      classic debug overlay, inset <code>x</code> and <code>y</code> px from the top-left.
      A floating panel never runs off the window: it caps at the viewport
      with a gap of <code>y</code> at the far edge (8px once dragged) and scrolls, header and all, so a tall
      panel reaches its last folder by scrolling and drags by its title once scrolled back
      up. A pinned panel ignores a position <code>persist</code> saved; a draggable one
      restores it. With the title focused, ⌥+arrow keys move the panel 10px at a time (⇧: 50px),
      the keyboard's drag. A click anywhere on the header outside the toolbar folds the panel. A
      press becomes a drag only after a few pixels, and Escape mid-drag puts the panel back.</p>
      <p>An open editor pane or the presets menu drags by its edge, so you can move it
      off what it covers. It keeps that spot until it closes. In a pane's field, Escape restores
      what you typed over and a second Escape closes the pane. Escapes the panel handles stop at
      the document, so <code>window</code> listeners don't see them.</p>
      <p>The placement, z-index and shadow sit at plain <code>.twk-panel</code> specificity,
      so a class of your own loaded after the stylesheet overrides them: <code>top</code>,
      <code>right</code> and <code>left</code> for the inset, <code>--twk-float-gap</code>
      for the far-edge gap or <code>max-height</code> for the whole cap, and
      <code>z-index</code> and <code>box-shadow</code> as usual.</p>`,
    target: `<button class="demo-btn fl-spawn" type="button">Spawn a floating panel</button>`,
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
    id: "destroy",
    title: "Teardown",
    prose: `<p><code>panel.destroy()</code> removes the panel, releases every global listener
      and closes any open popover; the API goes inert. Call it when the host view
      unmounts.</p>`,
  },
  {
    title: "Standalone controls",
    prose: `<p>Sometimes you want a control, not a panel: a slider in your own settings
      form, or the color picker behind a swatch your page already draws.
      <code>mountControl(host, value, opts)</code> builds one control from any schema value
      (shorthand or verbose) straight into an element of yours and returns
      <code>{ el, set, get, destroy, ready }</code>. Unlike a panel there is no params bag:
      <code>onChange</code> gets the value, and <code>set()</code> fires it too, so your own
      state stays the single source. <code>label: ""</code> suppresses the label when the host
      page has one.</p>
      <p><code>createColorPicker({ value, mode, onChange })</code> is the picker body alone
      (the OKLCH plane, strips and channel fields, no trigger row), for a swatch of your
      own. Append <code>el</code> wherever you like (a popover, a sidebar), call
      <code>reflow()</code> after showing it, and read <code>get()</code> back in whatever
      notation the mode dropdown is set to: <code>hex</code> gives <code>#RRGGBB</code>; the
      wide-gamut modes give a CSS color like <code>oklch(…)</code>, which a native
      <code>&lt;input type="color"&gt;</code> won't accept; feed that only hex. Both handles
      exist synchronously; on the code-split build a lazy control fills its <code>el</code>
      in behind <code>ready</code>.</p>
      <p><code>gradientCss(value, direction?)</code> and <code>gradientStops(value)</code> turn
      a gradient control's value into CSS, easing expanded and blend space honored; the
      editor's own preview draws through the same function. Pure string work: no control
      needs to be mounted. See <a href="./color-and-gradient.html#ex-gradient">Gradient</a>.</p>`,
    code: `
      import { mountControl, createColorPicker } from "tweakit";

      const blur = mountControl(form, [12, 0, 40, 1], {
        key: "blur", label: "",                      // the form already labels it
        onChange: (v) => card.style.filter = "blur(" + v + "px)",
      });
      blur.set(20);                                   // moves the slider AND runs onChange

      const picker = createColorPicker({
        value: "oklch(0.7 0.15 200)", mode: "oklch",
        onChange: (c) => swatch.style.background = c,
      });
      myPopover.append(picker.el);
      swatch.addEventListener("click", () => { openPopover(); picker.reflow(); });

      import { gradientCss } from "tweakit";
      panel.on((p) => hero.style.background = gradientCss(p.ramp, 135));`,
  },
  {
    title: "The rest of the options",
    prose: `<p>The full third argument, for reference:</p>
      <table>
        <tr><th>Option</th><th>Does</th></tr>
        <tr><td><code>theme</code></td><td>token overrides; see <a href="./theming.html">Theming</a></td></tr>
        <tr><td><code>persist</code></td><td>localStorage key (or <code>true</code> to key by panel name); enables presets</td></tr>
        <tr><td><code>presets</code></td><td><code>false</code> keeps <code>persist</code>'s saving without the Presets menu</td></tr>
        <tr><td><code>floating</code></td><td>start floated: <code>true</code> or <code>{ x, y }</code></td></tr>
        <tr><td><code>draggable</code></td><td>header dragging, on by default; <code>false</code> pins</td></tr>
        <tr><td><code>toolbar</code></td><td><code>false</code> for a bare panel (no copy / reset / presets)</td></tr>
        <tr><td><code>undo</code></td><td>debounced undo/redo history</td></tr>
        <tr><td><code>onReset</code></td><td>replace the default reset behavior</td></tr>
        <tr><td><code>strings</code></td><td>the words it shows and says, by key, over the English defaults; see below</td></tr>
        <tr><td><code>shadow</code></td><td><code>true</code> builds the panel in a shadow root, out of reach of page CSS such as <code>#app button { … }</code>; see below</td></tr>
      </table>`,
  },
  {
    id: "strings",
    title: "Its words",
    prose: `<p>Every word a panel shows or says (its buttons and tooltips, its sub-editors' labels,
      what a screen reader hears after a copy or a paste) has a key in <code>strings</code>, with
      its English default in the <code>Strings</code> type. Pass the ones to change: to translate
      the panel, or to rename the chrome. A key with a <code>{placeholder}</code> takes a string
      using it, or a function given the values, for plurals. <code>mountControl</code>,
      <code>createColorPicker</code> and <code>enhance(root, { strings })</code> take it too.</p>`,
    code: `
      tweaks("Réglages", schema, { strings: {
        presets: "Préréglages", reset: "Réinitialiser",
        presetSaved: "Préréglage {name} enregistré",
        pasted: (v) => (v.n === 1 ? "1 valeur collée" : \`\${v.n} valeurs collées\`),
      } });`,
  },
  {
    id: "shadow",
    title: "Shielded from page CSS",
    prose: `<p>A page's rules aimed through a wrapper (<code>#app button { padding: 20px }</code>,
      a <code>.prose</code> container, CMS styles) reach a panel's own buttons, fields and labels.
      <code>shadow: true</code> builds the panel in a shadow root instead, and its panes in a
      second root on <code>&lt;body&gt;</code>, where none of that applies. <code>panel.el</code> is
      then the host, a <code>&lt;twk-host&gt;</code>: append it as usual. The panel still inherits
      what any element does (the host's font size, color, direction). Theme it with
      <code>--twk-*</code> tokens on the host itself (<code>.twk-host { --twk-radius: 4px }</code>),
      which its panes take too, or with <code>theme</code>; your own rules for the kit's classes
      (<code>.twk-panel { … }</code>) come along as well. Its styles are the kit's rules from the
      page's own <code>tweakit/css</code>; a page without it links <code>tweaks.css</code> from
      beside the module, or the stylesheet at <code>shadow: { href }</code>.
      <code>mountControl</code> and <code>createColorPicker</code> take <code>shadow</code> too.</p>`,
  },
];
