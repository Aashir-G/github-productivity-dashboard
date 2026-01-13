let currentDays = 7;
let currentCtx = null; // { username, repo }
let lastPayload = null;

// ========== Typewriter Effect ==========
function typewriter(el, text, speed = 38) {
  el.innerHTML = "";
  const cursor = document.createElement("span");
  cursor.className = "cursor";
  cursor.textContent = "▍";
  el.appendChild(cursor);

  let i = 0;
  const timer = setInterval(() => {
    if (i >= text.length) {
      clearInterval(timer);
      cursor.textContent = "";
      return;
    }
    cursor.insertAdjacentText("beforebegin", text[i]);
    i++;
  }, speed);
}

// ========== URL Parsing ==========
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

// ========== UI State Management ==========
function setActive(selector, matchFn) {
  document.querySelectorAll(selector).forEach(el => {
    el.classList.toggle("active", matchFn(el));
  });
}

function setTopButtonActive(which) {
  document.getElementById("btnAnalyze").classList.toggle("active", which === "analyze");
  document.getElementById("btnRecent").classList.toggle("active", which === "recent");
}

function forceFade() {
  const content = document.getElementById("content");
  content.classList.remove("fadeIn");
  void content.offsetWidth; // Force reflow
  content.classList.add("fadeIn");
}

function showContent(panelName) {
  const content = document.getElementById("content");
  content.classList.remove("hidden");

  document.getElementById("panelAnalyze").classList.toggle("hidden", panelName !== "analyze");
  document.getElementById("panelRecent").classList.toggle("hidden", panelName !== "recent");

  forceFade();
  setTopButtonActive(panelName);
}

function fmt(n) {
  return Number.isFinite(n) ? String(n) : "-";
}

function showLoadingSkeleton() {
  document.getElementById("m-contrib").textContent = "...";
  document.getElementById("m-breakdown").textContent = "Loading...";
  document.getElementById("m-beststreak").textContent = "...";
  document.getElementById("m-best").textContent = "...";
  document.getElementById("m-bestcount").textContent = "...";
  document.getElementById("m-avgcommits").textContent = "...";
  document.getElementById("m-avgcontribs").textContent = "...";
  document.getElementById("m-consistency").textContent = "...";
  document.getElementById("m-reviews").textContent = "...";
  document.getElementById("m-comments").textContent = "...";
  document.getElementById("bars").innerHTML = "";
  document.getElementById("foot").textContent = "Loading data...";
}

function showError(message) {
  document.getElementById("m-contrib").textContent = "-";
  document.getElementById("m-breakdown").textContent = "-";
  document.getElementById("m-beststreak").textContent = "-";
  document.getElementById("m-best").textContent = "-";
  document.getElementById("m-bestcount").textContent = "-";
  document.getElementById("m-avgcommits").textContent = "-";
  document.getElementById("m-avgcontribs").textContent = "-";
  document.getElementById("m-consistency").textContent = "-";
  document.getElementById("m-reviews").textContent = "-";
  document.getElementById("m-comments").textContent = "-";
  document.getElementById("bars").innerHTML = "";
  document.getElementById("foot").textContent = message;
}

// ========== Trend Chart with Tooltips ==========
function attachBarTooltip(daysArr, perDay) {
  const barsEl = document.getElementById("bars");
  const tip = document.getElementById("tip");
  if (!barsEl || !tip) return;

  const barNodes = [...barsEl.querySelectorAll(".bar")];

  const hide = () => tip.classList.add("hidden");
  const show = (bar, idx) => {
    const day = daysArr[idx];
    const stats = perDay[day] || { contributions: 0, commits: 0, prs: 0, issues: 0, reviews: 0, comments: 0 };

    tip.textContent = `${day} • ${stats.contributions} contrib • ${stats.commits} commits • ${stats.prs} PRs • ${stats.issues} issues • ${stats.reviews} reviews • ${stats.comments} comments`;
    tip.classList.remove("hidden");

    const barsRect = barsEl.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const x = (barRect.left - barsRect.left) + (barRect.width / 2);

    tip.style.left = `${x}px`;
  };

  barNodes.forEach((bar, idx) => {
    bar.addEventListener("mouseenter", () => show(bar, idx));
    bar.addEventListener("mousemove", () => show(bar, idx));
    bar.addEventListener("mouseleave", hide);
  });

  barsEl.addEventListener("mouseleave", hide);
}

