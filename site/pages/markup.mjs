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
    title: "Calling enhance() yourself",
    prose: `<p>Auto-enhance covers the initial document. For markup you inject later —
      a modal, a CMS block, a partial render — call it on the new root. Hosts that are
      already live are skipped, so re-running is safe.</p>`,
    code: `
      import { enhance } from "tweakit/core";

      modal.innerHTML = controlsMarkup;
      await enhance(modal);   // resolves once any lazy modules have loaded`,
  },
];
