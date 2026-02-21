#!/usr/bin/env bash
# Sync engine source files from SimStudio into DimSim.
# Run after making changes in SimStudio that should carry over.
#
# Usage: bash copy-sources.sh [/path/to/SimStudio]
# Default: looks for SimStudio as sibling directory on Desktop.

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="${1:-/Users/shreyanskothari/Desktop/SimStudio}"

if [ ! -f "$SRC/src/main.js" ]; then
  echo "ERROR: SimStudio not found at $SRC"
  echo "Usage: bash copy-sources.sh /path/to/SimStudio"
  exit 1
fi

echo "Syncing engine from $SRC ..."
cp "$SRC/src/main.js"              "$DIR/src/engine.js"
cp "$SRC/src/style.css"            "$DIR/src/style.css"
cp "$SRC/src/AiAvatar.js"          "$DIR/src/AiAvatar.js"
mkdir -p "$DIR/src/ai"
mkdir -p "$DIR/src/ai/sim"
cp "$SRC/src/ai/sim/vlmActions.js" "$DIR/src/ai/sim/vlmActions.js"
cp "$SRC/src/ai/sim/vlmPrompt.js"  "$DIR/src/ai/sim/vlmPrompt.js"
cp "$SRC/src/ai/vlmClient.js"      "$DIR/src/ai/vlmClient.js"
cp "$SRC/src/ai/visionCapture.js"  "$DIR/src/ai/visionCapture.js"

# DimSim is sim-only: strip editor-side asset creation pipeline after sync.
python3 - "$DIR/src/engine.js" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()

text = text.replace('import { initVibeCreator } from "./ai/vibeCreator.js";\n', "")
text = text.replace('import { ACTIONS as APP_VLM_ACTIONS, DEFAULTS as APP_VLM_DEFAULTS } from "./ai/vlmActions.js";\n', "")
text = text.replace('import { buildPrompt as buildAppVlmPrompt } from "./ai/vlmPrompt.js";\n', "")

text = re.sub(
    r'const IS_SIM_ONLY_PROFILE = .*?\n'
    r'const ACTIVE_VLM_ACTIONS = .*?\n'
    r'const ACTIVE_VLM_DEFAULTS = .*?\n'
    r'const buildActiveVlmPrompt = .*?\n'
    r'.*?;\n',
    'const IS_SIM_ONLY_PROFILE = true;\n'
    'const ACTIVE_VLM_ACTIONS = SIM_VLM_ACTIONS;\n'
    'const ACTIVE_VLM_DEFAULTS = SIM_VLM_DEFAULTS;\n'
    'const buildActiveVlmPrompt = () => buildSimVlmPrompt({ actions: ACTIVE_VLM_ACTIONS });\n',
    text,
    flags=re.S
)

text = re.sub(
    r'vibeCreatorApi = initVibeCreator\(\{.*?\n\}\);\n',
    '// DimSim is sim-only; editor asset-creation pipeline is disabled.\n'
    'vibeCreatorApi = null;\n',
    text,
    flags=re.S
)

path.write_text(text)
PY

echo "Done. engine.js: $(wc -l < "$DIR/src/engine.js") lines"
echo ""
echo "NOTE: After syncing, you may need to re-apply DimSim-specific patches"
echo "(VLM endpoint, agent defaults). Check engine.js diff before committing."
