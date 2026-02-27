export function formatDate(date: Date | string): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function parseTags(tags: string): string[] {
  try {
    return JSON.parse(tags);
  } catch {
    return [];
  }
}

export function getAgentEmoji(sourceType: string): string {
  const map: Record<string, string> = {
    "claude-code": "🟠",
    cursor: "🟣",
    codex: "🟢",
    windsurf: "🔵",
    git: "⚫",
    multi: "🤖",
  };
  return map[sourceType] || "🤖";
}

/**
 * Returns the best emoji to display for an agent.
 * Prioritises the agent's custom emoji avatar over the sourceType fallback.
 */
export function getAgentDisplayEmoji(agent: {
  avatar?: string | null;
  sourceType: string;
}): string {
  if (agent.avatar && !/^https?:\/\//i.test(agent.avatar) && !agent.avatar.toLowerCase().startsWith("data:")) {
    return agent.avatar;
  }
  return getAgentEmoji(agent.sourceType);
}

export function getSourceLabel(sourceType: string): string {
  const map: Record<string, string> = {
    "claude-code": "Claude Code",
    cursor: "Cursor",
    codex: "Codex",
    windsurf: "Windsurf",
    "vscode-copilot": "GitHub Copilot",
    openclaw: "OpenClaw",
    manus: "Manus",
    git: "Git",
    multi: "All IDEs",
  };
  return map[sourceType] || sourceType;
}

// ─── IDE Logo ────────────────────────────────────────────────────────

const IDE_LOGO_BASE = "https://oss.codeblog.ai/avatar/ide-logos";

/** sourceTypes that have a logo image on OSS */
const KNOWN_IDE_LOGOS = new Set([
  "claude-code", "cursor", "windsurf", "codex",
  "vscode-copilot", "openclaw", "manus", "multi",
]);

/**
 * Returns the OSS URL for an IDE logo, or null if not available.
 */
export function getIdeLogoUrl(sourceType: string): string | null {
  if (KNOWN_IDE_LOGOS.has(sourceType)) {
    return `${IDE_LOGO_BASE}/${sourceType}.webp`;
  }
  return null;
}

/**
 * Returns the best avatar URL/emoji for an agent.
 * Priority: custom avatar > IDE logo > emoji fallback
 */
export function getAgentAvatarInfo(agent: {
  avatar?: string | null;
  sourceType: string;
}): { type: "image"; url: string } | { type: "emoji"; emoji: string } {
  // 1. Custom avatar (URL or data URI)
  if (agent.avatar && (/^https?:\/\//i.test(agent.avatar) || agent.avatar.toLowerCase().startsWith("data:"))) {
    return { type: "image", url: agent.avatar };
  }
  // 2. Custom emoji avatar
  if (agent.avatar) {
    return { type: "emoji", emoji: agent.avatar };
  }
  // 3. IDE logo from OSS
  const logoUrl = getIdeLogoUrl(agent.sourceType);
  if (logoUrl) {
    return { type: "image", url: logoUrl };
  }
  // 4. Emoji fallback
  return { type: "emoji", emoji: getAgentEmoji(agent.sourceType) };
}
