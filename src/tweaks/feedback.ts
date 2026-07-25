/* Panel feedback chrome — the toolbar button factories (copy / reset + their
 * one-shot animations), the shared toast pill, the hint tooltip, and the
 * clipboard helper. All portal-aware: the toast + tip carry the anchor panel's
 * theme and winning scheme the way popover() does. */
import { el, btn, carrySkin, placeBelow } from "./shared.js";
import { ICON_COPY, ICON_CHECK, ICON_RESET, ICON_INFO } from "./icons.js";

// Toolbar buttons shared by the live panel and the markup showcase: one factory
// (icon button + matching title/aria-label), plus the copy/reset one-shot animations
// (the copied flash, the reset spin — each stashes its timer on the button as `_t`).
const toolbarBtn = (cls, icon, label) => { const b = btn("tw-toolbar-btn" + (cls ? " " + cls : ""), icon); b.title = label; b.setAttribute("aria-label", label); return b; };
const makeCopyBtn = () => toolbarBtn("tw-toolbar-btn--swap", `<span class="tw-toolbar-btn__icons">${ICON_COPY}${ICON_CHECK}</span>`, "Copy values");
const makeResetBtn = () => toolbarBtn("tw-toolbar-btn--reset", ICON_RESET, "Reset");
const flashCopied = (btn) => { btn.classList.add("is-copied"); clearTimeout(btn._t); btn._t = setTimeout(() => btn.classList.remove("is-copied"), 1400); };
// Reset spin — an accumulated rotation on --tw-spin, driven by the transform transition
// (no keyframes): transitions retarget mid-flight, so a second click mid-spin continues
// smoothly into the next full turn from the current angle instead of snapping back to
// rest ("interruptible beats staged"). is-spinning lengthens the transition for the
// spin's run; once settled, the counter renormalises to 0 with the transition suppressed
// — −n·360° is the same angle, so nothing visibly moves and the counter can't grow forever.
// "Settled" is the transform's own transitionend, not a fixed timer: the same transform
// carries the hover wind-up, so any mid-spin retarget (hover engaging or dropping,
// another click) restarts the transition clock, and a timer tuned to one spin's length
// would fire mid-flight and snap the icon to rest. At transitionend the angle is exactly
// −n·360° + wind, so zeroing is invisible however the spin was steered. Two guards: an
// end arriving <250ms after the click is a stale wind settle dispatched late (a real
// spin runs ≥500ms from the last click), and the timeout is only a fallback for when no
// transition runs at all (reduced motion, hidden panel) — it re-arms while one is still
// live rather than cutting it short.
const spinReset = (btn) => {
  const svg = btn.querySelector("svg");
  if (!btn._spinSettle) {
    btn._spinSettle = () => {
      clearTimeout(btn._t);
      btn.classList.remove("is-spinning");
      svg.style.transition = "none"; svg.style.setProperty("--tw-spin", "0deg");
      // Commit the zero while transitions are off — getBoundingClientRect, NOT offsetWidth:
      // svg is an SVG element, where offsetWidth is undefined, so the HTML reflow idiom
      // flushed nothing and the whole inline dance collapsed into one style update. The
      // browser never saw transition:none, and the −n·360° → 0 change animated through
      // the restored transition — a full visible unwind right after every spin (the icon
      // "ran twice" per press).
      void svg.getBoundingClientRect();
      svg.style.transition = "";
    };
    svg.addEventListener("transitionend", (e) => {
      if (e.propertyName === "transform" && btn.classList.contains("is-spinning") && performance.now() - btn._spinT > 250) btn._spinSettle();
    });
  }
  btn._spinT = performance.now();
  svg.style.setProperty("--tw-spin", `${(parseFloat(svg.style.getPropertyValue("--tw-spin")) || 0) - 360}deg`);
  btn.classList.add("is-spinning");
  clearTimeout(btn._t);
  const fallback = () => { if (svg.getAnimations && svg.getAnimations().length) btn._t = setTimeout(fallback, 250); else btn._spinSettle(); };
  btn._t = setTimeout(fallback, 600);
};

