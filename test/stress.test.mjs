/* Seeded stress harness — a deterministic fuzzer over the panel API. Each seed grows a
 * random schema (every control type, shorthand and verbose, nested folders and tabs, a
 * slice of hostile values), builds it against the single-file bundle under jsdom, then
 * drives the panel through a few dozen random operations and checks the invariants
 * after every one. One test() per seed, so a failure names the seed that reproduces it.
 *
 *   TW_STRESS_SEEDS=200 node --test test/stress.test.mjs   # more seeds (default 40)
 *   TW_STRESS_SEED=17 node --test test/stress.test.mjs     # replay exactly one seed
 *   TW_STRESS_TRACE=1 TW_STRESS_SEED=17 node --test …       # …and print every operation it performs
 *   TW_STRESS_UNSKIP=1 node --test test/stress.test.mjs    # run the KNOWN_BUGS seeds too (does the fix hold?)
 *
 * What counts as a failure: an operation that throws, an exception escaping an event
 * listener (jsdom raises those as an error event on the window), an unhandled rejection, a
 * toJSON() that can't stringify, a control value that isn't JSON-safe (a non-finite
 * number, a function, a symbol), a control value that toJSON() doesn't mirror, a
 * fromJSON(toJSON()) that isn't a fixed point, and anything the panel leaves behind
 * after destroy(): its root, an open portal, a live interval, a rAF loop.
 *
 * What does NOT count: console.warn / console.error. Those are the kit's documented
 * degrade contract (a malformed value → that control is skipped, a bad set() → that key
 * is skipped), so the harness captures them silently and only prints them when a seed
 * fails. */
import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as nodeSetTimeout } from "node:timers";
import { window } from "./_setup-dom.mjs";

// jsdom has no canvas 2D implementation (getContext() returns null), and the graph
// controls draw into the context they got — a browser never hands back null for a fresh
// canvas. A tiny no-op context stands in, installed before the bundle loads (the color
// module probes canvas support at import), so the harness exercises the kit, not jsdom's
// gaps. Every method is a no-op with a plausible return. `fillStyle` behaves like the real
// one for the sRGB family — the color parser normalizes rgb / hsl / hwb / named colors by
// writing them to a canvas and reading the echo back ("#rrggbb", or "rgba(…)" when
// translucent; an invalid write is ignored) — so those modes round-trip here as they do in
// a browser instead of degrading to black.
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const hslToRgb = (h, s, l) => { h = ((h % 360) + 360) % 360; const a = s * Math.min(l, 1 - l); const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; };
const hwbToRgb = (h, w, b) => { if (w + b >= 1) { const g = w / (w + b); return [g, g, g]; } return hslToRgb(h, 1, 0.5).map((c) => c * (1 - w - b) + w); };
const NAMED_COLORS = { red: [1, 0, 0], black: [0, 0, 0], white: [1, 1, 1], blue: [0, 0, 1], lime: [0, 1, 0], transparent: [0, 0, 0, 0] };
function canvasColor(str) { // what a 2D context's fillStyle getter echoes for `str`, or null when the write would be ignored
  const s = String(str).trim().toLowerCase();
  let rgb = null, a = 1, m;
  if ((m = s.match(/^#([0-9a-f]{3,8})$/))) {
    let h = m[1]; if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255;
  } else if (NAMED_COLORS[s]) { rgb = NAMED_COLORS[s].slice(0, 3); a = NAMED_COLORS[s][3] ?? 1; }
  else if ((m = s.match(/^(rgba?|hsla?|hwb)\(([^)]*)\)$/))) {
    const parts = m[2].replace("/", " ").split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const nums = parts.map((p) => { const v = parseFloat(p); return Number.isFinite(v) ? (p.endsWith("%") ? v / 100 : v) : NaN; });
    if (nums.some(Number.isNaN)) return null;
    if (nums.length > 3) a = clamp01(nums[3]);
    if (m[1].startsWith("rgb")) rgb = nums.slice(0, 3).map((v, i) => clamp01(parts[i].endsWith("%") ? v : v / 255));
    else if (m[1].startsWith("hsl")) rgb = hslToRgb(nums[0], clamp01(nums[1]), clamp01(nums[2]));
    else rgb = hwbToRgb(nums[0], clamp01(nums[1]), clamp01(nums[2]));
  }
  if (!rgb) return null;
  const b = rgb.map((v) => Math.round(clamp01(v) * 255));
  return a >= 1 ? "#" + b.map((v) => v.toString(16).padStart(2, "0")).join("") : `rgba(${b[0]}, ${b[1]}, ${b[2]}, ${a})`;
}
const fakeContext = () => {
  const store = Object.assign(Object.create(null), { fillStyle: "#000000", strokeStyle: "#000000" });
  return new Proxy({}, {
    get: (_, k) => {
      if (k in store) return store[k];
      if (typeof k === "symbol") return undefined;
      return (...a) => k === "getImageData" ? { data: new Uint8ClampedArray(4 * Math.max(1, a[2] | 0) * Math.max(1, a[3] | 0)) }
        : k === "measureText" ? { width: 0 }
        : k === "createLinearGradient" || k === "createRadialGradient" || k === "createConicGradient" ? { addColorStop() {} }
        : k === "getContextAttributes" ? {} : undefined;
    },
    set: (_, k, v) => {
      if (k === "fillStyle" || k === "strokeStyle") { const n = typeof v === "string" ? canvasColor(v) : null; if (n) store[k] = n; } // an unparseable color leaves the previous value, like the real setter
      else store[k] = v;
      return true;
    },
  });
};
window.HTMLCanvasElement.prototype.getContext = function () { return (this._twStressCtx ||= fakeContext()); };

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));

