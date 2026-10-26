/* Public types for the Tweakit API — the schema you hand to tweaks() and the
 * panel you get back. These are what ship as .d.ts, so consumers get autocomplete on
 * the schema shorthands + the verbose control forms + the panel methods. */

/** An option for a select / radio grid: a bare string or number, or `{ value, label }`; the param is the value as written. */
export type Option = string | number | { value: string | number; label?: string; color?: string }; // color: any CSS color, shown as a swatch beside a dropdown option (and the chosen one on the row)

/** A color stop in a gradient. */
export type GradientStop = { color: string; pos: number };

/** The CSS `<color-interpolation-method>` a gradient blends through — the space of the
 *  mode the stops were authored in. Template it as `linear-gradient(in <interpolation> …)`
 *  so your CSS ramp matches the editor's preview exactly. */
export type GradientInterpolation = "srgb" | "hsl" | "hwb" | "oklch" | "oklab" | "lch" | "lab" | "display-p3" | "rec2020";

/** What a sides control accepts: one number for all four; `[vertical, horizontal]`,
 *  `[top, horizontal, bottom]` or `[top, right, bottom, left]` (CSS order); a CSS shorthand
 *  string like `"1rem 2rem"` (its unit becomes the control's when `unit` isn't given; mixed
 *  units warn and read as px); or any subset of
 *  the four as an object. With `corners: true` the four are the corners from top-left round,
 *  the same CSS order, under the same keys, and they floor at 0 unless `min` says otherwise. */
export type SidesInput = number | readonly number[] | string | { top?: number; right?: number; bottom?: number; left?: number };
/** A sides control's value: the four numbers in CSS order plus the shorthand they collapse
 *  to (`css`, in the control's unit, `0` bare), so `el.style.padding = css`. */
export interface SidesValue { top: number; right: number; bottom: number; left: number; css: string }

/** What a shadow control accepts — any subset of its fields (px, `color` any color the kit
 *  parses); or, as `value`, a `box-shadow` string: optional `inset`, two to four px lengths,
 *  one color, one layer. */
export interface ShadowInput { inset?: boolean; x?: number; y?: number; blur?: number; spread?: number; color?: string }
/** A shadow control's value — the fields, plus the `box-shadow` CSS they resolve to (`css`),
 *  built from the numbers and the picker's own color notation, so `el.style.boxShadow = css`. */
export interface ShadowValue { inset: boolean; x: number; y: number; blur: number; spread: number; color: string; css: string }
/** What a motion control accepts — any subset of either mode's fields. A `curve` may be
 *  the four cubic-bezier numbers or a CSS keyword (`ease`, `ease-out`, …); `duration` is
 *  the easing's, in ms. Spring keys select the spring mode unless `mode` says otherwise. */
export interface MotionInput { mode?: "easing" | "spring"; curve?: readonly [number, number, number, number] | string; duration?: number; stiffness?: number; damping?: number; mass?: number; visualDuration?: number; bounce?: number }
/** A motion control's value: an easing curve with its duration, or a spring — each also
 *  carrying the CSS it resolves to, `duration` in ms and an `easing` string (`cubic-bezier(…)`,
 *  or a sampled `linear(…)` for the spring), so a host can write
 *  `transition: transform ${duration}ms ${easing}` in either mode. */
export type MotionValue =
  | { mode: "easing"; curve: [number, number, number, number]; duration: number; easing: string }
  | { mode: "spring"; stiffness: number; damping: number; mass: number; visualDuration?: number; bounce?: number; duration: number; easing: string };

/** How a gradient blends between neighboring stops: `"linear"` (CSS's own straight blend,
 *  the default) or a CSS easing — `ease`, `ease-in`, `ease-out`, `ease-in-out`, or any
 *  `cubic-bezier(x1, y1, x2, y2)`. No browser eases a gradient natively, so `gradientCss()`
 *  samples the curve into stops; template through it rather than by hand. */
export type GradientEasing = "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out" | `cubic-bezier(${string})`;

/** A gradient control's value — the stops, the blend space, and the easing between stops.
 *  Hand it to `gradientCss(value, angle?)` for the CSS, or `gradientStops(value)` for just
 *  the stop list (a conic / radial gradient). */
