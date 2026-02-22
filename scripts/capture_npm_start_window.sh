#!/usr/bin/env bash

set -euo pipefail

if [[ $# -gt 2 ]]; then
  echo "Usage: $0 [capture_delay_seconds] [output_png_path]" >&2
  exit 1
fi

CAPTURE_DELAY_SECONDS="${1:-0}"
OUTPUT_PATH="${2:-}"

if [[ -n "$OUTPUT_PATH" ]]; then
  mkdir -p "$(dirname "$OUTPUT_PATH")"
else
  OUTPUT_PATH="/tmp/kale-window-$(date +%Y%m%d-%H%M%S).png"
fi

find_window_id() {
  swift -e '
import CoreGraphics
import Foundation

let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []

func matches(_ window: [String: Any]) -> Bool {
  let layer = window[kCGWindowLayer as String] as? Int ?? -1
  if layer != 0 { return false }

  let title = (window[kCGWindowName as String] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  if title != "kale" { return false }

  let owner = (window[kCGWindowOwnerName as String] as? String ?? "").lowercased()
  return owner.contains("electron") || owner.contains("kale")
}

if let target = windows.first(where: matches),
   let id = target[kCGWindowNumber as String] as? Int {
  print(id)
}
'
}

has_kale_process() {
  pgrep -if 'electron.*kale|kale\.app|/kale($| )' >/dev/null 2>&1
}

if ! has_kale_process; then
  cat >&2 <<'EOF'
Could not find a running kale application process.
Start the app first (for example: npm run start), then run this script again.
EOF
  exit 1
fi

WINDOW_ID="$(find_window_id || true)"

if [[ -z "$WINDOW_ID" ]]; then
  cat >&2 <<'EOF'
Could not find a running on-screen "kale" Electron window.
Start the app first (for example: npm run start), then run this script again.
EOF
  exit 1
fi

if [[ "$CAPTURE_DELAY_SECONDS" != "0" ]]; then
  sleep "$CAPTURE_DELAY_SECONDS"
fi

screencapture -x -o -l "$WINDOW_ID" "$OUTPUT_PATH"
echo "Captured kale window ($WINDOW_ID) -> $OUTPUT_PATH"
echo "Screenshot file: $OUTPUT_PATH"
echo "$OUTPUT_PATH"
