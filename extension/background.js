const HOST_NAME = "opencode_zen_browser";

let port = null;
let reconnectTimer = null;
let readOnly = false;

const attachedTabs = new Set();
const agentOpenedTabs = new Set();
const attachedWindows = new Set();

const MAX_NETWORK_ENTRIES_PER_TAB = 80;
const networkLogs = new Map();
const pendingRequests = new Map();
const STRIPPED_HEADERS = new Set([
  "cookie",
  "cookie2",
  "set-cookie",
  "user-agent",
  "accept-encoding",
  "accept-language",
  "connection",
  "host",
]);
const textDecoder = new TextDecoder();

function decodeRequestBody(requestBody) {
  if (!requestBody) return undefined;
  if (Array.isArray(requestBody.raw) && requestBody.raw.length > 0) {
    try {
      const parts = requestBody.raw
        .map((chunk) => (chunk?.bytes ? textDecoder.decode(chunk.bytes) : ""))
        .join("");
      return parts ? parts.slice(0, 2000) : undefined;
    } catch {
      return undefined;
    }
  }
  if (requestBody.formData) {
    try {
      return JSON.stringify(requestBody.formData).slice(0, 2000);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function recordNetworkEntry(tabId, entry) {
  let list = networkLogs.get(tabId);
  if (!list) {
    list = [];
    networkLogs.set(tabId, list);
  }
  list.push(entry);
  if (list.length > MAX_NETWORK_ENTRIES_PER_TAB) {
    list.splice(0, list.length - MAX_NETWORK_ENTRIES_PER_TAB);
  }
}

function isScriptableUrl(url) {
  return typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"));
}

function makeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function connectBridge() {
  if (port) return;
  try {
    port = browser.runtime.connectNative(HOST_NAME);
  } catch (err) {
    console.error("[opencode-zen-browser] connectNative failed:", err);
    scheduleReconnect();
    return;
  }

  port.onMessage.addListener(async (msg) => {
    if (!msg || typeof msg !== "object") return;
    try {
      const result = await handleRpcRequest(msg.method, msg.params || {});
      port?.postMessage({ id: msg.id, result });
    } catch (err) {
      port?.postMessage({
        id: msg.id,
        error: {
          code: err?.code || "EXTENSION_ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });

  port.onDisconnect.addListener((disconnectedPort) => {
    const errMsg = disconnectedPort?.error?.message || browser.runtime.lastError?.message;
    if (errMsg) {
      console.warn("[opencode-zen-browser] native port disconnected:", errMsg);
    }
    port = null;
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectBridge();
  }, 2000);
}

async function updateBadgeForTab(tabId) {
  try {
    if (attachedTabs.has(tabId)) {
      await browser.action.setBadgeText({ text: readOnly ? "RO" : "ON", tabId });
      await browser.action.setBadgeBackgroundColor({
        color: readOnly ? "#5E69D1" : "#26A544",
        tabId,
      });
      await browser.action.setBadgeTextColor?.({ color: "#FFFFFF", tabId });
    } else {
      await browser.action.setBadgeText({ text: "", tabId });
    }
  } catch {
    // Tab may have been closed concurrently
  }
}

async function refreshAllBadges() {
  await browser.action.setBadgeText({ text: "" });
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.map((tab) => updateBadgeForTab(tab.id)));
}

function formatTabInfo(tab) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    cookieStoreId: tab.cookieStoreId,
    title: tab.title || "",
    url: tab.url || "",
    favIconUrl: tab.favIconUrl || "",
    active: Boolean(tab.active),
    attached: attachedTabs.has(tab.id),
    openedByAgent: agentOpenedTabs.has(tab.id),
    scriptable: isScriptableUrl(tab.url),
  };
}

async function getPopupState() {
  const win = await browser.windows.getLastFocused({ populate: true }).catch(() => null);
  const windowTabs = win?.tabs || (await browser.tabs.query({ currentWindow: true }));
  const windowId = win?.id ?? windowTabs[0]?.windowId ?? null;
  const activeTab = windowTabs.find((t) => t.active) || null;

  // Include attached tabs from other windows as well if any
  const seen = new Set(windowTabs.map((t) => t.id));
  const extraAttached = [];
  for (const tabId of attachedTabs) {
    if (seen.has(tabId)) continue;
    try {
      const tab = await browser.tabs.get(tabId);
      extraAttached.push(tab);
    } catch {
      attachedTabs.delete(tabId);
      agentOpenedTabs.delete(tabId);
    }
  }

  return {
    bridgeConnected: port !== null,
    readOnly,
    windowId,
    windowAttached: windowId !== null && attachedWindows.has(windowId),
    attachedCount: attachedTabs.size,
    activeTab: activeTab ? formatTabInfo(activeTab) : null,
    openTabs: [...windowTabs, ...extraAttached].map(formatTabInfo),
  };
}

async function requireAttachedTab(tabId) {
  if (typeof tabId !== "number") {
    throw makeError("INVALID_PARAMS", "tabId (number) is required");
  }
  if (!attachedTabs.has(tabId)) {
    throw makeError(
      "TAB_NOT_ATTACHED",
      `Tab ${tabId} is not attached. Ask the user to attach it in Zen or open one with zen_open.`
    );
  }
  try {
    const tab = await browser.tabs.get(tabId);
    if (!isScriptableUrl(tab.url)) {
      throw makeError("UNSUPPORTED_URL", `Tab ${tabId} URL (${tab.url}) cannot be scripted`);
    }
    return tab;
  } catch (err) {
    attachedTabs.delete(tabId);
    agentOpenedTabs.delete(tabId);
    throw err?.code ? err : makeError("TAB_NOT_FOUND", `Tab ${tabId} no longer exists`);
  }
}

async function ensureContentScript(tabId) {
  await browser.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
}

function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = async () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      try {
        resolve(await browser.tabs.get(tabId));
      } catch {
        resolve(null);
      }
    };

    const onUpdated = (updatedId, changeInfo) => {
      if (updatedId === tabId && changeInfo.status === "complete") {
        setTimeout(finish, 120);
      }
    };

    const timer = setTimeout(finish, timeoutMs);
    browser.tabs.onUpdated.addListener(onUpdated);

    browser.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        setTimeout(finish, 80);
      }
    }).catch(finish);
  });
}

