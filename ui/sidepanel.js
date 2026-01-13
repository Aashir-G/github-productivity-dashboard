let currentDays = 7;
let currentUsername = null;

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
  document.getElementById("panel-settings").classList.toggle("hidden", name !== "settings");

  setActive(".tab", el => el.dataset.tab === name);
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

async function loadToken() {
  const { gh_token } = await chrome.storage.sync.get(["gh_token"]);
  document.getElementById("token").value = gh_token || "";
}

async function saveToken() {
  const token = document.getElementById("token").value.trim();
  const res = await chrome.runtime.sendMessage({ type: "SET_TOKEN", token });
  document.getElementById("status").textContent = res.ok ? "Saved token." : `Error: ${res.error}`;
}

async function analyze() {
  document.getElementById("m-pushes").textContent = "-";
  document.getElementById("m-streak").textContent = "-";
  document.getElementById("m-best").textContent = "-";
  document.getElementById("foot").textContent = "Loading...";
  document.getElementById("trendFoot").textContent = "";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const ctx = tab?.url ? parseGitHubContext(tab.url) : null;

  if (!ctx) {
    document.getElementById("foot").textContent = "Open a GitHub profile or repo, then click Analyze.";
    return;
  }

  currentUsername = ctx.username;

  const res = await chrome.runtime.sendMessage({
    type: "FETCH_ANALYTICS",
    username: ctx.username,
    days: currentDays
  });

  if (!res?.ok) {
    document.getElementById("foot").textContent = res?.error || "Failed to load.";
    return;
  }

  const { metrics, rate, fetchedAt } = res.payload;

  document.getElementById("m-pushes").textContent = String(metrics.pushesInWindow);
  document.getElementById("m-streak").textContent =
    `${metrics.streakDays} day${metrics.streakDays === 1 ? "" : "s"}`;
  document.getElementById("m-best").textContent =
    `${metrics.bestDay} (${metrics.bestDayCount})`;

  renderBars(metrics.windowDays, metrics.pushesPerDay);

  const rem = rate?.remaining ?? "?";
  const ts = new Date(fetchedAt).toLocaleString();
  document.getElementById("foot").textContent = `Updated ${ts} • API remaining: ${rem}`;
  document.getElementById("trendFoot").textContent = `Showing last ${currentDays} days for ${ctx.username}`;

  // Optional: link to profile in bottom footer
  const repoLink = document.getElementById("repoLink");
  repoLink.href = `https://github.com/${ctx.username}`;
}

document.getElementById("analyze").addEventListener("click", analyze);
document.getElementById("refresh").addEventListener("click", analyze);
document.getElementById("saveToken").addEventListener("click", saveToken);

document.querySelectorAll(".tab").forEach(t => {
  t.addEventListener("click", () => showPanel(t.dataset.tab));
});

document.querySelectorAll(".segbtn").forEach(btn => {
  btn.addEventListener("click", () => {
    currentDays = Number(btn.dataset.days);
    setActive(".segbtn", el => Number(el.dataset.days) === currentDays);
    if (currentUsername) analyze();
  });
});

// init
showPanel("overview");
setActive(".segbtn", el => Number(el.dataset.days) === currentDays);
loadToken();