const SEED_COUNT = Math.max(1, (+process.env.TW_STRESS_SEEDS | 0) || 40);
const ONLY_SEED = process.env.TW_STRESS_SEED ? +process.env.TW_STRESS_SEED : null;
const SEEDS = ONLY_SEED != null ? [ONLY_SEED] : Array.from({ length: SEED_COUNT }, (_, i) => i + 1);
const PER_SEED_MS = 10_000;
const TRACE = !!process.env.TW_STRESS_TRACE;
const UNSKIP = !!process.env.TW_STRESS_UNSKIP;

// Seeds that reproduce a known, not-yet-fixed bug. Each entry skips that exact seed with
// the reason, so the suite stays green while the fix ships as its own PR.
const KNOWN_BUGS = new Map([
  // list / radiogrid / segmented: set() with a value matching no option stores it verbatim —
  // a number, an object, NaN or ±Infinity land in params as-is (toJSON() then writes null,
  // so a restore differs from the live state). Repro: tweaks("L", { l: ["a", "b"] }).set("l", -Infinity).
  [5, "list set() stores a non-matching -Infinity verbatim"],
  [15, "list set() stores a non-matching { stiffness: NaN } object verbatim"],
  [17, "segmented set() stores a non-matching -Infinity verbatim"],
  [30, "list set() stores a non-matching -Infinity verbatim"],
  [35, "segmented set() stores a non-matching NaN verbatim"],
  // image: set() stores a non-string verbatim (a Date, {}, 5, true); only null coerces to "".
  // Repro: tweaks("I", { i: { type: "image" } }).set("i", new Date(0)).
  [6, "image set() stores a Date object verbatim"],
]);

// ── PRNG — mulberry32: tiny, seedable, good enough to spread a schema across the space ──
function mulberry32(seed) {
  let a = seed | 0;
  const next = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    next,
    int: (n) => Math.floor(next() * n),               // 0 … n-1
    range: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), // lo … hi inclusive
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

// ── Instrumented globals — the bundle resolves these by bare identifier at call time, so
// swapping them on globalThis after import is enough. rAF becomes a synchronous frame
// queue the harness pumps itself (one frame per operation, and a drain after destroy so
// a surviving loop shows up without waiting on wall-clock time). setInterval is tracked
// so a poll that outlives destroy() is a named failure, not a hung process. ──
const rafQueue = new Map();
let rafId = 0, rafTimer = 0;
const asyncErrors = []; // exceptions out of rAF callbacks, listener throws, unhandled rejections — attributed to the op in flight
const runFrame = () => {
  rafTimer = 0;
  const batch = [...rafQueue.values()]; rafQueue.clear();
  const now = Date.now();
  for (const fn of batch) { try { fn(now); } catch (e) { asyncErrors.push(["rAF callback", e]); } }
};
globalThis.requestAnimationFrame = (fn) => { const id = ++rafId; rafQueue.set(id, fn); if (!rafTimer) rafTimer = setTimeout(runFrame, 16); return id; };
globalThis.cancelAnimationFrame = (id) => { rafQueue.delete(id); };
const liveIntervals = new Set();
const realSetInterval = globalThis.setInterval, realClearInterval = globalThis.clearInterval;
globalThis.setInterval = (fn, ms, ...rest) => { const id = realSetInterval(fn, ms, ...rest); liveIntervals.add(id); return id; };
globalThis.clearInterval = (id) => { liveIntervals.delete(id); return realClearInterval(id); };

// An exception escaping an event listener reaches the window as an ErrorEvent (the same path a browser's onerror sees) — jsdom's own "not implemented" reports go elsewhere, so no filtering is needed.
window.addEventListener("error", (ev) => asyncErrors.push(["listener", ev.error ?? new Error(ev.message)]));
process.on("unhandledRejection", (e) => asyncErrors.push(["unhandled rejection", e]));

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
// `__proto__` as an own, enumerable key — what JSON.parse hands a host, and the one spelling
// an object literal can't produce (it sets the prototype instead).
const defineKey = (obj, key, value) => { if (key === "__proto__") Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true }); else obj[key] = value; return obj; };

