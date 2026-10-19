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
    // top-down pool-table illustration (aria-hidden: the badge already
    // states availability) + right-edge chevron matching the reference card
    const art = document.createElement("span");
    art.className = "table-art";
    art.setAttribute("aria-hidden", "true");
    art.innerHTML =
      '<svg viewBox="0 0 120 76" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="2" y="2" width="116" height="72" rx="10" fill="#0B3D2E" />' +
      '<rect x="13" y="13" width="94" height="50" rx="4" fill="#24704F" />' +
      '<rect x="13" y="13" width="94" height="50" rx="4" fill="none" stroke="#17513A" stroke-width="2.5" />' +
      '<g fill="#05130E"><circle cx="15" cy="15" r="5.4" /><circle cx="105" cy="15" r="5.4" /><circle cx="15" cy="61" r="5.4" /><circle cx="105" cy="61" r="5.4" /><circle cx="60" cy="11.5" r="4.6" /><circle cx="60" cy="64.5" r="4.6" /></g>' +
      '<g><circle cx="45" cy="40" r="4.3" fill="#F5F3ED" /><circle cx="72" cy="31" r="4.3" fill="#D4AF37" /><circle cx="81" cy="45" r="4.3" fill="#DC2626" /></g>' +
      "</svg>";
    const go = document.createElement("span");
    go.className = "table-go";
    go.setAttribute("aria-hidden", "true");
    go.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg>';
    card.appendChild(top);
    card.appendChild(name);
    card.appendChild(sub);
    card.appendChild(art);
    card.appendChild(go);
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
