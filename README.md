# opencode-zen-browser

OpenCode 2 plugin and Zen Browser companion extension for exploring and extracting content inside your live browser sessions.

Instead of launching a separate headless browser or copying cookies out of Zen, the extension exposes only the tabs you explicitly attach (or tabs opened by the agent) over a local Native Messaging bridge and UNIX socket. Tools are registered in OpenCode's `zen` Code Mode namespace (`pinned: false`) so multi-step flows run in a single `execute` call without polluting the prompt.

## What it does

- **Per-tab access control (`extension/`):** attach or detach individual tabs or an entire window from the toolbar popup. Unattached tabs stay invisible to the agent.
- **Read-only switch:** blocks `click`, `type`, `back`, and non-`GET`/`HEAD` requests from the popup while still allowing snapshots, scrolling, waiting, and screenshots.
- **Multi-window & container aware:** `tools.zen.open` opens background tabs (`active: false`) inside the attached window and inherits non-default Zen container `cookieStoreId`s.
- **Two snapshot modes:**
  - `interactive`: semantic DOM tree with `@1`, `@2` element refs and structured `elements` array (`role`, `name`, `value`, `checked`, etc.). Automatically scopes to an open modal dialog if present, otherwise `<main>`, otherwise `<body>`, and walks open Shadow DOMs.
  - `markdown`: extracts prose via `@mozilla/readability`, `linkedom`, and `turndown`.
- **Same-site authenticated fetch (`tools.zen.fetch`):** runs `window.fetch` inside the attached tab (`credentials: "include"` by default, or `"same-origin"` / `"omit"` for public CORS `*` subdomains) so internal REST/GraphQL requests reuse the browser's live TLS/HTTP2 stack and cookies without leaving Zen. Cross-site URLs are rejected.
- **Passive network capture (`tools.zen.network`):** buffers recent XHR/fetch requests per attached tab (URL, method, status code, non-cookie headers, request body) so you can inspect GraphQL `queryId`s or internal API parameters without DevTools.

## Tools (`tools.zen.*`)

Registered under the `zen` Code Mode namespace (`codemode: true`, `pinned: false`):

| Tool | Purpose |
|---|---|
| `tools.zen.tabs()` | List attached tabs, bridge status, and read-only state |
| `tools.zen.open({ url, tabId?, windowId?, active? })` | Open a background tab or navigate an attached tab |
| `tools.zen.snapshot({ tabId?, mode?, scope?, maxChars?, includeIframes? })` | Extract interactive `@ref` tree + `elements` (across iframes), or clean Markdown |
| `tools.zen.interact({ tabId?, action, ref?, text?, dialog?, ... })` | `click`, `type`, `scroll`, `wait` (supports `text` / `dialog`), or `back` |
| `tools.zen.fetch({ tabId?, url, method?, headers?, body?, credentials? })` | Execute an authenticated same-site HTTP/GraphQL request |
| `tools.zen.network({ tabId?, filter?, limit?, clear? })` | Inspect recent XHR/fetch requests captured on an attached tab |
| `tools.zen.screenshot({ tabId? })` | Save a PNG/JPEG capture to a temp file and return its path |
| `tools.zen.close({ tabId })` | Close an agent-opened tab or detach a user-owned tab |

## Install (macOS + Zen Browser)

1. Build the plugin and install the Native Messaging host manifest:

```sh
git clone https://github.com/krishna2206/opencode-zen-browser.git
cd opencode-zen-browser
pnpm install
pnpm run build
pnpm run install-host
```

`pnpm run install-host` creates:
- `~/.cache/opencode-zen-browser/opencode-zen-browser-host` (launcher pointing to the absolute `bun` path)
- `~/Library/Application Support/Mozilla/NativeMessagingHosts/opencode_zen_browser.json`

2. Load the extension in Zen Browser:
- Open `about:debugging#/runtime/this-firefox`
- Click **Load Temporary Add-on...** and select `extension/manifest.json` (or sign it with `web-ext sign --channel=unlisted` for permanent install).

3. Register the built `dist` directory in `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": [
    { "package": "file:///path/to/opencode-zen-browser/dist" }
  ]
}
```

## Architecture

- `extension/` — WebExtension MV3 (`manifest.json`, `background.js`, `content.js`, `popup.html`, `popup.css`, `popup.js`)
- `host/` — Native Messaging stdio-to-UNIX-socket multiplexer (`protocol.mjs`, `bridge.mjs`, `install.mjs`), listening on `~/.cache/opencode-zen-browser/bridge.sock` (`chmod 0600`)
- `src/` — OpenCode 2 plugin (`index.ts`, `client.ts`, `markdown.ts`, `types.ts`)
- `tests/` — Unit tests (`bun test tests`)

## Development

```sh
pnpm run typecheck
pnpm run test
pnpm run build
```
