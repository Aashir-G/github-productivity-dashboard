import { githubFetch, usernameEventsUrl } from "./api.js";

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_EVENT_PAGES = 3; // 3 pages x 100 = up to 300 events

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
  await chrome.storage.local.set({
    [key]: { cachedAt: Date.now(), payload }
  });
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

function computeMetricsFromEvents(events, daysWanted) {
  const windowDays = buildWindowDays(daysWanted);

  // Use PushEvent as "commit-like" activity
  const pushEvents = events.filter(e => e.type === "PushEvent");

  const pushesPerDay = Object.fromEntries(windowDays.map(d => [d, 0]));
  for (const e of pushEvents) {
    const day = isoDay(e.created_at);
    if (pushesPerDay[day] !== undefined) pushesPerDay[day] += 1;
  }

  const pushesInWindow = windowDays.reduce((sum, d) => sum + pushesPerDay[d], 0);

  // Streak: consecutive days ending today with activity
  let streakDays = 0;
  for (let i = windowDays.length - 1; i >= 0; i--) {
    if (pushesPerDay[windowDays[i]] > 0) streakDays++;
    else break;
  }

  // Best day in window
  let bestDay = windowDays[0];
  let bestDayCount = pushesPerDay[bestDay];
  for (const d of windowDays) {
    if (pushesPerDay[d] > bestDayCount) {
      bestDayCount = pushesPerDay[d];
      bestDay = d;
    }
  }

  return {
    windowDays,
    pushesPerDay,
    pushesInWindow,
    streakDays,
    bestDay,
    bestDayCount
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
      // If the page came back less than 100, no more pages
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
        const token = (msg.token || "").trim();
        await chrome.storage.sync.set({ gh_token: token });
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "SET_OVERLAY") {
        const enabled = !!msg.enabled;
        await chrome.storage.sync.set({ overlay_enabled: enabled });
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "FETCH_ANALYTICS") {
        const username = msg.username;
        const days = Number(msg.days || 14);

        if (!username) throw new Error("Missing username");
        if (![7, 14, 30].includes(days)) throw new Error("Invalid days value");

        const cacheKey = `analytics:${username}:${days}`;
        const cached = await getCached(cacheKey);
        if (cached) {
          sendResponse({ ok: true, source: "cache", payload: cached });
          return;
        }

        const token = await getToken();
        const { events, rate } = await fetchUserEvents(username, token);

        const metrics = computeMetricsFromEvents(events, days);
        const payload = {
          username,
          days,
          metrics,
          rate,
          fetchedAt: new Date().toISOString()
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
