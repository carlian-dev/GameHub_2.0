// js/tables-public.js - CU-002 live available-tables section on the landing page.
// Pair: index.html #tables section <-> GET /api/tables/availability (no login).
// Apple-design notes: keyed DOM (polls never flash existing cards), staggered
// critically-damped entrances on one path (rise+fade, no bounce — no gesture
// momentum here), skeleton on first load, press-down feedback via CSS,
// transform/opacity-only animation, reduced-motion respected.
(function () {
  const section = document.getElementById("tables");
  const countEl = document.getElementById("tablesCount");
  const gridEl = document.getElementById("tablesGrid");
  const updatedEl = document.getElementById("tablesUpdated");
  const errorEl = document.getElementById("tablesError");
  const liveEl = document.getElementById("liveLabel");
  if (!section || !countEl || !gridEl) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const seen = new Map(); // id -> card element (stable across polls)
  let firstLoad = true;

  function setState(state, label) {
    section.dataset.state = state;
    if (liveEl) liveEl.textContent = label;
  }

  function fadeSwap(el, text) {
    if (reduceMotion || !el.animate) {
      el.textContent = text;
      return;
    }
    el.animate(
      [{ opacity: 0.25 }, { opacity: 1 }],
      { duration: 220, easing: "ease-out" }
    );
    el.textContent = text;
  }

  function skeleton() {
    gridEl.innerHTML = "";
    seen.clear();
    for (let i = 0; i < 6; i++) {
      const s = document.createElement("div");
      s.className = "table-card is-skeleton";
      s.setAttribute("aria-hidden", "true");
      const l = document.createElement("span");
      l.className = "skel-line";
      const p = document.createElement("span");
      p.className = "skel-pill";
      s.appendChild(l);
      s.appendChild(p);
      gridEl.appendChild(s);
    }
  }

  function buildCard(t, index) {
    const card = document.createElement("div");
    card.className = "table-card";
    const top = document.createElement("div");
    top.className = "table-top";
    const dot = document.createElement("span");
    dot.className = "table-dot";
    dot.setAttribute("aria-hidden", "true");
    const badge = document.createElement("span");
    badge.className = "table-badge";
    badge.textContent = "Available";
    top.appendChild(dot);
    top.appendChild(badge);
    const name = document.createElement("strong");
    name.className = "table-name";
    name.textContent = t.name;
    const sub = document.createElement("span");
    sub.className = "table-sub";
    sub.textContent = "Open now · walk-ins welcome";
    card.appendChild(top);
    card.appendChild(name);
    card.appendChild(sub);
    if (!reduceMotion) {
      card.style.animationDelay = `${Math.min(index * 45, 360)}ms`;
      card.classList.add("is-entering");
    }
    return card;
  }

  function paint(tables) {
    // First real data replaces the skeleton placeholders.
    gridEl.querySelectorAll(".is-skeleton").forEach((s) => s.remove());
    const ids = new Set(tables.map((t) => t.id));
    // Exit along the same path cards entered (sink + fade).
    for (const [id, el] of seen) {
      if (!ids.has(id)) {
        seen.delete(id);
        if (reduceMotion) {
          el.remove();
        } else {
          el.classList.add("is-leaving");
          window.setTimeout(() => el.remove(), 220);
        }
      }
    }
    if (tables.length === 0) {
      gridEl.innerHTML = "";
      seen.clear();
      const empty = document.createElement("div");
      empty.className = "tables-empty";
      const big = document.createElement("strong");
      big.textContent = "All tables are in play";
      const small = document.createElement("span");
      small.textContent = "Check back shortly — this updates every 30 seconds.";
      empty.appendChild(big);
      empty.appendChild(small);
      gridEl.appendChild(empty);
      fadeSwap(countEl, "Nothing open right now");
      return;
    }
    // Reorder stable nodes to server order without re-animating them.
    tables.forEach((t, i) => {
      let el = seen.get(t.id);
      if (!el) {
        el = buildCard(t, i);
        seen.set(t.id, el);
      } else {
        el.querySelector(".table-name").textContent = t.name;
        el.classList.remove("is-entering");
      }
      gridEl.appendChild(el);
    });
    fadeSwap(countEl, `${tables.length} table${tables.length === 1 ? "" : "s"} open now`);
  }

  async function load(quiet = false) {
    if (!quiet) {
      setState("checking", "Checking");
      if (firstLoad) {
        countEl.textContent = "Finding open tables…";
        skeleton();
      }
      errorEl.hidden = true;
    }
    try {
      const { tables } = await listPublicTables();
      paint(tables || []);
      updatedEl.textContent =
        `Updated ${new Date().toLocaleTimeString()} · auto-refresh 30s`;
      errorEl.hidden = true;
      setState("live", "Live");
      firstLoad = false;
    } catch (e) {
      if (!quiet) {
        gridEl.innerHTML = "";
        seen.clear();
        countEl.textContent = "Live availability is unavailable right now.";
      } else {
        updatedEl.textContent = "Reconnecting…";
      }
      errorEl.textContent = `${e.message} `;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "tables-retry";
      retry.textContent = "Retry";
      retry.addEventListener("click", () => load());
      errorEl.appendChild(retry);
      errorEl.hidden = false;
      setState("offline", "Offline");
      firstLoad = false;
    }
  }

  load();
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    load(true);
  }, 30000);
})();
