const FALLBACK_FAVICON = `
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/>
    <path d="M2.5 8h11M8 2c1.8 1.8 1.8 10.2 0 12M8 2c-1.8 1.8-1.8 10.2 0 12" stroke="currentColor" stroke-width="1.15"/>
  </svg>`;

function plugSvg(size) {
  return `
    <svg class="plug-svg" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <g transform="rotate(-45 8 8)">
        <g class="plug-socket">
          <rect x="0.5" y="7.15" width="3" height="1.7" rx="0.85" fill="currentColor"/>
          <path d="M5.6 4.6h2v6.8h-2A2.8 2.8 0 0 1 2.8 8.6V7.4a2.8 2.8 0 0 1 2.8-2.8Z" fill="currentColor"/>
        </g>
        <g class="plug-head">
          <rect x="6.1" y="5.7" width="2.5" height="1.35" rx="0.65" fill="currentColor"/>
          <rect x="6.1" y="8.95" width="2.5" height="1.35" rx="0.65" fill="currentColor"/>
          <path d="M8.4 4.6h2a2.8 2.8 0 0 1 2.8 2.8v1.2a2.8 2.8 0 0 1-2.8 2.8h-2V4.6Z" fill="currentColor"/>
          <rect x="12.5" y="7.15" width="3" height="1.7" rx="0.85" fill="currentColor"/>
        </g>
      </g>
    </svg>`;
}

const LOCK_ICON_FILL = `
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path fill-rule="evenodd" clip-rule="evenodd" d="M5 7V5a3 3 0 1 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v4.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13V8.5A1.5 1.5 0 0 1 4.5 7H5Zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2Z" fill="currentColor"/>
  </svg>`;

const bridgePill = document.getElementById("bridgePill");
const bridgeLabel = document.getElementById("bridgeLabel");
const offlineAlert = document.getElementById("offlineAlert");
const currentStateLabel = document.getElementById("currentStateLabel");
const currentFavicon = document.getElementById("currentFavicon");
const currentTitle = document.getElementById("currentTitle");
const currentUrl = document.getElementById("currentUrl");
const toggleTabBtn = document.getElementById("toggleTabBtn");
const toggleWindowBtn = document.getElementById("toggleWindowBtn");
const readOnlyCheck = document.getElementById("readOnlyCheck");
const listTitle = document.getElementById("listTitle");
const detachAllBtn = document.getElementById("detachAllBtn");
const tabList = document.getElementById("tabList");

let currentState = null;

function getBaseUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.hostname.replace(/^www\./, "");
    }
    return parsed.protocol.replace(/:$/, "");
  } catch {
    return rawUrl;
  }
}

function parseSvgNode(markup) {
  const doc = new DOMParser().parseFromString(markup.trim(), "image/svg+xml");
  return document.importNode(doc.documentElement, true);
}

function renderFaviconInto(el, favIconUrl) {
  el.replaceChildren();
  if (favIconUrl && (favIconUrl.startsWith("http://") || favIconUrl.startsWith("https://") || favIconUrl.startsWith("data:"))) {
    const img = document.createElement("img");
    img.src = favIconUrl;
    img.alt = "";
    img.addEventListener("error", () => {
      el.replaceChildren(parseSvgNode(FALLBACK_FAVICON));
    }, { once: true });
    el.appendChild(img);
    return;
  }
  el.appendChild(parseSvgNode(FALLBACK_FAVICON));
}

