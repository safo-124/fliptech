#!/usr/bin/env bash
# Publish an app update to your own server: no Expo cloud.
#
#   ./scripts/publish-update.sh safo@your-server
#
# Builds the app's JavaScript and assets for Android, then copies them to
# /var/lib/fliptech/app-updates/<app version>/<timestamp>/ on the server,
# where backend appsupport/updates.py serves them. Phones running a build
# of the same app version pick it up the next time the app opens.
#
# Only for JavaScript and asset changes. A change to native code (a new
# Expo package, app.config.ts plugins, permissions) needs a new build and a
# new "version" in app.json, or the update would crash the older builds.
#
# To roll back, delete or rename the newest folder on the server: the one
# before it is served again.
set -euo pipefail

SERVER="${1:?Usage: $0 user@server}"
cd "$(dirname "$0")/.."

: "${EXPO_PUBLIC_API_URL:?Set EXPO_PUBLIC_API_URL to the live site, e.g. https://yourdomain.com}"
: "${EXPO_PUBLIC_SITE_URL:=$EXPO_PUBLIC_API_URL}"
export EXPO_PUBLIC_API_URL EXPO_PUBLIC_SITE_URL

VERSION="$(node -p "require('./app.json').expo.version")"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="dist-update"

rm -rf "$OUT"
npx expo export --platform android --output-dir "$OUT"
npx expo config --type public --json > "$OUT/expoConfig.json"

REMOTE="/var/lib/fliptech/app-updates/$VERSION/$STAMP"
echo "Uploading to $SERVER:$REMOTE"
ssh "$SERVER" "sudo mkdir -p '$REMOTE' && sudo chown \"\$(whoami)\" '$REMOTE'"
rsync -az --delete "$OUT/" "$SERVER:$REMOTE/"
ssh "$SERVER" "sudo chown -R fliptech:fliptech '/var/lib/fliptech/app-updates'"
echo "Published update $STAMP for app version $VERSION."
