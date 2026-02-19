/**
 * Vibe Creator – Agentic 3D scene generation.
 *
 * Works like Cursor's agentic mode: decomposes complex goals (e.g. "build an
 * apartment") into ordered subtasks, executes each additively with vision
 * feedback, reviews, fixes, and polishes — fully autonomously.
 *
 * Three-phase flow:
 *   Phase 1  PLAN   — LLM breaks the goal into ordered tasks
 *   Phase 2  BUILD  — For each task: execute → merge → review → fix if needed
 *   Phase 3  POLISH — Final holistic review + adjustments
 */

// =============================================================================
// SHARED SCHEMA — referenced by executor, reviewer, and final-review prompts
// =============================================================================

const SCENE_SCHEMA = `## Coordinate System
- Y-axis is UP. Floor at Y=0.
- Object Y position = half its height to sit flush on the floor (e.g., a 0.8m tall box → Y=0.4).
- Typical room: ~6m wide (X), ~3m tall (Y), ~6m deep (Z). Center near origin.
- Positive X = right, Negative X = left.
- Positive Z = toward camera (south), Negative Z = away (north).

## Primitive Types

### box
- Dimensions: { width: [0.01–50], height: [0.01–50], depth: [0.01–50] } (meters)
- Common uses: walls, floors, ceilings, tables, shelves, doors, cabinets, cushions, screens
- Placement: Y = height / 2 for floor contact
- Typical scales:
  - Wall: width 6.0, height 3.0, depth 0.15
  - Door: width 0.9, height 2.1, depth 0.08
  - Dining table top: width 1.4, height 0.05, depth 0.9
  - Desk: width 1.2, height 0.05, depth 0.6
  - Shelf: width 0.8, height 0.02, depth 0.3
  - Seat cushion: width 0.45, height 0.08, depth 0.45
  - Book: width 0.15, height 0.22, depth 0.03
  - TV screen: width 1.2, height 0.7, depth 0.05

### sphere
- Dimensions: { radius: [0.01–10] }
- Common uses: decorative balls, lamp globes, fruit, planet models
- Placement: Y = radius for floor contact
- Typical scales: decorative ball 0.1, lamp globe 0.15, fruit 0.04

### cylinder
- Dimensions: { radiusTop: [0.005–5], radiusBottom: [0.005–5], height: [0.01–20] }
- Common uses: table/chair legs, columns, vases, lamp posts, cups, pipes
- Placement: Y = height / 2 for floor contact
- Typical scales:
  - Table leg: rTop 0.025, rBot 0.025, h 0.73
  - Chair leg: rTop 0.02, rBot 0.02, h 0.43
  - Column: rTop 0.15, rBot 0.15, h 3.0
  - Vase: rTop 0.06, rBot 0.08, h 0.25
  - Cup: rTop 0.04, rBot 0.035, h 0.12

### cone
- Dimensions: { radius: [0.01–5], height: [0.01–20] }
- Common uses: lamp shades, roof peaks, tree tops, party hats
- Placement: Y = height / 2 for floor contact
- Typical scales: lamp shade r 0.2, h 0.15; tree top r 0.5, h 1.0

### torus
- Dimensions: { radius: [0.05–5], tube: [0.01–2] }
- Common uses: picture frames, decorative rings, donut shapes
- Typical scales: picture frame r 0.3, tube 0.02; ring r 0.15, tube 0.02

### plane
- Dimensions: { width: [0.01–100], height: [0.01–100] } (flat 2D surface)
- Common uses: rugs, posters, screens, mirrors, paintings
- Typical scales: rug 2.0x1.5, poster 0.6x0.9, mirror 0.5x1.0

## Common Furniture Dimensions Reference
| Furniture            | Height (Y) | Width (X) | Depth (Z) |
|----------------------|------------|-----------|-----------|
| Dining table         | 0.75m      | 1.2–1.8m  | 0.8–1.0m  |
| Coffee table         | 0.45m      | 1.0–1.2m  | 0.6m      |
| Desk                 | 0.75m      | 1.2–1.6m  | 0.6–0.8m  |
| Chair seat height    | 0.45m      | 0.45m     | 0.45m     |
| Chair total height   | 0.85m      | 0.45m     | 0.45m     |
| Sofa seat height     | 0.42m      | 1.8–2.4m  | 0.85m     |
| Bed (queen)          | 0.55m      | 1.5m      | 2.0m      |
| Bookshelf            | 1.8m       | 0.8m      | 0.3m      |
| Kitchen counter      | 0.9m       | varies    | 0.6m      |
| Door                 | 2.1m       | 0.9m      | 0.08m     |
| Window               | 1.2m       | 1.0m      | 0.1m      |
| Standard ceiling     | 2.7–3.0m   | –         | –         |
| Wall thickness       | –          | –         | 0.12–0.15m|

## Material
Use this in 3 steps to reduce decision load:

1) Start with ONLY these core keys:
- color (hex), softness (0..1), metalness (0..1), optional opacity

2) Use these recipe targets when needed:
- cushion/fabric: softness high, hardness low, fluffiness medium-high
- leaf: doubleSided true, alphaCutoff ~0.3-0.6, slight transmission
- water/glass: transmission high, ior 1.33-1.52, thickness > 0, opacity near 1
- mirror/chrome: metalness high, softness near 0, envMapIntensity high
- concrete: softness high, metalness near 0, textureHardness medium-high

3) Advanced keys (optional overrides):
- hardness, fluffiness
- specularIntensity, specularColor, envMapIntensity
- transmission, ior, thickness, attenuationColor, attenuationDistance
- iridescence
- emissive, emissiveIntensity
- clearcoat, clearcoatRoughness
- alphaCutoff
- doubleSided, flatShading, wireframe
- textureSoftness, textureHardness
- uvTransform: { repeatX, repeatY, offsetX, offsetY, rotationDeg }
- generateTexture (optional short prompt; use on only 2-4 key surfaces/task)

## Boolean Cutouts (optional)
- You can carve holes by adding "cutouts" to a primitive.
- Each cutout uses another primitive-like shape in the target's local space.
- Keep cutouts sparse (0-3 per object) for performance.

## Lights
| type          | extra keys                                    |
|---------------|-----------------------------------------------|
| "directional" | target {x,y,z}                                |
| "point"       | distance (0=infinite)                         |
| "spot"        | target, distance, angle (rad), penumbra 0-1   |
All: color (hex), intensity (0-10), position {x,y,z}, castShadow (bool).

## Groups
Multi-part objects MUST be grouped:
{ "id": "chair-1", "name": "Chair", "children": ["chair-1-seat", "chair-1-back", "chair-1-leg-fl", ...] }

## Primitive JSON Shape
Use this minimal structure by default:
{
  "id": "<unique-kebab-case>",
  "type": "box",
  "name": "Table Top",
  "notes": "", "tags": [], "state": "static", "metadata": {},
  "dimensions": { "width": 1.2, "height": 0.05, "depth": 0.8, "edgeRadius": 0.02 },
  "transform": {
    "position": { "x": 0, "y": 0.75, "z": 0 },
    "rotation": { "x": 0, "y": 0, "z": 0 },
    "scale": { "x": 1, "y": 1, "z": 1 }
  },
  "material": {
    "color": "#8B4513",
    "softness": 0.6,
    "metalness": 0.0,
    "opacity": 1.0
  },
  "cutouts": [],
  "physics": true, "castShadow": true, "receiveShadow": true
}

Only add advanced material keys when needed for a specific look.

## Rules
- Every ID must be unique kebab-case.
- Rotation in radians. Use plain numbers (3.14159, not Math.PI).
- Build furniture from MULTIPLE primitives and GROUP them.
- Consult the Common Furniture Dimensions Reference above for realistic proportions.
- CRITICAL: valid JSON only. No JS expressions, no comments, no trailing commas.`;

// =============================================================================
// PROMPTS
// =============================================================================

const PLANNER_PROMPT = `## ROLE
You are a 3D scene architect planner. Given a high-level goal, you break it into an ordered list of concrete construction tasks that a builder agent will execute one by one.

## GUIDELINES
- Start with structural elements (walls, floors, room layout) if the scene needs enclosure.
- Then add furniture/objects room-by-room or area-by-area.
- Lighting should come AFTER furniture is placed so light positions make sense.
- Decoration and fine details should be the final tasks.
- Each task should produce roughly 5–25 primitives. Split large areas into multiple tasks.
- Do not over-stage simple structure primitives (walls/floors/basic blocks). Reserve asset staging for reusable or texture-complex assets.
- Each task description MUST be SPECIFIC: name the objects to build, approximate sizes, materials/colors, and WHERE to place them (use coordinates or relative directions like "along the north wall at Z=-3").
- If the request is simple (e.g. "add a chair"), return just 1 task.
- Tasks are executed sequentially — later tasks can reference objects from earlier tasks.

## OUTPUT FORMAT
Output ONLY valid JSON — no markdown, no comments, no extra text:
{
  "plan": [
    {
      "id": "unique-task-id",
      "title": "Short task title",
      "description": "Detailed description of what to build, where to place it, materials, etc."
    }
  ]
}

## EXAMPLE
Goal: "A small cozy café with a counter, seating area, and warm lighting"
{
  "plan": [
    {
      "id": "structure",
      "title": "Café floor and walls",
      "description": "Build a rectangular café space ~8m wide (X) x 7m deep (Z). Floor at Y=0 in warm wood tone (#D2A679). Walls 3m tall, 0.15m thick on all four sides. Front wall (Z=3.5) should have a 2m wide opening for the entrance centered at X=0. Walls in cream (#F5F0E1)."
    },
    {
      "id": "counter-area",
      "title": "Service counter with bar stools",
      "description": "Build an L-shaped service counter along the back wall (Z=-3). Main counter ~3m wide, 0.9m tall, 0.6m deep in dark wood (#5C3A1E). Add 4 bar stools (seat height 0.7m) spaced evenly in front of the counter. Add a small display case on the counter (glass-like material, low roughness)."
    },
    {
      "id": "seating",
      "title": "Café tables and chairs",
      "description": "Place 4 small round café tables (0.7m diameter, 0.75m tall) with 2 chairs each in the seating area (X: -2 to 2, Z: -1 to 2.5). Space tables at least 1.5m apart. Tables in light wood (#C4A882), chairs in dark metal (#2C2C2C) with cushion seats."
    },
    {
      "id": "lighting",
      "title": "Warm ambient and accent lighting",
      "description": "Add 4 warm pendant lights (point lights, color #FFE4B5, intensity 3) hanging at Y=2.2 above each table. Add 2 spot lights behind the counter pointing down at the display area. One ambient directional light from above (warm white, intensity 1.5) for overall fill."
    },
    {
      "id": "decoration",
      "title": "Decorative details and plants",
      "description": "Add a menu board (plane, dark green #2D4A3E) on the wall behind the counter. Place 2-3 small potted plants (cylinders for pots, cones/spheres for foliage) on windowsills and counter. Add a rug (#8B6F47) under the seating area. Use generateTexture on the floor for 'warm oak hardwood planks' and on the menu board for 'chalkboard with café menu'."
    }
  ]
}`;

const TASK_EXECUTOR_PROMPT = `## ROLE
You are a 3D scene builder executing ONE construction task at a time. You receive the task description, what already exists in the scene, and optionally a screenshot. You output ONLY the NEW objects for this task.

## THINKING PROCESS
Before generating objects, reason through your spatial plan:
1. Where in the scene does this task take place? (coordinates)
2. What existing objects must I avoid overlapping with?
3. What are the correct real-world dimensions for each object?
4. How should objects be positioned relative to each other?
Include this reasoning in your output's "reasoning" field.

${SCENE_SCHEMA}

## OUTPUT FORMAT
Output ONLY valid JSON with reasoning and new objects:
{
  "reasoning": "Brief explanation of your spatial plan — where you're placing objects and why, what dimensions you're using, and how you're avoiding overlaps with existing objects.",
  "tags": [],
  "primitives": [ ...only NEW primitives for this task... ],
  "lights": [ ...only NEW lights, if this task requires them... ],
  "groups": [ ...only NEW groups for this task's multi-part objects... ]
}

## CORRECT OUTPUT EXAMPLE
Task: "Place a wooden dining table with 4 chairs in the center of the room"
Existing: floor (6x6m at Y=0), walls at X=±3, Z=±3

{
  "reasoning": "Center of room is (0, 0, 0). Table top at Y=0.75 (standard dining height). Table top is 1.4x0.05x0.9m. 4 legs as cylinders (r=0.025, h=0.73) at corners, Y=0.365 (half of 0.73). 4 chairs positioned 0.6m from table edges.",
  "tags": [],
  "primitives": [
    { "id": "dining-table-top", "type": "box", "name": "Table Top", "dimensions": {"width": 1.4, "height": 0.05, "depth": 0.9}, "transform": {"position": {"x": 0, "y": 0.75, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 0}, "scale": {"x": 1, "y": 1, "z": 1}}, "material": {"color": "#8B4513", "roughness": 0.6, "metalness": 0.0}, "notes": "", "tags": [], "state": "static", "metadata": {}, "physics": true, "castShadow": true, "receiveShadow": true },
    { "id": "dining-table-leg-fl", "type": "cylinder", "name": "Leg FL", "dimensions": {"radiusTop": 0.025, "radiusBottom": 0.025, "height": 0.73}, "transform": {"position": {"x": -0.6, "y": 0.365, "z": 0.35}, "rotation": {"x": 0, "y": 0, "z": 0}, "scale": {"x": 1, "y": 1, "z": 1}}, "material": {"color": "#8B4513", "roughness": 0.6, "metalness": 0.0}, "notes": "", "tags": [], "state": "static", "metadata": {}, "physics": true, "castShadow": true, "receiveShadow": true },
    { "id": "dining-table-leg-fr", "type": "cylinder", "name": "Leg FR", "dimensions": {"radiusTop": 0.025, "radiusBottom": 0.025, "height": 0.73}, "transform": {"position": {"x": 0.6, "y": 0.365, "z": 0.35}, "rotation": {"x": 0, "y": 0, "z": 0}, "scale": {"x": 1, "y": 1, "z": 1}}, "material": {"color": "#8B4513", "roughness": 0.6, "metalness": 0.0}, "notes": "", "tags": [], "state": "static", "metadata": {}, "physics": true, "castShadow": true, "receiveShadow": true },
    { "id": "dining-table-leg-bl", "type": "cylinder", "name": "Leg BL", "dimensions": {"radiusTop": 0.025, "radiusBottom": 0.025, "height": 0.73}, "transform": {"position": {"x": -0.6, "y": 0.365, "z": -0.35}, "rotation": {"x": 0, "y": 0, "z": 0}, "scale": {"x": 1, "y": 1, "z": 1}}, "material": {"color": "#8B4513", "roughness": 0.6, "metalness": 0.0}, "notes": "", "tags": [], "state": "static", "metadata": {}, "physics": true, "castShadow": true, "receiveShadow": true },
    { "id": "dining-table-leg-br", "type": "cylinder", "name": "Leg BR", "dimensions": {"radiusTop": 0.025, "radiusBottom": 0.025, "height": 0.73}, "transform": {"position": {"x": 0.6, "y": 0.365, "z": -0.35}, "rotation": {"x": 0, "y": 0, "z": 0}, "scale": {"x": 1, "y": 1, "z": 1}}, "material": {"color": "#8B4513", "roughness": 0.6, "metalness": 0.0}, "notes": "", "tags": [], "state": "static", "metadata": {}, "physics": true, "castShadow": true, "receiveShadow": true }
  ],
  "lights": [],
  "groups": [
    { "id": "dining-table", "name": "Dining Table", "children": ["dining-table-top", "dining-table-leg-fl", "dining-table-leg-fr", "dining-table-leg-bl", "dining-table-leg-br"] }
  ]
}
(Chairs omitted for brevity — in real output, include ALL objects for the task.)

## COMMON MISTAKES — DO NOT DO THESE

WRONG — Including existing objects in output:
{ "primitives": [ {"id": "existing-wall-1", ...}, {"id": "new-table", ...} ] }
Only output NEW objects. Existing objects are provided for spatial reference only.

WRONG — Using JS expressions instead of numbers:
{ "position": { "y": "height/2" } }  or  { "rotation": { "y": "Math.PI" } }
Always use computed numeric values: { "y": 0.365 } or { "y": 3.14159 }

WRONG — Wrapping JSON in markdown code fences.
Output raw JSON only, no wrapping.

WRONG — Objects floating in the air:
{ "position": { "y": 2.0 } } for a table that should be on the floor.
Floor-standing objects: Y = object_height / 2. Table-top objects: Y = table_height + object_height / 2.

WRONG — Unrealistic proportions:
A chair taller than a door, a table the size of a room, a cup the size of a chair.
Consult the Common Furniture Dimensions Reference in the schema.

## SPATIAL AWARENESS
- You will be given positions and sizes of existing objects. Do NOT place new objects where they would overlap.
- Place objects in logical positions relative to existing ones (chairs near tables, lamps near seating, nightstands beside beds, etc.).
- Maintain realistic clearance: at least 0.5m walkways between furniture, chairs pulled 0.3m out from table edges.
- If you see a screenshot, use it to understand the current spatial layout and verify your coordinate choices.
- If a Materials Palette is provided in the scene context, use those colors/materials for style consistency unless the task specifies otherwise.

## STAGED-ASSET POLICY (CRITICAL)
- If the context includes AVAILABLE_STAGED_ASSETS / STAGED_ASSET_CATALOG, those assets already exist and WILL be placed from the asset library.
- In that case, DO NOT build furniture/props/decor assets in this task.
- Only output scene structure + architectural elements + optional lighting (walls, floors, ceilings, doors, windows, simple partitions, light fixtures).`;

