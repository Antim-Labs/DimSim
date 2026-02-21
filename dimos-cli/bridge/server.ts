#!/usr/bin/env -S deno run --allow-net --allow-read --unstable-net

/**
 * DimSim Bridge Server
 *
 * Sits between the DimSim browser frontend and the dimos Python agent,
 * translating between WebSocket (browser) and LCM/UDP (dimos).
 *
 * Protocol:
 *   Binary messages = LCM sensor/command packets (passthrough, no parsing)
 *     Browser → Bridge → LCM:  /cmd_vel (Twist)
 *     LCM → Bridge → Browser:  /color_image, /depth_image, /lidar, /odom
 *
 *   Text messages = JSON eval commands (broadcast to other clients)
 *     Runner → Bridge → Browser:  ping, loadEnv, startWorkflow, stopWorkflow
 *     Browser → Bridge → Runner:  pong, envReady, workflowComplete
 *
 * Modes:
 *   Full bridge  — LCM relay + static files + eval commands
 *   Eval-only    — Static files + eval commands (no LCM, for headless CI)
 */

import { LCM } from "@dimos/lcm";
import { decodeChannel } from "@dimos/msgs";
import { serveDir } from "@std/http/file-server";

export interface BridgeServerOptions {
  port: number;
  distDir: string;
  scene?: string;
  /** Skip LCM — only relay eval commands + serve static files (for headless CI). */
  evalOnly?: boolean;
}

export async function startBridgeServer(options: BridgeServerOptions) {
  const { port, distDir, scene, evalOnly = false } = options;
  const clients = new Set<WebSocket>();

  let lcm: LCM | null = null;
  let relayCount = 0;
  let relayBytes = 0;

  if (!evalOnly) {
    lcm = new LCM();
    await lcm.start();

    // Forward raw LCM packets → all browser clients
    lcm.subscribePacket((packet: Uint8Array) => {
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(packet);
      }
    });

    setInterval(() => {
      if (relayCount > 0) {
        console.log(`[bridge] ${relayCount} packets (${(relayBytes / 1024).toFixed(0)} KB) in last 10s`);
        relayCount = 0;
        relayBytes = 0;
      }
    }, 10_000);
  }

  // ── HTTP + WebSocket server ─────────────────────────────────────────────

  Deno.serve({ port }, async (req: Request) => {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (req.headers.get("upgrade") === "websocket") {
      const { socket, response } = Deno.upgradeWebSocket(req);
      socket.binaryType = "arraybuffer";

      socket.onopen = () => clients.add(socket);
      socket.onclose = () => clients.delete(socket);
      socket.onerror = () => clients.delete(socket);

      socket.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Binary: LCM packet — relay to LCM bus and other WS clients
          const packet = new Uint8Array(event.data);

          if (lcm) {
            try {
              const { channel, payload } = decodeChannel(packet);
              await lcm.publishRaw(channel, payload);
              relayCount++;
              relayBytes += payload.length;
            } catch (e) {
              console.warn("[bridge] relay error:", e);
            }
          }

          for (const client of clients) {
            if (client !== socket && client.readyState === WebSocket.OPEN) {
              client.send(packet);
            }
          }
        } else if (typeof event.data === "string") {
          // Text: JSON eval command — broadcast to other clients
          for (const client of clients) {
            if (client !== socket && client.readyState === WebSocket.OPEN) {
              client.send(event.data);
            }
          }
        }
      };

      return response;
    }

    // Serve index.html with dimos mode injection
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

    // Static files from dist/
    return serveDir(req, { fsRoot: distDir, quiet: true });
  });

  console.log(`[bridge] :${port}${evalOnly ? " (eval-only)" : " (LCM bridge)"}`);

  if (lcm) await lcm.run();
}

// ── Standalone entry point ────────────────────────────────────────────────

if (import.meta.main) {
  const distDir = new URL("../../dist", import.meta.url).pathname;
  const scene = Deno.args.find((_a, i, arr) => arr[i - 1] === "--scene") || "hotel-lobby";
  const port = parseInt(Deno.args.find((_a, i, arr) => arr[i - 1] === "--port") || "8090");
  await startBridgeServer({ port, distDir, scene });
}
