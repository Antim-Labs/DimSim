#!/usr/bin/env python3
"""
DimSim ↔ dimos Integration Test

Validates end-to-end connectivity between DimSim (browser sim) and dimos
(Python robotics stack) via WebSocket through the bridge server.

Data flow:
  Python  ──WebSocket──▶  Bridge Server  ──WebSocket──▶  Browser (DimSim)
  Python  ◀──WebSocket──  Bridge Server  ◀──WebSocket──  Browser (DimSim)

This script:
  1. Connects to the bridge WebSocket (same as the browser does)
  2. Publishes /cmd_vel Twist commands encoded as LCM packets → agent moves in sim
  3. Subscribes to /odom, /camera/image, /camera/depth, /lidar/points
  4. Reports what it receives; SUCCESS when all 4 channels are live

Prerequisites:
  1. Start DimSim bridge:
       ~/.deno/bin/deno run --allow-all --unstable-net dimos-cli/cli.ts dev
  2. Open http://localhost:8090 in Chrome (scene must load)
  3. Run this script from the dimos venv:
       /path/to/dimos/.venv/bin/python dimos-cli/test/dimos_integration.py

Options:
  --ws URL       WebSocket URL (default: ws://localhost:8090)
  --timeout N    Timeout in seconds (default: 30)
  --rate N       cmd_vel publish rate in Hz (default: 10)
"""

import sys
import json
import time
import struct
import threading
import argparse

import websocket

# dimos message types for encoding cmd_vel
from dimos.msgs.geometry_msgs import Twist, Vector3

# -- LCM packet codec (matches @dimos/msgs encodePacket / decodePacket) ------
# Format: [Magic BE u32][Seq BE u32][Channel UTF-8][NULL][Payload]
# Standard LCM uses big-endian (network byte order) for the header.

LCM_MAGIC = 0x4C433032  # "LC02" in ASCII / big-endian
_seq = 0

def encode_lcm_packet(channel: str, payload: bytes) -> bytes:
    """Encode an LCM binary packet (same format as @dimos/msgs encodePacket)."""
    global _seq
    ch_bytes = channel.encode("utf-8")
    buf = struct.pack(">II", LCM_MAGIC, _seq) + ch_bytes + b"\x00" + payload
    _seq += 1
    return buf


def decode_lcm_packet(data: bytes) -> tuple[str, bytes]:
    """Decode an LCM packet → (channel, payload). Raises ValueError on bad packet."""
    if len(data) < 9:
        raise ValueError("Packet too short")
    magic = struct.unpack_from(">I", data, 0)[0]
    if magic != LCM_MAGIC:
        raise ValueError(f"Bad magic: 0x{magic:08x}")
    # Find null terminator after 8-byte header
    null_pos = data.index(0, 8)
    channel = data[8:null_pos].decode("utf-8")
    payload = data[null_pos + 1:]
    return channel, payload


# -- Channel names (must match DimSim's dimosBridge.ts) ----------------------
CH_CMD_VEL = "/cmd_vel#geometry_msgs.Twist"
CH_ODOM    = "/odom#geometry_msgs.PoseStamped"
CH_IMAGE   = "/camera/image#sensor_msgs.Image"
CH_DEPTH   = "/camera/depth#sensor_msgs.Image"
CH_LIDAR   = "/lidar/points#sensor_msgs.PointCloud2"


