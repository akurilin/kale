#!/usr/bin/env bash
#
# Launch Kale with CDP enabled for an instance-scoped QA session.
#
# Usage:
#   scripts/start-with-cdp.sh --instance <id> [--skip-build] [--json]
#
# Why this script is strict about instance IDs:
# parallel QA runs must never share userData directories, logs, startup files,
# or process cleanup scope.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$PROJECT_ROOT/.vite/build"

SKIP_BUILD=false
JSON_OUTPUT=false
INSTANCE_ID=""

# Why: a single usage helper keeps all required flags documented in one place
# when the script exits early for invalid automation invocations.
print_usage() {
  cat >&2 <<'EOF'
Usage:
  scripts/start-with-cdp.sh --instance <id> [--skip-build] [--json]

Options:
  --instance <id>  Required. ASCII letters/digits plus . _ -
  --skip-build     Reuse existing .vite/build output
  --json           Suppress human helper lines; still emits KALE_QA_READY marker
EOF
}

# Why: restricting instance IDs to safe filesystem characters keeps all
# instance-scoped /tmp paths predictable and shell-safe.
is_valid_instance_id() {
  local candidate_instance_id="$1"
  [[ "$candidate_instance_id" =~ ^[A-Za-z0-9._-]+$ ]]
}

# Why: CDP ports must be unique per QA session, and using the OS ephemeral-port
# allocator is safer than hardcoding one shared default across parallel runners.
pick_random_free_port() {
  node -e "
const net = require('node:net');
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address !== 'object') {
    process.exit(1);
  }
  process.stdout.write(String(address.port));
  server.close();
});
"
}

# Why: allowing an explicit override keeps reproducibility possible in edge
# debugging cases, while default behavior remains collision-resistant.
resolve_cdp_port() {
  if [[ -n "${KALE_CDP_PORT:-}" ]]; then
    printf '%s' "$KALE_CDP_PORT"
    return
  fi

  pick_random_free_port
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --instance)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --instance" >&2
        print_usage
        exit 1
      fi
      INSTANCE_ID="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --json)
      JSON_OUTPUT=true
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      print_usage
      exit 1
      ;;
  esac
done

if [[ -z "$INSTANCE_ID" ]]; then
  echo "Missing required --instance <id> argument." >&2
  print_usage
  exit 1
fi

if ! is_valid_instance_id "$INSTANCE_ID"; then
  echo "Invalid --instance value '$INSTANCE_ID'. Allowed characters: A-Z a-z 0-9 . _ -" >&2
  exit 1
fi

INSTANCE_ROOT_DIR="/tmp/kale-qa/$INSTANCE_ID"
USER_DATA_DIR="$INSTANCE_ROOT_DIR/user-data"
STARTUP_MARKDOWN_FILE_PATH="$INSTANCE_ROOT_DIR/session.md"
LOG_FILE="$INSTANCE_ROOT_DIR/electron.log"
PID_FILE="$INSTANCE_ROOT_DIR/electron.pid"
STATE_FILE="$INSTANCE_ROOT_DIR/session.json"
ELECTRON_PID=""

mkdir -p "$INSTANCE_ROOT_DIR"
mkdir -p "$USER_DATA_DIR"

if [[ -f "$PID_FILE" ]]; then
  STALE_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ "$STALE_PID" =~ ^[0-9]+$ ]] && kill -0 "$STALE_PID" 2>/dev/null; then
    echo "Instance '$INSTANCE_ID' is already running (PID $STALE_PID)." >&2
    echo "Use a different --instance value or terminate the active session terminal." >&2
    exit 1
  fi
  rm -f "$PID_FILE"
fi

if [[ "$SKIP_BUILD" = false ]]; then
  echo "Building Vite bundles..."
  (
    cd "$PROJECT_ROOT"
    npx electron-forge package
  )
fi

if [[ ! -d "$BUILD_DIR" ]]; then
  echo "Build directory not found at $BUILD_DIR" >&2
  echo "Run without --skip-build so electron-forge can generate .vite/build." >&2
  exit 1
fi

# Why: direct Electron launches resolve app assets from .vite/build, so prompts
# and data must be copied there each run to keep QA runtime behavior consistent.
echo "Copying runtime assets to build directory..."
rm -rf "$BUILD_DIR/prompts" "$BUILD_DIR/data"
cp -R "$PROJECT_ROOT/prompts" "$BUILD_DIR/prompts"
cp -R "$PROJECT_ROOT/data" "$BUILD_DIR/data"

