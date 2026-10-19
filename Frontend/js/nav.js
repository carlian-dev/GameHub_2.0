// js/nav.js - landing mobile menu. Pair: index.html (hamburger .nav-toggle +
// #navLinks). Collapses to a hamburger under 760px (css/styles.css), toggles
// aria-expanded, closes on link click / Escape / resize back to desktop.
// Auth pages don't load this (single "Back to site" link just wraps).
(function () {
  var toggle = document.getElementById("navToggle");
  var menu = document.getElementById("navLinks");
  if (!toggle || !menu) return;

  function setOpen(open) {
    menu.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }

  toggle.addEventListener("click", function () {
    setOpen(!menu.classList.contains("open"));
  });
  // Close after choosing an anchor.
  menu.addEventListener("click", function (e) {
    if (e.target && e.target.tagName === "A") setOpen(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && menu.classList.contains("open")) {
      setOpen(false);
      toggle.focus();
    }
  });
  // Back to desktop widths: reset so the menu isn't stuck "open" later.
  window.addEventListener("resize", function () {
    if (window.innerWidth > 760) setOpen(false);
  });
})();
