/**
 * DimosBridge — Browser-side WebSocket client for dimos integration.
 *
 * Uses TWO WebSocket connections to prevent large sensor data from blocking
 * real-time odom/cmd_vel:
 *   wsControl  → /odom, /cmd_vel  (tiny packets, real-time)
 *   wsSensors  → /color_image, /depth_image, /lidar  (large packets, can lag)
 *
 * All messages are LCM-encoded binary packets using @dimos/msgs, sent over
 * WebSocket to the bridge server which relays them to/from dimos via LCM/UDP.
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
const CH_CMD_VEL = "/cmd_vel#geometry_msgs.Twist";
const CH_ODOM = "/odom#geometry_msgs.PoseStamped";
const CH_IMAGE = "/color_image#sensor_msgs.Image";
const CH_DEPTH = "/depth_image#sensor_msgs.Image";
const CH_LIDAR = "/lidar#sensor_msgs.PointCloud2";

// -- Default publish rates (ms) ----------------------------------------------
const DEFAULT_RATES: PublishRates = { odom: 50, lidar: 200, images: 500 }; // 20 Hz odom, 5 Hz lidar, 2 Hz images

// -- Types --------------------------------------------------------------------

export interface PublishRates { odom: number; lidar: number; images: number; }

export interface RgbFrame {
  data: Uint8Array;
  width: number;
  height: number;
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
  captureRgb: () => RgbFrame | null;
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

export class DimosBridge {
  wsUrl: string;
  agent: any;
  sensors: SensorSources;
  rates: PublishRates;
  frameTransform: FrameTransform;

  // Two separate WebSocket connections
  wsControl: WebSocket | null;   // odom + cmd_vel (tiny, real-time)
  wsSensors: WebSocket | null;   // images + lidar (large, can lag)

  // Keep legacy .ws alias pointing to control for compatibility
  get ws(): WebSocket | null { return this.wsControl; }

  _timers: Record<string, ReturnType<typeof setInterval>>;
  _dirty: { odom: boolean; lidar: boolean; images: boolean };
  _rafId: number | null;
  _connected: boolean;

  _cmdVel: { linX: number; linY: number; linZ: number; angX: number; angY: number; angZ: number } | null;
  _cmdVelStamp: number;
  _serverLidar: boolean;

  constructor({ wsUrl, agent, sensorSources, rates, frameTransform }: DimosBridgeOptions) {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    this.wsUrl = wsUrl || `${protocol}//${location.host}`;
    this.agent = agent;
    this.sensors = sensorSources;
    this.rates = { ...DEFAULT_RATES, ...rates };
    this.frameTransform = frameTransform || "ros";
    this.wsControl = null;
    this.wsSensors = null;
    this._timers = {};
    this._dirty = { odom: false, lidar: false, images: false };
    this._rafId = null;
    this._connected = false;
    this._cmdVel = null;
    this._cmdVelStamp = 0;
    this._serverLidar = false;
  }

  connect(): void {
    // Control socket: odom out, cmd_vel in
    this.wsControl = new WebSocket(this.wsUrl + "?ch=control");
    this.wsControl.binaryType = "arraybuffer";

    this.wsControl.onopen = () => {
      console.log("[DimosBridge] control WS connected");
      this._connected = true;
      this._startPublishing();
    };

    this.wsControl.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      try {
        const raw = new Uint8Array(event.data);
        const { channel, data } = decodePacket(raw);
        this._handlePacket(channel, data);
      } catch {}
    };

    this.wsControl.onclose = () => {
      console.log("[DimosBridge] control WS disconnected, reconnecting in 2s...");
      this._connected = false;
      this._stopPublishing();
      setTimeout(() => this.connect(), 2000);
    };

    this.wsControl.onerror = () => {};

    // Sensor socket: images + lidar out (no incoming expected)
    this.wsSensors = new WebSocket(this.wsUrl + "?ch=sensors");
    this.wsSensors.binaryType = "arraybuffer";

    this.wsSensors.onopen = () => {
      console.log("[DimosBridge] sensor WS connected");
    };

    this.wsSensors.onclose = () => {
      console.log("[DimosBridge] sensor WS disconnected");
    };

    this.wsSensors.onerror = () => {};
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
      // ROS → Three.js: inverse of the cyclic permutation (x→y, y→z, z→x)
      linX = lin.y;
      linY = lin.z;
      linZ = lin.x;
      angX = ang.y;
      angY = ang.z;
      angZ = ang.x;
    } else {
      linX = lin.x; linY = lin.y; linZ = lin.z;
      angX = ang.x; angY = ang.y; angZ = ang.z;
    }

    this._cmdVel = { linX, linY, linZ, angX, angY, angZ };
    this._cmdVelStamp = Date.now();
  }

  /** Get current velocity, auto-zeroing after 1500ms timeout (safety stop). */
  getCmdVel(): { linX: number; linY: number; linZ: number; angX: number; angY: number; angZ: number } {
    if (!this._cmdVel || Date.now() - this._cmdVelStamp > 1500) {
      return { linX: 0, linY: 0, linZ: 0, angX: 0, angY: 0, angZ: 0 };
    }
    return this._cmdVel;
  }

  // -- Outgoing sensor data ---------------------------------------------------

  sceneReady = false;

  _startPublishing(): void {
    // No lidar timer — server-side lidar handles it via LCM directly.
    // No images timer — camera stream disabled for now.
  }

  _makeHeader(frameId: string): any {
    const now = Date.now();
    return new std_msgs.Header({
      stamp: new std_msgs.Time({ sec: Math.floor(now / 1000), nsec: (now % 1000) * 1_000_000 }),
      frame_id: frameId,
    });
  }

  _publishOdom(): void {
    this._publishOdomSync(this._makeHeader("world"));
  }

  _publishLidar(): void {
    this._publishLidarSync(this._makeHeader("world"));
  }

  _publishImages(): void {
    const camHeader = this._makeHeader("camera_optical");
    this._publishRgbSync(camHeader);
    this._publishDepthSync(camHeader);
  }

  // -- Odom -------------------------------------------------------------------

  _odomDbgN = 0;

  _publishOdomSync(header: any): void {
    try {
      const pose = this.sensors.getOdomPose();
      if (!pose) return;

      this._odomDbgN++;

      // Three.js (Y-up) → ROS (Z-up) cyclic permutation: x→y, y→z, z→x
      const rosQx = pose.qz;
      const rosQy = pose.qx;
      const rosQz = pose.qy;
      const rosQw = pose.qw;

      const q = new geometry_msgs.Quaternion();
      q.x = rosQx; q.y = rosQy; q.z = rosQz; q.w = rosQw;
      const pt = new geometry_msgs.Point();
      pt.x = pose.z; pt.y = pose.x; pt.z = pose.y;
      const p = new geometry_msgs.Pose();
      p.position = pt;
      p.orientation = q;

      header.seq = this._odomDbgN;
      const odomMsg = new geometry_msgs.PoseStamped();
      odomMsg.header = header;
      odomMsg.pose = p;

      if (this._odomDbgN <= 3 || this._odomDbgN % 100 === 0) {
        console.log(`[odom TX seq=${this._odomDbgN}] qz=${rosQz.toFixed(4)} qw=${rosQw.toFixed(4)}`);
      }

      // Send on CONTROL socket (not sensor socket)
      this._sendControl(CH_ODOM, odomMsg);
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

  /** Send on the control WebSocket (odom, small real-time data) */
  _sendControl(channel: string, msg: any): void {
    if (!this.wsControl || this.wsControl.readyState !== WebSocket.OPEN) return;
    this.wsControl.send(encodePacket(channel, msg));
  }

  /** Send on the sensor WebSocket (images, lidar — large data) */
  _sendSensor(channel: string, msg: any): void {
    if (!this.wsSensors || this.wsSensors.readyState !== WebSocket.OPEN) return;
    this.wsSensors.send(encodePacket(channel, msg));
  }

  /** Legacy _send — routes to appropriate socket based on channel */
  _send(channel: string, msg: any): void {
    if (channel === CH_ODOM) {
      this._sendControl(channel, msg);
    } else {
      this._sendSensor(channel, msg);
    }
  }

  // -- RGB --------------------------------------------------------------------

  _publishRgbSync(header: any): void {
    try {
      const frame = this.sensors.captureRgb();
      if (!frame) return;

      this._sendSensor(CH_IMAGE, new sensor_msgs.Image({
        header,
        height: frame.height,
        width: frame.width,
        encoding: "rgba8",
        is_bigendian: 0,
        step: frame.width * 4,
        data_length: frame.data.length,
        data: frame.data,
      }));
    } catch (e) {
      console.warn("[DimosBridge] RGB publish error:", e);
    }
  }

  // -- Depth ------------------------------------------------------------------

  _publishDepthSync(header: any): void {
    try {
      const frame = this.sensors.captureDepth();
      if (!frame) return;

      const depthBytes = new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);

      this._sendSensor(CH_DEPTH, new sensor_msgs.Image({
        header,
        height: frame.height,
        width: frame.width,
        encoding: "32FC1",
        is_bigendian: 0,
        step: frame.width * 4,
        data_length: depthBytes.length,
        data: depthBytes,
      }));
    } catch (e) {
      console.warn("[DimosBridge] depth publish error:", e);
    }
  }

  // -- LiDAR ------------------------------------------------------------------

  _lidarDbgN = 0;
  _publishLidarSync(header: any): void {
    try {
      const frame = this.sensors.captureLidar();
      this._lidarDbgN++;
      if (this._lidarDbgN <= 3 || this._lidarDbgN % 100 === 0) {
        console.log(`[DimosBridge] lidar #${this._lidarDbgN}: ${frame ? frame.numPoints : 'null'} pts, sensorWS=${this.wsSensors?.readyState}`);
      }
      if (!frame) return;

      const numPoints = frame.numPoints || 0;
      if (numPoints === 0) return;

      const pointStep = 16;
      const buf = new ArrayBuffer(numPoints * pointStep);
      const view = new DataView(buf);
      const pts = frame.points;
      const intensity = frame.intensity;

      // Points are Three.js world-frame (Y-up).
      // Convert to ROS world-frame (Z-up): cyclic permutation x→y, y→z, z→x
      for (let i = 0; i < numPoints; i++) {
        const off = i * pointStep;
        const tx = pts[i * 3 + 0], ty = pts[i * 3 + 1], tz = pts[i * 3 + 2];
        view.setFloat32(off,     tz, true);   // ROS x = Three.js z
        view.setFloat32(off + 4, tx, true);   // ROS y = Three.js x
        view.setFloat32(off + 8, ty, true);   // ROS z = Three.js y
        view.setFloat32(off + 12, intensity ? intensity[i] : 1.0, true);
      }

      this._sendSensor(CH_LIDAR, new sensor_msgs.PointCloud2({
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
        data_length: numPoints * pointStep,
        data: new Uint8Array(buf),
        is_dense: 1,
      }));
    } catch (e) {
      console.warn("[DimosBridge] LiDAR publish error:", e);
    }
  }

  dispose(): void {
    this._stopPublishing();
    if (this.wsControl) { this.wsControl.onclose = null; this.wsControl.close(); }
    if (this.wsSensors) { this.wsSensors.onclose = null; this.wsSensors.close(); }
    this.wsControl = null;
    this.wsSensors = null;
  }
}

