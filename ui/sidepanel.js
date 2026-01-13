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

// ========== Goal Tracking ==========
async function loadGoal(username) {
  const { goals } = await chrome.storage.local.get(["goals"]);
  return goals?.[username] || null;
}

async function saveGoal(username, goal) {
  const { goals } = await chrome.storage.local.get(["goals"]);
  const updated = { ...goals, [username]: goal };
  await chrome.storage.local.set({ goals: updated });
}

async function clearGoal(username) {
  const { goals } = await chrome.storage.local.get(["goals"]);
  if (goals && goals[username]) {
    delete goals[username];
    await chrome.storage.local.set({ goals });
  }
  document.getElementById("goalDisplay").classList.add("hidden");
  document.getElementById("goalInput").value = "";
}

function updateGoalDisplay(goal, current) {
  const display = document.getElementById("goalDisplay");
  const fill = document.getElementById("goalFill");
  const currentEl = document.getElementById("goalCurrent");
  const targetEl = document.getElementById("goalTarget");
  const statusEl = document.getElementById("goalStatus");

  display.classList.remove("hidden");
  currentEl.textContent = current;
  targetEl.textContent = goal;

  const percentage = Math.min(100, Math.round((current / goal) * 100));
  fill.style.width = `${percentage}%`;

  if (current >= goal) {
    statusEl.textContent = "🎉 Goal achieved! Keep it up!";
    statusEl.style.color = "var(--good)";
  } else {
    const remaining = goal - current;
    statusEl.textContent = `${remaining} more contribution${remaining === 1 ? '' : 's'} to reach your goal`;
    statusEl.style.color = "var(--muted)";
  }
}

// ========== Reputation Score Calculation (FIXED) ==========
function calculateReputationScore(metrics, languages, days) {
  const { totals, bestStreak, consistency, avgPushesPerDay, activeDays } = metrics;
  
  // Factor 1: Consistency (0-200 points) - BOOSTED
  let consistencyPoints = Math.min(200, Math.round(consistency * 2.5));
  
  // Factor 2: Velocity (0-200 points) - More achievable
  // Scale: 0-2/day = 0-48, 2-5/day = 48-120, 5-10/day = 120-200, 10+/day = 200
  let velocityPoints = 0;
  if (avgPushesPerDay >= 10) {
    velocityPoints = 200;
  } else if (avgPushesPerDay >= 5) {
    velocityPoints = Math.min(200, 120 + Math.round((avgPushesPerDay - 5) * 16));
  } else if (avgPushesPerDay >= 2) {
    velocityPoints = Math.min(120, 48 + Math.round((avgPushesPerDay - 2) * 24));
  } else {
    velocityPoints = Math.round(avgPushesPerDay * 24);
  }
  
  // Factor 3: Quality (0-200 points) - FIXED to reward high activity
  let qualityPoints = 0;
  if (totals.pushes > 0) {
    const commitsPerActiveDay = totals.pushes / Math.max(1, activeDays);
    // Realistic sweet spots that reward active developers
    if (commitsPerActiveDay >= 8 && commitsPerActiveDay <= 20) {
      qualityPoints = 200;
    } else if (commitsPerActiveDay >= 5 && commitsPerActiveDay <= 25) {
      qualityPoints = 185;
    } else if (commitsPerActiveDay >= 3 && commitsPerActiveDay <= 30) {
      qualityPoints = 170;
    } else if (commitsPerActiveDay >= 2) {
      qualityPoints = 155;
    } else if (commitsPerActiveDay >= 1) {
      qualityPoints = 130;
    } else {
      qualityPoints = 100;
    }
  }
  
  // Factor 4: Collaboration (0-200 points) - Enhanced
  let collaborationPoints = Math.min(200, Math.round(consistency * 1.2) + (languages.length * 18));
  
  // Factor 5: Impact (0-200 points) - Boosted
  // Combination of streak longevity and total volume
  const streakScore = Math.min(100, bestStreak * 10);
  const volumeScore = Math.min(100, Math.round(totals.pushes * 2));
  let impactPoints = Math.min(200, streakScore + volumeScore);
  
  // Calculate total score (0-1000) - sum all factors and scale
  const rawScore = consistencyPoints + velocityPoints + qualityPoints + collaborationPoints + impactPoints;
  const totalScore = Math.min(1000, Math.round(rawScore)); // Max is 1000 (5 factors × 200)
  
  // Determine tier and percentile - MORE ACHIEVABLE TIERS
  let tier, tierClass, percentile;
  if (totalScore >= 850) {
    tier = "Elite";
    tierClass = "excellent";
    percentile = 95;
  } else if (totalScore >= 700) {
    tier = "Excellent";
    tierClass = "excellent";
    percentile = 85;
  } else if (totalScore >= 550) {
    tier = "Very Good";
    tierClass = "verygood";
    percentile = 70;
  } else if (totalScore >= 400) {
    tier = "Good";
    tierClass = "good";
    percentile = 50;
  } else if (totalScore >= 250) {
    tier = "Fair";
    tierClass = "fair";
    percentile = 30;
  } else {
    tier = "Developing";
    tierClass = "poor";
    percentile = 15;
  }
  
  return {
    totalScore,
    tier,
    tierClass,
    percentile,
    factors: {
      consistency: { points: consistencyPoints, rating: getRating(consistencyPoints, 200) },
      velocity: { points: velocityPoints, rating: getRating(velocityPoints, 200) },
      quality: { points: qualityPoints, rating: getRating(qualityPoints, 200) },
      collaboration: { points: collaborationPoints, rating: getRating(collaborationPoints, 200) },
      impact: { points: impactPoints, rating: getRating(impactPoints, 200) }
    }
  };
}

