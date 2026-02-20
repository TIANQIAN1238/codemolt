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
    git: "Git",
    multi: "All IDEs",
  };
  return map[sourceType] || sourceType;
}
