// Analytics over utilization snapshots.
//
// Utilization is a percentage of a rolling window's quota, so it goes UP as
// you use Claude and DROPS when the window rolls off / resets. "Consumption"
// over a period is therefore the sum of positive deltas between consecutive
// snapshots — drops are resets, not negative usage, and are ignored.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Gaps longer than this between snapshots make a delta unreliable (the
// machine was asleep, the poller was down); skip them rather than guess.
const MAX_DELTA_GAP = 3 * HOUR;

export function consumption(snapshots, key, fromTs, toTs = Infinity) {
  let total = 0;
  let prev = null;
  for (const s of snapshots) {
    const v = s[key];
    if (v == null) continue;
    if (s.ts > toTs) break;
    if (prev !== null && s.ts >= fromTs && s.ts - prev.ts <= MAX_DELTA_GAP) {
      const d = v - prev.v;
      if (d > 0) total += d;
    }
    prev = { ts: s.ts, v };
  }
  return total;
}

// Consumption bucketed by local calendar day, for the last `days` days.
// Returns [{ day: 'YYYY-MM-DD', value }] oldest first, empty days included.
export function dailyConsumption(snapshots, key, days) {
  const buckets = new Map();
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    buckets.set(localDayKey(d), 0);
  }
  let prev = null;
  for (const s of snapshots) {
    const v = s[key];
    if (v == null) continue;
    if (prev !== null && s.ts - prev.ts <= MAX_DELTA_GAP) {
      const d = v - prev.v;
      if (d > 0) {
        const dayKey = localDayKey(new Date(s.ts));
        if (buckets.has(dayKey)) buckets.set(dayKey, buckets.get(dayKey) + d);
      }
    }
    prev = { ts: s.ts, v };
  }
  return [...buckets].map(([day, value]) => ({ day, value }));
}

function localDayKey(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Burn rate + limit projection for one window.
//   snapshots: rows ordered by ts asc
//   key: 'five_hour_util' | 'seven_day_util'
//   lookback: how far back to measure the pace over
// Returns { ratePerHour, current, resetsAt, willHitLimit, hitAt } or null.
export function projection(snapshots, key, lookback, resetsAtMs, nowMs = Date.now()) {
  const latest = [...snapshots].reverse().find((s) => s[key] != null);
  if (!latest) return null;
  const current = latest[key];

  const burned = consumption(snapshots, key, nowMs - lookback, nowMs);
  // Pace over the actual span covered, capped at the lookback.
  const first = snapshots.find((s) => s[key] != null && s.ts >= nowMs - lookback);
  const spanMs = first ? Math.max(latest.ts - first.ts, HOUR / 2) : lookback;
  const ratePerHour = burned / (spanMs / HOUR);

  const result = {
    ratePerHour,
    current,
    resetsAt: resetsAtMs ?? null,
    willHitLimit: false,
    hitAt: null,
  };

  if (ratePerHour > 0.01 && current < 100) {
    const hoursToLimit = (100 - current) / ratePerHour;
    const hitAt = nowMs + hoursToLimit * HOUR;
    if (!resetsAtMs || hitAt < resetsAtMs) {
      result.willHitLimit = true;
      result.hitAt = hitAt;
    }
  } else if (current >= 100) {
    result.willHitLimit = true;
    result.hitAt = nowMs;
  }
  return result;
}

// Full summary payload for the dashboard.
export function summarize(store, nowMs = Date.now()) {
  const latest = store.latest();
  const rows30d = store.since(nowMs - 30 * DAY);

  const daily = dailyConsumption(rows30d, 'seven_day_util', 14);
  const last24h = consumption(rows30d, 'seven_day_util', nowMs - DAY, nowMs);
  const prior24h = consumption(rows30d, 'seven_day_util', nowMs - 2 * DAY, nowMs - DAY);

  return {
    now: nowMs,
    latest: latest
      ? {
          ts: latest.ts,
          fiveHour: {
            utilization: latest.five_hour_util,
            resetsAt: latest.five_hour_resets_at,
          },
          sevenDay: {
            utilization: latest.seven_day_util,
            resetsAt: latest.seven_day_resets_at,
          },
        }
      : null,
    fiveHourProjection: projection(
      rows30d, 'five_hour_util', HOUR, latest?.five_hour_resets_at, nowMs),
    sevenDayProjection: projection(
      rows30d, 'seven_day_util', DAY, latest?.seven_day_resets_at, nowMs),
    daily,
    burn: { last24h, prior24h },
    snapshotCount: store.count(),
  };
}
