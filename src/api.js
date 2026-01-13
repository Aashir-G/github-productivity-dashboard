export async function githubFetch(url, token) {
  const headers = {
    Accept: "application/vnd.github+json"
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });

  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset");

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `GitHub API error ${res.status}. Remaining=${remaining} Reset=${reset}. ${text}`
    );
  }

  return {
    data: await res.json(),
    rate: { remaining, reset }
  };
}

export function usernameEventsUrl(username, page = 1) {
  return `https://api.github.com/users/${encodeURIComponent(
    username
  )}/events/public?per_page=100&page=${page}`;
}