CDP_PORT="$(resolve_cdp_port)"
if ! [[ "$CDP_PORT" =~ ^[0-9]+$ ]]; then
  echo "Resolved CDP port '$CDP_PORT' is not numeric." >&2
  exit 1
fi

CDP_URL="http://localhost:$CDP_PORT"
if curl -s "$CDP_URL/json/version" >/dev/null 2>&1; then
  echo "CDP port $CDP_PORT is already in use. Set KALE_CDP_PORT to another port or retry." >&2
  exit 1
fi

# Why: session terminals are the lifecycle boundary in agentic QA, so cleanup
# on signal/exit must terminate only this script's Electron child process.
# shellcheck disable=SC2317,SC2329 # Invoked via trap below; ShellCheck 0.9 misclassifies trap-only functions as unreachable.
cleanup() {
  local script_exit_code=$?
  trap - EXIT INT TERM HUP

  if [[ -n "$ELECTRON_PID" ]] && kill -0 "$ELECTRON_PID" 2>/dev/null; then
    kill "$ELECTRON_PID" 2>/dev/null || true
    for _ in $(seq 1 30); do
      if ! kill -0 "$ELECTRON_PID" 2>/dev/null; then
        break
      fi
      sleep 0.1
    done
    if kill -0 "$ELECTRON_PID" 2>/dev/null; then
      kill -9 "$ELECTRON_PID" 2>/dev/null || true
    fi
  fi

  rm -f "$PID_FILE" "$STATE_FILE"
  exit "$script_exit_code"
}

trap cleanup EXIT INT TERM HUP

echo "Launching instance '$INSTANCE_ID' on CDP port $CDP_PORT..."
(
  cd "$PROJECT_ROOT"
  KALE_QA_INSTANCE_ID="$INSTANCE_ID" \
  KALE_USER_DATA_DIR="$USER_DATA_DIR" \
  KALE_STARTUP_MARKDOWN_FILE_PATH="$STARTUP_MARKDOWN_FILE_PATH" \
  ./node_modules/.bin/electron .vite/build/main.js --remote-debugging-port="$CDP_PORT"
) > >(tee "$LOG_FILE") 2>&1 &
ELECTRON_PID=$!
echo "$ELECTRON_PID" > "$PID_FILE"

for _attempt in $(seq 1 30); do
  if curl -s "$CDP_URL/json/version" >/dev/null 2>&1; then
    READY_JSON="$(
      node - "$INSTANCE_ID" "$CDP_PORT" "$CDP_URL" "$ELECTRON_PID" "$STATE_FILE" "$USER_DATA_DIR" "$STARTUP_MARKDOWN_FILE_PATH" "$LOG_FILE" <<'NODE'
const fs = require('node:fs');
const [
  instanceId,
  cdpPortText,
  cdpUrl,
  electronPidText,
  stateFilePath,
  userDataDir,
  startupMarkdownFilePath,
  logFilePath,
] = process.argv.slice(2);

const state = {
  event: 'ready',
  instanceId,
  cdpPort: Number(cdpPortText),
  cdpUrl,
  electronPid: Number(electronPidText),
  userDataDir,
  startupMarkdownFilePath,
  logFilePath,
  startedAt: new Date().toISOString(),
};

fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf8');
process.stdout.write(JSON.stringify(state));
NODE
    )"

    if [[ "$JSON_OUTPUT" = false ]]; then
      echo "CDP ready on $CDP_URL (Electron PID: $ELECTRON_PID)"
      echo "Instance state file: $STATE_FILE"
      echo "Connect with Playwright:"
      echo "  const browser = await chromium.connectOverCDP('$CDP_URL');"
    fi

    echo "KALE_QA_READY $READY_JSON"
    wait "$ELECTRON_PID"
    exit $?
  fi

  if ! kill -0 "$ELECTRON_PID" 2>/dev/null; then
    wait "$ELECTRON_PID" || true
    echo "Electron exited before CDP became ready. Review logs in $LOG_FILE" >&2
    exit 1
  fi

  sleep 1
done

echo "Timed out waiting for CDP on port $CDP_PORT for instance '$INSTANCE_ID'" >&2
tail -n 120 "$LOG_FILE" >&2 || true
exit 1
