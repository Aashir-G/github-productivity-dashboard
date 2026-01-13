let currentDays = 7;
let currentCtx = null; // { username, repo }
let lastPayload = null;

function parseGitHubContext(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (!parts.length) return null;
    return { username: parts[0], repo: parts[1] || null };
  } catch {
    return null;
  }
}

function setActive(selector, matchFn) {
  document.querySelectorAll(selector).forEach(el => {
    el.classList.toggle("active", matchFn(el));
  });
}

function showPanel(name) {
  document.getElementById("panel-overview").classList.toggle("hidden", name !== "overview");
  document.getElementById("panel-trend").classList.toggle("hidden", name !== "trend");
  document.getElementById("panel-insights").classList.toggle("hidden", name !== "insights");
  document.getElementById("panel-settings").classList.toggle("hidden", name !== "settings");
  setActive(".tab", el => el.dataset.tab === name);
}

function fmt(n) {
  return Number.isFinite(n) ? String(n) : "-";
}

function dayOfWeek(isoDate) {
  // isoDate: YYYY-MM-DD
  const d = new Date(isoDate + "T00:00:00");
  return d.getDay(); // 0=Sun
}

function computeExtra(metrics) {
  const days = metrics.windowDays;
  const counts = metrics.pushesPerDay;

  let activeDays = 0;
  let total = 0;
  let weekend = 0;
  let weekday = 0;

  let peakDay = days[0];
  let peakVal = counts[peakDay] || 0;

  for (const d of days) {
    const c = counts[d] || 0;
    total += c;
    if (c > 0) activeDays += 1;

    const dow = dayOfWeek(d);
    if (dow === 0 || dow === 6) weekend += c;
    else weekday += c;

    if (c > peakVal) {
      peakVal = c;
      peakDay = d;
    }
  }

  const avg = days.length ? (total / days.length) : 0;

  // consistency score (simple): activeDays/window
  const consistency = days.length ? Math.round((activeDays / days.length) * 100) : 0;

  return { activeDays, avg, weekend, weekday, peakDay, peakVal, consistency };
}

function renderBars(daysArr, countsObj) {
  const barsEl = document.getElementById("bars");
  barsEl.innerHTML = "";
  const max = Math.max(1, ...daysArr.map(d => countsObj[d] || 0));

  for (const d of daysArr) {
    const c = countsObj[d] || 0;
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = `${Math.round((c / max) * 100)}%`;
    bar.title = `${d}: ${c} pushes`;
    barsEl.appendChild(bar);
  }
}

function renderHeatStrip(metrics) {
  // Always show 30 cells (last 30 days). If we analyzed 7/14, pad.
  const heatEl = document.getElementById("heat");
  heatEl.innerHTML = "";

  // Build last 30 days list based on today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const last30 = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    last30.push(d.toISOString().slice(0, 10));
  }

  const counts = metrics.pushesPerDay || {};
  const max = Math.max(1, ...last30.map(d => counts[d] || 0));

  for (const d of last30) {
    const c = counts[d] || 0;
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.title = `${d}: ${c} pushes`;

    // intensity buckets
    const ratio = c / max;
    if (c === 0) {
      // keep base style
    } else if (ratio <= 0.25) cell.classList.add("on1");
    else if (ratio <= 0.5) cell.classList.add("on2");
    else if (ratio <= 0.75) cell.classList.add("on3");
    else cell.classList.add("on4");

    heatEl.appendChild(cell);
  }
}

function renderTopRepos(events, username) {
  const list = document.getElementById("topRepos");
  list.innerHTML = "";

  // Count push events per repo name
  const map = new Map();
  for (const e of events) {
    if (e.type !== "PushEvent") continue;
    const repo = e.repo?.name || "";
    if (!repo) continue;
    map.set(repo, (map.get(repo) || 0) + 1);
  }

  const top = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!top.length) {
    list.innerHTML = `<div class="muted">No recent push events found.</div>`;
    return;
  }

  for (const [repo, count] of top) {
    const row = document.createElement("div");
    row.className = "rowitem";
    row.innerHTML = `
      <div class="left">
        <div class="titleSm">${repo}</div>
        <div class="subSm">Recent push activity</div>
      </div>
      <div class="badge">${count} pushes</div>
    `;
    row.addEventListener("click", () => {
      chrome.tabs.create({ url: `https://github.com/${repo}` });
    });
    list.appendChild(row);
  }
}

async function loadToken() {
  const { gh_token, auto_analyze } = await chrome.storage.sync.get(["gh_token", "auto_analyze"]);
  document.getElementById("token").value = gh_token || "";
  document.getElementById("autoAnalyze").checked = !!auto_analyze;
}

async function saveToken() {
  const token = document.getElementById("token").value.trim();
  const res = await chrome.runtime.sendMessage({ type: "SET_TOKEN", token });
  document.getElementById("status").textContent = res.ok ? "Saved token." : `Error: ${res.error}`;
}

