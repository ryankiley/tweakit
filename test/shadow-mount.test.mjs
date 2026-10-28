/* opts.shadow: the panel in a shadow root on its host, its portals in a second root on <body>, and everything that
 * crosses those boundaries: outside presses, focus, ⌘Z and ⌘C, the scheme pin, the lift, and teardown. */
import test from "node:test";
import assert from "node:assert/strict";
import { window } from "./_setup-dom.mjs";
import { loadSingle, wait, ptr, key, dragHeader } from "./_helpers.mjs";
// the kit guards on these globals; the shared setup doesn't expose them
globalThis.MutationObserver = window.MutationObserver;
globalThis.customElements = window.customElements;

const { tweaks, mountControl, createColorPicker } = await loadSingle();
const mount = async (schema, opts = {}) => {
  const p = tweaks("Shadow", schema, { shadow: true, ...opts });
  document.body.append(p.el);
  await p.ready;
  return p;
};
const inner = (p) => p.el.shadowRoot.querySelector(".twk-panel");
const portalRoot = () => document.querySelector(".twk-portal-host")?.shadowRoot;

test("a shadow panel lives in its host's open shadow root, with the stylesheet linked there, and works as a light one", async () => {
  const p = await mount({ size: [12, 0, 40, 1], on: true });
  try {
    assert.ok(p.el.classList.contains("twk-host") && p.el.shadowRoot, "el is the host");
    assert.equal(document.querySelector(".twk-panel"), null, "no panel in the page's own tree");
    assert.ok(inner(p).classList.contains("twk-in-shadow"), "the panel skips the light token rule");
    const link = p.el.shadowRoot.querySelector("link[rel=stylesheet]");
    assert.match(link.href, /\/tweaks\.css$/, "tweaks.css beside the module");
    assert.equal(p.el.style.visibility, "hidden", "hidden until the stylesheet applies");
    link.dispatchEvent(new Event("load"));
    assert.equal(p.el.style.visibility, "", "and shown once it does");
    p.set("size", 20);
    assert.equal(p.params.size, 20);
    assert.equal(inner(p).querySelector("[role=slider]").getAttribute("aria-valuenow"), "20");
  } finally {
    p.destroy();
  }
});

test("shadow: { href } links that stylesheet instead", async () => {
  const p = await mount({ a: 1 }, { shadow: { href: "/assets/tweakit.css" } });
  try {
    assert.equal(p.el.shadowRoot.querySelector("link").getAttribute("href"), "/assets/tweakit.css");
  } finally {
    p.destroy();
  }
});

test("a pane opens in the portal root, a press inside it or the panel keeps it, and one on the page closes it", async () => {
  const p = await mount({ fruit: ["Apple", "Banana"] });
  try {
    inner(p).querySelector(".twk-select-trigger").click();
    await wait(40);
    const dd = portalRoot()?.querySelector(".twk-select-dropdown");
    assert.ok(dd?.classList.contains("is-open"), "the dropdown opened in the portal root");
    assert.ok(dd.classList.contains("twk-in-shadow"), "taking its tokens from that root's host");
    assert.equal(document.querySelector("body > .twk-select-dropdown"), null, "not on <body>");
    // e.target reads as the portal host out here
    dd.querySelector(".twk-select-option").dispatchEvent(ptr("pointerdown"));
    inner(p).querySelector(".twk-select-label").dispatchEvent(ptr("pointerdown"));
    assert.ok(dd.classList.contains("is-open"), "presses inside the pane and its row keep it open");
    document.body.dispatchEvent(ptr("pointerdown"));
    assert.ok(!dd.classList.contains("is-open"), "a press on the page closes it");
  } finally {
    p.destroy();
  }
});

