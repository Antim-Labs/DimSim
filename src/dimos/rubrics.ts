/**
 * Eval rubric scoring functions.
 *
 * Three rubric types:
 * 1. Object Distance -- metric distance between target object and goal position
 * 2. LLM Judge -- subjective VLM evaluation of agent behavior
 * 3. Physical Ground Truth -- check scene state against expected conditions
 */

// -- Types --------------------------------------------------------------------

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AssetEntry {
  title?: string;
  id?: string;
  transform?: { x?: number; y?: number; z?: number };
}

export interface PrimitiveEntry {
  label?: string;
  id?: string;
  x?: number;
  y?: number;
  z?: number;
}

export interface TagEntry {
  label?: string;
  id?: string;
  position?: Vec3;
}

export interface SceneState {
  assets?: AssetEntry[];
  primitives?: PrimitiveEntry[];
  tags?: TagEntry[];
}

export interface ObjectDistanceCriteria {
  object: string;
  target: string;
  thresholdM?: number;
}

export interface ObjectDistanceResult {
  pass: boolean;
  distanceM: number;
  details: string;
}

export interface GroundTruthCriteria {
  [condName: string]: boolean;
}

export interface GroundTruthCheck {
  expected: boolean;
  actual: boolean;
  pass: boolean;
}

export interface GroundTruthResult {
  pass: boolean;
  checks: Record<string, GroundTruthCheck>;
  details: string;
}

export interface LlmJudgeCriteria {
  prompt: string;
}

