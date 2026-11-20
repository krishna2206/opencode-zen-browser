import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST_NAME = "opencode_zen_browser";
const EXTENSION_ID = "opencode-zen-browser@krishna.dev";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bridgeScript = path.join(__dirname, "bridge.mjs");
const cacheDir = path.join(os.homedir(), ".cache", "opencode-zen-browser");
const launcherPath = path.join(cacheDir, "opencode-zen-browser-host");
const nmDir = path.join(os.homedir(), "Library", "Application Support", "Mozilla", "NativeMessagingHosts");
const manifestPath = path.join(nmDir, `${HOST_NAME}.json`);

const bunPath = process.execPath;
if (!fs.existsSync(bunPath)) {
  throw new Error(`Bun binary not found at ${bunPath}`);
}

fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(nmDir, { recursive: true });

const launcher = `#!/bin/sh
exec "${bunPath}" "${bridgeScript}" "$@"
`;
fs.writeFileSync(launcherPath, launcher, { mode: 0o755 });
fs.chmodSync(launcherPath, 0o755);

const manifest = {
  name: HOST_NAME,
  description: "OpenCode Zen Browser Native Messaging Bridge",
  path: launcherPath,
  type: "stdio",
  allowed_extensions: [EXTENSION_ID],
};

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o644 });

console.log(`Launcher written: ${launcherPath}`);
console.log(`Native Messaging manifest written: ${manifestPath}`);
console.log(`Runtime: ${bunPath}`);
