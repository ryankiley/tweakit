/* tweaks() — the panel factory: builds the shell + controls from a schema and returns the live
 * API. Persistence, presets, undo, the filter, floating drag and the lazy-window queue live here. */
import {
  el, btn, txt, clamp, popover, closeActivePopover, stopPointerLeak, setCollapsed,
  applyThemeVars, resolveTheme, carryScheme, onLive, setDisabled, requestReflow, quietFocus, fuzzyMatch,
  REDUCE_MOTION, getControl,
} from "./shared.js";
import { metaFor, valueChanged, restoreDefault, hasOwn, isReservedKey, VALUELESS } from "./schema.js";
import { ensureForMetas } from "./lazy.js";
import { createFolder, createControl } from "./controls/basic.js";
import { makeCopyBtn, makePasteBtn, makeResetBtn, toolbarBtn, flash, readText, copyText, spinReset, hideHintNow, addHintMarker, LABEL_SEL } from "./feedback.js";
import { ICON_PRESETS, ICON_X, ICON_SEARCH } from "./icons.js";
import type { Schema, TweaksOptions, Panel, Params, PanelState, Control } from "./types.js";
import type { Meta } from "./schema.js";
import type { ClipCtx, Scope } from "./clip.js";
import type { PanelEl } from "./shared.js";
import type { TabsControl } from "./controls/tabs.js";

/** A params object or one of its folder/tabs sub-objects — the holder a control writes into. */
type Target = Record<string, unknown>;
/** A valued control's wiring: where its value lives, its set/get, the reset pair (raw, def) and its dotted path. */
export interface Entry { target: Target; key: string; set: Control["set"]; get: Control["get"]; raw: unknown; def: unknown; path: string[]; persist: boolean; m: Meta; el: HTMLElement }
/** A values snapshot — params minus `_last`, as JSON round-trips it. */
export type Snapshot = Record<string, any>;
/** A folder in the filter index: its node, label and body (for the child scan). */
interface FolderItem { el: HTMLElement; label: string; body: HTMLElement }

let topFloating: HTMLElement | null = null; // the floating panel raised last (raise())
let picked: [HTMLElement, () => void] | null = null; // the panel holding the page's one pick, and how to drop it