export interface GradientValue { stops: GradientStop[]; interpolation?: GradientInterpolation; easing?: GradientEasing }

/** Reader passed to a conditional `render` / `disabled` predicate — `get("siblingKey")`. */
export type Get = (key: string) => unknown;

/** Per-control extras that can ride on any object-form value. */
export interface ControlOptions {
  /** The label shown for this control, in place of the title-cased key; `""` shows no label.
   *  Honored by every verbose `{ type }` form (in a plain folder object, `label` is a child). */
  label?: string;
  /** Show/hide this control based on other values. */
  render?: (get: Get) => boolean;
  /** Gray-out + lock this control (static, or derived from other values). */
  disabled?: boolean | ((get: Get) => boolean);
  /** A tooltip revealed by an ⓘ marker beside the label. */
  hint?: string;
  /** `false` leaves this control out of what `opts.persist` saves, so it opens on its schema
   *  value every load (presets, undo and `toJSON()` still carry it). On a control, not a
   *  plain folder object, where `persist` is a child. */
  persist?: boolean;
}

/** The verbose object forms a schema value can take: `{ type: "…", … }`. */
export type SchemaObject =
  | { type: "slider"; value?: number; min?: number; max?: number; step?: number; soft?: boolean; unit?: string;
      /** Draws the readout from the value ("7:30 AM" for minutes of the day), in place of its
       *  digits; `unit` still follows it. Display only, like `unit`: the param stays the number. */
      format?: (value: number) => string;
      /** Reads a typed readout back into a value, so the inline editor shows and takes the
       *  formatted text (without one, it edits the digits). Text it can't read (it throws, or
       *  returns anything but a finite number) leaves the value where it was. */
      parse?: (text: string) => number }
  | { type: "number"; value?: number; min?: number; max?: number; step?: number; soft?: boolean; unit?: string }
  | { type: "checkbox"; value?: boolean }
  | { type: "list"; options: readonly Option[]; value?: string | number }
  | { type: "radiogrid" | "segmented"; options: readonly Option[]; value?: string | number; cols?: number }
  | { type: "color"; value?: string }
  | { type: "text"; value?: string; rows?: number; placeholder?: string }
  | { type: "interval"; value?: readonly [number, number]; min?: number; max?: number; step?: number }
  | { type: "spring"; mode?: "time" | "physics"; visualDuration?: number; bounce?: number; stiffness?: number; damping?: number; mass?: number; value?: { mode?: "time" | "physics"; visualDuration?: number; bounce?: number; stiffness?: number; damping?: number; mass?: number } }
  | { type: "cubicbezier"; value?: readonly [number, number, number, number] }
  | ({ type: "shadow"; value?: ShadowInput | string } & ShadowInput)
  | { type: "sides"; value?: SidesInput; corners?: boolean; unit?: string; step?: number; min?: number; max?: number; top?: number; right?: number; bottom?: number; left?: number }
  | ({ type: "motion"; value?: MotionInput } & MotionInput)
  | { type: "point"; components: ReadonlyArray<{ key: string; label?: string; value?: number; min?: number; max?: number; step?: number }>; value?: { readonly [key: string]: number }; pad?: boolean; invertY?: boolean }
  | { type: "point"; value: { readonly [key: string]: number }; components?: undefined; pad?: boolean; invertY?: boolean } // the value names its components
  | { type: "gradient"; value?: GradientValue | ReadonlyArray<GradientStop | readonly [string, number]>; stops?: ReadonlyArray<GradientStop | readonly [string, number]> }
  | { type: "plot"; expr?: string; fn?: (x: number) => number; xMin?: number; xMax?: number; yMin?: number; yMax?: number; samples?: number; editable?: boolean; min?: number; max?: number }
  | { type: "fpsgraph" }
  | { type: "monitor"; get?: () => number | string; value?: number | string; graph?: boolean; view?: "graph" | "text"; min?: number; max?: number; interval?: number; rows?: number; decimals?: number }
  | { type: "image"; value?: string;
      /** Supplied images to pick from, as URLs or `{ value, label }`. The control becomes a row naming the chosen
       *  image that opens a pane of tiles with the upload below them, and the param is the chosen URL or the upload's data URL. */
      options?: ReadonlyArray<string | { value: string; label?: string }>;
      /** Tiles per row in the gallery, 1 to 6 (by default one per option for two or three, 2 for one or four, then 3). */
      cols?: number;
      /** The largest upload taken, in bytes (10 MB unless set); a bigger file is refused with a note. */
      maxSize?: number;
      /** An upload longer than this on its long side, in px, is drawn down to it before it becomes the param, and one
       *  heavier than 1.5 MB is redrawn at its size, so a phone photo can't fill storage (2560 unless set; `false` takes
       *  uploads as they are). A JPEG comes out as a JPEG at
       *  `quality`; anything else as a PNG when that is 1.5 MB or less (a screenshot, not a photo), else as a JPEG, or a WebP
       *  when it has transparency. A GIF, an SVG, an animated WebP or APNG, a light picture within `fit`, or one the redraw wouldn't make smaller is kept as it is. */
      fit?: number | false;
      /** The JPEG or WebP quality of a shrunk upload, 0 to 1 (0.85 unless set). */
      quality?: number;
      /** `false` leaves the upload button out of a gallery: the options are the whole choice. */
      upload?: boolean;
      /** `false` leaves Clear out of a gallery, and Delete no longer empties it: for a choice that must keep a value. */
      clear?: boolean }
  | { type: "button"; action: () => void; label?: string }
  | { type: "buttongroup"; buttons: Record<string, () => void> | ReadonlyArray<{ label: string; action: () => void }> }
  | { type: "separator" }
  | { type: "tabs"; pages: { readonly [title: string]: Schema } };

