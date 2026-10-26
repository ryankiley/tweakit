/* Shared test helpers. DOM-free at import time; the ones that build events or stub navigator read the jsdom globals when called. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** Resolve after `ms`. */
export const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
export const tick = wait;

/** URL of a built output under dist/. */
export const distUrl = (rel) => new URL(`../dist/${rel}`, import.meta.url);
/** The single-file bundle. */
export const loadSingle = () => import(distUrl("tweaks.js"));
/** The code-split core; heavy controls load on demand. */
export const loadSplit = () => import(distUrl("tweaks/core.js"));
/** The built stylesheet, as text. */
export const distCss = () => readFileSync(distUrl("tweaks.css"), "utf8");

/** A mount function for one bundle + panel name: builds, appends, awaits `ready`. */
export const mounter = (tweaks, name) => async (schema, opts) => { const p = tweaks(name, schema, opts); document.body.append(p.el); await p.ready; return p; };

/** Hover a panel's Presets button, as a pointer does before it presses: that downloads the menu's chunk, so the press
 *  then opens the menu at once. Found by its role, as strings may rename it. Resolves to the button. */
export const armPresets = async (p) => { const b = p.el.querySelector('.twk-toolbar-btn[aria-haspopup="menu"]'); b.dispatchEvent(new Event("pointerenter")); await wait(10); return b; };

/** A synthetic pointer event; jsdom has no PointerEvent constructor. Composed, as a real one is, so it leaves a shadow root. */
export const ptr = (type, props) => Object.assign(new Event(type, { bubbles: true, cancelable: true, composed: true }), { pointerId: 1, button: 0, buttons: 1, pointerType: "mouse", ...props });

/** Dispatch a keydown on `target`, composed as a real one is; returns the event. */
export const key = (target, props) => { const e = new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, composed: true, ...props }); target.dispatchEvent(e); return e; };

/** Two number arrays agree to 1e-9, element by element. */
export const near = (a, b, msg) => { assert.equal(a.length, b.length, msg); a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${msg}: [${i}] ${v} vs ${b[i]}`)); };

/** Two numbers agree within `eps`. */
export const close = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;
// What a panel saved under `k`, out of its { v: 1, values } or { v: 1, presets } wrapper.
export const saved = (k) => { const s = JSON.parse(localStorage.getItem(k)); return s && s.v === 1 && Object.keys(s).length === 2 ? (s.values ?? s.presets) : s; };

/** Run `fn` with console.warn collected, then wait `settle` ms, since a notice's words load from a lazy chunk. Resolves to
 *  the warnings, each call's arguments joined; `fn` gets the list as it fills, for checks between steps. */
export const warnings = async (fn, settle = 20) => {
  const warn = console.warn, msgs = []; console.warn = (...a) => msgs.push(a.join(" "));
  try { await fn(msgs); await wait(settle); return msgs; } finally { console.warn = warn; }
};
/** `fn`'s result, with console.warn silenced. */
export const quiet = async (fn) => { const warn = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = warn; } };

/** Run `fn` with navigator.clipboard stubbed and let a write land; resolves to the last text written, or null. */
export const withClipboard = async (fn) => {
  let copied = null;
  const clip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async (t) => { copied = t; } }, configurable: true });
  try { await fn(); await wait(0); return copied; } finally { if (clip) Object.defineProperty(globalThis.navigator, "clipboard", clip); else delete globalThis.navigator.clipboard; }
};
/** What the toolbar's copy button under `root` writes; `init` adds to the click (shiftKey: what changed). */
export const copyFrom = (root, init) => withClipboard(() => root.querySelector(".twk-toolbar-btn--swap").dispatchEvent(new window.MouseEvent("click", { bubbles: true, ...init })));

/** A press in the panel's side padding level with `node`, which picks that row or folder. jsdom lays nothing out, so the
 *  row or folder header `node` sits in is given a box at the press's height for the moment of the press. */
export const pressBeside = (p, node, props = {}) => {
  const box = node && (node.closest(".twk-folder-header") || node.closest(".twk-controls > *"));
  if (box) box.getBoundingClientRect = () => ({ top: 40, bottom: 72, height: 32, left: 0, right: 0, width: 0 });
  try { p.el.dispatchEvent(ptr("pointerdown", { clientX: 2, clientY: 50, ...props })); } finally { if (box) delete box.getBoundingClientRect; }
};
/** Drag a panel by its header: pressed at (100, y0), moved by dx, dy and released there. */
export const dragHeader = (p, dx, dy = 0, y0 = 10) => {
  const header = p.el.querySelector(".twk-header");
  header.setPointerCapture = header.releasePointerCapture = () => {};
  header.dispatchEvent(ptr("pointerdown", { clientX: 100, clientY: y0 }));
  header.dispatchEvent(ptr("pointermove", { clientX: 100 + dx, clientY: y0 + dy }));
  header.dispatchEvent(ptr("pointerup", { clientX: 100 + dx, clientY: y0 + dy, buttons: 0 }));
};
