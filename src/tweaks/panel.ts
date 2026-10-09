/* tweaks() — the panel factory: builds the shell + controls from a schema and
 * returns the live API (params/on/set/reset/toJSON/…). Persistence, presets,
 * undo, the filter, floating drag, and the lazy-window queue all live here. */
import {
  el, btn, txt, clamp, popover, closeActivePopover, stopPointerLeak, setCollapsed,
  applyThemeVars, resolveTheme, carryScheme, onLive, requestReflow, quietFocus, fuzzyMatch,
  REDUCE_MOTION, getControl,
} from "./shared.js";
import { metaFor, valueChanged, restoreDefault, hasOwn, isReservedKey, VALUELESS } from "./schema.js";
import { ensureForMetas } from "./lazy.js";
import { createFolder, createControl } from "./controls/basic.js";
import { makeCopyBtn, makeResetBtn, toolbarBtn, spinReset, showToast, hideHintNow, addHintMarker, LABEL_SEL } from "./feedback.js";
import { ICON_PRESETS, ICON_X, ICON_SEARCH } from "./icons.js";
import type { Schema, TweaksOptions, Panel, Params, PanelState, Control } from "./types.js";
import type { Meta } from "./schema.js";
import type { PanelEl } from "./shared.js";
import type { TabsControl } from "./controls/tabs.js";

/** A params object or one of its folder/tabs sub-objects — the holder a control writes into. */
type Target = Record<string, unknown>;
/** A valued control's wiring: where its value lives (target + key), its set/get, the pair
 *  reset restores (the authored value and the form it opened on), and its dotted path. */
interface Entry { target: Target; key: string; set: Control["set"]; get: Control["get"]; raw: unknown; def: unknown; path: string[] }
/** A values snapshot — params minus `_last`, as JSON round-trips it (persist, presets,
 *  undo, toJSON). A parsed JSON blob: its leaves are whatever the controls, or a
 *  hand-edited store, hold. */
type Snapshot = Record<string, any>;
/** A folder in the filter index: its node, label and body (for the child scan). */
interface FolderItem { el: HTMLElement; label: string; body: HTMLElement }

let topFloating: HTMLElement | null = null; // the floating panel raised last (see raise() in the drag wiring)

