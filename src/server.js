#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openStore, DB_PATH } from './store.js';
import { summarize } from './stats.js';
import { startPoller } from './poller.js';

const PORT = Number(process.env.CUD_PORT || 7788);
const HOST = process.env.CUD_HOST || '127.0.0.1';
const POLL_MINUTES = Number(process.env.CUD_POLL_MINUTES || 5);
// Set CUD_COLLECT=off to run the web UI only (snapshots arrive via
// POST /api/snapshot from a separate collector instead).
const COLLECT = process.env.CUD_COLLECT !== 'off';
// Optional bearer token required on POST /api/snapshot.
const INGEST_TOKEN = process.env.CUD_INGEST_TOKEN || null;

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const store = openStore();
const poller = COLLECT ? startPoller(store, { intervalMs: POLL_MINUTES * 60_000 }) : null;

const DAY = 86_400_000;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/summary') {
      return sendJSON(res, {
        ...summarize(store),
        poller: poller
          ? { intervalMinutes: POLL_MINUTES, ...poller.state }
          : { mode: 'ingest-only' },
        dbPath: DB_PATH,
      });
    }

    if (url.pathname === '/api/history') {
      const hours = Math.min(Number(url.searchParams.get('hours') || 168), 24 * 90);
      return sendJSON(res, {
        now: Date.now(),
        rows: store.since(Date.now() - hours * 3_600_000),
      });
    }

    if (url.pathname === '/api/snapshot' && req.method === 'POST') {
      if (INGEST_TOKEN && req.headers.authorization !== `Bearer ${INGEST_TOKEN}`) {
        res.writeHead(401).end();
        return;
      }
      const body = JSON.parse(await readBody(req));
      store.insert({
        ts: body.ts ?? Date.now(),
        fiveHour: parseWindowBody(body.five_hour ?? body.fiveHour),
        sevenDay: parseWindowBody(body.seven_day ?? body.sevenDay),
        raw: body,
      });
      return sendJSON(res, { ok: true });
    }

    // Static files.
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
    const file = join(PUBLIC_DIR, safe);
    if (!file.startsWith(PUBLIC_DIR)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404).end('not found');
    }
  } catch (err) {
    console.error('[server]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

function sendJSON(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function parseWindowBody(w) {
  if (!w || typeof w.utilization !== 'number') return null;
  const resetsAt = w.resets_at ?? w.resetsAt;
  return {
    utilization: w.utilization,
    resetsAt: resetsAt ? new Date(resetsAt) : null,
  };
}

server.listen(PORT, HOST, () => {
  console.log(`claude-usage-dashboard on http://${HOST}:${PORT}`);
  console.log(`  db: ${DB_PATH}`);
  console.log(COLLECT
    ? `  polling every ${POLL_MINUTES} min`
    : '  collection off (ingest-only mode)');
});
