/* Markup: enhance() and [data-twk] hosts. The examples here are pure HTML: the
 * markup shown IS the markup injected; the page imports tweakit/auto, which enhances it on load. */

export const meta = {
  slug: "markup",
  title: "Markup",
  description: "Markup-driven panels: enhance() upgrades [data-twk] HTML into live controls, no JavaScript required.",
};

export const intro = `
<p>The second way in: write <code>[data-twk]</code> markup and <code>enhance()</code>
upgrades each host into a live control in place. Importing <code>tweakit</code> binds
nothing by itself. Import <code>tweakit/auto</code> instead, the same API, and it runs
<code>enhance(document)</code> once the page has parsed; this page does, so the first three
examples are plain HTML, no page script at all. Or call <code>enhance()</code> yourself, for
the whole page or for DOM added later.</p>`;

export const examples = [
  {
    id: "static-panel",
    title: "A static panel shell",
    prose: `<p>A <code>.twk-panel</code> shell with <code>[data-twk]</code> hosts inside
      becomes the real thing: collapsible header, copy + reset toolbar operating over
      its controls, the works. Each control writes its live value back onto its host's
      <code>data-value</code> attribute. A <code>data-key</code> names the control in
      the toolbar's copied JSON (and stands in for a missing <code>data-label</code>);
      without one, the label is the key.</p>`,
    html: `
      <div class="twk-panel" data-mode="inline" style="max-width: 300px">
        <div class="twk-header"><span class="twk-title">Static</span></div>
        <div class="twk-controls">
          <div data-twk="slider" data-label="Blur" data-value="12" data-min="0" data-max="40" data-unit="px"></div>
          <div data-twk="checkbox" data-label="Visible" data-checked="true"></div>
          <div data-twk="list" data-label="Blend" data-options="normal, multiply, screen" data-value="normal"></div>
        </div>
      </div>`,
  },
  {
    id: "heavy-markup",
    title: "Heavy controls from markup",
    prose: `<p>Most controls work declaratively: their config flattens into
      <code>data-*</code> attributes, and the lazy ones load on demand exactly as they
      do from a schema. Markup understands <code>slider</code>, <code>number</code>,
      <code>checkbox</code> (with <code>data-options</code> it becomes a radio grid),
      <code>radiogrid</code> (or <code>segmented</code>), <code>list</code>, <code>text</code>, <code>color</code>,
      <code>gradient</code>, <code>image</code>, <code>button</code>, <code>buttongroup</code>,
      <code>separator</code>, <code>interval</code>, <code>spring</code>,
      <code>cubicbezier</code>, <code>motion</code>, <code>shadow</code>, <code>sides</code>, <code>point</code>, <code>plot</code>,
      <code>monitor</code> and <code>fpsgraph</code>, plus the <code>folder</code> wrapper below.
      An <code>image</code> with <code>data-options</code>, a comma list of URLs, is the gallery.
      <code>tabs</code> is panel-only; a host naming it is left untouched.</p>`,
    html: `
      <div class="twk-panel" data-mode="inline" style="max-width: 300px">
        <div class="twk-header"><span class="twk-title">Heavy</span></div>
        <div class="twk-controls">
          <div data-twk="color" data-label="Tint" data-value="#7C5CFF"></div>
          <div data-twk="spring" data-label="Motion" data-stiffness="220" data-damping="18" data-mass="1"></div>
          <div data-twk="point" data-label="Offset" data-components="X,Y" data-value="0,0" data-min="-50" data-max="50" data-pad="true"></div>
          <div data-twk="interval" data-label="Band" data-value="30,70" data-min="0" data-max="100" data-step="1"></div>
        </div>
      </div>`,
  },
  {
    id: "bare-hosts",
    title: "Bare hosts, anywhere",
    prose: `<p>Hosts don't need a panel shell: a <code>[data-twk]</code> div in any
      layout enhances in place (a <code>data-hint</code> rides along as the ⓘ tooltip).
      A <code>data-twk="folder"</code> wraps its children in a collapsible group.</p>`,
    html: `
      <div style="max-width: 300px">
        <div data-twk="folder" data-label="Inline anywhere">
          <div data-twk="slider" data-label="Speed" data-value="1.5" data-min="0" data-max="3" data-step="0.1"
               data-hint="Just a div in the page"></div>
          <div data-twk="radiogrid" data-label="Size" data-options="S, M, L, XL" data-cols="2" data-value="M"></div>
        </div>
      </div>`,
  },
  {
    id: "change-event",
    title: "Listening for changes",
    prose: `<p>Every edit on a host writes its <code>data-value</code> and dispatches a
      bubbling <code>twk:change</code> event with <code>{ key, value }</code> in
      <code>detail</code> (<code>key</code> is the host's <code>data-key</code>, or its
      label), so one listener on an ancestor hears every control under it. The host also
      keeps its handle at <code>host._tw.ctrl</code>: <code>get()</code> reads the value
      and <code>set(v)</code> applies one <em>and</em> runs the same change path (data-value
      + event). Drag the slider, then hit the button.</p>`,
    target: `
      <div class="mk-change">
        <div class="twk-panel" data-mode="inline" style="max-width: 300px">
          <div class="twk-header"><span class="twk-title">Observed</span></div>
          <div class="twk-controls">
            <div data-twk="slider" data-key="blur" data-value="12" data-min="0" data-max="40" data-step="1"></div>
          </div>
        </div>
        <button class="demo-btn mk-set" type="button">host._tw.ctrl.set(random)</button>
        <pre class="demo-well mk-log">Change something</pre>
      </div>`,
    css: `
      .mk-change { display: flex; flex-direction: column; gap: 12px; width: 100%; align-self: stretch; }
      .mk-log { white-space: pre; }`,
    noMount: true,
    noCaption: true,
    run: ({ enhance, target }) => {
      const log = target.querySelector(".mk-log");
      target.addEventListener("twk:change", (e) => {
        log.textContent = e.detail.key + " → " + JSON.stringify(e.detail.value) + "  (data-value=" + e.target.dataset.value + ")";
      });
      enhance(target).then(() => {
        const host = target.querySelector("[data-twk]");
        target.querySelector(".mk-set").addEventListener("click", () => host._tw.ctrl.set(Math.round(Math.random() * 40)));
      });
    },
  },
  {
    title: "Binding on load, or yourself",
    prose: `<p><code>tweakit/auto</code> covers the document as it parsed. Without it,
      call <code>enhance()</code>, which binds the whole document by default. For markup you
      inject later (a modal, a CMS block, a partial render), call it on the new root, which
      counts too when it is itself a <code>[data-twk]</code> host. Hosts that are already live
      are skipped, so re-running is safe. With the single-file build and no bundler, the same
      call goes in your module script: <code>import { enhance } from "./tweaks.js"; enhance();</code></p>`,
    code: `
      import "tweakit/auto";   // binds the page's [data-twk] hosts once it has parsed

      // or, from tweakit or tweakit/single:
      import { enhance } from "tweakit";

      await enhance();         // the whole document
      modal.innerHTML = controlsMarkup;
      await enhance(modal);    // resolves once any lazy modules have loaded`,
  },
];
