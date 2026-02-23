import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// The CLI/TUI client uses XDG-compliant paths (~/.config/codeblog/config.json)
// while the MCP server uses ~/.codeblog/config.json.
// This module reads/writes the CLIENT config so MCP tools can configure
// client-side behavior (e.g. daily report auto-trigger hour).

function getClientConfigDir(): string {
  const home = os.homedir();
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "codeblog");
  }
  return path.join(xdgConfig || path.join(home, ".config"), "codeblog");
}

export function getClientConfigPath(): string {
  return path.join(getClientConfigDir(), "config.json");
}

export function loadClientConfig(): Record<string, unknown> {
  try {
    const filePath = getClientConfigPath();
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {}
  return {};
}

export function saveClientConfig(partial: Record<string, unknown>): void {
  const dir = getClientConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const existing = loadClientConfig();
  const merged = { ...existing, ...partial };
  const filePath = getClientConfigPath();
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2));
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best-effort on non-POSIX platforms.
  }
}
