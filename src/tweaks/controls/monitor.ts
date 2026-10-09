// ── Monitor + FPS graph — live sparkline / readout. Lazy; registers both types.
import { el, txt, fitCanvas, accentColor, clamp, blade, json, registerControl } from "../shared.js";
import type { Meta } from "../schema.js";

// Stroke a ring buffer of samples across the canvas, each mapped to a 0-1 fraction by
// `frac`. NaN = no sample yet: the pen lifts, so a sparse buffer draws segments, not a
// false zero line.
const strokeSeries = (ctx: CanvasRenderingContext2D, node: Element, w: number, h: number, samples: number[], start: number, frac: (s: number) => number) => {
  const N = samples.length;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = accentColor(node);
  ctx.lineWidth = 1.5; ctx.lineJoin = "round"; ctx.beginPath();
  let pen = false;
  for (let k = 0; k < N; k++) {
    const s = samples[(start + k) % N];
    if (Number.isNaN(s)) continue;
    const x = (k / (N - 1)) * w, y = h - clamp(frac(s), 0, 1) * h;
    pen ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), pen = true);
  }
  ctx.stroke();
};

// Re-fit a canvas on window resize and on tw-reflow (a tab page revealing the control —
// it measured 0 while hidden); returns the release. Manual, not onLive: these blades idle
// through the "built but not mounted yet" window, which onLive would read as gone.
const watchReflow = (fn: () => void) => {
  for (const t of ["resize", "tw-reflow"]) window.addEventListener(t, fn);
  return () => { for (const t of ["resize", "tw-reflow"]) window.removeEventListener(t, fn); };
};

