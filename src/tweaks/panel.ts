/* tweaks() — the panel factory: builds the shell + controls from a schema and returns the live
 * API. Persistence, presets, undo, floating drag and the lazy-window queue live here. */
import {
  el,
  btn,
  txt,
  clamp,
  popover,
  closeActivePopover,
  stopPointerLeak,
  foldBody,
  applyThemeVars,
  resolveTheme,
  carryScheme,
  onLive,
  setDisabled,
  requestReflow,
  quietFocus,
  activeIn,
  isolate,
  using,
  words,
  getControl,
  notice,
  isObj,
  hasOwn,
  isReservedKey,
  valueChanged,
  restoreDefault,
} from "./shared.js";
import { metaFor, VALUELESS } from "./schema.js";
import { ensureForMetas, scanTypes } from "./lazy.js";
import { createFolder, createControl } from "./controls/basic.js";
import {
  makeCopyBtn,
  makeResetBtn,
  toolbarBtn,
  copyText,
  spinReset,
  announce,
  hideHintNow,
  addHintMarker,
  LABEL_SEL,
} from "./feedback.js";
import { ICON_PRESETS, ICON_X } from "./icons.js";
import { createUndo } from "./undo.js";
import type {
  Schema,
  HeldSchema,
  TweaksOptions,
  Panel,
  Params,
  ParamsOf,
  KnownTypes,
  PanelState,
  Control,
} from "./types.js";
import type { Meta } from "./schema.js";
import type { ClipCtx, Scope } from "./clip.js";
import type { PanelEl } from "./shared.js";
import type { TabsControl } from "./controls/tabs.js";

/** A params object or one of its folder/tabs sub-objects — the holder a control writes into. */
type Target = Record<string, unknown>;
/** A valued control's wiring: where its value lives, its set/get, the reset pair (raw, def) and its dotted path. */
export interface Entry {
  target: Target;
  key: string;
  set: Control["set"];
  get: Control["get"];
  raw: unknown;
  def: unknown;
  path: string[];
  persist: boolean;
  m: Meta;
  el: HTMLElement;
  note?: Control["note"];
  range?: Control["range"];
}
/** A values snapshot — params as JSON round-trips it. */
export type Snapshot = Record<string, any>;

let topFloating: HTMLElement | null = null; // the floating panel raised last (raise())
const liveKeys = new Map<string, number>(); // persist keys of the panels alive now, for the shared-key warning
let picked: [HTMLElement, () => void] | null = null; // the panel holding the page's one pick, and how to drop it
// The page's one hidden field that a picked ⌘C / ⌘V focuses for the keypress, so the browser's own copy and paste run on
// it: the system clipboard both ways, with no permission to ask. `onCatch` is that keypress's answer.
let catchEl: HTMLTextAreaElement | null = null,
  onCatch: ((e: ClipboardEvent) => void) | null = null;

/** Build a panel from `schema`; the shell and API exist synchronously, lazy controls fill in on `ready`.
 *  A schema written inline (or `as const`) types `params` from its shape. */