def main():
    parser = argparse.ArgumentParser(description="DimSim ↔ dimos integration test")
    parser.add_argument("--ws", default="ws://localhost:8090", help="Bridge WebSocket URL")
    parser.add_argument("--timeout", type=int, default=30, help="Timeout in seconds")
    parser.add_argument("--rate", type=int, default=10, help="cmd_vel publish rate (Hz)")
    args = parser.parse_args()

    received = {"odom": 0, "image": 0, "depth": 0, "lidar": 0}
    eval_task = {"prompt": None, "workflow": None}
    tick = 0
    success = False
    ws_connected = threading.Event()

    # -- WebSocket callbacks ---------------------------------------------------
    def on_message(ws_app, data):
        # Text messages = eval harness commands (task prompt, workflow lifecycle)
        if isinstance(data, str):
            try:
                msg = json.loads(data)
                if msg.get("type") == "startWorkflow":
                    wf = msg.get("workflow", {})
                    eval_task["prompt"] = wf.get("task")
                    eval_task["workflow"] = wf.get("name")
                    print(f"\n[integration] *** EVAL TASK RECEIVED ***")
                    print(f"[integration]   Workflow: {eval_task['workflow']}")
                    print(f"[integration]   Prompt:   {eval_task['prompt']}")
                    print(f"[integration] *** A real dimos agent would use this prompt with its VLM ***\n")
                elif msg.get("type") == "workflowComplete":
                    scores = msg.get("rubricScores", {})
                    passed = all(s.get("pass", True) for s in scores.values())
                    print(f"\n[integration] *** EVAL RESULT: {'PASS' if passed else 'FAIL'} ***")
                    print(f"[integration]   Scores: {json.dumps(scores, indent=2)}\n")
                elif msg.get("type") in ("loadEnv", "envReady", "workflowStarted"):
                    print(f"[integration] Eval event: {msg.get('type')}")
            except (json.JSONDecodeError, KeyError):
                pass
            return

        if not isinstance(data, bytes):
            return
        try:
            channel, payload = decode_lcm_packet(data)
        except (ValueError, IndexError):
            return

        if "/odom" in channel:
            received["odom"] += 1
            if received["odom"] <= 3 or received["odom"] % 10 == 0:
                # Try to extract position from payload (skip 8-byte fingerprint + header)
                print(f"[integration] Got odom #{received['odom']} ({len(payload)} bytes)")
        elif "/camera/image" in channel:
            received["image"] += 1
            if received["image"] <= 3 or received["image"] % 10 == 0:
                print(f"[integration] Got RGB #{received['image']} ({len(payload)} bytes)")
        elif "/camera/depth" in channel:
            received["depth"] += 1
            if received["depth"] <= 3 or received["depth"] % 10 == 0:
                print(f"[integration] Got depth #{received['depth']} ({len(payload)} bytes)")
        elif "/lidar/points" in channel:
            received["lidar"] += 1
            if received["lidar"] <= 3 or received["lidar"] % 10 == 0:
                print(f"[integration] Got LiDAR #{received['lidar']} ({len(payload)} bytes)")

    def on_open(ws_app):
        print(f"[integration] WebSocket connected to {args.ws}")
        ws_connected.set()

    def on_error(ws_app, error):
        print(f"[integration] WebSocket error: {error}")

    def on_close(ws_app, close_code, close_msg):
        print("[integration] WebSocket closed")

    # -- Start WebSocket in background thread ---------------------------------
    ws = websocket.WebSocketApp(
        args.ws,
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
    )
    ws_thread = threading.Thread(target=ws.run_forever, daemon=True)
    ws_thread.start()

    if not ws_connected.wait(timeout=5):
        print("[integration] Failed to connect to WebSocket. Is the bridge running?")
        sys.exit(1)

    # -- Publish cmd_vel and monitor results ----------------------------------
    interval = 1.0 / args.rate
    print(f"[integration] Publishing /cmd_vel at {args.rate} Hz (Three.js identity frame)")
    print(f"[integration] Timeout: {args.timeout}s\n")

    start_time = time.time()

    try:
        while time.time() - start_time < args.timeout:
            # Build Twist — Three.js identity: z=forward, y=yaw
            twist = Twist(
                linear=Vector3(0, 0, 0.5),
                angular=Vector3(0, 0.3, 0),
            )
            payload = twist.lcm_encode()
            packet = encode_lcm_packet(CH_CMD_VEL, payload)
            ws.send(packet, opcode=websocket.ABNF.OPCODE_BINARY)
            tick += 1

            if tick <= 3 or tick % 20 == 0:
                print(f"[integration] Sent cmd_vel #{tick}")

            # Status check every 5s
            elapsed = time.time() - start_time
            if tick > 1 and (tick % (args.rate * 5) == 0):
                print(f"\n[integration] STATUS ({elapsed:.0f}s): "
                      f"cmd_sent={tick} odom={received['odom']} "
                      f"rgb={received['image']} depth={received['depth']} "
                      f"lidar={received['lidar']}")

                if all(v > 0 for v in received.values()):
                    success = True
                    print("\n========================================")
                    print("  SUCCESS: All channels working!")
                    print("  DimSim ↔ dimos transport verified.")
                    print("========================================\n")
                    break

                if received["odom"] == 0 and elapsed > 10:
                    print("[integration] No sensor data. Is the browser open at localhost:8090?")
                print()

            time.sleep(interval)

        if not success:
            print(f"\n[integration] TIMEOUT after {args.timeout}s")
            print(f"[integration] Final: cmd_sent={tick} odom={received['odom']} "
                  f"rgb={received['image']} depth={received['depth']} "
                  f"lidar={received['lidar']}")

            if all(v == 0 for v in received.values()):
                print("\n[integration] No data received. Check:")
                print("  1. Bridge running:  ~/.deno/bin/deno run --allow-all --unstable-net dimos-cli/cli.ts dev")
                print("  2. Browser open at http://localhost:8090 with scene loaded")
                print("  3. Browser tab is in foreground (rAF needs focus)")
            elif received["odom"] > 0 and received["image"] == 0:
                print("\n[integration] Odom works but no sensor images.")
                print("  Check browser console for [DimosBridge] errors.")

    except KeyboardInterrupt:
        print("\n[integration] Interrupted by user")

    finally:
        # Send zero velocity (safety stop)
        try:
            stop_twist = Twist()
            stop_pkt = encode_lcm_packet(CH_CMD_VEL, stop_twist.lcm_encode())
            ws.send(stop_pkt, opcode=websocket.ABNF.OPCODE_BINARY)
        except Exception:
            pass

        ws.close()
        print("[integration] Done.")

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
