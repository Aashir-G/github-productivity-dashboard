import { githubFetch, usernameEventsUrl } from "./api.js";

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

async function getToken() {
  const { gh_token } = await chrome.storage.sync.get(["gh_token"]);
  return gh_token || "";
}

async function getCached(key) {
  const { [key]: val } = await chrome.storage.local.get([key]);
  if (!val) return null;
  if (!val.cachedAt || Date.now() - val.cachedAt > CACHE_TTL_MS) return null;
  return val.payload;
}

async function setCached(key, payload) {
  await chrome.storage.local.set({
    [key]: { cachedAt: Date.now(), payload }
  });
}

function isoDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function computeMetricsFromEvents(events) {
  // Focus on PushEvent for "commit-like" activity
  const pushEvents = events.filter(e => e.type === "PushEvent");

  // Count pushes per day (last 14 days)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const counts = Object.fromEntries(days.map(d => [d, 0]));
  for (const e of pushEvents) {
    const day = isoDay(e.created_at);
    if (counts[day] !== undefined) counts[day] += 1;
  }

  // Last 7 days total
  const last7 = days.slice(-7).reduce((sum, d) => sum + counts[d], 0);

  // Streak: consecutive days ending today with count > 0
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (counts[days[i]] > 0) streak++;
    else break;
  }

  // Most active day in last 14 days
  let bestDay = days[0], bestVal = counts[bestDay];
  for (const d of days) {
    if (counts[d] > bestVal) {
      bestVal = counts[d];
      bestDay = d;
    }
  }

  return {
    windowDays: days,
    pushesPerDay: counts,
    pushesLast7Days: last7,
    streakDays: streak,
    bestDay,
    bestDayCount: bestVal
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "SET_TOKEN") {
        const token = (msg.token || "").trim();
        await chrome.storage.sync.set({ gh_token: token });
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "FETCH_ANALYTICS") {
        const username = msg.username;
        if (!username) throw new Error("Missing username");

        const cacheKey = `analytics:${username}`;
        const cached = await getCached(cacheKey);
        if (cached) {
          sendResponse({ ok: true, source: "cache", payload: cached });
          return;
        }

        const token = await getToken();
        const { data: events, rate } = await githubFetch(usernameEventsUrl(username), token);

        const metrics = computeMetricsFromEvents(events);

        const payload = { username, metrics, rate, fetchedAt: new Date().toISOString() };
        await setCached(cacheKey, payload);

        sendResponse({ ok: true, source: "api", payload });
        return;
      }

      sendResponse({ ok: false, error: "Unknown message" });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();

  return true; // keep message channel open for async
});
