/* Imports: the two builds, panel.ready semantics, and the package exports map. */

export const meta = {
  slug: "imports",
  title: "The two builds",
  nav: "The two builds",
  description: "Single-file vs code-split: how the two tweakit entries load, what panel.ready means, and which to pick.",
};

export const intro = `
<p>One source tree, two builds, one API. The only observable difference is
<em>when</em> heavy controls exist.</p>
<table>
  <tr><th>Entry</th><th>Size</th><th>Loading</th></tr>
  <tr><td><code>tweakit</code></td><td>{{size-single}} gzip</td><td>the single-file build; every control inlined, fully synchronous</td></tr>
  <tr><td><code>tweakit/core</code></td><td>{{size-split}} gzip</td><td>code-split; color engine and heavy controls dynamic-import on first use</td></tr>
  <tr><td><code>tweakit/css</code></td><td>{{size-css}} gzip</td><td>the stylesheet, the same for both builds; add it to either figure for the full weight on the wire</td></tr>
</table>
<p>Pick the single-file build for drop-in simplicity. Pick <code>/core</code> when panels are part of a
real app and you'd rather not ship the color engine to users who never open a
picker.</p>`;

export const examples = [
  {
    id: "ready",
    title: "panel.ready",
    prose: `<p><code>tweaks()</code> returns synchronously on both builds: the panel
      element, params and methods are live at once. On the split build, a panel whose
      schema needs lazy modules builds all of its controls when <code>panel.ready</code>
      resolves (until then the shell is an empty frame); on the single-file build,
      <code>ready</code> resolves immediately. This page runs the split build; the stamp
      shows how long the lazy path took (the docs preload the chunks, so this is the
      import, not a network round trip).</p>`,
    target: `<code class="im-stamp">…</code>`,
    css: `
      .im-stamp { font-size: 13px; color: var(--demo-muted); background: var(--demo-fill);
                  border: 1px solid var(--demo-line); border-radius: 8px; padding: 8px 14px; }`,
    run: ({ tweaks, mount, target }) => {
      const stamp = target.querySelector(".im-stamp");
      const t0 = performance.now();
      const panel = tweaks("Ready", {
        motion: { type: "spring", stiffness: 220, damping: 18, mass: 1 }, // lazy here
        speed: [1, 0, 3, 0.1],                                            // built-in
      });
      mount.append(panel.el);   // the shell mounts now; controls build at ready

      panel.ready.then(() => {
        stamp.textContent = `panel.ready resolved in ${Math.round(performance.now() - t0)} ms`;
      });
    },
  },
  {
    title: "What loads when",
    prose: `<p>On the split build, these schema types trigger a dynamic import the first
      time any panel (or <code>[data-tw]</code> host) uses them; once loaded, they're
      synchronous for the rest of the session:</p>
      <ul>
        <li><strong>color engine</strong>: <code>color</code>, and <code>gradient</code> (which builds on it)</li>
        <li><strong>numeric field engine</strong>: <code>number</code> (the boxed fields of spring, point, cubicbezier and the color channels reuse it)</li>
        <li><strong>one module each</strong>: <code>interval</code>, <code>spring</code>, <code>cubicbezier</code>,
          <code>point</code>, <code>plot</code>, <code>image</code>, <code>tabs</code></li>
        <li><strong>monitors</strong>: <code>monitor</code> and <code>fpsgraph</code> share a module</li>
      </ul>
      <p>Everything else (<code>slider</code>, <code>text</code>, <code>checkbox</code>, <code>list</code>,
      <code>radiogrid</code>, <code>button</code>, <code>buttongroup</code>, <code>folder</code>,
      <code>separator</code>) ships in core and is always synchronous.</p>`,
  },
  {
    title: "The exports map",
    prose: `<p>Everything the package ships, by import path. Types ride along with both
      entries.</p>`,
    code: `
      import { tweaks, enhance, mountControl, createColorPicker, gradientCss, gradientStops } from "tweakit";        // single-file build
      import { tweaks, enhance, mountControl, createColorPicker, gradientCss, gradientStops } from "tweakit/core";   // code-split
      import "tweakit/css";                                                                                          // panel styles

      import type { Schema, Panel, PanelState, Theme, TweaksOptions, GradientValue } from "tweakit";`,
  },
];
