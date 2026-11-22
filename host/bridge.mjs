import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NativeFrameDecoder, encodeNativeMessage } from "./protocol.mjs";

export const CACHE_DIR = path.join(os.homedir(), ".cache", "opencode-zen-browser");
export const SOCKET_PATH = path.join(CACHE_DIR, "bridge.sock");
const DEFAULT_TIMEOUT_MS = 35_000;

export function startBridge({
  socketPath = SOCKET_PATH,
  input = process.stdin,
  output = process.stdout,
  onShutdown,
} = {}) {
  const dir = path.dirname(socketPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }

  let nextInternalId = 1;
  let closed = false;
  const pending = new Map();
  const clients = new Set();

  function writeToExtension(message) {
    const frame = encodeNativeMessage(message);
    output.write(frame);
  }

  function sendToClient(client, payload) {
    if (client.destroyed) return;
    client.write(JSON.stringify(payload) + "\n");
  }

  const decoder = new NativeFrameDecoder((msg) => {
    if (!msg || typeof msg !== "object") return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(msg.id);

    sendToClient(entry.client, {
      id: entry.originalId,
      ...(msg.error ? { error: msg.error } : { result: msg.result }),
    });
  });

  const server = net.createServer((client) => {
    clients.add(client);
    let lineBuf = "";

    client.on("data", (chunk) => {
      lineBuf += chunk.toString("utf8");
      let idx;
      while ((idx = lineBuf.indexOf("\n")) !== -1) {
        const line = lineBuf.slice(0, idx).trim();
        lineBuf = lineBuf.slice(idx + 1);
        if (!line) continue;

        let req;
        try {
          req = JSON.parse(line);
        } catch {
          sendToClient(client, {
            id: null,
            error: { code: "INVALID_JSON", message: "Malformed JSON request" },
          });
          continue;
        }

        if (!req || typeof req.method !== "string") {
          sendToClient(client, {
            id: req?.id ?? null,
            error: { code: "INVALID_REQUEST", message: "Missing method field" },
          });
          continue;
        }

        if (req.method === "bridge.ping") {
          sendToClient(client, {
            id: req.id ?? null,
            result: { ok: true, bridge: true, pid: process.pid },
          });
          continue;
        }

        const internalId = nextInternalId++;
        const timeoutMs = typeof req.timeoutMs === "number" && req.timeoutMs > 0
          ? req.timeoutMs
          : DEFAULT_TIMEOUT_MS;

        const timer = setTimeout(() => {
          pending.delete(internalId);
          sendToClient(client, {
            id: req.id ?? null,
            error: { code: "TIMEOUT", message: `Extension did not respond within ${timeoutMs}ms` },
          });
        }, timeoutMs);

        pending.set(internalId, {
          client,
          originalId: req.id ?? null,
          timer,
        });

        try {
          writeToExtension({
            id: internalId,
            method: req.method,
            params: req.params ?? {},
          });
        } catch (err) {
          clearTimeout(timer);
          pending.delete(internalId);
          sendToClient(client, {
            id: req.id ?? null,
            error: {
              code: "WRITE_FAILED",
              message: err instanceof Error ? err.message : String(err),
            },
          });
        }
      }
    });

    client.on("close", () => {
      clients.delete(client);
      for (const [internalId, entry] of pending.entries()) {
        if (entry.client === client) {
          clearTimeout(entry.timer);
          pending.delete(internalId);
        }
      }
    });

    client.on("error", () => {
      client.destroy();
    });
  });

  server.listen(socketPath, () => {
    try {
      fs.chmodSync(socketPath, 0o600);
    } catch {
      // Ignore if socket already removed on fast shutdown
    }
  });

  function shutdown(exitCode = 0) {
    if (closed) return;
    closed = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      sendToClient(entry.client, {
        id: entry.originalId,
        error: { code: "BRIDGE_CLOSED", message: "Browser bridge disconnected" },
      });
    }
    pending.clear();
    for (const client of clients) {
      client.destroy();
    }
    clients.clear();
    server.close();
    try {
      if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
      }
    } catch {
      // Ignore cleanup race
    }
    onShutdown?.(exitCode);
  }

  input.on("data", (chunk) => {
    try {
      decoder.push(chunk);
    } catch (err) {
      const msg = `[opencode-zen-browser] decode error: ${err instanceof Error ? err.stack || err.message : String(err)}\n`;
      process.stderr.write(msg);
      try {
        fs.appendFileSync(path.join(dir, "bridge.log"), `${new Date().toISOString()} ${msg}`);
      } catch {
        // ignore log write failure
      }
      shutdown(1);
    }
  });

  input.on("end", () => shutdown(0));
  input.on("close", () => shutdown(0));
  input.on("error", () => shutdown(1));

  return { server, shutdown, socketPath };
}

const isMainModule = (() => {
  try {
    if (!process.argv[1]) return false;
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMainModule) {
  const { shutdown } = startBridge({
    onShutdown: (code) => {
      setTimeout(() => process.exit(code), 20);
    },
  });
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}