function getRating(points, max) {
  const percent = (points / max) * 100;
  if (percent >= 90) return "excellent";
  if (percent >= 75) return "very good";
  if (percent >= 60) return "good";
  if (percent >= 40) return "fair";
  return "needs work";
}

function getImprovementSuggestions(score, metrics) {
  const suggestions = [];
  const { factors } = score;
  
  // Find weakest areas
  const sortedFactors = Object.entries(factors).sort((a, b) => a[1].points - b[1].points);
  
  if (factors.consistency.points < 150) {
    suggestions.push("Maintain a 25-day streak to boost consistency by 50+ points");
  }
  
  if (factors.velocity.points < 150) {
    suggestions.push("Increase to 10+ contributions per day for higher velocity");
  }
  
  if (factors.quality.points < 150) {
    suggestions.push("Aim for 8-20 commits per active day for quality boost");
  }
  
  if (factors.collaboration.points < 150) {
    suggestions.push("Learn 2+ new languages to improve collaboration score");
  }
  
  if (factors.impact.points < 150) {
    suggestions.push("Build longer streaks and increase weekly volume");
  }
  
  // Add tier-specific suggestions
  if (score.totalScore < 850) {
    const pointsNeeded = 850 - score.totalScore;
    suggestions.push(`Reach Elite tier (850+) by earning ${pointsNeeded} more points`);
  }
  
  return suggestions.slice(0, 3);
}

