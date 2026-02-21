/**
 * DimosBridge — Browser-side WebSocket client for dimos integration.
 *
 * Simulates a robot's sensor/command interface over WebSocket:
 *   Publishes → /odom, /color_image, /depth_image, /lidar  (sensor data to dimos)
 *   Subscribes → /cmd_vel                                   (velocity commands from dimos)
 *
 * All messages are LCM-encoded binary packets using @dimos/msgs, sent over
 * WebSocket to the bridge server which relays them to/from dimos via LCM/UDP.
 *
 * From dimos's perspective, this looks identical to a real robot.
 */

// @ts-ignore — CDN import (runs in browser, no Deno/Node type resolution)
import {
  encodePacket,
  decodePacket,
  geometry_msgs,
  sensor_msgs,
  std_msgs,
} from "https://esm.sh/jsr/@dimos/msgs@0.1.4";

// -- Channels ----------------------------------------------------------------
// Channel names match dimos Python convention: /{stream_name}#{msg_type}
const CH_CMD_VEL = "/cmd_vel#geometry_msgs.Twist";
const CH_ODOM = "/odom#geometry_msgs.PoseStamped";
const CH_IMAGE = "/color_image#sensor_msgs.Image";
const CH_DEPTH = "/depth_image#sensor_msgs.Image";
const CH_LIDAR = "/lidar#sensor_msgs.PointCloud2";

// -- Default publish rates (ms) ----------------------------------------------
// Odom needs fast updates (10 Hz) for planner tracking.
// Sensors (RGB/depth/LiDAR) can be slower to reduce memory pressure.
const DEFAULT_RATES: PublishRates = { odom: 100, sensors: 500 }; // 10 Hz odom, 2 Hz sensors

// -- Types --------------------------------------------------------------------

export interface PublishRates {
  odom: number;
  sensors: number;
}

export interface DepthFrame {
  data: Float32Array;
  width: number;
  height: number;
}

export interface LidarFrame {
  numPoints: number;
  points: Float32Array;    // N*3 interleaved XYZ
  intensity?: Float32Array; // N
}

export interface OdomPose {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
}

export interface SensorSources {
  captureRgb: () => Promise<string | null>;
  captureDepth: () => DepthFrame | null;
  captureLidar: () => LidarFrame | null;
  getOdomPose: () => OdomPose | null;
}

export type FrameTransform = "identity" | "ros";

export interface DimosBridgeOptions {
  wsUrl?: string;
  agent: any;
  sensorSources: SensorSources;
  rates?: Partial<PublishRates>;
  frameTransform?: FrameTransform;
}

interface DirtyFlags {
  odom: boolean;
  sensors: boolean;
}

export class DimosBridge {
  wsUrl: string;
  agent: any;
  sensors: SensorSources;
  rates: PublishRates;
  frameTransform: FrameTransform;
  ws: WebSocket | null;

  _timers: Record<string, ReturnType<typeof setInterval>>;
  _dirty: DirtyFlags;
  _rafId: number | null;
  _connected: boolean;

  // Latest velocity command — integrated each frame by agent.update()
  _cmdVel: { linX: number; linY: number; linZ: number; angX: number; angY: number; angZ: number } | null;
  _cmdVelStamp: number; // Date.now() when last received — auto-zero after timeout

  // Hooks for eval harness and debug tooling
  _onCmdVel: ((twist: any) => void) | null;
  _onSensorSent: ((type: string, msg: any) => void) | null;

  constructor({ wsUrl, agent, sensorSources, rates, frameTransform }: DimosBridgeOptions) {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    this.wsUrl = wsUrl || `${protocol}//${location.host}`;
    this.agent = agent;
    this.sensors = sensorSources;
    this.rates = { ...DEFAULT_RATES, ...rates };
    this.frameTransform = frameTransform || "ros";
    this.ws = null;
    this._timers = {};
    this._dirty = { odom: false, sensors: false };
    this._rafId = null;
    this._connected = false;

    this._cmdVel = null;
    this._cmdVelStamp = 0;
    this._onCmdVel = null;
    this._onSensorSent = null;
  }

  connect(): void {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      console.log("[DimosBridge] connected to", this.wsUrl);
      this._connected = true;
      this._startPublishing();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      try {
        const { channel, data } = decodePacket(new Uint8Array(event.data));
        this._handlePacket(channel, data);
      } catch (e) {
        console.warn("[DimosBridge] decode error:", e);
      }
    };

