import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { startBridge } from "../host/bridge.mjs";
import { encodeNativeMessage, NativeFrameDecoder } from "../host/protocol.mjs";
import { callZenBridge, ZenBridgeError } from "../src/client.js";

const tempDirs: string[] = [];

function makeTempSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zen-bridge-test-"));
  tempDirs.push(dir);
  return path.join(dir, "bridge.sock");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("native messaging protocol & bridge", () => {
  test("decodes chunked and coalesced native frames", () => {
    const received: unknown[] = [];
    const decoder = new NativeFrameDecoder((msg) => received.push(msg));

    const f1 = encodeNativeMessage({ id: 1, method: "ping" });
    const f2 = encodeNativeMessage({ id: 2, result: { ok: true, text: "café" } });
    const combined = Buffer.concat([f1, f2]);

    decoder.push(combined.subarray(0, 3));
    expect(received.length).toBe(0);
    decoder.push(combined.subarray(3, 12));
    decoder.push(combined.subarray(12));

    expect(received).toEqual([
      { id: 1, method: "ping" },
      { id: 2, result: { ok: true, text: "café" } },
    ]);
  });

  test("accepts incoming frames larger than 1 MiB (e.g. screenshots)", () => {
    const received: unknown[] = [];
    const decoder = new NativeFrameDecoder((msg) => received.push(msg));
    const bigPayload = { id: 9, result: { data: "x".repeat(1_400_000) } };
    const frame = encodeNativeMessage(bigPayload, 16 * 1024 * 1024);

    decoder.push(frame);
    expect(received.length).toBe(1);
    expect((received[0] as typeof bigPayload).result.data.length).toBe(1_400_000);
  });

  test("multiplexes concurrent socket requests and cleans up socket on shutdown", async () => {
    const socketPath = makeTempSocketPath();
    const input = new PassThrough();
    const output = new PassThrough();

    const decoder = new NativeFrameDecoder((msg: { id: number; method: string; params: { n?: number } }) => {
      // Respond out-of-order to confirm id mapping across concurrent callers
      const delay = msg.params?.n === 1 ? 40 : 5;
      setTimeout(() => {
        input.write(
          encodeNativeMessage({
            id: msg.id,
            result: { echoed: msg.method, n: msg.params?.n },
          })
        );
      }, delay);
    });
    output.on("data", (chunk) => decoder.push(chunk));

    const bridge = startBridge({ socketPath, input, output });
    await new Promise((r) => setTimeout(r, 40));

    const stat = fs.statSync(socketPath);
    expect(stat.mode & 0o777).toBe(0o600);

    const [r1, r2, ping] = await Promise.all([
      callZenBridge("test.one", { n: 1 }, { socketPath }),
      callZenBridge("test.two", { n: 2 }, { socketPath }),
      callZenBridge("bridge.ping", {}, { socketPath }),
    ]);

    expect(r1).toEqual({ echoed: "test.one", n: 1 });
    expect(r2).toEqual({ echoed: "test.two", n: 2 });
    expect((ping as { bridge: boolean }).bridge).toBe(true);

    bridge.shutdown();
    expect(fs.existsSync(socketPath)).toBe(false);

    await expect(callZenBridge("ping", {}, { socketPath })).rejects.toBeInstanceOf(ZenBridgeError);
  });
});
