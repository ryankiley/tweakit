/* Tweaks — the fold a row behind a render condition hides and shows with. A panel with
 * conditionals imports it once its first pass is done, so that pass (and a restore in the
 * same task) just toggles the class, and a basic panel never fetches it.
 *
 * The row folds the way a folder does: the rows below close up over its height and the
 * gap (a negative margin-bottom) as it's clipped from the bottom and fades, on
 * --tw-ease-fold over 0.35s. Its height is held as it stands, so nothing inside squashes,
 * no padding or border is left to snap, and a row folding inside a folder that folds too
 * can't shrink it from under it. Flipped mid-fold, it turns around from where it's drawn;
 * the open end settles on the row's own margin and opacity (a disabled row's 0.4).
 * Reduced motion, a DOM without the Animations API or an easing it refuses, and a row with
 * nothing drawn (under a hidden ancestor — one this same change reveals, which then folds
 * open around it) just toggle the class. */
import { REDUCE_MOTION } from "./shared.js";

export const fold = (node: HTMLElement & { _fold?: Animation }, hide: boolean) => {
  const cs = getComputedStyle(node), at = node._fold?.playState == "running" && { marginBottom: cs.marginBottom, clipPath: cs.clipPath, opacity: cs.opacity };
  node._fold?.cancel(); node.classList.remove("tw-cond-hidden");
  const h = !REDUCE_MOTION.matches && node.animate && node.offsetHeight;
  node.classList.toggle("tw-cond-hidden", hide);
  if (h) try {
    // d is the room the row takes: its height, the 6px stack gap (tweaks.css .tw-controls) and its own top margin (a stacked folder's −6px already cancels that gap). The clip rises with the rows closing up, so they meet at the seam.
    const d = h + 6 + parseFloat(cs.marginTop), H = h + "px", shut = { height: H, marginBottom: -d + "px", clipPath: `inset(0 0 ${d}px)`, opacity: 0 }, open = { height: H, clipPath: "inset(0)" };
    (node._fold = node.animate([at || (hide ? open : shut), hide ? shut : open], { duration: 350, easing: cs.getPropertyValue("--tw-ease-fold").trim() }))
      .onfinish = () => node.classList.toggle("tw-cond-hidden", hide);
    node.classList.remove("tw-cond-hidden"); // drawn until the fold lands — after animate(), so an easing it refuses still leaves the toggle done
  } catch {}
};
