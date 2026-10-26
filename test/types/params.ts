// Type-level checks for params inferred from a schema. test/types.test.mjs runs tsc over this
// file against the built declarations: each @ts-expect-error must be an error, the rest must pass.
import { tweaks, type Schema, type Params } from "../../dist/types/tweaks/core.js";

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