export interface TrajectoryPoint {
  ts: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface LlmJudgeContext {
  task: string;
  finalSnapshot: string | null;
  trajectory: TrajectoryPoint[];
  sceneState: SceneState;
}

export interface LlmJudgeResult {
  score: number;
  reasoning: string;
  details: string;
}

// -- Object Distance Rubric ---------------------------------------------------

/**
 * Scores whether a target object is within threshold distance of a goal.
 */
export function scoreObjectDistance(criteria: ObjectDistanceCriteria, sceneState: SceneState): ObjectDistanceResult {
  const { object: objectName, target: targetName, thresholdM = 0.5 } = criteria;

  const objectPos = _findObjectPosition(objectName, sceneState);
  const targetPos = _findObjectPosition(targetName, sceneState);

  if (!objectPos) {
    return { pass: false, distanceM: Infinity, details: `Object "${objectName}" not found in scene` };
  }
  if (!targetPos) {
    return { pass: false, distanceM: Infinity, details: `Target "${targetName}" not found in scene` };
  }

  const dx = objectPos.x - targetPos.x;
  const dy = objectPos.y - targetPos.y;
  const dz = objectPos.z - targetPos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  return {
    pass: dist <= thresholdM,
    distanceM: Math.round(dist * 1000) / 1000,
    details: `"${objectName}" is ${dist.toFixed(3)}m from "${targetName}" (threshold: ${thresholdM}m)`,
  };
}

// -- Physical Ground Truth Rubric ---------------------------------------------

/**
 * Checks scene state against expected boolean conditions.
 */
export function scoreGroundTruth(criteria: GroundTruthCriteria, sceneState: SceneState): GroundTruthResult {
  const checks: Record<string, GroundTruthCheck> = {};
  let allPass = true;

  for (const [condName, expected] of Object.entries(criteria)) {
    const actual = _evaluateCondition(condName, sceneState);
    const pass = actual === expected;
    checks[condName] = { expected, actual, pass };
    if (!pass) allPass = false;
  }

  const failedNames = Object.entries(checks)
    .filter(([, v]) => !v.pass)
    .map(([k]) => k);

  return {
    pass: allPass,
    checks,
    details: allPass
      ? "All ground truth conditions met"
      : `Failed: ${failedNames.join(", ")}`,
  };
}

// -- LLM Judge Rubric ---------------------------------------------------------

/**
 * Sends task context + final screenshot to a VLM and gets a subjective score.
 */
export async function scoreLlmJudge(criteria: LlmJudgeCriteria, context: LlmJudgeContext): Promise<LlmJudgeResult> {
  const { prompt } = criteria;
  const { task, finalSnapshot, trajectory } = context;

  // Build evaluation prompt
  const evalPrompt = [
    `You are an eval judge for a robot simulation. Score the agent's performance 1-5.`,
    ``,
    `TASK: ${task}`,
    ``,
    `EVALUATION QUESTION: ${prompt}`,
    ``,
    `TRAJECTORY SUMMARY: Agent took ${trajectory.length} recorded steps over ${trajectory.length > 0 ? trajectory[trajectory.length - 1].ts : 0}ms.`,
    ``,
    `Respond with JSON: { "score": <1-5>, "reasoning": "<brief explanation>" }`,
  ].join("\n");

  try {
    // Use the DimSim VLM endpoint (same as agent uses) to call the judge
    const body: Record<string, any> = {
      model: "gpt-4o",
      prompt: evalPrompt,
      image: finalSnapshot || undefined,
    };

    const resp = await fetch("/vlm/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      return { score: 0, reasoning: `VLM request failed: HTTP ${resp.status}`, details: "judge_error" };
    }

    const result = await resp.json();
    // Parse the VLM response -- it should be JSON with score and reasoning
    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    const score = Number(parsed.score || parsed.result?.score || 0);
    const reasoning = String(parsed.reasoning || parsed.result?.reasoning || "");

    return {
      score: Math.max(1, Math.min(5, score)),
      reasoning,
      details: `LLM judge score: ${score}/5`,
    };
  } catch (err: any) {
    return {
      score: 0,
      reasoning: `Judge error: ${err.message || err}`,
      details: "judge_error",
    };
  }
}

// -- Helpers ------------------------------------------------------------------

/**
 * Find an object's position in the scene by name (searches assets, primitives, tags).
 */
function _findObjectPosition(name: string, sceneState: SceneState): Vec3 | null {
  const lower = name.toLowerCase();

  // Search assets
  if (sceneState.assets) {
    for (const asset of sceneState.assets) {
      if (asset.title?.toLowerCase().includes(lower) || asset.id?.toLowerCase().includes(lower)) {
        if (asset.transform) {
          return { x: asset.transform.x || 0, y: asset.transform.y || 0, z: asset.transform.z || 0 };
        }
      }
    }
  }

  // Search primitives
  if (sceneState.primitives) {
    for (const prim of sceneState.primitives) {
      if (prim.label?.toLowerCase().includes(lower) || prim.id?.toLowerCase().includes(lower)) {
        return { x: prim.x || 0, y: prim.y || 0, z: prim.z || 0 };
      }
    }
  }

  // Search tags
  if (sceneState.tags) {
    for (const tag of sceneState.tags) {
      if (tag.label?.toLowerCase().includes(lower) || tag.id?.toLowerCase().includes(lower)) {
        if (tag.position) return tag.position;
      }
    }
  }

  return null;
}

/**
 * Evaluate a named condition against the scene state.
 * Conditions are convention-based: e.g. "spatulaOnCounter" checks if "spatula" is near "counter".
 */
function _evaluateCondition(condName: string, sceneState: SceneState): boolean {
  // Parse condition name: "<object>On<surface>" or "<object>Near<target>"
  const onMatch = condName.match(/^(\w+)On(\w+)$/);
  if (onMatch) {
    const [, objName, surfaceName] = onMatch;
    const objPos = _findObjectPosition(objName, sceneState);
    const surfPos = _findObjectPosition(surfaceName, sceneState);
    if (!objPos || !surfPos) return false;
    const dx = objPos.x - surfPos.x;
    const dz = objPos.z - surfPos.z;
    const horizDist = Math.sqrt(dx * dx + dz * dz);
    // "On" means horizontally close and vertically above
    return horizDist < 1.0 && objPos.y >= surfPos.y - 0.1;
  }

  const nearMatch = condName.match(/^(\w+)Near(\w+)$/);
  if (nearMatch) {
    const [, objName, targetName] = nearMatch;
    const objPos = _findObjectPosition(objName, sceneState);
    const targetPos = _findObjectPosition(targetName, sceneState);
    if (!objPos || !targetPos) return false;
    const dx = objPos.x - targetPos.x;
    const dy = objPos.y - targetPos.y;
    const dz = objPos.z - targetPos.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) < 1.5;
  }

  // Unknown condition format
  console.warn(`[rubric] Unknown condition format: ${condName}`);
  return false;
}