// ── Monitor — read a getter and show it: a number as a sparkline (auto-ranged, or pinned
// with min/max) or a rolling readout, a string as a buffer of the last few values. Read
// on an interval, or — `perFrame`, the FPS graph — once per animation frame, the getter
// handed the frame's timestamp. One blade, one loop, one teardown for both. ──
function createMonitor(meta: Meta, perFrame = false) {
  const get: (now?: number) => unknown = typeof meta.get === "function" ? meta.get : () => meta.value;
  const interval = Math.max(30, Number.isFinite(+meta.interval) ? +meta.interval : 200); // a non-finite interval would make setInterval(…, NaN) a 0 ms busy-poll
  let probe: unknown; try { probe = get(); } catch {}
  const isNum = typeof probe === "number";
  const graph = meta.view === "graph" || (isNum && meta.graph !== false && meta.view !== "text" && meta.rows == null);

  const wrap = el("div", "tw-fps tw-monitor");
  const val = txt("span", "tw-fps-val", "—");
  wrap.append(txt("span", "tw-fps-label", meta.label ?? "Monitor"), val);

  let timer = 0, raf = 0, unwatch = () => {}, wasConnected = false;
  // `decimals` is clamped to what a readout can show (toFixed throws past 100 and nothing
  // wants more than 20); a missing value reads as a dash, not the word "undefined".
  const decimals = Number.isFinite(+meta.decimals) ? Math.min(20, Math.max(0, Math.floor(+meta.decimals))) : 2;
  const fmt = (v: unknown) => (v == null ? "—" : typeof v === "number" ? (Number.isInteger(v) || !Number.isFinite(v) ? String(v) : v.toFixed(decimals)) : typeof v === "object" ? json(v) : String(v));
  // Release the loop and its listeners. Called on a real unmount (below) AND handed to the
  // panel as the blade's `destroy`, so a panel torn down before it ever connected — which
  // the "never mounted yet" branch below deliberately idles through, so it can never
  // self-stop — doesn't leave the loop running forever.
  const stop = () => { if (timer) clearInterval(timer); timer = 0; if (raf) cancelAnimationFrame(raf); raf = 0; unwatch(); };
  // "Never mounted yet" (a host appends panel.el after building) idles the tick; only a
  // panel that was mounted and then removed — or a panel.destroy() — stops it. The next
  // frame is booked before the read, so a stop() from anywhere in the tick cancels it.
  const poll = (fn: (v: unknown) => void) => {
    const tick = (now?: number) => {
      if (perFrame) raf = requestAnimationFrame(tick);
      if (!wrap.isConnected) { if (wasConnected) stop(); return; }
      wasConnected = true;
      let v: unknown; try { v = get(now); } catch { return; }
      fn(v);
    };
    if (perFrame) raf = requestAnimationFrame(tick); else timer = setInterval(tick, interval);
  };

  // String buffer (multiline) — the last `rows` values, newest at the bottom.
  if (!graph && meta.rows) {
    val.remove();
    // Sanitise rows like `interval` above: a negative/NaN value spun the trim loop
    // forever (length floors at 0, still > a negative bound) — a hung tab on first poll.
    const rows = Math.max(1, Math.floor(+meta.rows) || 1);
    const buf = el("pre", "tw-monitor-buffer"); buf.style.setProperty("--tw-monitor-rows", rows);
    wrap.append(buf);
    const lines: string[] = [];
    poll((v) => { lines.push(fmt(v)); while (lines.length > rows) lines.shift(); buf.textContent = lines.join("\n"); });
    return blade(wrap, stop);
  }
  // Plain readout — just the latest value, refreshed on the interval.
  if (!graph) { poll((v) => { val.textContent = fmt(v); }); return blade(wrap, stop); }

  // Sparkline (numbers).
  const canvas = document.createElement("canvas"); canvas.className = "tw-fps-canvas";
  wrap.append(canvas);
  const ctx = canvas.getContext("2d");
  // No 2D context (a headless DOM, a blocked canvas) degrades to the text readout; the
  // poll below still updates it.
  if (!ctx) { poll((v) => { val.textContent = fmt(v); }); return blade(wrap, stop); }
  const N = 80, samples: number[] = new Array(N).fill(NaN);
  let idx = 0, w = 0, h = 0;
  const onResize = () => { [w, h] = fitCanvas(canvas, ctx, 2); };
  unwatch = watchReflow(onResize);
  const draw = () => {
    if (!w) onResize(); // the canvas measured 0 while detached — fit it on the first connected draw
    if (!w) return;
    let lo = meta.min, hi = meta.max;
    if (lo == null || hi == null) {
      let mn = Infinity, mx = -Infinity;
      for (const s of samples) if (Number.isFinite(s)) { if (s < mn) mn = s; if (s > mx) mx = s; } // an Infinity sample would blank the auto-range for the whole buffer
      if (mn === Infinity) { mn = 0; mx = 1; } else if (mn === mx) { mn -= 0.5; mx += 0.5; }
      const pad = (mx - mn) * 0.1;
      if (lo == null) lo = mn - pad; if (hi == null) hi = mx + pad;
    }
    const span = (hi - lo) || 1;
    strokeSeries(ctx, wrap, w, h, samples, idx, (s) => (s - lo) / span);
  };
  poll((v) => { if (typeof v !== "number" || !Number.isFinite(v)) { val.textContent = fmt(v); return; } samples[idx] = v; idx = (idx + 1) % N; val.textContent = fmt(v); draw(); }); // a non-finite sample shows in the readout but stays out of the graph
  return blade(wrap, stop);
}

// ── FPS graph — the per-frame monitor: the getter turns each frame's timestamp into the
// rate since the last one (nothing on the first, and nothing for the construction-time
// probe, which carries no timestamp), pinned to a 0–120 range, read out as a whole number. ──
const frameRate = () => { let last = 0; return (now?: number) => { if (!(now! > 0)) return undefined; const fps = last ? 1000 / (now! - last) : undefined; last = now!; return fps; }; };
const createFps = (meta: Meta) => createMonitor({ ...meta, label: meta.label ?? "FPS", get: frameRate(), view: "graph", min: 0, max: 120, decimals: 0 }, true); // ??: an explicit "" label renders none

registerControl("fpsgraph", createFps);
registerControl("monitor", (meta: Meta) => createMonitor(meta)); // the registry's constructors take (meta, onChange); the per-frame switch is the FPS wrapper's alone
