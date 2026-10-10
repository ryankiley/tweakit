/* A multiline text field fades the edge that has more text past it instead of cutting it
 * off: classes on the textarea drive a CSS mask. jsdom lays out nothing, so the metrics
 * are stubbed on the element and the field is driven through its scroll and input events. */
import test from "node:test";
import assert from "node:assert/strict";
import "./_setup-dom.mjs";

const { tweaks } = await import(new URL("../dist/tweaks.js", import.meta.url));
const metrics = (el, m) => { for (const [k, v] of Object.entries(m)) Object.defineProperty(el, k, { value: v, configurable: true, writable: true }); };
const clip = (el) => [el.classList.contains("is-clip-top"), el.classList.contains("is-clip-bottom")];

test("the fade follows where the overflow is: bottom at the top, both midway, top at the end, none when it fits", async () => {
  const p = tweaks("T", { notes: { type: "text", value: "a\nb\nc\nd\ne\nf", rows: 3 } }); document.body.append(p.el); await p.ready;
  const ta = p.el.querySelector("textarea.tw-textarea"); assert.ok(ta);
  metrics(ta, { scrollHeight: 200, clientHeight: 60, scrollTop: 0 }); ta.dispatchEvent(new window.Event("input"));
  assert.deepEqual(clip(ta), [false, true], "at the top, only the bottom fades");
  metrics(ta, { scrollTop: 50 }); ta.dispatchEvent(new window.Event("scroll"));
  assert.deepEqual(clip(ta), [true, true], "midway, both edges fade");
  metrics(ta, { scrollTop: 140 }); ta.dispatchEvent(new window.Event("scroll"));
  assert.deepEqual(clip(ta), [true, false], "at the end, only the top fades");
  metrics(ta, { scrollHeight: 60, scrollTop: 0 }); p.set("notes", "short");
  assert.deepEqual(clip(ta), [false, false], "text that fits has no fade; set() re-judges");
  p.destroy();
});

test("a single-line text field is left alone", async () => {
  const p = tweaks("T", { name: "hi" }); document.body.append(p.el); await p.ready;
  const inp = p.el.querySelector("input.tw-text"); metrics(inp, { scrollHeight: 200, clientHeight: 20, scrollTop: 0 }); inp.dispatchEvent(new window.Event("input"));
  assert.deepEqual(clip(inp), [false, false]);
  p.destroy();
});
