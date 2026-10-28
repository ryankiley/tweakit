/* Panel lifecycle edges: a lifted panel whose host container goes away, two floating
 * panels fighting for the top, presets and undo called before a lazy panel is ready, and
 * free bag keys surviving an undo. */
import test from "node:test";
import assert from "node:assert/strict";
import { window } from "./_setup-dom.mjs";
import { loadSingle, loadSplit, tick, ptr, distCss, warnings, dragHeader } from "./_helpers.mjs";
// the kit guards on the global; the shared setup doesn't expose it
globalThis.MutationObserver = window.MutationObserver;

const { tweaks } = await loadSingle();
const lazy = await loadSplit();
// The floating placement panel.ts writes: the two insets and the height cap, as custom properties.
const pos = (p) => ["--twk-float-x", "--twk-float-y"].map((v) => p.el.style.getPropertyValue(v));
const cap = (p) => p.el.style.getPropertyValue("--twk-float-max-h");

test("a lifted panel leaves the document with the host container that held it", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const p = tweaks("Lift", { a: [1, 0, 10, 1] });
  host.append(p.el);
  dragHeader(p, 40);
  assert.equal(p.el.dataset.mode, "floating");
  assert.equal(p.el.parentNode, document.body, "lifted to body");
  host.remove();
  await tick(20);
  assert.ok(!p.el.isConnected, "the panel followed its slot out");
  p.destroy();
});

// The three edges a real pointer hits that header-only listeners missed: a release that
// lands a hair off the header, a flick whose first move is already outside it, and the
// click the browser fires on the capturing header once the drag ends.
test("a press released off the header still ends", () => {
  const p = tweaks("Press", { a: 1 });
  document.body.append(p.el);
  const header = p.el.querySelector(".twk-header");
  header.setPointerCapture = header.releasePointerCapture = () => {};
  header.dispatchEvent(ptr("pointerdown", { clientX: 100, clientY: 10 }));
  document.body.dispatchEvent(ptr("pointerup", { clientX: 101, clientY: 60, buttons: 0 }));
  document.body.dispatchEvent(ptr("pointermove", { clientX: 300, clientY: 200 }));
  assert.equal(p.el.dataset.mode, "inline", "the release elsewhere ended the press: a later move drags nothing");
  p.destroy();
});

test("a flick whose moves land outside the header still drags the panel", () => {
  const p = tweaks("Flick", { a: 1 });
  document.body.append(p.el);
  const header = p.el.querySelector(".twk-header");
  header.setPointerCapture = header.releasePointerCapture = () => {};
  header.dispatchEvent(ptr("pointerdown", { clientX: 100, clientY: 10 }));
  document.body.dispatchEvent(ptr("pointermove", { clientX: 160, clientY: 90 }));
  document.body.dispatchEvent(ptr("pointerup", { clientX: 160, clientY: 90, buttons: 0 }));
  assert.equal(p.el.dataset.mode, "floating", "the move heard on the document lifted it");
  assert.ok(!p.el.classList.contains("is-dragging"));
  p.destroy();
});

test("the click that ends a drag is swallowed once; the next title click still collapses", () => {
  const p = tweaks("Click", { a: 1 });
  document.body.append(p.el);
  const header = p.el.querySelector(".twk-header"),
    title = p.el.querySelector(".twk-header-toggle");
  dragHeader(p, 40);
  // With the header holding pointer capture, the browser targets the drag-ending click at
  // the header (the common ancestor of the press on the title and the captured release).
  header.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.ok(!p.el.classList.contains("is-collapsed"), "the drag-ending click did not collapse");
  title.click();
  assert.ok(p.el.classList.contains("is-collapsed"), "the next real click collapses");
  title.click();
  assert.ok(!p.el.classList.contains("is-collapsed"), "and the one after re-expands");
  p.destroy();
});

