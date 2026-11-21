/* A persisting panel follows another tab's saves: the browser's `storage` event for its key brings those values in as a
 * restore does (one notify, no changed key), and they aren't written back, so two tabs can't trade stale writes.
 * jsdom fires no storage event across documents, so each test dispatches the one another tab's save would. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";
import { loadSingle, wait } from "./_helpers.mjs";

const { tweaks } = await loadSingle();
// What another tab's save does here: storage holds the new value, and the event says so.
const fromOtherTab = (key, newValue) => {
  if (newValue == null) localStorage.removeItem(key);
  else localStorage.setItem(key, newValue);
  window.dispatchEvent(new window.StorageEvent("storage", { key, newValue }));
};
const values = (v) => JSON.stringify({ v: 1, values: v });

test("another tab's save comes in as a restore, and isn't saved back", async () => {
  localStorage.removeItem("tw:sync-a");
  const p = tweaks(
    "A",
    { r: [10, 0, 100, 1], note: { type: "text", value: "here", persist: false } },
    { persist: "sync-a" },
  );
  document.body.append(p.el);
  await p.ready;
  const heard = [];
  p.on((params, k) => heard.push([params.r, k]));
  try {
    fromOtherTab("tw:sync-a", values({ r: 30, note: "there" }));
    assert.equal(p.params.r, 30);
    assert.equal(p.params.note, "here", "a control that isn't saved isn't taken from a save either");
    assert.deepEqual(heard, [[30, undefined]], "one notify, as a restore makes");
    await wait(220); // past the 150 ms save
    assert.equal(localStorage.getItem("tw:sync-a"), values({ r: 30, note: "there" }), "nothing written back");
    p.set("r", 40);
    await wait(220);
    assert.equal(JSON.parse(localStorage.getItem("tw:sync-a")).values.r, 40, "its own edits still save");
  } finally {
    p.destroy();
    localStorage.removeItem("tw:sync-a");
  }
});

test("other keys, removals, junk and old formats are ignored, and a destroyed panel hears nothing", async () => {
  const p = tweaks("B", { r: [10, 0, 100, 1] }, { persist: "sync-b" });
  document.body.append(p.el);
  await p.ready;
  try {
    fromOtherTab("tw:else", values({ r: 50 }));
    fromOtherTab("tw:sync-b", null);
    fromOtherTab("tw:sync-b", "{nope");
    fromOtherTab("tw:sync-b", JSON.stringify({ r: 50 }));
    fromOtherTab("tw:sync-b:presets", JSON.stringify({ v: 1, presets: {} }));
    assert.equal(p.params.r, 10);
  } finally {
    p.destroy();
  }
  fromOtherTab("tw:sync-b", values({ r: 60 }));
  assert.equal(p.params.r, 10, "released on destroy");
  for (const k of ["tw:sync-b", "tw:else", "tw:sync-b:presets"]) localStorage.removeItem(k);
});

test("a panel without persist has no storage listener to follow", async () => {
  const p = tweaks("C", { r: [10, 0, 100, 1] });
  document.body.append(p.el);
  await p.ready;
  fromOtherTab("tw:C", values({ r: 70 }));
  assert.equal(p.params.r, 10);
  p.destroy();
  localStorage.removeItem("tw:C");
});

test("a panel taken out of the page and put back keeps following", async () => {
  const p = tweaks("D", { r: [10, 0, 100, 1] }, { persist: "sync-d" });
  document.body.append(p.el);
  await p.ready;
  try {
    p.el.remove();
    fromOtherTab("tw:sync-d", values({ r: 20 }));
    assert.equal(p.params.r, 20, "out of the page, a save still comes in");
    document.body.append(p.el);
    fromOtherTab("tw:sync-d", values({ r: 30 }));
    assert.equal(p.params.r, 30, "and after it's back");
  } finally {
    p.destroy();
    localStorage.removeItem("tw:sync-d");
  }
});

test("another tab's save starts this tab's undo afresh: ⌘Z doesn't take it back", async () => {
  const p = tweaks("U", { r: [10, 0, 100, 1] }, { persist: "sync-u", undo: true });
  document.body.append(p.el);
  await p.ready;
  try {
    p.set("r", 40);
    await wait(400); // a step of this tab's own
    fromOtherTab("tw:sync-u", values({ r: 30 }));
    p.undo();
    assert.equal(p.params.r, 30);
  } finally {
    p.destroy();
    localStorage.removeItem("tw:sync-u");
  }
});