test("focus moving from the panel into its pane keeps the pane open", async () => {
  const p = await mount({ fruit: ["Apple", "Banana"] });
  try {
    const trigger = inner(p).querySelector(".twk-select-trigger");
    trigger.focus();
    key(trigger, { key: "ArrowDown" });
    await wait(40);
    const dd = portalRoot().querySelector(".twk-select-dropdown");
    assert.ok(dd.classList.contains("is-open"));
    assert.equal(portalRoot().activeElement?.textContent, "Apple", "focus went into the pane");
    assert.ok(dd.classList.contains("is-open"), "and the pane stayed open across the two roots");
    key(dd, { key: "ArrowDown" });
    assert.equal(portalRoot().activeElement?.textContent, "Banana", "arrow keys read focus in the pane's root");
  } finally {
    p.destroy();
  }
});

test("⌘Z in a shadow panel's text field is the field's; on a slider it's the panel's; ⌘C copies the focused row", async () => {
  const p = await mount({ label: { type: "text", value: "hi" }, x: [1, 0, 10, 1] }, { undo: true });
  try {
    const field = inner(p).querySelector(".twk-text"),
      slider = inner(p).querySelector("[role=slider]");
    field.focus();
    assert.equal(key(field, { key: "z", metaKey: true }).defaultPrevented, false, "the field keeps its native undo");
    slider.focus();
    assert.equal(key(slider, { key: "z", metaKey: true }).defaultPrevented, true, "the panel owns ⌘Z on a control");
    key(slider, { key: "c", metaKey: true });
    assert.equal(
      document.activeElement?.className,
      "twk-sr",
      "⌘C found the focused row through the root and stepped to the copy field",
    );
    assert.equal(document.activeElement.value, "1");
  } finally {
    p.destroy();
  }
});

test("a scheme pin on the host or an ancestor reaches the panel inside, and follows a change", async () => {
  const wrap = document.createElement("div");
  wrap.dataset.twkScheme = "dark";
  document.body.append(wrap);
  const p = tweaks("Pin", { a: 1 }, { shadow: true });
  wrap.append(p.el);
  await p.ready;
  try {
    await wait(0);
    assert.equal(inner(p).getAttribute("data-twk-scheme"), "dark", "mirrored from the ancestor");
    wrap.dataset.twkScheme = "light";
    await wait(0);
    assert.equal(inner(p).getAttribute("data-twk-scheme"), "light", "and follows it");
    delete wrap.dataset.twkScheme;
    p.el.dataset.twkScheme = "dark";
    await wait(0);
    assert.equal(inner(p).getAttribute("data-twk-scheme"), "dark", "a pin on the host itself counts");
  } finally {
    p.destroy();
    wrap.remove();
  }
});

test("a drag lifts the host to <body>, leaving the slot, and destroy() takes the host and the portal root away", async () => {
  const slot = document.createElement("div");
  document.body.append(slot);
  const p = tweaks("Lift", { a: [1, 0, 10, 1] }, { shadow: true });
  slot.append(p.el);
  await p.ready;
  const header = inner(p).querySelector(".twk-header");
  dragHeader({ el: { querySelector: () => header } }, 40);
  assert.equal(inner(p).dataset.mode, "floating");
  assert.equal(p.el.parentNode, document.body, "the host moved, with the panel still in its root");
  assert.equal(inner(p).parentNode, p.el.shadowRoot);
  assert.ok(slot.querySelector(".twk-lift-slot"), "a placeholder holds the slot");
  p.destroy();
  assert.ok(
    !p.el.isConnected && !slot.querySelector(".twk-lift-slot"),
    "destroy() removed the host and the placeholder",
  );
  assert.equal(document.querySelector(".twk-portal-host"), null, "and the portal root");
  slot.remove();
});

