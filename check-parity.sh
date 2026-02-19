#!/usr/bin/env bash
# Verify DimSim sim-AI files match SimStudio sim-source files.
#
# Usage:
#   bash check-parity.sh [/path/to/SimStudio]

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="${1:-/Users/shreyanskothari/Desktop/SimStudio}"

if [ ! -f "$SRC/src/ai/sim/vlmActions.js" ]; then
  echo "ERROR: SimStudio not found at $SRC"
  echo "Usage: bash check-parity.sh /path/to/SimStudio"
  exit 1
fi

STATUS=0

check_pair() {
  local src_file="$1"
  local dst_file="$2"
  local label="$3"
  if cmp -s "$src_file" "$dst_file"; then
    echo "[OK]   $label"
  else
    echo "[DIFF] $label"
    STATUS=1
  fi
}

check_pair "$SRC/src/ai/sim/vlmActions.js" "$DIR/src/ai/vlmActions.js" "vlmActions (sim)"
check_pair "$SRC/src/ai/sim/vlmPrompt.js"  "$DIR/src/ai/vlmPrompt.js"  "vlmPrompt (sim)"
check_pair "$SRC/src/ai/vlmClient.js"      "$DIR/src/ai/vlmClient.js"  "vlmClient"
check_pair "$SRC/src/ai/visionCapture.js"  "$DIR/src/ai/visionCapture.js" "visionCapture"

if [ "$STATUS" -ne 0 ]; then
  echo ""
  echo "Parity check failed. Run: bash copy-sources.sh \"$SRC\""
  exit 1
fi

echo ""
echo "Parity check passed."
