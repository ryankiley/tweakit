/* Docs shell runtime — copy buttons on snippets + the mobile nav drawer.
 * The copy/check icons are the kit's own (Lucide, ISC — see THIRD-PARTY-NOTICES.md),
 * so the site's copy interaction matches the panels'. */
(() => {
  const ICON_COPY = '<svg class="ex-copy-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const ICON_CHECK = '<svg class="ex-copy-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

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
  menu && menu.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!document.body.classList.contains("nav-open"));
  });
  document.addEventListener("click", (e) => {
    if (document.body.classList.contains("nav-open") && !e.target.closest(".sb")) setOpen(false);
  });
})();
