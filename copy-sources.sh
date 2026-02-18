#!/usr/bin/env bash
# Sync engine source files from VLM-agent into DimSim.
# Run after making changes in VLM-agent that should carry over.
#
# Usage: bash copy-sources.sh [/path/to/VLM-agent]
# Default: looks for VLM-agent as sibling directory on Desktop.

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="${1:-/Users/shreyanskothari/Desktop/VLM-agent}"

if [ ! -f "$SRC/src/main.js" ]; then
  echo "ERROR: VLM-agent not found at $SRC"
  echo "Usage: bash copy-sources.sh /path/to/VLM-agent"
  exit 1
fi

echo "Syncing engine from $SRC ..."
cp "$SRC/src/main.js"              "$DIR/src/engine.js"
cp "$SRC/src/style.css"            "$DIR/src/style.css"
cp "$SRC/src/AiAvatar.js"          "$DIR/src/AiAvatar.js"
mkdir -p "$DIR/src/ai"
cp "$SRC/src/ai/vlmActions.js"     "$DIR/src/ai/vlmActions.js"
cp "$SRC/src/ai/vlmPrompt.js"      "$DIR/src/ai/vlmPrompt.js"
cp "$SRC/src/ai/vlmClient.js"      "$DIR/src/ai/vlmClient.js"
cp "$SRC/src/ai/visionCapture.js"  "$DIR/src/ai/visionCapture.js"
cp "$SRC/src/ai/vibeCreator.js"    "$DIR/src/ai/vibeCreator.js"

echo "Done. engine.js: $(wc -l < "$DIR/src/engine.js") lines"
echo ""
echo "NOTE: After syncing, you may need to re-apply DimSim-specific patches"
echo "(VLM endpoint, agent defaults). Check engine.js diff before committing."