/** A schema value — a shorthand, a verbose `{ type }` object, or a nested folder. */
export type SchemaValue =
  | number                                          // bare number → slider (0–1 for a value ≤ 1, else 0–3×value; a negative spans that either side of zero)
  | boolean                                         // → checkbox
  | string                                          // → text input; a hex or color-function string → color picker
  | readonly [number] | readonly [number, number] | readonly [number, number, number] | readonly [number, number, number, number] // [value, min?, max?, step?] → slider
  | readonly [readonly [number, number], number, number] | readonly [readonly [number, number], number, number, number]           // [[lo,hi], min, max, step?] → interval
  | readonly number[] | readonly (number | readonly number[])[] // either of the above, widened by a schema held in a variable
  | readonly Option[]                               // a list of options → list (dropdown)
  | { options: readonly Option[]; value?: string | number }  // a list with a chosen default
  | { action: () => void; label?: string }          // → button
  | (SchemaObject & ControlOptions)                 // verbose form (+ render/disabled/hint)
  | Schema                                          // nested object → folder
  | SchemaFolder;                                   // a nested folder with its own render / disabled predicate

/** The object you hand to `tweaks(name, schema, opts?)`. No value is a function, so a verbose
 *  form's callbacks (`format`, `fn`) take their parameter types from that form alone. */
export interface Schema { readonly [key: string]: SchemaValue; }
/** A nested folder that carries its own `render` / `disabled` predicate or `hint`: chrome, not
 *  children. Its index admits the predicate, so it gives up a child named `type`: that sets it
 *  apart from a verbose form, whose callbacks would otherwise be typed against the predicate too. */
export interface SchemaFolder {
  readonly type?: undefined;
  readonly render?: (get: Get) => boolean;
  readonly disabled?: boolean | ((get: Get) => boolean);
  readonly hint?: string;
  readonly [key: string]: SchemaValue | ((get: Get) => boolean) | undefined;
}

// ── Params inferred from a schema ──
// tweaks() takes its schema as a const type parameter, so each value keeps its literal shape and
// these types read the control it builds the way schema.ts does, in the same order.

/** A spring control's value: the physics, plus the time pair and mode when tuned by feel. */
export interface SpringValue { stiffness: number; damping: number; mass: number; visualDuration?: number; bounce?: number; mode?: "time" | "physics" }

type OptionValue<O> = O extends string | number ? O : O extends { readonly value: infer V extends string | number } ? V : never;
// A list's param: one of its options, or a `value` off the list, which the control keeps as given until a pick.
type ChoiceValue<V> = (V extends { readonly options: readonly (infer O)[] } ? OptionValue<O> : never) | (V extends { readonly value: infer D extends string | number } ? D : never);
type Alnum = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type Dashed<S extends string, Acc extends string = "", Run = false> =
  S extends `${infer C}${infer R}` ? C extends Alnum ? Dashed<R, `${Acc}${C}`, false> : Run extends true ? Dashed<R, Acc, true> : Dashed<R, `${Acc}-`, true> : Acc;
