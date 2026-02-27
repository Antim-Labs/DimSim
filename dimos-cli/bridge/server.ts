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

export interface BridgeServerOptions {
  port: number;
  distDir: string;
  scene?: string;
  evalOnly?: boolean;
}

export async function startBridgeServer(options: BridgeServerOptions) {
  const { port, distDir, scene, evalOnly = false } = options;

  // Control clients receive LCM→WS relay (cmd_vel from dimos)
  const controlClients = new Set<WebSocket>();
  let activeControlClient: WebSocket | null = null;
  // Sensor clients only send WS→LCM (no LCM→WS needed)
  const sensorClients = new Set<WebSocket>();

  let lcm: LCM | null = null;
  const sentSeqs = new Set<number>();

  if (!evalOnly) {
    lcm = new LCM();
    await lcm.start();

    // LCM → WS: forward external packets to CONTROL clients only
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
              lcm.publishRaw(decoded.channel, decoded.data);
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
        let _latestOdom: { channel: string; data: Uint8Array } | null = null;

        // Publish latest odom at 10Hz — always fresh, never queued
        const _odomTimer = setInterval(async () => {
          if (_latestOdom && lcm) {
            const { channel, data } = _latestOdom;
            _latestOdom = null;
            try {
              sentSeqs.add(lcm.getNextSeq());
              await lcm.publishRaw(channel, data);
            } catch { /* ignore */ }
          }
        }, 100);

        socket.onclose = () => {
          clearInterval(_odomTimer);
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
              // Store latest odom — timer publishes it
              _odomLogN++;
              const d = decoded.data;
              _latestOdom = { channel: decoded.channel, data: new Uint8Array(d) };
              if (d.byteLength >= 32 && (_odomLogN <= 3 || _odomLogN % 100 === 0)) {
                const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
                const txSeq = dv.getInt32(8, false);
                const quatOff = d.byteLength - 32;
                const qz = dv.getFloat64(quatOff + 16, false), qw = dv.getFloat64(quatOff + 24, false);
                console.log(`[bridge] odom txSeq=${txSeq} quat=(${qz.toFixed(4)},${qw.toFixed(4)})`);
              }
            }
          } catch { /* ignore */ }
        };
      }

      return response;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      try {
        let html = await Deno.readTextFile(`${distDir}/index.html`);
        const inject = `<script>window.__dimosMode=true;window.__dimosScene="${scene || "hotel-lobby"}";</script>`;
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