test("mountControl and createColorPicker take shadow too: el is the host, and destroy() takes it and its portal root", async () => {
  const where = document.createElement("div");
  document.body.append(where);
  const c = mountControl(where, [5, 0, 10, 1], { shadow: true });
  await c.ready;
  const picker = createColorPicker({ value: "#336699", shadow: true });
  where.append(picker.el);
  await picker.ready;
  try {
    assert.equal(c.el.parentNode, where, "the host went into the given element");
    assert.ok(c.el.shadowRoot.querySelector(".twk-control.twk-in-shadow [role=slider]"), "the control is in its root");
    c.set(7);
    assert.equal(c.get(), 7);
    assert.ok(picker.el.shadowRoot.querySelector(".twk-color-picker"), "the picker is in its root");
  } finally {
    c.destroy();
    picker.destroy();
  }
  assert.equal(where.children.length, 0, "both hosts left");
  assert.equal(document.querySelector(".twk-portal-host"), null, "and their portal roots");
  where.remove();
});

// A page's own web component that renders a light panel in its shadow root: a press on the pane's own option read as
// outside (e.target is the component's host up there). Its panes go to <body>, as before: a transformed ancestor of the
// component would capture a pane kept in its root.
test("a light panel inside a page's own shadow root keeps its panes on <body>, open on a press inside", async () => {
  const component = document.createElement("div");
  document.body.append(component);
  const root = component.attachShadow({ mode: "open" });
  const p = tweaks("Inside", { fruit: ["Apple", "Banana"] });
  root.append(p.el);
  await p.ready;
  try {
    p.el.querySelector(".twk-select-trigger").click();
    await wait(40);
    const dd = document.querySelector("body > .twk-select-dropdown");
    assert.ok(
      dd?.classList.contains("is-open") && !dd.classList.contains("twk-in-shadow"),
      "the pane opened on <body>, with its own tokens",
    );
    dd.querySelector(".twk-select-option").dispatchEvent(ptr("pointerdown"));
    p.el.querySelector(".twk-select-label").dispatchEvent(ptr("pointerdown"));
    assert.ok(dd.classList.contains("is-open"), "presses on its option and on its row kept it");
    document.body.dispatchEvent(ptr("pointerdown"));
    assert.ok(!dd.classList.contains("is-open"), "a press on the page closed it");
  } finally {
    p.destroy();
    component.remove();
  }
});

// A shadow panel's host is a <twk-host>, so it hears the page connect and disconnect it. A host the page dropped without
// destroy() kept its portal root on <body> and a document observer; one appended after its dressing, or moved, kept
// whatever scheme it first read; a portal root the page removed stayed gone.
test("a shadow host lets go when the page drops it, comes back when re-added, and reads the scheme where it lands", async () => {
  const dark = document.createElement("div");
  dark.dataset.twkScheme = "dark";
  const light = document.createElement("div");
  light.dataset.twkScheme = "light";
  document.body.append(dark, light);
  // dressed before it's in the page
  const p = tweaks("Life", { fruit: ["Apple", "Banana"] }, { shadow: true });
  await p.ready;
  try {
    assert.equal(p.el.localName, "twk-host");
    dark.append(p.el);
    await wait(0);
    assert.equal(inner(p).getAttribute("data-twk-scheme"), "dark", "read on arrival");
    light.append(p.el);
    await wait(0);
    assert.equal(inner(p).getAttribute("data-twk-scheme"), "light", "and on a move");
    inner(p).querySelector(".twk-select-trigger").click();
    await wait(40);
    assert.ok(document.querySelector(".twk-portal-host"), "a pane put the portal root on <body>");
    document.body.dispatchEvent(ptr("pointerdown"));
    await wait(220);
    p.el.remove();
    await wait(0);
    assert.equal(
      document.querySelector(".twk-portal-host"),
      null,
      "dropped without destroy(), it let go of the portal root",
    );
    light.append(p.el);
    await wait(0);
    document.querySelector(".twk-portal-host")?.remove(); // the page clears what it doesn't know
    inner(p).querySelector(".twk-select-trigger").click();
    await wait(40);
    assert.ok(
      portalRoot()?.querySelector(".twk-select-dropdown.is-open")?.isConnected,
      "back in the page, its panes open in a portal root on <body> again",
    );
  } finally {
    p.destroy();
    dark.remove();
    light.remove();
  }
});
