/* The fold a row behind a render condition hides and shows with. A panel with conditionals
 * imports it once its first pass is done, so a basic panel never fetches it.
 * The rows below close up over the row's height and gap as it's clipped from the bottom and
 * fades; its own height is held so nothing inside squashes, and flipped mid-fold it turns
 * around from where it's drawn. */
import { REDUCE_MOTION } from "./shared.js";

/** Fold `node` shut or open; reduced motion, no Animations API or a row with nothing drawn just toggle the class. */
export const fold = (node: HTMLElement & { _fold?: Animation }, hide: boolean) => {
  const cs = getComputedStyle(node), at = node._fold?.playState == "running" && { marginBottom: cs.marginBottom, clipPath: cs.clipPath, opacity: cs.opacity };
  node._fold?.cancel(); node.classList.remove("tw-cond-hidden");
  const h = !REDUCE_MOTION.matches && node.animate && node.offsetHeight;
  node.classList.toggle("tw-cond-hidden", hide);
  if (h) try {
    // d is the room the row takes: its height, the 6px stack gap (tweaks.css) and its own top margin.
    const d = h + 6 + parseFloat(cs.marginTop), H = h + "px", shut = { height: H, marginBottom: -d + "px", clipPath: `inset(0 0 ${d}px)`, opacity: 0 }, open = { height: H, clipPath: "inset(0)" };
    (node._fold = node.animate([at || (hide ? open : shut), hide ? shut : open], { duration: 350, easing: cs.getPropertyValue("--tw-ease-fold").trim() }))
      .onfinish = () => node.classList.toggle("tw-cond-hidden", hide);
    node.classList.remove("tw-cond-hidden"); // after animate(): a refused easing leaves the toggle done
  } catch {}
};