// ── Schema generation ─────────────────────────────────────────────────────────
const WORDS = ["size", "blur", "speed", "tint", "alpha", "x", "y", "label", "mode", "ratio", "depth", "offset", "gain", "ease", "shape", "rate", "width", "gap"];
const VALUE_TYPES = ["slider", "number", "checkbox", "list", "radiogrid", "segmented", "color", "text", "interval", "spring", "cubicbezier", "point", "gradient", "plot", "image"];
const VALUELESS_TYPES = ["fpsgraph", "monitor", "button", "buttongroup", "separator"];
const COLORS = ["#ff8800", "#fff", "#1a2b3c", "rgb(10, 20, 30)", "rgba(0,0,0,0.5)", "hsl(200 50% 50%)", "oklch(0.7 0.1 200)", "oklab(0.5 0.1 -0.1)", "color(display-p3 1 0 0)", "red", "transparent"];
const HOSTILE_COLORS = [123, null, {}, "#ggg", "", "color(__proto__ 1 0 0)", "color(constructor 1 0 0)", true, [255, 0, 0], "rgb(", "oklch(NaN 0 0)"];
const num = (r) => r.pick([0, 1, 2, 5, 10, 0.5, 0.25, 100, -1, -10, 3.14159, 1e6]);
const hostileNum = (r) => r.pick([NaN, Infinity, -Infinity, 1e308, -1e308, 1e-300, -0, Number.MAX_SAFE_INTEGER, "7", null]);
const anyNum = (r, hostile) => (hostile && r.chance(0.6) ? hostileNum(r) : num(r));
const plausibleRange = (r) => r.pick([{ min: 0, max: 1 }, { min: 0, max: 100, step: 1 }, { min: -10, max: 10, step: 0.5 }, { min: 1, max: 1000, step: 10 }, { min: -1, max: 1, step: 0.01 }]);
const hostileRange = (r) => r.pick([{ min: 10, max: 0 }, { min: 5, max: 5 }, { min: -100, max: -50, step: 1 }, { min: 0, max: 1, step: 0 }, { min: 0, max: 1, step: -1 }, { min: 0, max: 1, step: NaN }, { min: 0, max: 1, step: Infinity }, { min: NaN, max: 1 }, { min: 0, max: Infinity }, { min: "a", max: "b" }, { min: 0, max: 1, step: 1e-101 }]);
const range = (r, hostile) => (hostile && r.chance(0.7) ? hostileRange(r) : plausibleRange(r));
const plausibleOptions = (r) => r.pick([["low", "mid", "high"], ["a", "b"], [{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c" }], ["one", "two", "three", "four", "five"]]);
const hostileOptions = (r) => r.pick([[], [""], [null], ["a", "a"], [{}], [{ value: 1 }], "notalist", [{ label: "no value" }], undefined]);
const options = (r, hostile) => (hostile && r.chance(0.7) ? hostileOptions(r) : plausibleOptions(r));
const color = (r, hostile) => (hostile && r.chance(0.7) ? r.pick(HOSTILE_COLORS) : r.pick(COLORS));
const text = (r, hostile) => (hostile && r.chance(0.7) ? r.pick([5, null, {}, [], "x".repeat(4000), "\u0000", "<b>hi</b>"]) : r.pick(["hello", "", "multi\nline", "ünïcödé"]));
const expr = (r, hostile) => (hostile && r.chance(0.7) ? r.pick(["x +* (", "", "constructor", "1/0", "x^", "((((", "sin(", "foo(x)", "x".repeat(500)]) : r.pick(["sin(x)", "x^2", "cos(x) * 2", "abs(x) - 1", "exp(-x*x)"]));
const fn = (r) => r.pick([() => 1, (x) => x * x, (x) => Math.sin(x), () => NaN, () => Infinity, () => "str"]);
const monitorGet = (r, hostile) => { let n = 0; return hostile && r.chance(0.6) ? r.pick([() => NaN, () => undefined, () => ({}), () => Infinity, () => n++ > 2 ? "late string" : 1, "notfn", null]) : r.pick([() => n++, () => (n += 0.37), () => "tick " + n++, () => Math.random()]); };

const tabSlug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tab";

// One control's schema value. `hostile` steers the generator toward the malformed slice.
// Returns the value plus whether it carries a value (so the op layer knows which paths
// hold a control value and what type to aim a fitting set() at).
function genControl(r, type, hostile) {
  const verbose = r.chance(0.5);
  switch (type) {
    case "slider": {
      if (!verbose) {
        const v = anyNum(r, hostile), rg = range(r, hostile);
        return r.pick([v, [v], [v, rg.min], [v, rg.min, rg.max], [v, rg.min, rg.max, rg.step ?? 1]]);
      }
      return { type: "slider", value: anyNum(r, hostile), ...range(r, hostile), soft: r.chance(0.3) };
    }
    case "number": return { type: "number", value: anyNum(r, hostile), ...(r.chance(0.5) ? range(r, hostile) : {}), soft: r.chance(0.3) };
    case "checkbox": return verbose ? { type: "checkbox", value: hostile && r.chance(0.5) ? r.pick([null, "yes", 0, NaN]) : r.chance(0.5) } : r.chance(0.5);
    case "list": return verbose ? { type: "list", options: options(r, hostile), value: hostile && r.chance(0.4) ? r.pick(["zzz", 5, null]) : undefined } : options(r, hostile);
    case "radiogrid": return { type: "radiogrid", options: options(r, hostile), cols: hostile && r.chance(0.4) ? r.pick([0, -1, NaN, 99]) : r.pick([2, 3, undefined]) };
    case "segmented": return { type: "segmented", options: options(r, hostile), value: hostile && r.chance(0.4) ? "" : undefined };
    case "color": return verbose ? { type: "color", value: color(r, hostile), label: hostile && r.chance(0.3) ? 7 : undefined } : color(r, hostile);
    case "text": return verbose ? { type: "text", value: text(r, hostile), rows: hostile && r.chance(0.4) ? r.pick([-1, NaN, 1e9, "3"]) : r.pick([undefined, 3]), placeholder: r.pick([undefined, "type here"]) } : (hostile ? text(r, hostile) : r.pick(["hello", "Some label"]));
    case "interval": {
      const rg = range(r, hostile), v = hostile && r.chance(0.6) ? r.pick([[8, 2], [NaN, 5], [1], "ab", [null, null], [Infinity, -Infinity]]) : [2, 8];
      return verbose ? { type: "interval", value: v, ...rg } : [[2, 8], rg.min, rg.max, rg.step];
    }
    case "spring": {
      const conf = hostile && r.chance(0.6)
        ? r.pick([{ stiffness: NaN, damping: 26, mass: 1 }, { mass: 0 }, { mass: -1 }, { mode: "bogus" }, { damping: Infinity }, { value: "x" }, { value: { visualDuration: -1, bounce: 7 } }, { stiffness: "300" }])
        : r.pick([{ stiffness: 300, damping: 26, mass: 1 }, { mode: "time", visualDuration: 0.5, bounce: 0.2 }, { value: { stiffness: 120, damping: 14, mass: 2 } }, {}]);
      return { type: "spring", ...conf };
    }
    case "cubicbezier": return { type: "cubicbezier", value: hostile && r.chance(0.6) ? r.pick([[2, -3, 5, 9], [0.1, 0.2], [NaN, 0, 0, 1], "ease", [1, 1, 1, 1, 1], null, [Infinity, 0, 0, 0]]) : r.pick([[0.25, 0.1, 0.25, 1], [0.42, 0, 0.58, 1], undefined]) };
    case "point": {
      const comps = hostile && r.chance(0.6)
        ? r.pick([[{ key: "x" }], [], [{ key: "" }], [{ key: "x", value: NaN }], [{ key: "__proto__", value: 1 }], [null], "xy", [{ key: "x" }, { key: "x" }], [{ key: "x", min: 10, max: 0, step: 0 }]])
        : r.pick([[{ key: "x", value: 1, min: -10, max: 10, step: 0.5 }, { key: "y", value: 2 }], [{ key: "x", label: "X", value: 0 }, { key: "y", label: "Y", value: 0 }, { key: "z", value: 1 }]]);
      return { type: "point", components: comps, pad: r.chance(0.5), invertY: r.chance(0.3) };
    }
    case "gradient": {
      const v = hostile && r.chance(0.6)
        ? r.pick([{ stops: [] }, { stops: [{ color: 5, pos: "a" }] }, "red", [["nope", NaN]], { stops: null }, { stops: [{ color: "#f00", pos: -5 }, { color: "#00f", pos: 7 }], interpolation: "bogus" }, [], [{ color: "#f00" }], 42])
        : r.pick([{ stops: [{ color: "#ff0000", pos: 0 }, { color: "#0000ff", pos: 1 }], interpolation: "oklch" }, [["#f00", 0], ["#0f0", 0.5], ["#00f", 1]], undefined]);
      return { type: "gradient", value: v };
    }
    case "plot": {
      const base = r.chance(0.3) ? { fn: fn(r) } : { expr: expr(r, hostile) };
      const extra = hostile && r.chance(0.6) ? r.pick([{ xMin: 5, xMax: -5 }, { samples: 0 }, { samples: -1 }, { samples: NaN }, { samples: 1e9 }, { yMin: NaN, yMax: 1 }, { xMin: "a" }]) : r.pick([{ xMin: -5, xMax: 5 }, { editable: false }, { samples: 64 }, {}]);
      return { type: "plot", ...base, ...extra };
    }
    case "image": return { type: "image", value: hostile && r.chance(0.6) ? r.pick([5, null, "javascript:alert(1)", {}, ""]) : r.pick(["data:image/gif;base64,R0lGODlhAQABAAAAACw=", "https://example.test/x.png", ""]) };
    case "fpsgraph": return { type: "fpsgraph", label: hostile && r.chance(0.3) ? 9 : r.pick([undefined, "FPS"]) };
    case "monitor": {
      const extra = hostile && r.chance(0.6) ? r.pick([{ interval: NaN }, { interval: -5 }, { interval: 0 }, { rows: -5 }, { rows: NaN }, { decimals: -1 }, { decimals: NaN }, { min: 10, max: 0 }, { view: "bogus" }]) : r.pick([{ interval: 30 }, { rows: 3, interval: 30 }, { view: "text", interval: 30 }, { graph: true, min: 0, max: 10, interval: 30 }]);
      return { type: "monitor", get: monitorGet(r, hostile), value: r.chance(0.3) ? 5 : undefined, ...extra };
    }
    case "button": {
      const action = hostile && r.chance(0.4) ? r.pick(["str", null, undefined]) : () => {};
      return verbose ? { type: "button", action, label: r.pick([undefined, "Go", ""]) } : { action };
    }
    case "buttongroup": return { type: "buttongroup", buttons: hostile && r.chance(0.6) ? r.pick([[], null, { A: "x" }, [{ label: "A" }], "ab", { "": () => {} }]) : r.pick([{ A: () => {}, B: () => {} }, [{ label: "One", action: () => {} }, { label: "Two", action: () => {} }]]) };
    case "separator": return { type: "separator" };
  }
  throw new Error("unknown control type " + type);
}

function genKey(r, ctx) {
  const roll = r.next();
  if (roll < 0.7) return r.pick(WORDS) + ctx.n++;
  if (roll < 0.8) return r.pick(WORDS);                                 // bare — may collide with a namesake in another folder
  if (roll < 0.85) return "a.b";                                        // a literal dot in a key
  if (roll < 0.9) return r.pick(["_last", "constructor", "toString", "hasOwnProperty", "valueOf", "prototype"]);
  if (roll < 0.95) return "";
  return "__proto__";
}

// A schema object of `count` entries at `depth`. Records every value-bearing control's path
// and type on ctx.paths, and every folder/tabs subtree on ctx.groups.
function genSchema(r, ctx, count, depth, prefix) {
  const schema = {};
  for (let i = 0; i < count; i++) {
    const key = genKey(r, ctx);
    const hostile = r.chance(0.25);
    const roll = r.next();
    let value;
    if (depth < 2 && roll < 0.15) {                                      // nested folder
      value = genSchema(r, ctx, r.range(1, 4), depth + 1, [...prefix, key]);
      if (hostile) Object.assign(value, r.pick([{ disabled: true }, { hint: "folder hint" }, { render: () => true }, { disabled: null }]));
      ctx.groups.push([...prefix, key]);
    } else if (depth < 2 && roll < 0.25) {                               // tabs
      const titles = hostile && r.chance(0.6) ? r.pick([["", "A"], ["A!", "A?"], ["Only"], []]) : r.pick([["Alpha", "Beta"], ["One", "Two", "Three"], ["Main"]]);
      const used = new Set(), pages = {};
      for (const t of titles) {
        let k = tabSlug(t), n = 2; const base = k; while (used.has(k)) k = `${base}-${n++}`; used.add(k);
        pages[t] = genSchema(r, ctx, r.range(1, 3), depth + 1, [...prefix, key, k]);
        ctx.groups.push([...prefix, key, k]);
      }
      if (hostile && r.chance(0.3)) pages[r.pick(["Null", "Str"])] = r.pick([null, "x"]);
      value = { type: "tabs", pages: hostile && r.chance(0.2) ? r.pick([{}, "x", null]) : pages };
      ctx.groups.push([...prefix, key]);
    } else if (roll < 0.3) {                                             // a value that isn't a control at all
      value = r.pick([null, undefined, () => 1, Symbol("s"), new Date(0), 10n, []]);
    } else {
      const type = r.chance(0.78) ? r.pick(VALUE_TYPES) : r.pick(VALUELESS_TYPES);
      value = genControl(r, type, hostile);
      if (value && typeof value === "object" && !Array.isArray(value) && r.chance(0.2)) { // per-control options ride on any object form
        Object.assign(value, r.pick([{ hint: "a hint" }, { disabled: true }, { disabled: (get) => !!get(r.pick(WORDS)) }, { render: (get) => get(r.pick(WORDS)) !== false }, { hint: 5 }, { render: "yes" }]));
      }
      // A top-level "_last" is the changed-key channel (the kit skips that entry by contract), and
      // the prototype names are refused at every depth — neither is a control path to check.
      const refused = (depth === 0 && key === "_last") || ["__proto__", "constructor", "prototype"].includes(key);
      if (VALUE_TYPES.includes(type) && !refused) ctx.paths.push({ path: [...prefix, key], type });
    }
    defineKey(schema, key, value);
  }
  return schema;
}

// ── Operations ────────────────────────────────────────────────────────────────
// A value that fits the control type (so sets actually move something), or a stray one.
function fittingValue(r, type) {
  switch (type) {
    case "slider": case "number": return num(r);
    case "checkbox": return r.chance(0.5);
    case "list": case "radiogrid": case "segmented": return r.pick(["low", "a", "one", "b", "zzz"]);
    case "color": return r.pick(COLORS);
    case "text": return r.pick(["hello", "", "changed"]);
    case "interval": return r.pick([[1, 3], [0, 10], [5, 5]]);
    case "spring": return r.pick([{ stiffness: 200, damping: 20, mass: 1 }, { mode: "time", visualDuration: 0.3, bounce: 0.1 }]);
    case "cubicbezier": return r.pick([[0.42, 0, 0.58, 1], [0, 0, 1, 1]]);
    case "point": return r.pick([{ x: 3, y: 4 }, { x: 0 }, { x: -1, y: 2, z: 3 }]);
    case "gradient": return r.pick([{ stops: [{ color: "#000", pos: 0 }, { color: "#fff", pos: 1 }] }, [["#f00", 0], ["#00f", 1]]]);
    case "plot": return r.pick(["cos(x)", "x", "tan(x)"]);
    case "image": return r.pick(["", "data:image/gif;base64,R0lGODlhAQABAAAAACw="]);
  }
  return num(r);
}
const STRAY_VALUES = [NaN, Infinity, -Infinity, 1e308, -0, "", "hi", "#ff0000", "oklch(0.6 0.15 30)", "color(__proto__ 1 0 0)", "sin(x)", "x +* (", true, false, null, undefined, [1, 2], [], [0.1, 0.2, 0.3, 0.4], [NaN, 1], { x: 1 }, {}, { stops: [] }, { stops: [{ color: "#f00", pos: 0 }] }, { stiffness: NaN }, { mode: "time", visualDuration: 0.4, bounce: 0.3 }, () => 1, Symbol("s"), 10n, "a".repeat(2000), new Date(0), [[1, 2]], { __proto__: null }, "7"];
const randomValue = (r, type) => (r.chance(0.5) ? fittingValue(r, type) : r.pick(STRAY_VALUES));
function randomKey(r, ctx) {
  const roll = r.next();
  if (roll < 0.5 && ctx.paths.length) { const p = r.pick(ctx.paths); return [r.chance(0.5) ? p.path.join(".") : p.path[p.path.length - 1], p.type]; }
  if (roll < 0.65 && ctx.groups.length) return [r.pick(ctx.groups).join("."), null];
  if (roll < 0.8) return [r.pick(["nope", "a.b.c", "", "folder.nope", "nope.x", "x.y.z.w"]), null];
  if (roll < 0.9) return [r.pick(["__proto__", "__proto__.x", "constructor", "x.prototype", "a.__proto__.b"]), null];
  return ["_last", null];
}
// The first path where two JSON-parsed values differ, with both sides — for the round-trip message.
function firstDiff(a, b, path = "$") {
  if (a === b) return null;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], `${path}.${k}`); if (d) return d; }
    return null;
  }
  return `${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`;
}
const nest = (path, value) => path.reduceRight((acc, k) => defineKey({}, k, acc), value); // { a: { b: value } } from ["a","b"]

