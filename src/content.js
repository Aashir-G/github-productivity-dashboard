const CARD_ID = "ghpd-card";

function parseUsernameFromPath() {
  const parts = location.pathname.split("/").filter(Boolean);
  return parts[0] || null;
}

function createCardShell() {
  const card = document.createElement("section");
  card.id = CARD_ID;
  card.innerHTML = `
    <div class="ghpd-head">
      <div>
        <div class="ghpd-title">Productivity Dashboard</div>
        <div class="ghpd-sub">Overlay mode</div>
      </div>
      <div class="ghpd-badge" id="ghpd-badge">Loading</div>
    </div>

    <div class="ghpd-grid">
      <div class="ghpd-metric">
        <div class="ghpd-k">Pushes (14d)</div>
        <div class="ghpd-v" id="m-pushes">–</div>
      </div>
      <div class="ghpd-metric">
        <div class="ghpd-k">Streak</div>
        <div class="ghpd-v" id="m-streak">–</div>
      </div>
      <div class="ghpd-metric">
        <div class="ghpd-k">Best Day</div>
        <div class="ghpd-v" id="m-best">–</div>
      </div>
    </div>

    <div class="ghpd-chart">
      <div class="ghpd-chart-title">Last 14 days</div>
      <div class="ghpd-bars" id="bars"></div>
    </div>

    <div class="ghpd-foot" id="foot"></div>
  `;
  return card;
}

function mountInLeftColumn(card) {
  const leftColumn = document.querySelector(".Layout-sidebar");
  const main = document.querySelector("main");

  if (leftColumn) leftColumn.prepend(card);
  else if (main) main.prepend(card);
  else document.body.prepend(card);
}

function removeCard() {
  const existing = document.getElementById(CARD_ID);
  if (existing) existing.remove();
}

function render(card, payload, source) {
  const { metrics, rate, fetchedAt } = payload;

  card.querySelector("#m-pushes").textContent = String(metrics.pushesInWindow);
  card.querySelector("#m-streak").textContent =
    `${metrics.streakDays} day${metrics.streakDays === 1 ? "" : "s"}`;
  card.querySelector("#m-best").textContent =
    `${metrics.bestDay} (${metrics.bestDayCount})`;

  const badge = card.querySelector("#ghpd-badge");
  badge.textContent = source === "cache" ? "Cached" : "Live";

  const barsEl = card.querySelector("#bars");
  barsEl.innerHTML = "";

  const days = metrics.windowDays;
  const counts = metrics.pushesPerDay;
  const max = Math.max(1, ...days.map(d => counts[d] || 0));

  for (const d of days) {
    const c = counts[d] || 0;
    const bar = document.createElement("div");
    bar.className = "ghpd-bar";
    bar.style.height = `${Math.round((c / max) * 100)}%`;
    bar.title = `${d}: ${c} pushes`;
    barsEl.appendChild(bar);
  }

  const rem = rate?.remaining ?? "?";
  card.querySelector("#foot").textContent =
    `Updated ${new Date(fetchedAt).toLocaleString()} • API remaining: ${rem}`;
}

async function injectIfEnabled() {
  const { overlay_enabled } = await chrome.storage.sync.get(["overlay_enabled"]);
  if (!overlay_enabled) {
    removeCard();
    return;
  }

  if (document.getElementById(CARD_ID)) return;

  if (location.hostname !== "github.com") return;

  const username = parseUsernameFromPath();
  if (!username) return;

  const card = createCardShell();
  mountInLeftColumn(card);

  const res = await chrome.runtime.sendMessage({
    type: "FETCH_ANALYTICS",
    username,
    days: 14
  });

  if (!res?.ok) {
    card.querySelector("#ghpd-badge").textContent = "Error";
    card.querySelector("#foot").textContent = res?.error || "Failed to load.";
    return;
  }

  render(card, res.payload, res.source);
}

// Re-run when user toggles overlay
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.overlay_enabled) {
    injectIfEnabled();
  }
});

// Initial run
injectIfEnabled();
