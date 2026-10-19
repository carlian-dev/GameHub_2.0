// js/theme.js - dark/light toggle for non-shell pages (landing, login, register).
// Same gh-theme localStorage key as js/dash.js, so the choice follows the
// user across every page. Expects one button.theme-icon containing svg.ic-moon
// + svg.ic-sun, animated via the .is-light class (see styles.css). No API calls.
(function () {
  var root = document.documentElement;
  var btn = document.querySelector(".theme-icon");
  function apply(t) {
    root.setAttribute("data-theme", t);
    if (!btn) return;
    if (btn.classList) btn.classList.toggle("is-light", t === "light");
  }
  var theme = "light";
  try { theme = localStorage.getItem("gh-theme") || "light"; } catch (e) { /* private mode */ }
  apply(theme);
  if (btn) {
    btn.addEventListener("click", function () {
      theme = (root.getAttribute("data-theme") === "dark") ? "light" : "dark";
      try { localStorage.setItem("gh-theme", theme); } catch (e) { /* private mode */ }
      apply(theme);
    });
  }
})();
