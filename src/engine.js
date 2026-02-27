import "./style.css";

import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { AiAvatar } from "./AiAvatar.js";
import { ACTIONS as SIM_VLM_ACTIONS, DEFAULTS as SIM_VLM_DEFAULTS } from "./ai/sim/vlmActions.js";
import { buildPrompt as buildSimVlmPrompt } from "./ai/sim/vlmPrompt.js";
import { MODEL_CONFIG } from "./ai/modelConfig.js";
import { requestVlmDecision } from "./ai/vlmClient.js";
import { captureAgentPovBase64, processPendingCaptures, hasPendingCapture } from "./ai/visionCapture.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const IS_SIM_ONLY_PROFILE = true;
const ACTIVE_VLM_ACTIONS = SIM_VLM_ACTIONS;
const ACTIVE_VLM_DEFAULTS = SIM_VLM_DEFAULTS;
const buildActiveVlmPrompt = () => buildSimVlmPrompt({ actions: ACTIVE_VLM_ACTIONS });
const resolveActiveVlmModel = () => (IS_SIM_ONLY_PROFILE ? MODEL_CONFIG.simMode : MODEL_CONFIG.editorMode);

let threeRendererRef = null;
let threeSceneRef = null;
// Splat/Spark stubs — variables kept so guarded references don't crash.
// SparkJS has been removed; these are always null.
let sparkRendererMesh = null;
let sparkNeedsUpdate = false;
let splatMesh = null;
let isLoadedSplat = false;
let RAPIER = null;
let _rapierInitPromise = null;
let rapierWorld = null;
let worldBody = null;
let playerBody = null;
let playerCollider = null;
let worldTriMeshCollider = null;
let flyMode = true;
let ghostMode = false;
let voxelGrid = null; // { NX, NY, NZ, voxel, min, occ }
let characterController = null;
let _rapierStepFaultCount = 0;
let walkVerticalVel = 0;
let aiAgents = [];

// Track asset collider handles for cleanup
const _assetColliderHandles = new Map();

// Player dimensions (tuned smaller so you can fit inside tighter splat/glb interiors).
const PLAYER_RADIUS = 0.12;
const PLAYER_HALF_HEIGHT = 0.25;
const PLAYER_EYE_HEIGHT = PLAYER_HALF_HEIGHT + PLAYER_RADIUS + 0.2; // camera above body origin
const LIDAR_MOUNT_HEIGHT = 0.35; // Go2 lidar mount height above ground

const canvas = document.getElementById("c");
const fileInput = document.getElementById("file-input");
const statusEl = document.getElementById("status");
const resetBtn = document.getElementById("reset");
const modeEditBtn = null;
const modeSimBtn = null;
const overlayEl = document.getElementById("overlay");
const simPanelCollapseBtn = document.getElementById("sim-panel-collapse");
const simPanelOpenBtn = document.getElementById("sim-panel-open");
const leftPanelCollapseBtn = document.getElementById("left-panel-collapse");
const leftPanelOpenBtn = document.getElementById("left-panel-open");
const statusSimEl = document.getElementById("status-sim");
const tagPlaceBtn = document.getElementById("tag-place");
const spawnAiBtn = document.getElementById("spawn-ai");
const assetGlbInputEl = document.getElementById("asset-glb-input");
const workspaceTabSceneBtn = document.getElementById("workspace-tab-scene");
const workspaceTabAssetBuilderBtn = document.getElementById("workspace-tab-asset-builder");
const collisionGlbInputEl = document.getElementById("collision-glb-input");
const worldSelectEl = document.getElementById("world-select");
const worldLoadBtn = document.getElementById("world-load");
const editorSimLightPreviewBtn = document.getElementById("editor-sim-light-preview-btn");

// Removed old collision quality/mode elements (simplified UI)
const tagSelectedEl = document.getElementById("tag-selected");
const tagFormEl = document.getElementById("tag-form");
const tagTitleEl = document.getElementById("tag-title");
const tagNotesEl = document.getElementById("tag-notes");
const tagRadiusEl = document.getElementById("tag-radius");
const tagRadiusValueEl = document.getElementById("tag-radius-value");
const tagSaveBtn = document.getElementById("tag-save");
const tagCancelBtn = document.getElementById("tag-cancel");
const tagDeleteBtn = document.getElementById("tag-delete");
const tagsListEl = document.getElementById("tags-list");
const tagsExportBtn = document.getElementById("tags-export");
const tagsImportEl = document.getElementById("tags-import");
const assetsListEl = document.getElementById("assets-list");
const modalEl = document.getElementById("modal");
const assetTitleEl = document.getElementById("asset-title");
const assetNotesEl = document.getElementById("asset-notes");
const assetPickableEl = document.getElementById("asset-pickable");
const assetStatesContainerEl = document.getElementById("asset-states-container");
const assetAddStateBtn = document.getElementById("asset-add-state");
const assetCreateBtn = document.getElementById("asset-create");
const assetCancelBtn = document.getElementById("asset-cancel");

// Primitive / Light editor elements
const shapeDropdownToggle = document.getElementById("shape-dropdown-toggle");
const shapeDropdownMenu = document.getElementById("shape-dropdown-menu");
const lightAddBtn = document.getElementById("light-add-btn");
const primitivesListEl = document.getElementById("primitives-list");
const primPropsEl = document.getElementById("prim-props");
const primNameEl = document.getElementById("prim-name");
const primDimsContainerEl = document.getElementById("prim-dims-container");
const primColorEl = document.getElementById("prim-color");
const primRoughnessEl = document.getElementById("prim-roughness");
const primRoughnessValEl = document.getElementById("prim-roughness-val");
const primPresetPlasticBtn = document.getElementById("prim-preset-plastic");
const primPresetCeramicBtn = document.getElementById("prim-preset-ceramic");
const primPresetRubberBtn = document.getElementById("prim-preset-rubber");
const primPresetFabricBtn = document.getElementById("prim-preset-fabric");
const primPresetVelvetBtn = document.getElementById("prim-preset-velvet");
const primPresetCushionBtn = document.getElementById("prim-preset-cushion");
const primPresetLeafBtn = document.getElementById("prim-preset-leaf");
const primPresetWaterBtn = document.getElementById("prim-preset-water");
const primPresetGlassBtn = document.getElementById("prim-preset-glass");
const primPresetMirrorBtn = document.getElementById("prim-preset-mirror");
const primPresetMetalBtn = document.getElementById("prim-preset-metal");
const primPresetConcreteBtn = document.getElementById("prim-preset-concrete");
const primPresetEmissiveBtn = document.getElementById("prim-preset-emissive");
const primMetalnessEl = document.getElementById("prim-metalness");
const primMetalnessValEl = document.getElementById("prim-metalness-val");
const primHardnessEl = document.getElementById("prim-hardness");
const primHardnessValEl = document.getElementById("prim-hardness-val");
const primFluffinessEl = document.getElementById("prim-fluffiness");
const primFluffinessValEl = document.getElementById("prim-fluffiness-val");
const primSpecularIntensityEl = document.getElementById("prim-specular-intensity");
const primSpecularIntensityValEl = document.getElementById("prim-specular-intensity-val");
const primSpecularColorEl = document.getElementById("prim-specular-color");
const primEnvIntensityEl = document.getElementById("prim-env-intensity");
const primEnvIntensityValEl = document.getElementById("prim-env-intensity-val");
const primOpacityEl = document.getElementById("prim-opacity");
const primOpacityValEl = document.getElementById("prim-opacity-val");
const primTransmissionEl = document.getElementById("prim-transmission");
const primTransmissionValEl = document.getElementById("prim-transmission-val");
const primIorEl = document.getElementById("prim-ior");
const primIorValEl = document.getElementById("prim-ior-val");
const primThicknessEl = document.getElementById("prim-thickness");
const primThicknessValEl = document.getElementById("prim-thickness-val");
const primAttenuationColorEl = document.getElementById("prim-attenuation-color");
const primAttenuationDistanceEl = document.getElementById("prim-attenuation-distance");
const primAttenuationDistanceValEl = document.getElementById("prim-attenuation-distance-val");
const primIridescenceEl = document.getElementById("prim-iridescence");
const primIridescenceValEl = document.getElementById("prim-iridescence-val");
const primEmissiveColorEl = document.getElementById("prim-emissive-color");
const primEmissiveIntensityEl = document.getElementById("prim-emissive-intensity");
const primEmissiveIntensityValEl = document.getElementById("prim-emissive-intensity-val");
const primClearcoatEl = document.getElementById("prim-clearcoat");
const primClearcoatValEl = document.getElementById("prim-clearcoat-val");
const primClearcoatRoughnessEl = document.getElementById("prim-clearcoat-roughness");
const primClearcoatRoughnessValEl = document.getElementById("prim-clearcoat-roughness-val");
const primAlphaCutoffEl = document.getElementById("prim-alpha-cutoff");
const primAlphaCutoffValEl = document.getElementById("prim-alpha-cutoff-val");
const primTextureSoftnessEl = document.getElementById("prim-texture-softness");
const primTextureSoftnessValEl = document.getElementById("prim-texture-softness-val");
const primTextureHardnessEl = document.getElementById("prim-texture-hardness");
const primTextureHardnessValEl = document.getElementById("prim-texture-hardness-val");
const primUvRepeatXEl = document.getElementById("prim-uv-repeat-x");
const primUvRepeatXValEl = document.getElementById("prim-uv-repeat-x-val");
const primUvRepeatYEl = document.getElementById("prim-uv-repeat-y");
const primUvRepeatYValEl = document.getElementById("prim-uv-repeat-y-val");
const primUvOffsetXEl = document.getElementById("prim-uv-offset-x");
const primUvOffsetXValEl = document.getElementById("prim-uv-offset-x-val");
const primUvOffsetYEl = document.getElementById("prim-uv-offset-y");
const primUvOffsetYValEl = document.getElementById("prim-uv-offset-y-val");
const primUvRotationEl = document.getElementById("prim-uv-rotation");
const primUvRotationValEl = document.getElementById("prim-uv-rotation-val");
const primDoubleSidedEl = document.getElementById("prim-double-sided");
const primFlatShadingEl = document.getElementById("prim-flat-shading");
const primWireframeEl = document.getElementById("prim-wireframe");
const primTextureEl = document.getElementById("prim-texture");
const primTextureLabelEl = document.getElementById("prim-texture-label");
const primTextureClearBtn = document.getElementById("prim-texture-clear");
const primPhysicsEl = document.getElementById("prim-physics");
const primCastShadowEl = document.getElementById("prim-cast-shadow");
const primReceiveShadowEl = document.getElementById("prim-receive-shadow");
const primNotesEl = document.getElementById("prim-notes");
const primTagsInputEl = document.getElementById("prim-tags-input");
const primStateEl = document.getElementById("prim-state");
const primMetaListEl = document.getElementById("prim-meta-list");
const primMetaAddBtn = document.getElementById("prim-meta-add");
const primDuplicateBtn = document.getElementById("prim-duplicate");
const primDeleteBtn = document.getElementById("prim-delete");
const primSubtractSourceEl = document.getElementById("prim-subtract-source");
const primSubtractDeleteSourceEl = document.getElementById("prim-subtract-delete-source");
const primSubtractApplyBtn = document.getElementById("prim-subtract-apply");
const primSubtractClearBtn = document.getElementById("prim-subtract-clear");
const primSubtractCountEl = document.getElementById("prim-subtract-count");
const lightsListEl = document.getElementById("lights-list");
const lightPropsEl = document.getElementById("light-props");
const lightNameEl = document.getElementById("light-name");
const lightTypeEl = document.getElementById("light-type");
const lightColorEl = document.getElementById("light-color");
const lightIntensityEl = document.getElementById("light-intensity");
const lightIntensityValEl = document.getElementById("light-intensity-val");
const lightDistanceEl = document.getElementById("light-distance");
const lightDistanceValEl = document.getElementById("light-distance-val");
const lightDistanceGroupEl = document.getElementById("light-distance-group");
const lightSpotGroupEl = document.getElementById("light-spot-group");
const lightAngleEl = document.getElementById("light-angle");
const lightAngleValEl = document.getElementById("light-angle-val");
const lightPenumbraEl = document.getElementById("light-penumbra");
const lightPenumbraValEl = document.getElementById("light-penumbra-val");
const lightTargetXEl = document.getElementById("light-target-x");
const lightTargetYEl = document.getElementById("light-target-y");
const lightTargetZEl = document.getElementById("light-target-z");
const lightCastShadowEl = document.getElementById("light-cast-shadow");
const lightDeleteBtn = document.getElementById("light-delete");

// Scene light elements
const sceneLightsListEl = document.getElementById("scene-lights-list");
const sceneLightPropsEl = document.getElementById("scene-light-props");
const slTitleEl = document.getElementById("sl-title");
const slColorEl = document.getElementById("sl-color");
const slIntensityEl = document.getElementById("sl-intensity");
const slIntensityValEl = document.getElementById("sl-intensity-val");
const slGroundRowEl = document.getElementById("sl-ground-row");
const slGroundColorEl = document.getElementById("sl-ground-color");
const slDistanceRowEl = document.getElementById("sl-distance-row");
const slDistanceEl = document.getElementById("sl-distance");
const slDistanceValEl = document.getElementById("sl-distance-val");
const slShadowRowEl = document.getElementById("sl-shadow-row");
const slShadowEl = document.getElementById("sl-shadow");
const slEnabledEl = document.getElementById("sl-enabled");
const slSkyControlsEl = document.getElementById("sl-sky-controls");
const slSkyTopColorEl = document.getElementById("sl-sky-top-color");
const slSkyHorizonColorEl = document.getElementById("sl-sky-horizon-color");
const slSkyBottomColorEl = document.getElementById("sl-sky-bottom-color");
const slSkyBrightnessEl = document.getElementById("sl-sky-brightness");
const slSkyBrightnessValEl = document.getElementById("sl-sky-brightness-val");
const slSkySoftnessEl = document.getElementById("sl-sky-softness");
const slSkySoftnessValEl = document.getElementById("sl-sky-softness-val");
const slSkySunStrengthEl = document.getElementById("sl-sky-sun-strength");
const slSkySunStrengthValEl = document.getElementById("sl-sky-sun-strength-val");
const slSkySunHeightEl = document.getElementById("sl-sky-sun-height");
const slSkySunHeightValEl = document.getElementById("sl-sky-sun-height-val");

// Details panel + Transform XYZ elements
const detailsPanelEl = document.getElementById("details-panel");
const detailsTitleEl = document.getElementById("details-title");
const assetDetailsEl = document.getElementById("asset-details");
const xformPxEl = document.getElementById("xform-px");
const xformPyEl = document.getElementById("xform-py");
const xformPzEl = document.getElementById("xform-pz");
const xformRxEl = document.getElementById("xform-rx");
const xformRyEl = document.getElementById("xform-ry");
const xformRzEl = document.getElementById("xform-rz");
const xformSxEl = document.getElementById("xform-sx");
const xformSyEl = document.getElementById("xform-sy");
const xformSzEl = document.getElementById("xform-sz");
const olTagsCountEl = document.getElementById("ol-tags-count");
const olAssetsCountEl = document.getElementById("ol-assets-count");
const olPrimsCountEl = document.getElementById("ol-prims-count");
const olLightsCountEl = document.getElementById("ol-lights-count");

// Portal elements
const portalCreateBtn = document.getElementById("portal-create-btn");
const portalModal = document.getElementById("portal-modal");
const portalTitleEl = document.getElementById("portal-title");
const portalDestinationEl = document.getElementById("portal-destination");
const portalCreateConfirmBtn = document.getElementById("portal-create-confirm");
const portalCancelBtn = document.getElementById("portal-cancel");
const portalExitModal = document.getElementById("portal-exit-modal");
const portalExitWorldNameEl = document.getElementById("portal-exit-world-name");
const portalExitPlaceBtn = document.getElementById("portal-exit-place");
const portalExitSkipBtn = document.getElementById("portal-exit-skip");

// Portal loading screen elements
const portalLoadingEl = document.getElementById("portal-loading");
const portalLoadingTitleEl = document.getElementById("portal-loading-title");
const portalLoadingDestEl = document.getElementById("portal-loading-dest");

// Portal creation state
let pendingPortalLink = null; // { entranceId, entranceWorldId, destinationWorldId, title }

// Portal loading screen functions
function showPortalLoading(destinationName, message = "Traveling through portal...") {
  if (portalLoadingTitleEl) portalLoadingTitleEl.textContent = message;
  if (portalLoadingDestEl) portalLoadingDestEl.textContent = destinationName;
  if (portalLoadingEl) {
    portalLoadingEl.classList.remove("hidden", "fade-out");
  }
}

function hidePortalLoading() {
  if (portalLoadingEl) {
    portalLoadingEl.classList.add("fade-out");
    setTimeout(() => {
      portalLoadingEl.classList.add("hidden");
    }, 500);
  }
}
const assetInteractActionEl = document.getElementById("asset-interact-action");
const assetInteractSelectedBtn = document.getElementById("asset-interact-selected");
const assetEditStatesSelectedBtn = document.getElementById("asset-edit-states-selected");
const assetDuplicateSelectedBtn = document.getElementById("asset-duplicate-selected");
const assetCastShadowEl = document.getElementById("asset-cast-shadow");
const assetReceiveShadowEl = document.getElementById("asset-receive-shadow");
const assetSelectedPickableEl = document.getElementById("asset-selected-pickable");
const assetBumpableEl = document.getElementById("asset-bumpable");
const assetBumpControlsEl = document.getElementById("asset-bump-controls");
const assetBumpResponseEl = document.getElementById("asset-bump-response");
const assetBumpResponseValEl = document.getElementById("asset-bump-response-val");
const assetBumpDampingEl = document.getElementById("asset-bump-damping");
const assetBumpDampingValEl = document.getElementById("asset-bump-damping-val");
const blobShadowControlsEl = document.getElementById("blob-shadow-controls");
const blobShadowOpacityEl = document.getElementById("blob-shadow-opacity");
const blobShadowOpacityValEl = document.getElementById("blob-shadow-opacity-val");
const blobShadowScaleEl = document.getElementById("blob-shadow-scale");
const blobShadowScaleValEl = document.getElementById("blob-shadow-scale-val");
const blobShadowStretchEl = document.getElementById("blob-shadow-stretch");
const blobShadowStretchValEl = document.getElementById("blob-shadow-stretch-val");
const blobShadowRotEl = document.getElementById("blob-shadow-rot");
const blobShadowRotValEl = document.getElementById("blob-shadow-rot-val");
const blobShadowOxEl = document.getElementById("blob-shadow-ox");
const blobShadowOyEl = document.getElementById("blob-shadow-oy");
const blobShadowOzEl = document.getElementById("blob-shadow-oz");
const assetDeleteSelectedBtn = document.getElementById("asset-delete-selected");
const assetToolMoveBtn = document.getElementById("asset-tool-move");
const assetToolRotateBtn = document.getElementById("asset-tool-rotate");
const assetToolScaleBtn = document.getElementById("asset-tool-scale");
const builderStateEditorEl = document.getElementById("builder-state-editor");
const agentPanelEl = document.getElementById("agent-panel");
const agentLastEl = document.getElementById("agent-last");
const agentObservationEl = document.getElementById("agent-observation");
const agentShotImgEl = document.getElementById("agent-shot-img");
const agentReqMetaEl = document.getElementById("agent-req-meta");
const agentReqPromptEl = document.getElementById("agent-req-prompt");
const agentReqContextEl = document.getElementById("agent-req-context");
const agentRespRawEl = document.getElementById("agent-resp-raw");
const agentLogEl = document.getElementById("agent-log");
const agentTaskStatusEl = document.getElementById("agent-task-status");
const agentTaskInputEl = document.getElementById("agent-task-input");
const agentTaskStartBtn = document.getElementById("agent-task-start");
const agentTaskEndBtn = document.getElementById("agent-task-end");
const simCameraModeToggleBtn = document.getElementById("sim-camera-toggle");
const simViewRgbdBtn = document.getElementById("sim-view-rgbd");
const simViewLidarBtn = document.getElementById("sim-view-lidar");
const simViewCompareBtn = document.getElementById("sim-view-compare");
const simRgbdGrayBtn = document.getElementById("sim-rgbd-gray");
const simRgbdColormapBtn = document.getElementById("sim-rgbd-colormap");
const simRgbdAutoRangeBtn = document.getElementById("sim-rgbd-auto-range");
const simRgbdNoiseBtn = document.getElementById("sim-rgbd-noise");
const simRgbdSpeckleBtn = document.getElementById("sim-rgbd-speckle");
const simRgbdMinEl = document.getElementById("sim-rgbd-min");
const simRgbdMaxEl = document.getElementById("sim-rgbd-max");
const simRgbdMinValEl = document.getElementById("sim-rgbd-min-val");
const simRgbdMaxValEl = document.getElementById("sim-rgbd-max-val");
const simRgbdPcOverlayBtn = document.getElementById("sim-rgbd-pc-overlay");
const simLidarColorRangeBtn = document.getElementById("sim-lidar-color-range");
const simLidarOrderedDebugBtn = document.getElementById("sim-lidar-ordered-debug");
const simLidarNoiseBtn = document.getElementById("sim-lidar-noise");
const simLidarMultiReturnBtn = document.getElementById("sim-lidar-multireturn");

// Tagging / annotation state
const HAS_EDITOR_PANEL = !!document.getElementById("tag-panel");
const HAS_SIM_PANEL = !!document.getElementById("agent-panel");
let appMode = HAS_EDITOR_PANEL ? (localStorage.getItem("sparkWorldMode") ?? "sim") : "sim"; // "sim" | "edit"
const isStagingEditor = new URLSearchParams(window.location.search).get("staging") === "1";
// ── dimos integration mode ──────────────────────────────────────────────────
// Activated via ?dimos=1 URL param or window.__dimosMode (injected by Deno bridge server).
// When active: internal VLM loop disabled, agent pose driven by external /odom,
// sensor data (RGB, depth, LiDAR) published as LCM packets via WebSocket bridge.
const _dimosParams = new URLSearchParams(window.location.search);
const dimosMode = _dimosParams.get("dimos") === "1" || window.__dimosMode === true;
const dimosScene = _dimosParams.get("scene") || window.__dimosScene || null;
let currentWorkspace = "scene"; // "scene" | "assetBuilder"
const workspaceSnapshots = { scene: null, assetBuilder: null };
const ASSET_LIBRARY_KEY = "sparkWorldAssetLibrary";
let builderEditingAssetId = null;
let builderEditingStateId = null;
let builderShowTypeChoice = false;
let builderPrimarySaveBtn = null;
let assetLibraryRuntimeCache = null;
let assetBuilderGrid = null;
let simSensorViewMode = "rgb"; // "rgb" | "rgbd" | "lidar"
let simCompareView = false; // show RGB + RGB-D + LiDAR side-by-side
let simPanelCollapsed = false;
let simUserCameraMode = localStorage.getItem("sparkWorldSimCameraMode") === "user" ? "user" : "agent";
let editorSimLightingPreview = localStorage.getItem("sparkWorldEditorSimPreview") === "1";
let _placementGhostLastUpdate = 0;
let rgbdVizMode = "colormap"; // "colormap" | "gray"
let rgbdAutoRange = true;
let rgbdRangeMinM = 0.2;
let rgbdRangeMaxM = 12.0;
let rgbdNoiseEnabled = false;
let rgbdSpeckleEnabled = false;
let rgbdPcOverlayOnLidar = false;
let lidarColorByRange = false; // false = intensity grayscale (realistic default)
let lidarOrderedDebugView = false; // false=unordered 3D cloud, true=ordered rings debug
let lidarNoiseEnabled = false; // deterministic range noise + dropouts
let lidarMultiReturnMode = "strongest"; // "strongest" | "last"
let worldKey = localStorage.getItem("sparkWorldLastWorldKey") ?? "default";

function clampNum(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function normalizeHexColor(value, fallback) {
  try {
    return `#${new THREE.Color(value).getHexString()}`;
  } catch {
    return fallback;
  }
}

function createDefaultSceneSettings() {
  return {
    sky: {
      enabled: false,
      topColor: "#7aa9ff",
      horizonColor: "#cfe5ff",
      bottomColor: "#f4f8ff",
      brightness: 1.0,
      softness: 1.35,
      sunStrength: 0.18,
      sunHeight: 0.45,
    },
  };
}

function normalizeSceneSettings(raw) {
  const defaults = createDefaultSceneSettings();
  const src = raw && typeof raw === "object" ? raw : {};
  const srcSky = src.sky && typeof src.sky === "object" ? src.sky : {};
  return {
    sky: {
      enabled: !!srcSky.enabled,
      topColor: normalizeHexColor(srcSky.topColor, defaults.sky.topColor),
      horizonColor: normalizeHexColor(srcSky.horizonColor, defaults.sky.horizonColor),
      bottomColor: normalizeHexColor(srcSky.bottomColor, defaults.sky.bottomColor),
      brightness: clampNum(srcSky.brightness, 0.2, 2.0),
      softness: clampNum(srcSky.softness, 0.2, 3.0),
      sunStrength: clampNum(srcSky.sunStrength, 0.0, 1.0),
      sunHeight: clampNum(srcSky.sunHeight, -0.2, 1.0),
    },
  };
}

function serializeSceneSettings() {
  return normalizeSceneSettings(sceneSettings);
}

let sceneSettings = createDefaultSceneSettings();
let tags = [];
let selectedTagId = null;
let draftTag = null; // tag being edited/created
const tagsGroup = new THREE.Group();
tagsGroup.name = "tagsGroup";

// Assets (Edit mode)
let assets = []; // [{id,title,notes,states:[{id,name,glbName,dataBase64,interactions:[{id,label,to}]}],currentStateId,actions:[{id,label,from,to}],transform:{...}, _colliderHandle?}]
let selectedAssetId = null;
let pendingAssetUpload = null; // { states:[{id,name,glbName,dataBase64,interactions:[...]}], currentStateId }
const assetsGroup = new THREE.Group();
assetsGroup.name = "assetsGroup";
let transformControls = null;
let grid = null;
const gltfLoader = new GLTFLoader();

// =============================================================================
// BLOB SHADOW – lightweight planar shadow for GLB assets (no shadow maps needed)
// =============================================================================
// Procedural radial-gradient texture (created once, shared by all blob shadows)
let _blobShadowTexture = null;
let _blobShadowGeometry = null;

function getBlobShadowTexture() {
  if (_blobShadowTexture) return _blobShadowTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  // Use a GRAYSCALE gradient: white = opaque shadow, black = transparent.
  // This texture will be used as an alphaMap (only the luminance/R channel matters).
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "#ffffff");     // center: fully opaque
  gradient.addColorStop(0.35, "#cccccc");
  gradient.addColorStop(0.65, "#444444");
  gradient.addColorStop(1, "#000000");      // edge: fully transparent
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  _blobShadowTexture = new THREE.CanvasTexture(canvas);
  _blobShadowTexture.needsUpdate = true;
  return _blobShadowTexture;
}

function getBlobShadowGeometry() {
  if (_blobShadowGeometry) return _blobShadowGeometry;
  _blobShadowGeometry = new THREE.PlaneGeometry(1, 1);
  // Rotate so the plane lies flat on the XZ ground plane (face up)
  _blobShadowGeometry.rotateX(-Math.PI / 2);
  return _blobShadowGeometry;
}

// Create a blob shadow mesh sized to an asset's footprint.
// Returns a Mesh that should be added as a child of the asset root.
// `opts` = { opacity, scale, stretch, rotationDeg, offsetX, offsetY, offsetZ }
function createBlobShadow(assetId, footprintX, footprintZ, localGroundY, opts) {
  const o = opts || {};
  const userScale = o.scale ?? 1.0;
  const userOpacity = o.opacity ?? 0.5;
  const stretch = o.stretch ?? 1.0;     // >1 elongates X, <1 elongates Z
  const rotDeg = o.rotationDeg ?? 0;    // rotation around Y in degrees
  const offsetX = o.offsetX ?? 0;
  const offsetY = o.offsetY ?? 0;
  const offsetZ = o.offsetZ ?? 0;

  // Base diameter from asset footprint, then apply user scale
  const baseDiameter = Math.max(footprintX, footprintZ) * 1.1;
  const d = baseDiameter * userScale;
  if (d < 0.04) return null;

  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    alphaMap: getBlobShadowTexture(),
    transparent: true,
    depthWrite: false,
    depthTest: true,
    opacity: userOpacity,
    side: THREE.DoubleSide,
    // Use ONLY constant depth bias. Slope-based factor causes the blob to
    // appear to slide as the camera angle changes while moving.
    polygonOffset: true,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: -300,
  });
  const mesh = new THREE.Mesh(getBlobShadowGeometry(), mat);
  // stretch > 1 makes the X axis wider; Z axis is inversely narrower to
  // keep the overall area roughly constant.
  const sx = d * stretch;
  const sz = d / stretch;
  mesh.scale.set(sx, 1, sz);
  // Raise slightly so it stays on/just above floor.
  mesh.position.set(offsetX, localGroundY + 0.08 + offsetY, offsetZ);
  // The shared geometry is already rotated to lie on XZ. An additional Y
  // rotation spins the ellipse around the vertical axis.
  mesh.rotation.y = (rotDeg * Math.PI) / 180;
  mesh.renderOrder = 1000;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.name = `blobShadow:${assetId}`;
  mesh.userData.isBlobShadow = true;
  mesh.userData._baseDiameter = baseDiameter;
  mesh.userData._baseLocalY = localGroundY + 0.08;
  return mesh;
}

// =============================================================================
// PRIMITIVES (Level Editor) – lightweight parametric shapes
// =============================================================================
let primitives = []; // [{id, type, name, dimensions:{...}, transform:{position,rotation,scale}, material:{color,roughness,metalness,textureDataUrl}, physics:bool, _colliderHandle?}]
let selectedPrimitiveId = null;
let groups = []; // [{id, name, children: [primId...]}]
let collapsedGroupIds = new Set();
let selectedGroupId = null;
let multiSelectedPrimIds = new Set(); // for shift+click multi-select → grouping
let groupSelectionMode = false; // checkbox-driven grouping mode (no keyboard required)
let groupPivot = null;        // THREE.Object3D pivot for group transform
let groupChildMeshes = [];    // meshes currently reparented to groupPivot
const _assetBumpVelocities = new Map(); // assetId -> THREE.Vector3
const _playerPosPrevForBump = new THREE.Vector3();
let _playerPosPrevForBumpValid = false;
const _agentPosPrevForBump = new Map(); // agentId -> THREE.Vector3
let _lastBumpSaveAt = 0;
let _lastBumpColliderSyncAt = 0;
const primitivesGroup = new THREE.Group();
primitivesGroup.name = "primitivesGroup";

const PRIMITIVE_DEFAULTS = {
  box: {
    width: 1,
    height: 1,
    depth: 1,
    edgeRadius: 0,
    edgeSegments: 4,
    widthSegments: 1,
    heightSegments: 1,
    depthSegments: 1,
  },
  sphere: {
    radius: 0.5,
    widthSegments: 32,
    heightSegments: 16,
    phiStartDeg: 0,
    phiLengthDeg: 360,
    thetaStartDeg: 0,
    thetaLengthDeg: 180,
  },
  cylinder: { radiusTop: 0.5, radiusBottom: 0.5, height: 1, radialSegments: 32, heightSegments: 1, openEnded: 0 },
  cone: { radius: 0.5, height: 1, radialSegments: 32, heightSegments: 1, openEnded: 0 },
  torus: { radius: 0.5, tube: 0.15, radialSegments: 16, tubularSegments: 48, arcDeg: 360 },
  plane: { width: 2, height: 2, widthSegments: 1, heightSegments: 1 },
};

const PRIMITIVE_DIM_CONFIG = {
  width: { min: 0.05, max: 50, step: 0.05 },
  height: { min: 0.05, max: 50, step: 0.05 },
  depth: { min: 0.05, max: 50, step: 0.05 },
  radius: { min: 0.01, max: 20, step: 0.01 },
  radiusTop: { min: 0.01, max: 20, step: 0.01 },
  radiusBottom: { min: 0.01, max: 20, step: 0.01 },
  tube: { min: 0.01, max: 10, step: 0.01 },
  edgeRadius: { min: 0, max: 2.5, step: 0.01 },
  edgeSegments: { min: 1, max: 12, step: 1, integer: true },
  widthSegments: { min: 1, max: 128, step: 1, integer: true },
  heightSegments: { min: 1, max: 128, step: 1, integer: true },
  depthSegments: { min: 1, max: 128, step: 1, integer: true },
  radialSegments: { min: 3, max: 128, step: 1, integer: true },
  tubularSegments: { min: 3, max: 256, step: 1, integer: true },
  phiStartDeg: { min: 0, max: 360, step: 1 },
  phiLengthDeg: { min: 1, max: 360, step: 1 },
  thetaStartDeg: { min: 0, max: 180, step: 1 },
  thetaLengthDeg: { min: 1, max: 180, step: 1 },
  arcDeg: { min: 1, max: 360, step: 1 },
  openEnded: { min: 0, max: 1, step: 1, integer: true },
};

function formatPrimitiveDimValue(key, value) {
  if (PRIMITIVE_DIM_CONFIG[key]?.integer) return String(Math.round(value));
  if (key.endsWith("Deg")) return `${Math.round(value)}°`;
  if (key === "openEnded") return value >= 0.5 ? "Yes" : "No";
  return Number(value).toFixed(2);
}

const PRIMITIVE_DIM_LABELS = {
  edgeRadius: "Roundness",
  edgeSegments: "Round Detail",
  widthSegments: "Detail X",
  heightSegments: "Detail Y",
  depthSegments: "Detail Z",
  radialSegments: "Circle Detail",
  tubularSegments: "Ring Detail",
  phiStartDeg: "Horizontal Cut Start",
  phiLengthDeg: "Horizontal Fill",
  thetaStartDeg: "Vertical Cut Start",
  thetaLengthDeg: "Vertical Fill",
  arcDeg: "Ring Opening",
  openEnded: "Open Ends",
  radiusTop: "Top Radius",
  radiusBottom: "Bottom Radius",
};

function getPrimitiveDimLabel(key) {
  return PRIMITIVE_DIM_LABELS[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
}

// =============================================================================
// EDITOR LIGHTS – user-placed lights with full control
// =============================================================================
let editorLights = []; // [{id, type, name, color, intensity, position:{x,y,z}, target:{x,y,z}, distance, angle, penumbra, castShadow, _lightObj?, _helperObj?}]
let selectedLightId = null;
const lightsGroup = new THREE.Group();
lightsGroup.name = "lightsGroup";
const _assetRaycaster = new THREE.Raycaster();
const _agentAssetRaycaster = new THREE.Raycaster();
const _tmpV1 = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();
const _tmpV3 = new THREE.Vector3();

// Agent camera follow mode (first-person POV)
let agentCameraFollow = false;
let _agentFollowInitialized = false;

// Agent task state — per-agent tasks for parallel execution.
let agentTask = {
  active: false,
  instruction: "",
  startedAt: 0,
  finishedAt: 0,
  finishedReason: "",
  lastSummary: "",
};
const _agentTasks = new Map(); // agentId -> { active, instruction, startedAt, finishedAt, finishedReason, lastSummary }

function _getAgentTask(agentId) {
  return _agentTasks.get(agentId) || agentTask;
}

function _setAgentTask(agentId, task) {
  _agentTasks.set(agentId, task);
  // Keep global agentTask in sync with the most recent active task (for UI compat)
  if (task.active) {
    agentTask = { ...task };
  }
}
let selectedAgentInspectorId = null;
const agentInspectorStateById = new Map(); // id -> { shot, request, response }
let agentCameraFollowId = null;
let agentUiSelectedLabelEl = null;
let agentUiSpawnBtn = null;
let agentUiFollowBtn = null;
let agentUiStopBtn = null;
let agentUiRemoveBtn = null;
let agentUiTaskInputEl = null;
let agentUiTaskRunBtn = null;
let agentTaskTargetId = null;
let vibeCreatorApi = null;
let agentBadgeLayerEl = null;
const agentBadgeElsById = new Map();
const EDITOR_TASK_WORKER_TARGET = 1;
const EDITOR_MAX_AGENT_COUNT = 4;

// Collision settings (simplified - always use GLB TriMesh)
const collisionSettings = {
  mode: "glb-trimesh",
  quality: 65, // Legacy: only used if voxel fallback is needed
};

// =============================================================================
// WORLD MANIFEST & LOADING
// =============================================================================
// Each world folder in /public/worlds/ should contain:
//   - A .ply file (splats)
//   - A .glb file (collision)
//   - A .json file (tags/assets)
const WORLDS_MANIFEST = [
  {
    id: "empty-room",
    name: "Empty Room",
    folder: "/worlds/empty-room",
    splatFile: "room.ply",
    colliderFile: "room_collider.glb",
    dataFile: "spark-world-tags-room_ply.json",
  },
  {
    id: "garden",
    name: "Garden",
    folder: "/worlds/garden",
    splatFile: "splats.ply",
    colliderFile: "collider.glb",
    dataFile: "spark-world-tags-splats_ply.json",
  },
];

// Populate world selector dropdown
function populateWorldSelector() {
  if (!worldSelectEl) return;
  worldSelectEl.innerHTML = '<option value="">— Select World —</option>';
  for (const w of WORLDS_MANIFEST) {
    const opt = document.createElement("option");
    opt.value = w.id;
    opt.textContent = w.name;
    worldSelectEl.appendChild(opt);
  }
}
populateWorldSelector();

// Helper to normalize asset schema (backward compat)
// This function ensures all asset properties are properly loaded including states, interactions, and actions
function normalizeAssetSchema(raw) {
  // Ensure states exist
  if (!raw.states || raw.states.length === 0) {
    raw.states = [{
      id: crypto.randomUUID(),
      name: "default",
      glbName: raw.glbName || "",
      dataBase64: raw.dataBase64 || "",
      interactions: [],
    }];
    raw.currentStateId = raw.states[0].id;
  }
  
  // Ensure each state has interactions array
  for (const state of raw.states) {
    if (!Array.isArray(state.interactions)) {
      state.interactions = [];
    }
  }
  
  // Build the normalized asset object
  const normalized = {
    id: raw.id ?? crypto.randomUUID(),
    title: raw.title ?? "",
    notes: raw.notes ?? "",
    states: raw.states,
    currentStateId: raw.currentStateId ?? raw.states[0]?.id,
    actions: [], // Will be populated below
    transform: raw.transform ?? { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    pickable: raw.pickable ?? false, // Can be picked up and moved
    castShadow: raw.castShadow ?? false,
    receiveShadow: raw.receiveShadow ?? false,
    blobShadow: raw.blobShadow ?? null, // { opacity, scale, stretch, rotationDeg, offsetX, offsetY, offsetZ }
    // Portal properties
    isPortal: raw.isPortal ?? false,
    destinationWorld: raw.destinationWorld ?? null,
    linkedPortalId: raw.linkedPortalId ?? null,
    linkedPortalPosition: raw.linkedPortalPosition ?? null,
  };
  
  // Copy actions if they exist in raw data
  if (Array.isArray(raw.actions) && raw.actions.length > 0) {
    normalized.actions = raw.actions.map(act => ({
      id: act.id,
      label: act.label || "toggle",
      from: act.from,
      to: act.to,
    }));
  } else {
    // Backfill actions from state interactions if no actions array exists
    for (const state of normalized.states) {
      for (const interaction of state.interactions || []) {
        if (interaction.to && interaction.to !== state.id) {
          normalized.actions.push({
            id: interaction.id || `act_${state.id}_${interaction.to}`,
            label: interaction.label || "toggle",
            from: state.id,
            to: interaction.to,
          });
        }
      }
    }
  }
  
  // Also backfill interactions from actions if any state is missing them
  if (normalized.actions.length > 0) {
    const actionsByFrom = new Map();
    for (const act of normalized.actions) {
      if (!actionsByFrom.has(act.from)) actionsByFrom.set(act.from, []);
      actionsByFrom.get(act.from).push({ id: act.id, label: act.label, to: act.to });
    }
    for (const state of normalized.states) {
      if (!state.interactions || state.interactions.length === 0) {
        state.interactions = actionsByFrom.get(state.id) || [];
      }
    }
  }
  
  return normalized;
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  // SparkRenderer docs recommend antialias:false for splats (MSAA doesn't help splats and can hurt)
  antialias: false,
  powerPreference: "high-performance",
  // Required for reading pixels from the canvas (agent POV capture)
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

// Shadows: OFF by default. Enabled dynamically only when a light actually casts shadows.
// BasicShadowMap is fully deterministic (no PCF/stochastic filtering).
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.BasicShadowMap;
renderer.shadowMap.autoUpdate = false; // we control when shadow maps update

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06070a);

// Image-based lighting for PBR GLBs. This dramatically improves "too dark" assets.
try {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
} catch {
  // ignore
}

// Make renderer/scene available to SparkRenderer initialization after dynamic import.
threeRendererRef = renderer;
threeSceneRef = scene;

const camera = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  0.05,
  2000
);
camera.position.set(0, 1.7, 4);

// Lighting for non-splat geometry (assets/avatars).
// Splats are mostly self-lit visually; GLB assets need strong, stable fill to avoid looking black.
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
scene.add(ambientLight);

const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 0.85);
hemi.position.set(0, 10, 0);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 1.6);
dir.position.set(8, 14, 6);
dir.castShadow = false; // off by default; user enables via Scene Lighting panel
dir.shadow.mapSize.width = 512;
dir.shadow.mapSize.height = 512;
dir.shadow.camera.near = 0.5;
dir.shadow.camera.far = 40;
dir.shadow.camera.left = -15;
dir.shadow.camera.right = 15;
dir.shadow.camera.top = 15;
dir.shadow.camera.bottom = -15;
dir.shadow.bias = -0.003;
scene.add(dir);

// Headlamp-style light attached to the camera so assets are visible wherever they are placed.
const headLamp = new THREE.PointLight(0xffffff, 1.4, 26, 1.5);
headLamp.position.set(0, 1.0, 0.6);
camera.add(headLamp);

// Lightweight procedural sky dome (single draw call). This is intentionally
// simple so it remains cheap for scale/headless workloads.
const skyUniforms = {
  uTop: { value: new THREE.Color("#7aa9ff") },
  uHorizon: { value: new THREE.Color("#cfe5ff") },
  uBottom: { value: new THREE.Color("#f4f8ff") },
  uBrightness: { value: 1.0 },
  uSoftness: { value: 1.35 },
  uSunStrength: { value: 0.18 },
  uSunDir: { value: new THREE.Vector3(0, 0.45, -1).normalize() },
};
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(220, 24, 16),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(worldPos.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldDir;
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uBottom;
      uniform float uBrightness;
      uniform float uSoftness;
      uniform float uSunStrength;
      uniform vec3 uSunDir;
      void main() {
        float h = clamp(vWorldDir.y * 0.5 + 0.5, 0.0, 1.0);
        float shaped = pow(h, max(0.15, uSoftness));
        vec3 col = mix(uBottom, uHorizon, smoothstep(0.0, 0.55, shaped));
        col = mix(col, uTop, smoothstep(0.45, 1.0, shaped));
        float sun = pow(max(dot(normalize(vWorldDir), normalize(uSunDir)), 0.0), 220.0);
        col += vec3(1.0, 0.92, 0.78) * sun * uSunStrength;
        gl_FragColor = vec4(col * uBrightness, 1.0);
      }
    `,
  })
);
skyDome.frustumCulled = false;
skyDome.renderOrder = -1000;
skyDome.visible = false;
scene.add(skyDome);

// Registry of built-in scene lights so the editor can expose them
const sceneLights = [
  { id: "_ambient",  label: "Ambient",     obj: ambientLight, type: "ambient" },
  { id: "_hemi",     label: "Hemisphere",   obj: hemi,         type: "hemisphere" },
  { id: "_dir",      label: "Directional",  obj: dir,          type: "directional" },
  { id: "_headlamp", label: "Head Lamp",    obj: headLamp,     type: "point" },
  { id: "_sky",      label: "Sky",          obj: skyDome,      type: "sky" },
];
scene.add(camera);

// Avatar: simple capsule that follows the first-person camera.
const avatar = new THREE.Mesh(
  new THREE.CapsuleGeometry(PLAYER_RADIUS * 0.8, PLAYER_HALF_HEIGHT * 2.0, 6, 12),
  new THREE.MeshStandardMaterial({ color: 0x7cc4ff, roughness: 0.5 })
);
avatar.castShadow = false;
avatar.receiveShadow = false;
avatar.visible = false; // always hidden; physics capsule handles collision
scene.add(avatar);
scene.add(tagsGroup);
scene.add(assetsGroup);
scene.add(primitivesGroup);
scene.add(lightsGroup);

// Placement ghost preview (edit mode): shows where new objects/assets will spawn.
const placementGhostGroup = new THREE.Group();
placementGhostGroup.name = "placementGhost";
placementGhostGroup.visible = false;
const placementGhostRingMat = new THREE.MeshBasicMaterial({
  color: 0x6ee7b7,
  transparent: true,
  opacity: 0.55,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const placementGhostRing = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.12, 32), placementGhostRingMat);
placementGhostGroup.add(placementGhostRing);
const placementGhostDot = new THREE.Mesh(
  new THREE.SphereGeometry(0.03, 10, 8),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false })
);
placementGhostGroup.add(placementGhostDot);
const placementGhostLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0.35)]),
  new THREE.LineBasicMaterial({ color: 0x6ee7b7, transparent: true, opacity: 0.9, depthWrite: false })
);
placementGhostGroup.add(placementGhostLine);
scene.add(placementGhostGroup);

// -----------------------------------------------------------------------------
// Sim sensor view modes (deterministic + lightweight)
// -----------------------------------------------------------------------------
const DEFAULT_SCENE_BG = new THREE.Color(0x06070a);
const RGBD_BG = new THREE.Color(0x000000);
function applySceneSkySettings() {
  const s = normalizeSceneSettings(sceneSettings).sky;
  sceneSettings.sky = s;
  skyUniforms.uTop.value.set(s.topColor);
  skyUniforms.uHorizon.value.set(s.horizonColor);
  skyUniforms.uBottom.value.set(s.bottomColor);
  skyUniforms.uBrightness.value = s.brightness;
  skyUniforms.uSoftness.value = s.softness;
  skyUniforms.uSunStrength.value = s.sunStrength;
  skyUniforms.uSunDir.value.set(0, s.sunHeight, -1).normalize();
}
function applySceneRgbBackground() {
  if (sceneSettings.sky.enabled) {
    skyDome.visible = true;
    scene.background = null;
  } else {
    skyDome.visible = false;
    scene.background = DEFAULT_SCENE_BG;
  }
}
applySceneSkySettings();
// RGB-D visualization range tuned for indoor robotics scenes (meters).
const RGBD_MIN_DEPTH_M = 0.2;
const RGBD_MAX_DEPTH_M = 12.0;
const RGBD_AUTO_PERCENTILE_LOW = 0.05;
const RGBD_AUTO_PERCENTILE_HIGH = 0.95;
const RGBD_AUTO_RANGE_UPDATE_MS = 250;
const RGBD_AUTO_RANGE_SMOOTH = 0.2;
const RGBD_CLEAR_ALPHA = 1.0;
rgbdRangeMinM = RGBD_MIN_DEPTH_M;
rgbdRangeMaxM = RGBD_MAX_DEPTH_M;
const _rgbdSize = new THREE.Vector2(
  Math.max(1, Math.floor(window.innerWidth * renderer.getPixelRatio())),
  Math.max(1, Math.floor(window.innerHeight * renderer.getPixelRatio()))
);
const rgbdDepthTarget = new THREE.WebGLRenderTarget(_rgbdSize.x, _rgbdSize.y, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
  depthBuffer: true,
  stencilBuffer: false,
});
rgbdDepthTarget.texture.generateMipmaps = false;
rgbdDepthTarget.depthTexture = new THREE.DepthTexture(_rgbdSize.x, _rgbdSize.y, THREE.UnsignedIntType);
rgbdDepthTarget.depthTexture.minFilter = THREE.NearestFilter;
rgbdDepthTarget.depthTexture.magFilter = THREE.NearestFilter;
rgbdDepthTarget.depthTexture.generateMipmaps = false;
const RGBD_PC_OVERLAY_RT_W = 192;
const RGBD_PC_OVERLAY_RT_H = 108;
const rgbdOverlayDepthTarget = new THREE.WebGLRenderTarget(RGBD_PC_OVERLAY_RT_W, RGBD_PC_OVERLAY_RT_H, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
  depthBuffer: true,
  stencilBuffer: false,
});
rgbdOverlayDepthTarget.texture.generateMipmaps = false;
rgbdOverlayDepthTarget.depthTexture = new THREE.DepthTexture(RGBD_PC_OVERLAY_RT_W, RGBD_PC_OVERLAY_RT_H, THREE.UnsignedIntType);
rgbdOverlayDepthTarget.depthTexture.minFilter = THREE.NearestFilter;
rgbdOverlayDepthTarget.depthTexture.magFilter = THREE.NearestFilter;
rgbdOverlayDepthTarget.depthTexture.generateMipmaps = false;

// RGB-D debug material (planar forward-axis depth from view-space z).
// Kept only for debugging and no longer used as default RGB-D output.
const rgbdPlanarDepthDebugMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uMinDepth: { value: RGBD_MIN_DEPTH_M },
    uMaxDepth: { value: RGBD_MAX_DEPTH_M },
  },
  vertexShader: `
    varying float vLinearDepth;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vLinearDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    varying float vLinearDepth;
    uniform float uMinDepth;
    uniform float uMaxDepth;
    void main() {
      // Blend linear + inverse depth for strong near-range sensitivity while
      // preserving metric ordering (deterministic, no auto-exposure).
      float d = clamp(vLinearDepth, uMinDepth, uMaxDepth);
      float lin = (d - uMinDepth) / max(0.0001, (uMaxDepth - uMinDepth)); // 0 near, 1 far
      float inv = (1.0 / d - 1.0 / uMaxDepth) / max(0.0001, (1.0 / uMinDepth - 1.0 / uMaxDepth)); // 1 near, 0 far
      float t = clamp(0.35 * (1.0 - lin) + 0.65 * inv, 0.0, 1.0); // near -> 1, far -> 0

      // High-contrast pseudo-color ramp (near cyan/green, far orange/red)
      vec3 nearC = vec3(0.05, 0.98, 0.98);
      vec3 midC  = vec3(0.40, 0.95, 0.10);
      vec3 farC  = vec3(0.98, 0.15, 0.05);
      vec3 c = (t > 0.5) ? mix(midC, nearC, (t - 0.5) * 2.0) : mix(farC, midC, t * 2.0);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
});
rgbdPlanarDepthDebugMaterial.toneMapped = false;

// Fullscreen passes:
// 1) reconstruct metric camera-space Z into a float render target
// 2) visualize that metric depth for display
const rgbdPostCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const rgbdMetricUsesR32F = renderer.capabilities.isWebGL2 && !!renderer.extensions.get("EXT_color_buffer_float");
const rgbdMetricTargetType = rgbdMetricUsesR32F ? THREE.FloatType : THREE.HalfFloatType;
const rgbdMetricTarget = new THREE.WebGLRenderTarget(_rgbdSize.x, _rgbdSize.y, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  format: rgbdMetricUsesR32F ? THREE.RedFormat : THREE.RGBAFormat,
  type: rgbdMetricTargetType,
  depthBuffer: false,
  stencilBuffer: false,
});
if (rgbdMetricUsesR32F) rgbdMetricTarget.texture.internalFormat = "R32F";
rgbdMetricTarget.texture.generateMipmaps = false;
const rgbdOverlayMetricTarget = new THREE.WebGLRenderTarget(RGBD_PC_OVERLAY_RT_W, RGBD_PC_OVERLAY_RT_H, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  format: rgbdMetricUsesR32F ? THREE.RedFormat : THREE.RGBAFormat,
  type: rgbdMetricTargetType,
  depthBuffer: false,
  stencilBuffer: false,
});
if (rgbdMetricUsesR32F) rgbdOverlayMetricTarget.texture.internalFormat = "R32F";
rgbdOverlayMetricTarget.texture.generateMipmaps = false;

const rgbdMetricScene = new THREE.Scene();
const rgbdMetricMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uDepthTex: { value: rgbdDepthTarget.depthTexture },
    uNear: { value: camera.near },
    uFar: { value: camera.far },
    uMinDepth: { value: rgbdRangeMinM },
    uMaxDepth: { value: rgbdRangeMaxM },
    uNoiseEnabled: { value: 0.0 },
    uSpeckleEnabled: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D uDepthTex;
    uniform float uNear;
    uniform float uFar;
    uniform float uMinDepth;
    uniform float uMaxDepth;
    uniform float uNoiseEnabled;
    uniform float uSpeckleEnabled;

    // Perspective depth [0,1] -> view-space z (negative in front of camera).
    float perspectiveDepthToViewZ(const in float depth, const in float near, const in float far) {
      return (near * far) / ((far - near) * depth - far);
    }

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      float depth01 = texture2D(uDepthTex, vUv).x;
      // No geometry hit: treat as max range.
      if (depth01 >= 0.999999) {
        gl_FragColor = vec4(uMaxDepth, uMaxDepth, uMaxDepth, 1.0);
        return;
      }

      float viewZ = perspectiveDepthToViewZ(depth01, uNear, uFar);
      float zMetric = -viewZ; // camera-space Z in meters (robotics back-projection convention)
      float d = clamp(zMetric, uMinDepth, uMaxDepth);

      if (uNoiseEnabled > 0.5) {
        float span = max(0.0001, uMaxDepth - uMinDepth);
        float t = clamp((d - uMinDepth) / span, 0.0, 1.0);
        // Quantization: ~1mm near, up to ~8mm far (indoors).
        float q = mix(0.001, 0.008, t * t);
        d = floor(d / q + 0.5) * q;

        // Dropouts: more likely on edges and farther range.
        float edge = clamp(length(vec2(dFdx(depth01), dFdy(depth01))) * 250.0, 0.0, 1.0);
        float pDrop = 0.01 + 0.08 * t * t + 0.18 * edge;
        float u = hash12(vUv * vec2(4096.0, 4096.0));
        if (u < pDrop) {
          gl_FragColor = vec4(uMaxDepth, uMaxDepth, uMaxDepth, 1.0);
          return;
        }

        // Optional speckle noise (small multiplicative perturbation).
        if (uSpeckleEnabled > 0.5) {
          float n = hash12(vUv * vec2(8192.0, 8192.0) + vec2(17.3, 9.1)) - 0.5;
          float amp = 0.002 + 0.01 * t; // 2mm near -> 12mm far
          d = clamp(d + n * amp, uMinDepth, uMaxDepth);
        }
      }

      gl_FragColor = vec4(d, d, d, 1.0);
    }
  `,
  depthTest: false,
  depthWrite: false,
});
rgbdMetricMaterial.toneMapped = false;
const rgbdMetricQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), rgbdMetricMaterial);
rgbdMetricScene.add(rgbdMetricQuad);

const rgbdVizScene = new THREE.Scene();
const rgbdVizMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uMetricDepthTex: { value: rgbdMetricTarget.texture },
    uMinDepth: { value: rgbdRangeMinM },
    uMaxDepth: { value: rgbdRangeMaxM },
    uGrayMode: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D uMetricDepthTex;
    uniform float uMinDepth;
    uniform float uMaxDepth;
    uniform float uGrayMode;
    void main() {
      float d = texture2D(uMetricDepthTex, vUv).r;
      d = clamp(d, uMinDepth, uMaxDepth);
      float lin = (d - uMinDepth) / max(0.0001, (uMaxDepth - uMinDepth)); // 0 near, 1 far
      if (uGrayMode > 0.5) {
        float g = 1.0 - lin;
        gl_FragColor = vec4(g, g, g, 1.0);
        return;
      }
      float inv = (1.0 / d - 1.0 / uMaxDepth) / max(0.0001, (1.0 / uMinDepth - 1.0 / uMaxDepth)); // 1 near, 0 far
      float t = clamp(0.35 * (1.0 - lin) + 0.65 * inv, 0.0, 1.0); // near -> 1, far -> 0
      vec3 nearC = vec3(0.05, 0.98, 0.98);
      vec3 midC  = vec3(0.40, 0.95, 0.10);
      vec3 farC  = vec3(0.98, 0.15, 0.05);
      vec3 c = (t > 0.5) ? mix(midC, nearC, (t - 0.5) * 2.0) : mix(farC, midC, t * 2.0);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
  depthTest: false,
  depthWrite: false,
});
rgbdVizMaterial.toneMapped = false;
const rgbdVizQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), rgbdVizMaterial);
rgbdVizScene.add(rgbdVizQuad);
let _savedOverrideMaterial = null;

function resizeRgbdTargets() {
  const w = Math.max(1, Math.floor(window.innerWidth * renderer.getPixelRatio()));
  const h = Math.max(1, Math.floor(window.innerHeight * renderer.getPixelRatio()));
  rgbdDepthTarget.setSize(w, h);
  rgbdMetricTarget.setSize(w, h);
  if (rgbdDepthTarget.depthTexture) {
    rgbdDepthTarget.depthTexture.image.width = w;
    rgbdDepthTarget.depthTexture.image.height = h;
    rgbdDepthTarget.depthTexture.needsUpdate = true;
  }
}

let _rgbdNearFarAsserted = false;
let _rgbdLastAutoRangeMs = 0;

function updateRgbdRangeLabels() {
  if (simRgbdMinValEl) simRgbdMinValEl.textContent = `${rgbdRangeMinM.toFixed(1)}m`;
  if (simRgbdMaxValEl) simRgbdMaxValEl.textContent = `${rgbdRangeMaxM.toFixed(1)}m`;
}

function setRgbdRange(minD, maxD) {
  const lo = Math.max(0.05, Math.min(minD, maxD - 0.05));
  const hi = Math.max(lo + 0.05, maxD);
  rgbdRangeMinM = lo;
  rgbdRangeMaxM = hi;
  rgbdMetricMaterial.uniforms.uMinDepth.value = lo;
  rgbdMetricMaterial.uniforms.uMaxDepth.value = hi;
  rgbdVizMaterial.uniforms.uMinDepth.value = lo;
  rgbdVizMaterial.uniforms.uMaxDepth.value = hi;
  if (simRgbdMinEl) simRgbdMinEl.value = lo.toFixed(1);
  if (simRgbdMaxEl) simRgbdMaxEl.value = hi.toFixed(1);
  updateRgbdRangeLabels();
}

setRgbdRange(RGBD_MIN_DEPTH_M, RGBD_MAX_DEPTH_M);

function percentileFromSorted(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function updateRgbdAutoRangeFromMetricTarget() {
  const now = performance.now();
  if (now - _rgbdLastAutoRangeMs < RGBD_AUTO_RANGE_UPDATE_MS) return;
  _rgbdLastAutoRangeMs = now;
  const depth = readRgbdMetricDepthFrameMeters();
  if (!depth || depth.length === 0) return;
  const samples = [];
  const stride = Math.max(1, Math.floor(depth.length / 5000));
  for (let i = 0; i < depth.length; i += stride) {
    const d = depth[i];
    if (!Number.isFinite(d)) continue;
    if (d <= RGBD_MIN_DEPTH_M || d >= RGBD_MAX_DEPTH_M) continue;
    samples.push(d);
  }
  if (samples.length < 32) return;
  samples.sort((a, b) => a - b);
  const p05 = percentileFromSorted(samples, RGBD_AUTO_PERCENTILE_LOW);
  const p95 = percentileFromSorted(samples, RGBD_AUTO_PERCENTILE_HIGH);
  const targetMin = Math.max(RGBD_MIN_DEPTH_M, Math.min(p05, p95 - 0.1));
  const targetMax = Math.min(RGBD_MAX_DEPTH_M, Math.max(p95, targetMin + 0.1));
  const smoothMin = rgbdRangeMinM + (targetMin - rgbdRangeMinM) * RGBD_AUTO_RANGE_SMOOTH;
  const smoothMax = rgbdRangeMaxM + (targetMax - rgbdRangeMaxM) * RGBD_AUTO_RANGE_SMOOTH;
  setRgbdRange(smoothMin, smoothMax);
}

function renderRgbdView(enableAutoRange = true) {
  renderRgbdMetricPassOffscreen();

  if (enableAutoRange && rgbdAutoRange) updateRgbdAutoRangeFromMetricTarget();
  rgbdVizMaterial.uniforms.uGrayMode.value = rgbdVizMode === "gray" ? 1.0 : 0.0;

  // Pass 3: visualize metric depth target.
  renderer.setRenderTarget(null);
  renderer.setClearColor(RGBD_BG, RGBD_CLEAR_ALPHA);
  renderer.clear(true, true, true);
  renderer.render(rgbdVizScene, rgbdPostCamera);
}

function renderRgbdMetricPassOffscreen(overrideCamera) {
  const cam = overrideCamera || camera;
  rgbdMetricMaterial.uniforms.uNear.value = cam.near;
  rgbdMetricMaterial.uniforms.uFar.value = cam.far;
  rgbdMetricMaterial.uniforms.uNoiseEnabled.value = rgbdNoiseEnabled ? 1.0 : 0.0;
  rgbdMetricMaterial.uniforms.uSpeckleEnabled.value = rgbdSpeckleEnabled ? 1.0 : 0.0;
  if (!_rgbdNearFarAsserted && !overrideCamera) {
    console.assert(
      Math.abs(rgbdMetricMaterial.uniforms.uNear.value - camera.near) < 1e-9 &&
      Math.abs(rgbdMetricMaterial.uniforms.uFar.value - camera.far) < 1e-9,
      "[RGB-D] Reconstruction near/far must match active camera near/far."
    );
    _rgbdNearFarAsserted = true;
  }

  // Ensure depth pass sees scene geometry, not lidar/overlay debug points.
  const savedOverride = scene.overrideMaterial;
  const savedSplat = splatMesh ? splatMesh.visible : false;
  const savedSpark = sparkRendererMesh ? sparkRendererMesh.visible : false;
  const savedAssets = assetsGroup.visible;
  const savedPrims = primitivesGroup.visible;
  const savedLights = lightsGroup.visible;
  const savedTags = tagsGroup.visible;
  const savedLidarViz = lidarVizGroup.visible;
  const savedRgbdPc = rgbdPcOverlayGroup.visible;

  scene.overrideMaterial = null;
  if (splatMesh) splatMesh.visible = false;
  if (sparkRendererMesh) sparkRendererMesh.visible = false;
  assetsGroup.visible = true;
  primitivesGroup.visible = true;
  lightsGroup.visible = true;
  tagsGroup.visible = false;
  lidarVizGroup.visible = false;
  rgbdPcOverlayGroup.visible = false;

  renderer.setRenderTarget(rgbdDepthTarget);
  renderer.setClearColor(0x000000, RGBD_CLEAR_ALPHA);
  renderer.clear(true, true, true);
  renderer.render(scene, cam);

  renderer.setRenderTarget(rgbdMetricTarget);
  renderer.setClearColor(0x000000, RGBD_CLEAR_ALPHA);
  renderer.clear(true, true, true);
  renderer.render(rgbdMetricScene, rgbdPostCamera);

  scene.overrideMaterial = savedOverride;
  if (splatMesh) splatMesh.visible = savedSplat;
  if (sparkRendererMesh) sparkRendererMesh.visible = savedSpark;
  assetsGroup.visible = savedAssets;
  primitivesGroup.visible = savedPrims;
  lightsGroup.visible = savedLights;
  tagsGroup.visible = savedTags;
  lidarVizGroup.visible = savedLidarViz;
  rgbdPcOverlayGroup.visible = savedRgbdPc;
}

function halfToFloat(h) {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : ((s ? -1 : 1) * Infinity);
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

function readRgbdMetricDepthFrameMeters() {
  const w = rgbdMetricTarget.width;
  const h = rgbdMetricTarget.height;
  if (!w || !h) return null;

  if (rgbdMetricUsesR32F) {
    const depth = new Float32Array(w * h);
    renderer.readRenderTargetPixels(rgbdMetricTarget, 0, 0, w, h, depth);
    return depth;
  }

  if (rgbdMetricTarget.texture.type === THREE.FloatType) {
    const raw = new Float32Array(w * h * 4);
    renderer.readRenderTargetPixels(rgbdMetricTarget, 0, 0, w, h, raw);
    const depth = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) depth[i] = raw[i * 4 + 0];
    return depth;
  }

  // Half-float fallback (WebGL1 / constrained platforms)
  const raw = new Uint16Array(w * h * 4);
  renderer.readRenderTargetPixels(rgbdMetricTarget, 0, 0, w, h, raw);
  const depth = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) depth[i] = halfToFloat(raw[i * 4 + 0]);
  return depth;
}

function readRgbdOverlayMetricDepthFrameMeters() {
  const w = rgbdOverlayMetricTarget.width;
  const h = rgbdOverlayMetricTarget.height;
  if (!w || !h) return null;
  if (rgbdMetricUsesR32F) {
    const depth = new Float32Array(w * h);
    renderer.readRenderTargetPixels(rgbdOverlayMetricTarget, 0, 0, w, h, depth);
    return depth;
  }
  if (rgbdOverlayMetricTarget.texture.type === THREE.FloatType) {
    const raw = new Float32Array(w * h * 4);
    renderer.readRenderTargetPixels(rgbdOverlayMetricTarget, 0, 0, w, h, raw);
    const depth = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) depth[i] = raw[i * 4 + 0];
    return depth;
  }
  const raw = new Uint16Array(w * h * 4);
  renderer.readRenderTargetPixels(rgbdOverlayMetricTarget, 0, 0, w, h, raw);
  const depth = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) depth[i] = halfToFloat(raw[i * 4 + 0]);
  return depth;
}

function updateRgbdPcOverlayCloud(force = false) {
  if (!rgbdPcOverlayOnLidar || simSensorViewMode !== "lidar" || appMode !== "sim" || lidarOrderedDebugView) {
    _rgbdPcGeom.setDrawRange(0, 0);
    _rgbdPcGeom.attributes.position.needsUpdate = true;
    _rgbdPcGeom.attributes.color.needsUpdate = true;
    _rgbdPcOverlayLastCount = 0;
    _rgbdPcOverlayLastPose = null;
    _rgbdPcOverlayDirty = false;
    rgbdPcOverlayGroup.visible = false;
    return;
  }
  if (!force && !_rgbdPcOverlayDirty) return;
  const now = performance.now();
  const curPos = camera.getWorldPosition(new THREE.Vector3());
  const curQuat = camera.getWorldQuaternion(new THREE.Quaternion());
  if (_rgbdPcOverlayLastPose) {
    const dp = curPos.distanceTo(_rgbdPcOverlayLastPose.pos);
    const da = THREE.MathUtils.radToDeg(curQuat.angleTo(_rgbdPcOverlayLastPose.quat));
    if (!force && dp < RGBD_PC_OVERLAY_MIN_TRANSLATION_M && da < RGBD_PC_OVERLAY_MIN_ROT_DEG) return;
  }
  _rgbdPcOverlayLastUpdateMs = now;
  _rgbdPcOverlayLastPose = { pos: curPos.clone(), quat: curQuat.clone() };

  const savedDepthTex = rgbdMetricMaterial.uniforms.uDepthTex.value;

  // Low-res depth+metric pass for overlay to avoid expensive full-res readback stalls.
  const savedOverride = scene.overrideMaterial;
  const savedSplat = splatMesh ? splatMesh.visible : false;
  const savedSpark = sparkRendererMesh ? sparkRendererMesh.visible : false;
  const savedAssets = assetsGroup.visible;
  const savedPrims = primitivesGroup.visible;
  const savedLights = lightsGroup.visible;
  const savedTags = tagsGroup.visible;
  const savedLidarViz = lidarVizGroup.visible;
  const savedRgbdPc = rgbdPcOverlayGroup.visible;
  scene.overrideMaterial = null;
  if (splatMesh) splatMesh.visible = false;
  if (sparkRendererMesh) sparkRendererMesh.visible = false;
  assetsGroup.visible = true;
  primitivesGroup.visible = true;
  lightsGroup.visible = true;
  tagsGroup.visible = false;
  lidarVizGroup.visible = false;
  rgbdPcOverlayGroup.visible = false;

  renderer.setRenderTarget(rgbdOverlayDepthTarget);
  renderer.setClearColor(0x000000, RGBD_CLEAR_ALPHA);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
  rgbdMetricMaterial.uniforms.uDepthTex.value = rgbdOverlayDepthTarget.depthTexture;
  renderer.setRenderTarget(rgbdOverlayMetricTarget);
  renderer.setClearColor(0x000000, RGBD_CLEAR_ALPHA);
  renderer.clear(true, true, true);
  renderer.render(rgbdMetricScene, rgbdPostCamera);
  rgbdMetricMaterial.uniforms.uDepthTex.value = savedDepthTex;

  scene.overrideMaterial = savedOverride;
  if (splatMesh) splatMesh.visible = savedSplat;
  if (sparkRendererMesh) sparkRendererMesh.visible = savedSpark;
  assetsGroup.visible = savedAssets;
  primitivesGroup.visible = savedPrims;
  lightsGroup.visible = savedLights;
  tagsGroup.visible = savedTags;
  lidarVizGroup.visible = savedLidarViz;
  rgbdPcOverlayGroup.visible = savedRgbdPc;

  const depth = readRgbdOverlayMetricDepthFrameMeters();
  if (!depth) {
    rgbdPcOverlayGroup.visible = false;
    return;
  }
  const w = rgbdOverlayMetricTarget.width;
  const h = rgbdOverlayMetricTarget.height;
  if (!w || !h) return;

  const tanHalfY = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  const fy = 0.5 * h / Math.max(1e-6, tanHalfY);
  const fx = fy * camera.aspect;
  const cx = (w - 1) * 0.5;
  const cy = (h - 1) * 0.5;
  const targetCount = Math.min(RGBD_PC_OVERLAY_MAX_POINTS, Math.floor(w * h));
  const stride = Math.max(1, Math.floor(Math.sqrt((w * h) / Math.max(1, targetCount))));
  const pCam = new THREE.Vector3();
  const pWorld = new THREE.Vector3();

  let n = 0;
  for (let py = 0; py < h; py += stride) {
    const v = h - 1 - py; // flip Y because render-target readback is bottom-up
    for (let px = 0; px < w; px += stride) {
      if (n >= RGBD_PC_OVERLAY_MAX_POINTS) break;
      const d = depth[py * w + px];
      if (!Number.isFinite(d) || d <= RGBD_MIN_DEPTH_M || d >= RGBD_MAX_DEPTH_M) continue;
      const x = ((px - cx) / fx) * d;
      const y = -((v - cy) / fy) * d;
      const z = -d; // camera forward is -Z in three.js camera coordinates
      pCam.set(x, y, z);
      pWorld.copy(pCam).applyMatrix4(camera.matrixWorld);

      _rgbdPcPosArray[n * 3 + 0] = pWorld.x;
      _rgbdPcPosArray[n * 3 + 1] = pWorld.y;
      _rgbdPcPosArray[n * 3 + 2] = pWorld.z;

      _rgbdPcColArray[n * 3 + 0] = 0.10;
      _rgbdPcColArray[n * 3 + 1] = 1.00;
      _rgbdPcColArray[n * 3 + 2] = 0.25;
      n++;
    }
    if (n >= RGBD_PC_OVERLAY_MAX_POINTS) break;
  }

  _rgbdPcGeom.setDrawRange(0, n);
  _rgbdPcGeom.attributes.position.needsUpdate = true;
  _rgbdPcGeom.attributes.color.needsUpdate = true;
  _rgbdPcOverlayLastCount = n;
  _rgbdPcOverlayDirty = false;
  rgbdPcOverlayGroup.visible = rgbdPcOverlayOnLidar && simSensorViewMode === "lidar" && !lidarOrderedDebugView && n > 0;
}

// -----------------------------------------------------------------------------
// RoboVal standardized LiDAR schema + sensor model
// -----------------------------------------------------------------------------
// We use lidar->world pose convention for pose_T_world_lidar (T_w_l).
// i.e. p_world = T_w_l * p_lidar
const LIDAR_SCAN_DURATION_S = 0.1; // 10 Hz spinning lidar
const LIDAR_NUM_RINGS = 32;
const LIDAR_NUM_AZ_BINS = 1024;
const LIDAR_MAX_POINTS = LIDAR_NUM_RINGS * LIDAR_NUM_AZ_BINS;
const LIDAR_MIN_RANGE_M = 0.2;
const LIDAR_MAX_RANGE_M = 3;
const LIDAR_RANGE_IMAGE_W = 1024; // optional dense azimuth bins for range image export
const LIDAR_V_MIN_RAD = THREE.MathUtils.degToRad(-30);
const LIDAR_V_MAX_RAD = THREE.MathUtils.degToRad(10);
const LIDAR_ACCUM_FRAMES = 50;
const LIDAR_STATS_INTERVAL_MS = 1500;
const LIDAR_ACCUM_MIN_TRANSLATION_M = 0.08;
const LIDAR_ACCUM_MIN_ROT_DEG = 1.5;
const LIDAR_ACCUM_REFRESH_S = 2.0;

// Lidar frame uses FLU convention:
// x=forward, y=left, z=up (right-handed). Camera local is x=right, y=up, z=back.
const _lidarToCamQuat = (() => {
  const m = new THREE.Matrix4().set(
    0, -1, 0, 0,
    0, 0, 1, 0,
    -1, 0, 0, 0,
    0, 0, 0, 1
  );
  return new THREE.Quaternion().setFromRotationMatrix(m);
})();

// Pose history for deskew (camera used as lidar pose proxy)
const _lidarPoseHistory = []; // [{stampNs, pos:Vector3, quat:Quaternion}]
const LIDAR_POSE_HISTORY_NS = 2_000_000_000; // keep ~2s history
let _lidarLastStatsMs = 0;
let _lidarUseKnownGoodDebugCloud = false;

function nowNs() {
  // Use unix epoch in ns consistently (browser clock based).
  return Math.floor(performance.timeOrigin * 1e6 + performance.now() * 1e6);
}

function pushLidarPoseSample(stampNs = nowNs()) {
  let pos, quat;
  const dimosAgent = dimosMode && window.__dimosAgent;
  if (dimosAgent) {
    // In dimos mode, sample from the agent's body position + orientation.
    // getPosition() returns capsule center (~0.37m above ground), so subtract
    // capsule half-extent to get ground level, then add mount height.
    const [ax, ay, az] = dimosAgent.getPosition?.() || [0, 0, 0];
    const groundY = ay - (PLAYER_HALF_HEIGHT + PLAYER_RADIUS);
    const lidarY = groundY + LIDAR_MOUNT_HEIGHT;
    pos = new THREE.Vector3(ax, lidarY, az);
    const yaw = window.__dimosYaw ?? dimosAgent.group?.rotation?.y ?? 0;
    const agentQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    quat = agentQuat.multiply(_lidarToCamQuat);
  } else {
    pos = camera.getWorldPosition(new THREE.Vector3());
    const camQuat = camera.getWorldQuaternion(new THREE.Quaternion());
    quat = camQuat.clone().multiply(_lidarToCamQuat);
  }
  _lidarPoseHistory.push({ stampNs, pos, quat });
  const minNs = stampNs - LIDAR_POSE_HISTORY_NS;
  while (_lidarPoseHistory.length > 2 && _lidarPoseHistory[0].stampNs < minNs) {
    _lidarPoseHistory.shift();
  }
}

function getLidarPoseAtNs(stampNs) {
  if (_lidarPoseHistory.length === 0) {
    const camQuat = camera.getWorldQuaternion(new THREE.Quaternion());
    return {
      pos: camera.getWorldPosition(new THREE.Vector3()),
      quat: camQuat.multiply(_lidarToCamQuat),
    };
  }
  if (_lidarPoseHistory.length === 1) {
    return {
      pos: _lidarPoseHistory[0].pos.clone(),
      quat: _lidarPoseHistory[0].quat.clone(),
    };
  }
  // Find bounding samples
  let i1 = 0;
  while (i1 < _lidarPoseHistory.length && _lidarPoseHistory[i1].stampNs < stampNs) i1++;
  if (i1 <= 0) {
    return {
      pos: _lidarPoseHistory[0].pos.clone(),
      quat: _lidarPoseHistory[0].quat.clone(),
    };
  }
  if (i1 >= _lidarPoseHistory.length) {
    const last = _lidarPoseHistory[_lidarPoseHistory.length - 1];
    return { pos: last.pos.clone(), quat: last.quat.clone() };
  }
  const a = _lidarPoseHistory[i1 - 1];
  const b = _lidarPoseHistory[i1];
  const alpha = (stampNs - a.stampNs) / Math.max(1, b.stampNs - a.stampNs);
  const pos = a.pos.clone().lerp(b.pos, alpha);
  const quat = a.quat.clone().slerp(b.quat, alpha);
  return { pos, quat };
}

function composeTwlFlat64(pos, quat) {
  const m = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1));
  const e = m.elements;
  // Return row-major 4x4 flattened float64 (explicitly for stable downstream use)
  return new Float64Array([
    e[0], e[4], e[8], e[12],
    e[1], e[5], e[9], e[13],
    e[2], e[6], e[10], e[14],
    e[3], e[7], e[11], e[15],
  ]);
}

function twlInverseMatrix(pos, quat) {
  const twl = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1));
  return twl.clone().invert();
}

function lidarVerticalAngleForRing(ring) {
  if (LIDAR_NUM_RINGS === 1) return 0;
  const t = ring / (LIDAR_NUM_RINGS - 1);
  return LIDAR_V_MIN_RAD + (LIDAR_V_MAX_RAD - LIDAR_V_MIN_RAD) * t;
}

function makeRoboValLidarFrame({
  frameId,
  stampNs,
  points,
  intensity,
  ring,
  t,
  hasRing,
  hasPerPointTime,
  scanDurationS,
  poseTWorldLidar,
}) {
  // RoboValLidarFrame schema (used across sim/export/eval)
  return {
    frame_id: frameId,
    stamp_ns: stampNs,
    points, // Float32Array length N*3 (xyz meters, lidar frame)
    intensity, // Float32Array length N
    ring, // Uint16Array length N
    t, // Float32Array length N (seconds from start of scan)
    has_ring: hasRing,
    has_per_point_time: hasPerPointTime,
    scan_duration_s: scanDurationS,
    pose_T_world_lidar: poseTWorldLidar, // Float64Array length 16, row-major
  };
}

// ROS2 PointField datatype constants:
// INT8=1, UINT8=2, INT16=3, UINT16=4, INT32=5, UINT32=6, FLOAT32=7, FLOAT64=8
function to_pointcloud2(frame) {
  const n = Math.floor((frame.points?.length || 0) / 3);
  const pointStep = 22; // x,y,z,float32(12) + intensity,float32(4) + ring,uint16(2) + t,float32(4)
  const data = new Uint8Array(n * pointStep);
  const dv = new DataView(data.buffer);
  for (let i = 0; i < n; i++) {
    const o = i * pointStep;
    dv.setFloat32(o + 0, frame.points[i * 3 + 0], true);
    dv.setFloat32(o + 4, frame.points[i * 3 + 1], true);
    dv.setFloat32(o + 8, frame.points[i * 3 + 2], true);
    dv.setFloat32(o + 12, frame.intensity[i] ?? 0, true);
    dv.setUint16(o + 16, frame.ring[i] ?? 0, true);
    dv.setFloat32(o + 18, frame.t[i] ?? 0, true);
  }
  return {
    header: {
      frame_id: frame.frame_id,
      stamp: {
        sec: Math.floor(frame.stamp_ns / 1e9),
        nanosec: Math.floor(frame.stamp_ns % 1e9),
      },
    },
    height: 1,
    width: n,
    fields: [
      { name: "x", offset: 0, datatype: 7, count: 1 },
      { name: "y", offset: 4, datatype: 7, count: 1 },
      { name: "z", offset: 8, datatype: 7, count: 1 },
      { name: "intensity", offset: 12, datatype: 7, count: 1 },
      { name: "ring", offset: 16, datatype: 4, count: 1 },
      { name: "t", offset: 18, datatype: 7, count: 1 },
    ],
    is_bigendian: false,
    point_step: pointStep,
    row_step: pointStep * n,
    data,
    is_dense: true,
  };
}

function toNpyBytes(typedArray, shape, descr) {
  // NPY v1.0
  const magic = new Uint8Array([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 0x01, 0x00]);
  const shapeStr = `(${shape.join(", ")}${shape.length === 1 ? "," : ""})`;
  let header = `{'descr': '${descr}', 'fortran_order': False, 'shape': ${shapeStr}, }`;
  // Pad so (magic+2-byte-len+header+\n) % 16 == 0
  const preamble = 10;
  const base = preamble + header.length + 1;
  const pad = (16 - (base % 16)) % 16;
  header = header + " ".repeat(pad) + "\n";
  const headerBytes = new TextEncoder().encode(header);
  const out = new Uint8Array(magic.length + 2 + headerBytes.length + typedArray.byteLength);
  out.set(magic, 0);
  const dv = new DataView(out.buffer);
  dv.setUint16(magic.length, headerBytes.length, true);
  out.set(headerBytes, magic.length + 2);
  out.set(new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength), magic.length + 2 + headerBytes.length);
  return out;
}

function makeZipStore(entries) {
  // Uncompressed ZIP (store) writer for deterministic byte output ordering.
  const enc = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const files = [];
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (u8) => {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const data = e.data;
    const crc = crc32(data);
    const lfh = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(lfh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true); // store
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    lfh.set(nameBytes, 30);
    localParts.push(lfh, data);
    files.push({ nameBytes, crc, size: data.length, offset });
    offset += lfh.length + data.length;
  }

  let centralSize = 0;
  for (const f of files) {
    const cfh = new Uint8Array(46 + f.nameBytes.length);
    const dv = new DataView(cfh.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint16(14, 0, true);
    dv.setUint32(16, f.crc, true);
    dv.setUint32(20, f.size, true);
    dv.setUint32(24, f.size, true);
    dv.setUint16(28, f.nameBytes.length, true);
    dv.setUint16(30, 0, true);
    dv.setUint16(32, 0, true);
    dv.setUint16(34, 0, true);
    dv.setUint16(36, 0, true);
    dv.setUint32(38, 0, true);
    dv.setUint32(42, f.offset, true);
    cfh.set(f.nameBytes, 46);
    centralParts.push(cfh);
    centralSize += cfh.length;
  }

  const eocd = new Uint8Array(22);
  const dvE = new DataView(eocd.buffer);
  dvE.setUint32(0, 0x06054b50, true);
  dvE.setUint16(4, 0, true);
  dvE.setUint16(6, 0, true);
  dvE.setUint16(8, files.length, true);
  dvE.setUint16(10, files.length, true);
  dvE.setUint32(12, centralSize, true);
  dvE.setUint32(16, offset, true);
  dvE.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, eocd], { type: "application/zip" });
}

function frameToNpzBlob(frame, rangeImage = null) {
  const n = Math.floor((frame.points?.length || 0) / 3);
  const xyz = toNpyBytes(frame.points, [n, 3], "<f4");
  const intensity = toNpyBytes(frame.intensity, [n], "<f4");
  const ring = toNpyBytes(frame.ring, [n], "<u2");
  const t = toNpyBytes(frame.t, [n], "<f4");
  const metadata = {
    frame_id: frame.frame_id,
    stamp_ns: frame.stamp_ns,
    scan_duration_s: frame.scan_duration_s,
    pose_T_world_lidar: Array.from(frame.pose_T_world_lidar),
    has_ring: frame.has_ring,
    has_per_point_time: frame.has_per_point_time,
  };
  const entries = [
    { name: "xyz.npy", data: xyz },
    { name: "intensity.npy", data: intensity },
    { name: "ring.npy", data: ring },
    { name: "t.npy", data: t },
    { name: "metadata.json", data: new TextEncoder().encode(JSON.stringify(metadata, null, 2)) },
  ];
  if (rangeImage) {
    entries.push(
      { name: "range.npy", data: toNpyBytes(rangeImage.range, [rangeImage.H, rangeImage.W], "<f4") },
      { name: "intensity_img.npy", data: toNpyBytes(rangeImage.intensity, [rangeImage.H, rangeImage.W], "<f4") },
      { name: "ring_index.npy", data: toNpyBytes(rangeImage.ring_index, [rangeImage.H, rangeImage.W], "<u2") },
      { name: "range_metadata.json", data: new TextEncoder().encode(JSON.stringify(rangeImage.metadata, null, 2)) },
    );
  }
  return makeZipStore(entries);
}

let _lidarLatestRawFrame = null;
let _lidarLatestDeskewedFrame = null;
let _lidarLatestRangeImage = null;
let _lidarLatestWorldPts = null;
let _lidarLatestLocalPts = null; // deskewed lidar-local FLU (x=fwd, y=left, z=up)
let _lidarLatestWorldIntensity = null;
let _lidarAutoExport = false;
let _lidarFrameSeq = 0;

async function writeLidarFrameFiles(rawFrame, deskewedFrame, rangeImage = null) {
  // Browser-safe export path: deterministic filenames with sequence + stamp.
  const seq = _lidarFrameSeq++;
  const base = `lidar_${String(seq).padStart(6, "0")}_${deskewedFrame.stamp_ns}`;
  const rawBlob = frameToNpzBlob(rawFrame, null);
  const deskBlob = frameToNpzBlob(deskewedFrame, null);
  const a1 = document.createElement("a");
  a1.href = URL.createObjectURL(rawBlob);
  a1.download = `${base}_lidar_raw.npz`;
  document.body.appendChild(a1);
  a1.click();
  a1.remove();
  setTimeout(() => URL.revokeObjectURL(a1.href), 500);

  const a2 = document.createElement("a");
  a2.href = URL.createObjectURL(deskBlob);
  a2.download = `${base}_lidar_deskewed.npz`;
  document.body.appendChild(a2);
  a2.click();
  a2.remove();
  setTimeout(() => URL.revokeObjectURL(a2.href), 500);

  if (rangeImage) {
    const rBlob = makeZipStore([
      { name: "range.npy", data: toNpyBytes(rangeImage.range, [rangeImage.H, rangeImage.W], "<f4") },
      { name: "intensity.npy", data: toNpyBytes(rangeImage.intensity, [rangeImage.H, rangeImage.W], "<f4") },
      { name: "ring_index.npy", data: toNpyBytes(rangeImage.ring_index, [rangeImage.H, rangeImage.W], "<u2") },
      { name: "metadata.json", data: new TextEncoder().encode(JSON.stringify(rangeImage.metadata, null, 2)) },
    ]);
    const a3 = document.createElement("a");
    a3.href = URL.createObjectURL(rBlob);
    a3.download = `${base}_lidar_range_image.npz`;
    document.body.appendChild(a3);
    a3.click();
    a3.remove();
    setTimeout(() => URL.revokeObjectURL(a3.href), 500);
  }
}

const lidarVizGroup = new THREE.Group();
lidarVizGroup.name = "lidarVizGroup";
lidarVizGroup.visible = false;
const LIDAR_VIZ_MAX_POINTS = LIDAR_MAX_POINTS * LIDAR_ACCUM_FRAMES;
const _lidarPosArray = new Float32Array(LIDAR_VIZ_MAX_POINTS * 3);
const _lidarColArray = new Float32Array(LIDAR_VIZ_MAX_POINTS * 3);
const _lidarAccumFrames = []; // [{pos: Float32Array, col: Float32Array}]
let _lidarLastAccumPose = null; // {pos:Vector3, quat:Quaternion, stampNs:number}
const _lidarGeom = new THREE.BufferGeometry();
_lidarGeom.setAttribute("position", new THREE.BufferAttribute(_lidarPosArray, 3));
_lidarGeom.setAttribute("color", new THREE.BufferAttribute(_lidarColArray, 3));
_lidarGeom.setDrawRange(0, 0);
const _lidarMat = new THREE.PointsMaterial({
  color: 0xffffff,
  vertexColors: true,
  size: 0.03,
  sizeAttenuation: true,
  depthTest: true,
  transparent: false,
});
const _lidarPoints = new THREE.Points(_lidarGeom, _lidarMat);
_lidarPoints.frustumCulled = false; // point cloud covers entire scene; never cull
console.assert(_lidarPoints.isPoints === true, "[LiDAR] Visualization must use THREE.Points");
lidarVizGroup.add(_lidarPoints);
scene.add(lidarVizGroup);
let _lidarLastNonZeroDrawCount = 0;
const rgbdPcOverlayGroup = new THREE.Group();
rgbdPcOverlayGroup.name = "rgbdPcOverlayGroup";
rgbdPcOverlayGroup.visible = false;
const RGBD_PC_OVERLAY_MAX_POINTS = 12000;
const RGBD_PC_OVERLAY_MIN_TRANSLATION_M = 0.15;
const RGBD_PC_OVERLAY_MIN_ROT_DEG = 4.0;
const _rgbdPcPosArray = new Float32Array(RGBD_PC_OVERLAY_MAX_POINTS * 3);
const _rgbdPcColArray = new Float32Array(RGBD_PC_OVERLAY_MAX_POINTS * 3);
const _rgbdPcGeom = new THREE.BufferGeometry();
_rgbdPcGeom.setAttribute("position", new THREE.BufferAttribute(_rgbdPcPosArray, 3));
_rgbdPcGeom.setAttribute("color", new THREE.BufferAttribute(_rgbdPcColArray, 3));
_rgbdPcGeom.setDrawRange(0, 0);
const _rgbdPcMat = new THREE.PointsMaterial({
  color: 0x00ff4f,
  vertexColors: true,
  size: 3.0,
  sizeAttenuation: false,
  depthTest: false,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  transparent: true,
  opacity: 1.0,
});
const _rgbdPcPoints = new THREE.Points(_rgbdPcGeom, _rgbdPcMat);
_rgbdPcPoints.frustumCulled = false; // overlay covers entire scene; never cull
console.assert(_rgbdPcPoints.isPoints === true, "[RGB-D overlay] Visualization must use THREE.Points");
_rgbdPcPoints.renderOrder = 2000;
rgbdPcOverlayGroup.add(_rgbdPcPoints);
scene.add(rgbdPcOverlayGroup);
let _rgbdPcOverlayLastUpdateMs = 0;
let _rgbdPcOverlayLastPose = null;
let _rgbdPcOverlayLastCount = 0;
let _rgbdPcOverlayDirty = false;

let _lidarScanState = null; // incremental scan state (processed across frames)

function updateSimSensorButtons() {
  if (simViewCompareBtn) simViewCompareBtn.classList.toggle("active", simCompareView);
  if (simViewRgbdBtn) simViewRgbdBtn.classList.toggle("active", simSensorViewMode === "rgbd" && !simCompareView);
  if (simRgbdGrayBtn) simRgbdGrayBtn.classList.toggle("active", rgbdVizMode === "gray");
  if (simRgbdColormapBtn) simRgbdColormapBtn.classList.toggle("active", rgbdVizMode === "colormap");
  if (simRgbdAutoRangeBtn) simRgbdAutoRangeBtn.classList.toggle("active", rgbdAutoRange);
  if (simRgbdNoiseBtn) simRgbdNoiseBtn.classList.toggle("active", rgbdNoiseEnabled);
  if (simRgbdSpeckleBtn) simRgbdSpeckleBtn.classList.toggle("active", rgbdSpeckleEnabled);
  if (simRgbdPcOverlayBtn) simRgbdPcOverlayBtn.classList.toggle("active", rgbdPcOverlayOnLidar);
  if (simRgbdMinEl) simRgbdMinEl.disabled = rgbdAutoRange;
  if (simRgbdMaxEl) simRgbdMaxEl.disabled = rgbdAutoRange;
  if (simViewLidarBtn) simViewLidarBtn.classList.toggle("active", simSensorViewMode === "lidar" && !lidarOrderedDebugView && !simCompareView);
  if (simLidarColorRangeBtn) simLidarColorRangeBtn.classList.toggle("active", lidarColorByRange);
  if (simLidarOrderedDebugBtn) simLidarOrderedDebugBtn.classList.toggle("active", lidarOrderedDebugView);
  if (simLidarNoiseBtn) simLidarNoiseBtn.classList.toggle("active", lidarNoiseEnabled);
  if (simLidarMultiReturnBtn) {
    simLidarMultiReturnBtn.classList.toggle("active", lidarMultiReturnMode === "last");
    simLidarMultiReturnBtn.textContent = lidarMultiReturnMode === "last" ? "LiDAR: Last Return" : "LiDAR: Strongest";
  }
  updateRgbdRangeLabels();
}

function applySimPanelCollapsedState() {
  if (!overlayEl || !agentPanelEl) return;
  const isSimMode = appMode === "sim";
  const shouldCollapse = isSimMode && simPanelCollapsed;
  overlayEl.classList.toggle("sim-panel-collapsed", shouldCollapse);
  // Keep panel visible in edit mode so vision/request/response remain inspectable.
  agentPanelEl.classList.toggle("hidden", isSimMode ? shouldCollapse : false);
  simPanelOpenBtn?.classList.toggle("hidden", !isSimMode || !shouldCollapse);
}

function lidarRangeColor01(t) {
  // Deterministic near->far gradient: cyan -> green -> yellow -> red
  const x = Math.min(1, Math.max(0, t));
  if (x < 0.33) {
    const u = x / 0.33;
    return [0.05 + 0.35 * u, 0.98, 0.98 - 0.88 * u];
  }
  if (x < 0.66) {
    const u = (x - 0.33) / 0.33;
    return [0.40 + 0.58 * u, 0.95 - 0.15 * u, 0.10 * (1.0 - u)];
  }
  const u = (x - 0.66) / 0.34;
  return [0.98, 0.80 - 0.65 * u, 0.02 + 0.03 * (1.0 - u)];
}

function lidarHash01(seed) {
  let x = seed | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function lidarGaussianNoise(seedBase) {
  // Deterministic approx N(0,1) from 6 uniforms (CLT).
  let s = 0;
  for (let i = 0; i < 6; i++) {
    s += lidarHash01(seedBase + i * 2654435761);
  }
  return s - 3.0;
}

function applyLidarRealityModel(toi, incidence, scanSeed, vi, hi) {
  let outRange = toi;
  let dropped = false;

  if (lidarNoiseEnabled) {
    // Indoor-friendly deterministic noise profile (meters).
    const sigma = 0.004 + 0.0015 * Math.max(0, toi); // ~4mm near, grows with range
    const n = lidarGaussianNoise(scanSeed ^ (vi * 73856093) ^ (hi * 19349663));
    outRange = Math.max(LIDAR_MIN_RANGE_M, Math.min(LIDAR_MAX_RANGE_M, outRange + sigma * n));

    const tr = Math.min(1, Math.max(0, toi / LIDAR_MAX_RANGE_M));
    const dropoutP = 0.005 + 0.04 * tr * tr; // deterministic, stronger at longer range
    const u = lidarHash01(scanSeed ^ (vi * 83492791) ^ (hi * 2654435761));
    if (u < dropoutP) dropped = true;
  }

  // Multi-return knob for future lidar profiles.
  // With a single physics hit, "last" is approximated as a slight farther-biased return.
  if (!dropped && lidarMultiReturnMode === "last") {
    const weakSurface = 1.0 - Math.max(0, Math.min(1, incidence));
    const tail = 0.015 * weakSurface; // up to 1.5 cm
    outRange = Math.min(LIDAR_MAX_RANGE_M, outRange + tail);
  }

  return { range: outRange, dropped };
}

function buildKnownGoodDebugCloud() {
  // Deterministic 1m cube grid centered 2m in front of camera.
  const center = new THREE.Vector3(0, 0, -2).applyMatrix4(camera.matrixWorld);
  const step = 0.1; // 11^3 ~= 1331 points
  const points = [];
  const colors = [];
  for (let x = -0.5; x <= 0.5001; x += step) {
    for (let y = -0.5; y <= 0.5001; y += step) {
      for (let z = -0.5; z <= 0.5001; z += step) {
        points.push(center.x + x, center.y + y, center.z + z);
        colors.push(0.15 + (x + 0.5) * 0.7, 0.25 + (y + 0.5) * 0.6, 0.95 - (z + 0.5) * 0.5);
      }
    }
  }
  return {
    pos: new Float32Array(points),
    col: new Float32Array(colors),
  };
}

function logLidarFrameStats(points, n, ring) {
  const now = performance.now();
  if (now - _lidarLastStatsMs < LIDAR_STATS_INTERVAL_MS) return;
  _lidarLastStatsMs = now;
  if (!n) {
    console.info("[LiDAR stats]", { n_points: 0, nan_inf_pct: 0 });
    return;
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let ringMin = Infinity;
  let ringMax = -Infinity;
  let bad = 0;
  const yQuant = new Set();
  for (let i = 0; i < n; i++) {
    const x = points[i * 3 + 0];
    const y = points[i * 3 + 1];
    const z = points[i * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      bad++;
      continue;
    }
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    yQuant.add(Math.round(y * 1000));
    const rr = ring[i];
    if (rr < ringMin) ringMin = rr;
    if (rr > ringMax) ringMax = rr;
  }
  console.info("[LiDAR stats]", {
    n_points: n,
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    nan_inf_pct: (100 * bad) / n,
    unique_y_mm: yQuant.size,
    rings_configured: LIDAR_NUM_RINGS,
    ring_min: Number.isFinite(ringMin) ? ringMin : 0,
    ring_max: Number.isFinite(ringMax) ? ringMax : 0,
  });
}

function shouldAppendAccumFrame(refPose, stampNs) {
  if (!_lidarLastAccumPose) return true;
  const dtS = (stampNs - _lidarLastAccumPose.stampNs) / 1e9;
  if (dtS >= LIDAR_ACCUM_REFRESH_S) return true;
  const dp = refPose.pos.distanceTo(_lidarLastAccumPose.pos);
  if (dp >= LIDAR_ACCUM_MIN_TRANSLATION_M) return true;
  const ang = THREE.MathUtils.radToDeg(refPose.quat.angleTo(_lidarLastAccumPose.quat));
  if (ang >= LIDAR_ACCUM_MIN_ROT_DEG) return true;
  return false;
}

function resetLidarScanState() {
  _lidarScanState = null;
}

function updateLidarPointCloud() {
  if (!rapierWorld || !RAPIER || (simSensorViewMode !== "lidar" && !dimosMode)) return;

  if (_lidarUseKnownGoodDebugCloud) {
    resetLidarScanState();
    const dbg = buildKnownGoodDebugCloud();
    const nDbg = Math.min(LIDAR_VIZ_MAX_POINTS, Math.floor(dbg.pos.length / 3));
    _lidarPosArray.set(dbg.pos.subarray(0, nDbg * 3), 0);
    _lidarColArray.set(dbg.col.subarray(0, nDbg * 3), 0);
    _lidarGeom.setDrawRange(0, nDbg);
    _lidarGeom.attributes.position.needsUpdate = true;
    _lidarGeom.attributes.color.needsUpdate = true;
    lidarVizGroup.position.set(0, 0, 0);
    lidarVizGroup.quaternion.identity();
    lidarVizGroup.scale.set(1, 1, 1);
    return;
  }

  // Build set of collider handles to exclude from lidar raycasts.
  // Excludes player collider and ALL AI agent colliders (lidar origin is inside them).
  // In dimos mode, also explicitly exclude the active dimos agent body/colliders.
  const _lidarExcludeHandles = new Set();
  const _lidarHostAgent = dimosMode ? window.__dimosAgent : null;
  const _lidarExcludeRigidBodyHandle = _lidarHostAgent?.body?.handle;
  if (playerCollider) _lidarExcludeHandles.add(playerCollider.handle);
  if (_lidarHostAgent?.collider?.handle != null) _lidarExcludeHandles.add(_lidarHostAgent.collider.handle);
  if (_lidarHostAgent?.spineCollider?.handle != null) _lidarExcludeHandles.add(_lidarHostAgent.spineCollider.handle);
  for (const a of aiAgents) {
    if (a?.collider) _lidarExcludeHandles.add(a.collider.handle);
    if (a?.spineCollider) _lidarExcludeHandles.add(a.spineCollider.handle);
  }

  // Spinning ring LiDAR (true XYZ in lidar frame), incremental over ~0.1s wall-clock.
  const H = LIDAR_NUM_AZ_BINS;
  const V = LIDAR_NUM_RINGS;
  const scanDurationS = LIDAR_SCAN_DURATION_S;
  const scanDurationNs = Math.floor(scanDurationS * 1e9);
  if (!_lidarScanState) {
    const scanStartNs = nowNs();
    const rangeImg = new Float32Array(LIDAR_NUM_RINGS * LIDAR_RANGE_IMAGE_W);
    const intenImg = new Float32Array(LIDAR_NUM_RINGS * LIDAR_RANGE_IMAGE_W);
    const ringIdxImg = new Uint16Array(LIDAR_NUM_RINGS * LIDAR_RANGE_IMAGE_W);
    for (let i = 0; i < rangeImg.length; i++) {
      rangeImg[i] = Number.POSITIVE_INFINITY;
      intenImg[i] = 0;
      ringIdxImg[i] = 0;
    }
    _lidarScanState = {
      scanStartNs,
      scanDurationS,
      scanDurationNs,
      scanSeed: (scanStartNs / 1e6) | 0,
      nextHi: 0,
      n: 0,
      rawPts: new Float32Array(LIDAR_MAX_POINTS * 3),
      deskPts: new Float32Array(LIDAR_MAX_POINTS * 3),
      intensity: new Float32Array(LIDAR_MAX_POINTS),
      ring: new Uint16Array(LIDAR_MAX_POINTS),
      tArr: new Float32Array(LIDAR_MAX_POINTS),
      worldPts: new Float32Array(LIDAR_MAX_POINTS * 3),
      colArray: new Float32Array(LIDAR_MAX_POINTS * 3), // private color buffer (never touches GPU display)
      rangeImg,
      intenImg,
      ringIdxImg,
    };
  }
  const st = _lidarScanState;
  const dirLocal = new THREE.Vector3();
  const dirWorld = new THREE.Vector3();
  const pWorld = new THREE.Vector3();
  const pRawLocal = new THREE.Vector3();
  const elapsedNs = Math.max(0, nowNs() - st.scanStartNs);
  const progress = Math.min(1, elapsedNs / Math.max(1, st.scanDurationNs));
  let targetHiExclusive = Math.floor(progress * H);
  targetHiExclusive = Math.max(targetHiExclusive, Math.min(H, st.nextHi + 1));
  if (elapsedNs >= st.scanDurationNs) targetHiExclusive = H;

  for (let hi = st.nextHi; hi < targetHiExclusive; hi++) {
    const az = -Math.PI + (2 * Math.PI * hi) / Math.max(1, H - 1);
    for (let vi = 0; vi < V; vi++) {
      if (st.n >= LIDAR_MAX_POINTS) break;
      const elev = lidarVerticalAngleForRing(vi);
      const cosE = Math.cos(elev);
      const sinE = Math.sin(elev);
      const sampleIndex = hi * V + vi;
      const tSec = (sampleIndex / Math.max(1, H * V - 1)) * scanDurationS;
      const stampNs = st.scanStartNs + Math.floor(tSec * 1e9);
      const pose = getLidarPoseAtNs(stampNs);
      const w2lNow = twlInverseMatrix(pose.pos, pose.quat);
      const origin = pose.pos;

      // XYZ conversion from ring/azimuth/range in lidar frame (FLU):
      // x = r*cos(elev)*cos(az), y = r*cos(elev)*sin(az), z = r*sin(elev)
      dirLocal.set(cosE * Math.cos(az), cosE * Math.sin(az), sinE);
      dirWorld.copy(dirLocal).applyQuaternion(pose.quat).normalize();
      const ray = new RAPIER.Ray(
        { x: origin.x, y: origin.y, z: origin.z },
        { x: dirWorld.x, y: dirWorld.y, z: dirWorld.z }
      );
      let hit = null;
      let singleExcludeHandle = undefined;
      // Defensive retry: if a self-collider slips through, recast while excluding it.
      // Keeps scans alive even if exclusion bookkeeping is briefly stale.
      for (let castAttempt = 0; castAttempt < 4; castAttempt++) {
        hit = rapierWorld.queryPipeline.castRayAndGetNormal(
          rapierWorld.bodies,
          rapierWorld.colliders,
          ray,
          LIDAR_MAX_RANGE_M,
          false,
          RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
          undefined,
          singleExcludeHandle,
          _lidarExcludeRigidBodyHandle,
          (h) => !_lidarExcludeHandles.has(h)
        );
        const hitHandle = hit?.colliderHandle;
        if (!hit || hitHandle == null || !_lidarExcludeHandles.has(hitHandle)) break;
        singleExcludeHandle = hitHandle;
      }
      let toi = hit ? (hit.toi ?? hit.timeOfImpact ?? 0) : Infinity;
      const hitNormal = hit?.normal || null;

      // Ground-truth-style lidar: no-return beams are omitted.
      if (!Number.isFinite(toi) || toi > LIDAR_MAX_RANGE_M || toi < LIDAR_MIN_RANGE_M) continue;

      const nx = hitNormal?.x ?? 0;
      const ny = hitNormal?.y ?? 0;
      const nz = hitNormal?.z ?? 1;
      const incidence = hitNormal ? Math.max(0, -(dirWorld.x * nx + dirWorld.y * ny + dirWorld.z * nz)) : 0.7;
      const reality = applyLidarRealityModel(toi, incidence, st.scanSeed, vi, hi);
      if (reality.dropped) continue;
      toi = reality.range;

      pWorld.set(
        origin.x + dirWorld.x * toi,
        origin.y + dirWorld.y * toi,
        origin.z + dirWorld.z * toi
      );
      pRawLocal.copy(pWorld).applyMatrix4(w2lNow);

      st.rawPts[st.n * 3 + 0] = pRawLocal.x;
      st.rawPts[st.n * 3 + 1] = pRawLocal.y;
      st.rawPts[st.n * 3 + 2] = pRawLocal.z;
      st.worldPts[st.n * 3 + 0] = pWorld.x;
      st.worldPts[st.n * 3 + 1] = pWorld.y;
      st.worldPts[st.n * 3 + 2] = pWorld.z;

      st.ring[st.n] = vi;
      st.tArr[st.n] = tSec;

      const atten = 1.0 / (1.0 + 0.02 * toi * toi);
      const I = Math.max(0.06, Math.min(1.0, incidence * atten));
      st.intensity[st.n] = I;
      const tr = Math.min(1, Math.max(0, toi / LIDAR_MAX_RANGE_M));
      const depthShade = 1.0 - 0.35 * tr; // cheap EDL-like darkening by depth/range

      if (lidarColorByRange) {
        const [r, g, b] = lidarRangeColor01(tr);
        st.colArray[st.n * 3 + 0] = r * depthShade;
        st.colArray[st.n * 3 + 1] = g * depthShade;
        st.colArray[st.n * 3 + 2] = b * depthShade;
      } else {
        // Intensity-like grayscale (closer to raw LiDAR semantics)
        const g = I * depthShade;
        st.colArray[st.n * 3 + 0] = g;
        st.colArray[st.n * 3 + 1] = g;
        st.colArray[st.n * 3 + 2] = g;
      }
      // Range-image binning: rows=rings, cols=azimuth bins
      const col = Math.min(LIDAR_RANGE_IMAGE_W - 1, Math.floor((hi / Math.max(1, H - 1)) * (LIDAR_RANGE_IMAGE_W - 1)));
      const idx = vi * LIDAR_RANGE_IMAGE_W + col;
      st.rangeImg[idx] = toi;
      st.intenImg[idx] = st.intensity[st.n];
      st.ringIdxImg[idx] = vi;
      st.n++;
    }
  }
  st.nextHi = targetHiExclusive;
  if (st.nextHi < H) {
    // Keep LiDAR visible while a scan is still being built.
    // If we don't have accumulated frames yet, show the partial current scan.
    if (!lidarOrderedDebugView && _lidarAccumFrames.length === 0 && st.n > 0) {
      _lidarPosArray.set(st.worldPts.subarray(0, st.n * 3), 0);
      _lidarColArray.set(st.colArray.subarray(0, st.n * 3), 0);
      _lidarGeom.setDrawRange(0, st.n);
      if (st.n > 0) _lidarLastNonZeroDrawCount = st.n;
      _lidarGeom.attributes.position.needsUpdate = true;
      _lidarGeom.attributes.color.needsUpdate = true;
      lidarVizGroup.position.set(0, 0, 0);
      lidarVizGroup.quaternion.identity();
      lidarVizGroup.scale.set(1, 1, 1);
    }
    return; // scan still in progress
  }

  const scanEndNs = st.scanStartNs + st.scanDurationNs;
  const refPose = getLidarPoseAtNs(scanEndNs);
  const refTwlFlat = composeTwlFlat64(refPose.pos, refPose.quat);
  const refW2L = twlInverseMatrix(refPose.pos, refPose.quat);
  const pDeskLocal = new THREE.Vector3();
  for (let i = 0; i < st.n; i++) {
    pDeskLocal.set(
      st.worldPts[i * 3 + 0],
      st.worldPts[i * 3 + 1],
      st.worldPts[i * 3 + 2]
    ).applyMatrix4(refW2L);
    st.deskPts[i * 3 + 0] = pDeskLocal.x;
    st.deskPts[i * 3 + 1] = pDeskLocal.y;
    st.deskPts[i * 3 + 2] = pDeskLocal.z;
  }

  logLidarFrameStats(st.worldPts, st.n, st.ring);

  const rawFrame = makeRoboValLidarFrame({
    frameId: "lidar",
    stampNs: scanEndNs,
    points: st.rawPts.subarray(0, st.n * 3),
    intensity: st.intensity.subarray(0, st.n),
    ring: st.ring.subarray(0, st.n),
    t: st.tArr.subarray(0, st.n),
    hasRing: true,
    hasPerPointTime: true,
    scanDurationS,
    poseTWorldLidar: refTwlFlat,
  });
  const deskewedFrame = makeRoboValLidarFrame({
    frameId: "lidar",
    stampNs: scanEndNs,
    points: st.deskPts.subarray(0, st.n * 3),
    intensity: st.intensity.subarray(0, st.n),
    ring: st.ring.subarray(0, st.n),
    t: st.tArr.subarray(0, st.n),
    hasRing: true,
    hasPerPointTime: true,
    scanDurationS,
    poseTWorldLidar: refTwlFlat,
  });
  const sensorModelMeta = {
    range_min_m: LIDAR_MIN_RANGE_M,
    range_max_m: LIDAR_MAX_RANGE_M,
    noise_enabled: lidarNoiseEnabled,
    multi_return_mode: lidarMultiReturnMode,
    ordered_render_debug: lidarOrderedDebugView,
    deskewed: true,
  };
  rawFrame.sensor_model = sensorModelMeta;
  deskewedFrame.sensor_model = sensorModelMeta;
  const rangeImage = {
    H: LIDAR_NUM_RINGS,
    W: LIDAR_RANGE_IMAGE_W,
    range: st.rangeImg,
    intensity: st.intenImg,
    ring_index: st.ringIdxImg,
    metadata: {
      azimuth_convention: "col increases with azimuth in lidar FLU frame",
      binning: "uniform azimuth bins",
      num_rings: LIDAR_NUM_RINGS,
      num_azimuth_bins: LIDAR_RANGE_IMAGE_W,
      sensor_model: sensorModelMeta,
      visualization_mode: lidarOrderedDebugView ? "single_sweep_ordered" : "accumulated_unordered",
      accumulation: {
        max_frames: LIDAR_ACCUM_FRAMES,
        min_translation_m: LIDAR_ACCUM_MIN_TRANSLATION_M,
        min_rotation_deg: LIDAR_ACCUM_MIN_ROT_DEG,
        refresh_s: LIDAR_ACCUM_REFRESH_S,
      },
    },
  };
  _lidarLatestRawFrame = rawFrame;
  _lidarLatestDeskewedFrame = deskewedFrame;
  _lidarLatestRangeImage = rangeImage;
  // Save world-frame points for dimos bridge (Three.js Y-up coords).
  // The bridge's cyclic permutation correctly converts these to ROS Z-up.
  _lidarLatestWorldPts = st.worldPts.slice(0, st.n * 3);
  _lidarLatestLocalPts = st.deskPts.slice(0, st.n * 3);
  _lidarLatestWorldIntensity = st.intensity.slice(0, st.n);

  // Default visualization: accumulated world-space point cloud (depth-tested).
  if (!lidarOrderedDebugView) {
    if (shouldAppendAccumFrame(refPose, scanEndNs)) {
      const framePos = new Float32Array(st.n * 3);
      const frameCol = new Float32Array(st.n * 3);
      framePos.set(st.worldPts.subarray(0, st.n * 3));
      frameCol.set(st.colArray.subarray(0, st.n * 3));
      _lidarAccumFrames.push({ pos: framePos, col: frameCol });
      while (_lidarAccumFrames.length > LIDAR_ACCUM_FRAMES) _lidarAccumFrames.shift();
      _lidarLastAccumPose = {
        pos: refPose.pos.clone(),
        quat: refPose.quat.clone(),
        stampNs: scanEndNs,
      };
    }

    let out = 0;
    const len = _lidarAccumFrames.length;
    for (let fi = 0; fi < len && out < LIDAR_VIZ_MAX_POINTS; fi++) {
      const f = _lidarAccumFrames[fi];
      const age01 = len <= 1 ? 0 : (len - 1 - fi) / (len - 1); // 1 old -> 0 newest
      const fade = 1.0 - 0.7 * age01;
      const fn = Math.floor(f.pos.length / 3);
      for (let i = 0; i < fn && out < LIDAR_VIZ_MAX_POINTS; i++, out++) {
        _lidarPosArray[out * 3 + 0] = f.pos[i * 3 + 0];
        _lidarPosArray[out * 3 + 1] = f.pos[i * 3 + 1];
        _lidarPosArray[out * 3 + 2] = f.pos[i * 3 + 2];
        _lidarColArray[out * 3 + 0] = Math.max(0, Math.min(1, f.col[i * 3 + 0] * fade));
        _lidarColArray[out * 3 + 1] = Math.max(0, Math.min(1, f.col[i * 3 + 1] * fade));
        _lidarColArray[out * 3 + 2] = Math.max(0, Math.min(1, f.col[i * 3 + 2] * fade));
      }
    }
    if (out > 0) {
      _lidarGeom.setDrawRange(0, out);
      _lidarLastNonZeroDrawCount = out;
    }
    lidarVizGroup.position.set(0, 0, 0);
    lidarVizGroup.quaternion.identity();
    lidarVizGroup.scale.set(1, 1, 1);
  } else {
    // Debug visualization: ordered current-frame cloud in deskewed lidar frame.
    _lidarAccumFrames.length = 0;
    _lidarPosArray.set(st.deskPts.subarray(0, st.n * 3), 0);
    _lidarGeom.setDrawRange(0, st.n);
    if (st.n > 0) _lidarLastNonZeroDrawCount = st.n;
    lidarVizGroup.position.copy(refPose.pos);
    lidarVizGroup.quaternion.copy(refPose.quat);
    lidarVizGroup.scale.set(1, 1, 1);
  }
  _lidarGeom.attributes.position.needsUpdate = true;
  _lidarGeom.attributes.color.needsUpdate = true;
  // Guard against intermittent empty frames causing visible flicker.
  if (_lidarGeom.drawRange.count <= 0 && _lidarLastNonZeroDrawCount > 0) {
    _lidarGeom.setDrawRange(0, _lidarLastNonZeroDrawCount);
  }
  if (_lidarAutoExport) {
    writeLidarFrameFiles(rawFrame, deskewedFrame, rangeImage);
  }
  resetLidarScanState();
}

function applySimSensorViewMode() {
  // Feature is sim-focused; always restore normal rendering in edit.
  if (appMode !== "sim") {
    simSensorViewMode = "rgb";
    simCompareView = false;
  }

  if (simSensorViewMode === "rgb") {
    // Restore default rendering.
    scene.overrideMaterial = _savedOverrideMaterial;
    if (splatMesh) splatMesh.visible = true;
    if (sparkRendererMesh) sparkRendererMesh.visible = true;
    assetsGroup.visible = true;
    primitivesGroup.visible = true;
    lightsGroup.visible = true;
    tagsGroup.visible = shouldShowEditorGuides();
    lidarVizGroup.visible = false;
    rgbdPcOverlayGroup.visible = false;
    _rgbdPcGeom.setDrawRange(0, 0);
    _lidarAccumFrames.length = 0;
    _lidarLastAccumPose = null;
    resetLidarScanState();
    applySceneRgbBackground();
  } else if (simSensorViewMode === "rgbd") {
    // RGB-D mode: render scene depth to offscreen target, then post-process to
    // metric camera-space Z visualization. Do not override scene materials.
    _savedOverrideMaterial = null;
    scene.overrideMaterial = null;
    if (splatMesh) splatMesh.visible = false;
    if (sparkRendererMesh) sparkRendererMesh.visible = false;
    assetsGroup.visible = true;
    primitivesGroup.visible = true;
    lightsGroup.visible = true;
    tagsGroup.visible = false;
    lidarVizGroup.visible = false;
    rgbdPcOverlayGroup.visible = false;
    _rgbdPcGeom.setDrawRange(0, 0);
    _lidarAccumFrames.length = 0;
    _lidarLastAccumPose = null;
    resetLidarScanState();
    skyDome.visible = false;
    scene.background = RGBD_BG;
  } else {
    // LiDAR mode: hide scene visuals and render deterministic point cloud only.
    _savedOverrideMaterial = null;
    scene.overrideMaterial = null;
    if (splatMesh) splatMesh.visible = false;
    if (sparkRendererMesh) sparkRendererMesh.visible = false;
    assetsGroup.visible = false;
    primitivesGroup.visible = false;
    lightsGroup.visible = false;
    tagsGroup.visible = false;
    lidarVizGroup.visible = true;
    rgbdPcOverlayGroup.visible = rgbdPcOverlayOnLidar && _rgbdPcOverlayLastCount > 0;
    skyDome.visible = false;
    scene.background = RGBD_BG;
  }
  updateSimSensorButtons();
}

function setSimSensorViewMode(mode) {
  const next = mode === "rgbd" || mode === "lidar" ? mode : "rgb";
  // Toggle behavior: clicking an already-active sensor mode returns to RGB.
  simSensorViewMode = (simSensorViewMode === next && next !== "rgb") ? "rgb" : next;
  applySimSensorViewMode();
  if (simSensorViewMode === "rgb") {
    setStatus("RGB view");
  } else if (simSensorViewMode === "rgbd") {
    setStatus(`RGB-D ${rgbdVizMode === "gray" ? "grayscale" : "colormap"} (${rgbdRangeMinM.toFixed(1)}-${rgbdRangeMaxM.toFixed(1)}m)`);
  } else {
    setStatus(lidarOrderedDebugView ? "LiDAR single sweep view" : "LiDAR accumulated 3D point cloud");
  }
}

// Controls: pointer-lock look + WASD move.
const controls = new PointerLockControls(camera, document.body);
scene.add(controls.object);

// Transform gizmo for edit-mode asset placement.
transformControls = new TransformControls(camera, renderer.domElement);
transformControls.visible = false;
transformControls.enabled = false;
transformControls.addEventListener("dragging-changed", (e) => {
  controls.enabled = !e.value;
  // When drag ENDS, rebuild colliders (expensive — only do once, not per-frame)
  if (!e.value) {
    if (selectedGroupId && groupPivot) persistGroupTransformsAndRebuild();
    else if (selectedAssetId) persistSelectedAssetTransform();
    else if (selectedPrimitiveId) persistSelectedPrimitiveTransform();
    else if (selectedLightId) persistSelectedLightTransform();
  }
});
transformControls.addEventListener("objectChange", () => {
  // During drag: only update the data model + XYZ inputs (cheap).
  // Colliders are rebuilt on drag-end above.
  if (selectedGroupId && groupPivot) {
    persistGroupTransforms();
  } else if (selectedAssetId) {
    const a = getSelectedAsset();
    const obj = assetsGroup.getObjectByName(`asset:${a?.id}`);
    if (a && obj) {
      a.transform = {
        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
        scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
      };
    }
  } else if (selectedPrimitiveId) {
    const prim = getSelectedPrimitive();
    const obj = primitivesGroup.getObjectByName(`prim:${prim?.id}`);
    if (prim && obj) {
      prim.transform = {
        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
        scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
      };
    }
  } else if (selectedLightId) {
    const ld = getSelectedLight();
    if (ld) syncLightFromProxy(ld);
  }
  populateTransformInputs();
});
scene.add(transformControls);

const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  up: false,
  down: false,
};

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || "";
  if (statusSimEl) statusSimEl.textContent = msg || "";
}

function randId() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadTagsForWorld() {
  // Clean up old primitive colliders BEFORE replacing the arrays
  for (const p of primitives) {
    removePrimitiveCollider(p);
  }

  try {
    const rawState = localStorage.getItem("sparkWorldStateByWorld");
    const byWorld = rawState ? JSON.parse(rawState) : {};
    const state = byWorld[worldKey] || null;
    if (state && typeof state === "object") {
      tags = Array.isArray(state.tags) ? state.tags : [];
      assets = Array.isArray(state.assets) ? state.assets.map(normalizeAsset).filter(Boolean) : [];
      primitives = Array.isArray(state.primitives) ? state.primitives : [];
      editorLights = Array.isArray(state.lights) ? state.lights : [];
      groups = Array.isArray(state.groups) ? state.groups : [];
      sceneSettings = normalizeSceneSettings(state.sceneSettings);
    } else {
      // Backwards compat: tags-only storage
      const raw = localStorage.getItem("sparkWorldTagsByWorld");
      const byWorldOld = raw ? JSON.parse(raw) : {};
      tags = Array.isArray(byWorldOld[worldKey]) ? byWorldOld[worldKey] : [];
      assets = [];
      primitives = [];
      editorLights = [];
      groups = [];
      sceneSettings = createDefaultSceneSettings();
    }
  } catch {
    tags = [];
    assets = [];
    primitives = [];
    editorLights = [];
    groups = [];
    sceneSettings = createDefaultSceneSettings();
  }
  selectedTagId = null;
  draftTag = null;
  selectedAssetId = null;
  selectedPrimitiveId = null;
  selectedLightId = null;
  rebuildTagMarkers();
  renderTagsList();
  renderTagPanel();
  rebuildAssets();
  renderAssetsList();
  rebuildAllPrimitives();
  renderPrimitivesList();
  renderPrimitiveProps();
  rebuildAllEditorLights();
  renderLightsList();
  renderLightProps();
  applySceneSkySettings();
  applySceneRgbBackground();
}

function saveTagsForWorld() {
  if (currentWorkspace !== "scene") {
    return;
  }
  try {
    let rawState = localStorage.getItem("sparkWorldStateByWorld");
    let byWorld = {};
    
    try {
      byWorld = rawState ? JSON.parse(rawState) : {};
    } catch {
      // Corrupted data, start fresh
      console.warn("[SAVE] Corrupted localStorage data, clearing...");
      byWorld = {};
    }
    
    const portalCount = assets.filter(a => a.isPortal).length;
    console.log(`[SAVE] Saving ${assets.length} assets (${portalCount} portals) for world: ${worldKey}`);
    
    // Only save lightweight metadata - NOT the full dataBase64 model data
    // For regular assets: just save state changes (currentStateId, transform)
    // For portals: save full portal data (they don't have dataBase64)
    const lightweightAssets = assets.map(a => {
      if (a.isPortal) {
        // Portals are small, save everything except runtime props
        return {
          id: a.id,
          title: a.title,
          notes: a.notes,
          isPortal: true,
          destinationWorld: a.destinationWorld,
          linkedPortalId: a.linkedPortalId,
          linkedPortalPosition: a.linkedPortalPosition,
          currentStateId: a.currentStateId,
          transform: a.transform,
          pickable: false,
          // Minimal state info for portals
          states: a.states?.map(s => ({ id: s.id, name: s.name })) || [],
          actions: a.actions || [],
        };
      } else {
        // Regular assets: only save delta/metadata, not model data
        return {
          id: a.id,
          currentStateId: a.currentStateId || a.currentState,
          transform: a.transform,
          pickable: a.pickable,
          castShadow: a.castShadow ?? false,
          receiveShadow: a.receiveShadow ?? false,
          blobShadow: a.blobShadow || null,
          _deltaOnly: true,
        };
      }
    });
    
    // Save primitives — strip collider handles and large texture data URLs
    // (textures are preserved in Export but too big for localStorage)
    const savePrimitives = primitives.map((p) => {
      const { _colliderHandle, ...rest } = p;
      if (rest.material?.textureDataUrl) {
        rest.material = { ...rest.material, textureDataUrl: null };
      }
      return rest;
    });

    // Save lights (strip runtime objects)
    const saveLights = editorLights.map((l) => {
      const { _lightObj, _helperObj, _proxyObj, ...rest } = l;
      return rest;
    });

    byWorld[worldKey] = {
      tags,
      assets: lightweightAssets,
      primitives: savePrimitives,
      lights: saveLights,
      groups,
      sceneSettings: serializeSceneSettings(),
    };
    const dataStr = JSON.stringify(byWorld);
    
    // Check size before saving (localStorage limit is typically 5MB)
    const sizeKB = (dataStr.length * 2) / 1024; // Rough estimate (UTF-16)
    console.log(`[SAVE] Data size: ${sizeKB.toFixed(1)}KB`);
    
    localStorage.setItem("sparkWorldStateByWorld", dataStr);
    localStorage.setItem("sparkWorldLastWorldKey", worldKey);
  } catch (e) {
    console.error("[SAVE] Failed to save world state:", e);
    
    // If quota exceeded, try clearing old data and retry
    if (e.name === "QuotaExceededError") {
      console.warn("[SAVE] Quota exceeded, clearing old world data...");
      try {
        localStorage.removeItem("sparkWorldStateByWorld");
        // Retry with just current world
        const freshData = {};
        freshData[worldKey] = { tags, assets: assets.filter(a => a.isPortal).map(a => ({
          id: a.id, title: a.title, notes: a.notes, isPortal: true,
          destinationWorld: a.destinationWorld, linkedPortalId: a.linkedPortalId,
          linkedPortalPosition: a.linkedPortalPosition, currentStateId: a.currentStateId,
          transform: a.transform, states: [], actions: a.actions || [],
        })), sceneSettings: serializeSceneSettings() };
        localStorage.setItem("sparkWorldStateByWorld", JSON.stringify(freshData));
        console.log("[SAVE] Saved portals only after clearing old data");
      } catch (e2) {
        console.error("[SAVE] Still failed after clearing:", e2);
      }
    }
  }
}

// Clear all localStorage data for this app (useful for debugging)
function clearWorldStorage() {
  localStorage.removeItem("sparkWorldStateByWorld");
  localStorage.removeItem("sparkWorldLastWorldKey");
  console.log("[STORAGE] Cleared all world storage");
}
// Expose for debugging: window.clearWorldStorage = clearWorldStorage;

function setWorldKey(key) {
  worldKey = key || "default";
  localStorage.setItem("sparkWorldLastWorldKey", worldKey);
  loadTagsForWorld();
}

function shouldShowEditorGuides() {
  return appMode === "edit" && !editorSimLightingPreview;
}

function updateEditorSimLightPreviewUi() {
  if (!editorSimLightPreviewBtn) return;
  editorSimLightPreviewBtn.classList.toggle("active", editorSimLightingPreview);
  editorSimLightPreviewBtn.classList.toggle("tb-muted", !editorSimLightingPreview);
  editorSimLightPreviewBtn.textContent = editorSimLightingPreview ? "Editor View" : "Sim View";
  editorSimLightPreviewBtn.title = editorSimLightingPreview
    ? "Restore editor helpers and gizmos"
    : "Hide editor helpers to preview sim lighting";
}

function applyEditorGuideVisibility() {
  const showGuides = shouldShowEditorGuides();
  if (grid) grid.visible = showGuides;
  if (tagsGroup) tagsGroup.visible = showGuides;
  if (!showGuides && placementGhostGroup) placementGhostGroup.visible = false;
  if (transformControls) {
    if (!showGuides) {
      transformControls.detach();
      transformControls.visible = false;
      transformControls.enabled = false;
    } else {
      const hasSelection = !!selectedAssetId || !!selectedPrimitiveId || !!selectedLightId;
      transformControls.visible = hasSelection;
      transformControls.enabled = hasSelection;
    }
  }
  for (const ld of editorLights) {
    if (ld._proxyObj) ld._proxyObj.visible = showGuides;
    if (ld._helperObj) ld._helperObj.visible = showGuides;
  }
}

function setAppMode(mode) {
  let target = mode === "edit" ? "edit" : "sim";
  // Clamp mode to what this page can actually render.
  // This prevents leaking a stored "edit" mode into sim-only pages.
  if (target === "edit" && !HAS_EDITOR_PANEL) target = "sim";
  if (target === "sim" && !HAS_SIM_PANEL) target = "edit";
  appMode = target;
  localStorage.setItem("sparkWorldMode", appMode);
  document.documentElement.dataset.mode = appMode;

  // Keep VLM enabled in both edit and sim so the agent can assist during creation.
  for (const a of aiAgents) {
    if (a?.vlm) a.vlm.enabled = true;
  }
  renderTagPanel();
  applySimPanelCollapsedState();
  renderAgentTaskUi();

  applyEditorGuideVisibility();
  updateEditorSimLightPreviewUi();

  // Close modal on mode switch.
  showModal(false);
  if (appMode === "edit" && agentCameraFollow) {
    disableAgentCameraFollow();
  }
  applySimSensorViewMode();
}

function getSelectedTag() {
  return tags.find((t) => t.id === selectedTagId) ?? null;
}

function renderTagPanel() {
  const sel = getSelectedTag();
  if (tagSelectedEl) {
    if (draftTag) {
      tagSelectedEl.textContent = `Editing tag…`;
    } else if (!sel) {
      tagSelectedEl.textContent =
        appMode === "edit"
          ? `Edit mode: aim at a surface and press T to place a tag.`
          : `Simulation mode: click a tag marker to view.`;
    } else {
      const lines = [
        `${sel.title || "(untitled)"}`,
        sel.notes ? `\n${sel.notes}` : "",
        `\nRadius: ${Number(sel.radius ?? 1.5).toFixed(2)}`,
      ].join("");
      tagSelectedEl.textContent = lines.trim();
    }
  }

  if (tagFormEl) {
    const show = appMode === "edit" && !!draftTag;
    tagFormEl.classList.toggle("hidden", !show);
  }
}

function renderTagsList() {
  if (!tagsListEl) return;
  tagsListEl.innerHTML = "";
  for (const t of tags) {
    const el = document.createElement("div");
    el.className = "tag-item" + (t.id === selectedTagId ? " active" : "");
    const title = (t.title || "(untitled)").slice(0, 40);
    el.innerHTML = `${escapeHtml(title)}<small>tag</small>`;
    el.addEventListener("click", () => {
      selectedTagId = t.id;
      selectedPrimitiveId = null;
      selectedLightId = null;
      selectedAssetId = null;
      if (appMode === "edit") {
        draftTag = { ...t };
        if (tagTitleEl) tagTitleEl.value = String(draftTag.title ?? "");
        if (tagNotesEl) tagNotesEl.value = String(draftTag.notes ?? "");
        if (tagRadiusEl) tagRadiusEl.value = String(Number(draftTag.radius ?? 1.5));
        if (tagRadiusValueEl) tagRadiusValueEl.textContent = Number(draftTag.radius ?? 1.5).toFixed(2);
      } else {
        draftTag = null;
      }
      updateMarkerMaterials();
      renderTagsList();
      renderTagPanel();
      updateDetailsPanel();
    });
    tagsListEl.appendChild(el);
  }
  updateOutlinerCounts();
}

const markerGeom = new THREE.SphereGeometry(0.08, 12, 12);
const markerMat = new THREE.MeshBasicMaterial({ color: 0x7cc4ff });
const markerMatActive = new THREE.MeshBasicMaterial({ color: 0xffd36e });
const radiusGeom = new THREE.SphereGeometry(1, 20, 14);
const radiusMat = new THREE.MeshBasicMaterial({
  color: 0x7cc4ff,
  transparent: true,
  opacity: 0.08,
  depthWrite: false,
});

function agentUiPush(event) {
  const logs = [
    agentLogEl,
    document.getElementById("edit-agent-log"),
  ].filter(Boolean);
  for (const log of logs) {
    const el = document.createElement("div");
    el.className = "agent-log-item";
    el.textContent = event;
    log.prepend(el);
    // cap
    while (log.children.length > 10) log.removeChild(log.lastChild);
  }
}

function agentUiSetLast(text) {
  const value = text || "";
  if (agentLastEl) agentLastEl.textContent = value;
  const editLast = document.getElementById("edit-agent-last");
  if (editLast) editLast.textContent = value;
}

function agentUiSetShot(base64) {
  if (!base64) return;
  const src = `data:image/jpeg;base64,${base64}`;
  if (agentShotImgEl) agentShotImgEl.src = src;
  const editShot = document.getElementById("edit-agent-shot-img");
  if (editShot) editShot.src = src;
}

function extractObservationText(parsed, raw) {
  const p = parsed && typeof parsed === "object" ? parsed : {};
  const observation =
    (typeof p.observation === "string" && p.observation) ||
    (typeof p.obs === "string" && p.obs) ||
    (typeof p.perception === "string" && p.perception) ||
    (typeof p.sceneObservation === "string" && p.sceneObservation) ||
    (typeof p.visualObservation === "string" && p.visualObservation) ||
    (typeof p.params?.observation === "string" && p.params.observation) ||
    "";
  if (observation.trim()) return observation.trim();

  if (typeof raw === "string" && raw.trim()) {
    const m = raw.match(/"observation"\s*:\s*"([^"]+)"/i);
    if (m?.[1]) return m[1];
  }
  return "";
}

function agentUiSetObservation(text) {
  const value = String(text || "").trim();
  if (!agentObservationEl) return;
  agentObservationEl.textContent = value || "No observation in latest response.";
}

function agentUiSetRequest({ endpoint, model, prompt, context, imageBytes, messages }) {
  const metaText = `endpoint: ${endpoint}\nmodel: ${model}\nimageBytes: ${imageBytes ?? "?"}\nworld: ${worldKey}`;
  if (agentReqMetaEl) agentReqMetaEl.textContent = metaText;
  const editMeta = document.getElementById("edit-agent-req-meta");
  if (editMeta) editMeta.textContent = metaText;
  if (agentReqPromptEl) agentReqPromptEl.textContent = prompt || "";
  const editPrompt = document.getElementById("edit-agent-req-prompt");
  if (editPrompt) editPrompt.textContent = prompt || "";
  
  // Format messages for display (only assistant and user messages, not system)
  let contextText = "";
  if (messages && messages.length > 0) {
    // Filter out system messages - only show assistant and user
    const conversationMessages = messages.filter(msg => msg.role !== "system");
    if (conversationMessages.length > 0) {
      contextText = conversationMessages.map((msg) => {
        const role = msg.role.toUpperCase();
        let content = "";
        if (typeof msg.content === "string") {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          // Handle multimodal content (text + image)
          content = msg.content.map(part => {
            if (part.type === "text") return part.text;
            if (part.type === "image_url") return "[IMAGE]";
            return JSON.stringify(part);
          }).join("\n");
        } else {
          content = JSON.stringify(msg.content, null, 2);
        }
        return `═══ ${role} ═══\n${content}`;
      }).join("\n\n");
    } else {
      contextText = "(No conversation history yet)";
    }
  } else {
    contextText = JSON.stringify(context ?? {}, null, 2);
  }
  if (agentReqContextEl) agentReqContextEl.textContent = contextText;
  const editContext = document.getElementById("edit-agent-req-context");
  if (editContext) editContext.textContent = contextText;
}

function agentUiSetResponse({ raw, parsed }) {
  if (agentRespRawEl) agentRespRawEl.textContent = raw || "";
  const editRaw = document.getElementById("edit-agent-resp-raw");
  if (editRaw) editRaw.textContent = raw || "";
  if (agentLastEl) agentLastEl.textContent = JSON.stringify(parsed ?? {}, null, 2);
  agentUiSetObservation(extractObservationText(parsed, raw));
  const editLast = document.getElementById("edit-agent-last");
  if (editLast) editLast.textContent = JSON.stringify(parsed ?? {}, null, 2);
}

function clearAgentInspectorViews() {
  if (agentShotImgEl) agentShotImgEl.removeAttribute("src");
  if (agentReqMetaEl) agentReqMetaEl.textContent = "No request yet";
  if (agentReqPromptEl) agentReqPromptEl.textContent = "";
  if (agentReqContextEl) agentReqContextEl.textContent = "";
  if (agentRespRawEl) agentRespRawEl.textContent = "";
  if (agentLastEl) agentLastEl.textContent = "Waiting...";
  if (agentObservationEl) agentObservationEl.textContent = "Waiting for first observation...";

  const editShot = document.getElementById("edit-agent-shot-img");
  const editReqMeta = document.getElementById("edit-agent-req-meta");
  const editReqPrompt = document.getElementById("edit-agent-req-prompt");
  const editReqContext = document.getElementById("edit-agent-req-context");
  const editRespRaw = document.getElementById("edit-agent-resp-raw");
  const editLast = document.getElementById("edit-agent-last");
  if (editShot) editShot.removeAttribute("src");
  if (editReqMeta) editReqMeta.textContent = "No request yet";
  if (editReqPrompt) editReqPrompt.textContent = "";
  if (editReqContext) editReqContext.textContent = "";
  if (editRespRaw) editRespRaw.textContent = "";
  if (editLast) editLast.textContent = "Waiting...";
}

function showEditSpawnedAgentsTab() {
  if (appMode !== "edit") return;
  const btn = document.getElementById("vibe-tab-agents");
  btn?.click?.();
}

function getAgentById(id) {
  const key = String(id || "");
  if (!key) return null;
  return aiAgents.find((a) => a?.id === key) || null;
}

function ensureAgentControlStrip() {
  // Restrict spawned-agent controls to the right-panel "Spawned Agents" tab only.
  const panelContent = document.getElementById("vibe-tab-agents-pane");
  if (!panelContent) return;

  let strip = document.getElementById("agent-control-strip");

  // Re-parent strip if it ended up in the wrong panel after mode switch.
  if (strip && strip.parentElement !== panelContent) {
    strip.remove();
    strip = null;
    agentUiSelectedLabelEl = null;
    agentUiSpawnBtn = null;
    agentUiFollowBtn = null;
    agentUiStopBtn = null;
    agentUiRemoveBtn = null;
    agentUiTaskInputEl = null;
    agentUiTaskRunBtn = null;
  }

  if (agentUiSelectedLabelEl && agentUiFollowBtn && agentUiStopBtn && agentUiRemoveBtn) return;

  if (!strip) {
    strip = document.createElement("div");
    strip.id = "agent-control-strip";
    strip.className = "agent-control-strip";
    strip.innerHTML = `
      <div class="agent-control-selected" id="agent-selected-label">Selected: none</div>
      <div class="agent-control-actions">
        <button id="agent-selected-spawn" type="button" class="tb-btn tb-primary">+ Spawn</button>
        <button id="agent-selected-follow" type="button" class="tb-btn tb-muted">Follow POV</button>
        <button id="agent-selected-stop" type="button" class="tb-btn">Stop</button>
        <button id="agent-selected-remove" type="button" class="tb-btn tb-danger">Remove</button>
      </div>
      <div class="agent-control-task-row">
        <input id="agent-selected-task-input" class="agent-control-task-input" type="text" placeholder="Task for selected agent..." />
        <button id="agent-selected-task-run" type="button" class="tb-btn tb-primary">Run</button>
      </div>
    `;
    panelContent.insertBefore(strip, panelContent.firstChild || null);
  }

  agentUiSelectedLabelEl = document.getElementById("agent-selected-label");
  agentUiSpawnBtn = document.getElementById("agent-selected-spawn");
  agentUiFollowBtn = document.getElementById("agent-selected-follow");
  agentUiStopBtn = document.getElementById("agent-selected-stop");
  agentUiRemoveBtn = document.getElementById("agent-selected-remove");
  agentUiTaskInputEl = document.getElementById("agent-selected-task-input");
  agentUiTaskRunBtn = document.getElementById("agent-selected-task-run");

  agentUiSpawnBtn?.addEventListener("click", () => {
    if (appMode !== "edit") return;
    void spawnOrMoveAiAtAim({ createNew: true, silent: false, ephemeral: false }).then(() => {
      const newest = aiAgents[aiAgents.length - 1];
      if (newest?.id) selectAgentInspector(newest.id);
      renderSelectedAgentControls();
    });
    showEditSpawnedAgentsTab();
  });
  agentUiFollowBtn?.addEventListener("click", () => {
    const a = getAgentById(selectedAgentInspectorId);
    if (!a) return;
    if (agentCameraFollow && agentCameraFollowId === a.id) {
      disableAgentCameraFollow();
    } else {
      enableAgentCameraFollow(a.id);
    }
    renderSelectedAgentControls();
  });
  agentUiStopBtn?.addEventListener("click", () => {
    const a = getAgentById(selectedAgentInspectorId);
    if (!a) return;
    stopAiAgent(a, "ui-stop");
    setStatus(`Stopped ${a.id}.`);
    renderSelectedAgentControls();
  });
  agentUiRemoveBtn?.addEventListener("click", () => {
    const a = getAgentById(selectedAgentInspectorId);
    if (!a) return;
    removeAiAgent(a, "ui-remove");
    setStatus(`Removed ${a.id}.`);
    if (agentTask.active && aiAgents.length === 0) endAgentTask("all-agents-removed");
    renderSelectedAgentControls();
  });
  const runSelectedTask = () => {
    const a = getAgentById(selectedAgentInspectorId);
    if (!a || appMode !== "edit") return;
    const text = String(agentUiTaskInputEl?.value || "").trim();
    if (!text) return;
    if (agentTask.active) endAgentTask("replace-task");
    void startAgentTask(text, { autoPool: false, targetAgentId: a.id });
    if (agentUiTaskInputEl) agentUiTaskInputEl.value = "";
    setStatus(`Running task on ${a.id}.`);
    showEditSpawnedAgentsTab();
  };
  agentUiTaskRunBtn?.addEventListener("click", runSelectedTask);
  agentUiTaskInputEl?.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") runSelectedTask();
  });
}

function renderSelectedAgentControls() {
  ensureAgentControlStrip();
  if (!agentUiSelectedLabelEl || !agentUiFollowBtn || !agentUiStopBtn || !agentUiRemoveBtn) return;
  const strip = document.getElementById("agent-control-strip");
  if (strip) {
    // Keep this strip exclusive to right panel UI in edit mode.
    strip.classList.toggle("hidden", appMode !== "edit");
    strip.style.display = appMode === "edit" ? "" : "none";
  }
  const a = getAgentById(selectedAgentInspectorId);
  const has = !!a;
  agentUiSelectedLabelEl.textContent = has ? `Selected: ${a.id}` : "Selected: none";
  if (agentUiSpawnBtn) agentUiSpawnBtn.disabled = appMode !== "edit";
  agentUiFollowBtn.disabled = !has;
  agentUiStopBtn.disabled = !has;
  agentUiRemoveBtn.disabled = !has;
  if (agentUiTaskInputEl) agentUiTaskInputEl.disabled = !has || appMode !== "edit";
  if (agentUiTaskRunBtn) agentUiTaskRunBtn.disabled = !has || appMode !== "edit";
  agentUiFollowBtn.textContent = has && agentCameraFollow && agentCameraFollowId === a.id ? "Unfollow POV" : "Follow POV";
}

function getOrCreateAgentInspectorState(agentId) {
  const id = String(agentId || "");
  if (!id) return { shot: "", request: null, response: null };
  if (!agentInspectorStateById.has(id)) {
    agentInspectorStateById.set(id, { shot: "", request: null, response: null });
  }
  return agentInspectorStateById.get(id);
}

function renderAgentInspector(agentId = selectedAgentInspectorId) {
  const id = String(agentId || "");
  if (!id) return;
  const s = getOrCreateAgentInspectorState(id);
  if (agentReqMetaEl) {
    const base = s.request || { endpoint: "-", model: "-", prompt: "", context: {}, imageBytes: null, messages: [] };
    agentUiSetRequest(base);
    agentReqMetaEl.textContent = `${agentReqMetaEl.textContent}\nagent: ${id}`;
    const editMeta = document.getElementById("edit-agent-req-meta");
    if (editMeta) editMeta.textContent = `${editMeta.textContent}\nagent: ${id}`;
  }
  if (s.shot) agentUiSetShot(s.shot);
  if (s.response) agentUiSetResponse(s.response);
}

function selectAgentInspector(agentId) {
  const id = String(agentId || "");
  if (!id) return;
  selectedAgentInspectorId = id;
  showEditSpawnedAgentsTab();
  // Force strip into correct panel on selection.
  ensureAgentControlStrip();
  renderAgentInspector(id);
  renderSelectedAgentControls();
  // Visual flash feedback.
  const strip = document.getElementById("agent-control-strip");
  if (strip) {
    strip.style.outline = "2px solid var(--accent-primary)";
    setTimeout(() => { strip.style.outline = ""; }, 600);
  }
}

function renderAgentTaskUi() {
  ensureAgentControlStrip();
  const bar = document.getElementById("agent-command-bar");
  const hasAgent = aiAgents.length > 0;

  if (bar) {
    // In edit mode, controls live in the Spawned Agents tab.
    bar.style.display = appMode === "edit" ? "none" : "";
  }

  // In edit mode keep spawn visible so users can add parallel agents.
  if (spawnAiBtn) spawnAiBtn.style.display = hasAgent && appMode !== "edit" ? "none" : "";

  if (!agentTaskStatusEl || !agentTaskInputEl || !agentTaskStartBtn || !agentTaskEndBtn) return;

  if (!agentTask.active) {
    // Keep command bar clean: no persistent "Done (...)" suffixes.
    agentTaskStatusEl.textContent = "";
    agentTaskInputEl.disabled = false;
    // In edit mode we can auto-spawn worker agents when starting a task.
    agentTaskStartBtn.disabled = appMode === "edit" ? false : !hasAgent;
    agentTaskEndBtn.disabled = true;
    if (bar) bar.classList.remove("active");
  } else {
    agentTaskStatusEl.textContent = "Running";
    agentTaskInputEl.disabled = true;
    agentTaskStartBtn.disabled = true;
    agentTaskEndBtn.disabled = false;
    if (bar) bar.classList.add("active");
  }
  updateSimCameraModeToggleUi();
  renderSelectedAgentControls();
}

function updateSimCameraModeToggleUi() {
  if (!simCameraModeToggleBtn) return;
  const isUserCam = simUserCameraMode === "user";
  simCameraModeToggleBtn.textContent = isUserCam ? "Camera: User" : "Camera: Agent";
  simCameraModeToggleBtn.classList.toggle("active", isUserCam);
  simCameraModeToggleBtn.classList.toggle("tb-muted", !isUserCam);
  simCameraModeToggleBtn.title = isUserCam
    ? "Keep your user camera while the agent runs"
    : "Follow the active agent while the task runs";
}

function enableAgentCameraFollow(agentId = selectedAgentInspectorId) {
  if (aiAgents.length === 0) return;
  const target = getAgentById(agentId) || aiAgents[0];
  if (!target) return;
  agentCameraFollow = true;
  agentCameraFollowId = target.id;
  _agentFollowInitialized = false;
  
  // Unlock player controls so camera isn't fighting with pointer lock
  controls?.unlock?.();
  
  // Hide the player avatar
  avatar.visible = false;
  
  // Hide crosshair and interaction hints during follow mode
  const crosshair = document.getElementById("crosshair");
  if (crosshair) crosshair.style.display = "none";
  const hint = document.getElementById("interaction-hint");
  if (hint) hint.style.display = "none";
  
  console.log("[AGENT CAM] Following agent");
  renderSelectedAgentControls();
}

function disableAgentCameraFollow() {
  agentCameraFollow = false;
  agentCameraFollowId = null;
  
  // Show all agent meshes again
  for (const a of aiAgents) {
    if (a?.group) a.group.visible = true;
  }
  
  // Avatar mesh stays hidden (physics capsule still active)
  
  // Restore crosshair and interaction hints
  const crosshair = document.getElementById("crosshair");
  if (crosshair) crosshair.style.display = "";
  const hint = document.getElementById("interaction-hint");
  if (hint) hint.style.display = "";
  
  console.log("[AGENT CAM] Returning to player");
  renderSelectedAgentControls();
}

function updateAgentCameraFollow(dt) {
  if (!agentCameraFollow || aiAgents.length === 0) return;
  
  const agent = getAgentById(agentCameraFollowId) || aiAgents[0];
  if (!agent) return;
  const [ax, ay, az] = agent.getPosition?.() || [0, 0, 0];
  const yaw = agent.group?.rotation?.y ?? 0;
  const pitch = typeof agent.pitch === "number" ? agent.pitch : 0;
  
  // Place camera at agent's eye position (same as visionCapture.js)
  const eyeHeight = (agent.halfHeight || 0.25) + (agent.radius || 0.12) + 0.15;
  const eyeY = ay + eyeHeight;
  camera.position.set(ax, eyeY, az);
  
  // Compute forward direction exactly like visionCapture.js does
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const fx = Math.sin(yaw) * cp;
  const fy = sp;
  const fz = Math.cos(yaw) * cp;
  
  // Use lookAt to match the VLM capture camera
  camera.lookAt(ax + fx, eyeY + fy, az + fz);
  
  // Hide the agent's own mesh so it doesn't block the view
  if (agent.group) agent.group.visible = false;
}

async function startAgentTask(instruction, { autoPool = true, targetAgentId = null } = {}) {
  const text = String(instruction || "").trim();
  if (!text) return;

  // Editor mode: spin up a small worker pool for parallelized task execution.
  if (appMode === "edit" && autoPool && !targetAgentId) {
    await ensureEditorWorkerPool(EDITOR_TASK_WORKER_TARGET);
    if (aiAgents.length === 0) {
      setStatus("Couldn't spawn editor workers. Aim at a valid area and press Spawn.");
      return;
    }
  }

  const now = Date.now();
  const taskState = {
    active: true,
    instruction: text,
    startedAt: now,
    finishedAt: 0,
    finishedReason: "",
    lastSummary: "",
  };

  // Determine which agents get this task
  const target = targetAgentId ? getAgentById(targetAgentId) : null;
  agentTaskTargetId = target?.id || null;
  const targets = target ? [target] : aiAgents;

  for (const a of targets) {
    _setAgentTask(a.id, { ...taskState });
    a._taskStartedAt = now;
    if (a?.vlm) a.vlm.enabled = true;
  }

  agentUiPush(`${new Date().toLocaleTimeString()}\nTASK START\n${text}${target ? ` [${target.id}]` : ` [${targets.length} agents]`}`);
  renderAgentTaskUi();
  
  // Follow only when user selected agent camera mode.
  if (appMode === "sim" && simUserCameraMode === "agent") enableAgentCameraFollow();
}

function endAgentTask(reason = "manual", agentId = null) {
  if (agentId) {
    // End task for a specific agent
    const task = _agentTasks.get(agentId);
    if (task?.active) {
      task.active = false;
      task.finishedAt = Date.now();
      task.finishedReason = reason;
      _agentTasks.set(agentId, task);
    }
    agentUiPush(`${new Date().toLocaleTimeString()}\nTASK END (${reason}) [${agentId}]`);
  } else {
    // End all tasks
    for (const [id, task] of _agentTasks) {
      if (task.active) {
        task.active = false;
        task.finishedAt = Date.now();
        task.finishedReason = reason;
      }
    }
    agentTask.active = false;
    agentTask.finishedAt = Date.now();
    agentTask.finishedReason = reason;
    agentUiPush(`${new Date().toLocaleTimeString()}\nTASK END ALL (${reason})`);
  }
  agentTaskTargetId = null;

  // Check if any agent still has an active task
  const anyActive = [..._agentTasks.values()].some((t) => t.active);
  if (!anyActive) {
    agentTask.active = false;
    disableAgentCameraFollow();
  }

  renderAgentTaskUi();

  // Editor worker agents are ephemeral: complete/stop -> vanish.
  if (appMode === "edit") {
    despawnEphemeralAgents("task-end");
  }
}

function rebuildTagMarkers() {
  while (tagsGroup.children.length) tagsGroup.remove(tagsGroup.children[0]);

  for (const t of tags) {
    if (!t.position) continue;
    const m = new THREE.Mesh(markerGeom, t.id === selectedTagId ? markerMatActive : markerMat);
    m.position.set(t.position.x, t.position.y, t.position.z);
    m.userData.tagId = t.id;
    m.renderOrder = 1000;
    tagsGroup.add(m);

    const r = Number(t.radius ?? 1.5);
    const shell = new THREE.Mesh(radiusGeom, radiusMat);
    shell.position.copy(m.position);
    shell.scale.setScalar(Math.max(0.01, r));
    shell.userData.tagId = t.id;
    shell.userData.isRadius = true;
    tagsGroup.add(shell);
  }

  updateMarkerMaterials();
}

function updateMarkerMaterials() {
  for (const child of tagsGroup.children) {
    if (!child.isMesh) continue;
    if (child.userData?.isRadius) continue;
    child.material = child.userData.tagId === selectedTagId ? markerMatActive : markerMat;
  }
}

function showModal(show) {
  if (!modalEl) return;
  // When modal opens, ensure pointer lock and movement/controls don't steal focus from inputs.
  if (show) {
    controls?.unlock?.();
    controls.enabled = false;
  } else {
    controls.enabled = true;
  }
  modalEl.classList.toggle("hidden", !show);
  modalEl.setAttribute("aria-hidden", show ? "false" : "true");
  if (show) {
    // Focus first input so keyboard immediately works (and stays focused).
    queueMicrotask(() => assetTitleEl?.focus?.());
  }
}

// Prevent global key handlers from interfering with typing inside the modal.
modalEl?.addEventListener("keydown", (e) => {
  e.stopPropagation();
});

function renderAssetModal() {
  if (!pendingAssetUpload) return;
  const states = pendingAssetUpload.states || [];
  const renderStateOptions = (selectedId) =>
    states
      .map((s) => {
        const id = escapeHtml(s.id);
        const label = escapeHtml(s.name || s.glbName || s.id);
        const sel = selectedId === s.id ? " selected" : "";
        return `<option value="${id}"${sel}>${label}</option>`;
      })
      .join("");

  if (assetStatesContainerEl) {
    assetStatesContainerEl.innerHTML = states
      .map((s, idx) => {
        const checked = pendingAssetUpload.currentStateId === s.id ? "checked" : "";
        const hasFile = s.dataBase64 ? "✓" : "Pick .glb";
        if (!Array.isArray(s.interactions)) s.interactions = [];
        return `
<div class="asset-state-row" data-state-id="${escapeHtml(s.id)}">
  <div class="asset-state-row-top">
    <label><input type="radio" name="asset-initial-state" value="${escapeHtml(s.id)}" ${checked}/> Initial</label>
    <input data-field="name" type="text" value="${escapeHtml(s.name || `state ${idx + 1}`)}" placeholder="State name" />
    <label class="file"><input data-field="file" type="file" accept=".glb" /><span>${escapeHtml(hasFile)}</span></label>
    ${states.length > 1 ? `<button data-action="remove" type="button">Remove</button>` : ""}
  </div>
  <div style="font-size:12px;color:var(--muted);font-weight:700;">${escapeHtml(s.glbName || "")}</div>
  <div class="asset-interactions-title">Interactions</div>
  <div class="asset-interactions">
    ${(s.interactions || [])
      .map((it) => {
        const id = escapeHtml(it.id);
        const label = escapeHtml(it.label || "");
        return `<div class="asset-interaction-row" data-interaction-id="${id}">
  <input data-field="ilabel" type="text" value="${label}" placeholder="Action label (e.g. open / turn on)" />
  <select data-field="ito" class="select">${renderStateOptions(it.to)}</select>
  <button data-action="remove-interaction" type="button">Remove</button>
</div>`;
      })
      .join("")}
    <div class="tag-panel-row" style="margin-top:6px;">
      <button data-action="add-interaction" type="button">Add interaction</button>
    </div>
  </div>
</div>`;
      })
      .join("");
  }
}

function base64FromArrayBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function arrayBufferFromBase64(base64) {
  const bin = atob(base64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function normalizeAsset(a) {
  if (!a || typeof a !== "object") return null;
  // Ensure pickable property exists
  if (typeof a.pickable !== "boolean") a.pickable = false;
  if (typeof a.bumpable !== "boolean") a.bumpable = false;
  if (!Number.isFinite(a.bumpResponse)) a.bumpResponse = 0.9;
  if (!Number.isFinite(a.bumpDamping)) a.bumpDamping = 0.9;
  // New schema: states is array
  if (Array.isArray(a.states)) {
    if (!a.currentStateId && a.states[0]?.id) a.currentStateId = a.states[0].id;
    // Ensure interactions exist per state.
    for (const s of a.states) {
      if (!Array.isArray(s.interactions)) s.interactions = [];
    }
    // Backfill actions from interactions if missing.
    if (!Array.isArray(a.actions) || a.actions.length === 0) {
      a.actions = [];
      for (const s of a.states) {
        for (const it of s.interactions) {
          a.actions.push({ id: it.id || `act_${s.id}_${it.to}`, label: it.label || "toggle", from: s.id, to: it.to });
        }
      }
    } else {
      // Backfill interactions from actions if missing.
      const byFrom = new Map();
      for (const act of a.actions) {
        if (!byFrom.has(act.from)) byFrom.set(act.from, []);
        byFrom.get(act.from).push({ id: act.id, label: act.label, to: act.to });
      }
      for (const s of a.states) {
        if (!s.interactions || s.interactions.length === 0) s.interactions = byFrom.get(s.id) || [];
      }
    }
    return a;
  }
  // Old schema: states is {A,B}
  if (a.states && typeof a.states === "object") {
    const out = {
      id: a.id,
      title: a.title || "",
      notes: a.notes || "",
      states: [],
      currentStateId: a.currentState || "A",
      actions: Array.isArray(a.actions) ? a.actions : [],
      transform: a.transform || null,
      bumpable: a.bumpable === true,
      bumpResponse: Number.isFinite(a.bumpResponse) ? a.bumpResponse : 0.9,
      bumpDamping: Number.isFinite(a.bumpDamping) ? a.bumpDamping : 0.9,
    };
    const A = a.states.A;
    const B = a.states.B;
    if (A) out.states.push({ id: "A", name: A.name || "stateA", glbName: A.glbName || "", dataBase64: A.dataBase64 || "", interactions: [] });
    if (B) out.states.push({ id: "B", name: B.name || "stateB", glbName: B.glbName || "", dataBase64: B.dataBase64 || "", interactions: [] });
    if (!out.currentStateId) out.currentStateId = out.states[0]?.id || "A";
    out.actions = Array.isArray(out.actions) ? out.actions : [];
    // Backfill interactions from actions.
    const byFrom = new Map();
    for (const act of out.actions) {
      if (!byFrom.has(act.from)) byFrom.set(act.from, []);
      byFrom.get(act.from).push({ id: act.id, label: act.label, to: act.to });
    }
    for (const s of out.states) s.interactions = byFrom.get(s.id) || [];
    return out;
  }
  return a;
}

function getSelectedAsset() {
  return assets.find((a) => a.id === selectedAssetId) || null;
}

function renderAssetsList() {
  if (!assetsListEl) return;
  assetsListEl.innerHTML = "";
  for (const a of assets) {
    const el = document.createElement("div");
    el.className = "tag-item" + (a.id === selectedAssetId ? " active" : "");
    const sId = a.currentStateId || a.currentState || "A";
    const stateObj = Array.isArray(a.states) ? a.states.find((s) => s.id === sId) : a.states?.[sId];
    const label = a.title || stateObj?.glbName || "(asset)";
    const kind = a.isPortal ? "portal" : (stateObj?.scene || stateObj?.shapeScene ? "shape" : "glb");
    el.innerHTML = `${escapeHtml(label)}<small>${kind}</small>`;
    el.addEventListener("click", () => selectAsset(a.id));
    assetsListEl.appendChild(el);
  }
  updateOutlinerCounts();
}

function selectAsset(id) {
  detachGroupTransform();
  selectedGroupId = null;
  const gd = document.getElementById("group-details");
  if (gd) gd.remove();

  selectedAssetId = id;
  if (id) {
    selectedPrimitiveId = null;
    selectedLightId = null;
    selectedSceneLightId = null;
    renderPrimitivesList();
    renderPrimitiveProps();
    renderLightsList();
    renderLightProps();
    renderSceneLightsList();
    renderSceneLightProps();
  }
  renderAssetsList();
  updateDetailsPanel();
  const obj = assetsGroup.getObjectByName(`asset:${id}`);
  if (appMode === "edit" && obj) {
    transformControls.attach(obj);
    transformControls.enabled = true;
    transformControls.visible = true;
  } else {
    transformControls.detach();
    transformControls.enabled = false;
    transformControls.visible = false;
  }
  // Update debug buttons availability.
  if (assetInteractSelectedBtn) {
    const a = getSelectedAsset();
    const cur = a?.currentStateId || a?.currentState || "A";
    const outs = (a?.actions || []).filter((x) => x.from === cur);
    assetInteractSelectedBtn.disabled = !(a && outs.length);
    if (assetInteractActionEl) {
      assetInteractActionEl.innerHTML = outs
        .map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.label || "interact")} → ${escapeHtml(x.to)}</option>`)
        .join("");
      assetInteractActionEl.disabled = !(a && outs.length);
    }
  }
  if (assetDeleteSelectedBtn) assetDeleteSelectedBtn.disabled = !getSelectedAsset();
  if (assetDuplicateSelectedBtn) assetDuplicateSelectedBtn.disabled = !getSelectedAsset();
  if (assetEditStatesSelectedBtn) assetEditStatesSelectedBtn.disabled = !getSelectedAsset();
  // Populate shadow checkboxes and blob shadow controls
  const selAsset = getSelectedAsset();
  if (assetCastShadowEl) assetCastShadowEl.checked = selAsset?.castShadow === true;
  if (assetReceiveShadowEl) assetReceiveShadowEl.checked = selAsset?.receiveShadow === true;
  if (assetSelectedPickableEl) assetSelectedPickableEl.checked = selAsset?.pickable === true;
  if (assetBumpableEl) assetBumpableEl.checked = selAsset?.bumpable === true;
  if (assetBumpControlsEl) assetBumpControlsEl.classList.toggle("hidden", !(selAsset?.bumpable));
  if (assetBumpResponseEl) assetBumpResponseEl.value = String(selAsset?.bumpResponse ?? 0.9);
  if (assetBumpResponseValEl) assetBumpResponseValEl.textContent = Number(selAsset?.bumpResponse ?? 0.9).toFixed(2);
  if (assetBumpDampingEl) assetBumpDampingEl.value = String(selAsset?.bumpDamping ?? 0.9);
  if (assetBumpDampingValEl) assetBumpDampingValEl.textContent = Number(selAsset?.bumpDamping ?? 0.9).toFixed(2);
  // Show/hide blob shadow sub-controls based on castShadow state
  if (blobShadowControlsEl) blobShadowControlsEl.classList.toggle("hidden", !(selAsset?.castShadow));
  if (selAsset?.castShadow) {
    const bs = selAsset.blobShadow || {};
    if (blobShadowOpacityEl) { blobShadowOpacityEl.value = bs.opacity ?? 0.5; }
    if (blobShadowOpacityValEl) blobShadowOpacityValEl.textContent = (bs.opacity ?? 0.5).toFixed(2);
    if (blobShadowScaleEl) { blobShadowScaleEl.value = bs.scale ?? 1.0; }
    if (blobShadowScaleValEl) blobShadowScaleValEl.textContent = (bs.scale ?? 1.0).toFixed(2);
    if (blobShadowStretchEl) { blobShadowStretchEl.value = bs.stretch ?? 1.0; }
    if (blobShadowStretchValEl) blobShadowStretchValEl.textContent = (bs.stretch ?? 1.0).toFixed(2);
    if (blobShadowRotEl) { blobShadowRotEl.value = bs.rotationDeg ?? 0; }
    if (blobShadowRotValEl) blobShadowRotValEl.textContent = `${Math.round(bs.rotationDeg ?? 0)}°`;
    if (blobShadowOxEl) blobShadowOxEl.value = bs.offsetX ?? 0;
    if (blobShadowOyEl) blobShadowOyEl.value = bs.offsetY ?? 0;
    if (blobShadowOzEl) blobShadowOzEl.value = bs.offsetZ ?? 0;
  }

  // Update transform toolbar state.
  const hasSel = !!getSelectedAsset();
  if (assetToolMoveBtn) assetToolMoveBtn.disabled = !hasSel;
  if (assetToolRotateBtn) assetToolRotateBtn.disabled = !hasSel;
  if (assetToolScaleBtn) assetToolScaleBtn.disabled = !hasSel;
  const mode = transformControls?.getMode?.() || "translate";
  assetToolMoveBtn?.classList.toggle("active", hasSel && mode === "translate");
  assetToolRotateBtn?.classList.toggle("active", hasSel && mode === "rotate");
  assetToolScaleBtn?.classList.toggle("active", hasSel && mode === "scale");
}

function persistSelectedAssetTransform() {
  const a = getSelectedAsset();
  if (!a) return;
  const obj = assetsGroup.getObjectByName(`asset:${a.id}`);
  if (!obj) return;
  a.transform = {
    position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
    rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
    scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
  };
  saveTagsForWorld();
  if (!a.bumpable) rebuildAssetCollider(a.id);
}

function normalizeShapeStateScene(sceneLike) {
  const raw = sceneLike || { tags: [], primitives: [], lights: [], groups: [] };
  return {
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    primitives: Array.isArray(raw.primitives) ? raw.primitives : [],
    lights: Array.isArray(raw.lights) ? raw.lights : [],
    groups: Array.isArray(raw.groups) ? raw.groups : [],
  };
}

function buildShapeStateRoot(state, assetId, fixedPivotCenter = null) {
  const sceneState = normalizeShapeStateScene(state?.scene || state?.shapeScene);
  const root = new THREE.Group();
  const primMap = new Map();
  for (const p of sceneState.primitives) {
    const geom = createPrimitiveGeometry(p.type, p.dimensions || {});
    const mat = createPrimitiveMaterial(p.material || {});
    const mesh = new THREE.Mesh(geom, mat);
    applyPrimitiveCutoutShader(mesh, p);
    mesh.name = `assetPrim:${assetId}:${p.id || randId()}`;
    mesh.userData.assetId = assetId;
    mesh.userData.isAssetPrimitive = true;
    mesh.castShadow = p.castShadow !== false;
    mesh.receiveShadow = p.receiveShadow !== false;
    const tr = p.transform || {};
    if (tr.position) mesh.position.set(tr.position.x || 0, tr.position.y || 0, tr.position.z || 0);
    if (tr.rotation) mesh.rotation.set(tr.rotation.x || 0, tr.rotation.y || 0, tr.rotation.z || 0);
    if (tr.scale) mesh.scale.set(tr.scale.x ?? 1, tr.scale.y ?? 1, tr.scale.z ?? 1);
    root.add(mesh);
    if (p.id) primMap.set(p.id, mesh);
  }
  for (const g of sceneState.groups || []) {
    if (!Array.isArray(g.children) || g.children.length === 0) continue;
    const subgroup = new THREE.Group();
    subgroup.name = `assetGroup:${assetId}:${g.id || randId()}`;
    root.add(subgroup);
    for (const cid of g.children) {
      const child = primMap.get(cid);
      if (!child) continue;
      subgroup.add(child);
    }
  }

  // Re-center: move the pivot to the bounding-box center so the transform
  // gizmo appears on the asset rather than at an arbitrary offset.
  root.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(root);
  if (!bbox.isEmpty()) {
    const autoCenter = bbox.getCenter(new THREE.Vector3());
    const center = fixedPivotCenter ? fixedPivotCenter.clone() : autoCenter;
    for (const child of root.children) {
      child.position.sub(center);
    }
    root.position.copy(center);
    root.userData._pivotCenter = center.clone();
  }

  return root;
}

function disposeShapeStateRoot(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (!obj?.isMesh) return;
    obj.geometry?.dispose?.();
    disposePrimitiveMaterial(obj.material);
  });
}

async function instantiateAsset(a) {
  // Handle portals specially
  if (a?.isPortal) {
    await instantiatePortalAsset(a);
    return;
  }
  
  if (!a?.states) return;
  const sId = a.currentStateId || a.currentState || (Array.isArray(a.states) ? a.states[0]?.id : "A");
  const state = Array.isArray(a.states)
    ? a.states.find((s) => s.id === sId) || a.states[0]
    : a.states[sId] || a.states.A;
  let root = null;
  if (state?.scene || state?.shapeScene) {
    let fixedPivotCenter = null;
    if (a._shapePivotCenter
      && Number.isFinite(a._shapePivotCenter.x)
      && Number.isFinite(a._shapePivotCenter.y)
      && Number.isFinite(a._shapePivotCenter.z)) {
      fixedPivotCenter = new THREE.Vector3(a._shapePivotCenter.x, a._shapePivotCenter.y, a._shapePivotCenter.z);
    } else if (Array.isArray(a.states) && a.states.length > 0) {
      const anchorState = a.states[0];
      const anchorRoot = buildShapeStateRoot(anchorState, `${a.id}:anchor`);
      const anchorCenter = anchorRoot.userData?._pivotCenter;
      if (anchorCenter) {
        fixedPivotCenter = anchorCenter.clone();
        a._shapePivotCenter = { x: anchorCenter.x, y: anchorCenter.y, z: anchorCenter.z };
      }
      disposeShapeStateRoot(anchorRoot);
    }
    root = buildShapeStateRoot(state, a.id, fixedPivotCenter);
    const rootCenter = root.userData?._pivotCenter;
    if (rootCenter && !a._shapePivotCenter) {
      a._shapePivotCenter = { x: rootCenter.x, y: rootCenter.y, z: rootCenter.z };
    }
  } else if (state?.dataBase64) {
    const buf = arrayBufferFromBase64(state.dataBase64);
    const url = URL.createObjectURL(new Blob([buf], { type: "model/gltf-binary" }));
    const gltf = await new Promise((resolve, reject) => {
      gltfLoader.load(url, (g) => resolve(g), undefined, (e) => reject(e));
    });
    URL.revokeObjectURL(url);
    root = gltf.scene;
  } else {
    return;
  }
  root.name = `asset:${a.id}`;
  const wantShadow = a.castShadow === true; // opt-in, default OFF
  const wantReceive = a.receiveShadow === true; // opt-in, default OFF

  root.traverse((m) => {
    if (m.isMesh) {
      if (!m.userData?.isAssetPrimitive) m.castShadow = false; // GLB assets keep cheap shadow behavior
      m.receiveShadow = wantReceive;
      m.userData.assetId = a.id;
    }
  });

  // Pre-compute local bounding sphere ONCE (cached — never call setFromObject again)
  const bbox = new THREE.Box3().setFromObject(root);
  const localSphere = new THREE.Sphere();
  bbox.getBoundingSphere(localSphere);
  const localCenter = localSphere.center.clone();
  root.worldToLocal(localCenter);
  root.userData._localSphereCenter = localCenter;
  root.userData._localSphereRadius = Math.max(localSphere.radius, 0.2);

  // Blob shadow: a cheap flat gradient circle beneath the asset.
  // Uses zero shadow-map resources — just a textured plane with transparency.
  if (wantShadow) {
    const bboxSize = bbox.getSize(new THREE.Vector3());
    const localGroundY = bbox.min.y + 0.005;
    const blob = createBlobShadow(a.id, bboxSize.x, bboxSize.z, localGroundY, {
      opacity: a.blobShadow?.opacity ?? 0.5,
      scale: a.blobShadow?.scale ?? 1.0,
      stretch: a.blobShadow?.stretch ?? 1.0,
      rotationDeg: a.blobShadow?.rotationDeg ?? 0,
      offsetX: a.blobShadow?.offsetX ?? 0,
      offsetY: a.blobShadow?.offsetY ?? 0,
      offsetZ: a.blobShadow?.offsetZ ?? 0,
    });
    if (blob) root.add(blob);
  }

  const tr = a.transform || {};
  if (tr.position) root.position.set(tr.position.x, tr.position.y, tr.position.z);
  if (tr.rotation) root.rotation.set(tr.rotation.x, tr.rotation.y, tr.rotation.z);
  if (tr.scale) root.scale.set(tr.scale.x, tr.scale.y, tr.scale.z);
  assetsGroup.add(root);
  await rebuildAssetCollider(a.id);
}

async function setAssetState(assetId, nextState) {
  const a = assets.find((x) => x.id === assetId);
  if (!a) return;
  const exists = Array.isArray(a.states) ? a.states.some((s) => s.id === nextState) : !!a.states?.[nextState];
  if (!exists) return;
  a.currentStateId = nextState;
  saveTagsForWorld();
  // Replace visual
  const existing = assetsGroup.getObjectByName(`asset:${a.id}`);
  if (existing?.parent) existing.parent.remove(existing);
  await instantiateAsset(a);
  renderAssetsList();
  selectAsset(a.id);
}

async function applyAssetAction(assetId, actionId) {
  const a = assets.find((x) => x.id === assetId);
  if (!a) return false;
  
  // Handle portal interactions specially
  if (a.isPortal && a.destinationWorld) {
    console.log(`[PORTAL] Entering portal to: ${a.destinationWorld}`);
    const destWorld = WORLDS_MANIFEST.find(w => w.id === a.destinationWorld);
    const destName = destWorld?.name || a.destinationWorld;
    
    // Show loading screen
    showPortalLoading(destName);
    setStatus(`Traveling to ${destName}...`);
    
    // Store spawn position from linked portal (if exists)
    const spawnPos = a.linkedPortalPosition || null;
    
    // Small delay for visual effect
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Load the destination world with spawn position
    await loadWorldViaPortal(a.destinationWorld, spawnPos, a.linkedPortalId);
    
    // Hide loading screen after a short delay
    await new Promise(resolve => setTimeout(resolve, 300));
    hidePortalLoading();
    
    return true;
  }
  
  const act = (a.actions || []).find((x) => x.id === actionId) || null;
  if (!act) return false;
  const cur = a.currentStateId || a.currentState || "A";
  if (cur !== act.from) return false;
  await setAssetState(assetId, act.to);
  return true;
}

// Special world loader for portal travel
async function loadWorldViaPortal(worldId, spawnPosition, linkedPortalId) {
  console.log(`[PORTAL] Loading world via portal: ${worldId}`, { spawnPosition, linkedPortalId });
  
  // Use the regular loadWorld function
  await loadWorld(worldId);
  
  // Small delay to ensure physics world is ready
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // Try to find the destination portal in this world to get accurate spawn position
  let finalSpawnPos = spawnPosition;
  
  if (linkedPortalId) {
    const destPortal = assets.find(a => a.id === linkedPortalId);
    if (destPortal?.transform?.position) {
      finalSpawnPos = destPortal.transform.position;
      console.log(`[PORTAL] Found destination portal, using its position:`, finalSpawnPos);
    }
  }
  
  // Teleport player to spawn position at ground level
  if (finalSpawnPos) {
    const spawnX = finalSpawnPos.x || 0;
    const spawnZ = finalSpawnPos.z || 0;
    
    // Portal's y position is at its base/ground level
    // Player body should be at ground + ~0.9m (half capsule height)
    const groundY = finalSpawnPos.y || 0;
    const playerBodyY = groundY + 0.9;
    
    console.log(`[PORTAL] Teleporting to: x=${spawnX.toFixed(2)}, bodyY=${playerBodyY.toFixed(2)}, z=${spawnZ.toFixed(2)}`);
    
    // Use the teleport function to set physics body
    teleportPlayerTo(spawnX, playerBodyY, spawnZ);
    
    // Camera will be synced automatically in the next updateRapier tick
    // But force sync now for immediate effect
    if (controls?.object) {
      const eyeY = playerBodyY + PLAYER_EYE_HEIGHT;
      controls.object.position.set(spawnX, eyeY, spawnZ);
      console.log(`[PORTAL] Camera set to: x=${spawnX.toFixed(2)}, y=${eyeY.toFixed(2)}, z=${spawnZ.toFixed(2)}`);
    }
  }
}

function getNearbyAssetsForAgent(agent, maxDist = 1.0) {
  const [ax, ay, az] = agent.getPosition?.() || [0, 0, 0];
  const yaw = agent.group?.rotation?.y ?? 0;
  const pitch = typeof agent.pitch === "number" ? agent.pitch : 0;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  
  // Full 3D forward direction (with pitch) - used for raycasting
  const forward3D = _tmpV1.set(Math.sin(yaw) * cp, sp, Math.cos(yaw) * cp).normalize();
  
  // Horizontal-only forward direction (yaw only, no pitch) - used for "in front" check
  // BUG FIX: Previously used forward3D which includes pitch, causing dot product to be
  // artificially reduced when looking up/down (cos(pitch) scaling factor)
  const forwardHoriz = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
  
  const eye = _tmpV2.set(ax, ay + PLAYER_EYE_HEIGHT * 0.9, az);

  const results = [];
  for (const a of assets) {
    const obj = assetsGroup.getObjectByName(`asset:${a.id}`);
    if (!obj) continue;
    
    // Use cached sphere center (O(1) — no vertex traversal)
    const _agentSphere = new THREE.Sphere();
    if (!getAssetWorldSphere(obj, _agentSphere)) continue;
    const center = _agentSphere.center;
    
    const dx = center.x - ax;
    const dy = center.y - ay;
    const dz = center.z - az;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > maxDist) continue;

    // Horizontal direction to object (for "in front" check)
    const toHoriz = _tmpV3.set(dx, 0, dz);
    const horizLen = toHoriz.length() || 1;
    toHoriz.multiplyScalar(1 / horizLen);
    
    // BUG FIX: Use horizontal forward for horizontal "in front" check
    // Threshold relaxed from 0.92 (~23°) to 0.7 (~45°) for better usability
    const inFrontHoriz = forwardHoriz.dot(toHoriz) > 0.7;

    let isLookedAt = false;
    
    // Debug: log for specific asset checks
    const debugThis = a.title?.toLowerCase().includes('bathtub') || a.title?.toLowerCase().includes('tub');
    
    if (debugThis) {
      console.log(`[RAYCAST DEBUG] Checking "${a.title}" (${a.id})`);
      console.log(`  Eye position:`, eye.toArray().map(v => v.toFixed(2)));
      console.log(`  Object center:`, [center.x.toFixed(2), center.y.toFixed(2), center.z.toFixed(2)]);
      console.log(`  Forward3D:`, forward3D.toArray().map(v => v.toFixed(2)));
      console.log(`  ForwardHoriz:`, [forwardHoriz.x.toFixed(2), forwardHoriz.y.toFixed(2), forwardHoriz.z.toFixed(2)]);
      console.log(`  ToHoriz:`, [toHoriz.x.toFixed(2), toHoriz.y.toFixed(2), toHoriz.z.toFixed(2)]);
      const dotVal = forwardHoriz.dot(toHoriz);
      console.log(`  Horiz dot product:`, dotVal.toFixed(3), `(need > 0.7 for inFront, > 0.3 for proximity)`);
      console.log(`  inFrontHoriz (>0.7):`, inFrontHoriz);
      console.log(`  roughlyInFront (>0.3):`, dotVal > 0.3);
    }
    
    // For interaction purposes, we use a very lenient "roughly in front" check
    // The bounding box center can be off to the side for wide objects
    const roughlyInFront = forwardHoriz.dot(toHoriz) > 0.3; // ~72° cone
    
    if (inFrontHoriz || roughlyInFront) {
      // Cheap bounding-sphere ray test instead of expensive recursive mesh raycast
      const objNode = assetsGroup.getObjectByName(`asset:${a.id}`);
      if (objNode) {
        const _tmpSphere = new THREE.Sphere();
        if (!getAssetWorldSphere(objNode, _tmpSphere)) { /* skip */ }
        _tmpSphere.radius = Math.max(_tmpSphere.radius, 0.3);
        
        // Test look direction against bounding sphere
        const lookRay = new THREE.Ray(eye, forward3D);
        if (lookRay.intersectsSphere(_tmpSphere)) {
          isLookedAt = true;
        }
        
        // Also test toward center direction (catches pitch misalignment)
        if (!isLookedAt) {
          const toCenter = new THREE.Vector3(
            center.x - eye.x, center.y - eye.y, center.z - eye.z
          ).normalize();
          const lookAlignment = forward3D.dot(toCenter);
          if (lookAlignment > 0.5) {
            const centerRay = new THREE.Ray(eye, toCenter);
            if (centerRay.intersectsSphere(_tmpSphere)) {
              isLookedAt = true;
            }
          }
        }
      }
    }
    
    // Method 3: If close enough and roughly in front, allow interaction even if raycast fails
    // This handles cases where:
    // - Mesh geometry doesn't raycast well
    // - Wide objects have their center off to the side
    if (!isLookedAt && dist < 1.5 && roughlyInFront) {
      if (debugThis) {
        console.log(`  Method 3 (proximity fallback): dist=${dist.toFixed(2)}, roughlyInFront=${roughlyInFront}`);
      }
      isLookedAt = true;
    }
    
    if (debugThis) {
      console.log(`  Final isLookedAt:`, isLookedAt);
    }

    const stateKey = a.currentStateId || a.currentState || "A";
    const stateObj = Array.isArray(a.states)
      ? a.states.find((s) => s.id === stateKey)
      : a.states?.[stateKey];
    const stateName = stateObj?.name || stateKey;
    const holdStatus = isAssetHeld(a.id);
    results.push({
      id: a.id,
      title: a.title || "",
      notes: a.notes || "",
      dist,
      isLookedAt,
      currentState: stateKey,
      currentStateName: stateName,
      actions: (a.actions || []).filter((x) => x.from === stateKey).map((x) => ({ id: x.id, label: x.label, from: x.from, to: x.to })),
      pickable: a.pickable || false,
      isPortal: a.isPortal || false,
      destinationWorld: a.destinationWorld || null,
      isHeld: holdStatus.held,
      heldBy: holdStatus.by || null,
    });
  }

  results.sort((a, b) => a.dist - b.dist);
  return results.slice(0, 20);
}

function getNearbyPrimitivesForAgent(agent, maxDist = 2.5) {
  const [ax, ay, az] = agent.getPosition?.() || [0, 0, 0];
  const yaw = agent.group?.rotation?.y ?? 0;
  const pitch = typeof agent.pitch === "number" ? agent.pitch : 0;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const forward3D = _tmpV1.set(Math.sin(yaw) * cp, sp, Math.cos(yaw) * cp).normalize();
  const forwardHoriz = _tmpV2.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
  const eye = _tmpV3.set(ax, ay + PLAYER_EYE_HEIGHT * 0.9, az);

  const out = [];
  for (const p of primitives) {
    const obj = primitivesGroup.getObjectByName(`prim:${p.id}`);
    if (!obj) continue;
    const center = obj.getWorldPosition(new THREE.Vector3());
    const dx = center.x - ax;
    const dy = center.y - ay;
    const dz = center.z - az;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > maxDist) continue;

    const toObj = new THREE.Vector3(center.x - eye.x, center.y - eye.y, center.z - eye.z).normalize();
    const toHoriz = new THREE.Vector3(dx, 0, dz);
    const horizLen = toHoriz.length() || 1;
    toHoriz.multiplyScalar(1 / horizLen);
    const lookAlignment = forward3D.dot(toObj);
    const horizAlignment = forwardHoriz.dot(toHoriz);
    const isLookedAt = lookAlignment > 0.82 || (dist < 1.6 && horizAlignment > 0.35);

    out.push({
      id: p.id,
      name: p.name || p.type || "primitive",
      type: p.type || "primitive",
      dist,
      isLookedAt,
    });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out.slice(0, 20);
}

function agentCreatePrimitiveInEditor({ shape, agent = null }) {
  if (appMode !== "edit") return { ok: false, reason: "not-edit-mode" };
  const allowed = new Set(["box", "sphere", "cylinder", "cone", "torus", "plane"]);
  const type = String(shape || "box").toLowerCase();
  if (!allowed.has(type)) return { ok: false, reason: "invalid-shape" };
  const placement = agent
    ? getPlacementFromAgentView(agent, { raycastDistance: 500, fallbackDistance: 2.5, surfaceOffset: 0.5 })
    : getPlacementAtCrosshair({ raycastDistance: 250, surfaceOffset: 0.5 });
  if (agent && !placement.hit) return { ok: false, reason: "no-surface-in-view" };
  addPrimitiveAtPosition(type, placement.position);
  return { ok: true, createdId: selectedPrimitiveId, type };
}

function findAssetLibraryRecordByName(name) {
  const q = String(name || "").trim().toLowerCase();
  if (!q) return null;
  const records = readAssetLibraryRecords();
  if (!Array.isArray(records) || records.length === 0) return null;
  let exact = records.find((r) => String(r?.name || "").trim().toLowerCase() === q);
  if (exact) return exact;
  let starts = records.find((r) => String(r?.name || "").trim().toLowerCase().startsWith(q));
  if (starts) return starts;
  return records.find((r) => String(r?.name || "").trim().toLowerCase().includes(q)) || null;
}

function normalizeAgentAssetPrompt(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getAgentRecentGeneratedAssets(agent, limit = 6) {
  const list = Array.isArray(agent?._recentGeneratedAssets) ? agent._recentGeneratedAssets : [];
  return list.slice(-Math.max(1, Number(limit) || 6)).reverse();
}

async function agentSpawnLibraryAssetInEditor({ assetName, agent = null }) {
  if (appMode !== "edit") return { ok: false, reason: "not-edit-mode" };
  const rec = findAssetLibraryRecordByName(assetName);
  if (!rec) return { ok: false, reason: "asset-not-found" };
  const placement = agent
    ? getPlacementFromAgentView(agent, { raycastDistance: 500, fallbackDistance: 2.5, surfaceOffset: 0.02 })
    : getPlacementAtCrosshair({ raycastDistance: 500, surfaceOffset: 0.02 });
  if (agent && !placement.hit) return { ok: false, reason: "no-surface-in-view" };
  await spawnShapeLibraryAsset(rec, {
    targetX: placement.position.x,
    targetY: placement.position.y,
    targetZ: placement.position.z,
  });
  return { ok: true, assetId: selectedAssetId || null, assetName: rec.name || "" };
}

async function agentGenerateAssetInEditor({ agent = null, prompt, placeNow = true, allowMultiple = false, count = 1 } = {}) {
  if (appMode !== "edit") return { ok: false, reason: "not-edit-mode" };
  const text = String(prompt || "").trim();
  if (!text) return { ok: false, reason: "missing-prompt" };
  if (!vibeCreatorApi?.createAssetHeadless) return { ok: false, reason: "vibe-api-unavailable" };
  const normalizedPrompt = normalizeAgentAssetPrompt(text);
  const taskEpoch = Number(agentTask?.startedAt || 0);
  const multiRequested = !!allowMultiple || Number(count) > 1;

  if (agent) {
    if (!agent._editorAssetGenState || Number(agent._editorAssetGenState.taskEpoch || 0) !== taskEpoch) {
      agent._editorAssetGenState = { taskEpoch, byPrompt: new Map() };
      agent._recentGeneratedAssets = [];
    }
    const prev = agent._editorAssetGenState.byPrompt.get(normalizedPrompt) || null;
    if (prev && !multiRequested) {
      if (prev.placedAssetId) {
        selectAsset(prev.placedAssetId);
      }
      setStatus(`Agent reused generated asset: ${prev.assetName || "asset"}`);
      return {
        ok: true,
        reused: true,
        assetName: prev.assetName || "",
        assetId: prev.placedAssetId || null,
        placed: !!prev.placedAssetId,
      };
    }
  }

  setStatus("Agent generating asset (headless)...");
  const rec = await vibeCreatorApi.createAssetHeadless(text);
  if (!rec) return { ok: false, reason: "generation-failed" };

  let placedAssetId = null;
  if (placeNow !== false) {
    const placement = agent
      ? getPlacementFromAgentView(agent, { raycastDistance: 500, fallbackDistance: 2.5, surfaceOffset: 0.02 })
      : getPlacementAtCrosshair({ raycastDistance: 500, surfaceOffset: 0.02 });
    placedAssetId = await spawnShapeLibraryAsset(rec, {
      targetX: placement.position.x,
      targetY: placement.position.y,
      targetZ: placement.position.z,
    });
  }
  if (agent) {
    if (!agent._editorAssetGenState || Number(agent._editorAssetGenState.taskEpoch || 0) !== taskEpoch) {
      agent._editorAssetGenState = { taskEpoch, byPrompt: new Map() };
      agent._recentGeneratedAssets = [];
    }
    agent._editorAssetGenState.byPrompt.set(normalizedPrompt, {
      assetName: rec.name || "",
      placedAssetId: placedAssetId || null,
      createdAt: Date.now(),
    });
    const recent = Array.isArray(agent._recentGeneratedAssets) ? agent._recentGeneratedAssets : [];
    recent.push({
      id: placedAssetId || "",
      name: rec.name || "",
      prompt: text,
      createdAt: Date.now(),
    });
    if (recent.length > 12) recent.splice(0, recent.length - 12);
    agent._recentGeneratedAssets = recent;
  }
  setStatus(`Agent generated asset: ${rec.name || "new asset"}`);
  return { ok: true, assetName: rec.name || "", assetId: placedAssetId || null, placed: placeNow !== false };
}

function agentTransformObjectInEditor({
  targetType,
  targetId,
  agent = null,
  moveX = 0,
  moveY = 0,
  moveZ = 0,
  rotateYDeg = 0,
  scaleMul = 1,
  setPositionX,
  setPositionY,
  setPositionZ,
  setRotationYDeg,
  setScaleX,
  setScaleY,
  setScaleZ,
  snapToCrosshair = false,
} = {}) {
  if (appMode !== "edit") return { ok: false, reason: "not-edit-mode" };
  const type = String(targetType || "").toLowerCase();
  const id = String(targetId || "");
  if (!id || (type !== "asset" && type !== "primitive")) return { ok: false, reason: "bad-target" };

  const obj = type === "asset"
    ? assetsGroup.getObjectByName(`asset:${id}`)
    : primitivesGroup.getObjectByName(`prim:${id}`);
  if (!obj) return { ok: false, reason: "target-missing" };

  const absPosX = Number(setPositionX);
  const absPosY = Number(setPositionY);
  const absPosZ = Number(setPositionZ);
  const hasAbsolutePosition = Number.isFinite(absPosX) || Number.isFinite(absPosY) || Number.isFinite(absPosZ);
  if (hasAbsolutePosition) {
    obj.position.set(
      Number.isFinite(absPosX) ? absPosX : obj.position.x,
      Number.isFinite(absPosY) ? absPosY : obj.position.y,
      Number.isFinite(absPosZ) ? absPosZ : obj.position.z
    );
  } else if (snapToCrosshair) {
    const placement = agent
      ? getPlacementFromAgentView(agent, { raycastDistance: 500, fallbackDistance: 2.5, surfaceOffset: 0.02 })
      : getPlacementAtCrosshair({ raycastDistance: 500, surfaceOffset: 0.02 });
    if (agent && !placement.hit) return { ok: false, reason: "no-surface-in-view" };
    obj.position.set(placement.position.x, placement.position.y, placement.position.z);
  }

  const dx = Number(moveX) || 0;
  const dy = Number(moveY) || 0;
  const dz = Number(moveZ) || 0;
  if (dx || dy || dz) obj.position.set(obj.position.x + dx, obj.position.y + dy, obj.position.z + dz);

  const absYawDeg = Number(setRotationYDeg);
  if (Number.isFinite(absYawDeg)) {
    obj.rotation.y = (absYawDeg * Math.PI) / 180;
  } else {
    const yawRad = ((Number(rotateYDeg) || 0) * Math.PI) / 180;
    if (yawRad) obj.rotation.y += yawRad;
  }

  const absSx = Number(setScaleX);
  const absSy = Number(setScaleY);
  const absSz = Number(setScaleZ);
  const hasAbsoluteScale = Number.isFinite(absSx) || Number.isFinite(absSy) || Number.isFinite(absSz);
  if (hasAbsoluteScale) {
    obj.scale.set(
      Number.isFinite(absSx) ? Math.max(0.01, absSx) : obj.scale.x,
      Number.isFinite(absSy) ? Math.max(0.01, absSy) : obj.scale.y,
      Number.isFinite(absSz) ? Math.max(0.01, absSz) : obj.scale.z
    );
  } else {
    const mul = Number(scaleMul);
    if (Number.isFinite(mul) && Math.abs(mul - 1) > 1e-4) {
    obj.scale.set(
      Math.max(0.01, obj.scale.x * mul),
      Math.max(0.01, obj.scale.y * mul),
      Math.max(0.01, obj.scale.z * mul)
    );
    }
  }

  if (type === "asset") {
    selectAsset(id);
    persistSelectedAssetTransform();
  } else {
    selectPrimitive(id);
    persistSelectedPrimitiveTransform();
  }
  setStatus(`Agent transformed ${type}: ${id.slice(0, 8)}…`);
  return { ok: true };
}

async function agentInteractAsset({ agent, assetId, actionId }) {
  console.log(`[INTERACT] Attempting interaction: assetId="${assetId}", actionId="${actionId}"`);
  
  const candidates = getNearbyAssetsForAgent(agent, 1.5); // Interaction distance
  
  // Debug: if no candidates, show what assets exist
  if (candidates.length === 0) {
    const [ax, ay, az] = agent.getPosition?.() || [0, 0, 0];
    console.log(`[INTERACT] Agent position:`, [ax.toFixed(2), ay.toFixed(2), az.toFixed(2)]);
    console.log(`[INTERACT] All assets in scene:`, assets.map(a => {
      const obj = assetsGroup.getObjectByName(`asset:${a.id}`);
      if (!obj) return { id: a.id, title: a.title, inScene: false };
      const _ds = new THREE.Sphere();
      getAssetWorldSphere(obj, _ds);
      const center = _ds.center;
      const dx = center.x - ax;
      const dy = center.y - ay;
      const dz = center.z - az;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      return { id: a.id, title: a.title, dist: dist.toFixed(2), center: [center.x.toFixed(2), center.y.toFixed(2), center.z.toFixed(2)] };
    }));
  }
  
  console.log(`[INTERACT] Nearby candidates:`, candidates.map(c => ({
    id: c.id,
    title: c.title,
    dist: c.dist.toFixed(2),
    isLookedAt: c.isLookedAt,
    currentState: c.currentState,
    actions: c.actions.map(a => `${a.id}:${a.label}`)
  })));
  
  const target = candidates.find((x) => x.id === assetId);
  if (!target) {
    console.warn(`[INTERACT] FAIL: Asset "${assetId}" not in nearby candidates`);
    return { ok: false, reason: "not-nearby" };
  }
  
  console.log(`[INTERACT] Found target: dist=${target.dist.toFixed(2)}m, isLookedAt=${target.isLookedAt}, currentState=${target.currentState}`);
  
  if (!target.isLookedAt && target.dist > 1.2) {
    console.warn(`[INTERACT] FAIL: Asset "${assetId}" not looked at (isLookedAt=false)`);
    return { ok: false, reason: "not-looking" };
  }
  if (!target.isLookedAt && target.dist <= 1.2) {
    console.log(`[INTERACT] Allowing close-range interaction despite look mismatch (dist=${target.dist.toFixed(2)}m).`);
  }
  
  // Check if the actionId exists in the target's available actions
  const availableAction = target.actions.find(a => a.id === actionId);
  if (!availableAction) {
    console.warn(`[INTERACT] actionId "${actionId}" not in available actions:`, target.actions);
    // Try to find by label instead
    const byLabel = target.actions.find(a => a.label?.toLowerCase() === actionId?.toLowerCase());
    if (byLabel) {
      console.log(`[INTERACT] Found action by label match: "${byLabel.id}"`);
      actionId = byLabel.id;
    }
  }
  
  const ok = await applyAssetAction(assetId, actionId);
  console.log(`[INTERACT] applyAssetAction result: ${ok}`);
  
  if (!ok) {
    // Diagnose why it failed
    const asset = assets.find(a => a.id === assetId);
    if (asset) {
      const curState = asset.currentStateId || asset.currentState || "A";
      const allActions = asset.actions || [];
      const matchingAction = allActions.find(a => a.id === actionId);
      console.warn(`[INTERACT] applyAssetAction FAILED diagnosis:`, {
        currentState: curState,
        requestedActionId: actionId,
        actionFound: !!matchingAction,
        actionFromState: matchingAction?.from,
        actionToState: matchingAction?.to,
        fromMatchesCurrent: matchingAction?.from === curState,
        allActionIds: allActions.map(a => `${a.id}(${a.from}->${a.to})`)
      });
    }
  }
  
  return { ok, reason: ok ? "ok" : "invalid-action" };
}

// ============================================================================
// PLAYER INTERACTION SYSTEM
// ============================================================================
const PLAYER_INTERACT_DISTANCE = 1.5; // Max distance player can interact with assets
const _playerInteractRaycaster = new THREE.Raycaster();
let _interactionPopup = null;
let _currentInteractableAsset = null;
let _crosshairInteractCycleIndex = 0;
let _crosshairInteractCycleSig = "";
let _crosshairInteractCandidates = [];

// ============================================================================
// PICK UP / DROP SYSTEM
// ============================================================================
let playerHeldAsset = null; // Asset ID currently held by player
let playerHeldGroupId = null; // Group ID currently held by player
const agentHeldAssets = new Map(); // Map<agentId, assetId> - assets held by each agent

/**
 * Check if an asset is currently being held by anyone
 */
function isAssetHeld(assetId) {
  if (playerHeldAsset === assetId) return { held: true, by: "player" };
  for (const [agentId, heldId] of agentHeldAssets.entries()) {
    if (heldId === assetId) return { held: true, by: "agent", agentId };
  }
  return { held: false };
}

function isGroupHeld(groupId) {
  if (playerHeldGroupId === groupId) return { held: true, by: "player" };
  return { held: false };
}

function getGroupById(groupId) {
  return groups.find((g) => g.id === groupId) || null;
}

function getGroupCentroid(groupId) {
  const g = getGroupById(groupId);
  if (!g || !Array.isArray(g.children) || g.children.length === 0) return null;
  let cx = 0, cy = 0, cz = 0, count = 0;
  for (const cid of g.children) {
    const p = primitives.find((x) => x.id === cid);
    const pos = p?.transform?.position;
    if (!pos) continue;
    cx += pos.x || 0;
    cy += pos.y || 0;
    cz += pos.z || 0;
    count++;
  }
  if (count === 0) return null;
  return { x: cx / count, y: cy / count, z: cz / count };
}

function playerPickUpGroup(groupId) {
  const g = getGroupById(groupId);
  if (!g) return { ok: false, reason: "not-found" };
  if (!g.pickable) return { ok: false, reason: "not-pickable" };
  if (playerHeldAsset || playerHeldGroupId) return { ok: false, reason: "hands-full" };
  const holdStatus = isGroupHeld(groupId);
  if (holdStatus.held) return { ok: false, reason: "already-held", by: holdStatus.by };

  playerHeldGroupId = groupId;
  for (const cid of g.children || []) {
    const mesh = primitivesGroup.getObjectByName(`prim:${cid}`);
    if (mesh) mesh.visible = false;
    const prim = primitives.find((p) => p.id === cid);
    if (prim) removePrimitiveCollider(prim);
  }
  setStatus(`Picked up group: ${g.name || "group"}`);
  return { ok: true };
}

function playerDropGroup() {
  if (!playerHeldGroupId) return { ok: false, reason: "not-holding" };
  const g = getGroupById(playerHeldGroupId);
  if (!g) {
    playerHeldGroupId = null;
    return { ok: false, reason: "not-found" };
  }
  const centroid = getGroupCentroid(g.id);
  if (!centroid) {
    playerHeldGroupId = null;
    return { ok: false, reason: "invalid-group" };
  }
  // Raycast from crosshair to find drop point
  const dropRay = new THREE.Raycaster();
  dropRay.setFromCamera({ x: 0, y: 0 }, camera);
  dropRay.far = 6;
  const candidates = [];
  // Exclude held group's own meshes
  const heldChildSet = new Set(g.children || []);
  primitivesGroup.traverse((c) => {
    if (c.isMesh && !heldChildSet.has(c.name?.replace("prim:", ""))) candidates.push(c);
  });
  assetsGroup.traverse((c) => { if (c.isMesh) candidates.push(c); });
  scene.traverse((c) => {
    if (c.isMesh && !candidates.includes(c) && c.parent !== assetsGroup && c.parent !== primitivesGroup) candidates.push(c);
  });
  const hits = dropRay.intersectObjects(candidates, false);
  let dropPos;
  if (hits.length > 0) {
    dropPos = { x: hits[0].point.x, y: hits[0].point.y, z: hits[0].point.z };
  } else {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    dropPos = {
      x: camera.position.x + forward.x * 1.5,
      y: 0,
      z: camera.position.z + forward.z * 1.5,
    };
  }
  const dx = dropPos.x - centroid.x;
  const dz = dropPos.z - centroid.z;
  for (const cid of g.children || []) {
    const prim = primitives.find((p) => p.id === cid);
    if (!prim?.transform?.position) continue;
    prim.transform.position.x += dx;
    prim.transform.position.z += dz;
    const mesh = primitivesGroup.getObjectByName(`prim:${cid}`);
    if (mesh) {
      mesh.position.x = prim.transform.position.x;
      mesh.position.y = prim.transform.position.y;
      mesh.position.z = prim.transform.position.z;
      mesh.visible = true;
    }
    rebuildPrimitiveColliderSync(prim);
  }
  const droppedId = playerHeldGroupId;
  playerHeldGroupId = null;
  saveTagsForWorld();
  setStatus(`Dropped group: ${g.name || "group"}`);
  return { ok: true, groupId: droppedId };
}

/**
 * Pick up an asset (for player)
 */
function playerPickUpAsset(assetId) {
  const asset = assets.find(a => a.id === assetId);
  if (!asset) return { ok: false, reason: "not-found" };
  if (!asset.pickable) return { ok: false, reason: "not-pickable" };
  
  const holdStatus = isAssetHeld(assetId);
  if (holdStatus.held) return { ok: false, reason: "already-held", by: holdStatus.by };
  
  if (playerHeldAsset) return { ok: false, reason: "hands-full" };
  
  playerHeldAsset = assetId;
  
  // Hide the asset from the scene (it's now "in hand")
  const obj = assetsGroup.getObjectByName(`asset:${assetId}`);
  if (obj) obj.visible = false;
  
  // Remove collider while held
  removeAssetCollider(assetId);
  
  console.log(`[PICKUP] Player picked up: ${asset.title || assetId}`);
  setStatus(`Picked up: ${asset.title || "item"}`);
  return { ok: true };
}

/**
 * Drop the held asset (for player)
 */
function playerDropAsset() {
  if (!playerHeldAsset) return { ok: false, reason: "not-holding" };
  
  const asset = assets.find(a => a.id === playerHeldAsset);
  if (!asset) {
    playerHeldAsset = null;
    return { ok: false, reason: "not-found" };
  }
  
  // Raycast from crosshair to find where the player is looking
  const dropRay = new THREE.Raycaster();
  dropRay.setFromCamera({ x: 0, y: 0 }, camera);
  dropRay.far = 6;
  // Collect all scene meshes except the held asset itself
  const candidates = [];
  primitivesGroup.traverse((c) => { if (c.isMesh) candidates.push(c); });
  assetsGroup.traverse((c) => {
    if (c.isMesh && !c.name?.includes(playerHeldAsset)) candidates.push(c);
  });
  // Also include splat / collision meshes if any
  scene.traverse((c) => {
    if (c.isMesh && !candidates.includes(c) && c.parent !== assetsGroup && c.parent !== primitivesGroup) candidates.push(c);
  });
  const hits = dropRay.intersectObjects(candidates, false);
  let dropPos;
  if (hits.length > 0) {
    // Place at the hit point
    dropPos = hits[0].point.clone();
  } else {
    // Fallback: fixed distance along look direction, at ground level
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const fallbackDist = 1.5;
    dropPos = new THREE.Vector3(
      camera.position.x + forward.x * fallbackDist,
      0,
      camera.position.z + forward.z * fallbackDist
    );
  }
  
  // Update asset transform
  asset.transform.position = { x: dropPos.x, y: dropPos.y, z: dropPos.z };
  
  // Show and reposition the asset — traverse to ensure all children are visible
  const obj = assetsGroup.getObjectByName(`asset:${playerHeldAsset}`);
  if (obj) {
    obj.position.copy(dropPos);
    obj.visible = true;
    obj.traverse((child) => { child.visible = true; });
  } else {
    // Object was lost — re-instantiate from asset data
    console.warn(`[DROP] 3D object missing for ${playerHeldAsset}, re-instantiating...`);
    instantiateAsset(asset);
  }
  
  // Rebuild collider
  rebuildAssetCollider(playerHeldAsset);
  
  console.log(`[DROP] Player dropped: ${asset.title || playerHeldAsset}`);
  setStatus(`Dropped: ${asset.title || "item"}`);
  
  const droppedId = playerHeldAsset;
  playerHeldAsset = null;
  saveTagsForWorld();
  
  return { ok: true, assetId: droppedId };
}

/**
 * Pick up an asset (for AI agent)
 */
function agentPickUpAsset(agent, assetId) {
  const agentId = agent.id || "default";
  const asset = assets.find(a => a.id === assetId);
  
  if (!asset) return { ok: false, reason: "not-found" };
  if (!asset.pickable) return { ok: false, reason: "not-pickable" };
  
  const holdStatus = isAssetHeld(assetId);
  if (holdStatus.held) return { ok: false, reason: "already-held", by: holdStatus.by };
  
  if (agentHeldAssets.has(agentId)) return { ok: false, reason: "hands-full" };
  
  // Check distance
  const [ax, ay, az] = agent.getPosition?.() || [0, 0, 0];
  const obj = assetsGroup.getObjectByName(`asset:${assetId}`);
  if (obj) {
    const _pickSphere = new THREE.Sphere();
    getAssetWorldSphere(obj, _pickSphere);
    const center = _pickSphere.center;
    const dist = Math.sqrt(
      Math.pow(center.x - ax, 2) + 
      Math.pow(center.y - ay, 2) + 
      Math.pow(center.z - az, 2)
    );
    if (dist > 1.5) return { ok: false, reason: "too-far", dist };
  }
  
  agentHeldAssets.set(agentId, assetId);
  
  // Hide the asset from the scene
  if (obj) obj.visible = false;
  
  // Remove collider while held
  removeAssetCollider(assetId);
  
  console.log(`[PICKUP] Agent ${agentId} picked up: ${asset.title || assetId}`);
  return { ok: true };
}

/**
 * Drop the held asset (for AI agent)
 */
function agentDropAsset(agent) {
  const agentId = agent.id || "default";
  const assetId = agentHeldAssets.get(agentId);
  
  if (!assetId) return { ok: false, reason: "not-holding" };
  
  const asset = assets.find(a => a.id === assetId);
  if (!asset) {
    agentHeldAssets.delete(agentId);
    return { ok: false, reason: "not-found" };
  }
  
  // Calculate drop position (in front of agent)
  const [ax, ay, az] = agent.getPosition?.() || [0, 0, 0];
  const yaw = agent.group?.rotation?.y ?? 0;
  const dropDist = 0.6;
  
  const dropPos = new THREE.Vector3(
    ax + Math.sin(yaw) * dropDist,
    ay + 0.1, // Slightly above ground
    az + Math.cos(yaw) * dropDist
  );
  
  // Update asset transform
  asset.transform.position = { x: dropPos.x, y: dropPos.y, z: dropPos.z };
  
  // Show and reposition the asset
  const obj = assetsGroup.getObjectByName(`asset:${assetId}`);
  if (obj) {
    obj.position.copy(dropPos);
    obj.visible = true;
  }
  
  // Rebuild collider
  rebuildAssetCollider(assetId);
  
  console.log(`[DROP] Agent ${agentId} dropped: ${asset.title || assetId}`);
  
  agentHeldAssets.delete(agentId);
  saveTagsForWorld();
  
  return { ok: true, assetId };
}

/**
 * Remove collider for an asset (when picked up)
 */
function removeAssetCollider(assetId) {
  const handle = _assetColliderHandles.get(assetId);
  if (handle != null && rapierWorld) {
    const collider = rapierWorld.getCollider(handle);
    if (collider) rapierWorld.removeCollider(collider, true);
    _assetColliderHandles.delete(assetId);
  }
}

/**
 * Get what the player is currently holding
 */
function getPlayerHeldAsset() {
  if (!playerHeldAsset) return null;
  return assets.find(a => a.id === playerHeldAsset) || null;
}

/**
 * Get what an agent is currently holding
 */
function getAgentHeldAsset(agent) {
  const agentId = agent.id || "default";
  const assetId = agentHeldAssets.get(agentId);
  if (!assetId) return null;
  return assets.find(a => a.id === assetId) || null;
}

/**
 * Get the interactable asset at the player's crosshair (center of screen).
 * Returns { asset, actions, dist, canPickUp } if found, or null if nothing interactable.
 */
const _hintRayOrigin = new THREE.Vector3();
const _hintRayDir = new THREE.Vector3();
const _hintTmpSphere = new THREE.Sphere();
const _hintRay = new THREE.Ray();
const _cachedSphereCenter = new THREE.Vector3();

// Get the world-space bounding sphere of an asset from its cached local data.
// This is O(1) — no vertex traversal, just one matrix-vector multiply.
function getAssetWorldSphere(obj, outSphere) {
  const lc = obj.userData._localSphereCenter;
  const lr = obj.userData._localSphereRadius;
  if (lc && lr) {
    _cachedSphereCenter.copy(lc);
    obj.localToWorld(_cachedSphereCenter);
    const scale = obj.matrixWorld.getMaxScaleOnAxis();
    outSphere.set(_cachedSphereCenter, lr * scale);
    return true;
  }
  return false;
}

function getInteractableAssetCandidatesAtCrosshair() {
  if (!camera) return [];
  camera.getWorldPosition(_hintRayOrigin);
  camera.getWorldDirection(_hintRayDir);
  _hintRay.set(_hintRayOrigin, _hintRayDir);

  const maxDist = PLAYER_INTERACT_DISTANCE + 0.8;
  const candidates = [];
  for (const child of assetsGroup.children) {
    const aid = child.name?.startsWith("asset:") ? child.name.slice(6) : null;
    if (!aid) continue;
    if (!getAssetWorldSphere(child, _hintTmpSphere)) continue;
    _hintTmpSphere.radius = Math.max(_hintTmpSphere.radius, 0.3);
    const centerDist = _hintRayOrigin.distanceTo(_hintTmpSphere.center);
    if (centerDist > maxDist + _hintTmpSphere.radius) continue;
    const hitPoint = _hintRay.intersectSphere(_hintTmpSphere, _tmpV1);
    if (!hitPoint) continue;
    const d = _hintRayOrigin.distanceTo(hitPoint);
    if (d > maxDist) continue;
    const toCenter = _tmpV2.copy(_hintTmpSphere.center).sub(_hintRayOrigin).normalize();
    const aim = Math.max(0, _hintRayDir.dot(toCenter));
    const score = aim * 4.0 - d * 0.45;
    candidates.push({ id: aid, dist: d, aim, score });
  }
  candidates.sort((a, b) => (b.score - a.score) || (a.dist - b.dist));
  return candidates.slice(0, 6);
}

function cycleInteractableTarget(step = 1) {
  const candidates = getInteractableAssetCandidatesAtCrosshair();
  if (!Array.isArray(candidates) || candidates.length <= 1) return false;
  const sig = candidates.map((c) => c.id).join("|");
  if (sig !== _crosshairInteractCycleSig) {
    _crosshairInteractCycleSig = sig;
    _crosshairInteractCycleIndex = 0;
  }
  const len = candidates.length;
  _crosshairInteractCycleIndex = (_crosshairInteractCycleIndex + step + len) % len;
  _crosshairInteractCandidates = candidates;
  return true;
}

function getInteractableAssetAtCrosshair() {
  const candidates = getInteractableAssetCandidatesAtCrosshair();
  const sig = candidates.map((c) => c.id).join("|");
  if (sig !== _crosshairInteractCycleSig) {
    _crosshairInteractCycleSig = sig;
    _crosshairInteractCycleIndex = 0;
  }
  _crosshairInteractCandidates = candidates;
  const primary = candidates[_crosshairInteractCycleIndex] || null;

  if (!primary) {
    // Fallback: pickable grouped shape assets
    _playerInteractRaycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const hits = _playerInteractRaycaster.intersectObjects(primitivesGroup.children, false);
    for (const hit of hits) {
      if (hit.distance > PLAYER_INTERACT_DISTANCE + 0.5) continue;
      const name = hit.object?.name || "";
      const m = name.match(/^prim:(.+)$/);
      if (!m) continue;
      const primId = m[1];
      const g = groups.find((gr) => (gr.children || []).includes(primId) && gr.pickable);
      if (!g) continue;
      const canPickUp = !playerHeldAsset && !playerHeldGroupId && !isGroupHeld(g.id).held;
      return { kind: "group", group: g, actions: [], dist: hit.distance, canPickUp, isPortal: false };
    }
    return null;
  }

  const asset = assets.find((a) => a.id === primary.id);
  if (!asset) return null;

  const currentState = asset.currentStateId || asset.currentState || "A";
  const actions = (asset.actions || []).filter((act) => act.from === currentState);
  const holdStatus = isAssetHeld(primary.id);
  const canPickUp = asset.pickable && !holdStatus.held && !playerHeldAsset && !playerHeldGroupId;
  const isPortal = asset.isPortal && asset.destinationWorld;

  if (actions.length === 0 && !canPickUp && !isPortal) return null;

  return {
    kind: "asset",
    asset,
    actions,
    dist: primary.dist,
    canPickUp,
    isPortal,
    candidateIndex: _crosshairInteractCycleIndex,
    candidateCount: candidates.length,
  };
}

/**
 * Create or get the interaction popup element
 */
function getInteractionPopup() {
  if (_interactionPopup) return _interactionPopup;
  
  _interactionPopup = document.createElement("div");
  _interactionPopup.id = "interaction-popup";
  // Styles are now in CSS, just set display none initially
  _interactionPopup.style.display = "none";
  document.body.appendChild(_interactionPopup);
  return _interactionPopup;
}

/**
 * Show the interaction popup with available actions
 */
function showInteractionPopup(asset, actions) {
  const popup = getInteractionPopup();
  
  // Build popup content
  const title = asset.title || "(asset)";
  const stateObj = Array.isArray(asset.states)
    ? asset.states.find((s) => s.id === (asset.currentStateId || asset.currentState))
    : null;
  const stateName = stateObj?.name || "";
  
  let html = `<div style="font-size: 11px; color: rgba(255,255,255,0.5); padding: 6px 10px 4px; font-weight: 600; letter-spacing: 0.02em;">${escapeHtml(title)}${stateName ? ` · ${escapeHtml(stateName)}` : ""}</div>`;
  
  actions.forEach((act, idx) => {
    html += `<button class="interact-action-btn" data-action-id="${escapeHtml(act.id)}" data-idx="${idx}">
      <span style="color: #6366f1; font-size: 11px; font-weight: 700; min-width: 24px;">[${idx + 1}]</span>
      ${escapeHtml(act.label || "interact")}
    </button>`;
  });
  
  html += `<div style="font-size: 10px; color: rgba(255,255,255,0.35); padding: 8px 10px 4px; text-align: center; border-top: 1px solid rgba(255,255,255,0.06); margin-top: 4px;">Press <b style="color: rgba(255,255,255,0.6);">1-${actions.length}</b> or click · <b style="color: rgba(255,255,255,0.6);">Esc</b> to cancel</div>`;
  
  popup.innerHTML = html;
  popup.style.display = "flex";
  _currentInteractableAsset = { asset, actions };
  
  // Add click handlers to buttons
  popup.querySelectorAll(".interact-action-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const actionId = btn.getAttribute("data-action-id");
      
      // Hide popup first
      hideInteractionPopup();
      
      // Execute the action
      if (actionId === "__PICK_UP__") {
        playerPickUpAsset(asset.id);
      } else {
        await executePlayerInteraction(asset.id, actionId);
      }
      
      // Re-lock pointer after a short delay (click events can re-lock)
      setTimeout(() => {
        try {
          controls?.lock?.();
        } catch (err) {
          // Ignore
        }
      }, 50);
    });
    // Hover effects handled in CSS
  });
}

/**
 * Hide the interaction popup
 */
function hideInteractionPopup() {
  if (_interactionPopup) {
    _interactionPopup.style.display = "none";
  }
  _currentInteractableAsset = null;
}

/**
 * Check if interaction popup is visible
 */
function isInteractionPopupVisible() {
  return _interactionPopup?.style.display === "flex";
}

/**
 * Execute a player interaction with an asset
 */
async function executePlayerInteraction(assetId, actionId) {
  // Handle special pick up action
  if (actionId === "__PICK_UP__") {
    const result = playerPickUpAsset(assetId);
    return result.ok;
  }
  
  const asset = assets.find((a) => a.id === assetId);
  if (!asset) {
    setStatus("Asset not found.");
    return false;
  }
  
  const action = (asset.actions || []).find((a) => a.id === actionId);
  if (!action) {
    setStatus("Action not available.");
    return false;
  }
  
  const ok = await applyAssetAction(assetId, actionId);
  if (ok) {
    setStatus(`${action.label || "Interacted"}: ${asset.title || "asset"}`);
  } else {
    setStatus("Interaction failed.");
  }
  return ok;
}

/**
 * Handle player interaction attempt (click or E key)
 */
async function handlePlayerInteraction() {
  // If popup is already showing, do nothing (let popup handle it)
  if (isInteractionPopupVisible()) {
    return;
  }
  
  // First, check if player is holding something - pressing E drops it
  if (playerHeldAsset) {
    playerDropAsset();
    return;
  }
  if (playerHeldGroupId) {
    playerDropGroup();
    return;
  }
  
  const target = getInteractableAssetAtCrosshair();
  if (!target) {
    // No interactable asset at crosshair
    return;
  }
  
  const { kind, asset, group, actions, dist, canPickUp, isPortal } = target;
  if (kind === "group") {
    if (canPickUp) playerPickUpGroup(group.id);
    return;
  }
  
  // Handle portals immediately (no popup needed)
  if (isPortal) {
    console.log(`[PORTAL] Player entering portal: ${asset.title}`);
    await applyAssetAction(asset.id, "enter_portal");
    return;
  }
  
  // Build combined action list (regular actions + pick up if available)
  const combinedActions = [...actions];
  if (canPickUp) {
    combinedActions.push({ id: "__PICK_UP__", label: "Pick up", special: true });
  }
  
  if (combinedActions.length === 1) {
    // Single action - execute immediately
    if (combinedActions[0].id === "__PICK_UP__") {
      playerPickUpAsset(asset.id);
    } else {
      await executePlayerInteraction(asset.id, combinedActions[0].id);
    }
  } else if (combinedActions.length > 1) {
    // Multiple actions - show selection popup
    // Temporarily unlock pointer to allow clicking popup
    controls?.unlock?.();
    showInteractionPopup(asset, combinedActions);
  }
}

// ============================================================================
// END PLAYER INTERACTION SYSTEM
// ============================================================================

function deleteSelectedAsset() {
  const a = getSelectedAsset();
  if (!a) return;
  // remove collider
  if (a._colliderHandle != null) {
    try {
      rapierWorld?.removeCollider?.(a._colliderHandle, true);
    } catch {}
  }
  // remove visual
  const obj = assetsGroup.getObjectByName(`asset:${a.id}`);
  if (obj?.parent) obj.parent.remove(obj);
  _assetBumpVelocities.delete(a.id);
  assets = assets.filter((x) => x.id !== a.id);
  selectedAssetId = null;
  transformControls?.detach();
  if (transformControls) {
    transformControls.visible = false;
    transformControls.enabled = false;
  }
  saveTagsForWorld();
  renderAssetsList();
  setStatus("Asset deleted.");
}

async function interactSelectedAssetDebug() {
  const a = getSelectedAsset();
  if (!a) return;
  const state = a.currentStateId || a.currentState || "A";
  const outgoing = (a.actions || []).filter((x) => x.from === state);
  const pickId = assetInteractActionEl?.value;
  const act = (pickId ? outgoing.find((x) => x.id === pickId) : null) || outgoing[0] || null;
  if (!act) {
    setStatus("Selected asset has no valid action from its current state.");
    return;
  }
  const ok = await applyAssetAction(a.id, act.id);
  setStatus(ok ? `Asset interacted: ${act.label}` : "Asset interaction failed.");
}

function _newId(prefix) {
  return `${prefix}${Date.now().toString(16)}${Math.random().toString(16).slice(2, 6)}`;
}

function _cloneAssetWithFreshIds(src) {
  // Ensure latest schema and interactions exist
  const a = normalizeAsset(structuredClone ? structuredClone(src) : JSON.parse(JSON.stringify(src)));

  const newAssetId = _newId("asset_");
  const stateIdMap = new Map();
  const newStates = [];

  for (const s of a.states || []) {
    const newSid = _newId("s");
    stateIdMap.set(s.id, newSid);
    newStates.push({
      id: newSid,
      name: s.name || "",
      glbName: s.glbName || "",
      dataBase64: s.dataBase64 || "",
      interactions: [],
    });
  }

  // Copy interactions (and rewrite state ids)
  for (const s of a.states || []) {
    const fromNew = stateIdMap.get(s.id);
    const dstState = newStates.find((x) => x.id === fromNew);
    if (!dstState) continue;
    const ints = Array.isArray(s.interactions) ? s.interactions : [];
    dstState.interactions = ints
      .map((it) => ({
        id: _newId("it_"),
        label: it.label || "toggle",
        to: stateIdMap.get(it.to) || stateIdMap.get(s.id) || fromNew,
      }))
      .filter((it) => it.to && it.to !== fromNew);
  }

  const curOld = a.currentStateId || a.currentState || (a.states?.[0]?.id ?? null);
  const curNew = stateIdMap.get(curOld) || newStates[0]?.id || null;

  // Offset placement slightly forward so it doesn't overlap
  let transform = a.transform ? structuredClone(a.transform) : null;
  const obj = assetsGroup.getObjectByName(`asset:${src.id}`);
  if (!transform) {
    transform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
  }
  if (obj) {
    transform.position = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
    transform.rotation = { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z };
    transform.scale = { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z };
  } else {
    transform.position = transform.position || { x: 0, y: 0, z: 0 };
    transform.rotation = transform.rotation || { x: 0, y: 0, z: 0 };
    transform.scale = transform.scale || { x: 1, y: 1, z: 1 };
  }
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  const offset = 0.7;
  transform.position.x += fwd.x * offset;
  transform.position.y += fwd.y * offset;
  transform.position.z += fwd.z * offset;

  const duplicated = {
    id: newAssetId,
    title: (src.title || "").trim() ? `${src.title} (copy)` : "Asset (copy)",
    notes: src.notes || "",
    states: newStates,
    currentStateId: curNew,
    transform,
    actions: [],
    _colliderHandle: null,
  };

  // Build actions from interactions for runtime/agent/debug use
  duplicated.actions = [];
  for (const s of duplicated.states) {
    for (const it of s.interactions || []) {
      duplicated.actions.push({ id: it.id, label: it.label, from: s.id, to: it.to });
    }
  }

  return duplicated;
}

async function duplicateSelectedAsset() {
  if (appMode !== "edit") return;
  const a = getSelectedAsset();
  if (!a) return;
  const dup = _cloneAssetWithFreshIds(a);
  assets.push(dup);
  saveTagsForWorld();
  await instantiateAsset(dup);
  renderAssetsList();
  selectAsset(dup.id);
  setStatus("Asset duplicated.");
}

async function buildRapierTriMeshColliderFromObject(obj) {
  await ensureRapierLoaded();
  const verts = [];
  const indices = [];
  let vertBase = 0;
  const tmpPos = new THREE.Vector3();
  obj.updateMatrixWorld(true);

  obj.traverse((m) => {
    if (!m.isMesh) return;
    const geom = m.geometry;
    const posAttr = geom?.attributes?.position;
    if (!posAttr) return;
    const indexAttr = geom.index;
    const matWorld = m.matrixWorld;

    for (let i = 0; i < posAttr.count; i++) {
      tmpPos.fromBufferAttribute(posAttr, i).applyMatrix4(matWorld);
      verts.push(tmpPos.x, tmpPos.y, tmpPos.z);
    }

    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i++) indices.push(indexAttr.getX(i) + vertBase);
    } else {
      for (let i = 0; i < posAttr.count; i++) indices.push(vertBase + i);
    }
    vertBase += posAttr.count;
  });

  if (verts.length < 9 || indices.length < 3) return null;
  const desc = RAPIER.ColliderDesc.trimesh(verts, indices).setFriction(0.9);
  return rapierWorld.createCollider(desc);
}

async function rebuildAssetCollider(assetId) {
  const a = assets.find((x) => x.id === assetId);
  if (!a) return;
  await ensureRapierLoaded();
  if (!rapierWorld || !RAPIER) return;
  
  // Remove existing collider
  if (a._colliderHandle != null) {
    try {
      if (typeof a._colliderHandle === 'object' && a._colliderHandle.handle !== undefined) {
        rapierWorld.removeCollider(a._colliderHandle, true);
      }
    } catch (e) {
      console.warn(`[COLLIDER] Failed to remove collider for ${assetId}:`, e);
    }
    a._colliderHandle = null;
  }
  
  const obj = assetsGroup.getObjectByName(`asset:${assetId}`);
  if (!obj) return;
  const collider = await buildRapierTriMeshColliderFromObject(obj);
  if (collider) {
    a._colliderHandle = collider;
  }
}

function removeAssetColliderHandle(asset) {
  if (!asset || asset._colliderHandle == null || !rapierWorld) return;
  try {
    if (typeof asset._colliderHandle === "object" && asset._colliderHandle.handle !== undefined) {
      rapierWorld.removeCollider(asset._colliderHandle, true);
    }
  } catch (e) {
    console.warn(`[COLLIDER] Failed to remove collider for ${asset.id}:`, e);
  }
  asset._colliderHandle = null;
}

async function rebuildAssets() {
  while (assetsGroup.children.length) assetsGroup.remove(assetsGroup.children[0]);
  for (const a of assets) {
    try {
      await instantiateAsset(a);
    } catch (e) {
      console.warn("Failed to rebuild asset", a?.glb?.name, e);
    }
  }
  selectAsset(selectedAssetId);
}

// =============================================================================
// PRIMITIVES – Parametric Shape System (Level Editor)
// =============================================================================

function createPrimitiveGeometry(type, dims) {
  dims = dims || {};
  const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const degToRad = (deg, fallback = 0) => (Number.isFinite(deg) ? deg : fallback) * Math.PI / 180;
  const clampInt = (v, fallback, min = 1) => Math.max(min, Math.floor(Number(v) || fallback));
  const clamp01 = (v, fallback = 0) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
  };
  switch (type) {
    case "box": {
      const width = Math.max(0.01, num(dims.width, 1));
      const height = Math.max(0.01, num(dims.height, 1));
      const depth = Math.max(0.01, num(dims.depth, 1));
      const edgeRadius = Math.max(0, num(dims.edgeRadius, 0));
      if (edgeRadius > 0) {
        const radius = Math.min(edgeRadius, width * 0.5, height * 0.5, depth * 0.5);
        const edgeSegments = clampInt(dims.edgeSegments, 4, 1);
        return new RoundedBoxGeometry(width, height, depth, edgeSegments, radius);
      }
      return new THREE.BoxGeometry(
        width,
        height,
        depth,
        clampInt(dims.widthSegments, 1, 1),
        clampInt(dims.heightSegments, 1, 1),
        clampInt(dims.depthSegments, 1, 1)
      );
    }
    case "sphere":
      return new THREE.SphereGeometry(
        Math.max(0.01, num(dims.radius, 0.5)),
        clampInt(dims.widthSegments, 32, 3),
        clampInt(dims.heightSegments, 16, 2),
        degToRad(num(dims.phiStartDeg, 0), 0),
        degToRad(num(dims.phiLengthDeg, 360), 360),
        degToRad(num(dims.thetaStartDeg, 0), 0),
        degToRad(num(dims.thetaLengthDeg, 180), 180)
      );
    case "cylinder":
      return new THREE.CylinderGeometry(
        Math.max(0.01, num(dims.radiusTop, 0.5)),
        Math.max(0.01, num(dims.radiusBottom, 0.5)),
        Math.max(0.01, num(dims.height, 1)),
        clampInt(dims.radialSegments, 32, 3),
        clampInt(dims.heightSegments, 1, 1),
        clamp01(dims.openEnded, 0) >= 0.5
      );
    case "cone":
      return new THREE.ConeGeometry(
        Math.max(0.01, num(dims.radius, 0.5)),
        Math.max(0.01, num(dims.height, 1)),
        clampInt(dims.radialSegments, 32, 3),
        clampInt(dims.heightSegments, 1, 1),
        clamp01(dims.openEnded, 0) >= 0.5
      );
    case "torus":
      return new THREE.TorusGeometry(
        Math.max(0.01, num(dims.radius, 0.5)),
        Math.max(0.01, num(dims.tube, 0.15)),
        clampInt(dims.radialSegments, 16, 3),
        clampInt(dims.tubularSegments, 48, 3),
        degToRad(num(dims.arcDeg, 360), 360)
      );
    case "plane":
      return new THREE.PlaneGeometry(
        Math.max(0.01, num(dims.width, 2)),
        Math.max(0.01, num(dims.height, 2)),
        clampInt(dims.widthSegments, 1, 1),
        clampInt(dims.heightSegments, 1, 1)
      );
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

const _textureLoader = new THREE.TextureLoader();
const _textureCache = new Map(); // dataUrl → THREE.Texture

function createPrimitiveMaterial(mat) {
  mat = mat || {};
  const uv = mat.uvTransform || {};
  const clamp01 = (v, fallback = 0) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
  };
  const hardness = clamp01(mat.hardness, 0);
  const fluffiness = clamp01(mat.fluffiness, 0);
  const params = {
    color: new THREE.Color(mat.color || "#808080"),
    roughness: mat.softness ?? mat.roughness ?? 0.7,
    metalness: mat.metalness ?? 0.0,
    specularIntensity: mat.specularIntensity ?? 1.0,
    specularColor: new THREE.Color(mat.specularColor || "#ffffff"),
    envMapIntensity: mat.envMapIntensity ?? 1.0,
    opacity: mat.opacity ?? 1.0,
    transparent: (mat.opacity ?? 1.0) < 1 || (mat.transmission ?? 0) > 0,
    transmission: mat.transmission ?? 0.0,
    ior: mat.ior ?? 1.45,
    thickness: mat.thickness ?? 0.0,
    attenuationColor: new THREE.Color(mat.attenuationColor || "#ffffff"),
    attenuationDistance: Math.max(0.01, mat.attenuationDistance ?? 1.0),
    iridescence: mat.iridescence ?? 0.0,
    iridescenceIOR: mat.ior ?? 1.45,
    emissive: new THREE.Color(mat.emissive || "#000000"),
    emissiveIntensity: mat.emissiveIntensity ?? 0.0,
    clearcoat: Math.max(mat.clearcoat ?? 0.0, hardness * 0.85),
    clearcoatRoughness: Math.min(mat.clearcoatRoughness ?? 0.0, 1 - hardness * 0.8),
    sheen: fluffiness,
    sheenRoughness: 0.9,
    sheenColor: new THREE.Color(mat.sheenColor || mat.color || "#808080"),
    side: mat.doubleSided === false ? THREE.FrontSide : THREE.DoubleSide,
    flatShading: mat.flatShading === true,
    wireframe: mat.wireframe === true,
    alphaTest: clamp01(mat.alphaCutoff, 0),
    depthWrite: (mat.opacity ?? 1.0) >= 1 && (mat.transmission ?? 0) <= 0,
  };
  if (mat.textureDataUrl) {
    let baseTex = _textureCache.get(mat.textureDataUrl);
    if (!baseTex) {
      baseTex = _textureLoader.load(mat.textureDataUrl);
      baseTex.colorSpace = THREE.SRGBColorSpace;
      baseTex.wrapS = baseTex.wrapT = THREE.RepeatWrapping;
      _textureCache.set(mat.textureDataUrl, baseTex);
    }
    const tex = baseTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(uv.repeatX ?? 1, uv.repeatY ?? 1);
    tex.offset.set(uv.offsetX ?? 0, uv.offsetY ?? 0);
    tex.rotation = ((uv.rotationDeg ?? 0) * Math.PI) / 180;
    tex.center.set(0.5, 0.5);
    const textureSoftness = clamp01(mat.textureSoftness, 0.25);
    const textureHardness = clamp01(mat.textureHardness, 0.5);
    const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() || 1;
    const targetAniso = Math.max(1, Math.round(1 + textureHardness * (maxAniso - 1)));
    tex.anisotropy = Math.max(1, Math.round(targetAniso * (1 - textureSoftness * 0.85)));
    tex.minFilter = textureSoftness > 0.6 ? THREE.LinearMipmapLinearFilter : THREE.LinearMipmapNearestFilter;
    tex.magFilter = textureSoftness > 0.75 ? THREE.LinearFilter : (textureHardness > 0.9 ? THREE.NearestFilter : THREE.LinearFilter);
    tex.generateMipmaps = true;
    params.map = tex;
  }
  return new THREE.MeshPhysicalMaterial(params);
}

function sanitizePrimitiveCutouts(cutouts) {
  if (!Array.isArray(cutouts)) return [];
  const out = [];
  for (const c of cutouts) {
    if (!c || typeof c !== "object") continue;
    if (!Array.isArray(c.targetToSourceMatrix) || c.targetToSourceMatrix.length !== 16) continue;
    const type = String(c.type || "");
    if (!["box", "sphere", "cylinder", "cone", "torus"].includes(type)) continue;
    out.push({
      type,
      targetToSourceMatrix: c.targetToSourceMatrix.map((n) => Number(n) || 0),
      dimensions: { ...(c.dimensions || {}) },
    });
    if (out.length >= 8) break;
  }
  return out;
}

function applyPrimitiveCutoutShader(mesh, primData) {
  if (!mesh?.material?.isMeshPhysicalMaterial) return;
  const cutouts = sanitizePrimitiveCutouts(primData?.cutouts);
  if (!cutouts.length) return;
  const mat = mesh.material;
  const maxCuts = 8;
  const cutMatrices = Array.from({ length: maxCuts }, () => new THREE.Matrix4());
  const cutA = Array.from({ length: maxCuts }, () => new THREE.Vector4(0, 0, 0, 0));
  const cutB = Array.from({ length: maxCuts }, () => new THREE.Vector4(0, 0, 0, 0));
  const typeCodeFor = (t) => (t === "sphere" ? 1 : t === "box" ? 2 : t === "cylinder" ? 3 : t === "cone" ? 4 : t === "torus" ? 5 : 0);
  for (let i = 0; i < cutouts.length && i < maxCuts; i++) {
    const c = cutouts[i];
    cutMatrices[i].fromArray(c.targetToSourceMatrix);
    const d = c.dimensions || {};
    switch (c.type) {
      case "sphere":
        cutA[i].set(Number(d.radius) || 0.5, 0, 0, typeCodeFor(c.type));
        break;
      case "box":
        cutA[i].set((Number(d.width) || 1) * 0.5, (Number(d.height) || 1) * 0.5, (Number(d.depth) || 1) * 0.5, typeCodeFor(c.type));
        break;
      case "cylinder":
      case "cone":
        cutA[i].set(Math.max(Number(d.radiusTop) || Number(d.radius) || 0.5, Number(d.radiusBottom) || Number(d.radius) || 0.5), Number(d.height) || 1, 0, typeCodeFor(c.type));
        break;
      case "torus":
        cutA[i].set(Number(d.radius) || 0.5, Number(d.tube) || 0.15, 0, typeCodeFor(c.type));
        break;
      default:
        break;
    }
  }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCutoutCount = { value: cutouts.length };
    shader.uniforms.uCutoutInv = { value: cutMatrices };
    shader.uniforms.uCutoutA = { value: cutA };
    shader.uniforms.uCutoutB = { value: cutB };
    shader.vertexShader = `
varying vec3 vPrimLocalPos;
${shader.vertexShader}`.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
vPrimLocalPos = position;`
    );
    shader.fragmentShader = `
uniform int uCutoutCount;
uniform mat4 uCutoutInv[8];
uniform vec4 uCutoutA[8];
uniform vec4 uCutoutB[8];
varying vec3 vPrimLocalPos;

float sdfBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
float sdfSphere(vec3 p, float r) { return length(p) - r; }
float sdfCylinderY(vec3 p, float r, float h) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h * 0.5);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
float sdfTorus(vec3 p, float r, float t) {
  vec2 q = vec2(length(p.xz) - r, p.y);
  return length(q) - t;
}
${shader.fragmentShader}`.replace(
      "#include <alphatest_fragment>",
      `#include <alphatest_fragment>
for (int i = 0; i < 8; i++) {
  if (i >= uCutoutCount) break;
  vec3 lp = (uCutoutInv[i] * vec4(vPrimLocalPos, 1.0)).xyz;
  float typ = uCutoutA[i].w;
  float d = 1e6;
  if (typ < 1.5) d = sdfSphere(lp, uCutoutA[i].x);
  else if (typ < 2.5) d = sdfBox(lp, vec3(uCutoutA[i].x, uCutoutA[i].y, uCutoutA[i].z));
  else if (typ < 3.5) d = sdfCylinderY(lp, uCutoutA[i].x, uCutoutA[i].y);
  else if (typ < 4.5) d = sdfCylinderY(lp, uCutoutA[i].x, uCutoutA[i].y);
  else d = sdfTorus(lp, uCutoutA[i].x, uCutoutA[i].y);
  if (d < 0.0) discard;
}`
    );
  };
  mat.customProgramCacheKey = () => `cutouts:${cutouts.length}:${cutouts.map((c) => c.type).join(",")}`;
  mat.needsUpdate = true;
}

function disposePrimitiveMaterial(material) {
  if (!material) return;
  const mats = Array.isArray(material) ? material : [material];
  for (const m of mats) {
    if (!m) continue;
    const maps = [
      "map",
      "alphaMap",
      "aoMap",
      "normalMap",
      "roughnessMap",
      "metalnessMap",
      "emissiveMap",
      "clearcoatMap",
      "clearcoatRoughnessMap",
      "transmissionMap",
      "thicknessMap",
    ];
    for (const key of maps) {
      const tex = m[key];
      if (tex?.isTexture) tex.dispose();
    }
    m.dispose?.();
  }
}

// Deferred collider queue — colliders are only created at a safe frame boundary
const _pendingColliderBuilds = [];

function flushPendingColliderBuilds() {
  if (!rapierWorld || !worldBody || _pendingColliderBuilds.length === 0) return;
  while (_pendingColliderBuilds.length > 0) {
    const prim = _pendingColliderBuilds.shift();
    // Verify the primitive still exists and still wants physics
    if (primitives.includes(prim) && prim.physics !== false) {
      rebuildPrimitiveColliderSync(prim);
    }
  }
}

function instantiatePrimitive(prim) {
  // Remove existing
  const existing = primitivesGroup.getObjectByName(`prim:${prim.id}`);
  if (existing) {
    existing.geometry?.dispose();
    disposePrimitiveMaterial(existing.material);
    primitivesGroup.remove(existing);
  }

  const geom = createPrimitiveGeometry(prim.type, prim.dimensions);
  const mat = createPrimitiveMaterial(prim.material);
  const mesh = new THREE.Mesh(geom, mat);
  applyPrimitiveCutoutShader(mesh, prim);
  mesh.name = `prim:${prim.id}`;
  mesh.userData.primitiveId = prim.id;
  mesh.userData.isPrimitive = true;
  // Default both to true — shapes should always participate in shadows
  mesh.castShadow = prim.castShadow !== false;
  mesh.receiveShadow = prim.receiveShadow !== false;

  const tr = prim.transform || {};
  if (tr.position) mesh.position.set(tr.position.x, tr.position.y, tr.position.z);
  if (tr.rotation) mesh.rotation.set(tr.rotation.x, tr.rotation.y, tr.rotation.z);
  if (tr.scale) mesh.scale.set(tr.scale.x ?? 1, tr.scale.y ?? 1, tr.scale.z ?? 1);

  primitivesGroup.add(mesh);

  // Build collider — if Rapier is ready, do it now; otherwise queue it
  if (prim.physics !== false) {
    if (rapierWorld && worldBody) {
      rebuildPrimitiveColliderSync(prim);
    } else {
      // Queue for deferred build once Rapier is ready
      _pendingColliderBuilds.push(prim);
      // Kick off Rapier init (non-blocking, collider will be built by flush)
      ensureRapierLoaded();
    }
  }
}

// Safely remove a primitive's existing collider from the Rapier world
function removePrimitiveCollider(prim) {
  if (prim._colliderHandle == null || !rapierWorld) return;
  try {
    if (typeof prim._colliderHandle === "object" && prim._colliderHandle.handle !== undefined) {
      rapierWorld.removeCollider(prim._colliderHandle, true);
    }
  } catch (e) {
    console.warn(`[COLLIDER] Primitive collider remove failed for ${prim.id}:`, e);
  }
  prim._colliderHandle = null;
}

// SYNCHRONOUS collider creation for native Rapier shapes.
// Only falls back to async for trimesh (torus, plane).
function rebuildPrimitiveColliderSync(prim) {
  if (!prim) return;
  // Rapier must already be loaded for sync creation
  if (!rapierWorld || !RAPIER || !worldBody) return;

  removePrimitiveCollider(prim);
  if (prim.physics === false) return;

  const mesh = primitivesGroup.getObjectByName(`prim:${prim.id}`);
  if (!mesh) return;

  const dims = prim.dimensions || {};
  const s = prim.transform?.scale || { x: 1, y: 1, z: 1 };
  const pos = prim.transform?.position || { x: 0, y: 0, z: 0 };
  const rot = prim.transform?.rotation || { x: 0, y: 0, z: 0 };

  // Clamp all half-extents / radii to a safe minimum to avoid WASM traps
  const clamp = (v) => Math.max(v, 0.001);

  let desc = null;

  // Use native Rapier collision shapes – far more compute-efficient than trimesh
  switch (prim.type) {
    case "box":
      desc = RAPIER.ColliderDesc.cuboid(
        clamp(((dims.width || 1) * (s.x ?? 1)) / 2),
        clamp(((dims.height || 1) * (s.y ?? 1)) / 2),
        clamp(((dims.depth || 1) * (s.z ?? 1)) / 2)
      );
      break;
    case "sphere":
      desc = RAPIER.ColliderDesc.ball(
        clamp((dims.radius || 0.5) * Math.max(s.x ?? 1, s.y ?? 1, s.z ?? 1))
      );
      break;
    case "cylinder":
      desc = RAPIER.ColliderDesc.cylinder(
        clamp(((dims.height || 1) * (s.y ?? 1)) / 2),
        clamp(Math.max(dims.radiusTop ?? 0.5, dims.radiusBottom ?? 0.5) * Math.max(s.x ?? 1, s.z ?? 1))
      );
      break;
    case "cone":
      desc = RAPIER.ColliderDesc.cone(
        clamp(((dims.height || 1) * (s.y ?? 1)) / 2),
        clamp((dims.radius || 0.5) * Math.max(s.x ?? 1, s.z ?? 1))
      );
      break;
    case "plane": {
      // PlaneGeometry lies in the XY plane (normal along +Z), so make the
      // cuboid thin in Z to match the visual exactly. No rotation offset needed.
      const pw = clamp(((dims.width || 2) * (s.x ?? 1)) / 2);
      const ph = clamp(((dims.height || 2) * (s.y ?? 1)) / 2);
      desc = RAPIER.ColliderDesc.cuboid(pw, ph, 0.005);
      break; // fall through to the standard rotation/translation below
    }
    case "torus": {
      // Torus: use trimesh async fallback (deferred, won't block)
      rebuildPrimitiveColliderAsync(prim);
      return;
    }
    default:
      return;
  }

  if (desc) {
    desc.setTranslation(pos.x, pos.y, pos.z);
    const euler = new THREE.Euler(rot.x, rot.y, rot.z);
    const quat = new THREE.Quaternion().setFromEuler(euler);
    desc.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    desc.setFriction(0.9);
    try {
      const collider = rapierWorld.createCollider(desc);
      prim._colliderHandle = collider;
    } catch (e) {
      console.warn(`[COLLIDER] Failed to create primitive collider for ${prim.type}:`, e);
    }
  }
}

// Async fallback only used for torus (trimesh)
async function rebuildPrimitiveColliderAsync(prim) {
  if (!prim) return;
  await ensureRapierLoaded();
  if (!rapierWorld || !RAPIER || !worldBody) return;
  removePrimitiveCollider(prim);
  if (prim.physics === false) return;
  const mesh = primitivesGroup.getObjectByName(`prim:${prim.id}`);
  if (!mesh) return;
  try {
    const collider = await buildRapierTriMeshColliderFromObject(mesh);
    if (collider) prim._colliderHandle = collider;
  } catch (e) {
    console.warn(`[COLLIDER] Trimesh fallback failed for ${prim.id}:`, e);
  }
}

// Keep old name as alias for callers (e.g. dimension/transform change handlers)
function rebuildPrimitiveCollider(primId) {
  const prim = primitives.find((p) => p.id === primId);
  if (prim) rebuildPrimitiveColliderSync(prim);
}

function addPrimitiveAtCrosshair(type) {
  const spawnPos = getPlacementAtCrosshair({ raycastDistance: 250, surfaceOffset: 0.5 }).position;
  addPrimitiveAtPosition(type, spawnPos);
}

function addPrimitiveAtPosition(type, spawnPos) {
  const prim = {
    id: randId(),
    type,
    name: type.charAt(0).toUpperCase() + type.slice(1),
    notes: "",
    tags: [],            // string tags for filtering / grouping
    state: "static",     // static | dynamic | interactable | trigger | decoration
    metadata: {},        // arbitrary key-value pairs
    dimensions: { ...(PRIMITIVE_DEFAULTS[type] || PRIMITIVE_DEFAULTS.box) },
    transform: {
      position: spawnPos,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    material: {
      color: "#808080",
      roughness: 0.7,
      softness: 0.7,
      hardness: 0.0,
      fluffiness: 0.0,
      metalness: 0.0,
      specularIntensity: 1.0,
      specularColor: "#ffffff",
      envMapIntensity: 1.0,
      opacity: 1.0,
      transmission: 0.0,
      ior: 1.45,
      thickness: 0.0,
      attenuationColor: "#ffffff",
      attenuationDistance: 1.0,
      iridescence: 0.0,
      emissive: "#000000",
      emissiveIntensity: 0.0,
      clearcoat: 0.0,
      clearcoatRoughness: 0.0,
      alphaCutoff: 0.0,
      textureSoftness: 0.25,
      textureHardness: 0.5,
      doubleSided: true,
      flatShading: false,
      wireframe: false,
      uvTransform: { repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0, rotationDeg: 0 },
      textureDataUrl: null,
    },
    physics: true,
    castShadow: true,
    receiveShadow: true,
  };

  primitives.push(prim);
  instantiatePrimitive(prim);
  saveTagsForWorld();
  renderPrimitivesList();
  selectPrimitive(prim.id);
  setStatus(`${prim.name} placed. Use transform tools to position.`);
}

function selectPrimitive(id) {
  // Detach group pivot if one is active
  detachGroupTransform();

  selectedPrimitiveId = id;
  selectedGroupId = null;
  if (id) {
    selectedAssetId = null;
    selectedLightId = null;
    selectedSceneLightId = null;
    renderAssetsList();
    renderLightsList();
    renderSceneLightsList();
    renderSceneLightProps();
  }
  // Remove old group-details panel if showing
  const gd = document.getElementById("group-details");
  if (gd) gd.remove();

  renderPrimitivesList();
  renderPrimitiveProps();
  updateDetailsPanel();

  const obj = id ? primitivesGroup.getObjectByName(`prim:${id}`) : null;
  if (appMode === "edit" && obj) {
    transformControls.attach(obj);
    transformControls.enabled = true;
    transformControls.visible = true;
  } else if (!selectedAssetId && !selectedLightId) {
    transformControls.detach();
    transformControls.enabled = false;
    transformControls.visible = false;
  }
}

function getPlacementAtCrosshair({ raycastDistance = 500, fallbackDistance = 3, surfaceOffset = 0.02 } = {}) {
  const hit = rapierRaycastFromCamera(raycastDistance);
  if (hit) {
    const n = hit.normal
      ? new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z).normalize()
      : new THREE.Vector3(0, 1, 0);
    return {
      hit: true,
      point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
      normal: { x: n.x, y: n.y, z: n.z },
      position: {
        x: hit.point.x + n.x * surfaceOffset,
        y: hit.point.y + n.y * surfaceOffset,
        z: hit.point.z + n.z * surfaceOffset,
      },
    };
  }

  // If no collider is hit, place directly in front of the crosshair.
  const dir = camera.getWorldDirection(new THREE.Vector3());
  const p = camera.getWorldPosition(new THREE.Vector3());
  return {
    hit: false,
    point: {
      x: p.x + dir.x * fallbackDistance,
      y: p.y + dir.y * fallbackDistance,
      z: p.z + dir.z * fallbackDistance,
    },
    normal: { x: 0, y: 1, z: 0 },
    position: {
      x: p.x + dir.x * fallbackDistance,
      y: p.y + dir.y * fallbackDistance,
      z: p.z + dir.z * fallbackDistance,
    },
  };
}

function getPlacementFromAgentView(agent, { raycastDistance = 500, fallbackDistance = 2.5, surfaceOffset = 0.02 } = {}) {
  const [ax, ay, az] = agent?.getPosition?.() || [0, 0, 0];
  const yaw = agent?.group?.rotation?.y ?? 0;
  const pitch = typeof agent?.pitch === "number" ? agent.pitch : 0;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const dx = Math.sin(yaw) * cp;
  const dy = sp;
  const dz = Math.cos(yaw) * cp;
  const eyeY = ay + PLAYER_EYE_HEIGHT * 0.9;

  if (rapierWorld && RAPIER) {
    const ray = new RAPIER.Ray({ x: ax, y: eyeY, z: az }, { x: dx, y: dy, z: dz });
    const hit = rapierWorld.queryPipeline.castRayAndGetNormal(
      rapierWorld.bodies,
      rapierWorld.colliders,
      ray,
      raycastDistance,
      false,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      agent?.collider?.handle
    );
    if (hit) {
      const toi = hit.toi ?? hit.timeOfImpact ?? 0;
      const px = ax + dx * toi;
      const py = eyeY + dy * toi;
      const pz = az + dz * toi;
      const n = hit.normal
        ? new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z).normalize()
        : new THREE.Vector3(0, 1, 0);
      return {
        hit: true,
        point: { x: px, y: py, z: pz },
        normal: { x: n.x, y: n.y, z: n.z },
        position: {
          x: px + n.x * surfaceOffset,
          y: py + n.y * surfaceOffset,
          z: pz + n.z * surfaceOffset,
        },
      };
    }
  }

  return {
    hit: false,
    point: {
      x: ax + dx * fallbackDistance,
      y: eyeY + dy * fallbackDistance,
      z: az + dz * fallbackDistance,
    },
    normal: { x: 0, y: 1, z: 0 },
    position: {
      x: ax + dx * fallbackDistance,
      y: eyeY + dy * fallbackDistance,
      z: az + dz * fallbackDistance,
    },
  };
}

const _placementGhostForward = new THREE.Vector3(0, 0, 1);
const _placementGhostNormal = new THREE.Vector3(0, 1, 0);
const _placementGhostQuat = new THREE.Quaternion();
const _placementGhostPos = new THREE.Vector3();

function updatePlacementGhost(nowMs) {
  const shouldShow =
    appMode === "edit" &&
    !editorSimLightingPreview &&
    !agentCameraFollow &&
    currentWorkspace === "scene" &&
    !!placementGhostGroup;
  if (!shouldShow) {
    placementGhostGroup.visible = false;
    return;
  }
  if (nowMs - _placementGhostLastUpdate < 80) return;
  _placementGhostLastUpdate = nowMs;

  const placement = getPlacementAtCrosshair({ raycastDistance: 500, fallbackDistance: 3, surfaceOffset: 0.02 });
  _placementGhostPos.set(placement.position.x, placement.position.y, placement.position.z);
  _placementGhostNormal.set(placement.normal.x, placement.normal.y, placement.normal.z).normalize();
  _placementGhostQuat.setFromUnitVectors(_placementGhostForward, _placementGhostNormal);

  placementGhostGroup.position.copy(_placementGhostPos);
  placementGhostGroup.quaternion.copy(_placementGhostQuat);
  placementGhostGroup.visible = true;

  const hitColor = 0x6ee7b7;
  const fallbackColor = 0xfbbf24;
  const c = placement.hit ? hitColor : fallbackColor;
  placementGhostRingMat.color.setHex(c);
  placementGhostLine.material.color.setHex(c);
}

function getSelectedPrimitive() {
  return primitives.find((p) => p.id === selectedPrimitiveId) || null;
}

function buildPrimitiveCutoutFromSource(targetId, sourceId) {
  const targetPrim = primitives.find((p) => p.id === targetId);
  const sourcePrim = primitives.find((p) => p.id === sourceId);
  if (!targetPrim || !sourcePrim) return null;
  const targetMesh = primitivesGroup.getObjectByName(`prim:${targetId}`);
  const sourceMesh = primitivesGroup.getObjectByName(`prim:${sourceId}`);
  if (!targetMesh || !sourceMesh) return null;
  targetMesh.updateMatrixWorld(true);
  sourceMesh.updateMatrixWorld(true);
  const targetWorldInv = new THREE.Matrix4().copy(targetMesh.matrixWorld).invert();
  const sourceInTarget = new THREE.Matrix4().multiplyMatrices(targetWorldInv, sourceMesh.matrixWorld);
  const targetToSource = new THREE.Matrix4().copy(sourceInTarget).invert();
  return {
    id: randId(),
    type: sourcePrim.type,
    targetToSourceMatrix: targetToSource.elements.slice(),
    dimensions: { ...(sourcePrim.dimensions || {}) },
  };
}

function refreshPrimitiveSubtractUi(prim) {
  if (!primSubtractSourceEl) return;
  const current = primSubtractSourceEl.value;
  const candidates = primitives.filter((p) => p.id !== prim.id);
  primSubtractSourceEl.innerHTML =
    `<option value="">Auto-target overlapping shapes...</option>` +
    candidates.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.type)} (${escapeHtml(p.type)})</option>`).join("");
  if (candidates.some((p) => p.id === current)) primSubtractSourceEl.value = current;
  const count = Array.isArray(prim.cutouts) ? prim.cutouts.length : 0;
  if (primSubtractCountEl) primSubtractCountEl.textContent = count ? `${count} cutout${count > 1 ? "s" : ""} applied` : "No cutouts";
}

function getOverlappingPrimitiveIds(targetId) {
  const targetMesh = primitivesGroup.getObjectByName(`prim:${targetId}`);
  if (!targetMesh) return [];
  const targetBox = new THREE.Box3().setFromObject(targetMesh).expandByScalar(0.01);
  const out = [];
  for (const p of primitives) {
    if (p.id === targetId) continue;
    const mesh = primitivesGroup.getObjectByName(`prim:${p.id}`);
    if (!mesh) continue;
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) continue;
    if (targetBox.intersectsBox(box)) out.push(p.id);
  }
  return out;
}

function persistSelectedPrimitiveTransform() {
  const prim = getSelectedPrimitive();
  if (!prim) return;
  const obj = primitivesGroup.getObjectByName(`prim:${prim.id}`);
  if (!obj) return;
  prim.transform = {
    position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
    rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
    scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
  };
  saveTagsForWorld();
  rebuildPrimitiveColliderSync(prim);
}

function deletePrimitive(id) {
  const idx = primitives.findIndex((p) => p.id === id);
  if (idx === -1) return;
  const prim = primitives[idx];

  // Remove collider safely
  removePrimitiveCollider(prim);

  // Remove visual
  const obj = primitivesGroup.getObjectByName(`prim:${id}`);
  if (obj) {
    obj.geometry?.dispose();
    disposePrimitiveMaterial(obj.material);
    primitivesGroup.remove(obj);
  }

  primitives.splice(idx, 1);
  if (selectedPrimitiveId === id) {
    selectedPrimitiveId = null;
    transformControls?.detach();
    transformControls.visible = false;
    transformControls.enabled = false;
  }
  saveTagsForWorld();
  renderPrimitivesList();
  renderPrimitiveProps();
  setStatus("Primitive deleted.");
}

function duplicatePrimitive(id) {
  const src = primitives.find((p) => p.id === id);
  if (!src) return;
  // Strip runtime objects (collider handle has circular refs) before deep clone
  const { _colliderHandle, ...serializable } = src;
  const clone = JSON.parse(JSON.stringify(serializable));
  clone.id = randId();
  clone.name = src.name + " copy";
  clone._colliderHandle = null;
  // Offset slightly
  if (clone.transform?.position) {
    clone.transform.position.x += 1;
  }
  primitives.push(clone);
  instantiatePrimitive(clone);
  saveTagsForWorld();
  renderPrimitivesList();
  selectPrimitive(clone.id);
  setStatus("Primitive duplicated.");
}

function updatePrimitiveMaterial(primId) {
  const prim = primitives.find((p) => p.id === primId);
  if (!prim) return;
  const mesh = primitivesGroup.getObjectByName(`prim:${prim.id}`)
    || (groupPivot ? groupPivot.getObjectByName(`prim:${prim.id}`) : null);
  if (!mesh) return;
  disposePrimitiveMaterial(mesh.material);
  mesh.material = createPrimitiveMaterial(prim.material);
  applyPrimitiveCutoutShader(mesh, prim);
}

function updatePrimitiveDimensions(primId) {
  const prim = primitives.find((p) => p.id === primId);
  if (!prim) return;
  const mesh = primitivesGroup.getObjectByName(`prim:${prim.id}`)
    || (groupPivot ? groupPivot.getObjectByName(`prim:${prim.id}`) : null);
  if (!mesh) return;
  mesh.geometry?.dispose();
  mesh.geometry = createPrimitiveGeometry(prim.type, prim.dimensions);
  rebuildPrimitiveCollider(prim.id);
}

function setGroupSelectionMode(enabled) {
  groupSelectionMode = !!enabled;
  if (!groupSelectionMode) {
    multiSelectedPrimIds.clear();
  }
  renderPrimitivesList();
  updateGroupActionBar();
  setStatus(groupSelectionMode ? "Group mode on: check shapes to group." : "Group mode off.");
}

function renderPrimitivesList() {
  if (!primitivesListEl) return;
  primitivesListEl.innerHTML = "";
  const validGroupIds = new Set(groups.map((g) => g.id));
  collapsedGroupIds = new Set([...collapsedGroupIds].filter((id) => validGroupIds.has(id)));

  // Gather IDs of primitives that belong to a group
  const groupedIds = new Set();
  for (const g of groups) {
    for (const cid of g.children) groupedIds.add(cid);
  }

  // Helper: build a primitive list item with multi-select support
  function makePrimItem(p, extraClass = "") {
    const isSelected = p.id === selectedPrimitiveId;
    const isMultiSelected = multiSelectedPrimIds.has(p.id);
    const el = document.createElement("div");
    el.className = "tag-item" + extraClass + (isSelected ? " active" : "") + (isMultiSelected ? " multi-selected" : "");
    if (groupSelectionMode) {
      el.innerHTML = `
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;width:100%;">
          <input data-group-select-checkbox type="checkbox" ${isMultiSelected ? "checked" : ""} />
          <span style="display:flex;flex-direction:column;min-width:0;">
            <span>${escapeHtml(p.name || p.type)}</span>
            <small>${escapeHtml(p.type)}</small>
          </span>
        </label>
      `;
      const cb = el.querySelector("input[data-group-select-checkbox]");
      cb?.addEventListener("click", (e) => e.stopPropagation());
      cb?.addEventListener("change", (e) => {
        e.stopPropagation();
        if (cb.checked) multiSelectedPrimIds.add(p.id);
        else multiSelectedPrimIds.delete(p.id);
        renderPrimitivesList();
        updateGroupActionBar();
      });
    } else {
    el.innerHTML = `${escapeHtml(p.name || p.type)}<small>${escapeHtml(p.type)}</small>`;
    }
    el.addEventListener("click", (e) => {
      if (groupSelectionMode) {
        e.stopPropagation();
        if (multiSelectedPrimIds.has(p.id)) multiSelectedPrimIds.delete(p.id);
        else multiSelectedPrimIds.add(p.id);
        renderPrimitivesList();
        updateGroupActionBar();
        return;
      }
      if (e.shiftKey) {
        // Shift+click toggles multi-selection
        e.stopPropagation();
        if (multiSelectedPrimIds.has(p.id)) {
          multiSelectedPrimIds.delete(p.id);
        } else {
          multiSelectedPrimIds.add(p.id);
        }
        // Also include the currently selected prim if there is one
        if (selectedPrimitiveId && !multiSelectedPrimIds.has(selectedPrimitiveId)) {
          multiSelectedPrimIds.add(selectedPrimitiveId);
        }
        renderPrimitivesList();
        updateGroupActionBar();
      } else {
        // Normal click: clear multi-select, select this one
        multiSelectedPrimIds.clear();
        selectPrimitive(p.id);
        updateGroupActionBar();
      }
    });
    return el;
  }

  // Render groups first
  for (const g of groups) {
    const gEl = document.createElement("div");
    gEl.className = "ol-group" + (g.id === selectedGroupId ? " active" : "");

    // Group header row
    const header = document.createElement("div");
    header.className = "ol-group-header";
    const isCollapsed = collapsedGroupIds.has(g.id);
    header.innerHTML = `<button type="button" class="ol-group-collapse-btn" title="${isCollapsed ? "Expand group" : "Collapse group"}">${isCollapsed ? "▸" : "▾"}</button><span class="ol-group-icon">📁</span><span class="ol-group-name">${escapeHtml(g.name)}</span>${g.pickable ? `<span class="ol-group-pickable" title="Pickable group">🖐</span>` : ""}<span class="ol-group-count">${g.children.length}</span>`;
    header.addEventListener("click", (e) => {
      e.stopPropagation();
      multiSelectedPrimIds.clear();
      selectGroup(g.id);
      updateGroupActionBar();
    });
    const collapseBtn = header.querySelector(".ol-group-collapse-btn");
    collapseBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (collapsedGroupIds.has(g.id)) collapsedGroupIds.delete(g.id);
      else collapsedGroupIds.add(g.id);
      renderPrimitivesList();
    });

    // Action buttons
    const actions = document.createElement("span");
    actions.className = "ol-group-actions";
    const dupBtn = document.createElement("button");
    dupBtn.className = "ol-group-btn";
    dupBtn.textContent = "Dup";
    dupBtn.title = "Duplicate group";
    dupBtn.addEventListener("click", (e) => { e.stopPropagation(); duplicateGroup(g.id); });
    const ungroupBtn = document.createElement("button");
    ungroupBtn.className = "ol-group-btn";
    ungroupBtn.textContent = "✕";
    ungroupBtn.title = "Ungroup";
    ungroupBtn.addEventListener("click", (e) => { e.stopPropagation(); ungroupGroup(g.id); });
    actions.appendChild(dupBtn);
    actions.appendChild(ungroupBtn);
    header.appendChild(actions);
    gEl.appendChild(header);

    // Group children
    const childList = document.createElement("div");
    childList.className = "ol-group-children";
    if (isCollapsed) childList.classList.add("hidden");
    for (const cid of g.children) {
      const p = primitives.find((pr) => pr.id === cid);
      if (!p) continue;
      childList.appendChild(makePrimItem(p, " ol-group-child"));
    }
    gEl.appendChild(childList);
    primitivesListEl.appendChild(gEl);
  }

  // Render ungrouped primitives
  for (const p of primitives) {
    if (groupedIds.has(p.id)) continue;
    primitivesListEl.appendChild(makePrimItem(p));
  }

  updateOutlinerCounts();
  updateGroupActionBar();
}

// ---- Group action bar (shown when multi-selecting) ----

function updateGroupActionBar() {
  let bar = document.getElementById("group-action-bar");
  const host = primitivesListEl?.parentElement;
  if (!host) return;
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "group-action-bar";
      bar.className = "ol-group-action-bar";
    host.insertBefore(bar, primitivesListEl);
    }
  if (!groupSelectionMode) {
    bar.innerHTML = `
      <span class="ol-group-action-label">Grouping</span>
      <button id="group-mode-toggle-btn" class="ol-group-action-btn" type="button">Group Objects</button>
    `;
    bar.querySelector("#group-mode-toggle-btn")?.addEventListener("click", () => {
      setGroupSelectionMode(true);
    });
    return;
  }
  bar.innerHTML = `
    <span class="ol-group-action-label">${multiSelectedPrimIds.size} selected</span>
    <button id="group-create-btn" class="ol-group-action-btn" type="button" ${multiSelectedPrimIds.size < 2 ? "disabled" : ""}>Group Selected</button>
    <button id="group-clear-btn" class="ol-group-action-btn ol-group-cancel-btn" type="button">Clear</button>
    <button id="group-done-btn" class="ol-group-action-btn" type="button">Done</button>
  `;
  bar.querySelector("#group-create-btn")?.addEventListener("click", () => {
      createGroupFromSelection();
    });
  bar.querySelector("#group-clear-btn")?.addEventListener("click", () => {
      multiSelectedPrimIds.clear();
      renderPrimitivesList();
      updateGroupActionBar();
    });
  bar.querySelector("#group-done-btn")?.addEventListener("click", () => {
    setGroupSelectionMode(false);
  });
}

function createGroupFromSelection() {
  if (multiSelectedPrimIds.size < 2) return;
  const children = [...multiSelectedPrimIds];

  // Remove these from any existing groups first
  for (const g of groups) {
    g.children = g.children.filter((cid) => !multiSelectedPrimIds.has(cid));
  }
  // Remove empty groups
  groups = groups.filter((g) => g.children.length > 0);

  // Derive a name from the shared prefix or just use "Group"
  const names = children.map((id) => {
    const p = primitives.find((pr) => pr.id === id);
    return p?.name || "";
  });
  // Try to find a common prefix
  let groupName = "Group";
  if (names.length > 0 && names[0]) {
    const words = names[0].split(/[\s\-_]+/);
    for (let len = words.length; len >= 1; len--) {
      const prefix = words.slice(0, len).join(" ");
      if (names.every((n) => n.startsWith(prefix) || n.toLowerCase().startsWith(prefix.toLowerCase()))) {
        groupName = prefix.trim();
        break;
      }
    }
  }
  if (!groupName || groupName.length < 2) groupName = "Group";

  const newGroup = {
    id: randId(),
    name: groupName,
    children,
    pickable: false,
  };
  groups.push(newGroup);

  multiSelectedPrimIds.clear();
  saveTagsForWorld();
  renderPrimitivesList();
  updateGroupActionBar();
  selectGroup(newGroup.id);
  setStatus(`Created group "${newGroup.name}" with ${children.length} shapes.`);
}

// ---- Group management ----

function selectGroup(id) {
  // Detach any previously active group pivot
  detachGroupTransform();

  selectedGroupId = id;
  selectedPrimitiveId = null;
  selectedAssetId = null;
  selectedLightId = null;
  selectedSceneLightId = null;

  if (id) {
    attachGroupTransform(id);
  }

  renderPrimitivesList();
  renderAssetsList();
  renderLightsList();
  renderSceneLightsList();
  renderPrimitiveProps();
  renderLightProps();
  renderSceneLightProps();
  updateGroupDetailsPanel();
  populateTransformInputs();
}

// --- Group pivot transform system ---

function attachGroupTransform(groupId) {
  const g = groups.find((gr) => gr.id === groupId);
  if (!g || g.children.length === 0) return;

  // Find all child meshes and compute centroid
  groupChildMeshes = [];
  let cx = 0, cy = 0, cz = 0;
  for (const cid of g.children) {
    const mesh = primitivesGroup.getObjectByName(`prim:${cid}`);
    if (mesh) {
      groupChildMeshes.push(mesh);
      cx += mesh.position.x;
      cy += mesh.position.y;
      cz += mesh.position.z;
    }
  }
  if (groupChildMeshes.length === 0) return;
  cx /= groupChildMeshes.length;
  cy /= groupChildMeshes.length;
  cz /= groupChildMeshes.length;

  // Create pivot at centroid
  groupPivot = new THREE.Object3D();
  groupPivot.name = "groupPivot";
  groupPivot.position.set(cx, cy, cz);
  scene.add(groupPivot);

  // Reparent children to pivot (preserving world transform)
  for (const mesh of groupChildMeshes) {
    groupPivot.attach(mesh);
  }

  // Attach transform controls to pivot
  if (appMode === "edit") {
    transformControls.attach(groupPivot);
    transformControls.enabled = true;
    transformControls.visible = true;
  }
}

function detachGroupTransform() {
  if (!groupPivot) return;

  // Persist final world transforms to data model before detaching
  persistGroupTransforms();

  // Reparent children back to primitivesGroup (preserving world transform)
  for (const mesh of groupChildMeshes) {
    primitivesGroup.attach(mesh);
  }

  // Clean up pivot
  scene.remove(groupPivot);
  groupPivot = null;
  groupChildMeshes = [];
}

function persistGroupTransforms() {
  if (!groupPivot) return;
  const g = groups.find((gr) => gr.id === selectedGroupId);
  if (!g) return;

  const wp = new THREE.Vector3();
  const wq = new THREE.Quaternion();
  const ws = new THREE.Vector3();

  for (const cid of g.children) {
    const prim = primitives.find((p) => p.id === cid);
    const mesh = groupPivot.getObjectByName(`prim:${cid}`);
    if (!prim || !mesh) continue;

    mesh.getWorldPosition(wp);
    mesh.getWorldQuaternion(wq);
    mesh.getWorldScale(ws);
    const euler = new THREE.Euler().setFromQuaternion(wq);

    prim.transform = {
      position: { x: wp.x, y: wp.y, z: wp.z },
      rotation: { x: euler.x, y: euler.y, z: euler.z },
      scale: { x: ws.x, y: ws.y, z: ws.z },
    };
  }
}

function persistGroupTransformsAndRebuild() {
  persistGroupTransforms();
  saveTagsForWorld();
  const g = groups.find((gr) => gr.id === selectedGroupId);
  if (g) {
    for (const cid of g.children) {
      const prim = primitives.find((p) => p.id === cid);
      if (prim) rebuildPrimitiveColliderSync(prim);
    }
  }
}

function applyGroupCastShadow(groupId, enabled) {
  const g = groups.find((gr) => gr.id === groupId);
  if (!g) return;
  for (const cid of g.children || []) {
    const prim = primitives.find((p) => p.id === cid);
    if (!prim) continue;
    prim.castShadow = !!enabled;
    const mesh = primitivesGroup.getObjectByName(`prim:${cid}`);
    if (mesh) mesh.castShadow = !!enabled;
  }
}

function inferGroupCastShadow(groupId) {
  const g = groups.find((gr) => gr.id === groupId);
  if (!g || !Array.isArray(g.children) || g.children.length === 0) return true;
  for (const cid of g.children) {
    const prim = primitives.find((p) => p.id === cid);
    if (!prim || prim.castShadow === false) return false;
  }
  return true;
}

function updateGroupDetailsPanel() {
  const g = groups.find((gr) => gr.id === selectedGroupId);

  // Remove old group details if any
  const existing = document.getElementById("group-details");
  if (existing) existing.remove();

  if (!g) {
    // Make sure regular details panel reflects actual selection
    updateDetailsPanel();
    return;
  }

  // Show details panel with group info
  if (detailsPanelEl) detailsPanelEl.classList.remove("hidden");
  if (detailsTitleEl) detailsTitleEl.textContent = `Group: ${g.name}`;

  // Hide other detail sections
  const tagForm = document.getElementById("tag-form");
  const assetDets = document.getElementById("asset-details");
  const primProps = document.getElementById("prim-props");
  const lightProps = document.getElementById("light-props");
  const slProps = document.getElementById("scene-light-props");
  if (tagForm) tagForm.classList.add("hidden");
  if (assetDets) assetDets.classList.add("hidden");
  if (primProps) primProps.classList.add("hidden");
  if (lightProps) lightProps.classList.add("hidden");
  if (slProps) slProps.classList.add("hidden");

  // Create group details panel
  const gd = document.createElement("div");
  gd.id = "group-details";
  gd.className = "prim-props";
  // Sample first child's material for initial slider values
  const firstChild = primitives.find((p) => g.children.includes(p.id));
  const fm = firstChild?.material || {};

  gd.innerHTML = `
    <details class="dt-section" open>
      <summary class="dt-header">Group</summary>
      <div class="dt-body">
        <input id="group-name-input" type="text" value="${escapeHtml(g.name)}" class="dt-input" placeholder="Group name" />
        <div style="font-size:12px; color:var(--text-tertiary); margin:6px 0;">${g.children.length} shapes in this group</div>
        <label class="prop-check"><input id="group-cast-shadow" type="checkbox" ${inferGroupCastShadow(g.id) ? "checked" : ""} /><span>Cast Shadow (all shapes)</span></label>
        <label class="prop-check"><input id="group-pickable" type="checkbox" ${g.pickable ? "checked" : ""} /><span>Pickable</span></label>
        <div class="dt-actions">
          <button id="group-dup-btn" class="tb-btn tb-primary" type="button">Duplicate Group</button>
          <button id="group-ungroup-btn" class="tb-btn tb-danger" type="button">Ungroup</button>
        </div>
      </div>
    </details>
    <details class="dt-section" open>
      <summary class="dt-header">Group Material</summary>
      <div class="dt-body">
        <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:6px;">Changes apply to all ${g.children.length} shapes.</div>
        <div style="font-size:12px;font-weight:600;margin-bottom:4px;">Presets</div>
        <div class="dt-actions" style="flex-wrap:wrap;gap:5px;margin-bottom:8px;">
          ${["plastic","ceramic","rubber","fabric","velvet","cushion","glass","mirror","metal","concrete"].map(
            (p) => `<button data-grp-preset="${p}" class="tb-btn tb-muted" type="button">${p.charAt(0).toUpperCase() + p.slice(1)}</button>`
          ).join("")}
        </div>
        <div class="dt-row"><label class="prop-label">Color</label><input id="grp-color" type="color" value="${fm.color || "#808080"}" /></div>
        <div class="slider"><span class="slider-label">Softness</span><input id="grp-roughness" type="range" min="0" max="1" step="0.05" value="${fm.softness ?? fm.roughness ?? 0.7}" /><span id="grp-roughness-val" class="slider-value">${(fm.softness ?? fm.roughness ?? 0.7).toFixed(2)}</span></div>
        <div class="slider"><span class="slider-label">Hardness</span><input id="grp-hardness" type="range" min="0" max="1" step="0.01" value="${fm.hardness ?? 0}" /><span id="grp-hardness-val" class="slider-value">${(fm.hardness ?? 0).toFixed(2)}</span></div>
        <div class="slider"><span class="slider-label">Fluffiness</span><input id="grp-fluffiness" type="range" min="0" max="1" step="0.01" value="${fm.fluffiness ?? 0}" /><span id="grp-fluffiness-val" class="slider-value">${(fm.fluffiness ?? 0).toFixed(2)}</span></div>
        <div class="slider"><span class="slider-label">Metal Look</span><input id="grp-metalness" type="range" min="0" max="1" step="0.05" value="${fm.metalness ?? 0}" /><span id="grp-metalness-val" class="slider-value">${(fm.metalness ?? 0).toFixed(2)}</span></div>
        <div class="slider"><span class="slider-label">Transparency</span><input id="grp-opacity" type="range" min="0.05" max="1" step="0.01" value="${fm.opacity ?? 1}" /><span id="grp-opacity-val" class="slider-value">${(fm.opacity ?? 1).toFixed(2)}</span></div>
        <div class="slider"><span class="slider-label">Glassiness</span><input id="grp-transmission" type="range" min="0" max="1" step="0.01" value="${fm.transmission ?? 0}" /><span id="grp-transmission-val" class="slider-value">${(fm.transmission ?? 0).toFixed(2)}</span></div>
        <div class="dt-row"><label class="prop-label">Glow Color</label><input id="grp-emissive" type="color" value="${fm.emissive || "#000000"}" /></div>
        <div class="slider"><span class="slider-label">Glow Strength</span><input id="grp-emissive-intensity" type="range" min="0" max="5" step="0.05" value="${fm.emissiveIntensity ?? 0}" /><span id="grp-emissive-intensity-val" class="slider-value">${(fm.emissiveIntensity ?? 0).toFixed(2)}</span></div>
        <div class="dt-row"><label class="prop-label">Texture</label>
          <label class="tb-btn tb-muted tb-file-label"><input id="grp-texture" type="file" accept="image/*" /><span id="grp-texture-label">${fm.textureDataUrl ? "Change" : "Upload"}</span></label>
          <button id="grp-texture-clear" type="button" class="tb-btn tb-muted">Clear</button>
        </div>
      </div>
    </details>
  `;
  detailsPanelEl.appendChild(gd);

  // Helper: apply a material change to all children in the group
  function applyToGroupMaterial(mutator) {
    for (const cid of g.children) {
      const prim = primitives.find((p) => p.id === cid);
      if (!prim) continue;
      if (!prim.material) prim.material = {};
      mutator(prim.material);
      updatePrimitiveMaterial(prim.id);
    }
    saveTagsForWorld();
  }

  // Wire group events
  gd.querySelector("#group-name-input").addEventListener("change", (e) => {
    g.name = e.target.value.trim() || g.name;
    saveTagsForWorld();
    renderPrimitivesList();
    if (detailsTitleEl) detailsTitleEl.textContent = `Group: ${g.name}`;
  });
  gd.querySelector("#group-cast-shadow")?.addEventListener("change", (e) => {
    applyGroupCastShadow(g.id, !!e.target.checked);
    saveTagsForWorld();
    setStatus(`Group shadows ${e.target.checked ? "enabled" : "disabled"}.`);
  });
  gd.querySelector("#group-pickable")?.addEventListener("change", (e) => {
    g.pickable = !!e.target.checked;
    saveTagsForWorld();
    setStatus(`Group pickable ${g.pickable ? "enabled" : "disabled"}.`);
  });
  gd.querySelector("#group-dup-btn").addEventListener("click", () => duplicateGroup(g.id));
  gd.querySelector("#group-ungroup-btn").addEventListener("click", () => ungroupGroup(g.id));

  // Wire preset buttons
  gd.querySelectorAll("button[data-grp-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = PRIMITIVE_MATERIAL_PRESETS[btn.getAttribute("data-grp-preset")];
      if (!preset) return;
      applyToGroupMaterial((mat) => {
        if (preset.softness !== undefined) { mat.softness = preset.softness; mat.roughness = preset.softness; }
        if (preset.hardness !== undefined) mat.hardness = preset.hardness;
        if (preset.fluffiness !== undefined) mat.fluffiness = preset.fluffiness;
        if (preset.metalness !== undefined) mat.metalness = preset.metalness;
        if (preset.transparency !== undefined) mat.opacity = preset.transparency;
        if (preset.transmission !== undefined) mat.transmission = preset.transmission;
        if (preset.clearcoat !== undefined) mat.clearcoat = preset.clearcoat;
        if (preset.clearcoatRoughness !== undefined) mat.clearcoatRoughness = preset.clearcoatRoughness;
        if (preset.emissive) mat.emissive = preset.emissive;
        if (preset.emissiveIntensity !== undefined) mat.emissiveIntensity = preset.emissiveIntensity;
        if (preset.specularIntensity !== undefined) mat.specularIntensity = preset.specularIntensity;
        if (preset.envMapIntensity !== undefined) mat.envMapIntensity = preset.envMapIntensity;
        if (preset.ior !== undefined) mat.ior = preset.ior;
        if (preset.thickness !== undefined) mat.thickness = preset.thickness;
      });
      updateGroupDetailsPanel();
      setStatus(`Applied "${btn.getAttribute("data-grp-preset")}" to group.`);
    });
  });

  // Wire material sliders
  const sliderBindings = [
    ["grp-roughness", "grp-roughness-val", (v, m) => { m.softness = v; m.roughness = v; }],
    ["grp-hardness", "grp-hardness-val", (v, m) => { m.hardness = v; }],
    ["grp-fluffiness", "grp-fluffiness-val", (v, m) => { m.fluffiness = v; }],
    ["grp-metalness", "grp-metalness-val", (v, m) => { m.metalness = v; }],
    ["grp-opacity", "grp-opacity-val", (v, m) => { m.opacity = v; }],
    ["grp-transmission", "grp-transmission-val", (v, m) => { m.transmission = v; }],
    ["grp-emissive-intensity", "grp-emissive-intensity-val", (v, m) => { m.emissiveIntensity = v; }],
  ];
  for (const [inputId, valId, setter] of sliderBindings) {
    const input = gd.querySelector(`#${inputId}`);
    const valEl = gd.querySelector(`#${valId}`);
    input?.addEventListener("input", () => {
      const v = parseFloat(input.value);
      if (valEl) valEl.textContent = v.toFixed(2);
      applyToGroupMaterial((m) => setter(v, m));
    });
  }

  // Wire color pickers
  gd.querySelector("#grp-color")?.addEventListener("input", (e) => {
    applyToGroupMaterial((m) => { m.color = e.target.value; });
  });
  gd.querySelector("#grp-emissive")?.addEventListener("input", (e) => {
    applyToGroupMaterial((m) => { m.emissive = e.target.value; });
  });

  // Wire texture upload
  gd.querySelector("#grp-texture")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      applyToGroupMaterial((m) => { m.textureDataUrl = reader.result; });
      const label = gd.querySelector("#grp-texture-label");
      if (label) label.textContent = "Change";
    };
    reader.readAsDataURL(file);
  });
  gd.querySelector("#grp-texture-clear")?.addEventListener("click", () => {
    applyToGroupMaterial((m) => { m.textureDataUrl = null; });
    const label = gd.querySelector("#grp-texture-label");
    if (label) label.textContent = "Upload";
  });
}

function duplicateGroup(groupId) {
  const g = groups.find((gr) => gr.id === groupId);
  if (!g) return;

  // Compute bounding center of the group for offset
  let cx = 0, cz = 0, count = 0;
  for (const cid of g.children) {
    const p = primitives.find((pr) => pr.id === cid);
    if (p?.transform?.position) { cx += p.transform.position.x; cz += p.transform.position.z; count++; }
  }
  if (count > 0) { cx /= count; cz /= count; }

  const newChildren = [];
  const offset = 2.0; // Offset duplicated group 2m along X

  for (const cid of g.children) {
    const src = primitives.find((pr) => pr.id === cid);
    if (!src) continue;
    const { _colliderHandle, ...serializable } = src;
    const clone = JSON.parse(JSON.stringify(serializable));
    clone.id = randId();
    clone.name = src.name;
    clone._colliderHandle = null;
    if (clone.transform?.position) {
      clone.transform.position.x += offset;
    }
    primitives.push(clone);
    instantiatePrimitive(clone);
    newChildren.push(clone.id);
  }

  const newGroup = {
    id: randId(),
    name: g.name + " copy",
    children: newChildren,
    pickable: !!g.pickable,
  };
  groups.push(newGroup);
  saveTagsForWorld();
  renderPrimitivesList();
  selectGroup(newGroup.id);
  setStatus(`Duplicated group "${g.name}" (${newChildren.length} shapes).`);
}

function ungroupGroup(groupId) {
  const idx = groups.findIndex((gr) => gr.id === groupId);
  if (idx === -1) return;
  const name = groups[idx].name;
  groups.splice(idx, 1);
  if (selectedGroupId === groupId) selectedGroupId = null;
  saveTagsForWorld();
  renderPrimitivesList();
  updateDetailsPanel();
  setStatus(`Ungrouped "${name}".`);
}

function renderPrimitiveProps() {
  const prim = getSelectedPrimitive();
  if (primPropsEl) primPropsEl.classList.toggle("hidden", !prim);
  if (!prim) return;

  if (primNameEl) primNameEl.value = prim.name || "";
  if (primNotesEl) primNotesEl.value = prim.notes || "";
  if (primTagsInputEl) primTagsInputEl.value = (prim.tags || []).join(", ");
  if (primStateEl) primStateEl.value = prim.state || "static";
  if (primColorEl) primColorEl.value = prim.material?.color || "#808080";
  const softness = prim.material?.softness ?? prim.material?.roughness ?? 0.7;
  if (primRoughnessEl) primRoughnessEl.value = String(softness);
  if (primRoughnessValEl) primRoughnessValEl.textContent = softness.toFixed(2);
  if (primHardnessEl) primHardnessEl.value = String(prim.material?.hardness ?? 0.0);
  if (primHardnessValEl) primHardnessValEl.textContent = (prim.material?.hardness ?? 0.0).toFixed(2);
  if (primFluffinessEl) primFluffinessEl.value = String(prim.material?.fluffiness ?? 0.0);
  if (primFluffinessValEl) primFluffinessValEl.textContent = (prim.material?.fluffiness ?? 0.0).toFixed(2);
  if (primMetalnessEl) primMetalnessEl.value = String(prim.material?.metalness ?? 0.0);
  if (primMetalnessValEl) primMetalnessValEl.textContent = (prim.material?.metalness ?? 0.0).toFixed(2);
  if (primSpecularIntensityEl) primSpecularIntensityEl.value = String(prim.material?.specularIntensity ?? 1.0);
  if (primSpecularIntensityValEl) primSpecularIntensityValEl.textContent = (prim.material?.specularIntensity ?? 1.0).toFixed(2);
  if (primSpecularColorEl) primSpecularColorEl.value = prim.material?.specularColor || "#ffffff";
  if (primEnvIntensityEl) primEnvIntensityEl.value = String(prim.material?.envMapIntensity ?? 1.0);
  if (primEnvIntensityValEl) primEnvIntensityValEl.textContent = (prim.material?.envMapIntensity ?? 1.0).toFixed(2);
  if (primOpacityEl) primOpacityEl.value = String(prim.material?.opacity ?? 1.0);
  if (primOpacityValEl) primOpacityValEl.textContent = (prim.material?.opacity ?? 1.0).toFixed(2);
  if (primTransmissionEl) primTransmissionEl.value = String(prim.material?.transmission ?? 0.0);
  if (primTransmissionValEl) primTransmissionValEl.textContent = (prim.material?.transmission ?? 0.0).toFixed(2);
  if (primIorEl) primIorEl.value = String(prim.material?.ior ?? 1.45);
  if (primIorValEl) primIorValEl.textContent = (prim.material?.ior ?? 1.45).toFixed(2);
  if (primThicknessEl) primThicknessEl.value = String(prim.material?.thickness ?? 0.0);
  if (primThicknessValEl) primThicknessValEl.textContent = (prim.material?.thickness ?? 0.0).toFixed(2);
  if (primAttenuationColorEl) primAttenuationColorEl.value = prim.material?.attenuationColor || "#ffffff";
  if (primAttenuationDistanceEl) primAttenuationDistanceEl.value = String(prim.material?.attenuationDistance ?? 1.0);
  if (primAttenuationDistanceValEl) primAttenuationDistanceValEl.textContent = (prim.material?.attenuationDistance ?? 1.0).toFixed(2);
  if (primIridescenceEl) primIridescenceEl.value = String(prim.material?.iridescence ?? 0.0);
  if (primIridescenceValEl) primIridescenceValEl.textContent = (prim.material?.iridescence ?? 0.0).toFixed(2);
  if (primEmissiveColorEl) primEmissiveColorEl.value = prim.material?.emissive || "#000000";
  if (primEmissiveIntensityEl) primEmissiveIntensityEl.value = String(prim.material?.emissiveIntensity ?? 0.0);
  if (primEmissiveIntensityValEl) primEmissiveIntensityValEl.textContent = (prim.material?.emissiveIntensity ?? 0.0).toFixed(2);
  if (primClearcoatEl) primClearcoatEl.value = String(prim.material?.clearcoat ?? 0.0);
  if (primClearcoatValEl) primClearcoatValEl.textContent = (prim.material?.clearcoat ?? 0.0).toFixed(2);
  if (primClearcoatRoughnessEl) primClearcoatRoughnessEl.value = String(prim.material?.clearcoatRoughness ?? 0.0);
  if (primClearcoatRoughnessValEl) primClearcoatRoughnessValEl.textContent = (prim.material?.clearcoatRoughness ?? 0.0).toFixed(2);
  if (primAlphaCutoffEl) primAlphaCutoffEl.value = String(prim.material?.alphaCutoff ?? 0.0);
  if (primAlphaCutoffValEl) primAlphaCutoffValEl.textContent = (prim.material?.alphaCutoff ?? 0.0).toFixed(2);
  if (primTextureSoftnessEl) primTextureSoftnessEl.value = String(prim.material?.textureSoftness ?? 0.25);
  if (primTextureSoftnessValEl) primTextureSoftnessValEl.textContent = (prim.material?.textureSoftness ?? 0.25).toFixed(2);
  if (primTextureHardnessEl) primTextureHardnessEl.value = String(prim.material?.textureHardness ?? 0.5);
  if (primTextureHardnessValEl) primTextureHardnessValEl.textContent = (prim.material?.textureHardness ?? 0.5).toFixed(2);
  const uv = prim.material?.uvTransform || {};
  if (primUvRepeatXEl) primUvRepeatXEl.value = String(uv.repeatX ?? 1);
  if (primUvRepeatXValEl) primUvRepeatXValEl.textContent = Number(uv.repeatX ?? 1).toFixed(2);
  if (primUvRepeatYEl) primUvRepeatYEl.value = String(uv.repeatY ?? 1);
  if (primUvRepeatYValEl) primUvRepeatYValEl.textContent = Number(uv.repeatY ?? 1).toFixed(2);
  if (primUvOffsetXEl) primUvOffsetXEl.value = String(uv.offsetX ?? 0);
  if (primUvOffsetXValEl) primUvOffsetXValEl.textContent = Number(uv.offsetX ?? 0).toFixed(2);
  if (primUvOffsetYEl) primUvOffsetYEl.value = String(uv.offsetY ?? 0);
  if (primUvOffsetYValEl) primUvOffsetYValEl.textContent = Number(uv.offsetY ?? 0).toFixed(2);
  if (primUvRotationEl) primUvRotationEl.value = String(uv.rotationDeg ?? 0);
  if (primUvRotationValEl) primUvRotationValEl.textContent = String(Math.round(Number(uv.rotationDeg ?? 0)));
  if (primDoubleSidedEl) primDoubleSidedEl.checked = prim.material?.doubleSided !== false;
  if (primFlatShadingEl) primFlatShadingEl.checked = prim.material?.flatShading === true;
  if (primWireframeEl) primWireframeEl.checked = prim.material?.wireframe === true;
  if (primPhysicsEl) primPhysicsEl.checked = prim.physics !== false;
  if (primCastShadowEl) primCastShadowEl.checked = prim.castShadow !== false;
  if (primReceiveShadowEl) primReceiveShadowEl.checked = prim.receiveShadow !== false;
  if (primTextureLabelEl) primTextureLabelEl.textContent = prim.material?.textureDataUrl ? "Change" : "Upload";

  // Render dimension inputs based on type
  if (primDimsContainerEl) {
    const dims = prim.dimensions || {};
    let html = "";
    const fields = Object.keys(PRIMITIVE_DEFAULTS[prim.type] || {});
    for (const key of fields) {
      const val = dims[key] ?? PRIMITIVE_DEFAULTS[prim.type][key] ?? 1;
      const label = getPrimitiveDimLabel(key);
      const cfg = PRIMITIVE_DIM_CONFIG[key] || { min: 0.05, max: 20, step: 0.05 };
      const valueText = formatPrimitiveDimValue(key, Number(val) || 0);
      html += `<div class="slider"><span class="slider-label">${escapeHtml(label)}</span>
        <input data-dim="${escapeHtml(key)}" type="range" min="${cfg.min}" max="${cfg.max}" step="${cfg.step}" value="${val}" />
        <span class="slider-value">${escapeHtml(valueText)}</span></div>`;
    }
    primDimsContainerEl.innerHTML = html;
  }

  // Render metadata key-value pairs
  renderPrimitiveMetadata(prim);
  refreshPrimitiveSubtractUi(prim);
}

function renderPrimitiveMetadata(prim) {
  if (!primMetaListEl) return;
  const meta = prim.metadata || {};
  const keys = Object.keys(meta);
  if (keys.length === 0) {
    primMetaListEl.innerHTML = '<div class="meta-kv-empty">No custom fields</div>';
    return;
  }
  primMetaListEl.innerHTML = keys
    .map(
      (k) =>
        `<div class="meta-kv-row" data-mk="${escapeHtml(k)}">
          <input class="meta-kv-key" data-field="key" type="text" value="${escapeHtml(k)}" placeholder="key" />
          <input class="meta-kv-val" data-field="val" type="text" value="${escapeHtml(String(meta[k] ?? ""))}" placeholder="value" />
          <button data-action="remove-meta" type="button" class="btn-sm danger" title="Remove">×</button>
        </div>`
    )
    .join("");
}

function rebuildAllPrimitives() {
  // Remove all existing colliders first
  for (const p of primitives) {
    removePrimitiveCollider(p);
  }
  // Remove all visual meshes
  while (primitivesGroup.children.length) {
    const c = primitivesGroup.children[0];
    c.geometry?.dispose();
    disposePrimitiveMaterial(c.material);
    primitivesGroup.remove(c);
  }
  // Rebuild all
  for (const p of primitives) {
    try {
      instantiatePrimitive(p);
    } catch (e) {
      console.warn("Failed to rebuild primitive", p.id, e);
    }
  }
}

// =============================================================================
// EDITOR LIGHTS – User-placed lights with visible proxy icons
// =============================================================================

// Shared geometries for the light icon proxy (created once, reused)
let _lightBulbGeom = null;
let _lightConeGeom = null;
let _lightRaysGeom = null;

function getLightIconGeometries() {
  if (!_lightBulbGeom) {
    _lightBulbGeom = new THREE.SphereGeometry(0.12, 12, 8);
    _lightConeGeom = new THREE.ConeGeometry(0.10, 0.22, 8);
    _lightConeGeom.translate(0, -0.22, 0);
    // Small lines radiating out to make it look like a bulb emitting light
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      pts.push(new THREE.Vector3(cx * 0.15, 0, cz * 0.15));
      pts.push(new THREE.Vector3(cx * 0.28, 0, cz * 0.28));
    }
    _lightRaysGeom = new THREE.BufferGeometry().setFromPoints(pts);
  }
  return { bulb: _lightBulbGeom, cone: _lightConeGeom, rays: _lightRaysGeom };
}

function createLightProxy(lightData) {
  const geos = getLightIconGeometries();
  const color = new THREE.Color(lightData.color || "#ffffff");
  const emissive = color.clone();

  // Build a small group that looks like a light bulb
  const proxy = new THREE.Group();
  proxy.name = `lightProxy:${lightData.id}`;
  proxy.userData.editorLightId = lightData.id;
  proxy.userData.isLightProxy = true;

  // Glowing bulb sphere
  const bulb = new THREE.Mesh(
    geos.bulb,
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 })
  );
  bulb.userData.editorLightId = lightData.id;
  proxy.add(bulb);

  // Colored emission halo (slightly bigger, translucent)
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 12, 8),
    new THREE.MeshBasicMaterial({ color: emissive, transparent: true, opacity: 0.35, depthWrite: false })
  );
  halo.userData.editorLightId = lightData.id;
  proxy.add(halo);

  // Direction cone (points along -Y in local space, we rotate the proxy to aim)
  if (lightData.type !== "point") {
    const cone = new THREE.Mesh(
      geos.cone,
      new THREE.MeshBasicMaterial({ color: emissive, transparent: true, opacity: 0.55 })
    );
    cone.userData.editorLightId = lightData.id;
    proxy.add(cone);
  }

  // Ray lines (point light gets them in all directions)
  const rayMat = new THREE.LineBasicMaterial({ color: emissive, transparent: true, opacity: 0.4 });
  const rays = new THREE.LineSegments(geos.rays, rayMat);
  rays.userData.editorLightId = lightData.id;
  proxy.add(rays);

  // Type label using a tiny sprite
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 128;
  labelCanvas.height = 32;
  const ctx = labelCanvas.getContext("2d");
  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.fillRect(0, 0, 128, 32);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const typeLabel = lightData.type === "point" ? "POINT" : lightData.type === "spot" ? "SPOT" : "DIR";
  ctx.fillText(typeLabel, 64, 16);
  const tex = new THREE.CanvasTexture(labelCanvas);
  const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.7, depthTest: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(0.5, 0.14, 1);
  sprite.position.set(0, 0.28, 0);
  sprite.userData.editorLightId = lightData.id;
  proxy.add(sprite);

  return proxy;
}

function syncLightFromProxy(lightData) {
  if (!lightData._lightObj || !lightData._proxyObj) return;
  const proxy = lightData._proxyObj;
  const light = lightData._lightObj;

  // Sync position
  light.position.copy(proxy.position);
  lightData.position = { x: proxy.position.x, y: proxy.position.y, z: proxy.position.z };

  // Sync rotation → compute target from proxy's -Y axis (local down)
  const dir = new THREE.Vector3(0, -1, 0);
  dir.applyQuaternion(proxy.quaternion).normalize();
  const targetDist = 5; // how far "ahead" the target sits
  const targetPos = proxy.position.clone().add(dir.multiplyScalar(targetDist));

  lightData.rotation = { x: proxy.rotation.x, y: proxy.rotation.y, z: proxy.rotation.z };

  if (light.target) {
    light.target.position.copy(targetPos);
    lightData.target = { x: targetPos.x, y: targetPos.y, z: targetPos.z };
    light.target.updateMatrixWorld();
  }
}

function instantiateEditorLight(lightData) {
  // Remove existing
  removeEditorLightObjects(lightData.id);

  let lightObj;
  const color = new THREE.Color(lightData.color || "#ffffff");
  const intensity = lightData.intensity ?? 1.0;

  switch (lightData.type) {
    case "point":
      lightObj = new THREE.PointLight(color, intensity, lightData.distance || 0);
      break;
    case "spot": {
      lightObj = new THREE.SpotLight(
        color,
        intensity,
        lightData.distance || 0,
        lightData.angle ?? Math.PI / 4,
        lightData.penumbra ?? 0.1
      );
      const tgt = lightData.target || { x: 0, y: 0, z: 0 };
      lightObj.target.position.set(tgt.x, tgt.y, tgt.z);
      lightsGroup.add(lightObj.target);
      break;
    }
    case "directional":
    default: {
      lightObj = new THREE.DirectionalLight(color, intensity);
      const tgt = lightData.target || { x: 0, y: 0, z: 0 };
      lightObj.target.position.set(tgt.x, tgt.y, tgt.z);
      lightsGroup.add(lightObj.target);
      break;
    }
  }

  const pos = lightData.position || { x: 5, y: 10, z: 5 };
  lightObj.position.set(pos.x, pos.y, pos.z);
  lightObj.castShadow = lightData.castShadow ?? false;
  lightObj.name = `light:${lightData.id}`;
  lightObj.userData.editorLightId = lightData.id;
  lightObj.userData.isEditorLight = true;

  // Configure shadow map for this light (only renders when castShadow=true).
  // Use 512 for point/spot (6-face cubemap = expensive) and 1024 for directional.
  if (lightObj.shadow) {
    const res = lightObj.isDirectionalLight ? 1024 : 512;
    lightObj.shadow.mapSize.width = res;
    lightObj.shadow.mapSize.height = res;
    lightObj.shadow.bias = -0.003;
    if (lightObj.shadow.camera) {
      if (lightObj.isDirectionalLight) {
        lightObj.shadow.camera.near = 0.5;
        lightObj.shadow.camera.far = 50;
        lightObj.shadow.camera.left = -20;
        lightObj.shadow.camera.right = 20;
        lightObj.shadow.camera.top = 20;
        lightObj.shadow.camera.bottom = -20;
      } else {
        lightObj.shadow.camera.near = 0.5;
        lightObj.shadow.camera.far = Math.min(lightData.distance || 30, 30);
      }
    }
  }

  lightsGroup.add(lightObj);
  lightData._lightObj = lightObj;

  // Create visible proxy icon (bulb mesh group)
  const proxy = createLightProxy(lightData);
  proxy.position.copy(lightObj.position);

  // Restore rotation if saved
  if (lightData.rotation) {
    proxy.rotation.set(lightData.rotation.x, lightData.rotation.y, lightData.rotation.z);
  } else if (lightObj.target) {
    // Compute initial rotation from position → target
    const targetPos = lightObj.target.position.clone();
    const lightPos = lightObj.position.clone();
    const dir = targetPos.sub(lightPos).normalize();
    // We want the proxy's -Y axis to point along dir
    const up = new THREE.Vector3(0, -1, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    proxy.quaternion.copy(q);
    lightData.rotation = { x: proxy.rotation.x, y: proxy.rotation.y, z: proxy.rotation.z };
  }

  proxy.visible = shouldShowEditorGuides();
  lightsGroup.add(proxy);
  lightData._proxyObj = proxy;

  // Also keep a minimal helper line from light to target for directional/spot
  if (lightData.type !== "point") {
    const helperMat = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.25 });
    const points = [lightObj.position.clone(), lightObj.target?.position?.clone() || new THREE.Vector3()];
    const helperLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), helperMat);
    helperLine.name = `lightHelper:${lightData.id}`;
    helperLine.userData.editorLightId = lightData.id;
    helperLine.userData.isLightHelper = true;
    helperLine.visible = shouldShowEditorGuides();
    lightsGroup.add(helperLine);
    lightData._helperObj = helperLine;
  } else {
    lightData._helperObj = null;
  }
}

function removeEditorLightObjects(id) {
  const names = [`light:${id}`, `lightHelper:${id}`, `lightProxy:${id}`];
  for (const n of names) {
    const obj = lightsGroup.getObjectByName(n);
    if (obj) {
      // Remove target if it exists (directional/spot)
      if (obj.target && obj.target.parent) obj.target.parent.remove(obj.target);
      // Dispose children meshes
      obj.traverse?.((c) => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          if (c.material.map) c.material.map.dispose();
          c.material.dispose();
        }
      });
      lightsGroup.remove(obj);
    }
  }
}

function addEditorLight(type) {
  // Place light in front of camera
  const dir = camera.getWorldDirection(new THREE.Vector3());
  const p = camera.getWorldPosition(new THREE.Vector3());
  const spawnPos = { x: p.x + dir.x * 3, y: p.y + 3, z: p.z + dir.z * 3 };

  const lightData = {
    id: randId(),
    type: type || "directional",
    name: (type || "directional").charAt(0).toUpperCase() + (type || "directional").slice(1) + " Light",
    color: "#ffffff",
    intensity: type === "directional" ? 1.5 : 1.0,
    position: spawnPos,
    target: { x: spawnPos.x, y: 0, z: spawnPos.z },
    distance: type === "point" ? 20 : type === "spot" ? 20 : 0,
    angle: Math.PI / 4,
    penumbra: 0.1,
    castShadow: false,
  };

  editorLights.push(lightData);
  instantiateEditorLight(lightData);
  saveTagsForWorld();
  renderLightsList();
  selectLight(lightData.id);
  setStatus(`${lightData.name} placed. Use transform tools to position.`);
}

function selectLight(id) {
  detachGroupTransform();
  selectedGroupId = null;
  const gd = document.getElementById("group-details");
  if (gd) gd.remove();

  selectedLightId = id;
  if (id) {
    selectedAssetId = null;
    selectedPrimitiveId = null;
    selectedSceneLightId = null;
    renderAssetsList();
    renderPrimitivesList();
    renderPrimitiveProps();
    renderSceneLightsList();
    renderSceneLightProps();
  }
  renderLightsList();
  renderLightProps();
  updateDetailsPanel();

  const lightData = editorLights.find((l) => l.id === id);
  const proxy = lightData?._proxyObj;
  if (appMode === "edit" && proxy) {
    transformControls.attach(proxy);
    transformControls.enabled = true;
    transformControls.visible = true;
  } else if (!selectedAssetId && !selectedPrimitiveId) {
    transformControls.detach();
    transformControls.enabled = false;
    transformControls.visible = false;
  }
}

function getSelectedLight() {
  return editorLights.find((l) => l.id === selectedLightId) || null;
}

function persistSelectedLightTransform() {
  const ld = getSelectedLight();
  if (!ld) return;

  // Sync from proxy → light
  syncLightFromProxy(ld);

  // Update the helper line if present
  if (ld._helperObj && ld._helperObj.geometry && ld._lightObj) {
    const pts = [ld._lightObj.position.clone(), ld._lightObj.target?.position?.clone() || new THREE.Vector3()];
    ld._helperObj.geometry.dispose();
    ld._helperObj.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  saveTagsForWorld();
}

function deleteEditorLight(id) {
  const idx = editorLights.findIndex((l) => l.id === id);
  if (idx === -1) return;
  removeEditorLightObjects(id);
  editorLights.splice(idx, 1);
  if (selectedLightId === id) {
    selectedLightId = null;
    transformControls?.detach();
    transformControls.visible = false;
    transformControls.enabled = false;
  }
  saveTagsForWorld();
  renderLightsList();
  renderLightProps();
  setStatus("Light deleted.");
}

function updateEditorLightFromProps(ld) {
  if (!ld?._lightObj) return;
  const obj = ld._lightObj;
  obj.color.set(ld.color || "#ffffff");
  obj.intensity = ld.intensity ?? 1.0;
  if (obj.isPointLight || obj.isSpotLight) {
    obj.distance = ld.distance ?? 0;
  }
  if (obj.isSpotLight) {
    obj.angle = ld.angle ?? Math.PI / 4;
    obj.penumbra = ld.penumbra ?? 0.1;
  }
  if (obj.target) {
    const t = ld.target || { x: 0, y: 0, z: 0 };
    obj.target.position.set(t.x, t.y, t.z);
  }
  obj.castShadow = ld.castShadow ?? false;

  // Update proxy icon colors to match light color
  if (ld._proxyObj) {
    const c = new THREE.Color(ld.color || "#ffffff");
    ld._proxyObj.traverse((child) => {
      if (child.isMesh && child.material && child !== ld._proxyObj.children[0]) {
        // Don't change the white bulb core; tint everything else
        child.material.color.copy(c);
      }
      if (child.isLine && child.material) {
        child.material.color.copy(c);
      }
    });
  }

  // Update helper line endpoints
  if (ld._helperObj && ld._helperObj.geometry && obj.target) {
    const pts = [obj.position.clone(), obj.target.position.clone()];
    ld._helperObj.geometry.dispose();
    ld._helperObj.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    if (ld._helperObj.material) ld._helperObj.material.color.set(ld.color || "#ffffff");
  }

  saveTagsForWorld();
}

function renderLightsList() {
  if (!lightsListEl) return;
  lightsListEl.innerHTML = "";
  for (const l of editorLights) {
    const el = document.createElement("div");
    el.className = "tag-item" + (l.id === selectedLightId ? " active" : "");
    el.innerHTML = `${escapeHtml(l.name || l.type)}<small>${escapeHtml(l.type)}</small>`;
    el.addEventListener("click", () => selectLight(l.id));
    lightsListEl.appendChild(el);
  }
  updateOutlinerCounts();
}

function renderLightProps() {
  const ld = getSelectedLight();
  if (lightPropsEl) lightPropsEl.classList.toggle("hidden", !ld);
  if (!ld) return;

  if (lightNameEl) lightNameEl.value = ld.name || "";
  if (lightTypeEl) lightTypeEl.value = ld.type || "directional";
  if (lightColorEl) lightColorEl.value = ld.color || "#ffffff";
  if (lightIntensityEl) lightIntensityEl.value = String(ld.intensity ?? 1.0);
  if (lightIntensityValEl) lightIntensityValEl.textContent = (ld.intensity ?? 1.0).toFixed(2);
  if (lightDistanceEl) lightDistanceEl.value = String(ld.distance ?? 0);
  if (lightDistanceValEl) lightDistanceValEl.textContent = String(Math.round(ld.distance ?? 0));
  if (lightAngleEl) lightAngleEl.value = String(ld.angle ?? 0.78);
  if (lightAngleValEl) lightAngleValEl.textContent = Math.round(((ld.angle ?? 0.78) * 180) / Math.PI) + "\u00B0";
  if (lightPenumbraEl) lightPenumbraEl.value = String(ld.penumbra ?? 0.1);
  if (lightPenumbraValEl) lightPenumbraValEl.textContent = (ld.penumbra ?? 0.1).toFixed(2);

  const t = ld.target || { x: 0, y: 0, z: 0 };
  if (lightTargetXEl) lightTargetXEl.value = t.x;
  if (lightTargetYEl) lightTargetYEl.value = t.y;
  if (lightTargetZEl) lightTargetZEl.value = t.z;

  if (lightCastShadowEl) lightCastShadowEl.checked = ld.castShadow ?? false;

  // Show/hide groups based on type
  const isPoint = ld.type === "point";
  const isSpot = ld.type === "spot";
  if (lightDistanceGroupEl) lightDistanceGroupEl.classList.toggle("hidden", !isPoint && !isSpot);
  if (lightSpotGroupEl) lightSpotGroupEl.classList.toggle("hidden", !isSpot);
}

function rebuildAllEditorLights() {
  // Remove all light objects
  while (lightsGroup.children.length) {
    const c = lightsGroup.children[0];
    c.traverse?.((m) => { m.geometry?.dispose(); m.material?.dispose(); });
    lightsGroup.remove(c);
  }
  for (const ld of editorLights) {
    ld._lightObj = null;
    ld._helperObj = null;
    ld._proxyObj = null;
    try {
      instantiateEditorLight(ld);
    } catch (e) {
      console.warn("Failed to rebuild light", ld.id, e);
    }
  }
  // Enable/disable the renderer shadow map based on whether any light casts shadows
  syncShadowMapEnabled();
}

// =============================================================================
// SCENE LIGHTS – Built-in lights exposed in the editor
// =============================================================================

let selectedSceneLightId = null;

function renderSceneLightsList() {
  if (!sceneLightsListEl) return;
  sceneLightsListEl.innerHTML = "";
  for (const sl of sceneLights) {
    const el = document.createElement("div");
    el.className = "tag-item" + (sl.id === selectedSceneLightId ? " active" : "");
    const isOn = sl.type === "sky" ? sceneSettings.sky.enabled : sl.obj.visible !== false;
    const onOff = isOn ? "" : " (off)";
    el.innerHTML = `${escapeHtml(sl.label)}${onOff}<small>${escapeHtml(sl.type)}</small>`;
    el.addEventListener("click", () => selectSceneLight(sl.id));
    sceneLightsListEl.appendChild(el);
  }
}

function selectSceneLight(id) {
  selectedSceneLightId = id;
  // Deselect everything else
  if (id) {
    selectedAssetId = null;
    selectedPrimitiveId = null;
    selectedLightId = null;
    draftTag = null;
    selectedTagId = null;
    renderAssetsList();
    renderPrimitivesList();
    renderPrimitiveProps();
    renderLightsList();
    renderLightProps();
    renderTagsList();
    renderTagPanel();
  }
  renderSceneLightsList();
  renderSceneLightProps();
  updateDetailsPanel();

  // No transform controls for scene lights (ambient/hemi have no position)
  transformControls?.detach();
  transformControls.visible = false;
  transformControls.enabled = false;
}

function getSelectedSceneLight() {
  return sceneLights.find((sl) => sl.id === selectedSceneLightId) || null;
}

function renderSceneLightProps() {
  const sl = getSelectedSceneLight();
  if (sceneLightPropsEl) sceneLightPropsEl.classList.toggle("hidden", !sl);
  if (!sl) return;

  const obj = sl.obj;
  const isShadowGround = sl.type === "shadow_ground";
  const isSky = sl.type === "sky";
  if (slTitleEl) slTitleEl.textContent = sl.label;
  if (slEnabledEl) slEnabledEl.checked = isSky ? !!sceneSettings?.sky?.enabled : obj.visible !== false;

  // Shadow ground: repurpose intensity slider as opacity
  if (isShadowGround) {
    if (slColorEl) slColorEl.parentElement.classList.add("hidden");
    if (slSkyControlsEl) slSkyControlsEl.classList.add("hidden");
    if (slIntensityEl) {
      slIntensityEl.min = "0";
      slIntensityEl.max = "1";
      slIntensityEl.step = "0.05";
      slIntensityEl.value = String(obj.material?.opacity ?? 0.35);
    }
    if (slIntensityValEl) slIntensityValEl.textContent = (obj.material?.opacity ?? 0.35).toFixed(2);
    // Relabel
    const label = slIntensityEl?.parentElement?.querySelector(".slider-label");
    if (label) label.textContent = "OPACITY";
    if (slGroundRowEl) slGroundRowEl.classList.add("hidden");
    if (slDistanceRowEl) slDistanceRowEl.classList.add("hidden");
    if (slShadowRowEl) slShadowRowEl.classList.add("hidden");
    return;
  }

  if (isSky) {
    if (slColorEl) slColorEl.parentElement.classList.add("hidden");
    if (slGroundRowEl) slGroundRowEl.classList.add("hidden");
    if (slDistanceRowEl) slDistanceRowEl.classList.add("hidden");
    if (slShadowRowEl) slShadowRowEl.classList.add("hidden");
    if (slIntensityEl) slIntensityEl.parentElement.classList.add("hidden");
    if (slSkyControlsEl) slSkyControlsEl.classList.remove("hidden");

    const s = normalizeSceneSettings(sceneSettings).sky;
    if (slSkyTopColorEl) slSkyTopColorEl.value = s.topColor;
    if (slSkyHorizonColorEl) slSkyHorizonColorEl.value = s.horizonColor;
    if (slSkyBottomColorEl) slSkyBottomColorEl.value = s.bottomColor;
    if (slSkyBrightnessEl) slSkyBrightnessEl.value = String(s.brightness);
    if (slSkyBrightnessValEl) slSkyBrightnessValEl.textContent = Number(s.brightness).toFixed(2);
    if (slSkySoftnessEl) slSkySoftnessEl.value = String(s.softness);
    if (slSkySoftnessValEl) slSkySoftnessValEl.textContent = Number(s.softness).toFixed(2);
    if (slSkySunStrengthEl) slSkySunStrengthEl.value = String(s.sunStrength);
    if (slSkySunStrengthValEl) slSkySunStrengthValEl.textContent = Number(s.sunStrength).toFixed(2);
    if (slSkySunHeightEl) slSkySunHeightEl.value = String(s.sunHeight);
    if (slSkySunHeightValEl) slSkySunHeightValEl.textContent = Number(s.sunHeight).toFixed(2);
    return;
  }

  // Normal light
  if (slSkyControlsEl) slSkyControlsEl.classList.add("hidden");
  if (slIntensityEl) slIntensityEl.parentElement.classList.remove("hidden");
  if (slColorEl) {
    slColorEl.parentElement.classList.remove("hidden");
    slColorEl.value = "#" + obj.color.getHexString();
  }
  if (slIntensityEl) {
    slIntensityEl.min = "0";
    slIntensityEl.max = "10";
    slIntensityEl.step = "0.05";
    slIntensityEl.value = String(obj.intensity);
  }
  if (slIntensityValEl) slIntensityValEl.textContent = obj.intensity.toFixed(2);
  const label = slIntensityEl?.parentElement?.querySelector(".slider-label");
  if (label) label.textContent = "INTENSITY";

  const isHemi = sl.type === "hemisphere";
  const isPoint = sl.type === "point";
  const isAmbient = sl.type === "ambient";
  const canShadow = !isAmbient && !isHemi;
  if (slGroundRowEl) slGroundRowEl.classList.toggle("hidden", !isHemi);
  if (slDistanceRowEl) slDistanceRowEl.classList.toggle("hidden", !isPoint);
  if (slShadowRowEl) slShadowRowEl.classList.toggle("hidden", !canShadow);
  if (slShadowEl && canShadow) slShadowEl.checked = obj.castShadow ?? false;

  if (isHemi && slGroundColorEl) {
    slGroundColorEl.value = "#" + obj.groundColor.getHexString();
  }
  if (isPoint && slDistanceEl) {
    slDistanceEl.value = String(obj.distance ?? 0);
    if (slDistanceValEl) slDistanceValEl.textContent = String(Math.round(obj.distance ?? 0));
  }
}

// Render the list on startup
renderSceneLightsList();

// =============================================================================
// DETAILS PANEL & TRANSFORM XYZ – UE-style unified properties
// =============================================================================

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

// Show the details panel and populate it for the currently selected object
function updateDetailsPanel() {
  const hasPrim = !!selectedPrimitiveId;
  const hasLight = !!selectedLightId;
  const hasAsset = !!selectedAssetId;
  const hasTag = !!draftTag;
  const hasSceneLight = !!selectedSceneLightId;
  const hasGroup = !!selectedGroupId;
  const hasAnything = hasPrim || hasLight || hasAsset || hasTag || hasSceneLight || hasGroup;

  if (detailsPanelEl) detailsPanelEl.classList.toggle("hidden", !hasAnything);
  if (assetDetailsEl) assetDetailsEl.classList.toggle("hidden", !hasAsset);
  if (sceneLightPropsEl) sceneLightPropsEl.classList.toggle("hidden", !hasSceneLight);

  refreshTransformToolbar();
  renderBuilderStateEditorPanel();

  if (!hasAnything) return;

  // Set title
  if (detailsTitleEl) {
    if (hasSceneLight) {
      const sl = getSelectedSceneLight();
      detailsTitleEl.textContent = `Scene: ${sl?.label || "Light"}`;
    } else if (hasPrim) {
      const p = getSelectedPrimitive();
      detailsTitleEl.textContent = `Shape: ${p?.name || p?.type || "Shape"}`;
    } else if (hasLight) {
      const l = getSelectedLight();
      detailsTitleEl.textContent = `Light: ${l?.name || l?.type || "Light"}`;
    } else if (hasAsset) {
      const a = getSelectedAsset();
      detailsTitleEl.textContent = `Asset: ${a?.title || "(asset)"}`;
    } else if (hasTag) {
      detailsTitleEl.textContent = `Tag: ${draftTag?.title || "(tag)"}`;
    }
  }

  // Populate transform XYZ from the selected object
  populateTransformInputs();
}

function populateTransformInputs() {
  let obj3d = null;

  if (selectedGroupId && groupPivot) {
    obj3d = groupPivot;
  } else if (selectedPrimitiveId) {
    obj3d = primitivesGroup.getObjectByName(`prim:${selectedPrimitiveId}`);
  } else if (selectedLightId) {
    const ld = getSelectedLight();
    obj3d = ld?._proxyObj || ld?._lightObj;
  } else if (selectedAssetId) {
    obj3d = assetsGroup.getObjectByName(`asset:${selectedAssetId}`);
  } else if (draftTag) {
    // Tags don't have full transform — just position
    if (xformPxEl) xformPxEl.value = (draftTag.position?.x ?? 0).toFixed(2);
    if (xformPyEl) xformPyEl.value = (draftTag.position?.y ?? 0).toFixed(2);
    if (xformPzEl) xformPzEl.value = (draftTag.position?.z ?? 0).toFixed(2);
    if (xformRxEl) xformRxEl.value = "0";
    if (xformRyEl) xformRyEl.value = "0";
    if (xformRzEl) xformRzEl.value = "0";
    if (xformSxEl) xformSxEl.value = "1";
    if (xformSyEl) xformSyEl.value = "1";
    if (xformSzEl) xformSzEl.value = "1";
    return;
  }

  if (!obj3d) return;

  if (xformPxEl) xformPxEl.value = obj3d.position.x.toFixed(2);
  if (xformPyEl) xformPyEl.value = obj3d.position.y.toFixed(2);
  if (xformPzEl) xformPzEl.value = obj3d.position.z.toFixed(2);
  if (xformRxEl) xformRxEl.value = (obj3d.rotation.x * RAD2DEG).toFixed(1);
  if (xformRyEl) xformRyEl.value = (obj3d.rotation.y * RAD2DEG).toFixed(1);
  if (xformRzEl) xformRzEl.value = (obj3d.rotation.z * RAD2DEG).toFixed(1);
  if (xformSxEl) xformSxEl.value = obj3d.scale.x.toFixed(2);
  if (xformSyEl) xformSyEl.value = obj3d.scale.y.toFixed(2);
  if (xformSzEl) xformSzEl.value = obj3d.scale.z.toFixed(2);
}

function applyTransformFromInputs() {
  const px = parseFloat(xformPxEl?.value) || 0;
  const py = parseFloat(xformPyEl?.value) || 0;
  const pz = parseFloat(xformPzEl?.value) || 0;
  const rx = (parseFloat(xformRxEl?.value) || 0) * DEG2RAD;
  const ry = (parseFloat(xformRyEl?.value) || 0) * DEG2RAD;
  const rz = (parseFloat(xformRzEl?.value) || 0) * DEG2RAD;
  const sx = Math.max(parseFloat(xformSxEl?.value) || 1, 0.01);
  const sy = Math.max(parseFloat(xformSyEl?.value) || 1, 0.01);
  const sz = Math.max(parseFloat(xformSzEl?.value) || 1, 0.01);

  if (selectedGroupId && groupPivot) {
    groupPivot.position.set(px, py, pz);
    groupPivot.rotation.set(rx, ry, rz);
    groupPivot.scale.set(sx, sy, sz);
    persistGroupTransformsAndRebuild();
  } else if (selectedPrimitiveId) {
    const obj = primitivesGroup.getObjectByName(`prim:${selectedPrimitiveId}`);
    if (obj) {
      obj.position.set(px, py, pz);
      obj.rotation.set(rx, ry, rz);
      obj.scale.set(sx, sy, sz);
      persistSelectedPrimitiveTransform();
    }
  } else if (selectedLightId) {
    const ld = getSelectedLight();
    const obj = ld?._proxyObj || ld?._lightObj;
    if (obj) {
      obj.position.set(px, py, pz);
      obj.rotation.set(rx, ry, rz);
      persistSelectedLightTransform();
    }
  } else if (selectedAssetId) {
    const obj = assetsGroup.getObjectByName(`asset:${selectedAssetId}`);
    if (obj) {
      obj.position.set(px, py, pz);
      obj.rotation.set(rx, ry, rz);
      obj.scale.set(sx, sy, sz);
      persistSelectedAssetTransform();
    }
  }
}

// Dynamically enable/disable the shadow map system.
// When no light casts shadows, the renderer skips ALL shadow work (zero overhead).
function enforceShadowSamplerBudget() {
  // Prevent WebGL shader validation failures:
  // "texture image units count exceeds MAX_TEXTURE_IMAGE_UNITS"
  // Point-light shadows are especially expensive (cube map = ~6 samplers).
  const budget = 8;
  const costFor = (lightObj) => (lightObj?.isPointLight ? 6 : 1);

  const candidates = [];
  for (const sl of sceneLights) {
    if (!sl?.obj || sl.obj.visible === false) continue;
    if (!sl.obj.castShadow) continue;
    candidates.push({ obj: sl.obj, source: "scene", meta: sl });
  }
  for (const ld of editorLights) {
    if (!ld?._lightObj || ld._lightObj.visible === false) continue;
    if (!ld._lightObj.castShadow) continue;
    candidates.push({ obj: ld._lightObj, source: "editor", meta: ld });
  }

  // Prefer non-point shadow lights first (directional/spot), then points.
  candidates.sort((a, b) => {
    const ac = costFor(a.obj);
    const bc = costFor(b.obj);
    if (ac !== bc) return ac - bc; // cheaper first
    return 0;
  });

  let used = 0;
  for (const c of candidates) {
    const cost = costFor(c.obj);
    if (used + cost <= budget) {
      used += cost;
      continue;
    }
    c.obj.castShadow = false;
    // keep data model consistent so UI reflects actual runtime state
    if (c.source === "editor") c.meta.castShadow = false;
  }
}

function syncShadowMapEnabled() {
  enforceShadowSamplerBudget();
  let anyCast = false;
  // Check scene lights
  for (const sl of sceneLights) {
    if (sl.obj?.castShadow && sl.obj?.visible !== false) { anyCast = true; break; }
  }
  // Check editor lights
  if (!anyCast) {
    for (const ld of editorLights) {
      if (ld._lightObj?.castShadow && ld._lightObj?.visible !== false) { anyCast = true; break; }
    }
  }
  if (renderer.shadowMap.enabled !== anyCast) {
    renderer.shadowMap.enabled = anyCast;
    // When toggling shadow maps, Three.js needs to recompile materials
    scene.traverse((obj) => { if (obj.material) obj.material.needsUpdate = true; });
  }
  if (anyCast) renderer.shadowMap.needsUpdate = true;
}

function updateOutlinerCounts() {
  if (olTagsCountEl) olTagsCountEl.textContent = String(tags.length);
  if (olAssetsCountEl) olAssetsCountEl.textContent = String(assets.length);
  if (olPrimsCountEl) olPrimsCountEl.textContent = String(primitives.length) + (groups.length ? ` (${groups.length}g)` : "");
  if (olLightsCountEl) olLightsCountEl.textContent = String(editorLights.length);
}

const _tmpCamPos = new THREE.Vector3();
const _tmpCamDir = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();

function rapierRaycastFromCamera(maxToi = 250) {
  if (!rapierWorld || !RAPIER) return null;
  // Query pipeline is kept current by rapierWorld.step() in updateRapier

  const o = camera.getWorldPosition(_tmpCamPos);
  const d = camera.getWorldDirection(_tmpCamDir).normalize();

  const ray = new RAPIER.Ray({ x: o.x, y: o.y, z: o.z }, { x: d.x, y: d.y, z: d.z });
  const hit = rapierWorld.queryPipeline.castRayAndGetNormal(
    rapierWorld.bodies,
    rapierWorld.colliders,
    ray,
    maxToi,
    false, // hollow: can hit boundary even if ray starts inside
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    undefined,
    playerCollider?.handle
  );
  if (!hit) return null;
  const toi = hit.toi ?? hit.timeOfImpact ?? 0;
  const p = { x: o.x + d.x * toi, y: o.y + d.y * toi, z: o.z + d.z * toi };
  const n = hit.normal ? { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z } : null;
  return { point: p, normal: n, colliderHandle: hit.colliderHandle ?? null, toi };
}

function isShapeFreeAt(shape, rot, pos, excludeColliderHandle = null) {
  if (!rapierWorld || !RAPIER) return false;
  const hit = rapierWorld.queryPipeline.intersectionWithShape(
    rapierWorld.bodies,
    rapierWorld.colliders,
    pos,
    rot,
    shape,
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    undefined,
    excludeColliderHandle
  );
  return hit == null;
}

function findNearbyFreeSpotForCollider(collider, startPos, maxR = 2.0, step = 0.12) {
  if (!collider) return null;
  const shape = collider.shape;
  const rot = collider.rotation();
  const exclude = collider.handle;

  if (isShapeFreeAt(shape, rot, startPos, exclude)) return startPos;

  const dirs = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [1, 0, 1],
    [1, 0, -1],
    [-1, 0, 1],
    [-1, 0, -1],
    [0, 1, 0],
    [0, -1, 0],
  ];
  for (let r = step; r <= maxR; r += step) {
    for (const [dx, dy, dz] of dirs) {
      const len = Math.hypot(dx, dy, dz) || 1;
      const pos = { x: startPos.x + (dx / len) * r, y: startPos.y + (dy / len) * r, z: startPos.z + (dz / len) * r };
      if (isShapeFreeAt(shape, rot, pos, exclude)) return pos;
    }
  }
  return null;
}

function removeAiAgent(agent, reason = "manual") {
  if (!agent) return;
  const removedId = String(agent.id || "");
  try {
    aiAgents = aiAgents.filter((a) => a !== agent);
    agentUiPush(`${new Date().toLocaleTimeString()}\nAGENT DESPAWN\n${agent.id} (${reason})`);
    agent.dispose?.();
  } catch {}
  if (removedId) {
    _agentTasks.delete(removedId);
    agentInspectorStateById.delete(removedId);
  }
  if (removedId) removeAgentBadge(removedId);
  if (agentCameraFollowId === removedId) {
    disableAgentCameraFollow();
  }
  if (selectedAgentInspectorId === removedId) {
    selectedAgentInspectorId = aiAgents[0]?.id || null;
    if (selectedAgentInspectorId) renderAgentInspector(selectedAgentInspectorId);
    else {
      clearAgentInspectorViews();
    }
  }
  if (aiAgents.length === 0) {
    disableAgentCameraFollow();
  }
  renderAgentTaskUi();
}

function stopAiAgent(agent, reason = "manual-stop") {
  if (!agent) return;
  try {
    if (agent.vlm) agent.vlm.enabled = false;
    agent._plan = null;
    agent._pendingDecision = null;
    agent._setThought?.("Stopped");
  } catch {}
  agentUiPush(`${new Date().toLocaleTimeString()}\nAGENT STOP\n${agent.id} (${reason})`);
  renderAgentTaskUi();
}

function despawnEphemeralAgents(reason = "task-end") {
  const doomed = aiAgents.filter((a) => a?._ephemeral === true);
  for (const a of doomed) removeAiAgent(a, reason);
}

function createAiAgent({ ephemeral = false } = {}) {
  const endpoint = localStorage.getItem("sparkWorldVlmEndpoint") || "/vlm/decision";
  const model = resolveActiveVlmModel();
  const nearbyRange = IS_SIM_ONLY_PROFILE ? 2.5 : appMode === "edit" ? 12 : 2.5;
  const id = `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  let agentRef = null;
  const agent = new AiAvatar({
    id,
    scene,
    rapierWorld,
    RAPIER,
    getWorldKey: () => worldKey,
    getTags: () => tags,
    getPlayerPosition: () => (Array.isArray(window.__playerPosition) ? window.__playerPosition : [0, 0, 0]),
    // Editor workers use lightweight capsule form only (skip GLB load).
    avatarUrl: appMode === "edit" ? "" : ["/agent-model/unitree_go2.glb", "/agent-model/robot.glb"],
    senseRadius: 3.0,
    walkSpeed: 2.0,
    vlm: {
      // In dimos mode, VLM is disabled — agent pose is driven externally via /odom.
      // Ephemeral workers auto-enable; manually spawned agents start idle.
      enabled: dimosMode ? false : true,
      showSpeechBubbleInScene: appMode !== "sim",
      holdPositionWhenIdle: true,
      endpoint,
      model,
      getModel: resolveActiveVlmModel,
      actions: ACTIVE_VLM_ACTIONS,
      buildPrompt: () => buildActiveVlmPrompt(),
      request: requestVlmDecision,
      captureBase64: async (a) => {
        // If a sensor mode is active (RGB-D, LiDAR, Compare), capture the
        // on-screen view which already renders in that mode via renderActiveView.
        if (simSensorViewMode !== "rgb" || simCompareView) {
          const [ax, ay, az] = a.getPosition?.() || [0, 0, 0];
          const yaw = a.group?.rotation?.y ?? 0;
          const pitch = typeof a.pitch === "number" ? a.pitch : 0;
          const cp = Math.cos(pitch), sp = Math.sin(pitch);
          const eyeY = ay + PLAYER_EYE_HEIGHT * 0.9;
          const prevPos = camera.position.clone();
          const prevQuat = camera.quaternion.clone();
          camera.position.set(ax, eyeY, az);
          camera.lookAt(ax + Math.sin(yaw) * cp, eyeY + sp, az + Math.cos(yaw) * cp);
          camera.updateProjectionMatrix();
          camera.updateMatrixWorld(true);
          renderActiveView();
          const dataUrl = renderer.domElement.toDataURL("image/jpeg", 0.8);
          camera.position.copy(prevPos);
          camera.quaternion.copy(prevQuat);
          camera.updateProjectionMatrix();
          camera.updateMatrixWorld(true);
          const idx = dataUrl.indexOf("base64,");
          return idx !== -1 ? dataUrl.slice(idx + 7) : null;
        }
        return captureAgentPovBase64({
          agent: a,
          renderer,
          scene,
          mainCamera: camera,
          width: 960,
          height: 432,
          eyeHeight: PLAYER_EYE_HEIGHT * 0.9,
          fov: camera.fov,
          near: camera.near,
          far: camera.far,
          headLamp: null,
          jpegQuality: 0.8,
        });
      },
      decideEverySteps: ACTIVE_VLM_DEFAULTS.decideEverySteps,
      stepMeters: ACTIVE_VLM_DEFAULTS.stepMeters,
      getTask: () => ({ ..._getAgentTask(id) }),
      // Editor agents need a broader object window so transform IDs stay visible.
      getNearbyAssets: (a) => getNearbyAssetsForAgent(a, nearbyRange),
      getNearbyPrimitives: (a) => getNearbyPrimitivesForAgent(a, nearbyRange),
      isEditorMode: () => (!IS_SIM_ONLY_PROFILE && appMode === "edit"),
      ...(!IS_SIM_ONLY_PROFILE
        ? {
            getRecentGeneratedAssets: (a) => getAgentRecentGeneratedAssets(a, 8),
            getAssetLibraryNames: () =>
              readAssetLibraryRecords()
                .map((r) => String(r?.name || "").trim())
                .filter(Boolean)
                .slice(0, 40),
            createPrimitiveInEditor: ({ agent: a, shape }) => agentCreatePrimitiveInEditor({ shape, agent: a }),
            spawnLibraryAssetInEditor: ({ agent: a, assetName }) => agentSpawnLibraryAssetInEditor({ assetName, agent: a }),
            transformObjectInEditor: (params) => agentTransformObjectInEditor(params),
            generateAssetInEditor: ({ agent: a, prompt, placeNow, allowMultiple, count }) =>
              agentGenerateAssetInEditor({ agent: a, prompt, placeNow, allowMultiple, count }),
          }
        : {}),
      interactAsset: ({ agent: a, assetId, actionId }) => agentInteractAsset({ agent: a, assetId, actionId }),
      pickUpAsset: ({ agent: a, assetId }) => agentPickUpAsset(a, assetId),
      dropAsset: ({ agent: a }) => agentDropAsset(a),
      getHeldAsset: (a) => getAgentHeldAsset(a),
      onCapture: (base64) => {
        const id = agentRef?.id || "";
        const s = getOrCreateAgentInspectorState(id);
        s.shot = base64 || "";
        if (!selectedAgentInspectorId) selectedAgentInspectorId = id;
        if (selectedAgentInspectorId === id) agentUiSetShot(base64);
      },
      onRequest: ({ endpoint: ep, model: m, prompt, context, imageBase64, messages }) => {
        const id = agentRef?.id || "";
        const req = {
          endpoint: ep,
          model: m,
          prompt,
          context,
          imageBytes: imageBase64 ? Math.floor((imageBase64.length * 3) / 4) : null,
          messages,
        };
        const s = getOrCreateAgentInspectorState(id);
        s.request = req;
        if (!selectedAgentInspectorId) selectedAgentInspectorId = id;
        if (selectedAgentInspectorId === id) renderAgentInspector(id);
        agentUiPush(`${new Date().toLocaleTimeString()}\nREQUEST ${m}\n${ep}\nagent=${id}`);
      },
      onResponse: ({ raw, parsed }) => {
        const id = agentRef?.id || "";
        const resp = { raw, parsed };
        const s = getOrCreateAgentInspectorState(id);
        s.response = resp;
        if (!selectedAgentInspectorId) selectedAgentInspectorId = id;
        if (selectedAgentInspectorId === id) agentUiSetResponse(resp);
        const action = typeof parsed?.action === "string" ? parsed.action : "";
        agentUiPush(`${new Date().toLocaleTimeString()}\nRESPONSE\n${action}\nagent=${id}`);
      },
      onActionApplied: ({ action, params, plan }) => {
        const id = agentRef?.id || "";
        agentUiPush(
          `${new Date().toLocaleTimeString()}\nAPPLY ${action}\nparams=${JSON.stringify(params || {})}\nplan=${JSON.stringify(plan || {})}\nagent=${id}`
        );
      },
      onTaskFinished: ({ summary }) => {
        const agent = agentRef;
        const summaryText = String(summary || "").trim();
        agentUiPush(`${new Date().toLocaleTimeString()}\nTASK FINISH${agent ? ` [${agent.id}]` : ""}\n${summaryText}`);

        // End this specific agent's task
        if (agent) {
          const task = _agentTasks.get(agent.id);
          if (task) {
            task.active = false;
            task.finishedAt = Date.now();
            task.finishedReason = "model";
            task.lastSummary = summaryText;
          }
        }

        // Auto-despawn if ephemeral or configured to despawn after task
        const shouldDespawn =
          agent &&
          (agent._ephemeral === true || agent._autoDespawnAfterTask === true);
        if (shouldDespawn) {
          _agentTasks.delete(agent.id);
          removeAiAgent(agent, "task-complete");
        }

        // Check if any agents still have active tasks
        const anyActive = [..._agentTasks.values()].some((t) => t.active);
        if (!anyActive) {
          agentTask.active = false;
          agentTask.finishedAt = Date.now();
          agentTask.finishedReason = "model";
          agentTask.lastSummary = summaryText;
          disableAgentCameraFollow();
        }
        renderAgentTaskUi();
      },
      onError: (err) => {
        const id = agentRef?.id || "";
        agentUiPush(`${new Date().toLocaleTimeString()}\nERROR\n${String(err?.message || err)}\nagent=${id}`);
      },
      onDecision: (d) => {
        const thought = typeof d?.thought === "string" ? d.thought : "";
        const action = typeof d?.action === "string" ? d.action : "";
        const id = agentRef?.id || "";
        agentUiPush(`${new Date().toLocaleTimeString()}\nDECISION\n${thought}\n${action}\nagent=${id}`);
      },
    },
  });
  agentRef = agent;
  agent._ephemeral = !!ephemeral;
  // Manually spawned editor agents should clean themselves up after task completion.
  agent._autoDespawnAfterTask = true;
  // Only inherit the active task if this agent was spawned as part of a worker pool (ephemeral).
  // Manually spawned agents start idle and wait for their own task assignment.
  agent._taskStartedAt = ephemeral ? Number(agentTask.startedAt || 0) : 0;
  getOrCreateAgentInspectorState(id);
  if (!selectedAgentInspectorId) selectedAgentInspectorId = id;
  renderSelectedAgentControls();
  return agent;
}

async function ensureEditorWorkerPool(targetCount = EDITOR_TASK_WORKER_TARGET) {
  if (appMode !== "edit") return;
  const desired = Math.max(1, Math.min(EDITOR_MAX_AGENT_COUNT, Number(targetCount) || EDITOR_TASK_WORKER_TARGET));
  let tries = 0;
  while (aiAgents.length < desired && tries < desired + 2) {
    const before = aiAgents.length;
    await spawnOrMoveAiAtAim({ createNew: true, silent: true, ephemeral: true });
    tries += 1;
    if (aiAgents.length === before) break;
  }
}

async function spawnOrMoveAiAtAim({ createNew = false, silent = false, ephemeral = false } = {}) {
  await ensureRapierLoaded();
  const hit = rapierRaycastFromCamera(500);
  const placement = hit
    ? { point: hit.point, normal: hit.normal || { x: 0, y: 1, z: 0 } }
    : getPlacementAtCrosshair({ raycastDistance: 500, fallbackDistance: 3, surfaceOffset: 0.0 });
  if (!hit && !silent) {
    setStatus("No collider hit; spawned AI using crosshair fallback placement.");
  }

  let agent = createNew ? null : aiAgents[0] || null;
  if (!agent) {
    if (aiAgents.length >= EDITOR_MAX_AGENT_COUNT) {
      if (!silent) setStatus(`Agent cap reached (${EDITOR_MAX_AGENT_COUNT}).`);
      return;
    }
    agent = createAiAgent({ ephemeral });
    aiAgents.push(agent);
  } else if (ephemeral) {
    agent._ephemeral = true;
  }

  const n = placement.normal
    ? new THREE.Vector3(placement.normal.x, placement.normal.y, placement.normal.z).normalize()
    : new THREE.Vector3(0, 1, 0);
  const offset = Math.max(0.12, (agent.radius ?? PLAYER_RADIUS) + 0.06);
  const p0 = placement.point;
  const candA = { x: p0.x + n.x * offset, y: p0.y + n.y * offset, z: p0.z + n.z * offset };
  const candB = { x: p0.x - n.x * offset, y: p0.y - n.y * offset, z: p0.z - n.z * offset };

  let chosen = null;
  chosen = findNearbyFreeSpotForCollider(agent.collider, candA, 2.0, 0.12);
  if (!chosen) chosen = findNearbyFreeSpotForCollider(agent.collider, candB, 2.0, 0.12);
  if (!chosen) chosen = findNearbyFreeSpotForCollider(agent.collider, { x: p0.x, y: p0.y + offset, z: p0.z }, 2.5, 0.12);
  if (!chosen) {
    if (!silent) setStatus("Couldn't find a free spot to place AI here.");
    return;
  }

  agent.setPosition(chosen.x, chosen.y, chosen.z);
  if (agentTask.active) {
    agent._taskStartedAt = agentTask.startedAt;
  }
  renderAgentTaskUi();
  if (!silent) {
    const label = createNew ? "AI worker spawned." : "AI placed.";
    setStatus(`${label} (${aiAgents.length} total)`);
  }
}

function pickAgentFromRay(raycaster) {
  const agentRoots = aiAgents.map((a) => a?.group).filter(Boolean);
  if (agentRoots.length === 0) return null;

  // First try exact mesh hits.
  const agentHits = raycaster.intersectObjects(agentRoots, true);
  if (agentHits.length > 0) {
    let obj = agentHits[0].object;
    while (obj && !(typeof obj.name === "string" && obj.name.startsWith("AiAvatar:"))) obj = obj.parent;
    const agentId = obj?.name?.slice("AiAvatar:".length) || "";
    const agent = aiAgents.find((a) => a.id === agentId) || null;
    if (agent) return agent;
  }

  // Fallback: broad proximity test against agent centers.
  let best = null;
  let bestT = Infinity;
  const origin = raycaster.ray.origin;
  const dir = raycaster.ray.direction;
  const tmp = new THREE.Vector3();
  const to = new THREE.Vector3();
  const pickRadius = 0.45; // generous click radius for tiny capsules

  for (const a of aiAgents) {
    if (!a?.group || a.group.visible === false) continue;
    const [x, y, z] = a.getPosition?.() || [0, 0, 0];
    // Aim around torso center for better clickability.
    tmp.set(x, y + (a.halfHeight || 0.25), z);
    const d2 = raycaster.ray.distanceSqToPoint(tmp);
    if (d2 > pickRadius * pickRadius) continue;

    // Prefer nearest along-ray candidate in front of camera.
    to.copy(tmp).sub(origin);
    const t = to.dot(dir);
    if (t <= 0) continue;
    if (t < bestT) {
      bestT = t;
      best = a;
    }
  }
  return best;
}

function pickAgentFromScreenPoint(clientX, clientY, canvasRect) {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || !canvasRect || aiAgents.length === 0) return null;
  const thresholdPx = 46;
  let best = null;
  let bestD2 = thresholdPx * thresholdPx;
  const v = new THREE.Vector3();
  for (const a of aiAgents) {
    if (!a?.group || a.group.visible === false) continue;
    const [x, y, z] = a.getPosition?.() || [0, 0, 0];
    v.set(x, y + (a.halfHeight || 0.25), z).project(camera);
    if (v.z < -1 || v.z > 1) continue; // behind camera / clipped
    const sx = canvasRect.left + (v.x * 0.5 + 0.5) * canvasRect.width;
    const sy = canvasRect.top + (-v.y * 0.5 + 0.5) * canvasRect.height;
    const dx = sx - clientX;
    const dy = sy - clientY;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = a;
    }
  }
  return best;
}

function ensureAgentBadgeLayer() {
  if (agentBadgeLayerEl) return;
  installAgentBadgeEventDelegation();
  const el = document.createElement("div");
  el.id = "agent-badge-layer";
  el.className = "agent-badge-layer";
  document.body.appendChild(el);
  agentBadgeLayerEl = el;
}

function getOrCreateAgentBadge(agentId) {
  const id = String(agentId || "");
  if (!id) return null;
  ensureAgentBadgeLayer();
  if (agentBadgeElsById.has(id)) return agentBadgeElsById.get(id);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "agent-badge";
  btn.textContent = id;
  btn.dataset.agentId = id;
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectAgentInspector(id);
    setStatus(`Inspecting ${id}. Use right panel controls.`);
  });
  document.body.appendChild(btn);
  agentBadgeElsById.set(id, btn);
  return btn;
}

function installAgentBadgeEventDelegation() {
  if (typeof document === "undefined") return;
  if (document.body?.dataset?.agentBadgeDelegationInstalled === "1") return;
  if (document.body) document.body.dataset.agentBadgeDelegationInstalled = "1";
  // Capture-phase delegation to beat canvas/overlay handlers.
  document.addEventListener(
    "pointerdown",
    (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const badge = target.closest(".agent-badge");
      if (!badge) return;
      const id = String(badge.dataset.agentId || "").trim();
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      selectAgentInspector(id);
      setStatus(`Inspecting ${id}. Use right panel controls.`);
    },
    true
  );
}

function removeAgentBadge(agentId) {
  const id = String(agentId || "");
  const el = agentBadgeElsById.get(id);
  if (el?.parentElement) el.parentElement.removeChild(el);
  agentBadgeElsById.delete(id);
}

function updateAgentBadges() {
  ensureAgentBadgeLayer();
  const show = appMode === "edit" && aiAgents.length > 0;
  if (!show) {
    for (const [, badge] of agentBadgeElsById) badge.classList.add("hidden");
    return;
  }

  const alive = new Set();
  const rect = canvas.getBoundingClientRect();
  const p = new THREE.Vector3();
  for (const a of aiAgents) {
    if (!a?.group) continue;
    const id = a.id;
    alive.add(id);
    const badge = getOrCreateAgentBadge(id);
    if (!badge) continue;
    const [x, y, z] = a.getPosition?.() || [0, 0, 0];
    p.set(x, y + (a.halfHeight || 0.25) + 0.55, z).project(camera);
    const hidden = p.z < -1 || p.z > 1;
      badge.classList.toggle("hidden", hidden);
    if (!hidden) {
      const sx = rect.left + (p.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-p.y * 0.5 + 0.5) * rect.height;
      badge.style.left = `${Math.round(sx)}px`;
      badge.style.top = `${Math.round(sy)}px`;
      badge.classList.toggle("active", selectedAgentInspectorId === id);
    }
  }

  for (const [id] of agentBadgeElsById) {
    if (!alive.has(id)) removeAgentBadge(id);
  }
}

function pickTagMarkerFromCamera() {
  _raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const hits = _raycaster.intersectObjects(tagsGroup.children, false);
  for (const h of hits) {
    const obj = h.object;
    if (obj?.userData?.isRadius) continue;
    const id = obj?.userData?.tagId;
    if (id) return id;
  }
  return null;
}

function beginTagAtAim() {
  if (appMode !== "edit") setAppMode("edit");
  const hit = rapierRaycastFromCamera();
  if (!hit) {
    setStatus("No collision surface under crosshair (need collision to tag).");
    return;
  }
  const r = Number(tagRadiusEl?.value ?? 1.5);
  draftTag = {
    id: randId(),
    title: "",
    notes: "",
    radius: Number.isFinite(r) ? r : 1.5,
    position: hit.point,
    normal: hit.normal,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  selectedTagId = draftTag.id;
  if (tagTitleEl) tagTitleEl.value = "";
  if (tagNotesEl) tagNotesEl.value = "";
  if (tagRadiusValueEl) tagRadiusValueEl.textContent = (draftTag.radius ?? 1.5).toFixed(2);
  updateMarkerMaterials();
  renderTagsList();
  renderTagPanel();
  setStatus("Tag placed. Fill details and click Save.");
}

function upsertDraftTag() {
  if (!draftTag) return;
  const title = String(tagTitleEl?.value ?? "").trim();
  const notes = String(tagNotesEl?.value ?? "").trim();
  const radius = Number(tagRadiusEl?.value ?? draftTag.radius ?? 1.5);
  draftTag.title = title;
  draftTag.notes = notes;
  draftTag.radius = Number.isFinite(radius) ? radius : 1.5;
  draftTag.updatedAt = Date.now();

  const idx = tags.findIndex((t) => t.id === draftTag.id);
  if (idx === -1) tags.unshift(draftTag);
  else tags[idx] = draftTag;

  saveTagsForWorld();
  draftTag = null;
  rebuildTagMarkers();
  renderTagsList();
  renderTagPanel();
  setStatus("Tag saved.");
}

function cancelDraftTag() {
  if (!draftTag) return;
  const id = draftTag.id;
  draftTag = null;
  // If it wasn't saved, drop selection.
  if (!tags.some((t) => t.id === id)) selectedTagId = null;
  rebuildTagMarkers();
  renderTagsList();
  renderTagPanel();
  setStatus("Tag edit cancelled.");
}

function deleteSelectedTag() {
  const sel = getSelectedTag();
  if (!sel) return;
  tags = tags.filter((t) => t.id !== sel.id);
  selectedTagId = null;
  draftTag = null;
  saveTagsForWorld();
  rebuildTagMarkers();
  renderTagsList();
  renderTagPanel();
  setStatus("Tag deleted.");
}

// Pointer lock: In edit mode, only lock on right-click so left-click is free for selection.
// In sim mode, any click locks the pointer for FPS navigation.
canvas.addEventListener("click", async (e) => {
  if (appMode === "edit") {
    // Edit mode: left-click is for selection (handled by mousedown below), don't lock
    return;
  }
  // Sim mode: lock on click for FPS
  if (!controls.isLocked) {
    controls.enabled = true;
    try { controls.lock(); } catch {}
  } else if (e.button === 0) {
    await handlePlayerInteraction();
  }
});

// Right-click to lock pointer in edit mode (for FPS navigation)
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (appMode === "edit" && !controls.isLocked) {
    controls.enabled = true;
    try { controls.lock(); } catch {}
  }
});

controls.addEventListener("lock", () => {
  controls.enabled = true;
});
controls.addEventListener("unlock", () => {
  if (appMode === "sim") setStatus("Click to look around.");
});

resetBtn?.addEventListener("click", () => {
  // Reset to origin-ish; if splat loaded we’ll re-frame it.
  controls.object.position.set(0, 1.7, 4);
  if (splatMesh) frameToSplat(splatMesh);
});

// Clear Level — remove all objects from the scene
document.getElementById("clear-level-btn")?.addEventListener("click", () => {
  if (!confirm("Clear ALL objects from the level? This cannot be undone.")) return;
  detachGroupTransform();
  for (const p of primitives) removePrimitiveCollider(p);
  for (const a of assets) {
    if (a._colliderHandle != null) {
      try { if (typeof a._colliderHandle === "object") rapierWorld?.removeCollider(a._colliderHandle, true); } catch {}
    }
  }
  while (assetsGroup.children.length) assetsGroup.remove(assetsGroup.children[0]);
  while (primitivesGroup.children.length) { const c = primitivesGroup.children[0]; c.geometry?.dispose(); disposePrimitiveMaterial(c.material); primitivesGroup.remove(c); }
  while (lightsGroup.children.length) { const c = lightsGroup.children[0]; c.traverse?.((m) => { m.geometry?.dispose(); m.material?.dispose(); }); lightsGroup.remove(c); }
  while (tagsGroup.children.length) tagsGroup.remove(tagsGroup.children[0]);
  _assetColliderHandles.clear();
  _assetBumpVelocities.clear();
  assets = []; primitives = []; editorLights = []; tags = []; groups = [];
  selectedAssetId = null; selectedPrimitiveId = null; selectedLightId = null;
  selectedSceneLightId = null; selectedTagId = null; draftTag = null; selectedGroupId = null;
  transformControls?.detach(); transformControls.visible = false; transformControls.enabled = false;
  saveTagsForWorld();
  renderTagsList(); renderAssetsList(); renderPrimitivesList(); renderLightsList();
  renderTagPanel(); renderPrimitiveProps(); renderLightProps(); renderSceneLightsList();
  updateDetailsPanel(); updateOutlinerCounts();
  setStatus("Level cleared.");
});

function setGhostMode(enabled) {
  ghostMode = !!enabled;
  // Ghost mode indicator shown in status
  if (enabled) setStatus("Ghost mode ON");
  
  // Disable collisions by turning the player collider into a sensor.
  // (Sensors don't generate contact forces, so you can pass through walls.)
  try {
    if (playerCollider && typeof playerCollider.setSensor === "function") {
      playerCollider.setSensor(ghostMode);
    }
  } catch {
    // ignore
  }
}

// Ghost mode toggled via 'G' key only

// Tagging UI
setAppMode(appMode);
updateEditorSimLightPreviewUi();
// In sim mode, start with an empty scene so the user loads what they want.
// In edit mode (or combined index.html), restore the previous session from localStorage.
if (appMode !== "sim") {
  loadTagsForWorld();
}
if (tagRadiusValueEl && tagRadiusEl) tagRadiusValueEl.textContent = Number(tagRadiusEl.value).toFixed(2);
// Mode toggle buttons in each panel
modeEditBtn?.addEventListener("click", () => setAppMode("sim"));
modeSimBtn?.addEventListener("click", () => setAppMode("edit"));
workspaceTabSceneBtn?.addEventListener("click", async () => { await switchWorkspace("scene"); });
workspaceTabAssetBuilderBtn?.addEventListener("click", async () => { await switchWorkspace("assetBuilder"); });
simPanelCollapseBtn?.addEventListener("click", () => {
  simPanelCollapsed = true;
  applySimPanelCollapsedState();
});
simPanelOpenBtn?.addEventListener("click", () => {
  simPanelCollapsed = false;
  applySimPanelCollapsedState();
});
simCameraModeToggleBtn?.addEventListener("click", () => {
  simUserCameraMode = simUserCameraMode === "user" ? "agent" : "user";
  localStorage.setItem("sparkWorldSimCameraMode", simUserCameraMode);
  updateSimCameraModeToggleUi();
  if (simUserCameraMode === "user") {
    if (agentCameraFollow) disableAgentCameraFollow();
  } else if (appMode === "sim" && agentTask.active) {
    enableAgentCameraFollow();
  }
});
editorSimLightPreviewBtn?.addEventListener("click", () => {
  editorSimLightingPreview = !editorSimLightingPreview;
  localStorage.setItem("sparkWorldEditorSimPreview", editorSimLightingPreview ? "1" : "0");
  updateEditorSimLightPreviewUi();
  applyEditorGuideVisibility();
  setStatus(editorSimLightingPreview ? "Sim lighting preview ON" : "Sim lighting preview OFF");
});
// Left editor panel collapse/expand
leftPanelCollapseBtn?.addEventListener("click", () => {
  overlayEl.classList.add("left-collapsed");
  leftPanelOpenBtn?.classList.remove("hidden");
});
leftPanelOpenBtn?.addEventListener("click", () => {
  overlayEl.classList.remove("left-collapsed");
  leftPanelOpenBtn?.classList.add("hidden");
});
simViewRgbdBtn?.addEventListener("click", () => {
  simCompareView = false;
  setSimSensorViewMode("rgbd");
});
simRgbdGrayBtn?.addEventListener("click", () => {
  rgbdVizMode = "gray";
  updateSimSensorButtons();
  if (simSensorViewMode === "rgbd") setStatus("RGB-D: metric grayscale");
});
simRgbdColormapBtn?.addEventListener("click", () => {
  rgbdVizMode = "colormap";
  updateSimSensorButtons();
  if (simSensorViewMode === "rgbd") setStatus("RGB-D: metric colormap");
});
simRgbdAutoRangeBtn?.addEventListener("click", () => {
  rgbdAutoRange = !rgbdAutoRange;
  updateSimSensorButtons();
  if (simSensorViewMode === "rgbd") setStatus(rgbdAutoRange ? "RGB-D auto-range ON (p5/p95)" : "RGB-D auto-range OFF");
});
simRgbdNoiseBtn?.addEventListener("click", () => {
  rgbdNoiseEnabled = !rgbdNoiseEnabled;
  updateSimSensorButtons();
  setStatus(rgbdNoiseEnabled ? "RGB-D noise ON" : "RGB-D noise OFF");
});
simRgbdSpeckleBtn?.addEventListener("click", () => {
  rgbdSpeckleEnabled = !rgbdSpeckleEnabled;
  updateSimSensorButtons();
  setStatus(rgbdSpeckleEnabled ? "RGB-D speckle ON" : "RGB-D speckle OFF");
});
simRgbdMinEl?.addEventListener("input", () => {
  if (rgbdAutoRange) return;
  const minV = Number(simRgbdMinEl.value);
  const maxV = Number(simRgbdMaxEl?.value ?? rgbdRangeMaxM);
  setRgbdRange(minV, maxV);
});
simRgbdMaxEl?.addEventListener("input", () => {
  if (rgbdAutoRange) return;
  const minV = Number(simRgbdMinEl?.value ?? rgbdRangeMinM);
  const maxV = Number(simRgbdMaxEl.value);
  setRgbdRange(minV, maxV);
});
simRgbdPcOverlayBtn?.addEventListener("click", () => {
  rgbdPcOverlayOnLidar = !rgbdPcOverlayOnLidar;
  _rgbdPcOverlayLastUpdateMs = 0;
  _rgbdPcOverlayLastPose = null;
  _rgbdPcOverlayDirty = rgbdPcOverlayOnLidar;
  if (!rgbdPcOverlayOnLidar) {
    _rgbdPcGeom.setDrawRange(0, 0);
    _rgbdPcOverlayLastCount = 0;
    _rgbdPcOverlayDirty = false;
  }
  if (rgbdPcOverlayOnLidar) {
    // Overlay button should directly enter combined LiDAR+RGBD-PC debug mode.
    simCompareView = false;
    lidarOrderedDebugView = false;
    if (simSensorViewMode !== "lidar") simSensorViewMode = "lidar";
    applySimSensorViewMode();
  }
  // Actual visibility is finalized by updateRgbdPcOverlayCloud once points are generated.
  rgbdPcOverlayGroup.visible = false;
  updateSimSensorButtons();
  setStatus(rgbdPcOverlayOnLidar ? `RGB-D->PointCloud overlay ON (${_rgbdPcOverlayLastCount} pts)` : "RGB-D->PointCloud overlay OFF");
});
simViewLidarBtn?.addEventListener("click", () => {
  // Main LiDAR button always maps to accumulated unordered 3D point cloud.
  simCompareView = false;
  lidarOrderedDebugView = false;
  if (simSensorViewMode !== "lidar") {
    _lidarAccumFrames.length = 0;
    _lidarLastAccumPose = null;
    resetLidarScanState();
  }
  setSimSensorViewMode("lidar");
  if (rgbdPcOverlayOnLidar) _rgbdPcOverlayDirty = true;
});
simViewCompareBtn?.addEventListener("click", () => {
  simCompareView = !simCompareView;
  if (simCompareView) {
    // Auto-collapse panel so tiles get full canvas width.
    simPanelCollapsed = true;
    applySimPanelCollapsedState();
    simSensorViewMode = "lidar";
    lidarOrderedDebugView = false;
    if (rgbdPcOverlayOnLidar) _rgbdPcOverlayDirty = true;
    setStatus("Compare view: RGB | RGB-D | LiDAR");
  } else {
    simPanelCollapsed = false;
    applySimPanelCollapsedState();
    setStatus("Compare view OFF");
  }
  applySimSensorViewMode();
});
simLidarColorRangeBtn?.addEventListener("click", () => {
  lidarColorByRange = !lidarColorByRange;
  updateSimSensorButtons();
  if (simSensorViewMode === "lidar") {
    updateLidarPointCloud();
    setStatus(lidarColorByRange ? "LiDAR: range-color mode" : "LiDAR: intensity mode");
  }
});
simLidarOrderedDebugBtn?.addEventListener("click", () => {
  // Single Sweep is the explicit ring/scan debug view.
  lidarOrderedDebugView = true;
  _lidarAccumFrames.length = 0;
  _lidarLastAccumPose = null;
  resetLidarScanState();
  if (simSensorViewMode !== "lidar") simSensorViewMode = "lidar";
  updateSimSensorButtons();
  applySimSensorViewMode();
  setStatus("LiDAR: single sweep view");
});
simLidarNoiseBtn?.addEventListener("click", () => {
  lidarNoiseEnabled = !lidarNoiseEnabled;
  _lidarAccumFrames.length = 0;
  _lidarLastAccumPose = null;
  resetLidarScanState();
  updateSimSensorButtons();
  if (simSensorViewMode === "lidar") updateLidarPointCloud();
  setStatus(lidarNoiseEnabled ? "LiDAR noise ON" : "LiDAR noise OFF");
});
simLidarMultiReturnBtn?.addEventListener("click", () => {
  lidarMultiReturnMode = lidarMultiReturnMode === "strongest" ? "last" : "strongest";
  _lidarAccumFrames.length = 0;
  _lidarLastAccumPose = null;
  resetLidarScanState();
  updateSimSensorButtons();
  if (simSensorViewMode === "lidar") updateLidarPointCloud();
  setStatus(`LiDAR return mode: ${lidarMultiReturnMode}`);
});
tagPlaceBtn?.addEventListener("click", () => beginTagAtAim());
spawnAiBtn?.addEventListener("click", async () => {
  await spawnOrMoveAiAtAim({ createNew: appMode === "edit", ephemeral: false });
  if (appMode === "edit" && aiAgents.length > 0) {
    selectAgentInspector(aiAgents[aiAgents.length - 1].id);
    setStatus("Agent spawned. Use Selected Agent task box on the right.");
  }
});
assetGlbInputEl?.addEventListener("change", async (e) => {
  if (appMode !== "edit") return;
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    pendingAssetUpload = {
      states: [
        {
          id: "s1",
          name: file.name.replace(/\.glb$/i, "") || "state 1",
          glbName: file.name,
          dataBase64: base64FromArrayBuffer(buf),
        },
      ],
      currentStateId: "s1",
      actions: [],
    };
    if (assetTitleEl) assetTitleEl.value = file.name.replace(/\.glb$/i, "");
    if (assetNotesEl) assetNotesEl.value = "";
    if (assetPickableEl) assetPickableEl.checked = false;
    renderAssetModal();
    showModal(true);
  } catch (err) {
    console.error(err);
    setStatus(err?.message || "Failed to read GLB.");
  } finally {
    e.target.value = "";
  }
});

assetCancelBtn?.addEventListener("click", () => {
  pendingAssetUpload = null;
  showModal(false);
});

// =============================================================================
// PORTAL CREATION
// =============================================================================

function showPortalModal(show = true) {
  if (!portalModal) return;
  portalModal.classList.toggle("hidden", !show);
  portalModal.setAttribute("aria-hidden", String(!show));
  
  if (show) {
    // Populate destination options (exclude current world)
    if (portalDestinationEl) {
      portalDestinationEl.innerHTML = '<option value="">— Select destination —</option>';
      for (const w of WORLDS_MANIFEST) {
        if (w.id !== worldKey) { // Don't show current world as destination
          const opt = document.createElement("option");
          opt.value = w.id;
          opt.textContent = w.name;
          portalDestinationEl.appendChild(opt);
        }
      }
    }
    if (portalTitleEl) portalTitleEl.value = "";
  }
}

function createPortalGeometry() {
  // Create a doorway frame shape
  const frameGroup = new THREE.Group();
  
  // Portal frame material (glowing purple)
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x6366f1,
    emissive: 0x6366f1,
    emissiveIntensity: 0.5,
    metalness: 0.8,
    roughness: 0.2,
  });
  
  // Portal surface material (semi-transparent, shimmering)
  const portalMaterial = new THREE.MeshStandardMaterial({
    color: 0x818cf8,
    emissive: 0x4f46e5,
    emissiveIntensity: 0.8,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
  });
  
  // Frame dimensions
  const width = 1.2;
  const height = 2.2;
  const depth = 0.1;
  const frameThickness = 0.12;
  
  // Left pillar
  const leftPillar = new THREE.Mesh(
    new THREE.BoxGeometry(frameThickness, height, depth),
    frameMaterial
  );
  leftPillar.position.set(-width / 2 + frameThickness / 2, height / 2, 0);
  frameGroup.add(leftPillar);
  
  // Right pillar
  const rightPillar = new THREE.Mesh(
    new THREE.BoxGeometry(frameThickness, height, depth),
    frameMaterial
  );
  rightPillar.position.set(width / 2 - frameThickness / 2, height / 2, 0);
  frameGroup.add(rightPillar);
  
  // Top beam
  const topBeam = new THREE.Mesh(
    new THREE.BoxGeometry(width, frameThickness, depth),
    frameMaterial
  );
  topBeam.position.set(0, height - frameThickness / 2, 0);
  frameGroup.add(topBeam);
  
  // Portal surface (the "magical" part)
  const portalSurface = new THREE.Mesh(
    new THREE.PlaneGeometry(width - frameThickness * 2, height - frameThickness),
    portalMaterial
  );
  portalSurface.position.set(0, (height - frameThickness) / 2 + frameThickness / 2, 0);
  frameGroup.add(portalSurface);
  
  return frameGroup;
}

async function createPortal(title, destinationWorldId, linkedData = null) {
  const id = randId();
  const destWorld = WORLDS_MANIFEST.find(w => w.id === destinationWorldId);
  if (!destWorld) {
    setStatus("Invalid destination world");
    return null;
  }
  
  console.log(`[PORTAL] Creating portal: "${title}" → ${destWorld.name} (linkedData:`, linkedData, `)`);
  
  // Get placement position from crosshair raycast
  const hit = rapierRaycastFromCamera(500);
  const p = hit?.point || { x: controls.object.position.x, y: 0, z: controls.object.position.z - 2 };
  console.log(`[PORTAL] Placement position:`, p);
  
  // Create portal asset data
  const portalAsset = {
    id,
    title: title || `Portal to ${destWorld.name}`,
    notes: `Leads to: ${destWorld.name}`,
    isPortal: true,
    destinationWorld: destinationWorldId,
    linkedPortalId: linkedData?.linkedPortalId || null,
    linkedPortalPosition: linkedData?.linkedPortalPosition || null,
    states: [{
      id: "active",
      name: "Active",
      glbName: "",
      dataBase64: "", // We'll use procedural geometry
      interactions: [{
        id: "enter",
        label: `Enter (go to ${destWorld.name})`,
        to: "active", // Portal doesn't change state, just triggers world load
      }],
    }],
    currentStateId: "active",
    actions: [{
      id: "enter_portal",
      label: `Enter (go to ${destWorld.name})`,
      from: "active",
      to: "active",
    }],
    transform: {
      position: { x: p.x, y: p.y, z: p.z },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    pickable: false,
  };
  
  assets.push(portalAsset);
  await instantiatePortalAsset(portalAsset);
  saveTagsForWorld();
  renderAssetsList();
  selectAsset(id);
  
  setStatus(`Portal to "${destWorld.name}" created!`);
  return portalAsset;
}

async function instantiatePortalAsset(portal) {
  if (!portal?.isPortal) return;
  
  const portalGroup = createPortalGeometry();
  portalGroup.name = `asset:${portal.id}`;
  
  // IMPORTANT: Set userData.assetId on all meshes for raycasting
  portalGroup.traverse((child) => {
    if (child.isMesh) {
      child.userData.assetId = portal.id;
    }
  });
  
  // Apply transform
  const t = portal.transform || {};
  if (t.position) portalGroup.position.set(t.position.x || 0, t.position.y || 0, t.position.z || 0);
  if (t.rotation) portalGroup.rotation.set(t.rotation.x || 0, t.rotation.y || 0, t.rotation.z || 0);
  if (t.scale) portalGroup.scale.set(t.scale.x || 1, t.scale.y || 1, t.scale.z || 1);
  
  assetsGroup.add(portalGroup);
  
  // Build a simple box collider for the portal (since it's procedural geometry)
  await buildPortalCollider(portal);
}

async function buildPortalCollider(portal) {
  // Portals don't need physics colliders - they only need the mesh for raycasting
  // The Three.js mesh is sufficient for player interaction detection
  // Skip creating any Rapier collider to avoid blocking movement
  
  // Just ensure any old collider is removed
  if (portal._colliderHandle != null) {
    try {
      await ensureRapierLoaded();
      if (rapierWorld) {
        const collider = rapierWorld.getCollider(portal._colliderHandle);
        if (collider) rapierWorld.removeCollider(collider, true);
      }
    } catch {}
    portal._colliderHandle = null;
  }
}

// Portal button click handler
portalCreateBtn?.addEventListener("click", () => {
  if (appMode !== "edit") return;
  showPortalModal(true);
});

portalCancelBtn?.addEventListener("click", () => {
  showPortalModal(false);
  pendingPortalLink = null;
});

portalCreateConfirmBtn?.addEventListener("click", async () => {
  const destination = portalDestinationEl?.value;
  const title = portalTitleEl?.value?.trim() || "";
  
  if (!destination) {
    setStatus("Please select a destination world");
    return;
  }
  
  showPortalModal(false);
  
  // Step 1: Create the entrance portal in current world
  const entrancePortal = await createPortal(title, destination);
  if (!entrancePortal) return;
  
  // Store the pending link info
  pendingPortalLink = {
    entranceId: entrancePortal.id,
    entranceWorldId: worldKey,
    destinationWorldId: destination,
    title: title,
    entrancePosition: { ...entrancePortal.transform.position },
  };
  
  // Load destination world to place exit
  const destWorld = WORLDS_MANIFEST.find(w => w.id === destination);
  const destName = destWorld?.name || destination;
  
  // Show loading screen
  showPortalLoading(destName, "Setting up portal connection...");
  setStatus(`Loading ${destName} to place exit portal...`);
  
  await new Promise(resolve => setTimeout(resolve, 800));
  await loadWorld(destination);
  
  // Hide loading and show exit placement modal
  await new Promise(resolve => setTimeout(resolve, 300));
  hidePortalLoading();
  showPortalExitModal(true, destName);
});

function showPortalExitModal(show = true, worldName = "") {
  if (!portalExitModal) return;
  portalExitModal.classList.toggle("hidden", !show);
  portalExitModal.setAttribute("aria-hidden", String(!show));
  
  if (show && portalExitWorldNameEl) {
    portalExitWorldNameEl.textContent = worldName;
  }
}

portalExitPlaceBtn?.addEventListener("click", async () => {
  if (!pendingPortalLink) {
    showPortalExitModal(false);
    return;
  }
  
  showPortalExitModal(false);
  await placeExitPortal();
});

portalExitSkipBtn?.addEventListener("click", async () => {
  showPortalExitModal(false);
  
  if (pendingPortalLink) {
    setStatus("Portal created without exit. You can add one later.");
  }
  pendingPortalLink = null;
});

async function placeExitPortal() {
  if (!pendingPortalLink) return;
  
  const { entranceId, entranceWorldId, destinationWorldId, title, entrancePosition } = pendingPortalLink;
  
  // Get placement position from crosshair
  const hit = rapierRaycastFromCamera(500);
  const exitPos = hit?.point || { 
    x: controls.object.position.x, 
    y: 0, 
    z: controls.object.position.z - 2 
  };
  
  // Create the exit portal in the destination world (current world now)
  // Pass linked data so it knows about the entrance portal
  const sourceWorld = WORLDS_MANIFEST.find(w => w.id === entranceWorldId);
  const exitPortal = await createPortal(
    `Portal to ${sourceWorld?.name || entranceWorldId}`,
    entranceWorldId,
    {
      linkedPortalId: entranceId,
      linkedPortalPosition: entrancePosition
    }
  );
  
  if (exitPortal) {
    // Now we need to update the entrance portal with the exit info
    // Store this to update when we return to the entrance world
    const exitInfo = {
      exitId: exitPortal.id,
      exitPosition: { ...exitPortal.transform.position },
    };
    
    // Save to localStorage temporarily (will be applied when loading entrance world)
    const linkKey = `portal_link_${entranceId}`;
    localStorage.setItem(linkKey, JSON.stringify(exitInfo));
    
    console.log(`[PORTAL] Exit portal created: ${exitPortal.id}, linked to entrance: ${entranceId}`);
    setStatus(`Exit portal created! You can now travel between worlds.`);
  }
  
  pendingPortalLink = null;
}

// Handle 'P' key to place exit portal during setup
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "p" && pendingPortalLink && !portalExitModal?.classList.contains("hidden")) {
    e.preventDefault();
    placeExitPortal();
    showPortalExitModal(false);
  }
});

// Restore portal links from localStorage when world loads
function restorePortalLinks() {
  console.log(`[PORTAL] Checking for portal links to restore. Assets:`, assets.filter(a => a.isPortal).map(a => ({ id: a.id, title: a.title })));
  
  for (const asset of assets) {
    if (!asset.isPortal) continue;
    
    const linkKey = `portal_link_${asset.id}`;
    const linkData = localStorage.getItem(linkKey);
    
    console.log(`[PORTAL] Checking link for portal ${asset.id}: linkKey=${linkKey}, hasData=${!!linkData}`);
    
    if (linkData) {
      try {
        const { exitId, exitPosition } = JSON.parse(linkData);
        asset.linkedPortalId = exitId;
        asset.linkedPortalPosition = exitPosition;
        console.log(`[PORTAL] ✓ Restored link for ${asset.id} → exit portal ${exitId} at`, exitPosition);
        
        // Clear the localStorage entry (one-time restore)
        localStorage.removeItem(linkKey);
        saveTagsForWorld();
      } catch (e) {
        console.warn("Failed to restore portal link:", e);
      }
    }
  }
}

assetAddStateBtn?.addEventListener("click", () => {
  if (!pendingAssetUpload) return;
  const n = (pendingAssetUpload.states?.length || 0) + 1;
  const id = `s${Date.now().toString(16)}${Math.random().toString(16).slice(2, 6)}`;
  pendingAssetUpload.states.push({ id, name: `state ${n}`, glbName: "", dataBase64: "", interactions: [] });
  renderAssetModal();
});

assetStatesContainerEl?.addEventListener("change", async (e) => {
  if (!pendingAssetUpload) return;
  const row = e.target?.closest?.(".asset-state-row");
  const sid = row?.getAttribute?.("data-state-id");
  if (!sid) return;
  const st = pendingAssetUpload.states.find((x) => x.id === sid);
  if (!st) return;

  if (e.target?.name === "asset-initial-state") {
    pendingAssetUpload.currentStateId = sid;
    renderAssetModal();
    return;
  }

  if (e.target?.getAttribute?.("data-field") === "file") {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    st.glbName = file.name;
    st.dataBase64 = base64FromArrayBuffer(buf);
    renderAssetModal();
    return;
  }
});

assetStatesContainerEl?.addEventListener("input", (e) => {
  if (!pendingAssetUpload) return;
  const row = e.target?.closest?.(".asset-state-row");
  const sid = row?.getAttribute?.("data-state-id");
  if (!sid) return;
  const st = pendingAssetUpload.states.find((x) => x.id === sid);
  if (!st) return;
  if (e.target?.getAttribute?.("data-field") === "name") {
    st.name = e.target.value;
    renderAssetModal();
  }
});

assetStatesContainerEl?.addEventListener("click", (e) => {
  if (!pendingAssetUpload) return;
  const btn = e.target?.closest?.("button");
  if (!btn) return;
  const row = e.target?.closest?.(".asset-state-row");
  const sid = row?.getAttribute?.("data-state-id");
  if (!sid) return;
  const action = btn.getAttribute("data-action");
  if (action === "remove") {
    pendingAssetUpload.states = pendingAssetUpload.states.filter((x) => x.id !== sid);
    if (pendingAssetUpload.currentStateId === sid) pendingAssetUpload.currentStateId = pendingAssetUpload.states[0]?.id || null;
    // Remove interactions referencing this state
    for (const s of pendingAssetUpload.states) {
      s.interactions = (s.interactions || []).filter((it) => it.to !== sid);
    }
    renderAssetModal();
    return;
  }

  const st = pendingAssetUpload.states.find((x) => x.id === sid);
  if (!st) return;

  if (action === "add-interaction") {
    const iid = `it_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 6)}`;
    st.interactions = st.interactions || [];
    const fallbackTo = pendingAssetUpload.states.find((x) => x.id !== sid)?.id || sid;
    st.interactions.push({ id: iid, label: "toggle", to: fallbackTo });
    renderAssetModal();
    return;
  }

  if (action === "remove-interaction") {
    const irow = e.target?.closest?.(".asset-interaction-row");
    const iid = irow?.getAttribute?.("data-interaction-id");
    if (!iid) return;
    st.interactions = (st.interactions || []).filter((it) => it.id !== iid);
    renderAssetModal();
    return;
  }
});

assetStatesContainerEl?.addEventListener("input", (e) => {
  if (!pendingAssetUpload) return;
  const row = e.target?.closest?.(".asset-state-row");
  const sid = row?.getAttribute?.("data-state-id");
  if (!sid) return;
  const st = pendingAssetUpload.states.find((x) => x.id === sid);
  if (!st) return;

  const irow = e.target?.closest?.(".asset-interaction-row");
  const iid = irow?.getAttribute?.("data-interaction-id");
  if (iid && e.target?.getAttribute?.("data-field") === "ilabel") {
    const it = (st.interactions || []).find((x) => x.id === iid);
    if (it) it.label = e.target.value;
    return;
  }
});

assetStatesContainerEl?.addEventListener("change", (e) => {
  if (!pendingAssetUpload) return;
  const row = e.target?.closest?.(".asset-state-row");
  const sid = row?.getAttribute?.("data-state-id");
  if (!sid) return;
  const st = pendingAssetUpload.states.find((x) => x.id === sid);
  if (!st) return;

  const irow = e.target?.closest?.(".asset-interaction-row");
  const iid = irow?.getAttribute?.("data-interaction-id");
  if (iid && e.target?.getAttribute?.("data-field") === "ito") {
    const it = (st.interactions || []).find((x) => x.id === iid);
    if (it) it.to = e.target.value;
    return;
  }
});

assetCreateBtn?.addEventListener("click", async () => {
  if (!pendingAssetUpload) return;
  const id = randId();
  const title = String(assetTitleEl?.value ?? "").trim();
  const notes = String(assetNotesEl?.value ?? "").trim();
  const placement = getPlacementAtCrosshair({ raycastDistance: 500, surfaceOffset: 0.02 });
  const pos = placement.position;

  // Validate states
  const states = (pendingAssetUpload.states || []).filter(Boolean);
  if (!states.length) {
    setStatus("Asset needs at least one state.");
    return;
  }
  for (const s of states) {
    if (!s.dataBase64) {
      setStatus("Please pick a .glb file for every state.");
      return;
    }
    if (!s.name) s.name = s.glbName || s.id;
  }
  // Flatten interactions into actions.
  let actions = [];
  for (const s of states) {
    const ints = Array.isArray(s.interactions) ? s.interactions : [];
    for (const it of ints) {
      if (!it.to || it.to === s.id) continue;
      actions.push({ id: it.id || `act_${s.id}_${it.to}`, label: it.label || "toggle", from: s.id, to: it.to });
    }
  }
  // If multiple states but no interactions, create a simple cycle.
  if (states.length > 1 && actions.length === 0) {
    for (let i = 0; i < states.length; i++) {
      const from = states[i].id;
      const to = states[(i + 1) % states.length].id;
      actions.push({ id: `cycle_${from}_to_${to}`, label: "next state", from, to });
      states[i].interactions = states[i].interactions || [];
      states[i].interactions.push({ id: `cycle_${from}_to_${to}`, label: "next state", to });
    }
  }

  const pickable = assetPickableEl?.checked ?? false;
  const a = {
    id,
    title,
    notes,
    states,
    currentStateId: pendingAssetUpload.currentStateId || states[0].id,
    actions,
    pickable,
    transform: {
      position: pos,
      rotation: { x: 0, y: camera.rotation.y, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
  assets.unshift(a);
  pendingAssetUpload = null;
  saveTagsForWorld();
  showModal(false);
  await instantiateAsset(a);
  renderAssetsList();
  selectAsset(a.id);
  const s0 = Array.isArray(a.states) ? a.states.find((s) => s.id === a.currentStateId) || a.states[0] : null;
  const nameShown = s0?.glbName || "";
  setStatus(`Asset added: ${nameShown}`);
});

assetDeleteSelectedBtn?.addEventListener("click", () => {
  if (appMode !== "edit") return;
  deleteSelectedAsset();
});
assetEditStatesSelectedBtn?.addEventListener("click", async () => {
  if (appMode !== "edit") return;
  await editSelectedAssetStatesInBuilder();
});

function refreshTransformToolbar() {
  const hasSel = !!getSelectedAsset() || !!getSelectedPrimitive() || !!getSelectedLight() || !!selectedGroupId;
  const mode = transformControls?.getMode?.() || "translate";
  assetToolMoveBtn?.classList.toggle("active", hasSel && mode === "translate");
  assetToolRotateBtn?.classList.toggle("active", hasSel && mode === "rotate");
  assetToolScaleBtn?.classList.toggle("active", hasSel && mode === "scale");
  if (assetToolMoveBtn) assetToolMoveBtn.disabled = !hasSel;
  if (assetToolRotateBtn) assetToolRotateBtn.disabled = !hasSel;
  if (assetToolScaleBtn) assetToolScaleBtn.disabled = !hasSel;
}

function setTransformMode(mode) {
  if (appMode !== "edit") return;
  // Work with any selected object: asset, primitive, light, or group
  const hasSel = !!getSelectedAsset() || !!getSelectedPrimitive() || !!getSelectedLight() || !!selectedGroupId;
  if (!hasSel) return;
  const m = mode === "rotate" || mode === "scale" ? mode : "translate";
  transformControls?.setMode?.(m);
  refreshTransformToolbar();
}

assetToolMoveBtn?.addEventListener("click", () => setTransformMode("translate"));
assetToolRotateBtn?.addEventListener("click", () => setTransformMode("rotate"));
assetToolScaleBtn?.addEventListener("click", () => setTransformMode("scale"));

assetInteractSelectedBtn?.addEventListener("click", async () => {
  if (appMode !== "edit") return;
  await interactSelectedAssetDebug();
});

assetDuplicateSelectedBtn?.addEventListener("click", async () => {
  if (appMode !== "edit") return;
  await duplicateSelectedAsset();
});

// Asset shadow toggles — changing these rebuilds the asset visual
assetCastShadowEl?.addEventListener("change", async () => {
  const a = getSelectedAsset();
  if (!a) return;
  a.castShadow = assetCastShadowEl.checked;
  if (!a.blobShadow) a.blobShadow = { opacity: 0.5, scale: 1.0, offsetX: 0, offsetY: 0, offsetZ: 0 };
  saveTagsForWorld();
  // Show/hide blob shadow sub-controls
  if (blobShadowControlsEl) blobShadowControlsEl.classList.toggle("hidden", !a.castShadow);
  // Detach transform gizmo BEFORE removing the old object from the scene
  transformControls.detach();
  // Rebuild the asset to add/remove blob shadow
  const existing = assetsGroup.getObjectByName(`asset:${a.id}`);
  if (existing?.parent) existing.parent.remove(existing);
  await instantiateAsset(a);
  // Reattach transform gizmo to the new object
  selectAsset(a.id);
});

// --- Blob shadow live-adjustment helpers ---
// Updates the blob shadow mesh in-place without rebuilding the entire asset.
function updateBlobShadowLive(assetId) {
  const a = assets.find((x) => x.id === assetId);
  if (!a?.castShadow) return;
  const root = assetsGroup.getObjectByName(`asset:${assetId}`);
  if (!root) return;
  const blob = root.getObjectByName(`blobShadow:${assetId}`);
  if (!blob) return;
  const bs = a.blobShadow || {};
  // Opacity
  if (blob.material) blob.material.opacity = bs.opacity ?? 0.5;
  // Scale + stretch
  const baseDiam = blob.userData._baseDiameter || 1;
  const userScale = bs.scale ?? 1.0;
  const stretch = bs.stretch ?? 1.0;
  const d = baseDiam * userScale;
  blob.scale.set(d * stretch, 1, d / stretch);
  // Rotation (Y axis, degrees → radians)
  blob.rotation.y = ((bs.rotationDeg ?? 0) * Math.PI) / 180;
  // Offset
  blob.position.x = bs.offsetX ?? 0;
  const baseY = blob.userData._baseLocalY ?? blob.position.y;
  blob.position.y = baseY + (bs.offsetY ?? 0);
  blob.position.z = bs.offsetZ ?? 0;
}

// Blob shadow slider / input listeners
blobShadowOpacityEl?.addEventListener("input", () => {
  const a = getSelectedAsset();
  if (!a) return;
  if (!a.blobShadow) a.blobShadow = {};
  a.blobShadow.opacity = parseFloat(blobShadowOpacityEl.value);
  if (blobShadowOpacityValEl) blobShadowOpacityValEl.textContent = a.blobShadow.opacity.toFixed(2);
  updateBlobShadowLive(a.id);
});
blobShadowOpacityEl?.addEventListener("change", () => saveTagsForWorld());

blobShadowScaleEl?.addEventListener("input", () => {
  const a = getSelectedAsset();
  if (!a) return;
  if (!a.blobShadow) a.blobShadow = {};
  a.blobShadow.scale = parseFloat(blobShadowScaleEl.value);
  if (blobShadowScaleValEl) blobShadowScaleValEl.textContent = a.blobShadow.scale.toFixed(2);
  updateBlobShadowLive(a.id);
});
blobShadowScaleEl?.addEventListener("change", () => saveTagsForWorld());

blobShadowStretchEl?.addEventListener("input", () => {
  const a = getSelectedAsset();
  if (!a) return;
  if (!a.blobShadow) a.blobShadow = {};
  a.blobShadow.stretch = parseFloat(blobShadowStretchEl.value);
  if (blobShadowStretchValEl) blobShadowStretchValEl.textContent = a.blobShadow.stretch.toFixed(2);
  updateBlobShadowLive(a.id);
});
blobShadowStretchEl?.addEventListener("change", () => saveTagsForWorld());

blobShadowRotEl?.addEventListener("input", () => {
  const a = getSelectedAsset();
  if (!a) return;
  if (!a.blobShadow) a.blobShadow = {};
  a.blobShadow.rotationDeg = parseFloat(blobShadowRotEl.value);
  if (blobShadowRotValEl) blobShadowRotValEl.textContent = `${Math.round(a.blobShadow.rotationDeg)}°`;
  updateBlobShadowLive(a.id);
});
blobShadowRotEl?.addEventListener("change", () => saveTagsForWorld());

blobShadowOxEl?.addEventListener("input", () => {
  const a = getSelectedAsset();
  if (!a) return;
  if (!a.blobShadow) a.blobShadow = {};
  a.blobShadow.offsetX = parseFloat(blobShadowOxEl.value) || 0;
  updateBlobShadowLive(a.id);
});
blobShadowOxEl?.addEventListener("change", () => saveTagsForWorld());

blobShadowOyEl?.addEventListener("input", () => {
  const a = getSelectedAsset();
  if (!a) return;
  if (!a.blobShadow) a.blobShadow = {};
  a.blobShadow.offsetY = parseFloat(blobShadowOyEl.value) || 0;
  updateBlobShadowLive(a.id);
});
blobShadowOyEl?.addEventListener("change", () => saveTagsForWorld());

blobShadowOzEl?.addEventListener("input", () => {
  const a = getSelectedAsset();
  if (!a) return;
  if (!a.blobShadow) a.blobShadow = {};
  a.blobShadow.offsetZ = parseFloat(blobShadowOzEl.value) || 0;
  updateBlobShadowLive(a.id);
});
blobShadowOzEl?.addEventListener("change", () => saveTagsForWorld());

assetReceiveShadowEl?.addEventListener("change", () => {
  const a = getSelectedAsset();
  if (!a) return;
  a.receiveShadow = assetReceiveShadowEl.checked;
  saveTagsForWorld();
  // Update in-place — just toggle receiveShadow on each mesh
  const obj = assetsGroup.getObjectByName(`asset:${a.id}`);
  if (obj) {
    obj.traverse((m) => {
      if (m.isMesh && !m.userData.isShadowProxy && !m.userData.isBlobShadow) {
        m.receiveShadow = a.receiveShadow;
      }
    });
  }
});

assetSelectedPickableEl?.addEventListener("change", () => {
  const a = getSelectedAsset();
  if (!a) return;
  a.pickable = !!assetSelectedPickableEl.checked;
  saveTagsForWorld();
  renderAssetsList();
});

assetBumpableEl?.addEventListener("change", async () => {
  const a = getSelectedAsset();
  if (!a) return;
  a.bumpable = !!assetBumpableEl.checked;
  if (assetBumpControlsEl) assetBumpControlsEl.classList.toggle("hidden", !a.bumpable);
  if (a.bumpable) {
    _assetBumpVelocities.set(a.id, new THREE.Vector3());
    await rebuildAssetCollider(a.id);
  } else {
    _assetBumpVelocities.delete(a.id);
    await rebuildAssetCollider(a.id);
  }
  saveTagsForWorld();
});

assetBumpResponseEl?.addEventListener("input", () => {
  const a = getSelectedAsset();
  if (!a) return;
  a.bumpResponse = parseFloat(assetBumpResponseEl.value) || 0.9;
  if (assetBumpResponseValEl) assetBumpResponseValEl.textContent = a.bumpResponse.toFixed(2);
});
assetBumpResponseEl?.addEventListener("change", () => saveTagsForWorld());

assetBumpDampingEl?.addEventListener("input", () => {
  const a = getSelectedAsset();
  if (!a) return;
  a.bumpDamping = parseFloat(assetBumpDampingEl.value) || 0.9;
  if (assetBumpDampingValEl) assetBumpDampingValEl.textContent = a.bumpDamping.toFixed(2);
});
assetBumpDampingEl?.addEventListener("change", () => saveTagsForWorld());

// Initialize agent UI visibility/content.
document.documentElement.dataset.mode = appMode;
applySimPanelCollapsedState();
renderAgentTaskUi();
agentTaskStartBtn?.addEventListener("click", () => {
  if (agentTask.active) return;
  void startAgentTask(agentTaskInputEl?.value);
});
agentTaskEndBtn?.addEventListener("click", () => endAgentTask("manual"));
// Enter key in command input starts task; stop propagation so WASD doesn't trigger
agentTaskInputEl?.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter" && !agentTask.active && (aiAgents.length > 0 || appMode === "edit")) {
    void startAgentTask(agentTaskInputEl.value);
  }
});
tagRadiusEl?.addEventListener("input", () => {
  if (tagRadiusValueEl) tagRadiusValueEl.textContent = Number(tagRadiusEl.value).toFixed(2);
  if (draftTag) draftTag.radius = Number(tagRadiusEl.value);
});
tagSaveBtn?.addEventListener("click", () => upsertDraftTag());
tagCancelBtn?.addEventListener("click", () => cancelDraftTag());
tagDeleteBtn?.addEventListener("click", () => deleteSelectedTag());

tagsExportBtn?.addEventListener("click", () => {
  const exportAssets = assets.map((a) => {
    const { _colliderHandle, ...rest } = a;
    return rest;
  });
  // Export primitives (parametric – always tiny)
  const exportPrimitives = primitives.map((p) => {
    const { _colliderHandle, ...rest } = p;
    return rest;
  });
  // Export lights (strip runtime objects)
  const exportLights = editorLights.map((l) => {
    const { _lightObj, _helperObj, _proxyObj, ...rest } = l;
    return rest;
  });
  const payload = {
    version: "2.0",
    worldKey,
    exportedAt: Date.now(),
    tags,
    assets: exportAssets,
    primitives: exportPrimitives,
    lights: exportLights,
    groups,
    sceneSettings: serializeSceneSettings(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `spark-world-tags-${String(worldKey).replace(/[^a-z0-9_-]+/gi, "_")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 250);
});

// Shared import logic — used by both editor Import and sim Load Level
async function importLevelFromJSON(json, options = {}) {
  const importedTags = Array.isArray(json?.tags) ? json.tags : Array.isArray(json) ? json : null;
  const preserveAssetsWhenMissing = options.preserveAssetsWhenMissing === true;
  const importedAssets = Array.isArray(json?.assets)
    ? json.assets
    : (preserveAssetsWhenMissing ? assets : []);
  const importedPrimitives = Array.isArray(json?.primitives) ? json.primitives : [];
  const importedLights = Array.isArray(json?.lights) ? json.lights : [];
  const importedGroups = Array.isArray(json?.groups) ? json.groups : [];
  const importedSceneSettings = json && typeof json === "object" && json.sceneSettings
    ? normalizeSceneSettings(json.sceneSettings)
    : null;
  if (!importedTags) throw new Error("Invalid level file.");
  // Detach group pivot before clearing
  detachGroupTransform();
  // Clean up old primitive colliders
  for (const p of primitives) removePrimitiveCollider(p);
  tags = importedTags;
  assets = importedAssets;
  primitives = importedPrimitives;
  editorLights = importedLights;
  groups = importedGroups;
  if (importedSceneSettings) sceneSettings = importedSceneSettings;
  selectedGroupId = null;
  if (!options.skipWorldSave) saveTagsForWorld();
  rebuildTagMarkers();
  await rebuildAssets();
  rebuildAllPrimitives();
  rebuildAllEditorLights();
  renderTagsList();
  renderAssetsList();
  renderPrimitivesList();
  renderLightsList();
  renderTagPanel();
  renderPrimitiveProps();
  renderLightProps();
  applySceneSkySettings();
  applySceneRgbBackground();
  updateOutlinerCounts();
  syncShadowMapEnabled();
}

function captureCurrentLevelSnapshot() {
  const exportAssets = assets.map((a) => {
    const { _colliderHandle, ...rest } = a;
    return rest;
  });
  const exportPrimitives = primitives.map((p) => {
    const { _colliderHandle, ...rest } = p;
    return rest;
  });
  const exportLights = editorLights.map((l) => {
    const { _lightObj, _helperObj, _proxyObj, ...rest } = l;
    return rest;
  });
  return {
    version: "2.0",
    tags: [...tags],
    assets: exportAssets,
    primitives: exportPrimitives,
    lights: exportLights,
    groups: [...groups],
    sceneSettings: serializeSceneSettings(),
  };
}

function emptyBuilderSnapshot() {
  return {
    version: "2.0",
    tags: [],
    assets: [],
    primitives: [],
    lights: [],
    groups: [],
    sceneSettings: serializeSceneSettings(),
  };
}

function updateWorkspaceTabUi() {
  const inBuilder = currentWorkspace === "assetBuilder";
  workspaceTabSceneBtn?.classList.toggle("active", !inBuilder);
  workspaceTabAssetBuilderBtn?.classList.toggle("active", inBuilder);
  document.body.classList.toggle("staging-mode", inBuilder);
  if (assetBuilderGrid) assetBuilderGrid.visible = inBuilder && appMode === "edit";
  // Legacy toolbar save actions are hidden — panel is canonical save flow.
  document.getElementById("staging-publish-sep")?.classList.add("hidden");
  document.getElementById("staging-publish-asset-btn")?.classList.add("hidden");
  document.getElementById("staging-save-state-btn")?.classList.add("hidden");

  // Outliner sections
  const assetsSection = document.getElementById("ol-assets-section");
  const lightsSection = document.getElementById("ol-lights-section");
  const sceneLightsSection = document.getElementById("ol-scene-lights-section");
  const tagsSection = document.getElementById("ol-tags-section");
  if (assetsSection) assetsSection.classList.toggle("hidden", inBuilder);
  if (lightsSection) lightsSection.classList.toggle("hidden", inBuilder);
  if (sceneLightsSection) sceneLightsSection.classList.toggle("hidden", inBuilder);
  if (tagsSection) tagsSection.classList.toggle("hidden", inBuilder);

  // Toolbar items: always show transform tools
  const assetTransformTools = document.getElementById("asset-transform-tools");
  if (assetTransformTools) assetTransformTools.classList.remove("hidden");

  // Scene-only toolbar items: hide in builder
  const sceneOnlyIds = [
    "world-select", "world-load", "tag-place", "light-add-btn",
    "portal-create-btn", "clear-level-btn", "tags-export", "advanced",
  ];
  for (const id of sceneOnlyIds) {
    const el = document.getElementById(id);
    if (el) {
      const target = el.closest?.(".tb-group") || el.closest?.("label.tb-btn") || el;
      target.classList.toggle("hidden", inBuilder);
    }
  }
  // GLB import label
  const assetImportInput = document.getElementById("asset-glb-input");
  if (assetImportInput?.parentElement) assetImportInput.parentElement.classList.toggle("hidden", inBuilder);
  // Import label (scene only)
  const importInput = document.getElementById("tags-import");
  if (importInput?.parentElement) importInput.parentElement.classList.toggle("hidden", inBuilder);

  // Builder-mode inline shape bar
  const builderShapeBar = document.getElementById("builder-shape-bar");
  if (builderShapeBar) builderShapeBar.classList.toggle("hidden", !inBuilder);

  // Toolbar separators: hide extras in builder (they look orphaned)
  document.querySelectorAll("#overlay-top > .tb-sep").forEach((sep, i) => {
    if (inBuilder && i !== 1) sep.classList.add("hidden");
    else sep.classList.remove("hidden");
  });

  // Primitive props: hide scene-specific fields in builder
  const primStateRow = document.getElementById("prim-state")?.closest?.(".dt-row");
  const primPhysicsRow = document.getElementById("prim-physics")?.closest?.("label.prop-check");
  const primMetaSection = document.getElementById("prim-meta-add")?.closest?.("details.dt-section");
  const primNotesEl = document.getElementById("prim-notes");
  const primTagsInputEl = document.getElementById("prim-tags-input");
  if (primStateRow) primStateRow.classList.toggle("hidden", inBuilder);
  if (primPhysicsRow) primPhysicsRow.classList.toggle("hidden", inBuilder);
  if (primMetaSection) primMetaSection.classList.toggle("hidden", inBuilder);
  if (primNotesEl) primNotesEl.classList.toggle("hidden", inBuilder);
  if (primTagsInputEl) primTagsInputEl.classList.toggle("hidden", inBuilder);

  renderBuilderStateEditorPanel();
}

async function switchWorkspace(nextWorkspace) {
  if (nextWorkspace !== "scene" && nextWorkspace !== "assetBuilder") return;
  if (appMode !== "edit") setAppMode("edit");
  if (currentWorkspace === nextWorkspace) return;
  workspaceSnapshots[currentWorkspace] = captureCurrentLevelSnapshot();
  currentWorkspace = nextWorkspace;
  // Reset builder state when leaving builder
  if (nextWorkspace !== "assetBuilder") {
    builderShowTypeChoice = false;
  }
  let nextSnapshot = workspaceSnapshots[nextWorkspace];
  if (!nextSnapshot) {
    nextSnapshot = nextWorkspace === "assetBuilder" ? emptyBuilderSnapshot() : emptyBuilderSnapshot();
    workspaceSnapshots[nextWorkspace] = nextSnapshot;
  }
  await importLevelFromJSON(nextSnapshot, { skipWorldSave: true });
  updateWorkspaceTabUi();
  if (nextWorkspace === "assetBuilder") {
    focusVibeStagingArea();
    setStatus("Asset Builder — build with shapes, then save to library.");
  } else {
    setStatus("Scene workspace.");
  }
}

tagsImportEl?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    await importLevelFromJSON(JSON.parse(text));
    setStatus("Level imported.");
  } catch (err) {
    console.error(err);
    setStatus(err?.message || "Failed to import.");
  } finally {
    e.target.value = "";
  }
});

// Sim-mode "Load Level JSON" input (only exists in sim.html)
const simLevelImportEl = document.getElementById("sim-level-import");
simLevelImportEl?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    setStatus("Loading level...");
    const text = await file.text();
    await importLevelFromJSON(JSON.parse(text));
    setStatus("Level loaded. Click to enter, then spawn an agent.");
  } catch (err) {
    console.error(err);
    setStatus(err?.message || "Failed to load level.");
  } finally {
    e.target.value = "";
  }
});

canvas?.addEventListener("mousedown", () => {
  const id = pickTagMarkerFromCamera();
  if (!id) return;
  selectedTagId = id;
  draftTag = null;
  updateMarkerMaterials();
  renderTagsList();
  renderTagPanel();
});

// Object picking in edit mode — unified: find the CLOSEST hit across all types
// (primitives, assets, lights) so an asset in front of a shape is picked correctly.
canvas?.addEventListener("mousedown", (e) => {
  if (appMode !== "edit") return;
  if (e.button !== 0) return; // left-click only
  if (transformControls?.dragging) return;

  const rect = canvas.getBoundingClientRect();
  // Screen-space fallback pick: very reliable for tiny/moving agent capsules.
  // Only usable when pointer is unlocked and we have real cursor coordinates.
  if (!controls.isLocked) {
    const pickedByScreen = pickAgentFromScreenPoint(e.clientX, e.clientY, rect);
    if (pickedByScreen) {
      selectAgentInspector(pickedByScreen.id);
      setStatus(`Inspecting ${pickedByScreen.id}. Use right panel controls.`);
      return;
    }
  }

  // Compute NDC mouse coords: crosshair (0,0) when locked, actual mouse pos when unlocked
  let ndc;
  if (controls.isLocked) {
    ndc = { x: 0, y: 0 };
  } else {
    ndc = {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    };
  }
  _assetRaycaster.setFromCamera(ndc, camera);

  // --- AI agents (click to inspect; shift+click to manage stop/remove) ---
  const pickedAgent = pickAgentFromRay(_assetRaycaster);
  if (pickedAgent) {
    selectAgentInspector(pickedAgent.id);
    setStatus(`Inspecting ${pickedAgent.id}. Use right panel controls.`);
    return;
  }

  // Collect the closest candidate from each category: { type, id, distance }
  let best = null; // { type: "prim"|"asset"|"light", id: string, dist: number }

  // --- Primitives (mesh raycast) ---
  const primHits = _assetRaycaster.intersectObjects(primitivesGroup.children, true);
  const primHit = primHits.find((h) => h.object?.userData?.primitiveId);
  if (primHit) {
    const d = primHit.distance;
    if (!best || d < best.dist) best = { type: "prim", id: primHit.object.userData.primitiveId, dist: d };
  }

  // --- Lights (proxy icon raycast — only the small bulb proxies, not helpers/lines) ---
  const lightTargets = lightsGroup.children.filter(
    (c) => c.userData?.isLightProxy
  );
  const lightHits = _assetRaycaster.intersectObjects(lightTargets, true);
  if (lightHits.length > 0) {
    let obj = lightHits[0].object;
    while (obj && !obj.userData?.editorLightId) obj = obj.parent;
    if (obj?.userData?.editorLightId) {
      const d = lightHits[0].distance;
      // Only pick a light if it's very close to the click — prefer assets/prims
      if (d < 8 && (!best || d < best.dist - 0.3)) best = { type: "light", id: obj.userData.editorLightId, dist: d };
    }
  }

  // --- Assets (mesh raycast + bounding-box fallback) ---
  // 1) Precise mesh raycast
  const assetHits = _assetRaycaster.intersectObjects(assetsGroup.children, true);
  for (const h of assetHits) {
    if (h.object?.userData?.isBlobShadow || h.object?.userData?.isShadowProxy) continue;
    const aid = h.object?.userData?.assetId;
    if (aid) {
      if (!best || h.distance < best.dist) best = { type: "asset", id: aid, dist: h.distance };
      break; // first valid asset mesh hit is the closest
    }
  }
  // 2) Bounding-box fallback for thin/sparse GLB meshes
  if (!best || best.type !== "asset") {
    const ray = _assetRaycaster.ray;
    const _box = new THREE.Box3(), _hp = new THREE.Vector3();
    for (const child of assetsGroup.children) {
      const aid = child.name?.startsWith("asset:") ? child.name.slice(6) : null;
      if (!aid) continue;
      _box.setFromObject(child);
      if (_box.isEmpty()) continue;
      _box.expandByScalar(0.05);
      const hit = ray.intersectBox(_box, _hp);
      if (hit) {
        const d = ray.origin.distanceTo(_hp);
        if (!best || d < best.dist) best = { type: "asset", id: aid, dist: d };
      }
    }
  }

  // --- Apply the winning pick ---
  if (best) {
    switch (best.type) {
      case "prim":  selectPrimitive(best.id); return;
      case "asset": selectAsset(best.id); return;
      case "light": selectLight(best.id); return;
    }
  }

  // Nothing hit — deselect everything
  if (selectedPrimitiveId) selectPrimitive(null);
  if (selectedLightId) selectLight(null);
  if (selectedAssetId) selectAsset(null);
  if (selectedSceneLightId) selectSceneLight(null);
  if (draftTag) {
    draftTag = null;
    selectedTagId = null;
    renderTagPanel();
    renderTagsList();
    updateDetailsPanel();
  }
});

// =============================================================================
// PRIMITIVE & LIGHT EVENT HANDLERS
// =============================================================================

// Shape dropdown toggle
shapeDropdownToggle?.addEventListener("click", (e) => {
  e.stopPropagation();
  shapeDropdownMenu?.classList.toggle("hidden");
});

// Close dropdown when clicking elsewhere
document.addEventListener("click", () => {
  shapeDropdownMenu?.classList.add("hidden");
});

// Shape buttons
shapeDropdownMenu?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-shape]");
  if (!btn) return;
  const shape = btn.getAttribute("data-shape");
  if (shape) {
    addPrimitiveAtCrosshair(shape);
    shapeDropdownMenu?.classList.add("hidden");
  }
});

// Add light button
lightAddBtn?.addEventListener("click", () => {
  addEditorLight("directional");
});

// Primitive property inputs
primNameEl?.addEventListener("input", () => {
  const prim = getSelectedPrimitive();
  if (prim) { prim.name = primNameEl.value; saveTagsForWorld(); renderPrimitivesList(); }
});

primNotesEl?.addEventListener("input", () => {
  const prim = getSelectedPrimitive();
  if (prim) { prim.notes = primNotesEl.value; saveTagsForWorld(); }
});

primTagsInputEl?.addEventListener("change", () => {
  const prim = getSelectedPrimitive();
  if (prim) {
    prim.tags = (primTagsInputEl.value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    saveTagsForWorld();
  }
});

primStateEl?.addEventListener("change", () => {
  const prim = getSelectedPrimitive();
  if (prim) { prim.state = primStateEl.value; saveTagsForWorld(); }
});

primMetaAddBtn?.addEventListener("click", () => {
  const prim = getSelectedPrimitive();
  if (!prim) return;
  if (!prim.metadata) prim.metadata = {};
  // Generate a unique default key name
  let n = 1;
  while (prim.metadata[`key${n}`] !== undefined) n++;
  prim.metadata[`key${n}`] = "";
  saveTagsForWorld();
  renderPrimitiveMetadata(prim);
});

primMetaListEl?.addEventListener("input", (e) => {
  const prim = getSelectedPrimitive();
  if (!prim) return;
  const row = e.target.closest(".meta-kv-row");
  if (!row) return;
  const oldKey = row.getAttribute("data-mk");
  const field = e.target.getAttribute("data-field");

  if (field === "val") {
    // Value changed – update in place
    if (oldKey != null && prim.metadata) {
      prim.metadata[oldKey] = e.target.value;
      saveTagsForWorld();
    }
  } else if (field === "key") {
    // Key renamed
    const newKey = e.target.value.trim();
    if (!newKey || newKey === oldKey) return;
    if (!prim.metadata) prim.metadata = {};
    const val = prim.metadata[oldKey] ?? "";
    delete prim.metadata[oldKey];
    prim.metadata[newKey] = val;
    row.setAttribute("data-mk", newKey);
    saveTagsForWorld();
  }
});

primMetaListEl?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action='remove-meta']");
  if (!btn) return;
  const row = btn.closest(".meta-kv-row");
  const key = row?.getAttribute("data-mk");
  const prim = getSelectedPrimitive();
  if (prim && key != null && prim.metadata) {
    delete prim.metadata[key];
    saveTagsForWorld();
    renderPrimitiveMetadata(prim);
  }
});

function editSelectedPrimitiveMaterial(editFn) {
  const prim = getSelectedPrimitive();
  if (!prim) return;
    if (!prim.material) prim.material = {};
  editFn(prim.material, prim);
    updatePrimitiveMaterial(prim.id);
    saveTagsForWorld();
  }

primColorEl?.addEventListener("input", () => {
  editSelectedPrimitiveMaterial((mat) => {
    mat.color = primColorEl.value;
  });
});

primRoughnessEl?.addEventListener("input", () => {
  const roughness = parseFloat(primRoughnessEl.value);
  editSelectedPrimitiveMaterial((mat) => {
    mat.softness = roughness;
    mat.roughness = roughness;
    if (primRoughnessValEl) primRoughnessValEl.textContent = roughness.toFixed(2);
  });
});

primHardnessEl?.addEventListener("input", () => {
  const hardness = parseFloat(primHardnessEl.value);
  editSelectedPrimitiveMaterial((mat) => {
    mat.hardness = hardness;
    mat.clearcoat = Math.max(mat.clearcoat ?? 0, hardness * 0.85);
    mat.clearcoatRoughness = Math.min(mat.clearcoatRoughness ?? 1, 1 - hardness * 0.8);
    if (primHardnessValEl) primHardnessValEl.textContent = hardness.toFixed(2);
    if (primClearcoatEl) primClearcoatEl.value = String(mat.clearcoat);
    if (primClearcoatValEl) primClearcoatValEl.textContent = Number(mat.clearcoat).toFixed(2);
    if (primClearcoatRoughnessEl) primClearcoatRoughnessEl.value = String(mat.clearcoatRoughness);
    if (primClearcoatRoughnessValEl) primClearcoatRoughnessValEl.textContent = Number(mat.clearcoatRoughness).toFixed(2);
  });
});

primFluffinessEl?.addEventListener("input", () => {
  const fluffiness = parseFloat(primFluffinessEl.value);
  editSelectedPrimitiveMaterial((mat) => {
    mat.fluffiness = fluffiness;
    if (primFluffinessValEl) primFluffinessValEl.textContent = fluffiness.toFixed(2);
  });
});

primMetalnessEl?.addEventListener("input", () => {
  const metalness = parseFloat(primMetalnessEl.value);
  editSelectedPrimitiveMaterial((mat) => {
    mat.metalness = metalness;
    if (primMetalnessValEl) primMetalnessValEl.textContent = metalness.toFixed(2);
  });
});

primSpecularIntensityEl?.addEventListener("input", () => {
  const value = parseFloat(primSpecularIntensityEl.value);
  editSelectedPrimitiveMaterial((mat) => {
    mat.specularIntensity = value;
    if (primSpecularIntensityValEl) primSpecularIntensityValEl.textContent = value.toFixed(2);
  });
});

primSpecularColorEl?.addEventListener("input", () => {
  editSelectedPrimitiveMaterial((mat) => {
    mat.specularColor = primSpecularColorEl.value;
  });
});

primEnvIntensityEl?.addEventListener("input", () => {
  const value = parseFloat(primEnvIntensityEl.value);
  editSelectedPrimitiveMaterial((mat) => {
    mat.envMapIntensity = value;
    if (primEnvIntensityValEl) primEnvIntensityValEl.textContent = value.toFixed(2);
  });
});

primOpacityEl?.addEventListener("input", () => {
  const opacity = parseFloat(primOpacityEl.value);
  editSelectedPrimitiveMaterial((mat) => {
    mat.opacity = opacity;
    if (primOpacityValEl) primOpacityValEl.textContent = opacity.toFixed(2);
  });
});

primTransmissionEl?.addEventListener("input", () => {
  const transmission = parseFloat(primTransmissionEl.value);
  editSelectedPrimitiveMaterial((mat) => {
    mat.transmission = transmission;
    if (primTransmissionValEl) primTransmissionValEl.textContent = transmission.toFixed(2);
  });
});

primIorEl?.addEventListener("input", () => {
  const ior = parseFloat(primIorEl.value);
  editSelectedPrimitiveMaterial((mat) => {
    mat.ior = ior;
    if (primIorValEl) primIorValEl.textContent = ior.toFixed(2);
  });
});

primThicknessEl?.addEventListener("input", () => {
  const thickness = parseFloat(primThicknessEl.value);
  editSelectedPrimitiveMaterial((mat) => {
    mat.thickness = thickness;
    if (primThicknessValEl) primThicknessValEl.textContent = thickness.toFixed(2);
  });
});

primAttenuationColorEl?.addEventListener("input", () => {
  editSelectedPrimitiveMaterial((mat) => {
    mat.attenuationColor = primAttenuationColorEl.value;
  });
});

primAttenuationDistanceEl?.addEventListener("input", () => {
  const value = parseFloat(primAttenuationDistanceEl.value);
  editSelectedPrimitiveMaterial((mat) => {
    mat.attenuationDistance = value;
    if (primAttenuationDistanceValEl) primAttenuationDistanceValEl.textContent = value.toFixed(2);
  });
});

primIridescenceEl?.addEventListener("input", () => {
  const value = parseFloat(primIridescenceEl.value);
  editSelectedPrimitiveMaterial((mat) => {
    mat.iridescence = value;
    if (primIridescenceValEl) primIridescenceValEl.textContent = value.toFixed(2);
  });
});

primEmissiveColorEl?.addEventListener("input", () => {
  editSelectedPrimitiveMaterial((mat) => {
    mat.emissive = primEmissiveColorEl.value;
  });
});

primEmissiveIntensityEl?.addEventListener("input", () => {
  const intensity = parseFloat(primEmissiveIntensityEl.value);
  editSelectedPrimitiveMaterial((mat) => {
    mat.emissiveIntensity = intensity;
    if (primEmissiveIntensityValEl) primEmissiveIntensityValEl.textContent = intensity.toFixed(2);
  });
});

primClearcoatEl?.addEventListener("input", () => {
  const clearcoat = parseFloat(primClearcoatEl.value);
  editSelectedPrimitiveMaterial((mat) => {
    mat.clearcoat = clearcoat;
    if (primClearcoatValEl) primClearcoatValEl.textContent = clearcoat.toFixed(2);
  });
});

primClearcoatRoughnessEl?.addEventListener("input", () => {
  const clearcoatRoughness = parseFloat(primClearcoatRoughnessEl.value);
  editSelectedPrimitiveMaterial((mat) => {
    mat.clearcoatRoughness = clearcoatRoughness;
    if (primClearcoatRoughnessValEl) primClearcoatRoughnessValEl.textContent = clearcoatRoughness.toFixed(2);
  });
});

primAlphaCutoffEl?.addEventListener("input", () => {
  const value = parseFloat(primAlphaCutoffEl.value);
  editSelectedPrimitiveMaterial((mat) => {
    mat.alphaCutoff = value;
    if (primAlphaCutoffValEl) primAlphaCutoffValEl.textContent = value.toFixed(2);
  });
});

primTextureSoftnessEl?.addEventListener("input", () => {
  const textureSoftness = parseFloat(primTextureSoftnessEl.value);
  editSelectedPrimitiveMaterial((mat) => {
    mat.textureSoftness = textureSoftness;
    if (primTextureSoftnessValEl) primTextureSoftnessValEl.textContent = textureSoftness.toFixed(2);
  });
});

primTextureHardnessEl?.addEventListener("input", () => {
  const textureHardness = parseFloat(primTextureHardnessEl.value);
  editSelectedPrimitiveMaterial((mat) => {
    mat.textureHardness = textureHardness;
    if (primTextureHardnessValEl) primTextureHardnessValEl.textContent = textureHardness.toFixed(2);
  });
});

function updateSelectedPrimitiveUvTransform(mutator) {
  editSelectedPrimitiveMaterial((mat) => {
    if (!mat.uvTransform) mat.uvTransform = { repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0, rotationDeg: 0 };
    mutator(mat.uvTransform);
  });
}

const PRIMITIVE_MATERIAL_PRESETS = {
  plastic: { softness: 0.35, hardness: 0.35, fluffiness: 0.0, metalness: 0.0, specularIntensity: 1.0, envMapIntensity: 0.9, transparency: 1, transmission: 0, ior: 1.47, thickness: 0, clearcoat: 0.55, clearcoatRoughness: 0.2, textureSoftness: 0.2, textureHardness: 0.65, alphaCutoff: 0, iridescence: 0 },
  ceramic: { softness: 0.25, hardness: 0.55, fluffiness: 0.0, metalness: 0.0, specularIntensity: 1.2, envMapIntensity: 1.1, transparency: 1, transmission: 0, ior: 1.5, thickness: 0, clearcoat: 0.65, clearcoatRoughness: 0.08, textureSoftness: 0.15, textureHardness: 0.75, alphaCutoff: 0, iridescence: 0 },
  rubber: { softness: 0.9, hardness: 0.15, fluffiness: 0.0, metalness: 0.0, specularIntensity: 0.4, envMapIntensity: 0.25, transparency: 1, transmission: 0, ior: 1.52, thickness: 0, clearcoat: 0.08, clearcoatRoughness: 0.7, textureSoftness: 0.55, textureHardness: 0.25, alphaCutoff: 0, iridescence: 0 },
  fabric: { softness: 0.88, hardness: 0.1, fluffiness: 0.45, metalness: 0.0, specularIntensity: 0.35, envMapIntensity: 0.2, transparency: 1, transmission: 0, ior: 1.45, thickness: 0.02, clearcoat: 0.0, clearcoatRoughness: 0.9, textureSoftness: 0.5, textureHardness: 0.2, alphaCutoff: 0, iridescence: 0 },
  velvet: { softness: 0.95, hardness: 0.05, fluffiness: 0.95, metalness: 0.0, specularIntensity: 0.3, envMapIntensity: 0.15, transparency: 1, transmission: 0, ior: 1.4, thickness: 0.05, clearcoat: 0.0, clearcoatRoughness: 1.0, textureSoftness: 0.65, textureHardness: 0.15, alphaCutoff: 0, iridescence: 0.05 },
  cushion: { softness: 0.92, hardness: 0.12, fluffiness: 0.72, metalness: 0.0, specularIntensity: 0.25, envMapIntensity: 0.18, transparency: 1, transmission: 0, ior: 1.4, thickness: 0.04, clearcoat: 0.0, clearcoatRoughness: 0.95, textureSoftness: 0.7, textureHardness: 0.18, alphaCutoff: 0, iridescence: 0 },
  leaf: { softness: 0.68, hardness: 0.25, fluffiness: 0.2, metalness: 0.0, specularIntensity: 0.8, envMapIntensity: 0.75, transparency: 1, transmission: 0.25, ior: 1.42, thickness: 0.03, clearcoat: 0.12, clearcoatRoughness: 0.5, textureSoftness: 0.2, textureHardness: 0.78, alphaCutoff: 0.45, iridescence: 0.05, attenuationColor: "#9ad07a", attenuationDistance: 0.45, doubleSided: true },
  water: { softness: 0.02, hardness: 0.95, fluffiness: 0.0, metalness: 0.0, specularIntensity: 1.35, envMapIntensity: 1.6, transparency: 0.96, transmission: 1.0, ior: 1.333, thickness: 0.4, clearcoat: 1.0, clearcoatRoughness: 0.03, textureSoftness: 0.08, textureHardness: 0.9, alphaCutoff: 0, iridescence: 0.12, attenuationColor: "#74c6ff", attenuationDistance: 0.55 },
  glass: { softness: 0.02, hardness: 0.92, fluffiness: 0.0, metalness: 0.0, specularIntensity: 1.25, envMapIntensity: 1.5, transparency: 0.98, transmission: 1.0, ior: 1.52, thickness: 0.35, clearcoat: 0.9, clearcoatRoughness: 0.02, textureSoftness: 0.1, textureHardness: 0.85, alphaCutoff: 0, iridescence: 0.0, attenuationColor: "#ffffff", attenuationDistance: 1.2 },
  mirror: { softness: 0.0, hardness: 1.0, fluffiness: 0.0, metalness: 1.0, specularIntensity: 1.7, envMapIntensity: 2.4, transparency: 1, transmission: 0, ior: 2.2, thickness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.0, textureSoftness: 0.0, textureHardness: 1.0, alphaCutoff: 0, iridescence: 0.0 },
  metal: { softness: 0.12, hardness: 0.86, fluffiness: 0.0, metalness: 0.95, specularIntensity: 1.5, envMapIntensity: 1.9, transparency: 1, transmission: 0, ior: 2.0, thickness: 0, clearcoat: 0.45, clearcoatRoughness: 0.06, textureSoftness: 0.1, textureHardness: 0.9, alphaCutoff: 0, iridescence: 0.0 },
  concrete: { softness: 0.96, hardness: 0.88, fluffiness: 0.0, metalness: 0.0, specularIntensity: 0.2, envMapIntensity: 0.15, transparency: 1, transmission: 0, ior: 1.5, thickness: 0, clearcoat: 0.0, clearcoatRoughness: 1.0, textureSoftness: 0.35, textureHardness: 0.7, alphaCutoff: 0, iridescence: 0 },
  emissive: { softness: 0.35, hardness: 0.4, fluffiness: 0.0, metalness: 0.0, specularIntensity: 0.8, envMapIntensity: 0.6, transparency: 1, transmission: 0, ior: 1.45, thickness: 0, clearcoat: 0.2, clearcoatRoughness: 0.25, textureSoftness: 0.2, textureHardness: 0.6, alphaCutoff: 0, iridescence: 0.08, emissive: "#88aaff", emissiveIntensity: 1.6 },
};

function applyPrimitiveMaterialPreset(presetKey) {
  const preset = PRIMITIVE_MATERIAL_PRESETS[presetKey];
  if (!preset) return;
  editSelectedPrimitiveMaterial((mat) => {
    mat.softness = preset.softness ?? mat.softness ?? mat.roughness ?? 0.7;
    mat.roughness = mat.softness;
    mat.hardness = preset.hardness ?? mat.hardness ?? 0;
    mat.fluffiness = preset.fluffiness ?? mat.fluffiness ?? 0;
    mat.metalness = preset.metalness ?? mat.metalness ?? 0;
    mat.specularIntensity = preset.specularIntensity ?? mat.specularIntensity ?? 1;
    mat.specularColor = preset.specularColor || mat.specularColor || "#ffffff";
    mat.envMapIntensity = preset.envMapIntensity ?? mat.envMapIntensity ?? 1;
    if (preset.transparency !== undefined) mat.opacity = preset.transparency;
    mat.transmission = preset.transmission ?? mat.transmission ?? 0;
    mat.ior = preset.ior ?? mat.ior ?? 1.45;
    mat.thickness = preset.thickness ?? mat.thickness ?? 0;
    mat.attenuationColor = preset.attenuationColor || mat.attenuationColor || "#ffffff";
    mat.attenuationDistance = preset.attenuationDistance ?? mat.attenuationDistance ?? 1.0;
    mat.iridescence = preset.iridescence ?? mat.iridescence ?? 0;
    mat.clearcoat = preset.clearcoat ?? mat.clearcoat ?? 0;
    mat.clearcoatRoughness = preset.clearcoatRoughness ?? mat.clearcoatRoughness ?? 0;
    mat.alphaCutoff = preset.alphaCutoff ?? mat.alphaCutoff ?? 0;
    mat.textureSoftness = preset.textureSoftness ?? mat.textureSoftness ?? 0.25;
    mat.textureHardness = preset.textureHardness ?? mat.textureHardness ?? 0.5;
    mat.doubleSided = preset.doubleSided ?? mat.doubleSided ?? true;
    if (preset.emissive) mat.emissive = preset.emissive;
    if (preset.emissiveIntensity !== undefined) mat.emissiveIntensity = preset.emissiveIntensity;
  });
  renderPrimitiveProps();
}

primUvRepeatXEl?.addEventListener("input", () => {
  const value = parseFloat(primUvRepeatXEl.value);
  updateSelectedPrimitiveUvTransform((uv) => {
    uv.repeatX = value;
    if (primUvRepeatXValEl) primUvRepeatXValEl.textContent = value.toFixed(2);
  });
});

primUvRepeatYEl?.addEventListener("input", () => {
  const value = parseFloat(primUvRepeatYEl.value);
  updateSelectedPrimitiveUvTransform((uv) => {
    uv.repeatY = value;
    if (primUvRepeatYValEl) primUvRepeatYValEl.textContent = value.toFixed(2);
  });
});

primUvOffsetXEl?.addEventListener("input", () => {
  const value = parseFloat(primUvOffsetXEl.value);
  updateSelectedPrimitiveUvTransform((uv) => {
    uv.offsetX = value;
    if (primUvOffsetXValEl) primUvOffsetXValEl.textContent = value.toFixed(2);
  });
});

primUvOffsetYEl?.addEventListener("input", () => {
  const value = parseFloat(primUvOffsetYEl.value);
  updateSelectedPrimitiveUvTransform((uv) => {
    uv.offsetY = value;
    if (primUvOffsetYValEl) primUvOffsetYValEl.textContent = value.toFixed(2);
  });
});

primUvRotationEl?.addEventListener("input", () => {
  const value = parseFloat(primUvRotationEl.value);
  updateSelectedPrimitiveUvTransform((uv) => {
    uv.rotationDeg = value;
    if (primUvRotationValEl) primUvRotationValEl.textContent = String(Math.round(value));
  });
});

primDoubleSidedEl?.addEventListener("change", () => {
  editSelectedPrimitiveMaterial((mat) => {
    mat.doubleSided = !!primDoubleSidedEl.checked;
  });
});

primFlatShadingEl?.addEventListener("change", () => {
  editSelectedPrimitiveMaterial((mat) => {
    mat.flatShading = !!primFlatShadingEl.checked;
  });
});

primWireframeEl?.addEventListener("change", () => {
  editSelectedPrimitiveMaterial((mat) => {
    mat.wireframe = !!primWireframeEl.checked;
  });
});

primTextureEl?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const prim = getSelectedPrimitive();
  if (!prim) return;
  const reader = new FileReader();
  reader.onload = () => {
    editSelectedPrimitiveMaterial((mat) => {
      mat.textureDataUrl = reader.result;
    });
    if (primTextureLabelEl) primTextureLabelEl.textContent = "Change";
  };
  reader.readAsDataURL(file);
});

primTextureClearBtn?.addEventListener("click", () => {
  editSelectedPrimitiveMaterial((mat) => {
    mat.textureDataUrl = null;
  });
    if (primTextureLabelEl) primTextureLabelEl.textContent = "Upload";
});

primPresetPlasticBtn?.addEventListener("click", () => applyPrimitiveMaterialPreset("plastic"));
primPresetCeramicBtn?.addEventListener("click", () => applyPrimitiveMaterialPreset("ceramic"));
primPresetRubberBtn?.addEventListener("click", () => applyPrimitiveMaterialPreset("rubber"));
primPresetFabricBtn?.addEventListener("click", () => applyPrimitiveMaterialPreset("fabric"));
primPresetVelvetBtn?.addEventListener("click", () => applyPrimitiveMaterialPreset("velvet"));
primPresetCushionBtn?.addEventListener("click", () => applyPrimitiveMaterialPreset("cushion"));
primPresetLeafBtn?.addEventListener("click", () => applyPrimitiveMaterialPreset("leaf"));
primPresetWaterBtn?.addEventListener("click", () => applyPrimitiveMaterialPreset("water"));
primPresetGlassBtn?.addEventListener("click", () => applyPrimitiveMaterialPreset("glass"));
primPresetMirrorBtn?.addEventListener("click", () => applyPrimitiveMaterialPreset("mirror"));
primPresetMetalBtn?.addEventListener("click", () => applyPrimitiveMaterialPreset("metal"));
primPresetConcreteBtn?.addEventListener("click", () => applyPrimitiveMaterialPreset("concrete"));
primPresetEmissiveBtn?.addEventListener("click", () => applyPrimitiveMaterialPreset("emissive"));

primPhysicsEl?.addEventListener("change", () => {
  const prim = getSelectedPrimitive();
  if (prim) {
    prim.physics = primPhysicsEl.checked;
    if (!prim.physics) {
      removePrimitiveCollider(prim);
    } else if (rapierWorld && worldBody) {
      rebuildPrimitiveColliderSync(prim);
    } else {
      _pendingColliderBuilds.push(prim);
      ensureRapierLoaded();
    }
    saveTagsForWorld();
  }
});

primCastShadowEl?.addEventListener("change", () => {
  const prim = getSelectedPrimitive();
  if (prim) {
    prim.castShadow = primCastShadowEl.checked;
    const mesh = primitivesGroup.getObjectByName(`prim:${prim.id}`);
    if (mesh) mesh.castShadow = prim.castShadow;
    saveTagsForWorld();
  }
});

primReceiveShadowEl?.addEventListener("change", () => {
  const prim = getSelectedPrimitive();
  if (prim) {
    prim.receiveShadow = primReceiveShadowEl.checked;
    const mesh = primitivesGroup.getObjectByName(`prim:${prim.id}`);
    if (mesh) mesh.receiveShadow = prim.receiveShadow;
    saveTagsForWorld();
  }
});

// Dimension sliders (delegated event on container)
primDimsContainerEl?.addEventListener("input", (e) => {
  const slider = e.target.closest("input[data-dim]");
  if (!slider) return;
  const key = slider.getAttribute("data-dim");
  const cfg = PRIMITIVE_DIM_CONFIG[key] || {};
  let val = parseFloat(slider.value);
  if (cfg.integer) val = Math.round(val);
  const valSpan = slider.nextElementSibling;
  if (valSpan && key) valSpan.textContent = formatPrimitiveDimValue(key, val);

  const prim = getSelectedPrimitive();
  if (prim && key) {
    if (!prim.dimensions) prim.dimensions = {};
    prim.dimensions[key] = val;
    updatePrimitiveDimensions(prim.id);
    saveTagsForWorld();
  }
});

primDuplicateBtn?.addEventListener("click", () => {
  if (selectedPrimitiveId) duplicatePrimitive(selectedPrimitiveId);
});

primDeleteBtn?.addEventListener("click", () => {
  if (selectedPrimitiveId) deletePrimitive(selectedPrimitiveId);
});

primSubtractApplyBtn?.addEventListener("click", () => {
  const cutter = getSelectedPrimitive();
  if (!cutter) return;
  const explicitTargetId = primSubtractSourceEl?.value || "";
  let targetIds = [];
  if (explicitTargetId) {
    if (explicitTargetId === cutter.id) return;
    targetIds = [explicitTargetId];
  } else {
    targetIds = getOverlappingPrimitiveIds(cutter.id);
  }
  if (!targetIds.length) {
    setStatus("No overlapping target shapes found. Place selected shape inside another and retry.");
    return;
  }
  let added = 0;
  for (const targetId of targetIds) {
    const target = primitives.find((p) => p.id === targetId);
    if (!target) continue;
    if (!Array.isArray(target.cutouts)) target.cutouts = [];
    const cutout = buildPrimitiveCutoutFromSource(target.id, cutter.id);
    if (!cutout) continue;
    target.cutouts.push(cutout);
    updatePrimitiveMaterial(target.id);
    added++;
  }
  if (!added) return;
  saveTagsForWorld();
  const deleteSource = primSubtractDeleteSourceEl?.checked === true;
  if (deleteSource) {
    const nextTargetId = targetIds[0] || null;
    deletePrimitive(cutter.id);
    if (nextTargetId) selectPrimitive(nextTargetId);
  } else {
    renderPrimitiveProps();
    renderPrimitivesList();
  }
  setStatus(`Subtract applied to ${added} target shape${added > 1 ? "s" : ""}.`);
});

primSubtractClearBtn?.addEventListener("click", () => {
  const target = getSelectedPrimitive();
  if (!target) return;
  target.cutouts = [];
  updatePrimitiveMaterial(target.id);
  saveTagsForWorld();
  renderPrimitiveProps();
  setStatus("Cutouts cleared.");
});

// Light property inputs
lightNameEl?.addEventListener("input", () => {
  const ld = getSelectedLight();
  if (ld) { ld.name = lightNameEl.value; saveTagsForWorld(); renderLightsList(); }
});

lightTypeEl?.addEventListener("change", () => {
  const ld = getSelectedLight();
  if (!ld) return;
  ld.type = lightTypeEl.value;
  // Recreate the light + proxy for the new type
  instantiateEditorLight(ld);
  saveTagsForWorld();
  renderLightProps();
  // Re-attach transform controls to the proxy
  if (ld._proxyObj) {
    transformControls.attach(ld._proxyObj);
  }
});

lightColorEl?.addEventListener("input", () => {
  const ld = getSelectedLight();
  if (ld) { ld.color = lightColorEl.value; updateEditorLightFromProps(ld); }
});

lightIntensityEl?.addEventListener("input", () => {
  const ld = getSelectedLight();
  if (ld) {
    ld.intensity = parseFloat(lightIntensityEl.value);
    if (lightIntensityValEl) lightIntensityValEl.textContent = ld.intensity.toFixed(2);
    updateEditorLightFromProps(ld);
  }
});

lightDistanceEl?.addEventListener("input", () => {
  const ld = getSelectedLight();
  if (ld) {
    ld.distance = parseFloat(lightDistanceEl.value);
    if (lightDistanceValEl) lightDistanceValEl.textContent = String(Math.round(ld.distance));
    updateEditorLightFromProps(ld);
  }
});

lightAngleEl?.addEventListener("input", () => {
  const ld = getSelectedLight();
  if (ld) {
    ld.angle = parseFloat(lightAngleEl.value);
    if (lightAngleValEl) lightAngleValEl.textContent = Math.round((ld.angle * 180) / Math.PI) + "\u00B0";
    updateEditorLightFromProps(ld);
  }
});

lightPenumbraEl?.addEventListener("input", () => {
  const ld = getSelectedLight();
  if (ld) {
    ld.penumbra = parseFloat(lightPenumbraEl.value);
    if (lightPenumbraValEl) lightPenumbraValEl.textContent = ld.penumbra.toFixed(2);
    updateEditorLightFromProps(ld);
  }
});

const lightTargetHandler = () => {
  const ld = getSelectedLight();
  if (ld) {
    ld.target = {
      x: parseFloat(lightTargetXEl?.value || 0),
      y: parseFloat(lightTargetYEl?.value || 0),
      z: parseFloat(lightTargetZEl?.value || 0),
    };
    updateEditorLightFromProps(ld);
    // Also update proxy rotation to face the new target
    if (ld._proxyObj && ld._lightObj) {
      const lightPos = ld._lightObj.position.clone();
      const targetPos = new THREE.Vector3(ld.target.x, ld.target.y, ld.target.z);
      const dir = targetPos.sub(lightPos).normalize();
      const up = new THREE.Vector3(0, -1, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
      ld._proxyObj.quaternion.copy(q);
      ld.rotation = { x: ld._proxyObj.rotation.x, y: ld._proxyObj.rotation.y, z: ld._proxyObj.rotation.z };
      saveTagsForWorld();
    }
  }
};
lightTargetXEl?.addEventListener("input", lightTargetHandler);
lightTargetYEl?.addEventListener("input", lightTargetHandler);
lightTargetZEl?.addEventListener("input", lightTargetHandler);

lightCastShadowEl?.addEventListener("change", () => {
  const ld = getSelectedLight();
  if (ld) { ld.castShadow = lightCastShadowEl.checked; updateEditorLightFromProps(ld); syncShadowMapEnabled(); }
});

lightDeleteBtn?.addEventListener("click", () => {
  if (selectedLightId) deleteEditorLight(selectedLightId);
});

// Scene light property handlers
slColorEl?.addEventListener("input", () => {
  const sl = getSelectedSceneLight();
  if (sl && sl.type !== "sky") {
    sl.obj.color.set(slColorEl.value);
  }
});

slIntensityEl?.addEventListener("input", () => {
  const sl = getSelectedSceneLight();
  if (!sl) return;
  if (sl.type === "shadow_ground") {
    // For shadow ground, this slider controls opacity
    sl.obj.material.opacity = parseFloat(slIntensityEl.value);
    if (slIntensityValEl) slIntensityValEl.textContent = sl.obj.material.opacity.toFixed(2);
  } else {
    if (sl.type === "sky") return;
    sl.obj.intensity = parseFloat(slIntensityEl.value);
    if (slIntensityValEl) slIntensityValEl.textContent = sl.obj.intensity.toFixed(2);
  }
});

slGroundColorEl?.addEventListener("input", () => {
  const sl = getSelectedSceneLight();
  if (sl && sl.obj.isHemisphereLight) {
    sl.obj.groundColor.set(slGroundColorEl.value);
  }
});

slDistanceEl?.addEventListener("input", () => {
  const sl = getSelectedSceneLight();
  if (sl && sl.obj.isPointLight) {
    sl.obj.distance = parseFloat(slDistanceEl.value);
    if (slDistanceValEl) slDistanceValEl.textContent = String(Math.round(sl.obj.distance));
  }
});

slShadowEl?.addEventListener("change", () => {
  const sl = getSelectedSceneLight();
  if (sl && sl.obj.castShadow !== undefined) {
    sl.obj.castShadow = slShadowEl.checked;
    syncShadowMapEnabled();
  }
});

slEnabledEl?.addEventListener("change", () => {
  const sl = getSelectedSceneLight();
  if (sl) {
    if (sl.type === "sky") {
      const s = normalizeSceneSettings(sceneSettings);
      s.sky.enabled = !!slEnabledEl.checked;
      sceneSettings = s;
      applySceneRgbBackground();
    } else {
      sl.obj.visible = slEnabledEl.checked;
    }
    renderSceneLightsList();
    syncShadowMapEnabled();
    saveTagsForWorld();
  }
});

function updateSkySettingFromUi(mutator) {
  const sl = getSelectedSceneLight();
  if (!sl || sl.type !== "sky") return;
  const s = normalizeSceneSettings(sceneSettings);
  mutator(s.sky);
  sceneSettings = s;
  applySceneSkySettings();
  applySceneRgbBackground();
  renderSceneLightProps();
  saveTagsForWorld();
}

slSkyTopColorEl?.addEventListener("input", () => {
  updateSkySettingFromUi((sky) => { sky.topColor = slSkyTopColorEl.value; });
});
slSkyHorizonColorEl?.addEventListener("input", () => {
  updateSkySettingFromUi((sky) => { sky.horizonColor = slSkyHorizonColorEl.value; });
});
slSkyBottomColorEl?.addEventListener("input", () => {
  updateSkySettingFromUi((sky) => { sky.bottomColor = slSkyBottomColorEl.value; });
});
slSkyBrightnessEl?.addEventListener("input", () => {
  updateSkySettingFromUi((sky) => { sky.brightness = parseFloat(slSkyBrightnessEl.value) || 1.0; });
});
slSkySoftnessEl?.addEventListener("input", () => {
  updateSkySettingFromUi((sky) => { sky.softness = parseFloat(slSkySoftnessEl.value) || 1.0; });
});
slSkySunStrengthEl?.addEventListener("input", () => {
  updateSkySettingFromUi((sky) => { sky.sunStrength = parseFloat(slSkySunStrengthEl.value) || 0.0; });
});
slSkySunHeightEl?.addEventListener("input", () => {
  updateSkySettingFromUi((sky) => { sky.sunHeight = parseFloat(slSkySunHeightEl.value) || 0.0; });
});

sceneLightPropsEl?.addEventListener("keydown", (e) => e.stopPropagation());

// Prevent props panel and details panel inputs from triggering global key handlers
primPropsEl?.addEventListener("keydown", (e) => e.stopPropagation());
lightPropsEl?.addEventListener("keydown", (e) => e.stopPropagation());
detailsPanelEl?.addEventListener("keydown", (e) => e.stopPropagation());

// Transform XYZ input handlers — apply on change (blur or Enter)
const xformInputs = [xformPxEl, xformPyEl, xformPzEl, xformRxEl, xformRyEl, xformRzEl, xformSxEl, xformSyEl, xformSzEl];
for (const inp of xformInputs) {
  if (!inp) continue;
  inp.addEventListener("change", () => applyTransformFromInputs());
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.target.blur(); applyTransformFromInputs(); }
  });
}

// Expose tag data for "simulation mode" consumers.
globalThis.sparkWorld = globalThis.sparkWorld || {};
globalThis.sparkWorld.getWorldKey = () => worldKey;
globalThis.sparkWorld.getTags = () => tags.slice();
globalThis.sparkWorld.getAiAgents = () => aiAgents.map((a) => ({ id: a.id, position: a.getPosition?.() }));

let isRebuildingCollision = false;
async function rebuildCollision() {
  if (!splatMesh) return;
  if (isRebuildingCollision) return;
  isRebuildingCollision = true;
  try {
    if (collisionSettings.mode === "glb-trimesh") {
      setStatus("Collision mode is GLB → TriMesh. Upload a .glb for collision.");
      return;
    }
    setStatus(`Rebuilding collision… (quality ${collisionSettings.quality})`);
    await buildRapierVoxelColliderFromSplat(splatMesh);
    setStatus(`Physics ready. (F fly, G ghost)`);
  } finally {
    isRebuildingCollision = false;
  }
}

// Rebuild collision button removed - now always using GLB TriMesh

function teleportPlayerTo(x, y, z) {
  if (!playerBody) return;
  playerBody.setTranslation({ x, y, z }, true);
  playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
}

function findSpawnInsideFromVoxels() {
  if (!voxelGrid) return null;
  const { NX, NY, NZ, voxel, min, occ } = voxelGrid;
  const index = (x, y, z) => x + NX * (y + NY * z);

  // Try a few X/Z candidates near the center to find an empty vertical column with headroom.
  const candidates = [];
  const cx = Math.floor(NX / 2);
  const cz = Math.floor(NZ / 2);
  for (const dx of [0, 1, -1, 2, -2, 3, -3]) {
    for (const dz of [0, 1, -1, 2, -2, 3, -3]) {
      const x = cx + dx;
      const z = cz + dz;
      if (x <= 0 || x >= NX - 1 || z <= 0 || z >= NZ - 1) continue;
      candidates.push([x, z]);
    }
  }

  const headroom = PLAYER_HALF_HEIGHT * 2 + PLAYER_RADIUS * 2 + 0.15;
  const headCells = Math.max(3, Math.ceil(headroom / voxel));

  for (const [x, z] of candidates) {
    // Scan from top to bottom for the first empty stretch with enough headroom.
    for (let y = NY - 2; y >= 1; y--) {
      let ok = true;
      for (let k = 0; k < headCells; k++) {
        const yy = y + k;
        if (yy >= NY) break;
        if (occ[index(x, yy, z)] !== 0) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      // world position: center of cell, then put capsule slightly above
      const wx = min.x + (x + 0.5) * voxel;
      const wy = min.y + (y + 0.5) * voxel + PLAYER_HALF_HEIGHT;
      const wz = min.z + (z + 0.5) * voxel;
      return { x: wx, y: wy, z: wz };
    }
  }
  return null;
}


function findNearestEmptyVoxelNearWorldPos(pos) {
  if (!voxelGrid) return null;
  const { NX, NY, NZ, voxel, min, occ } = voxelGrid;
  const index = (x, y, z) => x + NX * (y + NY * z);

  const toCell = (v, minV, N) => Math.max(1, Math.min(N - 2, Math.floor((v - minV) / voxel)));

  const sx = toCell(pos.x, min.x, NX);
  const sy = toCell(pos.y, min.y, NY);
  const sz = toCell(pos.z, min.z, NZ);

  const headCells = Math.max(3, Math.ceil(1.8 / voxel));

  // BFS-ish search in expanding Manhattan shells.
  const maxR = 20;
  for (let r = 0; r <= maxR; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const x = sx + dx;
        const z = sz + dz;
        if (x <= 0 || x >= NX - 1 || z <= 0 || z >= NZ - 1) continue;

        // Scan vertically around current y (prefer staying same level).
        for (let dy = -r; dy <= r; dy++) {
          const y = Math.max(1, Math.min(NY - 2, sy + dy));
          let ok = true;
          for (let k = 0; k < headCells; k++) {
            const yy = y + k;
            if (yy >= NY) break;
            if (occ[index(x, yy, z)] !== 0) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          const wx = min.x + (x + 0.5) * voxel;
          const wy = min.y + (y + 0.5) * voxel + 0.8;
          const wz = min.z + (z + 0.5) * voxel;
          return { x: wx, y: wy, z: wz };
        }
      }
    }
  }
  return null;
}

function safeDisableGhost() {
  // If we're currently inside an occupied voxel, turning collisions back on will
  // trap the character (penetration state). Relocate to nearest empty cell first.
  if (!playerBody) return setGhostMode(false);
  const p = playerBody.translation();

  // 1) If we have a voxel grid, use it (fast + deterministic for splat-voxels mode).
  if (voxelGrid) {
    const safe = findNearestEmptyVoxelNearWorldPos({ x: p.x, y: p.y, z: p.z });
    if (safe) {
      teleportPlayerTo(safe.x, safe.y, safe.z);
      setGhostMode(false);
      setStatus("Ghost disabled (moved to nearest free space).");
      return;
    }
  }

  // 2) Otherwise (e.g. GLB TriMesh mode), use Rapier query pipeline to find a non-penetrating spot.
  if (rapierWorld && playerCollider) {
    try {
      const shape = playerCollider.shape;
      const rot = playerCollider.rotation();
      const here = { x: p.x, y: p.y, z: p.z };

      const intersectsHere = rapierWorld.queryPipeline.intersectionWithShape(
        rapierWorld.bodies,
        rapierWorld.colliders,
        here,
        rot,
        shape,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        playerCollider.handle
      );

      // If we're not intersecting anything solid, we can safely disable ghost immediately.
      if (intersectsHere == null) {
        setGhostMode(false);
        setStatus("Ghost disabled.");
        return;
      }

      const tryOffsets = (maxR, step) => {
        for (let r = step; r <= maxR; r += step) {
          // sample a handful of directions per radius
          const dirs = [
            [1, 0, 0],
            [-1, 0, 0],
            [0, 0, 1],
            [0, 0, -1],
            [1, 0, 1],
            [1, 0, -1],
            [-1, 0, 1],
            [-1, 0, -1],
            [0, 1, 0],
            [0, -1, 0],
          ];
          for (const [dx, dy, dz] of dirs) {
            const len = Math.hypot(dx, dy, dz) || 1;
            const pos = { x: p.x + (dx / len) * r, y: p.y + (dy / len) * r, z: p.z + (dz / len) * r };
            const hit = rapierWorld.queryPipeline.intersectionWithShape(
              rapierWorld.bodies,
              rapierWorld.colliders,
              pos,
              rot,
              shape,
              RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
              undefined,
              playerCollider.handle
            );
            if (hit == null) return pos;
          }
        }
        return null;
      };

      const pos = tryOffsets(2.5, 0.15);
      if (pos) {
        teleportPlayerTo(pos.x, pos.y, pos.z);
        setGhostMode(false);
        setStatus("Ghost disabled (moved to nearest free space).");
        return;
      }
    } catch {
      // ignore
    }
  }

  setStatus("Couldn't find free space to disable Ghost. Staying in Ghost mode.");
  setGhostMode(true);
}

window.addEventListener("keydown", (e) => {
  const tagName = e.target?.tagName?.toLowerCase?.();
  const isTyping =
    tagName === "input" || tagName === "textarea" || tagName === "select" || e.target?.isContentEditable;
  if (!isTyping) {
    if (e.code === "KeyM") {
      setAppMode(appMode === "edit" ? "sim" : "edit");
      e.preventDefault();
    }
    if (e.code === "KeyT") {
      beginTagAtAim();
      e.preventDefault();
    }
    if (appMode === "edit") {
      // Transform mode uses UI buttons (Move/Rotate/Scale) to avoid conflicts with WASD.
      if ((e.code === "Delete" || e.code === "Backspace") && !draftTag) {
        // Delete selected primitive
        if (selectedPrimitiveId) {
          deletePrimitive(selectedPrimitiveId);
          e.preventDefault();
          return;
        }
        // Delete selected light
        if (selectedLightId) {
          deleteEditorLight(selectedLightId);
          e.preventDefault();
          return;
        }
        // Delete selected asset
        if (selectedAssetId) {
          const a = getSelectedAsset();
          if (a) {
            // remove collider
            if (a._colliderHandle != null) {
              try {
                rapierWorld?.removeCollider?.(a._colliderHandle, true);
              } catch {}
            }
            // remove visual
            const obj = assetsGroup.getObjectByName(`asset:${a.id}`);
            if (obj?.parent) obj.parent.remove(obj);
            _assetBumpVelocities.delete(a.id);
            assets = assets.filter((x) => x.id !== a.id);
            selectedAssetId = null;
            transformControls?.detach();
            transformControls.visible = false;
            transformControls.enabled = false;
            saveTagsForWorld();
            renderAssetsList();
            setStatus("Asset deleted.");
            e.preventDefault();
            return;
          }
        }
      }
    }
    if (e.code === "KeyB") {
      void spawnOrMoveAiAtAim({ createNew: appMode === "edit", ephemeral: false }).then(() => {
        if (appMode === "edit" && aiAgents.length > 0) {
          selectAgentInspector(aiAgents[aiAgents.length - 1].id);
          setStatus("Agent spawned. Use Selected Agent task box on the right.");
        }
      });
      e.preventDefault();
    }
    if ((e.code === "Delete" || e.code === "Backspace") && appMode === "edit" && !draftTag) {
      deleteSelectedTag();
      e.preventDefault();
    }
  }
  if (e.code === "KeyW") keys.forward = true;
  if (e.code === "KeyS") keys.backward = true;
  if (e.code === "KeyA") keys.left = true;
  if (e.code === "KeyD") keys.right = true;
  if (e.code === "Space") keys.up = true;
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") keys.down = true;
  if (e.code === "KeyF") flyMode = !flyMode;
  if (e.code === "KeyG") {
    if (ghostMode) safeDisableGhost();
    else setGhostMode(true);
  }
  
  // === PLAYER INTERACTION KEYS ===
  // E key to interact with asset at crosshair
  if (e.code === "KeyE" && controls?.isLocked && !isTyping) {
    handlePlayerInteraction();
    e.preventDefault();
  }
  if (e.code === "KeyR" && controls?.isLocked && !isTyping && !isInteractionPopupVisible()) {
    if (cycleInteractableTarget(1)) {
      updatePlayerInteractionHint();
      e.preventDefault();
    }
  }
  
  // Escape to close interaction popup
  if (e.code === "Escape" && isInteractionPopupVisible()) {
    hideInteractionPopup();
    // Re-lock pointer after closing popup
    controls?.lock?.();
    e.preventDefault();
  }
  
  // Number keys 1-9 to select action when popup is visible
  if (isInteractionPopupVisible() && _currentInteractableAsset) {
    const numMatch = e.code.match(/^(?:Digit|Numpad)([1-9])$/);
    if (numMatch) {
      const idx = parseInt(numMatch[1], 10) - 1;
      const { asset, actions } = _currentInteractableAsset;
      if (idx >= 0 && idx < actions.length) {
        const actionId = actions[idx].id;
        
        // Hide popup and re-lock pointer FIRST (before async operations)
        hideInteractionPopup();
        
        // Execute the action
        if (actionId === "__PICK_UP__") {
          playerPickUpAsset(asset.id);
        } else {
          executePlayerInteraction(asset.id, actionId);
        }
        
        // Re-lock pointer (use setTimeout since pointer lock may need a moment)
        setTimeout(() => {
          try {
            controls?.lock?.();
          } catch (err) {
            // Pointer lock requires user gesture, may fail silently
          }
        }, 10);
        
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
  }
});

window.addEventListener("keyup", (e) => {
  if (e.code === "KeyW") keys.forward = false;
  if (e.code === "KeyS") keys.backward = false;
  if (e.code === "KeyA") keys.left = false;
  if (e.code === "KeyD") keys.right = false;
  if (e.code === "Space") keys.up = false;
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") keys.down = false;
});

// Optional reference ground (helps when no splat is loaded).
grid = new THREE.GridHelper(50, 50, 0x233043, 0x121722);
grid.position.y = 0;
grid.visible = shouldShowEditorGuides();
scene.add(grid);

// Shadow catcher: a large transparent ground plane that only shows shadows.
// ShadowMaterial is fully transparent where there's no shadow, so the splat
// floor shows through, but shadows appear as dark patches on top.
const shadowCatcherMat = new THREE.ShadowMaterial({ opacity: 0.35 });
const shadowCatcher = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  shadowCatcherMat
);
shadowCatcher.rotation.x = -Math.PI / 2; // lie flat
shadowCatcher.position.y = 0.001;         // just above grid to avoid z-fighting
shadowCatcher.receiveShadow = true;
shadowCatcher.name = "__shadowCatcher";
scene.add(shadowCatcher);
// Add to scene lights registry so it's controllable from the editor
sceneLights.push({ id: "_shadow_ground", label: "Shadow Ground", obj: shadowCatcher, type: "shadow_ground" });

function disposeSplat(mesh) {
  try {
    mesh?.dispose?.();
  } catch {
    // ignore
  }
  if (mesh?.parent) mesh.parent.remove(mesh);
}

async function createSplatMeshFromFile(file) {
  await ensureSparkLoaded();
  ensureSparkRendererAttached();
  const ext = file.name.toLowerCase().endsWith(".spz")
    ? "spz"
    : file.name.toLowerCase().endsWith(".ply")
      ? "ply"
      : null;
  if (!ext) throw new Error("Unsupported file. Please upload .ply or .spz");

  const bytes = new Uint8Array(await file.arrayBuffer());

  // SparkJS supports multiple loading styles. We try in this order:
  // 1) bytes-in-memory (best for uploads)
  // 2) static load(url) if present
  // 3) url constructor as fallback
  //
  // Docs refs:
  // - https://sparkjs.dev/docs/loading-splats/
  // - https://sparkjs.dev/docs/splat-mesh/
  //
  // (We keep this resilient to minor API differences across versions.)
  try {
    const mesh = new SplatMesh({ fileBytes: bytes, fileType: ext, fileName: file.name });
    // Wait until splats are actually constructed/parsed.
    if (mesh?.initialized) await mesh.initialized;
    return mesh;
  } catch {
    // fall through
  }

  const blobUrl = URL.createObjectURL(file);
  try {
    if (typeof SplatMesh.load === "function") {
      const mesh = await SplatMesh.load(blobUrl);
      if (mesh?.initialized) await mesh.initialized;
      return mesh;
    }
    const mesh = new SplatMesh({ url: blobUrl, fileType: ext, fileName: file.name });
    if (mesh?.initialized) await mesh.initialized;
    return mesh;
  } finally {
    // If Spark internally needs the URL for streaming, this would be too early.
    // But for blob URLs we typically load immediately; keep the URL around a bit.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
  }
}

function getSplatBounds(mesh) {
  // Prefer Spark’s own bounds if available; otherwise use THREE’s Box3.
  try {
    if (typeof mesh?.getBoundingBox === "function") {
      const b = mesh.getBoundingBox(true);
      if (b) return b;
    }
  } catch {
    // ignore
  }

  try {
    const box = new THREE.Box3().setFromObject(mesh);
    if (Number.isFinite(box.min.x) && Number.isFinite(box.max.x)) return box;
  } catch {
    // ignore
  }

  return null;
}

function frameToSplat(mesh) {
  const box = getSplatBounds(mesh);
  if (!box) return false;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5;

  // Put the player near the center, slightly above.
  controls.object.position.set(center.x, center.y + 1.7, center.z + radius * 1.2);

  // Rotate to look toward the center.
  camera.lookAt(center);

  // Scale far plane so big splats don’t clip.
  camera.far = Math.max(2000, radius * 20);
  camera.updateProjectionMatrix();

  return true;
}

fileInput?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  setWorldKey(file.name);
  setStatus(`Loading ${file.name}…`);

  try {
    const mesh = await createSplatMeshFromFile(file);
    disposeSplat(splatMesh);
    splatMesh = mesh;
    scene.add(splatMesh);
    isLoadedSplat = true;
    sparkNeedsUpdate = true;

    // Now that the mesh is initialized, framing should succeed immediately.
    frameToSplat(splatMesh);

    setStatus(`Loaded ${file.name}. Waiting for collision .glb…`);
    // Always use GLB TriMesh - wait for user to upload collision file
    if (collisionGLBScene) {
      await buildRapierTriMeshColliderFromGLB(collisionGLBScene);
      setStatus(`Loaded ${file.name}. Physics ready.`);
    }
  } catch (err) {
    console.error(err);
    setStatus(err?.message || "Failed to load splat.");
  }
});

// =============================================================================
// LOAD PRE-CONFIGURED WORLD
// =============================================================================
async function loadWorld(worldId) {
  const world = WORLDS_MANIFEST.find((w) => w.id === worldId);
  if (!world) {
    setStatus(`World "${worldId}" not found.`);
    return;
  }

  setStatus(`Loading ${world.name}…`);
  setWorldKey(world.id);

  try {
    // 1. Load splat file
    const splatUrl = `${world.folder}/${world.splatFile}`;
    setStatus(`Loading splats…`);
    const splatResp = await fetch(splatUrl);
    if (!splatResp.ok) throw new Error(`Failed to fetch ${splatUrl}`);
    const splatBlob = await splatResp.blob();
    const splatFile = new File([splatBlob], world.splatFile, { type: "application/octet-stream" });
    
    const mesh = await createSplatMeshFromFile(splatFile);
    disposeSplat(splatMesh);
    splatMesh = mesh;
    scene.add(splatMesh);
    isLoadedSplat = true;
    sparkNeedsUpdate = true;
    frameToSplat(splatMesh);

    // 2. Load collision GLB
    const colliderUrl = `${world.folder}/${world.colliderFile}`;
    setStatus(`Loading collision…`);
    const colliderResp = await fetch(colliderUrl);
    if (!colliderResp.ok) throw new Error(`Failed to fetch ${colliderUrl}`);
    const colliderBlob = await colliderResp.blob();
    
    const colliderUrl2 = URL.createObjectURL(colliderBlob);
    const gltf = await new Promise((resolve, reject) => {
      gltfLoader.load(colliderUrl2, resolve, undefined, reject);
    });
    URL.revokeObjectURL(colliderUrl2);
    
    collisionGLBScene = gltf.scene;
    await buildRapierTriMeshColliderFromGLB(collisionGLBScene);

    // 3. Load tags/assets from JSON file, then merge localStorage modifications
    setStatus(`Loading assets & tags…`);
    
    // Clear existing assets from scene first
    for (const a of assets) {
      const obj = assetsGroup.getObjectByName(`asset:${a.id}`);
      if (obj) assetsGroup.remove(obj);
      // Remove collider if exists
      if (a._colliderHandle && rapierWorld) {
        try {
          // _colliderHandle can be either a collider object or a handle number
          if (typeof a._colliderHandle === 'object' && a._colliderHandle.handle !== undefined) {
            rapierWorld.removeCollider(a._colliderHandle, true);
          } else if (typeof a._colliderHandle === 'number') {
            const collider = rapierWorld.getCollider(a._colliderHandle);
            if (collider) rapierWorld.removeCollider(collider, true);
          }
        } catch (e) {
          console.warn(`[CLEANUP] Failed to remove collider for ${a.id}:`, e);
        }
      }
    }
    
    // Also clear the _assetColliderHandles Map
    _assetColliderHandles.forEach((handle, assetId) => {
      try {
        if (typeof handle === 'object' && handle.handle !== undefined) {
          rapierWorld.removeCollider(handle, true);
        } else if (typeof handle === 'number') {
          const collider = rapierWorld.getCollider(handle);
          if (collider) rapierWorld.removeCollider(collider, true);
        }
      } catch (e) {}
    });
    _assetColliderHandles.clear();
    
    // Clean up primitive colliders BEFORE clearing the array
    for (const p of primitives) {
      if (p._colliderHandle != null && rapierWorld) {
        try {
          if (typeof p._colliderHandle === 'object' && p._colliderHandle.handle !== undefined) {
            rapierWorld.removeCollider(p._colliderHandle, true);
          }
        } catch (e) {
          console.warn(`[CLEANUP] Failed to remove primitive collider for ${p.id}:`, e);
        }
        p._colliderHandle = null;
      }
    }
    
    assets = [];
    tags = [];
    primitives = [];
    editorLights = [];
    
    // Clear existing primitives from scene (visuals only – colliders already removed above)
    while (primitivesGroup.children.length) {
      const c = primitivesGroup.children[0];
      c.geometry?.dispose();
      disposePrimitiveMaterial(c.material);
      primitivesGroup.remove(c);
    }
    // Clear existing editor lights from scene
    while (lightsGroup.children.length) {
      const c = lightsGroup.children[0];
      c.traverse?.((m) => { m.geometry?.dispose(); m.material?.dispose(); });
      lightsGroup.remove(c);
    }
    
    // Load localStorage modifications (deltas + portals)
    let storedDeltas = {};  // Map of assetId -> delta data
    let storedPortals = []; // Full portal assets
    let storedTags = null;
    let storedPrimitives = null;
    let storedLights = null;
    let storedGroups = null;
    
    try {
      const rawState = localStorage.getItem("sparkWorldStateByWorld");
      const byWorld = rawState ? JSON.parse(rawState) : {};
      const storedState = byWorld[world.id];
      
      if (storedState && typeof storedState === "object") {
        if (Array.isArray(storedState.tags)) {
          storedTags = storedState.tags;
        }
        if (Array.isArray(storedState.primitives)) {
          storedPrimitives = storedState.primitives;
        }
        if (Array.isArray(storedState.lights)) {
          storedLights = storedState.lights;
        }
        if (Array.isArray(storedState.groups)) {
          storedGroups = storedState.groups;
        }
        if (Array.isArray(storedState.assets)) {
          for (const stored of storedState.assets) {
            if (stored.isPortal) {
              storedPortals.push(stored);
            } else if (stored._deltaOnly) {
              storedDeltas[stored.id] = stored;
            }
          }
        }
        console.log(`[WORLD] Found localStorage data: ${storedPortals.length} portals, ${Object.keys(storedDeltas).length} asset deltas`);
      }
    } catch (e) {
      console.warn("Failed to load from localStorage:", e);
    }
    
    // Always load base data from JSON file
    const dataUrl = `${world.folder}/${world.dataFile}`;
    const dataResp = await fetch(dataUrl);
    if (dataResp.ok) {
      const data = await dataResp.json();
      
      // Import tags (use stored if available, otherwise from JSON)
      if (storedTags) {
        tags = storedTags;
      } else if (Array.isArray(data.tags)) {
        tags = data.tags.map((t) => ({
          id: t.id ?? crypto.randomUUID(),
          title: t.title ?? "",
          notes: t.notes ?? "",
          position: t.position ?? { x: 0, y: 0, z: 0 },
          radius: t.radius ?? 1,
        }));
      }
      
      // Import assets from JSON, applying localStorage deltas
      if (Array.isArray(data.assets)) {
        for (const rawAsset of data.assets) {
          const asset = normalizeAssetSchema(rawAsset);
          
          // Apply localStorage delta if exists
          const delta = storedDeltas[asset.id];
          if (delta) {
            if (delta.currentStateId) asset.currentStateId = delta.currentStateId;
            if (delta.transform) asset.transform = delta.transform;
            if (delta.pickable !== undefined) asset.pickable = delta.pickable;
            if (delta.castShadow !== undefined) asset.castShadow = delta.castShadow;
            if (delta.receiveShadow !== undefined) asset.receiveShadow = delta.receiveShadow;
            if (delta.blobShadow) asset.blobShadow = delta.blobShadow;
            console.log(`[WORLD] Applied delta to asset: ${asset.id}`);
          }
          
          assets.push(asset);
          try {
            await instantiateAsset(asset);
          } catch (err) {
            console.warn(`Failed to instantiate asset ${asset.id}:`, err);
          }
        }
      }
      console.log(`[WORLD] Loaded ${assets.length} assets from JSON for ${world.id}`);
      
      // Load primitives from JSON if not already loaded from localStorage
      if (!storedPrimitives && Array.isArray(data.primitives)) {
        primitives = data.primitives;
      }
      // Load lights from JSON if not already loaded from localStorage
      if (!storedLights && Array.isArray(data.lights)) {
        editorLights = data.lights;
      }
    }
    
    // Add portals from localStorage (they're not in the JSON file)
    for (const portalData of storedPortals) {
      const portal = normalizeAssetSchema(portalData);
      console.log(`[WORLD] Adding portal from localStorage: ${portal.id} → ${portal.destinationWorld}`);
      assets.push(portal);
      try {
        await instantiateAsset(portal);
      } catch (err) {
        console.warn(`Failed to instantiate portal ${portal.id}:`, err);
      }
    }
    
    if (storedPortals.length > 0) {
      console.log(`[WORLD] ✓ Added ${storedPortals.length} portals from localStorage`);
    }

    // Load primitives (from localStorage first, fall back to stored)
    if (storedPrimitives) {
      primitives = storedPrimitives;
    }
    for (const p of primitives) {
      try { instantiatePrimitive(p); } catch (err) {
        console.warn(`Failed to instantiate primitive ${p.id}:`, err);
      }
    }
    console.log(`[WORLD] Loaded ${primitives.length} primitives`);

    // Load editor lights (from localStorage first, fall back to stored)
    if (storedLights) {
      editorLights = storedLights;
    }
    for (const ld of editorLights) {
      ld._lightObj = null;
      ld._helperObj = null;
      ld._proxyObj = null;
      try { instantiateEditorLight(ld); } catch (err) {
        console.warn(`Failed to instantiate light ${ld.id}:`, err);
      }
    }
    console.log(`[WORLD] Loaded ${editorLights.length} editor lights`);

    // Load groups (from localStorage first, fall back to JSON data)
    if (storedGroups) {
      groups = storedGroups;
    } else if (Array.isArray(data?.groups)) {
      groups = data.groups;
    } else {
      groups = [];
    }
    console.log(`[WORLD] Loaded ${groups.length} groups`);

    renderTagsList();
    renderAssetsList();
    renderPrimitivesList();
    renderLightsList();
    // Clear selections
    selectedTagId = null;
    draftTag = null;
    selectedPrimitiveId = null;
    selectedLightId = null;
    selectedGroupId = null;
    selectAsset(null);
    renderPrimitiveProps();
    renderLightProps();
    rebuildTagMarkers();
    
    // Restore any pending portal links for portals in this world
    restorePortalLinks();

    // Enable shadow map if any imported light casts shadows
    syncShadowMapEnabled();

    setStatus(`✓ ${world.name} loaded`);
  } catch (err) {
    console.error("Failed to load world:", err);
    setStatus(`Error: ${err.message}`);
  }
}

// Hook up world selector UI
worldLoadBtn?.addEventListener("click", () => {
  const worldId = worldSelectEl?.value;
  if (worldId) loadWorld(worldId);
});

// Double-click to load
worldSelectEl?.addEventListener("dblclick", () => {
  const worldId = worldSelectEl?.value;
  if (worldId) loadWorld(worldId);
});

window.addEventListener("resize", () => {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  resizeRgbdTargets();
  rgbdMetricMaterial.uniforms.uNear.value = camera.near;
  rgbdMetricMaterial.uniforms.uFar.value = camera.far;
});

const clock = new THREE.Clock();

function renderSceneInMode(mode) {
  const savedOverride = scene.overrideMaterial;
  const savedBg = scene.background;
  const savedSplat = splatMesh ? splatMesh.visible : false;
  const savedSpark = sparkRendererMesh ? sparkRendererMesh.visible : false;
  const savedAssets = assetsGroup.visible;
  const savedPrims = primitivesGroup.visible;
  const savedLights = lightsGroup.visible;
  const savedTags = tagsGroup.visible;
  const savedLidar = lidarVizGroup.visible;
  const savedOverlay = rgbdPcOverlayGroup.visible;

  if (mode === "rgb") {
    scene.overrideMaterial = null;
    if (splatMesh) splatMesh.visible = true;
    if (sparkRendererMesh) sparkRendererMesh.visible = true;
    assetsGroup.visible = true;
    primitivesGroup.visible = true;
    lightsGroup.visible = true;
    tagsGroup.visible = false;
    lidarVizGroup.visible = false;
    rgbdPcOverlayGroup.visible = false;
    scene.background = DEFAULT_SCENE_BG;
    renderer.render(scene, camera);
  } else if (mode === "lidar") {
    scene.overrideMaterial = null;
    if (splatMesh) splatMesh.visible = false;
    if (sparkRendererMesh) sparkRendererMesh.visible = false;
    assetsGroup.visible = false;
    primitivesGroup.visible = false;
    lightsGroup.visible = false;
    tagsGroup.visible = false;
    lidarVizGroup.visible = true;
    rgbdPcOverlayGroup.visible = rgbdPcOverlayOnLidar && _rgbdPcOverlayLastCount > 0;
    scene.background = RGBD_BG;
    renderer.render(scene, camera);
  }

  scene.overrideMaterial = savedOverride;
  scene.background = savedBg;
  if (splatMesh) splatMesh.visible = savedSplat;
  if (sparkRendererMesh) sparkRendererMesh.visible = savedSpark;
  assetsGroup.visible = savedAssets;
  primitivesGroup.visible = savedPrims;
  lightsGroup.visible = savedLights;
  tagsGroup.visible = savedTags;
  lidarVizGroup.visible = savedLidar;
  rgbdPcOverlayGroup.visible = savedOverlay;
}

function renderCompareViews() {
  // Panel is auto-collapsed in compare mode, so we use the FULL viewport.
  // IMPORTANT: Three.js setViewport/setScissor expect CSS pixel values, NOT
  // framebuffer pixels. Three.js internally multiplies by devicePixelRatio.
  const sz = renderer.getSize(new THREE.Vector2()); // CSS pixels
  const W = sz.x;
  const H = sz.y;
  const halfW = Math.floor(W / 2);
  const halfH = Math.floor(H / 2);

  renderer.setScissorTest(true);
  renderer.autoClear = false;

  // Clear entire canvas to black first.
  renderer.setViewport(0, 0, W, H);
  renderer.setScissor(0, 0, W, H);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, true, true);

  // --- Top-left: RGB (Three.js y=0 is bottom, so "top" = halfH) ---
  renderer.setViewport(0, halfH, halfW, halfH);
  renderer.setScissor(0, halfH, halfW, halfH);
  renderer.setClearColor(DEFAULT_SCENE_BG, 1);
  renderer.clear(true, true, true);
  renderSceneInMode("rgb");

  // --- Top-right: RGB-D ---
  // Offscreen metric depth passes change render targets and clobber viewport,
  // so we must re-set viewport/scissor afterward.
  renderRgbdMetricPassOffscreen();
  rgbdVizMaterial.uniforms.uGrayMode.value = rgbdVizMode === "gray" ? 1.0 : 0.0;
  renderer.setRenderTarget(null);
  renderer.setViewport(halfW, halfH, W - halfW, halfH);
  renderer.setScissor(halfW, halfH, W - halfW, halfH);
  renderer.setClearColor(RGBD_BG, 1);
  renderer.clear(true, true, true);
  renderer.render(rgbdVizScene, rgbdPostCamera);

  // --- Bottom-center: LiDAR ---
  const lidarX = Math.floor((W - halfW) / 2);
  renderer.setViewport(lidarX, 0, halfW, halfH);
  renderer.setScissor(lidarX, 0, halfW, halfH);
  renderer.setClearColor(RGBD_BG, 1);
  renderer.clear(true, true, true);
  renderSceneInMode("lidar");

  renderer.setScissorTest(false);
  renderer.autoClear = true;
  renderer.setViewport(0, 0, W, H);
  renderer.setScissor(0, 0, W, H);
}

function renderActiveView() {
  // Safety guard: ensure shadow sampler budget before any render call.
  // Prevents startup/frame-time shader validation failures on heavy scenes.
  syncShadowMapEnabled();
  if (simCompareView && appMode === "sim") {
    renderCompareViews();
  } else if (simSensorViewMode === "rgbd" && appMode === "sim") {
    renderRgbdView();
  } else {
    renderer.render(scene, camera);
  }
}

async function ensureRapierLoaded() {
  if (RAPIER) return;
  // Guard against concurrent calls: all callers share the same init promise
  if (!_rapierInitPromise) {
    _rapierInitPromise = _doRapierInit();
  }
  return _rapierInitPromise;
}

async function _doRapierInit() {
  // Important: use the package's own init() so its internal WASM bindings get wired up correctly.
  RAPIER = await import("@dimforge/rapier3d-compat");
  await RAPIER.init();
  rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  worldBody = rapierWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());

  // Player body
  const radius = PLAYER_RADIUS;
  const halfHeight = PLAYER_HALF_HEIGHT;
  playerBody = rapierWorld.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 3, 0)
  );
  playerCollider = rapierWorld.createCollider(
    RAPIER.ColliderDesc.capsule(halfHeight, radius).setFriction(0.0),
    playerBody
  );

  characterController = rapierWorld.createCharacterController(0.02);
  characterController.setSlideEnabled(true);
  characterController.enableAutostep(0.55, 0.25, true);
  characterController.enableSnapToGround(0.25);
  characterController.setMaxSlopeClimbAngle(Math.PI / 3);
  characterController.setMinSlopeSlideAngle(Math.PI / 2);
}

async function buildRapierTriMeshColliderFromGLB(gltfScene) {
  await ensureRapierLoaded();

  // Remove voxel colliders if present.
  if (worldBody?.__voxelColliders) {
    for (const c of worldBody.__voxelColliders) rapierWorld.removeCollider(c, true);
    worldBody.__voxelColliders = [];
  }
  voxelGrid = null;

  // Remove old trimesh collider if present.
  if (worldTriMeshCollider) {
    rapierWorld.removeCollider(worldTriMeshCollider, true);
    worldTriMeshCollider = null;
  }

  const verts = [];
  const indices = [];
  let vertBase = 0;
  const tmpPos = new THREE.Vector3();

  gltfScene.updateMatrixWorld(true);
  gltfScene.traverse((obj) => {
    if (!obj.isMesh) return;
    const geom = obj.geometry;
    if (!geom) return;
    const posAttr = geom.attributes?.position;
    if (!posAttr) return;
    const indexAttr = geom.index;
    const matWorld = obj.matrixWorld;

    for (let i = 0; i < posAttr.count; i++) {
      tmpPos.fromBufferAttribute(posAttr, i).applyMatrix4(matWorld);
      verts.push(tmpPos.x, tmpPos.y, tmpPos.z);
    }

    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i++) indices.push(indexAttr.getX(i) + vertBase);
    } else {
      for (let i = 0; i < posAttr.count; i++) indices.push(vertBase + i);
    }
    vertBase += posAttr.count;
  });

  if (verts.length === 0 || indices.length < 3) {
    setStatus("GLB had no mesh geometry for collision.");
    return;
  }

  setStatus(`Building GLB TriMesh collider… (verts=${verts.length / 3}, tris=${indices.length / 3})`);
  const desc = RAPIER.ColliderDesc.trimesh(verts, indices).setFriction(0.8);
  worldTriMeshCollider = rapierWorld.createCollider(desc);

  const box = new THREE.Box3().setFromObject(gltfScene);
  const c = box.getCenter(new THREE.Vector3());
  teleportPlayerTo(c.x, box.max.y + 2.0, c.z);
  setGhostMode(true);
  setStatus("GLB TriMesh collider ready. Spawned near center (ghost ON). Press G to disable ghost.");
}

let collisionGLBScene = null;
collisionGlbInputEl?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  setCollisionMode("glb-trimesh");
  try {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    const url = URL.createObjectURL(file);
    const gltf = await new Promise((resolve, reject) => {
      loader.load(url, (g) => resolve(g), undefined, (err) => reject(err));
    });
    URL.revokeObjectURL(url);
    collisionGLBScene = gltf.scene;
    await buildRapierTriMeshColliderFromGLB(collisionGLBScene);
  } catch (err) {
    console.error(err);
    setStatus(err?.message || "Failed to load GLB for collision.");
  }
});

async function buildRapierVoxelColliderFromSplat(mesh) {
  await ensureRapierLoaded();

  if (typeof mesh.forEachSplat !== "function") {
    setStatus("SplatMesh.forEachSplat unavailable; cannot build collider.");
    return;
  }

  const box = getSplatBounds(mesh);
  if (!box) return;

  const min = box.min.clone();
  const max = box.max.clone();
  const size = box.getSize(new THREE.Vector3());

  // Collision Quality slider mapping:
  // - Higher quality => smaller voxels + thicker ellipsoids + more dilation.
  const q = collisionSettings.quality / 100;
  const voxelMin = 0.04;
  const voxelMax = 0.22;
  let voxel = voxelMax + (voxelMin - voxelMax) * q;

  const maxDim = 200;
  voxel = Math.max(voxel, size.x / maxDim, size.y / maxDim, size.z / maxDim);
  voxel = Math.min(Math.max(voxel, voxelMin), voxelMax);

  const nx = Math.max(2, Math.ceil(size.x / voxel));
  const ny = Math.max(2, Math.ceil(size.y / voxel));
  const nz = Math.max(2, Math.ceil(size.z / voxel));

  const total = nx * ny * nz;
  if (total > 8_000_000) {
    voxel = Math.max(voxel, Math.cbrt((size.x * size.y * size.z) / 8_000_000));
  }

  const NX = Math.max(2, Math.ceil(size.x / voxel));
  const NY = Math.max(2, Math.ceil(size.y / voxel));
  const NZ = Math.max(2, Math.ceil(size.z / voxel));

  const occ = new Uint8Array(NX * NY * NZ);

  setStatus(`Voxelizing splat…`);

  // Voxelize splats as oriented ellipsoids for consistent wall collision.
  // Each splat is rendered as a Gaussian; for collision we treat it as an ellipsoid
  // at ~N standard deviations to create a reasonably "solid" surface.
  const STD = 2.0 + 4.0 * q; // 2.0..6.0 (high quality aggressively seals gaps)
  const invQ = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const d = new THREE.Vector3();
  const local = new THREE.Vector3();

  // Apply SplatMesh world transform to collider generation so voxels line up with rendered splats.
  mesh.updateMatrixWorld(true);
  const meshWorldQuat = new THREE.Quaternion();
  const meshWorldPos = new THREE.Vector3();
  const meshWorldScale = new THREE.Vector3();
  mesh.matrixWorld.decompose(meshWorldPos, meshWorldQuat, meshWorldScale);
  const worldCenter = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();

  const idxOf = (x, y, z) => x + NX * (y + NY * z);
  const markCell = (x, y, z) => {
    if (x < 0 || x >= NX || y < 0 || y >= NY || z < 0 || z >= NZ) return;
    occ[idxOf(x, y, z)] = 1;
  };

  mesh.forEachSplat((i, center, scales, quat, opacity, color) => {
    if (opacity < 0.02) return;

    // Transform splat center/orientation into world space.
    worldCenter.copy(center).applyMatrix4(mesh.matrixWorld);
    worldQuat.copy(meshWorldQuat).multiply(quat);

    // Effective radii in world units.
    const rx = Math.max(scales.x * meshWorldScale.x * STD, voxel * 0.6);
    const ry = Math.max(scales.y * meshWorldScale.y * STD, voxel * 0.6);
    const rz = Math.max(scales.z * meshWorldScale.z * STD, voxel * 0.6);

    // Two-sided collision: many splat captures only contain splats on ONE side of a wall.
    // If we voxelize only around the splat center, collision works from outside but can be
    // missing from inside. We approximate a wall normal as the axis with the smallest scale,
    // then voxelize a few centers offset along +/- normal to make collision bidirectional.
    const sx = Math.abs(scales.x * meshWorldScale.x);
    const sy = Math.abs(scales.y * meshWorldScale.y);
    const sz = Math.abs(scales.z * meshWorldScale.z);
    const minAxis = sx <= sy && sx <= sz ? 0 : sy <= sx && sy <= sz ? 1 : 2;
    const normalLocal =
      minAxis === 0 ? new THREE.Vector3(1, 0, 0) : minAxis === 1 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    const normalWorld = normalLocal.applyQuaternion(worldQuat).normalize();

    // Extrusion distance grows with quality. Clamp to avoid huge thickening.
    const extrude = Math.min(0.6, Math.max(voxel * 2.5, 0.05 + 0.45 * q));
    const centers = [
      worldCenter,
      worldCenter.clone().addScaledVector(normalWorld, extrude),
      worldCenter.clone().addScaledVector(normalWorld, -extrude),
    ];

    // Precompute inverse rotation
    invQ.copy(worldQuat).invert();
    const invRx2 = 1 / (rx * rx);
    const invRy2 = 1 / (ry * ry);
    const invRz2 = 1 / (rz * rz);
    const rMax = Math.max(rx, ry, rz);

    for (const c0 of centers) {
      // If the ellipsoid is smaller than a voxel, just mark the center cell.
      if (rx < voxel && ry < voxel && rz < voxel) {
        const x = Math.floor((c0.x - min.x) / voxel);
        const y = Math.floor((c0.y - min.y) / voxel);
        const z = Math.floor((c0.z - min.z) / voxel);
        markCell(x, y, z);
        continue;
      }

      const x0 = Math.floor((c0.x - rMax - min.x) / voxel);
      const x1 = Math.ceil((c0.x + rMax - min.x) / voxel);
      const y0 = Math.floor((c0.y - rMax - min.y) / voxel);
      const y1 = Math.ceil((c0.y + rMax - min.y) / voxel);
      const z0 = Math.floor((c0.z - rMax - min.z) / voxel);
      const z1 = Math.ceil((c0.z + rMax - min.z) / voxel);

      for (let z = z0; z <= z1; z++) {
        if (z < 0 || z >= NZ) continue;
        const wz = min.z + (z + 0.5) * voxel;
        for (let y = y0; y <= y1; y++) {
          if (y < 0 || y >= NY) continue;
          const wy = min.y + (y + 0.5) * voxel;
          for (let x = x0; x <= x1; x++) {
            if (x < 0 || x >= NX) continue;
            const wx = min.x + (x + 0.5) * voxel;

            d.set(wx - c0.x, wy - c0.y, wz - c0.z);
            local.copy(d).applyQuaternion(invQ);
            const v =
              local.x * local.x * invRx2 +
              local.y * local.y * invRy2 +
              local.z * local.z * invRz2;
            if (v <= 1.0) occ[idxOf(x, y, z)] = 1;
          }
        }
      }
    }
  });

  // Simple dilation to thicken walls
  const dilateIters = Math.max(2, Math.min(7, Math.round(2 + 5 * q)));
  for (let iter = 0; iter < dilateIters; iter++) {
    const next = occ.slice();
    for (let z = 1; z < NZ - 1; z++) {
      for (let y = 1; y < NY - 1; y++) {
        for (let x = 1; x < NX - 1; x++) {
          const idx = x + NX * (y + NY * z);
          if (occ[idx]) continue;
          // 26-neighborhood dilation (fills diagonal gaps too; better sealing)
          let filled = false;
          for (let dz = -1; dz <= 1 && !filled; dz++) {
            for (let dy = -1; dy <= 1 && !filled; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0 && dz === 0) continue;
                const ii = idx + dx + NX * (dy + NY * dz);
                if (occ[ii]) {
                  filled = true;
                  break;
                }
              }
            }
          }
          if (filled) next[idx] = 1;
        }
      }
    }
    occ.set(next);
  }

  setStatus(`Meshing voxels…`);

  // Save voxel grid for later "teleport inside" logic.
  voxelGrid = { NX, NY, NZ, voxel, min, occ };

  // Remove previous colliders
  if (worldBody.__voxelColliders) {
    for (const c of worldBody.__voxelColliders) rapierWorld.removeCollider(c, true);
  }
  worldBody.__voxelColliders = [];
  if (worldTriMeshCollider) {
    rapierWorld.removeCollider(worldTriMeshCollider, true);
    worldTriMeshCollider = null;
  }

  const visited = new Uint8Array(occ.length);
  const maxColliders = 6000;
  let colliderCount = 0;
  const index = (x, y, z) => x + NX * (y + NY * z);

  for (let z = 0; z < NZ && colliderCount < maxColliders; z++) {
    for (let y = 0; y < NY && colliderCount < maxColliders; y++) {
      for (let x = 0; x < NX && colliderCount < maxColliders; x++) {
        const i0 = index(x, y, z);
        if (!occ[i0] || visited[i0]) continue;

        // expand X
        let x1 = x;
        while (x1 + 1 < NX && occ[index(x1 + 1, y, z)] && !visited[index(x1 + 1, y, z)]) x1++;
        // expand Z
        let z1 = z;
        outerZ: while (z1 + 1 < NZ) {
          for (let xx = x; xx <= x1; xx++) {
            if (!occ[index(xx, y, z1 + 1)] || visited[index(xx, y, z1 + 1)]) break outerZ;
          }
          z1++;
        }
        // expand Y
        let y1 = y;
        outerY: while (y1 + 1 < NY) {
          for (let zz = z; zz <= z1; zz++) {
            for (let xx = x; xx <= x1; xx++) {
              if (!occ[index(xx, y1 + 1, zz)] || visited[index(xx, y1 + 1, zz)]) break outerY;
            }
          }
          y1++;
        }

        // mark visited
        for (let yy = y; yy <= y1; yy++) {
          for (let zz = z; zz <= z1; zz++) {
            for (let xx = x; xx <= x1; xx++) {
              visited[index(xx, yy, zz)] = 1;
            }
          }
        }

        // create cuboid collider
        const sx = (x1 - x + 1) * voxel;
        const sy = (y1 - y + 1) * voxel;
        const sz = (z1 - z + 1) * voxel;
        const cx = min.x + x * voxel + sx / 2;
        const cy = min.y + y * voxel + sy / 2;
        const cz = min.z + z * voxel + sz / 2;

        const desc = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
          .setTranslation(cx, cy, cz)
          .setFriction(0.8);
        const c = rapierWorld.createCollider(desc);
        worldBody.__voxelColliders.push(c);
        colliderCount++;
      }
    }
    await new Promise((r) => requestAnimationFrame(r));
  }

  setStatus(`Collider ready (${colliderCount} boxes). Fly: ${flyMode ? "ON" : "OFF"} (F toggles).`);

  // Spawn player: try inside first (ghost enabled so we don't get stuck), else above the top.
  setGhostMode(true);
  const inside = findSpawnInsideFromVoxels();
  if (inside) {
    teleportPlayerTo(inside.x, inside.y, inside.z);
    setStatus(`Collider ready (${colliderCount} boxes). Spawned inside (ghost ON). Press G to disable ghost.`);
  } else {
    teleportPlayerTo((min.x + max.x) / 2, max.y + 2.5, (min.z + max.z) / 2);
  }
}

function _hasBumpableAssets() {
  for (const a of assets) { if (a?.bumpable) return true; }
  return false;
}

function updateBumpableAssets(dt, playerPos, agentPushers = []) {
  if (currentWorkspace !== "scene" || !playerPos || !_hasBumpableAssets()) {
    _playerPosPrevForBumpValid = false;
    return;
  }
  if (!_playerPosPrevForBumpValid) {
    _playerPosPrevForBump.copy(playerPos);
    _playerPosPrevForBumpValid = true;
    return;
  }
  const playerVel = new THREE.Vector3().subVectors(playerPos, _playerPosPrevForBump).divideScalar(Math.max(dt, 1e-3));
  _playerPosPrevForBump.copy(playerPos);
  const speedXZ = Math.hypot(playerVel.x, playerVel.z);
  const playerCanPush = !ghostMode;
  const intent = new THREE.Vector3();
  const camForward = new THREE.Vector3();
  camera.getWorldDirection(camForward);
  camForward.y = 0;
  if (camForward.lengthSq() > 1e-6) camForward.normalize();
  const camRight = new THREE.Vector3().crossVectors(camForward, camera.up).normalize();
  if (keys.forward) intent.add(camForward);
  if (keys.backward) intent.sub(camForward);
  if (keys.right) intent.add(camRight);
  if (keys.left) intent.sub(camRight);
  if (intent.lengthSq() > 1e-6) intent.normalize();
  const intentPush = playerCanPush && intent.lengthSq() > 0;
  const pushDir = intentPush ? intent.clone() : new THREE.Vector3(playerVel.x, 0, playerVel.z);
  if (pushDir.lengthSq() > 1e-6) pushDir.normalize();
  const playerRadius = 0.35;
  const pushThreshold = 0.05;
  let anyMoved = false;
  let anyColliderNeedsSync = false;
  for (const a of assets) {
    if (!a?.bumpable) continue;
    const obj = assetsGroup.getObjectByName(`asset:${a.id}`);
    if (!obj) continue;
    const vel = _assetBumpVelocities.get(a.id) || new THREE.Vector3();
    const localCenter = obj.userData?._localSphereCenter || new THREE.Vector3();
    const worldCenter = localCenter.clone();
    obj.localToWorld(worldCenter);
    const worldRadius = (obj.userData?._localSphereRadius || 0.6) * Math.max(obj.scale.x, obj.scale.y, obj.scale.z);
    const dx = worldCenter.x - playerPos.x;
    const dz = worldCenter.z - playerPos.z;
    const dist = Math.hypot(dx, dz);
    const minDist = worldRadius + playerRadius;
    const ahead = pushDir.lengthSq() > 0 ? (dx * pushDir.x + dz * pushDir.z) : 0;
    const lateral = pushDir.lengthSq() > 0 ? Math.abs(dx * -pushDir.z + dz * pushDir.x) : dist;
    const inPushCone = intentPush && ahead > -0.05 && ahead < (minDist + 0.9) && lateral < (worldRadius + 0.55);
    if (playerCanPush && (dist < (minDist + 0.35) || inPushCone) && (speedXZ > pushThreshold || intentPush)) {
      const dirX = dist > 1e-3 ? dx / dist : (intentPush ? pushDir.x : (Math.sign(playerVel.x) || 1));
      const dirZ = dist > 1e-3 ? dz / dist : (intentPush ? pushDir.z : (Math.sign(playerVel.z) || 0));
      const penetration = minDist - dist;
      const response = Number(a.bumpResponse) || 0.9;
      const driveSpeed = Math.max(speedXZ, intentPush ? 1.4 : 0);
      const intentBonus = inPushCone ? 0.35 : 0;
      const impulse = Math.min(2.4, (Math.max(0, penetration) * 3 + driveSpeed * 0.35 + intentBonus) * response);
      vel.x += dirX * impulse;
      vel.z += dirZ * impulse;
    }
    // AI agents can push bumpable assets as well.
    for (const ap of agentPushers) {
      const apPos = ap?.pos;
      const apVel = ap?.vel;
      if (!apPos || !apVel) continue;
      const av = Math.hypot(apVel.x || 0, apVel.z || 0);
      if (av <= 0.04) continue;
      const adx = worldCenter.x - apPos.x;
      const adz = worldCenter.z - apPos.z;
      const adist = Math.hypot(adx, adz);
      const aminDist = worldRadius + Math.max(0.22, Number(ap.radius) || 0.22);
      if (adist > aminDist + 0.3) continue;
      const dirX = adist > 1e-3 ? adx / adist : (Math.sign(apVel.x) || 1);
      const dirZ = adist > 1e-3 ? adz / adist : (Math.sign(apVel.z) || 0);
      const penetration = aminDist - adist;
      const response = Number(a.bumpResponse) || 0.9;
      const impulse = Math.min(2.2, (Math.max(0, penetration) * 2.4 + av * 0.28) * response);
      vel.x += dirX * impulse;
      vel.z += dirZ * impulse;
    }
    const damping = Math.min(0.995, Math.max(0.65, Number(a.bumpDamping) || 0.9));
    const dampPow = Math.pow(damping, dt * 60);
    vel.multiplyScalar(dampPow);
    const maxSpeed = 2.5;
    const speed = Math.hypot(vel.x, vel.z);
    if (speed > maxSpeed) {
      const s = maxSpeed / speed;
      vel.x *= s;
      vel.z *= s;
    }
    if (vel.lengthSq() < 1e-4) {
      vel.set(0, 0, 0);
      _assetBumpVelocities.set(a.id, vel);
      continue;
    }
    let moveX = THREE.MathUtils.clamp(vel.x * dt, -0.2, 0.2);
    let moveZ = THREE.MathUtils.clamp(vel.z * dt, -0.2, 0.2);
    const myBox = new THREE.Box3().setFromObject(obj);
    const testBoxX = myBox.clone().translate(new THREE.Vector3(moveX, 0, 0));
    const testBoxZ = myBox.clone().translate(new THREE.Vector3(0, 0, moveZ));
    let blockedX = false, blockedZ = false;
    const checkCollision = (testBox, excludeObj) => {
      for (const child of primitivesGroup.children) {
        if (child === excludeObj) continue;
        const cb = new THREE.Box3().setFromObject(child);
        if (!cb.isEmpty() && testBox.intersectsBox(cb)) return true;
      }
      for (const child of assetsGroup.children) {
        if (child === excludeObj) continue;
        if (child.userData?.isBlobShadow) continue;
        const cb = new THREE.Box3().setFromObject(child);
        if (!cb.isEmpty() && testBox.intersectsBox(cb)) return true;
      }
      return false;
    };
    if (Math.abs(moveX) > 1e-5 && checkCollision(testBoxX, obj)) {
      blockedX = true;
      vel.x *= -0.15;
    }
    if (Math.abs(moveZ) > 1e-5 && checkCollision(testBoxZ, obj)) {
      blockedZ = true;
      vel.z *= -0.15;
    }
    if (!blockedX) obj.position.x += moveX;
    if (!blockedZ) obj.position.z += moveZ;
    if (blockedX && blockedZ) {
      _assetBumpVelocities.set(a.id, vel);
      continue;
    }
    anyMoved = true;
    anyColliderNeedsSync = true;
    if (!a.transform) a.transform = {};
    if (!a.transform.position) a.transform.position = { x: 0, y: 0, z: 0 };
    a.transform.position.x = obj.position.x;
    a.transform.position.z = obj.position.z;
    _assetBumpVelocities.set(a.id, vel);
  }
  if (anyMoved) {
    const now = performance.now();
    if (now - _lastBumpSaveAt > 500) {
      _lastBumpSaveAt = now;
      saveTagsForWorld();
    }
    if (anyColliderNeedsSync && now - _lastBumpColliderSyncAt > 50) {
      _lastBumpColliderSyncAt = now;
      for (const a of assets) {
        if (!a?.bumpable) continue;
        if (!_assetBumpVelocities.has(a.id)) continue;
        const v = _assetBumpVelocities.get(a.id);
        if (!v || v.lengthSq() < 1e-4) continue;
        rebuildAssetCollider(a.id);
      }
    }
  }
}

function collectAgentBumpPushers(dt) {
  const pushers = [];
  const alive = new Set();
  const invDt = 1 / Math.max(dt, 1e-3);
  for (const agent of aiAgents) {
    const id = String(agent?.id || "");
    const posRaw = agent?.body?.translation?.();
    if (!id || !posRaw) continue;
    alive.add(id);
    const pos = new THREE.Vector3(posRaw.x, posRaw.y, posRaw.z);
    const prev = _agentPosPrevForBump.get(id);
    const vel = prev ? pos.clone().sub(prev).multiplyScalar(invDt) : new THREE.Vector3();
    _agentPosPrevForBump.set(id, pos.clone());
    pushers.push({
      id,
      pos,
      vel,
      radius: Math.max(0.2, Number(agent?.radius) || 0.2),
    });
  }
  for (const id of _agentPosPrevForBump.keys()) {
    if (!alive.has(id)) _agentPosPrevForBump.delete(id);
  }
  return pushers;
}

function updateRapier(dt) {
  // No physics world loaded → free-fly camera movement so user can still navigate
  if (!rapierWorld || !playerBody) {
    const flySpeed = 8.0;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
    const move = new THREE.Vector3();
    if (keys.forward) move.add(fwd);
    if (keys.backward) move.sub(fwd);
    if (keys.right) move.add(right);
    if (keys.left) move.sub(right);
    if (keys.up) move.y += 1;
    if (keys.down) move.y -= 1;
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(flySpeed * dt);
      controls.object.position.add(move);
      avatar.position.copy(controls.object.position).y -= PLAYER_EYE_HEIGHT;
    }
    return;
  }

  // Flush any deferred collider builds BEFORE stepping
  flushPendingColliderBuilds();

  // Step physics FIRST — this integrates last frame's kinematic moves and
  // updates the query pipeline internally, avoiding the RefCell double-borrow
  // that happens with manual `queryPipeline.update(colliders)`.
  rapierWorld.timestep = dt;
  try {
    rapierWorld.step();
    _rapierStepFaultCount = 0;
  } catch (e) {
    _rapierStepFaultCount += 1;
    console.warn(`[RAPIER] step() failed (${_rapierStepFaultCount})`, e);
    // Prevent hard crash loop; skip this frame and try again next tick.
    return;
  }

  // Sync camera and avatar to the body position that step() just resolved
  const p = playerBody.translation();

  // Skip player movement when camera is following agent
  if (agentCameraFollow) {
    avatar.position.set(p.x, p.y, p.z);
    return;
  }

  const baseSpeed = 6.0;
  const runSpeed = 10.0;
  const flySpeed = 8.0;
  const speed = flyMode ? flySpeed : keys.down ? runSpeed : baseSpeed;
  const gravity = 20.0;
  const jumpVel = 8.0;

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();

  const wish = new THREE.Vector3();
  if (keys.forward) wish.add(forward);
  if (keys.backward) wish.sub(forward);
  if (keys.right) wish.add(right);
  if (keys.left) wish.sub(right);
  if (wish.lengthSq() > 0) wish.normalize();

  const upDown = flyMode ? (keys.up ? 1 : 0) + (keys.down ? -1 : 0) : 0;

  const t = p; // body position after step
  let desired = { x: 0, y: 0, z: 0 };

  if (ghostMode) {
    desired = {
      x: wish.x * flySpeed * dt,
      y: ((keys.up ? 1 : 0) + (keys.down ? -1 : 0)) * flySpeed * dt,
      z: wish.z * flySpeed * dt,
    };
    playerBody.setNextKinematicTranslation({
      x: t.x + desired.x,
      y: t.y + desired.y,
      z: t.z + desired.z,
    });
  } else if (flyMode) {
    desired = {
      x: wish.x * flySpeed * dt,
      y: upDown * flySpeed * dt,
      z: wish.z * flySpeed * dt,
    };
    if (characterController && playerCollider) {
      characterController.computeColliderMovement(
        playerCollider,
        desired,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS
      );
      const m = characterController.computedMovement();
      const mx = m.x, my = m.y, mz = m.z;
      playerBody.setNextKinematicTranslation({ x: t.x + mx, y: t.y + my, z: t.z + mz });
    } else {
      playerBody.setNextKinematicTranslation({ x: t.x + desired.x, y: t.y + desired.y, z: t.z + desired.z });
    }
  } else {
    walkVerticalVel -= gravity * dt;

    if (keys.up && characterController?.computedGrounded?.()) {
      walkVerticalVel = jumpVel;
    }

    desired = { x: wish.x * speed * dt, y: walkVerticalVel * dt, z: wish.z * speed * dt };

    if (characterController && playerCollider) {
      characterController.computeColliderMovement(
        playerCollider,
        desired,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS
      );
      const m = characterController.computedMovement();
      const mx = m.x, my = m.y, mz = m.z;
      const grounded = characterController.computedGrounded();
      if (grounded && walkVerticalVel < 0) walkVerticalVel = 0;
      playerBody.setNextKinematicTranslation({ x: t.x + mx, y: t.y + my, z: t.z + mz });
    } else {
      playerBody.setNextKinematicTranslation({ x: t.x + desired.x, y: t.y + desired.y, z: t.z + desired.z });
    }
  }

  // Safety: if Ghost is OFF, ensure the collider is not a sensor
  try {
    if (!ghostMode && playerCollider && typeof playerCollider.isSensor === "function" && playerCollider.isSensor()) {
      playerCollider.setSensor(false);
    }
  } catch {}
  avatar.position.set(p.x, p.y, p.z);
  
  // If agent camera follow is active, DON'T sync player camera to player body
  // The tick() function will handle camera positioning via updateAgentCameraFollow
  if (!agentCameraFollow) {
    controls.object.position.set(p.x, p.y + PLAYER_EYE_HEIGHT, p.z);
  }

  // Expose player position for other modules (AI, etc).
  if (typeof window !== "undefined") {
    window.__playerPosition = [p.x, p.y, p.z];
  }
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);

  updateRapier(dt);

  // Bumpable assets: only compute if any exist
  if (_hasBumpableAssets()) {
    const agentPushers = aiAgents.length ? collectAgentBumpPushers(dt) : [];
    let bumpPlayerPos = null;
    if (playerBody) {
      const p = playerBody.translation();
      bumpPlayerPos = new THREE.Vector3(p.x, p.y, p.z);
    } else {
      bumpPlayerPos = controls.object.position.clone();
      bumpPlayerPos.y -= PLAYER_EYE_HEIGHT;
    }
    updateBumpableAssets(dt, bumpPlayerPos, agentPushers);
  }

  // Update AI agents (if Rapier is initialized).
  if (aiAgents.length && rapierWorld) {
    const now = Date.now();
    for (const a of aiAgents) {
      try {
        a.update(dt, now);
      } catch (e) {
        console.warn("AI update failed:", e);
      }
    }
  }
  
  // Update agent camera follow (after agent update, before render)
  if (agentCameraFollow) {
    updateAgentCameraFollow(dt);
    avatar.visible = false;
  }

  // Editor-only UI updates — skip entirely in sim mode for headless performance
  if (appMode === "edit") {
    if (editorSimLightingPreview) applyEditorGuideVisibility();
    const now = performance.now();
    if (now - _lastHintUpdate > 150) {
      _lastHintUpdate = now;
      updateInteractionHint();
    }
    updateAgentBadges();
    updatePlacementGhost(now);
  } else {
    // Sim mode: only update interaction hint + badges at reduced rate
    const now = performance.now();
    if (now - _lastHintUpdate > 300) {
      _lastHintUpdate = now;
      updateInteractionHint();
    }
  }

  // LiDAR / sensor overlays — run when explicitly enabled OR in dimos mode
  if (simSensorViewMode === "lidar" || simCompareView || dimosMode) {
    lidarVizGroup.visible = true;
    updateLidarPointCloud();
    if (_lidarGeom.drawRange.count <= 0 && _lidarLastNonZeroDrawCount > 0) {
      _lidarGeom.setDrawRange(0, _lidarLastNonZeroDrawCount);
    }
    // In dimos mode, hide LiDAR viz from the main scene render — it's only
    // needed for data capture + the sidebar LiDAR panel renders it separately.
    if (dimosMode && simSensorViewMode !== "lidar" && !simCompareView) {
      lidarVizGroup.visible = false;
    }
  } else if (rgbdPcOverlayOnLidar && (simSensorViewMode === "lidar" || simCompareView)) {
    updateRgbdPcOverlayCloud(false);
  }

  pushLidarPoseSample();

  // Dimos sensor capture — GPU readback needs rAF, odom runs independently via setInterval
  if (dimosMode && window.__dimosBridge) {
    const bridge = window.__dimosBridge;
    if (bridge._connected) {
      // Sensors only: GPU readback (RGB, depth, lidar) needs active render
      if (bridge._dirty.sensors) {
        bridge._dirty.sensors = false;
        bridge._publishSensors();
      }
    }
  }

  // Agent vision captures
  if (hasPendingCapture()) {
    processPendingCaptures().then(() => {
      renderActiveView();
      requestAnimationFrame(tick);
    });
    return;
  }

  renderActiveView();
  requestAnimationFrame(tick);
}

// Interaction hint elements (cached)
let _lastHintUpdate = 0;
let _crosshairEl = null;
let _interactionHintEl = null;

function updateInteractionHint() {
  // Cache DOM elements
  if (!_crosshairEl) _crosshairEl = document.getElementById("crosshair");
  if (!_interactionHintEl) _interactionHintEl = document.getElementById("interaction-hint");
  
  // Only show when pointer is locked and no popup is visible
  if (!controls?.isLocked || isInteractionPopupVisible()) {
    _crosshairEl?.classList.remove("interactable");
    if (_interactionHintEl) {
      _interactionHintEl.classList.remove("visible");
    }
    return;
  }
  
  // If holding something, show drop hint
  if (playerHeldAsset) {
    const heldAsset = getPlayerHeldAsset();
    const heldName = heldAsset?.title || "item";
    _crosshairEl?.classList.remove("interactable");
    _crosshairEl?.classList.add("holding");
    if (_interactionHintEl) {
      _interactionHintEl.innerHTML = `Holding: ${escapeHtml(heldName)} · Drop<span class="hint-key">E</span>`;
      _interactionHintEl.classList.add("visible");
    }
    return;
  }
  if (playerHeldGroupId) {
    const heldGroup = groups.find((g) => g.id === playerHeldGroupId);
    const heldName = heldGroup?.name || "group";
    _crosshairEl?.classList.remove("interactable");
    _crosshairEl?.classList.add("holding");
    if (_interactionHintEl) {
      _interactionHintEl.innerHTML = `Holding: ${escapeHtml(heldName)} · Drop<span class="hint-key">E</span>`;
      _interactionHintEl.classList.add("visible");
    }
    return;
  }
  
  // Not holding anything - remove holding class
  _crosshairEl?.classList.remove("holding");
  
  const target = getInteractableAssetAtCrosshair();
  
  if (target) {
    const { kind, asset, group, actions, dist, canPickUp, isPortal } = target;
    const title = kind === "group" ? (group?.name || "(group)") : (asset.title || "(asset)");
    
    // Build action description
    let actionText;
    if (kind === "group") {
      actionText = "Pick up";
    } else if (isPortal) {
      const destWorld = WORLDS_MANIFEST.find(w => w.id === asset.destinationWorld);
      actionText = `Enter → ${destWorld?.name || asset.destinationWorld}`;
    } else if (actions.length === 0 && canPickUp) {
      actionText = "Pick up";
    } else if (actions.length === 1 && !canPickUp) {
      actionText = actions[0].label || "interact";
    } else {
      const count = actions.length + (canPickUp ? 1 : 0);
      actionText = `${count} actions`;
    }
    
    _crosshairEl?.classList.add("interactable");
    if (_interactionHintEl) {
      const cycleHint = kind === "asset" && target.candidateCount > 1
        ? ` · Cycle ${target.candidateIndex + 1}/${target.candidateCount}<span class="hint-key">R</span>`
        : "";
      _interactionHintEl.innerHTML = `${escapeHtml(title)} · ${escapeHtml(actionText)}<span class="hint-key">E</span>${cycleHint}`;
      _interactionHintEl.classList.add("visible");
    }
  } else {
    _crosshairEl?.classList.remove("interactable");
    if (_interactionHintEl) {
      _interactionHintEl.classList.remove("visible");
    }
  }
}

setStatus("Select a .ply/.spz to start.");
tick();

// Expose debug utilities
window.clearWorldStorage = clearWorldStorage;
window.__robovalLidar = {
  // Returns the latest standardized frames (raw + deskewed + optional range image)
  getLatestFrames() {
    return {
      raw: _lidarLatestRawFrame,
      deskewed: _lidarLatestDeskewedFrame,
      rangeImage: _lidarLatestRangeImage,
    };
  },
  // ROS2 PointCloud2-compatible dict converter
  toPointCloud2(frame) {
    return to_pointcloud2(frame);
  },
  // Manual export of the latest frame set to NPZ files.
  async exportLatest() {
    if (!_lidarLatestRawFrame || !_lidarLatestDeskewedFrame) return false;
    await writeLidarFrameFiles(_lidarLatestRawFrame, _lidarLatestDeskewedFrame, _lidarLatestRangeImage);
    return true;
  },
  // Auto-export each LiDAR frame (warning: downloads many files in browser).
  setAutoExport(enabled) {
    _lidarAutoExport = !!enabled;
    return _lidarAutoExport;
  },
  getAutoExport() {
    return _lidarAutoExport;
  },
  // Force a known-good synthetic cloud to isolate renderer issues from sensor math.
  setKnownGoodDebugCloud(enabled) {
    _lidarUseKnownGoodDebugCloud = !!enabled;
    _lidarAccumFrames.length = 0;
    _lidarLastAccumPose = null;
    resetLidarScanState();
    if (simSensorViewMode === "lidar") updateLidarPointCloud();
    return _lidarUseKnownGoodDebugCloud;
  },
  getKnownGoodDebugCloud() {
    return _lidarUseKnownGoodDebugCloud;
  },
  // Toggle ordered scan debug render (single-frame, lidar-frame) vs accumulated world cloud.
  setOrderedDebugView(enabled) {
    lidarOrderedDebugView = !!enabled;
    if (!lidarOrderedDebugView) {
      _lidarAccumFrames.length = 0;
      _lidarLastAccumPose = null;
      resetLidarScanState();
    }
    updateSimSensorButtons();
    if (simSensorViewMode === "lidar") updateLidarPointCloud();
    return lidarOrderedDebugView;
  },
  getOrderedDebugView() {
    return lidarOrderedDebugView;
  },
  setNoiseModel(enabled) {
    lidarNoiseEnabled = !!enabled;
    _lidarAccumFrames.length = 0;
    _lidarLastAccumPose = null;
    resetLidarScanState();
    updateSimSensorButtons();
    if (simSensorViewMode === "lidar") updateLidarPointCloud();
    return lidarNoiseEnabled;
  },
  getNoiseModel() {
    return lidarNoiseEnabled;
  },
  setMultiReturnMode(mode) {
    lidarMultiReturnMode = mode === "last" ? "last" : "strongest";
    _lidarAccumFrames.length = 0;
    _lidarLastAccumPose = null;
    resetLidarScanState();
    updateSimSensorButtons();
    if (simSensorViewMode === "lidar") updateLidarPointCloud();
    return lidarMultiReturnMode;
  },
  getMultiReturnMode() {
    return lidarMultiReturnMode;
  },
};

window.__robovalRgbd = {
  // Returns metric camera-space Z depth map in meters (Float32Array length W*H).
  // Uses the same render path as on-screen RGB-D mode.
  getMetricDepthFrame() {
    renderRgbdView();
    const depth = readRgbdMetricDepthFrameMeters();
    if (!depth) return null;
    return {
      width: rgbdMetricTarget.width,
      height: rgbdMetricTarget.height,
      depth_m: depth,
      semantics: "camera_space_z",
      units: "meters",
      min_depth_m: RGBD_MIN_DEPTH_M,
      max_depth_m: RGBD_MAX_DEPTH_M,
    };
  },
  getOverlayStats() {
    return {
      enabled: rgbdPcOverlayOnLidar,
      visible: rgbdPcOverlayGroup.visible,
      points: _rgbdPcOverlayLastCount,
      rt_w: RGBD_PC_OVERLAY_RT_W,
      rt_h: RGBD_PC_OVERLAY_RT_H,
      dirty: _rgbdPcOverlayDirty,
    };
  },
};

// Debug: List all colliders in the physics world
window.debugColliders = function() {
  if (!rapierWorld) {
    console.log("[DEBUG] No physics world loaded");
    return;
  }
  
  console.log("[DEBUG] === ALL COLLIDERS IN PHYSICS WORLD ===");
  let count = 0;
  rapierWorld.colliders.forEach((collider) => {
    const pos = collider.translation();
    const shape = collider.shape;
    const isSensor = collider.isSensor();
    const handle = collider.handle;
    console.log(`Collider #${count} (handle=${handle}): pos=(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}), sensor=${isSensor}, shapeType=${shape.type}`);
    count++;
  });
  console.log(`[DEBUG] Total colliders: ${count}`);
  
  // Also show asset collider handles
  console.log("[DEBUG] === ASSET COLLIDERS (on asset objects) ===");
  let assetColCount = 0;
  for (const a of assets) {
    if (a._colliderHandle) {
      const handleInfo = typeof a._colliderHandle === 'object' ? `obj.handle=${a._colliderHandle.handle}` : `num=${a._colliderHandle}`;
      console.log(`  ${a.id}: "${a.title}", _colliderHandle=${handleInfo}`);
      assetColCount++;
    }
  }
  console.log(`[DEBUG] Assets with colliders: ${assetColCount}`);
  
  // Show tracked map
  console.log("[DEBUG] === _assetColliderHandles Map ===");
  console.log(`Map size: ${_assetColliderHandles.size}`);
  
  // Show portal assets
  console.log("[DEBUG] === PORTALS ===");
  const portals = assets.filter(a => a.isPortal);
  console.log(`Portal count: ${portals.length}`);
  portals.forEach(p => {
    console.log(`  ${p.id}: "${p.title}", hasCollider=${!!p._colliderHandle}`);
  });
};

// Debug: Remove all colliders except world/player
window.debugClearAssetColliders = function() {
  if (!rapierWorld) return;
  
  // Helper to remove a collider (handles both object and number)
  const removeCol = (handle) => {
    try {
      if (typeof handle === 'object' && handle.handle !== undefined) {
        rapierWorld.removeCollider(handle, true);
        return true;
      } else if (typeof handle === 'number') {
        const collider = rapierWorld.getCollider(handle);
        if (collider) {
          rapierWorld.removeCollider(collider, true);
          return true;
        }
      }
    } catch (e) {}
    return false;
  };
  
  let removed = 0;
  
  // Remove all tracked asset colliders
  _assetColliderHandles.forEach((handle, assetId) => {
    if (removeCol(handle)) removed++;
  });
  _assetColliderHandles.clear();
  
  // Also clear colliders stored on asset objects
  for (const asset of assets) {
    if (asset._colliderHandle != null) {
      if (removeCol(asset._colliderHandle)) removed++;
      asset._colliderHandle = null;
    }
  }
  
  console.log(`[DEBUG] Cleared ${removed} asset colliders`);
};

// =============================================================================
// VIBE CREATOR — AI-powered scene generation (edit mode)
// =============================================================================
function getSelectionAnchorForVibe() {
  if (selectedPrimitiveId) {
    const p = primitives.find((x) => x.id === selectedPrimitiveId);
    const pos = p?.transform?.position;
    if (pos) return { x: pos.x || 0, y: pos.y || 0, z: pos.z || 0 };
  }
  if (selectedAssetId) {
    const obj = assetsGroup.getObjectByName(`asset:${selectedAssetId}`);
    if (obj) return { x: obj.position.x || 0, y: obj.position.y || 0, z: obj.position.z || 0 };
  }
  if (selectedLightId) {
    const l = editorLights.find((x) => x.id === selectedLightId);
    const pos = l?.position;
    if (pos) return { x: pos.x || 0, y: pos.y || 0, z: pos.z || 0 };
  }
  return null;
}

function getPlacementAnchorFromScreenForVibe(clientX, clientY) {
  if (!renderer || !camera) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const out = new THREE.Vector3();
  const hit = raycaster.ray.intersectPlane(ground, out);
  if (!hit) return null;
  return { x: out.x, y: out.y, z: out.z };
}

function focusVibeStagingArea() {
  if (currentWorkspace !== "assetBuilder") return;
  camera.position.set(27, 8, 30);
  camera.lookAt(new THREE.Vector3(27, 0, 27));
  camera.updateMatrixWorld(true);
  setStatus("Focused staging area.");
}

function openManualStagingEditor() {
  switchWorkspace("assetBuilder");
}

function captureCurrentAssetThumbnailDataUrl() {
  if (!renderer) return "";
  try {
    // Use an overhead camera that frames the current builder content
    const bbox = new THREE.Box3();
    primitivesGroup.traverse((c) => { if (c.isMesh) bbox.expandByObject(c); });
    assetsGroup.traverse((c) => { if (c.isMesh) bbox.expandByObject(c); });

    if (bbox.isEmpty()) {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL("image/jpeg", 0.72);
    }

    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.5);

    const thumbCam = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
    thumbCam.position.set(center.x + maxDim * 0.8, center.y + maxDim * 1.0, center.z + maxDim * 0.8);
    thumbCam.lookAt(center);
    thumbCam.updateProjectionMatrix();
    thumbCam.updateMatrixWorld(true);

    const thumbTarget = new THREE.WebGLRenderTarget(256, 256);
    renderer.setRenderTarget(thumbTarget);
    renderer.render(scene, thumbCam);
    renderer.setRenderTarget(null);

    const pixels = new Uint8Array(256 * 256 * 4);
    renderer.readRenderTargetPixels(thumbTarget, 0, 0, 256, 256, pixels);
    thumbTarget.dispose();

    const flipped = new Uint8ClampedArray(256 * 256 * 4);
    for (let y = 0; y < 256; y++) {
      const src = (255 - y) * 256 * 4;
      const dst = y * 256 * 4;
      flipped.set(pixels.subarray(src, src + 256 * 4), dst);
    }
    const cvs = document.createElement("canvas");
    cvs.width = 256;
    cvs.height = 256;
    const ctx = cvs.getContext("2d");
    ctx.putImageData(new ImageData(flipped, 256, 256), 0, 0);
    return cvs.toDataURL("image/jpeg", 0.75);
  } catch {
    return "";
  }
}

function readAssetLibraryRecords() {
  if (Array.isArray(assetLibraryRuntimeCache)) {
    return JSON.parse(JSON.stringify(assetLibraryRuntimeCache));
  }
  try {
    const list = JSON.parse(localStorage.getItem(ASSET_LIBRARY_KEY) || "[]");
    const out = Array.isArray(list) ? list : [];
    assetLibraryRuntimeCache = JSON.parse(JSON.stringify(out));
    return out;
  } catch {
    return [];
  }
}

function compactSceneForStorage(scene, textureLimit = 500000) {
  if (!scene || typeof scene !== "object") return scene;
  const out = JSON.parse(JSON.stringify(scene));
  for (const p of out.primitives || []) {
    const m = p?.material;
    if (!m) continue;
    const tex = m.textureDataUrl;
    if (typeof tex === "string" && tex.length > textureLimit) {
      m.textureDataUrl = null;
    }
  }
  return out;
}

function compactAssetLibraryForStorage(list, opts = {}) {
  const textureLimit = Number.isFinite(opts.textureLimit) ? Number(opts.textureLimit) : 500000;
  const lib = JSON.parse(JSON.stringify(Array.isArray(list) ? list : []));
  for (const rec of lib) {
    if (!rec || typeof rec !== "object") continue;
    rec.scene = compactSceneForStorage(rec.scene, textureLimit);
    if (Array.isArray(rec.states)) {
      for (const st of rec.states) {
        if (!st || typeof st !== "object") continue;
        st.scene = compactSceneForStorage(st.scene || st.shapeScene, textureLimit);
        if (st.shapeScene && !st.scene) st.shapeScene = undefined;
      }
    }
  }
  return lib;
}

function writeAssetLibraryRecords(list) {
  const arr = Array.isArray(list) ? list : [];
  assetLibraryRuntimeCache = JSON.parse(JSON.stringify(arr));
  const attempts = [
    arr,
    compactAssetLibraryForStorage(arr, { textureLimit: 500000 }),
    compactAssetLibraryForStorage(arr, { textureLimit: 250000 }),
    compactAssetLibraryForStorage(arr, { textureLimit: 100000 }),
  ];
  let savedLocal = false;
  let usedAttempt = 0;
  let savedCount = arr.length;
  for (let i = 0; i < attempts.length; i++) {
    try {
      localStorage.setItem(ASSET_LIBRARY_KEY, JSON.stringify(attempts[i]));
      savedLocal = true;
      usedAttempt = i;
      savedCount = attempts[i].length;
      break;
    } catch (err) {
      const msg = String(err?.name || err?.message || err);
      if (!/QuotaExceededError/i.test(msg)) {
        console.warn("[asset-library] localStorage write failed:", err);
        break;
      }
    }
  }
  // Last-resort: trim oldest records (keep thumbnails on retained records).
  if (!savedLocal) {
    const sorted = [...arr].sort((a, b) => Number(a?.createdAt || 0) - Number(b?.createdAt || 0));
    let candidate = compactAssetLibraryForStorage(sorted, { textureLimit: 100000 });
    while (candidate.length > 1) {
      candidate.shift();
      try {
        localStorage.setItem(ASSET_LIBRARY_KEY, JSON.stringify(candidate));
        savedLocal = true;
        usedAttempt = attempts.length;
        savedCount = candidate.length;
        break;
      } catch (err) {
        const msg = String(err?.name || err?.message || err);
        if (!/QuotaExceededError/i.test(msg)) {
          console.warn("[asset-library] localStorage trim write failed:", err);
          break;
        }
      }
    }
  }
  // Persist full-fidelity records to disk via server (fire-and-forget).
  _persistAssetLibraryToDisk(arr);
  if (!savedLocal) {
    setStatus("Asset library is too large for browser storage. Saved to disk, but local cache could not update.");
    // Still notify listeners with full-fidelity records so UI does not regress to placeholders.
    window.dispatchEvent(new CustomEvent("asset-library-updated", { detail: { assets: assetLibraryRuntimeCache, source: "memory" } }));
    renderBuilderStateEditorPanel();
    return false;
  }
  if (usedAttempt > 0) {
    if (savedCount < arr.length) {
      setStatus(`Asset saved. Browser cache kept ${savedCount}/${arr.length} newest assets; full library saved to disk.`);
    } else {
      setStatus("Asset saved. Browser cache was compacted to fit storage limits.");
    }
  }
  // Notify listeners with the full list so UI can prefer in-memory records over compacted cache.
  window.dispatchEvent(new CustomEvent("asset-library-updated", { detail: { assets: assetLibraryRuntimeCache, source: "storage" } }));
  renderBuilderStateEditorPanel();
  return true;
}

function _persistAssetLibraryToDisk(list) {
  const baseUrl = (localStorage.getItem("sparkWorldVlmEndpoint") || "/vlm/decision").replace("/vlm/decision", "");
  fetch(`${baseUrl}/vlm/asset-library`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assets: list }),
  }).catch(() => { /* server might be offline — localStorage still has it */ });
}

window.addEventListener("asset-library-updated", (ev) => {
  const assets = ev?.detail?.assets;
  if (Array.isArray(assets)) {
    assetLibraryRuntimeCache = JSON.parse(JSON.stringify(assets));
  }
});

function showBuilderStateFeedback(msg, isError = false) {
  const el = document.getElementById("builder-state-feedback");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isError ? "#ef4444" : "var(--text-tertiary)";
}

function getBuilderEditingAssetRecord(list = null) {
  const lib = Array.isArray(list) ? list : readAssetLibraryRecords();
  if (!builderEditingAssetId) return null;
  return lib.find((x) => x.id === builderEditingAssetId) || null;
}

function getBestAssetLibraryRecordByName(list, title) {
  const needle = String(title || "").trim().toLowerCase();
  if (!needle) return null;
  const matches = (Array.isArray(list) ? list : []).filter(
    (x) => String(x?.name || "").trim().toLowerCase() === needle,
  );
  if (!matches.length) return null;
  matches.sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0));
  return matches[0] || null;
}

function updateBuilderPrimarySaveButton() {
  if (!builderPrimarySaveBtn) return;
  const isVisible = currentWorkspace === "assetBuilder" && !!builderEditingAssetId;
  builderPrimarySaveBtn.classList.toggle("hidden", !isVisible);
  builderPrimarySaveBtn.textContent = "Save + Done";
}

async function finishBuilderEditing(saveBeforeExit = true) {
  if (saveBeforeExit) {
    const sid = builderEditingStateId;
    if (sid) {
      const snapshot = buildCurrentBuilderSceneSnapshot();
      if (snapshot?.primitives?.length) {
        updateBuilderEditingAssetRecord((rec) => {
          const st = (rec.states || []).find((s) => s.id === sid);
          if (st) st.scene = snapshot;
          rec.scene = snapshot;
          const thumb = captureCurrentAssetThumbnailDataUrl();
          if (typeof thumb === "string" && thumb.startsWith("data:image/")) {
            rec.thumbnailDataUrl = thumb;
          }
          rebuildActionsFromStateInteractions(rec);
        });
      }
    }
  }
  builderEditingAssetId = null;
  builderEditingStateId = null;
  builderShowTypeChoice = false;
  await importLevelFromJSON({ tags: [], primitives: [], lights: [], groups: [] });
  renderBuilderStateEditorPanel();
  updateBuilderPrimarySaveButton();
  setStatus("Done editing. Builder cleared.");
}

function updateBuilderEditingAssetRecord(mutator) {
  const list = readAssetLibraryRecords();
  const idx = list.findIndex((x) => x.id === builderEditingAssetId);
  if (idx === -1) return false;
  const rec = list[idx];
  mutator(rec);
  list[idx] = rec;
  return writeAssetLibraryRecords(list);
}

function renderBuilderStateEditorPanel() {
  if (!builderStateEditorEl) return;
  updateBuilderPrimarySaveButton();
  const inBuilder = currentWorkspace === "assetBuilder";
  const rec = getBuilderEditingAssetRecord();
  if (!inBuilder) {
    builderStateEditorEl.classList.add("hidden");
    builderStateEditorEl.innerHTML = "";
    return;
  }
  builderStateEditorEl.classList.remove("hidden");

  // ── PHASE 1: No asset saved yet — just name + save ──
  if (!rec && !builderShowTypeChoice) {
    builderStateEditorEl.innerHTML = `
      <details class="dt-section" open>
        <summary class="dt-header">Save Asset</summary>
        <div class="dt-body">
          <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:8px;">
            Build your asset with shapes, then save it to the library.
          </div>
          <input id="builder-new-asset-name" class="dt-input" type="text" placeholder="Asset name (e.g. Chair, Cabinet)" value="" />
          <div class="dt-actions" style="margin-top:4px;">
            <button id="builder-save-to-library-btn" class="tb-btn tb-primary" type="button">Save to Library</button>
          </div>
          <div id="builder-state-feedback" style="font-size:12px;color:var(--text-tertiary);margin-top:6px;"></div>
        </div>
      </details>
    `;
    return;
  }

  // ── PHASE 2: Just saved — ask Static or Interactive ──
  if (builderShowTypeChoice && rec) {
    const esc = (s) => escapeHtml(String(s ?? ""));
    builderStateEditorEl.innerHTML = `
      <details class="dt-section" open>
        <summary class="dt-header">Asset Saved</summary>
        <div class="dt-body">
          <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--text-primary);">
            "${esc(rec.name)}" saved to library!
          </div>
          <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:10px;">
            What kind of asset is this?
          </div>
          <div class="dt-actions" style="flex-direction:column;gap:6px;">
            <button id="builder-choose-static-btn" class="tb-btn" type="button" style="width:100%;text-align:left;padding:6px 8px;white-space:normal;line-height:1.35;">
              <strong>Static</strong> — Done!
            </button>
            <button id="builder-choose-interactive-btn" class="tb-btn tb-primary" type="button" style="width:100%;text-align:left;padding:6px 8px;white-space:normal;line-height:1.35;">
              <strong>Interactive</strong> — Add states (open/closed)
            </button>
          </div>
          <div id="builder-state-feedback" style="font-size:12px;color:var(--text-tertiary);margin-top:8px;"></div>
        </div>
      </details>
    `;
    return;
  }

  // ── PHASE 3: Interactive state editing ──
  if (!rec) {
    builderStateEditorEl.innerHTML = "";
    return;
  }
  const states = Array.isArray(rec.states) ? rec.states : [];
  const currentId = rec.currentStateId || states[0]?.id || "";
  const editingId = builderEditingStateId || currentId;
  const selectedState = states.find((s) => s.id === editingId) || states[0] || null;
  const selectedStateId = selectedState?.id || "";
  const esc = (s) => escapeHtml(String(s ?? ""));
  const renderStateOptions = () =>
    states.map((s) => `<option value="${esc(s.id)}"${selectedStateId === s.id ? " selected" : ""}>${esc(s.name || s.id)}</option>`).join("");
  const renderInteractionTargetOptions = (currentTo) =>
    states
      .filter((s) => s.id !== selectedStateId)
      .map((s) => `<option value="${esc(s.id)}"${currentTo === s.id ? " selected" : ""}>${esc(s.name || s.id)}</option>`)
      .join("");
  const selectedInteractions = Array.isArray(selectedState?.interactions) ? selectedState.interactions : [];
  const interactionRowsHtml = selectedInteractions.length
    ? selectedInteractions.map((it) => `
        <div class="builder-interaction-row dt-row" data-interaction-id="${esc(it.id)}" style="margin-bottom:4px;align-items:center;">
          <input class="dt-input builder-transition-label" type="text" data-field="builder-ilabel" value="${esc(it.label || "toggle")}" placeholder="Action label (e.g. Open left drawer)" />
          <select class="dt-select builder-transition-target" data-field="builder-ito">
            ${renderInteractionTargetOptions(it.to)}
          </select>
          <button class="tb-btn tb-danger builder-transition-remove" type="button" data-action="builder-remove-interaction" title="Remove this transition">Remove</button>
        </div>
      `).join("")
    : `<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:6px;">No custom transitions yet for this state.</div>`;
  builderStateEditorEl.innerHTML = `
    <details class="dt-section" open>
      <summary class="dt-header">Editing: ${esc(rec.name)}</summary>
      <div class="dt-body">
        <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:8px;">
          Modify shapes to create a new look, then save it as a new state.
          States cycle with <strong>E</strong> in sim mode.
        </div>
        <input id="builder-asset-name" class="dt-input" type="text" value="${esc(rec.name || "")}" placeholder="Asset name" />
        <label class="prop-check"><input id="builder-asset-pickable" type="checkbox" ${rec.pickable ? "checked" : ""} /><span>Pickable in sim</span></label>
        <label class="prop-check"><input id="builder-asset-bumpable" type="checkbox" ${rec.bumpable ? "checked" : ""} /><span>Bump-movable in sim</span></label>
        <div id="builder-bump-controls" class="${rec.bumpable ? "" : "hidden"}" style="padding:6px 8px;background:var(--surface-1);border-radius:8px;margin-bottom:6px;">
          <div class="slider"><span class="slider-label">Push Response</span><input id="builder-asset-bump-response" type="range" min="0.1" max="2.0" step="0.05" value="${Number(rec.bumpResponse ?? 0.9).toFixed(2)}" /><span id="builder-asset-bump-response-val" class="slider-value">${Number(rec.bumpResponse ?? 0.9).toFixed(2)}</span></div>
          <div class="slider"><span class="slider-label">Friction</span><input id="builder-asset-bump-damping" type="range" min="0.70" max="0.99" step="0.01" value="${Number(rec.bumpDamping ?? 0.9).toFixed(2)}" /><span id="builder-asset-bump-damping-val" class="slider-value">${Number(rec.bumpDamping ?? 0.9).toFixed(2)}</span></div>
        </div>
        <label class="prop-check"><input id="builder-auto-cycle" type="checkbox" ${rec.autoCycle !== false ? "checked" : ""} /><span>Auto-cycle states on interact (E)</span></label>
        <div style="font-size:11px;color:var(--text-tertiary);margin:-2px 0 6px 22px;">
          Turn this off to create custom transitions (e.g. closed -> half-open -> open).
        </div>
        <hr style="border:none;border-top:1px solid var(--border);margin:8px 0;" />
        <div style="font-size:12px;font-weight:600;margin-bottom:4px;">States (${states.length})</div>
        <div class="dt-row" style="margin-bottom:4px;">
          <select id="builder-state-select" class="dt-select" style="flex:1;">${renderStateOptions()}</select>
          <button id="builder-load-selected-state-btn" class="tb-btn" type="button" title="Load this state into the builder">Load</button>
        </div>
        <input id="builder-state-name" class="dt-input" type="text" value="${esc(selectedState?.name || "")}" placeholder="Rename this state" />
        <div class="dt-actions" style="margin-top:2px;margin-bottom:6px;">
          <button id="builder-save-current-state-btn" class="tb-btn" type="button" title="Overwrite this state with current shapes">Update State</button>
          <button id="builder-delete-selected-state-btn" class="tb-btn tb-danger" type="button" ${states.length <= 1 ? "disabled" : ""}>Delete</button>
        </div>
        <div style="font-size:12px;font-weight:600;margin-bottom:4px;">Transitions from "${esc(selectedState?.name || "state")}"</div>
        ${rec.autoCycle !== false
          ? `<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:6px;">Auto-cycle is on. Any manual transition edit/removal will switch to custom mode.</div>`
          : ``}
        ${interactionRowsHtml}
        <div class="dt-actions" style="margin-top:2px;margin-bottom:6px;">
          <button id="builder-add-interaction-btn" class="tb-btn" type="button" ${states.length <= 1 ? "disabled" : ""}>+ Add Transition</button>
          <button id="builder-clear-interactions-btn" class="tb-btn tb-danger" type="button" ${(selectedInteractions.length === 0 || states.length <= 1) ? "disabled" : ""}>Clear All</button>
        </div>
        <hr style="border:none;border-top:1px solid var(--border);margin:6px 0;" />
        <div style="font-size:12px;font-weight:600;margin-bottom:4px;">Add New State</div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:4px;">
          Modify the shapes above, name the new look, then save.
        </div>
        <input id="builder-new-state-name" class="dt-input" type="text" value="" placeholder="New state name (e.g. open)" />
        <div class="dt-actions" style="margin-top:2px;margin-bottom:6px;">
          <button id="builder-create-state-btn" class="tb-btn tb-primary" type="button" title="Save current shapes as a brand new state">+ Save as New State</button>
        </div>
        <div id="builder-state-feedback" style="font-size:12px;color:var(--text-tertiary);margin-bottom:4px;"></div>
        <button id="builder-done-editing-btn" class="tb-btn" type="button" style="width:100%;margin-top:4px;">Done Editing</button>
      </div>
    </details>
  `;
}

function buildCurrentBuilderSceneSnapshot() {
  const cleanPrimitives = primitives.map((p) => {
    const { _colliderHandle, ...rest } = p;
    return rest;
  });
  const cleanLights = editorLights.map((l) => {
    const { _lightObj, _helperObj, _proxyObj, ...rest } = l;
    return rest;
  });
  return { tags: [], primitives: cleanPrimitives, lights: cleanLights, groups: [...groups] };
}

function publishCurrentSceneToStagingQueue(name = "Manual staged asset") {
  const currentScene = buildCurrentBuilderSceneSnapshot();
  const defaultStateId = "state-default";
  const payload = {
    id: `lib-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    prompt: "Manually authored in asset builder",
    createdAt: Date.now(),
    thumbnailDataUrl: captureCurrentAssetThumbnailDataUrl(),
    scene: currentScene,
    states: [{ id: defaultStateId, name: "default", scene: currentScene, interactions: [] }],
    currentStateId: defaultStateId,
    actions: [],
    autoCycle: true,
    pickable: false,
    bumpable: false,
    bumpResponse: 0.9,
    bumpDamping: 0.9,
  };
  const existing = readAssetLibraryRecords();
  existing.push(payload);
  writeAssetLibraryRecords(existing);
  builderEditingAssetId = payload.id;
  builderEditingStateId = defaultStateId;
  builderShowTypeChoice = false;
  setStatus(`Saved asset to library: ${name}`);
}

function rebuildActionsFromStateInteractions(record) {
  const states = Array.isArray(record.states) ? record.states : [];
  const autoCycle = record.autoCycle !== false;
  if (autoCycle) {
    for (let i = 0; i < states.length; i++) {
      const s = states[i];
      s.interactions = [];
      if (states.length <= 1) continue;
      const next = states[(i + 1) % states.length];
      s.interactions.push({
        id: `cycle-${s.id}-to-${next.id}`,
        label: `to ${next.name || "next"}`,
        to: next.id,
      });
    }
  } else {
    for (const s of states) {
      s.interactions = Array.isArray(s.interactions) ? s.interactions : [];
    }
  }
  const actionMap = new Map();
  for (const s of states) {
    for (const it of s.interactions || []) {
      if (!it?.to || !states.some((x) => x.id === it.to)) continue;
      const id = it.id || `act-${s.id}-to-${it.to}`;
      actionMap.set(id, { id, label: it.label || "toggle", from: s.id, to: it.to });
    }
  }
  record.actions = [...actionMap.values()];
}

// Phase 1 save: create asset in library with one default state, then show type choice.
function saveBuilderAssetToLibrary() {
  const snapshot = buildCurrentBuilderSceneSnapshot();
  const hasGeometry = Array.isArray(snapshot.primitives) && snapshot.primitives.length > 0;
  if (!hasGeometry) {
    setStatus("Builder is empty. Add shapes before saving.");
    showBuilderStateFeedback("Add at least one shape first.", true);
    return;
  }
  const assetName = (document.getElementById("builder-new-asset-name")?.value?.trim()) || "";
  if (!assetName) {
    showBuilderStateFeedback("Please enter an asset name.", true);
    return;
  }
  const stateId = `state-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const payload = {
    id: `lib-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: assetName,
    prompt: "",
    createdAt: Date.now(),
    thumbnailDataUrl: captureCurrentAssetThumbnailDataUrl(),
    scene: snapshot,
    states: [{ id: stateId, name: "default", scene: snapshot, interactions: [] }],
    currentStateId: stateId,
    actions: [],
    autoCycle: false,
    pickable: false,
    bumpable: false,
    bumpResponse: 0.9,
    bumpDamping: 0.9,
  };
  const existing = readAssetLibraryRecords();
  existing.push(payload);
  writeAssetLibraryRecords(existing);
  builderEditingAssetId = payload.id;
  builderEditingStateId = stateId;
  builderShowTypeChoice = true;
  renderBuilderStateEditorPanel();
  setStatus(`Asset "${assetName}" saved to library.`);
}

// Phase 2 → Static: asset is done, clear builder.
function finalizeAssetAsStatic() {
  builderShowTypeChoice = false;
  builderEditingAssetId = null;
  builderEditingStateId = null;
  importLevelFromJSON({ tags: [], primitives: [], lights: [], groups: [] });
  renderBuilderStateEditorPanel();
  setStatus("Static asset saved. Builder cleared for next asset.");
}

// Phase 2 → Interactive: keep asset loaded, rename default state, show state editor.
function finalizeAssetAsInteractive() {
  builderShowTypeChoice = false;
  const rec = getBuilderEditingAssetRecord();
  if (rec) {
    rec.autoCycle = true;
    const firstState = (rec.states || [])[0];
    if (firstState && firstState.name === "default") firstState.name = "closed";
    rebuildActionsFromStateInteractions(rec);
    const list = readAssetLibraryRecords();
    const idx = list.findIndex((x) => x.id === rec.id);
    if (idx !== -1) { list[idx] = rec; writeAssetLibraryRecords(list); }
  }
  renderBuilderStateEditorPanel();
  setStatus("Now modify the shapes and save additional states.");
}

// Phase 3: add a new state to the currently-editing interactive asset.
function saveCurrentBuilderSceneAsNewState() {
  const existing = readAssetLibraryRecords();
  const snapshot = buildCurrentBuilderSceneSnapshot();
  if (!snapshot.primitives?.length) {
    showBuilderStateFeedback("Builder is empty. Add at least one shape.", true);
    return;
  }
  if (!builderEditingAssetId) {
    showBuilderStateFeedback("No asset being edited.", true);
    return;
  }
  const target = existing.find((x) => x.id === builderEditingAssetId) || null;
  if (!target) {
    showBuilderStateFeedback("Asset not found in library.", true);
    return;
  }
  const typedStateName = document.getElementById("builder-new-state-name")?.value?.trim();
  if (!typedStateName) {
    showBuilderStateFeedback("Enter a name for the new state (e.g. open).", true);
    return;
  }
  const states = Array.isArray(target.states) ? target.states : [];
  const existingNames = new Set(states.map((s) => String(s?.name || "").toLowerCase()));
  let stateName = typedStateName;
  if (existingNames.has(stateName.toLowerCase())) {
    let n = 2;
    while (existingNames.has(`${typedStateName} ${n}`.toLowerCase())) n++;
    stateName = `${typedStateName} ${n}`;
  }
  const newStateId = `state-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  states.push({ id: newStateId, name: stateName, scene: snapshot, interactions: [] });
  target.states = states;
  if (typeof target.autoCycle !== "boolean") target.autoCycle = true;
  rebuildActionsFromStateInteractions(target);
  target.currentStateId = target.currentStateId || states[0]?.id || newStateId;
  target.scene = snapshot;
  const thumb = captureCurrentAssetThumbnailDataUrl();
  if (typeof thumb === "string" && thumb.startsWith("data:image/")) {
    target.thumbnailDataUrl = thumb;
  }
  writeAssetLibraryRecords(existing);
  builderEditingAssetId = target.id;
  builderEditingStateId = newStateId;
  renderBuilderStateEditorPanel();
  setStatus(`Saved new state "${stateName}" for ${target.name}.`);
  showBuilderStateFeedback(`Saved state "${stateName}".`);
}

async function openLibraryAssetInBuilder(assetRecord) {
  const rec = assetRecord || null;
  if (!rec) return;
  const states = Array.isArray(rec.states) ? rec.states : [];
  const currentStateId = rec.currentStateId || states[0]?.id || null;
  const st = states.find((s) => s.id === currentStateId) || states[0] || null;
  const scenePayload = st?.scene || st?.shapeScene || rec.scene;
  if (!scenePayload) return;
  await switchWorkspace("assetBuilder");
  await importLevelFromJSON(scenePayload);
  builderEditingAssetId = rec.id || null;
  builderEditingStateId = currentStateId || st?.id || null;
  builderShowTypeChoice = false;
  renderBuilderStateEditorPanel();
  setStatus(`Editing asset in builder: ${rec.name || "asset"} (${st?.name || "state"})`);
}

async function editSelectedAssetStatesInBuilder() {
  const a = getSelectedAsset();
  if (!a) return;
  const list = readAssetLibraryRecords();
  let rec = null;
  if (a.libraryAssetId) rec = list.find((x) => x.id === a.libraryAssetId) || null;
  if (!rec) {
    rec = getBestAssetLibraryRecordByName(list, a.title);
  }
  if (!rec) {
    setStatus("This asset is not linked to a library record. Save it to library first.");
    return;
  }
  await openLibraryAssetInBuilder(rec);
}

builderStateEditorEl?.addEventListener("input", (e) => {
  if (!builderEditingAssetId) return;
  const t = e.target;
  const irow = t.closest?.(".builder-interaction-row");
  if (irow && t.getAttribute?.("data-field") === "builder-ilabel") {
    const iid = irow.getAttribute("data-interaction-id");
    if (!iid) return;
    updateBuilderEditingAssetRecord((rec) => {
      rec.autoCycle = false;
      const sid = builderEditingStateId || rec.currentStateId || rec.states?.[0]?.id;
      const st = (rec.states || []).find((s) => s.id === sid);
      if (!st) return;
      st.interactions = Array.isArray(st.interactions) ? st.interactions : [];
      const it = st.interactions.find((x) => x.id === iid);
      if (it) it.label = t.value;
      rebuildActionsFromStateInteractions(rec);
    });
    return;
  }
  if (t.id === "builder-asset-name") {
    updateBuilderEditingAssetRecord((rec) => { rec.name = t.value.trim() || rec.name; });
    return;
  }
  if (t.id === "builder-state-name") {
    const sid = builderEditingStateId;
    if (!sid) return;
    updateBuilderEditingAssetRecord((rec) => {
      const st = (rec.states || []).find((s) => s.id === sid);
      if (st) st.name = t.value.trim() || st.name;
      rebuildActionsFromStateInteractions(rec);
    });
    return;
  }
  if (t.id === "builder-asset-bump-response") {
    const v = parseFloat(t.value) || 0.9;
    const valEl = document.getElementById("builder-asset-bump-response-val");
    if (valEl) valEl.textContent = v.toFixed(2);
    return;
  }
  if (t.id === "builder-asset-bump-damping") {
    const v = parseFloat(t.value) || 0.9;
    const valEl = document.getElementById("builder-asset-bump-damping-val");
    if (valEl) valEl.textContent = v.toFixed(2);
  }
});

builderStateEditorEl?.addEventListener("change", async (e) => {
  if (!builderEditingAssetId) return;
  const t = e.target;
  const irow = t.closest?.(".builder-interaction-row");
  if (irow && t.getAttribute?.("data-field") === "builder-ito") {
    const iid = irow.getAttribute("data-interaction-id");
    if (!iid) return;
    updateBuilderEditingAssetRecord((rec) => {
      rec.autoCycle = false;
      const sid = builderEditingStateId || rec.currentStateId || rec.states?.[0]?.id;
      const st = (rec.states || []).find((s) => s.id === sid);
      if (!st) return;
      st.interactions = Array.isArray(st.interactions) ? st.interactions : [];
      const it = st.interactions.find((x) => x.id === iid);
      if (it) it.to = t.value;
      rebuildActionsFromStateInteractions(rec);
    });
    return;
  }
  if (t.id === "builder-asset-pickable") {
    updateBuilderEditingAssetRecord((rec) => { rec.pickable = !!t.checked; });
    return;
  }
  if (t.id === "builder-auto-cycle") {
    updateBuilderEditingAssetRecord((rec) => {
      rec.autoCycle = !!t.checked;
      rebuildActionsFromStateInteractions(rec);
    });
    renderBuilderStateEditorPanel();
    return;
  }
  if (t.id === "builder-asset-bumpable") {
    updateBuilderEditingAssetRecord((rec) => { rec.bumpable = !!t.checked; });
    renderBuilderStateEditorPanel();
    return;
  }
  if (t.id === "builder-asset-bump-response") {
    const v = parseFloat(t.value) || 0.9;
    updateBuilderEditingAssetRecord((rec) => { rec.bumpResponse = v; });
    const valEl = document.getElementById("builder-asset-bump-response-val");
    if (valEl) valEl.textContent = v.toFixed(2);
    return;
  }
  if (t.id === "builder-asset-bump-damping") {
    const v = parseFloat(t.value) || 0.9;
    updateBuilderEditingAssetRecord((rec) => { rec.bumpDamping = v; });
    const valEl = document.getElementById("builder-asset-bump-damping-val");
    if (valEl) valEl.textContent = v.toFixed(2);
    return;
  }
  if (t.id === "builder-state-select") {
    builderEditingStateId = t.value || null;
    renderBuilderStateEditorPanel();
    return;
  }
});

builderStateEditorEl?.addEventListener("click", async (e) => {
  const btn = e.target.closest?.("button");
  if (!btn) return;
  if (btn.id === "builder-add-interaction-btn") {
    updateBuilderEditingAssetRecord((rec) => {
      const sid = builderEditingStateId || rec.currentStateId || rec.states?.[0]?.id;
      const st = (rec.states || []).find((s) => s.id === sid);
      if (!st) return;
      st.interactions = Array.isArray(st.interactions) ? st.interactions : [];
      const fallbackTo = (rec.states || []).find((s) => s.id !== sid)?.id || sid;
      const iid = `it-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      st.interactions.push({ id: iid, label: "toggle", to: fallbackTo });
      // Adding custom transitions implies non-cycling behavior.
      rec.autoCycle = false;
      rebuildActionsFromStateInteractions(rec);
    });
    renderBuilderStateEditorPanel();
    return;
  }
  if (btn.id === "builder-clear-interactions-btn") {
    updateBuilderEditingAssetRecord((rec) => {
      rec.autoCycle = false;
      const sid = builderEditingStateId || rec.currentStateId || rec.states?.[0]?.id;
      const st = (rec.states || []).find((s) => s.id === sid);
      if (!st) return;
      st.interactions = [];
      rebuildActionsFromStateInteractions(rec);
    });
    renderBuilderStateEditorPanel();
    return;
  }
  if (btn.getAttribute?.("data-action") === "builder-remove-interaction") {
    const row = btn.closest?.(".builder-interaction-row");
    const iid = row?.getAttribute?.("data-interaction-id");
    if (!iid) return;
    updateBuilderEditingAssetRecord((rec) => {
      rec.autoCycle = false;
      const sid = builderEditingStateId || rec.currentStateId || rec.states?.[0]?.id;
      const st = (rec.states || []).find((s) => s.id === sid);
      if (!st) return;
      st.interactions = (st.interactions || []).filter((x) => x.id !== iid);
      rebuildActionsFromStateInteractions(rec);
    });
    renderBuilderStateEditorPanel();
    return;
  }

  // Phase 1: initial save
  if (btn.id === "builder-save-to-library-btn") {
    saveBuilderAssetToLibrary();
    return;
  }

  // Phase 2: static or interactive choice
  if (btn.id === "builder-choose-static-btn") {
    finalizeAssetAsStatic();
    return;
  }
  if (btn.id === "builder-choose-interactive-btn") {
    finalizeAssetAsInteractive();
    return;
  }

  // Phase 3: state editing
  if (btn.id === "builder-load-selected-state-btn") {
    const sid = document.getElementById("builder-state-select")?.value || builderEditingStateId;
    if (!sid) return;
    const rec = getBuilderEditingAssetRecord();
    const st = (rec?.states || []).find((s) => s.id === sid);
    if (!st?.scene && !st?.shapeScene) return;
    await importLevelFromJSON(st.scene || st.shapeScene);
    builderEditingStateId = sid;
    renderBuilderStateEditorPanel();
    showBuilderStateFeedback(`Loaded state "${st.name || sid}".`);
    return;
  }
  if (btn.id === "builder-save-current-state-btn") {
    const sid = builderEditingStateId;
    if (!sid) return;
    const snapshot = buildCurrentBuilderSceneSnapshot();
    if (!snapshot.primitives?.length) {
      showBuilderStateFeedback("Builder is empty. Add shapes first.", true);
      return;
    }
    updateBuilderEditingAssetRecord((rec) => {
      const st = (rec.states || []).find((s) => s.id === sid);
      if (st) st.scene = snapshot;
      // Keep top-level scene in sync for compatibility with legacy readers.
      rec.scene = snapshot;
      const thumb = captureCurrentAssetThumbnailDataUrl();
      if (typeof thumb === "string" && thumb.startsWith("data:image/")) {
        rec.thumbnailDataUrl = thumb;
      }
      rebuildActionsFromStateInteractions(rec);
    });
    showBuilderStateFeedback("State updated.");
    return;
  }
  if (btn.id === "builder-create-state-btn") {
    saveCurrentBuilderSceneAsNewState();
    return;
  }
  if (btn.id === "builder-delete-selected-state-btn") {
    const sid = builderEditingStateId;
    if (!sid) return;
    updateBuilderEditingAssetRecord((rec) => {
      rec.states = (rec.states || []).filter((s) => s.id !== sid);
      if (!rec.states.length) return;
      if (rec.currentStateId === sid) rec.currentStateId = rec.states[0].id;
      builderEditingStateId = rec.states[0].id;
      rebuildActionsFromStateInteractions(rec);
    });
    return;
  }
  if (btn.id === "builder-done-editing-btn") {
    await finishBuilderEditing(true);
    return;
  }
});

async function spawnShapeLibraryAsset(assetRecord, opts = {}) {
  const rec = assetRecord || {};
  const states = Array.isArray(rec.states) && rec.states.length > 0
    ? rec.states
    : [{ id: "state-default", name: "default", scene: rec.blueprint || rec.scene || { tags: [], primitives: [], lights: [], groups: [] }, interactions: [] }];
  const currentStateId = rec.currentStateId || states[0]?.id || "state-default";
  const actions = Array.isArray(rec.actions) ? rec.actions : [];
  const placement = getPlacementAtCrosshair({ raycastDistance: 500, surfaceOffset: 0.02 });
  const explicitTarget = Number.isFinite(opts.targetX) && Number.isFinite(opts.targetZ);
  const anchor = explicitTarget
    ? {
        x: Number(opts.targetX),
        y: Number.isFinite(opts.targetY) ? Number(opts.targetY) : 0,
        z: Number(opts.targetZ),
      }
    : placement.position;
  const id = randId();
  const newAsset = normalizeAsset({
    id,
    title: rec.name || "Shape Asset",
    notes: rec.prompt || "",
    states,
    currentStateId,
    actions,
    transform: {
      position: { x: anchor.x || 0, y: anchor.y || 0, z: anchor.z || 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    pickable: rec.pickable === true,
    bumpable: rec.bumpable === true,
    bumpResponse: Number.isFinite(rec.bumpResponse) ? rec.bumpResponse : 0.9,
    bumpDamping: Number.isFinite(rec.bumpDamping) ? rec.bumpDamping : 0.9,
    libraryAssetId: rec.id || null,
    castShadow: false,
    receiveShadow: false,
  });
  assets.push(newAsset);
  await instantiateAsset(newAsset);
  saveTagsForWorld();
  renderAssetsList();
  selectAsset(newAsset.id);
  return newAsset.id;
}

assetBuilderGrid = new THREE.GridHelper(80, 80, 0x2b2f38, 0x1f232b);
assetBuilderGrid.position.set(0, 0.001, 0);
assetBuilderGrid.visible = false;
scene.add(assetBuilderGrid);

// Inline shape palette for builder mode (replaces dropdown in builder)
const toolbar = document.getElementById("overlay-top");
if (toolbar) {
  const shapeBar = document.createElement("div");
  shapeBar.className = "builder-shape-bar hidden";
  shapeBar.id = "builder-shape-bar";
  const shapes = [
    { type: "box", icon: "▢", label: "Box" },
    { type: "sphere", icon: "●", label: "Sphere" },
    { type: "cylinder", icon: "⬡", label: "Cyl" },
    { type: "cone", icon: "△", label: "Cone" },
    { type: "torus", icon: "◎", label: "Torus" },
    { type: "plane", icon: "▬", label: "Plane" },
  ];
  for (const s of shapes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tb-btn";
    btn.title = `Add ${s.label}`;
    btn.innerHTML = `<span class="shape-icon">${s.icon}</span>${s.label}`;
    btn.addEventListener("click", () => addPrimitiveAtCrosshair(s.type));
    shapeBar.appendChild(btn);
  }
  // Insert the shape bar right after the transform tools
  const transformTools = document.getElementById("asset-transform-tools");
  if (transformTools?.nextSibling) toolbar.insertBefore(shapeBar, transformTools.nextSibling.nextSibling);
  else toolbar.appendChild(shapeBar);
}
// Legacy toolbar save buttons — kept as hidden DOM anchors for backward compat
if (toolbar && !document.getElementById("staging-publish-asset-btn")) {
  const sep = document.createElement("div");
  sep.className = "tb-sep hidden";
  sep.id = "staging-publish-sep";
  const btn = document.createElement("button");
  btn.id = "staging-publish-asset-btn";
  btn.type = "button";
  btn.className = "tb-btn hidden";
  const stateBtn = document.createElement("button");
  stateBtn.id = "staging-save-state-btn";
  stateBtn.type = "button";
  stateBtn.className = "tb-btn hidden";
  toolbar.appendChild(sep);
  toolbar.appendChild(btn);
  toolbar.appendChild(stateBtn);
}
if (toolbar && !document.getElementById("builder-primary-save-btn")) {
  const btn = document.createElement("button");
  btn.id = "builder-primary-save-btn";
  btn.type = "button";
  btn.className = "tb-btn tb-primary hidden";
  btn.style.marginLeft = "auto";
  btn.style.fontWeight = "700";
  btn.style.border = "1px solid rgba(255,255,255,0.35)";
  btn.style.boxShadow = "0 0 0 2px rgba(59,130,246,0.25)";
  btn.textContent = "Save + Done";
  btn.addEventListener("click", async () => {
    if (!builderEditingAssetId || currentWorkspace !== "assetBuilder") return;
    await finishBuilderEditing(true);
  });
  toolbar.appendChild(btn);
  builderPrimarySaveBtn = btn;
}
updateWorkspaceTabUi();
updateBuilderPrimarySaveButton();
if (isStagingEditor) {
  setTimeout(() => { switchWorkspace("assetBuilder"); }, 0);
}

// DimSim is sim-only; editor asset-creation pipeline is disabled.
vibeCreatorApi = null;
// ── dimos integration mode boot ──────────────────────────────────────────────
// When dimosMode is active, auto-load a scene and spawn an agent, then connect
// the LCM bridge so sensor data flows and external /odom drives the agent.
if (dimosMode) {
  (async () => {
    try {
      // 1. Auto-load scene
      const sceneName = dimosScene || "hotel-lobby";
      console.log(`[dimos] Loading scene: ${sceneName}`);
      const resp = await fetch(`/sims/${sceneName}.json`);
      if (!resp.ok) throw new Error(`Scene fetch failed: HTTP ${resp.status}`);
      const sceneJson = await resp.json();
      await importLevelFromJSON(sceneJson);
      console.log(`[dimos] Scene loaded: ${sceneName}`);

      // 2. Auto-spawn agent (wait for physics to settle)
      await new Promise((r) => setTimeout(r, 1500));
      await ensureRapierLoaded();
      const agent = createAiAgent({ ephemeral: false });
      aiAgents.push(agent);
      // Place agent at a default spawn point
      const spawnPos = sceneJson.dimosSpawnPoint || { x: 2, y: 0.5, z: 3 };
      agent.setPosition(spawnPos.x, spawnPos.y, spawnPos.z);
      // Track yaw independently — reading from group.rotation.y (Three.js Euler)
      // can return stale/zero values during internal matrix recomposition.
      let _dimosYaw = 0;
      // Override the agent's update loop — in dimos mode, movement is driven
      // by /cmd_vel (Twist velocity commands) from the dimos navigation stack.
      // Uses the character controller for collision-aware movement (no clipping through furniture).
      agent.update = function(dt) {
        const bridge = window.__dimosBridge;
        if (!bridge) { this._syncVisual(); return; }
        const vel = bridge.getCmdVel();
        if (vel.linX !== 0 || vel.linY !== 0 || vel.linZ !== 0 || vel.angY !== 0) {
          const pos = this.body.translation();

          // Integrate angular velocity (yaw rotation about Y axis)
          _dimosYaw += vel.angY * dt;
          this.group.rotation.y = _dimosYaw;

          // Compute desired displacement in world frame
          const cosY = Math.cos(_dimosYaw);
          const sinY = Math.sin(_dimosYaw);
          const desired = {
            x: (vel.linZ * sinY + vel.linX * cosY) * dt,
            y: vel.linY * dt - 9.81 * dt * dt * 0.5, // gravity keeps agent grounded
            z: (vel.linZ * cosY - vel.linX * sinY) * dt,
          };

          // Use character controller for collision-aware movement
          if (this.controller && this.collider) {
            this.controller.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
            const m = this.controller.computedMovement();
            this.body.setNextKinematicTranslation({ x: pos.x + m.x, y: pos.y + m.y, z: pos.z + m.z });
          } else {
            this.body.setNextKinematicTranslation({ x: pos.x + desired.x, y: pos.y + desired.y, z: pos.z + desired.z });
          }
        } else {
          // Even with zero velocity, apply gravity to keep grounded
          const pos = this.body.translation();
          const desired = { x: 0, y: -9.81 * dt * dt * 0.5, z: 0 };
          if (this.controller && this.collider) {
            this.controller.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
            const m = this.controller.computedMovement();
            this.body.setNextKinematicTranslation({ x: pos.x + m.x, y: pos.y + m.y, z: pos.z + m.z });
          }
        }
        this._syncVisual();
      };
      console.log(`[dimos] Agent spawned: ${agent.id}`);

      // 3. Set up fast offscreen RGB capture for dimos (no splat warm-up delay)
      const _dimosCapW = 960, _dimosCapH = 432;
      const _dimosCapTarget = new THREE.WebGLRenderTarget(_dimosCapW, _dimosCapH, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false,
      });
      const _dimosCapCam = new THREE.PerspectiveCamera(80, _dimosCapW / _dimosCapH, camera.near, camera.far);
      const _dimosCapBuf = new Uint8Array(_dimosCapW * _dimosCapH * 4);
      const _dimosCapCvs = document.createElement("canvas");
      _dimosCapCvs.width = _dimosCapW;
      _dimosCapCvs.height = _dimosCapH;
      const _dimosCapCtx = _dimosCapCvs.getContext("2d");

      function _dimosCaptureRgb() {
        const [ax, ay, az] = agent.getPosition?.() || [0, 0, 0];
        const yaw = agent.group?.rotation?.y ?? 0;
        const pitch = typeof agent.pitch === "number" ? agent.pitch : 0;
        const cp = Math.cos(pitch), sp = Math.sin(pitch);
        const eyeY = ay + PLAYER_EYE_HEIGHT * 0.9;
        _dimosCapCam.position.set(ax, eyeY, az);
        _dimosCapCam.lookAt(ax + Math.sin(yaw)*cp, eyeY + sp, az + Math.cos(yaw)*cp);
        _dimosCapCam.updateProjectionMatrix();
        _dimosCapCam.updateMatrixWorld(true);

        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(_dimosCapTarget);
        renderer.render(scene, _dimosCapCam);
        renderer.setRenderTarget(prev);

        renderer.readRenderTargetPixels(_dimosCapTarget, 0, 0, _dimosCapW, _dimosCapH, _dimosCapBuf);
        // Flip Y
        const flipped = new Uint8ClampedArray(_dimosCapW * _dimosCapH * 4);
        const rowB = _dimosCapW * 4;
        for (let y = 0; y < _dimosCapH; y++) {
          flipped.set(_dimosCapBuf.subarray((_dimosCapH-1-y)*rowB, (_dimosCapH-y)*rowB), y*rowB);
        }
        _dimosCapCtx.putImageData(new ImageData(flipped, _dimosCapW, _dimosCapH), 0, 0);
        const dataUrl = _dimosCapCvs.toDataURL("image/jpeg", 0.75);
        const idx = dataUrl.indexOf("base64,");
        return idx !== -1 ? dataUrl.slice(idx + 7) : null;
      }

      // Offscreen depth capture from agent POV (uses main RGBD pipeline targets)
      function _dimosCaptureDepth() {
        const [ax, ay, az] = agent.getPosition?.() || [0, 0, 0];
        const yaw = agent.group?.rotation?.y ?? 0;
        const pitch = typeof agent.pitch === "number" ? agent.pitch : 0;
        const cp = Math.cos(pitch), sp = Math.sin(pitch);
        const eyeY = ay + PLAYER_EYE_HEIGHT * 0.9;
        _dimosCapCam.position.set(ax, eyeY, az);
        _dimosCapCam.lookAt(ax + Math.sin(yaw)*cp, eyeY + sp, az + Math.cos(yaw)*cp);
        _dimosCapCam.updateProjectionMatrix();
        _dimosCapCam.updateMatrixWorld(true);

        renderRgbdMetricPassOffscreen(_dimosCapCam);
        renderer.setRenderTarget(null);

        const depthData = readRgbdMetricDepthFrameMeters();
        if (!depthData) return null;

        const dw = rgbdMetricTarget.width, dh = rgbdMetricTarget.height;

        // Flip rows: WebGL reads bottom-to-top, image convention is top-to-bottom
        const flipped = new Float32Array(dw * dh);
        for (let y = 0; y < dh; y++) {
          flipped.set(depthData.subarray((dh - 1 - y) * dw, (dh - y) * dw), y * dw);
        }
        return { data: flipped, width: dw, height: dh };
      }

      // 4. Sidebar sensor panel setup (depth + LiDAR canvases)
      const _dimosSidebarW = 320, _dimosSidebarH = 145;
      const _dimosDepthCanvas = document.getElementById("agent-depth-canvas");
      const _dimosLidarCanvas = document.getElementById("agent-lidar-canvas");
      if (_dimosDepthCanvas) { _dimosDepthCanvas.width = _dimosSidebarW; _dimosDepthCanvas.height = _dimosSidebarH; }
      if (_dimosLidarCanvas) { _dimosLidarCanvas.width = _dimosSidebarW; _dimosLidarCanvas.height = _dimosSidebarH; }
      const _dimosDepthCtx = _dimosDepthCanvas?.getContext("2d");
      const _dimosLidarCtx = _dimosLidarCanvas?.getContext("2d");

      // Small offscreen render targets for sidebar panels
      const _dimosSidebarDepthTarget = new THREE.WebGLRenderTarget(_dimosSidebarW, _dimosSidebarH, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false,
      });
      const _dimosSidebarLidarTarget = new THREE.WebGLRenderTarget(_dimosSidebarW, _dimosSidebarH, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false,
      });
      const _dimosSidebarReadBuf = new Uint8Array(_dimosSidebarW * _dimosSidebarH * 4);

      // Helper: render a target, readback, flip Y, draw to 2D canvas
      function _dimosBlitToCanvas(rt, ctx, w, h) {
        renderer.readRenderTargetPixels(rt, 0, 0, w, h, _dimosSidebarReadBuf);
        const flipped = new Uint8ClampedArray(w * h * 4);
        const rowB = w * 4;
        for (let y = 0; y < h; y++) {
          flipped.set(_dimosSidebarReadBuf.subarray((h-1-y)*rowB, (h-y)*rowB), y*rowB);
        }
        ctx.putImageData(new ImageData(flipped, w, h), 0, 0);
      }

      /** Update the sidebar sensor panels (called after capture) */
      function _dimosUpdateSidebarPanels(rgbBase64) {
        if (window.__dimosHeadless) return;

        // RGB — set img src
        if (rgbBase64 && agentShotImgEl) {
          agentShotImgEl.src = `data:image/jpeg;base64,${rgbBase64}`;
        }

        // Depth — render colormap to small target, blit to canvas
        if (_dimosDepthCtx) {
          const prev = renderer.getRenderTarget();
          rgbdVizMaterial.uniforms.uGrayMode.value = rgbdVizMode === "gray" ? 1.0 : 0.0;
          renderer.setRenderTarget(_dimosSidebarDepthTarget);
          renderer.setClearColor(0x000000, 1);
          renderer.clear(true, true, true);
          renderer.render(rgbdVizScene, rgbdPostCamera);
          _dimosBlitToCanvas(_dimosSidebarDepthTarget, _dimosDepthCtx, _dimosSidebarW, _dimosSidebarH);
          renderer.setRenderTarget(prev);
        }

        // LiDAR — render lidar scene from agent POV to small target, blit to canvas
        if (_dimosLidarCtx) {
          const prev = renderer.getRenderTarget();
          // Save/restore scene visibility for lidar-only render
          const savedSplat = splatMesh ? splatMesh.visible : false;
          const savedSpark = sparkRendererMesh ? sparkRendererMesh.visible : false;
          const savedAssets = assetsGroup.visible;
          const savedPrims = primitivesGroup.visible;
          const savedLights = lightsGroup.visible;
          const savedTags = tagsGroup.visible;
          const savedLidar = lidarVizGroup.visible;
          const savedOverlay = rgbdPcOverlayGroup.visible;
          const savedBg = scene.background;

          if (splatMesh) splatMesh.visible = false;
          if (sparkRendererMesh) sparkRendererMesh.visible = false;
          assetsGroup.visible = false;
          primitivesGroup.visible = false;
          lightsGroup.visible = false;
          tagsGroup.visible = false;
          lidarVizGroup.visible = true;
          rgbdPcOverlayGroup.visible = false;
          scene.background = RGBD_BG;

          renderer.setRenderTarget(_dimosSidebarLidarTarget);
          renderer.setClearColor(0x000000, 1);
          renderer.clear(true, true, true);
          renderer.render(scene, _dimosCapCam);

          // Restore
          if (splatMesh) splatMesh.visible = savedSplat;
          if (sparkRendererMesh) sparkRendererMesh.visible = savedSpark;
          assetsGroup.visible = savedAssets;
          primitivesGroup.visible = savedPrims;
          lightsGroup.visible = savedLights;
          tagsGroup.visible = savedTags;
          lidarVizGroup.visible = savedLidar;
          rgbdPcOverlayGroup.visible = savedOverlay;
          scene.background = savedBg;

          _dimosBlitToCanvas(_dimosSidebarLidarTarget, _dimosLidarCtx, _dimosSidebarW, _dimosSidebarH);
          renderer.setRenderTarget(prev);
        }
      }

      // 5. Connect dimos bridge
      let _lastRgbBase64 = null;
      const { DimosBridge } = await import("./dimos/dimosBridge.ts");
      const bridge = new DimosBridge({
        agent,
        sensorSources: {
          captureRgb: () => {
            const b64 = _dimosCaptureRgb();
            _lastRgbBase64 = b64;
            return Promise.resolve(b64);
          },
          captureDepth: () => _dimosCaptureDepth(),
          captureLidar: () => {
            // Return world-frame points (Three.js Y-up).
            // Bridge converts Y-up → ROS Z-up and labels frame_id="world".
            const lLen = _lidarLatestWorldPts ? _lidarLatestWorldPts.length : -1;
            if (lLen > 0) {
              return {
                points: _lidarLatestWorldPts,
                intensity: _lidarLatestWorldIntensity,
                numPoints: lLen / 3,
              };
            }
            const frames = window.__robovalLidar?.getLatestFrames?.();
            const src = frames?.raw;
            if (!src) return null;
            return { points: src.points, intensity: src.intensity, numPoints: src.points?.length / 3 || 0 };
          },
          getOdomPose: () => {
            const pos = agent.getPosition?.();
            if (!pos) return null; // skip this frame instead of fallback to origin
            const [ax, ay, az] = pos;
            const qw = Math.cos(_dimosYaw / 2);
            const qy = Math.sin(_dimosYaw / 2);
            return { x: ax, y: ay, z: az, qx: 0, qy, qz: 0, qw };
          },
        },
      });

      // Hook: after _publishSensors, capture RGB locally for panels + publish lidar
      const origPublishSensors = bridge._publishSensors.bind(bridge);
      bridge._publishSensors = function() {
        origPublishSensors();
        // Capture RGB for sidebar display only (not sent over WebSocket)
        _lastRgbBase64 = _dimosCaptureRgb();
        _dimosUpdateSidebarPanels(_lastRgbBase64);
      };

      bridge.connect();
      window.__dimosBridge = bridge;
      window.__dimosAgent = agent;
      // Expose yaw for lidar pose sampling (avoids reading Three.js Euler)
      Object.defineProperty(window, '__dimosYaw', { get: () => _dimosYaw });

      // Odom: publish on a standalone setInterval (not rAF) so it runs even when tab is backgrounded.
      // rAF pauses when the tab loses focus, but odom must keep flowing for the planner.
      setInterval(() => {
        if (bridge._connected) {
          bridge._publishOdom();
        }
      }, bridge.rates.odom);

      // Eval harness disabled — focusing on dimos integration.
      // Re-enable by importing evalHarness.ts when eval workflows are needed.

      // Auto-open Agent Vision panel in dimos mode
      if (!window.__dimosHeadless) {
        const visionDetails = document.getElementById("agent-vision-details");
        if (visionDetails) visionDetails.setAttribute("open", "");
      }

      // 7. Debug panel (integration diagnostics)
      if (!window.__dimosHeadless) {
        const dbg = document.createElement("div");
        dbg.id = "dimos-debug";
        dbg.style.cssText = "position:fixed;bottom:8px;left:8px;z-index:99999;background:rgba(0,0,0,0.88);color:#0f0;font:11px/1.4 monospace;padding:10px 14px;border-radius:8px;max-width:460px;max-height:400px;overflow-y:auto;pointer-events:auto;user-select:text;";
        document.body.appendChild(dbg);

        const _dbgState = {
          bridgeConn: false,
          sensorFps: 0,
          agentPos: { x: 0, y: 0, z: 0 },
          agentYaw: 0,
          cmdVel: { angY: 0, linZ: 0 },
          _sensorCount: 0,
          _sensorLastTs: Date.now(),
        };

        // Hook sensor publish for FPS counter
        const _origPubSensors2 = bridge._publishSensors;
        bridge._publishSensors = function() {
          _dbgState._sensorCount++;
          _origPubSensors2.call(bridge);
        };

        // Update loop
        setInterval(() => {
          const now = Date.now();
          const dt = (now - _dbgState._sensorLastTs) / 1000;
          if (dt >= 1) {
            _dbgState.sensorFps = Math.round(_dbgState._sensorCount / dt);
            _dbgState._sensorCount = 0;
            _dbgState._sensorLastTs = now;
          }

          const [ax, ay, az] = agent.getPosition?.() || [0, 0, 0];
          _dbgState.agentPos = { x: ax.toFixed(2), y: ay.toFixed(2), z: az.toFixed(2) };
          _dbgState.agentYaw = (agent.group?.rotation?.y ?? 0).toFixed(3);
          _dbgState.bridgeConn = bridge.ws?.readyState === WebSocket.OPEN;
          const vel = bridge.getCmdVel();
          _dbgState.cmdVel = { angY: vel.angY.toFixed(3), linZ: vel.linZ.toFixed(3) };

          dbg.innerHTML = `
            <div style="color:#fff;font-weight:bold;margin-bottom:4px;">dimos integration</div>
            <div>Bridge: ${_dbgState.bridgeConn ? '<span style="color:#0f0">connected</span>' : '<span style="color:#f00">disconnected</span>'} | Sensors: ${_dbgState.sensorFps} fps</div>
            <div>Agent: (${_dbgState.agentPos.x}, ${_dbgState.agentPos.y}, ${_dbgState.agentPos.z}) yaw=${_dbgState.agentYaw}</div>
            <div>cmd_vel: angY=${_dbgState.cmdVel.angY} linZ=${_dbgState.cmdVel.linZ}</div>
          `;
        }, 500);
      }

      console.log("[dimos] Bridge connected. Sensor publishing active.");
    } catch (err) {
      console.error("[dimos] Initialization failed:", err);
    }
  })();
}
