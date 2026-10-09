/* Standalone controls — the kit's controls without the panel: mountControl() builds ONE
 * control from a schema value into a host of your own (the same meta derivation and
 * constructor registry tweaks() uses, so every shorthand and verbose form works), and
 * createColorPicker() hands out the colour editor surface alone — the picker body with
 * no trigger row, for a host page that brings its own swatch. Both handles are shaped
 * like a panel: they exist synchronously, `set()` runs the change callback, `destroy()`
 * tears down, and `ready` resolves once a lazily-loaded control has built (immediately
 * on the single-file build, where every control is inlined). */
import { el, getControl, onReady, setDisabled } from "./shared.js";
import { metaFor, valueChanged, VALUELESS } from "./schema.js";
import { ensureForMetas } from "./lazy.js";
import { createControl } from "./controls/basic.js";
import { addHintMarker } from "./feedback.js";
import type { SchemaValue, MountOptions, MountedControl, ColorPickerOptions, ColorPicker, ColorMode, Control , Get } from "./types.js";
import type { Meta } from "./schema.js";
import type { PickerBody, PickerOptions } from "./controls/colour.js";

// The wrapper a standalone piece lives in. Outside a .tw-panel the cascade delivers none
// of the kit's tokens, and the controls size and paint from them (a slider track is
// `height: var(--tw-row-height)`, a surface `var(--tw-surface)`) — so the wrapper carries
// .tw-portal, the token scope the stylesheet already keeps for nodes that live outside a
// panel (the popovers, the toast, bare markup hosts): the full token set with its
// light/dark twins, the font stack, box-sizing, and no panel chrome.
const scope = (cls: string) => el("div", `${cls} tw-standalone tw-portal`);
// Run `build` once the lazy module a control needs has landed — synchronously when none
// is missing (the single build, or a chunk already warm), else behind the returned
// promise, which rejects if the chunk fails (the handled fork keeps that out of the
// unhandled-rejection channel for callers that never await it, like panel.ready).
const whenLoaded = <H>(metas: Array<Pick<Meta, "type">>, build: () => void, handle: H): Promise<H> => {
  const pend = ensureForMetas(metas);
  if (!pend) { build(); return Promise.resolve(handle); }
  const ready = pend.then(build).then(() => handle);
  ready.catch(() => {});
  return ready;
};

export function mountControl(host: Element, value: SchemaValue, opts: MountOptions = {}): MountedControl {
  const key = opts.key ?? "value";
  const meta = metaFor(key, value);
  // A folder or a tabs set is a tree of controls, not one — tweaks() is the entry for those.
  if (!meta || meta.type === "folder" || meta.type === "tabs") throw new TypeError(`[tweaks] mountControl: "${key}" is not a single-control schema value`);
  if (opts.label != null) meta.label = String(opts.label); // the option wins over a title-cased key or a verbose form's own label; "" = no label
  const valued = !VALUELESS.has(meta.type); // display/action controls carry no value: set/get are inert
  const root = scope("tw-control"); // stable from the start; the control fills it in (on the split build, once its chunk lands)
  host.append(root);
  let ctrl: Control | null = null, destroyed = false, last: unknown = meta.value, parked: unknown, queued = false;
  // The change path: the control's own emits and the handle's set() both land here, gated
  // the way the panel gates notify() — a same-value set() (a consumer mirroring values
  // back) stays silent instead of echoing.
  const emit = (v: unknown) => { if (!valueChanged(last, v)) return; last = v; opts.onChange && opts.onChange(v, key); };
  const build = () => {
    if (destroyed) return; // destroy() before the chunk landed — nothing to mount
    ctrl = createControl(meta, valued ? emit : () => {});
    if (!ctrl) return; // the chunk failed or the constructor threw — degrades to an empty wrapper, the panel's own idiom
    if (meta.hint) addHintMarker(ctrl.el, meta.hint);
    // The other per-control options a verbose value carries (ControlOptions) are resolved ONCE
    // at mount: a standalone control has no siblings for a predicate to read, so `get` answers
    // undefined, and nothing re-evaluates later. A throwing predicate leaves the control as-is.
    const none: Get = () => undefined;
    try {
      if (meta.render && !meta.render(none)) ctrl.el.classList.add("tw-cond-hidden");
      const d = typeof meta.disabled === "function" ? meta.disabled(none) : meta.disabled;
      if (d) setDisabled(ctrl.el, true);
    } catch {}
    root.append(ctrl.el);
    if (!valued) return;
    last = ctrl.get(); // the form the control opened on (a hex colour reads back in the picker's own notation)
    if (queued) { ctrl.set(parked); emit(ctrl.get()); } // a set() made in the lazy window applies — and announces — now
  };
  const handle: MountedControl = {
    el: root,
    set: (v) => { if (destroyed || !valued) return; if (ctrl) { ctrl.set(v); emit(ctrl.get()); } else { parked = v; queued = true; } },
    get: () => (!valued ? undefined : ctrl ? ctrl.get() : queued ? parked : meta.value),
    destroy: () => { destroyed = true; if (ctrl && typeof ctrl.destroy === "function") ctrl.destroy(); root.remove(); },
    ready: null,
  };
  handle.ready = whenLoaded([meta], build, handle);
  return handle;
}

export function createColorPicker(opts: ColorPickerOptions = {}): ColorPicker {
  // A wrapper of the kit's own, so the handle's `el` is stable across both builds: on the
  // code-split build the body fills it in once the colour chunk lands.
  const root = scope("tw-color-picker");
  let body: PickerBody | null = null, destroyed = false, last = opts.value, parked: string, queued = false, parkedMode: ColorMode = null;
  const emit = (v: string) => { if (!valueChanged(last, v)) return; last = v; opts.onChange && opts.onChange(v); };
  const build = () => {
    if (destroyed) return;
    const make = getControl<PickerBody, PickerOptions>("colorpicker"); // the picker body, registered by the colour module beside its control
    if (!make) return;
    body = make({ value: opts.value, mode: opts.mode }, emit);
    last = body.get();
    root.append(body.el);
    if (parkedMode) body.setMode(parkedMode);
    if (queued) { body.set(parked); emit(body.get()); }
    onReady(body.reflow); // rasterise + place the thumbs once it has a real box — next frame, for a picker appended right after creation
  };
  const picker: ColorPicker = {
    el: root,
    set: (v) => { if (destroyed) return; if (body) { body.set(v); emit(body.get()); } else { parked = v; queued = true; } },
    get: () => (body ? body.get() : queued ? parked : opts.value),
    mode: () => (body ? body.mode() : parkedMode || opts.mode || "oklch"),
    setMode: (m) => { if (body) body.setMode(m); else parkedMode = m; },
    reflow: () => { if (body) body.reflow(); },
    destroy: () => { destroyed = true; root.remove(); },
    ready: null,
  };
  picker.ready = whenLoaded([{ type: "color" }], build, picker);
  return picker;
}