type TrimDash<S extends string> = S extends `-${infer R}` ? TrimDash<R> : S extends `${infer R}-` ? TrimDash<R> : S;
/** A tab title's key under `params`: lower-case, each run of other characters a `-`, trimmed
 *  (`"Layout & Grid"` → `"layout-grid"`). Two titles that slug alike are told apart at runtime only. */
export type TabKey<T extends string> = string extends T ? string : TrimDash<Dashed<Lowercase<T>>> extends infer K extends string ? (K extends "" ? "tab" : K) : never;
// True when two page titles slug to one key: the runtime suffixes the later one (`a`, `a-2`) in an
// order a type can't follow, so those pages read as the loose Params rather than merge into one.
type TabClash<P> = true extends { [T in keyof P & string]: TabKey<T> extends { [U in Exclude<keyof P & string, T>]: TabKey<U> }[Exclude<keyof P & string, T>] ? true : false }[keyof P & string] ? true : false;

type Valueless = "button" | "buttongroup" | "separator" | "fpsgraph" | "monitor";
// The field each falsy-capable form hinges on (schema.ts REQUIRED): without it the object isn't
// that control but a shorthand or a folder holding a child named `type`.
type Hinge = { list: "options"; radiogrid: "options"; segmented: "options"; point: "components" | "value"; tabs: "pages" };
// A hinge field there but unusable skips the control at runtime, so it puts nothing on params.
type TypedValue<V> =
  V extends { readonly type: "slider" | "number" } ? number
  : V extends { readonly type: "checkbox" } ? boolean
  : V extends { readonly type: "list" | "radiogrid" | "segmented" } ? (V extends { readonly options: readonly unknown[] } ? ChoiceValue<V> : never)
  : V extends { readonly type: "color" | "text" | "image" | "plot" } ? string
  : V extends { readonly type: "interval" } ? [number, number]
  : V extends { readonly type: "cubicbezier" } ? [number, number, number, number]
  : V extends { readonly type: "spring" } ? SpringValue
  : V extends { readonly type: "motion" } ? MotionValue
  : V extends { readonly type: "shadow" } ? ShadowValue
  : V extends { readonly type: "sides" } ? SidesValue
  : V extends { readonly type: "gradient" } ? GradientValue
  : V extends { readonly type: "point" } ? (V extends { readonly components: readonly [] } ? never : V extends { readonly components: readonly (infer C)[] } ? { [K in C extends { readonly key: infer Key extends string } ? Key : never]: number }
    : V extends { readonly value: infer P extends object } ? (keyof P extends never ? never : { -readonly [K in keyof P & string]: number }) : never)
  : V extends { readonly type: "tabs" } ? (V extends { readonly pages: infer P extends object } ? (keyof P extends never ? never : TabClash<P> extends true ? Record<string, Params> : { [T in keyof P & string as TabKey<T>]: ParamsOf<P[T]> }) : never)
  : unknown;
/** The value a schema entry puts on `params`. */
export type ValueOf<V> =
  V extends { readonly type: infer T } ? (
    string extends T ? any                                   // a `type` widened by a schema held in a variable: the control can't be known
    : T extends SchemaObject["type"] ? (T extends keyof Hinge ? ([Extract<Hinge[T], keyof V>] extends [never] ? ShorthandValue<V> : VerboseValue<V, T>) : VerboseValue<V, T>)
    : ShorthandValue<V>)
  : ShorthandValue<V>;
type VerboseValue<V, T> = T extends Valueless ? never : TypedValue<V>;
type ShorthandValue<V> =
  V extends readonly [readonly [number, number], ...unknown[]] ? [number, number]
  : V extends readonly [number] | readonly [number, number] | readonly [number, number, number] | readonly [number, number, number, number] ? number
  : V extends readonly [number, ...number[]] ? V[number]     // five numbers or more are a list of them
  : V extends readonly [] ? undefined                        // an empty list, with no choice to hold
  : V extends readonly number[] ? number                     // a tuple widened by a schema held in a variable: a slider, or a list of numbers
  : V extends readonly (number | readonly number[])[] ? [number, number]
  : V extends number ? number
  : V extends boolean ? boolean
  : V extends string ? string
  : V extends readonly (infer O)[] ? OptionValue<O>
  : V extends { readonly action: (...a: any[]) => any } ? never
  : V extends { readonly options: readonly unknown[] } ? ChoiceValue<V>
  : V extends object ? Entries<V, true>
  : unknown;