function render(state) {
  currentState = state;
  const { bridgeConnected, readOnly, activeTab, openTabs, windowAttached, attachedCount } = state;

  bridgePill.classList.toggle("is-offline", !bridgeConnected);
  bridgeLabel.textContent = bridgeConnected ? "Pont actif" : "Déconnecté";
  offlineAlert.hidden = bridgeConnected;

  if (activeTab) {
    renderFaviconInto(currentFavicon, activeTab.favIconUrl);
    currentTitle.textContent = activeTab.title || "Sans titre";
    currentUrl.textContent = getBaseUrl(activeTab.url);

    if (!activeTab.scriptable) {
      currentStateLabel.dataset.state = "off";
      currentStateLabel.hidden = true;
      toggleTabBtn.className = "btn btn-secondary is-grow";
      toggleTabBtn.textContent = "Page protégée";
      toggleTabBtn.disabled = true;
    } else if (activeTab.attached) {
      const nextState = readOnly ? "ro" : "on";
      currentStateLabel.hidden = false;
      if (currentStateLabel.dataset.state !== nextState) {
        currentStateLabel.dataset.state = nextState;
        currentStateLabel.className = "active-state-label" + (readOnly ? " is-ro" : "");
        const iconNode = parseSvgNode(readOnly ? LOCK_ICON_FILL : plugSvg(12));
        const textNode = document.createElement("span");
        textNode.textContent = readOnly ? "Lecture seule" : "Attaché";
        currentStateLabel.replaceChildren(iconNode, textNode);
      }
      toggleTabBtn.disabled = false;
      toggleTabBtn.className = "btn btn-secondary is-grow";
      toggleTabBtn.textContent = "Détacher";
    } else {
      currentStateLabel.dataset.state = "off";
      currentStateLabel.hidden = true;
      toggleTabBtn.disabled = false;
      toggleTabBtn.className = "btn btn-primary";
      toggleTabBtn.textContent = "Attacher cet onglet";
    }
  } else {
    currentFavicon.replaceChildren(parseSvgNode(FALLBACK_FAVICON));
    currentTitle.textContent = "Aucun onglet actif";
    currentUrl.textContent = "";
    currentStateLabel.hidden = true;
    toggleTabBtn.disabled = true;
  }

  const scriptableCount = openTabs.filter((t) => t.scriptable).length;
  toggleWindowBtn.disabled = scriptableCount === 0;
  toggleWindowBtn.className = "btn btn-secondary" + (windowAttached ? " is-active" : "");
  toggleWindowBtn.textContent = windowAttached
    ? "Fenêtre attachée"
    : `Toute la fenêtre (${scriptableCount})`;

  readOnlyCheck.checked = readOnly;

  const listableTabs = openTabs.filter((t) => t.scriptable || t.attached);
  listTitle.textContent = `Onglets ouverts · ${listableTabs.length}`;
  detachAllBtn.hidden = attachedCount === 0;

  if (listableTabs.length === 0) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "empty-state";
    emptyEl.textContent = "Aucun onglet web ouvert.";
    tabList.replaceChildren(emptyEl);
    return;
  }

  const existingIds = Array.from(tabList.children).map((el) => Number(el.dataset.tabId));
  const nextIds = listableTabs.map((t) => t.id);
  const sameOrder =
    existingIds.length === nextIds.length &&
    existingIds.every((id, idx) => id === nextIds[idx]);

  if (sameOrder) {
    listableTabs.forEach((tab) => {
      const row = tabList.querySelector(`[data-tab-id="${tab.id}"]`);
      const btn = row.querySelector("[data-toggle]");
      row.classList.toggle("is-attached", tab.attached);
      btn.classList.toggle("is-attached", tab.attached);
      btn.title = tab.attached ? "Détacher cet onglet" : "Attacher cet onglet";
      btn.setAttribute("aria-label", `${tab.attached ? "Détacher" : "Attacher"} ${tab.title || ""}`);
      btn.setAttribute("aria-pressed", String(tab.attached));
    });
    return;
  }

  tabList.replaceChildren();
  for (const tab of listableTabs) {
    const row = document.createElement("div");
    row.className = `tab-item${tab.attached ? " is-attached" : ""}`;
    row.dataset.tabId = String(tab.id);

    const icon = document.createElement("span");
    icon.className = "tab-icon";
    icon.setAttribute("aria-hidden", "true");
    renderFaviconInto(icon, tab.favIconUrl);

    const info = document.createElement("div");
    info.className = "tab-info";

    const titleEl = document.createElement("div");
    titleEl.className = "tab-item-title";
    titleEl.textContent = tab.title || "Sans titre";

    const subEl = document.createElement("div");
    subEl.className = "tab-item-sub";

    const urlEl = document.createElement("span");
    urlEl.className = "tab-item-url";
    urlEl.textContent = getBaseUrl(tab.url);
    subEl.appendChild(urlEl);

    if (tab.openedByAgent) {
      const tag = document.createElement("span");
      tag.className = "tag-agent";
      tag.title = "Ouvert par l'agent";
      tag.textContent = "Agent";
      subEl.appendChild(tag);
    }

    info.appendChild(titleEl);
    info.appendChild(subEl);

    const btn = document.createElement("button");
    btn.className = `plug-btn${tab.attached ? " is-attached" : ""}`;
    btn.type = "button";
    btn.dataset.toggle = String(tab.id);
    btn.title = tab.attached ? "Détacher cet onglet" : "Attacher cet onglet";
    btn.setAttribute("aria-label", `${tab.attached ? "Détacher" : "Attacher"} ${tab.title || ""}`);
    btn.setAttribute("aria-pressed", String(tab.attached));
    btn.appendChild(parseSvgNode(plugSvg(16)));

    row.appendChild(icon);
    row.appendChild(info);
    row.appendChild(btn);
    tabList.appendChild(row);
  }
}

async function sendAction(payload) {
  const next = await browser.runtime.sendMessage(payload);
  if (next) render(next);
}

toggleTabBtn.addEventListener("click", () => {
  if (!currentState?.activeTab) return;
  sendAction({ type: "popup:toggleTab", tabId: currentState.activeTab.id });
});

toggleWindowBtn.addEventListener("click", () => {
  if (!currentState?.windowId) return;
  sendAction({ type: "popup:toggleWindow", windowId: currentState.windowId });
});

readOnlyCheck.addEventListener("change", () => {
  sendAction({ type: "popup:setReadOnly", readOnly: readOnlyCheck.checked });
});

detachAllBtn.addEventListener("click", () => {
  sendAction({ type: "popup:detachAll" });
});

tabList.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-toggle]");
  if (!btn) return;
  const tabId = Number(btn.dataset.toggle);
  sendAction({ type: "popup:toggleTab", tabId });
});

sendAction({ type: "popup:getState" });
