if (!globalThis.__opencodeZenLoaded) {
  globalThis.__opencodeZenLoaded = true;

  const refMap = new Map();

  const INTERACTIVE_SELECTOR = [
    "a[href]",
    "button",
    "input",
    "textarea",
    "select",
    "summary",
    "[role='button']",
    "[role='link']",
    "[role='textbox']",
    "[role='searchbox']",
    "[role='combobox']",
    "[role='menuitem']",
    "[role='option']",
    "[role='tab']",
    "[role='checkbox']",
    "[role='radio']",
    "[role='switch']",
    "[contenteditable='true']",
    "[contenteditable='']",
  ].join(",");

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG"]);
  const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);
  const NOISE_TEXT = new Set(["·", "•", "|", "/", "--", "-"]);

  function cleanText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function isSubtreeHidden(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return true;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.opacity === "0") {
      return true;
    }
    return false;
  }

  function isElementSelfHidden(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
    return getComputedStyle(el).visibility === "hidden";
  }

  function hasNonZeroBox(el) {
    const style = getComputedStyle(el);
    if (style.display === "contents") return true;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function isInteractiveVisible(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (SKIP_TAGS.has(el.tagName)) return false;
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;

    if (el.tagName === "INPUT") {
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "radio" || type === "checkbox") {
        // Custom-styled radios/checkboxes often hide the native input inside a visible <label>
        const label = el.closest("label") || (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
        if (label && !isSubtreeHidden(label) && !isElementSelfHidden(label) && hasNonZeroBox(label)) return true;
      }
    }

    if (style.opacity === "0") return false;
    return hasNonZeroBox(el);
  }

  function findVisibleDialogs(root, out = []) {
    if (!root || typeof root.querySelectorAll !== "function") return out;
    for (const dlg of root.querySelectorAll("dialog[open], [role='dialog'], [role='alertdialog'], [aria-modal='true']")) {
      const style = getComputedStyle(dlg);
      if (style.display === "none" || style.visibility === "hidden" || dlg.hidden) continue;
      if (!hasNonZeroBox(dlg)) continue;
      if (cleanText(dlg.textContent).length > 0) {
        out.push(dlg);
      }
    }
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) {
        findVisibleDialogs(el.shadowRoot, out);
      }
    }
    return out;
  }

  function resolveSnapshotRoot(scope = "auto") {
    if (scope === "body") {
      return { root: document.body, scopeUsed: "body" };
    }
    if (scope === "main") {
      const main = document.querySelector("main");
      if (main && !isSubtreeHidden(main)) return { root: main, scopeUsed: "main" };
      return { root: document.body, scopeUsed: "body" };
    }

    const dialogs = findVisibleDialogs(document);
    if (dialogs.length > 0) {
      return { root: dialogs[dialogs.length - 1], scopeUsed: "dialog" };
    }
    const main = document.querySelector("main");
    if (main && !isSubtreeHidden(main) && cleanText(main.textContent).length > 40) {
      return { root: main, scopeUsed: "main" };
    }
    return { root: document.body, scopeUsed: "body" };
  }

  function getAccessibleName(el) {
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return cleanText(ariaLabel);

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .map(cleanText)
        .filter(Boolean);
      if (parts.length > 0) return parts.join(" ");
    }

    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) {
          const text = cleanText(label.textContent);
          if (text) return text;
        }
      }
      const parentLabel = el.closest("label");
      if (parentLabel) {
        const clone = parentLabel.cloneNode(true);
        clone.querySelectorAll("input,textarea,select").forEach((n) => n.remove());
        const text = cleanText(clone.textContent);
        if (text) return text;
      }
      if (el.placeholder) return cleanText(el.placeholder);
      if (el.name) return cleanText(el.name);
    }

    const title = el.getAttribute("title");
    const inner = cleanText(el.innerText || el.textContent);
    if (inner) return inner.slice(0, 140);
    if (title) return cleanText(title).slice(0, 140);

    const img = el.querySelector("img[alt]");
    if (img?.alt) return cleanText(img.alt).slice(0, 140);
    return "";
  }

  function getRoleLabel(el) {
    const explicitRole = el.getAttribute("role");
    if (explicitRole) return explicitRole;
    const tag = el.tagName;
    if (tag === "A") return "link";
    if (tag === "BUTTON" || tag === "SUMMARY") return "button";
    if (tag === "SELECT") return "combobox";
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit" || type === "button" || type === "reset") return "button";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    if (el.isContentEditable) return "textbox";
    return "button";
  }

  function extractElementInfo(el, ref) {
    const role = getRoleLabel(el);
    const name = getAccessibleName(el);
    const info = { ref, role, name };

    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "checkbox" || type === "radio") {
        if (el.checked) info.checked = true;
      } else if (type === "password") {
        info.value = el.value ? "[filled]" : "";
      } else if (el.value) {
        info.value = cleanText(el.value).slice(0, 80);
      }
    } else if (el.tagName === "SELECT") {
      const selected = el.selectedOptions?.[0]?.textContent;
      if (selected) info.value = cleanText(selected).slice(0, 60);
    } else if (el.isContentEditable) {
      const txt = cleanText(el.textContent);
      if (txt) info.value = txt.slice(0, 80);
    }

    if (el.getAttribute("aria-pressed") === "true") info.pressed = true;
    if (el.getAttribute("aria-expanded") === "true") info.expanded = true;
    if (el.getAttribute("aria-selected") === "true") info.selected = true;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") info.disabled = true;

    return info;
  }

  function formatInteractiveLine(info) {
    const attrs = [];
    if (info.checked) attrs.push("checked");
    if (info.value) attrs.push(`value="${info.value.replace(/"/g, "'")}"`);
    if (info.pressed) attrs.push("pressed");
    if (info.expanded) attrs.push("expanded");
    if (info.selected) attrs.push("selected");
    if (info.disabled) attrs.push("disabled");

    const namePart = info.name ? ` "${info.name.replace(/"/g, "'")}"` : "";
    const attrPart = attrs.length > 0 ? ` [${attrs.join(", ")}]` : "";
    return `${info.role}${namePart}${attrPart} [${info.ref}]`;
  }

  function buildInteractiveSnapshot(maxChars = 8000, scope = "auto") {
    refMap.clear();
    let nextRef = 1;
    const lines = [];
    const elements = [];
    let totalChars = 0;
    let truncated = false;

    function pushLine(line) {
      if (!line) return false;
      if (lines.length > 0 && lines[lines.length - 1] === line) return false;
      if (totalChars + line.length + 1 > maxChars) {
        truncated = true;
        return false;
      }
      lines.push(line);
      totalChars += line.length + 1;
      return true;
    }

    function walk(node) {
      if (truncated || !node) return;

      if (node.nodeType === Node.TEXT_NODE) {
        if (node.parentElement && isElementSelfHidden(node.parentElement)) return;
        const txt = cleanText(node.textContent);
        if (txt.length > 0 && !NOISE_TEXT.has(txt)) {
          pushLine(`text "${txt.slice(0, 300).replace(/"/g, "'")}"`);
        }
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      if (node.matches(INTERACTIVE_SELECTOR)) {
        if (!isInteractiveVisible(node)) return;
        const name = getAccessibleName(node);
        // Skip unlabelled decorative links/buttons unless they are inputs
        if (!name && node.tagName !== "INPUT" && node.tagName !== "TEXTAREA" && node.tagName !== "SELECT") {
          return;
        }
        const ref = `@${nextRef}`;
        const info = extractElementInfo(node, ref);
        if (pushLine(formatInteractiveLine(info))) {
          nextRef++;
          refMap.set(ref, node);
          elements.push(info);
        }
        return;
      }

      if (node !== root && isSubtreeHidden(node)) return;

      if (HEADING_TAGS.has(node.tagName)) {
        if (isElementSelfHidden(node)) return;
        const interactiveInside = node.querySelector(INTERACTIVE_SELECTOR);
        if (!interactiveInside) {
          const headingText = cleanText(node.innerText || node.textContent);
          if (headingText) {
            pushLine(`heading(${node.tagName.toLowerCase()}) "${headingText.slice(0, 160).replace(/"/g, "'")}"`);
          }
          return;
        }
      }

      if (node.shadowRoot) {
        for (const child of node.shadowRoot.childNodes) {
          if (truncated) break;
          walk(child);
        }
      }

      for (const child of node.childNodes) {
        if (truncated) break;
        walk(child);
      }
    }

    const { root, scopeUsed } = resolveSnapshotRoot(scope);
    if (root) {
      walk(root);
    }

    return {
      url: location.href,
      title: document.title,
      scope: scopeUsed,
      refCount: elements.length,
      truncated,
      elements,
      content: lines.join("\n"),
    };
  }

  function extractReadableHtml(maxChars = 650000) {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("script, style, noscript, svg, template").forEach((n) => n.remove());
    let html = clone.outerHTML || "";
    const truncated = html.length > maxChars;
    if (truncated) {
      html = html.slice(0, maxChars);
    }
    return {
      url: location.href,
      title: document.title,
      truncated,
      html,
    };
  }

  function resolveRef(ref) {
    if (!ref || typeof ref !== "string") {
      throw new Error("Missing @ref (call zen_snapshot first)");
    }
    const normalized = ref.startsWith("@") ? ref : `@${ref}`;
    const el = refMap.get(normalized);
    if (!el || !el.isConnected) {
      throw new Error(`Element ${normalized} is stale or not found — call zen_snapshot again`);
    }
    return { ref: normalized, el };
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor?.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function performClick(ref) {
    const { ref: normalized, el } = resolveRef(ref);
    el.scrollIntoView({ block: "center", inline: "nearest" });
    el.focus?.({ preventScroll: true });

    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };

    el.dispatchEvent(new MouseEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.click();

    return {
      action: "click",
      ref: normalized,
      tag: el.tagName.toLowerCase(),
      label: getAccessibleName(el).slice(0, 100),
      url: location.href,
    };
  }

  function performType(ref, text, clear = true, submit = false) {
    const { ref: normalized, el } = resolveRef(ref);
    el.scrollIntoView({ block: "center", inline: "nearest" });
    el.focus();

    const value = String(text ?? "");

    if (el.tagName === "SELECT") {
      const option = Array.from(el.options).find(
        (opt) => opt.value === value || cleanText(opt.textContent) === value
      );
      if (!option) {
        throw new Error(`Option "${value}" not found in select ${normalized}`);
      }
      el.value = option.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.isContentEditable) {
      const next = clear ? value : `${el.textContent || ""}${value}`;
      el.textContent = next;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const next = clear ? value : `${el.value || ""}${value}`;
      setNativeValue(el, next);
      try {
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      } catch {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      throw new Error(`Element ${normalized} (${el.tagName.toLowerCase()}) is not editable`);
    }

    if (submit) {
      const keyOpts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent("keydown", keyOpts));
      el.dispatchEvent(new KeyboardEvent("keypress", keyOpts));
      el.dispatchEvent(new KeyboardEvent("keyup", keyOpts));
      if (el.form && typeof el.form.requestSubmit === "function") {
        el.form.requestSubmit();
      }
    }

    return {
      action: "type",
      ref: normalized,
      length: value.length,
      submitted: Boolean(submit),
    };
  }

  function findMainScrollContainer() {
    const root = document.scrollingElement || document.documentElement;
    if (root && root.scrollHeight > (window.innerHeight || root.clientHeight) + 20) {
      return null;
    }
    let best = null;
    let bestArea = 0;
    for (const el of document.querySelectorAll("*")) {
      if (el.clientHeight < 150 || el.scrollHeight <= el.clientHeight + 20) continue;
      const style = getComputedStyle(el);
      if (style.overflowY !== "auto" && style.overflowY !== "scroll") continue;
      const area = el.clientWidth * el.clientHeight;
      if (area > bestArea) {
        bestArea = area;
        best = el;
      }
    }
    return best;
  }

  function scrollElement(el, direction, delta) {
    if (direction === "top") el.scrollTop = 0;
    else if (direction === "bottom") el.scrollTop = el.scrollHeight;
    else if (direction === "up") el.scrollTop = Math.max(0, el.scrollTop - delta);
    else el.scrollTop = Math.min(el.scrollHeight, el.scrollTop + delta);
  }

  function performScroll(direction = "down", amount = 600, ref) {
    const delta = Math.abs(Number(amount) || 600);
    const target = ref ? resolveRef(ref).el : findMainScrollContainer();

    if (target) {
      scrollElement(target, direction, delta);
      return {
        action: "scroll",
        target: ref || "container",
        tag: target.tagName.toLowerCase(),
        direction,
        scrollTop: Math.round(target.scrollTop),
        scrollHeight: target.scrollHeight,
      };
    }

    if (direction === "top") window.scrollTo({ top: 0, behavior: "instant" });
    else if (direction === "bottom") window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    else if (direction === "up") window.scrollBy({ top: -delta, behavior: "instant" });
    else window.scrollBy({ top: delta, behavior: "instant" });

    return {
      action: "scroll",
      direction,
      scrollY: Math.round(window.scrollY),
      scrollHeight: document.documentElement.scrollHeight,
    };
  }

  function isSameSiteUrl(targetUrl, currentUrl) {
    const page = new URL(currentUrl);
    if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") return false;
    if (page.protocol === "https:" && targetUrl.protocol !== "https:") return false;

    const targetHost = targetUrl.hostname.toLowerCase();
    const pageHost = page.hostname.toLowerCase();
    const pageRoot = pageHost.replace(/^www\./, "");
    return (
      targetHost === pageHost ||
      targetHost === pageRoot ||
      targetHost.endsWith("." + pageRoot)
    );
  }

  async function performFetch(params = {}) {
    const rawUrl = params.url;
    if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
      throw new Error("url is required");
    }

    const resolved = new URL(rawUrl, location.href);
    if (!isSameSiteUrl(resolved, location.href)) {
      throw new Error(
        `Cross-site fetch blocked: ${resolved.origin} does not match attached tab (${location.origin})`
      );
    }

    const method = String(params.method || "GET").toUpperCase();
    const headers = {};
    if (params.headers && typeof params.headers === "object") {
      for (const [k, v] of Object.entries(params.headers)) {
        if (typeof v === "string") headers[k] = v;
      }
    }

    let body;
    if (params.body !== undefined && params.body !== null && method !== "GET" && method !== "HEAD") {
      if (typeof params.body === "string") {
        body = params.body;
      } else {
        body = JSON.stringify(params.body);
        if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
          headers["content-type"] = "application/json";
        }
      }
    }

    const timeoutMs = Math.min(Math.max(Number(params.timeoutMs) || 15000, 500), 30000);
    const maxChars = Math.min(Math.max(Number(params.maxChars) || 100000, 1000), 1000000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(resolved.href, {
        method,
        headers,
        body,
        credentials: "include",
        signal: controller.signal,
      });

      const contentType = resp.headers.get("content-type") || "";
      const rawText = await resp.text();
      const trimmed = rawText.trim();
      const looksJson =
        contentType.toLowerCase().includes("json") ||
        trimmed.startsWith("{") ||
        trimmed.startsWith("[");

      if (looksJson && rawText.length <= 1500000) {
        try {
          const json = JSON.parse(rawText);
          return {
            status: resp.status,
            ok: resp.ok,
            url: resp.url || resolved.href,
            contentType,
            truncated: false,
            json,
          };
        } catch {
          // Fall through to text response if body is invalid/truncated JSON
        }
      }

      const truncated = rawText.length > maxChars;
      return {
        status: resp.status,
        ok: resp.ok,
        url: resp.url || resolved.href,
        contentType,
        truncated,
        text: truncated ? rawText.slice(0, maxChars) : rawText,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return;

    if (message.type === "zen:snapshot") {
      if (message.mode === "markdown") {
        return Promise.resolve(extractReadableHtml(message.maxChars));
      }
      return Promise.resolve(buildInteractiveSnapshot(message.maxChars, message.scope));
    }

    if (message.type === "zen:click") {
      return Promise.resolve(performClick(message.ref));
    }

    if (message.type === "zen:type") {
      return Promise.resolve(performType(message.ref, message.text, message.clear, message.submit));
    }

    if (message.type === "zen:scroll") {
      return Promise.resolve(performScroll(message.direction, message.amount, message.ref));
    }

    if (message.type === "zen:fetch") {
      return performFetch(message);
    }

    if (message.type === "zen:hasText") {
      const needle = String(message.text || "");
      const bodyText = document.body?.innerText || "";
      return Promise.resolve({ found: bodyText.includes(needle) });
    }
  });
}
