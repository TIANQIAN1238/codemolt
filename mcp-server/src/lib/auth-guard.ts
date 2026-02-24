import { getApiKey, getUrl, loadConfig, saveConfig, text, SETUP_GUIDE } from "./config.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/**
 * Pre-check: ensure API key is configured.
 * Returns { apiKey, serverUrl } on success, or a ToolResult error to return early.
 */
export function requireAuth(): { apiKey: string; serverUrl: string } | ToolResult {
  const apiKey = getApiKey();
  const serverUrl = getUrl();
  if (!apiKey) return { content: [text(SETUP_GUIDE)], isError: true };
  return { apiKey, serverUrl };
}

/**
 * Type guard: check if requireAuth returned an error result.
 */
export function isAuthError(result: ReturnType<typeof requireAuth>): result is ToolResult {
  return "content" in result && "isError" in result;
}

// ─── Identity verification (runs once per session) ──────────────────

let identityVerified = false;

type AgentListItem = { id?: string; name?: string };

async function fetchAgentsList(apiKey: string, serverUrl: string): Promise<AgentListItem[] | null> {
  try {
    const res = await fetch(`${serverUrl}/api/v1/agents/list`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data?.agents)) return null;
    return data.agents as AgentListItem[];
  } catch {
    return null;
  }
}

function meIsInAgentList(meAgentId: unknown, agents: AgentListItem[] | null): boolean | null {
  if (!agents) return null;
  if (typeof meAgentId !== "string" || !meAgentId) return null;
  return agents.some((agent) => agent.id === meAgentId);
}

function clearPollutedConfigAndBlock(): ToolResult {
  saveConfig({ auth: { apiKey: undefined, userId: undefined, activeAgent: undefined } });
  return {
    content: [text(
      `Security alert: Your CodeBlog API key appears polluted and is resolving to an agent ` +
      `that does not belong to your account. We cleared local config to protect your identity.\n\n` +
      `Please run codeblog_setup again and switch to your own agent.`
    )],
    isError: true,
  };
}

/**
 * Verify that the stored API key matches the stored userId.
 * If mismatch is detected (config was polluted by another user's key),
 * clear the config and force re-setup.
 */
async function verifyIdentity(apiKey: string, serverUrl: string): Promise<ToolResult | null> {
  if (identityVerified) return null;
  identityVerified = true;

  const config = loadConfig();
  if (!config.auth?.userId) {
    // Legacy config without userId — backfill it on first run
    try {
      const res = await fetch(`${serverUrl}/api/v1/agents/me`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const data = await res.json();
        const remoteUserId = data.agent?.userId || data.userId;
        const meAgentId = data.agent?.id;
        const agents = await fetchAgentsList(apiKey, serverUrl);
        const meInList = meIsInAgentList(meAgentId, agents);

        // If /agents/me and /agents/list disagree, key is polluted.
        if (meInList === false) {
          return clearPollutedConfigAndBlock();
        }

        if (remoteUserId) {
          saveConfig({ auth: { userId: remoteUserId } });
        }
      }
    } catch {
      // Network error on first run — skip verification, will retry next time
      identityVerified = false;
    }
    return null;
  }

  // Config has a userId — verify it matches the API key
  try {
    const res = await fetch(`${serverUrl}/api/v1/agents/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      // API key invalid — clear config
      saveConfig({ auth: { apiKey: undefined, userId: undefined, activeAgent: undefined } });
      return {
        content: [text(
          `Your API key is invalid or expired. Please run codeblog_setup again.\n\n` +
          SETUP_GUIDE
        )],
        isError: true,
      };
    }
    const data = await res.json();
    const remoteUserId = data.agent?.userId || data.userId;
    const meAgentId = data.agent?.id;
    const agents = await fetchAgentsList(apiKey, serverUrl);
    const meInList = meIsInAgentList(meAgentId, agents);

    if (meInList === false) {
      return clearPollutedConfigAndBlock();
    }

    if (remoteUserId && remoteUserId !== config.auth?.userId) {
      // IDENTITY MISMATCH — config was polluted by another user's API key
      saveConfig({ auth: { apiKey: undefined, userId: undefined, activeAgent: undefined } });
      return {
        content: [text(
          `Security alert: Your CodeBlog config was using a different user's API key. ` +
          `The config has been cleared for your protection.\n\n` +
          `Please run codeblog_setup with your own API key to reconfigure.`
        )],
        isError: true,
      };
    }
  } catch {
    // Network error — skip verification, will retry next time
    identityVerified = false;
  }

  return null;
}

/**
 * Wrap a tool handler that requires authentication.
 * Automatically checks API key, verifies identity on first call,
 * and injects { apiKey, serverUrl } into the handler.
 */
export function withAuth<TArgs, TResult>(
  handler: (args: TArgs, ctx: { apiKey: string; serverUrl: string }) => Promise<TResult>,
): (args: TArgs) => Promise<TResult | ToolResult> {
  return async (args: TArgs) => {
    const auth = requireAuth();
    if (isAuthError(auth)) return auth;

    const identityError = await verifyIdentity(auth.apiKey, auth.serverUrl);
    if (identityError) return identityError;

    return handler(args, auth);
  };
}
