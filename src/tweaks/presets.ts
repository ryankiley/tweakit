/* The presets menu (opts.persist): the toolbar button's pane for saving, loading and deleting named snapshots. Its own
 * chunk, loaded when the button is first hovered, focused or pressed: a panel nobody opens it on never downloads it. */
import { el, btn, txt, popover, quietFocus } from "./shared.js";

/** Build the menu on `trigger`. `save` is false when storage refused the write. Returns the popover, which owns the
 *  button's clicks from here on. `announce` and the delete icon come from the core: imported here, they would split
 *  feedback.ts and icons.ts into a chunk of their own that every panel downloads. */
export const presetsMenu = (trigger: HTMLButtonElement, names: () => string[], save: (nm: string) => boolean, load: (nm: string) => void, remove: (nm: string) => void, announce: (msg: string) => void, iconX: string) => {
  const menu = el("div", "twk-presets-menu");
  const saveRow = el("div", "twk-presets-save");
  const input = el("input", "twk-presets-input"); input.type = "text"; input.placeholder = "Preset name…"; input.spellcheck = false; input.setAttribute("aria-label", "New preset name"); quietFocus(input);
  const saveBtn = txt("button", "twk-presets-savebtn", "Save");
  saveRow.append(input, saveBtn);
  const list = el("div", "twk-presets-list");
  menu.append(saveRow, list);
  const renderList = () => {
    const all = names();
    list.replaceChildren();
    if (!all.length) return list.append(txt("div", "twk-presets-empty", "No presets yet"));
    for (const nm of all) {
      const row = el("div", "twk-presets-row");
      const loadBtn = txt("button", "twk-presets-load", nm);
      loadBtn.addEventListener("click", () => { load(nm); menuPop.close(); announce(`Loaded preset ${nm}`); });
      const del = btn("twk-presets-del", iconX); del.setAttribute("aria-label", `Delete preset ${nm}`);
      del.addEventListener("click", (e) => { e.stopPropagation(); remove(nm); renderList(); });
      row.append(loadBtn, del); list.append(row);
    }
  };
  const doSave = () => { const nm = input.value.trim(); if (!nm) { input.focus(); return; } if (!save(nm)) { announce(`Preset ${nm} not saved: storage is full`); return; } input.value = ""; renderList(); announce(`Saved preset ${nm}`); }; // a refused save keeps the typed name
  // The shared popover shell; align:"end" hangs it off the button's right edge.
  const menuPop = popover(trigger, trigger, menu, {
    width: 208, fallbackH: 160, align: "end",
    onOpen: () => { renderList(); input.focus(); },
  });
  saveBtn.addEventListener("click", doSave);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSave(); });
  return menuPop;
};
