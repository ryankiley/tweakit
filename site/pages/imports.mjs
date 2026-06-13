/* Imports — the two builds, panel.ready semantics, and the package exports map. */

export const meta = {
  slug: "imports",
  title: "The two builds",
  nav: "The two builds",
  description: "Monolith vs code-split: how the two tweakability entries load, what panel.ready means, and which to pick.",
};

export const intro = `
<p>One source tree, two builds, one API. The only observable difference is
<em>when</em> heavy controls exist.</p>
<table>
  <tr><th>Entry</th><th>Size</th><th>Loading</th></tr>
  <tr><td><code>tweakability</code></td><td>{{size-single}} gzip</td><td>one self-contained file; every control inlined, fully synchronous</td></tr>
  <tr><td><code>tweakability/core</code></td><td>{{size-split}} gzip</td><td>code-split; color engine and heavy controls dynamic-import on first use</td></tr>
</table>
<p>Pick the monolith for drop-in simplicity (it's also the no-bundler choice — copy
<code>dist/tweaks.js</code> anywhere). Pick <code>/core</code> when panels are part of a
real app and you'd rather not ship the color engine to users who never open a
picker.</p>`;

export const examples = [
  {
    id: "ready",
    title: "panel.ready",
    prose: `<p><code>tweaks()</code> returns synchronously on both builds — the panel
      element, params and methods are live at once. On the split build, a panel whose
      schema needs lazy modules builds all of its controls when <code>panel.ready</code>
      resolves (until then the shell is an empty frame); on the monolith,
      <code>ready</code> resolves immediately. This page runs the split build — the
      stamp shows the real load.</p>`,
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
      time any panel (or <code>[data-tw]</code> host) uses them — once loaded, they're
      synchronous for the rest of the session:</p>
      <ul>
        <li><strong>color engine</strong> — <code>color</code>, and <code>gradient</code> (which builds on it)</li>
        <li><strong>one module each</strong> — <code>interval</code>, <code>spring</code>, <code>cubicbezier</code>,
          <code>point</code>, <code>plot</code>, <code>image</code>, <code>tabs</code></li>
        <li><strong>monitors</strong> — <code>monitor</code> and <code>fpsgraph</code> share a module</li>
      </ul>
      <p>Everything else — slider, number, text, checkbox, list, radiogrid, button,
      buttongroup, folder, separator — ships in core and is always synchronous.</p>`,
  },
  {
    title: "The exports map",
    prose: `<p>Everything the package ships, by import path. Types ride along with both
      entries.</p>`,
    code: `
      import { tweaks, enhance } from "tweakability";        // monolith
      import { tweaks, enhance } from "tweakability/core";   // code-split
      import "tweakability/css";                             // panel styles

      import type { Schema, Panel, Theme, TweaksOptions } from "tweakability";`,
  },
];
