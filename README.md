# DimSim

Standalone 3D simulation runner for VLM-agent scenes. Load a scene, spawn AI agents, run tasks — with full sensor support (RGB-D, LiDAR).

## Architecture

DimSim re-uses the VLM-agent engine directly. This means:
- **Any feature added to VLM-agent editor automatically works here** after running `npm run sync`
- No code duplication — one source of truth for the engine
- DimSim only adds: scene dropdown UI, VLM endpoint config, agent spawn defaults

```
DimSim/
├── index.html              ← Sim-mode UI (scene dropdown + full sensor controls)
├── src/
│   ├── main.js             ← Entry point (4 lines — imports engine.js)
│   ├── engine.js           ← Full VLM-agent engine (synced via copy-sources.sh)
│   ├── style.css           ← Synced from VLM-agent
│   ├── AiAvatar.js         ← Agent class (synced)
│   └── ai/                 ← VLM modules (synced)
├── public/
│   ├── sims/               ← Scene JSON files + manifest.json
│   └── agent-model/        ← Robot GLB models
├── vlm-server/             ← FastAPI VLM proxy (Gemini/OpenAI)
├── copy-sources.sh         ← Sync engine from VLM-agent
├── update-sims.sh          ← Rebuild scene manifest
└── vite.config.js          ← Dev proxy + build config
```

## Setup

```bash
npm install
npm run setup:server   # one-time: pip install Python deps
```

## Run

Terminal 1:
```bash
npm run server         # VLM backend on :8000
```

Terminal 2:
```bash
npm run dev            # Frontend on :5173
```

## Sync from VLM-agent

After making changes in the VLM-agent editor project:

```bash
npm run sync           # copies engine + AI modules
```

**DimSim-specific patches** (VLM endpoint, agent defaults) live in `engine.js` — check the diff after syncing.

## Add/remove scenes

Drop `.json` scene files in `public/sims/`, then:

```bash
npm run update-sims    # rebuilds manifest.json
```

## Features

- Full sim mode: navigation, interaction, physics, lighting
- AI agent: spawn, task assignment, VLM decision loop
- Sensors: RGB-D depth, LiDAR point cloud, compare view, noise simulation
- Portal system, pickable assets, bumpable objects
- All material types from editor (glass, metal, fabric, etc.)
