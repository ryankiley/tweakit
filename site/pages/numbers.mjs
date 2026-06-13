/* Numbers — slider, number, interval, point. */

export const meta = {
  slug: "numbers",
  title: "Numbers",
  description: "Tweakit's numeric controls, live: slider, number field, dual-handle interval, and the 2D point pad.",
};

export const intro = `
<p>Four ways to edit a number — or two, or four of them at once. Sliders and number
fields are built in; <code>interval</code> and <code>point</code> are heavy controls
that load on first use.</p>`;

export const examples = [
  {
    id: "slider",
    title: "Slider",
    prose: `<p>The workhorse. <code>[value, min, max, step]</code> as shorthand, or
      <code>{ type: "slider" }</code> for options. Drag anywhere on the track, scrub with
      arrow keys (⇧ for coarse steps), or hover the value and click to type
      (double-click resets). With six or fewer stops the track snaps and shows rule
      lines.</p>`,
    target: `<div class="num-tile"></div>`,
    css: `
      .num-tile { width: 132px; height: 132px; background: #7C5CFF;
                  box-shadow: 0 18px 46px -10px color-mix(in oklab, #7C5CFF 55%, transparent),
                              inset 0 1px 0 rgba(255, 255, 255, 0.32);
                  will-change: border-radius, transform; }`,
    run: ({ tweaks, mount, target }) => {
      const tile = target.querySelector(".num-tile");
      const panel = tweaks("Slider", {
        radius: [16, 0, 66, 1],       // continuous: smooth square → circle
        size: [4, 2, 6, 1],           // ≤6 stops: snaps, shows rule lines
      });
      mount.append(panel.el);

      const apply = (p) => {
        tile.style.borderRadius = `${p.radius}px`;
        tile.style.transform = `scale(${0.55 + p.size * 0.11})`;
      };
      panel.on(apply);
      apply(panel.params);
    },
  },
  {
    id: "number",
    title: "Number",
    prose: `<p><code>{ type: "number" }</code> is a plain numeric field with a
      drag-to-scrub grab handle — for values where a track makes no sense. Drag the
      handle to scrub it, click the field to type. <code>min</code>/<code>max</code>
      clamp; omit them for unbounded.</p>`,
    target: `<div class="num-rotor"><div class="num-rotor-card">12°</div></div>`,
    css: `
      .num-rotor { display: grid; place-items: center; width: 200px; height: 200px; }
      .num-rotor-card { display: grid; place-items: center; width: 120px; height: 120px; border-radius: 18px;
                        background: #7C5CFF; color: #fff; font-weight: 600; font-size: 18px;
                        transform: rotate(12deg); box-shadow: 0 14px 44px var(--demo-shadow); }`,
    run: ({ tweaks, mount, target }) => {
      const card = target.querySelector(".num-rotor-card");
      const panel = tweaks("Number", {
        angle: { type: "number", value: 12, min: -180, max: 180, step: 1 },
      });
      mount.append(panel.el);

      const apply = (p) => {
        card.style.transform = `rotate(${p.angle}deg)`;
        card.textContent = `${p.angle}°`;
      };
      panel.on(apply);
      apply(panel.params);
    },
  },
  {
    id: "interval",
    title: "Interval",
    prose: `<p>A dual-handle range. Shorthand <code>[[lo, hi], min, max, step?]</code> —
      the first entry being a 2-tuple is what marks it as an interval. The value on
      <code>params</code> is a <code>[lo, hi]</code> pair; here it gates which bars count
      as “in range”.</p>`,
    target: `<div class="num-bars"></div>`,
    css: `
      .num-bars { display: flex; align-items: flex-end; gap: 4px; width: 100%; height: 160px; padding: 0 6px; }
      .num-bar { flex: 1; min-width: 3px; border-radius: 3px 3px 0 0; background: var(--demo-bar);
                 transition: background 0.15s; }
      .num-bar-hot { background: #7C5CFF; }`,
    run: ({ tweaks, mount, target }) => {
      const strip = target.querySelector(".num-bars");
      const heights = Array.from({ length: 28 }, (_, i) => 12 + 84 * Math.abs(Math.sin(i * 0.6 + 1)));
      const bars = heights.map((h) => {
        const b = document.createElement("div");
        b.className = "num-bar";
        b.style.height = `${h}%`;
        strip.append(b);
        return b;
      });
      const panel = tweaks("Interval", {
        band: [[30, 70], 0, 100, 1],   // [[lo, hi], min, max, step]
      });
      mount.append(panel.el);

      const apply = (p) => bars.forEach((b, i) =>
        b.classList.toggle("num-bar-hot", heights[i] >= p.band[0] && heights[i] <= p.band[1]));
      panel.on(apply);
      panel.ready.then(() => apply(panel.params)); // interval loads lazily
    },
  },
  {
    id: "point",
    title: "Point",
    prose: `<p>An n-dimensional vector — one scrubbable field per component, plus a
      draggable 2D pad for the first two (on by default; <code>pad: false</code> opts
      out). The value is a plain map of component keys. Add a third component for 3D, a
      fourth for 4D; the pad stays 2D, the fields stack.</p>`,
    target: `<div class="num-field"><div class="num-dot"></div></div>`,
    css: `
      .num-field { position: relative; width: 220px; height: 220px; border-radius: 16px;
                   background: var(--demo-fill-soft); border: 1px solid var(--demo-line);
                   background-image: linear-gradient(var(--demo-grid) 1px, transparent 1px),
                                     linear-gradient(90deg, var(--demo-grid) 1px, transparent 1px);
                   background-size: 22px 22px; }
      .num-dot { position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin: -9px;
                 border-radius: 50%; background: #7C5CFF; box-shadow: 0 0 24px #7C5CFF; }`,
    run: ({ tweaks, mount, target }) => {
      const dot = target.querySelector(".num-dot");
      const panel = tweaks("Point", {
        offset: { type: "point", pad: true, components: [
          { key: "x", label: "X", value: 0, min: -1, max: 1, step: 0.01 },
          { key: "y", label: "Y", value: 0, min: -1, max: 1, step: 0.01 },
        ] },
      });
      mount.append(panel.el);

      const apply = (p) => {
        dot.style.left = `${50 + p.offset.x * 45}%`;
        dot.style.top = `${50 + p.offset.y * 45}%`;
      };
      panel.on(apply);
      panel.ready.then(() => apply(panel.params)); // point loads lazily
    },
  },
];
