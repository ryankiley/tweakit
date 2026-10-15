/* Shared test helpers. DOM-free at import time; ptr() and key() read the jsdom globals when called. */
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

/** A synthetic pointer event; jsdom has no PointerEvent constructor. */
export const ptr = (type, props) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), { pointerId: 1, button: 0, buttons: 1, pointerType: "mouse", ...props });

/** Dispatch a keydown on `target`; returns the event. */
export const key = (target, props) => { const e = new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...props }); target.dispatchEvent(e); return e; };

/** Two number arrays agree to 1e-9, element by element. */
export const near = (a, b, msg) => { assert.equal(a.length, b.length, msg); a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${msg}: [${i}] ${v} vs ${b[i]}`)); };

/** Two numbers agree within `eps`. */
export const close = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;
