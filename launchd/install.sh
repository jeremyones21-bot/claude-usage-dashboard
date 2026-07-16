#!/bin/zsh
# Installs the dashboard as a launchd user agent so it starts at login and
# keeps collecting snapshots in the background.
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
PLIST=~/Library/LaunchAgents/com.claude-usage-dashboard.plist

mkdir -p ~/Library/LaunchAgents
sed -e "s|__NODE__|$NODE|" -e "s|__PROJECT__|$PROJECT|" \
  "$PROJECT/launchd/com.claude-usage-dashboard.plist" > "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed. Dashboard: http://127.0.0.1:7788  (logs: /tmp/claude-usage-dashboard.log)"
echo "Uninstall with: launchctl unload $PLIST && rm $PLIST"