test("a click anywhere on the header but its toolbar folds the panel; a click that wobbles a few px is still a click", () => {
  const p = tweaks("Hit", { a: 1 });
  document.body.append(p.el);
  const header = p.el.querySelector(".twk-header"),
    toolbarBtn = p.el.querySelector(".twk-toolbar .twk-toolbar-btn");
  header.setPointerCapture = header.releasePointerCapture = () => {};
  const press = (dx, dy, type = "mouse", target = header) => {
    target.dispatchEvent(ptr("pointerdown", { clientX: 100, clientY: 10, pointerType: type }));
    target.dispatchEvent(ptr("pointermove", { clientX: 100 + dx, clientY: 10 + dy, pointerType: type }));
    target.dispatchEvent(ptr("pointerup", { clientX: 100 + dx, clientY: 10 + dy, buttons: 0, pointerType: type }));
    target.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  };
  const collapsed = () => p.el.classList.contains("is-collapsed");
  press(0, 0);
  assert.ok(collapsed(), "the strip beside the title folds it");
  press(4, 3);
  assert.ok(!collapsed(), "5px of wobble from a mouse is still a click");
  assert.notEqual(p.el.dataset.mode, "floating", "and moved nothing");
  press(7, 6, "touch");
  assert.ok(collapsed(), "a finger gets 10px");
  press(6, 4);
  assert.ok(collapsed(), "past 6px a mouse drags: the click is swallowed");
  assert.equal(p.el.dataset.mode, "floating");
  toolbarBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.ok(collapsed(), "a toolbar button keeps its own click");
  // pressed on a button, slid off onto the strip:
  toolbarBtn.dispatchEvent(ptr("pointerdown", { clientX: 200, clientY: 10 }));
  // the click lands on the common ancestor
  header.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.ok(collapsed(), "a press that began on the toolbar never folds the panel");
  p.destroy();
});

// A fixed box ignores page scroll, so a floating panel taller than the window used to run off
// it with its last folders unreachable. Its position caps its height at the viewport below its
// top edge, and the whole panel scrolls, header and all.
test("a floating panel taller than the viewport caps at the viewport below its top and scrolls", async () => {
  assert.match(
    distCss(),
    /\.twk-panel\[data-mode=floating\]\{overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none\}/,
    "scrolling, the scrollbar hidden",
  );
  const h = window.innerHeight;
  window.innerHeight = 400; // a short window
  const schema = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`folder${i}`, { a: [1, 0, 10, 1], b: [2, 0, 10, 1] }]),
  );
  const p = tweaks("Tall", schema);
  document.body.append(p.el);
  const drag = (dx, dy) => dragHeader(p, dx, dy, 20);
  // jsdom lays nothing out: stand in for the panel's full height (scrollHeight, rounded).
  const full = (v) => Object.defineProperty(p.el, "scrollHeight", { value: v, configurable: true });
  try {
    // An inline panel lifted by a drag keeps the 8px margin at the bottom (one placed by opts.floating mirrors its
    // inset; see below).
    p.el.getBoundingClientRect = () => ({ left: 60, top: 120, right: 60, bottom: 120, width: 0, height: 0 });
    drag(0, 10); // lifted where it sat, then 10px down (past the click's slop)
    assert.deepEqual(
      [pos(p)[1], cap(p)],
      ["130px", "calc(100dvh - 138px)"],
      "the cap is written with the position: 130 top + 8 margin",
    );
    full(1600);
    window.dispatchEvent(new Event("resize"));
    assert.deepEqual(
      [pos(p)[1], cap(p)],
      ["8px", "calc(100dvh - 16px)"],
      "a panel taller than the window clamps to the top margin on its full height, and the cap follows",
    );
    drag(40, 200);
    assert.deepEqual(
      pos(p),
      ["100px", "8px"],
      "dragging down can't push a too-tall panel off the bottom, however short the cap made it",
    );
    // A panel that fits moves freely, the cap recomputed from where it lands.
    full(100); // scrollHeight rounds a fractional layout, so the clamp allows a pixel of slack
    drag(0, 150);
    assert.deepEqual([pos(p)[1], cap(p)], ["158px", "calc(100dvh - 166px)"], "recomputed after the drag");
    drag(0, 900);
    assert.equal(pos(p)[1], `${400 - 101 - 8}px`, "parked at the bottom on the rounded-up height");
  } finally {
    window.innerHeight = h;
    p.destroy();
  }
});

