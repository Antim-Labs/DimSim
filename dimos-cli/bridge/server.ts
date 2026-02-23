#!/usr/bin/env -S deno run --allow-net --allow-read --unstable-net

/**
 * DimSim Bridge Server
 *
 * - WebSocket ↔ LCM relay with full fragmentation support
 * - Static file server for the pre-built DimSim frontend (dist/)
 * - Injects dimosMode=true into served index.html
 * - Uses vendored LCM transport with joinMulticastV4 fix
 */

import { LCM } from "../vendor/lcm/lcm.ts";
import { decodePacket } from "../vendor/lcm/transport.ts";
import { MAGIC_SHORT } from "../vendor/lcm/types.ts";
import { serveDir } from "@std/http/file-server";

export interface BridgeServerOptions {
  port: number;
  distDir: string;
  scene?: string;
  evalOnly?: boolean;
}

export async function startBridgeServer(options: BridgeServerOptions) {
  const { port, distDir, scene, evalOnly = false } = options;
  const clients = new Set<WebSocket>();

  let lcm: LCM | null = null;

  // Track sequence numbers we publish so we can filter out loopback echoes.
  // Loopback must be ON for same-host Deno→Deno multicast to work,
  // but that means we receive our own published packets back.
  const sentSeqs = new Set<number>();

  if (!evalOnly) {
    lcm = new LCM();
    await lcm.start();

    // LCM → WS: forward EXTERNAL multicast packets to browser clients.
    // Skip packets we published ourselves (loopback echoes) and fragments
    // (browser only understands small LCM packets).
    lcm.subscribePacket((packet: Uint8Array) => {
      if (packet.length < 8) return;
      const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
      const magic = view.getUint32(0, false);

      // Only forward small packets — browser can't handle fragments
      if (magic !== MAGIC_SHORT) return;

      // Skip our own echoes
      const seq = view.getUint32(4, false);
      if (sentSeqs.has(seq)) {
        sentSeqs.delete(seq);
        return;
      }

      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(packet);
      }
    });
  }

  // ── HTTP + WebSocket server ─────────────────────────────────────────────
  Deno.serve({ port }, async (req: Request) => {
    const url = new URL(req.url);

    if (req.headers.get("upgrade") === "websocket") {
      const { socket, response } = Deno.upgradeWebSocket(req);
      socket.binaryType = "arraybuffer";

      socket.onopen = () => { clients.add(socket); console.log(`[bridge] WS+ (${clients.size})`); };
      socket.onclose = () => { clients.delete(socket); console.log(`[bridge] WS- (${clients.size})`); };
      socket.onerror = () => clients.delete(socket);

      socket.onmessage = async (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
          const packet = new Uint8Array(event.data);

          // WS → LCM: decode and re-publish with fragmentation
          if (lcm) {
            try {
              const decoded = decodePacket(packet);
              if (decoded && decoded.type === "small") {
                // Record the sequence number so we can filter the loopback echo
                sentSeqs.add(lcm.getNextSeq());
                await lcm.publishRaw(decoded.channel, decoded.data);
              }
            } catch {
              // Silently drop publish errors
            }
          }

          // WS → WS: broadcast to other clients
          for (const client of clients) {
            if (client !== socket && client.readyState === WebSocket.OPEN) {
              client.send(packet);
            }
          }
        } else if (typeof event.data === "string") {
          for (const client of clients) {
            if (client !== socket && client.readyState === WebSocket.OPEN) {
              client.send(event.data);
            }
          }
        }
      };

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
