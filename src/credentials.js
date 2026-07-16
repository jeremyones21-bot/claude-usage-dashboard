// Reads Claude Code's OAuth session from ~/.claude/.credentials.json rather
// than the "Claude Code-credentials" Keychain item. The CLI resets that item's
// access control list on every token refresh, so Keychain access from another
// process re-triggers the macOS permission prompt no matter how many times
// "Always Allow" is granted. The file holds the same JSON blob with a
// top-level "claudeAiOauth" object.
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CREDENTIALS_PATH =
  process.env.CUD_CREDENTIALS || join(homedir(), '.claude', '.credentials.json');

// Same public OAuth client the Claude Code CLI uses.
const REFRESH_URL = 'https://console.anthropic.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

export async function readCredentials() {
  const raw = JSON.parse(await readFile(CREDENTIALS_PATH, 'utf8'));
  const oauth = raw.claudeAiOauth;
  if (!oauth?.accessToken) {
    throw new Error(`no claudeAiOauth.accessToken in ${CREDENTIALS_PATH}`);
  }
  return {
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken ?? null,
    expiresAt: oauth.expiresAt ? new Date(oauth.expiresAt) : null,
    raw,
  };
}

async function writeCredentials(creds) {
  const json = creds.raw;
  json.claudeAiOauth = {
    ...(json.claudeAiOauth ?? {}),
    accessToken: creds.accessToken,
    ...(creds.refreshToken ? { refreshToken: creds.refreshToken } : {}),
    ...(creds.expiresAt ? { expiresAt: creds.expiresAt.getTime() } : {}),
  };
  await writeFile(CREDENTIALS_PATH, JSON.stringify(json));
  await chmod(CREDENTIALS_PATH, 0o600);
}

async function refresh(creds) {
  if (!creds.refreshToken) throw new Error('no refresh token available');
  const res = await fetch(REFRESH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: HTTP ${res.status}`);
  const json = await res.json();
  const updated = {
    ...creds,
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? creds.refreshToken,
    expiresAt: json.expires_in
      ? new Date(Date.now() + json.expires_in * 1000)
      : creds.expiresAt,
  };
  // Write back so the CLI (and the menu-bar app) see current tokens too.
  await writeCredentials(updated).catch(() => {});
  return updated;
}

// Returns a currently-valid access token, refreshing only when the stored one
// is expired (or about to). Re-reads the file first so a refresh done by
// another process (the CLI, the menu-bar app) is picked up instead of burning
// our possibly-stale refresh token.
export async function getAccessToken() {
  const creds = await readCredentials();
  const expiringSoon =
    creds.expiresAt && creds.expiresAt.getTime() < Date.now() + 60_000;
  if (!expiringSoon) return creds.accessToken;
  const refreshed = await refresh(creds);
  return refreshed.accessToken;
}

export { CREDENTIALS_PATH };
