/* jsdom globals for the panel tests — the kit reads document/window/matchMedia/
 * getComputedStyle at build time and rAF for its measure passes. Import this
 * before importing a built bundle. The VirtualConsole stays silent so jsdom's
 * own "not implemented" noise (canvas 2D, which the kit feature-detects and
 * degrades around) doesn't drown the test output; the kit's real console.error
 * degrade messages go through Node's console and still show. */
import { JSDOM, VirtualConsole } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
  virtualConsole: new VirtualConsole(),
});
const { window } = dom;

globalThis.window = window;
for (const k of ["document", "HTMLElement", "Element", "Node", "CustomEvent", "Event", "localStorage"]) globalThis[k] = window[k];
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
const matchMedia = window.matchMedia
  ? window.matchMedia.bind(window)
  : (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.matchMedia = matchMedia;
window.matchMedia = matchMedia;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16);
globalThis.cancelAnimationFrame = clearTimeout;

export { window };