export function tweaks<const S extends HeldSchema>(
  name: string,
  schema: S & KnownTypes<S>,
  opts?: TweaksOptions,
): Panel<ParamsOf<S>>;
export function tweaks(name: string, schema: Schema, opts: TweaksOptions = {}): Panel {
  // an untitled tab page's name is a word too
  const metas = using(opts.strings, () =>
    Object.entries(schema)
      .map(([k, v]) => metaFor(k, v))
      .filter(Boolean),
  );
  const tr = words(opts.strings); // the panel's own words; its controls take them as assemble() builds them
  const params: Params = {};
  // the dotted path the latest change touched (`card.size`), as set() and changes() name it: on()'s second argument
  let last: string | undefined;
  const entries: Entry[] = []; // flattened across folders, for reset + persist
  // dotted path → type of each button, monitor, separator: set() says it holds no value
  const valueless = new Map<string, string>();
  const listeners = new Set<(p: Params, last?: string) => void>();
  const own = new Set<(p: Params, last?: string) => void>(); // undo + conditionals: all a silent write calls
  const cleanups: Array<() => void> = []; // releases for destroy(): document/window listeners, timers
  let destroyed = false; // set by destroy(): assemble() bails, mutators go silent
  let assembled = false; // set at the end of assemble(); no controls exist before
  // The lazy window: a mutating API call made before the controls exist queues here and replays in order once assemble() has built them.
  const queue: Array<() => void> = [];
  let failed = false; // the chunks failed: the panel can never be built
  let built = -1; // cleanups.length as assemble() enters build()
  // the failed build already said why
  const later = (fn: () => void) => {
    if (destroyed) return;
    if (failed) return;
    assembled ? fn() : queue.push(fn);
  };
  let liftSlot: HTMLSpanElement | null = null; // the placeholder a lifted panel leaves in its slot
  // what the lift carried from the slot's context (lift()), under the panel's own theme
  const carried: Record<string, string> = {};
  // The values snapshot: undefined written as null (JSON would drop the key).
  const replacer = (_k: string, v: unknown) => (v === undefined ? null : v);
  // params as the schema shapes it, folders and tab pages included: a value the host parks on params is its own, so
  // snapshots, restores and undo carry only what a control holds. Null-prototype: a folder named "toString" is its own.
  const valuesOf = (ms: Meta[], from: Target): Snapshot => {
    const o: Snapshot = Object.create(null);
    for (const m of ms)
      if (hasOwn(from, m.key)) {
        // skipped and valueless rows hold nothing
        const v: unknown = from[m.key];
        if (m.type === "folder") o[m.key] = valuesOf(m.children, v as Target);
        else if (m.type === "tabs") {
          const t: Snapshot = (o[m.key] = Object.create(null));
          for (const pg of m.pages)
            if (hasOwn(v as Target, pg.key)) t[pg.key] = valuesOf(pg.children, (v as Target)[pg.key] as Target);
        } else o[m.key] = v;
      }
    return o;
  };
  const snapshot = (): Snapshot => JSON.parse(JSON.stringify(valuesOf(metas, params), replacer));
  // Storage keys — opt-in via opts.persist (a string key, or `true` to key by name).
  const persistKey = opts.persist ? `tw:${opts.persist === true ? name : opts.persist}` : null;
  const presetsKey = persistKey ? `${persistKey}:presets` : null;
  // Two live panels on one key overwrite each other's saves, the last write winning: say so. A remount after destroy() is fine.
  // The key is held until destroy(), or until a failed build leaves the panel unable to save: a remount then is quiet too.
  let holdsKey = !!persistKey;
  if (persistKey) {
    const n = liveKeys.get(persistKey) || 0;
    if (n) notice("sharedKey", persistKey.slice(3));
    liveKeys.set(persistKey, n + 1);
  }
  const releaseKey = () => {
    if (!holdsKey) return;
    holdsKey = false;
    const n = (liveKeys.get(persistKey!) || 1) - 1;
    if (n) liveKeys.set(persistKey!, n);
    else liveKeys.delete(persistKey!);
  };
  // any: a parsed JSON blob, whatever the store holds
  const readStore = (k: string): any => {
    try {
      return JSON.parse(localStorage.getItem(k) || "null");
    } catch {
      return null;
    }
  };
  // false: storage off, full or denied
  const writeStore = (k: string, v: unknown) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch {
      return false;
    }
  };
  // Saved values and presets carry a format version, { v: 1, values } and { v: 1, presets }, so a later change to what's
  // stored (a color's precision, a gray's hue) can tell old data from new. Anything else (0.5's bare object) reads as
  // nothing, and the panel opens on its defaults.
  const unwrap = (s: any, k: string) => (s?.v === 1 ? s[k] : null);
  const writeValues = (snap: Snapshot) => writeStore(persistKey!, { v: 1, values: snap });
  const writePresets = (all: unknown) => writeStore(presetsKey!, { v: 1, presets: all });
  // own keys only: a control keyed toString must not read Object.prototype's
  const atPath = (obj: Snapshot | null, path: string[]): unknown =>
    path.reduce<any>((o, k) => (o != null && hasOwn(o, k) ? o[k] : undefined), obj);
  // Take one entry's value out of a snapshot; true when it was there. Reflect: an undeletable key is left, not thrown.
  const drop = (snap: Snapshot | null, e: Entry) => {
    const o: any = atPath(snap, e.path.slice(0, -1));
    if (!o || typeof o !== "object" || !hasOwn(o, e.key)) return false;
    Reflect.deleteProperty(o, e.key);
    return true;
  };
  // A control with `persist: false` stays out of what is saved and out of what is restored.
  const unsaved = (snap: Snapshot | null) => {
    for (const e of entries) if (!e.persist) drop(snap, e);
    return snap;
  };
  // ── Images in IndexedDB (image-store.ts): what storage holds for an uploaded image is its ref, and `savedImages` maps this
  // panel's refs to their data URLs. The build doesn't wait for them: every other value restores as it builds, and a stored
  // image waits in `waiting` until the store answers, then fills in (restoreImages), by `ready`. With no store to hold an
  // upload (not answered yet, unavailable, or it refused that image), the data URL saves inline, as 0.5 saved it, and moves
  // to the store on a later save; a write storage refuses then leaves the inline images out. With no store, a stored ref
  // stays saved as it was until its row is written. ──
  // both null without IndexedDB
  let imgs: ReturnType<(typeof import("./image-store.js"))["bind"]> | null = null,
    savedImages: Map<string, string> | null = null;
  let imagesReady = false; // the store has answered, or failed to load
  // a row's stored ref, and the value it held while the store loaded or the image was fetched
  const waiting = new Map<Entry, [string, unknown]>();
  // image-store.ts's ref, readable before that chunk loads
  const isRef = (v: unknown): v is string => typeof v === "string" && v.startsWith("tw-image:");
  const isDataUrl = (v: unknown): v is string => typeof v === "string" && v.startsWith("data:");
  const imageEntries = () => entries.filter((e) => e.m.type === "image");
  const unsavable = new Map<Entry, unknown>();
  const notSaved = (e: Entry, v: unknown) => {
    if (unsavable.get(e) === v) return;
    unsavable.set(e, v);
    e.note?.(tr("notSaved", "Not saved"));
  };
  const toRefs = (snap: Snapshot) => {
    const stored = imagesReady && imgs ? readStore(persistKey!) : undefined; // undefined: no store to hold an upload
    for (const e of imageEntries()) {
      const o: any = atPath(snap, e.path.slice(0, -1)),
        v = o?.[e.key],
        w = waiting.get(e);
      // still loading or no store: keep the stored ref; a write since settles it
      if (w && o && hasOwn(o, e.key)) {
        if (!valueChanged(w[1], v)) {
          o[e.key] = w[0];
          continue;
        }
        waiting.delete(e);
      }
      if (!isDataUrl(v) || stored === undefined) continue; // a URL is small, and a data URL with no store saves inline
      const ref = imgs!.save(e, v, stored);
      if (ref) o[e.key] = ref;
    }
    return snap;
  };
  // An image a restore names by ref: from the store's answer, or once it answers; a ref the store has never seen here (a
  // preset another tab saved) is fetched. It lands only on a row the host and the person left alone meanwhile.
  const late = (e: Entry, held: unknown, url: string) => {
    if (destroyed || valueChanged(held, e.get()) || !tryAssign(e, url)) return false;
    undoApi?.patch(e.path, held, e.get()); // not a step of its own: ⌘Z mustn't take a restored image back out
    return true;
  };
  // A stored snapshot back to values, the way applySnapshot takes them: each known ref resolved, an unknown one left out
  // (its control keeps its value) and listed, so `restore` can fill it in once it arrives.
  const fromRefs = (snap: Snapshot | null, pending: [Entry, string][] = []) => {
    if (snap && typeof snap === "object")
      for (const e of imageEntries()) {
        const v = atPath(snap, e.path);
        if (!isRef(v)) continue;
        const url = savedImages?.get(v);
        if (url) (atPath(snap, e.path.slice(0, -1)) as any)[e.key] = url;
        else {
          drop(snap, e);
          pending.push([e, v]);
        }
      }
    return snap;
  };
  const restore = (snap: Snapshot | null, silent?: boolean) => {
    const pending: [Entry, string][] = [];
    applySnapshot(fromRefs(snap, pending), silent);
    for (const [e, ref] of pending) {
      // a write meanwhile settles it, even back to the value held
      const w: [string, unknown] = [ref, e.get()];
      waiting.set(e, w);
      if (!imagesReady || !imgs) continue; // no store: the ref stays saved until the row is written
      imgs.fetch(ref).then((url) => {
        if (waiting.get(e) !== w) return;
        waiting.delete(e);
        if (url && late(e, w[1], url)) {
          last = undefined;
          notify();
        }
      });
    }
  };
  // The store answered: each waiting row the host and the person left alone takes its image, in one notify.
  const restoreImages = () => {
    imagesReady = true;
    if (!assembled || destroyed || failed) {
      waiting.clear();
      return;
    } // not built yet: the build resolves refs itself
    let changed = false;
    for (const [e, [ref, held]] of [...waiting]) {
      const url = savedImages?.get(ref);
      if (url && late(e, held, url)) changed = true;
    }
    // no store: each ref stays waiting, so no save writes the default over it and no later session prunes it
    if (imgs) waiting.clear();
    if (changed) {
      last = undefined;
      notify();
    } else if (imgs) persist(); // an upload saved inline while the store loaded moves to it now
  };
  // Delete the records nothing names any more: not the saved values, not a preset. Only records this panel knows, loaded
  // or written: another tab's panel on the same key may have just stored one this panel has never seen.
  const pruneImages = () => imgs?.prune([readStore(persistKey!), listPresets()]);
  // Debounced save; destroy() flushes a pending write rather than dropping it. saveNow writes at once.
  let saveNow = () => {};
  const persist = persistKey
    ? (() => {
        let saveT = 0;
        // A write storage refuses (off, denied, or full of something else) is dropped silently, unless an image saved inline may
        // be what didn't fit: then those are left out, their rows say so, and the rest is written.
        const save = () => {
          saveT = 0;
          const snap = toRefs(unsaved(snapshot()));
          if (!writeValues(snap)) {
            const inline = imageEntries().filter((e) => isDataUrl(atPath(snap, e.path)));
            if (!inline.length) return;
            for (const e of inline) {
              notSaved(e, atPath(snap, e.path));
              drop(snap, e);
            }
            if (!writeValues(snap)) return;
          }
          pruneImages();
        };
        saveNow = save;
        cleanups.push(() => {
          if (saveT) {
            clearTimeout(saveT);
            save();
          }
        });
        return () => {
          clearTimeout(saveT);
          saveT = setTimeout(save, 150);
        };
      })()
    : () => {};
  // Each listener runs isolated: a throwing callback can't break the others or skip persist().
  // `last` is read once, so a write one listener makes can't change the key the rest are told.
  // a listener may destroy() the panel: arm no save behind it
  const notify = (silent?: boolean, changed = last) => {
    (silent ? own : listeners).forEach((fn) => {
      try {
        fn(params, changed);
      } catch (e) {
        console.error("[tweaks] listener threw:", e);
      }
    });
    if (!destroyed) persist();
  };
  // The one write path behind restores and set(). A function/symbol/bigint is no control value (JSON can't carry those).
  const notAValue = (v: unknown) => typeof v === "function" || typeof v === "symbol" || typeof v === "bigint";
  // An explicit write also settles a row still waiting for its stored image: the host's or the person's value wins.
  const assign = (e: Entry, v: unknown) => {
    if (notAValue(v)) throw new TypeError(`a ${typeof v} is not a control value`);
    waiting.delete(e);
    e.set(v);
    e.target[e.key] = e.get();
  };
  const tryAssign = (e: Entry, v: unknown) => {
    try {
      assign(e, v);
      return true;
    } catch (err) {
      console.error(`[tweaks] restoring "${e.path.join(".")}" failed — value skipped:`, err);
      return false;
    }
  };
  // …and the reset write: the opened form, then the authored value (restoreDefault).
  const assignDefault = (e: Entry) => {
    waiting.delete(e);
    restoreDefault(e, e.raw, e.def);
    e.target[e.key] = e.get();
  };
  // opts.onReset replaces the default; a reset() called from INSIDE it performs the default instead of recursing.
  let inOnReset = false;
  const resetAll = () => {
    if (typeof opts.onReset === "function" && !inOnReset) {
      inOnReset = true;
      try {
        return opts.onReset();
      } finally {
        inOnReset = false;
      }
    }
    for (const e of entries) {
      try {
        assignDefault(e);
      } catch (err) {
        console.error(`[tweaks] resetting "${e.path.join(".")}" failed — control skipped:`, err);
      }
    }
    last = undefined;
    notify();
  };

  const panel: PanelEl = el("div", "twk-panel");
  panel.dataset.mode = "inline";
  // A landmark, so a screen reader can jump to the panel and hear which one; an unnamed region is no landmark, so a blank name falls back.
  const landmark = (n: string) => panel.setAttribute("aria-label", n.trim() || tr("panel", "Tweaks"));
  panel.setAttribute("role", "region");
  landmark(name);
  // Stop pointer events leaking past the panel to a stage listening on window.
  stopPointerLeak(panel);
  const header = el("div", "twk-header");
  // The title is the collapse toggle; the toolbar beside it never collapses.
  const titleBtn = btn("twk-header-toggle");
  titleBtn.setAttribute("aria-expanded", "true");
  let title = name; // setName() moves it; the storage key keeps the built name
  const titleEl = txt("span", "twk-title", title);
  titleBtn.append(titleEl);
  const toolbar = el("div", "twk-toolbar");
  // The values moved off their defaults, keyed by dotted path — setMany()'s shape, for baking tuned values into source.
  const changed = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const e of entries) if (valueChanged(e.get(), e.def)) out[e.path.join(".")] = e.get();
    return JSON.parse(JSON.stringify(out, replacer));
  };
  // ⇧-click copies the changed values only; reset restores every default or runs opts.onReset.
  const copyBtn = makeCopyBtn((changedOnly) => {
    if (!changedOnly) return [JSON.stringify(snapshot(), null, 2), -1];
    const c = changed();
    return [JSON.stringify(c, null, 2), Object.keys(c).length];
  }, tr);
  // A picked row's paste (pasteScope, in the lazy clip chunk) writes through the panel's own load path; ctx lends it.
  // A paste is its own undo step: what was pending commits first, the paste right after, so neither merges with a drag.
  const ctx: ClipCtx = {
    panel,
    entries,
    fromJSON: (st) => {
      undoApi?.flush();
      api.fromJSON(st);
      undoApi?.flush();
    },
    announce,
    alive: () => !destroyed,
    tr,
  };
  const resetBtn = makeResetBtn(resetAll, tr);
  // Presets share persistence's storage, so the button needs it on.
  let presetsBtn: HTMLButtonElement | null = null;
  if (persistKey && opts.presets !== false) {
    // opts.presets:false keeps the saving, without the menu
    presetsBtn = toolbarBtn("", ICON_PRESETS, tr("presets", "Presets"));
    presetsBtn.setAttribute("aria-haspopup", "menu");
    presetsBtn.setAttribute("aria-expanded", "false");
    toolbar.append(presetsBtn);
  }
  toolbar.append(copyBtn, resetBtn);
  header.append(titleBtn);
  if (opts.toolbar !== false) header.append(toolbar); // toolbar:false → a bare panel, e.g. an embedded demo
  // The buttons act on controls that only exist once assemble() has built them: inert until then.
  const toolbarBtns = [copyBtn, resetBtn, presetsBtn].filter(Boolean);
  for (const b of toolbarBtns) b.disabled = true;
  // swallowClick lives on the header, not the title: once the header holds pointer capture, the click ending a drag is dispatched there.
  let dragMoved = false,
    swallowClick = false;
  header.addEventListener(
    "click",
    (e) => {
      if (swallowClick) {
        swallowClick = false;
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
  // A bottom-parked floating panel grows past the viewport when it expands: re-clamp once the collapse has settled.
  const toggleBody = () => foldBody(panel, titleBtn, body, !panel.classList.contains("is-collapsed"), reclamp);
  titleBtn.addEventListener("click", toggleBody);
  // A click anywhere on the header outside the toolbar folds the panel, if the press began on the header or title (a press
  // slid off a toolbar button also clicks here). A drag's closing click arrives defaultPrevented.
  let pressedHeader = false;
  header.addEventListener(
    "pointerdown",
    (e) => {
      pressedHeader = e.target === header || titleBtn.contains(e.target as Node);
    },
    true,
  );
  header.addEventListener("click", (e) => {
    if (e.target === header && pressedHeader && !e.defaultPrevented) toggleBody();
  });
  const body = el("div", "twk-body");
  const controls = el("div", "twk-controls");
  body.append(controls);
  panel.append(header, body);
  // opts.shadow: the panel lives in a shadow root on its own host, out of page CSS's reach; shadow-root.ts styles it and
  // gives its portals a root of their own. `box` is what sits in the page and moves on a lift.
  const iso = isolate(panel, opts.shadow),
    box = iso.box;

  // Stash the theme so the portaled popovers (which lose the panel's inherited vars) re-apply it on open.
  let themeVars = resolveTheme(opts.theme);
  applyThemeVars(panel, themeVars);
  panel._twTheme = themeVars;

  // ── Floating position — seeded in the shell, so an opts.floating / persisted panel is fixed in place
  // the moment tweaks() returns instead of jumping when the lazy chunks land. ──
  const draggable = opts.draggable !== false;
  const MARGIN = 8,
    SNAP = 28; // px: viewport inset; snap distance to park against an edge
  // opts.floating's x / y are insets from the viewport's top-left, as px / py below are.
  const place = typeof opts.floating === "object" && opts.floating ? opts.floating : null;
  // The vertical clamp uses the panel's full height, scrollHeight, not its capped one: clamping on the cap would ratchet
  // (every position fits, so a tall panel drags up but never back down). +1: it rounds, so a panel parked at the far edge
  // isn't capped a fraction short of its rows.
  // The viewport from clientWidth / clientHeight: a fixed box's right and bottom edges sit inside the page scrollbars,
  // which innerWidth / innerHeight count. Only in standards mode: with no doctype the root's client box is the page's
  // content, not the viewport (and jsdom has no layout: 0) — the inner size there.
  const root = () => (document.compatMode === "CSS1Compat" ? document.documentElement : null);
  const vw = () => root()?.clientWidth || window.innerWidth,
    vh = () => root()?.clientHeight || window.innerHeight;
  const bounds = () => ({
    maxX: Math.max(MARGIN, vw() - panel.offsetWidth - MARGIN),
    maxY: Math.max(MARGIN, vh() - panel.scrollHeight - 1 - gap),
  });
  const posKey = persistKey ? `${persistKey}:pos` : null;
  // A pinned panel sits where opts.floating puts it; only a draggable one restores a saved spot.
  const stored = draggable && posKey ? readStore(posKey) : null;
  const saved = stored && typeof stored === "object" ? stored : null;
  const start = saved || place || { x: 16, y: 16 };
  // 0 is an inset, not a missing one
  const inset = (v: unknown) => {
    const n = parseFloat(v as string);
    return n >= 0 ? n : 16;
  };
  const x0 = inset(start.x),
    y0 = inset(start.y);
  let px = x0,
    py = y0;
  // The gap a capped panel keeps from the far edge: while it sits at its opts.floating placement, the inset that gave the
  // near one (16 for `true`), so a panel placed 16px down stops 16px short of the bottom. Once dragged or restored, it has
  // left that placement: the margin, as the drag clamp keeps. --twk-float-gap overrides either (tweaks.css registers it
  // as a <length>, so a rem or vh value computes to px here).
  let moved = !!saved,
    gap = MARGIN;
  const readGap = () => {
    const v = parseFloat(getComputedStyle(panel).getPropertyValue("--twk-float-gap"));
    gap = v >= 0 ? v : opts.floating && !moved ? inset(place?.y) : MARGIN;
  };
  // A fixed box ignores page scroll, so a floating panel caps at the viewport past its near edge and scrolls (tweaks.css).
  // Custom properties, not left / top / max-height: the stylesheet maps them, so host CSS can still override each one.
  const apply = () => {
    const s = panel.style;
    s.setProperty("--twk-float-x", px + "px");
    s.setProperty("--twk-float-y", py + "px");
    s.setProperty("--twk-float-max-h", `calc(100dvh - ${py + gap}px)`);
  };
  const clampPos = () => {
    readGap();
    const { maxX, maxY } = bounds();
    if (draggable) {
      px = clamp(px, MARGIN, maxX);
      py = clamp(py, MARGIN, maxY);
      return;
    }
    // A pinned panel clamps from its placement each time, so a window that narrows and widens again hands its spot back.
    px = clamp(x0, Math.min(MARGIN, x0), maxX);
    // It keeps its insets while they leave it half the window (or its full height, if less); past that the inset and the
    // far gap shrink together, so a short window never caps it to nothing.
    const room = vh() - Math.min(panel.scrollHeight + 1, vh() / 2),
      k = Math.min(1, room / (y0 + gap || 1));
    py = Math.round(y0 * k);
    gap = Math.round(gap * k);
  };
  const reclamp = () => {
    if (!destroyed && panel.dataset.mode === "floating" && panel.isConnected) {
      clampPos();
      apply();
    }
  };
  if ((draggable || opts.floating) && (opts.floating || saved)) {
    panel.dataset.mode = "floating";
    clampPos();
    apply();
    // A position saved on a larger monitor restores off-viewport: re-clamp once mounted (offsetWidth is 0 until then).
    requestAnimationFrame(reclamp);
  }

  // Per-control reset. The target is LABEL_SEL — the hint marker's list, so the two can't drift — or the root.
  const resetEntry = (e: Entry) => {
    assignDefault(e);
    last = e.path.join(".");
    notify();
  };
  const wireReset = (root: HTMLElement, entry: Entry) => {
    const t =
      root.querySelector<HTMLElement>(".twk-slider-value") || root.querySelector<HTMLElement>(LABEL_SEL) || root;
    t.classList.add("twk-resettable");
    t.title = tr("resetHint", "Double-click or hold to reset");
    // Coarse pointers get a press-and-hold reset: the desktop double-click fights double-tap-zoom on touch.
    let holdT = 0,
      hx = 0,
      hy = 0,
      held = false;
    const cancelHold = () => {
      if (holdT) {
        clearTimeout(holdT);
        holdT = 0;
        t.classList.remove("twk-reset-holding");
      }
    };
    t.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      held = false; // a press on the readout mustn't jump the slider
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      hx = e.clientX;
      hy = e.clientY;
      t.classList.add("twk-reset-holding");
      holdT = setTimeout(() => {
        holdT = 0;
        t.classList.remove("twk-reset-holding", "is-editable");
        held = true;
        resetEntry(entry);
      }, 500);
    });
    t.addEventListener("pointermove", (e) => {
      if (holdT && Math.abs(e.clientX - hx) + Math.abs(e.clientY - hy) > 8) cancelHold();
    });
    t.addEventListener("pointerup", cancelHold);
    t.addEventListener("pointercancel", cancelHold);
    t.addEventListener("pointerleave", cancelHold);
    // a long-press mustn't raise the text callout
    t.addEventListener("contextmenu", (e) => {
      if (held) e.preventDefault();
    });
    // a completed hold-reset swallows the trailing tap-to-edit
    t.addEventListener(
      "click",
      (e) => {
        if (held) {
          e.preventDefault();
          e.stopImmediatePropagation();
          held = false;
        }
      },
      true,
    );
    t.addEventListener("dblclick", (e) => {
      // a double-click in a text field is a word-select
      if (t === root && (e.target as Element).closest?.("input, textarea")) return;
      e.preventDefault();
      e.stopPropagation();
      resetEntry(entry);
    });
    // Click #1 can swap the readout for the inline input, so the dblclick lands there; delegated on the root.
    if (t.classList.contains("twk-slider-value"))
      root.addEventListener("dblclick", (e) => {
        const inp = e.target as HTMLElement;
        if (!inp.classList?.contains("twk-slider-input")) return;
        e.preventDefault();
        e.stopPropagation();
        inp.blur(); // commits + closes the editor; a no-op change, so no notify
        resetEntry(entry);
      });
    // The keyboard reset, Alt-qualified so a bare Backspace in a text field stays a backspace and the gradient editor keeps Delete.
    root.addEventListener("keydown", (e) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || (e.key !== "Backspace" && e.key !== "Delete")) return;
      e.preventDefault();
      e.stopPropagation();
      // an open inline editor commits + closes first
      if ((e.target as HTMLElement).classList?.contains("twk-slider-input")) (e.target as HTMLElement).blur();
      resetEntry(entry);
    });
  };

  // Conditional controls — `render` shows/hides, `disabled` grays-out + locks, both re-evaluated on every change; `hint` is a static tooltip.
  const conditionals: Array<{ node: HTMLElement; m: Meta }> = [];
  // fold.ts is a lazy chunk the first pass imports, so that pass just toggles; foldRow returns whether the row was revealed (re-measure).
  let fold: typeof import("./fold.js").fold | undefined;
  const foldRow = (node: HTMLElement & { _hid?: boolean }, hide: boolean) => {
    if (!node._hid === !hide) return false;
    node._hid = hide;
    if (fold) fold(node, hide);
    else node.classList.toggle("twk-cond-hidden", hide);
    return !hide;
  };
  const registerCond = (node: HTMLElement, m: Meta) => {
    if (m.hint) addHintMarker(node, m.hint);
    if (m.render || m.disabled != null) conditionals.push({ node, m });
  };
  // UI state for toJSON/fromJSON, keyed by path
  const folderEls: Array<{ path: string[]; el: HTMLElement; setCollapsed: (c: boolean) => void }> = [],
    tabsCtrls: Array<{ path: string[]; ctrl: TabsControl; pageKeys: string[] }> = [];

  // A control's own loop (the monitor, the FPS graph) hands back a `destroy`; a panel destroyed before it ever connected would run it forever.
  const adopt = (ctrl: Control) => {
    if (typeof ctrl.destroy === "function") cleanups.push(ctrl.destroy);
  };

  const build = (container: HTMLElement, ms: Meta[], target: Target, basePath: string[] = []) => {
    for (const m of ms) {
      if (m.type === "tabs") {
        const sub: Target = {};
        target[m.key] = sub;
        const makeTabs = getControl<TabsControl>("tabs");
        const tabsCtrl = makeTabs && makeTabs(m);
        if (!tabsCtrl) continue; // ensured before assemble; skipped if its chunk failed
        tabsCtrls.push({ path: [...basePath, m.key], ctrl: tabsCtrl, pageKeys: m.pages.map((p) => p.key) });
        m.pages.forEach((page, i) => {
          const psub: Target = {};
          sub[page.key] = psub;
          build(tabsCtrl.bodies[i], page.children, psub, [...basePath, m.key, page.key]);
        });
        registerCond(tabsCtrl.el, m);
        container.append(tabsCtrl.el);
        continue;
      }
      if (m.type === "folder") {
        const sub: Target = {};
        target[m.key] = sub;
        const f = createFolder(m);
        folderEls.push({ path: [...basePath, m.key], el: f.el, setCollapsed: f.setCollapsed });
        scopes.set(f.el, { kind: "folder", path: [...basePath, m.key], label: m.label });
        build(f.body, m.children, sub, [...basePath, m.key]);
        registerCond(f.el, m);
        container.append(f.el);
        continue;
      }
      const valued = !VALUELESS.has(m.type);
      const dotted = [...basePath, m.key].join("."); // a bare leaf couldn't tell size from card.size
      // a change made in the panel settles a row waiting for its stored image, as assign does
      let entry: Entry | undefined;
      // same-value emits (a re-entrant echo) don't notify
      const ctrl = createControl(
        m,
        valued
          ? (v: unknown) => {
              if (!valueChanged(target[m.key], v)) return;
              if (entry) waiting.delete(entry);
              target[m.key] = v;
              last = dotted;
              notify();
            }
          : () => {},
      );
      if (!ctrl) continue;
      adopt(ctrl);
      if (!valued) valueless.set(dotted, m.type);
      if (valued) {
        // reset() restores `raw` over the form the control OPENED on (`def`), read before the parked value applies — see restoreDefault.
        const def = ctrl.get();
        // A value a host parked on params before assemble ran wins over the schema default.
        if (hasOwn(target, m.key)) ctrl.set(target[m.key]);
        target[m.key] = ctrl.get();
        entry = {
          target,
          key: m.key,
          set: ctrl.set,
          get: ctrl.get,
          raw: m.value,
          def,
          path: [...basePath, m.key],
          persist: m.persist !== false,
          m,
          el: ctrl.el,
          note: ctrl.note,
          range: ctrl.range,
        };
        entries.push(entry);
        wireReset(ctrl.el, entry);
        scopes.set(ctrl.el, { kind: "row", entry, label: m.label });
      }
      registerCond(ctrl.el, m);
      container.append(ctrl.el);
    }
  };

  // ── Snapshots in: persisted sessions, presets, fromJSON, undo. Per-entry isolation: a control whose
  // set() throws on hostile stored data (a corrupt snapshot, a hand-edited preset) costs only its own value. ──
  const applySnapshot = (snap: Snapshot | null, silent?: boolean) => {
    if (!snap || typeof snap !== "object") return;
    for (const e of entries) {
      const v = atPath(snap, e.path);
      if (v === undefined) continue;
      tryAssign(e, v);
    }
    last = undefined;
    notify(silent);
  };
  // ── Named presets (opt-in via opts.persist) — snapshots under "<key>:presets" ──
  // null-proto: a preset named "__proto__" is an ordinary key
  const listPresets = (): Record<string, Snapshot> => {
    const p = presetsKey ? unwrap(readStore(presetsKey), "presets") : null;
    return Object.assign(Object.create(null), p && typeof p === "object" ? p : {});
  };
  // False when storage refused the write, so the caller can say so instead of claiming a save.
  // the menu announces a refusal
  const savePreset = (nm: string) => {
    const all = listPresets();
    all[nm] = toRefs(snapshot());
    return writePresets(all);
  };
  // re-read at replay: a delete queued ahead of it wins
  const loadPreset = (nm: string) => {
    const all = listPresets();
    if (all[nm]) restore(all[nm]);
  };
  const deletePreset = (nm: string) => {
    const all = listPresets();
    delete all[nm];
    if (writePresets(all)) pruneImages();
  };

  // ── Whole-panel UI state (toJSON / fromJSON) — folder open/closed and the active tab, keyed by dotted path ──
  // JSON-pointer escaping, so a literal "." can't collide
  const pathKey = (p: string[]) => p.map((k) => String(k).replace(/~/g, "~1").replace(/\./g, "~0")).join(".");
  const collectUI = () => {
    const ui: NonNullable<PanelState["ui"]> = {};
    if (folderEls.length) {
      const f: Record<string, boolean> = {};
      for (const fe of folderEls) f[pathKey(fe.path)] = fe.el.classList.contains("is-collapsed");
      ui.folders = f;
    }
    if (tabsCtrls.length) {
      const t: Record<string, string | null> = {};
      for (const tc of tabsCtrls) t[pathKey(tc.path)] = tc.pageKeys[tc.ctrl.active()] ?? null;
      ui.tabs = t;
    }
    return ui;
  };
  const applyUI = (ui: PanelState["ui"]) => {
    if (!ui || typeof ui !== "object") return;
    if (ui.folders)
      for (const fe of folderEls) {
        const c = ui.folders[pathKey(fe.path)];
        if (typeof c === "boolean") fe.setCollapsed(c);
      }
    // a re-activate would fire a spurious twk-reflow
    if (ui.tabs)
      for (const tc of tabsCtrls) {
        const i = tc.pageKeys.indexOf(ui.tabs[pathKey(tc.path)]);
        if (i >= 0 && i !== tc.ctrl.active()) tc.ctrl.activate(i);
      }
  };

  // ── Repositioning — drag the header to move the panel ──
  // An inline panel lifts into a floating layer on the first drag, at the spot it sat, then tracks the
  // pointer; on release it eases to a near viewport edge, and the position persists to "<key>:pos".
  if (draggable || opts.floating) {
    if (draggable) panel.dataset.draggable = "true"; // CSS grab cursor on the header — the affordance
    // Lift in place at the current rect; a same-size placeholder stays in the old slot, or the host container reflows mid-drag.
    const lift = () => {
      if (panel.dataset.mode === "floating") return;
      const r = panel.getBoundingClientRect();
      px = r.left;
      py = r.top;
      if (box.parentNode) {
        liftSlot = el("span", "twk-lift-slot");
        liftSlot.style.width = r.width + "px";
        liftSlot.style.height = r.height + "px";
        liftSlot.setAttribute("aria-hidden", "true");
        // a shadow panel's scheme pin is read at its slot from here on
        box.before(liftSlot);
        (box as any)._twSlot = liftSlot;
      }
      // Portal to <body>: a transformed/filter/contain ancestor would become the fixed panel's containing block. The scheme scope doesn't ride along — carry it.
      // So does the rest of the slot's context: the text properties the kit leaves to inheritance (a host's font-size,
      // letter-spacing, color, direction, lang) and every --twk-* token, inherited or matched through an ancestor selector
      // (`.my-sidebar .twk-panel { --twk-radius: 4px }`, as the theming page shows). Read with the panel's own theme off, so
      // opts.theme / setTheme() still layer on top and setTheme(null) falls back to the host's values; only what the move
      // changes is written, inline. A host rule reaching inside through an ancestor (`#app button { … }`) still stops
      // matching: only a shadow root could keep that.
      applyThemeVars(panel, null);
      const cs = getComputedStyle(panel),
        lang = box.closest("[lang]")?.getAttribute("lang"),
        was: Record<string, string> = {};
      for (const k of [
        "font-family",
        "font-size",
        "font-weight",
        "font-style",
        "font-stretch",
        "font-variant",
        "font-feature-settings",
        "font-variation-settings",
        "font-kerning",
        "line-height",
        "letter-spacing",
        "word-spacing",
        "text-transform",
        "text-align",
        "color",
        "direction",
        ...Array.from(cs).filter((k) => k.startsWith("--twk-")),
      ])
        was[k] = cs.getPropertyValue(k);
      carryScheme(panel, panel);
      document.body.appendChild(box);
      for (const k in was) if (cs.getPropertyValue(k) !== was[k]) panel.style.setProperty(k, (carried[k] = was[k]));
      if (lang && box.closest("[lang]")?.getAttribute("lang") !== lang) panel.lang = lang;
      applyThemeVars(panel, themeVars);
      panel.dataset.mode = "floating";
      apply();
      // A host that removes its container without destroy() would leave the lifted panel on screen; when the placeholder leaves the document, the panel follows.
      if (liftSlot && typeof MutationObserver === "function") {
        const obs = new MutationObserver(() => {
          if (liftSlot && !liftSlot.isConnected) {
            obs.disconnect();
            liftSlot = null;
            box.remove();
          }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
        cleanups.push(() => obs.disconnect());
      }
    };
    // Two floating panels share one stylesheet z-index; the last touched gets a higher one. A class at plain .twk-panel
    // specificity, not an inline value, so a host's own z-index still wins after a drag.
    const raise = () => {
      if (topFloating && topFloating !== panel) topFloating.classList.remove("is-raised");
      panel.classList.add("is-raised");
      topFloating = panel;
    };
    const grab = () => {
      moved = true;
      lift();
      raise();
      readGap();
    };
    const moveTo = (x: number, y: number, dx: number, dy: number) => {
      const { maxX, maxY } = bounds();
      px = clamp(x + dx, MARGIN, maxX);
      py = clamp(y + dy, MARGIN, maxY);
      apply();
    };
    const savePos = () => {
      if (posKey) writeStore(posKey, { x: px, y: py });
    };

    let dragId: number | null = null,
      sx = 0,
      sy = 0,
      ox = 0,
      oy = 0,
      snapT = 0;
    // Document listeners (capture, so the panel's own pointer-stop can't hide them) for the press's duration.
    // Capture is taken only past the threshold: on the press it would retarget a plain click off the title.
    const listen = (on: boolean) => {
      for (const [t, fn] of [
        ["pointermove", onMove],
        ["pointerup", endDrag],
        ["pointercancel", endDrag],
      ] as Array<[string, (e: PointerEvent) => void]>)
        on ? document.addEventListener(t, fn, true) : document.removeEventListener(t, fn, true);
      on
        ? document.addEventListener("keydown", onDragKey, true)
        : document.removeEventListener("keydown", onDragKey, true);
    };
    // Escape mid-press cancels: the panel returns to where the drag began and the release's click is swallowed. Capture
    // phase, so it beats a pane's Escape.
    const onDragKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || dragId === null) return;
      e.preventDefault();
      e.stopPropagation();
      // before the release, so a lostpointercapture finds no drag to end
      const id = dragId;
      dragId = null;
      listen(false);
      try {
        header.releasePointerCapture(id);
      } catch {}
      if (dragMoved) {
        px = ox;
        py = oy;
        apply();
      }
      panel.classList.remove("is-dragging");
      swallowClick = true;
      document.addEventListener(
        "pointerup",
        () =>
          setTimeout(() => {
            swallowClick = false;
          }, 0),
        { capture: true, once: true },
      );
    };
    if (draggable)
      header.addEventListener("pointerdown", (e) => {
        // draggable:false keeps lift/clamp, never the press
        if (e.button !== 0 || dragId !== null || (e.target as Element).closest(".twk-toolbar, input, textarea, select"))
          return;
        dragId = e.pointerId;
        sx = e.clientX;
        sy = e.clientY;
        dragMoved = false;
        listen(true);
        // Regrab mid–edge-snap: pick the panel up where it visually is, not the parked target.
        if (panel.classList.contains("is-snapping")) {
          clearTimeout(snapT);
          const cur = getComputedStyle(panel);
          px = parseFloat(cur.left) || px;
          py = parseFloat(cur.top) || py;
          panel.classList.remove("is-snapping");
          apply(); // …and drop the snap transition, so the grab is 1:1
        }
      });
    // The keyboard's drag: with the title focused, Alt+arrows move the panel 10px (Shift: 50px) through the same lift, clamp
    // and saved position as a pointer drag. Alt-qualified, so a bare arrow stays the page's.
    if (draggable)
      header.addEventListener("keydown", (e) => {
        if (e.target !== titleBtn || !e.altKey || e.metaKey || e.ctrlKey) return;
        const d = e.shiftKey ? 50 : 10,
          dx = e.key === "ArrowRight" ? d : e.key === "ArrowLeft" ? -d : 0,
          dy = e.key === "ArrowDown" ? d : e.key === "ArrowUp" ? -d : 0;
        if (!dx && !dy) return;
        e.preventDefault();
        e.stopPropagation();
        const lifting = panel.dataset.mode !== "floating";
        grab();
        // the lift moves the panel to <body>, which drops focus; the next step needs it back
        if (lifting) titleBtn.focus({ preventScroll: true });
        moveTo(px, py, dx, dy);
        savePos();
      });
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== dragId) return;
      // The window lost the pointer: bail as every other drag surface does.
      if (e.buttons === 0) {
        endDrag(e);
        return;
      }
      const dx = e.clientX - sx,
        dy = e.clientY - sy;
      if (!dragMoved) {
        // Drag slop: quick clicks wander a few px, fingers more. Collapsing is common and moving rare, so favor the click.
        if (Math.hypot(dx, dy) < (e.pointerType === "mouse" ? 6 : 10)) return;
        dragMoved = true;
        grab();
        ox = px;
        oy = py; // the (possibly just-lifted) origin, once the drag starts
        try {
          header.setPointerCapture(dragId);
        } catch {}
        panel.classList.add("is-dragging");
      }
      moveTo(ox, oy, dx, dy);
    };
    const endDrag = (e: PointerEvent) => {
      if (e.pointerId !== dragId) return;
      try {
        header.releasePointerCapture(dragId);
      } catch {}
      dragId = null;
      listen(false);
      // Swallow exactly the click that follows the release; let the flag lapse in case none comes (a pointercancel).
      swallowClick = dragMoved;
      if (swallowClick)
        setTimeout(() => {
          swallowClick = false;
        }, 0);
      if (dragMoved) {
        // Edge magnetism: a drop near a side eases the rest of the way to the margin.
        const { maxX, maxY } = bounds();
        if (px <= MARGIN + SNAP) px = MARGIN;
        else if (px >= maxX - SNAP) px = maxX;
        if (py <= MARGIN + SNAP) py = MARGIN;
        else if (py >= maxY - SNAP) py = maxY;
        // The ease is a class (tweaks.css), so the reduced-motion kill-switch covers it.
        // One timer at a time: an earlier drop's would strip the class 340ms after it, partway through this snap.
        clearTimeout(snapT);
        panel.classList.add("is-snapping");
        snapT = setTimeout(() => panel.classList.remove("is-snapping"), 340);
        apply();
        savePos();
      }
      panel.classList.remove("is-dragging");
    };
    header.addEventListener("lostpointercapture", endDrag); // implicit capture loss mid-drag ends it like a release
    cleanups.push(() => listen(false)); // a destroy() mid-press releases the document listeners
  }
  // Registered by assemble(): onLive releases itself once the owner LEAVES the document, which it can only tell if it saw the panel connected first.
  const watchResize = () => {
    if (!(draggable || opts.floating)) return;
    reclamp(); // a resize during the lazy window went unheard; clamp now
    cleanups.push(onLive(panel, [[window, "resize"]], reclamp));
  };

  // The menu is presets.ts, downloaded on the button's first hover, focus or press. A press before it lands opens it once it
  // does, unless Escape, or a press or focus elsewhere, came first, and a second press doesn't queue a second open; after that the
  // menu's popover owns the clicks. A chunk that fails to load is tried again on the next press.
  if (presetsBtn) {
    const b = presetsBtn;
    let menu: Promise<ReturnType<(typeof import("./presets.js"))["presetsMenu"]>> | undefined,
      made = false;
    const load = () =>
      (menu ||= import("./presets.js").then(
        (m) => {
          if (destroyed) throw 0;
          made = true;
          return m.presetsMenu(
            b,
            () => Object.keys(listPresets()),
            savePreset,
            loadPreset,
            deletePreset,
            announce,
            ICON_X,
            tr,
          );
        },
        (e) => {
          menu = undefined;
          if (e !== 0) console.error("[tweaks] presets:", e);
          throw e;
        },
      ));
    for (const t of ["pointerenter", "focus"])
      b.addEventListener(
        t,
        () => {
          load().catch(() => {});
        },
        { once: true },
      );
    let want = false;
    // Escape, or a press or focus elsewhere
    const cancel = (e: Event) => {
      if (e.type === "keydown" ? (e as KeyboardEvent).key === "Escape" : !e.composedPath().includes(b)) want = false;
    };
    const watch = (on: boolean) => {
      for (const t of ["pointerdown", "focusin", "keydown"])
        (on ? document.addEventListener : document.removeEventListener).call(document, t, cancel, true);
    };
    b.addEventListener("click", () => {
      if (made || b.disabled || want) return;
      want = true;
      watch(true);
      load()
        .then(
          (pop) => {
            if (want) pop.open();
          },
          () => {},
        )
        .finally(() => {
          want = false;
          watch(false);
        });
    });
  }

  // ── Undo / redo (opts.undo): undo.ts. inEditable is declared below, and only read on a keypress. ──
  const undoApi = opts.undo
    ? createUndo(
        panel,
        snapshot,
        applySnapshot,
        atPath,
        (t) => inEditable(t),
        (fn) => {
          listeners.add(fn);
          own.add(fn);
        },
      )
    : null;

  // ── Pick and copy / paste — a press beside a row (in the panel's side padding, or a gap between rows) picks it, as
  // a layer is picked in a design tool; beside a folder's header, the folder. ⌘C / ⌘V (ctrl elsewhere) then act on the
  // pick, or with none on the page, on the row holding focus. A row copies its value and pastes one back; a folder copies
  // its values object and pastes one into its own keys, so two folders with the same keys trade values. Escape, or a
  // press anywhere else, drops the pick; a text field or a text selection keeps the browser's own keys. ──
  const scopes = new Map<Element, Scope>(); // a row's or folder's root → its scope, filled by build()
  const scopeAt = (n: Element | null): Scope | undefined => {
    for (; n && n !== panel && panel.contains(n); n = n.parentElement) {
      const s = scopes.get(n);
      if (s) return s;
    }
  };
  const rowAt = (n: Element | null): Element | undefined => {
    for (; n && n !== panel; n = n.parentElement) if (scopes.get(n)?.kind === "row") return n;
  };
  // Out of sight: hidden by its condition, on a tab page not showing, or inside a collapsed folder or panel.
  const hidden = (el: Element) =>
    !!(
      el.closest(".twk-cond-hidden, .twk-tabs-page:not([data-active=true])") ||
      el.parentElement?.closest(".is-collapsed")
    );
  let pick: [Element, Scope] | undefined;
  // the path: a shadow host retargets e.target
  const away = (e: Event) => {
    const t = e.composedPath()[0] as Element;
    if (!panel.contains(t) && !t.closest?.(".twk-portal")) unpick();
  };
  const unpick = () => {
    if (!pick) return;
    pick[0].classList.remove("is-picked");
    pick = undefined;
    document.removeEventListener("pointerdown", away, true);
    if (picked?.[0] === panel) picked = null;
  };
  const choose = (el: Element, s: Scope) => {
    if (picked && picked[0] !== panel) picked[1](); // one pick on the page
    unpick();
    pick = [el, s];
    picked = [panel, unpick];
    el.classList.add("is-picked");
    document.addEventListener("pointerdown", away, true); // only while something is picked
    // Focus moves to what was picked (a folder's header, a row's control), so its keys work and a screen reader names
    // it; a press shows no ring. A text field isn't focused, or ⌘V would paste into it as text, and any selection goes.
    // its tab stop, not a hint or a closed pop's
    const f = [...el.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), [tabindex="0"]')].find(
      (n) => !n.closest(".twk-hint, .twk-portal, [inert]"),
    );
    if (f) f.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
    else (activeIn(panel) as HTMLElement | null)?.blur?.();
    document.getSelection?.()?.removeAllRanges();
  };
  cleanups.push(unpick);
  panel.addEventListener(
    "pointerdown",
    (e) => {
      const t = e.target as Element;
      // On a control, or a header: working the picked row keeps the pick, anything else drops it. A touch never picks:
      // a phone has no ⌘C, and a scroll that starts in the padding shouldn't pick what it passes.
      if (rowAt(t) || t.closest(".twk-header, .twk-folder-header, button, input, textarea, select")) {
        if (!pick?.[0].contains(t)) unpick();
        return;
      }
      if (e.button !== 0 || e.pointerType === "touch") return unpick();
      // Beside a row: the row (or folder header) level with the press, by its own box, so nothing overlapping the panel
      // can stand in the way. The last match is the deepest: a folder's rows come after it.
      let hit: [Element, Scope] | undefined;
      for (const [el, s] of scopes) {
        const r = (s.kind === "folder" ? el.firstElementChild! : el).getBoundingClientRect();
        if (r.height && e.clientY >= r.top && e.clientY < r.bottom && !hidden(el)) hit = [el, s];
      }
      if (!hit) return unpick();
      e.preventDefault(); // no text selection
      choose(...hit);
    },
    true,
  ); // capture: a label's own pointerdown stops the event before it bubbles here
  const inEditable = (t: Element | null) =>
    !!(
      t &&
      (t as HTMLElement).matches &&
      ((t as HTMLElement).matches("input, textarea, select") || (t as HTMLElement).isContentEditable)
    );
  // Called from the panel's one keydown listener (registered by assemble(), beside the undo keys). Focus steps to the
  // hidden field for the keypress (the copy selected in it), the browser copies or pastes there, and focus steps back.
  const onClipKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (pick) {
        e.stopPropagation();
        unpick();
      }
      return;
    }
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.repeat || inEditable(e.composedPath()[0] as Element)) return;
    const k = e.key.toLowerCase();
    if (k !== "c" && k !== "v") return;
    // the picking panel left the page without destroy(): free the slot
    if (picked && !picked[0].isConnected) picked[1]();
    if (pick && hidden(pick[0])) unpick(); // a pick out of sight takes nothing
    // focus on a hidden row takes nothing either
    const fe = activeIn(panel),
      s = pick ? pick[1] : picked || !fe || hidden(fe) ? undefined : scopeAt(fe);
    // a shadow root's own selection where it has one (Chrome); else the document's holds it
    const rn: any = panel.getRootNode();
    // selected text: the browser copies that
    if (!s || (k === "c" && String((rn.getSelection ? rn : document).getSelection?.() || ""))) return;
    const json =
      k === "c" ? JSON.stringify(s.kind === "row" ? s.entry.get() : atPath(snapshot(), s.path), replacer, 2) : "";
    // words for a screen reader; the toolbar's copy button stays as it is
    const copied = (ok: boolean) => {
      if (!destroyed)
        announce(ok ? tr("rowCopied", "{label} copied", { label: s.label }) : tr("copyFailed", "Copy failed"));
    };
    const band = pick?.[0],
      back = activeIn(panel) as HTMLElement | null,
      ring = !!back?.matches(":focus-visible");
    // The browser's copy or paste can land some milliseconds after this keydown (an app's menu passes it on), so focus
    // steps back only when it lands, or after a second with none; it's caught page-wide, wherever focus is by then.
    if (!catchEl) {
      catchEl = el("textarea", "twk-sr");
      catchEl.tabIndex = -1;
      catchEl.setAttribute("aria-hidden", "true");
      for (const t of ["copy", "paste"]) document.addEventListener(t, (e) => onCatch?.(e as ClipboardEvent), true);
    }
    const ta = catchEl,
      done = () => {
        onCatch = null;
        if (document.activeElement === ta) {
          ta.blur();
          back?.focus?.({ preventScroll: true, focusVisible: ring } as FocusOptions);
        }
      };
    const h = (onCatch = (ev) => {
      if (ev.target !== ta && inEditable(ev.target as Element)) return; // a field focused meanwhile keeps its own paste
      ev.preventDefault();
      done();
      if (json) return (ev.clipboardData?.setData("text/plain", json), copied(!!ev.clipboardData));
      const t = ev.clipboardData?.getData("text/plain") ?? null;
      import("./clip.js").then(
        (m) => m.pasteInto(t, (t) => m.pasteScope(ctx, s, t), ctx, band),
        () => {},
      );
    });
    if (!ta.isConnected) document.body.appendChild(ta);
    ta.value = json;
    ta.focus({ preventScroll: true });
    ta.select();
    // none came: write the copy directly
    setTimeout(() => {
      if (onCatch === h) {
        done();
        if (json) copyText(json).then(copied);
      }
    }, 1000);
  };

  // Build the controls, then everything that needs them: the conditionals' first pass, the persisted restore,
  // the undo seed, the queued API calls. Synchronous when every control type is registered, else behind panel.ready.
  const assemble = () => {
    if (destroyed) return; // destroy() before the chunks landed: nothing to build
    built = cleanups.length;
    using(opts.strings, () => build(controls, metas, params));
    if (conditionals.length) {
      // first wins
      const byKey = new Map<string, Entry>();
      for (const e of entries) if (!byKey.has(e.key)) byKey.set(e.key, e);
      const getVal = (k: string) => {
        const e = byKey.get(k);
        return e ? e.target[e.key] : params[k];
      };
      const applyConditionals = () => {
        let revealed = false;
        for (const { node, m } of conditionals) {
          // A throwing predicate leaves the node as-is rather than aborting the pass.
          try {
            if (m.render && foldRow(node, !m.render(getVal))) revealed = true;
            if (m.disabled != null) {
              const d = typeof m.disabled === "function" ? m.disabled(getVal) : m.disabled;
              setDisabled(node, !!d);
            }
          } catch {}
        }
        if (revealed) requestReflow(); // built hidden it measured 0×0; shown, let it re-measure
      };
      listeners.add(applyConditionals);
      own.add(applyConditionals);
      applyConditionals();
      // a fold chunk that fails to load leaves the rows toggling
      import("./fold.js").then(
        (m) => {
          fold = m.fold;
        },
        () => {},
      );
    }
    // Restore last session, notifying: on the lazy path a host may already have subscribed.
    if (persistKey) restore(unsaved(unwrap(readStore(persistKey), "values")));
    if (destroyed) return; // a listener may have destroyed the panel on that notify
    undoApi?.arm();
    watchResize();
    // one document listener per panel for its keys
    cleanups.push(
      onLive(panel, [[document, "keydown"]], (e: KeyboardEvent) => {
        undoApi?.onKey(e);
        onClipKey(e);
      }),
    );
    assembled = true;
    // Replay after the restore, so an explicit host set() wins over a stored value; a destroy() mid-replay drops the rest.
    for (const fn of queue.splice(0)) {
      if (destroyed) break;
      try {
        fn();
      } catch (e) {
        console.error("[tweaks] a call queued before ready failed:", e);
      }
    }
    for (const b of toolbarBtns) b.disabled = false; // the controls exist now
  };

  // A set() past a hard range clamps, which is right, but silent it reads as the value not taking: say so, once a key.
  const clamped = new Set<Entry>();
  // Each number asked for is held to the range the control resolved (derived bounds, a point's per component), not the
  // schema's min and max, which a derived range leaves unset; a hair past an end is float noise, not a clamp.
  const clampNote = (e: Entry, key: string, v: unknown) => {
    const r = e.range;
    if (!r || e.m.soft || clamped.has(e)) return;
    // [component, number] pairs: one number, a list (interval, sides), a sides string, or an object's sides or components.
    const asked: [string, unknown][] =
      typeof v === "string"
        ? v
            .trim()
            .split(/\s+/)
            .map((s) => ["", parseFloat(s)])
        : Array.isArray(v)
          ? v.map((n) => ["", n])
          : isObj(v)
            ? Object.entries(v)
            : [["", v]];
    for (const [k, n] of asked) {
      const b = Array.isArray(r) ? r : r[k],
        eps = 1e-9 * Math.max(1, Math.abs(n as number));
      if (b && typeof n === "number" && (n < b[0] - eps || n > b[1] + eps)) {
        clamped.add(e);
        notice("clamp", key, v, b[0], b[1], e.m.type);
        return;
      }
    }
  };
  // Resolve a (possibly dotted) key, apply, report whether the leaf changed; never notifies, so setMany fires one notify.
  const applySet = (key: string, v: unknown) => {
    if (String(key).split(".").some(isReservedKey)) return false; // never write through to the prototype
    const parts = String(key).split(".");
    // The path exactly as changes() names it first, so a key holding a dot ("a.b", "f.a.b") is reachable; two controls
    // whose paths read the same (a top-level "a.b" beside folder a's b) are ambiguous, not a guess.
    const exact = entries.filter((x) => x.path.join(".") === key);
    if (exact.length > 1) {
      notice("ambiguousPath", key, exact.length);
      return false;
    }
    let e: Entry | undefined = exact[0];
    if (!e && parts.length > 1) {
      const t = valueless.get(key);
      notice(t ? "noValue" : "noPath", key, t);
      return false;
    }
    if (!e) {
      const matches = entries.filter((x) => x.key === key);
      if (matches.length > 1) {
        notice("ambiguousKey", key, matches.length, matches[0].path.join("."));
        return false;
      }
      e = matches[0];
    }
    // A key no control owns is refused: written through, a typo landed on params and in every save after.
    // A button, monitor or separator is there but holds nothing to set, which "no control has that key" would misstate.
    const vt = !e && (valueless.get(key) || [...valueless].find(([p]) => p.split(".").pop() === key)?.[1]);
    if (!e) {
      if (vt) notice("noValue", key, vt);
      else
        notice(
          "noControl",
          key,
          metas.some((m) => m.key === key && (m.type === "folder" || m.type === "tabs")),
        );
      return false;
    }
    const prev = e.target[e.key];
    // Same isolation as applySnapshot: a hostile value costs only that key.
    if (notAValue(v)) return false;
    try {
      assign(e, v);
    } catch (err) {
      console.error(`[tweaks] set("${key}") failed — value skipped:`, err);
      return false;
    }
    clampNote(e, key, v);
    if (!valueChanged(prev, e.target[e.key])) return false; // keeps a store-sync listener from echoing forever
    last = e.path.join("."); // on((p, last)) sees programmatic sets like control edits
    return true;
  };

  // Every mutating method goes through later(): live at once, queued in the lazy window, silent after destroy().
  const api = {
    el: box,
    params,
    on(fn) {
      if (destroyed) return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // a key that can't stringify throws here, not in the replay
    set(key, v, o) {
      const k = String(key),
        silent = o?.silent;
      later(() => {
        if (applySet(k, v)) notify(silent);
      });
    },
    // Batch write: listeners + persist fire once for the whole batch.
    setMany(values, o) {
      if (values == null || typeof values !== "object") return;
      const batch = Object.entries(values),
        silent = o?.silent; // read now, so a later mutation can't reach the replay
      // per-key isolation: a bad value costs only its key; one changed key is named, many aren't
      later(() => {
        let changed = 0;
        for (const [k, v] of batch) {
          try {
            if (applySet(k, v)) changed++;
          } catch (e) {
            console.error(`[tweaks] setMany("${k}") failed — key skipped:`, e);
          }
        }
        if (changed > 1) last = undefined;
        if (changed) notify(silent);
      });
    },
    reset() {
      if (assembled && !destroyed) spinReset(resetBtn);
      later(resetAll);
    },
    // Whole-panel state — values + UI as a JSON-safe object (the standard toJSON hook). Before ready there
    // are no values yet. fromJSON applies one back: values (one notify), then the UI silently, outside undo.
    toJSON() {
      return destroyed ? { values: {}, ui: {} } : { values: snapshot(), ui: collectUI() };
    },
    changes() {
      return destroyed ? {} : changed();
    }, // empty in the lazy window too — no entries yet
    fromJSON(state, o) {
      if (!state || typeof state !== "object") return;
      const silent = o?.silent;
      // read now (one level), like setMany
      const values = state.values && typeof state.values === "object" ? { ...state.values } : state.values,
        ui = state.ui && typeof state.ui === "object" ? { ...state.ui } : state.ui;
      later(() => {
        if (values) applySnapshot(values, silent);
        applyUI(ui);
      });
    },
    // Live theming clears the prior theme first, so setTheme(null) reverts to the default look.
    // a rename never moves saved values or presets
    setName(n) {
      if (destroyed) return;
      title = String(n);
      titleEl.textContent = title;
      landmark(title);
    },
    // A lifted panel's carried context sits under the theme: a key the old theme set and the new one drops falls back to it.
    setTheme(theme) {
      if (destroyed) return;
      applyThemeVars(panel, null);
      for (const k in carried) panel.style.setProperty(k, carried[k]);
      themeVars = resolveTheme(theme);
      panel._twTheme = themeVars;
      applyThemeVars(panel, themeVars);
      window.dispatchEvent(new Event("twk-retheme"));
    },
    // Presets API (no-ops without opts.persist); before ready they queue like set() does.
    // queued before ready counts as saved; once built, whether storage took it
    savePreset: (nm) => {
      if (destroyed || failed || !presetsKey || !nm) return false;
      let ok = true;
      later(() => {
        ok = savePreset(nm);
      });
      return ok;
    },
    // whether it's stored now; a save still queued before ready isn't yet
    loadPreset: (nm) => {
      if (destroyed || failed || !listPresets()[nm]) return false;
      later(() => loadPreset(nm));
      return true;
    },
    deletePreset: (nm) => {
      if (presetsKey) later(() => deletePreset(nm));
    },
    presets: () => (destroyed ? [] : Object.keys(listPresets())),
    // no-ops without opts.undo; queued before ready, in order
    undo: () => {
      if (undoApi) later(undoApi.undo);
    },
    redo: () => {
      if (undoApi) later(undoApi.redo);
    },
    // Teardown. Safe to call before ready resolves — assemble() sees the flag and bails.
    destroy() {
      if (destroyed) return;
      destroyed = true;
      releaseKey();
      closeActivePopover(panel); // page-wide singletons: close only what's anchored here
      hideHintNow(panel);
      for (const fn of cleanups.splice(0)) {
        try {
          fn();
        } catch {}
      }
      listeners.clear();
      if (liftSlot) {
        liftSlot.remove();
        liftSlot = null;
      }
      if (topFloating === panel) topFloating = null;
      panel.dataset.twkDestroyed = ""; // onLive listeners release on their next event by this mark
      box.remove();
    },
  } as Panel; // `ready` is filled in just below
  // Assemble once the missing modules resolve, surfacing that on ready; else assemble now. A panel that persists an image
  // builds without waiting for its stored images; they fill in when the store answers, and `ready` waits for that too.
  // A store that fails to load just saves no uploads.
  const images =
    persistKey && scanTypes(metas).has("image")
      ? import("./image-store.js").then(
          async (m) => {
            savedImages = await m.load(persistKey);
            // A refused upload saves again, inline; after destroy() no save is armed, so it writes now while storage still names that ref.
            if (savedImages)
              imgs = m.bind(
                persistKey,
                savedImages,
                (ref) => {
                  if (!destroyed) persist();
                  else if (JSON.stringify(readStore(persistKey)).includes(JSON.stringify(ref))) saveNow();
                },
                listPresets,
                (v) => !!presetsKey && writePresets(v),
              );
          },
          () => {},
        )
      : null;
  if (!images) imagesReady = true;
  const imagesIn = images && images.then(restoreImages);
  // A shadow panel's dressing: `ready` waits for it, not for the stylesheet's download.
  const shadowIn = iso.dressed;
  cleanups.push(iso.end);
  const lazy = ensureForMetas(metas);
  if (lazy) {
    // A failed chunk or a throwing build leaves the panel unbuildable: queued calls dropped, later calls refused,
    // ready rejects. A partway build must not leave live controls behind an inert API: release what it wired.
    const fail = (e: unknown) => {
      failed = true;
      queue.length = 0;
      releaseKey();
      // only what the build wired; the shell's stay for destroy()
      if (built >= 0)
        for (const fn of cleanups.splice(built)) {
          try {
            fn();
          } catch {}
        }
      // detached below, they'd never see the panel's own mark
      for (const c of controls.children) (c as HTMLElement).dataset.twkDestroyed = "";
      listeners.clear();
      entries.length = 0;
      controls.replaceChildren();
      // the chunk's own error is logged in lazy.ts
      if (!destroyed)
        console.warn(
          `[tweaks] "${name}": the panel could not be built — ${built >= 0 ? "the build threw" : "its lazy controls failed to load"}; the API is inert`,
        );
      throw e;
    };
    const building = lazy.then(assemble);
    // fail covers both the chunk and a build that throws
    api.ready = panel.ready = (imagesIn || shadowIn ? Promise.all([building, imagesIn, shadowIn]) : building).then(
      () => api,
      fail,
    );
    api.ready.catch(() => {}); // a handled fork: no unhandled-rejection noise
  } else {
    assemble();
    api.ready = panel.ready =
      imagesIn || shadowIn ? Promise.all([imagesIn, shadowIn]).then(() => api) : Promise.resolve(api);
  }
  return api as Panel;
}
