let currentDays = 7;
let currentCtx = null;
let lastPayload = null;

// ========== Typewriter Effect ==========
function typewriter(el, text, speed = 38) {
  el.innerHTML = "";
  const cursor = document.createElement("span");
  cursor.className = "cursor";
  cursor.textContent = "▌";
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
  void content.offsetWidth;
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
  document.getElementById("m-pushes").textContent = "...";
  document.getElementById("m-beststreak").textContent = "...";
  document.getElementById("m-best").textContent = "...";
  document.getElementById("m-bestcount").textContent = "...";
  document.getElementById("m-avgpushes").textContent = "...";
  document.getElementById("m-consistency").textContent = "...";
  document.getElementById("bars").innerHTML = "";
  document.getElementById("foot").textContent = "Loading data...";
}

function showError(message) {
  document.getElementById("m-pushes").textContent = "-";
  document.getElementById("m-beststreak").textContent = "-";
  document.getElementById("m-best").textContent = "-";
  document.getElementById("m-bestcount").textContent = "-";
  document.getElementById("m-avgpushes").textContent = "-";
  document.getElementById("m-consistency").textContent = "-";
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
    const pushes = perDay[day] || 0;

    tip.textContent = `${day} • ${pushes} contribution${pushes === 1 ? '' : 's'}`;
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

// ========== Languages Display ==========
function renderLanguages(languages) {
  const wrap = document.getElementById("stackChips");
  const fragment = document.createDocumentFragment();

  if (!languages || !languages.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No languages detected";
    fragment.appendChild(empty);
  } else {
    languages.forEach((lang) => {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.textContent = lang;
      fragment.appendChild(chip);
    });
  }

  wrap.innerHTML = "";
  wrap.appendChild(fragment);
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
    showError("Open a GitHub profile, then click Analyze profile.");
    return;
  }

  currentCtx = ctx;
  await analyzeUsername(ctx.username);
}

async function analyzeUsername(username) {
  setContextPill(currentCtx || { username, repo: null });
  showLoadingSkeleton();

  try {
    console.log(`[UI] Requesting analytics for ${username}...`);
    
    const res = await chrome.runtime.sendMessage({
      type: "FETCH_ANALYTICS",
      username,
      days: currentDays
    });

    console.log("[UI] Response:", res);

    if (!res?.ok) {
      showError(res?.error || "Failed to load data. Please try again.");
      return;
    }

    if (!res.payload?.metrics) {
      showError("Invalid data received from service worker");
      console.error("[UI] Payload:", res.payload);
      return;
    }

    const { metrics, languages, rate, fetchedAt } = res.payload;
    lastPayload = res.payload;

    // Main metrics - using contributions
    document.getElementById("m-pushes").textContent = fmt(metrics.totals.pushes);
    document.getElementById("m-beststreak").textContent = `${metrics.bestStreak} day${metrics.bestStreak === 1 ? '' : 's'}`;
    document.getElementById("m-best").textContent = metrics.bestDay;
    document.getElementById("m-bestcount").textContent = `${metrics.bestDayCount} contribution${metrics.bestDayCount === 1 ? '' : 's'}`;

    // Trend chart - using contributions
    renderBars(metrics.windowDays, metrics.pushesPerDay);
    attachBarTooltip(metrics.windowDays, metrics.pushesPerDay);

    // Insights
    document.getElementById("m-avgpushes").textContent = metrics.avgPushesPerDay.toFixed(1);
    document.getElementById("m-consistency").textContent = `${metrics.consistency}%`;
    setConsistencyUI(metrics.consistency);

    // Languages
    renderLanguages(languages);

    // Footer
    const source = res.source === "cache" ? "cached" : "live";
    const rem = rate?.remaining ?? "?";
    const timestamp = new Date(fetchedAt).toLocaleString();
    document.getElementById("foot").textContent = 
      `${source} • ${timestamp} • API: ${rem} remaining`;

    // Update recent profiles
    const recent = await pushRecentUser(username);
    renderRecentList(recent);

  } catch (err) {
    console.error("[UI] Error:", err);
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
    statusEl.textContent = res.ok ? "✓ Token saved" : `Error: ${res.error}`;
    
    setTimeout(() => {
      statusEl.textContent = "";
    }, 3000);
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
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
  const lines = ["Date,Pushes"];
  
  for (const day of metrics.windowDays) {
    lines.push([
      day,
      metrics.pushesPerDay[day] || 0
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
  const confirmed = confirm("Clear all cached data?");
  if (!confirmed) return;

  try {
    const res = await chrome.runtime.sendMessage({ type: "CLEAR_CACHE" });
    if (res?.ok) {
      alert(`Cleared ${res.cleared} cached entries`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
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

document.getElementById("btnManualAnalyze")?.addEventListener("click", async () => {
  const username = document.getElementById("usernameInput").value.trim();
  if (!username) {
    alert("Please enter a GitHub username");
    return;
  }
  if (!/^[a-zA-Z0-9-]+$/.test(username)) {
    alert("Invalid username format. Only letters, numbers, and hyphens allowed.");
    return;
  }
  currentCtx = { username, repo: null };
  await analyzeUsername(username);
});

document.getElementById("usernameInput")?.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    document.getElementById("btnManualAnalyze").click();
  }
});

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
typewriter(document.getElementById("twTitle"), "GitHub Dashboard", 40);
setActive(".segbtn", el => Number(el.dataset.days) === currentDays);
setTopButtonActive("analyze");

getRecentUsers().then(renderRecentList);
loadToken();