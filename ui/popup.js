let currentDays = 7;

function parseGitHubContext(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    return { username: parts[0], repo: parts[1] || null };
  } catch {
    return null;
  }
}

function setActiveDays(days) {
  currentDays = days;
  document.querySelectorAll(".segbtn").forEach(b => {
    b.classList.toggle("active", Number(b.dataset.days) === days);
  });
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

async function loadSettings() {
  const { gh_token, overlay_enabled } = await chrome.storage.sync.get([
    "gh_token",
    "overlay_enabled"
  ]);

  document.getElementById("token").value = gh_token || "";
  document.getElementById("overlayToggle").checked = !!overlay_enabled;
}

async function saveToken() {
  const token = document.getElementById("token").value.trim();
  const res = await chrome.runtime.sendMessage({ type: "SET_TOKEN", token });
  document.getElementById("status").textContent = res.ok ? "Saved token." : `Error: ${res.error}`;
}

async function setOverlay(enabled) {
  const res = await chrome.runtime.sendMessage({ type: "SET_OVERLAY", enabled });
  if (!res?.ok) {
    document.getElementById("status").textContent = `Error: ${res?.error || "Failed to update overlay"}`;
  } else {
    document.getElementById("status").textContent = enabled ? "Overlay enabled." : "Overlay disabled.";
  }
}

async function refresh() {
  document.getElementById("m-pushes").textContent = "–";
  document.getElementById("m-streak").textContent = "–";
  document.getElementById("m-best").textContent = "–";
  document.getElementById("foot").textContent = "";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const ctx = tab?.url ? parseGitHubContext(tab.url) : null;

  if (!ctx) {
    document.getElementById("context").textContent = "Open a GitHub profile or repo";
    return;
  }

  document.getElementById("context").textContent =
    ctx.repo ? `${ctx.username}/${ctx.repo}` : ctx.username;

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
  document.getElementById("foot").textContent =
    `Updated ${new Date(fetchedAt).toLocaleString()} • API remaining: ${rem}`;
}

document.getElementById("refresh").addEventListener("click", refresh);

document.getElementById("saveToken").addEventListener("click", saveToken);

document.getElementById("overlayToggle").addEventListener("change", (e) => {
  setOverlay(e.target.checked);
});

document.querySelectorAll(".segbtn").forEach(btn => {
  btn.addEventListener("click", () => {
    setActiveDays(Number(btn.dataset.days));
    refresh();
  });
});

// Init
setActiveDays(7);
loadSettings().then(refresh);
