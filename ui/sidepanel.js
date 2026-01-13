let currentDays = 7;
let currentCtx = null;   // { username, repo }
let lastPayload = null;

// ---------- Typewriter ----------
function typewriter(el, text, speed = 38) {
  el.innerHTML = "";
  const cursor = document.createElement("span");
  cursor.className = "cursor";
  cursor.textContent = "▍";
  el.appendChild(document.createTextNode(""));
  el.appendChild(cursor);

  let i = 0;
  const timer = setInterval(() => {
    if (i >= text.length) {
      clearInterval(timer);
      cursor.textContent = ""; // stop cursor once done (optional)
      return;
    }
    // insert before cursor
    cursor.insertAdjacentText("beforebegin", text[i]);
    i++;
  }, speed);
}

// ---------- Helpers ----------
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

function showContent(panelName) {
  const content = document.getElementById("content");
  content.classList.remove("hidden");

  document.getElementById("panelAnalyze").classList.toggle("hidden", panelName !== "analyze");
  document.getElementById("panelRecent").classList.toggle("hidden", panelName !== "recent");
}

function fmt(n) {
  return Number.isFinite(n) ? String(n) : "-";
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------- Recent profiles ----------
async function getRecentUsers() {
  const { recent_users } = await chrome.storage.local.get(["recent_users"]);
  return Array.isArray(recent_users) ? recent_users : [];
}

async function pushRecentUser(username) {
  const list = await getRecentUsers();
  const next = [username, ...list.filter(x => x !== username)].slice(0, 12);
  await chrome.storage.local.set({ recent_users: next });
  return next;
}

async function clearRecentUsers() {
  await chrome.storage.local.set({ recent_users: [] });
}

function renderRecentList(users) {
  const list = document.getElementById("recentList");
  list.innerHTML = "";

  if (!users.length) {
    list.innerHTML = `<div class="muted">No recent profiles yet.</div>`;
    return;
  }

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
    list.appendChild(row);
  }
}

// ---------- Data / Rendering ----------
function setContextPill(ctx) {
  const pill = document.getElementById("ctxPill");
  if (!ctx) pill.textContent = "No profile detected";
  else pill.textContent = ctx.repo ? `${ctx.username}/${ctx.repo}` : ctx.username;
}

async function analyzeCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const ctx = tab?.url ? parseGitHubContext(tab.url) : null;

  if (!ctx) {
    setContextPill(null);
    document.getElementById("foot").textContent =
      "Open a GitHub profile or repo tab, then click Analyze profile.";
    return;
  }

  currentCtx = ctx;
  await analyzeUsername(ctx.username);
}

async function analyzeUsername(username) {
  setContextPill(currentCtx || { username, repo: null });

  document.getElementById("foot").textContent = "Loading...";
  document.getElementById("exportStatus").textContent = "";

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

  document.getElementById("m-pushes").textContent = fmt(metrics.pushesInWindow);
  document.getElementById("m-streak").textContent =
    `${metrics.streakDays} day${metrics.streakDays === 1 ? "" : "s"}`;
  document.getElementById("m-best").textContent =
    `${metrics.bestDay} (${metrics.bestDayCount})`;

  renderBars(metrics.windowDays, metrics.pushesPerDay);

  const rem = rate?.remaining ?? "-";
  document.getElementById("foot").textContent =
    `Updated ${new Date(fetchedAt).toLocaleString()} • API remaining: ${rem}`;

  const recent = await pushRecentUser(username);
  renderRecentList(recent);
}

function buildResumeBullet() {
  if (!lastPayload) {
    return "Built a Chrome Extension side panel that analyzes GitHub productivity using the GitHub REST API and displays streak + trend insights.";
  }
  const { username, days, metrics } = lastPayload;
  return `Built a Chrome Extension (Side Panel) using JavaScript + GitHub REST API to visualize ${days}-day activity (${metrics.pushesInWindow} pushes), streaks, and trends for rapid productivity insights.`;
}

function buildSummary() {
  if (!lastPayload) return "No data yet. Click Analyze profile.";
  const { username, days, metrics } = lastPayload;
  return `GitHubDash • ${username} • ${days}d • pushes=${metrics.pushesInWindow}, streak=${metrics.streakDays}d, best=${metrics.bestDay} (${metrics.bestDayCount})`;
}

// ---------- Settings ----------
async function loadToken() {
  const { gh_token } = await chrome.storage.sync.get(["gh_token"]);
  document.getElementById("token").value = gh_token || "";
}

async function saveToken() {
  const token = document.getElementById("token").value.trim();
  const res = await chrome.runtime.sendMessage({ type: "SET_TOKEN", token });
  document.getElementById("status").textContent = res.ok ? "Saved token." : `Error: ${res.error}`;
}

// ---------- Events ----------
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
  await clearRecentUsers();
  renderRecentList([]);
});

document.getElementById("copyBullet").addEventListener("click", async () => {
  const ok = await copyText(buildResumeBullet());
  document.getElementById("exportStatus").textContent = ok ? "Copied resume bullet." : "Copy failed.";
});

document.getElementById("copySummary").addEventListener("click", async () => {
  const ok = await copyText(buildSummary());
  document.getElementById("exportStatus").textContent = ok ? "Copied summary." : "Copy failed.";
});

document.getElementById("saveToken").addEventListener("click", saveToken);

document.querySelectorAll(".segbtn").forEach(btn => {
  btn.addEventListener("click", async () => {
    currentDays = Number(btn.dataset.days);
    setActive(".segbtn", el => Number(el.dataset.days) === currentDays);
    if (currentCtx?.username) await analyzeUsername(currentCtx.username);
  });
});

// ---------- Init ----------
typewriter(document.getElementById("twTitle"), "Welcome to GitHubDash!", 34);
setActive(".segbtn", el => Number(el.dataset.days) === currentDays);

// Load recent silently so it’s ready
getRecentUsers().then(renderRecentList);
loadToken();
