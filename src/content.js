function getUsernameFromGitHubPage() {
  const path = location.pathname.split("/").filter(Boolean);
  if (path.length >= 1) return path[0];
  return null;
}

function createDashboardCard() {
  const card = document.createElement("section");
  card.id = "ghpd-card";
  card.innerHTML = `
    <div class="ghpd-head">
      <div>
        <div class="ghpd-title">Productivity Dashboard</div>
        <div class="ghpd-sub">GitHub activity insights</div>
      </div>
      <div class="ghpd-badge" id="ghpd-badge">Loading</div>
    </div>

    <div class="ghpd-grid">
      <div class="ghpd-metric">
        <div class="ghpd-k">Pushes (7d)</div>
        <div class="ghpd-v" id="m-7d">–</div>
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

    <div class="ghpd-foot" id="ghpd-foot"></div>
  `;
  return card;
}

function renderDashboard(card, payload, source) {
  const { metrics, rate, fetchedAt } = payload;

  card.querySelector("#m-7d").textContent = String(metrics.pushesLast7Days);
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
  const max = Math.max(1, ...days.map(d => counts[d]));

  for (const d of days) {
    const bar = document.createElement("div");
    bar.className = "ghpd-bar";
    const h = Math.round((counts[d] / max) * 100);
    bar.style.height = `${h}%`;
    bar.title = `${d}: ${counts[d]} pushes`;
    barsEl.appendChild(bar);
  }

  const rem = rate?.remaining ?? "?";
  card.querySelector("#ghpd-foot").textContent =
    `Updated ${new Date(fetchedAt).toLocaleString()} • API remaining: ${rem}`;
}

function mountCard(card) {
  // Left profile column on GitHub
  const leftColumn = document.querySelector(".Layout-sidebar");

  // Main content fallback
  const main = document.querySelector("main");

  // Force positioning so it never overlaps
  card.style.position = "relative";
  card.style.maxWidth = "280px";
  card.style.marginBottom = "16px";

  if (leftColumn) {
    leftColumn.prepend(card);
  } else if (main) {
    main.prepend(card);
  } else {
    document.body.prepend(card);
  }
}

(async function init() {
  if (location.hostname !== "github.com") return;

  const username = getUsernameFromGitHubPage();
  if (!username) return;

  if (document.getElementById("ghpd-card")) return;

  const card = createDashboardCard();
  mountCard(card);

  const res = await chrome.runtime.sendMessage({ type: "FETCH_ANALYTICS", username });

  if (!res?.ok) {
    card.querySelector("#ghpd-badge").textContent = "Error";
    card.querySelector("#ghpd-foot").textContent = res?.error || "Failed to load analytics.";
    return;
  }

  renderDashboard(card, res.payload, res.source);
})();