function renderBars(daysArr, values) {
  const barsEl = document.getElementById("bars");
  const fragment = document.createDocumentFragment();

  const max = Math.max(1, ...daysArr.map(d => values[d] || 0));

  for (const d of daysArr) {
    const v = values[d] || 0;
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = `${Math.round((v / max) * 100)}%`;
    fragment.appendChild(bar);
  }

  barsEl.innerHTML = "";
  barsEl.appendChild(fragment);
}

// ========== Recent Profiles ==========
async function getRecentUsers() {
  const { recent_users } = await chrome.storage.local.get(["recent_users"]);
  return Array.isArray(recent_users) ? recent_users : [];
}

async function pushRecentUser(username) {
  const list = await getRecentUsers();
  const next = [username, ...list.filter(x => x !== username)].slice(0, 20);
  await chrome.storage.local.set({ recent_users: next });
  return next;
}

async function clearRecentUsers() {
  await chrome.storage.local.set({ recent_users: [] });
}

function renderRecentList(users) {
  const list = document.getElementById("recentList");
  const fragment = document.createDocumentFragment();

  if (!users.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No recent profiles yet.";
    fragment.appendChild(empty);
  } else {
    for (const u of users) {
      const row = document.createElement("div");
      row.className = "rowitem";
      row.innerHTML = `
        <div>
          <div class="titleSm">${u}</div>
          <div class="subSm">Click to analyze</div>
        </div>
        <div class="badge">Analyze</div>
      `;
      row.addEventListener("click", async () => {
        showContent("analyze");
        currentCtx = { username: u, repo: null };
        await analyzeUsername(u);
      });
      fragment.appendChild(row);
    }
  }

  list.innerHTML = "";
  list.appendChild(fragment);
}

// ========== Tech Stacks ==========
const DEFAULT_STACKS = [
  "JavaScript", "TypeScript", "React", "Vue", "Angular", "Node.js", 
  "Python", "Java", "Go", "Rust", "C++", "C#",
  "SQL", "MongoDB", "PostgreSQL", "Redis",
  "Docker", "Kubernetes", "AWS", "Firebase", "Git"
];

async function loadStacks() {
  const { fav_stacks } = await chrome.storage.local.get(["fav_stacks"]);
  if (fav_stacks && Array.isArray(fav_stacks.items) && Array.isArray(fav_stacks.on)) {
    return fav_stacks;
  }
  return { items: DEFAULT_STACKS, on: [] };
}

async function saveStacks(stacks) {
  await chrome.storage.local.set({ fav_stacks: stacks });
}

function renderStacks(stacks) {
  const wrap = document.getElementById("stackChips");
  const fragment = document.createDocumentFragment();

  stacks.items.forEach((name) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    if (stacks.on.includes(name)) chip.classList.add("on");
    chip.textContent = name;

    chip.addEventListener("click", async () => {
      const on = new Set(stacks.on);
      if (on.has(name)) on.delete(name);
      else on.add(name);
      stacks.on = [...on];
      await saveStacks(stacks);
      renderStacks(stacks);
    });

    fragment.appendChild(chip);
  });

  wrap.innerHTML = "";
  wrap.appendChild(fragment);
}

async function addStack() {
  const input = document.getElementById("stackInput");
  const raw = input.value.trim();
  if (!raw) return;

  const stacks = await loadStacks();
  const exists = stacks.items.some(x => x.toLowerCase() === raw.toLowerCase());
  if (!exists) stacks.items = [raw, ...stacks.items].slice(0, 30);

  input.value = "";
  await saveStacks(stacks);
  renderStacks(stacks);
}