export function tweaks(name: string, schema: Schema, opts: TweaksOptions = {}): Panel {
  // "_last" is the changed-key channel on params — a schema entry by that name would
  // fight it (the param's value doubles as the listener's "what changed" argument).
  const metas = Object.entries(schema).filter(([k]) => k !== "_last" || (console.warn('[tweaks] "_last" is reserved (the changed-key channel) — schema entry skipped'), false)).map(([k, v]) => metaFor(k, v)).filter(Boolean);
  const params: Params = {};
  const entries: Entry[] = []; // { target, key, set, get, def, path } — flattened across folders, for reset + persist
  const subTrees = new Set<Target>(); // the folder/tabs params sub-objects — set() refuses to overwrite one (doing so orphaned every child entry silently)
  const listeners = new Set<(p: Params, last?: string) => void>();
  const cleanups: Array<() => void> = []; // every global attachment (document/window listeners, pending timers) registers its release here for destroy()
  let destroyed = false; // flipped by destroy(): assemble() bails, the mutating API methods go silent
  let assembled = false; // flipped at the end of assemble() — until then the controls don't exist
  // The lazy window (split build, before the chunks land): a mutating API call made before
  // the controls exist queues here and replays — in call order, against the real entries —
  // once assemble() has built them. A dotted/nested set before then used to warn-and-drop,
  // a bare nested key minted a top-level orphan while the control kept its default, and a
  // preset save or an undo was silently dropped.
  const queue: Array<() => void> = [];
  const presetOps = new Map<string, "save" | "delete">(); // the last preset op a lazy-window call queued per name: a loadPreset() behind a save is accepted, one behind a delete refused; cleared once the queue has replayed
  let failed = false; // flipped when the lazy chunks fail to load: the panel can never be built, so the queue would only grow
  const later = (fn: () => void) => { if (destroyed) return; if (failed) { console.warn("[tweaks] call ignored — the panel's lazy controls failed to load"); return; } assembled ? fn() : queue.push(fn); }; // a refused call says so, like every other refusal here
  let liftSlot: HTMLSpanElement | null = null; // the placeholder a lifted panel leaves in its host slot — removed on destroy()
  // The values snapshot — persist, presets, undo, toJSON and copy all read it: params minus
  // its `_last` channel, with a control holding `undefined` (a list with no matching option,
  // a set(key, undefined)) written as null — JSON has no undefined, so the key silently
  // dropped out, and a null → undefined edit was invisible to undo (redo left the null behind).
  // A replacer function, not an arrow: `this` is the holder, so only the top-level
  // changed-key strips — a folder child legitimately keyed "_last" survives.
  const replacer = function (this: unknown, k: string, v: unknown) { return k === "_last" && this === params ? undefined : v === undefined ? null : typeof v === "bigint" ? String(v) : v; }; // a bigint (a host-parked bag value) would otherwise throw out of every snapshot — the debounced persist and undo timers uncaught
  const snapshot = (): Snapshot => JSON.parse(JSON.stringify(params, replacer));
  // Persistence + presets storage keys — opt-in via opts.persist (a string key, or
  // `true` to key by the panel name). null disables both (existing callers unaffected).
  const persistKey = opts.persist ? `tw:${opts.persist === true ? name : opts.persist}` : null;
  const presetsKey = persistKey ? `${persistKey}:presets` : null;
  const readStore = (k: string): any => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }; // any: a parsed JSON blob, whatever the store holds
  const writeStore = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  // The live values save to localStorage, debounced. destroy() flushes a pending write
  // rather than dropping it — the last edit before a teardown (an SPA route change right
  // after a tweak) used to vanish with the timer.
  const persist = persistKey ? (() => {
    let saveT = 0;
    const save = () => { saveT = 0; writeStore(persistKey, snapshot()); };
    cleanups.push(() => { if (saveT) { clearTimeout(saveT); save(); } });
    return () => { clearTimeout(saveT); saveT = setTimeout(save, 150); };
  })() : () => {};
  // Each listener runs isolated: a throwing on() callback (or internal listener)
  // can't break the others, skip persist(), or bubble back out through set().
  const notify = () => { listeners.forEach((fn) => { try { fn(params, params._last); } catch (e) { console.error("[tweaks] listener threw:", e); } }); if (!destroyed) persist(); }; // a listener may destroy() the panel: the flush cleanup already ran, so no new save may be armed behind it
  // Push a value into a control and mirror what it actually took back onto params — the
  // one write path behind restores and set(). A function/symbol/bigint is no control value
  // (the list control stores any value as-is, and JSON can't carry those: every snapshot
  // silently dropped the key) — set() warns first; the restore paths' per-entry catch logs it.
  const notAValue = (v: unknown) => typeof v === "function" || typeof v === "symbol" || typeof v === "bigint";
  const assign = (e: Entry, v: unknown) => { if (notAValue(v)) throw new TypeError(`a ${typeof v} is not a control value`); e.set(v); e.target[e.key] = e.get(); };
  // …and the reset write: the opened form, then the authored value (restoreDefault).
  const assignDefault = (e: Entry) => { restoreDefault(e, e.raw, e.def); e.target[e.key] = e.get(); };
  // The reset itself, independent of the toolbar button — api.reset() and the lazy-window
  // replay run it directly. Per-entry isolation like applySnapshot. opts.onReset replaces
  // the default; a reset() called from INSIDE it performs the default instead of
  // re-entering the hook (resetAll → onReset → reset() → resetAll → … used to recurse until
  // the stack blew — the hook that wraps the default is the obvious thing to write).
  let inOnReset = false;
  const resetAll = () => {
    if (typeof opts.onReset === "function" && !inOnReset) {
      inOnReset = true;
      try { return opts.onReset(); } finally { inOnReset = false; }
    }
    for (const e of entries) {
      try { assignDefault(e); }
      catch (err) { console.error(`[tweaks] resetting "${e.path.join(".")}" failed — control skipped:`, err); }
    }
    params._last = undefined; notify();
  };

  const panel: PanelEl = el("div", "tw-panel"); panel.dataset.mode = "inline";
  // Stop pointer events leaking past the panel to whatever's behind it (e.g. a
  // demo stage that listens on window). The controls have handled them by now.
  stopPointerLeak(panel);
  const header = el("div", "tw-header");
  // Tapping the title collapses the body; the toolbar sits
  // beside it and never triggers a collapse. No chevron — the title is the toggle.
  const titleBtn = btn("tw-header-toggle");
  titleBtn.setAttribute("aria-expanded", "true");
  titleBtn.append(txt("span", "tw-title", name));
  const toolbar = el("div", "tw-toolbar");
  // Copy emits the values snapshot; reset restores every default (or runs opts.onReset).
  // feedback.ts owns their click feedback (the copy ⇄ check swap, the reset spin).
  const copyBtn = makeCopyBtn(panel, name, () => JSON.stringify(params, replacer, 2));
  const resetBtn = makeResetBtn(resetAll);
  // Presets button appears only when persistence is on (presets share its storage).
  let presetsBtn: HTMLButtonElement | null = null;
  if (persistKey) {
    presetsBtn = toolbarBtn("", ICON_PRESETS, "Presets");
    presetsBtn.setAttribute("aria-haspopup", "menu"); presetsBtn.setAttribute("aria-expanded", "false");
    toolbar.append(presetsBtn);
  }
  // Filter (opts.filter): a search button swaps the title for an input; typing hides
  // controls whose label doesn't match (folders stay if their title or a child does).
  // The filter lives behind a toolbar button, so it needs a toolbar: with toolbar:false
  // the button was never mounted and nothing could flip .is-searching — the input sat in
  // the header, permanently invisible, with the whole search index built behind it.
  const filterOn = !!opts.filter && (opts.toolbar !== false || (console.warn("[tweaks] opts.filter needs the toolbar (its search button lives there) — ignored alongside toolbar:false"), false));
  const searchBtn = filterOn ? toolbarBtn("", ICON_SEARCH, "Filter controls") : null;
  const searchInput = filterOn ? el("input", "tw-search") : null;
  if (filterOn) {
    searchInput.type = "text"; searchInput.placeholder = "Filter…"; searchInput.spellcheck = false; searchInput.setAttribute("aria-label", "Filter controls");
    quietFocus(searchInput);
    toolbar.append(searchBtn);
  }
  toolbar.append(copyBtn, resetBtn);
  header.append(titleBtn);
  if (filterOn) header.append(searchInput);
  if (opts.toolbar !== false) header.append(toolbar); // opts.toolbar:false → a bare panel (no copy/reset/presets), e.g. an embedded single-control demo
  // The buttons act on controls that only exist once assemble() has built them — until
  // then (the lazy-chunk window on the split build) they're honestly inert rather than
  // silently dead.
  const toolbarBtns = [copyBtn, resetBtn, presetsBtn, searchBtn].filter(Boolean);
  for (const b of toolbarBtns) b.disabled = true;
  // A header drag (floating mode) sets this so the click ending the drag doesn't collapse.
  // The swallow lives on the header, not the title: once the header holds pointer capture
  // the browser dispatches that click to the header (the common ancestor of the press and
  // the release), so a title-level guard never saw it and ate the NEXT real click instead.
  let dragMoved = false, swallowClick = false;
  header.addEventListener("click", (e) => { if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); } }, true);
  titleBtn.addEventListener("click", () => {
    setCollapsed(panel, titleBtn, body, !panel.classList.contains("is-collapsed"));
    // A bottom-parked floating panel grows past the viewport when it expands — re-clamp
    // once the 0.25s body collapse has settled and the height is real.
    if (panel.dataset.mode === "floating") setTimeout(() => { if (panel.dataset.mode === "floating" && panel.isConnected) { clampPos(); apply(); } }, 270);
  });
  const body = el("div", "tw-body");
  const controls = el("div", "tw-controls");
  body.append(controls);
  panel.append(header, body);

  // Apply the optional theme to the panel; stash it so the portaled popovers —
  // which escape to <body> and lose the panel's inherited vars — re-apply it on open.
  let themeVars = resolveTheme(opts.theme);
  applyThemeVars(panel, themeVars); panel._twTheme = themeVars;

  // ── Floating position — seeded in the shell, so an opts.floating / persisted-position
  // panel is fixed in place the moment tweaks() returns instead of jumping when the lazy
  // chunks land. ──
  const draggable = opts.draggable !== false;
  const MARGIN = 8, SNAP = 28; // px: viewport inset, and the drop distance within which the panel parks against an edge
  const bounds = () => ({ maxX: Math.max(MARGIN, window.innerWidth - panel.offsetWidth - MARGIN), maxY: Math.max(MARGIN, window.innerHeight - panel.offsetHeight - MARGIN) });
  const posKey = persistKey ? `${persistKey}:pos` : null;
  const saved = (draggable || opts.floating) && posKey ? readStore(posKey) : null;
  const start = saved || (typeof opts.floating === "object" ? opts.floating : null) || { x: 16, y: 16 };
  let px = +start.x || 16, py = +start.y || 16;
  const apply = () => { panel.style.left = px + "px"; panel.style.top = py + "px"; };
  const clampPos = () => { const { maxX, maxY } = bounds(); px = clamp(px, MARGIN, maxX); py = clamp(py, MARGIN, maxY); };
  if ((draggable || opts.floating) && (opts.floating || saved)) {
    panel.dataset.mode = "floating"; clampPos(); apply();
    // A position saved on a larger monitor restores fully off this viewport — re-clamp
    // once the host has mounted the panel (offsetWidth is 0 until then, so the build-time
    // clamp above can only pin the left/top edge into the viewport).
    requestAnimationFrame(() => { if (!destroyed && panel.dataset.mode === "floating" && panel.isConnected) { clampPos(); apply(); } });
  }

  // Per-control reset: double-click a control's label (or the slider's value
  // readout — its label is a pointer-events:none overlay) to revert just that
  // control to the default it was built with. Complements the whole-panel reset.
  // The target is the control's label (LABEL_SEL — the same list the hint marker homes
  // on, so the two can't drift), or the whole root for a label-less control.
  const resetEntry = (e: Entry) => { assignDefault(e); params._last = e.key; notify(); };
  const wireReset = (root: HTMLElement, entry: Entry) => {
    const t = root.querySelector<HTMLElement>(".tw-slider-value")
      || root.querySelector<HTMLElement>(LABEL_SEL)
      || root;
    t.classList.add("tw-resettable"); t.title = "Double-click or hold to reset";
    // Coarse pointers get a press-and-hold reset — the desktop double-click fights
    // double-tap-zoom on touch. The held class fills a charging cue; releasing or moving
    // off before it completes cancels. On the slider value (which also taps-to-edit), a
    // completed hold drops is-editable and swallows the trailing tap so it resets cleanly.
    let holdT = 0, hx = 0, hy = 0, held = false;
    const cancelHold = () => { if (holdT) { clearTimeout(holdT); holdT = 0; t.classList.remove("tw-reset-holding"); } };
    t.addEventListener("pointerdown", (e) => {
      e.stopPropagation(); held = false; // a press on the readout shouldn't jump the slider on the way to a reset
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      hx = e.clientX; hy = e.clientY; t.classList.add("tw-reset-holding");
      holdT = setTimeout(() => { holdT = 0; t.classList.remove("tw-reset-holding", "is-editable"); held = true; resetEntry(entry); }, 500);
    });
    t.addEventListener("pointermove", (e) => { if (holdT && Math.abs(e.clientX - hx) + Math.abs(e.clientY - hy) > 8) cancelHold(); });
    t.addEventListener("pointerup", cancelHold);
    t.addEventListener("pointercancel", cancelHold);
    t.addEventListener("pointerleave", cancelHold);
    t.addEventListener("contextmenu", (e) => { if (held) e.preventDefault(); }); // a long-press mustn't raise the text callout
    t.addEventListener("click", (e) => { if (held) { e.preventDefault(); e.stopImmediatePropagation(); held = false; } }, true); // a completed hold-reset swallows the trailing tap-to-edit
    t.addEventListener("dblclick", (e) => {
      if (t === root && (e.target as Element).closest && (e.target as Element).closest("input, textarea")) return; // on the whole-root fallback, a double-click inside a text field is a word-select, not a reset
      e.preventDefault(); e.stopPropagation(); resetEntry(entry);
    });
    // The slider's readout is BOTH the reset target and the click-to-type trigger, and
    // the two collided: once an 800ms hover armed editing — exactly what a deliberate
    // double-click does first — click #1 swapped the readout for the inline input, so the
    // dblclick landed on the input and the reset never fired. Catch it there too: commit
    // and close the editor (blur), then reset. Delegated on the control root because the
    // input doesn't exist until that first click creates it.
    if (t.classList.contains("tw-slider-value")) root.addEventListener("dblclick", (e) => {
      const inp = e.target as HTMLElement;
      if (!inp.classList || !inp.classList.contains("tw-slider-input")) return;
      e.preventDefault(); e.stopPropagation();
      inp.blur(); // restores the readout via the input's own commit — a no-op value change, so it can't notify
      resetEntry(entry);
    });
    // The keyboard reset: Alt+Backspace (or Alt+Delete) with focus anywhere inside the
    // control — its track, a handle, a field, the text input. The pointer paths above had
    // no keyboard twin. Alt-qualified, so a bare Backspace in a text field stays a
    // backspace and the gradient editor keeps Delete for its stops.
    root.addEventListener("keydown", (e) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || (e.key !== "Backspace" && e.key !== "Delete")) return;
      e.preventDefault(); e.stopPropagation();
      if ((e.target as HTMLElement).classList && (e.target as HTMLElement).classList.contains("tw-slider-input")) (e.target as HTMLElement).blur(); // an open inline editor commits + closes first, as on the double-click path
      resetEntry(entry);
    });
  };

  // Conditional controls — `render: (get) => bool` shows/hides; `disabled` (boolean
  // or `(get) => bool`) greys-out + locks; both re-evaluate on every change. `hint`
  // is a static tooltip. registerCond wires whichever a control declared.
  const conditionals: Array<{ node: HTMLElement; m: Meta }> = [];
  const registerCond = (node: HTMLElement, m: Meta) => {
    if (m.hint) addHintMarker(node, m.hint);
    if (m.render || m.disabled != null) conditionals.push({ node, m });
  };
  const filterItems: Array<{ el: HTMLElement; label: string; folder: FolderItem | null }> = [], filterFolders: FolderItem[] = []; // searchable index (opts.filter) keyed on each control's real label
  const folderEls: Array<{ path: string[]; el: HTMLElement; setCollapsed: (c: boolean) => void }> = [], tabsCtrls: Array<{ path: string[]; ctrl: TabsControl; pageKeys: string[] }> = []; // folder + tabs handles keyed by path — read/restored as UI state by toJSON/fromJSON

  // A control that runs its own loop (the monitor's poll, the FPS graph's rAF) hands back
  // a `destroy`; take it into the panel's cleanups so destroy() releases it. Those loops
  // otherwise only stop on unmount, and they deliberately idle through the "built but not
  // appended yet" window — so a panel destroyed before it ever connected ran forever.
  const adopt = (ctrl: Control) => { if (typeof ctrl.destroy === "function") cleanups.push(ctrl.destroy); };

  // Build controls into a container, recursing into folders (nested params).
  const build = (container: HTMLElement, ms: Meta[], target: Target, basePath: string[] = [], folderItem: FolderItem | null = null) => {
    for (const m of ms) {
      if (m.type === "tabs") {
        const sub: Target = {}; subTrees.add(sub); target[m.key] = sub;
        const makeTabs = getControl<TabsControl>("tabs");
        const tabsCtrl = makeTabs && makeTabs(m);
        if (!tabsCtrl) continue; // tabs module ensured before assemble; skip if it failed to load
        tabsCtrls.push({ path: [...basePath, m.key], ctrl: tabsCtrl, pageKeys: m.pages.map((p) => p.key) });
        m.pages.forEach((page, i) => { const psub: Target = {}; subTrees.add(psub); sub[page.key] = psub; build(tabsCtrl.bodies[i], page.children, psub, [...basePath, m.key, page.key]); });
        registerCond(tabsCtrl.el, m); container.append(tabsCtrl.el);
        continue;
      }
      if (m.type === "folder") {
        const sub: Target = {}; subTrees.add(sub); target[m.key] = sub;
        const f = createFolder(m);
        folderEls.push({ path: [...basePath, m.key], el: f.el, setCollapsed: f.setCollapsed });
        const fi = filterOn ? { el: f.el, label: m.label, body: f.body } : null;
        if (fi) filterFolders.push(fi);
        build(f.body, m.children, sub, [...basePath, m.key], fi); registerCond(f.el, m); container.append(f.el);
        continue;
      }
      // Display/action controls (VALUELESS) carry no value: no entry, so no reset/persist wiring.
      const valued = !VALUELESS.has(m.type);
      const ctrl = createControl(m, valued ? (v: unknown) => { if (!valueChanged(target[m.key], v)) return; target[m.key] = v; params._last = m.key; notify(); } : () => {}); // same-value emits (a discrete drag inside one detent, a re-entrant echo) don't notify
      if (!ctrl) continue;
      adopt(ctrl);
      if (valued) {
        // reset() restores the schema value (`raw`) over the form the control OPENED on (`def`,
        // its own get() at build, read before the parked value below applies) — see
        // restoreDefault: the raw value alone left a control set() can't take it on where it
        // was (a numeric text, a NaN number, a spring's explicit mode), and the opened form
        // alone re-parsed a colour from its rounded readout string.
        const def = ctrl.get();
        // A value a host parked on params directly before assemble ran (the lazy-load
        // window on the split build) wins over the schema default — apply it to the
        // control rather than clobbering it back with ctrl.get(). (API set() calls from
        // that window queue and replay after the build instead.)
        if (hasOwn(target, m.key)) ctrl.set(target[m.key]);
        target[m.key] = ctrl.get();
        const entry = { target, key: m.key, set: ctrl.set, get: ctrl.get, raw: m.value, def, path: [...basePath, m.key] };
        entries.push(entry); wireReset(ctrl.el, entry);
      }
      registerCond(ctrl.el, m);
      if (filterOn && m.type !== "separator") filterItems.push({ el: ctrl.el, label: m.label, folder: folderItem }); // every control is searchable by label except the (valueless) separator
      container.append(ctrl.el);
    }
  };

  // ── Filter (opts.filter) — the search button swaps the title for a filter input ──
  if (filterOn) {
    const applyFilter = (raw: string) => {
      const q = raw.trim().toLowerCase();
      // Track reveals: a control hidden by the filter measured 0×0 if it was built or
      // resized meanwhile, so an un-hide re-measures it (requestReflow), like a reveal
      // by render condition or tab page.
      let revealed = false;
      const show = (node: HTMLElement, hide: boolean) => { if (!hide && node.classList.contains("tw-filter-hidden")) revealed = true; node.classList.toggle("tw-filter-hidden", hide); };
      if (!q) { filterItems.forEach((i) => show(i.el, false)); filterFolders.forEach((f) => show(f.el, false)); }
      else {
        for (const it of filterItems) {
          const folderMatch = it.folder && fuzzyMatch(it.folder.label, q);
          show(it.el, !(fuzzyMatch(it.label, q) || folderMatch));
        }
        // innermost folders first, so an outer folder sees its children's resolved state
        for (const f of filterFolders.slice().reverse()) {
          const hasChild = [...f.body.children].some((ch) => !ch.classList.contains("tw-filter-hidden"));
          show(f.el, !(fuzzyMatch(f.label, q) || hasChild));
        }
      }
      if (revealed) requestReflow();
    };
    const exitSearch = () => { panel.classList.remove("is-searching"); searchInput.value = ""; applyFilter(""); };
    searchBtn.addEventListener("click", () => { if (searchBtn.disabled) return; if (panel.classList.toggle("is-searching")) { searchInput.focus(); searchInput.select(); } else exitSearch(); });
    searchInput.addEventListener("input", () => applyFilter(searchInput.value));
    searchInput.addEventListener("keydown", (e) => { if (e.key === "Escape") { exitSearch(); searchBtn.focus(); } });
  }

  // ── Snapshots in: persisted sessions, presets, fromJSON, undo. Path-aware so folders
  // round-trip. Per-entry isolation, the kit-wide degrade idiom (createControl, metaFor,
  // notify, applyConditionals all do the same): a control whose set() throws on hostile
  // stored data — a corrupt localStorage snapshot, a hand-edited preset, a fromJSON from
  // elsewhere — must cost only its own value. Unguarded, one throw abandoned every
  // remaining entry AND skipped the notify/persist below, leaving the panel silently
  // half-restored with listeners none the wiser. ──
  const atPath = (obj: Snapshot, path: string[]): unknown => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const owned = new Set(metas.map((m) => m.key)); // top-level control, folder and tabs keys — everything else on params is a bag key
  const applySnapshot = (snap: Snapshot | null, fire = true) => {
    if (!snap || typeof snap !== "object") return;
    for (const e of entries) {
      const v = atPath(snap, e.path); if (v === undefined) continue;
      try { assign(e, v); }
      catch (err) { console.error(`[tweaks] restoring "${e.path.join(".")}" failed — value skipped:`, err); }
    }
    // Free bag keys the host has parked on params ride along: the snapshot carries them,
    // so a restore (undo, a preset, fromJSON) brings their values back too. A key params
    // doesn't hold is still skipped, like a control path that no longer exists.
    for (const k of Object.keys(snap)) if (!owned.has(k) && k !== "_last" && hasOwn(params, k) && !isReservedKey(k) && !notAValue(snap[k])) params[k] = snap[k];
    params._last = undefined; if (fire) notify();
  };
  // ── Named presets (opt-in via opts.persist) — snapshots under "<key>:presets". The API
  // layer below guards the key + name and queues these in the lazy window. ──
  const listPresets = (): Record<string, Snapshot> => { const p = presetsKey ? readStore(presetsKey) : null; return Object.assign(Object.create(null), p && typeof p === "object" ? p : {}); }; // null-proto: a preset named "__proto__" is an ordinary key (a plain object's assignment wrote the prototype — savePreset claimed success while storing nothing, loadPreset applied Object.prototype)
  const savePreset = (nm: string) => { const all = listPresets(); all[nm] = snapshot(); writeStore(presetsKey, all); };
  const loadPreset = (nm: string) => { const all = listPresets(); if (all[nm]) applySnapshot(all[nm]); }; // re-read at replay: a delete queued ahead of it wins
  const deletePreset = (nm: string) => { const all = listPresets(); delete all[nm]; writeStore(presetsKey, all); };

  // ── Whole-panel UI state (toJSON / fromJSON) — folder open/closed and the active tab,
  // keyed by dotted path, alongside the values snapshot. Decoupled from localStorage: the
  // host persists the returned object however it likes (a file, a URL/share link, a server). ──
  const pathKey = (p: string[]) => p.map((k) => String(k).replace(/~/g, "~1").replace(/\./g, "~0")).join("."); // JSON-pointer-style escaping → injective: a literal "." in a key can't collide with the nesting separator (keys without dots stay readable)
  const collectUI = () => {
    const ui: NonNullable<PanelState["ui"]> = {};
    if (folderEls.length) { const f: Record<string, boolean> = {}; for (const fe of folderEls) f[pathKey(fe.path)] = fe.el.classList.contains("is-collapsed"); ui.folders = f; }
    if (tabsCtrls.length) { const t: Record<string, string | null> = {}; for (const tc of tabsCtrls) t[pathKey(tc.path)] = tc.pageKeys[tc.ctrl.active()] ?? null; ui.tabs = t; }
    return ui;
  };
  const applyUI = (ui: PanelState["ui"]) => {
    if (!ui || typeof ui !== "object") return;
    if (ui.folders) for (const fe of folderEls) { const c = ui.folders[pathKey(fe.path)]; if (typeof c === "boolean") fe.setCollapsed(c); }
    if (ui.tabs) for (const tc of tabsCtrls) { const i = tc.pageKeys.indexOf(ui.tabs[pathKey(tc.path)]); if (i >= 0 && i !== tc.ctrl.active()) tc.ctrl.activate(i); } // skip re-activating the already-active tab — avoids a spurious tw-reflow on a no-op restore
  };

  // ── Repositioning — drag the header to move the panel ───────────────────────
  // Every panel is draggable by its header (opt out with opts.draggable:false). An
  // inline panel lifts into a fixed, floating layer on the first drag — popping out of
  // document flow at the exact spot it sat, so it doesn't jump — then tracks the pointer.
  // opts.floating starts it already floated (`true` → top-left, or an explicit {x,y}). A
  // plain click on the title (no drag past the threshold) still collapses. On release the
  // panel eases the rest of the way to a viewport edge when dropped near one (a gentle
  // magnetism), and the position persists to "<key>:pos" when persistence is on — so a
  // moved panel returns where the user left it.
  if (draggable || opts.floating) {
    if (draggable) {
      panel.dataset.draggable = "true"; // CSS grab cursor on the header — the affordance
      // A top-centre grabber pill — the visual cue to match the cursor. Decorative
      // (pointer-events:none, so the press still lands on the header), it reveals on
      // header hover and brightens mid-drag the way the slider handle does.
      const grabber = el("span", "tw-grabber"); grabber.setAttribute("aria-hidden", "true");
      header.prepend(grabber);
    }
    // Lift an inline panel into the floating layer at its current on-screen rect, so a
    // drag pops it out of flow in place rather than snapping to a corner. A same-size
    // placeholder stays behind in the old slot — without it the host container reflows
    // mid-drag (an emptied flex/grid cell collapses), which reads as a layout break.
    const lift = () => {
      if (panel.dataset.mode === "floating") return;
      const r = panel.getBoundingClientRect();
      px = r.left; py = r.top;
      if (panel.parentNode) {
        liftSlot = el("span", "tw-lift-slot");
        liftSlot.style.width = r.width + "px"; liftSlot.style.height = r.height + "px";
        liftSlot.setAttribute("aria-hidden", "true");
        panel.before(liftSlot);
      }
      // Portal to <body>: left in its slot, any transformed/filter/contain ancestor would
      // become the fixed panel's containing block (the bug class the popovers already
      // solved by portaling). The inline --tw-* theme vars ride along on the node; the
      // scheme scope doesn't — carry the winning scheme, popover()'s idiom.
      carryScheme(panel, panel);
      document.body.appendChild(panel);
      panel.dataset.mode = "floating"; apply();
      // A host that removes its container without destroy() (an SPA route change) would
      // leave the lifted panel on screen over whatever renders next. The placeholder left
      // in the slot is the tell: when it leaves the document, the panel follows it out.
      if (liftSlot && typeof MutationObserver === "function") {
        const obs = new MutationObserver(() => { if (liftSlot && !liftSlot.isConnected) { obs.disconnect(); liftSlot = null; panel.remove(); } });
        obs.observe(document.documentElement, { childList: true, subtree: true });
        cleanups.push(() => obs.disconnect());
      }
    };
    // Two floating panels share one z-index in the stylesheet, so the one touched last
    // didn't stay on top. The last lifted or dragged panel gets the higher inline value
    // and the previous holder gives its own back to the stylesheet.
    const raise = () => { if (topFloating && topFloating !== panel) topFloating.style.zIndex = ""; panel.style.zIndex = "99991"; topFloating = panel; };

    let dragId: number | null = null, sx = 0, sy = 0, ox = 0, oy = 0;
    // The move/release listeners sit on the document for the press's duration (capture
    // phase, so the panel's own pointer-stop can't hide them). Capture is only taken once
    // the drag passes its threshold — taking it on the press would retarget a plain click
    // away from the title button — so until then a fast flick's first move, or a release a
    // hair off the header, lands elsewhere; heard on the document they still steer or end
    // the press, where header-only listeners left the grabber lit and the drag stranded.
    const listen = (on: boolean) => { for (const [t, fn] of [["pointermove", onMove], ["pointerup", endDrag], ["pointercancel", endDrag]] as Array<[string, (e: PointerEvent) => void]>) on ? document.addEventListener(t, fn, true) : document.removeEventListener(t, fn, true); };
    if (draggable) header.addEventListener("pointerdown", (e) => { // draggable:false pins a floating panel too — it keeps the lift/clamp machinery for its position, never the press
      // Let the toolbar buttons and any inputs work; drag from anywhere else on the header.
      if (e.button !== 0 || dragId !== null || (e.target as Element).closest(".tw-toolbar, input, textarea, select")) return;
      dragId = e.pointerId; sx = e.clientX; sy = e.clientY; dragMoved = false;
      listen(true);
      panel.classList.add("is-grabbing"); // press feedback: brighten the grabber the instant it's grabbed, before any move — matters on touch, where there's no hover to reveal it first
      // Regrab mid–edge-snap: pick the panel up where it visually is (the eased,
      // in-flight position), not the parked target px/py already hold — clearing the
      // transition against the target style teleported it on the first move.
      if (panel.style.transition) {
        const cur = getComputedStyle(panel);
        px = parseFloat(cur.left) || px; py = parseFloat(cur.top) || py;
        panel.style.transition = ""; apply(); // …and drop the snap transition, so the grab is 1:1
      }
    });
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== dragId) return;
      // Released where no pointerup reached us (the window lost the pointer): the button
      // is up but dragId is still ours, so bail the way every other drag surface in the
      // kit does (the slider, the interval, dragGesture) rather than steer with nothing pressed.
      if (e.buttons === 0) { endDrag(e); return; }
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragMoved) {
        if (Math.abs(dx) + Math.abs(dy) < 4) return; // a few px of slop before it counts as a drag, not a click
        dragMoved = true; lift(); raise(); ox = px; oy = py; // capture the (possibly just-lifted) origin once the drag truly starts
        try { header.setPointerCapture(dragId); } catch {}
        panel.classList.add("is-dragging");
      }
      const { maxX, maxY } = bounds();
      px = clamp(ox + dx, MARGIN, maxX); py = clamp(oy + dy, MARGIN, maxY); apply();
    };
    const endDrag = (e: PointerEvent) => {
      if (e.pointerId !== dragId) return;
      try { header.releasePointerCapture(dragId); } catch {}
      dragId = null; listen(false);
      // The click that ends a real drag follows the release in the same input task; swallow
      // exactly that one (the header's capture-phase click listener), and let the flag
      // lapse right after in case no click comes (a pointercancel, a release off-window).
      swallowClick = dragMoved;
      if (swallowClick) setTimeout(() => { swallowClick = false; }, 0);
      if (dragMoved) {
        // Edge magnetism: a drop near a side eases the rest of the way to the margin, so the
        // panel parks cleanly against the edge instead of hovering a few px off it.
        const { maxX, maxY } = bounds();
        if (px <= MARGIN + SNAP) px = MARGIN; else if (px >= maxX - SNAP) px = maxX;
        if (py <= MARGIN + SNAP) py = MARGIN; else if (py >= maxY - SNAP) py = maxY;
        if (!REDUCE_MOTION.matches) { // the glide is inline style, out of reach of the CSS reduced-motion kill-switch — park instantly instead
          panel.style.transition = "left 0.32s var(--tw-ease-spring), top 0.32s var(--tw-ease-spring)";
          setTimeout(() => { panel.style.transition = ""; }, 340);
        }
        apply();
        if (posKey) writeStore(posKey, { x: px, y: py });
      }
      panel.classList.remove("is-dragging", "is-grabbing");
    };
    header.addEventListener("lostpointercapture", endDrag); // implicit capture loss mid-drag ends it like a release
    cleanups.push(() => listen(false)); // a destroy() mid-press releases the document listeners
  }
  // Keep a floated panel inside the viewport as the window resizes — self-cleaning (it used
  // to leak per draggable panel), and released eagerly by destroy(). Registered by
  // assemble(), once the host has had its chance to mount the panel: onLive releases itself
  // on the first event after the owner LEAVES the document, which it can only tell apart from
  // "not mounted yet" if it saw the panel connected first.
  const watchResize = () => {
    if (!(draggable || opts.floating)) return;
    if (panel.dataset.mode === "floating") { clampPos(); apply(); } // a resize during the lazy window went unheard — clamp once now
    cleanups.push(onLive(panel, [[window, "resize"]], () => { if (panel.dataset.mode === "floating") { clampPos(); apply(); } }));
  };

  if (presetsBtn) {
    const menu = el("div", "tw-presets-menu");
    const saveRow = el("div", "tw-presets-save");
    const input = el("input", "tw-presets-input"); input.type = "text"; input.placeholder = "Preset name…"; input.spellcheck = false; input.setAttribute("aria-label", "New preset name"); quietFocus(input);
    const saveBtn = txt("button", "tw-presets-savebtn", "Save");
    saveRow.append(input, saveBtn);
    const list = el("div", "tw-presets-list");
    menu.append(saveRow, list);
    const renderList = () => {
      const all = listPresets(), names = Object.keys(all);
      list.replaceChildren();
      if (!names.length) return list.append(txt("div", "tw-presets-empty", "No presets yet"));
      for (const nm of names) {
        const row = el("div", "tw-presets-row");
        const load = txt("button", "tw-presets-load", nm);
        load.addEventListener("click", () => { loadPreset(nm); menuPop.close(); showToast(`Loaded “${nm}”`, panel); });
        const del = btn("tw-presets-del", ICON_X); del.setAttribute("aria-label", `Delete preset ${nm}`);
        del.addEventListener("click", (e) => { e.stopPropagation(); deletePreset(nm); renderList(); });
        row.append(load, del); list.append(row);
      }
    };
    const doSave = () => { const nm = input.value.trim(); if (!nm) { input.focus(); return; } savePreset(nm); input.value = ""; renderList(); showToast(`Saved “${nm}”`, panel); };
    // The shared popover shell again — portaled, theme-carried, outside/Esc/scroll-away
    // close, single-open with the editors. align:"end" hangs it off the button's right
    // edge (it sits at the panel's right corner).
    const menuPop = popover(presetsBtn, presetsBtn, menu, {
      width: 208, fallbackH: 160, gap: 6, align: "end",
      onOpen: () => { renderList(); input.focus(); },
    });
    saveBtn.addEventListener("click", doSave);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSave(); });
  }

  // ── Edit lifecycle (opts.onEditStart / onEditEnd) — fired when a drag/scrub on any
  // in-panel control begins and ends, so a host can pause expensive work during a
  // continuous edit and commit once on release. Continuous values still flow via on(). ──
  if (opts.onEditStart || opts.onEditEnd) {
    const DRAG_SEL = ".tw-slider, .tw-num-grab, .tw-pad, .tw-wg-area, .tw-wg-hue, .tw-wg-alpha, .tw-bezier-handle, .tw-gradient-bar, .tw-gradient-stop";
    let editing = false;
    // The end listeners sit on document (capture) only for the edit's duration: a drag on
    // a popover surface portaled to <body> (the colour plane, a gradient stop) releases
    // there, where the panel's own pointerup listener would never hear it.
    const endEdit = () => {
      document.removeEventListener("pointerup", endEdit, true); document.removeEventListener("pointercancel", endEdit, true);
      if (editing) { editing = false; opts.onEditEnd && opts.onEditEnd(); }
    };
    const editDown = (e: PointerEvent) => {
      if (editing || !(e.target as Element).closest(DRAG_SEL)) return;
      editing = true; opts.onEditStart && opts.onEditStart();
      document.addEventListener("pointerup", endEdit, true); document.addEventListener("pointercancel", endEdit, true);
    };
    panel.addEventListener("pointerdown", editDown);
    panel._twEditPointer = editDown; // popover() relays pointerdowns on its portaled surfaces here
    cleanups.push(endEdit);
  }

  // ── Undo / redo (opts.undo) — a debounced history of snapshots. Cmd/Ctrl-Z undoes,
  // ⇧ (or Ctrl-Y) redoes, scoped to when the panel is hovered or focused so it doesn't
  // hijack the page's own undo. A continuous drag coalesces into one step. The history
  // is seeded by assemble() once the controls (and any persisted session) are in. ──
  const undoApi = opts.undo ? (() => {
    // Bounded: each step is a deep clone of every value, and a long tuning session
    // committed one every 350ms of editing with nothing ever dropping off the back.
    const HIST_MAX = 200;
    let history: Snapshot[] = [], histIdx = 0, applyingHistory = false, histTimer = 0;
    const commit = () => {
      histTimer = 0;
      const snap = snapshot();
      if (JSON.stringify(snap) === JSON.stringify(history[histIdx])) return; // unchanged
      history = history.slice(0, histIdx + 1); history.push(snap); // a new edit drops the redo branch
      if (history.length > HIST_MAX) history = history.slice(history.length - HIST_MAX); // oldest steps age out
      histIdx = history.length - 1;
    };
    const record = () => { if (applyingHistory) return; clearTimeout(histTimer); histTimer = setTimeout(commit, 350); };
    const flush = () => { if (histTimer) { clearTimeout(histTimer); commit(); } }; // commit a pending edit first, so ⌘Z right after a change still undoes it
    listeners.add(record);
    const restore = (idx: number) => { applyingHistory = true; applySnapshot(history[idx]); applyingHistory = false; histIdx = idx; };
    const undo = () => { flush(); if (histIdx > 0) restore(histIdx - 1); };
    const redo = () => { flush(); if (histIdx < history.length - 1) restore(histIdx + 1); };
    const focused = () => panel.matches(":hover") || panel.contains(document.activeElement);
    // A text field owns its own undo: ⌘Z with the caret in the text control, the filter
    // input, a preset name or the plot's expression stays native (the panel's history
    // used to swallow it there and kill the field's edit undo).
    const inTextField = (t: HTMLElement | null) => !!(t && t.matches && (t.matches("input, textarea") || t.isContentEditable));
    // Self-cleaning (the listener used to hold the whole panel + history alive forever),
    // and released eagerly by destroy(). Registered by assemble() with the history seed —
    // see watchResize for why a global listener waits for the build.
    const onKey = (e: KeyboardEvent) => {
      if (!focused() || !(e.metaKey || e.ctrlKey) || inTextField(e.target as HTMLElement)) return;
      const k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (k === "y") { e.preventDefault(); redo(); }
    };
    return { undo, redo, arm: () => { history = [snapshot()]; histIdx = 0; cleanups.push(onLive(panel, [[document, "keydown"]], onKey)); } };
  })() : null;

  // Build the controls, then everything that needs them built: the conditionals' first
  // pass, the persisted-session restore, the undo seed, the queued API calls. Runs
  // synchronously when every control type the schema needs is already registered — the
  // single-file build, and any split build after the modules have loaded once — and is
  // deferred behind panel.ready otherwise. tweaks() returns synchronously either way: the
  // panel shell + API exist immediately; lazy controls fill in on ready.
  const assemble = () => {
    if (destroyed) return; // destroy() before the lazy chunks landed — nothing to build
    build(controls, metas, params);
    // Apply the conditionals now and on every change (a sibling's value can flip them).
    if (conditionals.length) {
      const byKey = new Map<string, Entry>(); for (const e of entries) if (!byKey.has(e.key)) byKey.set(e.key, e); // first wins, like the find() it replaces
      const getVal = (k: string) => { const e = byKey.get(k); return e ? e.target[e.key] : params[k]; };
      const applyConditionals = () => {
        let revealed = false;
        for (const { node, m } of conditionals) {
          // A throwing render/disabled predicate degrades to "leave the node as-is"
          // rather than aborting construction or the whole notify() pass.
          try {
            if (m.render) { const hide = !m.render(getVal); if (!hide && node.classList.contains("tw-cond-hidden")) revealed = true; node.classList.toggle("tw-cond-hidden", hide); }
            if (m.disabled != null) { const d = typeof m.disabled === "function" ? m.disabled(getVal) : m.disabled; node.classList.toggle("is-disabled", !!d); node.inert = !!d; } // inert blocks keyboard + focus too, not just the CSS pointer-events
          } catch {}
        }
        if (revealed) requestReflow(); // a control built behind a false render condition measured 0×0 (blank canvas/SVG, a stuck pill) — once shown, let it re-measure, as a tab page does
      };
      listeners.add(applyConditionals); applyConditionals();
    }
    // Restore last session, notifying: on the lazy path assemble runs after tweaks()
    // returned, so a host that already subscribed must hear the restored values (on the
    // synchronous path nobody is subscribed yet, so the notify is free).
    if (persistKey) applySnapshot(readStore(persistKey));
    if (destroyed) return; // a listener may have destroyed the panel on that notify — no listener may register on, and no call may reach, a torn-down panel
    undoApi?.arm(); watchResize();
    assembled = true;
    // Replay the API calls queued during the lazy window — after the persisted-session
    // restore above, so an explicit host set() wins over a stored value the way it wins
    // over the schema default.
    // A listener may destroy() the panel mid-replay: the rest of the queue is dropped, not
    // applied to a torn-down panel. Each call runs isolated, as a listener does — one that
    // throws costs only itself, never the calls behind it, ready's resolution or the toolbar.
    for (const fn of queue.splice(0)) { if (destroyed) break; try { fn(); } catch (e) { console.error("[tweaks] a call queued before ready failed:", e); } }
    presetOps.clear();
    for (const b of toolbarBtns) b.disabled = false; // the controls exist now
  };

  // One programmatic value write — resolve a (possibly dotted) key to its control or to a
  // free bag key, apply it, and report whether the resolved leaf actually changed. The
  // shared core of set()/setMany(): it never notifies, so a batch can fire one notify at
  // the end (a set() loop would re-run every listener + persist per key).
  const applySet = (key: string, v: unknown) => {
    if (String(key).split(".").some(isReservedKey)) { console.warn(`[tweaks] set("${key}") ignored — reserved key`); return false; } // params is an object-as-map; never write through to the prototype
    const parts = String(key).split(".");
    let e: Entry | undefined;
    if (parts.length > 1) {
      // Dotted path ("folder.child", "tabs.page.child") — walk the folder/tabs subtrees to
      // the owning target, then match the leaf there.
      let t: any = params; // walks the params bag, whose subtrees hold whatever the host parked
      for (let i = 0; i < parts.length - 1 && t; i++) { t = t[parts[i]]; if (!subTrees.has(t)) t = null; }
      e = t && entries.find((x) => x.target === t && x.key === parts[parts.length - 1]);
      if (!e) { console.warn(`[tweaks] set("${key}") — no control at that path`); return false; }
    } else {
      // Bare key — a top-level control by that name wins outright (a top-level key has no
      // dotted form, so nothing else could ever reach it); otherwise a unique match anywhere
      // reaches a nested control without a path, and ambiguity between nested namesakes
      // warns instead of guessing (and instead of minting an orphan top-level key).
      const matches = entries.filter((x) => x.key === key);
      const top = matches.find((x) => x.target === params);
      if (!top && matches.length > 1) { console.warn(`[tweaks] set("${key}") is ambiguous — ${matches.length} controls share that key; use a dotted path (e.g. "${matches[0].path.join(".")}")`); return false; }
      e = top || matches[0];
    }
    const target = e ? e.target : params, leaf = e ? e.key : key;
    const prev = target[leaf];
    // Same isolation as applySnapshot: a control that throws on a hostile value degrades
    // to "that key didn't take" instead of throwing out of set() — and, in setMany's loop,
    // instead of abandoning the rest of the batch and its single notify.
    if (e && notAValue(v)) { console.warn(`[tweaks] set("${key}") ignored — a ${typeof v} is not a control value`); return false; } // assign() would throw; the API path warns like its other refusals (bag keys stay free: hosts park what they like)
    if (e) { try { assign(e, v); } catch (err) { console.error(`[tweaks] set("${key}") failed — value skipped:`, err); return false; } }
    else if (subTrees.has(params[key])) { console.warn(`[tweaks] set("${key}") ignored — it's a folder/tabs group; set its children instead`); return false; } // overwriting the subtree would silently orphan every child value
    else params[key] = v; // bag passthrough — hosts park free keys on params
    if (!valueChanged(prev, target[leaf])) return false; // a no-change set doesn't notify — the guard that keeps a store-sync listener from echoing forever
    params._last = leaf; // stamp the changed key, so on((p, last)) sees programmatic sets the same as control edits
    return true;
  };

  // The API is built + returned synchronously. Every mutating method goes through
  // later(): live at once on the synchronous path, queued (in call order) in the lazy
  // window, and silent after destroy().
  const api = {
    el: panel, params,
    on(fn) { if (destroyed) return () => {}; listeners.add(fn); return () => listeners.delete(fn); },
    set(key, v) { const k = String(key); later(() => { if (applySet(k, v)) notify(); }); }, // the key resolves at the call: one that can't stringify throws here, not out of the replay
    // Batch write — apply a flat map of (possibly dotted) keys, e.g.
    // setMany({ "shadow.radius": 28, blur: 48 }), firing listeners + persist ONCE for the
    // whole batch rather than per key as a set() loop would. Same path resolution and
    // no-op / reserved / bad-path guards as set(); unrecognised keys warn-and-skip.
    setMany(values) {
      if (values == null || typeof values !== "object") return;
      const batch = Object.entries(values); // read now, so a host mutating the object after the call can't change what a lazy-window replay applies
      later(() => { let changed = false; for (const [k, v] of batch) { try { if (applySet(k, v)) changed = true; } catch (e) { console.error(`[tweaks] setMany("${k}") failed — key skipped:`, e); } } if (changed) notify(); }); // per-key isolation: a bag value the change check can't compare (circular) costs only its key, and the rest still notify
    },
    reset() { if (assembled && !destroyed) spinReset(resetBtn); later(resetAll); },
    // Whole-panel state — values + UI (open folders, active tabs) as a plain JSON-safe
    // object, independent of localStorage. `JSON.stringify(panel)` works too (this is the
    // standard toJSON hook). Before ready there are no values yet: the controls, and so their
    // defaults, don't exist, and the queued writes haven't applied. fromJSON applies a
    // previously-saved object back: values where their path still exists (missing ones
    // skipped, like a preset load — one notify), then the UI state, silently (not a value
    // change, and outside undo so a ⌘Z reverts values without thrashing folders/tabs).
    toJSON() { return destroyed ? { values: {}, ui: {} } : { values: snapshot(), ui: collectUI() }; },
    fromJSON(state) {
      if (!state || typeof state !== "object") return;
      const values = state.values && typeof state.values === "object" ? { ...state.values } : state.values, ui = state.ui && typeof state.ui === "object" ? { ...state.ui } : state.ui; // read now, like setMany (one level): a host re-pointing a key after the call can't change what a lazy-window replay applies
      later(() => { if (values) applySnapshot(values); applyUI(ui); });
    },
    // Live theming — re-applies --tw-* vars to the panel (and future popovers). Clears
    // the prior theme first, so setTheme(null) reverts to the default monochrome look.
    setTheme(theme) { if (destroyed) return; if (themeVars) for (const k in themeVars) panel.style.removeProperty(k); themeVars = resolveTheme(theme); panel._twTheme = themeVars; applyThemeVars(panel, themeVars); window.dispatchEvent(new Event("tw-retheme")); },
    // Presets API (no-ops without opts.persist). Names are arbitrary strings. The list reads
    // storage, which exists already; a save/load/delete made before ready queues like set()
    // does (a save then snapshots the built controls, not an empty panel).
    savePreset: (nm) => { if (destroyed || failed || !presetsKey || !nm) return false; if (!assembled) presetOps.set(String(nm), "save"); later(() => savePreset(nm)); return true; },
    loadPreset: (nm) => { const op = presetOps.get(String(nm)); if (destroyed || failed || op === "delete" || !(op === "save" || listPresets()[nm])) return false; later(() => loadPreset(nm)); return true; }, // a stored entry that isn't a snapshot (a hand-edited null) reads as absent, as it always did after ready; a save queued ahead of the load counts as stored, a delete queued ahead as gone
    deletePreset: (nm) => { if (presetsKey) { if (!assembled) presetOps.set(String(nm), "delete"); later(() => deletePreset(nm)); } },
    presets: () => (destroyed ? [] : Object.keys(listPresets())),
    undo: () => { if (undoApi) later(undoApi.undo); }, redo: () => { if (undoApi) later(undoApi.redo); }, // no-ops without opts.undo; queued before ready, in order with the value writes
    // Teardown: close this panel's open portaled surfaces, release every global
    // attachment, pull the panel (and the lift placeholder) out of the DOM, and inert the
    // API. Safe to call before ready resolves — assemble() sees the flag and bails.
    destroy() {
      if (destroyed) return;
      destroyed = true;
      closeActivePopover(panel); // the popover + hint are page-wide singletons: scope the close to a surface anchored in THIS panel (an unscoped close dismissed another panel's open menu or picker)
      hideHintNow(panel);
      for (const fn of cleanups.splice(0)) { try { fn(); } catch {} }
      listeners.clear();
      if (liftSlot) { liftSlot.remove(); liftSlot = null; }
      if (topFloating === panel) topFloating = null;
      panel.remove();
    },
  } as Panel; // `ready` is filled in just below, once the lazy check has run
  // Lazy controls: if the schema needs feature modules not yet loaded, assemble once
  // they resolve and surface that on panel.ready / api.ready; otherwise assemble now
  // (synchronous — the monolith and warmed-up split builds always take this path).
  const pending = ensureForMetas(metas);
  if (pending) {
    // A chunk that fails to load — or a build that throws — leaves the panel unbuildable: the
    // queued calls are dropped (they could only pile up), later calls are refused with a
    // warning, and ready rejects for hosts that await it — the shell stays up with its
    // toolbar inert rather than a silent sink.
    const fail = (e: unknown) => { failed = true; queue.length = 0; if (!destroyed) console.warn(`[tweaks] "${name}": its lazy controls failed to load — the API is inert`); throw e; }; // the error itself is logged where the chunk failed (lazy.ts); a destroyed panel has nothing to report
    api.ready = panel.ready = pending.then(assemble).then(() => api, fail); // fail covers both the chunk and a build that throws (a non-JSON-safe bag value parked before ready, which the undo seed's snapshot can't take)
    api.ready.catch(() => {}); // a handled fork — no unhandled-rejection noise, while ready still rejects for hosts that await it
  }
  else { assemble(); api.ready = panel.ready = Promise.resolve(api); }
  return api as Panel;
}
