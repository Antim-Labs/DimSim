// Central list of allowed actions the VLM can choose from.
// Each action executes, then a NEW screenshot is taken for the next decision.
// This is a snapshot-based system, not a video stream.

export const ACTIONS = [
  // === MOVEMENT ===
  {
    id: "MOVE_FORWARD",
    description: "Move forward. Use for approaching things you see.",
    params: { steps: "integer 1-5" },
  },
  {
    id: "MOVE_BACKWARD",
    description: "Move backward. Use to back away or reposition.",
    params: { steps: "integer 1-3" },
  },
  {
    id: "STRAFE_LEFT",
    description: "Sidestep left without turning.",
    params: { steps: "integer 1-3" },
  },
  {
    id: "STRAFE_RIGHT",
    description: "Sidestep right without turning.",
    params: { steps: "integer 1-3" },
  },
  {
    id: "MOVE_UP",
    description: "Move upward (float up). Useful in editor mode for vertical repositioning.",
    params: { steps: "integer 1-3" },
  },
  {
    id: "MOVE_DOWN",
    description: "Move downward (float down). Useful in editor mode for vertical repositioning.",
    params: { steps: "integer 1-3" },
  },

  // === LOOKING/TURNING ===
  {
    id: "TURN_LEFT",
    description: "Turn body left (yaw). Use to see what's to your left or explore new directions.",
    params: { degrees: "number 30-90" },
  },
  {
    id: "TURN_RIGHT",
    description: "Turn body right (yaw). Use to see what's to your right or explore new directions.",
    params: { degrees: "number 30-90" },
  },
  {
    id: "LOOK_UP",
    description: "Tilt view upward. Use to see shelves, ceilings, tall objects.",
    params: { degrees: "number 15-45" },
  },
  {
    id: "LOOK_DOWN",
    description: "Tilt view downward. Use to see floor, low objects, items on ground.",
    params: { degrees: "number 15-45" },
  },

  // === NAVIGATION ===
  {
    id: "GOTO_LOCATION",
    description: "Navigate toward a known location. Use 'start' to return to where you began.",
    params: { locationId: "string (tag id from nearbyLocations, or 'start')" },
  },

  // === INTERACTION ===
  {
    id: "INTERACT",
    description: "Interact with an object. REQUIRES: object in NEARBY OBJECTS list AND distance < 1.5m. Use the EXACT assetId from [id: ...] brackets!",
    params: { assetId: "string (EXACT id from [id: xxx] in NEARBY OBJECTS)", actionLabel: "string (from can: list)" },
  },

  // === PICK UP / DROP ===
  {
    id: "PICK_UP",
    description: "Pick up a pickable object. REQUIRES: object marked [pickable] in NEARBY OBJECTS AND distance < 1.5m AND you're not already holding something.",
    params: { assetId: "string (EXACT id from [id: xxx] in NEARBY OBJECTS)" },
  },
  {
    id: "DROP",
    description: "Drop the object you're currently holding. Places it in front of you.",
    params: {},
  },

  // === EDITOR ACTIONS (edit mode only) ===
  {
    id: "CREATE_PRIMITIVE",
    description: "Create a new primitive at the crosshair placement ghost. EDIT MODE ONLY.",
    params: { shape: "string (box|sphere|cylinder|cone|torus|plane)" },
  },
  {
    id: "SPAWN_LIBRARY_ASSET",
    description: "Spawn an asset from the Asset Library near the crosshair by name match. EDIT MODE ONLY.",
    params: { assetName: "string (name from ASSET LIBRARY list)" },
  },
  {
    id: "TRANSFORM_OBJECT",
    description: "Transform an existing object by ID. EDIT MODE ONLY. Works for assets and primitives. Supports absolute or delta transforms.",
    params: {
      targetType: "string ('asset' or 'primitive')",
      targetId: "string (EXACT id from nearby lists)",
      setPositionX: "number world X absolute, optional",
      setPositionY: "number world Y absolute, optional",
      setPositionZ: "number world Z absolute, optional",
      setRotationYDeg: "number absolute yaw degrees, optional",
      setScaleX: "number absolute scale X, optional",
      setScaleY: "number absolute scale Y, optional",
      setScaleZ: "number absolute scale Z, optional",
      moveX: "number meters, optional",
      moveY: "number meters, optional",
      moveZ: "number meters, optional",
      rotateYDeg: "number degrees, optional",
      scaleMul: "number multiplier, optional (e.g. 1.1 or 0.9)",
      snapToCrosshair: "boolean optional (true = move to crosshair placement)",
    },
  },
  {
    id: "GENERATE_ASSET",
    description: "Generate a new reusable asset from text in headless mode, save to library, then place it. EDIT MODE ONLY.",
    params: {
      prompt: "string (asset description)",
      placeNow: "boolean optional (default true)",
      allowMultiple: "boolean optional (default false; set true only when user explicitly asks for multiples)",
      count: "number optional (if >1, multiple generation is allowed)",
    },
  },

  // === META ===
  {
    id: "THINK",
    description: "Pause to reason about your situation. Use when stuck or need to reconsider your approach.",
    params: { thought: "string (your reasoning)" },
  },
  {
    id: "DONE",
    description: "Task is complete. Only use when you've achieved the goal.",
    params: { summary: "string (what you accomplished)" },
  },
];

export const DEFAULTS = {
  model: "gpt-4o",
  decideEverySteps: 1,
  stepMeters: 0.4,
  maxToiMeters: 50,
};
