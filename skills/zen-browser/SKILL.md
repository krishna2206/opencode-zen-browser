---
name: zen-browser
description: Use the zen-browser CLI to inspect and interact with attached tabs in Zen Browser (DOM snapshots, Markdown extraction, clicks, typing, scrolling, passive XHR capture, same-site authenticated fetch, and screenshots). Activate when the user asks to browse, test a web app, read a logged-in page, or inspect network requests in Zen Browser.
---

# Zen Browser CLI (`zen-browser`)

Controls only the Zen Browser tabs explicitly attached by the user (or opened via `zen-browser open`). Unattached tabs remain invisible. Respects the extension's Read-only popup switch (blocks `click`, `type`, `back`, and non-`GET`/`HEAD` `fetch`).

## Workflow

1. Inspect currently attached tabs:
   ```sh
   zen-browser tabs
   ```
2. Open a background tab if needed, or reuse an attached `--tab <id>`:
   ```sh
   zen-browser open "https://example.com"
   ```
3. Read the page first with `snapshot`:
   - Use `--mode interactive` (default) to get `@1`, `@2` element refs (`--scope auto|main|body`).
   - Use `--mode markdown` for prose/articles.
   ```sh
   zen-browser snapshot --tab 12
   zen-browser snapshot --tab 12 --mode markdown --max-chars 12000
   ```
4. Act on `@ref`s from the latest `snapshot` (always re-snapshot after navigation or closing a modal):
   ```sh
   zen-browser type @3 "hello@example.com" --tab 12
   zen-browser click @4 --tab 12 --wait-ms 500
   zen-browser wait --text "Dashboard" --tab 12 --ms 5000
   zen-browser scroll down --amount 800 --tab 12
   zen-browser back --tab 12
   ```
5. Inspect recent XHR/fetch traffic or call same-site APIs using the browser's live cookies/TLS:
   ```sh
   zen-browser network --tab 12 --filter graphql --limit 10
   zen-browser fetch "/api/me" --tab 12
   zen-browser fetch "https://api.example.com/public" --credentials omit --tab 12
   ```
6. Take a screenshot only when visual layout matters (prints saved temp file path):
   ```sh
   zen-browser screenshot --tab 12
   ```
7. Clean up tabs opened by the agent (or detach user-owned tabs without closing them):
   ```sh
   zen-browser close 12
   ```

## Tips

- Pass `--json` to any command when structured output is needed.
- Combine sequential steps in one shell command with `&&` to save turns.
- If multiple tabs are attached and none is uniquely active, pass `--tab <id>` explicitly.
- If `zen-browser` reports the bridge is unavailable, ensure Zen Browser is running, the extension is installed, and `node host/install.mjs` was run on this machine.
