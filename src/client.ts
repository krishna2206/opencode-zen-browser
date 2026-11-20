import net from "node:net";
import os from "node:os";
import path from "node:path";

export const DEFAULT_SOCKET_PATH = path.join(
  os.homedir(),
  ".cache",
  "opencode-zen-browser",
  "bridge.sock"
);

export class ZenBridgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ZenBridgeError";
    this.code = code;
  }
}

export interface RpcCallOptions {
  socketPath?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function callZenBridge<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  options: RpcCallOptions = {}
): Promise<T> {
  const socketPath = options.socketPath ?? DEFAULT_SOCKET_PATH;
  const timeoutMs = options.timeoutMs ?? 35_000;
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return await new Promise<T>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new ZenBridgeError("ABORTED", "Request aborted"));
      return;
    }

    let settled = false;
    let buffer = "";
    const socket = net.createConnection(socketPath);

    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (!socket.destroyed) {
        socket.destroy();
      }
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onAbort = () => {
      fail(new ZenBridgeError("ABORTED", "Request aborted by caller"));
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });

    const timer = setTimeout(() => {
      fail(new ZenBridgeError("TIMEOUT", `Zen Browser did not respond within ${timeoutMs}ms`));
    }, timeoutMs);

    socket.on("connect", () => {
      const payload = JSON.stringify({
        id: requestId,
        method,
        params,
        timeoutMs,
      });
      socket.write(payload + "\n");
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;

        let msg: { id?: unknown; result?: T; error?: { code?: string; message?: string } };
        try {
          msg = JSON.parse(line);
        } catch {
          fail(new ZenBridgeError("INVALID_RESPONSE", "Bridge returned malformed JSON"));
          return;
        }

        if (msg.id !== requestId) continue;

        settled = true;
        cleanup();
        if (msg.error) {
          reject(
            new ZenBridgeError(
              msg.error.code || "EXTENSION_ERROR",
              msg.error.message || "Unknown extension error"
            )
          );
          return;
        }
        resolve(msg.result as T);
        return;
      }
    });

    socket.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT" || err.code === "ECONNREFUSED") {
        fail(
          new ZenBridgeError(
            "BRIDGE_UNAVAILABLE",
            `Zen Browser bridge is unavailable (${socketPath}). Ensure Zen Browser is open and the OpenCode Zen Browser extension is loaded.`
          )
        );
        return;
      }
      fail(new ZenBridgeError(err.code || "SOCKET_ERROR", err.message));
    });

    socket.on("close", () => {
      if (!settled) {
        fail(new ZenBridgeError("BRIDGE_CLOSED", "Connection to Zen Browser bridge closed"));
      }
    });
  });
}