// Keys the runtime skips at every level, since they would write through to Object.prototype.
type Reserved = "__proto__" | "constructor" | "prototype";
// A nested folder's render / disabled / hint are its chrome, not children; at the root and on a
// tab page they are controls like any other key.
type FolderChrome<V, K> = K extends "disabled" | "hint" ? true : K extends "render" ? (V extends (...a: any[]) => any ? true : false) : false;
type Entries<S, Nested extends boolean> = string extends keyof S ? Params
  : { -readonly [K in keyof S & string as K extends Reserved ? never : ValueOf<S[K]> extends never ? never : Nested extends true ? (FolderChrome<S[K], K> extends true ? never : K) : K]: ValueOf<S[K]> };
/** The live values a schema builds, nested like the schema; a plain `Schema` gives the loose `Params`. */
export type ParamsOf<S> = Entries<S, false>;

// ── Type names checked at the call ──
// Schema's folder branch takes any object, so `{ type: "slidr", value: 1 }` fit it and compiled. tweaks() and mountControl()
// intersect their argument with these, which keep a known name, a widened `string` (a schema held in a variable: the
// runtime decides), and every shorthand as they are, and turn an unknown name into the list of known ones, so it fails
// right where it's written. A known name without its hinge field is a folder at runtime and isn't checked further.
type CheckValue<V> =
  V extends { readonly type: infer T } ? (string extends T ? V : T extends SchemaObject["type"] ? (V extends { readonly type: "tabs"; readonly pages: infer P } ? { readonly pages: { [K in keyof P]: KnownTypes<P[K]> } } : unknown) : { readonly type: NotAControlType })
  : V extends readonly unknown[] | ((...a: any[]) => any) ? unknown
  : V extends object ? KnownTypes<V>
  : unknown;
// A brand, not the list of names: a literal intersected with the list collapses the whole entry to `never`, and the error
// read "not assignable to type 'never'" on every key. The brand keeps the entry and puts its text in the error.
type NotAControlType = { readonly "names no control: see the type list in AGENTS.md": true };
/** A schema whose every `type` names a control (`tweaks()` checks it; `{ type: "slidr" }` is an error). */
export type KnownTypes<S> = { [K in keyof S]: CheckValue<S[K]> };
/** One schema value whose `type` names a control (`mountControl()` checks it). */
export type KnownType<V> = CheckValue<V>;

/** A theme — token overrides applied over the default monochrome look. Every key is
 *  optional, so a partial theme only moves what it names; unset tokens keep their default.
 *  Keys are the `--tw-*` custom properties themselves. Apply at build via
 *  `tweaks(name, schema, { theme })`, or live via `panel.setTheme(theme)`. The kit's whole
 *  appearance runs on these custom properties — this is the public theming surface. */
export interface Theme {
  /** Brand accent — slider fills, focus rings, active highlights (default: neutral, no accent). */
  "--tw-accent"?: string;
  /** Text drawn on the accent (active segment / radio label); the primary text tone unless set, so set it with a light accent. */
  "--tw-on-accent"?: string;
  /** Panel background, reused for recessed wells. */
  "--tw-base"?: string;
  /** Popover / dropdown background. */
  "--tw-dropdown-bg"?: string;
  /** Control surface and its hover / active steps. */
  "--tw-surface"?: string; "--tw-surface-hover"?: string; "--tw-surface-active"?: string;
  /** Hairline border and its hover step. */
  "--tw-border"?: string; "--tw-border-hover"?: string;
  /** Text-selection highlight wash. */
  "--tw-selection"?: string;
  /** Text tones — panel title, section heading, primary value text, control label, and the muted / faint / focus tones. */
  "--tw-text-root"?: string; "--tw-text-section"?: string; "--tw-text-primary"?: string; "--tw-text-label"?: string;
  "--tw-text-secondary"?: string; "--tw-text-tertiary"?: string; "--tw-text-focus"?: string;
  /** Copy-confirmation accent, and the invalid-state accent (the plot's bad-expression cue). */
  "--tw-success"?: string; "--tw-danger"?: string;
  /** Popover shadow, the panel's container elevation, and its lifted (floating / dragging) variant. */
  "--tw-shadow-dropdown"?: string; "--tw-shadow-panel"?: string; "--tw-shadow-panel-lifted"?: string;
  /** Font stack, and the monospace stack (the plot's expression field). */
  "--tw-font-sans"?: string; "--tw-font-mono"?: string;
  /** Control corner radius, row height and the panel's width (256px by default), as CSS lengths. */
  "--tw-radius"?: string; "--tw-row-height"?: string; "--tw-width"?: string;
  /** Any other token. */
  [token: `--${string}`]: string | undefined;
}

