#!/usr/bin/env bash
#
# Build the app and launch Electron with Chrome DevTools Protocol enabled so
# Playwright (or any CDP client) can connect and drive the UI.
#
# Usage:
#   scripts/start-with-cdp.sh              # build + launch, wait for CDP
#   scripts/start-with-cdp.sh --skip-build # reuse previous build, just launch
#
# The script prints the CDP endpoint URL when ready and leaves Electron running
# in the background. Kill it with: pkill -f 'Electron .vite'

set -euo pipefail

CDP_PORT="${KALE_CDP_PORT:-9222}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$PROJECT_ROOT/.vite/build"
SKIP_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

# Kill any existing CDP-enabled Electron instance on the same port.
if curl -s "http://localhost:$CDP_PORT/json/version" >/dev/null 2>&1; then
  echo "Killing existing Electron instance on CDP port $CDP_PORT..."
  pkill -f 'Electron .vite' 2>/dev/null || true
  sleep 1
fi

if [ "$SKIP_BUILD" = false ]; then
  echo "Building Vite bundles..."
  cd "$PROJECT_ROOT"
  npx electron-forge package 2>&1 | tail -1
fi

# The direct Electron launch resolves app.getAppPath() to .vite/build/, so
# runtime assets that live outside the Vite bundle need to be copied there.
echo "Copying runtime assets to build directory..."
cp -r "$PROJECT_ROOT/prompts" "$BUILD_DIR/prompts"
cp -r "$PROJECT_ROOT/data" "$BUILD_DIR/data"

echo "Launching Electron with CDP on port $CDP_PORT..."
cd "$PROJECT_ROOT"
./node_modules/.bin/electron .vite/build/main.js --remote-debugging-port="$CDP_PORT" &>/tmp/kale-cdp.log &
ELECTRON_PID=$!

# Wait for CDP to become available.
for _attempt in $(seq 1 20); do
  if curl -s "http://localhost:$CDP_PORT/json/version" >/dev/null 2>&1; then
    echo "CDP ready on http://localhost:$CDP_PORT (Electron PID: $ELECTRON_PID)"
    echo ""
    echo "Connect with Playwright:"
    echo "  const browser = await chromium.connectOverCDP('http://localhost:$CDP_PORT');"
    echo ""
    echo "Stop with:"
    echo "  pkill -f 'Electron .vite'"
    exit 0
  fi
  sleep 1
done

echo "Timed out waiting for CDP on port $CDP_PORT" >&2
cat /tmp/kale-cdp.log >&2
exit 1
