let currentDays = 7;
let currentCtx = null; // { username, repo }
let lastPayload = null;

// ---------- Typewriter ----------
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

function setTopButtonActive(which) {
  document.getElementById("btnAnalyze").classList.toggle("active", which === "analyze");
  document.getElementById("btnRecent").classList.toggle("active", which === "recent");
}

function forceFade() {
  const content = document.getElementById("content");
  content.classList.remove("fadeIn");
  void content.offsetWidth; // reflow to restart animation
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

// ---------- Trend hover tooltip ----------
function attachBarTooltip(daysArr, perDay) {
  const barsEl = document.getElementById("bars");
  const tip = document.getElementById("tip");
  if (!barsEl || !tip) return;

  const barNodes = [...barsEl.querySelectorAll(".bar")];

  const hide = () => tip.classList.add("hidden");
  const show = (bar, idx) => {
    const day = daysArr[idx];
    const stats = perDay[day] || { contributions: 0, commits: 0, prs: 0, issues: 0 };

    tip.textContent = `${day}  •  contrib ${stats.contributions}  •  commits ${stats.commits}  •  PRs ${stats.prs}  •  issues ${stats.issues}`;
    tip.classList.remove("hidden");

    // Position tooltip above hovered bar
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
  barsEl.innerHTML = "";

  const max = Math.max(1, ...daysArr.map(d => values[d] || 0));

  for (const d of daysArr) {
    const v = values[d] || 0;
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = `${Math.round((v / max) * 100)}%`;
    barsEl.appendChild(bar);
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

// ---------- Favorite tech stacks ----------
const DEFAULT_STACKS = [
  "JavaScript", "TypeScript", "React", "Node.js", "Python", "Java",
  "SQL", "Firebase", "Chrome Extensions", "Git"
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
  wrap.innerHTML = "";

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

    wrap.appendChild(chip);
  });
}

async function addStack() {
  const input = document.getElementById("stackInput");
  const raw = input.value.trim();
  if (!raw) return;

  const stacks = await loadStacks();
  const exists = stacks.items.some(x => x.toLowerCase() === raw.toLowerCase());
  if (!exists) stacks.items = [raw, ...stacks.items].slice(0, 18);

  input.value = "";
  await saveStacks(stacks);
  renderStacks(stacks);
}

// ---------- Rendering ----------
function setContextPill(ctx) {
  const pill = document.getElementById("ctxPill");
  if (!ctx) pill.textContent = "No profile detected";
  else pill.textContent = ctx.repo ? `${ctx.username}/${ctx.repo}` : ctx.username;
}

function setConsistencyUI(percent) {
  const arrow = document.getElementById("consArrow");
  arrow.classList.remove("good", "bad");

  if (percent >= 50) {
    arrow.textContent = "▲";
    arrow.classList.add("good");
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

  // KPIs
  document.getElementById("m-contrib").textContent = fmt(metrics.totals.contributions);
  document.getElementById("m-breakdown").textContent =
    `commits ${metrics.totals.commits} • PRs ${metrics.totals.prs} • issues ${metrics.totals.issues}`;

  document.getElementById("m-beststreak").textContent = `${metrics.bestStreak} days`;
  document.getElementById("m-best").textContent = metrics.bestDay;
  document.getElementById("m-bestcount").textContent = `${metrics.bestDayCount} contributions`;

  // Trend uses contributions per day now
  renderBars(metrics.windowDays, metrics.contributionsPerDay);

  // Build per-day detailed object for tooltip
  const perDay = {};
  for (const d of metrics.windowDays) {
    perDay[d] = {
      contributions: metrics.contributionsPerDay[d] || 0,
      commits: metrics.commitsPerDay[d] || 0,
      prs: metrics.prsPerDay[d] || 0,
      issues: metrics.issuesPerDay[d] || 0
    };
  }
  attachBarTooltip(metrics.windowDays, perDay);

  // Insights
  document.getElementById("m-avgcommits").textContent = metrics.avgCommitsPerDay.toFixed(1);
  document.getElementById("m-consistency").textContent = `${metrics.consistency}%`;
  setConsistencyUI(metrics.consistency);

  const rem = rate?.remaining ?? "-";
  document.getElementById("foot").textContent =
    `Updated ${new Date(fetchedAt).toLocaleString()} • API remaining: ${rem}`;

  // Recent profiles
  const recent = await pushRecentUser(username);
  renderRecentList(recent);
}

// ---------- Token ----------
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

document.getElementById("saveToken").addEventListener("click", saveToken);

document.getElementById("addStack").addEventListener("click", addStack);
document.getElementById("stackInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addStack();
});

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
setTopButtonActive("analyze");

getRecentUsers().then(renderRecentList);
loadToken();

// stacks
loadStacks().then((stacks) => renderStacks(stacks));
