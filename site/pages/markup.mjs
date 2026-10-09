/* Markup — enhance() and [data-tw] hosts. The examples here are pure HTML: the
 * markup shown IS the markup injected; importing core auto-enhances it on load. */

export const meta = {
  slug: "markup",
  title: "Markup",
  description: "Markup-driven panels: enhance() upgrades [data-tw] HTML into live controls — no JavaScript required.",
};

export const intro = `
<p>The second way in: write <code>[data-tw]</code> markup and <code>enhance()</code>
upgrades each host into a live control in place. Importing the core module runs
<code>enhance(document)</code> automatically on load — every example on this page is
plain HTML, no page script at all. Call <code>enhance(root)</code> yourself for DOM
added later.</p>`;

export const examples = [
  {
    id: "static-panel",
    title: "A static panel shell",
    prose: `<p>A <code>.tw-panel</code> shell with <code>[data-tw]</code> hosts inside
      becomes the real thing — collapsible header, copy + reset toolbar operating over
      its controls, the works. Each control writes its live value back onto its host's
      <code>data-value</code> attribute. A <code>data-key</code> names the control in
      the toolbar's copied JSON (and stands in for a missing <code>data-label</code>);
      without one, the label is the key.</p>`,
    html: `
      <div class="tw-panel" data-mode="inline" style="max-width: 300px">
        <div class="tw-header"><span class="tw-title">Static</span></div>
        <div class="tw-controls">
          <div data-tw="slider" data-label="Blur" data-value="12" data-min="0" data-max="40"></div>
          <div data-tw="checkbox" data-label="Visible" data-checked="true"></div>
          <div data-tw="list" data-label="Blend" data-options="normal, multiply, screen" data-value="normal"></div>
        </div>
      </div>`,
  },
  {
    id: "heavy-markup",
    title: "Heavy controls from markup",
    prose: `<p>Most controls work declaratively — their config flattens into
      <code>data-*</code> attributes, and the lazy ones load on demand exactly as they
      do from a schema. Markup understands <code>slider</code>, <code>number</code>,
      <code>checkbox</code> (with <code>data-options</code> it becomes a radio grid),
      <code>radiogrid</code>, <code>list</code>, <code>text</code>, <code>color</code>,
      <code>image</code>, <code>button</code>, <code>buttongroup</code>,
      <code>separator</code>, <code>interval</code>, <code>spring</code>,
      <code>cubicbezier</code>, <code>point</code>, <code>plot</code> and
      <code>fpsgraph</code>, plus the <code>folder</code> wrapper below.
      <code>gradient</code>, <code>monitor</code>, <code>segmented</code> and
      <code>tabs</code> are panel-only — a host naming one of those is left untouched.</p>`,
    html: `
      <div class="tw-panel" data-mode="inline" style="max-width: 300px">
        <div class="tw-header"><span class="tw-title">Heavy</span></div>
        <div class="tw-controls">
          <div data-tw="color" data-label="Tint" data-value="#7C5CFF"></div>
          <div data-tw="spring" data-label="Motion" data-stiffness="220" data-damping="18" data-mass="1"></div>
          <div data-tw="point" data-label="Offset" data-components="X,Y" data-value="0,0" data-min="-50" data-max="50" data-pad="true"></div>
          <div data-tw="interval" data-label="Band" data-value="30,70" data-min="0" data-max="100" data-step="1"></div>
        </div>
      </div>`,
  },
  {
    id: "bare-hosts",
    title: "Bare hosts, anywhere",
    prose: `<p>Hosts don't need a panel shell — a <code>[data-tw]</code> div in any
      layout enhances in place (a <code>data-hint</code> rides along as the ⓘ tooltip).
      A <code>data-tw="folder"</code> wraps its children in a collapsible group.</p>`,
    html: `
      <div style="max-width: 300px">
        <div data-tw="folder" data-label="Inline anywhere">
          <div data-tw="slider" data-label="Speed" data-value="1.5" data-min="0" data-max="3" data-step="0.1"
               data-hint="Just a div in the page"></div>
          <div data-tw="radiogrid" data-label="Size" data-options="S, M, L, XL" data-cols="2" data-value="M"></div>
        </div>
      </div>`,
  },
  {
    id: "change-event",
    title: "Listening for changes",
    prose: `<p>Every edit on a host writes its <code>data-value</code> and dispatches a
      bubbling <code>tw:change</code> event with <code>{ key, value }</code> in
      <code>detail</code> — <code>key</code> is the host's <code>data-key</code> (or its
      label) — so one listener on an ancestor hears every control under it. The host also
      keeps its handle at <code>host._tw.ctrl</code>: <code>get()</code> reads the value
      and <code>set(v)</code> applies one <em>and</em> runs the same change path (data-value
      + event), where a same-value <code>set()</code> stays silent. Drag the slider, then
      hit the button.</p>`,
    target: `
      <div class="mk-change">
        <div class="tw-panel" data-mode="inline" style="max-width: 300px">
          <div class="tw-header"><span class="tw-title">Observed</span></div>
          <div class="tw-controls">
            <div data-tw="slider" data-key="blur" data-value="12" data-min="0" data-max="40" data-step="1"></div>
          </div>
        </div>
        <button class="demo-btn mk-set" type="button">host._tw.ctrl.set(random)</button>
        <pre class="mk-log">— change something —</pre>
      </div>`,
    css: `
      .mk-change { display: flex; flex-direction: column; gap: 12px; width: 100%; align-self: stretch; }
      .mk-log { margin: 0; padding: 12px 14px; border-radius: 10px; background: var(--demo-well);
                border: 1px solid var(--demo-well-line); font-size: 12px; line-height: 1.6; color: var(--demo-well-ink); }`,
    noMount: true,
    noCaption: true,
    run: ({ enhance, target }) => {
      const log = target.querySelector(".mk-log");
      target.addEventListener("tw:change", (e) => {
        log.textContent = e.detail.key + " → " + JSON.stringify(e.detail.value) + "  (data-value=" + e.target.dataset.value + ")";
      });
      enhance(target).then(() => {
        const host = target.querySelector("[data-tw]");
        target.querySelector(".mk-set").addEventListener("click", () => host._tw.ctrl.set(Math.round(Math.random() * 40)));
      });
    },
  },
  {
    title: "Calling enhance() yourself",
    prose: `<p>Auto-enhance covers the initial document. For markup you inject later —
      a modal, a CMS block, a partial render — call it on the new root, which counts
      too when it is itself a <code>[data-tw]</code> host. Hosts that are already live
      are skipped, so re-running is safe.</p>`,
    code: `
      import { enhance } from "tweakit/core";

      modal.innerHTML = controlsMarkup;
      await enhance(modal);   // resolves once any lazy modules have loaded`,
  },
];
