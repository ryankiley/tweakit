/* tweaks() — the panel factory: builds the shell + controls from a schema and
 * returns the live API (params/on/set/reset/toJSON/…). Persistence, presets,
 * undo, the filter, floating drag, and the lazy-window replay all live here. */
import {
  el, btn, txt, clamp, popover, closeActivePopover, stopPointerLeak,
  applyThemeVars, resolveTheme, carryScheme, onLive, quietFocus, fuzzyMatch,
  REDUCE_MOTION, getControl,
} from "./shared.js";
import { metaFor, valueChanged, hasOwn, VALUELESS } from "./schema.js";
import { ensureForMetas } from "./lazy.js";
import { createFolder, createControl } from "./controls/basic.js";
import { makeCopyBtn, makeResetBtn, toolbarBtn, flashCopied, spinReset, showToast, hideHintNow, addHintMarker, copyText } from "./feedback.js";
import { ICON_PRESETS, ICON_X, ICON_SEARCH } from "./icons.js";
import type { Schema, TweaksOptions, Panel, Params } from "./types.js";

export function tweaks(name: string, schema: Schema, opts: TweaksOptions = {}): Panel {
  // "_last" is the changed-key channel on params — a schema entry by that name would
  // fight it (the param's value doubles as the listener's "what changed" argument).
  const metas = Object.entries(schema).filter(([k]) => k !== "_last" || (console.warn('[tweaks] "_last" is reserved (the changed-key channel) — schema entry skipped'), false)).map(([k, v]) => metaFor(k, v)).filter(Boolean);
  const params: Params = {};
  const entries = []; // { target, key, set, get, def, path } — flattened across folders, for reset + persist
  const subTrees = new Set(); // the folder/tabs params sub-objects — set() refuses to overwrite one (doing so orphaned every child entry silently)
  const listeners = new Set<(p?: any, last?: any) => void>();
  const cleanups: Array<() => void> = []; // every global attachment (document/window listeners, pending timers) registers its release here for destroy()
  let destroyed = false; // flipped by destroy(): assemble() bails, the mutating API methods go silent
  let assembled = false; // flipped at the end of assemble() — set() queues until the controls exist
  const preSets: Array<[string | symbol, any]> = []; // set()/setMany()/fromJSON() calls from the lazy window, replayed once assemble() has built the controls — a dotted/nested set before then used to warn-and-drop, and a bare nested key minted a top-level orphan while the control kept its default
  let liftSlot = null; // the placeholder a lifted panel leaves in its host slot — removed on destroy()
  let persist = () => {}; // reassigned below when opts.persist is set (debounced localStorage save)
  // Assigned by assemble() below. Declared here so the API returned synchronously can
  // forward to them even on the lazy path, where assemble() runs after modules load.
  let listPresets: () => Record<string, any> = () => ({}), savePreset: (nm?: string) => boolean = () => false, loadPreset: (nm?: string) => boolean = () => false, deletePreset: (nm?: string) => void = () => {};
  let undo = () => {}, redo = () => {};
  // Whole-panel state (toJSON/fromJSON). Reassigned in assemble() once the controls + the
  // value/UI collectors exist; the stubs below cover the lazy window before ready — toJSON
  // returns the live values (no UI state yet); fromJSON enqueues onto preSets (tagged), so it
  // replays interleaved with set()/setMany() in call order, after the persist/preset restore.
  const FROMJSON = Symbol("fromJSON"), SETMANY = Symbol("setMany");
  let doToJSON: () => any = () => { const v = JSON.parse(JSON.stringify(params)); delete v._last; return { values: v, ui: {} }; };
  let doFromJSON: (state: any) => void = (state) => { preSets.push([FROMJSON, state]); };
  // Each listener runs isolated: a throwing on() callback (or internal listener)
  // can't break the others, skip persist(), or bubble back out through set().
  const notify = () => { listeners.forEach((fn) => { try { fn(params, params._last); } catch (e) { console.error("[tweaks] listener threw:", e); } }); persist(); };
  // Persistence + presets storage keys — opt-in via opts.persist (a string key, or
  // `true` to key by the panel name). null disables both (existing callers unaffected).
  const persistKey = opts.persist ? `tw:${opts.persist === true ? name : opts.persist}` : null;
  const presetsKey = persistKey ? `${persistKey}:presets` : null;
  const readStore = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
  const writeStore = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  const panel = el("div", "tw-panel"); panel.dataset.mode = "inline";
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
  // Copy uses the site's contextual icon swap — copy ⇄ check cross-fade (both
  // icons stacked, opacity+scale+blur transitioned), not an innerHTML cut.
  const copyBtn = makeCopyBtn();
  const resetBtn = makeResetBtn();
  // Presets button appears only when persistence is on (presets share its storage).
  let presetsBtn = null;
  if (persistKey) {
    presetsBtn = toolbarBtn("", ICON_PRESETS, "Presets");
    presetsBtn.setAttribute("aria-haspopup", "menu"); presetsBtn.setAttribute("aria-expanded", "false");
    toolbar.append(presetsBtn);
  }
  // Filter (opts.filter): a search button swaps the title for an input; typing hides
  // controls whose label doesn't match (folders stay if their title or a child does).
  const filterOn = !!opts.filter;
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
  // The toolbar's handlers wire up in assemble() — until then (the lazy-chunk window on
  // the split build) the buttons are honestly inert rather than silently dead.
  for (const b of [copyBtn, resetBtn, presetsBtn, searchBtn]) if (b) b.disabled = true;
  // A header drag (floating mode) sets this so the click ending the drag doesn't collapse.
  let dragMoved = false;
  titleBtn.addEventListener("click", () => {
    if (dragMoved) { dragMoved = false; return; }
    const collapsed = panel.classList.toggle("is-collapsed");
    titleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    body.inert = collapsed; // same a11y reason as the folder: a collapsed panel's controls leave the tab order + a11y tree
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
  // chunks land. The drag wiring itself still lives in assemble(). ──
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
  const resetEntry = (e) => { e.set(e.def); e.target[e.key] = e.get(); params._last = e.key; notify(); };
  const wireReset = (root, entry) => {
    const t = root.querySelector(".tw-slider-value")
      || root.querySelector(".tw-row-label, .tw-select-label, .tw-trigger-label, .tw-radiogrid-label, .tw-field-label")
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
    t.addEventListener("dblclick", (e) => { e.preventDefault(); e.stopPropagation(); resetEntry(entry); });
  };

  // Conditional controls — `render: (get) => bool` shows/hides; `disabled` (boolean
  // or `(get) => bool`) greys-out + locks; both re-evaluate on every change. `hint`
  // is a static tooltip. registerCond wires whichever a control declared.
  const conditionals = [];
  const registerCond = (node, m) => {
    if (m.hint) addHintMarker(node, m.hint);
    if (m.render || m.disabled != null) conditionals.push({ node, m });
  };
  const filterItems = [], filterFolders = []; // searchable index (opts.filter) keyed on each control's real label
  const folderEls: any[] = [], tabsCtrls: any[] = []; // folder + tabs handles keyed by path — read/restored as UI state by toJSON/fromJSON

  // Build controls into a container, recursing into folders (nested params).
  const build = (container, ms, target, basePath = [], folderItem = null) => {
    for (const m of ms) {
      if (m.type === "tabs") {
        const sub = {}; subTrees.add(sub); target[m.key] = sub;
        const makeTabs = getControl("tabs");
        const tabsCtrl = makeTabs && makeTabs(m);
        if (!tabsCtrl) continue; // tabs module ensured before assemble; skip if it failed to load
        tabsCtrls.push({ path: [...basePath, m.key], ctrl: tabsCtrl, pageKeys: m.pages.map((p) => p.key) });
        m.pages.forEach((page, i) => { const psub = {}; subTrees.add(psub); sub[page.key] = psub; build(tabsCtrl.bodies[i], page.children, psub, [...basePath, m.key, page.key]); });
        registerCond(tabsCtrl.el, m); container.append(tabsCtrl.el);
        continue;
      }
      if (m.type === "folder") {
        const sub = {}; subTrees.add(sub); target[m.key] = sub;
        const f = createFolder(m);
        folderEls.push({ path: [...basePath, m.key], el: f.el, setCollapsed: f.setCollapsed });
        const fi = filterOn ? { el: f.el, label: m.label, body: f.body } : null;
        if (fi) filterFolders.push(fi);
        build(f.body, m.children, sub, [...basePath, m.key], fi); registerCond(f.el, m); container.append(f.el);
        continue;
      }
      if (VALUELESS.has(m.type)) { const ctrl = createControl(m, () => {}); if (ctrl) { if (filterOn && m.type !== "separator") filterItems.push({ el: ctrl.el, label: m.label, folder: folderItem }); registerCond(ctrl.el, m); container.append(ctrl.el); } continue; }
      const ctrl = createControl(m, (v) => { if (!valueChanged(target[m.key], v)) return; target[m.key] = v; params._last = m.key; notify(); }); // same-value emits (a discrete drag inside one detent, a re-entrant echo) don't notify
      if (!ctrl) continue;
      // A value a host parked on params directly before assemble ran (the lazy-load
      // window on the split build) wins over the schema default — apply it to the
      // control rather than clobbering it back with ctrl.get(). (API set() calls from
      // that window queue in preSets and replay after the build instead.)
      if (hasOwn(target, m.key)) ctrl.set(target[m.key]);
      target[m.key] = ctrl.get();
      const entry = { target, key: m.key, set: ctrl.set, get: ctrl.get, def: m.value, path: [...basePath, m.key] };
      entries.push(entry); wireReset(ctrl.el, entry); registerCond(ctrl.el, m);
      if (filterOn) filterItems.push({ el: ctrl.el, label: m.label, folder: folderItem });
      container.append(ctrl.el);
    }
  };

  // Build the controls + wire everything (persistence, presets, undo, filter, …).
  // Runs synchronously when every control type the schema needs is already registered
  // — the readable single-file build, and any split build after the modules have loaded
  // once — and is deferred behind panel.ready otherwise. tweaks() returns synchronously
  // either way: the panel shell + API exist immediately; lazy controls fill in on ready.
  const assemble = () => {
  if (destroyed) return; // destroy() before the lazy chunks landed — nothing to build
  build(controls, metas, params);

  // Apply the conditionals now and on every change (a sibling's value can flip them).
  if (conditionals.length) {
    const byKey = new Map(); for (const e of entries) if (!byKey.has(e.key)) byKey.set(e.key, e); // first wins, like the find() it replaces
    const getVal = (k) => { const e = byKey.get(k); return e ? e.target[e.key] : params[k]; };
    const applyConditionals = () => {
      for (const { node, m } of conditionals) {
        // A throwing render/disabled predicate degrades to "leave the node as-is"
        // rather than aborting construction or the whole notify() pass.
        try {
          if (m.render) node.classList.toggle("tw-cond-hidden", !m.render(getVal));
          if (m.disabled != null) { const d = typeof m.disabled === "function" ? m.disabled(getVal) : m.disabled; node.classList.toggle("is-disabled", !!d); node.inert = !!d; } // inert blocks keyboard + focus too, not just the CSS pointer-events
        } catch {}
      }
    };
    listeners.add(applyConditionals); applyConditionals();
  }

  // ── Filter (opts.filter) — the search button swaps the title for a filter input ──
  if (filterOn) {
    const applyFilter = (raw) => {
      const q = raw.trim().toLowerCase();
      if (!q) { filterItems.forEach((i) => i.el.classList.remove("tw-filter-hidden")); filterFolders.forEach((f) => f.el.classList.remove("tw-filter-hidden")); return; }
      for (const it of filterItems) {
        const folderMatch = it.folder && fuzzyMatch(it.folder.label, q);
        it.el.classList.toggle("tw-filter-hidden", !(fuzzyMatch(it.label, q) || folderMatch));
      }
      // innermost folders first, so an outer folder sees its children's resolved state
      for (const f of filterFolders.slice().reverse()) {
        const hasChild = [...f.body.children].some((ch) => !ch.classList.contains("tw-filter-hidden"));
        f.el.classList.toggle("tw-filter-hidden", !(fuzzyMatch(f.label, q) || hasChild));
      }
    };
    const exitSearch = () => { panel.classList.remove("is-searching"); searchInput.value = ""; applyFilter(""); };
    searchBtn.addEventListener("click", () => { if (panel.classList.toggle("is-searching")) { searchInput.focus(); searchInput.select(); } else exitSearch(); });
    searchInput.addEventListener("input", () => applyFilter(searchInput.value));
    searchInput.addEventListener("keydown", (e) => { if (e.key === "Escape") { exitSearch(); searchBtn.focus(); } });
  }

  // ── Persistence + named presets (opt-in via opts.persist) ──────────────────
  // The live values save to localStorage (debounced) and restore on build; presets
  // are named snapshots under "<key>:presets". Path-aware so folders round-trip.
  const atPath = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const stripLast = function (k, v) { return k === "_last" && this === params ? undefined : v; }; // function, not arrow: `this` is the holder, so only the top-level changed-key channel strips — a folder child legitimately keyed "_last" survives
  const snapshot = () => JSON.parse(JSON.stringify(params, stripLast));
  const applySnapshot = (snap, fire = true) => {
    if (!snap || typeof snap !== "object") return;
    for (const e of entries) { const v = atPath(snap, e.path); if (v !== undefined) { e.set(v); e.target[e.key] = e.get(); } }
    params._last = undefined; if (fire) notify();
  };
  if (persistKey) {
    let saveT; persist = () => { clearTimeout(saveT); saveT = setTimeout(() => writeStore(persistKey, snapshot()), 150); };
    cleanups.push(() => clearTimeout(saveT));
    // Restore last session, notifying: on the lazy path assemble runs after tweaks()
    // returned, so a host that already subscribed must hear the restored values (on the
    // synchronous path nobody is subscribed yet, so the notify is free).
    applySnapshot(readStore(persistKey));
  }
  listPresets = () => { const p = presetsKey ? readStore(presetsKey) : null; return Object.assign(Object.create(null), p && typeof p === "object" ? p : {}); }; // null-proto: a preset named "__proto__" is an ordinary key (a plain object's assignment wrote the prototype — savePreset claimed success while storing nothing, loadPreset applied Object.prototype)
  savePreset = (nm) => { if (!presetsKey || !nm) return false; const all = listPresets(); all[nm] = snapshot(); writeStore(presetsKey, all); return true; };
  loadPreset = (nm) => { const all = listPresets(); if (all[nm]) { applySnapshot(all[nm]); return true; } return false; };
  deletePreset = (nm) => { if (!presetsKey) return; const all = listPresets(); delete all[nm]; writeStore(presetsKey, all); };

  // ── Whole-panel state (toJSON / fromJSON) ──────────────────────────────────
  // Values via the same snapshot machinery as presets, PLUS UI state — folder
  // open/closed and the active tab, keyed by dotted path. Decoupled from
  // localStorage: the host persists the returned object however it likes (a file,
  // a URL/share link, a server). fromJSON applies values where their path still
  // exists (missing keys skipped, like a preset load) then restores the UI state.
  const pathKey = (p) => p.map((k) => String(k).replace(/~/g, "~1").replace(/\./g, "~0")).join("."); // JSON-pointer-style escaping → injective: a literal "." in a key can't collide with the nesting separator (keys without dots stay readable)
  const collectUI = () => {
    const ui: any = {};
    if (folderEls.length) { const f: any = {}; for (const fe of folderEls) f[pathKey(fe.path)] = fe.el.classList.contains("is-collapsed"); ui.folders = f; }
    if (tabsCtrls.length) { const t: any = {}; for (const tc of tabsCtrls) t[pathKey(tc.path)] = tc.pageKeys[tc.ctrl.active()] ?? null; ui.tabs = t; }
    return ui;
  };
  const applyUI = (ui) => {
    if (!ui || typeof ui !== "object") return;
    if (ui.folders) for (const fe of folderEls) { const c = ui.folders[pathKey(fe.path)]; if (typeof c === "boolean") fe.setCollapsed(c); }
    if (ui.tabs) for (const tc of tabsCtrls) { const i = tc.pageKeys.indexOf(ui.tabs[pathKey(tc.path)]); if (i >= 0 && i !== tc.ctrl.active()) tc.ctrl.activate(i); } // skip re-activating the already-active tab — avoids a spurious tw-reflow on a no-op restore
  };
  doToJSON = () => ({ values: snapshot(), ui: collectUI() });
  doFromJSON = (state) => { if (!state || typeof state !== "object") return; if (state.values) applySnapshot(state.values); applyUI(state.ui); }; // applySnapshot fires notify once; UI restore is silent (not a value change). A lazy-window fromJSON replays via its tagged preSets entry, in call order.

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
    };

    let dragId = null, sx = 0, sy = 0, ox = 0, oy = 0;
    header.addEventListener("pointerdown", (e) => {
      // Let the toolbar buttons and any inputs work; drag from anywhere else on the header.
      if (e.button !== 0 || dragId !== null || e.target.closest(".tw-toolbar, input, textarea, select")) return;
      dragId = e.pointerId; sx = e.clientX; sy = e.clientY; dragMoved = false;
      panel.classList.add("is-grabbing"); // press feedback: brighten the grabber the instant it's grabbed, before any move — matters on touch, where there's no hover to reveal it first
      // Regrab mid–edge-snap: pick the panel up where it visually is (the eased,
      // in-flight position), not the parked target px/py already hold — clearing the
      // transition against the target style teleported it on the first move.
      if (panel.style.transition) {
        const cur = getComputedStyle(panel);
        px = parseFloat(cur.left) || px; py = parseFloat(cur.top) || py;
        panel.style.transition = ""; apply();
      } else panel.style.transition = ""; // clear any leftover snap transition so the grab is 1:1
    });
    header.addEventListener("pointermove", (e) => {
      if (e.pointerId !== dragId) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragMoved) {
        if (Math.abs(dx) + Math.abs(dy) < 4) return; // a few px of slop before it counts as a drag, not a click
        dragMoved = true; lift(); ox = px; oy = py; // capture the (possibly just-lifted) origin once the drag truly starts
        try { header.setPointerCapture(dragId); } catch {}
        panel.classList.add("is-dragging");
      }
      const { maxX, maxY } = bounds();
      px = clamp(ox + dx, MARGIN, maxX); py = clamp(oy + dy, MARGIN, maxY); apply();
    });
    const endDrag = (e) => {
      if (e.pointerId !== dragId) return;
      try { header.releasePointerCapture(dragId); } catch {}
      dragId = null;
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
    header.addEventListener("pointerup", endDrag);
    header.addEventListener("pointercancel", endDrag);
    header.addEventListener("lostpointercapture", endDrag); // implicit capture loss mid-drag ends it like a release
    // Keep a floated panel inside the viewport as the window resizes — self-cleaning
    // (it used to leak per draggable panel), and released eagerly by destroy().
    cleanups.push(onLive(panel, [[window, "resize"]], () => { if (panel.dataset.mode === "floating") { clampPos(); apply(); } }));
  }

  if (presetsBtn) {
    const menu = el("div", "tw-presets-menu");
    const saveRow = el("div", "tw-presets-save");
    const input = el("input", "tw-presets-input"); input.type = "text"; input.placeholder = "Preset name…"; input.spellcheck = false; input.setAttribute("aria-label", "New preset name"); quietFocus(input);
    const saveBtn = txt("button", "tw-presets-savebtn", "Save"); saveBtn.type = "button";
    saveRow.append(input, saveBtn);
    const list = el("div", "tw-presets-list");
    menu.append(saveRow, list);
    const renderList = () => {
      const all = listPresets(), names = Object.keys(all);
      list.replaceChildren();
      if (!names.length) return list.append(txt("div", "tw-presets-empty", "No presets yet"));
      for (const nm of names) {
        const row = el("div", "tw-presets-row");
        const load = txt("button", "tw-presets-load", nm); load.type = "button";
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

  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(JSON.stringify(params, stripLast, 2));
    if (ok) { flashCopied(copyBtn); showToast(`${name} values copied`, panel); }
    else showToast("Copy failed", panel);
  });
  // A host can supply its own reset (e.g. restore real app defaults + rebuild);
  // otherwise reset each control to the default it was built with. The icon spins
  // once on click — motion feedback to match the copy swap.
  resetBtn.addEventListener("click", () => {
    spinReset(resetBtn);
    if (typeof opts.onReset === "function") return opts.onReset();
    entries.forEach((e) => { e.set(e.def); e.target[e.key] = e.get(); }); params._last = undefined; notify();
  });

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
    const editDown = (e) => {
      if (editing || !e.target.closest(DRAG_SEL)) return;
      editing = true; opts.onEditStart && opts.onEditStart();
      document.addEventListener("pointerup", endEdit, true); document.addEventListener("pointercancel", endEdit, true);
    };
    panel.addEventListener("pointerdown", editDown);
    panel._twEditPointer = editDown; // popover() relays pointerdowns on its portaled surfaces here
    cleanups.push(endEdit);
  }

  // ── Undo / redo (opts.undo) — a debounced history of snapshots. Cmd/Ctrl-Z undoes,
  // ⇧ (or Ctrl-Y) redoes, scoped to when the panel is hovered or focused so it doesn't
  // hijack the page's own undo. A continuous drag coalesces into one step. ──
  if (opts.undo) {
    let history = [snapshot()], histIdx = 0, applyingHistory = false, histTimer = 0;
    const commit = () => {
      histTimer = 0;
      const snap = snapshot();
      if (JSON.stringify(snap) === JSON.stringify(history[histIdx])) return; // unchanged
      history = history.slice(0, histIdx + 1); history.push(snap); histIdx = history.length - 1; // a new edit drops the redo branch
    };
    const record = () => { if (applyingHistory) return; clearTimeout(histTimer); histTimer = setTimeout(commit, 350); };
    const flush = () => { if (histTimer) { clearTimeout(histTimer); commit(); } }; // commit a pending edit first, so ⌘Z right after a change still undoes it
    listeners.add(record);
    const restore = (idx) => { applyingHistory = true; applySnapshot(history[idx]); applyingHistory = false; histIdx = idx; };
    undo = () => { flush(); if (histIdx > 0) restore(histIdx - 1); };
    redo = () => { flush(); if (histIdx < history.length - 1) restore(histIdx + 1); };
    const focused = () => panel.matches(":hover") || panel.contains(document.activeElement);
    // Self-cleaning (the listener used to hold the whole panel + history alive forever),
    // and released eagerly by destroy().
    cleanups.push(onLive(panel, [[document, "keydown"]], (e) => {
      if (!focused() || !(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (k === "y") { e.preventDefault(); redo(); }
    }));
  }
  assembled = true;
  // Replay set() calls queued during the lazy window — after the persisted-session
  // restore above, so an explicit host set() wins over a stored value the way it wins
  // over the schema default. Each replays through api.set, so paths resolve against
  // the real entries and listeners hear the changes.
  for (const [k, v] of preSets.splice(0)) { if (k === FROMJSON) doFromJSON(v); else if (k === SETMANY) api.setMany(v); else api.set(k as string, v); } // tagged fromJSON/setMany entries replay through their assembled impls (one notify each); the shared queue preserves set/setMany/fromJSON call order
  for (const b of [copyBtn, resetBtn, presetsBtn, searchBtn]) if (b) b.disabled = false; // the toolbar's handlers are live now
  }; // end assemble

  // The API is built + returned synchronously. on/set/reset/setTheme operate on the
  // shell (live immediately); the presets + undo methods forward to bindings assemble()
  // fills in (no-ops until then — only reachable on the lazy path, before ready).
  // One programmatic value write — resolve a (possibly dotted) key to its control or to a
  // free bag key, apply it, and report whether the resolved leaf actually changed. The
  // shared core of set()/setMany(): it never notifies, so a batch can fire one notify at
  // the end (a set() loop would re-run every listener + persist per key).
  const RESERVED = (p) => p === "__proto__" || p === "constructor" || p === "prototype";
  const reservedKey = (key) => { if (String(key).split(".").some(RESERVED)) { console.warn(`[tweaks] set("${key}") ignored — reserved key`); return true; } return false; }; // params is an object-as-map; never write through to the prototype — shared by applySet + the lazy-window queue paths
  const applySet = (key, v) => {
    if (reservedKey(key)) return false;
    const parts = String(key).split(".");
    let e;
    if (parts.length > 1) {
      // Dotted path ("folder.child", "tabs.page.child") — walk the folder/tabs subtrees to
      // the owning target, then match the leaf there.
      let t: any = params;
      for (let i = 0; i < parts.length - 1 && t; i++) { t = t[parts[i]]; if (!subTrees.has(t)) t = null; }
      e = t && entries.find((x) => x.target === t && x.key === parts[parts.length - 1]);
      if (!e) { console.warn(`[tweaks] set("${key}") — no control at that path`); return false; }
    } else {
      // Bare key — a unique match anywhere reaches nested controls without a path;
      // ambiguity warns instead of guessing (and instead of minting an orphan top-level key).
      const matches = entries.filter((x) => x.key === key);
      if (matches.length > 1) { console.warn(`[tweaks] set("${key}") is ambiguous — ${matches.length} controls share that key; use a dotted path (e.g. "${matches[0].path.join(".")}")`); return false; }
      e = matches[0];
    }
    const target = e ? e.target : params, leaf = e ? e.key : key;
    const prev = target[leaf];
    if (e) { e.set(v); target[leaf] = e.get(); }
    else if (subTrees.has(params[key])) { console.warn(`[tweaks] set("${key}") ignored — it's a folder/tabs group; set its children instead`); return false; } // overwriting the subtree would silently orphan every child value
    else params[key] = v; // bag passthrough — hosts park free keys on params
    if (!valueChanged(prev, target[leaf])) return false; // a no-change set doesn't notify — the guard that keeps a store-sync listener from echoing forever
    params._last = leaf; // stamp the changed key, so on((p, last)) sees programmatic sets the same as control edits
    return true;
  };

  const api: any = {
    el: panel, params,
    on(fn) { if (destroyed) return () => {}; listeners.add(fn); return () => listeners.delete(fn); },
    set(key, v) {
      if (destroyed) return;
      if (!assembled) { // the lazy window (split build, before ready): the controls don't exist yet, so queue and let assemble() replay — resolving against the real entries instead of warning a nested path away or orphaning a bare key on params
        if (reservedKey(key)) return;
        return void preSets.push([String(key), v]);
      }
      if (applySet(key, v)) notify();
    },
    // Batch write — apply a flat map of (possibly dotted) keys, e.g.
    // setMany({ "shadow.radius": 28, blur: 48 }), firing listeners + persist ONCE for the
    // whole batch rather than per key as a set() loop would. Same path resolution and
    // no-op / reserved / bad-path guards as set(); unrecognised keys warn-and-skip.
    setMany(values) {
      if (destroyed || values == null || typeof values !== "object") return;
      if (!assembled) { // lazy window — queue the whole batch as ONE tagged entry, so it replays as a single setMany() (one notify), interleaved in call order with set()/fromJSON()
        const filtered: any = {};
        for (const k of Object.keys(values)) { if (!reservedKey(k)) filtered[k] = values[k]; }
        preSets.push([SETMANY, filtered]);
        return;
      }
      let changed = false;
      for (const k of Object.keys(values)) { if (applySet(k, values[k])) changed = true; }
      if (changed) notify();
    },
    reset() { if (!destroyed) resetBtn.click(); },
    // Whole-panel state — values + UI (open folders, active tabs) as a plain JSON-safe
    // object, independent of localStorage. `JSON.stringify(panel)` works too (this is the
    // standard toJSON hook). fromJSON applies a previously-saved object back.
    toJSON() { return destroyed ? { values: {}, ui: {} } : doToJSON(); },
    fromJSON(state) { if (!destroyed) doFromJSON(state); },
    // Live theming — re-applies --tw-* vars to the panel (and future popovers). Clears
    // the prior theme first, so setTheme(null) reverts to the default monochrome look.
    setTheme(theme) { if (destroyed) return; if (themeVars) for (const k in themeVars) panel.style.removeProperty(k); themeVars = resolveTheme(theme); panel._twTheme = themeVars; applyThemeVars(panel, themeVars); window.dispatchEvent(new Event("tw-retheme")); },
    // Presets API (no-ops without opts.persist). Names are arbitrary strings.
    savePreset: (nm) => !destroyed && savePreset(nm), loadPreset: (nm) => !destroyed && loadPreset(nm), deletePreset: (nm) => { if (!destroyed) deletePreset(nm); }, presets: () => (destroyed ? [] : Object.keys(listPresets())),
    undo: () => { if (!destroyed) undo(); }, redo: () => { if (!destroyed) redo(); }, // no-ops without opts.undo
    // Teardown: close any open portaled surface, release every global attachment, pull
    // the panel (and the lift placeholder) out of the DOM, and inert the API. Safe to
    // call before ready resolves — assemble() sees the flag and bails.
    destroy() {
      if (destroyed) return;
      destroyed = true;
      closeActivePopover(); // popovers are globally single-open, so whichever is up closes (idempotent if it isn't this panel's)
      hideHintNow();
      for (const fn of cleanups.splice(0)) { try { fn(); } catch {} }
      listeners.clear();
      if (liftSlot) { liftSlot.remove(); liftSlot = null; }
      panel.remove();
    },
  };
  // Lazy controls: if the schema needs feature modules not yet loaded, assemble once
  // they resolve and surface that on panel.ready / api.ready; otherwise assemble now
  // (synchronous — the monolith and warmed-up split builds always take this path).
  const pending = ensureForMetas(metas);
  if (pending) {
    api.ready = panel.ready = pending.then(assemble).then(() => api);
    api.ready.catch(() => {}); // a handled fork — no unhandled-rejection noise when a chunk fails, while ready still rejects for hosts that await it
  }
  else { assemble(); api.ready = panel.ready = Promise.resolve(api); }
  return api as Panel;
}
