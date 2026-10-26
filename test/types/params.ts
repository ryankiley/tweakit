// Type-level checks for params inferred from a schema. test/types.test.mjs runs tsc over this
// file against the built declarations: each @ts-expect-error must be an error, the rest must pass.
import { tweaks, mountControl, type Schema, type Params, type ShadowValue } from "../../dist/types/tweaks/core.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expect = <T extends true>() => {};

const p = tweaks("Card", {
  radius: [18, 0, 60, 1],
  scale: 0.5,
  visible: true,
  title: "Hello",
  tint: "#7C5CFF",
  blend: ["normal", "multiply"],
  fit: { options: ["cover", { value: "contain", label: "Contain" }], value: "cover" },
  range: [[20, 80], 0, 100],
  go: { action: () => {} },
  shadow: { blur: 24, inset: false, render: (get) => get("visible") === true },
  drop: { type: "shadow", blur: 12 },
  pad: { type: "sides", value: 8 },
  ease: { type: "motion", mode: "spring", stiffness: 300 },
  wobble: { type: "spring" },
  curve: { type: "cubicbezier", value: [0.2, 0, 0, 1] },
  back: { type: "bezier", value: [0.34, 1.56, 0.64, 1] },
  on: { type: "toggle", value: true },
  flag: { type: "switch" },
  ramp: { type: "gradient", stops: [["#000", 0], ["#fff", 1]] },
  at: { type: "point", components: [{ key: "x" }, { key: "y", value: 4 }] },
  mode: { type: "segmented", options: ["a", "b"] },
  count: { type: "number", value: 3, label: "Count" },
  photo: { type: "image" },
  f: { type: "plot", expr: "sin(x)" },
  fps: { type: "fpsgraph" },
  line: { type: "separator" },
  view: { type: "tabs", pages: { "Layout & Grid": { gap: 8 }, Type: { size: [14, 8, 32] } } },
});

expect<Equal<typeof p.params.radius, number>>();
expect<Equal<typeof p.params.scale, number>>();
expect<Equal<typeof p.params.visible, boolean>>();
expect<Equal<typeof p.params.title, string>>();
expect<Equal<typeof p.params.tint, string>>();
expect<Equal<typeof p.params.blend, "normal" | "multiply">>();
expect<Equal<typeof p.params.fit, "cover" | "contain">>();
expect<Equal<typeof p.params.range, [number, number]>>();
expect<Equal<typeof p.params.shadow, { blur: number; inset: boolean }>>();
expect<Equal<typeof p.params.drop.css, string>>();
expect<Equal<typeof p.params.pad.css, string>>();
expect<Equal<typeof p.params.ease.easing, string>>();
expect<Equal<typeof p.params.wobble.stiffness, number>>();
expect<Equal<typeof p.params.curve, [number, number, number, number]>>();
expect<Equal<typeof p.params.back, [number, number, number, number]>>();
expect<Equal<typeof p.params.on, boolean>>();
expect<Equal<typeof p.params.flag, boolean>>();
expect<Equal<typeof p.params.ramp.stops[number]["pos"], number>>();
expect<Equal<typeof p.params.at, { x: number; y: number }>>();
expect<Equal<typeof p.params.mode, "a" | "b">>();
expect<Equal<typeof p.params.count, number>>();
expect<Equal<typeof p.params.photo, string>>();
expect<Equal<typeof p.params.f, string>>();
expect<Equal<typeof p.params.view, { "layout-grid": { gap: number }; type: { size: number } }>>();

// @ts-expect-error a typo is caught
p.params.bulr;
// @ts-expect-error a button holds no value
p.params.go;
// @ts-expect-error nor does a graph
p.params.fps;
// @ts-expect-error nor a separator
p.params.line;
// @ts-expect-error a folder's render predicate is its chrome, not a child
p.params.shadow.render;

p.on((v, last) => { expect<Equal<typeof v.radius, number>>(); expect<Equal<typeof last, string | undefined>>(); });
p.ready.then((q) => { expect<Equal<typeof q.params.blend, "normal" | "multiply">>(); });

// A schema held in a variable widens its tuples and strings, and still types its keys.
const held = { radius: [18, 0, 60, 1], range: [[20, 80], 0, 100], blend: ["normal", "multiply"], on: true };
const h = tweaks("Held", held);
expect<Equal<typeof h.params, { radius: number; range: [number, number]; blend: string; on: boolean }>>();

// `as const` and `satisfies Schema` both pass.
const frozen = { blend: ["a", "b"], size: [14, 8, 32], kind: { type: "radiogrid", options: ["x", "y"] } } as const;
const fz = tweaks("Frozen", frozen);
expect<Equal<typeof fz.params, { blend: "a" | "b"; size: number; kind: "x" | "y" }>>();
const checked = { gap: [8, 0, 32], mode: { type: "segmented", options: ["a", "b"] } } satisfies Schema;
const ck = tweaks("Checked", checked);
expect<Equal<typeof ck.params, { gap: number; mode: string }>>(); // satisfies widens the options; as const keeps them
const exact = { mode: { type: "segmented", options: ["a", "b"] } } as const satisfies Schema;
const ex = tweaks("Exact", exact);
expect<Equal<typeof ex.params, { mode: "a" | "b" }>>();