async function setAutoAnalyze(enabled) {
  await chrome.storage.sync.set({ auto_analyze: !!enabled });
  document.getElementById("status").textContent = enabled ? "Auto-analyze enabled." : "Auto-analyze disabled.";
}

function setContextPills(ctx, rateRemaining) {
  const ctxPill = document.getElementById("ctxPill");
  const ratePill = document.getElementById("ratePill");

  if (!ctx) ctxPill.textContent = "No context";
  else ctxPill.textContent = ctx.repo ? `${ctx.username}/${ctx.repo}` : ctx.username;

  ratePill.textContent = `API: ${rateRemaining ?? "-"}`;
}

function setAvatar(url) {
  const avatar = document.getElementById("avatar");
  if (!url) {
    avatar.innerHTML = "🐙";
    return;
  }
  avatar.innerHTML = `<img src="${url}" alt="avatar">`;
}

function renderRecentUsers(users) {
  const list = document.getElementById("recentUsers");
  list.innerHTML = "";

  if (!users.length) {
    list.innerHTML = `<div class="muted">No recent users yet.</div>`;
    return;
  }

  for (const u of users.slice(0, 6)) {
    const row = document.createElement("div");
    row.className = "rowitem";
    row.innerHTML = `
      <div class="left">
        <div class="titleSm">${u}</div>
        <div class="subSm">Click to analyze</div>
      </div>
      <div class="badge">Analyze</div>
    `;
    row.addEventListener("click", async () => {
      currentCtx = { username: u, repo: null };
      await analyzeUsername(u);
      showPanel("overview");
    });
    list.appendChild(row);
  }
}

async function pushRecentUser(username) {
  const key = "recent_users";
  const { [key]: arr } = await chrome.storage.local.get([key]);
  const list = Array.isArray(arr) ? arr : [];
  const next = [username, ...list.filter(x => x !== username)].slice(0, 10);
  await chrome.storage.local.set({ [key]: next });
  renderRecentUsers(next);
}

async function loadRecentUsers() {
  const { recent_users } = await chrome.storage.local.get(["recent_users"]);
  renderRecentUsers(Array.isArray(recent_users) ? recent_users : []);
}

async function analyzeCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const ctx = tab?.url ? parseGitHubContext(tab.url) : null;

  if (!ctx) {
    document.getElementById("foot").textContent = "Open a GitHub profile or repo, then click Analyze.";
    setContextPills(null, null);
    setAvatar(null);
    return;
  }

  currentCtx = ctx;
  await analyzeUsername(ctx.username);
}

async function analyzeUsername(username) {
  // reset
  document.getElementById("foot").textContent = "Loading...";
  document.getElementById("trendFoot").textContent = "";
  document.getElementById("insFoot").textContent = "Generating insights...";
  document.getElementById("exportStatus").textContent = "";

  // Fetch analytics (cached by worker)
  const res = await chrome.runtime.sendMessage({
    type: "FETCH_ANALYTICS",
    username,
    days: currentDays
  });

  if (!res?.ok) {
    document.getElementById("foot").textContent = res?.error || "Failed to load.";
    return;
  }

  const { metrics, rate, fetchedAt } = res.payload;
  lastPayload = res.payload;

  // Set pills and footer
  setContextPills(currentCtx || { username, repo: null }, rate?.remaining);
  document.getElementById("foot").textContent =
    `Updated ${new Date(fetchedAt).toLocaleString()} • API remaining: ${rate?.remaining ?? "-"}`;

  document.getElementById("trendFoot").textContent = `Showing last ${currentDays} days for ${username}`;

  // KPIs
  document.getElementById("m-pushes").textContent = fmt(metrics.pushesInWindow);
  document.getElementById("m-streak").textContent =
    `${metrics.streakDays} day${metrics.streakDays === 1 ? "" : "s"}`;
  document.getElementById("m-best").textContent =
    `${metrics.bestDay} (${metrics.bestDayCount})`;

  const extra = computeExtra(metrics);
  document.getElementById("m-active").textContent = fmt(extra.activeDays);
  document.getElementById("m-avg").textContent = extra.avg.toFixed(1);

  // Insights tab
  document.getElementById("m-weekend").textContent = fmt(extra.weekend);
  document.getElementById("m-weekday").textContent = fmt(extra.weekday);
  document.getElementById("m-peak").textContent = `${extra.peakDay} (${extra.peakVal})`;
  document.getElementById("m-consistency").textContent = `${extra.consistency}% active`;
  document.getElementById("insFoot").textContent = "Tip: add a token to increase rate limits.";

  // Trend tab chart
  renderBars(metrics.windowDays, metrics.pushesPerDay);

  // Heat strip (nice filler)
  renderHeatStrip(metrics);

  // Top repos + avatar (need events + user)
  // We already have events in service worker but not returning them.
  // MVP approach: infer top repos by re-fetching minimal from GitHub DOM? Not reliable.
  // So we’ll do a lightweight extra fetch via public API through the worker by using existing cached events:
  // Quick workaround: compute top repos by checking GitHub page is on username/repo. If not, show a placeholder.
  // Instead, we’ll populate top repos by parsing pushes from metrics days only (no repo names).
  // To still look “product-like”, we show profile/repo shortcuts and recent users list.
  document.getElementById("topRepos").innerHTML =
    `<div class="muted">Next upgrade: show per-repo breakdown (PRs + pushes) by fetching repos endpoint.</div>`;

  // Set avatar from GitHub (simple fetch to user API)
  // Use browser fetch directly (public, no token needed). If rate limited, it just falls back.
  try {
    const r = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`);
    if (r.ok) {
      const u = await r.json();
      setAvatar(u.avatar_url);
    } else {
      setAvatar(null);
    }
  } catch {
    setAvatar(null);
  }

  // Save recent user list
  await pushRecentUser(username);

  // repoLink: point to your repo (edit this to your actual repo later)
  const repoLink = document.getElementById("repoLink");
  repoLink.href = "https://github.com/yourusername/github-productivity-dashboard";
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function buildSummaryText() {
  if (!lastPayload) return "No data yet. Click Analyze.";
  const { username, days, metrics } = lastPayload;
  return `GitHubDash: ${username} • ${days}d • Pushes=${metrics.pushesInWindow}, Streak=${metrics.streakDays}d, Best=${metrics.bestDay} (${metrics.bestDayCount})`;
}

function buildResumeBullet() {
  if (!lastPayload) return "Built a GitHub productivity dashboard Chrome extension using the GitHub REST API.";
  const { username, days, metrics } = lastPayload;
  return `Built a Chrome Extension (Side Panel) that visualizes GitHub activity using the GitHub REST API, surfacing ${metrics.pushesInWindow} pushes over ${days} days with streak + trend insights for rapid productivity review.`;
}

function buildMarkdownSummary() {
  if (!lastPayload) return "No data yet.";
  const { username, days, metrics, fetchedAt } = lastPayload;
  return `## GitHubDash Summary

- **User:** ${username}
- **Window:** last ${days} days
- **Pushes:** ${metrics.pushesInWindow}
- **Streak:** ${metrics.streakDays} days
- **Best day:** ${metrics.bestDay} (${metrics.bestDayCount})
- **Updated:** ${new Date(fetchedAt).toLocaleString()}
`;
}

// Quick actions
document.getElementById("openProfile").addEventListener("click", async () => {
  if (!currentCtx?.username) return;
  chrome.tabs.create({ url: `https://github.com/${currentCtx.username}` });
});

