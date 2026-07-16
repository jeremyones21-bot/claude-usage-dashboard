const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

// Fetches the plan-usage snapshot Claude Code itself shows. Returns
// { fiveHour, sevenDay, raw } where each window is
// { utilization: 0-100, resetsAt: Date|null } or null if absent.
export async function fetchUsage(accessToken) {
  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'claude-usage-dashboard/0.1',
    },
  });
  if (res.status === 401 || res.status === 403) {
    const err = new Error('unauthorized');
    err.unauthorized = true;
    throw err;
  }
  if (!res.ok) throw new Error(`usage fetch failed: HTTP ${res.status}`);
  const json = await res.json();
  return {
    fiveHour: parseWindow(json.five_hour),
    sevenDay: parseWindow(json.seven_day),
    raw: json,
  };
}

function parseWindow(w) {
  if (!w || typeof w.utilization !== 'number') return null;
  return {
    utilization: w.utilization,
    resetsAt: w.resets_at ? new Date(w.resets_at) : null,
  };
}