async function resolveDefaultTargetContext(explicitWindowId) {
  if (typeof explicitWindowId === "number") {
    for (const tabId of attachedTabs) {
      try {
        const tab = await browser.tabs.get(tabId);
        if (tab.windowId === explicitWindowId) {
          return { windowId: explicitWindowId, cookieStoreId: tab.cookieStoreId };
        }
      } catch {
        // ignore stale tab
      }
    }
    return { windowId: explicitWindowId };
  }

  for (const tabId of attachedTabs) {
    try {
      const tab = await browser.tabs.get(tabId);
      return { windowId: tab.windowId, cookieStoreId: tab.cookieStoreId };
    } catch {
      // ignore stale tab
    }
  }

  const win = await browser.windows.getLastFocused().catch(() => null);
  return win ? { windowId: win.id } : {};
}

async function handleRpcRequest(method, params) {
  if (method === "ping") {
    return {
      ok: true,
      pong: true,
      extensionId: browser.runtime.id,
      version: browser.runtime.getManifest().version,
      readOnly,
      attachedCount: attachedTabs.size,
    };
  }

  if (method === "tabs.list") {
    const tabs = [];
    for (const tabId of [...attachedTabs]) {
      try {
        const tab = await browser.tabs.get(tabId);
        tabs.push(formatTabInfo(tab));
      } catch {
        attachedTabs.delete(tabId);
        agentOpenedTabs.delete(tabId);
      }
    }
    return {
      bridgeConnected: true,
      readOnly,
      attachedWindows: [...attachedWindows],
      tabs,
    };
  }

  if (method === "tabs.open") {
    const url = params?.url;
    if (typeof url !== "string" || !isScriptableUrl(url)) {
      throw makeError("INVALID_URL", "url must start with http:// or https://");
    }

    if (typeof params.tabId === "number") {
      await requireAttachedTab(params.tabId);
      await browser.tabs.update(params.tabId, {
        url,
        ...(typeof params.active === "boolean" ? { active: params.active } : {}),
      });
      const updated = await waitForTabComplete(params.tabId);
      return formatTabInfo(updated || (await browser.tabs.get(params.tabId)));
    }

    const ctx = await resolveDefaultTargetContext(params.windowId);
    const created = await browser.tabs.create({
      url,
      active: typeof params.active === "boolean" ? params.active : false,
      ...(ctx.windowId !== undefined ? { windowId: ctx.windowId } : {}),
      ...(ctx.cookieStoreId && ctx.cookieStoreId !== "firefox-default"
        ? { cookieStoreId: ctx.cookieStoreId }
        : {}),
    });

    attachedTabs.add(created.id);
    agentOpenedTabs.add(created.id);
    await updateBadgeForTab(created.id);

    const loaded = await waitForTabComplete(created.id);
    return formatTabInfo(loaded || created);
  }

  if (method === "tabs.close") {
    const tabId = params?.tabId;
    await requireAttachedTab(tabId);
    networkLogs.delete(tabId);
    if (agentOpenedTabs.has(tabId)) {
      attachedTabs.delete(tabId);
      agentOpenedTabs.delete(tabId);
      await browser.tabs.remove(tabId);
      return { action: "closed", tabId };
    }
    attachedTabs.delete(tabId);
    await updateBadgeForTab(tabId);
    return { action: "detached", tabId };
  }

  if (method === "tabs.snapshot") {
    const tab = await requireAttachedTab(params?.tabId);
    await ensureContentScript(tab.id);
    const mode = params?.mode === "markdown" ? "markdown" : "interactive";
    const result = await browser.tabs.sendMessage(tab.id, {
      type: "zen:snapshot",
      mode,
      maxChars: params?.maxChars,
      scope: params?.scope,
    });
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      mode,
      ...result,
    };
  }

  if (method === "tabs.interact") {
    const tab = await requireAttachedTab(params?.tabId);
    const action = params?.action;

    if (readOnly && (action === "click" || action === "type" || action === "back")) {
      throw makeError("READ_ONLY", "Extension is in read-only mode (click, type, back are blocked)");
    }

    if (action === "back") {
      await browser.tabs.goBack(tab.id);
      const updated = await waitForTabComplete(tab.id, 8000);
      return {
        action: "back",
        tabId: tab.id,
        url: updated?.url || tab.url,
        title: updated?.title || tab.title,
      };
    }

    if (action === "wait") {
      const waitMs = Math.min(Math.max(Number(params?.ms) || 1000, 50), 10000);
      if (typeof params?.text === "string" && params.text.length > 0) {
        await ensureContentScript(tab.id);
        const deadline = Date.now() + waitMs;
        while (Date.now() < deadline) {
          const res = await browser.tabs.sendMessage(tab.id, {
            type: "zen:hasText",
            text: params.text,
          });
          if (res?.found) {
            return { action: "wait", found: true, text: params.text };
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        throw makeError("WAIT_TIMEOUT", `Text "${params.text}" did not appear within ${waitMs}ms`);
      }
      await new Promise((r) => setTimeout(r, waitMs));
      return { action: "wait", waitedMs: waitMs };
    }

    await ensureContentScript(tab.id);

    let actionResult;
    if (action === "click") {
      actionResult = await browser.tabs.sendMessage(tab.id, {
        type: "zen:click",
        ref: params?.ref,
      });
    } else if (action === "type") {
      actionResult = await browser.tabs.sendMessage(tab.id, {
        type: "zen:type",
        ref: params?.ref,
        text: params?.text,
        clear: params?.clear ?? true,
        submit: params?.submit ?? false,
      });
    } else if (action === "scroll") {
      actionResult = await browser.tabs.sendMessage(tab.id, {
        type: "zen:scroll",
        direction: params?.direction || "down",
        amount: params?.amount || 600,
        ref: params?.ref,
      });
    } else {
      throw makeError("INVALID_ACTION", `Unsupported action: ${String(action)}`);
    }

    const postWaitMs = Number(params?.waitMs);
    if (Number.isFinite(postWaitMs) && postWaitMs > 0) {
      await new Promise((r) => setTimeout(r, Math.min(postWaitMs, 10000)));
    }
    return actionResult;
  }

  if (method === "tabs.screenshot") {
    const tab = await requireAttachedTab(params?.tabId);
    let previousActiveId = null;

    if (!tab.active) {
      const activeInWin = await browser.tabs.query({ windowId: tab.windowId, active: true });
      previousActiveId = activeInWin[0]?.id ?? null;
      await browser.tabs.update(tab.id, { active: true });
      await new Promise((r) => setTimeout(r, 120));
    }

    try {
      let mimeType = "image/png";
      let dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      if (dataUrl.length > 850_000) {
        dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, {
          format: "jpeg",
          quality: 85,
        });
        mimeType = "image/jpeg";
      }
      return {
        tabId: tab.id,
        windowId: tab.windowId,
        title: tab.title,
        url: tab.url,
        mimeType,
        dataUrl,
      };
    } finally {
      if (previousActiveId !== null && previousActiveId !== tab.id) {
        await browser.tabs.update(previousActiveId, { active: true }).catch(() => {});
      }
    }
  }

  if (method === "tabs.fetch") {
    const tab = await requireAttachedTab(params?.tabId);
    const httpMethod = String(params?.method || "GET").toUpperCase();
    const allowedMethods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
    if (!allowedMethods.has(httpMethod)) {
      throw makeError("INVALID_METHOD", `Unsupported HTTP method: ${httpMethod}`);
    }
    if (readOnly && httpMethod !== "GET" && httpMethod !== "HEAD") {
      throw makeError(
        "READ_ONLY",
        `Extension is in read-only mode (${httpMethod} requests are blocked; only GET/HEAD allowed)`
      );
    }

    await ensureContentScript(tab.id);
    const res = await browser.tabs.sendMessage(tab.id, {
      type: "zen:fetch",
      url: params?.url,
      method: httpMethod,
      headers: params?.headers,
      body: params?.body,
      credentials: params?.credentials,
      timeoutMs: params?.timeoutMs,
      maxChars: params?.maxChars,
    });
    return {
      tabId: tab.id,
      ...res,
    };
  }

  if (method === "tabs.network") {
    const tab = await requireAttachedTab(params?.tabId);
    const filter = typeof params?.filter === "string" ? params.filter.trim().toLowerCase() : "";
    const limit = Math.min(Math.max(Number(params?.limit) || 25, 1), MAX_NETWORK_ENTRIES_PER_TAB);
    const rawList = networkLogs.get(tab.id) || [];
    const filtered = filter
      ? rawList.filter(
          (item) =>
            item.url.toLowerCase().includes(filter) ||
            (item.requestBody && item.requestBody.toLowerCase().includes(filter))
        )
      : rawList;

    const entries = filtered.slice(-limit).map((item) => ({
      url: item.url,
      method: item.method,
      statusCode: item.statusCode,
      timestamp: item.timestamp,
      headers: item.headers,
      ...(item.requestBody !== undefined ? { requestBody: item.requestBody } : {}),
      ...(item.error !== undefined ? { error: item.error } : {}),
    }));

    if (params?.clear === true) {
      networkLogs.delete(tab.id);
    }

    return {
      tabId: tab.id,
      totalBuffered: rawList.length,
      count: entries.length,
      entries,
    };
  }

  throw makeError("METHOD_NOT_FOUND", `Unknown method: ${method}`);
}

