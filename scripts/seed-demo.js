// Generates 14 days of synthetic usage history into a DEMO database so the
// dashboard can be previewed (or screenshotted for the README) without
// waiting days for real snapshots. Never touches the real DB unless you
// explicitly point CUD_DB at it.
//
//   node scripts/seed-demo.js            # writes ./demo.db
//   CUD_DB=./demo.db npm start           # serve the demo data
import { openStore } from '../src/store.js';

const DB = process.env.CUD_DB || './demo.db';
const store = openStore(DB);

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const now = Date.now();
const start = now - 14 * DAY;

let fiveHour = 0;
let sevenDay = 12;
let fiveHourResetAt = alignToNext5hBoundary(start);

// A seeded PRNG so the demo data is reproducible.
let seed = 42;
const rand = () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;

for (let ts = start; ts <= now; ts += 5 * MIN) {
  const d = new Date(ts);
  const hour = d.getHours();
  const weekday = d.getDay() >= 1 && d.getDay() <= 5;

  // Work happens on weekday days/evenings, in bursts.
  const working = weekday && hour >= 9 && hour <= 23 && rand() < 0.75;
  const burst = rand() < 0.06 ? 3 + rand() * 5 : 0;
  const usagePerTick = working ? 0.35 + rand() * 0.9 + burst : rand() < 0.04 ? rand() * 0.4 : 0;

  fiveHour = Math.min(fiveHour + usagePerTick * 1.9, 100);
  sevenDay = Math.min(sevenDay + usagePerTick * 0.08, 100);

  if (ts >= fiveHourResetAt) {
    fiveHour = 0;
    fiveHourResetAt += 5 * HOUR;
  }
  // The 7-day window slowly rolls off old usage.
  sevenDay = Math.max(sevenDay - 0.03 - (sevenDay > 45 ? 0.025 : 0), 0);

  // Simulate the machine being asleep overnight: no snapshots 1am-8am.
  if (hour >= 1 && hour < 8) continue;

  store.insert({
    ts,
    fiveHour: { utilization: fiveHour, resetsAt: new Date(fiveHourResetAt) },
    sevenDay: { utilization: sevenDay, resetsAt: new Date(nextMonday9am(ts)) },
    raw: null,
  });
}

function alignToNext5hBoundary(ts) {
  return Math.ceil(ts / (5 * HOUR)) * 5 * HOUR;
}

function nextMonday9am(ts) {
  const d = new Date(ts);
  d.setHours(9, 0, 0, 0);
  do { d.setDate(d.getDate() + 1); } while (d.getDay() !== 1);
  return d.getTime();
}

console.log(`Seeded ${store.count()} demo snapshots into ${DB}`);
console.log(`Preview with:  CUD_DB=${DB} CUD_COLLECT=off npm start`);
store.close();