function renderReputationScore(score, metrics) {
  const container = document.getElementById("reputationContainer");
  const improvements = getImprovementSuggestions(score, metrics);
  
  const html = `
    <div class="scoreDisplay">
      <div class="k">YOUR REPUTATION SCORE</div>
      <div class="scoreNumber">${score.totalScore}</div>
      <div class="scoreBar">
        <div class="scoreBarFill ${score.tierClass}" style="width: ${(score.totalScore / 1000) * 100}%"></div>
      </div>
      <div class="scoreTier">${score.tier} (${score.totalScore >= 850 ? '850-1000' : score.totalScore >= 700 ? '700-849' : score.totalScore >= 550 ? '550-699' : score.totalScore >= 400 ? '400-549' : score.totalScore >= 250 ? '250-399' : '0-249'})</div>
      <div class="scorePercentile">Top ${100 - score.percentile}% of active developers</div>
    </div>
    
    <div class="scoreFactors">
      <div class="scoreFactor">
        <span class="factorLabel">Consistency</span>
        <div class="factorValue">
          ${score.factors.consistency.points} <span class="factorRating">${score.factors.consistency.rating}</span>
        </div>
      </div>
      <div class="scoreFactor">
        <span class="factorLabel">Velocity</span>
        <div class="factorValue">
          ${score.factors.velocity.points} <span class="factorRating">${score.factors.velocity.rating}</span>
        </div>
      </div>
      <div class="scoreFactor">
        <span class="factorLabel">Quality</span>
        <div class="factorValue">
          ${score.factors.quality.points} <span class="factorRating">${score.factors.quality.rating}</span>
        </div>
      </div>
      <div class="scoreFactor">
        <span class="factorLabel">Collaboration</span>
        <div class="factorValue">
          ${score.factors.collaboration.points} <span class="factorRating">${score.factors.collaboration.rating}</span>
        </div>
      </div>
      <div class="scoreFactor">
        <span class="factorLabel">Impact</span>
        <div class="factorValue">
          ${score.factors.impact.points} <span class="factorRating">${score.factors.impact.rating}</span>
        </div>
      </div>
    </div>
    
    ${improvements.length > 0 ? `
    <div class="scoreImprovement">
      <div class="improvementTitle">🚀 Improve Your Score</div>
      <div class="improvementList">
        ${improvements.map(s => `<div class="improvementItem">${s}</div>`).join('')}
      </div>
    </div>
    ` : ''}
  `;
  
  container.innerHTML = html;
}

// ========== Activity Patterns ==========
function calculateActivityPatterns(metrics, days) {
  const { totals, bestStreak, activeDays, avgPushesPerDay, windowDays, pushesPerDay } = metrics;
  
  // Determine coding rhythm
  let rhythm, rhythmIcon, rhythmDesc;
  if (avgPushesPerDay >= 8) {
    rhythm = "Power Coder";
    rhythmIcon = "⚡";
    rhythmDesc = "High velocity, crushing it daily";
  } else if (avgPushesPerDay >= 5) {
    rhythm = "Consistent Builder";
    rhythmIcon = "🔨";
    rhythmDesc = "Steady progress, great momentum";
  } else if (avgPushesPerDay >= 2) {
    rhythm = "Regular Contributor";
    rhythmIcon = "📝";
    rhythmDesc = "Balanced activity, solid pace";
  } else if (avgPushesPerDay >= 0.5) {
    rhythm = "Casual Coder";
    rhythmIcon = "🌱";
    rhythmDesc = "Growing habits, keep it up";
  } else {
    rhythm = "Getting Started";
    rhythmIcon = "🌟";
    rhythmDesc = "Every commit counts";
  }
  
  // Determine streak style
  let streakStyle, streakIcon;
  if (bestStreak >= 14) {
    streakStyle = "Marathon Runner";
    streakIcon = "🏃";
  } else if (bestStreak >= 7) {
    streakStyle = "Week Warrior";
    streakIcon = "💪";
  } else if (bestStreak >= 3) {
    streakStyle = "Sprint Starter";
    streakIcon = "🚀";
  } else {
    streakStyle = "Building Momentum";
    streakIcon = "🎯";
  }
  
  // Calculate activity distribution
  const hasContributions = windowDays.filter(d => (pushesPerDay[d] || 0) > 0).length;
  const emptyDays = windowDays.length - hasContributions;
  
  // Most productive day
  let mostProductiveDay = null;
  let maxContributions = 0;
  for (const day of windowDays) {
    if ((pushesPerDay[day] || 0) > maxContributions) {
      maxContributions = pushesPerDay[day] || 0;
      mostProductiveDay = day;
    }
  }
  
  return {
    rhythm,
    rhythmIcon,
    rhythmDesc,
    streakStyle,
    streakIcon,
    activeDays: hasContributions,
    emptyDays,
    mostProductiveDay,
    maxContributions
  };
}

