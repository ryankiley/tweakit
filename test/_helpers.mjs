/* Helpers the suite's files share: the timers, synthetic events and closeness asserts that
 * were once redefined per file, and the loaders for the built outputs the tests run against
 * (dist/tweaks.js, the code-split dist/tweaks/core.js, dist/tweaks.css). DOM-free at import
 * time, so the pure-maths tests can take `near` or `close` without spinning up jsdom; ptr()
 * and key() read the globals _setup-dom.mjs installs when they are called. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** Resolve for `ms`; `tick` is the same thing under the name half the files used. */
export const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
export const tick = wait;

/** The URL of a built output, relative to dist/. */
export const distUrl = (rel) => new URL(`../dist/${rel}`, import.meta.url);
/** The single-file bundle: every control registered synchronously. */
export const loadSingle = () => import(distUrl("tweaks.js"));
/** The code-split core: heavy controls load on demand, so a panel has a lazy window. */
export const loadSplit = () => import(distUrl("tweaks/core.js"));
/** The built stylesheet, as text. */
export const distCss = () => readFileSync(distUrl("tweaks.css"), "utf8");

/** A mount function for one bundle + panel name: builds the panel, appends it, awaits
 *  `ready`, returns it. `const mount = mounter(tweaks, "S")` → `await mount(schema)`. */
export const mounter = (tweaks, name) => async (schema, opts) => { const p = tweaks(name, schema, opts); document.body.append(p.el); await p.ready; return p; };

/** A synthetic pointer event. jsdom has no PointerEvent constructor, and the drag paths only
 *  read pointerId / button / buttons / clientX / clientY / pointerType off it. */
export const ptr = (type, props) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), { pointerId: 1, button: 0, buttons: 1, pointerType: "mouse", ...props });

/** Dispatch a keydown on `target`; returns the event so a test can read defaultPrevented. */
export const key = (target, props) => { const e = new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...props }); target.dispatchEvent(e); return e; };

/** Two number arrays agree to 1e-9, element by element (and in length). */
export const near = (a, b, msg) => { assert.equal(a.length, b.length, msg); a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${msg}: [${i}] ${v} vs ${b[i]}`)); };

/** Two numbers agree within `eps`. */
export const close = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;