/** Options for a programmatic write — `set()`, `setMany()`, `fromJSON()`. */
export interface SetOptions {
  /** Apply without calling your `on()` listeners: for mirroring a value the host already
   *  acted on (another tab, its own state), so the change doesn't echo back. Conditional
   *  controls, persistence and undo still follow it: it's an undo step like any other. */
  silent?: boolean;
}

/** Where a floating panel starts: `x` / `y` are its insets in px (16 by default) from the
 *  viewport's top-left. The far edge keeps a gap of `y` when the height caps; CSS
 *  `--tw-float-gap` overrides it. */
export interface FloatingPlacement { x?: number; y?: number }

/** Panel options (third arg to `tweaks()`). */
export interface TweaksOptions {
  /** Theme overrides as `--tw-*` tokens; `null` / omitted = default monochrome. */
  theme?: Theme | null;
  /** Persist values to localStorage + enable presets — a key, or `true` to key by name. Uploaded images go to
   *  IndexedDB under the same key, and come back by `ready`. */
  persist?: string | boolean;
  /** With `persist`, `false` keeps saving values but leaves the Presets menu out of the
   *  toolbar (the presets API still works). On by default. */
  presets?: boolean;
  /** Start the panel already floated (fixed-positioned): `true` → 16px from the top-left, or a
   *  placement `{ x, y }`. Its height caps at the window and it scrolls, header and all. */
  floating?: boolean | FloatingPlacement;
  /** Drag the header to reposition the panel — on by default. An inline panel lifts into a
   *  floating layer on first drag; set `false` to pin it in place. */
  draggable?: boolean;
  /** Set `false` for a bare panel (no copy/reset/presets toolbar). */
  toolbar?: boolean;
  /** Enable debounced undo/redo (⌘Z / ⇧⌘Z while the panel is hovered/focused). */
  undo?: boolean;
  /** Custom reset handler (e.g. restore real app defaults + rebuild). */
  onReset?: () => void;
}

/** The live values bag, loosely typed — `params[key]` for each control. A schema literal passed
 *  to `tweaks()` gets its exact shape instead (`ParamsOf`). */
export type Params = Record<string, any>;
/** The keys `set()` and `setMany()` take: a typed panel's controls by dotted path (`size`, `card.size`), so a typo is a
 *  compile error; any string for a panel built from a plain `Schema`. An object-valued control's own fields read as
 *  paths too (`drop.blur`): the types can't tell its value from a folder, so they allow what the runtime refuses. */
export type PanelPath<P> = string extends keyof P ? string
  : { [K in keyof P & string]: K | (P[K] extends readonly unknown[] ? never : P[K] extends object ? `${K}.${PanelPath<P[K]>}` : never) }[keyof P & string];

/** The whole-panel state `toJSON()` returns / `fromJSON()` accepts: every control value
 *  (nested to mirror folders/tabs) plus UI state — which folders are collapsed and which
 *  tab is active. JSON-safe; persist it however you like. Both `values` and `ui` are
 *  optional on the way in, so `fromJSON({ values })` restores values only and
 *  `fromJSON({ ui })` restores chrome only. (Panel collapse + floating position are not
 *  captured — position has its own `opts.persist` channel.) */
