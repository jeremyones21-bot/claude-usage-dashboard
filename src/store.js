import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export const DB_PATH =
  process.env.CUD_DB || join(homedir(), '.claude-usage-dashboard', 'usage.db');

export function openStore(path = DB_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      ts INTEGER PRIMARY KEY,           -- unix ms
      five_hour_util REAL,
      five_hour_resets_at INTEGER,      -- unix ms
      seven_day_util REAL,
      seven_day_resets_at INTEGER,      -- unix ms
      raw TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON snapshots (ts);
  `);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO snapshots
      (ts, five_hour_util, five_hour_resets_at, seven_day_util, seven_day_resets_at, raw)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  return {
    insert(snapshot) {
      insertStmt.run(
        snapshot.ts,
        snapshot.fiveHour?.utilization ?? null,
        snapshot.fiveHour?.resetsAt?.getTime() ?? null,
        snapshot.sevenDay?.utilization ?? null,
        snapshot.sevenDay?.resetsAt?.getTime() ?? null,
        snapshot.raw ? JSON.stringify(snapshot.raw) : null,
      );
    },

    latest() {
      return db
        .prepare('SELECT * FROM snapshots ORDER BY ts DESC LIMIT 1')
        .get();
    },

    since(tsMs) {
      return db
        .prepare('SELECT ts, five_hour_util, five_hour_resets_at, seven_day_util, seven_day_resets_at FROM snapshots WHERE ts >= ? ORDER BY ts ASC')
        .all(tsMs);
    },

    count() {
      return db.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n;
    },

    close() {
      db.close();
    },
  };
}