if (browser.webRequest) {
  const filterSpec = { urls: ["<all_urls>"], types: ["xmlhttprequest"] };

  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.tabId < 0 || !attachedTabs.has(details.tabId)) return;
      if (pendingRequests.size > 500) pendingRequests.clear();
      const entry = {
        requestId: details.requestId,
        url: details.url,
        method: details.method,
        timestamp: Math.round(details.timeStamp),
        statusCode: null,
        headers: {},
        requestBody: decodeRequestBody(details.requestBody),
      };
      pendingRequests.set(details.requestId, entry);
      recordNetworkEntry(details.tabId, entry);
    },
    filterSpec,
    ["requestBody"]
  );

  browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const entry = pendingRequests.get(details.requestId);
      if (!entry || !Array.isArray(details.requestHeaders)) return;
      for (const header of details.requestHeaders) {
        const lower = String(header.name || "").toLowerCase();
        if (!lower || STRIPPED_HEADERS.has(lower)) continue;
        if (typeof header.value === "string") {
          entry.headers[lower] = header.value;
        }
      }
    },
    filterSpec,
    ["requestHeaders"]
  );

  browser.webRequest.onCompleted.addListener((details) => {
    const entry = pendingRequests.get(details.requestId);
    if (entry) {
      entry.statusCode = details.statusCode ?? null;
      pendingRequests.delete(details.requestId);
    }
  }, filterSpec);

  browser.webRequest.onErrorOccurred.addListener((details) => {
    const entry = pendingRequests.get(details.requestId);
    if (entry) {
      entry.error = details.error || "request_failed";
      pendingRequests.delete(details.requestId);
    }
  }, filterSpec);
}