export interface PanelState {
  /** Every control value, **nested** to mirror folders/tabs (e.g. `{ shadow: { radius: 16 } }`)
   *  — not the dotted form `set()`/`setMany()` take. `fromJSON` matches by that nested path and
   *  skips keys with no matching control. Normally you pass back what `toJSON()` produced. */
  values?: Record<string, any>;
  ui?: {
    /** Folder collapse state → `true` when collapsed. Keys are the folder's path with each
     *  segment JSON-pointer-escaped (`.`→`~0`, `~`→`~1`) then joined by `.` — injective, so a
     *  literal dot in a key can't collide with the nesting separator. For plain keys that's
     *  the dotted path, so `fromJSON({ ui: { folders: { shadow: true } } })` starts one closed. */
    folders?: Record<string, boolean>;
    /** Active tab → the active page's key, under the tabs control's path (escaped as above). */
    tabs?: Record<string, string | null>;
  };
}

/** The panel object `tweaks()` returns; `P` is its values' shape. A bare `Panel` takes any panel, typed or not (its
 *  default is `any`, not `Params`: `set()`'s typed paths would make a typed panel unassignable to `Panel<Params>`). */
export interface Panel<P = any> {
  /** The panel root element — append it to the DOM. */
  el: HTMLElement;
  /** Live values, updated in place as controls change. */
  params: P;
  /** Resolves once any lazily-loaded controls have hydrated and, for a panel that persists an image control, its
   *  stored images have loaded (resolves immediately when there's neither). */
  ready: Promise<Panel<P>>;
  /** Subscribe to changes; `last` is the changed control's dotted path (`size`, `card.size`), as `set()` and `changes()`
   *  name it, or undefined when many changed at once (a restore, `reset()`, `fromJSON`, `setMany`). */
  on(fn: (params: P, last?: string) => void): () => void;
  /** Set a control's value programmatically. Nested controls take a dotted path
   *  ("folder.child", "tabs.page.child"); at runtime a bare key also reaches a nested control
   *  when it's unambiguous, though a typed panel's types take the full path. A key matching
   *  no control, or a folder or tab, is refused with a console warning. */
  set(key: PanelPath<P>, value: unknown, options?: SetOptions): void;
  /** Set several controls at once — a flat map of keys (dotted for nested controls), e.g.
   *  `setMany({ "shadow.radius": 28, blur: 48 })`. Resolves each key like `set()`, then fires
   *  listeners + persists ONCE for the whole batch, where N separate `set()` calls would fire
   *  N times. Unknown / ambiguous / reserved keys warn and are skipped. */
  setMany(values: { readonly [K in PanelPath<P>]?: unknown }, options?: SetOptions): void;
  /** Reset every control to its default (or run `opts.onReset`). */
  reset(): void;
  /** Serialize the whole panel — every control value plus UI state (collapsed folders,
   *  active tabs) — to a plain JSON-safe object, independent of localStorage/presets. Hand
   *  it to your own storage: a file, a query string / share link, a server. `JSON.stringify`
   *  on the panel calls this too. Most meaningful once `ready` (lazy controls have built). */
  toJSON(): PanelState;
  /** The values that differ from their defaults, keyed by dotted path — `setMany()`'s shape
   *  (`{ "shadow.radius": 28, blur: 48 }`), the hand-off for baking tuned values into source.
   *  ⇧-click on the toolbar's copy button copies this instead of the full snapshot. Empty
   *  before `ready`. */
  changes(): Record<string, unknown>;
  /** Restore a panel from a `toJSON()` object: values are applied where their path still
   *  exists (missing ones skipped, like loading a preset), then folder/tab UI state. Fires
   *  listeners once. Both halves are optional — pass `{ values }` to restore values only, or
   *  `{ ui }` to restore chrome only. The value restore is undoable (one history step); the
   *  UI restore is intentionally outside undo, so a Cmd-Z reverts values without thrashing
   *  folders/tabs. */
  fromJSON(state: PanelState, options?: SetOptions): void;
  /** Re-theme the panel live; `null` reverts to the default. */
  setTheme(theme?: Theme | null): void;
  /** Retitle the panel live — the header follows. The name it was built
   *  with stays its storage key (`persist: true`), so saved values and presets keep their
   *  home across a rename. */
  setName(name: string): void;
  /** Save the current values as a named preset (needs `opts.persist`). False when there is nowhere to save it, or storage refused it. */
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
  /** Release any loop the control owns (the monitor's poll, the FPS graph's rAF). Only
   *  the live controls supply it; the panel calls it from `destroy()`. */
  destroy?(): void;
  /** Show a short message on the control for a moment. Only the image control supplies it; the panel calls it when
   *  storage refuses the control's value. */
  note?(message: string): void;
  /** The hard range set() fits a number into, as the control resolved it (derived bounds too); a point's per component.
   *  Only the numeric controls supply it; the panel's clamp notice reads it. */
  range?: [number, number] | Record<string, [number, number]>;
}

