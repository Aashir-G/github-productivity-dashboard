import { githubFetch, usernameEventsUrl } from "./api.js";

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_EVENT_PAGES = 3; // up to 300 events

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

async function getToken() {
  const { gh_token } = await chrome.storage.sync.get(["gh_token"]);
  return (gh_token || "").trim();
}

async function getCached(key) {
  const { [key]: val } = await chrome.storage.local.get([key]);
  if (!val) return null;
  if (!val.cachedAt || Date.now() - val.cachedAt > CACHE_TTL_MS) return null;
  return val.payload;
}

async function setCached(key, payload) {
  await chrome.storage.local.set({ [key]: { cachedAt: Date.now(), payload } });
}

function isoDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function buildWindowDays(daysWanted) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = [];
  for (let i = daysWanted - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function maxConsecutiveActiveDays(windowDays, contributionsPerDay) {
  let best = 0;
  let current = 0;

  for (const d of windowDays) {
    const active = (contributionsPerDay[d] || 0) > 0;
    if (active) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }

  return best;
}

function computeContributionMetrics(events, daysWanted) {
  const windowDays = buildWindowDays(daysWanted);

  const commitsPerDay = Object.fromEntries(windowDays.map(d => [d, 0]));
  const prsPerDay = Object.fromEntries(windowDays.map(d => [d, 0]));
  const issuesPerDay = Object.fromEntries(windowDays.map(d => [d, 0]));
  const contributionsPerDay = Object.fromEntries(windowDays.map(d => [d, 0]));

  let totalCommits = 0;
  let totalPRs = 0;
  let totalIssues = 0;

  for (const e of events) {
    const day = isoDay(e.created_at);
    if (commitsPerDay[day] === undefined) continue;

    if (e.type === "PushEvent") {
      const commits = Array.isArray(e.payload?.commits) ? e.payload.commits.length : 0;
      commitsPerDay[day] += commits;
      totalCommits += commits;
    }

    if (e.type === "PullRequestEvent" && e.payload?.action === "opened") {
      prsPerDay[day] += 1;
      totalPRs += 1;
    }

    if (e.type === "IssuesEvent" && e.payload?.action === "opened") {
      issuesPerDay[day] += 1;
      totalIssues += 1;
    }
  }

  for (const d of windowDays) {
    contributionsPerDay[d] = (commitsPerDay[d] || 0) + (prsPerDay[d] || 0) + (issuesPerDay[d] || 0);
  }

  const contributionsTotal = totalCommits + totalPRs + totalIssues;

  // Best day by contributions
  let bestDay = windowDays[0];
  let bestDayCount = contributionsPerDay[bestDay] || 0;
  for (const d of windowDays) {
    if ((contributionsPerDay[d] || 0) > bestDayCount) {
      bestDayCount = contributionsPerDay[d] || 0;
      bestDay = d;
    }
  }

  const bestStreak = maxConsecutiveActiveDays(windowDays, contributionsPerDay);

  // Active days + consistency
  const activeDays = windowDays.reduce((acc, d) => acc + ((contributionsPerDay[d] || 0) > 0 ? 1 : 0), 0);
  const consistency = windowDays.length ? Math.round((activeDays / windowDays.length) * 100) : 0;

  // Avg commits/day (requested)
  const avgCommitsPerDay = windowDays.length ? (totalCommits / windowDays.length) : 0;

  return {
    windowDays,
    commitsPerDay,
    prsPerDay,
    issuesPerDay,
    contributionsPerDay,
    totals: {
      commits: totalCommits,
      prs: totalPRs,
      issues: totalIssues,
      contributions: contributionsTotal
    },
    bestDay,
    bestDayCount,
    bestStreak,
    activeDays,
    consistency,
    avgCommitsPerDay
  };
}

async function fetchUserEvents(username, token) {
  let all = [];
  let lastRate = null;

  for (let page = 1; page <= MAX_EVENT_PAGES; page++) {
    const { data, rate } = await githubFetch(usernameEventsUrl(username, page), token);
    lastRate = rate;

    if (Array.isArray(data) && data.length) {
      all = all.concat(data);
      if (data.length < 100) break;
    } else {
      break;
    }
  }

  return { events: all, rate: lastRate };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "SET_TOKEN") {
        await chrome.storage.sync.set({ gh_token: (msg.token || "").trim() });
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "FETCH_ANALYTICS") {
        const username = msg.username;
        const days = Number(msg.days || 14);

        if (!username) throw new Error("Missing username");
        if (![7, 14, 30].includes(days)) throw new Error("Invalid days");

        const cacheKey = `analytics:${username}:${days}`;
        const cached = await getCached(cacheKey);
        if (cached) {
          sendResponse({ ok: true, source: "cache", payload: cached });
          return;
        }

        const token = await getToken();
        const { events, rate } = await fetchUserEvents(username, token);

        const metrics = computeContributionMetrics(events, days);
        const payload = {
          username,
          days,
          metrics,
          rate,
          fetchedAt: new Date().toISOString(),
          note: "Counts are based on public events feed. Private activity may not appear."
        };

        await setCached(cacheKey, payload);
        sendResponse({ ok: true, source: "api", payload });
        return;
      }

      sendResponse({ ok: false, error: "Unknown message type" });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();

  return true;
});
