# opencode-zen-browser

OpenCode 2 plugin, Claude Code CLI plugin/CLI (`zen-browser`), and Zen Browser companion extension for exploring and automating inside your live browser sessions.

Instead of launching a separate headless browser or copying cookies out of Zen, the extension exposes only the tabs you explicitly attach (or tabs opened by the agent) over a local Native Messaging bridge and UNIX socket.

## What it does

- **Per-tab access control (`extension/`):** attach or detach individual tabs or an entire window from the toolbar popup. Unattached tabs stay invisible to the agent.
- **Read-only switch:** blocks `click`, `type`, `back`, and non-`GET`/`HEAD` requests from the popup while still allowing snapshots, scrolling, waiting, and screenshots.
- **Multi-window & container aware:** `open` creates background tabs (`active: false`) inside the attached window and inherits non-default Zen container `cookieStoreId`s.
- **Two snapshot modes:**
  - `interactive`: semantic DOM tree with `@1`, `@2` element refs and structured `elements` array (`role`, `name`, `value`, `checked`, etc.). Automatically scopes to an open modal dialog if present, otherwise `<main>`, otherwise `<body>`, and walks open Shadow DOMs.
  - `markdown`: extracts prose via `@mozilla/readability`, `linkedom`, and `turndown`.
- **Same-site authenticated fetch (`fetch`):** runs `window.fetch` inside the attached tab (`credentials: "include"` by default, or `"same-origin"` / `"omit"` for public CORS `*` subdomains) so internal REST/GraphQL requests reuse the browser's live TLS/HTTP2 stack and cookies without leaving Zen. Cross-site URLs are rejected.
- **Passive network capture (`network`):** buffers recent XHR/fetch requests per attached tab (URL, method, status code, non-cookie headers, request body) so you can inspect GraphQL `queryId`s or internal API parameters without DevTools.

## Interfaces

1. **OpenCode 2 (Code Mode):** registered under `tools.zen.*` (`codemode: true`, `pinned: false`) so multi-step flows run in a single `execute` call without polluting the prompt.
2. **Claude Code CLI & terminal (`zen-browser` + `.claude-plugin/` + `skills/zen-browser/`):** shares the exact same `src/core/` logic over `bridge.sock` with zero extra runtime dependencies.

| OpenCode tool | CLI command | Purpose |
|---|---|---|
| `tools.zen.tabs()` | `zen-browser tabs` | List attached tabs, bridge status, and read-only state |
| `tools.zen.open({ url, ... })` | `zen-browser open <url>` | Open a background tab or navigate an attached tab |
| `tools.zen.snapshot({ ... })` | `zen-browser snapshot` | Extract interactive `@ref` tree + `elements`, or clean Markdown |
| `tools.zen.interact({ ... })` | `zen-browser click / type / scroll / wait / back` | Interact with `@ref`s, wait for text, or go back |
| `tools.zen.fetch({ url, ... })` | `zen-browser fetch <url>` | Execute an authenticated same-site HTTP/GraphQL request |
| `tools.zen.network({ ... })` | `zen-browser network` | Inspect recent XHR/fetch requests captured on an attached tab |
| `tools.zen.screenshot({ ... })` | `zen-browser screenshot` | Save a PNG/JPEG capture to a temp file and return its path |
| `tools.zen.close({ tabId })` | `zen-browser close <tabId>` | Close an agent-opened tab or detach a user-owned tab |

## Install

### 1. Build & register the Native Messaging host (macOS or Linux)

Requires Node.js >= 20 (or Bun).

```sh
git clone https://github.com/krishna2206/opencode-zen-browser.git
cd opencode-zen-browser
npm install
npm run build
npm run install-host
```

`npm run install-host` (`node host/install.mjs`) creates:
- `~/.cache/opencode-zen-browser/opencode-zen-browser-host` (launcher pointing to the `node`/`bun` binary)
- Native Messaging manifest:
  - macOS: `~/Library/Application Support/Mozilla/NativeMessagingHosts/opencode_zen_browser.json`
  - Linux: `~/.mozilla/native-messaging-hosts/opencode_zen_browser.json`

> **Linux note:** use the native tarball, AppImage, or distro package of Zen Browser. Flatpak sandboxes Native Messaging by default.

### 2. Install the Zen Browser extension

- **Permanent install (recommended):** open a signed `.xpi` (e.g. `opencode_zen_browser-0.1.0.xpi` from Releases, or signed locally via `web-ext sign --channel=unlisted`) in Zen Browser.
- **Temporary install (from git clone):** open `about:debugging#/runtime/this-firefox` in Zen -> **Load Temporary Add-on...** -> select `extension/manifest.json`.

### 3a. Connect to OpenCode 2

Register the built `dist` directory in `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": [
    { "package": "file:///path/to/opencode-zen-browser/dist" }
  ]
}
```

### 3b. Connect to Claude Code CLI

You can load the plugin per session or install the CLI + skill globally so every Claude Code session has it automatically.

**Option A — Permanent install (recommended for daily use):**

```sh
npm link
mkdir -p ~/.claude/skills
ln -sfn "$(pwd)/skills/zen-browser" ~/.claude/skills/zen-browser
```

Verify both are active:

```sh
zen-browser --help
```

**Option B — Plugin directory (no global install):**

```sh
claude --plugin-dir /path/to/opencode-zen-browser
```

While enabled via `--plugin-dir`, Claude Code automatically exposes `bin/zen-browser` on `PATH` and loads the `zen-browser` skill.

#### Setup prompt for Claude Code

If someone is setting this up on a fresh macOS or Linux machine, they can open `claude` and paste this prompt:

```text
Set up https://github.com/krishna2206/opencode-zen-browser for Claude Code and Zen Browser on this machine:
1. Clone the repo (e.g. into ~/dev/opencode-zen-browser), run `npm install`, `npm run build`, and `npm run install-host`.
2. Check if Zen Browser is installed natively/AppImage or via Flatpak (if Flatpak is present, warn me because Flatpak sandboxes Native Messaging).
3. Link `zen-browser` globally (`npm link`) and symlink `skills/zen-browser` into `~/.claude/skills/zen-browser`.
4. Verify `zen-browser --help` works, then tell me the exact step to load the extension in Zen Browser (`about:debugging#/runtime/this-firefox` -> `extension/manifest.json`, or the `.xpi` file if I have it) and test `zen-browser tabs` once loaded.
```

## Architecture

- `extension/` — WebExtension MV3 (`manifest.json`, `background.js`, `content.js`, `popup.html`, `popup.css`, `popup.js`)
- `host/` — Native Messaging stdio-to-UNIX-socket multiplexer (`protocol.mjs`, `bridge.mjs`, `install.mjs`), listening on `~/.cache/opencode-zen-browser/bridge.sock` (`chmod 0600`)
- `src/core/` — Shared agent-agnostic logic (`client.ts`, `types.ts`, `markdown.ts`, `actions.ts`)
- `src/adapters/` — Thin agent frontends (`opencode.ts` for OpenCode 2 Code Mode, `cli.ts` for `zen-browser`)
- `bin/zen-browser` — CLI executable (`Node >= 20`)
- `.claude-plugin/` & `skills/zen-browser/` — Claude Code plugin manifest and skill instructions
- `tests/` — Unit & CLI tests (`bun test tests`)

## Development

```sh
pnpm run typecheck
pnpm run test
pnpm run build
```