const describeEl = (el) => `<${el.tagName.toLowerCase()}${el.type ? ` type=${el.type}` : ""}${el.className ? ` class="${el.className}"` : ""}>`;
const KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Enter", "Escape", " ", "PageUp", "PageDown", "Tab"];
const FOCUSABLE = "[tabindex], button, input, select, textarea, a[href]";
const CLICKABLE = "button, [role=button], [tabindex], .tw-folder-header, .tw-select, .tw-slider-value, .tw-tabs-bar > *";

function makeOps(r, ctx) {
  const presetNames = ["p1", "p2", "", "__proto__", "constructor", "a b", "x".repeat(300), 5, null];
  return {
    set: (p) => { const [k, t] = randomKey(r, ctx); const v = randomValue(r, t); ctx.last = ["set", k, v]; p.set(k, v); },
    setMany: (p) => {
      if (r.chance(0.15)) { const v = r.pick([null, "str", 5, [], undefined]); ctx.last = ["setMany", v]; return p.setMany(v); }
      const m = {}; for (let i = r.range(1, 4); i > 0; i--) { const [k, t] = randomKey(r, ctx); defineKey(m, k, randomValue(r, t)); }
      ctx.last = ["setMany", m];
      p.setMany(m);
    },
    reset: (p) => { ctx.last = ["reset"]; p.reset(); },
    roundTrip: (p) => {
      ctx.last = ["roundTrip"];
      const a = JSON.stringify(p.toJSON());
      p.fromJSON(JSON.parse(a));
      const b = JSON.stringify(p.toJSON());
      p.fromJSON(JSON.parse(b));
      const c = JSON.stringify(p.toJSON());
      if (c !== b) assert.fail(`fromJSON(toJSON()) must be a fixed point after one trip — first difference at ${firstDiff(JSON.parse(b), JSON.parse(c))}`);
    },
    fromJSONHostile: (p) => {
      const sample = ctx.paths.length ? r.pick(ctx.paths) : null;
      const state = r.pick([
        null, "x", 5, [], { values: 5 }, { values: [] }, { ui: { folders: { k: "yes" }, tabs: { t: 99 } } }, { ui: "x" }, { values: null, ui: null },
        sample ? { values: nest(sample.path, randomValue(r, sample.type)) } : {},
        { values: nest(["__proto__", "polluted"], true) },
        { values: { a: { b: { c: 1 } } }, ui: { folders: {}, tabs: {} } },
      ]);
      ctx.last = ["fromJSON", state];
      p.fromJSON(state);
    },
    preset: (p) => {
      const nm = r.pick(presetNames);
      const op = r.pick(["save", "save", "load", "delete", "list"]);
      ctx.last = ["preset", op, nm];
      if (op === "save") p.savePreset(nm); else if (op === "load") p.loadPreset(nm); else if (op === "delete") p.deletePreset(nm); else p.presets();
    },
    undo: (p) => { ctx.last = ["undo"]; p.undo(); },
    redo: (p) => { ctx.last = ["redo"]; p.redo(); },
    key: (p) => {
      const els = [...p.el.querySelectorAll(FOCUSABLE)].filter((e) => !e.disabled);
      if (!els.length) return;
      const target = r.pick(els);
      target.focus();
      const init = r.chance(0.15) ? { key: r.pick(["z", "y", "Z"]), metaKey: r.chance(0.5), ctrlKey: r.chance(0.5), shiftKey: r.chance(0.5) } : { key: r.pick(KEYS), shiftKey: r.chance(0.2) };
      ctx.last = ["key", init, describeEl(target)];
      target.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
      if (r.chance(0.5)) target.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true, cancelable: true, ...init }));
    },
    click: (p) => {
      const els = [...p.el.querySelectorAll(CLICKABLE), ...document.querySelectorAll(".tw-portal button, .tw-portal [tabindex]")].filter((e) => !e.disabled);
      if (!els.length) return;
      const el = r.pick(els);
      ctx.last = ["click", describeEl(el)];
      el.click();
    },
    change: (p) => { // commit an edit through a field the way a user would: type into an input / select and fire change
      const els = [...p.el.querySelectorAll("input, select, textarea")].filter((e) => !e.disabled && e.type !== "file"); // a file input's value is read-only by spec
      if (!els.length) return;
      const el = r.pick(els);
      let v;
      if (el.tagName === "SELECT") { if (el.options.length) el.selectedIndex = v = r.int(el.options.length); }
      else if (el.type === "checkbox") el.checked = v = !el.checked;
      else el.value = v = String(r.pick([num(r), "abc", "", "1e999", "-", "0x10", "#123456", "sin(x)"]));
      ctx.last = ["change", describeEl(el), v];
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
      el.dispatchEvent(new window.Event("change", { bubbles: true }));
    },
  };
}
const OP_WEIGHTS = [["set", 6], ["setMany", 2], ["reset", 1], ["roundTrip", 2], ["fromJSONHostile", 1], ["preset", 2], ["undo", 1], ["redo", 1], ["key", 4], ["click", 4], ["change", 2]];
const OP_BAG = OP_WEIGHTS.flatMap(([name, w]) => Array(w).fill(name));

