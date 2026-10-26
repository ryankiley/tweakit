// Type-level checks for params inferred from a schema. test/types.test.mjs runs tsc over this
// file against the built declarations: each @ts-expect-error must be an error, the rest must pass.
import { tweaks, mountControl, type Schema, type Params, type Panel, type ShadowValue, type ParamsOf } from "../../dist/types/tweaks/core.js";

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
  on: { type: "checkbox", value: true },
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
expect<Equal<typeof p.params.on, boolean>>();
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
const hinge = tweaks("Hinge", { marker: { type: "point", size: 3 }, pick: { type: "point", options: ["a", "b"] } });
expect<Equal<typeof hinge.params, { marker: { type: string; size: number }; pick: "a" | "b" }>>();
// With the hinge field there it's that control, so an unusable one is an error, and the runtime skips it.
// @ts-expect-error a list's options are a list
const badHinge = tweaks("Hinge", { bad: { type: "list", options: 5 } });
expect<Equal<typeof badHinge.params, {}>>();
// A value is a hinge too: a list holding one but no options is skipped at runtime, not a folder of `type` and `value`.
// @ts-expect-error a list needs its options
tweaks("Hinge", { noOptions: { type: "list", value: "a" } });
// A name no control has, with a value, options or an action, is skipped at runtime: nothing on params. Without one, a folder.
const unknownTypes = { b: { type: "bezier", value: [0.3, 1, 0.6, 1] }, d: { type: "dropdown", options: ["a", "b"] }, font: { type: "Inter", size: 12 }, ok: 1 } as const;
expect<Equal<ParamsOf<typeof unknownTypes>, { font: { type: string; size: number }; ok: number }>>();

// Numeric choices put the number on params, as the runtime does, bare or as `{ value, label }`.
const nums = tweaks("Nums", {
  n: { type: "list", options: [1, 2, 4] },
  seg: { type: "segmented", options: [8, 16], value: 16 },
  grid: { type: "radiogrid", options: [{ value: 0.5, label: "Half" }, 1] },
  sizes: { options: ["s", { value: 2, label: "Two" }], value: 2 },
});
expect<Equal<typeof nums.params, { n: 1 | 2 | 4; seg: 8 | 16; grid: 0.5 | 1; sizes: "s" | 2 }>>();
nums.set("n", 2); nums.setMany({ seg: 8, grid: 1 });
// A held schema widens them to number, or string | number for a mix.
const heldNums = { pick: { options: [1, 2], value: 2 }, mixed: { options: ["a", 1] } };
const hn = tweaks("HeldNums", heldNums);
expect<Equal<typeof hn.params, { pick: number; mixed: string | number }>>();
const checkedNums = { n: { type: "list", options: [1, 2, 4] } } satisfies Schema;
const cn = tweaks("CheckedNums", checkedNums);
expect<Equal<typeof cn.params, { n: number }>>();
// A default off the list is kept as given until a pick, so it joins the options.
const off = tweaks("Off", { a: { options: ["a", "b"], value: "c" }, l: { type: "list", options: ["a", "b"], value: "c" },
  s: { type: "segmented", options: ["a"], value: "z" }, r: { type: "radiogrid", options: [1, 2], value: 3 } });
expect<Equal<typeof off.params, { a: "a" | "b" | "c"; l: "a" | "b" | "c"; s: "a" | "z"; r: 1 | 2 | 3 }>>();

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
// Twenty folders deep still compiles (tsc ran out of depth spelling every path); past ten the rest of a path is any string.
const deep = tweaks("Deep", { f: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { x: 1 } } } } } } } } } } } } } } } } } } } } } });
deep.set("f.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.x", 2); deep.setMany({ "f.a.a": 1 });
// @ts-expect-error a wrong key above the cut-off is still caught
deep.set("f.b", 1);

// A type name no control has fails where it's written, at any depth; a known name, a widened `string` and a
// known name without its hinge field (a folder at runtime) all still compile.
// @ts-expect-error "slidr" names no control
tweaks("Typo", { a: { type: "slidr", value: 1 } });
// @ts-expect-error nor inside a folder
tweaks("Typo", { f: { inner: { type: "chekbox", value: true } } });
// @ts-expect-error nor on a tab page
tweaks("Typo", { t: { type: "tabs", pages: { One: { b: { type: "colr", value: "#fff" } } } } });
// @ts-expect-error nor in mountControl
mountControl(document.body, { type: "numbr", value: 1 });
tweaks("Known", { a: { type: "slider", value: 1 }, b: { type: "cubicbezier" }, c: { type: "checkbox" }, marker: { type: "point", size: 3 } });
// @ts-expect-error the toggle / switch / bezier aliases are gone
tweaks("Alias", { c: { type: "toggle" } });
mountControl(document.body, { type: "number", value: 1 });
// A known name the runtime builds holds its fields to that control's form, rather than reading as a folder.
// @ts-expect-error an image's options are URLs
tweaks("Img", { pic: { type: "image", options: [1] } });
// @ts-expect-error nor in mountControl
mountControl(document.body, { type: "image", options: [1] });
// @ts-expect-error a slider holds a number, not a string
tweaks("Slider", { s: { type: "slider", value: "12" } });
tweaks("Img", { pic: { type: "image", options: ["a.png", { value: "b.png", label: "B" }], hint: "Pick" } });
const heldTypo = { a: { type: "slidr", value: 1 } }; // held without as const: `type` is string, the runtime decides
tweaks("Held", heldTypo);

// A point names its components from `value` when it has none, as the runtime does.
const pv = tweaks("Pv", { at: { type: "point", value: { x: 0, y: 10 } }, both: { type: "point", components: [{ key: "u" }], value: { u: 2 } } });
expect<Equal<typeof pv.params.at, { x: number; y: number }>>();
expect<Equal<typeof pv.params.both, { u: number }>>();

// A typed panel is still a Panel: hosts hold one in a ref or pass it to a helper typed with the bare name.
const asPanel: Panel = tweaks("AsPanel", { x: 1, card: { size: [2, 0, 10, 1] } });
const ref: { current: Panel | null } = { current: null };
ref.current = tweaks("Ref", { on: true });
const takesPanel = (p: Panel) => p.set("anything", 1);
takesPanel(paths); asPanel.reset();

// An annotated Schema holds a nested `type` to the known names too; a known name, a folder and a non-string `type` child pass.
// @ts-expect-error "slidr" names no control
const annotated: Schema = { a: { type: "slidr", value: 1 } };
// @ts-expect-error nor deeper in a folder
const annotatedDeep: Schema = { f: { g: { type: "chekbox" } } };
const annotatedOk: Schema = { a: { type: "slider", value: 1 }, f: { inner: 1, type: 3 }, g: { type: "checkbox" } };
tweaks("Annotated", annotatedOk);
