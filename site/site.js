/* Docs shell runtime: copy buttons, code folds, heading permalinks, the mobile nav drawer.
 * The copy/check icons are the kit's own (Hugeicons); test/site.test.mjs holds them to icons.ts. */
(() => {
  const ICON_COPY = '<svg class="ex-copy-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5.5 16.5-.7-.2q-1.5-.6-2.1-2.1-.2-.7-.2-2.7v-2c0-3.3 0-5 1-6s2.7-1 6-1h2c1.4 0 2 0 2.7.2q1.6.5 2.1 2.1l.2.7"/><path d="M7.5 14.5c0-3.3 0-5 1-6s2.7-1 6-1 5 0 6 1 1 2.7 1 6 0 5-1 6-2.7 1-6 1-5 0-6-1-1-2.7-1-6"/></svg>';
  const ICON_CHECK = '<svg class="ex-copy-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 14 3.5 3.5L19 6.5"/></svg>';

  document.querySelectorAll(".ex-codewrap").forEach((wrap) => {
    const code = wrap.querySelector("code");
    if (!code) return;
    const btn = document.createElement("button");
    btn.className = "ex-copy";
    btn.type = "button";
    btn.setAttribute("aria-label", "Copy code");
    btn.innerHTML = `<span class="ex-copy-icons">${ICON_COPY}${ICON_CHECK}</span>`;
    let timer;
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.textContent);
        btn.classList.add("is-copied");
        btn.setAttribute("aria-label", "Copied");
      } catch {
        btn.setAttribute("aria-label", "Copy failed");
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        btn.classList.remove("is-copied");
        btn.setAttribute("aria-label", "Copy code");
      }, 1400);
    });
    wrap.append(btn);
  });

  // Code tabs: one block shown at a time; Left and Right arrows move between tabs.
  document.querySelectorAll(".ex-tablist").forEach((list) => {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const show = (tab) => tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute("aria-controls"));
      if (panel) panel.hidden = !on;
    });
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => show(tab));
      tab.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!d || e.altKey || e.ctrlKey || e.metaKey) return;   // Alt+Left is the browser's Back
        e.preventDefault();
        const next = tabs[(i + d + tabs.length) % tabs.length];
        show(next);
        next.focus();
      });
    });
  });

  // Closed is hidden="until-found", so find-in-page can open a fold; beforematch keeps the toggle in step.
  document.querySelectorAll(".ex-fold-toggle").forEach((btn) => {
    const body = document.getElementById(btn.getAttribute("aria-controls"));
    if (!body) return;
    const set = (open) => {
      btn.setAttribute("aria-expanded", String(open));
      if (open) body.removeAttribute("hidden"); else body.setAttribute("hidden", "until-found");
    };
    btn.addEventListener("click", () => set(btn.getAttribute("aria-expanded") !== "true")); // the page never scrolls on its own
    body.addEventListener("beforematch", () => set(true));
  });

  // Hover-revealed permalinks on anchored section headings.
  document.querySelectorAll(".ex[id] > h2").forEach((h) => {
    const a = document.createElement("a");
    a.className = "h-anchor";
    a.href = "#" + h.parentElement.id;
    a.setAttribute("aria-label", "Link to this section");
    a.textContent = "#";
    h.append(a);
  });

  const menu = document.querySelector(".topbar-menu");
  const setOpen = (open) => {
    document.body.classList.toggle("nav-open", open);
    menu && menu.setAttribute("aria-expanded", String(open));
  };
  menu && menu.addEventListener("click", () => {
    setOpen(!document.body.classList.contains("nav-open"));
  });
  // The scrim is pointer-events:none, so swallow the dismissal click at capture before what's under it activates.
  document.addEventListener("click", (e) => {
    if (!document.body.classList.contains("nav-open")) return;
    if (e.target.closest(".sb") || e.target.closest(".topbar-menu")) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("nav-open")) setOpen(false);
  });
})();
