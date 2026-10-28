// ── Monitor + FPS graph — live sparkline / readout. Lazy; registers both types.
import { el, txt, clamp, blade, json, registerControl, words } from "../shared.js";
import { fitCanvas, accentColor } from "../heavy.js";
import type { Meta } from "../schema.js";

// NaN means no sample yet: the pen lifts rather than drawing a false zero.
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

// Manual, not onLive: these blades idle through the built-but-not-mounted window, which onLive would read as gone.
const watchReflow = (fn: () => void) => {
  for (const t of ["resize", "twk-reflow"]) window.addEventListener(t, fn);
  return () => { for (const t of ["resize", "twk-reflow"]) window.removeEventListener(t, fn); };
};

// ── Monitor — a number as a sparkline or a readout, a string as a buffer of the last few values; read on an interval
// or, `perFrame` (the FPS graph), once per animation frame. ──
function createMonitor(meta: Meta, perFrame = false) {
  const get: (now?: number) => unknown = typeof meta.get === "function" ? meta.get : () => meta.value;
  // NaN would make setInterval a 0 ms busy-poll
  const interval = Math.max(30, Number.isFinite(+meta.interval) ? +meta.interval : 200);
  let probe: unknown; try { probe = get(); } catch {}
  const isNum = typeof probe === "number";
  const graph = meta.view === "graph" || (isNum && meta.graph !== false && meta.view !== "text" && meta.rows == null);

  const wrap = el("div", "twk-fps twk-monitor");
  const val = txt("span", "twk-fps-val", "—");
  wrap.append(txt("span", "twk-fps-label", meta.label ?? words()("monitor", "Monitor")), val);

  let timer = 0, raf = 0, unwatch = () => {}, wasConnected = false;
  // toFixed throws past 100; a missing value reads as a dash.
  const decimals = Number.isFinite(+meta.decimals) ? Math.min(20, Math.max(0, Math.floor(+meta.decimals))) : 2;
  const fmt = (v: unknown) => (v == null ? "—" : typeof v === "number" ? (Number.isInteger(v) || !Number.isFinite(v) ? String(v) : v.toFixed(decimals)) : typeof v === "object" ? json(v) : String(v));
  // Also the blade's `destroy`: a panel torn down before it ever connected can never self-stop below.
  const stop = () => { if (timer) clearInterval(timer); timer = 0; if (raf) cancelAnimationFrame(raf); raf = 0; unwatch(); };
  // Never-mounted-yet idles the tick; only a mount-then-remove, or destroy(), stops it. The next frame is booked before
  // the read, so a stop() inside the tick cancels it.
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

  if (!graph && meta.rows) {
    val.remove();
    // A negative or NaN rows spun the trim loop forever.
    const rows = Math.max(1, Math.floor(+meta.rows) || 1);
    const buf = el("pre", "twk-monitor-buffer"); buf.style.setProperty("--twk-monitor-rows", rows);
    wrap.append(buf);
    const lines: string[] = [];
    poll((v) => { lines.push(fmt(v)); while (lines.length > rows) lines.shift(); buf.textContent = lines.join("\n"); });
    return blade(wrap, stop);
  }
  const readout = (v: unknown) => { val.textContent = fmt(v); };
  if (!graph) { poll(readout); return blade(wrap, stop); }

  const canvas = document.createElement("canvas"); canvas.className = "twk-fps-canvas";
  wrap.append(canvas);
  const ctx = canvas.getContext("2d");
  // No 2D context (a headless DOM, a blocked canvas) degrades to the text readout.
  if (!ctx) { poll(readout); return blade(wrap, stop); }
  const N = 80, samples: number[] = new Array(N).fill(NaN);
  let idx = 0, w = 0, h = 0;
  const onResize = () => { [w, h] = fitCanvas(canvas, ctx, 2); };
  unwatch = watchReflow(onResize);
  const draw = () => {
    if (!w) onResize(); // measured 0 while detached: fit on the first live draw
    if (!w) return;
    let lo = meta.min, hi = meta.max;
    if (lo == null || hi == null) {
      let mn = Infinity, mx = -Infinity;
      // an Infinity sample would blank the auto-range
      for (const s of samples) if (Number.isFinite(s)) { if (s < mn) mn = s; if (s > mx) mx = s; }
      if (mn === Infinity) { mn = 0; mx = 1; } else if (mn === mx) { mn -= 0.5; mx += 0.5; }
      const pad = (mx - mn) * 0.1;
      if (lo == null) lo = mn - pad; if (hi == null) hi = mx + pad;
    }
    const span = (hi - lo) || 1;
    strokeSeries(ctx, wrap, w, h, samples, idx, (s) => (s - lo) / span);
  };
  // a non-finite sample shows in the readout, not the graph
  poll((v) => { readout(v); if (typeof v === "number" && Number.isFinite(v)) { samples[idx] = v; idx = (idx + 1) % N; draw(); } });
  return blade(wrap, stop);
}

// ── FPS graph — each frame's timestamp becomes the rate since the last (none on the first or for the probe), 0–120. ──
const frameRate = () => { let last = 0; return (now?: number) => { if (!(now! > 0)) return undefined; const fps = last ? 1000 / (now! - last) : undefined; last = now!; return fps; }; };
// ??: an explicit "" label renders none
const createFps = (meta: Meta) => createMonitor({ ...meta, label: meta.label ?? words()("fps", "FPS"), get: frameRate(), view: "graph", min: 0, max: 120, decimals: 0 }, true);

registerControl("fpsgraph", createFps);
registerControl("monitor", (meta: Meta) => createMonitor(meta)); // the registry passes (meta, onChange), not perFrame