browser.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object" || !String(message.type || "").startsWith("popup:")) {
    return;
  }

  return (async () => {
    if (message.type === "popup:toggleTab") {
      const tabId = message.tabId;
      if (attachedTabs.has(tabId)) {
        attachedTabs.delete(tabId);
        networkLogs.delete(tabId);
      } else {
        const tab = await browser.tabs.get(tabId).catch(() => null);
        if (tab && isScriptableUrl(tab.url)) {
          attachedTabs.add(tabId);
        }
      }
      await updateBadgeForTab(tabId);
    } else if (message.type === "popup:toggleWindow") {
      const windowId = message.windowId;
      const winTabs = await browser.tabs.query({ windowId });
      if (attachedWindows.has(windowId)) {
        attachedWindows.delete(windowId);
        for (const tab of winTabs) {
          attachedTabs.delete(tab.id);
          networkLogs.delete(tab.id);
        }
      } else {
        attachedWindows.add(windowId);
        for (const tab of winTabs) {
          if (isScriptableUrl(tab.url)) {
            attachedTabs.add(tab.id);
          }
        }
      }
      await refreshAllBadges();
    } else if (message.type === "popup:setReadOnly") {
      readOnly = Boolean(message.readOnly);
      await refreshAllBadges();
    } else if (message.type === "popup:detachAll") {
      attachedTabs.clear();
      attachedWindows.clear();
      networkLogs.clear();
      await refreshAllBadges();
    }

    return await getPopupState();
  })();
});

browser.tabs.onCreated.addListener((tab) => {
  if (attachedWindows.has(tab.windowId) && isScriptableUrl(tab.url)) {
    attachedTabs.add(tab.id);
    updateBadgeForTab(tab.id);
  }
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && attachedWindows.has(tab.windowId) && isScriptableUrl(tab.url)) {
    attachedTabs.add(tabId);
    updateBadgeForTab(tabId);
  }
  if (changeInfo.status === "complete" && attachedTabs.has(tabId)) {
    updateBadgeForTab(tabId);
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  agentOpenedTabs.delete(tabId);
  networkLogs.delete(tabId);
});

browser.tabs.onActivated.addListener(({ tabId }) => {
  updateBadgeForTab(tabId);
});

browser.windows.onRemoved.addListener((windowId) => {
  attachedWindows.delete(windowId);
});

connectBridge();
refreshAllBadges();