// A schema typed as the loose Schema keeps the loose Params.
const loose: Schema = { a: 1 };
const l = tweaks("Loose", loose);
expect<Equal<typeof l.params, Params>>();

// A verbose form's callbacks take their parameter types from the form (--strict: no implicit any),
// while a nested folder's own predicates still typecheck and stay off params.
const cb = tweaks("Callbacks", {
  s: { type: "slider", value: 1, format: (v) => v.toFixed(1), parse: (t) => Number(t) },
  f: { type: "plot", fn: (x) => Math.sin(x) },
  shadow: { blur: 24, render: (get) => get("s") === 1, disabled: (get) => get("s") === 0, hint: "Drop",
    inner: { type: "slider", format: (v) => `${v}px` } },
  locked: { a: 1, disabled: true },
});
expect<Equal<typeof cb.params, { s: number; f: string; shadow: { blur: number; inner: number }; locked: { a: number } }>>();
// @ts-expect-error a bare function is no control
mountControl(document.body, (get: (key: string) => unknown) => true);
// @ts-expect-error nor a root key: only a nested folder has a predicate of its own
tweaks("Root", { render: (get: (key: string) => unknown) => true });

// A held schema's verbose forms widen `type` to string, so their values can't be known: any, not a wrong shape.
const heldVerbose = { drop: { type: "shadow", blur: 12 }, size: { type: "slider", value: 5 }, n: 2 };
const hv = tweaks("HeldVerbose", heldVerbose);
expect<Equal<typeof hv.params.drop, any>>();
expect<Equal<typeof hv.params.size, any>>();
expect<Equal<typeof hv.params.n, number>>();
// @ts-expect-error the keys are still known
hv.params.sise;
const heldChecked = { drop: { type: "shadow", blur: 12 } } satisfies Schema;
const hc = tweaks("HeldChecked", heldChecked);
expect<Equal<typeof hc.params.drop, ShadowValue>>(); // satisfies keeps the verbose type

// hint / disabled / render are a nested folder's chrome only: at the root and on a tab page they are controls.
const rc = tweaks("Chrome", { hint: "hello", disabled: true, render: false, a: 1, tabs: { type: "tabs", pages: { One: { hint: "h", b: 2 } } } });
expect<Equal<typeof rc.params, { hint: string; disabled: boolean; render: boolean; a: number; tabs: { one: { hint: string; b: number } } }>>();

// Two titles that slug alike are told apart at runtime only (`a`, `a-2`): loose, not merged into one page.
const clash = tweaks("Clash", { v: { type: "tabs", pages: { "A!": { a: 1 }, "A?": { b: 2 } } } });
expect<Equal<typeof clash.params.v, Record<string, Params>>>();

// A `type` child without its control's hinge field is a folder, or the shorthand it otherwise reads as.
const hinge = tweaks("Hinge", { marker: { type: "point", size: 3 }, pick: { type: "point", options: ["a", "b"] }, bad: { type: "list", options: 5 } });
expect<Equal<typeof hinge.params, { marker: { type: string; size: number }; pick: "a" | "b" }>>();

// Five numbers or more are a list of them, `[]` an empty list, and reserved keys are skipped.
const lists = tweaks("Lists", { many: [1, 2, 3, 4, 5], four: [1, 2, 3, 4], none: [], constructor: 1, prototype: 2, ok: 3 });
expect<Equal<typeof lists.params, { many: 1 | 2 | 3 | 4 | 5; four: number; none: undefined; ok: number }>>();

// A typed panel's set() and setMany() take only its own paths; a plain Schema keeps string keys.
const paths = tweaks("Paths", { size: [1, 0, 10, 1], card: { size: [2, 0, 10, 1] } });
paths.set("size", 2); paths.set("card.size", 3); paths.setMany({ size: 1, "card.size": 2 });
// @ts-expect-error a key no control has
paths.set("nope", 5);
// @ts-expect-error nor in a batch
paths.setMany({ nope: 5 });
const plain: Schema = { a: 1 };
tweaks("Plain", plain).set("anything", 1);

// A type name no control has fails where it's written, at any depth; a known name, an alias, a widened `string` and a
// known name without its hinge field (a folder at runtime) all still compile.
// @ts-expect-error "slidr" names no control
tweaks("Typo", { a: { type: "slidr", value: 1 } });
// @ts-expect-error nor inside a folder
tweaks("Typo", { f: { inner: { type: "chekbox", value: true } } });
// @ts-expect-error nor on a tab page
tweaks("Typo", { t: { type: "tabs", pages: { One: { b: { type: "colr", value: "#fff" } } } } });
// @ts-expect-error nor in mountControl
mountControl(document.body, { type: "numbr", value: 1 });
tweaks("Known", { a: { type: "slider", value: 1 }, b: { type: "bezier" }, c: { type: "toggle" }, marker: { type: "point", size: 3 } });
mountControl(document.body, { type: "number", value: 1 });
const heldTypo = { a: { type: "slidr", value: 1 } }; // held without as const: `type` is string, the runtime decides
tweaks("Held", heldTypo);

// A point names its components from `value` when it has none, as the runtime does.
const pv = tweaks("Pv", { at: { type: "point", value: { x: 0, y: 10 } }, both: { type: "point", components: [{ key: "u" }], value: { u: 2 } } });
expect<Equal<typeof pv.params.at, { x: number; y: number }>>();
expect<Equal<typeof pv.params.both, { u: number }>>();