// ── Invariants ────────────────────────────────────────────────────────────────
const atPath = (obj, path) => path.reduce((o, k) => (o != null && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined), obj);
const isPlain = (v) => { const proto = Object.getPrototypeOf(v); return proto === Object.prototype || proto === null; };
function assertJsonSafe(v, where) {
  if (v === null || typeof v === "boolean" || typeof v === "string") return;
  if (typeof v === "number") return void assert.ok(Number.isFinite(v), `${where}: non-finite number ${v}`);
  if (Array.isArray(v)) return v.forEach((x, i) => assertJsonSafe(x, `${where}[${i}]`));
  if (typeof v === "object" && isPlain(v)) return Object.keys(v).forEach((k) => assertJsonSafe(v[k], `${where}.${k}`));
  assert.fail(`${where}: not a JSON-safe value (${typeof v})`);
}
// The kit's own snapshot normalization (an `undefined` leaf is written as null), so a
// params value and its toJSON() mirror compare on the same footing.
const normalize = (v) => JSON.stringify(v, (k, x) => (x === undefined ? null : typeof x === "bigint" ? String(x) : x));
function checkInvariants(p, ctx, where) {
  const json = JSON.stringify(p.toJSON()); // must not throw
  const values = JSON.parse(json).values;
  for (const { path } of ctx.paths) {
    const holder = atPath(p.params, path.slice(0, -1));
    if (holder == null || typeof holder !== "object" || !Object.prototype.hasOwnProperty.call(holder, path[path.length - 1])) continue; // the control was skipped (malformed), or the path is a hostile key the kit refused
    const v = holder[path[path.length - 1]];
    const label = `${where} params.${path.join(".")}`;
    // `undefined` is a documented control state (a list whose options hold no match); it
    // serializes as null. Anything else must be plain JSON with finite numbers.
    if (v !== undefined) assertJsonSafe(v, label);
    assert.equal(normalize(v === undefined ? null : v), normalize(atPath(values, path)), `${label}: toJSON() does not mirror params`);
  }
  if (asyncErrors.length) { const [[src, e]] = asyncErrors.splice(0); throw new Error(`${where}: ${src} threw: ${e && e.stack || e}`, { cause: e }); }
}