document.getElementById("openRepo").addEventListener("click", async () => {
  if (!currentCtx?.username || !currentCtx?.repo) return;
  chrome.tabs.create({ url: `https://github.com/${currentCtx.username}/${currentCtx.repo}` });
});

document.getElementById("copySummary").addEventListener("click", async () => {
  const ok = await copyText(buildSummaryText());
  document.getElementById("exportStatus").textContent = ok ? "Copied summary." : "Copy failed.";
});

// Export buttons
document.getElementById("copyBullet").addEventListener("click", async () => {
  const ok = await copyText(buildResumeBullet());
  document.getElementById("exportStatus").textContent = ok ? "Copied resume bullet." : "Copy failed.";
});

document.getElementById("copyMarkdown").addEventListener("click", async () => {
  const ok = await copyText(buildMarkdownSummary());
  document.getElementById("exportStatus").textContent = ok ? "Copied markdown summary." : "Copy failed.";
});

// Tabs
document.querySelectorAll(".tab").forEach(t => {
  t.addEventListener("click", () => showPanel(t.dataset.tab));
});

// Segment window buttons
document.querySelectorAll(".segbtn").forEach(btn => {
  btn.addEventListener("click", async () => {
    currentDays = Number(btn.dataset.days);
    setActive(".segbtn", el => Number(el.dataset.days) === currentDays);
    if (currentCtx?.username) await analyzeUsername(currentCtx.username);
  });
});

// Primary actions
document.getElementById("analyze").addEventListener("click", analyzeCurrentTab);
document.getElementById("refresh").addEventListener("click", () => {
  if (currentCtx?.username) analyzeUsername(currentCtx.username);
  else analyzeCurrentTab();
});

// Settings
document.getElementById("saveToken").addEventListener("click", saveToken);
document.getElementById("autoAnalyze").addEventListener("change", (e) => {
  setAutoAnalyze(e.target.checked);
});

// Auto-analyze when switching to a GitHub tab
chrome.tabs.onActivated.addListener(async () => {
  const { auto_analyze } = await chrome.storage.sync.get(["auto_analyze"]);
  if (!auto_analyze) return;
  analyzeCurrentTab();
});

// Also when URL changes in the active tab
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  const { auto_analyze } = await chrome.storage.sync.get(["auto_analyze"]);
  if (!auto_analyze) return;

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id !== tabId) return;

  analyzeCurrentTab();
});

// Init
showPanel("overview");
setActive(".segbtn", el => Number(el.dataset.days) === currentDays);
loadToken();
loadRecentUsers();
setContextPills(null, null);
