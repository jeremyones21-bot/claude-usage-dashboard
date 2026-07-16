import { getAccessToken } from './credentials.js';
import { fetchUsage } from './claude-api.js';

// Polls the usage endpoint on an interval and writes snapshots to the store.
// Errors are recorded (visible in the dashboard footer) but never fatal —
// the next tick just tries again.
export function startPoller(store, { intervalMs }) {
  const state = { lastError: null, lastSuccess: null };

  async function tick() {
    try {
      const token = await getAccessToken();
      const usage = await fetchUsage(token);
      store.insert({ ts: Date.now(), ...usage });
      state.lastSuccess = Date.now();
      state.lastError = null;
    } catch (err) {
      state.lastError = { ts: Date.now(), message: err.message };
      console.error(`[poller] ${new Date().toISOString()} ${err.message}`);
    }
  }

  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { state, tick, stop: () => clearInterval(timer) };
}