const TASK_REVIEWER_PROMPT = `## ROLE
You are a STRICT 3D scene quality inspector. Your job is to find problems — not to be lenient.
You are NOT the builder. Do not make excuses for poor placement.
You are reviewing a single construction task that was just completed. Evaluate ONLY the objects added by this task.

## FAILURE CRITERIA — Fail the review if ANY of these are true:
1. **Floating objects**: Any object's Y position is more than 0.1m higher than expected ground/surface contact
2. **Clipping/Overlap**: Any two objects from this task overlap significantly, or new objects clip through existing ones
3. **Unrealistic scale**: Any object's dimensions are clearly wrong (e.g., a chair taller than a door, a cup bigger than a plate)
4. **Missing grouping**: Multi-part furniture (table with legs, chair with seat/back) is not grouped
5. **Spatial nonsense**: Objects placed in illogical locations (lamp inside a wall, chair on top of table, sink floating in mid-room)
6. **Missing critical objects**: The task description mentions specific objects that were not created

## WHAT TO IGNORE — Do NOT fail for:
- Minor color or material preference differences (subjective)
- Slight imperfections in spacing (< 0.1m off)
- Missing optional decorative details not mentioned in the task

## EVALUATION PROCESS
1. Check each new object's Y position against expected ground/surface contact
2. Compare positions against existing scene objects for overlap/clipping
3. Verify dimensions against real-world proportions
4. Confirm multi-part objects are properly grouped
5. Check that all objects mentioned in the task description exist

## OUTPUT FORMAT
Respond with ONLY valid JSON:

If the task passes ALL checks:
{ "status": "ok", "reasoning": "Brief explanation of what looks correct." }

If ANY failure criterion is triggered:
{
  "status": "fix",
  "reasoning": "Specific description of what failed and what you're correcting. Reference exact object IDs and positions.",
  "scene": { "tags": [], "primitives": [...corrected objects...], "lights": [...], "groups": [...] }
}

The "scene" in a fix must contain the COMPLETE replacement objects for this task (not the full scene — only this task's objects, corrected).

${SCENE_SCHEMA}`;

const FINAL_REVIEW_PROMPT = `## ROLE
You are performing a final holistic review of a completed 3D scene. All construction tasks are done. Your job is to check the scene as a whole and identify any significant issues.

## EVALUATION CHECKLIST
1. **Completeness**: Is anything from the original request clearly missing?
2. **Layout logic**: Does the overall arrangement make spatial sense? (e.g., kitchen near dining, bedroom separate from living areas)
3. **Lighting balance**: Is there sufficient lighting across all areas? Any dark corners that need a light?
4. **Floating/Clipping**: Any objects visibly floating or clipping through others?
5. **Proportions**: Do objects look correctly sized relative to each other?
6. **Cohesion**: Do materials and colors form a coherent style?

## WHEN TO REFINE
Only request refinement for SIGNIFICANT issues:
- An entire room or area is missing from the request
- A major piece of furniture is missing (e.g., no bed in a bedroom)
- Lighting is completely absent in a large area
- Multiple objects are badly misplaced

Do NOT refine for minor aesthetic preferences or tiny gaps.

## OUTPUT FORMAT
Respond with ONLY valid JSON:

If the scene is acceptable:
{ "status": "done", "reasoning": "Brief summary of the completed scene and its strengths." }

If significant improvements are needed:
{
  "status": "refine",
  "reasoning": "What specific issues need fixing and why.",
  "scene": { "tags": [], "primitives": [...], "lights": [...], "groups": [...] }
}

If status is "refine", the scene must be the COMPLETE updated scene (ALL objects, not just changes).

${SCENE_SCHEMA}`;

const ASSET_STAGING_PROMPT = `## ROLE
You are generating ONE reusable 3D asset for a staging area.

## GOAL
- Build exactly one coherent asset (single object/furniture/prop) as grouped primitives.
- Do NOT place it in the final room. Keep it authored near origin for staging.
- Prioritize geometry quality, proportions, and material quality over scene placement.

## OUTPUT
Return ONLY valid JSON:
{
  "reasoning": "MAX 20 words on how you designed this asset and chosen proportions/materials.",
  "tags": ["staging-asset"],
  "primitives": [...],
  "lights": [],
  "groups": [...]
}

## RULES
- Asset should be floor-grounded and centered around origin.
- Multi-part assets must be grouped.
- Use generateTexture only for key surfaces that need visual fidelity.
- Keep output compact: short IDs/names, no unnecessary prose.
- No markdown/code fences/comments.

${SCENE_SCHEMA}`;

const ASSET_REVIEW_PROMPT = `## ROLE
You are a strict reviewer for a staged reusable asset.

## CHECK
- Is it recognizably the requested asset?
- Are proportions realistic?
- Are parts grouped correctly?
- Any floating/clipping/self-intersection issues?
- Are materials/textures appropriate?

## OUTPUT
If acceptable:
{ "status": "ok", "reasoning": "MAX 15 words." }

If fixes are needed:
{
  "status": "fix",
  "reasoning": "MAX 20 words on what to correct.",
  "scene": { "tags": [], "primitives": [...], "lights": [], "groups": [...] }
}

${SCENE_SCHEMA}`;

const AUTO_STAGE_ASSET_PLANNER_PROMPT = `## ROLE
You identify which reusable assets should be staged first before scene generation.

## GOAL
- Given a scene request, pick ALL reusable and texture-complex assets that benefit from isolated asset-builder generation and validation.
- Exclude structure primitives (walls, floors, ceilings, plain blocks).
- Exclude tiny throwaway decor.
- Include furniture/props likely reused multiple times (shelves, racks, desks, machines, cabinets, lamps).
- Streetscape/building frontage assets (shop facades, storefront modules, window displays, awnings, signs) MUST be staged as assets, not generated directly in the scene phase.
- When unsure, prefer staging the asset rather than constructing it directly in scene tasks.

## OUTPUT
Return ONLY valid JSON:
{
  "reasoning": "MAX 12 word explanation of how you decomposed the request into staged assets and why",
  "assets": [
    {
      "name": "Short asset name",
      "prompt": "Specific prompt to generate this one asset in staging",
      "count": 1
    }
  ]
}

## RULES
- Return 0 to 20 assets max (include ALL non-structure furniture/props that should be staged).
- count must be an integer 1-6.
- If no reusable assets are needed, return {"assets":[]}.
- Keep text compact; prioritize complete valid JSON.
- No markdown/code fences/comments.`;

const ASSET_PLACEMENT_PROMPT = `## ROLE
You place already-generated staged assets into a completed structural scene.

## INPUT
- Scene request text
- Current structural scene summary (after structure generation)
- Staged asset catalog (names + intended counts)

## OUTPUT
Return ONLY valid JSON:
{
  "reasoning": "How you decided placement zones and spacing.",
  "placements": [
    {
      "assetName": "Name from staged catalog",
      "count": 2,
      "positions": [{ "x": 0, "z": -2 }, { "x": 2, "z": -2 }]
    }
  ]
}

## RULES
- Use only assetName values from staged catalog.
- count must match number of positions.
- Keep >= 0.9m spacing between large assets when possible.
- No markdown/code fences/comments.`;

const ASSET_LIBRARY_KEY = "sparkWorldAssetLibrary";
const VIBE_CHAT_HISTORY_KEY = "sparkWorldVibeChatHistory";

// =============================================================================
// HELPERS — parsing, validation, math sanitization
// =============================================================================

function sanitizeJSMath(text) {
  // 1. Replace Math.* expressions (e.g. Math.PI, Math.PI / 2)
  text = text.replace(/Math\.\w+(?:\s*[\/\*\+\-]\s*[\d.]+)*/g, (match) => {
    try {
      const val = Function(`"use strict"; return (${match})`)();
      return typeof val === "number" && isFinite(val) ? String(val) : match;
    } catch { return match; }
  });

  // 2. Replace inline arithmetic in JSON value positions (e.g. "y": 0.22 + 0.09,)
  //    Pattern: a colon followed by a numeric expression with +, -, *, /
  text = text.replace(/:\s*(-?[\d.]+\s*[+\-*/]\s*-?[\d.]+(?:\s*[+\-*/]\s*-?[\d.]+)*)\s*(?=[,}\]\n\r])/g, (match, expr) => {
    try {
      const val = Function(`"use strict"; return (${expr})`)();
      if (typeof val === "number" && isFinite(val)) return `: ${val}`;
    } catch { /* skip */ }
    return match;
  });

  return text;
}

/** Strip JS-style comments from JSON (LLMs love to add // comments) */
function stripJSComments(text) {
  // Remove single-line comments (// ...) but not inside strings
  // Strategy: skip quoted strings, remove // to end-of-line outside them
  let result = "";
  let i = 0;
  while (i < text.length) {
    // Skip strings (preserve their contents)
    if (text[i] === '"') {
      result += '"';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') { result += text[i++]; } // skip escaped char
        if (i < text.length) { result += text[i++]; }
      }
      if (i < text.length) { result += text[i++]; } // closing quote
    }
    // Single-line comment
    else if (text[i] === '/' && text[i + 1] === '/') {
      // Skip to end of line
      while (i < text.length && text[i] !== '\n') i++;
    }
    // Block comment
    else if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; // skip */
    }
    else {
      result += text[i++];
    }
  }
  return result;
}

function extractJSON(text, opts = {}) {
  const quiet = opts?.quiet === true;
  if (!text || typeof text !== "string") {
    if (text && typeof text === "object") return text;
    throw new Error("Empty or invalid LLM response.");
  }
  text = text.replace(/^\uFEFF/, "").trim();
  text = sanitizeJSMath(text);
  text = stripJSComments(text);

  try { return JSON.parse(text); } catch { /* continue */ }

  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* continue */ }
  }

  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    try { return JSON.parse(text.slice(braceStart, braceEnd + 1)); } catch { /* continue */ }
    let cleaned = text.slice(braceStart, braceEnd + 1).replace(/,\s*([}\]])/g, "$1");
    try { return JSON.parse(cleaned); } catch { /* continue */ }
  }

  // ── Truncated JSON repair ──
  // If the response was cut off mid-JSON (common with token limits), try to
  // close all open brackets/braces and parse what we have.
  if (braceStart !== -1) {
    let fragment = text.slice(braceStart);
    // Strip any trailing partial key/value (text after the last comma or colon that isn't closed)
    fragment = fragment.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"{}[\]]*$/, "");
    fragment = fragment.replace(/,\s*$/, "");
    // Count unclosed braces/brackets and close them
    let opens = 0, openBrackets = 0;
    let inString = false, escaped = false;
    for (const ch of fragment) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") opens++;
      else if (ch === "}") opens--;
      else if (ch === "[") openBrackets++;
      else if (ch === "]") openBrackets--;
    }
    // Close any open string
    if (inString) fragment += '"';
    // Close open brackets then braces
    for (let i = 0; i < openBrackets; i++) fragment += "]";
    for (let i = 0; i < opens; i++) fragment += "}";
    // Remove trailing commas before closers
    fragment = fragment.replace(/,\s*([}\]])/g, "$1");
    try {
      const repaired = JSON.parse(fragment);
      console.warn("[VibeCreator] Repaired truncated JSON (" + (opens + openBrackets) + " closers added)");
      return repaired;
    } catch { /* continue */ }
  }

  if (!quiet) console.error("[VibeCreator] Failed to parse:", text.slice(0, 600));
  throw new Error("Could not parse JSON from LLM response.");
}