/** Options for `mountControl(host, value, opts?)` — one control, no panel. */
export interface MountOptions {
  /** The key passed to `onChange` and used to derive the label when none is given (default `"value"`). */
  key?: string;
  /** The label shown on the control; `""` shows none (the host page already has one). Wins over
   *  the title-cased key and over a verbose form's own `label`. */
  label?: string;
  /** Fired with the new value whenever the control changes — by hand or through `set()`. */
  onChange?: (value: unknown, key: string) => void;
}

/** The handle `mountControl()` returns. */
export interface MountedControl {
  /** The wrapper (`.tw-control`) the control lives in, already appended to the host and
   *  stable from creation — it carries the kit's tokens, so the control renders outside a
   *  panel. On the code-split build a lazily-loaded control fills it in once `ready` resolves. */
  el: HTMLElement;
  /** Apply a value — the control updates AND `onChange` fires (when the value actually
   *  changed). Before `ready`, the value is queued and applied once the control builds. */
  set(value: unknown): void;
  /** The current value (the queued or schema value before `ready`; `undefined` for a
   *  valueless control such as a button). */
  get(): unknown;
  /** Remove the control from the host and release anything it owns. */
  destroy(): void;
  /** Resolves with this handle once the control has built — immediately on the single-file build. */
  ready: Promise<MountedControl>;
}

/** The notations the color picker edits in (its mode dropdown). The emitted value follows
 *  the mode: `hex` gives `#RRGGBB`, the wide-gamut modes give a CSS color like `oklch(…)`. */
export type ColorMode = "hex" | "srgb" | "css" | "hsl" | "hwb" | "oklch" | "oklab" | "lch" | "lab" | "p3" | "rec2020";

/** Options for `createColorPicker(opts?)` — the picker body alone, no trigger row. */
export interface ColorPickerOptions {
  /** The color it opens on — any CSS color string (default `#7c5cff`). */
  value?: string;
  /** The notation it opens in (default `oklch`). */
  mode?: ColorMode;
  /** Fired with the new color string whenever it changes — by hand or through `set()`. */
  onChange?: (value: string) => void;
}

/** The handle `createColorPicker()` returns. Bring your own trigger: append `el` to a popover
 *  or a panel of your own; the kit owns the editor surface and the gamut math. */
export interface ColorPicker {
  /** The picker's root (`.tw-color-picker`), stable from creation; it carries the kit's tokens,
   *  so the picker renders anywhere. On the code-split build the editor fills it in once the
   *  color chunk has loaded. */
  el: HTMLElement;
  /** Apply a color — the picker updates AND `onChange` fires (when the color actually changed). */
  set(value: string): void;
  /** The current color, serialized in the picker's mode. */
  get(): string;
  /** The current notation. */
  mode(): ColorMode;
  /** Switch notation — formatting only, nothing fires. */
  setMode(mode: ColorMode): void;
  /** Re-rasterize and re-place the thumbs. It reflows itself a frame after creation; call
   *  this when you show it later (a popover opening) or after it resizes. */
  reflow(): void;
  /** Remove the picker from the DOM. */
  destroy(): void;
  /** Resolves with this handle once the editor has built — immediately on the single-file build. */
  ready: Promise<ColorPicker>;
}

/** `detail` of the `tw:change` event a `[data-tw]` host dispatches (bubbling) whenever its
 *  control changes — `key` is the host's `data-key` (or its label), `value` the new value,
 *  also written to the host's `data-value`. */
export interface TwChangeDetail { key: string; value: unknown; }

declare global {
  interface HTMLElementEventMap { "tw:change": CustomEvent<TwChangeDetail>; }
}
