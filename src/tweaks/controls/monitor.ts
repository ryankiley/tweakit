// ── Monitor + FPS graph — live sparkline / readout. Lazy; registers both types.
import { el, txt, fitCanvas, accentColor, clamp, blade, registerControl } from "../shared.js";

// Stroke a ring buffer of samples across the canvas — the FPS graph and the numeric
// monitor share the pen; each maps a sample to a 0-1 fraction its own way. NaN = no
// sample yet: the pen lifts, so a sparse buffer draws segments, not a false zero line.
const strokeSeries = (ctx, node, w, h, samples, start, frac) => {
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

// ── FPS graph — a live monitor blade, zero deps ──
function createFps(meta) {
  const wrap = el("div", "tw-fps");
  const val = txt("span", "tw-fps-val", "—");
  const canvas = document.createElement("canvas"); canvas.className = "tw-fps-canvas";
  wrap.append(txt("span", "tw-fps-label", meta.label || "FPS"), val, canvas);
  const ctx = canvas.getContext("2d");
  const N = 80, samples = new Array(N).fill(0), MAX = 120;
  let i = 0, last = 0, raf = 0, w = 0, h = 0, wasConnected = false, stopped = false;
  const resize = () => { [w, h] = fitCanvas(canvas, ctx, 2); };
  // Release everything: the rAF loop and its two listeners. Called on a real unmount
  // (below) AND handed to the panel as the blade's `destroy`, so a panel torn down
  // before it ever connected — which the "never mounted yet" branch below deliberately
  // idles through, so it can never self-stop — doesn't leave the loop spinning forever.
  const stop = () => { stopped = true; if (raf) cancelAnimationFrame(raf); raf = 0; window.removeEventListener("resize", resize); window.removeEventListener("tw-reflow", resize); };
  const draw = () => { if (w) strokeSeries(ctx, wrap, w, h, samples, i, (s) => s / MAX); };
  const tick = (now) => {
    if (!canvas.isConnected) {
      // "Never mounted yet" (a host builds the panel eagerly, appends panel.el later) is
      // not "removed": idle cheaply until the first connected tick; only a real unmount
      // (or panel.destroy(), via the blade's `destroy`) stops the loop + its listeners.
      if (wasConnected) { stop(); return; }
      last = 0; raf = requestAnimationFrame(tick); return;
    }
    if (!wasConnected) { wasConnected = true; resize(); } // first connected tick → fit the canvas (it measured 0 detached)
    if (last) { const fps = 1000 / (now - last); samples[i] = fps; i = (i + 1) % N; val.textContent = Math.round(fps); draw(); }
    last = now; raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(() => { if (stopped) return; resize(); raf = requestAnimationFrame(tick); }); // held in `raf` (and re-checked) so a destroy() before the first frame can't start the loop behind it
  window.addEventListener("resize", resize);
  window.addEventListener("tw-reflow", resize); // a tab page revealing this control re-fits the canvas (it measured 0 while hidden)
  return blade(wrap, stop);
}

// ── Monitor — poll any getter on an interval and show it: a number as a sparkline
// (auto-ranged, or pinned with min/max) or a rolling readout, a string as a buffer
// of the last few values. The FPS graph is the per-frame special case (createFps);
// this is the general one — a graph/buffer monitor. ──
function createMonitor(meta) {
  const get = typeof meta.get === "function" ? meta.get : () => meta.value;
  const interval = Math.max(30, Number.isFinite(+meta.interval) ? +meta.interval : 200); // a non-finite interval would make setInterval(…, NaN) a 0 ms busy-poll
  let probe; try { probe = get(); } catch {}
  const isNum = typeof probe === "number";
  const graph = meta.view === "graph" || (isNum && meta.graph !== false && meta.view !== "text" && meta.rows == null);

  const wrap = el("div", "tw-fps tw-monitor");
  const val = txt("span", "tw-fps-val", "—");
  wrap.append(txt("span", "tw-fps-label", meta.label || "Monitor"), val);

  let timer = 0, onResize = () => {}, wasConnected = false;
  const fmt = (v) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(meta.decimals ?? 2)) : String(v));
  // Also handed to the panel as the blade's `destroy` — a panel destroyed before it ever
  // connected idles below forever, so it could never clear its own interval on unmount.
  const stop = () => { if (timer) clearInterval(timer); timer = 0; window.removeEventListener("resize", onResize); window.removeEventListener("tw-reflow", onResize); };
  // "Never mounted yet" (a host appends panel.el after building) idles the tick; only a
  // panel that was mounted and then removed — or a panel.destroy() — stops the poll.
  const poll = (fn) => { timer = setInterval(() => { if (!wrap.isConnected) { if (wasConnected) stop(); return; } wasConnected = true; let v; try { v = get(); } catch { return; } fn(v); }, interval); };

  // String buffer (multiline) — the last `rows` values, newest at the bottom.
  if (!graph && meta.rows) {
    val.remove();
    // Sanitise rows like `interval` above: a negative/NaN value spun the trim loop
    // forever (length floors at 0, still > a negative bound) — a hung tab on first poll.
    const rows = Math.max(1, Math.floor(+meta.rows) || 1);
    const buf = el("pre", "tw-monitor-buffer"); buf.style.setProperty("--tw-monitor-rows", rows);
    wrap.append(buf);
    const lines = [];
    poll((v) => { lines.push(fmt(v)); while (lines.length > rows) lines.shift(); buf.textContent = lines.join("\n"); });
    return blade(wrap, stop);
  }
  // Plain readout — just the latest value, refreshed on the interval.
  if (!graph) { poll((v) => { val.textContent = fmt(v); }); return blade(wrap, stop); }

  // Sparkline (numbers).
  const canvas = document.createElement("canvas"); canvas.className = "tw-fps-canvas";
  wrap.append(canvas);
  const ctx = canvas.getContext("2d");
  const N = 80, samples = new Array(N).fill(NaN);
  let idx = 0, w = 0, h = 0;
  onResize = () => { [w, h] = fitCanvas(canvas, ctx, 2); };
  const draw = () => {
    if (!w) onResize();
    if (!w) return;
    let lo = meta.min, hi = meta.max;
    if (lo == null || hi == null) {
      let mn = Infinity, mx = -Infinity;
      for (const s of samples) if (!Number.isNaN(s)) { if (s < mn) mn = s; if (s > mx) mx = s; }
      if (mn === Infinity) { mn = 0; mx = 1; } else if (mn === mx) { mn -= 0.5; mx += 0.5; }
      const pad = (mx - mn) * 0.1;
      if (lo == null) lo = mn - pad; if (hi == null) hi = mx + pad;
    }
    const span = (hi - lo) || 1;
    strokeSeries(ctx, wrap, w, h, samples, idx, (s) => (s - lo) / span);
  };
  poll((v) => { if (typeof v !== "number") return; samples[idx] = v; idx = (idx + 1) % N; val.textContent = fmt(v); draw(); });
  requestAnimationFrame(() => { onResize(); draw(); });
  window.addEventListener("resize", onResize);
  window.addEventListener("tw-reflow", onResize); // a tab page revealing this control re-fits the canvas (it measured 0 while hidden)
  return blade(wrap, stop);
}

registerControl("fpsgraph", createFps);
registerControl("monitor", createMonitor);

