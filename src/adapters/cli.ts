import { parseArgs } from "node:util";
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

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const DEFAULT_IO: CliIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
};

const HELP_TEXT = `zen-browser — control attached Zen Browser tabs over the local Native Messaging bridge

Usage:
  zen-browser <command> [args] [options]

Commands:
  tabs                                      List attached tabs and read-only status
  open <url> [--tab <id>] [--window <id>] [--active]
                                            Open a background tab or navigate an attached tab
  snapshot [--tab <id>] [--mode interactive|markdown] [--scope auto|main|body] [--max-chars <n>]
                                            Extract @ref DOM tree or readable Markdown
  click <@ref> [--tab <id>] [--wait-ms <n>] Click an interactive element from snapshot
  type <@ref> <text> [--tab <id>] [--no-clear] [--submit] [--wait-ms <n>]
                                            Type or select a value in an element
  scroll [down|up|top|bottom] [--amount <n>] [--ref <@ref>] [--tab <id>] [--wait-ms <n>]
                                            Scroll page, container, or target element
  wait [--text <str> | --ms <n>] [--tab <id>]
                                            Wait for text to appear or sleep up to 10000ms
  back [--tab <id>]                         Navigate back in tab history
  fetch <url> [--method GET] [--header "K: V"] [--body <str|json>] [--credentials include|same-origin|omit] [--timeout-ms <n>] [--max-chars <n>] [--tab <id>]
                                            Execute a same-site HTTP/GraphQL fetch inside the tab
  network [--filter <str>] [--limit <n>] [--clear] [--tab <id>]
                                            Read captured XHR/fetch requests on a tab
  screenshot [--tab <id>]                   Save a PNG/JPEG capture to temp directory and print path
  close <tabId>                             Close an agent-opened tab or detach a user tab

Global options:
  --socket <path>   Override bridge socket path (or set ZEN_BROWSER_SOCKET)
  --json            Output raw JSON
  -h, --help        Show help`;

function parseIntOpt(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined) return undefined;
  const num = Number(raw);
  if (!Number.isInteger(num)) {
    throw new Error(`Invalid integer for ${name}: "${raw}"`);
  }
  return num;
}

function parseHeaders(rawHeaders: string[] | undefined): Record<string, string> | undefined {
  if (!rawHeaders || rawHeaders.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const item of rawHeaders) {
    const idx = item.indexOf(":");
    if (idx <= 0) {
      throw new Error(`Invalid --header "${item}". Expected "Key: Value".`);
    }
    const key = item.slice(0, idx).trim();
    const val = item.slice(idx + 1).trim();
    if (!key) {
      throw new Error(`Empty header name in "${item}".`);
    }
    out[key] = val;
  }
  return out;
}

