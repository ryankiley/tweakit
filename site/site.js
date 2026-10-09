/* Docs shell runtime — copy buttons on snippets + the mobile nav drawer.
 * The copy/check icons are the kit's own (Hugeicons `copy-01` and `tick-02`, MIT — see
 * THIRD-PARTY-NOTICES.md), so the site's copy interaction matches the panels'. */
(() => {
  const ICON_COPY = '<svg class="ex-copy-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 14.5C7.5 11.2 7.5 9.55 8.53 8.53C9.55 7.5 11.2 7.5 14.5 7.5C17.8 7.5 19.45 7.5 20.47 8.53C21.5 9.55 21.5 11.2 21.5 14.5C21.5 17.8 21.5 19.45 20.47 20.47C19.45 21.5 17.8 21.5 14.5 21.5C11.2 21.5 9.55 21.5 8.53 20.47C7.5 19.45 7.5 17.8 7.5 14.5ZM7.5 16.5C6.1 16.5 5.41 16.5 4.84 16.3C3.84 15.95 3.05 15.16 2.7 14.16C2.5 13.59 2.5 12.9 2.5 11.5V9.5C2.5 6.2 2.5 4.55 3.53 3.53C4.55 2.5 6.2 2.5 9.5 2.5H11.5C12.9 2.5 13.59 2.5 14.16 2.7C15.16 3.05 15.95 3.84 16.3 4.84C16.5 5.41 16.5 6.1 16.5 7.5"/></svg>';
  const ICON_CHECK = '<svg class="ex-copy-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 14L8.5 17.5L19 6.5"/></svg>';

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
  // The dim scrim is pointer-events:none, so a dismissal tap lands on whatever sits
  // under it — intercept at capture phase: close the drawer AND swallow the click so
  // the underlying element doesn't activate (a link would navigate mid-dismiss).
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