function buildFallbackAssetScene(prompt = "asset") {
  const safe = String(prompt || "asset").trim().slice(0, 32) || "asset";
  const id = _randId();
  return {
    tags: ["staging-asset", safe.toLowerCase().replace(/\s+/g, "-")],
    primitives: [
      {
        id,
        type: "box",
        name: safe,
        dimensions: { width: 1.0, height: 1.0, depth: 1.0 },
        transform: {
          position: { x: 0, y: 0.5, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        material: { color: "#7b8794", roughness: 0.8, metalness: 0.1, textureDataUrl: null },
        physics: true,
        castShadow: true,
        receiveShadow: true,
        notes: "Fallback primitive from parse recovery",
        tags: ["fallback"],
        state: "static",
        metadata: {},
      },
    ],
    lights: [],
    groups: [],
  };
}

function parsePlannerAssetsLoose(rawText) {
  const text = String(rawText || "");
  const out = [];
  // Recover complete objects that already contain name/prompt/count.
  const re = /\{[^{}]*"name"\s*:\s*"([^"]+)"[^{}]*"prompt"\s*:\s*"([^"]+)"[^{}]*"count"\s*:\s*(\d+)[^{}]*\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = String(m[1] || "").trim();
    const prompt = String(m[2] || "").trim();
    const count = Math.max(1, Math.min(6, Number(m[3] || 1)));
    if (!prompt) continue;
    out.push({ name: name || prompt.slice(0, 24), prompt, count });
  }
  // De-duplicate by prompt text
  const seen = new Set();
  return out.filter((x) => {
    const k = x.prompt.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function validateScene(scene) {
  if (!scene || typeof scene !== "object") throw new Error("Response is not an object.");
  if (!Array.isArray(scene.tags)) scene.tags = [];
  if (!Array.isArray(scene.primitives)) scene.primitives = [];
  if (!Array.isArray(scene.lights)) scene.lights = [];

  for (const p of scene.primitives) {
    if (!p.id) p.id = _randId();
    if (!p.transform) p.transform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
    if (!p.transform.rotation) p.transform.rotation = { x: 0, y: 0, z: 0 };
    if (!p.transform.scale) p.transform.scale = { x: 1, y: 1, z: 1 };
    if (!p.material) p.material = { color: "#808080", roughness: 0.7, metalness: 0.0 };
    if (p.material.softness === undefined) p.material.softness = p.material.roughness ?? 0.7;
    if (p.material.roughness === undefined) p.material.roughness = p.material.softness ?? 0.7;
    if (p.material.hardness === undefined) p.material.hardness = 0.0;
    if (p.material.fluffiness === undefined) p.material.fluffiness = 0.0;
    if (p.material.specularIntensity === undefined) p.material.specularIntensity = 1.0;
    if (!p.material.specularColor) p.material.specularColor = "#ffffff";
    if (p.material.envMapIntensity === undefined) p.material.envMapIntensity = 1.0;
    if (p.material.textureDataUrl === undefined) p.material.textureDataUrl = null;
    if (p.material.opacity === undefined) p.material.opacity = 1.0;
    if (p.material.transmission === undefined) p.material.transmission = 0.0;
    if (p.material.ior === undefined) p.material.ior = 1.45;
    if (p.material.thickness === undefined) p.material.thickness = 0.0;
    if (!p.material.attenuationColor) p.material.attenuationColor = "#ffffff";
    if (p.material.attenuationDistance === undefined) p.material.attenuationDistance = 1.0;
    if (p.material.iridescence === undefined) p.material.iridescence = 0.0;
    if (!p.material.emissive) p.material.emissive = "#000000";
    if (p.material.emissiveIntensity === undefined) p.material.emissiveIntensity = 0.0;
    if (p.material.clearcoat === undefined) p.material.clearcoat = 0.0;
    if (p.material.clearcoatRoughness === undefined) p.material.clearcoatRoughness = 0.0;
    if (p.material.textureSoftness === undefined) p.material.textureSoftness = 0.25;
    if (p.material.textureHardness === undefined) p.material.textureHardness = 0.5;
    if (p.material.alphaCutoff === undefined) p.material.alphaCutoff = 0.0;
    if (p.material.doubleSided === undefined) p.material.doubleSided = true;
    if (p.material.flatShading === undefined) p.material.flatShading = false;
    if (p.material.wireframe === undefined) p.material.wireframe = false;
    if (!p.material.uvTransform || typeof p.material.uvTransform !== "object") {
      p.material.uvTransform = { repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0, rotationDeg: 0 };
    } else {
      const uv = p.material.uvTransform;
      if (uv.repeatX === undefined) uv.repeatX = 1;
      if (uv.repeatY === undefined) uv.repeatY = 1;
      if (uv.offsetX === undefined) uv.offsetX = 0;
      if (uv.offsetY === undefined) uv.offsetY = 0;
      if (uv.rotationDeg === undefined) uv.rotationDeg = 0;
    }
    if (p.physics === undefined) p.physics = true;
    if (p.castShadow === undefined) p.castShadow = true;
    if (p.receiveShadow === undefined) p.receiveShadow = true;
    if (!p.notes) p.notes = "";
    if (!Array.isArray(p.tags)) p.tags = [];
    if (!p.state) p.state = "static";
    if (!p.metadata) p.metadata = {};
    if (!p.name) p.name = p.type ? p.type.charAt(0).toUpperCase() + p.type.slice(1) : "Shape";
    if (!Array.isArray(p.cutouts)) p.cutouts = [];
  }

  for (const l of scene.lights) {
    if (!l.id) l.id = _randId();
    if (!l.name) l.name = l.type ? l.type.charAt(0).toUpperCase() + l.type.slice(1) + " Light" : "Light";
    if (!["directional", "point", "spot"].includes(l.type)) l.type = "point";
    if (!l.color) l.color = "#ffffff";
    if (l.intensity === undefined) l.intensity = 1.0;
    l.intensity = Math.max(0, Math.min(8, Number(l.intensity) || 1.0));
    if (!l.position) l.position = { x: 0, y: 2.5, z: 0 };
    if (!l.target) l.target = { x: 0, y: 0, z: 0 };
    if (l.distance === undefined) l.distance = 0;
    if (l.castShadow === undefined) l.castShadow = false;
    if (l.type === "spot") {
      if (l.angle === undefined) l.angle = 0.78;
      if (l.penumbra === undefined) l.penumbra = 0.1;
    }
  }

  // Render-budget guardrail:
  // Too many shadow-casting lights (especially point lights) can exceed
  // MAX_TEXTURE_IMAGE_UNITS and crash shader validation.
  // Keep a strict budget and silently disable extra shadows.
  const MAX_LIGHTS_TOTAL = 8;
  if (scene.lights.length > MAX_LIGHTS_TOTAL) {
    scene.lights = scene.lights.slice(0, MAX_LIGHTS_TOTAL);
  }
  const shadowCost = (l) => (l.type === "point" ? 6 : 1);
  const MAX_SHADOW_TEXTURE_UNITS = 8;
  let usedShadowUnits = 0;
  for (const l of scene.lights) {
    if (!l.castShadow) continue;
    const c = shadowCost(l);
    if (usedShadowUnits + c > MAX_SHADOW_TEXTURE_UNITS) {
      l.castShadow = false;
      continue;
    }
    usedShadowUnits += c;
  }

  if (!Array.isArray(scene.groups)) scene.groups = [];
  const primIds = new Set(scene.primitives.map((p) => p.id));
  for (const g of scene.groups) {
    if (!g.id) g.id = _randId();
    if (!g.name) g.name = "Group";
    if (!Array.isArray(g.children)) g.children = [];
    g.children = g.children.filter((cid) => primIds.has(cid));
  }
  scene.groups = scene.groups.filter((g) => g.children.length > 0);

  return scene;
}

function buildFallbackStructureScene(goalPrompt, task) {
  const baseId = _randId().slice(0, 8);
  const floorColor = /wood|oak|hardwood/i.test(goalPrompt) ? "#a17b57" : "#7a7a7a";
  const wallColor = /brick/i.test(goalPrompt) ? "#8c5645" : "#d4d4d4";
  const width = 10;
  const depth = 8;
  const height = 3;
  const t = 0.15;
  const yWall = height / 2;
  return validateScene({
    tags: ["fallback-structure"],
    primitives: [
      {
        id: `${baseId}-floor`, type: "box", name: "Floor",
        dimensions: { width, height: 0.1, depth },
        transform: { position: { x: 0, y: 0.05, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        material: { color: floorColor, roughness: 0.8, metalness: 0.0 },
        physics: true, castShadow: true, receiveShadow: true, notes: "", tags: [], state: "static", metadata: {},
      },
      {
        id: `${baseId}-wall-n`, type: "box", name: "North Wall",
        dimensions: { width, height, depth: t },
        transform: { position: { x: 0, y: yWall, z: -depth / 2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        material: { color: wallColor, roughness: 0.9, metalness: 0.0 },
        physics: true, castShadow: true, receiveShadow: true, notes: "", tags: [], state: "static", metadata: {},
      },
      {
        id: `${baseId}-wall-s`, type: "box", name: "South Wall",
        dimensions: { width, height, depth: t },
        transform: { position: { x: 0, y: yWall, z: depth / 2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        material: { color: wallColor, roughness: 0.9, metalness: 0.0 },
        physics: true, castShadow: true, receiveShadow: true, notes: "", tags: [], state: "static", metadata: {},
      },
      {
        id: `${baseId}-wall-w`, type: "box", name: "West Wall",
        dimensions: { width: t, height, depth },
        transform: { position: { x: -width / 2, y: yWall, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        material: { color: wallColor, roughness: 0.9, metalness: 0.0 },
        physics: true, castShadow: true, receiveShadow: true, notes: "", tags: [], state: "static", metadata: {},
      },
      {
        id: `${baseId}-wall-e`, type: "box", name: "East Wall",
        dimensions: { width: t, height, depth },
        transform: { position: { x: width / 2, y: yWall, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        material: { color: wallColor, roughness: 0.9, metalness: 0.0 },
        physics: true, castShadow: true, receiveShadow: true, notes: "", tags: [], state: "static", metadata: {},
      },
    ],
    lights: [],
    groups: [{
      id: `${baseId}-structure`,
      name: "Structure Shell",
      children: [`${baseId}-floor`, `${baseId}-wall-n`, `${baseId}-wall-s`, `${baseId}-wall-w`, `${baseId}-wall-e`],
    }],
  });
}

function extractScenePayload(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  // Some models accidentally return reviewer-style wrappers.
  if (parsed.scene && typeof parsed.scene === "object") return parsed.scene;
  return parsed;
}

function _randId() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function _safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function summarizeStagedAssetRecord(record, count = 1) {
  const scene = record?.blueprint || record?.scene || (Array.isArray(record?.states) ? record.states[0]?.scene : null) || { primitives: [], groups: [] };
  const prims = Array.isArray(scene.primitives) ? scene.primitives : [];
  const groups = Array.isArray(scene.groups) ? scene.groups : [];
  if (prims.length === 0) {
    return {
      name: record?._displayName || record?.name || "Asset",
      prompt: String(record?.prompt || ""),
      count: Math.max(1, _safeNum(count, 1)),
      summary: "simple staged asset",
      primitiveCount: 0,
      groupCount: 0,
      textureCount: 0,
      footprint: { w: 1, d: 1, h: 1 },
      tags: [],
      stateCount: Array.isArray(record?.states) ? record.states.length : 1,
      pickable: record?.pickable === true,
    };
  }
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  let textureCount = 0;
  const typeCounts = {};
  const tags = new Set();
  for (const p of prims) {
    const tr = p.transform || {};
    const pos = tr.position || {};
    const dims = p.dimensions || {};
    const px = _safeNum(pos.x, 0);
    const py = _safeNum(pos.y, 0);
    const pz = _safeNum(pos.z, 0);
    const w = Math.max(0.1, _safeNum(dims.width, _safeNum(dims.radius, 0.5) * 2));
    const h = Math.max(0.1, _safeNum(dims.height, _safeNum(dims.radius, 0.5) * 2));
    const d = Math.max(0.1, _safeNum(dims.depth, _safeNum(dims.radius, 0.5) * 2));
    minX = Math.min(minX, px - w / 2); maxX = Math.max(maxX, px + w / 2);
    minY = Math.min(minY, py - h / 2); maxY = Math.max(maxY, py + h / 2);
    minZ = Math.min(minZ, pz - d / 2); maxZ = Math.max(maxZ, pz + d / 2);
    if (p.material?.textureDataUrl) textureCount += 1;
    const t = String(p.type || "shape");
    typeCounts[t] = (typeCounts[t] || 0) + 1;
    for (const tg of (p.tags || [])) tags.add(String(tg));
  }
  const topTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, c]) => `${t}:${c}`).join(", ");
  const footprint = {
    w: Math.max(0.1, maxX - minX),
    d: Math.max(0.1, maxZ - minZ),
    h: Math.max(0.1, maxY - minY),
  };
  const summary = `${prims.length} shapes, ${groups.length} groups, textures:${textureCount}, types:${topTypes}`;
  return {
    name: record?._displayName || record?.name || "Asset",
    prompt: String(record?.prompt || ""),
    count: Math.max(1, _safeNum(count, 1)),
    summary,
    primitiveCount: prims.length,
    groupCount: groups.length,
    textureCount,
    footprint: {
      w: Number(footprint.w.toFixed(2)),
      d: Number(footprint.d.toFixed(2)),
      h: Number(footprint.h.toFixed(2)),
    },
    tags: [...tags].slice(0, 6),
    stateCount: Array.isArray(record?.states) ? record.states.length : 1,
    pickable: record?.pickable === true,
  };
}

async function generateTextures(scene, imageEndpoint, onProgress, signal) {
  function makeFallbackTextureDataUrl(seedText) {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    let h = 0;
    for (let i = 0; i < seedText.length; i++) h = (h * 31 + seedText.charCodeAt(i)) % 360;
    ctx.fillStyle = `hsl(${h}, 18%, 44%)`;
    ctx.fillRect(0, 0, c.width, c.height);
    // subtle stripe pattern to avoid flat color look
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = `hsl(${(h + 24) % 360}, 22%, 58%)`;
    for (let y = 0; y < c.height; y += 12) ctx.fillRect(0, y, c.width, 6);
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 140; i++) {
      const x = Math.floor(Math.random() * c.width);
      const y = Math.floor(Math.random() * c.height);
      ctx.fillRect(x, y, 1, 1);
    }
    return c.toDataURL("image/png");
  }

  const toGenerate = scene.primitives.filter((p) => p.material?.generateTexture);
  if (toGenerate.length === 0) return 0;
  let generated = 0;
  for (const prim of toGenerate) {
    if (signal?.aborted) break;
    const desc = prim.material.generateTexture;
    onProgress?.(`Generating texture: "${desc}"…`);
    try {
      let ok = false;
      const attempts = [
        { size: "512x512", quality: "medium" },
        { size: "256x256", quality: "low" },
      ];
      for (const attempt of attempts) {
        if (signal?.aborted) break;
        const res = await fetch(imageEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: desc, size: attempt.size, quality: attempt.quality }),
          signal,
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (data?.dataUrl) {
          prim.material.textureDataUrl = data.dataUrl;
          generated++;
          ok = true;
          break;
        }
      }
      if (!ok) {
        const fallback = makeFallbackTextureDataUrl(String(desc || prim.name || "texture"));
        if (fallback) {
          prim.material.textureDataUrl = fallback;
          generated++;
          onProgress?.(`Texture fallback applied for "${prim.name || prim.id}"`);
        }
      }
    } catch (err) {
      if (err.name === "AbortError") break;
      const fallback = makeFallbackTextureDataUrl(String(desc || prim.name || "texture"));
      if (fallback) {
        prim.material.textureDataUrl = fallback;
        generated++;
        onProgress?.(`Texture fallback applied for "${prim.name || prim.id}"`);
      }
    }
    delete prim.material.generateTexture;
  }
  for (const prim of scene.primitives) {
    if (prim.material?.generateTexture) delete prim.material.generateTexture;
  }
  return generated;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// =============================================================================
// SPATIAL SUMMARY — compact scene description for task context
// =============================================================================

function _primExtent(p) {
  const d = p.dimensions || {};
  const r = d.radius || 0.5;
  switch (p.type) {
    case "box": return { w: d.width || 1, h: d.height || 1, d: d.depth || 1 };
    case "sphere": return { w: r * 2, h: r * 2, d: r * 2 };
    case "cylinder": return { w: Math.max(d.radiusTop || 0.5, d.radiusBottom || 0.5) * 2, h: d.height || 1, d: Math.max(d.radiusTop || 0.5, d.radiusBottom || 0.5) * 2 };
    case "cone": return { w: (d.radius || 0.5) * 2, h: d.height || 1, d: (d.radius || 0.5) * 2 };
    case "torus": { const R = d.radius || 0.5; const t = d.tube || 0.15; return { w: (R + t) * 2, h: t * 2, d: (R + t) * 2 }; }
    case "plane": return { w: d.width || 2, h: 0.01, d: d.height || 2 };
    default: return { w: 1, h: 1, d: 1 };
  }
}

function buildSpatialSummary(scene) {
  if (!scene || (scene.primitives.length === 0 && scene.lights.length === 0)) {
    return "Scene is currently empty.";
  }

  const lines = [];
  const groupedIds = new Set();
  for (const g of (scene.groups || [])) {
    for (const cid of g.children) groupedIds.add(cid);
  }

  // --- Scene inventory header with performance budget ---
  const totalPrims = scene.primitives.length;
  const totalLights = scene.lights.length;
  const totalGroups = (scene.groups || []).length;
  lines.push(`## Scene Inventory: ${totalPrims} primitives, ${totalLights} lights, ${totalGroups} groups`);

  if (totalPrims > 150) {
    lines.push(`WARNING: HIGH OBJECT COUNT (${totalPrims}). Keep new additions minimal (5-15 objects) to avoid performance issues.`);
  } else if (totalPrims > 80) {
    lines.push(`Note: Budget remaining ~${200 - totalPrims} more objects recommended before performance concerns.`);
  }
  lines.push("");

  // --- Style consistency: extract materials palette ---
  const materialCounts = {};
  for (const p of scene.primitives) {
    const mat = p.material;
    if (mat && mat.color) {
      const key = `${mat.color}|r${(mat.roughness ?? 0.5).toFixed(1)}|m${(mat.metalness ?? 0).toFixed(1)}`;
      if (!materialCounts[key]) materialCounts[key] = { color: mat.color, roughness: mat.roughness ?? 0.5, metalness: mat.metalness ?? 0, count: 0, examples: [] };
      materialCounts[key].count++;
      if (materialCounts[key].examples.length < 2) materialCounts[key].examples.push(p.name || p.id);
    }
  }

  const topMaterials = Object.values(materialCounts).sort((a, b) => b.count - a.count).slice(0, 6);
  if (topMaterials.length > 0) {
    lines.push("## Materials Palette (use these for style consistency)");
    for (const m of topMaterials) {
      lines.push(`- ${m.color} (roughness: ${m.roughness.toFixed(1)}, metalness: ${m.metalness.toFixed(1)}) — used ${m.count}x (e.g., ${m.examples.join(", ")})`);
    }
    lines.push("");
  }

  // --- Objects in scene ---
  lines.push("## Existing Objects");

  // Groups with bounding info (always show — they represent composed furniture)
  for (const g of (scene.groups || [])) {
    const children = g.children.map((cid) => scene.primitives.find((p) => p.id === cid)).filter(Boolean);
    if (children.length === 0) continue;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const c of children) {
      const pos = c.transform?.position || { x: 0, y: 0, z: 0 };
      const ext = _primExtent(c);
      minX = Math.min(minX, pos.x - ext.w / 2); maxX = Math.max(maxX, pos.x + ext.w / 2);
      minY = Math.min(minY, pos.y - ext.h / 2); maxY = Math.max(maxY, pos.y + ext.h / 2);
      minZ = Math.min(minZ, pos.z - ext.d / 2); maxZ = Math.max(maxZ, pos.z + ext.d / 2);
    }
    const cx = ((minX + maxX) / 2).toFixed(1), cy = ((minY + maxY) / 2).toFixed(1), cz = ((minZ + maxZ) / 2).toFixed(1);
    const sx = (maxX - minX).toFixed(1), sy = (maxY - minY).toFixed(1), sz = (maxZ - minZ).toFixed(1);
    lines.push(`- GROUP "${g.name}" [${g.id}] (${children.length} parts): center (${cx}, ${cy}, ${cz}), bounds ~${sx}x${sy}x${sz}m`);
  }

  // Ungrouped primitives — prioritize structural, then budget the rest
  const ungrouped = scene.primitives.filter((p) => !groupedIds.has(p.id));
  const MAX_DETAILED = 30;

  if (ungrouped.length <= MAX_DETAILED) {
    // Show all if within budget
    for (const p of ungrouped) {
      const pos = p.transform?.position || { x: 0, y: 0, z: 0 };
      const ext = _primExtent(p);
      lines.push(`- "${p.name}" [${p.id}] (${p.type}): at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}), ~${ext.w.toFixed(1)}x${ext.h.toFixed(1)}x${ext.d.toFixed(1)}m`);
    }
  } else {
    // Prioritize structural elements (walls, floors, ceilings) — always important for spatial context
    const structural = ungrouped.filter((p) => {
      const name = (p.name || "").toLowerCase();
      return name.includes("wall") || name.includes("floor") || name.includes("ceiling") || name.includes("roof") || name.includes("door");
    });
    const nonStructural = ungrouped.filter((p) => !structural.includes(p));

    for (const p of structural) {
      const pos = p.transform?.position || { x: 0, y: 0, z: 0 };
      const ext = _primExtent(p);
      lines.push(`- "${p.name}" [${p.id}] (${p.type}): at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}), ~${ext.w.toFixed(1)}x${ext.h.toFixed(1)}x${ext.d.toFixed(1)}m`);
    }

    // Fill remaining budget with other objects
    const remaining = MAX_DETAILED - structural.length;
    for (let i = 0; i < Math.min(remaining, nonStructural.length); i++) {
      const p = nonStructural[i];
      const pos = p.transform?.position || { x: 0, y: 0, z: 0 };
      const ext = _primExtent(p);
      lines.push(`- "${p.name}" [${p.id}] (${p.type}): at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}), ~${ext.w.toFixed(1)}x${ext.h.toFixed(1)}x${ext.d.toFixed(1)}m`);
    }

    // Summarize omitted objects by region
    if (nonStructural.length > remaining) {
      const omitted = nonStructural.length - remaining;
      const omittedObjects = nonStructural.slice(remaining);
      let oMinX = Infinity, oMaxX = -Infinity, oMinZ = Infinity, oMaxZ = -Infinity;
      for (const p of omittedObjects) {
        const pos = p.transform?.position || { x: 0, y: 0, z: 0 };
        oMinX = Math.min(oMinX, pos.x); oMaxX = Math.max(oMaxX, pos.x);
        oMinZ = Math.min(oMinZ, pos.z); oMaxZ = Math.max(oMaxZ, pos.z);
      }
      lines.push(`- ... and ${omitted} more objects in area X:[${oMinX.toFixed(1)} to ${oMaxX.toFixed(1)}], Z:[${oMinZ.toFixed(1)} to ${oMaxZ.toFixed(1)}]`);
    }
  }

  // --- Lights ---
  if (scene.lights.length > 0) {
    lines.push("");
    lines.push("## Lights");
    for (const l of (scene.lights || [])) {
      const pos = l.position || { x: 0, y: 0, z: 0 };
      lines.push(`- "${l.name}" (${l.type}): at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}), color ${l.color || "#ffffff"}, intensity ${l.intensity ?? 1}`);
    }
  }

  // --- Scene bounding box ---
  let sMinX = Infinity, sMaxX = -Infinity, sMinZ = Infinity, sMaxZ = -Infinity;
  let sMinY = Infinity, sMaxY = -Infinity;
  for (const p of scene.primitives) {
    const pos = p.transform?.position || { x: 0, y: 0, z: 0 };
    const ext = _primExtent(p);
    sMinX = Math.min(sMinX, pos.x - ext.w / 2); sMaxX = Math.max(sMaxX, pos.x + ext.w / 2);
    sMinY = Math.min(sMinY, pos.y - ext.h / 2); sMaxY = Math.max(sMaxY, pos.y + ext.h / 2);
    sMinZ = Math.min(sMinZ, pos.z - ext.d / 2); sMaxZ = Math.max(sMaxZ, pos.z + ext.d / 2);
  }
  if (isFinite(sMinX)) {
    lines.push("");
    lines.push("## Scene Bounds");
    lines.push(`Footprint: X [${sMinX.toFixed(1)} to ${sMaxX.toFixed(1)}], Y [${sMinY.toFixed(1)} to ${sMaxY.toFixed(1)}], Z [${sMinZ.toFixed(1)} to ${sMaxZ.toFixed(1)}]`);
    lines.push(`Size: ${(sMaxX - sMinX).toFixed(1)}m wide x ${(sMaxY - sMinY).toFixed(1)}m tall x ${(sMaxZ - sMinZ).toFixed(1)}m deep`);
  }

  return lines.join("\n");
}

// =============================================================================
// SCENE MERGING — additive composition + per-task tracking
// =============================================================================

/** Strip large binary data (textures) from scene before sending to LLM */
function compactSceneForLLM(scene) {
  return {
    tags: scene.tags || [],
    primitives: (scene.primitives || []).map((p) => {
      if (p.material?.textureDataUrl) {
        return { ...p, material: { ...p.material, textureDataUrl: "(texture applied)" } };
      }
      return p;
    }),
    lights: scene.lights || [],
    groups: scene.groups || [],
  };
}

function mergeScene(existing, additions) {
  return {
    tags: existing.tags || [],
    primitives: [...(existing.primitives || []), ...(additions.primitives || [])],
    lights: [...(existing.lights || []), ...(additions.lights || [])],
    groups: [...(existing.groups || []), ...(additions.groups || [])],
  };
}

function removeObjectsByIds(scene, primIds, lightIds, groupIds) {
  return {
    tags: scene.tags || [],
    primitives: (scene.primitives || []).filter((p) => !primIds.has(p.id)),
    lights: (scene.lights || []).filter((l) => !lightIds.has(l.id)),
    groups: (scene.groups || []).filter((g) => !groupIds.has(g.id)),
  };
}

function deepCloneJSON(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function withPrefixedIds(scene, prefix) {
  const cloned = deepCloneJSON(scene);
  const primMap = new Map();
  const lightMap = new Map();
  const groupMap = new Map();

  for (const p of cloned.primitives || []) {
    const old = p.id;
    p.id = `${prefix}${old || _randId()}`;
    primMap.set(old, p.id);
  }
  for (const l of cloned.lights || []) {
    const old = l.id;
    l.id = `${prefix}${old || _randId()}`;
    lightMap.set(old, l.id);
  }
  for (const g of cloned.groups || []) {
    const old = g.id;
    g.id = `${prefix}${old || _randId()}`;
    groupMap.set(old, g.id);
  }
  for (const g of cloned.groups || []) {
    g.children = (g.children || []).map((cid) => primMap.get(cid) || `${prefix}${cid}`);
  }
  return cloned;
}

function offsetScene(scene, dx, dz) {
  const cloned = deepCloneJSON(scene);
  let minY = Infinity;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

  for (const p of cloned.primitives || []) {
    const pos = p.transform?.position || { x: 0, y: 0, z: 0 };
    const ext = _primExtent(p);
    minY = Math.min(minY, pos.y - ext.h / 2);
    minX = Math.min(minX, pos.x - ext.w / 2); maxX = Math.max(maxX, pos.x + ext.w / 2);
    minZ = Math.min(minZ, pos.z - ext.d / 2); maxZ = Math.max(maxZ, pos.z + ext.d / 2);
  }
  const cx = isFinite(minX) ? (minX + maxX) / 2 : 0;
  const cz = isFinite(minZ) ? (minZ + maxZ) / 2 : 0;
  const lift = isFinite(minY) ? -minY + 0.01 : 0;

  for (const p of cloned.primitives || []) {
    if (!p.transform) p.transform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
    if (!p.transform.position) p.transform.position = { x: 0, y: 0, z: 0 };
    p.transform.position.x = (p.transform.position.x - cx) + dx;
    p.transform.position.z = (p.transform.position.z - cz) + dz;
    p.transform.position.y = p.transform.position.y + lift;
  }
  for (const l of cloned.lights || []) {
    if (!l.position) l.position = { x: 0, y: 2.5, z: 0 };
    l.position.x = (l.position.x - cx) + dx;
    l.position.z = (l.position.z - cz) + dz;
  }
  return cloned;
}

function _isLikelyStructuralPrimitive(p) {
  const t = String(p?.type || "").toLowerCase();
  const d = p?.dimensions || {};
  const w = Number(d.width ?? d.radiusTop ?? d.radius ?? 0);
  const h = Number(d.height ?? 0);
  const depth = Number(d.depth ?? d.radiusBottom ?? d.tube ?? 0);
  const n = `${p?.name || ""} ${(p?.tags || []).join(" ")}`.toLowerCase();
  if (/\b(storefront|shopfront|facade|façade|shop facade|window display|display window|awning|store sign|signage)\b/.test(n)) return false;
  if (/\b(wall|floor|ceiling|room|partition|beam|pillar|column|ramp|platform|roof)\b/.test(n)) return true;
  if (t === "plane") return true;
  if (t === "box") {
    if (Math.max(w, h, depth) >= 2.0) return true;
    if (h <= 0.22 && w >= 1.0 && depth >= 1.0) return true;
  }
  if (t === "cylinder") {
    const rt = Number(d.radiusTop ?? 0);
    const rb = Number(d.radiusBottom ?? 0);
    if (h >= 2.0 && Math.max(rt, rb) >= 0.08) return true;
  }
  return false;
}

function enforceStagedComplexPolicy(sceneLike, stagedCatalog = []) {
  if (!Array.isArray(stagedCatalog) || stagedCatalog.length === 0) return sceneLike;
  const stagedKeywords = stagedCatalog
    .flatMap((x) => `${x?.name || ""} ${x?.prompt || ""}`.toLowerCase().split(/[^a-z0-9]+/g))
    .filter((k) => k && k.length >= 4);
  const hasFacadeCatalog = stagedKeywords.some((k) => /facade|storefront|shopfront|awning|display|signage/.test(k));
  const cloned = deepCloneJSON(sceneLike || { tags: [], primitives: [], lights: [], groups: [] });
  const groupedChildIds = new Set();
  for (const g of cloned.groups || []) {
    for (const cid of g.children || []) groupedChildIds.add(cid);
  }
  cloned.groups = [];
  cloned.primitives = (cloned.primitives || []).filter((p) => {
    const blob = `${p?.name || ""} ${p?.notes || ""} ${(p?.tags || []).join(" ")}`.toLowerCase();
    const keywordMatch = stagedKeywords.some((k) => blob.includes(k));
    if (keywordMatch) return false;
    if (hasFacadeCatalog && /\b(storefront|shopfront|facade|façade|shop|retail|window display|display window|awning|store sign|signage)\b/.test(blob)) return false;
    if (groupedChildIds.has(p.id)) return false;
    if (p?.material?.generateTexture) return false;
    return _isLikelyStructuralPrimitive(p);
  });
  return cloned;
}

// =============================================================================
// UI — task tracker + prompt bar
// =============================================================================

function buildUI(containerEl) {
  // Build a Cursor-like panel layout inside the container
  // Structure: header | scrollable tracker | bottom input bar

  // --- Panel header ---
  const header = document.createElement("div");
  header.className = "vibe-panel-header";
  header.innerHTML = `
    <span class="vibe-panel-title">AI Scene Builder</span>
    <div style="display:flex; gap:6px; align-items:center;">
      <div id="vibe-status" class="vibe-status"></div>
      <button id="ai-panel-collapse" class="panel-collapse-btn" type="button" title="Collapse panel">▶</button>
    </div>
  `;
  containerEl.appendChild(header);

  const tabs = document.createElement("div");
  tabs.className = "vibe-tabs";
  tabs.innerHTML = `
    <button id="vibe-tab-scene" class="vibe-tab-btn active" type="button">Scene Builder</button>
    <button id="vibe-tab-assets" class="vibe-tab-btn" type="button">Asset Library</button>
    <button id="vibe-tab-agents" class="vibe-tab-btn" type="button">Spawned Agents</button>
  `;
  containerEl.appendChild(tabs);

  const content = document.createElement("div");
  content.className = "vibe-content";

  // --- Scene tab ---
  const sceneTab = document.createElement("div");
  sceneTab.id = "vibe-tab-scene-pane";
  sceneTab.className = "vibe-tab-pane";
  const tracker = document.createElement("div");
  tracker.id = "vibe-tracker";
  tracker.className = "vibe-tracker";
  tracker.innerHTML = `<div class="vibe-empty-state">
    <div class="vibe-empty-icon">✦</div>
    <div class="vibe-empty-text">Describe a 3D scene below and press Generate to start building.</div>
  </div>`;
  const streamDetails = document.createElement("details");
  streamDetails.id = "vibe-stream-details";
  streamDetails.className = "vibe-stream-details";
  streamDetails.innerHTML = `
    <summary class="vibe-stream-summary">Model reasoning stream</summary>
    <pre id="vibe-stream-body" class="vibe-stream-body"></pre>
  `;
  sceneTab.appendChild(streamDetails);
  sceneTab.appendChild(tracker);

  // --- Assets tab ---
  const assetsTab = document.createElement("div");
  assetsTab.id = "vibe-tab-assets-pane";
  assetsTab.className = "vibe-tab-pane hidden";
  assetsTab.innerHTML = `
    <div class="vibe-assets-help">Asset Library: assets saved from Asset Builder (manual or agent-generated). Drag to scene canvas or click a card to insert.</div>
    <div id="vibe-asset-list" class="vibe-asset-list"></div>
  `;

  // --- Spawned agents tab ---
  const agentsTab = document.createElement("div");
  agentsTab.id = "vibe-tab-agents-pane";
  agentsTab.className = "vibe-tab-pane hidden";
  agentsTab.innerHTML = `
    <div class="vibe-assets-help">Spawned agent controls and inspector.</div>
    <details class="agent-collapse" open>
      <summary>Selected Agent Vision</summary>
      <div class="agent-vision">
        <img id="edit-agent-shot-img" class="agent-shot-img" alt="Selected agent POV" />
      </div>
      <div class="agent-collapse-content">
        <div class="section-label">Last Decision</div>
        <pre id="edit-agent-last" class="agent-decision-content">Waiting...</pre>
      </div>
    </details>
    <details class="agent-collapse">
      <summary>Request Details</summary>
      <div class="agent-collapse-content">
        <div id="edit-agent-req-meta" class="agent-meta">No request yet</div>
        <details class="agent-sub-collapse">
          <summary>Prompt</summary>
          <pre id="edit-agent-req-prompt" class="agent-pre"></pre>
        </details>
        <details class="agent-sub-collapse">
          <summary>Context</summary>
          <pre id="edit-agent-req-context" class="agent-pre"></pre>
        </details>
        <details class="agent-sub-collapse">
          <summary>Raw Output</summary>
          <pre id="edit-agent-resp-raw" class="agent-pre"></pre>
        </details>
      </div>
    </details>
    <details class="agent-collapse">
      <summary>Activity Log</summary>
      <div id="edit-agent-log" class="agent-log"></div>
    </details>
  `;

  content.appendChild(sceneTab);
  content.appendChild(assetsTab);
  content.appendChild(agentsTab);
  containerEl.appendChild(content);

  // --- Bottom input bar ---
  const bar = document.createElement("div");
  bar.id = "vibe-creator-bar";
  bar.className = "vibe-bar";
  bar.innerHTML = `
    <input id="vibe-prompt-input" class="vibe-input" type="text"
           placeholder='Describe a scene…' />
    <label class="vibe-mode-toggle" title="Add to existing scene instead of replacing">
      <input id="vibe-additive" type="checkbox" />
      <span>Add</span>
    </label>
    <button id="vibe-generate-btn" class="vibe-btn vibe-btn-primary" type="button">Generate</button>
    <button id="vibe-stop-btn" class="vibe-btn vibe-btn-stop hidden" type="button">Stop</button>
  `;
  containerEl.appendChild(bar);

  const tabSceneBtn = tabs.querySelector("#vibe-tab-scene");
  const tabAssetsBtn = tabs.querySelector("#vibe-tab-assets");
  const tabAgentsBtn = tabs.querySelector("#vibe-tab-agents");
  function setTab(tab) {
    const sceneActive = tab === "scene";
    const assetsActive = tab === "assets";
    const agentsActive = tab === "agents";
    tabSceneBtn.classList.toggle("active", sceneActive);
    tabAssetsBtn.classList.toggle("active", assetsActive);
    tabAgentsBtn.classList.toggle("active", agentsActive);
    sceneTab.classList.toggle("hidden", !sceneActive);
    assetsTab.classList.toggle("hidden", !assetsActive);
    agentsTab.classList.toggle("hidden", !agentsActive);
    bar.classList.toggle("hidden", !sceneActive);
  }
  tabSceneBtn.addEventListener("click", () => setTab("scene"));
  tabAssetsBtn.addEventListener("click", () => setTab("assets"));
  tabAgentsBtn.addEventListener("click", () => setTab("agents"));

  // --- Wire up collapse button ---
  const collapseBtn = header.querySelector("#ai-panel-collapse");
  const openBtn = document.getElementById("ai-panel-open");
  if (collapseBtn && openBtn) {
    collapseBtn.addEventListener("click", () => {
      document.getElementById("overlay").classList.add("right-collapsed");
      openBtn.classList.remove("hidden");
    });
    openBtn.addEventListener("click", () => {
      document.getElementById("overlay").classList.remove("right-collapsed");
      openBtn.classList.add("hidden");
    });
  }

  return {
    bar,
    setTab,
    tracker,
    streamDetails,
    streamBody: streamDetails.querySelector("#vibe-stream-body"),
    input: bar.querySelector("#vibe-prompt-input"),
    generateBtn: bar.querySelector("#vibe-generate-btn"),
    stopBtn: bar.querySelector("#vibe-stop-btn"),
    additiveCheckbox: bar.querySelector("#vibe-additive"),
    assetList: assetsTab.querySelector("#vibe-asset-list"),
    spawnedAgentsPane: agentsTab,
    statusEl: header.querySelector("#vibe-status"),
  };
}

// =============================================================================
// MAIN
// =============================================================================

/**
 * @param {Object} config
 * @param {HTMLElement} config.containerEl
 * @param {Function}    config.importLevel       – async (json) => void
 * @param {Function}    config.getCurrentScene   – () => { tags, primitives, lights, groups }
 * @param {Function}    config.captureScreenshot – async () => base64 JPEG
 * @param {Function}    config.captureAssetThumbnail - async () => data URL
 * @param {Function}    config.setStatus
 * @param {string}      config.endpoint
 * @param {string}      config.imageEndpoint
 * @param {string}      config.model
 */
export function initVibeCreator(config) {
  const {
    containerEl,
    importLevel,
    getCurrentScene,
    captureScreenshot,
    captureAssetThumbnail,
    setStatus,
    endpoint,
    imageEndpoint,
    model,
    getPlacementAnchor,
    getPlacementAnchorFromScreen,
    focusStagingArea,
    openStagingEditor,
    openAssetInBuilder,
    getWorkspaceMode,
    switchWorkspaceMode,
    spawnLibraryAsset,
  } = config;
  if (!containerEl) { console.warn("[VibeCreator] No container, skipping."); return; }

  const ui = buildUI(containerEl);
  let abortController = null;
  let isGenerating = false;
  let isAssetGenerating = false;
  const libraryAssets = []; // {id,name,prompt,thumbnailDataUrl,blueprint}
  let stagedInsertCounter = 0;
  let draggedAssetId = null;

  // ---- UI helpers ----

  function setVibeStatus(msg, isError = false) {
    ui.statusEl.textContent = msg;
    ui.statusEl.style.color = isError ? "#ef4444" : "";
  }

  function readChatHistory() {
    try {
      const raw = localStorage.getItem(VIBE_CHAT_HISTORY_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function writeChatHistory(list) {
    const slim = (Array.isArray(list) ? list : []).slice(-20).map((x) => ({
      role: x?.role === "assistant" ? "assistant" : "user",
      text: String(x?.text || "").slice(0, 500),
      ts: Number(x?.ts || Date.now()),
    }));
    localStorage.setItem(VIBE_CHAT_HISTORY_KEY, JSON.stringify(slim));
  }

  function pushChatHistory(role, text) {
    const list = readChatHistory();
    list.push({ role, text, ts: Date.now() });
    writeChatHistory(list);
  }

  function buildConversationContextText() {
    const list = readChatHistory().slice(-10);
    if (list.length === 0) return "";
    const lines = list.map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.text}`);
    return lines.join("\n");
  }

  function resetStreamLog() {
    if (!ui.streamBody) return;
    ui.streamBody.textContent = "";
  }

  function appendStreamLog(text) {
    if (!ui.streamBody || !text) return;
    const MAX = 14000;
    ui.streamBody.textContent += text;
    if (ui.streamBody.textContent.length > MAX) {
      ui.streamBody.textContent = ui.streamBody.textContent.slice(ui.streamBody.textContent.length - MAX);
    }
    ui.streamBody.scrollTop = ui.streamBody.scrollHeight;
  }

  async function streamModelText(label, rawText, signal) {
    const text = String(rawText || "");
    if (!text) return;
    appendStreamLog(`\n[${label}] \n`);
    const maxChars = 5000;
    const clipped = text.length > maxChars ? (text.slice(0, maxChars) + "\n...[truncated]") : text;
    const chunkSize = 140;
    for (let i = 0; i < clipped.length; i += chunkSize) {
      if (signal?.aborted) return;
      appendStreamLog(clipped.slice(i, i + chunkSize));
      await sleep(8);
    }
    appendStreamLog("\n");
  }

  function ensureAiPanelVisible() {
    const overlay = document.getElementById("overlay");
    const openBtn = document.getElementById("ai-panel-open");
    if (overlay?.classList.contains("right-collapsed")) {
      overlay.classList.remove("right-collapsed");
      openBtn?.classList.add("hidden");
    }
  }

  function isLikelyEditPrompt(promptText) {
    const s = String(promptText || "").toLowerCase();
    return /\b(change|make|set|turn|update|edit|replace|adjust|move|recolor|color)\b/.test(s);
  }

  function setGenerating(active) {
    isGenerating = active;
    ui.generateBtn.classList.toggle("hidden", active);
    ui.stopBtn.classList.toggle("hidden", !active);
    ui.input.disabled = active;
    ui.bar.classList.toggle("active", active);
  }

  function setAssetGenerating(active) {
    isAssetGenerating = active;
  }

  function escHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---- Task tracker ----

  let trackerTasks = []; // [{id, title, description, status, meta, details:[string]}]

  function clearTracker() {
    trackerTasks = [];
    ui.tracker.innerHTML = `<div class="vibe-empty-state">
      <div class="vibe-empty-icon">✦</div>
      <div class="vibe-empty-text">Describe a 3D scene below and press Generate to start building.</div>
    </div>`;
  }

  function initTracker(title, tasks) {
    trackerTasks = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: "pending", // pending | active | done | failed
      meta: "",
      details: [],
    }));
    renderTracker(title);
  }

  function updateTaskStatus(taskId, status, meta) {
    const t = trackerTasks.find((t) => t.id === taskId);
    if (t) { t.status = status; if (meta !== undefined) t.meta = meta; }
    rerenderTracker();
  }

  function addTaskDetail(taskId, text) {
    const t = trackerTasks.find((t) => t.id === taskId);
    if (t) t.details.push(text);
    rerenderTracker();
  }

  function addFinalNote(text) {
    const el = document.createElement("div");
    el.className = "vt-final";
    el.innerHTML = `<span class="vt-final-icon">&#9734;</span> ${escHtml(text)}`;
    ui.tracker.appendChild(el);
    ui.tracker.scrollTop = ui.tracker.scrollHeight;
  }

  let currentActivity = ""; // shown in the activity bar

  function setActivity(text) {
    currentActivity = text;
    const el = ui.tracker.querySelector(".vt-activity");
    if (el) {
      el.textContent = text;
      el.classList.toggle("hidden", !text);
    }
  }

  function renderTracker(title) {
    ui.tracker.innerHTML = `<div class="vt-header">${escHtml(title)} <span class="vt-count">${trackerTasks.length} tasks</span></div>`;
    for (const t of trackerTasks) {
      ui.tracker.appendChild(_buildTaskEl(t));
    }
    // Activity bar at the bottom
    const actBar = document.createElement("div");
    actBar.className = "vt-activity" + (currentActivity ? "" : " hidden");
    actBar.textContent = currentActivity;
    ui.tracker.appendChild(actBar);
  }

  function rerenderTracker() {
    const header = ui.tracker.querySelector(".vt-header");
    const finalNotes = ui.tracker.querySelectorAll(".vt-final");
    ui.tracker.innerHTML = "";
    if (header) ui.tracker.appendChild(header);
    for (const t of trackerTasks) {
      ui.tracker.appendChild(_buildTaskEl(t));
    }
    for (const fn of finalNotes) ui.tracker.appendChild(fn);
    // Re-add activity bar
    const actBar = document.createElement("div");
    actBar.className = "vt-activity" + (currentActivity ? "" : " hidden");
    actBar.textContent = currentActivity;
    ui.tracker.appendChild(actBar);
    ui.tracker.scrollTop = ui.tracker.scrollHeight;
  }

  function _buildTaskEl(t) {
    const el = document.createElement("div");
    el.className = `vt-task vt-${t.status}`;
    const icon = t.status === "done" ? "&#10003;" : t.status === "active" ? "&#9679;" : t.status === "failed" ? "&#10007;" : "&#9675;";
    let html = `<div class="vt-task-row"><span class="vt-icon">${icon}</span><span class="vt-title">${escHtml(t.title)}</span>`;
    if (t.meta) html += `<span class="vt-meta">${escHtml(t.meta)}</span>`;
    html += `</div>`;
    if (t.details.length > 0) {
      html += `<div class="vt-details">`;
      for (const d of t.details) {
        html += `<div class="vt-detail">${escHtml(d)}</div>`;
      }
      html += `</div>`;
    }
    el.innerHTML = html;
    return el;
  }

  function nextStageSlot(index) {
    const cols = 3;
    const row = Math.floor(index / cols);
    const col = index % cols;
    return { x: 24 + col * 4.5, z: 24 + row * 4.5 };
  }

  function readAssetLibrary() {
    try {
      const raw = localStorage.getItem(ASSET_LIBRARY_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function assetLibraryMergeKey(entry) {
    if (!entry || typeof entry !== "object") return "";
    if (entry.id) return `id:${entry.id}`;
    const name = String(entry.name || "").trim().toLowerCase();
    const prompt = String(entry.prompt || "").trim().toLowerCase();
    return `np:${name}|${prompt}`;
  }

  function countTextureDataUrlsInScene(scene) {
    if (!scene || typeof scene !== "object") return 0;
    let count = 0;
    for (const p of scene.primitives || []) {
      const tex = p?.material?.textureDataUrl;
      if (typeof tex === "string" && tex.startsWith("data:image/")) count++;
    }
    return count;
  }

  function getAssetRecordRichnessScore(entry) {
    if (!entry || typeof entry !== "object") return 0;
    let score = 0;
    const thumb = entry.thumbnailDataUrl;
    if (typeof thumb === "string" && thumb.startsWith("data:image/")) {
      score += Math.min(10, Math.floor(thumb.length / 50000) + 1);
    }
    score += countTextureDataUrlsInScene(entry.scene) * 20;
    if (Array.isArray(entry.states)) {
      score += entry.states.length;
      for (const st of entry.states) {
        score += countTextureDataUrlsInScene(st?.scene || st?.shapeScene) * 20;
      }
    }
    return score;
  }

  function choosePreferredMergedEntry(localEntry, diskEntry) {
    if (!localEntry) return diskEntry;
    if (!diskEntry) return localEntry;
    const localScore = getAssetRecordRichnessScore(localEntry);
    const diskScore = getAssetRecordRichnessScore(diskEntry);
    if (diskScore > localScore) return diskEntry;
    if (localScore > diskScore) return localEntry;
    return localEntry;
  }

  function mergeAssetLibrariesPreferLocal(localList, diskList) {
    const local = Array.isArray(localList) ? localList : [];
    const disk = Array.isArray(diskList) ? diskList : [];
    const mergedByKey = new Map();
    for (const entry of local) {
      const key = assetLibraryMergeKey(entry);
      if (!key) continue;
      mergedByKey.set(key, entry);
    }
    for (const entry of disk) {
      const key = assetLibraryMergeKey(entry);
      if (!key) continue;
      if (!mergedByKey.has(key)) {
        mergedByKey.set(key, entry);
      } else {
        mergedByKey.set(key, choosePreferredMergedEntry(mergedByKey.get(key), entry));
      }
    }
    return [...mergedByKey.values()];
  }

  function compactBlueprintForStorage(scene) {
    const cloned = deepCloneJSON(scene || { tags: [], primitives: [], lights: [], groups: [] });
  // Keep texture payloads unless they are extremely large.
  // Previous value (120k) was stripping many valid generated textures.
  const MAX_TEXTURE_DATA_URL_LEN = 500000;
    for (const p of cloned.primitives || []) {
      if (!p.material) continue;
      const tex = p.material.textureDataUrl;
      if (typeof tex === "string" && tex.length > MAX_TEXTURE_DATA_URL_LEN) {
        p.material.textureDataUrl = null;
      }
    }
    return cloned;
  }

  function compactThumbnailForStorage(dataUrl) {
    if (typeof dataUrl !== "string") return "";
    // Keep thumbnails unless they are extremely large.
    return dataUrl.length > 1500000 ? "" : dataUrl;
  }

  function compactLibraryEntry(entry) {
    const states = Array.isArray(entry.states)
      ? entry.states.map((s) => ({
        id: s.id,
        name: s.name,
        interactions: Array.isArray(s.interactions) ? s.interactions : [],
        scene: compactBlueprintForStorage(s.scene || s.shapeScene || entry.scene),
      }))
      : null;
    return {
      id: entry.id,
      name: entry.name,
      prompt: entry.prompt,
      thumbnailDataUrl: compactThumbnailForStorage(entry.thumbnailDataUrl),
      createdAt: entry.createdAt || Date.now(),
      scene: compactBlueprintForStorage(entry.scene),
      states: states || undefined,
      currentStateId: entry.currentStateId || undefined,
      actions: Array.isArray(entry.actions) ? entry.actions : undefined,
      pickable: entry.pickable === true,
    };
  }

  function writeAssetLibrary(list) {
    const fullList = Array.isArray(list) ? list : [];
    // Use the editor's canonical write function if available — single source of truth.
    if (typeof config.writeAssetLibrary === "function") {
      config.writeAssetLibrary(fullList);
      return true;
    }
    let attempt = fullList.map(compactLibraryEntry);
    attempt = attempt.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const MAX_ITEMS = 30;
    if (attempt.length > MAX_ITEMS) attempt = attempt.slice(-MAX_ITEMS);
    while (attempt.length > 0) {
      try {
        localStorage.setItem(ASSET_LIBRARY_KEY, JSON.stringify(attempt));
        _persistToDisk(fullList);
        return true;
      } catch (err) {
        const msg = String(err?.name || err?.message || err);
        if (!/QuotaExceededError/i.test(msg)) throw err;
        attempt.shift();
      }
    }
    localStorage.setItem(ASSET_LIBRARY_KEY, "[]");
    return false;
  }

  function _persistToDisk(assets) {
    const baseUrl = (endpoint || "").replace("/vlm/decision", "");
    fetch(`${baseUrl}/vlm/asset-library`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assets }),
    }).catch(() => {});
  }

  function upsertAssetLibraryFromRecord(record) {
    const list = readAssetLibrary();
    const existingIdx = list.findIndex((x) => x.id && record.id && x.id === record.id);
    const fallbackIdx = existingIdx >= 0
      ? existingIdx
      : list.findIndex((x) => x.name === record.name && x.prompt === record.prompt);
    const entry = {
      id: record.id,
      name: record.name,
      prompt: record.prompt,
      thumbnailDataUrl: compactThumbnailForStorage(record.thumbnailDataUrl),
      createdAt: Date.now(),
    // Keep full-fidelity scene/state here; writeAssetLibrary handles local compaction.
    scene: deepCloneJSON(record.blueprint || { tags: [], primitives: [], lights: [], groups: [] }),
    states: Array.isArray(record.states) ? deepCloneJSON(record.states) : undefined,
      currentStateId: record.currentStateId || undefined,
      actions: Array.isArray(record.actions) ? record.actions : undefined,
      pickable: record.pickable === true,
    };
    if (fallbackIdx >= 0) list[fallbackIdx] = entry;
    else list.push(entry);
    const ok = writeAssetLibrary(list);
    if (!ok) {
      setVibeStatus("Asset library is full. Oldest assets were trimmed.", true);
    }
  }

  function loadAssetLibraryIntoState(sourceList = null) {
    const list = Array.isArray(sourceList) ? sourceList : readAssetLibrary();
    libraryAssets.length = 0;
    for (const item of list) {
      const stateList = Array.isArray(item.states) ? item.states : [];
      const curStateId = item.currentStateId || stateList[0]?.id || null;
      const curState = stateList.find((s) => s.id === curStateId) || stateList[0] || null;
      const sceneFromState = curState?.scene || curState?.shapeScene || null;
      libraryAssets.push({
        id: item.id || `lib-${Math.random().toString(36).slice(2, 7)}`,
        name: item.name || "Library Asset",
        prompt: item.prompt || "Saved asset",
        thumbnailDataUrl: typeof item.thumbnailDataUrl === "string" ? item.thumbnailDataUrl : "",
        scene: validateScene(item.scene || { tags: [], primitives: [], lights: [], groups: [] }),
        states: stateList,
        currentStateId: curStateId,
        actions: Array.isArray(item.actions) ? item.actions : [],
        pickable: item.pickable === true,
        bumpable: item.bumpable === true,
        bumpResponse: Number.isFinite(item.bumpResponse) ? Number(item.bumpResponse) : 0.9,
        bumpDamping: Number.isFinite(item.bumpDamping) ? Number(item.bumpDamping) : 0.9,
        blueprint: validateScene(sceneFromState || item.scene || { tags: [], primitives: [], lights: [], groups: [] }),
      });
    }
  }

  function resolveAssetRecordFromLibrary(planned) {
    if (!planned) return null;
    const pName = String(planned.name || "").toLowerCase();
    const pPrompt = String(planned.prompt || "").toLowerCase();
    const byScore = [...libraryAssets]
      .map((a) => {
        const aName = String(a.name || "").toLowerCase();
        const aPrompt = String(a.prompt || "").toLowerCase();
        let score = 0;
        if (pName && aName.includes(pName)) score += 3;
        if (pPrompt && aPrompt.includes(pPrompt)) score += 3;
        if (pName && pPrompt && (aPrompt.includes(pName) || aName.includes(pPrompt))) score += 2;
        return { a, score };
      })
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score);
    return byScore[0]?.a || null;
  }

  const DEFAULT_ASSET_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256' viewBox='0 0 256 256'%3E%3Crect width='256' height='256' fill='%230b0d11'/%3E%3Cg stroke='%236b7280' stroke-width='10' stroke-linecap='round'%3E%3Cpath d='M46 200 L92 110 L138 200 Z' fill='none'/%3E%3Crect x='140' y='128' width='62' height='62' fill='none'/%3E%3Ccircle cx='92' cy='96' r='22' fill='none'/%3E%3C/g%3E%3C/svg%3E";

  function getSceneForAssetThumbnail(asset) {
    if (!asset || typeof asset !== "object") return null;
    const states = Array.isArray(asset.states) ? asset.states : [];
    const currentStateId = asset.currentStateId || states[0]?.id || null;
    const st = states.find((s) => s.id === currentStateId) || states[0] || null;
    return st?.scene || st?.shapeScene || asset.blueprint || asset.scene || null;
  }

  function deriveAssetThumbnailDataUrl(asset) {
    const scene = getSceneForAssetThumbnail(asset);
    if (!scene || typeof scene !== "object") return DEFAULT_ASSET_PLACEHOLDER;
    const primitives = Array.isArray(scene.primitives) ? scene.primitives : [];
    const colors = [];
    for (const p of primitives) {
      const c = p?.material?.color;
      if (typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c) && !colors.includes(c)) colors.push(c);
      if (colors.length >= 3) break;
    }
    const c1 = colors[0] || "#374151";
    const c2 = colors[1] || "#4b5563";
    const c3 = colors[2] || "#6b7280";
    const label = String(asset?.name || "Asset").trim().slice(0, 1).toUpperCase() || "A";
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256' viewBox='0 0 256 256'>
<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='${c1}'/><stop offset='100%' stop-color='${c2}'/></linearGradient></defs>
<rect width='256' height='256' fill='url(#g)'/>
<circle cx='196' cy='58' r='26' fill='${c3}' fill-opacity='0.75'/>
<rect x='34' y='132' width='96' height='70' rx='12' fill='${c3}' fill-opacity='0.6'/>
<path d='M132 196 L178 96 L222 196 Z' fill='none' stroke='rgba(255,255,255,0.55)' stroke-width='8' stroke-linecap='round'/>
<text x='24' y='48' fill='rgba(255,255,255,0.9)' font-size='32' font-family='Inter,Arial,sans-serif' font-weight='700'>${escHtml(label)}</text>
</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function getAssetCardThumbnail(asset) {
    const thumb = asset?.thumbnailDataUrl;
    if (typeof thumb === "string" && thumb.startsWith("data:image/")) return thumb;
    return deriveAssetThumbnailDataUrl(asset);
  }

  function renderStagedAssets() {
    if (!ui.assetList) return;
    if (libraryAssets.length === 0) {
      ui.assetList.innerHTML = `<div class="vibe-asset-empty">No saved assets yet. Switch to Asset Builder, create an asset, and click Save Asset To Library.</div>`;
      return;
    }
    ui.assetList.innerHTML = libraryAssets.map((a, idx) => `
      <div class="vibe-asset-item" data-asset-id="${a.id}" draggable="true">
        <img class="vibe-asset-thumb" src="${escHtml(getAssetCardThumbnail(a))}" alt="${escHtml(a.name || `Asset ${idx + 1}`)}" loading="lazy" />
        <div class="vibe-asset-item-head">
          <span class="vibe-asset-name">${escHtml(a.name || `Asset ${idx + 1}`)}</span>
          <button type="button" class="vibe-btn vibe-asset-edit" title="Open in Asset Builder">Edit</button>
          <button type="button" class="vibe-btn vibe-btn-stop vibe-asset-remove" title="Delete asset">Delete</button>
        </div>
        <div class="vibe-asset-prompt">${escHtml(a.prompt)}</div>
      </div>
    `).join("");
  }

  async function insertApprovedAsset(assetRecord, opts = {}) {
    if (Array.isArray(assetRecord.states) && assetRecord.states.length > 0 && typeof spawnLibraryAsset === "function") {
      await spawnLibraryAsset(assetRecord, opts);
      setVibeStatus(`Inserted "${assetRecord.name}" into scene.`);
      return { prefix: `lib-asset-${assetRecord.id}-`, primitiveCount: 0, groupCount: 0 };
    }
    const current = getCurrentScene();
    const placed = withPrefixedIds(assetRecord.blueprint, `asset-${assetRecord.id}-${Date.now()}-`);
    let dx;
    let dz;
    const screenAnchor = (typeof getPlacementAnchorFromScreen === "function" && typeof opts.clientX === "number" && typeof opts.clientY === "number")
      ? getPlacementAnchorFromScreen(opts.clientX, opts.clientY)
      : null;
    const anchor = screenAnchor || (typeof getPlacementAnchor === "function" ? getPlacementAnchor() : null);
    if (Number.isFinite(opts.targetX) && Number.isFinite(opts.targetZ)) {
      dx = Number(opts.targetX);
      dz = Number(opts.targetZ);
    } else if (anchor && opts.preferAnchor !== false) {
      dx = (anchor.x || 0) + 1.4;
      dz = (anchor.z || 0) + 1.4;
    } else {
      const ring = stagedInsertCounter++;
      dx = (ring % 4) * 1.8 - 2.7;
      dz = Math.floor(ring / 4) * 1.8;
    }
    const shifted = offsetScene(placed, dx, dz);
    const groupedPrimIds = shifted.primitives.map((p) => p.id);
    if (groupedPrimIds.length >= 2 && (!Array.isArray(shifted.groups) || shifted.groups.length === 0)) {
      shifted.groups.push({
        id: `asset-group-${assetRecord.id}-${Date.now().toString(36)}`,
        name: assetRecord.name || "Asset Group",
        children: groupedPrimIds,
      });
    }
    const merged = mergeScene(current, shifted);
    await importLevel(merged);
    setVibeStatus(`Inserted "${assetRecord.name}" into scene.`);
    return {
      prefix: `asset-${assetRecord.id}-`,
      primitiveCount: shifted.primitives.length,
      groupCount: shifted.groups.length,
    };
  }

  async function planAutoStagedAssets(goalPrompt) {
    if (!goalPrompt) return { reasoning: "", assets: [] };
    const fallbackByKeyword = [
      { re: /\b(soho|street view|street scene|high street|main street|shopping street)\b/i, name: "Storefront Facade Module", prompt: "a detailed modular storefront facade with windows, door, trim, and signage area suitable for SoHo street frontage", count: 6 },
      { re: /\b(storefront|shopfront|shop facade|facade|façade|retail frontage)\b/i, name: "Storefront Facade Module", prompt: "a detailed modular storefront facade with display windows, entry door, trim, and awning mount points", count: 6 },
      { re: /\b(awning)\b/i, name: "Shop Awning", prompt: "a reusable striped fabric shop awning with metal support brackets", count: 4 },
      { re: /\b(sign|signage|shop sign|store sign|neon)\b/i, name: "Store Sign", prompt: "a reusable storefront sign panel with frame and mounting brackets", count: 5 },
      { re: /\b(display window|window display)\b/i, name: "Window Display Unit", prompt: "a reusable storefront window display unit with frame and sill", count: 4 },
      { re: /\b(shelf|shelving|rack|racking)\b/i, name: "Industrial Shelf", prompt: "an industrial warehouse shelving rack made of metal with multiple levels", count: 2 },
      { re: /\b(pallet)\b/i, name: "Pallet", prompt: "a reusable wooden shipping pallet", count: 3 },
      { re: /\b(forklift)\b/i, name: "Forklift", prompt: "a compact warehouse forklift built from primitives", count: 1 },
      { re: /\b(crate|box stack|storage box)\b/i, name: "Crate Stack", prompt: "a reusable stack of storage crates", count: 2 },
      { re: /\b(desk|table)\b/i, name: "Table", prompt: "a reusable table asset with realistic proportions", count: 2 },
      { re: /\b(chair|stool|bench)\b/i, name: "Chair", prompt: "a reusable chair asset with seat, legs, and back", count: 4 },
      { re: /\b(cabinet|locker)\b/i, name: "Cabinet", prompt: "a reusable storage cabinet", count: 2 },
      { re: /\b(machine|equipment|generator)\b/i, name: "Machine", prompt: "a reusable industrial machine/equipment prop", count: 1 },
    ];
    try {
      const plannerMsgs = [
        { role: "system", content: AUTO_STAGE_ASSET_PLANNER_PROMPT },
        { role: "user", content: `Scene request:\n${goalPrompt}` },
      ];
      const raw = await callLLM(plannerMsgs, 2600, abortController?.signal, "Asset Planner");
      let parsed;
      try {
        parsed = extractJSON(raw, { quiet: true });
      } catch {
        // Gemini can truncate long planner JSON; salvage complete entries.
        parsed = { reasoning: "", assets: parsePlannerAssetsLoose(raw) };
      }
      const list = Array.isArray(parsed?.assets) ? parsed.assets : [];
      const normalized = list
        .map((x) => ({
          name: String(x?.name || "").trim(),
          prompt: String(x?.prompt || "").trim(),
          count: Math.max(1, Math.min(6, Number.isFinite(Number(x?.count)) ? Math.round(Number(x.count)) : 1)),
        }))
        .filter((x) => x.prompt.length >= 4)
        .slice(0, 20);
      if (normalized.length > 0) return { reasoning: String(parsed?.reasoning || ""), assets: normalized };

      // Retry once with an ultra-compact planner prompt before keyword fallback.
      const retryMsgs = [
        {
          role: "system",
          content: [
            "Return ONLY compact valid JSON. No markdown/code fences.",
            'Use exact format: {"reasoning":"MAX 8 words.","assets":[{"name":"","prompt":"","count":1}]}',
            "Return 0-12 assets, count 1-6, keep prompts concise.",
          ].join("\n"),
        },
        { role: "user", content: `Scene request:\n${goalPrompt}` },
      ];
      try {
        const retryRaw = await callLLM(retryMsgs, 1400, abortController?.signal, "Asset Planner Retry");
        let retryParsed;
        try {
          retryParsed = extractJSON(retryRaw, { quiet: true });
        } catch {
          retryParsed = { reasoning: "", assets: parsePlannerAssetsLoose(retryRaw) };
        }
        const retryList = Array.isArray(retryParsed?.assets) ? retryParsed.assets : [];
        const retryNorm = retryList
          .map((x) => ({
            name: String(x?.name || "").trim(),
            prompt: String(x?.prompt || "").trim(),
            count: Math.max(1, Math.min(6, Number.isFinite(Number(x?.count)) ? Math.round(Number(x.count)) : 1)),
          }))
          .filter((x) => x.prompt.length >= 4)
          .slice(0, 20);
        if (retryNorm.length > 0) return { reasoning: String(retryParsed?.reasoning || ""), assets: retryNorm };
      } catch {}

      return {
        reasoning: "Fallback keyword-based staged asset queue.",
        assets: fallbackByKeyword
        .filter((k) => k.re.test(goalPrompt))
        .slice(0, 20)
        .map((k) => ({ name: k.name, prompt: k.prompt, count: k.count })),
      };
    } catch (err) {
      console.warn("[VibeCreator] auto-stage planner failed:", err?.message || err);
      return {
        reasoning: "Planner error fallback queue.",
        assets: fallbackByKeyword
        .filter((k) => k.re.test(goalPrompt))
        .slice(0, 20)
        .map((k) => ({ name: k.name, prompt: k.prompt, count: k.count })),
      };
    }
  }

  function resolveStagedRecordByName(name, stagedAssetRecords) {
    const needle = String(name || "").toLowerCase().trim();
    if (!needle) return null;
    let best = null;
    let bestScore = -1;
    for (const rec of stagedAssetRecords || []) {
      const a = `${rec?._displayName || rec?.name || ""} ${rec?.prompt || ""}`.toLowerCase();
      let score = 0;
      if (a.includes(needle)) score += 5;
      const tokens = needle.split(/[^a-z0-9]+/g).filter(Boolean);
      for (const t of tokens) if (t.length >= 3 && a.includes(t)) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = rec;
      }
    }
    return bestScore > 0 ? best : null;
  }

  async function planStagedAssetPlacements(goalPrompt, stagedCatalog, sceneSnapshot, sceneScreenshotBase64 = null) {
    if (!Array.isArray(stagedCatalog) || stagedCatalog.length === 0) return [];
    try {
      const spatial = buildSpatialSummary(sceneSnapshot || { tags: [], primitives: [], lights: [], groups: [] });
      const userParts = [
        {
          type: "text",
          text: `Scene request:\n${goalPrompt}\n\nStructural scene summary:\n${spatial}\n\nStaged asset catalog (summarized):\n${JSON.stringify(stagedCatalog.map((x) => ({ name: x.name, count: x.count, summary: x.summary?.summary || "", footprint: x.summary?.footprint || { w: 1, d: 1, h: 1 } })), null, 2)}`,
        },
      ];
      if (sceneScreenshotBase64) {
        userParts.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${sceneScreenshotBase64}` } });
      }
      // Include a few staged-asset thumbnails so placement planner can reason visually.
      for (const item of stagedCatalog.slice(0, 6)) {
        const thumb = item?.thumbnailDataUrl;
        if (typeof thumb === "string" && thumb.startsWith("data:image/")) {
          userParts.push({ type: "image_url", image_url: { url: thumb } });
        }
      }
      const msgs = [
        { role: "system", content: ASSET_PLACEMENT_PROMPT },
        { role: "user", content: userParts },
      ];
      const raw = await callLLM(msgs, 2800, abortController?.signal, "Asset Placement Planner");
      const parsed = extractJSON(raw, { quiet: true });
      const placements = Array.isArray(parsed?.placements) ? parsed.placements : [];
      return placements
        .map((p) => ({
          assetName: String(p?.assetName || "").trim(),
          positions: Array.isArray(p?.positions)
            ? p.positions
              .filter((pos) => Number.isFinite(Number(pos?.x)) && Number.isFinite(Number(pos?.z)))
              .map((pos) => ({ x: Number(pos.x), z: Number(pos.z) }))
            : [],
        }))
        .filter((p) => p.assetName && p.positions.length > 0);
    } catch (err) {
      console.warn("[VibeCreator] placement planner failed:", err?.message || err);
      return [];
    }
  }

  async function createStagedAssetFromPrompt(prompt, options = {}) {
    if (!prompt) { setVibeStatus("Enter an asset prompt first.", true); return; }
    const skipPlacement = !!options.skipPlacement;
    const silent = !!options.silent;
    const headless = !!options.headless;

    const localAbort = new AbortController();
    setAssetGenerating(true);
    if (!headless && typeof focusStagingArea === "function") {
      try { focusStagingArea(); } catch {}
    }
    if (!silent && !headless) {
      setVibeStatus("Staging asset…");
      setStatus("Vibe Creator: staging asset…");
    }

    try {
      const convoCtx = buildConversationContextText();
      const messages = [
        { role: "system", content: ASSET_STAGING_PROMPT },
        { role: "user", content: `${convoCtx ? `Conversation context:\n${convoCtx}\n\n` : ""}Create one reusable asset for staging: ${prompt}` },
      ];
      const raw = await callLLM(messages, 8192, localAbort.signal, "Asset Generator");
      let assetScene;
      try {
        assetScene = validateScene(extractJSON(raw, { quiet: true }));
      } catch (parseErr) {
        console.warn("[VibeCreator] Asset JSON parse failed; retrying with compact output...", parseErr?.message || parseErr);
        const retryMessages = [
          {
            role: "system",
            content: [
              "Return ONLY compact valid JSON (no markdown/code fences).",
              "The output MUST match this shape exactly:",
              '{"reasoning":"MAX 12 words.","tags":[],"primitives":[],"lights":[],"groups":[]}',
              "Keep reasoning extremely short and prioritize complete JSON over detail.",
              "If uncertain, output a simpler asset, but always valid JSON.",
              SCENE_SCHEMA,
            ].join("\n"),
          },
          {
            role: "user",
            content: `${convoCtx ? `Conversation context:\n${convoCtx}\n\n` : ""}Create one reusable staged asset for: ${prompt}`,
          },
        ];
        try {
          const retryRaw = await callLLM(retryMessages, 4096, localAbort.signal, "Asset Generator Retry");
          assetScene = validateScene(extractJSON(retryRaw, { quiet: true }));
        } catch (retryErr) {
          console.warn("[VibeCreator] Retry parse failed; using fallback asset scene.", retryErr?.message || retryErr);
          assetScene = validateScene(buildFallbackAssetScene(prompt));
        }
      }
      if (!skipPlacement && !headless) {
        const livePreview = offsetScene(assetScene, 0, 0);
        await importLevel(livePreview);
        setVibeStatus("Asset draft generated…");
      }

      // ── Texture generation (best-effort — save asset even if textures fail) ──
      const texCount = assetScene.primitives.filter((p) => p.material?.generateTexture).length;
      if (texCount > 0 && imageEndpoint) {
        try {
          await generateTextures(assetScene, imageEndpoint, (msg) => setVibeStatus(msg), localAbort.signal);
          if (!skipPlacement && !headless) {
            const postTexturePreview = offsetScene(assetScene, 0, 0);
            await importLevel(postTexturePreview);
          }
        } catch (texErr) {
          console.warn("[VibeCreator] Texture generation failed, continuing without textures:", texErr.message);
          // Strip generateTexture flags so they don't cause issues downstream
          for (const p of assetScene.primitives) {
            if (p.material) delete p.material.generateTexture;
          }
          if (!skipPlacement && !headless) {
            await importLevel(offsetScene(assetScene, 0, 0));
          }
        }
      }

      // ── Lightweight self-review (best-effort — never lose the working asset) ──
      try {
        const reviewMessages = [
          { role: "system", content: ASSET_REVIEW_PROMPT },
          { role: "user", content: `Requested staged asset: ${prompt}\n\nAsset JSON:\n${JSON.stringify(compactSceneForLLM(assetScene), null, 2)}` },
        ];
        const reviewRaw = await callLLM(reviewMessages, 8192, localAbort.signal, "Asset Reviewer");
        const review = extractJSON(reviewRaw, { quiet: true });
        if (review.status === "fix" && review.scene) {
          const fixedScene = validateScene(review.scene);
          // Preserve textures from the original if the reviewer stripped them
          for (const fp of fixedScene.primitives) {
            if (!fp.material?.textureDataUrl) {
              const orig = assetScene.primitives.find((op) => op.id === fp.id);
              if (orig?.material?.textureDataUrl) {
                fp.material = fp.material || {};
                fp.material.textureDataUrl = orig.material.textureDataUrl;
              }
            }
          }
          assetScene = fixedScene;
          if (!skipPlacement && !headless) {
            await importLevel(offsetScene(assetScene, 0, 0));
            setVibeStatus("Asset reviewed and adjusted…");
          }
        }
      } catch (reviewErr) {
        console.warn("[VibeCreator] Asset review failed, keeping original asset:", reviewErr.message);
      }

      const assetId = `stg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const record = {
        id: assetId,
        name: (prompt.length > 48 ? prompt.slice(0, 48) + "..." : prompt),
        prompt,
        states: [
          {
            id: "state-default",
            name: "default",
            scene: deepCloneJSON(assetScene),
            interactions: [],
          },
        ],
        currentStateId: "state-default",
        actions: [],
        pickable: false,
        blueprint: assetScene,
        thumbnailDataUrl: "",
      };
      if (!skipPlacement && !headless) {
        const placed = offsetScene(record.blueprint, 0, 0);
        await importLevel(placed);
      }
      if (typeof captureAssetThumbnail === "function") {
        try {
          // For headless/skipped placement, temporarily import the scene to capture a thumbnail
          if (headless || skipPlacement) {
            const tempScene = offsetScene(record.blueprint, 0, 0);
            await importLevel(tempScene);
          }
          const thumb = await captureAssetThumbnail();
          if (typeof thumb === "string" && thumb.startsWith("data:image/")) {
            record.thumbnailDataUrl = thumb;
          }
        } catch {}
      }
      // Fallback thumbnail path if dedicated thumbnail capture failed.
      if ((!record.thumbnailDataUrl || !record.thumbnailDataUrl.startsWith("data:image/"))
        && typeof captureScreenshot === "function") {
        try {
          const shot = await captureScreenshot();
          if (typeof shot === "string" && shot.startsWith("data:image/")) {
            record.thumbnailDataUrl = shot;
          }
        } catch {}
      }
      upsertAssetLibraryFromRecord(record);
      loadAssetLibraryIntoState();
      renderStagedAssets();
      if (!silent && !headless) {
        setVibeStatus(`Asset created + saved: ${record.name}`);
        setStatus("Vibe Creator: asset created and saved to library.");
      }
      pushChatHistory("assistant", `Created reusable asset "${record.name}" from prompt "${prompt}".`);
      return record;
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("[VibeCreator] Stage asset error:", err);
        if (!silent) setVibeStatus(err.message || "Failed to stage asset.", true);
      }
    } finally {
      setAssetGenerating(false);
    }
  }

  async function generateStagedAsset() {
    if (isGenerating || isAssetGenerating) return;
    const prompt = ui.input.value.trim();
    await createStagedAssetFromPrompt(prompt);
  }

  // ---- LLM call ----

  async function callLLM(messages, maxTokens = 16384, signal = abortController?.signal, streamLabel = "LLM") {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: "", messages, max_tokens: maxTokens }),
      signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`API error (${res.status}): ${errText || res.statusText}`);
    }
    const data = await res.json();
    const rawText = data.raw || data.text || (typeof data === "string" ? data : JSON.stringify(data));
    console.log("[VibeCreator] LLM:", rawText.slice(0, 400) + (rawText.length > 400 ? "…" : ""));
    await streamModelText(streamLabel, rawText, signal);
    return rawText;
  }

  // ---- Screenshot helper ----

  async function safeScreenshot() {
    try {
      await sleep(600);
      return await captureScreenshot();
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // CORE AGENTIC LOOP
  // ===========================================================================

  async function generate() {
    const prompt = ui.input.value.trim();
    if (!prompt) { setVibeStatus("Enter a scene description.", true); return; }
    resetStreamLog();
    ui.streamDetails?.classList.remove("hidden");
    appendStreamLog(`[User Prompt]\n${prompt}\n`);
    pushChatHistory("user", prompt);
    const workspace = typeof getWorkspaceMode === "function" ? getWorkspaceMode() : "scene";
    if (workspace === "assetBuilder") {
      await generateStagedAsset();
      return;
    }

    const sceneBefore = getCurrentScene();
    const hasExistingScene = Array.isArray(sceneBefore?.primitives) && sceneBefore.primitives.length > 0;
    const additive = ui.additiveCheckbox.checked || (hasExistingScene && isLikelyEditPrompt(prompt));
    if (!ui.additiveCheckbox.checked && additive && hasExistingScene) {
      addFinalNote("Detected follow-up edit request. Running in additive edit mode.");
    }

    setGenerating(true);
    clearTracker();
    currentActivity = "";
    setVibeStatus("Planning…");
    setStatus("Vibe Creator: planning…");
    abortController = new AbortController();

    // Track per-task object IDs for clean replacement during fixes
    const taskPrimIds = {};   // taskId -> Set<primId>
    const taskLightIds = {};  // taskId -> Set<lightId>
    const taskGroupIds = {};  // taskId -> Set<groupId>
    let stagedAssetsPlan = [];
    let stagedAssetRecords = [];

    try {
      // =================================================================
      // PHASE 0 — AUTO STAGE REUSABLE ASSETS (scene mode)
      // =================================================================
      setVibeStatus("Identifying reusable assets…");
      const assetPlan = await planAutoStagedAssets(prompt);
      stagedAssetsPlan = Array.isArray(assetPlan?.assets) ? assetPlan.assets : [];
      if (assetPlan?.reasoning) {
        addFinalNote(`Asset queue plan: ${assetPlan.reasoning}`);
      }
      if (stagedAssetsPlan.length > 0) {
        addFinalNote(`Asset queue contains ${stagedAssetsPlan.length} staged assets.`);
        ensureAiPanelVisible();
        ui.setTab("assets");
        if (typeof switchWorkspaceMode === "function") {
          await switchWorkspaceMode("assetBuilder");
        }
        setStatus(`Vibe Creator: staging ${stagedAssetsPlan.length} reusable assets…`);
        const emptyScene = { tags: [], primitives: [], lights: [], groups: [] };
        for (const planned of stagedAssetsPlan) {
          if (abortController.signal.aborted) break;
          // Generate each asset in isolation to avoid blending multiple assets together.
          await importLevel(emptyScene);
          setVibeStatus(`Staging reusable asset: ${planned.name || planned.prompt}`);
          const oneAssetPrompt = `${planned.prompt}\n\nIMPORTANT: Generate exactly ONE asset only. Do not include other props or scene layout.`;
          const rec = await createStagedAssetFromPrompt(oneAssetPrompt, { skipPlacement: false, silent: true });
          const recovered = rec || resolveAssetRecordFromLibrary(planned);
          if (recovered) {
            const normalized = {
              ...recovered,
              blueprint: validateScene(recovered.blueprint || recovered.scene || { tags: [], primitives: [], lights: [], groups: [] }),
            };
            if (!normalized.id) normalized.id = `lib-${Math.random().toString(36).slice(2, 8)}`;
            if (!normalized.name) normalized.name = planned.name || "Library Asset";
            normalized._insertCount = planned.count;
            normalized._displayName = planned.name || normalized.name;
            normalized._contextSummary = summarizeStagedAssetRecord(normalized, planned.count);
            stagedAssetRecords.push(normalized);
            addFinalNote(`Staged asset ready: ${normalized._displayName} (${normalized._contextSummary.summary}; ~${normalized._contextSummary.footprint.w}m x ${normalized._contextSummary.footprint.d}m)`);
          } else {
            addFinalNote(`Failed to stage/recover asset: ${planned.name || planned.prompt}`);
          }
          // Clear builder again so the next asset starts from a clean staging level.
          await importLevel(emptyScene);
        }
        if (typeof switchWorkspaceMode === "function") {
          await switchWorkspaceMode("scene");
        }
        ui.setTab("scene");
        setVibeStatus("Staged reusable assets. Building scene…");
      }

      const stagedCatalog = stagedAssetRecords.map((x) => ({
        name: x._displayName || x.name,
        prompt: x.prompt,
        count: Math.max(1, Number(x._insertCount) || 1),
        thumbnailDataUrl: x.thumbnailDataUrl || "",
        summary: summarizeStagedAssetRecord(x, Math.max(1, Number(x._insertCount) || 1)),
      }));
      // Compact context catalog used in planning/execution prompts.
      const stagedCatalogContext = stagedCatalog.map((x) => ({
        name: x.name,
        prompt: x.prompt,
        count: x.count,
        summary: x.summary?.summary || "",
        primitiveCount: x.summary?.primitiveCount || 0,
        textureCount: x.summary?.textureCount || 0,
        footprint: x.summary?.footprint || { w: 1, d: 1, h: 1 },
      }));

      // =================================================================
      // PHASE 1 — PLANNING
      // =================================================================
      const planMessages = [{ role: "system", content: PLANNER_PROMPT }];
      let planUserContent = `Create a plan for building this 3D scene: ${prompt}`;
      const convoCtx = buildConversationContextText();
      if (convoCtx) {
        planUserContent += `\n\nConversation history context:\n${convoCtx}`;
      }
      if (additive) {
        const current = getCurrentScene();
        planUserContent += `\n\nThe scene already has objects. Add to the existing scene.\n${buildSpatialSummary(current)}`;
      }
      if (stagedCatalogContext.length > 0) {
        planUserContent += `\n\nStaged asset library catalog (summarized; already generated and must be reused):\n${JSON.stringify(stagedCatalogContext, null, 2)}\nCreate plan tasks for STRUCTURE/LIGHTING only. Do not include furniture/props build tasks because those will come from staged assets.`;
      }
      planMessages.push({ role: "user", content: planUserContent });

      const planRaw = await callLLM(planMessages, 2048, abortController.signal, "Planner");
      const planResult = extractJSON(planRaw, { quiet: true });
      let tasks = planResult.plan || planResult.tasks || [];
      if (!Array.isArray(tasks) || tasks.length === 0) {
        // Fallback for simple requests — single task
        tasks = [{ id: "main", title: prompt.slice(0, 60), description: prompt }];
      }

      // Ensure each task has an id
      for (let i = 0; i < tasks.length; i++) {
        if (!tasks[i].id) tasks[i].id = `task-${i}`;
      }

      initTracker(prompt, tasks);
      setVibeStatus(`Plan: ${tasks.length} tasks`);
      console.log(`[VibeCreator] Plan: ${tasks.length} tasks`);

      // =================================================================
      // PHASE 2 — EXECUTE EACH TASK (with error recovery)
      // =================================================================
      const MAX_PARSE_RETRIES = 2;   // retries for JSON parse failures
      const MAX_REVIEW_FIXES = 2;    // max review→fix cycles per task

      for (let i = 0; i < tasks.length; i++) {
        if (abortController.signal.aborted) break;

        const task = tasks[i];
        updateTaskStatus(task.id, "active", "generating…");
        setVibeStatus(`Task ${i + 1}/${tasks.length}: ${task.title}`);
        setStatus(`Vibe Creator: ${task.title} (${i + 1}/${tasks.length})`);
        setActivity(`Generating: ${task.title} — ${task.description}`);

        // --- Context for this task ---
        const currentScene = (additive || i > 0) ? getCurrentScene() : { tags: [], primitives: [], lights: [], groups: [] };
        const spatialSummary = buildSpatialSummary(currentScene);
        const screenshot = currentScene.primitives.length > 0 ? await safeScreenshot() : null;

        // --- Build executor messages ---
        const execUserContent = [];
        let textPart = `Overall goal: "${prompt}"\n\nTask ${i + 1}/${tasks.length}: ${task.title}\nDescription: ${task.description}\n\n${spatialSummary}`;
        if (stagedCatalogContext.length > 0) {
          const stagedNames = stagedAssetRecords.map((x) => x._displayName || x.name).join(", ");
          textPart += `\n\nAVAILABLE_STAGED_ASSETS: ${stagedNames}\nSTAGED_ASSET_CATALOG_SUMMARY:\n${JSON.stringify(stagedCatalogContext, null, 2)}\nDo not spend primitives rebuilding these assets in detail. Focus this task on architecture/layout and leave logical placement space for staged assets only.`;
        }
        execUserContent.push({ type: "text", text: textPart });
        if (screenshot) {
          execUserContent.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${screenshot}` } });
        }

        const execMessages = [
          { role: "system", content: TASK_EXECUTOR_PROMPT },
          { role: "user", content: execUserContent },
        ];

        // --- Execute task with JSON parse retry ---
        let additions = null;
        let lastExecRaw = "";
        let parseAttempts = 0;

        while (!additions && parseAttempts <= MAX_PARSE_RETRIES) {
          if (abortController.signal.aborted) break;
          try {
            lastExecRaw = await callLLM(execMessages, 16384, abortController.signal, `Executor: ${task.title}`);
            const parsed = extractJSON(lastExecRaw, { quiet: true });
            const scenePayload = extractScenePayload(parsed);

            // Extract chain-of-thought reasoning if present
            if (parsed.reasoning) {
              const reasoningPreview = parsed.reasoning.length > 200
                ? parsed.reasoning.slice(0, 200) + "…"
                : parsed.reasoning;
              addTaskDetail(task.id, `Plan: ${reasoningPreview}`);
            }

            additions = validateScene(scenePayload);
            const beforeFilterCount = additions.primitives?.length || 0;
            additions = enforceStagedComplexPolicy(additions, stagedCatalogContext);
            const afterFilterCount = additions.primitives?.length || 0;
            // Safety: if policy filtering removed everything on an otherwise non-empty task,
            // keep original additions so structure doesn't collapse to zero.
            if (beforeFilterCount > 0 && afterFilterCount === 0) {
              additions = validateScene(scenePayload);
              addTaskDetail(task.id, "Staged-policy filter removed all shapes; restored task output.");
            }
          } catch (parseErr) {
            parseAttempts++;
            if (parseAttempts > MAX_PARSE_RETRIES) {
              addTaskDetail(task.id, `Failed after ${parseAttempts} parse attempts. Skipping task.`);
              updateTaskStatus(task.id, "failed", "parse error");
              console.error(`[VibeCreator] Task "${task.title}" parse failed:`, parseErr.message);
              break;
            }
            addTaskDetail(task.id, `JSON parse error (attempt ${parseAttempts}/${MAX_PARSE_RETRIES}), retrying…`);
            // Feed the error back to the LLM for self-correction
            execMessages.push(
              { role: "assistant", content: lastExecRaw },
              { role: "user", content: [{ type: "text", text: `Your previous response was not valid JSON. Error: "${parseErr.message}"\n\nPlease output ONLY valid JSON matching the required format. No markdown code fences, no comments, no trailing commas. Start with { and end with }.` }] }
            );
          }
        }

        // Skip to next task if this one failed to parse
        if (!additions) continue;

        // If model returned no shapes, synthesize a minimal shell fallback.
        // Be strict for early/empty-scene tasks where structure is required.
        if ((additions.primitives?.length || 0) === 0) {
          const taskText = `${task.title || ""} ${task.description || ""}`.toLowerCase();
          const isLikelyStructureTask = /\b(structure|shell|room|enclosure|walls?|floor|ceiling|layout|interior)\b/.test(taskText);
          const isEarlyTaskOnEmptyScene = i <= 1 && (getCurrentScene()?.primitives?.length || 0) === 0;
          if (isLikelyStructureTask || isEarlyTaskOnEmptyScene) {
            additions = buildFallbackStructureScene(prompt, task);
            addTaskDetail(task.id, "Model returned empty structure task; applied fallback shell.");
          }
        }

        // Track IDs for this task
        taskPrimIds[task.id] = new Set(additions.primitives.map((p) => p.id));
        taskLightIds[task.id] = new Set(additions.lights.map((l) => l.id));
        taskGroupIds[task.id] = new Set(additions.groups.map((g) => g.id));

        // --- Textures ---
        const texCount = additions.primitives.filter((p) => p.material?.generateTexture).length;
        if (texCount > 0 && imageEndpoint) {
          updateTaskStatus(task.id, "active", `${texCount} textures…`);
          await generateTextures(additions, imageEndpoint, (msg) => setVibeStatus(msg), abortController.signal);
        }

        // --- Merge + import ---
        const merged = mergeScene(getCurrentScene(), additions);
        await importLevel(merged);

        let pc = additions.primitives.length;
        const gc = additions.groups.length;
        addTaskDetail(task.id, `Added ${pc} shapes, ${gc} groups.`);
        updateTaskStatus(task.id, "active", `${pc} shapes — reviewing…`);
        setActivity(`Reviewing: ${task.title} — checking placement and proportions…`);

        // --- Review with escalation (retry loop) ---
        let reviewAttempts = 0;
        let reviewPassed = false;

        while (reviewAttempts < MAX_REVIEW_FIXES && !reviewPassed) {
          if (abortController.signal.aborted) break;

          const reviewShot = await safeScreenshot();
          if (!reviewShot) { reviewPassed = true; break; } // no screenshot = skip review

          const currentPc = taskPrimIds[task.id].size;
          const currentGc = taskGroupIds[task.id].size;

          const reviewMessages = [
            { role: "system", content: TASK_REVIEWER_PROMPT },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Overall goal: "${prompt}"\nCompleted task: ${task.title}\nDetails: ${task.description}\nAdded ${currentPc} primitives, ${currentGc} groups.${reviewAttempts > 0 ? `\n\nThis is fix attempt ${reviewAttempts}/${MAX_REVIEW_FIXES}. Previous fix was applied but may still have issues. Be thorough.` : ""}`,
                },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${reviewShot}` } },
              ],
            },
          ];

          try {
            const reviewRaw = await callLLM(reviewMessages, 8192, abortController.signal, `Reviewer: ${task.title}`);
            let review;
            try {
              review = extractJSON(reviewRaw, { quiet: true });
            } catch (reviewParseErr) {
              // Ask model to compact/repair its own prior output once before skipping review.
              const parseRepairMessages = [
                {
                  role: "system",
                  content: "Convert the provided text into valid compact JSON only. No markdown. If text is truncated, return {\"status\":\"ok\",\"reasoning\":\"review parse fallback\"}.",
                },
                {
                  role: "user",
                  content: [{ type: "text", text: `Repair to valid JSON with schema {status,reasoning,scene?}:\n\n${String(reviewRaw).slice(0, 12000)}` }],
                },
              ];
              try {
                const repairedRaw = await callLLM(parseRepairMessages, 2500, abortController.signal, `Reviewer Parse Repair: ${task.title}`);
                review = extractJSON(repairedRaw, { quiet: true });
              } catch {
                throw reviewParseErr;
              }
            }

            if (review.status === "fix" && review.scene) {
              reviewAttempts++;
              addTaskDetail(task.id, `Fix ${reviewAttempts}: ${review.reasoning}`);
              updateTaskStatus(task.id, "active", `fixing (attempt ${reviewAttempts})…`);
              setActivity(`Fixing: ${review.reasoning}`);

              // Remove this task's objects, replace with fix
              const stripped = removeObjectsByIds(getCurrentScene(), taskPrimIds[task.id], taskLightIds[task.id], taskGroupIds[task.id]);
              const fixScene = validateScene(review.scene);
              const prevPrimCount = taskPrimIds[task.id]?.size || 0;
              // Guardrail: reject destructive fixes that unexpectedly drop most task content.
              if (prevPrimCount >= 3 && fixScene.primitives.length < Math.ceil(prevPrimCount * 0.5)) {
                addTaskDetail(
                  task.id,
                  `Rejected destructive fix (${fixScene.primitives.length}/${prevPrimCount} shapes). Keeping previous result.`
                );
                reviewPassed = true;
                continue;
              }

              // Update tracked IDs
              taskPrimIds[task.id] = new Set(fixScene.primitives.map((p) => p.id));
              taskLightIds[task.id] = new Set(fixScene.lights.map((l) => l.id));
              taskGroupIds[task.id] = new Set(fixScene.groups.map((g) => g.id));

              const fixTexCount = fixScene.primitives.filter((p) => p.material?.generateTexture).length;
              if (fixTexCount > 0 && imageEndpoint) {
                await generateTextures(fixScene, imageEndpoint, (msg) => setVibeStatus(msg), abortController.signal);
              }

              const fixMerged = mergeScene(stripped, fixScene);
              await importLevel(fixMerged);
              pc = fixScene.primitives.length;
              addTaskDetail(task.id, `Fixed → ${pc} shapes.`);

              if (reviewAttempts >= MAX_REVIEW_FIXES) {
                addTaskDetail(task.id, `Fix limit reached (${MAX_REVIEW_FIXES} attempts). Accepting current state.`);
                reviewPassed = true;
              }
              // Otherwise loop back to review the fix
            } else {
              // Review passed
              addTaskDetail(task.id, review.reasoning || "Looks good.");
              reviewPassed = true;
            }
          } catch (reviewErr) {
            // Review parse failure — don't block, just accept and move on
            console.warn(`[VibeCreator] Review parse failed for task "${task.title}":`, reviewErr.message);
            addTaskDetail(task.id, "Review skipped (parse error). Accepting current state.");
            reviewPassed = true;
          }
        }

        updateTaskStatus(task.id, "done", `${pc} shapes`);
      }

      // =================================================================
      // PHASE 2.5 — INSERT STAGED ASSET INSTANCES
      // =================================================================
      if (!abortController.signal.aborted && stagedAssetRecords.length > 0) {
        setVibeStatus("Placing staged assets into scene…");
        const placementShot = await safeScreenshot();
        const placementPlan = await planStagedAssetPlacements(prompt, stagedCatalog, getCurrentScene(), placementShot);
        const placedCounts = new Map();
        for (const pp of placementPlan) {
          const rec = resolveStagedRecordByName(pp.assetName, stagedAssetRecords);
          if (!rec) continue;
          for (const pos of pp.positions) {
            if (abortController.signal.aborted) break;
            await insertApprovedAsset(rec, { preferAnchor: false, targetX: pos.x, targetZ: pos.z });
            placedCounts.set(rec.id, (placedCounts.get(rec.id) || 0) + 1);
          }
        }
        // Fill any missing planned counts with deterministic fallback placement.
        for (const rec of stagedAssetRecords) {
          const target = Math.max(1, Number(rec._insertCount) || 1);
          const already = placedCounts.get(rec.id) || 0;
          for (let n = already; n < target; n++) {
            if (abortController.signal.aborted) break;
            await insertApprovedAsset(rec, { preferAnchor: false });
          }
          addFinalNote(`Staged asset inserted: ${rec._displayName || rec.name} x${target}`);
        }
      }

      // =================================================================
      // PHASE 3 — FINAL POLISH
      // =================================================================
      if (tasks.length > 1 && !abortController.signal.aborted) {
        setVibeStatus("Final review…");
        setStatus("Vibe Creator: final review…");
        setActivity("Final review — checking overall scene for missing elements, layout, and lighting…");
        const finalShot = await safeScreenshot();

        if (finalShot) {
          const finalScene = getCurrentScene();
          const spatialCtx = buildSpatialSummary(finalScene);
          // Use spatial summary + compact JSON (no base64 textures) to stay within token limits
          const compactScene = compactSceneForLLM(finalScene);
          const sceneStr = JSON.stringify(compactScene, null, 2);
          // If compact JSON is still huge (>100K chars), fall back to spatial summary only
          const sceneContext = sceneStr.length > 100000
            ? spatialCtx
            : `${spatialCtx}\n\nFull scene JSON:\n${sceneStr}`;

          const finalMessages = [
            { role: "system", content: FINAL_REVIEW_PROMPT },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Original request: "${prompt}"\n\n${sceneContext}`,
                },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${finalShot}` } },
              ],
            },
          ];

          const finalRaw = await callLLM(finalMessages, 16384, abortController.signal, "Final Reviewer");
          const finalResult = extractJSON(finalRaw, { quiet: true });

          if (finalResult.status === "refine" && finalResult.scene) {
            addFinalNote(`Polish: ${finalResult.reasoning}`);
            const beforePolish = getCurrentScene();
            const polished = validateScene(finalResult.scene);
            const polishTexCount = polished.primitives.filter((p) => p.material?.generateTexture).length;
            if (polishTexCount > 0 && imageEndpoint) {
              await generateTextures(polished, imageEndpoint, (msg) => setVibeStatus(msg), abortController.signal);
            }
            // Non-destructive polish: keep existing objects that the polisher accidentally omits.
            const nonDestructive = {
              tags: [...(polished.tags || beforePolish.tags || [])],
              primitives: [...(beforePolish.primitives || [])],
              lights: [...(beforePolish.lights || [])],
              groups: [...(beforePolish.groups || [])],
            };
            const primById = new Map(nonDestructive.primitives.map((p, i) => [p.id, i]));
            for (const p of polished.primitives || []) {
              const idx = primById.get(p.id);
              if (idx === undefined) nonDestructive.primitives.push(p);
              else nonDestructive.primitives[idx] = p;
            }
            const lightById = new Map(nonDestructive.lights.map((l, i) => [l.id, i]));
            for (const l of polished.lights || []) {
              const idx = lightById.get(l.id);
              if (idx === undefined) nonDestructive.lights.push(l);
              else nonDestructive.lights[idx] = l;
            }
            const groupById = new Map(nonDestructive.groups.map((g, i) => [g.id, i]));
            for (const g of polished.groups || []) {
              const idx = groupById.get(g.id);
              if (idx === undefined) nonDestructive.groups.push(g);
              else nonDestructive.groups[idx] = g;
            }
            await importLevel(nonDestructive, { preserveAssetsWhenMissing: true });
            addFinalNote(`Polished (non-destructive) → ${nonDestructive.primitives.length} shapes.`);
          } else {
            addFinalNote(finalResult.reasoning || "Scene complete.");
          }
        }
      }

      // --- Done ---
      setActivity("");
      const finalScene = getCurrentScene();
      setVibeStatus(`Done! ${finalScene.primitives.length} shapes, ${finalScene.groups.length} groups.`);
      setStatus(`Vibe Creator: done — ${finalScene.primitives.length} shapes, ${finalScene.groups.length} groups.`);
      pushChatHistory("assistant", `Completed scene update. Scene now has ${finalScene.primitives.length} shapes and ${finalScene.groups.length} groups.`);

    } catch (err) {
      setActivity("");
      if (err.name === "AbortError") {
        setVibeStatus("Stopped.");
        setStatus("Vibe Creator: stopped.");
      } else {
        console.error("[VibeCreator]", err);
        setVibeStatus(err.message || "Failed.", true);
        setStatus("Vibe Creator: failed.");
      }
    } finally {
      abortController = null;
      setGenerating(false);
    }
  }

  function stop() {
    if (abortController) { abortController.abort(); abortController = null; }
    setGenerating(false);
  }

  // ---- Event listeners ----

  ui.generateBtn.addEventListener("click", generate);
  ui.stopBtn.addEventListener("click", stop);
  ui.assetList?.addEventListener("click", async (e) => {
    const card = e.target.closest(".vibe-asset-item");
    if (!card) return;
    const id = card.getAttribute("data-asset-id");
    const asset = libraryAssets.find((a) => a.id === id);
    if (!asset) return;
    const removeBtn = e.target.closest(".vibe-asset-remove");
    if (removeBtn) {
      const list = readAssetLibrary().filter((x) => x.id !== asset.id);
      writeAssetLibrary(list);
      loadAssetLibraryIntoState();
      renderStagedAssets();
      return;
    }
    const editBtn = e.target.closest(".vibe-asset-edit");
    if (editBtn) {
      if (typeof openAssetInBuilder === "function") {
        try {
          await openAssetInBuilder(asset);
        } catch (err) {
          console.error("[VibeCreator] Failed to open asset in builder:", err);
          setVibeStatus("Could not open asset in builder.", true);
        }
      }
      return;
    }
    await insertApprovedAsset(asset);
  });
  ui.assetList?.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".vibe-asset-item");
    if (!card) return;
    const id = card.getAttribute("data-asset-id");
    const asset = libraryAssets.find((a) => a.id === id);
    if (!asset) return;
    draggedAssetId = id;
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", id);
  });
  const canvasEl = document.getElementById("c");
  canvasEl?.addEventListener("dragover", (e) => {
    if (!draggedAssetId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  canvasEl?.addEventListener("drop", async (e) => {
    if (!draggedAssetId) return;
    e.preventDefault();
    const asset = libraryAssets.find((a) => a.id === draggedAssetId);
    draggedAssetId = null;
    if (!asset) return;
    await insertApprovedAsset(asset, { preferAnchor: true, clientX: e.clientX, clientY: e.clientY });
  });
  canvasEl?.addEventListener("dragend", () => { draggedAssetId = null; });
  // On startup: merge disk records without clobbering fresher local edits.
  (async function restoreFromDisk() {
    const baseUrl = (endpoint || "").replace("/vlm/decision", "");
    try {
      const res = await fetch(`${baseUrl}/vlm/asset-library`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.assets) && data.assets.length > 0) {
          const localAssets = readAssetLibrary();
          const merged = localAssets.length > 0
            ? mergeAssetLibrariesPreferLocal(localAssets, data.assets)
            : data.assets;
          const mergedRaw = JSON.stringify(merged);
          const localRaw = JSON.stringify(localAssets);
          if (mergedRaw !== localRaw) {
            let wroteLocal = false;
            try {
              localStorage.setItem(ASSET_LIBRARY_KEY, mergedRaw);
              wroteLocal = true;
            } catch (err) {
              console.warn("[VibeCreator] localStorage restore skipped:", err?.message || err);
            }
            console.log(`[VibeCreator] Restored ${merged.length} assets (merged local + disk).`);
            loadAssetLibraryIntoState(wroteLocal ? null : merged);
            renderStagedAssets();
          }
          // If disk was stale, push the merged canonical list back.
          if (mergedRaw !== JSON.stringify(data.assets)) {
            writeAssetLibrary(merged);
          }
        }
      }
    } catch { /* server offline — fall back to localStorage */ }
  })();
  loadAssetLibraryIntoState();
  renderStagedAssets();
  window.addEventListener("storage", (ev) => {
    if (ev.key !== ASSET_LIBRARY_KEY) return;
    loadAssetLibraryIntoState();
    renderStagedAssets();
  });
  window.addEventListener("asset-library-updated", (ev) => {
    const updated = ev?.detail?.assets;
    loadAssetLibraryIntoState(Array.isArray(updated) ? updated : null);
    renderStagedAssets();
  });

  ui.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !isGenerating) { e.preventDefault(); generate(); }
    if (e.key === "Escape") { if (isGenerating) stop(); else ui.input.blur(); }
    e.stopPropagation();
  });
  ui.input.addEventListener("keyup", (e) => e.stopPropagation());
  ui.input.addEventListener("keypress", (e) => e.stopPropagation());

  console.log("[VibeCreator] Agentic mode initialized.");

  return {
    async createAssetHeadless(prompt) {
      const rec = await createStagedAssetFromPrompt(String(prompt || "").trim(), {
        skipPlacement: true,
        silent: true,
        headless: true,
      });
      return rec || null;
    },
  };
}
