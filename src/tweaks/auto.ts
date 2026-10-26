/* tweakit/auto: the code-split API, plus enhance(document) once the page has parsed. The bare import binds nothing, so a
 * page of [data-tw] markup with no script of its own imports this entry instead. Built on its own, unbundled, so it stays a
 * few lines over ./core.js rather than reshaping the split build's chunks. */
import { enhance } from "./core.js";
export * from "./core.js";

// A page with nothing to bind doesn't fetch the markup chunk: no [data-tw] host, and no static showcase panel (enhance() wraps one).
if (typeof document !== "undefined") {
  const run = () => { if (document.querySelector('[data-tw], .tw-panel[data-mode="inline"] > .tw-controls')) enhance(document); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
}
