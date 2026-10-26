/* Standalone controls — the kit's controls without the panel: mountControl() builds one control
 * into a host of your own, createColorPicker() hands out the color editor surface alone. */
import { el, getControl, onReady, setDisabled, valueChanged } from "./shared.js";
import { metaFor, VALUELESS } from "./schema.js";
import { ensureForMetas } from "./lazy.js";
import { createControl } from "./controls/basic.js";
import { addHintMarker } from "./feedback.js";
import type { SchemaValue, HeldValue, KnownType, MountOptions, MountedControl, ColorPickerOptions, ColorPicker, ColorMode, Control , Get } from "./types.js";
import type { Meta } from "./schema.js";
import type { PickerBody, PickerOptions } from "./controls/color.js";

// Outside a .tw-panel the cascade delivers none of the kit's tokens, so the wrapper carries .tw-portal.
const scope = (cls: string) => el("div", `${cls} tw-standalone tw-portal`);
// Run `build` once the lazy module has landed (synchronously when none is missing); the handled fork keeps a failed chunk out of the unhandled-rejection channel.
const whenLoaded = <H>(metas: Array<Pick<Meta, "type">>, build: () => void, handle: H): Promise<H> => {
  const pend = ensureForMetas(metas);
  if (!pend) { build(); return Promise.resolve(handle); }
  const ready = pend.then(build).then(() => handle);
  ready.catch(() => {});
  return ready;
};

/** One control from a schema value, into `host`; a folder or tabs set is tweaks()'s to build. */
export function mountControl<const V extends HeldValue>(host: Element, value: V & KnownType<V>, opts?: MountOptions): MountedControl;
export function mountControl(host: Element, value: SchemaValue, opts: MountOptions = {}): MountedControl {
  const key = opts.key ?? "value";
  const meta = metaFor(key, value);
  if (!meta || meta.type === "folder" || meta.type === "tabs") throw new TypeError(`[tweaks] mountControl: "${key}" is not a single-control schema value`);
  if (opts.label != null) meta.label = String(opts.label); // the option wins over the derived label; "" = no label
  const valued = !VALUELESS.has(meta.type); // display/action controls carry no value: set/get are inert
  const root = scope("tw-control"); // the control fills it in on ready
  host.append(root);
  let ctrl: Control | null = null, destroyed = false, last: unknown = meta.value, parked: unknown, queued = false;
  // Gated the way the panel gates notify(): a same-value set() stays silent instead of echoing.
  const emit = (v: unknown) => { if (!valueChanged(last, v)) return; last = v; opts.onChange && opts.onChange(v, key); };
  const build = () => {
    if (destroyed) return; // destroy() before the chunk landed — nothing to mount
    ctrl = createControl(meta, valued ? emit : () => {});
    if (!ctrl) return; // a failed chunk degrades to an empty wrapper
    if (meta.hint) addHintMarker(ctrl.el, meta.hint);
    // Resolved once at mount: with no siblings for a predicate to read, `get` answers undefined.
    const none: Get = () => undefined;
    try { if (meta.render && !meta.render(none)) ctrl.el.classList.add("tw-cond-hidden"); } catch {}
    try { const d = typeof meta.disabled === "function" ? meta.disabled(none) : meta.disabled; if (d) setDisabled(ctrl.el, true); } catch {} // each predicate fails on its own
    root.append(ctrl.el);
    if (!valued) return;
    last = ctrl.get(); // the form the control opened on
    if (queued) { ctrl.set(parked); emit(ctrl.get()); } // a set() from the lazy window applies and announces now
  };
  const handle: MountedControl = {
    el: root,
    set: (v) => { if (destroyed || !valued) return; if (ctrl) { ctrl.set(v); emit(ctrl.get()); } else { parked = v; queued = true; } },
    get: () => (!valued ? undefined : ctrl ? ctrl.get() : queued ? parked : meta.value),
    destroy: () => { destroyed = true; if (ctrl && typeof ctrl.destroy === "function") ctrl.destroy(); root.dataset.twDestroyed = ""; root.remove(); }, // onLive listeners release on their next event by this mark
    ready: null,
  };
  handle.ready = whenLoaded([meta], build, handle);
  return handle;
}

/** The color editor surface alone, for a host page that brings its own swatch. */
export function createColorPicker(opts: ColorPickerOptions = {}): ColorPicker {
  const root = scope("tw-color-picker");
  let body: PickerBody | null = null, destroyed = false, last = opts.value, parked: string, queued = false, parkedMode: ColorMode = null;
  const emit = (v: string) => { if (!valueChanged(last, v)) return; last = v; opts.onChange && opts.onChange(v); };
  const build = () => {
    if (destroyed) return;
    const make = getControl<PickerBody, PickerOptions>("colorpicker"); // registered by the color module beside its control
    if (!make) return;
    body = make({ value: opts.value, mode: opts.mode }, emit);
    last = body.get();
    root.append(body.el);
    if (parkedMode) body.setMode(parkedMode);
    if (queued) { body.set(parked); emit(body.get()); }
    onReady(body.reflow); // next frame: the thumbs need a real box
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
