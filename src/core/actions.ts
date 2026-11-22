import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { callZenBridge, resolveSocketPath } from "./client.js";
import { htmlToReadableMarkdown } from "./markdown.js";
import type {
  CloseResult,
  FetchResult,
  InteractResult,
  InteractiveSnapshotResult,
  MarkdownSnapshotRawResult,
  NetworkResult,
  ScreenshotRawResult,
  ScreenshotResult,
  SnapshotElement,
  TabInfo,
  TabsListResult,
  TabSummary,
} from "./types.js";

export interface ActionContext {
  socketPath?: string;
  signal?: AbortSignal;
}

export function toTabSummary(tab: TabInfo): TabSummary {
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title,
    url: tab.url,
    active: tab.active,
    openedByAgent: tab.openedByAgent,
  };
}

export function formatTabLine(tab: TabInfo): string {
  const flags = [tab.active ? "active" : null, tab.openedByAgent ? "agent" : null].filter(Boolean);
  const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
  return `- tabId=${tab.id} (windowId=${tab.windowId})${flagStr}: ${tab.title || "(untitled)"} — ${tab.url}`;
}

export async function resolveTargetTabId(
  explicitTabId: number | undefined,
  ctx: ActionContext = {}
): Promise<number> {
  if (typeof explicitTabId === "number") return explicitTabId;

  const socketPath = resolveSocketPath(ctx.socketPath);
  const list = await callZenBridge<TabsListResult>(
    "tabs.list",
    {},
    { socketPath, signal: ctx.signal }
  );
  if (list.tabs.length === 0) {
    throw new Error(
      "No Zen Browser tabs are currently attached. Ask the user to attach a tab in the Zen extension popup, or open one with open."
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

export async function listTabs(ctx: ActionContext = {}): Promise<{
  bridgeConnected: boolean;
  readOnly: boolean;
  tabs: TabSummary[];
}> {
  const socketPath = resolveSocketPath(ctx.socketPath);
  const data = await callZenBridge<TabsListResult>(
    "tabs.list",
    {},
    { socketPath, signal: ctx.signal }
  );
  return {
    bridgeConnected: data.bridgeConnected,
    readOnly: data.readOnly,
    tabs: data.tabs.map(toTabSummary),
  };
}

export async function openTab(
  input: { url: string; tabId?: number; windowId?: number; active?: boolean },
  ctx: ActionContext = {}
): Promise<TabInfo> {
  const socketPath = resolveSocketPath(ctx.socketPath);
  return await callZenBridge<TabInfo>(
    "tabs.open",
    {
      url: input.url,
      tabId: input.tabId,
      windowId: input.windowId,
      active: input.active ?? false,
    },
    { socketPath, signal: ctx.signal }
  );
}

export async function snapshotTab(
  input: {
    tabId?: number;
    mode?: "interactive" | "markdown";
    scope?: "auto" | "main" | "body";
    maxChars?: number;
  } = {},
  ctx: ActionContext = {}
): Promise<{
  output: {
    tabId: number;
    mode: "interactive" | "markdown";
    url: string;
    title: string;
    truncated: boolean;
    scope?: string;
    refCount?: number;
    elements?: SnapshotElement[];
    content: string;
  };
  usedReadability?: boolean;
}> {
  const socketPath = resolveSocketPath(ctx.socketPath);
  const tabId = await resolveTargetTabId(input.tabId, { socketPath, signal: ctx.signal });
  const mode = input.mode ?? "interactive";
  const maxChars = input.maxChars ?? (mode === "markdown" ? 16_000 : 8_000);

  if (mode === "markdown") {
    const raw = await callZenBridge<MarkdownSnapshotRawResult>(
      "tabs.snapshot",
      { tabId, mode: "markdown" },
      { socketPath, signal: ctx.signal }
    );
    const converted = htmlToReadableMarkdown(raw.html, {
      url: raw.url,
      title: raw.title,
      maxChars,
    });
    return {
      output: {
        tabId: raw.tabId,
        mode: "markdown",
        url: raw.url,
        title: converted.title || raw.title,
        truncated: converted.truncated,
        content: converted.markdown,
      },
      usedReadability: converted.usedReadability,
    };
  }

  const snap = await callZenBridge<InteractiveSnapshotResult>(
    "tabs.snapshot",
    { tabId, mode: "interactive", maxChars, scope: input.scope ?? "auto" },
    { socketPath, signal: ctx.signal }
  );
  return {
    output: {
      tabId: snap.tabId,
      mode: "interactive",
      url: snap.url,
      title: snap.title,
      truncated: snap.truncated,
      scope: snap.scope ?? "body",
      refCount: snap.refCount,
      elements: snap.elements ?? [],
      content: snap.content,
    },
  };
}

export async function interactTab(
  input: {
    tabId?: number;
    action: "click" | "type" | "scroll" | "wait" | "back";
    ref?: string;
    text?: string;
    clear?: boolean;
    submit?: boolean;
    direction?: "down" | "up" | "top" | "bottom";
    amount?: number;
    ms?: number;
    waitMs?: number;
  },
  ctx: ActionContext = {}
): Promise<InteractResult> {
  const socketPath = resolveSocketPath(ctx.socketPath);
  const tabId = await resolveTargetTabId(input.tabId, { socketPath, signal: ctx.signal });
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
    { socketPath, signal: ctx.signal }
  );
  return {
    tabId,
    action: input.action,
    ...result,
  } as InteractResult;
}

export async function screenshotTab(
  input: { tabId?: number } = {},
  ctx: ActionContext = {}
): Promise<ScreenshotResult> {
  const socketPath = resolveSocketPath(ctx.socketPath);
  const tabId = await resolveTargetTabId(input.tabId, { socketPath, signal: ctx.signal });
  const shot = await callZenBridge<ScreenshotRawResult>(
    "tabs.screenshot",
    { tabId },
    { socketPath, signal: ctx.signal }
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

  return {
    tabId: shot.tabId,
    path: filePath,
    mime,
    title: shot.title,
    url: shot.url,
  };
}

export async function fetchInTab(
  input: {
    tabId?: number;
    url: string;
    method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
    headers?: Record<string, string>;
    body?: unknown;
    credentials?: "include" | "same-origin" | "omit";
    timeoutMs?: number;
    maxChars?: number;
  },
  ctx: ActionContext = {}
): Promise<FetchResult> {
  const socketPath = resolveSocketPath(ctx.socketPath);
  const tabId = await resolveTargetTabId(input.tabId, { socketPath, signal: ctx.signal });
  const res = await callZenBridge<FetchResult>(
    "tabs.fetch",
    {
      tabId,
      url: input.url,
      method: input.method ?? "GET",
      headers: input.headers,
      body: input.body,
      credentials: input.credentials,
      timeoutMs: input.timeoutMs,
      maxChars: input.maxChars,
    },
    { socketPath, signal: ctx.signal }
  );
  return {
    tabId: res.tabId,
    status: res.status,
    ok: res.ok,
    url: res.url,
    contentType: res.contentType,
    truncated: res.truncated,
    ...(res.json !== undefined ? { json: res.json } : {}),
    ...(res.text !== undefined ? { text: res.text } : {}),
  };
}

export async function readNetworkLog(
  input: { tabId?: number; filter?: string; limit?: number; clear?: boolean } = {},
  ctx: ActionContext = {}
): Promise<NetworkResult> {
  const socketPath = resolveSocketPath(ctx.socketPath);
  const tabId = await resolveTargetTabId(input.tabId, { socketPath, signal: ctx.signal });
  return await callZenBridge<NetworkResult>(
    "tabs.network",
    {
      tabId,
      filter: input.filter,
      limit: input.limit,
      clear: input.clear,
    },
    { socketPath, signal: ctx.signal }
  );
}

export async function closeTab(
  input: { tabId: number },
  ctx: ActionContext = {}
): Promise<CloseResult> {
  const socketPath = resolveSocketPath(ctx.socketPath);
  return await callZenBridge<CloseResult>(
    "tabs.close",
    { tabId: input.tabId },
    { socketPath, signal: ctx.signal }
  );
}
