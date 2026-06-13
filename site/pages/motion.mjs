/* Motion & curves — spring, cubicbezier, plot. */

export const meta = {
  slug: "motion",
  title: "Motion & curves",
  description: "The spring tuner, cubic-bézier easing editor and expression grapher — each driving live motion.",
};

export const intro = `
<p>These controls edit plain config objects — a spring's physical parameters, a CSS
easing curve, a function of <code>x</code> — that feed straight into your own animation
code. All three are lazy-loaded heavy controls.</p>`;

export const examples = [
  {
    id: "spring",
    title: "Spring",
    prose: `<p><code>{ type: "spring" }</code> is a stiffness / damping / mass tuner
      with a live settle-curve preview. The param is the plain
      <code>{ stiffness, damping, mass }</code> object — here it drives a tiny integrator.
      Soften the damping, then send the ball.</p>`,
    target: `<div class="spr-track"><div class="spr-ball"></div></div>`,
    css: `
      .spr-track { position: relative; width: 100%; height: 64px; border-radius: 14px;
                   background: var(--demo-fill-soft); border: 1px solid var(--demo-line); }
      .spr-ball { position: absolute; top: 50%; left: 8px; width: 32px; height: 32px; margin-top: -16px;
                  border-radius: 50%; background: #7C5CFF; box-shadow: 0 0 26px rgba(124, 92, 255, 0.55); }`,
    run: ({ tweaks, mount, target }) => {
      const ball = target.querySelector(".spr-ball");
      let x = 0, vel = 0, dest = 0, raf = 0;
      const panel = tweaks("Spring", {
        motion: { type: "spring", stiffness: 220, damping: 18, mass: 1 },
        send: { type: "button", label: "Send it", action: () => { dest = dest ? 0 : 1; go(); } },
      });
      mount.append(panel.el);

      const go = () => {
        cancelAnimationFrame(raf);
        const tick = () => {
          const { stiffness, damping, mass } = panel.params.motion;
          vel += ((-stiffness * (x - dest) - damping * vel) / mass) / 60;
          x += vel / 60;
          ball.style.left = `calc(8px + ${x} * (100% - 48px))`;
          if (Math.abs(vel) + Math.abs(x - dest) > 0.0005) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      };
    },
  },
  {
    id: "cubicbezier",
    title: "Cubic bézier",
    prose: `<p>A CSS easing editor — drag the two handles, or type into the
      X1/Y1/X2/Y2 fields. The param is the four-number array, ready for
      <code>cubic-bezier(…)</code> anywhere CSS takes a timing function. The dot below
      ping-pongs on an infinite animation; the curve is applied live.</p>`,
    target: `<div class="bez-track"><div class="bez-dot"></div></div>`,
    css: `
      .bez-track { position: relative; width: 100%; height: 56px; border-radius: 14px;
                   background: var(--demo-fill-soft); border: 1px solid var(--demo-line); }
      .bez-dot { position: absolute; top: 50%; width: 26px; height: 26px; margin-top: -13px; border-radius: 50%;
                 background: #ff8a5b; animation: bez-pingpong 1.2s cubic-bezier(0.25, 0.1, 0.25, 1) infinite alternate; }
      @keyframes bez-pingpong { from { left: 8px; } to { left: calc(100% - 34px); } }`,
    run: ({ tweaks, mount, target }) => {
      const dot = target.querySelector(".bez-dot");
      const panel = tweaks("Easing", {
        curve: { type: "cubicbezier", value: [0.25, 0.1, 0.25, 1] },
        seconds: [1.2, 0.2, 3, 0.1],
      });
      mount.append(panel.el);

      const apply = (p) => {
        dot.style.animationTimingFunction = `cubic-bezier(${p.curve.join(", ")})`;
        dot.style.animationDuration = `${p.seconds}s`;
      };
      panel.on(apply);
      panel.ready.then(() => apply(panel.params));
    },
  },
  {
    id: "plot",
    title: "Plot",
    prose: `<p>An expression grapher with a safe evaluator — no <code>eval</code>, just a
      small parser over <code>x</code>, the usual math functions and constants. The
      param is the expression string itself; type into the field to regraph. Pass
      <code>fn</code> instead to graph one of your own functions (read-only), and
      <code>xMin</code>/<code>xMax</code>/<code>yMin</code>/<code>yMax</code>/<code>samples</code>
      to frame it.</p>`,
    target: `<code class="plt-readout">params.wave = "sin(x) * exp(-x / 6)"</code>`,
    css: `
      .plt-readout { font-size: 12.5px; color: var(--demo-muted); background: var(--demo-fill);
                     border: 1px solid var(--demo-line); border-radius: 8px; padding: 8px 14px;
                     max-width: 100%; overflow-wrap: anywhere; }`,
    run: ({ tweaks, mount, target }) => {
      const readout = target.querySelector(".plt-readout");
      const panel = tweaks("Plot", {
        wave: { type: "plot", expr: "sin(x) * exp(-x / 6)", xMin: 0, xMax: 12 },
      });
      mount.append(panel.el);

      const apply = (p) => {
        readout.textContent = `params.wave = ${JSON.stringify(p.wave)}`;
      };
      panel.on(apply);
      panel.ready.then(() => apply(panel.params));
    },
  },
];
