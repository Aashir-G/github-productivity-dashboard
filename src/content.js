const CARD_ID = "ghpd-card";

function parseUsernameFromPath() {
  const parts = location.pathname.split("/").filter(Boolean);
  return parts[0] || null;
}

function createCardShell() {
  const card = document.createElement("section");
  card.id = CARD_ID;
  card.setAttribute("aria-label", "GitHub Productivity Dashboard");
  card.innerHTML = `
    <div class="ghpd-head">
      <div>
        <div class="ghpd-title">Productivity Dashboard</div>
        <div class="ghpd-sub">14-day snapshot</div>
      </div>
      <div class="ghpd-badge" id="ghpd-badge">Loading</div>
    </div>

    <div class="ghpd-grid">
      <div class="ghpd-metric">
        <div class="ghpd-k">Contributions</div>
        <div class="ghpd-v" id="m-contrib">–</div>
        <div class="ghpd-mini" id="m-breakdown">–</div>
      </div>
      <div class="ghpd-metric">
        <div class="ghpd-k">Best Streak</div>
        <div class="ghpd-v" id="m-streak">–</div>
        <div class="ghpd-mini">consecutive days</div>
      </div>
      <div class="ghpd-metric">
        <div class="ghpd-k">Best Day</div>
        <div class="ghpd-v" id="m-best">–</div>
        <div class="ghpd-mini" id="m-bestcount">–</div>
      </div>
    </div>

    <div class="ghpd-chart">
      <div class="ghpd-chart-title">Contribution trend (14 days)</div>
      <div class="ghpd-bars" id="bars" role="img" aria-label="14-day contribution chart"></div>
    </div>

    <div class="ghpd-insights">
      <div class="ghpd-insight">
        <span class="ghpd-label">Commits:</span>
        <span class="ghpd-val" id="m-commits">–</span>
      </div>
      <div class="ghpd-insight">
        <span class="ghpd-label">PRs:</span>
        <span class="ghpd-val" id="m-prs">–</span>
      </div>
      <div class="ghpd-insight">
        <span class="ghpd-label">Reviews:</span>
        <span class="ghpd-val" id="m-reviews">–</span>
      </div>
      <div class="ghpd-insight">
        <span class="ghpd-label">Consistency:</span>
        <span class="ghpd-val" id="m-consistency">–</span>
      </div>
    </div>

    <div class="ghpd-foot" id="foot">Analyzing activity...</div>
  `;
  return card;
}

function mountInLeftColumn(card) {
  const leftColumn = document.querySelector(".Layout-sidebar");
  const main = document.querySelector("main");

  if (leftColumn) {
    leftColumn.prepend(card);
  } else if (main) {
    main.prepend(card);
  } else {
    document.body.prepend(card);
  }
}

function removeCard() {
  const existing = document.getElementById(CARD_ID);
  if (existing) existing.remove();
}

function render(card, payload, source) {
  const { metrics, rate, fetchedAt } = payload;

  // Main metrics
  card.querySelector("#m-contrib").textContent = String(metrics.totals.contributions);
  card.querySelector("#m-breakdown").textContent = 
    `${metrics.totals.commits} commits • ${metrics.totals.prs} PRs • ${metrics.totals.issues} issues`;

  card.querySelector("#m-streak").textContent = `${metrics.bestStreak}`;
  
  card.querySelector("#m-best").textContent = metrics.bestDay;
  card.querySelector("#m-bestcount").textContent = `${metrics.bestDayCount} contributions`;

  // Extended metrics
  card.querySelector("#m-commits").textContent = String(metrics.totals.commits);
  card.querySelector("#m-prs").textContent = String(metrics.totals.prs);
  card.querySelector("#m-reviews").textContent = String(metrics.totals.reviews);
  card.querySelector("#m-consistency").textContent = `${metrics.consistency}%`;

  // Badge
  const badge = card.querySelector("#ghpd-badge");
  badge.textContent = source === "cache" ? "Cached" : "Live";
  badge.className = `ghpd-badge ${source === "cache" ? "ghpd-cached" : "ghpd-live"}`;

  // Chart
  const barsEl = card.querySelector("#bars");
  const fragment = document.createDocumentFragment();

  const days = metrics.windowDays;
  const counts = metrics.contributionsPerDay;
  const max = Math.max(1, ...days.map(d => counts[d] || 0));

  for (const d of days) {
    const c = counts[d] || 0;
    const bar = document.createElement("div");
    bar.className = "ghpd-bar";
    bar.style.height = `${Math.round((c / max) * 100)}%`;
    bar.setAttribute("title", `${d}: ${c} contributions`);
    bar.setAttribute("aria-label", `${d}: ${c} contributions`);
    fragment.appendChild(bar);
  }

  barsEl.innerHTML = "";
  barsEl.appendChild(fragment);

  // Footer
  const rem = rate?.remaining ?? "?";
  const timestamp = new Date(fetchedAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
  
  card.querySelector("#foot").textContent = 
    `Updated ${timestamp} • API calls: ${rem} remaining`;
}

function renderError(card, message) {
  card.querySelector("#ghpd-badge").textContent = "Error";
  card.querySelector("#ghpd-badge").className = "ghpd-badge ghpd-error";
  card.querySelector("#foot").textContent = message;
  
  // Clear metrics
  card.querySelector("#m-contrib").textContent = "–";
  card.querySelector("#m-breakdown").textContent = "–";
  card.querySelector("#m-streak").textContent = "–";
  card.querySelector("#m-best").textContent = "–";
  card.querySelector("#m-bestcount").textContent = "–";
  card.querySelector("#m-commits").textContent = "–";
  card.querySelector("#m-prs").textContent = "–";
  card.querySelector("#m-reviews").textContent = "–";
  card.querySelector("#m-consistency").textContent = "–";
  card.querySelector("#bars").innerHTML = "";
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

  try {
    const res = await chrome.runtime.sendMessage({
      type: "FETCH_ANALYTICS",
      username,
      days: 14
    });

    if (!res?.ok) {
      renderError(card, res?.error || "Failed to load data");
      return;
    }

    render(card, res.payload, res.source);
  } catch (err) {
    renderError(card, `Error: ${err.message || "Unknown error"}`);
  }
}

// Re-run when user toggles overlay
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.overlay_enabled) {
    injectIfEnabled();
  }
});

// Initial run
injectIfEnabled();

// Re-inject on navigation (for SPAs)
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    injectIfEnabled();
  }
}).observe(document, { subtree: true, childList: true });