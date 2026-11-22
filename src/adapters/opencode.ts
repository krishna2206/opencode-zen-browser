import { Plugin } from "@opencode/plugin";
import { Schema } from "effect";
import {
  closeTab,
  fetchInTab,
  formatTabLine,
  interactTab,
  listTabs,
  openTab,
  readNetworkLog,
  screenshotTab,
  snapshotTab,
  toTabSummary,
} from "../core/actions.js";
import { resolveSocketPath } from "../core/client.js";

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

const ZEN_OPTIONS = { namespace: "zen", codemode: true, pinned: false } as const;

export default Plugin.define({
  id: "opencode-zen-browser",
  setup: async (ctx) => {
    const socketPath = resolveSocketPath(
      typeof ctx.options?.socketPath === "string" && ctx.options.socketPath.length > 0
        ? ctx.options.socketPath
        : undefined
    );

    await ctx.tool.transform((tools) => {
      tools.namespace({
        name: "zen",
        description:
          "Explore and interact with attached Zen Browser tabs (tabs, open, snapshot, interact, fetch, network, screenshot, close). Use in Code Mode to batch navigation, clicks, waits, passive network inspection, authenticated same-site requests and snapshots into a single execute call.",
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
          const output = await listTabs({ socketPath, signal: context.signal });
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
            Schema.Number.annotate({
              description: "Existing attached tabId to navigate instead of opening a new tab",
            })
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
          const tab = await openTab(input, { socketPath, signal: context.signal });
          return {
            output: toTabSummary(tab),
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
            Schema.Number.annotate({
              description: "Attached tabId (optional if only one tab is attached or active)",
            })
          ),
          mode: Schema.optional(
            Schema.Literals(["interactive", "markdown"]).annotate({
              description:
                "'interactive' (default) for @ref tree + elements, 'markdown' for clean readable Markdown",
            })
          ),
          scope: Schema.optional(
            Schema.Literals(["auto", "main", "body"]).annotate({
              description:
                "'auto' (default: open dialog > main > body), 'main', or 'body' (includes top navbar/sidebars)",
            })
          ),
          maxChars: Schema.optional(
            Schema.Number.annotate({
              description: "Max characters to return (default 8000 for interactive, 16000 for markdown)",
            })
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
          const { output, usedReadability } = await snapshotTab(input, {
            socketPath,
            signal: context.signal,
          });
          if (output.mode === "markdown") {
            return {
              output,
              content: `${output.title}\n${output.url}\n\n${output.content}`,
              metadata: {
                tabId: output.tabId,
                mode: "markdown",
                usedReadability: Boolean(usedReadability),
                truncated: output.truncated,
              },
            };
          }
          return {
            output,
            content: `${output.title} (${output.scope}, ${output.refCount} refs)\n\n${output.content}`,
            metadata: {
              tabId: output.tabId,
              mode: "interactive",
              scope: output.scope,
              refCount: output.refCount,
              truncated: output.truncated,
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
            Schema.String.annotate({
              description: "Element reference like '@12' from snapshot (for click/type/scroll)",
            })
          ),
          text: Schema.optional(
            Schema.String.annotate({
              description: "Text to type (for action='type') or text to wait for (for action='wait')",
            })
          ),
          clear: Schema.optional(
            Schema.Boolean.annotate({
              description: "Replace existing input value before typing (default true)",
            })
          ),
          submit: Schema.optional(
            Schema.Boolean.annotate({ description: "Press Enter / submit after typing (default false)" })
          ),
          direction: Schema.optional(
            Schema.Literals(["down", "up", "top", "bottom"]).annotate({
              description: "Scroll direction (default 'down')",
            })
          ),
          amount: Schema.optional(
            Schema.Number.annotate({ description: "Scroll distance in pixels (default 600)" })
          ),
          ms: Schema.optional(
            Schema.Number.annotate({
              description: "Wait duration or text-wait timeout in ms (max 10000)",
            })
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
          const output = await interactTab(input, { socketPath, signal: context.signal });
          return {
            output,
            content: JSON.stringify(output),
            metadata: { tabId: output.tabId, action: input.action },
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
          const output = await screenshotTab(input, { socketPath, signal: context.signal });
          return {
            output,
            content: `Screenshot saved to: ${output.path}`,
            metadata: { tabId: output.tabId, path: output.path, mime: output.mime },
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
            Schema.Number.annotate({
              description: "Attached tabId whose origin/session executes the request",
            })
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
          credentials: Schema.optional(
            Schema.Literals(["include", "same-origin", "omit"]).annotate({
              description:
                "Fetch credentials mode (default 'include'; use 'omit' for public CORS '*' endpoints)",
            })
          ),
          timeoutMs: Schema.optional(
            Schema.Number.annotate({ description: "Request timeout in ms (default 15000, max 30000)" })
          ),
          maxChars: Schema.optional(
            Schema.Number.annotate({
              description: "Max text length if non-JSON response (default 100000)",
            })
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
          const res = await fetchInTab(input, { socketPath, signal: context.signal });
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
        name: "network",
        options: ZEN_OPTIONS,
        description:
          "Read recent XHR/fetch requests captured passively on an attached tab (URL, method, statusCode, non-cookie headers, requestBody) to discover GraphQL queryIds or API endpoints without DevTools.",
        input: Schema.Struct({
          tabId: Schema.optional(
            Schema.Number.annotate({ description: "Attached tabId (optional if unambiguous)" })
          ),
          filter: Schema.optional(
            Schema.String.annotate({
              description:
                "Case-insensitive substring filter against URL or requestBody (e.g. 'graphql')",
            })
          ),
          limit: Schema.optional(
            Schema.Number.annotate({ description: "Max most-recent entries to return (default 25, max 80)" })
          ),
          clear: Schema.optional(
            Schema.Boolean.annotate({
              description: "Clear the tab's captured buffer after reading (default false)",
            })
          ),
        }),
        output: Schema.Struct({
          tabId: Schema.Number,
          totalBuffered: Schema.Number,
          count: Schema.Number,
          entries: Schema.Array(
            Schema.Struct({
              url: Schema.String,
              method: Schema.String,
              statusCode: Schema.Union([Schema.Number, Schema.Null]),
              timestamp: Schema.Number,
              headers: Schema.Record(Schema.String, Schema.String),
              requestBody: Schema.optional(Schema.String),
              error: Schema.optional(Schema.String),
            })
          ),
        }),
        execute: async (input, context) => {
          const res = await readNetworkLog(input, { socketPath, signal: context.signal });
          return {
            output: res,
            content: `Captured ${res.count} requests (${res.totalBuffered} buffered) on tab ${res.tabId}`,
            metadata: { tabId: res.tabId, count: res.count },
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
          const res = await closeTab(input, { socketPath, signal: context.signal });
          return {
            output: res,
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