function parseBody(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

export async function runCli(argv: string[], io: CliIo = DEFAULT_IO): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        socket: { type: "string" },
        tab: { type: "string" },
        window: { type: "string" },
        active: { type: "boolean" },
        mode: { type: "string" },
        scope: { type: "string" },
        "max-chars": { type: "string" },
        "wait-ms": { type: "string" },
        clear: { type: "boolean" },
        "no-clear": { type: "boolean" },
        submit: { type: "boolean" },
        amount: { type: "string" },
        ref: { type: "string" },
        text: { type: "string" },
        ms: { type: "string" },
        method: { type: "string" },
        header: { type: "string", multiple: true },
        body: { type: "string" },
        credentials: { type: "string" },
        "timeout-ms": { type: "string" },
        filter: { type: "string" },
        limit: { type: "string" },
      },
    });

    const [cmd, ...rest] = positionals;
    if (values.help || !cmd || cmd === "help") {
      io.stdout(HELP_TEXT);
      return 0;
    }

    const socketPath = resolveSocketPath(values.socket);
    const ctx = { socketPath };
    const tabId = parseIntOpt(values.tab, "--tab");
    const jsonOut = Boolean(values.json);

    if (cmd === "tabs") {
      const res = await listTabs(ctx);
      if (jsonOut) {
        io.stdout(JSON.stringify(res, null, 2));
      } else {
        const lines = [`Attached tabs: ${res.tabs.length} (readOnly: ${res.readOnly})`];
        for (const t of res.tabs) {
          const flags = [t.active ? "active" : null, t.openedByAgent ? "agent" : null].filter(Boolean);
          const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
          lines.push(`- tabId=${t.tabId} (windowId=${t.windowId})${flagStr}: ${t.title || "(untitled)"} — ${t.url}`);
        }
        io.stdout(lines.join("\n"));
      }
      return 0;
    }

    if (cmd === "open") {
      const url = rest[0];
      if (!url) throw new Error("Usage: zen-browser open <url> [--tab <id>] [--window <id>] [--active]");
      const tab = await openTab(
        {
          url,
          tabId,
          windowId: parseIntOpt(values.window, "--window"),
          active: Boolean(values.active),
        },
        ctx
      );
      if (jsonOut) {
        io.stdout(JSON.stringify(toTabSummary(tab), null, 2));
      } else {
        io.stdout(`Opened ${formatTabLine(tab)}`);
      }
      return 0;
    }

    if (cmd === "snapshot") {
      const mode = values.mode ?? "interactive";
      if (mode !== "interactive" && mode !== "markdown") {
        throw new Error(`Invalid --mode "${mode}". Use "interactive" or "markdown".`);
      }
      const scope = values.scope ?? "auto";
      if (scope !== "auto" && scope !== "main" && scope !== "body") {
        throw new Error(`Invalid --scope "${scope}". Use "auto", "main", or "body".`);
      }
      const { output } = await snapshotTab(
        {
          tabId,
          mode,
          scope,
          maxChars: parseIntOpt(values["max-chars"], "--max-chars"),
        },
        ctx
      );
      if (jsonOut) {
        io.stdout(JSON.stringify(output, null, 2));
      } else if (output.mode === "markdown") {
        io.stdout(`${output.title}\n${output.url}\n\n${output.content}`);
      } else {
        io.stdout(`${output.title} (${output.scope}, ${output.refCount} refs)\n\n${output.content}`);
      }
      return 0;
    }

    if (cmd === "click") {
      const ref = rest[0] ?? values.ref;
      if (!ref) throw new Error("Usage: zen-browser click <@ref> [--tab <id>] [--wait-ms <n>]");
      const res = await interactTab(
        {
          tabId,
          action: "click",
          ref,
          waitMs: parseIntOpt(values["wait-ms"], "--wait-ms"),
        },
        ctx
      );
      io.stdout(jsonOut ? JSON.stringify(res, null, 2) : JSON.stringify(res));
      return 0;
    }

    if (cmd === "type") {
      const ref = rest[0] ?? values.ref;
      const text = rest.length >= 2 ? rest.slice(1).join(" ") : values.text;
      if (!ref || text === undefined) {
        throw new Error("Usage: zen-browser type <@ref> <text> [--tab <id>] [--no-clear] [--submit]");
      }
      const clear = values["no-clear"] ? false : true;
      const res = await interactTab(
        {
          tabId,
          action: "type",
          ref,
          text,
          clear,
          submit: Boolean(values.submit),
          waitMs: parseIntOpt(values["wait-ms"], "--wait-ms"),
        },
        ctx
      );
      io.stdout(jsonOut ? JSON.stringify(res, null, 2) : JSON.stringify(res));
      return 0;
    }

    if (cmd === "scroll") {
      const direction = (rest[0] ?? "down") as "down" | "up" | "top" | "bottom";
      if (!["down", "up", "top", "bottom"].includes(direction)) {
        throw new Error(`Invalid scroll direction "${direction}". Use down, up, top, or bottom.`);
      }
      const res = await interactTab(
        {
          tabId,
          action: "scroll",
          direction,
          amount: parseIntOpt(values.amount, "--amount"),
          ref: values.ref,
          waitMs: parseIntOpt(values["wait-ms"], "--wait-ms"),
        },
        ctx
      );
      io.stdout(jsonOut ? JSON.stringify(res, null, 2) : JSON.stringify(res));
      return 0;
    }

    if (cmd === "wait") {
      const res = await interactTab(
        {
          tabId,
          action: "wait",
          text: values.text,
          ms: parseIntOpt(values.ms, "--ms"),
        },
        ctx
      );
      io.stdout(jsonOut ? JSON.stringify(res, null, 2) : JSON.stringify(res));
      return 0;
    }

    if (cmd === "back") {
      const res = await interactTab({ tabId, action: "back" }, ctx);
      io.stdout(jsonOut ? JSON.stringify(res, null, 2) : JSON.stringify(res));
      return 0;
    }

    if (cmd === "fetch") {
      const url = rest[0];
      if (!url) throw new Error("Usage: zen-browser fetch <url> [--method GET] [--header 'K: V'] [--body <data>]");
      const method = (values.method ?? "GET").toUpperCase() as
        | "GET"
        | "HEAD"
        | "POST"
        | "PUT"
        | "PATCH"
        | "DELETE"
        | "OPTIONS";
      if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(method)) {
        throw new Error(`Invalid HTTP method "${method}".`);
      }
      const credentials = values.credentials as "include" | "same-origin" | "omit" | undefined;
      if (credentials && !["include", "same-origin", "omit"].includes(credentials)) {
        throw new Error(`Invalid --credentials "${credentials}". Use include, same-origin, or omit.`);
      }
      const res = await fetchInTab(
        {
          tabId,
          url,
          method,
          headers: parseHeaders(values.header),
          body: parseBody(values.body),
          credentials,
          timeoutMs: parseIntOpt(values["timeout-ms"], "--timeout-ms"),
          maxChars: parseIntOpt(values["max-chars"], "--max-chars"),
        },
        ctx
      );
      if (jsonOut) {
        io.stdout(JSON.stringify(res, null, 2));
      } else {
        const bodyText =
          res.json !== undefined ? JSON.stringify(res.json, null, 2) : res.text ?? "";
        io.stdout(bodyText ? `${res.status} ${res.url}\n${bodyText}` : `${res.status} ${res.url}`);
      }
      return 0;
    }

    if (cmd === "network") {
      const res = await readNetworkLog(
        {
          tabId,
          filter: values.filter,
          limit: parseIntOpt(values.limit, "--limit"),
          clear: Boolean(values.clear),
        },
        ctx
      );
      if (jsonOut) {
        io.stdout(JSON.stringify(res, null, 2));
      } else {
        const lines = [`Captured ${res.count} requests (${res.totalBuffered} buffered) on tab ${res.tabId}`];
        for (const e of res.entries) {
          lines.push(`- [${e.statusCode ?? "pending"}] ${e.method} ${e.url}${e.error ? ` (${e.error})` : ""}`);
          if (e.requestBody) lines.push(`  body: ${e.requestBody}`);
        }
        io.stdout(lines.join("\n"));
      }
      return 0;
    }

    if (cmd === "screenshot") {
      const res = await screenshotTab({ tabId }, ctx);
      io.stdout(jsonOut ? JSON.stringify(res, null, 2) : res.path);
      return 0;
    }

    if (cmd === "close") {
      const targetId = rest[0] !== undefined ? parseIntOpt(rest[0], "<tabId>") : tabId;
      if (targetId === undefined) {
        throw new Error("Usage: zen-browser close <tabId>");
      }
      const res = await closeTab({ tabId: targetId }, ctx);
      if (jsonOut) {
        io.stdout(JSON.stringify(res, null, 2));
      } else {
        io.stdout(
          res.action === "closed"
            ? `Closed agent-opened tab ${res.tabId}.`
            : `Detached user tab ${res.tabId} (left open in Zen Browser).`
        );
      }
      return 0;
    }

    throw new Error(`Unknown command "${cmd}". Run "zen-browser --help" for usage.`);
  } catch (err) {
    io.stderr(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
