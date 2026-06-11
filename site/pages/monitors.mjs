/* Monitors — monitor (readout + sparkline) and fpsgraph. */

export const meta = {
  slug: "monitors",
  title: "Monitors",
  description: "Read-only controls: live value readouts with sparkline graphs, and the FPS meter under real load.",
};

export const intro = `
<p>Monitors flow the other way: instead of editing a value, they watch one. Hand them
a <code>get</code> function and they poll it — numbers draw a scrolling graph by
default; <code>graph: false</code> keeps a plain text readout.</p>`;

export const examples = [
  {
    id: "monitor",
    title: "Monitor",
    prose: `<p>Two monitors over the same signal — a noisy sine the page generates.
      The graph form scrolls; the text form just re-reads. <code>min</code>/<code>max</code>
      frame the graph, <code>interval</code> sets the poll rate (ms),
      <code>decimals</code> trims the readout.</p>`,
    run: ({ tweaks, mount }) => {
      const signal = () => Math.sin(Date.now() / 600) * 50 + (Math.random() - 0.5) * 12;
      const panel = tweaks("Monitor", {
        wave: { type: "monitor", get: signal, min: -70, max: 70 },
        value: { type: "monitor", get: signal, graph: false, decimals: 1, interval: 250 },
      });
      mount.append(panel.el);
    },
  },
  {
    id: "fpsgraph",
    title: "FPS graph",
    prose: `<p><code>{ type: "fpsgraph" }</code> measures the page's real frame rate —
      no <code>get</code> needed. To prove it's honest, the slider spawns blurred,
      endlessly-spinning tiles. Push it up and watch the trace dip; pull it back and
      the frame rate recovers.</p>`,
    target: `<div class="fps-field"></div>`,
    css: `
      .fps-field { display: flex; flex-wrap: wrap; gap: 6px; align-content: flex-start;
                   width: 100%; min-height: 170px; max-height: 220px; overflow: hidden; }
      .fps-tile { width: 22px; height: 22px; border-radius: 5px; background: linear-gradient(135deg, #7C5CFF, #ff8a5b);
                  filter: blur(2px); animation: fps-spin 1.1s linear infinite; }
      @keyframes fps-spin { to { transform: rotate(360deg) scale(0.8); } }`,
    run: ({ tweaks, mount, target }) => {
      const field = target.querySelector(".fps-field");
      const panel = tweaks("FPS", {
        fps: { type: "fpsgraph", label: "FPS" },
        load: [0, 0, 400, 20],     // number of spinning tiles
      });
      mount.append(panel.el);

      const apply = (p) => {
        while (field.children.length > p.load) field.lastChild.remove();
        while (field.children.length < p.load) {
          const tile = document.createElement("div");
          tile.className = "fps-tile";
          tile.style.animationDelay = `${(field.children.length * 53) % 1100}ms`;
          field.append(tile);
        }
      };
      panel.on(apply);
      panel.ready.then(() => apply(panel.params));
    },
  },
];
