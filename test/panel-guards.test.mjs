/* What a panel keeps to itself: its fields stay out of the browser's autofill and the
 * password managers', and a press or a click on it, or on a popover it portals to
 * <body>, never reaches the page behind. Both were patched by hand in a host's panels
 * before. Runs against the built single-file bundle under jsdom, like panel.test.mjs. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, wait } from "./_helpers.mjs";

const { tweaks } = await loadSingle();

test("every field a panel builds is left alone by autofill and password managers", async () => {
  const p = tweaks("Fields", {
    owner: { type: "text", value: "Maya" },
    note: { type: "text", value: "", rows: 3 },
  }, { filter: true, persist: "t-fields" });
  document.body.append(p.el);
  try {
    // The presets menu's name field is built in a popover on <body>.
    p.el.querySelector('.tw-toolbar-btn[aria-label="Presets"]').click();
    const fields = [...p.el.querySelectorAll("input, textarea"), ...document.querySelectorAll(".tw-portal input, .tw-portal textarea")];
    for (const cls of ["tw-text", "tw-textarea", "tw-search", "tw-presets-input"]) assert.ok(fields.some((f) => f.classList.contains(cls)), `a .${cls} was built`);
    for (const f of fields) {
      assert.equal(f.getAttribute("autocomplete"), "off", `.${f.className} turns autofill off`);
      assert.ok(f.hasAttribute("data-1p-ignore"), `.${f.className} asks 1Password to leave it`);
      assert.equal(f.getAttribute("data-lpignore"), "true", `.${f.className} asks LastPass to leave it`);
    }
  } finally {
    p.destroy();
    await wait(220); // the portaled menu node is removed 200ms after close
  }
});

test("a press or a click on the panel or its popover never reaches the page", async () => {
  const p = tweaks("Clicks", { a: 1 }, { persist: "t-clicks" });
  document.body.append(p.el);
  const heard = [], types = ["pointerdown", "pointerup", "click"];
  const onPage = (e) => heard.push(e.type);
  const press = (node) => { for (const t of types) node.dispatchEvent(new window.Event(t, { bubbles: true })); };
  for (const t of types) document.addEventListener(t, onPage);
  try {
    const presets = p.el.querySelector('.tw-toolbar-btn[aria-label="Presets"]');
    press(presets);
    assert.equal(presets.getAttribute("aria-expanded"), "true", "the panel still hears its own click: the menu opened");
    const menu = [...document.querySelectorAll(".tw-portal")].find((n) => n.querySelector(".tw-presets-input"));
    assert.ok(menu, "the menu is portaled to <body>");
    press(menu.querySelector(".tw-presets-input"));
    assert.deepEqual(heard, [], "the page heard nothing from the panel or its menu");
    press(document.body);
    assert.deepEqual(heard, types, "and still hears its own presses");
  } finally {
    for (const t of types) document.removeEventListener(t, onPage);
    p.destroy();
    await wait(220);
  }
});
