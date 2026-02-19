/**
 * DimosBridge -- Browser-side WebSocket<->LCM client for dimos integration.
 *
 * Subscribes to /odom (PoseStamped) to drive agent position/orientation.
 * Publishes sensor data (RGB Image, Depth Image, LiDAR PointCloud2) as LCM
 * packets encoded with @dimos/msgs and sent over WebSocket to the Deno bridge.
 */

// @ts-ignore -- CDN import, no local type definitions
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
// Single unified capture rate for synchronized sensor publishing.
const DEFAULT_RATES: PublishRates = { capture: 200 }; // 5 Hz — all sensors in lockstep

// -- Types --------------------------------------------------------------------

export interface PublishRates {
  capture: number;
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
  capture: boolean;
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

  // Eval harness hooks -- the eval system can listen to bridge events.
  _onCmdVel: ((twist: any) => void) | null;
  _onSensorSent: ((type: string, msg: any) => void) | null;

  constructor({ wsUrl, agent, sensorSources, rates, frameTransform }: DimosBridgeOptions) {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    this.wsUrl = wsUrl || `${protocol}//${location.host}`;
    this.agent = agent;
    this.sensors = sensorSources;
    this.rates = { ...DEFAULT_RATES, ...rates };
    this.frameTransform = frameTransform || "identity";
    this.ws = null;
    this._timers = {};
    this._dirty = { capture: false };
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
    // Eval harness or other systems can add more channel handlers here.
  }

  _handleCmdVel(twist: any): void {
    const lin = twist.linear;
    const ang = twist.angular;

    let linX: number, linY: number, linZ: number;
    let angX: number, angY: number, angZ: number;

    if (this.frameTransform === "ros") {
      // ROS Twist: linear (x=fwd, y=left, z=up), angular (z=yaw)
      // Three.js: x=right, y=up, z=fwd
      linX = -lin.y;   // ROS left -> Three.js -X
      linY = lin.z;    // ROS up -> Three.js Y
      linZ = lin.x;    // ROS fwd -> Three.js Z
      angX = -ang.y;
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

  /** Get current velocity, auto-zeroing after 500ms of no updates (safety stop). */
  getCmdVel(): { linX: number; linY: number; linZ: number; angX: number; angY: number; angZ: number } {
    if (!this._cmdVel || Date.now() - this._cmdVelStamp > 500) {
      return { linX: 0, linY: 0, linZ: 0, angX: 0, angY: 0, angZ: 0 };
    }
    return this._cmdVel;
  }

  // -- Outgoing sensor data ---------------------------------------------------

  _startPublishing(): void {
    // Single timer marks all sensors dirty at a unified rate.
    // The engine's tick() loop checks _dirty.capture and calls _publishAll()
    // to stay perfectly synchronized with the render loop.
    this._timers.capture = setInterval(() => { this._dirty.capture = true; }, this.rates.capture);
  }

  /** Capture and publish all sensors + odom with a shared timestamp. */
  _publishAll(): void {
    const now = Date.now();
    const header = (frameId: string) => new std_msgs.Header({
      stamp: new std_msgs.Time({ sec: Math.floor(now / 1000), nsec: (now % 1000) * 1_000_000 }),
      frame_id: frameId,
    });
    this._publishOdomSync(header("base_link"));
    this._publishRgbSync(header("camera_link"));
    this._publishDepthSync(header("camera_link"));
    this._publishLidarSync(header("lidar_link"));
  }

  // -- Odom (agent pose feedback to dimos) ------------------------------------

  _publishOdomSync(header: any): void {
    try {
      const pose = this.sensors.getOdomPose();
      if (!pose) return;

      const odomMsg = new geometry_msgs.PoseStamped({
        header,
        pose: new geometry_msgs.Pose({
          position: new geometry_msgs.Point({ x: pose.x, y: pose.y, z: pose.z }),
          orientation: new geometry_msgs.Quaternion({ x: pose.qx, y: pose.qy, z: pose.qz, w: pose.qw }),
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

      for (let i = 0; i < numPoints; i++) {
        const off = i * pointStep;
        view.setFloat32(off, pts[i * 3], true);
        view.setFloat32(off + 4, pts[i * 3 + 1], true);
        view.setFloat32(off + 8, pts[i * 3 + 2], true);
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

  // -- Eval harness command channel -------------------------------------------
  // The bridge also relays JSON commands from the Deno eval runner.
  // These arrive on the same WebSocket but as text (not binary).

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
