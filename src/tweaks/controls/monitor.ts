// ── Monitor + FPS graph — live sparkline / readout. Lazy; registers both types.
import { el, fitCanvas, accentColor, clamp, registerControl } from "../shared.js";

// ── FPS graph — a live monitor blade (Tweakpane's FpsGraph), zero deps ──
function createFps(meta) {
  const wrap = el("div", "tw-fps");
  const label = el("span", "tw-fps-label"); label.textContent = meta.label || "FPS";
  const val = el("span", "tw-fps-val"); val.textContent = "—";
  const canvas = document.createElement("canvas"); canvas.className = "tw-fps-canvas";
  wrap.append(label, val, canvas);
  const ctx = canvas.getContext("2d");
  const N = 80, samples = new Array(N).fill(0), MAX = 120;
  let i = 0, last = 0, raf = 0, w = 0, h = 0;
  const resize = () => { [w, h] = fitCanvas(canvas, ctx, 2); };
  const draw = () => {
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = accentColor(wrap);
    ctx.lineWidth = 1.5; ctx.lineJoin = "round"; ctx.beginPath();
    for (let k = 0; k < N; k++) {
      const s = samples[(i + k) % N];
      const x = (k / (N - 1)) * w, y = h - Math.min(s / MAX, 1) * h;
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  };
  const tick = (now) => {
    if (!canvas.isConnected) { window.removeEventListener("resize", resize); raf = 0; return; } // panel rebuilt → stop the loop + its resize listener
    if (last) { const fps = 1000 / (now - last); samples[i] = fps; i = (i + 1) % N; val.textContent = Math.round(fps); draw(); }
    last = now; raf = requestAnimationFrame(tick);
  };
  requestAnimationFrame(() => { resize(); raf = requestAnimationFrame(tick); });
  window.addEventListener("resize", resize);
  return { el: wrap, set: () => {}, get: () => undefined };
}

// ── Monitor — poll any getter on an interval and show it: a number as a sparkline
// (auto-ranged, or pinned with min/max) or a rolling readout, a string as a buffer
// of the last few values. The FPS graph is the per-frame special case (createFps);
// this is the general one (Tweakpane's graph/buffer monitor, leva's monitor()). ──
function createMonitor(meta) {
  const get = typeof meta.get === "function" ? meta.get : () => meta.value;
  const interval = Math.max(30, Number.isFinite(+meta.interval) ? +meta.interval : 200); // a non-finite interval would make setInterval(…, NaN) a 0 ms busy-poll
  let probe; try { probe = get(); } catch {}
  const isNum = typeof probe === "number";
  const graph = meta.view === "graph" || (isNum && meta.graph !== false && meta.view !== "text" && meta.rows == null);

  const wrap = el("div", "tw-fps tw-monitor");
  const label = el("span", "tw-fps-label"); label.textContent = meta.label || "Monitor";
  const val = el("span", "tw-fps-val"); val.textContent = "—";
  wrap.append(label, val);

  let timer = 0, onResize = () => {};
  const fmt = (v) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(meta.decimals ?? 2)) : String(v));
  const stop = () => { if (timer) clearInterval(timer); timer = 0; window.removeEventListener("resize", onResize); };
  const poll = (fn) => { timer = setInterval(() => { if (!wrap.isConnected) return stop(); let v; try { v = get(); } catch { return; } fn(v); }, interval); };

  // String buffer (multiline) — the last `rows` values, newest at the bottom.
  if (!graph && meta.rows) {
    val.remove();
    const buf = el("pre", "tw-monitor-buffer"); buf.style.setProperty("--tw-monitor-rows", meta.rows);
    wrap.append(buf);
    const lines = [];
    poll((v) => { lines.push(fmt(v)); while (lines.length > meta.rows) lines.shift(); buf.textContent = lines.join("\n"); });
    return { el: wrap, set: () => {}, get: () => undefined };
  }
  // Plain readout — just the latest value, refreshed on the interval.
  if (!graph) { poll((v) => { val.textContent = fmt(v); }); return { el: wrap, set: () => {}, get: () => undefined }; }

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
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = accentColor(wrap);
    ctx.lineWidth = 1.5; ctx.lineJoin = "round"; ctx.beginPath();
    let started = false;
    for (let k = 0; k < N; k++) {
      const s = samples[(idx + k) % N];
      if (Number.isNaN(s)) continue;
      const x = (k / (N - 1)) * w, y = h - clamp((s - lo) / span, 0, 1) * h;
      started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), started = true);
    }
    ctx.stroke();
  };
  poll((v) => { if (typeof v !== "number") return; samples[idx] = v; idx = (idx + 1) % N; val.textContent = fmt(v); draw(); });
  requestAnimationFrame(() => { onResize(); draw(); });
  window.addEventListener("resize", onResize);
  return { el: wrap, set: () => {}, get: () => undefined };
}

registerControl("fpsgraph", createFps);
registerControl("monitor", createMonitor);

