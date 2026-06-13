/* Public types for the Tweakability API — the schema you hand to tweaks() and the
 * panel you get back. These are what ship as .d.ts, so consumers get autocomplete on
 * the schema shorthands + the verbose control forms + the panel methods. */

/** An option for a select / radio grid: a bare string, or `{ value, label }`. */
export type Option = string | { value: string; label?: string };

/** A colour stop in a gradient. */
export type GradientStop = { color: string; pos: number };

/** Reader passed to a conditional `render` / `disabled` predicate — `get("siblingKey")`. */
export type Get = (key: string) => unknown;

/** Per-control extras that can ride on any object-form value. */
export interface ControlOptions {
  /** Show/hide this control based on other values. */
  render?: (get: Get) => boolean;
  /** Grey-out + lock this control (static, or derived from other values). */
  disabled?: boolean | ((get: Get) => boolean);
  /** A tooltip revealed by an ⓘ marker beside the label. */
  hint?: string;
}

/** The verbose object forms a schema value can take: `{ type: "…", … }`. */
export type SchemaObject =
  | { type: "slider"; value?: number; min?: number; max?: number; step?: number; soft?: boolean }
  | { type: "number"; value?: number; min?: number; max?: number; step?: number; soft?: boolean }
  | { type: "checkbox"; value?: boolean }
  | { type: "list"; options: Option[]; value?: string }
  | { type: "radiogrid" | "segmented"; options: Option[]; value?: string; cols?: number }
  | { type: "color"; value?: string; label?: string }
  | { type: "text"; value?: string; rows?: number; placeholder?: string }
  | { type: "interval"; value?: [number, number]; min?: number; max?: number; step?: number }
  | { type: "spring"; stiffness?: number; damping?: number; mass?: number; value?: { stiffness?: number; damping?: number; mass?: number } }
  | { type: "cubicbezier"; value?: [number, number, number, number] }
  | { type: "point"; components: Array<{ key: string; label?: string; value?: number; min?: number; max?: number; step?: number }>; pad?: boolean; invertY?: boolean }
  | { type: "gradient"; value?: { stops: GradientStop[] } | Array<GradientStop | [string, number]> }
  | { type: "plot"; expr?: string; fn?: (x: number) => number; xMin?: number; xMax?: number; yMin?: number; yMax?: number; samples?: number; editable?: boolean }
  | { type: "fpsgraph"; label?: string }
  | { type: "monitor"; get?: () => number | string; value?: number | string; graph?: boolean; view?: "graph" | "text"; min?: number; max?: number; interval?: number; rows?: number; decimals?: number }
  | { type: "image"; value?: string }
  | { type: "button"; action: () => void; label?: string }
  | { type: "buttongroup"; buttons: Record<string, () => void> | Array<{ label: string; action: () => void }> }
  | { type: "separator" }
  | { type: "tabs"; pages: Record<string, Schema> };

/** A schema value — a shorthand, a verbose `{ type }` object, or a nested folder. */
export type SchemaValue =
  | number                                          // bare number → slider (0…3×)
  | boolean                                         // → checkbox
  | string                                          // a label, or a colour string → colour picker
  | [number] | [number, number] | [number, number, number] | [number, number, number, number] // [value, min?, max?, step?] → slider
  | [[number, number], number, number] | [[number, number], number, number, number]           // [[lo,hi], min, max, step?] → interval
  | Option[]                                        // a list of options → list (dropdown)
  | (SchemaObject & ControlOptions)                 // verbose form (+ render/disabled/hint)
  | Schema;                                         // nested object → folder

/** The object you hand to `tweaks(name, schema, opts?)`. */
export interface Schema { [key: string]: SchemaValue; }

/** A theme — token overrides applied over the default monochrome look. Every key is
 *  optional, so a partial theme only moves what it names; unset tokens keep their default.
 *  Use the friendly names here, or any raw `--tw-*` custom property. Apply at build via
 *  `tweaks(name, schema, { theme })`, or live via `panel.setTheme(theme)`. The kit's whole
 *  appearance runs on these custom properties — this is the public theming surface. */
