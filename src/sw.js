import { githubFetch, usernameEventsUrl } from "./api.js";

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;

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

// ========== Fetch Contribution Data ==========

async function fetchContributionData(username, token, daysWanted) {
  console.log(`[SW] Fetching data for ${username} (${daysWanted} days)`);
  
  // Try GraphQL first if we have a token
  if (token) {
    try {
      const result = await fetchFromGraphQL(username, token, daysWanted);
      console.log('[SW] Successfully fetched from GraphQL');
      return result;
    } catch (err) {
      console.warn('[SW] GraphQL failed, falling back to Events API:', err.message);
    }
  }
  
  // Fallback to Events API
  return await fetchFromEventsAPI(username, token, daysWanted);
}

async function fetchFromGraphQL(username, token, daysWanted) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - daysWanted);
  
  const query = `
    query($username: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $username) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      query,
      variables: {
        username,
        from: from.toISOString(),
        to: to.toISOString()
      }
    })
  });

  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");

  if (!response.ok) {
    throw new Error(`GraphQL API returned ${response.status}`);
  }

  const result = await response.json();
  
  if (result.errors) {
    throw new Error(result.errors[0]?.message || 'GraphQL query failed');
  }

  const weeks = result.data?.user?.contributionsCollection?.contributionCalendar?.weeks || [];
  const contributionsByDate = {};
  
  for (const week of weeks) {
    for (const day of week.contributionDays) {
      contributionsByDate[day.date] = day.contributionCount;
    }
  }

  return {
    contributionsByDate,
    rate: { remaining, reset }
  };
}

async function fetchFromEventsAPI(username, token, daysWanted) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysWanted);
  cutoffDate.setHours(0, 0, 0, 0);

  const contributionsByDate = {};
  const windowDays = buildWindowDays(daysWanted);
  
  // Initialize all days to 0
  for (const day of windowDays) {
    contributionsByDate[day] = 0;
  }

  let allEvents = [];
  let lastRate = null;
  let shouldContinue = true;
  
  // Fetch up to 10 pages of events
  for (let page = 1; page <= 10 && shouldContinue; page++) {
    try {
      const { data, rate } = await githubFetch(usernameEventsUrl(username, page), token);
      lastRate = rate;

      if (!Array.isArray(data) || data.length === 0) {
        console.log(`[SW] No more events at page ${page}`);
        break;
      }

      let eventsInWindow = 0;
      
      for (const event of data) {
        if (!event.created_at) continue;
        
        const eventDate = new Date(event.created_at);
        
        // Stop if we've gone past the cutoff
        if (eventDate < cutoffDate) {
          shouldContinue = false;
          break;
        }
        
        const day = isoDay(event.created_at);
        
        // Only count events within our window
        if (contributionsByDate[day] !== undefined) {
          eventsInWindow++;
          
          // Count different types of contributions
          if (event.type === "PushEvent") {
            // Count commits in the push
            const commits = event.payload?.commits?.length || 1;
            contributionsByDate[day] += commits;
          } 
          else if (event.type === "PullRequestEvent" && event.payload?.action === "opened") {
            contributionsByDate[day] += 1;
          }
          else if (event.type === "IssuesEvent" && event.payload?.action === "opened") {
            contributionsByDate[day] += 1;
          }
          else if (event.type === "PullRequestReviewEvent") {
            contributionsByDate[day] += 1;
          }
          else if (event.type === "CreateEvent" && event.payload?.ref_type === "repository") {
            contributionsByDate[day] += 1;
          }
        }
      }

      console.log(`[SW] Page ${page}: ${data.length} events, ${eventsInWindow} in window`);

      // If we got less than 100 events, this is the last page
      if (data.length < 100) {
        break;
      }
      
    } catch (err) {
      console.error(`[SW] Error fetching page ${page}:`, err);
      break;
    }
  }

  console.log('[SW] Contributions by date:', contributionsByDate);
  
  return {
    contributionsByDate,
    rate: lastRate
  };
}

// ========== Language Detection ==========

async function fetchUserLanguages(username, token) {
  try {
    const reposUrl = `https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=updated&per_page=30`;
    const { data: repos } = await githubFetch(reposUrl, token);
    
    if (!Array.isArray(repos)) return [];
    
    const langCounts = {};
    
    for (const repo of repos) {
      if (repo.fork) continue;
      if (!repo.language) continue;
      
      langCounts[repo.language] = (langCounts[repo.language] || 0) + 1;
    }
    
    const sorted = Object.entries(langCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([lang]) => lang);
    
    return sorted;
  } catch (err) {
    console.error("[SW] Failed to fetch languages:", err);
    return [];
  }
}

// ========== Metrics Calculation ==========

function maxConsecutiveActiveDays(windowDays, contributionsByDate) {
  let best = 0;
  let current = 0;

  for (const d of windowDays) {
    const active = (contributionsByDate[d] || 0) > 0;
    if (active) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }

  return best;
}

function computeMetrics(contributionsByDate, daysWanted) {
  const windowDays = buildWindowDays(daysWanted);

  let totalContributions = 0;

  for (const day of windowDays) {
    totalContributions += contributionsByDate[day] || 0;
  }

  // Best day
  let bestDay = windowDays[0];
  let bestDayCount = contributionsByDate[bestDay] || 0;
  for (const d of windowDays) {
    if ((contributionsByDate[d] || 0) > bestDayCount) {
      bestDayCount = contributionsByDate[d] || 0;
      bestDay = d;
    }
  }

  const bestStreak = maxConsecutiveActiveDays(windowDays, contributionsByDate);
  const activeDays = windowDays.reduce((acc, d) => acc + ((contributionsByDate[d] || 0) > 0 ? 1 : 0), 0);
  const consistency = windowDays.length ? Math.round((activeDays / windowDays.length) * 100) : 0;
  const avgPerDay = windowDays.length ? (totalContributions / windowDays.length) : 0;

  return {
    windowDays,
    pushesPerDay: contributionsByDate,
    totals: {
      pushes: totalContributions
    },
    bestDay,
    bestDayCount,
    bestStreak,
    activeDays,
    consistency,
    avgPushesPerDay: avgPerDay
  };
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

        if (!username) throw new Error("Missing username");
        if (!/^[a-zA-Z0-9-]+$/.test(username)) throw new Error("Invalid username format");
        if (![7, 14, 30].includes(days)) throw new Error("Invalid days");

        const cacheKey = `analytics:${username}:${days}`;
        const cached = await getCached(cacheKey);
        
        if (cached) {
          console.log(`[SW] Returning cached data for ${username}`);
          sendResponse({ ok: true, source: "cache", payload: cached });
          return;
        }

        const token = await getToken();
        const { contributionsByDate, rate } = await fetchContributionData(username, token, days);
        const languages = await fetchUserLanguages(username, token);
        const metrics = computeMetrics(contributionsByDate, days);
        
        const payload = {
          username,
          days,
          metrics,
          languages,
          rate,
          fetchedAt: new Date().toISOString()
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
      console.error("[SW] Error:", err);
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();

  return true;
});