    this.ws.onclose = () => {
      console.log("[DimosBridge] disconnected, reconnecting in 2s...");
      this._connected = false;
      this._stopPublishing();
      setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  // -- Incoming packets -------------------------------------------------------

  _handlePacket(channel: string, data: any): void {
    if (channel === CH_CMD_VEL) {
      this._handleCmdVel(data);
    }
  }

  _handleCmdVel(twist: any): void {
    const lin = twist.linear;
    const ang = twist.angular;

    let linX: number, linY: number, linZ: number;
    let angX: number, angY: number, angZ: number;

    if (this.frameTransform === "ros") {
      // ROS Z-up → Three.js Y-up: inverse cyclic permutation.
      // Three_x = ROS_y (left),  Three_y = ROS_z (up),  Three_z = ROS_x (fwd)
      linX = lin.y;    // ROS left (+Y) -> Three.js +X
      linY = lin.z;    // ROS up   (+Z) -> Three.js +Y
      linZ = lin.x;    // ROS fwd  (+X) -> Three.js +Z
      angX = ang.y;
      angY = ang.z;    // ROS yaw (about Z) -> Three.js yaw (about Y)
      angZ = ang.x;
    } else {
      // Identity — Three.js conventions directly
      linX = lin.x;
      linY = lin.y;
      linZ = lin.z;
      angX = ang.x;
      angY = ang.y;
      angZ = ang.z;
    }

    this._cmdVel = { linX, linY, linZ, angX, angY, angZ };
    this._cmdVelStamp = Date.now();

    if (this._onCmdVel) this._onCmdVel(twist);
  }

  /** Get current velocity, auto-zeroing after timeout of no updates (safety stop).
   *  1500ms accommodates the dimos pipeline latency (~200-400ms between commands). */
  getCmdVel(): { linX: number; linY: number; linZ: number; angX: number; angY: number; angZ: number } {
    if (!this._cmdVel || Date.now() - this._cmdVelStamp > 1500) {
      return { linX: 0, linY: 0, linZ: 0, angX: 0, angY: 0, angZ: 0 };
    }
    return this._cmdVel;
  }

  // -- Outgoing sensor data ---------------------------------------------------

  _startPublishing(): void {
    // Separate timers: odom fast (10 Hz), sensors slower (2 Hz) to reduce memory pressure.
    this._timers.odom = setInterval(() => { this._dirty.odom = true; }, this.rates.odom);
    this._timers.sensors = setInterval(() => { this._dirty.sensors = true; }, this.rates.sensors);
  }

  _makeHeader(frameId: string): any {
    const now = Date.now();
    return new std_msgs.Header({
      stamp: new std_msgs.Time({ sec: Math.floor(now / 1000), nsec: (now % 1000) * 1_000_000 }),
      frame_id: frameId,
    });
  }

  /** Publish odom only (called at high rate). */
  _publishOdom(): void {
    this._publishOdomSync(this._makeHeader("base_link"));
  }

  /** Capture and publish sensor data (called at lower rate). */
  _publishSensors(): void {
    this._publishOdomSync(this._makeHeader("base_link"));
    this._publishRgbSync(this._makeHeader("camera_link"));
    this._publishDepthSync(this._makeHeader("camera_link"));
    this._publishLidarSync(this._makeHeader("lidar_link"));
  }

  // -- Odom (agent pose feedback to dimos) ------------------------------------

  _publishOdomSync(header: any): void {
    try {
      const pose = this.sensors.getOdomPose();
      if (!pose) return;

      // Three.js is Y-up (X-right, Y-up, Z-forward); dimos expects Z-up
      // (X-forward, Y-left, Z-up).  The correct mapping is a cyclic
      // permutation: ROS_x = Three_z, ROS_y = Three_x, ROS_z = Three_y.
      // Quaternion imaginary components follow the same permutation.
      const odomMsg = new geometry_msgs.PoseStamped({
        header,
        pose: new geometry_msgs.Pose({
          position: new geometry_msgs.Point({ x: pose.z, y: pose.x, z: pose.y }),
          orientation: new geometry_msgs.Quaternion({ x: pose.qz, y: pose.qx, z: pose.qy, w: pose.qw }),
        }),
      });

      this._send(CH_ODOM, odomMsg);
    } catch (e) {
      console.warn("[DimosBridge] odom publish error:", e);
    }
  }

  _stopPublishing(): void {
    for (const k of Object.keys(this._timers)) clearInterval(this._timers[k]);
    this._timers = {};
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  _send(channel: string, msg: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const packet = encodePacket(channel, msg);
    this.ws.send(packet);
    if (this._onSensorSent) this._onSensorSent(channel, msg);
  }

  // -- RGB (JPEG passthrough) -------------------------------------------------

  async _publishRgbSync(header: any): Promise<void> {
    try {
      const base64 = await this.sensors.captureRgb();
      if (!base64) return;

      // Decode base64 -> raw JPEG bytes (avoid expensive canvas round-trip).
      const binaryStr = atob(base64);
      const jpegBytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) jpegBytes[i] = binaryStr.charCodeAt(i);

      // Parse JPEG dimensions from SOF0 marker.
      const dims = _parseJpegDimensions(jpegBytes);

      const imageMsg = new sensor_msgs.Image({
        header,
        height: dims.height,
        width: dims.width,
        encoding: "jpeg",
        is_bigendian: 0,
        step: 0, // not applicable for compressed
        data_length: jpegBytes.length,
        data: jpegBytes,
      });

      this._send(CH_IMAGE, imageMsg);
    } catch (e) {
      console.warn("[DimosBridge] RGB publish error:", e);
    }
  }

  // -- Depth (Float32 metric) -------------------------------------------------

  _publishDepthSync(header: any): void {
    try {
      const frame = this.sensors.captureDepth();
      if (!frame) return;

      const depthBytes = new Uint8Array(
        frame.data.buffer, frame.data.byteOffset, frame.data.byteLength
      );

      const depthMsg = new sensor_msgs.Image({
        header,
        height: frame.height,
        width: frame.width,
        encoding: "32FC1",
        is_bigendian: 0,
        step: frame.width * 4,
        data_length: depthBytes.length,
        data: depthBytes,
      });

      this._send(CH_DEPTH, depthMsg);
    } catch (e) {
      console.warn("[DimosBridge] depth publish error:", e);
    }
  }

  // -- LiDAR (PointCloud2) ----------------------------------------------------

  _publishLidarSync(header: any): void {
    try {
      const frame = this.sensors.captureLidar();
      if (!frame) return;

      const numPoints = frame.numPoints || 0;
      if (numPoints === 0) return;

      // Pack XYZ + intensity into interleaved float32 buffer (16 bytes/point).
      const pointStep = 16;
      const buf = new ArrayBuffer(numPoints * pointStep);
      const view = new DataView(buf);
      const pts = frame.points;         // Float32Array[N*3]
      const intensity = frame.intensity; // Float32Array[N]

      // Three.js Y-up → ROS Z-up: cyclic permutation (x,y,z) → (z,x,y).
      // ROS_x = Three_z, ROS_y = Three_x, ROS_z = Three_y.
      for (let i = 0; i < numPoints; i++) {
        const off = i * pointStep;
        view.setFloat32(off, pts[i * 3 + 2], true);     // ROS X = Three.js Z (forward)
        view.setFloat32(off + 4, pts[i * 3], true);     // ROS Y = Three.js X (left)
        view.setFloat32(off + 8, pts[i * 3 + 1], true); // ROS Z = Three.js Y (up)
        view.setFloat32(off + 12, intensity ? intensity[i] : 1.0, true);
      }

      const dataBytes = new Uint8Array(buf);
      const pc2Msg = new sensor_msgs.PointCloud2({
        header,
        height: 1,
        width: numPoints,
        fields_length: 4,
        fields: [
          new sensor_msgs.PointField({ name: "x", offset: 0, datatype: 7, count: 1 }),
          new sensor_msgs.PointField({ name: "y", offset: 4, datatype: 7, count: 1 }),
          new sensor_msgs.PointField({ name: "z", offset: 8, datatype: 7, count: 1 }),
          new sensor_msgs.PointField({ name: "intensity", offset: 12, datatype: 7, count: 1 }),
        ],
        is_bigendian: 0,
        point_step: pointStep,
        row_step: numPoints * pointStep,
        data_length: dataBytes.length,
        data: dataBytes,
        is_dense: 1,
      });

      this._send(CH_LIDAR, pc2Msg);
    } catch (e) {
      console.warn("[DimosBridge] LiDAR publish error:", e);
    }
  }

  /** Send a JSON text command (used by eval harness for runner communication). */
  sendCommand(cmd: Record<string, any>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(cmd));
  }

  dispose(): void {
    this._stopPublishing();
    if (this.ws) { this.ws.onclose = null; this.ws.close(); }
    this.ws = null;
  }
}

// -- Helpers ------------------------------------------------------------------

interface JpegDimensions {
  width: number;
  height: number;
}

/** Parse width/height from JPEG SOF0/SOF2 marker. */
function _parseJpegDimensions(bytes: Uint8Array): JpegDimensions {
  // Scan for SOF markers (0xFF 0xC0 through 0xFF 0xCF, excluding 0xC4 and 0xC8).
  for (let i = 0; i < bytes.length - 9; i++) {
    if (bytes[i] !== 0xff) continue;
    const marker = bytes[i + 1];
    if (
      (marker >= 0xc0 && marker <= 0xcf) &&
      marker !== 0xc4 &&
      marker !== 0xc8
    ) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return { width, height };
    }
  }
  // Fallback -- DimSim default capture size
  return { width: 960, height: 432 };
}
