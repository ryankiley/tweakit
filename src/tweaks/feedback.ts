/* Panel feedback chrome — the toolbar button factories (copy / reset and their one-shot
 * animations), the hint tooltip and the clipboard helper. The screen-reader announcer they
 * speak through lives in shared.ts, where the lazy controls reach it too. */
import { el, btn, carrySkin, placeBelow, announce } from "./shared.js";
import { ICON_COPY, ICON_CHECK, ICON_RESET, ICON_INFO } from "./icons.js";

/** A toolbar button with its one-shot animation state: timer, spin settle hook, last click time. */
interface ToolbarBtn extends HTMLButtonElement { _t?: number; _spinSettle?: () => void; _spinT?: number }

/** An icon toolbar button with matching title and aria-label. */
const toolbarBtn = (cls: string, icon: string, label: string): ToolbarBtn => { const b = btn("tw-toolbar-btn" + (cls ? " " + cls : ""), icon); b.title = label; b.setAttribute("aria-label", label); return b; };
/** Copy: puts `text(changedOnly)` on the clipboard and confirms with the check swap, and to a screen reader in words.
 *  `text` returns the payload and a count (-1 for the full snapshot; 0 copies nothing).
 *  Both handlers bail while `disabled`: a synthetic dispatchEvent(click) reaches a disabled button. */
const makeCopyBtn = (text: (changedOnly: boolean) => [string, number]) => {
  const b = toolbarBtn("tw-toolbar-btn--swap", `<span class="tw-toolbar-btn__icons">${ICON_COPY}${ICON_CHECK}</span>`, "Copy values (⇧: changed only)");
  b.addEventListener("click", async (e) => {
    if (b.disabled) return;
    const [t, n] = text(e.shiftKey);
    if (!n) return announce("Nothing has changed");
    if (!(await copyText(t))) return announce("Copy failed");
    flashCopied(b); announce(n > 0 ? `${n} changed value${n === 1 ? "" : "s"} copied` : "Values copied");
  });
  return b;
};
/** Reset: runs `onReset` behind the icon's one-shot spin. */
const makeResetBtn = (onReset: () => void) => { const b = toolbarBtn("tw-toolbar-btn--reset", ICON_RESET, "Reset"); b.addEventListener("click", () => { if (b.disabled) return; spinReset(b); onReset(); }); return b; };
const flashCopied = (btn: ToolbarBtn) => { btn.classList.add("is-copied"); clearTimeout(btn._t); btn._t = setTimeout(() => btn.classList.remove("is-copied"), 1400); };
/** Reset spin — an accumulated rotation on --tw-spin driven by the transform transition, so a
 *  second click mid-spin retargets smoothly instead of snapping back. Once settled the counter
 *  renormalizes to 0 with the transition suppressed (−n·360° is the same angle). "Settled" is the
 *  transform's own transitionend, not a timer: the hover wind-up shares the transform and restarts
 *  the clock. An end <250ms after the click is a stale wind settle; the timeout is only a fallback
 *  for when no transition runs at all (reduced motion, hidden panel). */
const spinReset = (btn: ToolbarBtn) => {
  const svg = btn.querySelector("svg");
  if (!btn._spinSettle) {
    btn._spinSettle = () => {
      clearTimeout(btn._t);
      btn.classList.remove("is-spinning");
      svg.style.transition = "none"; svg.style.setProperty("--tw-spin", "0deg");
      // getBoundingClientRect, not offsetWidth: on an SVG element offsetWidth is undefined, so the
      // reflow idiom flushed nothing and the −n·360° → 0 change animated as a visible unwind.
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

// Hint tooltip — one shared bubble, portaled to <body> so it clears the panel's overflow clip.
let hintTip: HTMLDivElement | null = null, hintTimer = 0, hintAnchor: Element | null = null;
const onHintKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); hideHintNow(); } }; // bound only while open; WCAG 1.4.13 (dismissable)
/** Hide the tip now; with `owner` (panel.destroy()), only a tip anchored inside it — the node is shared. */
const hideHintNow = (owner?: Element) => { if (owner && hintAnchor && !owner.contains(hintAnchor)) return; clearTimeout(hintTimer); document.removeEventListener("keydown", onHintKey); if (hintTip) hintTip.classList.remove("is-open"); };
function showHint(anchor: Element, text: string) {
  if (!hintTip) { hintTip = el("div", "tw-tip tw-portal"); hintTip.setAttribute("role", "tooltip"); }
  if (!hintTip.isConnected) document.body.appendChild(hintTip); // re-home after a host replaced <body>'s content
  clearTimeout(hintTimer);
  hintTip.textContent = text;
  carrySkin(hintTip, anchor); // resolved at show time: setTheme may have run since build
  const wasOpen = hintTip.classList.contains("is-open");
  hintTip.style.visibility = "hidden"; hintTip.classList.add("is-open");
  placeBelow(anchor, hintTip, { align: "center", prefer: "above", gap: 8 });
  hintTip.style.visibility = "";
  document.addEventListener("keydown", onHintKey);
  hintAnchor = anchor;
  // Unmount watchdog: a host removing the panel mid-hover would strand the open tip. One rAF per frame while open.
  if (!wasOpen) requestAnimationFrame(function watch() { if (!hintTip.classList.contains("is-open")) return; if (!hintAnchor.isConnected) return hideHintNow(); requestAnimationFrame(watch); });
}
function hideHint() { if (hintTip) { clearTimeout(hintTimer); hintTimer = setTimeout(hideHintNow, 80); } } // a short grace, so crossing marker → tip doesn't flicker
/** Every control's label element — the one list behind the hint marker's home and the per-control
 *  reset target (panel.ts wireReset), so the two can't drift. */
const LABEL_SEL = ".tw-slider-label, .tw-row-label, .tw-select-label, .tw-trigger-label, .tw-radiogrid-label, .tw-field-label, .tw-folder-title, .tw-fps-label, .tw-plot-label, .tw-spring-label, .tw-bezier-label";
/** A control's `hint` becomes a ⓘ marker beside its label that reveals the tooltip on hover/focus. */
function addHintMarker(node: Element, hint: string) {
  const label = node.querySelector(LABEL_SEL) || node;
  if (label === node && node.classList.contains("tw-separator")) return; // a divider has no label to carry a marker
  // Inside a <button> (select trigger, folder header), which can't contain interactive content, the
  // ⓘ is a decorative span and the hint rides the host button's aria-description for screen readers.
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
  mark.addEventListener("pointerdown", (e) => e.stopPropagation()); // mustn't start a slider scrub or panel drag
  mark.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); }); // and (inside a control button) mustn't toggle the parent
  label.appendChild(mark);
}
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  // Fallback when the clipboard API is blocked (no user activation): textarea + execCommand.
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.top = "-9999px";
  document.body.appendChild(ta); ta.focus(); ta.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch {}
  document.body.removeChild(ta);
  return ok;
}

export { toolbarBtn, makeCopyBtn, makeResetBtn, flashCopied, copyText, spinReset, announce, hideHintNow, addHintMarker, LABEL_SEL };
