#!/usr/bin/env -S deno run --allow-net --allow-read --unstable-net

/**
 * DimSim Bridge Server
 *
 * - WebSocket ↔ LCM relay (raw binary passthrough, no parsing overhead)
 * - Static file server for the pre-built DimSim frontend (dist/)
 * - Injects dimosMode=true into served index.html
 * - Relays eval harness JSON commands between Deno runner and browser
 */

import { LCM } from "@dimos/lcm";
import { decodePacket } from "../vendor/lcm/transport.ts";
import { geometry_msgs } from "@dimos/msgs";
import { serveDir } from "@std/http/file-server";

export interface BridgeServerOptions {
  port: number;
  distDir: string;
  scene?: string;
}

export async function startBridgeServer(options: BridgeServerOptions) {
  const { port, distDir, scene } = options;
  const clients = new Set<WebSocket>();

  // ── LCM setup ───────────────────────────────────────────────────────────
  const lcm = new LCM();
  await lcm.start();

  // Log odom for debugging (optional)
  lcm.subscribe("/odom", geometry_msgs.PoseStamped, (msg: { data: { pose: { position: { x: number; y: number; z: number } } } }) => {
    const pos = msg.data.pose.position;
    console.log(`[odom] x=${pos.x.toFixed(2)} y=${pos.y.toFixed(2)} z=${pos.z.toFixed(2)}`);
  });

  // Forward ALL raw LCM packets → browser clients
  lcm.subscribePacket((packet: Uint8Array) => {
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(packet);
      }
    }
  });

  // ── HTTP + WebSocket server ─────────────────────────────────────────────
  Deno.serve({ port }, async (req: Request) => {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (req.headers.get("upgrade") === "websocket") {
      const { socket, response } = Deno.upgradeWebSocket(req);
      socket.binaryType = "arraybuffer";

      socket.onopen = () => {
        console.log("[bridge] client connected");
        clients.add(socket);
      };
      socket.onclose = () => clients.delete(socket);
      socket.onerror = () => clients.delete(socket);

      socket.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Binary = LCM packet → decode and re-publish with fragmentation support
          const packet = new Uint8Array(event.data);
          try {
            const decoded = decodePacket(packet);
            if (decoded && decoded.type === "small") {
              // Re-publish through publishRaw which handles fragmentation for large messages
              await lcm.publishRaw(decoded.channel, decoded.data);
            } else {
              // Fragment or unknown — forward as-is
              await lcm.publishPacket(packet);
            }
          } catch (e) {
            // Silently drop publish errors (e.g., EMSGSIZE for oversized packets)
          }
          // Relay to other WS clients (so loopback test / other consumers get sensor data)
          for (const client of clients) {
            if (client !== socket && client.readyState === WebSocket.OPEN) {
              client.send(packet);
            }
          }
        } else if (typeof event.data === "string") {
          // Text = eval harness command → broadcast to other clients (eval runner)
          for (const client of clients) {
            if (client !== socket && client.readyState === WebSocket.OPEN) {
              client.send(event.data);
            }
          }
        }
      };

      return response;
    }

    // Serve index.html with dimosMode injection
    if (url.pathname === "/" || url.pathname === "/index.html") {
      try {
        let html = await Deno.readTextFile(`${distDir}/index.html`);
        const inject = `<script>window.__dimosMode=true;window.__dimosScene="${scene || "hotel-lobby"}";</script>`;
        html = html.replace("</head>", `${inject}\n</head>`);
        return new Response(html, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      } catch {
        return new Response("index.html not found in dist/", { status: 404 });
      }
    }

    // Serve static files from dist/
    return serveDir(req, { fsRoot: distDir, quiet: true });
  });

  console.log(`[dimsim] Bridge server running: http://localhost:${port}`);
  console.log(`[dimsim] Scene: ${scene || "hotel-lobby"}`);
  console.log(`[dimsim] Serving dist from: ${distDir}`);

  // Run LCM message loop (blocking)
  await lcm.run();
}

// ── Standalone entry point ────────────────────────────────────────────────
if (import.meta.main) {
  const distDir = new URL("../../dist", import.meta.url).pathname;
  const scene = Deno.args.find((_a, i, arr) => arr[i - 1] === "--scene") || "hotel-lobby";
  const port = parseInt(Deno.args.find((_a, i, arr) => arr[i - 1] === "--port") || "8090");

  await startBridgeServer({ port, distDir, scene });
}