function renderActivityPatterns(patterns) {
  const container = document.getElementById("competitiveContainer");
  
  const html = `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <div style="padding: 16px; background: var(--card); border-radius: 8px; border: 1px solid var(--border);">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
          <span style="font-size: 32px;">${patterns.rhythmIcon}</span>
          <div>
            <div style="font-size: 15px; font-weight: 600; color: var(--text);">${patterns.rhythm}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">${patterns.rhythmDesc}</div>
          </div>
        </div>
      </div>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <div style="padding: 12px; background: var(--card); border-radius: 6px; border: 1px solid var(--border); text-align: center;">
          <div style="font-size: 24px; margin-bottom: 4px;">${patterns.streakIcon}</div>
          <div style="font-size: 13px; font-weight: 600; color: var(--text);">${patterns.streakStyle}</div>
        </div>
        <div style="padding: 12px; background: var(--card); border-radius: 6px; border: 1px solid var(--border); text-align: center;">
          <div style="font-size: 24px; margin-bottom: 4px;">📅</div>
          <div style="font-size: 13px; font-weight: 600; color: var(--text);">${patterns.activeDays} Active Days</div>
        </div>
      </div>
      
      ${patterns.mostProductiveDay ? `
      <div style="padding: 12px; background: var(--card); border-radius: 6px; border: 1px solid var(--border);">
        <div style="font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Most Productive Day</div>
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="font-size: 13px; color: var(--text);">${patterns.mostProductiveDay}</div>
          <div style="font-size: 16px; font-weight: 600; color: var(--accent);">${patterns.maxContributions} contributions</div>
        </div>
      </div>
      ` : ''}
    </div>
  `;
  
  container.innerHTML = html;
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
    arrow.textContent = "◆";
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

    // Main metrics
    document.getElementById("m-pushes").textContent = fmt(metrics.totals.pushes);
    document.getElementById("m-beststreak").textContent = `${metrics.bestStreak} day${metrics.bestStreak === 1 ? '' : 's'}`;
    document.getElementById("m-best").textContent = metrics.bestDay;
    document.getElementById("m-bestcount").textContent = `${metrics.bestDayCount} contribution${metrics.bestDayCount === 1 ? '' : 's'}`;

    // Trend chart
    renderBars(metrics.windowDays, metrics.pushesPerDay);
    attachBarTooltip(metrics.windowDays, metrics.pushesPerDay);

    // Insights
    document.getElementById("m-avgpushes").textContent = metrics.avgPushesPerDay.toFixed(1);
    document.getElementById("m-consistency").textContent = `${metrics.consistency}%`;
    setConsistencyUI(metrics.consistency);

    // Languages
    renderLanguages(languages);

    // Reputation Score
    const reputationScore = calculateReputationScore(metrics, languages, currentDays);
    renderReputationScore(reputationScore, metrics);

    // Activity Patterns
    const patterns = calculateActivityPatterns(metrics, currentDays);
    renderActivityPatterns(patterns);

    // Goal tracking - tied to this specific username
    const goal = await loadGoal(username);
    if (goal) {
      updateGoalDisplay(goal, metrics.totals.pushes);
    } else {
      document.getElementById("goalDisplay").classList.add("hidden");
    }

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

document.getElementById("setGoal")?.addEventListener("click", async () => {
  const goalInput = document.getElementById("goalInput");
  const goal = parseInt(goalInput.value);
  
  if (!goal || goal < 1) {
    alert("Please enter a valid goal (1 or higher)");
    return;
  }
  
  if (!currentCtx?.username) {
    alert("Please analyze a profile first");
    return;
  }
  
  await saveGoal(currentCtx.username, goal);
  
  if (lastPayload?.metrics) {
    updateGoalDisplay(goal, lastPayload.metrics.totals.pushes);
  } else {
    updateGoalDisplay(goal, 0);
  }
  
  goalInput.value = "";
});

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
});

// ========== Initialization ==========
typewriter(document.getElementById("twTitle"), "GitHub Dashboard", 40);
setActive(".segbtn", el => Number(el.dataset.days) === currentDays);
setTopButtonActive("analyze");

getRecentUsers().then(renderRecentList);
loadToken();