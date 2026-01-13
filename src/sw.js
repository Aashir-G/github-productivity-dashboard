import { githubFetch, usernameEventsUrl } from "./api.js";

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_EVENT_PAGES = 3; // up to 300 events
const MAX_CACHE_ENTRIES = 50; // Prevent storage bloat
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

// ========== Storage Management ==========

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
  await cleanupOldCache();
}

async function cleanupOldCache() {
  const all = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(all).filter(k => k.startsWith("analytics:"));
  
  if (cacheKeys.length <= MAX_CACHE_ENTRIES) return;
  
  // Sort by age, remove oldest
  const sorted = cacheKeys
    .map(k => ({ key: k, age: all[k]?.cachedAt || 0 }))
    .sort((a, b) => a.age - b.age);
  
  const toRemove = sorted.slice(0, cacheKeys.length - MAX_CACHE_ENTRIES).map(x => x.key);
  
  for (const key of toRemove) {
    await chrome.storage.local.remove(key);
  }
}

// ========== Date Utilities ==========

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

// ========== Metrics Calculation ==========

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

function computeContributionMetrics(events, daysWanted, username) {
  const windowDays = buildWindowDays(daysWanted);

  // Initialize counters for all event types
  const commitsPerDay = Object.fromEntries(windowDays.map(d => [d, 0]));
  const prsPerDay = Object.fromEntries(windowDays.map(d => [d, 0]));
  const issuesPerDay = Object.fromEntries(windowDays.map(d => [d, 0]));
  const reviewsPerDay = Object.fromEntries(windowDays.map(d => [d, 0]));
  const commentsPerDay = Object.fromEntries(windowDays.map(d => [d, 0]));
  const starsPerDay = Object.fromEntries(windowDays.map(d => [d, 0]));
  const releasesPerDay = Object.fromEntries(windowDays.map(d => [d, 0]));
  const contributionsPerDay = Object.fromEntries(windowDays.map(d => [d, 0]));

  let totalCommits = 0;
  let totalPRs = 0;
  let totalIssues = 0;
  let totalReviews = 0;
  let totalComments = 0;
  let totalStars = 0;
  let totalReleases = 0;

  for (const e of events) {
    const day = isoDay(e.created_at);
    if (commitsPerDay[day] === undefined) continue;

    // Count only commits authored by the user
    if (e.type === "PushEvent") {
      const userCommits = Array.isArray(e.payload?.commits)
        ? e.payload.commits.filter(c => {
            const authorName = c.author?.name?.toLowerCase();
            const authorEmail = c.author?.email?.toLowerCase();
            const user = username.toLowerCase();
            return authorName === user || authorEmail?.includes(user);
          }).length
        : 0;
      
      commitsPerDay[day] += userCommits;
      totalCommits += userCommits;
    }

    // Pull Requests
    if (e.type === "PullRequestEvent" && e.payload?.action === "opened") {
      prsPerDay[day] += 1;
      totalPRs += 1;
    }

    // Issues
    if (e.type === "IssuesEvent" && e.payload?.action === "opened") {
      issuesPerDay[day] += 1;
      totalIssues += 1;
    }

    // Code Reviews
    if (e.type === "PullRequestReviewEvent") {
      reviewsPerDay[day] += 1;
      totalReviews += 1;
    }

    // Comments (Issues + PR Review Comments)
    if (e.type === "IssueCommentEvent" || e.type === "PullRequestReviewCommentEvent") {
      commentsPerDay[day] += 1;
      totalComments += 1;
    }

    // Stars given
    if (e.type === "WatchEvent" && e.payload?.action === "started") {
      starsPerDay[day] += 1;
      totalStars += 1;
    }

    // Releases
    if (e.type === "ReleaseEvent" && e.payload?.action === "published") {
      releasesPerDay[day] += 1;
      totalReleases += 1;
    }
  }

  // Calculate total contributions per day
  for (const d of windowDays) {
    contributionsPerDay[d] = 
      (commitsPerDay[d] || 0) + 
      (prsPerDay[d] || 0) + 
      (issuesPerDay[d] || 0) +
      (reviewsPerDay[d] || 0) +
      (commentsPerDay[d] || 0);
  }

  const contributionsTotal = totalCommits + totalPRs + totalIssues + totalReviews + totalComments;

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

  // Averages
  const avgCommitsPerDay = windowDays.length ? (totalCommits / windowDays.length) : 0;
  const avgContributionsPerDay = windowDays.length ? (contributionsTotal / windowDays.length) : 0;

  return {
    windowDays,
    commitsPerDay,
    prsPerDay,
    issuesPerDay,
    reviewsPerDay,
    commentsPerDay,
    starsPerDay,
    releasesPerDay,
    contributionsPerDay,
    totals: {
      commits: totalCommits,
      prs: totalPRs,
      issues: totalIssues,
      reviews: totalReviews,
      comments: totalComments,
      stars: totalStars,
      releases: totalReleases,
      contributions: contributionsTotal
    },
    bestDay,
    bestDayCount,
    bestStreak,
    activeDays,
    consistency,
    avgCommitsPerDay,
    avgContributionsPerDay
  };
}

// ========== API Fetching with Retry ==========

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchUserEvents(username, token) {
  let all = [];
  let lastRate = null;
  let retries = 0;

  for (let page = 1; page <= MAX_EVENT_PAGES; page++) {
    while (retries < MAX_RETRIES) {
      try {
        const { data, rate } = await githubFetch(usernameEventsUrl(username, page), token);
        lastRate = rate;

        if (Array.isArray(data) && data.length) {
          all = all.concat(data);
          if (data.length < 100) {
            return { events: all, rate: lastRate };
          }
          break; // Success, move to next page
        } else {
          return { events: all, rate: lastRate };
        }
      } catch (err) {
        retries++;
        if (retries >= MAX_RETRIES) throw err;
        
        // Exponential backoff
        await sleep(RETRY_DELAY_MS * Math.pow(2, retries - 1));
      }
    }
    retries = 0; // Reset for next page
  }

  return { events: all, rate: lastRate };
}

// ========== Message Handling ==========

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "SET_TOKEN") {
        const sanitized = (msg.token || "").trim().replace(/[<>"']/g, "");
        await chrome.storage.sync.set({ gh_token: sanitized });
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "FETCH_ANALYTICS") {
        const username = (msg.username || "").trim();
        const days = Number(msg.days || 14);

        // Validation
        if (!username) throw new Error("Missing username");
        if (!/^[a-zA-Z0-9-]+$/.test(username)) throw new Error("Invalid username format");
        if (![7, 14, 30].includes(days)) throw new Error("Invalid days");

        const cacheKey = `analytics:${username}:${days}`;
        const cached = await getCached(cacheKey);
        
        if (cached) {
          sendResponse({ ok: true, source: "cache", payload: cached });
          return;
        }

        const token = await getToken();
        const { events, rate } = await fetchUserEvents(username, token);

        const metrics = computeContributionMetrics(events, days, username);
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

      if (msg?.type === "CLEAR_CACHE") {
        const all = await chrome.storage.local.get(null);
        const cacheKeys = Object.keys(all).filter(k => k.startsWith("analytics:"));
        
        for (const key of cacheKeys) {
          await chrome.storage.local.remove(key);
        }
        
        sendResponse({ ok: true, cleared: cacheKeys.length });
        return;
      }

      sendResponse({ ok: false, error: "Unknown message type" });
    } catch (err) {
      console.error("Service worker error:", err);
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();

  return true;
});