export interface Theme {
  /** Brand accent — slider fills, focus rings, active highlights (default: neutral, no accent). */
  accent?: string;
  /** Text drawn on the accent (active segment / radio label). Auto-derived from the accent's luminance if unset. */
  onAccent?: string;
  /** Panel background, reused for recessed wells. */
  base?: string;
  /** Popover / dropdown background. */
  dropdownBg?: string;
  /** Control surface and its hover / active steps. */
  surface?: string; surfaceHover?: string; surfaceActive?: string;
  /** Hairline border and its hover step. */
  border?: string; borderHover?: string;
  /** Text-selection highlight wash. */
  selection?: string;
  /** Text tones — panel title, section heading, primary value text, control label, and the muted / faint / focus tones. */
  title?: string; section?: string; text?: string; label?: string; textMuted?: string; textFaint?: string; focus?: string;
  /** Copy-confirmation accent. */
  success?: string;
  /** Invalid-state accent (the plot's bad-expression cue). */
  danger?: string;
  /** Popover shadow, the panel's container elevation, and its lifted (floating / dragging) variant. */
  shadow?: string; shadowPanel?: string; shadowPanelLifted?: string;
  /** Font stack, and the monospace stack (the plot's expression field). */
  font?: string; fontMono?: string;
  /** Control corner radius and row height — a bare number is treated as px. */
  radius?: number | string; density?: number | string;
  /** Escape hatch — any raw token, e.g. `"--tw-accent": "#6c8cff"`. */
  [token: string]: string | number | undefined;
}

/** Panel options (third arg to `tweaks()`). */
export interface TweaksOptions {
  /** Theme overrides (friendly names or raw `--tw-*`); `null` / omitted = default monochrome. */
  theme?: Theme | null;
  /** Persist values to localStorage + enable presets — a key, or `true` to key by name. */
  persist?: string | boolean;
  /** Add a filter/search field to the toolbar. */
  filter?: boolean;
  /** Start the panel already floated (fixed-positioned): `true` → top-left, or an explicit `{x,y}`. */
  floating?: boolean | { x: number; y: number };
  /** Drag the header to reposition the panel — on by default. An inline panel lifts into a
   *  floating layer on first drag; set `false` to pin it in place. */
  draggable?: boolean;
  /** Set `false` for a bare panel (no copy/reset/presets toolbar). */
  toolbar?: boolean;
  /** Enable debounced undo/redo (⌘Z / ⇧⌘Z while the panel is hovered/focused). */
  undo?: boolean;
  /** Custom reset handler (e.g. restore real app defaults + rebuild). */
  onReset?: () => void;
  /** Fired when a drag/scrub on any control begins. */
  onEditStart?: () => void;
  /** Fired when a drag/scrub ends. */
  onEditEnd?: () => void;
}

/** The live values bag — `params[key]` for each control; `_last` is the last-changed key. */
export type Params = Record<string, any> & { _last?: string };

/** The panel object `tweaks()` returns. */
export interface Panel {
  /** The panel root element — append it to the DOM. */
  el: HTMLElement;
  /** Live values, updated in place as controls change. */
  params: Params;
  /** Resolves once any lazily-loaded controls have hydrated (resolves immediately when none). */
  ready: Promise<Panel>;
  /** Subscribe to changes; returns an unsubscribe fn. */
  on(fn: (params: Params, last?: string) => void): () => void;
  /** Set a control's value programmatically. Nested controls take a dotted path
   *  ("folder.child", "tabs.page.child"); a bare key also reaches a nested control
   *  when it's unambiguous. A key matching no control is stored on `params` as-is. */
  set(key: string, value: unknown): void;
  /** Reset every control to its default (or run `opts.onReset`). */
  reset(): void;
  /** Re-theme the panel live; `null` reverts to the default. */
  setTheme(theme?: Theme | null): void;
  /** Save the current values as a named preset (needs `opts.persist`). */
  savePreset(name: string): boolean;
  /** Load a named preset. */
  loadPreset(name: string): boolean;
  /** Delete a named preset. */
  deletePreset(name: string): void;
  /** List saved preset names. */
  presets(): string[];
  /** Undo / redo (need `opts.undo`). */
  undo(): void;
  redo(): void;
  /** Tear the panel down — remove it from the DOM, release every global listener, close any open popover; the API goes inert. */
  destroy(): void;
}

/** A built control's handle (internal-ish, but used across modules). */
export interface Control {
  el: HTMLElement;
  set(value: unknown): void;
  get(): unknown;
}