// Toast — the kit's own feedback pill (copy / preset confirmations), portaled to
// <body> bottom-centre so it works anywhere the panel is dropped, not only on a host
// page that happens to have a .toast element. One shared node, tip-style visuals;
// carries the anchor panel's winning scheme + live theme the way the tip does.
let toastEl = null, toastTimer = 0;
function showToast(msg, anchor?) {
  if (!toastEl) { toastEl = el("div", "tw-toast tw-portal"); toastEl.setAttribute("role", "status"); document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  carrySkin(toastEl, anchor); // the anchor panel's theme + winning scheme, tip-style
  toastEl.classList.add("is-open");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("is-open"), 1600);
}
// Hint tooltip — one shared, portaled bubble shown by a control's info marker on
// hover/focus. Portaled to <body> so it clears the panel's overflow clip; sits
// above its anchor, flipping below when there's no room. Pointer-transparent.
let hintTip = null, hintTimer = 0, hintAnchor = null;
const onHintKey = (e) => { if (e.key === "Escape") hideHintNow(); }; // bound only while the tip is open — WCAG 1.4.13, the hover content is dismissable
const hideHintNow = () => { clearTimeout(hintTimer); document.removeEventListener("keydown", onHintKey); if (hintTip) hintTip.classList.remove("is-open"); };
function showHint(anchor, text) {
  if (!hintTip) { hintTip = el("div", "tw-tip tw-portal"); hintTip.setAttribute("role", "tooltip"); document.body.appendChild(hintTip); }
  clearTimeout(hintTimer);
  hintTip.textContent = text;
  carrySkin(hintTip, anchor); // theme + winning scheme, resolved at show time (setTheme may have run since build)
  const wasOpen = hintTip.classList.contains("is-open");
  hintTip.style.visibility = "hidden"; hintTip.classList.add("is-open");
  // Shared placement: centre on the anchor, prefer above (the tooltip convention),
  // flip to the side with more room, clamp into the viewport — the same algorithm
  // every modal uses, so the tip is no longer the one surface with its own path.
  placeBelow(anchor, hintTip, { align: "center", prefer: "above", gap: 8 });
  hintTip.style.visibility = "";
  document.addEventListener("keydown", onHintKey);
  hintAnchor = anchor;
  // Unmount watchdog (popover()'s pattern): a host removing the panel mid-hover would
  // otherwise strand the open tip on screen. One rAF per frame, only while open.
  if (!wasOpen) requestAnimationFrame(function watch() { if (!hintTip.classList.contains("is-open")) return; if (!hintAnchor.isConnected) return hideHintNow(); requestAnimationFrame(watch); });
}
function hideHint() { if (hintTip) hintTimer = setTimeout(() => { hintTip.classList.remove("is-open"); document.removeEventListener("keydown", onHintKey); }, 80); }
// A control's `hint` becomes a visible ⓘ marker beside its label that reveals the
// text in the tooltip on hover/focus — discoverable and keyboard-reachable, unlike
// the old native `title`. Shared by the panel build (registerCond) and enhance().
function addHintMarker(node: any, hint: string) {
  const label = node.querySelector(".tw-slider-label, .tw-row-label, .tw-select-label, .tw-trigger-label, .tw-radiogrid-label, .tw-field-label, .tw-folder-title, .tw-fps-label, .tw-plot-label") || node;
  // The select-trigger / folder-header / colour-gradient-point trigger wrap their label
  // in a <button>, which can't legally contain interactive content. Inside one, the ⓘ is
  // a decorative, non-focusable marker (still reveals the tip on hover for mouse users)
  // and the hint rides the host button's aria-description, so a screen reader announces
  // it with the control. A standalone label keeps a real focusable button — valid where
  // it sits, and a keyboard-reachable way to the tip.
  const hostBtn = label.closest("button");
  const mark = hostBtn ? el("span", "tw-hint", ICON_INFO) : btn("tw-hint", ICON_INFO);
  const show = () => showHint(mark, hint);
  if (hostBtn) {
    mark.setAttribute("aria-hidden", "true");
    const prior = hostBtn.getAttribute("aria-description");
    hostBtn.setAttribute("aria-description", prior ? `${prior}. ${hint}` : hint);
  } else {
    mark.setAttribute("aria-label", hint);
    mark.addEventListener("focus", show);
    mark.addEventListener("blur", hideHint);
    mark.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }); // keyboard activation stays on the marker
  }
  mark.addEventListener("pointerenter", show);
  mark.addEventListener("pointerleave", hideHint);
  mark.addEventListener("pointerdown", (e) => e.stopPropagation()); // a press on the marker mustn't start a slider scrub or panel drag
  mark.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); }); // and (inside a control button) mustn't toggle the parent
  label.appendChild(mark);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  // Fallback when the clipboard API is blocked (no user activation): the same
  // textarea + execCommand path copy.js uses, so values copy byte-identically.
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.top = "-9999px";
  document.body.appendChild(ta); ta.focus(); ta.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch {}
  document.body.removeChild(ta);
  return ok;
}

export { toolbarBtn, makeCopyBtn, makeResetBtn, flashCopied, spinReset, showToast, hideHintNow, addHintMarker, copyText };