/** Build a panel from `schema`; the shell and API exist synchronously, lazy controls fill in on `ready`. */
export function tweaks(name: string, schema: Schema, opts: TweaksOptions = {}): Panel {
  // "_last" is the changed-key channel on params; a schema entry by that name would fight it.
  const metas = Object.entries(schema).filter(([k]) => k !== "_last" || (console.warn('[tweaks] "_last" is reserved (the changed-key channel) — schema entry skipped'), false)).map(([k, v]) => metaFor(k, v)).filter(Boolean);
  const params: Params = {};
  const entries: Entry[] = []; // flattened across folders, for reset + persist
  const subTrees = new Set<Target>(); // set() refuses to overwrite one: it orphans every child
  const listeners = new Set<(p: Params, last?: string) => void>();
  const own = new Set<(p: Params, last?: string) => void>(); // undo + conditionals: all a silent write calls
  const cleanups: Array<() => void> = []; // releases for destroy(): document/window listeners, timers
  let destroyed = false; // set by destroy(): assemble() bails, mutators go silent
  let assembled = false; // set at the end of assemble(); no controls exist before
  // The lazy window: a mutating API call made before the controls exist queues here and replays in order once assemble() has built them.
  const queue: Array<() => void> = [];
  // The last preset op queued per name: a loadPreset() behind a save is accepted, one behind a delete refused.
  const presetOps = new Map<string, "save" | "delete">();
  let failed = false; // the chunks failed: the panel can never be built
  let built = -1; // cleanups.length as assemble() enters build()
  const later = (fn: () => void) => { if (destroyed) return; if (failed) { console.warn("[tweaks] call ignored — the panel could not be built"); return; } assembled ? fn() : queue.push(fn); }; // a refused call says so, like every other refusal here
  let liftSlot: HTMLSpanElement | null = null; // the placeholder a lifted panel leaves in its slot
  // The values snapshot: params minus `_last`, undefined written as null (JSON would drop the key).
  // A function, not an arrow: `this` is the holder, so only the top-level `_last` strips.
  const replacer = function (this: unknown, k: string, v: unknown) { return k === "_last" && this === params ? undefined : v === undefined ? null : typeof v === "bigint" ? String(v) : v; }; // a bigint would throw out of every snapshot
  // A bag value JSON can't take must not throw out of every snapshot: fall back to the controls' values, say so once.
  let snapshotWarned = false;
  const controlsSnapshot = (): Snapshot => { const out: Record<string, any> = {}; for (const e of entries) { let o = out; for (const k of e.path.slice(0, -1)) o = o[k] ||= {}; o[e.key] = e.get(); } return JSON.parse(JSON.stringify(out, replacer)); };
  const snapshot = (): Snapshot => { try { return JSON.parse(JSON.stringify(params, replacer)); } catch (e) { if (!snapshotWarned) { snapshotWarned = true; console.warn("[tweaks] a value parked on params can't be serialised — snapshots carry the controls' values only:", e); } return controlsSnapshot(); } };
  // Storage keys — opt-in via opts.persist (a string key, or `true` to key by name).
  const persistKey = opts.persist ? `tw:${opts.persist === true ? name : opts.persist}` : null;
  const presetsKey = persistKey ? `${persistKey}:presets` : null;
  const readStore = (k: string): any => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }; // any: a parsed JSON blob, whatever the store holds
  const writeStore = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const atPath = (obj: Snapshot | null, path: string[]): unknown => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
  // A control with `persist: false` stays out of what is saved and out of what is restored.
  const unsaved = (snap: Snapshot | null) => {
    for (const e of entries) if (!e.persist) { const o: any = atPath(snap, e.path.slice(0, -1)); if (o && typeof o === "object") Reflect.deleteProperty(o, e.key); } // Reflect: an undeletable key is left, not thrown
    return snap;
  };
  // Debounced save; destroy() flushes a pending write rather than dropping it.
  const persist = persistKey ? (() => {
    let saveT = 0;
    const save = () => { saveT = 0; writeStore(persistKey, unsaved(snapshot())); };
    cleanups.push(() => { if (saveT) { clearTimeout(saveT); save(); } });
    return () => { clearTimeout(saveT); saveT = setTimeout(save, 150); };
  })() : () => {};
  // Each listener runs isolated: a throwing callback can't break the others or skip persist().
  // `last` is read once, so a write one listener makes can't change the key the rest are told.
  const notify = (silent?: boolean, last = params._last) => { (silent ? own : listeners).forEach((fn) => { try { fn(params, last); } catch (e) { console.error("[tweaks] listener threw:", e); } }); if (!destroyed) persist(); }; // a listener may destroy() the panel: arm no save behind it
  // The one write path behind restores and set(). A function/symbol/bigint is no control value (JSON can't carry those).
  const notAValue = (v: unknown) => typeof v === "function" || typeof v === "symbol" || typeof v === "bigint";
  const assign = (e: Entry, v: unknown) => { if (notAValue(v)) throw new TypeError(`a ${typeof v} is not a control value`); e.set(v); e.target[e.key] = e.get(); };
  // …and the reset write: the opened form, then the authored value (restoreDefault).
  const assignDefault = (e: Entry) => { restoreDefault(e, e.raw, e.def); e.target[e.key] = e.get(); };
  // opts.onReset replaces the default; a reset() called from INSIDE it performs the default instead of recursing.
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
  // Stop pointer events leaking past the panel to a stage listening on window.
  stopPointerLeak(panel);
  const header = el("div", "tw-header");
  // The title is the collapse toggle; the toolbar beside it never collapses.
  const titleBtn = btn("tw-header-toggle");
  titleBtn.setAttribute("aria-expanded", "true");
  let title = name; // setName() moves it; the storage key keeps the built name
  const titleEl = txt("span", "tw-title", title); titleBtn.append(titleEl);
  const toolbar = el("div", "tw-toolbar");
  // The values moved off their defaults, keyed by dotted path — setMany()'s shape, for baking tuned values into source.
  const changed = (): Record<string, unknown> => { const out: Record<string, unknown> = {}; for (const e of entries) if (valueChanged(e.get(), e.def)) out[e.path.join(".")] = e.get(); return JSON.parse(JSON.stringify(out, replacer)); };
  // ⇧-click copies the changed values only; reset restores every default or runs opts.onReset.
  const copyBtn = makeCopyBtn((changedOnly) => { if (!changedOnly) return [JSON.stringify(snapshot(), null, 2), -1]; const c = changed(); return [JSON.stringify(c, null, 2), Object.keys(c).length]; }); // snapshot() falls back on a bad bag value, not throws
  // Paste takes a copy back (pasteValues, in the lazy clip chunk; ctx lends it the panel). A chunk that can't load shows the cross.
  const ctx: ClipCtx = { panel, entries, fromJSON: (st) => api.fromJSON(st), ui: () => collectUI(), flash, alive: () => !destroyed, copy: (s) => doCopy(s), paste: (s) => doPaste(s), reset: (es) => { for (const e of es) try { assignDefault(e); } catch {} params._last = undefined; notify(); } };
  const pasteBtn = makePasteBtn((read, b) => { import("./clip.js").then((m) => m.pasteInto(read, b, (t) => m.pasteValues(ctx, t), ctx), () => flash(b, "is-failed")); });
  const resetBtn = makeResetBtn(resetAll);
  // Presets share persistence's storage, so the button needs it on.
  let presetsBtn: HTMLButtonElement | null = null;
  if (persistKey && opts.presets !== false) { // opts.presets:false keeps the saving, without the menu
    presetsBtn = toolbarBtn("", ICON_PRESETS, "Presets");
    presetsBtn.setAttribute("aria-haspopup", "menu"); presetsBtn.setAttribute("aria-expanded", "false");
    toolbar.append(presetsBtn);
  }
  // The filter (opts.filter) lives behind a toolbar button, so toolbar:false would leave it unreachable.
  const filterOn = !!opts.filter && (opts.toolbar !== false || (console.warn("[tweaks] opts.filter needs the toolbar (its search button lives there) — ignored alongside toolbar:false"), false));
  const searchBtn = filterOn ? toolbarBtn("", ICON_SEARCH, "Filter controls") : null;
  const searchInput = filterOn ? el("input", "tw-search") : null;
  if (filterOn) {
    searchInput.type = "text"; searchInput.placeholder = "Filter…"; searchInput.spellcheck = false; searchInput.setAttribute("aria-label", "Filter controls");
    quietFocus(searchInput);
    toolbar.append(searchBtn);
  }
  toolbar.append(copyBtn, pasteBtn, resetBtn);
  header.append(titleBtn);
  if (filterOn) header.append(searchInput);
  if (opts.toolbar !== false) header.append(toolbar); // toolbar:false → a bare panel, e.g. an embedded demo
  // The buttons act on controls that only exist once assemble() has built them: inert until then.
  const toolbarBtns = [copyBtn, pasteBtn, resetBtn, presetsBtn, searchBtn].filter(Boolean);
  for (const b of toolbarBtns) b.disabled = true;
  // swallowClick lives on the header, not the title: once the header holds pointer capture, the click ending a drag is dispatched there.
  let dragMoved = false, swallowClick = false;
  header.addEventListener("click", (e) => { if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); } }, true);
  titleBtn.addEventListener("click", () => {
    setCollapsed(panel, titleBtn, body, !panel.classList.contains("is-collapsed"));
    // A bottom-parked floating panel grows past the viewport when it expands: re-clamp once the collapse has settled.
    if (panel.dataset.mode === "floating") setTimeout(() => { if (panel.dataset.mode === "floating" && panel.isConnected) { clampPos(); apply(); } }, 270);
  });
  const body = el("div", "tw-body");
  const controls = el("div", "tw-controls");
  body.append(controls);
  panel.append(header, body);

  // Stash the theme so the portaled popovers (which lose the panel's inherited vars) re-apply it on open.
  let themeVars = resolveTheme(opts.theme);
  applyThemeVars(panel, themeVars); panel._twTheme = themeVars;

  // ── Floating position — seeded in the shell, so an opts.floating / persisted panel is fixed in place
  // the moment tweaks() returns instead of jumping when the lazy chunks land. ──
  const draggable = opts.draggable !== false;
  const MARGIN = 8, SNAP = 28; // px: viewport inset; snap distance to park against an edge
  // The clamp uses the panel's natural height — what it would be uncapped (the CSS max-height caps a floating panel at
  // the viewport below its top, and it scrolls). Clamping on the capped height would ratchet: every position fits, so a
  // tall panel could be dragged up but never back down. +1: offsetHeight rounds, so a panel parked at the bottom isn't
  // capped a fraction short of its rows.
  const natural = () => panel.offsetHeight + 1 + panel.scrollHeight - panel.clientHeight;
  const bounds = () => ({ maxX: Math.max(MARGIN, window.innerWidth - panel.offsetWidth - MARGIN), maxY: Math.max(MARGIN, window.innerHeight - natural() - MARGIN) });
  const posKey = persistKey ? `${persistKey}:pos` : null;
  const saved = (draggable || opts.floating) && posKey ? readStore(posKey) : null;
  const start = saved || (typeof opts.floating === "object" ? opts.floating : null) || { x: 16, y: 16 };
  let px = +start.x || 16, py = +start.y || 16;
  const apply = () => { panel.style.left = px + "px"; panel.style.top = py + "px"; panel.style.setProperty("--tw-top", py + "px"); }; // --tw-top: the CSS height cap reads it
  const clampPos = () => { const { maxX, maxY } = bounds(); px = clamp(px, MARGIN, maxX); py = clamp(py, MARGIN, maxY); };
  if ((draggable || opts.floating) && (opts.floating || saved)) {
    panel.dataset.mode = "floating"; clampPos(); apply();
    // A position saved on a larger monitor restores off-viewport: re-clamp once mounted (offsetWidth is 0 until then).
    requestAnimationFrame(() => { if (!destroyed && panel.dataset.mode === "floating" && panel.isConnected) { clampPos(); apply(); } });
  }

  // Per-control reset. The target is LABEL_SEL — the hint marker's list, so the two can't drift — or the root.
  const resetEntry = (e: Entry) => { assignDefault(e); params._last = e.key; notify(); };
  const wireReset = (root: HTMLElement, entry: Entry) => {
    const t = root.querySelector<HTMLElement>(".tw-slider-value")
      || root.querySelector<HTMLElement>(LABEL_SEL)
      || root;
    t.classList.add("tw-resettable"); t.title = "Double-click or hold to reset";
    // Coarse pointers get a press-and-hold reset: the desktop double-click fights double-tap-zoom on touch.
    let holdT = 0, hx = 0, hy = 0, held = false;
    const cancelHold = () => { if (holdT) { clearTimeout(holdT); holdT = 0; t.classList.remove("tw-reset-holding"); } };
    t.addEventListener("pointerdown", (e) => {
      e.stopPropagation(); held = false; // a press on the readout mustn't jump the slider
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
      if (t === root && (e.target as Element).closest && (e.target as Element).closest("input, textarea")) return; // a double-click in a text field is a word-select
      e.preventDefault(); e.stopPropagation(); resetEntry(entry);
    });
    // Click #1 can swap the readout for the inline input, so the dblclick lands there; delegated on the root.
    if (t.classList.contains("tw-slider-value")) root.addEventListener("dblclick", (e) => {
      const inp = e.target as HTMLElement;
      if (!inp.classList || !inp.classList.contains("tw-slider-input")) return;
      e.preventDefault(); e.stopPropagation();
      inp.blur(); // commits + closes the editor; a no-op change, so no notify
      resetEntry(entry);
    });
    // The keyboard reset, Alt-qualified so a bare Backspace in a text field stays a backspace and the gradient editor keeps Delete.
    root.addEventListener("keydown", (e) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || (e.key !== "Backspace" && e.key !== "Delete")) return;
      e.preventDefault(); e.stopPropagation();
      if ((e.target as HTMLElement).classList && (e.target as HTMLElement).classList.contains("tw-slider-input")) (e.target as HTMLElement).blur(); // an open inline editor commits + closes first
      resetEntry(entry);
    });
  };

  // Conditional controls — `render` shows/hides, `disabled` greys-out + locks, both re-evaluated on every change; `hint` is a static tooltip.
  const conditionals: Array<{ node: HTMLElement; m: Meta }> = [];
  // fold.ts is a lazy chunk the first pass imports, so that pass just toggles; foldRow returns whether the row was revealed (re-measure).
  let fold: typeof import("./fold.js").fold | undefined;
  const foldRow = (node: HTMLElement & { _hid?: boolean }, hide: boolean) => {
    if (!node._hid === !hide) return false;
    node._hid = hide;
    if (fold) fold(node, hide); else node.classList.toggle("tw-cond-hidden", hide);
    return !hide;
  };
  const registerCond = (node: HTMLElement, m: Meta) => {
    if (m.hint) addHintMarker(node, m.hint);
    if (m.render || m.disabled != null) conditionals.push({ node, m });
  };
  const filterItems: Array<{ el: HTMLElement; label: string; folder: FolderItem | null }> = [], filterFolders: FolderItem[] = []; // the filter index, keyed on each control's label
  const folderEls: Array<{ path: string[]; el: HTMLElement; setCollapsed: (c: boolean) => void }> = [], tabsCtrls: Array<{ path: string[]; ctrl: TabsControl; pageKeys: string[] }> = []; // UI state for toJSON/fromJSON, keyed by path

  // A control's own loop (the monitor, the FPS graph) hands back a `destroy`; a panel destroyed before it ever connected would run it forever.
  const adopt = (ctrl: Control) => { if (typeof ctrl.destroy === "function") cleanups.push(ctrl.destroy); };

  const build = (container: HTMLElement, ms: Meta[], target: Target, basePath: string[] = [], folderItem: FolderItem | null = null) => {
    for (const m of ms) {
      if (m.type === "tabs") {
        const sub: Target = {}; subTrees.add(sub); target[m.key] = sub;
        const makeTabs = getControl<TabsControl>("tabs");
        const tabsCtrl = makeTabs && makeTabs(m);
        if (!tabsCtrl) continue; // ensured before assemble; skipped if its chunk failed
        tabsCtrls.push({ path: [...basePath, m.key], ctrl: tabsCtrl, pageKeys: m.pages.map((p) => p.key) });
        m.pages.forEach((page, i) => { const psub: Target = {}; subTrees.add(psub); sub[page.key] = psub; build(tabsCtrl.bodies[i], page.children, psub, [...basePath, m.key, page.key]); });
        registerCond(tabsCtrl.el, m); container.append(tabsCtrl.el);
        continue;
      }
      if (m.type === "folder") {
        const sub: Target = {}; subTrees.add(sub); target[m.key] = sub;
        const f = createFolder(m);
        folderEls.push({ path: [...basePath, m.key], el: f.el, setCollapsed: f.setCollapsed });
        scopes.set(f.el, { kind: "folder", path: [...basePath, m.key], label: m.label });
        const fi = filterOn ? { el: f.el, label: m.label, body: f.body } : null;
        if (fi) filterFolders.push(fi);
        build(f.body, m.children, sub, [...basePath, m.key], fi); registerCond(f.el, m); container.append(f.el);
        continue;
      }
      const valued = !VALUELESS.has(m.type);
      const ctrl = createControl(m, valued ? (v: unknown) => { if (!valueChanged(target[m.key], v)) return; target[m.key] = v; params._last = m.key; notify(); } : () => {}); // same-value emits (a re-entrant echo) don't notify
      if (!ctrl) continue;
      adopt(ctrl);
      if (valued) {
        // reset() restores `raw` over the form the control OPENED on (`def`), read before the parked value applies — see restoreDefault.
        const def = ctrl.get();
        // A value a host parked on params before assemble ran wins over the schema default.
        if (hasOwn(target, m.key)) ctrl.set(target[m.key]);
        target[m.key] = ctrl.get();
        const entry = { target, key: m.key, set: ctrl.set, get: ctrl.get, raw: m.value, def, path: [...basePath, m.key], persist: m.persist !== false, m, el: ctrl.el };
        entries.push(entry); wireReset(ctrl.el, entry); scopes.set(ctrl.el, { kind: "row", entry, label: m.label });
      }
      registerCond(ctrl.el, m);
      if (filterOn && m.type !== "separator") filterItems.push({ el: ctrl.el, label: m.label, folder: folderItem }); // every control is searchable except the separator
      container.append(ctrl.el);
    }
  };

  // ── Filter (opts.filter) — the search button swaps the title for a filter input ──
  if (filterOn) {
    const applyFilter = (raw: string) => {
      const q = raw.trim().toLowerCase();
      // an un-hide re-measures: a control hidden by the filter measured 0×0 if built meanwhile
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

  // ── Snapshots in: persisted sessions, presets, fromJSON, undo. Per-entry isolation: a control whose
  // set() throws on hostile stored data (a corrupt snapshot, a hand-edited preset) costs only its own value. ──
  const owned = new Set(metas.map((m) => m.key)); // everything else on params is a bag key
  const applySnapshot = (snap: Snapshot | null, silent?: boolean) => {
    if (!snap || typeof snap !== "object") return;
    for (const e of entries) {
      const v = atPath(snap, e.path); if (v === undefined) continue;
      try { assign(e, v); }
      catch (err) { console.error(`[tweaks] restoring "${e.path.join(".")}" failed — value skipped:`, err); }
    }
    // Free bag keys the host parked on params ride along, so a restore brings them back too.
    for (const k of Object.keys(snap)) if (!owned.has(k) && k !== "_last" && hasOwn(params, k) && !isReservedKey(k) && !notAValue(snap[k])) { try { params[k] = snap[k]; } catch (err) { console.error(`[tweaks] restoring "${k}" failed — value skipped:`, err); } } // a getter-only bag key costs only itself
    params._last = undefined; notify(silent);
  };
  // ── Named presets (opt-in via opts.persist) — snapshots under "<key>:presets" ──
  const listPresets = (): Record<string, Snapshot> => { const p = presetsKey ? readStore(presetsKey) : null; return Object.assign(Object.create(null), p && typeof p === "object" ? p : {}); }; // null-proto: a preset named "__proto__" is an ordinary key
  const savePreset = (nm: string) => { const all = listPresets(); all[nm] = snapshot(); writeStore(presetsKey, all); };
  const loadPreset = (nm: string) => { const all = listPresets(); if (all[nm]) applySnapshot(all[nm]); }; // re-read at replay: a delete queued ahead of it wins
  const deletePreset = (nm: string) => { const all = listPresets(); delete all[nm]; writeStore(presetsKey, all); };

  // ── Whole-panel UI state (toJSON / fromJSON) — folder open/closed and the active tab, keyed by dotted path ──
  const pathKey = (p: string[]) => p.map((k) => String(k).replace(/~/g, "~1").replace(/\./g, "~0")).join("."); // JSON-pointer escaping, so a literal "." can't collide
  const collectUI = () => {
    const ui: NonNullable<PanelState["ui"]> = {};
    if (folderEls.length) { const f: Record<string, boolean> = {}; for (const fe of folderEls) f[pathKey(fe.path)] = fe.el.classList.contains("is-collapsed"); ui.folders = f; }
    if (tabsCtrls.length) { const t: Record<string, string | null> = {}; for (const tc of tabsCtrls) t[pathKey(tc.path)] = tc.pageKeys[tc.ctrl.active()] ?? null; ui.tabs = t; }
    return ui;
  };
  const applyUI = (ui: PanelState["ui"]) => {
    if (!ui || typeof ui !== "object") return;
    if (ui.folders) for (const fe of folderEls) { const c = ui.folders[pathKey(fe.path)]; if (typeof c === "boolean") fe.setCollapsed(c); }
    if (ui.tabs) for (const tc of tabsCtrls) { const i = tc.pageKeys.indexOf(ui.tabs[pathKey(tc.path)]); if (i >= 0 && i !== tc.ctrl.active()) tc.ctrl.activate(i); } // a re-activate would fire a spurious tw-reflow
  };

  // ── Repositioning — drag the header to move the panel ──
  // An inline panel lifts into a floating layer on the first drag, at the spot it sat, then tracks the
  // pointer; on release it eases to a near viewport edge, and the position persists to "<key>:pos".
  if (draggable || opts.floating) {
    if (draggable) {
      panel.dataset.draggable = "true"; // CSS grab cursor on the header — the affordance
      // Decorative grabber pill (pointer-events:none, so the press still lands on the header).
      const grabber = el("span", "tw-grabber"); grabber.setAttribute("aria-hidden", "true");
      header.prepend(grabber);
    }
    // Lift in place at the current rect; a same-size placeholder stays in the old slot, or the host container reflows mid-drag.
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
      // Portal to <body>: a transformed/filter/contain ancestor would become the fixed panel's containing block. The scheme scope doesn't ride along — carry it.
      carryScheme(panel, panel);
      document.body.appendChild(panel);
      panel.dataset.mode = "floating"; apply();
      // A host that removes its container without destroy() would leave the lifted panel on screen; when the placeholder leaves the document, the panel follows.
      if (liftSlot && typeof MutationObserver === "function") {
        const obs = new MutationObserver(() => { if (liftSlot && !liftSlot.isConnected) { obs.disconnect(); liftSlot = null; panel.remove(); } });
        obs.observe(document.documentElement, { childList: true, subtree: true });
        cleanups.push(() => obs.disconnect());
      }
    };
    // Two floating panels share one stylesheet z-index; the last touched gets a higher inline value.
    const raise = () => { if (topFloating && topFloating !== panel) topFloating.style.zIndex = ""; panel.style.zIndex = "99991"; topFloating = panel; };

    let dragId: number | null = null, sx = 0, sy = 0, ox = 0, oy = 0;
    // Document listeners (capture, so the panel's own pointer-stop can't hide them) for the press's duration.
    // Capture is taken only past the threshold: on the press it would retarget a plain click off the title.
    const listen = (on: boolean) => { for (const [t, fn] of [["pointermove", onMove], ["pointerup", endDrag], ["pointercancel", endDrag]] as Array<[string, (e: PointerEvent) => void]>) on ? document.addEventListener(t, fn, true) : document.removeEventListener(t, fn, true); };
    if (draggable) header.addEventListener("pointerdown", (e) => { // draggable:false keeps lift/clamp, never the press
      if (e.button !== 0 || dragId !== null || (e.target as Element).closest(".tw-toolbar, input, textarea, select")) return;
      dragId = e.pointerId; sx = e.clientX; sy = e.clientY; dragMoved = false;
      listen(true);
      panel.classList.add("is-grabbing"); // brighten the grabber on press: on touch there's no hover
      // Regrab mid–edge-snap: pick the panel up where it visually is, not the parked target.
      if (panel.style.transition) {
        const cur = getComputedStyle(panel);
        px = parseFloat(cur.left) || px; py = parseFloat(cur.top) || py;
        panel.style.transition = ""; apply(); // …and drop the snap transition, so the grab is 1:1
      }
    });
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== dragId) return;
      // The window lost the pointer: bail as every other drag surface does.
      if (e.buttons === 0) { endDrag(e); return; }
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragMoved) {
        if (Math.abs(dx) + Math.abs(dy) < 4) return; // a few px of slop before it counts as a drag, not a click
        dragMoved = true; lift(); raise(); ox = px; oy = py; // the (possibly just-lifted) origin, once the drag starts
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
      // Swallow exactly the click that follows the release; let the flag lapse in case none comes (a pointercancel).
      swallowClick = dragMoved;
      if (swallowClick) setTimeout(() => { swallowClick = false; }, 0);
      if (dragMoved) {
        // Edge magnetism: a drop near a side eases the rest of the way to the margin.
        const { maxX, maxY } = bounds();
        if (px <= MARGIN + SNAP) px = MARGIN; else if (px >= maxX - SNAP) px = maxX;
        if (py <= MARGIN + SNAP) py = MARGIN; else if (py >= maxY - SNAP) py = maxY;
        if (!REDUCE_MOTION.matches) { // inline style escapes the CSS reduced-motion kill-switch
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
  // Registered by assemble(): onLive releases itself once the owner LEAVES the document, which it can only tell if it saw the panel connected first.
  const watchResize = () => {
    if (!(draggable || opts.floating)) return;
    if (panel.dataset.mode === "floating") { clampPos(); apply(); } // a resize during the lazy window went unheard; clamp now
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
        load.addEventListener("click", () => { loadPreset(nm); menuPop.close(); });
        const del = btn("tw-presets-del", ICON_X); del.setAttribute("aria-label", `Delete preset ${nm}`);
        del.addEventListener("click", (e) => { e.stopPropagation(); deletePreset(nm); renderList(); });
        row.append(load, del); list.append(row);
      }
    };
    const doSave = () => { const nm = input.value.trim(); if (!nm) { input.focus(); return; } savePreset(nm); input.value = ""; renderList(); };
    // The shared popover shell; align:"end" hangs it off the button's right edge.
    const menuPop = popover(presetsBtn, presetsBtn, menu, {
      width: 208, fallbackH: 160, gap: 6, align: "end",
      onOpen: () => { renderList(); input.focus(); },
    });
    saveBtn.addEventListener("click", doSave);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSave(); });
  }

  // ── Edit lifecycle (opts.onEditStart / onEditEnd) — a drag on any in-panel control, so a host can pause expensive work ──
  if (opts.onEditStart || opts.onEditEnd) {
    const DRAG_SEL = ".tw-slider, .tw-num-grab, .tw-pad, .tw-wg-area, .tw-wg-hue, .tw-wg-alpha, .tw-bezier-handle, .tw-gradient-bar, .tw-gradient-stop";
    let editing = false;
    // The end listeners sit on document (capture) only for the edit's duration: a drag on a portaled popover surface releases there.
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
    panel._twEditPointer = editDown; // popover() relays its portaled surfaces' pointerdowns here
    cleanups.push(endEdit);
  }

  // ── Undo / redo (opts.undo) — a debounced history of snapshots, scoped to a hovered or focused panel so it doesn't hijack the page's own undo ──
  const undoApi = opts.undo ? (() => {
    // Bounded: each step is a deep clone of every value.
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
    const flush = () => { if (histTimer) { clearTimeout(histTimer); commit(); } }; // so ⌘Z right after a change still undoes that change
    listeners.add(record); own.add(record);
    const restore = (idx: number) => { applyingHistory = true; applySnapshot(history[idx]); applyingHistory = false; histIdx = idx; };
    const undo = () => { flush(); if (histIdx > 0) restore(histIdx - 1); };
    const redo = () => { flush(); if (histIdx < history.length - 1) restore(histIdx + 1); };
    const focused = () => panel.matches(":hover") || panel.contains(document.activeElement);
    // A text field owns its own undo: ⌘Z with the caret in a text control stays native.
    const inTextField = (t: HTMLElement | null) => !!(t && t.matches && (t.matches("input, textarea") || t.isContentEditable));
    // Registered by assemble() — see watchResize for why a global listener waits for the build.
    const onKey = (e: KeyboardEvent) => {
      if (!focused() || !(e.metaKey || e.ctrlKey) || inTextField(e.target as HTMLElement)) return;
      const k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (k === "y") { e.preventDefault(); redo(); }
    };
    return { undo, redo, onKey, arm: () => { history = [snapshot()]; histIdx = 0; } };
  })() : null;

  // ── Pick and copy / paste — a press beside a row (in the panel's side padding, or a gap between rows) picks it, as
  // a layer is picked in a design tool; beside a folder's header, the folder. ⌘C / ⌘V (ctrl elsewhere) then act on the
  // pick, or with none on the page, on the row holding focus. A row copies its value and pastes one back; a folder copies
  // its values object and pastes one into its own keys, so two folders with the same keys trade values. Escape, or a
  // press anywhere else, drops the pick; a text field or a text selection keeps the browser's own keys. ──
  const scopes = new Map<Element, Scope>(); // a row's or folder's root → its scope, filled by build()
  const scopeAt = (n: Element | null): Scope | undefined => { for (; n && n !== panel && panel.contains(n); n = n.parentElement) { const s = scopes.get(n); if (s) return s; } };
  const rowAt = (n: Element | null): Element | undefined => { for (; n && n !== panel; n = n.parentElement) if (scopes.get(n)?.kind === "row") return n; };
  let pick: [Element, Scope] | undefined, press = ""; // press: the last pointer's type, for the right-click menu below
  const away = (e: Event) => { const t = e.target as Element; if (!panel.contains(t) && !t.closest?.(".tw-portal")) unpick(); };
  const unpick = () => { if (!pick) return; pick[0].classList.remove("is-picked"); pick = undefined; document.removeEventListener("pointerdown", away, true); if (picked?.[0] === panel) picked = null; };
  const choose = (el: Element, s: Scope) => {
    if (picked && picked[0] !== panel) picked[1](); // one pick on the page
    unpick(); pick = [el, s]; picked = [panel, unpick]; el.classList.add("is-picked");
    document.addEventListener("pointerdown", away, true); // only while something is picked
  };
  cleanups.push(unpick);
  panel.addEventListener("pointerdown", (e) => {
    const t = e.target as Element; press = e.pointerType;
    if (pick?.[0].contains(t)) return; // working the picked row keeps it
    if (e.button !== 0 || rowAt(t) || t.closest(".tw-header, .tw-folder-header, button, input, textarea, select")) return unpick();
    // Beside a row: find what's level with the press across the middle of the controls.
    const r = controls.getBoundingClientRect(), hit = document.elementFromPoint?.(r.left + r.width / 2, e.clientY) ?? null;
    const head = hit?.closest(".tw-folder-header"), el = head ? head.parentElement : rowAt(hit), s = el && scopes.get(el);
    if (!s) return unpick();
    e.preventDefault(); // no text selection, no focus change
    choose(el, s);
  }, true); // capture: a label's own pointerdown stops the event before it bubbles here
  const inEditable = (t: Element | null) => !!(t && (t as HTMLElement).matches && ((t as HTMLElement).matches("input, textarea, select") || (t as HTMLElement).isContentEditable));
  // Called from the panel's one keydown listener (registered by assemble(), beside the undo keys). The copy is written
  // and the paste read started here, inside the keypress, where the browser counts them as the user's gesture.
  const onClipKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") return unpick();
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.repeat || inEditable(e.target as Element)) return;
    const k = e.key.toLowerCase(); if (k !== "c" && k !== "v") return;
    const s = pick ? pick[1] : picked ? undefined : scopeAt(document.activeElement);
    if (!s || (k === "c" && String(document.getSelection?.() || ""))) return; // selected text: the browser copies that
    e.preventDefault();
    (k === "v" ? doPaste : doCopy)(s);
  };
  const doPaste = (s: Scope) => { const read = readText(); import("./clip.js").then((m) => m.pasteInto(read, pasteBtn, (t) => m.pasteScope(ctx, s, t), ctx), () => flash(pasteBtn, "is-failed")); };
  const doCopy = (s: Scope) => copyText(JSON.stringify(s.kind === "row" ? s.entry.get() : atPath(snapshot(), s.path), replacer, 2))
    .then((ok) => { if (ok && !destroyed) flash(copyBtn, "is-copied"); }); // the toolbar copy icon flashes its check
  // A right-click on a row or folder picks it and opens Copy / Paste / Reset for it (the menu is built in the clip chunk).
  // Shift, a text field, a selection inside the panel, anywhere else in the panel, and a touch or pen long-press (the
  // hold-reset's) keep the browser's menu. contextmenu names its pointer where it's a PointerEvent; elsewhere the last
  // press's type stands in.
  let menuOff: (() => void) | undefined;
  cleanups.push(() => menuOff?.());
  panel.addEventListener("contextmenu", (e) => {
    const t = e.target as Element, pt = (e as PointerEvent).pointerType || press, sel = document.getSelection?.();
    const at = e.clientX || e.clientY ? [e.clientX, e.clientY] : null; // the menu key or ⇧F10 may carry no point: under the row
    if ((e.shiftKey && at) || pt === "touch" || pt === "pen" || inEditable(t) || (sel && String(sel) && panel.contains(sel.anchorNode))) return; // ⇧ with a pointer: the browser's menu; ⇧F10 is the keyboard's way to this one
    let el: Element | null = t; while (el && el !== panel && !scopes.has(el)) el = el.parentElement;
    const s = el && scopes.get(el); if (!s) return;
    e.preventDefault(); choose(el, s);
    import("./clip.js").then((m) => { if (!destroyed) menuOff = m.openMenu(ctx, s, t, at); }, () => {});
  });

  // Build the controls, then everything that needs them: the conditionals' first pass, the persisted restore,
  // the undo seed, the queued API calls. Synchronous when every control type is registered, else behind panel.ready.
  const assemble = () => {
    if (destroyed) return; // destroy() before the chunks landed: nothing to build
    built = cleanups.length; build(controls, metas, params);
    if (conditionals.length) {
      const byKey = new Map<string, Entry>(); for (const e of entries) if (!byKey.has(e.key)) byKey.set(e.key, e); // first wins
      const getVal = (k: string) => { const e = byKey.get(k); return e ? e.target[e.key] : params[k]; };
      const applyConditionals = () => {
        let revealed = false;
        for (const { node, m } of conditionals) {
          // A throwing predicate leaves the node as-is rather than aborting the pass.
          try {
            if (m.render && foldRow(node, !m.render(getVal))) revealed = true;
            if (m.disabled != null) { const d = typeof m.disabled === "function" ? m.disabled(getVal) : m.disabled; setDisabled(node, !!d); }
          } catch {}
        }
        if (revealed) requestReflow(); // built hidden it measured 0×0; shown, let it re-measure
      };
      listeners.add(applyConditionals); own.add(applyConditionals); applyConditionals();
      import("./fold.js").then((m) => { fold = m.fold; }, () => {}); // a fold chunk that fails to load leaves the rows toggling
    }
    // Restore last session, notifying: on the lazy path a host may already have subscribed.
    if (persistKey) applySnapshot(unsaved(readStore(persistKey)));
    if (destroyed) return; // a listener may have destroyed the panel on that notify
    undoApi?.arm(); watchResize();
    cleanups.push(onLive(panel, [[document, "keydown"]], (e: KeyboardEvent) => { undoApi?.onKey(e); onClipKey(e); })); // one document listener per panel for its keys
    assembled = true;
    // Replay after the restore, so an explicit host set() wins over a stored value; a destroy() mid-replay drops the rest.
    for (const fn of queue.splice(0)) { if (destroyed) break; try { fn(); } catch (e) { console.error("[tweaks] a call queued before ready failed:", e); } }
    presetOps.clear();
    for (const b of toolbarBtns) b.disabled = false; // the controls exist now
  };

  // Resolve a (possibly dotted) key, apply, report whether the leaf changed; never notifies, so setMany fires one notify.
  const applySet = (key: string, v: unknown) => {
    if (String(key).split(".").some(isReservedKey)) { console.warn(`[tweaks] set("${key}") ignored — reserved key`); return false; } // never write through to the prototype
    const parts = String(key).split(".");
    let e: Entry | undefined;
    if (parts.length > 1) {
      // Dotted path — walk the folder/tabs subtrees to the owning target.
      let t: any = params; // any: the bag's subtrees hold whatever the host parked
      for (let i = 0; i < parts.length - 1 && t; i++) { t = t[parts[i]]; if (!subTrees.has(t)) t = null; }
      e = t && entries.find((x) => x.target === t && x.key === parts[parts.length - 1]);
      if (!e) { console.warn(`[tweaks] set("${key}") — no control at that path`); return false; }
    } else {
      // Bare key — a top-level control wins outright; else a unique nested match, and ambiguity warns instead of guessing.
      const matches = entries.filter((x) => x.key === key);
      const top = matches.find((x) => x.target === params);
      if (!top && matches.length > 1) { console.warn(`[tweaks] set("${key}") is ambiguous — ${matches.length} controls share that key; use a dotted path (e.g. "${matches[0].path.join(".")}")`); return false; }
      e = top || matches[0];
    }
    const target = e ? e.target : params, leaf = e ? e.key : key;
    const prev = target[leaf];
    // Same isolation as applySnapshot: a hostile value costs only that key.
    if (e && notAValue(v)) { console.warn(`[tweaks] set("${key}") ignored — a ${typeof v} is not a control value`); return false; } // warns like the API's other refusals; bag keys stay free
    if (e) { try { assign(e, v); } catch (err) { console.error(`[tweaks] set("${key}") failed — value skipped:`, err); return false; } }
    else if (subTrees.has(params[key])) { console.warn(`[tweaks] set("${key}") ignored — it's a folder/tabs group; set its children instead`); return false; } // overwriting it would orphan every child value
    else params[key] = v; // bag passthrough — hosts park free keys on params
    if (!valueChanged(prev, target[leaf])) return false; // keeps a store-sync listener from echoing forever
    params._last = leaf; // on((p, last)) sees programmatic sets like control edits
    return true;
  };

  // Every mutating method goes through later(): live at once, queued in the lazy window, silent after destroy().
  const api = {
    el: panel, params,
    on(fn) { if (destroyed) return () => {}; listeners.add(fn); return () => listeners.delete(fn); },
    set(key, v, o) { const k = String(key), silent = o?.silent; later(() => { if (applySet(k, v)) notify(silent); }); }, // a key that can't stringify throws here, not in the replay
    // Batch write: listeners + persist fire once for the whole batch.
    setMany(values, o) {
      if (values == null || typeof values !== "object") return;
      const batch = Object.entries(values), silent = o?.silent; // read now, so a later mutation can't reach the replay
      later(() => { let changed = false; for (const [k, v] of batch) { try { if (applySet(k, v)) changed = true; } catch (e) { console.error(`[tweaks] setMany("${k}") failed — key skipped:`, e); } } if (changed) notify(silent); }); // per-key isolation: a bad bag value costs only its key
    },
    reset() { if (assembled && !destroyed) spinReset(resetBtn); later(resetAll); },
    // Whole-panel state — values + UI as a JSON-safe object (the standard toJSON hook). Before ready there
    // are no values yet. fromJSON applies one back: values (one notify), then the UI silently, outside undo.
    toJSON() { return destroyed ? { values: {}, ui: {} } : { values: snapshot(), ui: collectUI() }; },
    changes() { return destroyed ? {} : changed(); }, // empty in the lazy window too — no entries yet
    fromJSON(state, o) {
      if (!state || typeof state !== "object") return;
      const silent = o?.silent;
      const values = state.values && typeof state.values === "object" ? { ...state.values } : state.values, ui = state.ui && typeof state.ui === "object" ? { ...state.ui } : state.ui; // read now (one level), like setMany
      later(() => { if (values) applySnapshot(values, silent); applyUI(ui); });
    },
    // Live theming clears the prior theme first, so setTheme(null) reverts to the default look.
    setName(n) { if (destroyed) return; title = String(n); titleEl.textContent = title; }, // a rename never moves saved values or presets
    setTheme(theme) { if (destroyed) return; if (themeVars) for (const k in themeVars) panel.style.removeProperty(k); themeVars = resolveTheme(theme); panel._twTheme = themeVars; applyThemeVars(panel, themeVars); window.dispatchEvent(new Event("tw-retheme")); },
    // Presets API (no-ops without opts.persist); before ready they queue like set() does.
    savePreset: (nm) => { if (destroyed || failed || !presetsKey || !nm) return false; if (!assembled) presetOps.set(String(nm), "save"); later(() => savePreset(nm)); return true; },
    loadPreset: (nm) => { const op = presetOps.get(String(nm)); if (destroyed || failed || op === "delete" || !(op === "save" || listPresets()[nm])) return false; later(() => loadPreset(nm)); return true; }, // a queued save counts as stored, a queued delete as gone
    deletePreset: (nm) => { if (presetsKey) { if (!assembled) presetOps.set(String(nm), "delete"); later(() => deletePreset(nm)); } },
    presets: () => (destroyed ? [] : Object.keys(listPresets())),
    undo: () => { if (undoApi) later(undoApi.undo); }, redo: () => { if (undoApi) later(undoApi.redo); }, // no-ops without opts.undo; queued before ready, in order
    // Teardown. Safe to call before ready resolves — assemble() sees the flag and bails.
    destroy() {
      if (destroyed) return;
      destroyed = true;
      closeActivePopover(panel); // page-wide singletons: close only what's anchored here
      hideHintNow(panel);
      for (const fn of cleanups.splice(0)) { try { fn(); } catch {} }
      listeners.clear();
      if (liftSlot) { liftSlot.remove(); liftSlot = null; }
      if (topFloating === panel) topFloating = null;
      panel.dataset.twDestroyed = ""; // onLive listeners release on their next event by this mark
      panel.remove();
    },
  } as Panel; // `ready` is filled in just below
  // Assemble once the missing modules resolve, surfacing that on ready; else assemble now.
  const pending = ensureForMetas(metas);
  if (pending) {
    // A failed chunk or a throwing build leaves the panel unbuildable: queued calls dropped, later calls refused,
    // ready rejects. A partway build must not leave live controls behind an inert API: release what it wired.
    const fail = (e: unknown) => {
      failed = true; queue.length = 0;
      if (built >= 0) for (const fn of cleanups.splice(built)) { try { fn(); } catch {} } // only what the build wired; the shell's stay for destroy()
      for (const c of controls.children) (c as HTMLElement).dataset.twDestroyed = ""; // detached below, they'd never see the panel's own mark
      listeners.clear(); entries.length = 0; controls.replaceChildren();
      if (!destroyed) console.warn(`[tweaks] "${name}": the panel could not be built — ${built >= 0 ? "the build threw" : "its lazy controls failed to load"}; the API is inert`); // the chunk's own error is logged in lazy.ts
      throw e;
    };
    api.ready = panel.ready = pending.then(assemble).then(() => api, fail); // fail covers both the chunk and a build that throws
    api.ready.catch(() => {}); // a handled fork: no unhandled-rejection noise
  }
  else { assemble(); api.ready = panel.ready = Promise.resolve(api); }
  return api as Panel;
}
