# claude-usage-dashboard

A local web dashboard for your Claude plan usage: live 5-hour / 7-day window
meters, usage history, daily consumption trends, burn rate, and "at this pace
you'll hit your limit by Thursday" projections.

It reads the same OAuth session Claude Code itself uses, polls the usage
endpoint every few minutes, and stores snapshots in a local SQLite database —
so unlike the in-CLI `/usage` view, it remembers history and can show trends.

**Zero dependencies.** Plain Node (≥ 23.4, for built-in `node:sqlite`), no npm
install, no cloud. Everything stays on your machine.

## Quick start

```sh
node src/server.js
# → http://127.0.0.1:7788
```

That's it. The server polls usage every 5 minutes and the dashboard fills in
as history accumulates.

To try the UI immediately with synthetic data:

```sh
node scripts/seed-demo.js
CUD_DB=./demo.db CUD_COLLECT=off node src/server.js
```

## Run at login (macOS)

```sh
./launchd/install.sh
```

Installs a launchd user agent that keeps the collector + dashboard running in
the background.

## How it works

- **Credentials** are read from `~/.claude/.credentials.json` (the file Claude
  Code maintains alongside its Keychain item). When the access token is
  expired, it's refreshed against the same public OAuth client the CLI uses,
  and the new tokens are written back so the CLI stays in sync. Tokens never
  leave your machine.
- **Snapshots** of `GET https://api.anthropic.com/api/oauth/usage` (the
  endpoint behind Claude Code's `/usage`) are stored in
  `~/.claude-usage-dashboard/usage.db` every 5 minutes.
- **Utilization** is a percentage of a rolling window's quota: it climbs as
  you use Claude and drops as usage rolls off. "Consumption" is computed as
  the sum of *positive* deltas between snapshots, so resets don't count as
  negative usage. Deltas across gaps longer than 3 hours (laptop asleep) are
  skipped rather than guessed.
- **Projections** extrapolate the recent pace — the last hour for the 5-hour
  window, the last 24 hours for the 7-day window — against the window's reset
  time.

## Configuration (env vars)

| Variable | Default | Meaning |
|---|---|---|
| `CUD_PORT` | `7788` | HTTP port |
| `CUD_HOST` | `127.0.0.1` | Bind address (loopback only by default) |
| `CUD_POLL_MINUTES` | `5` | Snapshot interval |
| `CUD_DB` | `~/.claude-usage-dashboard/usage.db` | SQLite path |
| `CUD_CREDENTIALS` | `~/.claude/.credentials.json` | Credentials file |
| `CUD_COLLECT` | `on` | Set `off` to disable polling (ingest-only mode) |
| `CUD_INGEST_TOKEN` | — | If set, `POST /api/snapshot` requires this bearer token |

## Split deployment (optional)

The default mode is all-in-one: one process polls and serves. If you'd rather
host the dashboard elsewhere (a home server, a private VPS), run the web half
there with `CUD_COLLECT=off` and have a tiny agent on your Mac POST snapshots:

```sh
curl -X POST https://your-host/api/snapshot \
  -H "Authorization: Bearer $CUD_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(curl -s https://api.anthropic.com/api/oauth/usage \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "anthropic-beta: oauth-2025-04-20")"
```

Only usage percentages travel; credentials stay local.

## API

- `GET /api/summary` — latest snapshot, projections, daily consumption, burn rate
- `GET /api/history?hours=168` — raw snapshots
- `POST /api/snapshot` — ingest a snapshot (for split deployment)

## Caveats

- The usage endpoint is undocumented and could change without notice (this
  project reads whatever Claude Code's own `/usage` reads).
- If two processes refresh the same OAuth token simultaneously (this, the CLI,
  a menu-bar app), a refresh can occasionally lose the race; the poller just
  retries on the next tick.
