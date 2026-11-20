import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Plugin } from "@opencode/plugin";
import { Schema } from "effect";
import { callZenBridge, DEFAULT_SOCKET_PATH } from "./client.js";
import { htmlToReadableMarkdown } from "./markdown.js";
import type {
  CloseResult,
  FetchResult,
  InteractiveSnapshotResult,
  MarkdownSnapshotRawResult,
  ScreenshotRawResult,
  TabInfo,
  TabsListResult,
} from "./types.js";

const TabOutput = Schema.Struct({
  tabId: Schema.Number,
  windowId: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  active: Schema.Boolean,
  openedByAgent: Schema.Boolean,
});

const SnapshotElementOutput = Schema.Struct({
  ref: Schema.String,
  role: Schema.String,
  name: Schema.String,
  value: Schema.optional(Schema.String),
  checked: Schema.optional(Schema.Boolean),
  pressed: Schema.optional(Schema.Boolean),
  expanded: Schema.optional(Schema.Boolean),
  selected: Schema.optional(Schema.Boolean),
  disabled: Schema.optional(Schema.Boolean),
});

function toTabOutput(tab: TabInfo) {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title,
    url: tab.url,
    active: tab.active,
    openedByAgent: tab.openedByAgent,
  };
}

function formatTabLine(tab: TabInfo): string {
  const flags = [
    tab.active ? "active" : null,
    tab.openedByAgent ? "agent" : null,
  ].filter(Boolean);
  const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
  return `- tabId=${tab.id} (windowId=${tab.windowId})${flagStr}: ${tab.title || "(untitled)"} — ${tab.url}`;
}

async function resolveTargetTabId(
  explicitTabId: number | undefined,
  socketPath: string,
  signal: AbortSignal
): Promise<number> {
  if (typeof explicitTabId === "number") return explicitTabId;

  const list = await callZenBridge<TabsListResult>("tabs.list", {}, { socketPath, signal });
  if (list.tabs.length === 0) {
    throw new Error(
      "No Zen Browser tabs are currently attached. Ask the user to attach a tab in the Zen extension popup, or open one with tools.zen.open."
    );
  }
  if (list.tabs.length === 1) {
    return list.tabs[0].id;
  }
  const active = list.tabs.filter((t) => t.active);
  if (active.length === 1) {
    return active[0].id;
  }
  throw new Error(
    `Multiple tabs are attached. Pass tabId explicitly:\n${list.tabs.map(formatTabLine).join("\n")}`
  );
}

const ZEN_OPTIONS = { namespace: "zen", codemode: true, pinned: false } as const;

