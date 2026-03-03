#!/usr/bin/env -S deno run --allow-net --allow-read --unstable-net

/**
 * DimSim Bridge Server
 *
 * - TWO WebSocket channels: control (odom/cmd_vel) and sensors (images/lidar)
 *   Separate TCP streams so large sensor data never blocks real-time odom.
 * - LCM multicast relay (WS ↔ LCM)
 * - Static file server for the pre-built DimSim frontend (dist/)
 * - Uses vendored LCM transport with joinMulticastV4 fix
 */

import { LCM } from "../vendor/lcm/lcm.ts";
import { decodePacket } from "../vendor/lcm/transport.ts";
import { MAGIC_SHORT, SHORT_HEADER_SIZE } from "../vendor/lcm/types.ts";
import { serveDir } from "@std/http/file-server";
import { ServerLidar } from "./lidar.ts";
import { geometry_msgs } from "@dimos/msgs";

// Magic prefix for Rapier world snapshot (ASCII "DSSN")
const SNAPSHOT_MAGIC = 0x4453534E;

export interface BridgeServerOptions {
  port: number;
  distDir: string;
  scene?: string;
  evalOnly?: boolean;
  headless?: boolean;
}

export async function startBridgeServer(options: BridgeServerOptions) {
  const { port, distDir, scene, evalOnly = false, headless = false } = options;

  // Control clients receive LCM→WS relay (cmd_vel from dimos)
  const controlClients = new Set<WebSocket>();
  let activeControlClient: WebSocket | null = null;
  // Sensor clients only send WS→LCM (no LCM→WS needed)
  const sensorClients = new Set<WebSocket>();

  let lcm: LCM | null = null;
  const sentSeqs = new Set<number>();
  let serverLidar: ServerLidar | null = null;

  // -- Server-side lidar init from Rapier snapshot ----------------------------
  async function initServerLidar(snapshot: Uint8Array): Promise<void> {
    if (serverLidar) { serverLidar.stop(); serverLidar = null; }
    try {
      const RAPIER = await import("@dimforge/rapier3d-compat");
      await RAPIER.init();
      const world = RAPIER.World.restoreSnapshot(snapshot);
      if (!world) { console.error("[bridge] failed to restore Rapier snapshot"); return; }

      // Remove non-fixed bodies (player capsule, AI agents) — server world is static
      const bodiesToRemove: any[] = [];
      world.bodies.forEach((body: any) => {
        if (!body.isFixed()) bodiesToRemove.push(body.handle);
      });
      for (const handle of bodiesToRemove) {
        world.removeRigidBody(world.getRigidBody(handle));
      }
      console.log(`[bridge] Rapier snapshot restored (removed ${bodiesToRemove.length} non-fixed bodies)`);

      serverLidar = new ServerLidar(lcm!, world, RAPIER, sentSeqs);
      serverLidar.start();
    } catch (e) {
      console.error("[bridge] server lidar init error:", e);
    }
  }

  if (!evalOnly) {
    lcm = new LCM();
    await lcm.start();

    // LCM → WS: forward external packets to CONTROL clients only
    // sentSeqs filters echo (packets we published ourselves).
    // NOTE: no global maxRelaySeq filter — multiple external publishers
    // (planner, mapper, etc.) have independent seq counters so a single
    // global max would silently drop packets from slower publishers.
    lcm.subscribePacket((packet: Uint8Array) => {
      if (packet.length < 8) return;
      const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
      const magic = view.getUint32(0, false);
      if (magic !== MAGIC_SHORT) return;

      const seq = view.getUint32(4, false);
      if (sentSeqs.has(seq)) {
        sentSeqs.delete(seq);
        return;
      }

      const copy = packet.slice();
      const client = activeControlClient;
      if (client && client.readyState === WebSocket.OPEN) client.send(copy);
    });
  }

  // ── HTTP + WebSocket server ─────────────────────────────────────────────
  Deno.serve({ port }, async (req: Request) => {
    const url = new URL(req.url);

    if (req.headers.get("upgrade") === "websocket") {
      const { socket, response } = Deno.upgradeWebSocket(req);
      socket.binaryType = "arraybuffer";
      const ch = url.searchParams.get("ch") || "control";
      const isSensor = ch === "sensors";

      if (isSensor) {
        // ── SENSOR WebSocket ──────────────────────────────────────────
        socket.onopen = () => { sensorClients.add(socket); console.log(`[bridge] sensor WS+ (${sensorClients.size})`); };
        socket.onclose = () => { sensorClients.delete(socket); console.log(`[bridge] sensor WS-`); };
        socket.onerror = () => sensorClients.delete(socket);

        let _sensorLogN = 0;
        socket.onmessage = (event: MessageEvent) => {
          if (!(event.data instanceof ArrayBuffer) || !lcm) return;
          const packet = new Uint8Array(event.data);

          // Check for Rapier snapshot (DSSN magic prefix)
          if (packet.length > 4) {
            const magic = new DataView(packet.buffer, packet.byteOffset, 4).getUint32(0, false);
            if (magic === SNAPSHOT_MAGIC) {
              const snapshot = packet.slice(4);
              console.log(`[bridge] Rapier snapshot received (${(snapshot.byteLength / 1024).toFixed(0)}KB)`);
              initServerLidar(snapshot);
              return;
            }
          }

          try {
            const decoded = decodePacket(packet);
            if (decoded && decoded.type === "small") {
              _sensorLogN++;
              if (_sensorLogN <= 3 || _sensorLogN % 10 === 0) {
                // Extract short channel name for logging
                const ch = decoded.channel.split("#")[0].replace("/", "");
                console.log(`[bridge] sensor #${_sensorLogN} ${ch} ${(decoded.data.byteLength / 1024).toFixed(0)}KB`);
              }
              sentSeqs.add(lcm.getNextSeq());
              lcm.publishRaw(decoded.channel, decoded.data).catch(() => {});
            }
          } catch { /* ignore */ }
        };
      } else {
        // ── CONTROL WebSocket ─────────────────────────────────────────
        socket.onopen = () => {
          // Enforce single active control uplink to avoid interleaved odom from multiple tabs.
          if (activeControlClient && activeControlClient !== socket && activeControlClient.readyState === WebSocket.OPEN) {
            try {
              activeControlClient.close(1000, "superseded-by-new-control-client");
            } catch { /* ignore */ }
          }
          activeControlClient = socket;
          controlClients.add(socket);
          console.log(`[bridge] control WS+ (${controlClients.size}) active=1`);
        };
        socket.onerror = () => controlClients.delete(socket);

        let _odomLogN = 0;

        socket.onclose = () => {
          controlClients.delete(socket);
          if (activeControlClient === socket) activeControlClient = null;
          console.log(`[bridge] control WS- (${controlClients.size})`);
        };

        socket.onmessage = (event: MessageEvent) => {
          if (!(event.data instanceof ArrayBuffer) || !lcm) return;
          // Ignore odom uplink from non-active control sockets.
          if (activeControlClient !== socket) return;
          const packet = new Uint8Array(event.data);
          try {
            const decoded = decodePacket(packet);
            if (decoded && decoded.type === "small") {
              _odomLogN++;

              // Feed odom to server-side lidar BEFORE async LCM publish
              if (serverLidar && decoded.channel === "/odom#geometry_msgs.PoseStamped") {
                try {
                  const odom = geometry_msgs.PoseStamped.decode(decoded.data);
                  const p = odom.pose.position;
                  const q = odom.pose.orientation;
                  // ROS Z-up → Three.js Y-up: inverse cyclic permutation
                  // ROS (x,y,z) → Three.js (y,z,x)
                  serverLidar.updatePose(
                    p.y, p.z, p.x,  // position
                    q.y, q.z, q.x, q.w,  // quaternion
                  );
                  if (_odomLogN <= 3 || _odomLogN % 200 === 0) {
                    console.log(`[bridge] odom→lidar #${_odomLogN}: pos=(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)})`);
                  }
                } catch (e) {
                  if (_odomLogN <= 5) console.warn("[bridge] odom decode error:", e);
                }
              }

              // Relay to LCM (async, non-fatal)
              sentSeqs.add(lcm.getNextSeq());
              lcm.publishRaw(decoded.channel, decoded.data).catch(() => {});
            }
          } catch { /* ignore */ }
        };
      }

      return response;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      try {
        let html = await Deno.readTextFile(`${distDir}/index.html`);
        const inject = `<script>window.__dimosMode=true;window.__dimosScene="${scene || "hotel-lobby"}";${headless ? "window.__dimosHeadless=true;" : ""}</script>`;
        html = html.replace("</head>", `${inject}\n</head>`);
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      } catch {
        return new Response("index.html not found", { status: 404 });
      }
    }

    return serveDir(req, { fsRoot: distDir, quiet: true });
  });

  console.log(`[bridge] :${port}${evalOnly ? " (eval-only)" : " (LCM bridge)"}`);

  if (lcm) {
    await lcm.run();
  } else {
    await new Promise(() => {});
  }
}

if (import.meta.main) {
  const distDir = new URL("../../dist", import.meta.url).pathname;
  const scene = Deno.args.find((_a: string, i: number, arr: string[]) => arr[i - 1] === "--scene") || "hotel-lobby";
  const port = parseInt(Deno.args.find((_a: string, i: number, arr: string[]) => arr[i - 1] === "--port") || "8090");
  await startBridgeServer({ port, distDir, scene });
}
