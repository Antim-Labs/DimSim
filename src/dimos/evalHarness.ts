/**
 * EvalHarness -- Browser-side eval orchestrator for dimos integration.
 *
 * Manages workflow execution lifecycle:
 * 1. Receives commands from the Deno eval runner via DimosBridge (WebSocket text messages)
 * 2. Hot-loads environments by calling importLevelFromJSON (no page reload)
 * 3. Teleports agent to workflow start pose
 * 4. Tracks object state each frame (positions from Rapier physics)
 * 5. Captures eval snapshots for LLM judge
 * 6. Computes rubric scores and sends results back to runner
 */

import {
  scoreObjectDistance,
  scoreLlmJudge,
  scoreGroundTruth,
  type SceneState,
  type ObjectDistanceCriteria,
  type GroundTruthCriteria,
  type LlmJudgeCriteria,
  type TrajectoryPoint,
} from "./rubrics.ts";
import type { DimosBridge } from "./dimosBridge.ts";

// -- Types --------------------------------------------------------------------

export interface AgentPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface StartPose {
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
}

export interface SuccessCriteria {
  objectDistance?: ObjectDistanceCriteria;
  groundTruth?: GroundTruthCriteria;
  llmJudge?: LlmJudgeCriteria;
}

export interface Workflow {
  name: string;
  task: string;
  environment?: string;
  startPose?: StartPose;
  timeoutSec?: number;
  successCriteria?: SuccessCriteria;
}

interface EvalCommand {
  type: string;
  scene?: string;
  workflow?: Workflow;
  [key: string]: any;
}

export interface EvalHarnessOptions {
  bridge: DimosBridge;
  importLevel: (json: any) => Promise<void>;
  captureRgb: () => Promise<string | null>;
  getSceneState: () => SceneState;
  getAgentPose: () => AgentPose | null;
}

// Extend Window to include __dimosAgent
declare global {
  interface Window {
    __dimosAgent?: any;
  }
}

export class EvalHarness {
  bridge: DimosBridge;
  importLevel: (json: any) => Promise<void>;
  captureRgb: () => Promise<string | null>;
  getSceneState: () => SceneState;
  getAgentPose: () => AgentPose | null;

  _workflow: Workflow | null;
  _startTime: number;
  _snapshots: string[];
  _trajectory: TrajectoryPoint[];
  _trackingInterval: ReturnType<typeof setInterval> | null;
  _timeoutTimer: ReturnType<typeof setTimeout> | null;
  _originalOnMessage: ((event: MessageEvent) => void) | null;

  constructor({ bridge, importLevel, captureRgb, getSceneState, getAgentPose }: EvalHarnessOptions) {
    this.bridge = bridge;
    this.importLevel = importLevel;
    this.captureRgb = captureRgb;
    this.getSceneState = getSceneState;
    this.getAgentPose = getAgentPose;

    this._workflow = null;
    this._startTime = 0;
    this._snapshots = [];
    this._trajectory = [];
    this._trackingInterval = null;
    this._timeoutTimer = null;

    // Listen for commands from the eval runner (Deno side)
    this._originalOnMessage = null;
    this._hookBridgeMessages();
  }

  _hookBridgeMessages(): void {
    // Wrap bridge.connect so we re-hook after any reconnection
    const origConnect = this.bridge.connect.bind(this.bridge);
    this.bridge.connect = () => {
      origConnect();
      // Re-hook the new WebSocket after connect() creates it
      setTimeout(() => {
        const ws = this.bridge.ws;
        if (ws) this._patchWsOnMessage(ws);
      }, 100);
    };

    // Hook current WS if already connected
    const ws = this.bridge.ws;
    if (ws) this._patchWsOnMessage(ws);
  }

  _patchWsOnMessage(ws: WebSocket): void {
    const origOnMessage = ws.onmessage;
    ws.onmessage = (event: MessageEvent) => {
      // Text messages are eval commands; binary messages are LCM packets
      if (typeof event.data === "string") {
        try {
          const cmd: EvalCommand = JSON.parse(event.data);
          this._handleCommand(cmd);
        } catch {
          // Not valid JSON -- ignore
        }
        return;
      }
      // Forward binary to original handler
      if (origOnMessage) (origOnMessage as (event: MessageEvent) => void).call(ws, event);
    };
  }