export default Plugin.define({
  id: "opencode-zen-browser",
  setup: async (ctx) => {
    const socketPath =
      typeof ctx.options?.socketPath === "string" && ctx.options.socketPath.length > 0
        ? ctx.options.socketPath
        : DEFAULT_SOCKET_PATH;

    await ctx.tool.transform((tools) => {
      tools.namespace({
        name: "zen",
        description:
          "Explore and interact with attached Zen Browser tabs (tabs, open, snapshot, interact, fetch, screenshot, close). Use in Code Mode to batch navigation, clicks, waits, authenticated same-site requests and snapshots into a single execute call.",
      });

      tools.add({
        name: "tabs",
        options: ZEN_OPTIONS,
        description:
          "List Zen Browser tabs currently attached/authorized for the agent, along with bridge status and read-only mode.",
        input: Schema.Struct({}),
        output: Schema.Struct({
          bridgeConnected: Schema.Boolean,
          readOnly: Schema.Boolean,
          tabs: Schema.Array(TabOutput),
        }),
        execute: async (_input, context) => {
          const data = await callZenBridge<TabsListResult>(
            "tabs.list",
            {},
            { socketPath, signal: context.signal }
          );
          const output = {
            bridgeConnected: data.bridgeConnected,
            readOnly: data.readOnly,
            tabs: data.tabs.map(toTabOutput),
          };
          return {
            output,
            content: `Attached tabs: ${output.tabs.length} (readOnly: ${output.readOnly})`,
            metadata: { count: output.tabs.length, readOnly: output.readOnly },
          };
        },
      });

      tools.add({
        name: "open",
        options: ZEN_OPTIONS,
        description:
          "Open an http(s) URL in Zen Browser (defaults to a background tab in the attached window/container), or navigate an already-attached tab.",
        input: Schema.Struct({
          url: Schema.String.annotate({ description: "Target http:// or https:// URL" }),
          tabId: Schema.optional(
            Schema.Number.annotate({ description: "Existing attached tabId to navigate instead of opening a new tab" })
          ),
          windowId: Schema.optional(
            Schema.Number.annotate({ description: "Target Zen windowId when opening a new tab" })
          ),
          active: Schema.optional(
            Schema.Boolean.annotate({ description: "Focus the opened tab (default false)" })
          ),
        }),
        output: TabOutput,
        execute: async (input, context) => {
          const tab = await callZenBridge<TabInfo>(
            "tabs.open",
            {
              url: input.url,
              tabId: input.tabId,
              windowId: input.windowId,
              active: input.active ?? false,
            },
            { socketPath, signal: context.signal }
          );
          return {
            output: toTabOutput(tab),
            content: `Opened ${formatTabLine(tab)}`,
            metadata: { tabId: tab.id, windowId: tab.windowId, url: tab.url },
          };
        },
      });

      tools.add({
        name: "snapshot",
        options: ZEN_OPTIONS,
        description:
          "Read an attached Zen Browser tab. Interactive mode returns both compact text (content) and structured elements ([{ ref, role, name, ... }]); markdown mode extracts clean prose via Readability + Turndown.",
        input: Schema.Struct({
          tabId: Schema.optional(
            Schema.Number.annotate({ description: "Attached tabId (optional if only one tab is attached or active)" })
          ),
          mode: Schema.optional(
            Schema.Literals(["interactive", "markdown"]).annotate({
              description: "'interactive' (default) for @ref tree + elements, 'markdown' for clean readable Markdown",
            })
          ),
          scope: Schema.optional(
            Schema.Literals(["auto", "main", "body"]).annotate({
              description: "'auto' (default: open dialog > main > body), 'main', or 'body' (includes top navbar/sidebars)",
            })
          ),
          maxChars: Schema.optional(
            Schema.Number.annotate({ description: "Max characters to return (default 8000 for interactive, 16000 for markdown)" })
          ),
        }),
        output: Schema.Struct({
          tabId: Schema.Number,
          mode: Schema.Literals(["interactive", "markdown"]),
          url: Schema.String,
          title: Schema.String,
          truncated: Schema.Boolean,
          scope: Schema.optional(Schema.String),
          refCount: Schema.optional(Schema.Number),
          elements: Schema.optional(Schema.Array(SnapshotElementOutput)),
          content: Schema.String,
        }),
        execute: async (input, context) => {
          const tabId = await resolveTargetTabId(input.tabId, socketPath, context.signal);
          const mode = input.mode ?? "interactive";
          const maxChars = input.maxChars ?? (mode === "markdown" ? 16_000 : 8_000);

          if (mode === "markdown") {
            const raw = await callZenBridge<MarkdownSnapshotRawResult>(
              "tabs.snapshot",
              { tabId, mode: "markdown" },
              { socketPath, signal: context.signal }
            );
            const converted = htmlToReadableMarkdown(raw.html, {
              url: raw.url,
              title: raw.title,
              maxChars,
            });
            const output = {
              tabId: raw.tabId,
              mode: "markdown" as const,
              url: raw.url,
              title: converted.title || raw.title,
              truncated: converted.truncated,
              content: converted.markdown,
            };
            return {
              output,
              content: `${output.title}\n${output.url}\n\n${output.content}`,
              metadata: {
                tabId: raw.tabId,
                mode: "markdown",
                usedReadability: converted.usedReadability,
                truncated: converted.truncated,
              },
            };
          }

          const snap = await callZenBridge<InteractiveSnapshotResult>(
            "tabs.snapshot",
            { tabId, mode: "interactive", maxChars, scope: input.scope ?? "auto" },
            { socketPath, signal: context.signal }
          );
          const output = {
            tabId: snap.tabId,
            mode: "interactive" as const,
            url: snap.url,
            title: snap.title,
            truncated: snap.truncated,
            scope: snap.scope ?? "body",
            refCount: snap.refCount,
            elements: snap.elements ?? [],
            content: snap.content,
          };
          return {
            output,
            content: `${output.title} (${output.scope}, ${output.refCount} refs)\n\n${output.content}`,
            metadata: {
              tabId: snap.tabId,
              mode: "interactive",
              scope: output.scope,
              refCount: snap.refCount,
              truncated: snap.truncated,
            },
          };
        },
      });

      tools.add({
        name: "interact",
        options: ZEN_OPTIONS,
        description:
          "Interact with an attached Zen Browser tab: click or type on @refs from snapshot, scroll, wait, or go back. Blocked actions (click/type/back) fail cleanly if Read-only mode is active.",
        input: Schema.Struct({
          tabId: Schema.optional(
            Schema.Number.annotate({ description: "Attached tabId (optional if unambiguous)" })
          ),
          action: Schema.Literals(["click", "type", "scroll", "wait", "back"]),
          ref: Schema.optional(
            Schema.String.annotate({ description: "Element reference like '@12' from snapshot (for click/type/scroll)" })
          ),
          text: Schema.optional(
            Schema.String.annotate({ description: "Text to type (for action='type') or text to wait for (for action='wait')" })
          ),
          clear: Schema.optional(
            Schema.Boolean.annotate({ description: "Replace existing input value before typing (default true)" })
          ),
          submit: Schema.optional(
            Schema.Boolean.annotate({ description: "Press Enter / submit after typing (default false)" })
          ),
          direction: Schema.optional(
            Schema.Literals(["down", "up", "top", "bottom"]).annotate({ description: "Scroll direction (default 'down')" })
          ),
          amount: Schema.optional(
            Schema.Number.annotate({ description: "Scroll distance in pixels (default 600)" })
          ),
          ms: Schema.optional(
            Schema.Number.annotate({ description: "Wait duration or text-wait timeout in ms (max 10000)" })
          ),
          waitMs: Schema.optional(
            Schema.Number.annotate({ description: "Optional post-action wait in ms (max 10000)" })
          ),
        }),
        output: Schema.Struct({
          tabId: Schema.Number,
          action: Schema.String,
          ref: Schema.optional(Schema.String),
          tag: Schema.optional(Schema.String),
          label: Schema.optional(Schema.String),
          url: Schema.optional(Schema.String),
          title: Schema.optional(Schema.String),
          length: Schema.optional(Schema.Number),
          submitted: Schema.optional(Schema.Boolean),
          target: Schema.optional(Schema.String),
          direction: Schema.optional(Schema.String),
          scrollTop: Schema.optional(Schema.Number),
          scrollY: Schema.optional(Schema.Number),
          scrollHeight: Schema.optional(Schema.Number),
          found: Schema.optional(Schema.Boolean),
          text: Schema.optional(Schema.String),
          waitedMs: Schema.optional(Schema.Number),
        }),
        execute: async (input, context) => {
          const tabId = await resolveTargetTabId(input.tabId, socketPath, context.signal);
          const result = await callZenBridge<Record<string, unknown>>(
            "tabs.interact",
            {
              tabId,
              action: input.action,
              ref: input.ref,
              text: input.text,
              clear: input.clear,
              submit: input.submit,
              direction: input.direction,
              amount: input.amount,
              ms: input.ms,
              waitMs: input.waitMs,
            },
            { socketPath, signal: context.signal }
          );
          const output = {
            tabId,
            action: input.action,
            ...result,
          } as {
            tabId: number;
            action: string;
            ref?: string;
            tag?: string;
            label?: string;
            url?: string;
            title?: string;
            length?: number;
            submitted?: boolean;
            target?: string;
            direction?: string;
            scrollTop?: number;
            scrollY?: number;
            scrollHeight?: number;
            found?: boolean;
            text?: string;
            waitedMs?: number;
          };
          return {
            output,
            content: JSON.stringify(output),
            metadata: { tabId, action: input.action },
          };
        },
      });

      tools.add({
        name: "screenshot",
        options: ZEN_OPTIONS,
        description:
          "Capture a screenshot of an attached Zen Browser tab and save it to a temporary file. Returns the file path (inspect with the read tool only when needed).",
        input: Schema.Struct({
          tabId: Schema.optional(
            Schema.Number.annotate({ description: "Attached tabId (optional if unambiguous)" })
          ),
        }),
        output: Schema.Struct({
          tabId: Schema.Number,
          path: Schema.String,
          mime: Schema.String,
          title: Schema.String,
          url: Schema.String,
        }),
        execute: async (input, context) => {
          const tabId = await resolveTargetTabId(input.tabId, socketPath, context.signal);
          const shot = await callZenBridge<ScreenshotRawResult>(
            "tabs.screenshot",
            { tabId },
            { socketPath, signal: context.signal }
          );
          const isJpeg = shot.mimeType === "image/jpeg" || shot.dataUrl.startsWith("data:image/jpeg");
          const mime = isJpeg ? "image/jpeg" : "image/png";
          const ext = isJpeg ? "jpg" : "png";
          const base64 = shot.dataUrl.replace(/^data:image\/[a-z]+;base64,/, "");
          const dir = path.join(os.tmpdir(), "opencode-zen-browser");
          await fs.mkdir(dir, { recursive: true });
          const filename = `zen-tab-${shot.tabId}-${Date.now()}.${ext}`;
          const filePath = path.join(dir, filename);
          await fs.writeFile(filePath, Buffer.from(base64, "base64"));

          const output = {
            tabId: shot.tabId,
            path: filePath,
            mime,
            title: shot.title,
            url: shot.url,
          };
          return {
            output,
            content: `Screenshot saved to: ${filePath}`,
            metadata: { tabId: shot.tabId, path: filePath, mime },
          };
        },
      });

      tools.add({
        name: "fetch",
        options: ZEN_OPTIONS,
        description:
          "Perform an authenticated same-site HTTP/GraphQL fetch from inside an attached Zen Browser tab (reuses browser TLS, cookies, CSRF and anti-bot state). Read-only mode permits GET/HEAD only.",
        input: Schema.Struct({
          tabId: Schema.optional(
            Schema.Number.annotate({ description: "Attached tabId whose origin/session executes the request" })
          ),
          url: Schema.String.annotate({
            description: "Same-site http(s) URL or relative path (e.g. '/i/api/graphql/...')",
          }),
          method: Schema.optional(
            Schema.Literals(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]).annotate({
              description: "HTTP method (default 'GET')",
            })
          ),
          headers: Schema.optional(
            Schema.Record(Schema.String, Schema.String).annotate({
              description: "Extra request headers (e.g. x-csrf-token, authorization)",
            })
          ),
          body: Schema.optional(
            Schema.Json.annotate({
              description: "Request body (string or JSON object/array, auto-serialized as JSON)",
            })
          ),
          timeoutMs: Schema.optional(
            Schema.Number.annotate({ description: "Request timeout in ms (default 15000, max 30000)" })
          ),
          maxChars: Schema.optional(
            Schema.Number.annotate({ description: "Max text length if non-JSON response (default 100000)" })
          ),
        }),
        output: Schema.Struct({
          tabId: Schema.Number,
          status: Schema.Number,
          ok: Schema.Boolean,
          url: Schema.String,
          contentType: Schema.String,
          truncated: Schema.Boolean,
          json: Schema.optional(Schema.Json),
          text: Schema.optional(Schema.String),
        }),
        execute: async (input, context) => {
          const tabId = await resolveTargetTabId(input.tabId, socketPath, context.signal);
          const res = await callZenBridge<FetchResult>(
            "tabs.fetch",
            {
              tabId,
              url: input.url,
              method: input.method ?? "GET",
              headers: input.headers,
              body: input.body,
              timeoutMs: input.timeoutMs,
              maxChars: input.maxChars,
            },
            { socketPath, signal: context.signal }
          );
          const output = {
            tabId: res.tabId,
            status: res.status,
            ok: res.ok,
            url: res.url,
            contentType: res.contentType,
            truncated: res.truncated,
            ...(res.json !== undefined ? { json: res.json as Schema.Json } : {}),
            ...(res.text !== undefined ? { text: res.text } : {}),
          };
          return {
            output,
            content: `${res.status} ${res.url}`,
            metadata: { tabId: res.tabId, status: res.status, ok: res.ok },
          };
        },
      });

      tools.add({
        name: "close",
        options: ZEN_OPTIONS,
        description:
          "Close a tab that was opened by tools.zen.open, or detach a user-owned attached tab without closing it.",
        input: Schema.Struct({
          tabId: Schema.Number.annotate({ description: "Attached tabId to close or detach" }),
        }),
        output: Schema.Struct({
          tabId: Schema.Number,
          action: Schema.Literals(["closed", "detached"]),
        }),
        execute: async (input, context) => {
          const res = await callZenBridge<CloseResult>(
            "tabs.close",
            { tabId: input.tabId },
            { socketPath, signal: context.signal }
          );
          const output = {
            tabId: res.tabId,
            action: res.action,
          };
          return {
            output,
            content:
              res.action === "closed"
                ? `Closed agent-opened tab ${res.tabId}.`
                : `Detached user tab ${res.tabId} (left open in Zen Browser).`,
            metadata: { tabId: res.tabId, action: res.action },
          };
        },
      });
    });
  },
});
