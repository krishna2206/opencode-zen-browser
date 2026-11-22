import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { startBridge } from "../host/bridge.mjs";
import { encodeNativeMessage, NativeFrameDecoder } from "../host/protocol.mjs";
import { runCli } from "../src/adapters/cli.js";

const tempDirs: string[] = [];

function makeTempSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zen-cli-test-"));
  tempDirs.push(dir);
  return path.join(dir, "bridge.sock");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("zen-browser CLI", () => {
  test("executes tabs, open, snapshot, click, type, fetch, network, and close via UNIX socket", async () => {
    const socketPath = makeTempSocketPath();
    const input = new PassThrough();
    const output = new PassThrough();
    const seenCalls: Array<{ method: string; params: Record<string, unknown> }> = [];

    const decoder = new NativeFrameDecoder(
      (msg: { id: number; method: string; params: Record<string, unknown> }) => {
        seenCalls.push({ method: msg.method, params: msg.params });

        let result: unknown = {};
        if (msg.method === "tabs.list") {
          result = {
            bridgeConnected: true,
            readOnly: false,
            attachedWindows: [1],
            tabs: [
              {
                id: 7,
                windowId: 1,
                title: "Example",
                url: "https://example.com",
                active: true,
                attached: true,
                openedByAgent: false,
                scriptable: true,
              },
            ],
          };
        } else if (msg.method === "tabs.open") {
          result = {
            id: 9,
            windowId: 1,
            title: "Opened",
            url: msg.params.url,
            active: false,
            attached: true,
            openedByAgent: true,
            scriptable: true,
          };
        } else if (msg.method === "tabs.snapshot") {
          result = {
            tabId: msg.params.tabId,
            windowId: 1,
            mode: "interactive",
            scope: "main",
            url: "https://example.com",
            title: "Example",
            refCount: 1,
            truncated: false,
            elements: [{ ref: "@1", role: "button", name: "Submit" }],
            content: 'button "Submit" [@1]',
          };
        } else if (msg.method === "tabs.interact") {
          result = { action: msg.params.action, ref: msg.params.ref, ok: true };
        } else if (msg.method === "tabs.fetch") {
          result = {
            tabId: msg.params.tabId,
            status: 200,
            ok: true,
            url: "https://example.com/api",
            contentType: "application/json",
            truncated: false,
            json: { ok: true },
          };
        } else if (msg.method === "tabs.network") {
          result = {
            tabId: msg.params.tabId,
            totalBuffered: 1,
            count: 1,
            entries: [
              {
                url: "https://example.com/graphql",
                method: "POST",
                statusCode: 200,
                timestamp: 12345,
                headers: { "content-type": "application/json" },
                requestBody: '{"op":"Viewer"}',
              },
            ],
          };
        } else if (msg.method === "tabs.close") {
          result = { action: "closed", tabId: msg.params.tabId };
        }

        input.write(encodeNativeMessage({ id: msg.id, result }));
      }
    );
    output.on("data", (chunk) => decoder.push(chunk));

    const bridge = startBridge({ socketPath, input, output });
    await new Promise((r) => setTimeout(r, 40));

    try {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const io = {
        stdout: (line: string) => stdout.push(line),
        stderr: (line: string) => stderr.push(line),
      };

      expect(await runCli(["--help"], io)).toBe(0);
      expect(stdout.pop()).toContain("zen-browser");

      expect(await runCli(["tabs", "--json", "--socket", socketPath], io)).toBe(0);
      const tabsRes = JSON.parse(stdout.pop()!) as { tabs: Array<{ tabId: number }> };
      expect(tabsRes.tabs[0].tabId).toBe(7);

      expect(await runCli(["open", "https://example.com/new", "--socket", socketPath], io)).toBe(0);
      expect(stdout.pop()).toContain("tabId=9");

      expect(await runCli(["snapshot", "--tab", "7", "--socket", socketPath], io)).toBe(0);
      expect(stdout.pop()).toContain('button "Submit" [@1]');

      expect(await runCli(["click", "@1", "--tab", "7", "--socket", socketPath], io)).toBe(0);
      stdout.pop();

      expect(
        await runCli(
          ["type", "@1", "hello world", "--no-clear", "--submit", "--tab", "7", "--socket", socketPath],
          io
        )
      ).toBe(0);
      stdout.pop();

      expect(
        await runCli(
          [
            "fetch",
            "/api",
            "--method",
            "POST",
            "--header",
            "x-csrf: tok",
            "--body",
            '{"a":1}',
            "--credentials",
            "omit",
            "--tab",
            "7",
            "--socket",
            socketPath,
          ],
          io
        )
      ).toBe(0);
      expect(stdout.pop()).toContain("200 https://example.com/api");

      expect(await runCli(["network", "--tab", "7", "--filter", "graphql", "--socket", socketPath], io)).toBe(0);
      expect(stdout.pop()).toContain("https://example.com/graphql");

      expect(await runCli(["close", "9", "--socket", socketPath], io)).toBe(0);
      expect(stdout.pop()).toContain("Closed agent-opened tab 9.");

      const fetchCall = seenCalls.find((c) => c.method === "tabs.fetch");
      expect(fetchCall?.params).toMatchObject({
        tabId: 7,
        url: "/api",
        method: "POST",
        headers: { "x-csrf": "tok" },
        body: { a: 1 },
        credentials: "omit",
      });

      const typeCall = seenCalls.find((c) => c.method === "tabs.interact" && c.params.action === "type");
      expect(typeCall?.params).toMatchObject({
        tabId: 7,
        ref: "@1",
        text: "hello world",
        clear: false,
        submit: true,
      });

      expect(stderr).toEqual([]);
    } finally {
      bridge.shutdown();
    }
  });

  test("rejects malformed flags with exit code 1", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io = {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    };

    expect(await runCli(["open"], io)).toBe(1);
    expect(stderr.pop()).toContain("Usage: zen-browser open");

    expect(await runCli(["snapshot", "--tab", "abc"], io)).toBe(1);
    expect(stderr.pop()).toContain("Invalid integer for --tab");

    expect(await runCli(["fetch", "/api", "--header", "badheader"], io)).toBe(1);
    expect(stderr.pop()).toContain("Invalid --header");
  });

  test("runs built bin/zen-browser under Node.js", () => {
    const repoRoot = path.resolve(import.meta.dir, "..");
    const distCli = path.join(repoRoot, "dist/adapters/cli.js");
    if (!fs.existsSync(distCli)) {
      throw new Error("dist/adapters/cli.js missing — run pnpm run build before tests");
    }
    const res = spawnSync("node", [path.join(repoRoot, "bin/zen-browser"), "--help"], {
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("zen-browser");
  });
});