test("draggable: false pins a floating panel too", () => {
  const p = tweaks("Pinned", { a: 1 }, { floating: { x: 40, y: 50 }, draggable: false });
  document.body.append(p.el);
  dragHeader(p, 100, 100);
  assert.deepEqual(pos(p), ["40px", "50px"], "the press moved nothing");
  p.el.querySelector(".twk-header-toggle").click();
  assert.ok(p.el.classList.contains("is-collapsed"), "the title still collapses");
  p.destroy();
  // Nor does its header look or act like a handle: no grab cursor, and a touch swipe on it scrolls the panel.
  const css = distCss();
  assert.match(
    css,
    /\.twk-panel\[data-draggable=true\]>\.twk-header\{touch-action:none;margin-top:-10px;padding-top:10px\}/,
  );
  assert.ok(
    !/\[data-mode=floating\]>\.twk-header[^{]*\{[^}]*(cursor|touch-action)/.test(css),
    "no floating-only header rule",
  );
});

test("a floating panel's far margins are measured inside the page scrollbars", () => {
  const root = document.documentElement;
  Object.defineProperty(root, "clientWidth", { value: 1009, configurable: true }); // a 15px scrollbar on a 1024 window
  Object.defineProperty(root, "clientHeight", { value: 753, configurable: true });
  const p = tweaks("Bars", { a: 1 }, { floating: { x: 16, y: 16 } });
  document.body.append(p.el);
  Object.defineProperty(p.el, "offsetWidth", { value: 256, configurable: true });
  Object.defineProperty(p.el, "scrollHeight", { value: 200, configurable: true });
  try {
    dragHeader(p, 2000, 2000);
    assert.deepEqual(
      pos(p),
      [`${1009 - 256 - 8}px`, `${753 - 201 - 8}px`],
      "the far margins sit 8px inside the scrollbars, not under them",
    );
    // With no doctype the root's client box is the page's content, not the viewport: the inner size stands in.
    Object.defineProperty(document, "compatMode", { value: "BackCompat", configurable: true });
    Object.defineProperty(root, "clientHeight", { value: 90, configurable: true }); // a short page
    dragHeader(p, 2000, 2000);
    assert.deepEqual(
      pos(p),
      [`${1024 - 256 - 8}px`, `${window.innerHeight - 201 - 8}px`],
      "quirks mode measures the window",
    );
  } finally {
    delete document.compatMode;
    delete root.clientWidth;
    delete root.clientHeight;
    p.destroy();
  }
});

// Resize the window for the length of fn, the panel's clamp listening.
const resized = (w, h, fn) => {
  const w0 = window.innerWidth,
    h0 = window.innerHeight;
  window.innerWidth = w;
  window.innerHeight = h;
  window.dispatchEvent(new Event("resize"));
  try {
    fn();
  } finally {
    window.innerWidth = w0;
    window.innerHeight = h0;
    window.dispatchEvent(new Event("resize"));
  }
};

test("a pinned panel clamps from its placement, so a window that narrows and widens hands its spot back", () => {
  const p = tweaks("PinSpot", { a: 1 }, { floating: { x: 16, y: 16 }, draggable: false });
  document.body.append(p.el);
  Object.defineProperty(p.el, "offsetWidth", { value: 256, configurable: true });
  resized(270, 500, () => assert.equal(pos(p)[0], "8px", "pushed in to the margin by a too-narrow window"));
  assert.deepEqual(pos(p), ["16px", "16px"], "back at its placement once the window widens");
  Object.defineProperty(p.el, "scrollHeight", { value: 2000, configurable: true });
  resized(1024, 400, () =>
    assert.equal(pos(p)[1], "16px", "a pinned panel taller than the window keeps its top inset and scrolls"),
  );
  p.destroy();
});

test("the height cap keeps the floating inset as its far gap; --twk-float-gap overrides it", () => {
  const p = tweaks("Gap", { a: 1 }, { floating: { x: 16, y: 16 }, draggable: false });
  document.body.append(p.el);
  assert.equal(cap(p), "calc(100dvh - 32px)", "16 from the top, 16 short of the bottom");
  p.el.style.setProperty("--twk-float-gap", "40px"); // stands in for a host rule: the clamp reads the computed value
  window.dispatchEvent(new Event("resize"));
  assert.equal(cap(p), "calc(100dvh - 56px)", "the host's gap");
  p.destroy();
  const q = tweaks("GapTrue", { a: 1 }, { floating: true });
  document.body.append(q.el);
  assert.equal(cap(q), "calc(100dvh - 32px)", "floating: true sits 16px in, and mirrors it");
  q.destroy();
  // Custom properties stay raw text unless registered: registered as a <length>, 1.5rem computes to 24px, not 1.5.
  assert.match(distCss(), /@property --twk-float-gap\{syntax: "<length>"; inherits: true; initial-value: -1px;\}/);
});

test("the far gap holds only at the placement: a dragged panel reaches the bottom margin", () => {
  const h = window.innerHeight;
  window.innerHeight = 600;
  const p = tweaks("Reach", { a: 1 }, { floating: { x: 24, y: 120 } });
  document.body.append(p.el);
  Object.defineProperty(p.el, "scrollHeight", { value: 200, configurable: true });
  try {
    assert.equal(cap(p), "calc(100dvh - 240px)", "placed: 120 down, 120 short of the bottom");
    dragHeader(p, 0, 900);
    assert.deepEqual(
      [pos(p)[1], cap(p)],
      [`${600 - 201 - 8}px`, "calc(100dvh - 399px)"],
      "parked 8px from the bottom, the cap on the margin",
    );
  } finally {
    window.innerHeight = h;
    p.destroy();
  }
});

test("a pinned panel in a window too short for its insets shrinks them together, never capping to nothing", () => {
  const p = tweaks("Short", { a: 1 }, { floating: { x: 16, y: 300 }, draggable: false });
  document.body.append(p.el);
  Object.defineProperty(p.el, "scrollHeight", { value: 1200, configurable: true });
  resized(1024, 500, () => {
    assert.deepEqual(
      [pos(p)[1], cap(p)],
      ["125px", "calc(100dvh - 250px)"],
      "half the window for the panel; the 300 + 300 insets share the rest",
    );
  });
  resized(1024, 1400, () =>
    assert.deepEqual([pos(p)[1], cap(p)], ["300px", "calc(100dvh - 600px)"], "back at its placement in a tall window"),
  );
  p.destroy();
});

test("an inset of 0 is honored, not read as missing", () => {
  const p = tweaks("Flush", { a: 1 }, { floating: { x: 0, y: 0 }, draggable: false });
  document.body.append(p.el);
  assert.deepEqual([...pos(p), cap(p)], ["0px", "0px", "calc(100dvh - 0px)"]);
  p.destroy();
});

test("a panel grabbed mid-snap picks up where it visually is, and the snap's timer is its own", async () => {
  const p = tweaks("Regrab", { a: 1 }, { floating: { x: 16, y: 16 } });
  document.body.append(p.el);
  const header = p.el.querySelector(".twk-header");
  header.setPointerCapture = header.releasePointerCapture = () => {};
  dragHeader(p, -10, 0); // dropped near the left edge: snapping
  assert.ok(p.el.classList.contains("is-snapping"));
  p.el.style.left = "50px";
  p.el.style.top = "40px"; // stand in for the mid-flight computed left / top
  header.dispatchEvent(ptr("pointerdown", { clientX: 100, clientY: 10 }));
  assert.ok(!p.el.classList.contains("is-snapping"));
  assert.deepEqual(pos(p), ["50px", "40px"], "read from where it is drawn, not where it was headed");
  header.dispatchEvent(ptr("pointermove", { clientX: 110, clientY: 20 }));
  assert.deepEqual(pos(p), ["60px", "50px"], "and the drag moves on from there");
  header.dispatchEvent(ptr("pointerup", { clientX: 110, clientY: 20, buttons: 0 }));
  p.el.style.left = p.el.style.top = "";
  await tick(200);
  dragHeader(p, -50, 0); // a second snap 200ms into the first one's 340
  await tick(200);
  assert.ok(p.el.classList.contains("is-snapping"), "the first drop's timer didn't cut the second snap short");
  await tick(200);
  assert.ok(!p.el.classList.contains("is-snapping"));
  assert.deepEqual(pos(p), ["8px", "50px"], "the second drop snapped to the left margin");
  resized(500, 300, () => assert.deepEqual(pos(p), ["8px", "50px"], "and it holds its insets as the window shrinks"));
  p.destroy();
});

test("only a draggable panel eases its shadow: a pinned one starts floated, with no transition", () => {
  const css = distCss();
  assert.match(
    css,
    /\.twk-panel\[data-draggable=true\]\[data-mode=floating\]\{transition:box-shadow \.25s var\(--twk-ease-out\)\}/,
    "only once floated: an inline panel's shadow doesn't ease on a theme or scheme change",
  );
  assert.match(
    css,
    /\.twk-panel:where\(\[data-mode=floating\]\)\{left:var\(--twk-float-x\);top:var\(--twk-float-y\);max-height:var\(--twk-float-max-h\);z-index:99990;box-shadow:var\(--twk-shadow-panel-lifted\)\}/,
    "placement, z-index and shadow at plain class specificity, so a host class overrides them",
  );
  assert.ok(
    !/\.twk-panel(\[data-draggable=true\])?\{[^}]*transition/.test(css),
    "an inline panel carries no transition",
  );
  const p = tweaks("Pin", { a: 1 }, { floating: true, draggable: false });
  assert.equal(p.el.dataset.draggable, undefined, "so the transition rule never matches it");
  p.destroy();
});

test("a pinned panel ignores a saved position; a draggable one restores it, and saves where it's dropped", () => {
  localStorage.clear();
  localStorage.setItem("tw:pin:pos", JSON.stringify({ x: 300, y: 200 }));
  const pinned = tweaks("Pin", { a: 1 }, { persist: "pin", floating: { x: 16, y: 16 }, draggable: false });
  assert.deepEqual(pos(pinned), ["16px", "16px"], "the placement wins over the stored spot");
  pinned.destroy();
  const free = tweaks("Free", { a: 1 }, { persist: "pin", floating: { x: 16, y: 16 } });
  assert.deepEqual(pos(free), ["300px", "200px"], "a draggable panel picks up where it was left");
  document.body.append(free.el);
  dragHeader(free, -100, 100);
  assert.deepEqual(JSON.parse(localStorage.getItem("tw:pin:pos")), { x: 200, y: 300 }, "saved where it was dropped");
  free.destroy();
  localStorage.clear();
});

test("the floating panel touched last sits above the others", () => {
  const a = tweaks("A", { a: 1 }, { floating: true }),
    b = tweaks("B", { b: 1 }, { floating: true });
  document.body.append(a.el, b.el);
  dragHeader(a, 30);
  assert.ok(a.el.classList.contains("is-raised"));
  dragHeader(b, 30);
  assert.ok(b.el.classList.contains("is-raised"));
  assert.ok(!a.el.classList.contains("is-raised"), "the previous holder gives the stylesheet value back");
  assert.equal(a.el.style.zIndex + b.el.style.zIndex, "", "a class, not an inline z-index a host's own couldn't beat");
  assert.match(distCss(), /\.twk-panel:where\(\.is-raised\)\{z-index:99991\}/);
  a.destroy();
  b.destroy();
});

test("presets and undo called before a lazy panel is ready replay in order", async () => {
  localStorage.clear();
  // lazy, so assemble waits on ready
  const spring = { type: "spring", value: { stiffness: 100, damping: 12, mass: 1 } };
  const p = lazy.tweaks("LazyPresets", { x: [1, 0, 10, 1], s: spring }, { persist: "lp" });
  assert.ok(p.el.querySelector(".twk-toolbar-btn--reset").disabled, "in the lazy window");
  p.set("x", 4);
  assert.equal(p.savePreset("four"), true, "queued, not dropped");
  p.set("x", 9);
  await p.ready;
  assert.deepEqual(p.presets(), ["four"]);
  assert.equal(p.params.x, 9);
  p.loadPreset("four");
  assert.equal(p.params.x, 4, "the preset captured the value at its point in the queue");
  p.destroy();
  localStorage.setItem("tw:lp2:presets", JSON.stringify({ v: 1, presets: { seven: { x: 7 } } }));
  // spring is registered by now — a type the process has not loaded keeps this in the lazy window
  const q = lazy.tweaks(
    "LazyLoad",
    { x: [1, 0, 10, 1], b: { type: "cubicbezier", value: [0.4, 0, 0.2, 1] } },
    { persist: "lp2" },
  );
  assert.ok(q.el.querySelector(".twk-toolbar-btn--reset").disabled, "still in the lazy window");
  assert.equal(q.loadPreset("seven"), true, "a stored preset is loadable before ready");
  assert.equal(q.loadPreset("missing"), false);
  await q.ready;
  assert.equal(q.params.x, 7);
  q.destroy();
});

// set() used to write a key no control owned straight onto params, so a typo rode into toJSON() and every save.
test("set() refuses a key no control has, with a warning, and keeps it out of params and toJSON()", async () => {
  const p = tweaks("Bag", { a: [1, 0, 10, 1] });
  let calls = 0;
  p.on(() => calls++);
  const warned = await warnings(() => {
    p.set("nope", 5);
    p.setMany({ a: 3, typo: 1 });
  });
  assert.equal(p.params.a, 3);
  assert.ok(!("nope" in p.params) && !("typo" in p.params));
  assert.deepEqual(p.toJSON().values, { a: 3 });
  assert.equal(calls, 1, "the good key still notifies");
  assert.ok(warned.some((m) => m.includes('set("nope") ignored — no control has that key')));
  assert.ok(warned.some((m) => m.includes('set("typo") ignored')));
  p.destroy();
});

test("set() on a button, monitor or separator says it holds no value, not that no control has the key", async () => {
  const p = tweaks("Bag", {
    go: { action: () => {} },
    m: { type: "monitor", value: 1 },
    line: { type: "separator" },
    f: { b: { type: "button", action: () => {} } },
  });
  const warn = console.warn,
    warned = [];
  console.warn = (...m) => warned.push(m.join(" "));
  try {
    p.set("go", 1);
    p.set("m", 2);
    p.setMany({ line: 3, "f.b": 4 });
    p.set("b", 5);
    p.set("nope", 6);
    await new Promise((r) => setTimeout(r, 10)); // a notice's words come from a lazy chunk
    assert.deepEqual(warned, [
      '[tweaks] set("go") ignored — a button holds no value to set',
      '[tweaks] set("m") ignored — a monitor holds no value to set',
      '[tweaks] set("line") ignored — a separator holds no value to set',
      '[tweaks] set("f.b") ignored — a button holds no value to set',
      '[tweaks] set("b") ignored — a button holds no value to set',
      '[tweaks] set("nope") ignored — no control has that key',
    ]);
    assert.deepEqual(p.toJSON().values, { f: {} });
  } finally {
    console.warn = warn;
    p.destroy();
  }
});

test("collapsing folds the body over the height in view, not its whole content, and cleans up after", () => {
  const p = tweaks("Tall", { a: 1 });
  document.body.append(p.el);
  const body = p.el.querySelector(".twk-body"),
    title = p.el.querySelector(".twk-header-toggle");
  // jsdom lays out nothing: a body 1874px tall starting 50px down a 768px window, so 718px of it is in view. Under a
  // fold (its rows held at 1fr) it's drawn at `drawn`.
  let drawn = 0;
  body.getBoundingClientRect = () => ({
    top: 50,
    height: body.style.gridTemplateRows ? drawn : p.el.classList.contains("is-collapsed") ? 0 : 1874,
  });
  const calls = [];
  body.animate = (frames, o) => {
    const a = {
      frames,
      o,
      cancel() {
        a.canceled = true;
      },
      onfinish: null,
    };
    calls.push(a);
    return a;
  };
  title.click();
  assert.ok(p.el.classList.contains("is-collapsed"));
  assert.deepEqual(calls[0].frames, [{ height: "718px" }, { height: "0px" }], "from the window's edge, not 1874px");
  assert.equal(calls[0].o.duration, 350);
  assert.equal(calls[0].o.fill, "forwards");
  assert.equal(body.style.gridTemplateRows, "1fr", "the rows stay laid out under the fold");
  drawn = 300;
  title.click(); // turned around mid-fold
  assert.ok(calls[0].canceled, "the running fold gave way");
  assert.deepEqual(
    calls[1].frames,
    [{ height: "300px" }, { height: "718px" }],
    "from where it's drawn, open to what fits",
  );
  calls[1].onfinish();
  assert.equal(body.style.gridTemplateRows, "");
  assert.equal(body.style.transition, "");
  assert.ok(calls[1].canceled, "its held frame released");
  p.destroy();
});

test("a folder's click folds over what's in view too, and a restore mid-fold turns it around", () => {
  const p = tweaks("Folders", { group: { a: 1, b: 2 } });
  document.body.append(p.el);
  const folder = p.el.querySelector(".twk-folder"),
    body = folder.querySelector(".twk-folder-body");
  // A 306px folder body starting 700px down a 768px window: 68px of it in view. Under a fold it's drawn at `drawn`.
  let drawn = 0;
  body.getBoundingClientRect = () => ({
    top: 700,
    height: body.style.gridTemplateRows ? drawn : folder.classList.contains("is-collapsed") ? 0 : 306,
  });
  const calls = [];
  body.animate = (frames, o) => {
    const a = {
      frames,
      o,
      cancel() {
        a.canceled = true;
      },
      onfinish: null,
    };
    calls.push(a);
    return a;
  };
  folder.querySelector(".twk-folder-header").click();
  assert.ok(folder.classList.contains("is-collapsed"));
  assert.deepEqual(calls[0].frames, [{ height: "68px" }, { height: "0px" }], "only the 68px above the window's edge");
  assert.equal(p.toJSON().ui.folders.group, true, "toJSON reads the fold's end state");
  drawn = 30;
  p.fromJSON({ ...p.toJSON(), ui: { folders: { group: false } } }); // restored open, mid-fold
  assert.ok(!folder.classList.contains("is-collapsed"), "restored open");
  assert.ok(calls[0].canceled, "the running fold gave way");
  assert.deepEqual(
    calls[1].frames,
    [{ height: "30px" }, { height: "68px" }],
    "and the restore folds back from where it's drawn",
  );
  calls[1].onfinish();
  assert.equal(body.style.gridTemplateRows, "");
  assert.equal(body.style.transition, "");
  p.destroy();
});

// A panel whose build failed never saves again, but it kept its persist key counted until destroy(): a remount on that
// key, the usual answer to a failed build, warned that another live panel saved there. (shadow: unloaded in this file.)
test("a failed build lets go of its persist key, so a remount on it is quiet", async () => {
  const warn = console.warn,
    warned = [];
  console.warn = (...a) => warned.push(a.join(" "));
  const shared = () => warned.filter((m) => m.includes("already saves")).length;
  try {
    const p = lazy.tweaks("Broke", { n: [1, 0, 10, 1], s: { type: "shadow", x: 0, y: 4, blur: 8 } }, { persist: true });
    p.params.n = Object.create(null); // no number: the slider's set() throws out of the build
    await assert.rejects(p.ready);
    const q = lazy.tweaks("Broke", { n: [1, 0, 10, 1] }, { persist: true });
    await tick(20); // a notice's words come from a lazy chunk
    assert.equal(shared(), 0, warned.join("\n"));
    p.destroy(); // released already: it mustn't release q's count too
    const r = lazy.tweaks("Broke", { n: [1, 0, 10, 1] }, { persist: true });
    await tick(20);
    assert.equal(shared(), 1, "q is still live, so r warns");
    q.destroy();
    r.destroy();
  } finally {
    console.warn = warn;
    localStorage.clear();
  }
});
