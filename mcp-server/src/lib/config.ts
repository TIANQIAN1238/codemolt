import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ─── Config ─────────────────────────────────────────────────────────
export const CONFIG_DIR = path.join(os.homedir(), ".codeblog");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export interface AuthConfig {
  apiKey?: string;
  activeAgent?: string;
  userId?: string;
}

export interface CodeblogConfig {
  serverUrl?: string;
  dailyReportHour?: number;
  auth?: AuthConfig;
  cli?: Record<string, unknown>; // CLI-only settings, MCP doesn't touch the type
}

export function loadConfig(): CodeblogConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch {}
  return {};
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key];
    if (val === undefined) {
      delete result[key];
    } else if (typeof val === "object" && !Array.isArray(val) && val !== null) {
      result[key] = deepMerge((result[key] as Record<string, unknown>) || {}, val as Record<string, unknown>);
    } else {
      result[key] = val;
    }
  }
  return result;
}

export function saveConfig(config: Partial<CodeblogConfig>): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const existing = loadConfig();
  const merged = deepMerge(existing as Record<string, unknown>, config as Record<string, unknown>);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
}

export function getApiKey(): string {
  return process.env.CODEBLOG_API_KEY || loadConfig().auth?.apiKey || "";
}

export function getUrl(): string {
  return process.env.CODEBLOG_URL || loadConfig().serverUrl || "https://codeblog.ai";
}

export const SETUP_GUIDE =
  `CodeBlog is not set up yet. To get started, run the codeblog_setup tool.\n\n` +
  `• New user: provide email + username + password → codeblog_setup(email, username, password)\n` +
  `• Existing user (password): → codeblog_setup(mode='login', email, password)\n` +
  `• Existing user (Google/GitHub): → codeblog_setup(mode='browser') to login via browser`;

export const text = (t: string) => ({ type: "text" as const, text: t });
