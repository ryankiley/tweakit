/* Motion & curves — the motion control, its spring and bézier pieces, and the plot. */

export const meta = {
  slug: "motion",
  title: "Motion & curves",
  description: "The motion control (an easing or a spring over one value), the spring and bézier editors on their own, and the expression grapher — each driving live motion.",
};

export const intro = `
<p>These controls edit plain config objects — a transition's timing, a spring's parameters,
a CSS easing curve, a function of <code>x</code> — that feed straight into your own
animation code. All of them are lazy-loaded heavy controls.</p>`;

export const examples = [
  {
    id: "motion",
    title: "Motion",
    prose: `<p><code>{ type: "motion" }</code> is one control for a transition's timing: an
      easing curve with a duration, or a spring tuned by feel (duration + bounce), switched
      inside the popover over one value. Either way the param carries the CSS it resolves
      to — <code>duration</code> in ms and an <code>easing</code> string,
      <code>cubic-bezier(…)</code> or a sampled <code>linear(…)</code> for the spring — so
      one <code>transition</code> works in both modes. Tap anywhere on the stage and the
      box goes there with the motion; make the spring bouncier, or switch to an easing.</p>`,
    target: `<div class="mo-stage"><div class="mo-box"></div></div>`,
    css: `
      .mo-stage { position: relative; width: 100%; height: 120px; border-radius: 16px; overflow: hidden; cursor: crosshair;
                  background: var(--demo-fill-soft); border: 1px solid var(--demo-line); touch-action: none; }
      .mo-box { position: absolute; top: 50%; left: 0; width: 40px; height: 40px; margin-top: -20px; border-radius: 11px;
                background: #7C5CFF; box-shadow: 0 6px 18px rgba(124, 92, 255, 0.35); transform: translateX(24px); }`,
    run: ({ tweaks, mount, target }) => {
      const stage = target.querySelector(".mo-stage"), box = target.querySelector(".mo-box");
      const panel = tweaks("Motion", {
        move: { type: "motion", visualDuration: 0.45, bounce: 0.3 },   // or { type: "motion", curve: "ease-out", duration: 240 }
      });
      mount.append(panel.el);

      const apply = (p) => { box.style.transition = `transform ${p.move.duration}ms ${p.move.easing}`; };
      panel.on(apply);
      panel.ready.then(() => apply(panel.params));
      stage.addEventListener("pointerdown", (e) => {
        const r = stage.getBoundingClientRect();
        const x = Math.max(0, Math.min(r.width - 40, e.clientX - r.left - 20)); // the box's left edge, kept inside the stage
        box.style.transform = `translateX(${x}px)`;
      });
    },
  },
  {
    id: "pieces",
    title: "Spring and bézier on their own",
    prose: `<p>When the motion isn't a transition, use the editors inside Motion alone.
      <code>{ type: "spring" }</code> resolves to <code>{ stiffness, damping, mass }</code> for
      a simulation that reads them every frame — the ball here is a tiny integrator.
      <code>{ type: "cubicbezier" }</code> is the bare four-number curve for anything that takes
      a timing function on its own — the dot's keyframe animation.</p>`,
    target: `
      <div class="pc-stage">
        <div class="pc-track"><div class="pc-ball"></div></div>
        <div class="pc-track"><div class="pc-dot"></div></div>
      </div>`,
    css: `
      .pc-stage { display: flex; flex-direction: column; gap: 14px; width: 100%; }
      .pc-track { position: relative; width: 100%; height: 56px; border-radius: 14px;
                  background: var(--demo-fill-soft); border: 1px solid var(--demo-line); }
      .pc-ball { position: absolute; top: 50%; left: 8px; width: 30px; height: 30px; margin-top: -15px;
                 border-radius: 50%; background: #7C5CFF; box-shadow: 0 0 26px rgba(124, 92, 255, 0.55); }
      .pc-dot { position: absolute; top: 50%; width: 26px; height: 26px; margin-top: -13px; border-radius: 50%;
                background: #ff8a5b; animation: pc-pingpong 1.2s cubic-bezier(0.25, 0.1, 0.25, 1) infinite alternate; }
      @keyframes pc-pingpong { from { left: 8px; } to { left: calc(100% - 34px); } }`,
    run: ({ tweaks, mount, target }) => {
      const ball = target.querySelector(".pc-ball"), dot = target.querySelector(".pc-dot");
      let x = 0, vel = 0, dest = 0, raf = 0;
      const panel = tweaks("Pieces", {
        spring: { type: "spring", stiffness: 220, damping: 18, mass: 1 },
        send: { type: "button", label: "Send the ball", action: () => { dest = dest ? 0 : 1; go(); } },
        curve: { type: "cubicbezier", value: [0.25, 0.1, 0.25, 1] },
        seconds: { type: "slider", value: 1.2, min: 0.2, max: 3, step: 0.1, unit: "s" },
      });
      mount.append(panel.el);

      const go = () => {
        cancelAnimationFrame(raf);
        const tick = () => {
          const { stiffness, damping, mass } = panel.params.spring;
          vel += ((-stiffness * (x - dest) - damping * vel) / mass) / 60;
          x += vel / 60;
          ball.style.left = `calc(8px + ${x} * (100% - 46px))`;
          if (Math.abs(vel) + Math.abs(x - dest) > 0.0005) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      };
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
      <code>fn</code> instead to graph one of your own functions (read-only), or
      <code>editable: false</code> to drop the field and keep a fixed expression, and
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