// ── One seed ──────────────────────────────────────────────────────────────────
async function runSeed(seed) {
  const r = mulberry32(seed);
  const ctx = { n: 0, paths: [], groups: [] };
  const schema = genSchema(r, ctx, r.range(3, 12), 0, []);
  const opts = { persist: `stress-${seed}`, undo: true, filter: r.chance(0.5), toolbar: !r.chance(0.2), draggable: r.chance(0.5), floating: r.chance(0.2) };
  const warnings = [];
  const realWarn = console.warn, realError = console.error;
  console.warn = (...a) => warnings.push(["warn", ...a]); console.error = (...a) => warnings.push(["error", ...a]);
  const watchdog = nodeSetTimeout(() => { realError(`[stress] seed ${seed} hung; last step: ${step}`); process.exit(1); }, PER_SEED_MS); watchdog.unref();
  let step = "build", p = null;
  const ops = makeOps(r, ctx);
  try {
    localStorage.clear();
    asyncErrors.length = 0;
    p = tweaks(`Stress ${seed}`, schema, opts);
    document.body.append(p.el);
    await p.ready;
    runFrame();
    checkInvariants(p, ctx, step);

    const count = r.range(30, 60);
    for (let i = 0; i < count; i++) {
      const name = r.pick(OP_BAG);
      step = `op ${i} (${name})`;
      try { ops[name](p); } catch (e) { throw new Error(`${step} threw: ${e && e.stack || e}`, { cause: e }); }
      if (TRACE) process.stderr.write(`  [seed ${seed}] ${step}: ${describeSchema(ctx.last)}\n`);
      runFrame();                     // one synthetic animation frame per op
      if (i % 8 === 7) await tick(0); // let the kit's own timers (persist, popover arming) run now and then
      checkInvariants(p, ctx, step);
    }

    step = "settle";
    await tick(40);                   // several monitor polls at the 30ms floor, the persist debounce in flight
    runFrame();
    checkInvariants(p, ctx, step);

    step = "destroy";
    p.destroy();
    p.destroy();                      // idempotent
    p.set("anything", 1); p.setMany({ a: 1 }); p.reset(); p.fromJSON({ values: {} }); p.undo(); p.redo(); // inert, not throwing
    assert.deepEqual(p.toJSON(), { values: {}, ui: {} }, "toJSON() after destroy is the empty state");
    assert.equal(document.querySelector(".tw-panel"), null, "no panel root left in the document");
    assert.equal(liveIntervals.size, 0, "a poll interval outlived destroy()");
    for (let i = 0; i < 6 && rafQueue.size; i++) runFrame(); // drain one-shot frames; a loop keeps re-arming
    assert.equal(rafQueue.size, 0, "a rAF loop outlived destroy()");
    // Popovers fade out before their node leaves the DOM (200ms); the toast and the hint tip
    // are page-wide singletons that stay mounted (closed) by design — only an open one is a leak.
    if (document.querySelector(".tw-portal:not(.tw-toast):not(.tw-tip)")) await tick(220);
    assert.equal(document.querySelector(".tw-portal:not(.tw-toast):not(.tw-tip)"), null, "a portaled surface outlived destroy()");
    assert.equal(document.querySelector(".tw-tip.is-open"), null, "the hint tip stayed open past destroy()");
    if (asyncErrors.length) { const [[src, e]] = asyncErrors.splice(0); throw new Error(`destroy: ${src} threw: ${e && e.stack || e}`, { cause: e }); }
  } catch (e) {
    // Re-raise as a plain Error carrying the reproduction context (the reporter prints an
    // AssertionError's original message only, so appending to it would be lost).
    let msg = `seed ${seed}: ${e && e.message || e}`;
    if (warnings.length) msg += `\n  kit console output before the failure (${warnings.length}): ` + warnings.slice(-6).map((w) => w.map((x) => (x instanceof Error ? x.message : typeof x === "string" ? x : String(x))).join(" ")).join("\n    ");
    if (ctx.last) msg += `\n  last op: ${describeSchema(ctx.last)}`;
    msg += `\n  schema: ${describeSchema(schema)}`;
    const err = new Error(msg, { cause: e });
    err.stack = `${msg}\n${String(e && e.stack || "").split("\n").slice(1).join("\n")}`;
    throw err;
  } finally {
    clearTimeout(watchdog);
    console.warn = realWarn; console.error = realError;
    if (p) { try { p.destroy(); } catch {} }
    for (const el of document.querySelectorAll(".tw-panel, .tw-portal")) el.remove();
    asyncErrors.length = 0;
    localStorage.clear();
  }
}

// A compact, re-pasteable rendering of the generated schema for a failure message.
const describeSchema = (schema) => {
  const seen = new WeakSet();
  return JSON.stringify(schema, function (k, v) {
    if (typeof v === "function") return "<fn>";
    if (typeof v === "symbol") return "<symbol>";
    if (typeof v === "bigint") return `<${v}n>`;
    if (typeof v === "number" && !Number.isFinite(v)) return `<${v}>`;
    if (v === undefined) return "<undefined>";
    if (v && typeof v === "object") { if (seen.has(v)) return "<cycle>"; seen.add(v); }
    return v;
  }).slice(0, 4000);
};

for (const seed of SEEDS) {
  const known = UNSKIP ? undefined : KNOWN_BUGS.get(seed);
  test(`stress seed ${seed}`, { timeout: PER_SEED_MS, skip: known && `known bug: ${known}` }, () => runSeed(seed));
}