async function exportStacksAsJSON() {
  const stacks = await loadStacks();
  const activeStacks = stacks.items.filter(s => stacks.on.includes(s));
  
  const dataStr = JSON.stringify({ stacks: activeStacks }, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.download = "my-tech-stack.json";
  a.click();
  
  URL.revokeObjectURL(url);
}

// ========== Context & Analysis ==========
function setContextPill(ctx) {
  const pill = document.getElementById("ctxPill");
  if (!ctx) pill.textContent = "No profile detected";
  else pill.textContent = ctx.repo ? `${ctx.username}/${ctx.repo}` : ctx.username;
}

function setConsistencyUI(percent) {
  const arrow = document.getElementById("consArrow");
  arrow.classList.remove("good", "bad", "neutral");

  if (percent >= 70) {
    arrow.textContent = "▲";
    arrow.classList.add("good");
  } else if (percent >= 40) {
    arrow.textContent = "●";
    arrow.classList.add("neutral");
  } else {
    arrow.textContent = "▼";
    arrow.classList.add("bad");
  }
}

async function analyzeCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const ctx = tab?.url ? parseGitHubContext(tab.url) : null;

  if (!ctx) {
    setContextPill(null);
    showError("Open a GitHub profile or repo tab, then click Analyze profile.");
    return;
  }

  currentCtx = ctx;
  await analyzeUsername(ctx.username);
}

async function analyzeUsername(username) {
  setContextPill(currentCtx || { username, repo: null });
  showLoadingSkeleton();

  try {
    const res = await chrome.runtime.sendMessage({
      type: "FETCH_ANALYTICS",
      username,
      days: currentDays
    });

    if (!res?.ok) {
      showError(res?.error || "Failed to load data. Please try again.");
      return;
    }

    const { metrics, rate, fetchedAt } = res.payload;
    lastPayload = res.payload;

    // Main metrics
    document.getElementById("m-contrib").textContent = fmt(metrics.totals.contributions);
    document.getElementById("m-breakdown").textContent = 
      `${metrics.totals.commits} commits • ${metrics.totals.prs} PRs • ${metrics.totals.issues} issues`;

    document.getElementById("m-beststreak").textContent = `${metrics.bestStreak} day${metrics.bestStreak === 1 ? '' : 's'}`;
    document.getElementById("m-best").textContent = metrics.bestDay;
    document.getElementById("m-bestcount").textContent = `${metrics.bestDayCount} contributions`;

    // Trend chart
    renderBars(metrics.windowDays, metrics.contributionsPerDay);

    // Build detailed per-day stats for tooltips
    const perDay = {};
    for (const d of metrics.windowDays) {
      perDay[d] = {
        contributions: metrics.contributionsPerDay[d] || 0,
        commits: metrics.commitsPerDay[d] || 0,
        prs: metrics.prsPerDay[d] || 0,
        issues: metrics.issuesPerDay[d] || 0,
        reviews: metrics.reviewsPerDay[d] || 0,
        comments: metrics.commentsPerDay[d] || 0
      };
    }
    attachBarTooltip(metrics.windowDays, perDay);

    // Insights
    document.getElementById("m-avgcommits").textContent = metrics.avgCommitsPerDay.toFixed(1);
    document.getElementById("m-avgcontribs").textContent = metrics.avgContributionsPerDay.toFixed(1);
    document.getElementById("m-consistency").textContent = `${metrics.consistency}%`;
    setConsistencyUI(metrics.consistency);

    // Extended metrics
    document.getElementById("m-reviews").textContent = fmt(metrics.totals.reviews);
    document.getElementById("m-comments").textContent = fmt(metrics.totals.comments);

    // Footer
    const source = res.source === "cache" ? "cached" : "live";
    const rem = rate?.remaining ?? "?";
    const timestamp = new Date(fetchedAt).toLocaleString();
    document.getElementById("foot").textContent = 
      `${source} • ${timestamp} • API calls remaining: ${rem}`;

    // Update recent profiles
    const recent = await pushRecentUser(username);
    renderRecentList(recent);

  } catch (err) {
    showError(`Error: ${err.message || "Unknown error occurred"}`);
  }
}

// ========== Token Management ==========
async function loadToken() {
  const { gh_token } = await chrome.storage.sync.get(["gh_token"]);
  document.getElementById("token").value = gh_token || "";
}