  async _handleCommand(cmd: EvalCommand): Promise<void> {
    console.log("[eval] command:", cmd.type, cmd);

    switch (cmd.type) {
      case "loadEnv":
        await this._loadEnvironment(cmd.scene!);
        this.bridge.sendCommand({ type: "envReady", scene: cmd.scene });
        break;

      case "startWorkflow":
        await this._startWorkflow(cmd.workflow!);
        break;

      case "stopWorkflow":
        await this._stopWorkflow("runner-requested");
        break;

      case "ping":
        this.bridge.sendCommand({ type: "pong", ts: Date.now() });
        break;

      default:
        console.warn("[eval] unknown command:", cmd.type);
    }
  }

  // -- Environment loading ----------------------------------------------------

  async _loadEnvironment(sceneName: string): Promise<void> {
    console.log(`[eval] loading environment: ${sceneName}`);
    try {
      const resp = await fetch(`/sims/${sceneName}.json`);
      if (!resp.ok) throw new Error(`Scene fetch failed: HTTP ${resp.status}`);
      const json = await resp.json();
      await this.importLevel(json);
      console.log(`[eval] environment loaded: ${sceneName}`);
    } catch (err: any) {
      console.error("[eval] loadEnv failed:", err);
      this.bridge.sendCommand({ type: "envError", error: String(err.message || err) });
    }
  }

  // -- Workflow execution -----------------------------------------------------

  async _startWorkflow(workflow: Workflow): Promise<void> {
    this._workflow = workflow;
    this._startTime = Date.now();
    this._snapshots = [];
    this._trajectory = [];

    console.log(`[eval] starting workflow: ${workflow.name} -- "${workflow.task}"`);

    // Teleport agent to start pose
    if (workflow.startPose) {
      const p = workflow.startPose;
      const agent = window.__dimosAgent;
      if (agent) {
        agent.setPosition(p.x ?? 0, p.y ?? 0.5, p.z ?? 0);
        if (p.yaw !== undefined) {
          agent.group.rotation.y = (p.yaw * Math.PI) / 180;
        }
      }
    }

    // Start tracking object state
    this._trackingInterval = setInterval(() => this._trackFrame(), 1000);

    // Timeout
    const timeoutMs = (workflow.timeoutSec || 120) * 1000;
    this._timeoutTimer = setTimeout(() => {
      this._stopWorkflow("timeout");
    }, timeoutMs);

    this.bridge.sendCommand({ type: "workflowStarted", name: workflow.name });
  }

  _trackFrame(): void {
    const pose = this.getAgentPose();
    if (pose) {
      this._trajectory.push({ ts: Date.now() - this._startTime, ...pose });
    }
  }

  async _stopWorkflow(reason: string): Promise<void> {
    if (!this._workflow) return;

    if (this._trackingInterval) clearInterval(this._trackingInterval);
    if (this._timeoutTimer) clearTimeout(this._timeoutTimer);
    this._trackingInterval = null;
    this._timeoutTimer = null;

    console.log(`[eval] workflow stopped: ${this._workflow.name} (${reason})`);

    // Capture final snapshot for LLM judge
    let finalSnapshot: string | null = null;
    try {
      finalSnapshot = await this.captureRgb();
    } catch { /* best effort */ }

    // Score rubrics
    const sceneState = this.getSceneState();

    // Inject agent position as a virtual tag so rubrics can reference "agent"
    const agentPose = this.getAgentPose();
    if (agentPose) {
      if (!sceneState.tags) sceneState.tags = [];
      sceneState.tags.push({
        label: "agent", id: "agent",
        position: { x: agentPose.x, y: agentPose.y, z: agentPose.z },
      });
    }

    const criteria = this._workflow.successCriteria || {};
    const scores: Record<string, any> = {};

    if (criteria.objectDistance) {
      scores.objectDistance = scoreObjectDistance(criteria.objectDistance, sceneState);
    }

    if (criteria.groundTruth) {
      scores.groundTruth = scoreGroundTruth(criteria.groundTruth, sceneState);
    }

    if (criteria.llmJudge) {
      scores.llmJudge = await scoreLlmJudge(criteria.llmJudge, {
        task: this._workflow.task,
        finalSnapshot,
        trajectory: this._trajectory,
        sceneState,
      });
    }

    const result = {
      type: "workflowComplete",
      name: this._workflow.name,
      environment: this._workflow.environment,
      reason,
      durationMs: Date.now() - this._startTime,
      trajectory: this._trajectory,
      rubricScores: scores,
    };

    console.log("[eval] result:", result);
    this.bridge.sendCommand(result);

    this._workflow = null;
  }

  dispose(): void {
    if (this._trackingInterval) clearInterval(this._trackingInterval);
    if (this._timeoutTimer) clearTimeout(this._timeoutTimer);
  }
}
