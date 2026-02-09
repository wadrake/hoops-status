const $ = (sel) => document.querySelector(sel);

const state = {
  data: null,
  q: "",
  status: "ALL",
  team: "ALL",
  sortBy: "UPDATED_DESC",
  apiNote: null
};

function loadTheme() {
  const saved = localStorage.getItem("hs_theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  updateThemeButton();
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  const next = cur === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("hs_theme", next);
  updateThemeButton();
}

function updateThemeButton() {
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  $("#themeToggle").textContent = cur === "light" ? "Dark" : "Light";
}

function fmtRelative(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

function badge(status) {
  const safe = String(status || "—").toUpperCase();
  return `
    <span class="badge status-${safe}">
      <span class="dot" aria-hidden="true"></span>
      <span>${safe}</span>
    </span>
  `;
}

function sortItems(items) {
  const copy = [...items];
  const by = state.sortBy;

  const statusOrder = { OUT: 0, DOUBTFUL: 1, QUESTIONABLE: 2, PROBABLE: 3 };

  copy.sort((a, b) => {
    if (by === "UPDATED_DESC") return new Date(b.updated_iso) - new Date(a.updated_iso);
    if (by === "UPDATED_ASC") return new Date(a.updated_iso) - new Date(b.updated_iso);
    if (by === "PLAYER_ASC") return (a.player || "").localeCompare(b.player || "");
    if (by === "TEAM_ASC") return (a.team || "").localeCompare(b.team || "");
    if (by === "STATUS_ASC") return (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
    return 0;
  });

  return copy;
}

function applyFilters(items) {
  const q = state.q.trim().toLowerCase();

  return items.filter((it) => {
    const player = (it.player || "").toLowerCase();
    const matchesQ = !q || player.includes(q);

    const st = String(it.status || "").toUpperCase();
    const matchesStatus = state.status === "ALL" || st === state.status;

    const matchesTeam = state.team === "ALL" || it.team === state.team;

    return matchesQ && matchesStatus && matchesTeam;
  });
}

function renderTable(tableEl, emptyEl, rows) {
  const tbody = tableEl.querySelector("tbody");
  tbody.innerHTML = "";

  if (!rows.length) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  for (const it of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(it.player)}</strong></td>
      <td>${escapeHtml(it.team)}</td>
      <td>${escapeHtml(it.injury)}</td>
      <td>${badge(it.status)}</td>
      <td>${escapeHtml(it.expected_return || "—")}</td>
      <td class="muted" title="${escapeHtml(it.updated_iso)}">${fmtRelative(it.updated_iso)}</td>
    `;
    tbody.appendChild(tr);
  }
}

function populateTeamFilter(items) {
  const teams = Array.from(new Set(items.map((x) => x.team).filter(Boolean))).sort();
  const sel = $("#teamFilter");

  // preserve "All Teams" option
  sel.querySelectorAll("option:not([value='ALL'])").forEach((o) => o.remove());

  for (const t of teams) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    sel.appendChild(opt);
  }
}

function updateMeta(totalRows, filteredRows) {
  const lr = state.data?.last_refreshed_iso;

  $("#lastRefreshedPill").textContent =
    `Last refreshed: ${lr ? new Date(lr).toLocaleString() : "—"}`;

  $("#rowsPill").textContent = `Players: ${filteredRows} / ${totalRows}`;

  // Optional: show provider note if present (won't break if element doesn't exist)
  const noteEl = document.getElementById("apiNote");
  if (noteEl) {
    if (state.apiNote) {
      noteEl.textContent = state.apiNote;
      noteEl.hidden = false;
    } else {
      noteEl.hidden = true;
    }
  }
}

function normalizeIncoming(payload) {
  // Ensure shape: { last_refreshed_iso, items: [] }
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const normalizedItems = items.map((it) => ({
    player: it.player ?? "Unknown",
    team: it.team ?? "—",
    injury: it.injury ?? "—",
    status: String(it.status ?? "QUESTIONABLE").toUpperCase(),
    expected_return: it.expected_return ?? "—",
    updated_iso: it.updated_iso ?? new Date().toISOString()
  }));

  return {
    last_refreshed_iso: payload?.last_refreshed_iso ?? null,
    items: normalizedItems,
    note: payload?.note ?? null
  };
}

function render() {
  const all = state.data?.items || [];
  const filtered = applyFilters(all);
  const sorted = sortItems(filtered);

  const outTonight = sortItems(all.filter((x) => String(x.status).toUpperCase() === "OUT"));

  renderTable($("#injuriesTable"), $("#injuriesEmpty"), sorted);
  renderTable($("#outTonightTable"), $("#outTonightEmpty"), outTonight);

  updateMeta(all.length, sorted.length);
}

/**
 * Fetch injuries.
 * - Production: hits /api/nba/injuries (Cloudflare Worker route)
 * - Local dev fallback: ./injuries.json
 */
async function fetchInjuries() {
  // Try API route first
  try {
    const res = await fetch("/api/nba/injuries", { cache: "no-store" });
    if (!res.ok) throw new Error(`API error ${res.status}`);

    const payload = await res.json();
    const normalized = normalizeIncoming(payload);

    state.apiNote = normalized.note;
    state.data = normalized;

    populateTeamFilter(state.data.items || []);
    return;
  } catch (err) {
    // Fallback to local file for localhost development
    const res2 = await fetch("./injuries.json", { cache: "no-store" });
    if (!res2.ok) {
      const text2 = await res2.text().catch(() => "");
      throw new Error(`Fallback failed ${res2.status}: ${text2.slice(0, 200)}`);
    }

    const payload2 = await res2.json();
    const normalized2 = normalizeIncoming(payload2);

    state.apiNote =
      normalized2.note ||
      "Local mode: loaded ./injuries.json (deploy /api/nba/injuries for auto-updates).";
    state.data = normalized2;

    populateTeamFilter(state.data.items || []);
  }
}

async function init() {
  loadTheme();
  $("#themeToggle").addEventListener("click", toggleTheme);

  $("#year").textContent = String(new Date().getFullYear());

  $("#q").addEventListener("input", (e) => {
    state.q = e.target.value || "";
    render();
  });

  $("#clearSearch").addEventListener("click", () => {
    state.q = "";
    $("#q").value = "";
    render();
  });

  $("#statusFilter").addEventListener("change", (e) => {
    state.status = e.target.value;
    render();
  });

  $("#teamFilter").addEventListener("change", (e) => {
    state.team = e.target.value;
    render();
  });

  $("#sortBy").addEventListener("change", (e) => {
    state.sortBy = e.target.value;
    render();
  });

  await fetchInjuries();
  render();

  // Auto-refresh the dashboard every 2 minutes (re-fetch latest from API or local file)
  setInterval(async () => {
    try {
      await fetchInjuries();
      render();
    } catch (e) {
      console.warn("Auto-refresh failed:", e);
    }
  }, 2 * 60 * 1000);
}

init().catch((err) => {
  console.error(err);
  alert(
    "Could not load injury data.\n\n" +
    "Local: ensure injuries.json is in the same folder and you are running a local server.\n" +
    "Deployed: ensure /api/nba/injuries is routed to your Worker."
  );
});