async function saveToken() {
  const token = document.getElementById("token").value.trim();
  const statusEl = document.getElementById("status");
  
  try {
    const res = await chrome.runtime.sendMessage({ type: "SET_TOKEN", token });
    statusEl.textContent = res.ok ? "✓ Token saved successfully" : `Error: ${res.error}`;
    statusEl.style.color = res.ok ? "var(--good)" : "var(--bad)";
    
    setTimeout(() => {
      statusEl.textContent = "";
    }, 3000);
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.style.color = "var(--bad)";
  }
}

// ========== Data Export ==========
async function exportAnalyticsAsJSON() {
  if (!lastPayload) {
    alert("No data to export. Analyze a profile first.");
    return;
  }

  const dataStr = JSON.stringify(lastPayload, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.download = `github-analytics-${lastPayload.username}-${currentDays}d.json`;
  a.click();
  
  URL.revokeObjectURL(url);
}

async function exportAnalyticsAsCSV() {
  if (!lastPayload) {
    alert("No data to export. Analyze a profile first.");
    return;
  }

  const { metrics } = lastPayload;
  const lines = ["Date,Commits,PRs,Issues,Reviews,Comments,Total Contributions"];
  
  for (const day of metrics.windowDays) {
    lines.push([
      day,
      metrics.commitsPerDay[day] || 0,
      metrics.prsPerDay[day] || 0,
      metrics.issuesPerDay[day] || 0,
      metrics.reviewsPerDay[day] || 0,
      metrics.commentsPerDay[day] || 0,
      metrics.contributionsPerDay[day] || 0
    ].join(","));
  }

  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.download = `github-analytics-${lastPayload.username}-${currentDays}d.csv`;
  a.click();
  
  URL.revokeObjectURL(url);
}

// ========== Cache Management ==========
async function clearAllCache() {
  const confirmed = confirm("Clear all cached analytics data? You'll need to refetch from GitHub API.");
  if (!confirmed) return;

  try {
    const res = await chrome.runtime.sendMessage({ type: "CLEAR_CACHE" });
    if (res?.ok) {
      alert(`Cleared ${res.cleared} cached entries`);
    }
  } catch (err) {
    alert(`Error clearing cache: ${err.message}`);
  }
}

// ========== Event Listeners ==========
document.getElementById("btnAnalyze").addEventListener("click", async () => {
  showContent("analyze");
  await analyzeCurrentTab();
});

document.getElementById("btnRecent").addEventListener("click", async () => {
  showContent("recent");
  const users = await getRecentUsers();
  renderRecentList(users);
});

document.getElementById("refresh").addEventListener("click", async () => {
  if (currentCtx?.username) await analyzeUsername(currentCtx.username);
  else await analyzeCurrentTab();
});

document.getElementById("clearRecent").addEventListener("click", async () => {
  const confirmed = confirm("Clear all recent profiles?");
  if (!confirmed) return;
  await clearRecentUsers();
  renderRecentList([]);
});

document.getElementById("saveToken").addEventListener("click", saveToken);

document.getElementById("addStack").addEventListener("click", addStack);
document.getElementById("stackInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addStack();
});

document.getElementById("exportStacks")?.addEventListener("click", exportStacksAsJSON);
document.getElementById("exportJSON")?.addEventListener("click", exportAnalyticsAsJSON);
document.getElementById("exportCSV")?.addEventListener("click", exportAnalyticsAsCSV);
document.getElementById("clearCache")?.addEventListener("click", clearAllCache);

document.querySelectorAll(".segbtn").forEach(btn => {
  btn.addEventListener("click", async () => {
    currentDays = Number(btn.dataset.days);
    setActive(".segbtn", el => Number(el.dataset.days) === currentDays);
    if (currentCtx?.username) await analyzeUsername(currentCtx.username);
  });
});

// ========== Keyboard Shortcuts ==========
document.addEventListener("keydown", (e) => {
  if (e.key === "r" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    document.getElementById("refresh").click();
  }
  
  if (e.key === "e" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    exportAnalyticsAsJSON();
  }
});

// ========== Initialization ==========
typewriter(document.getElementById("twTitle"), "Welcome to GitHubDash!", 34);
setActive(".segbtn", el => Number(el.dataset.days) === currentDays);
setTopButtonActive("analyze");

getRecentUsers().then(renderRecentList);
loadToken();
loadStacks().then(renderStacks);