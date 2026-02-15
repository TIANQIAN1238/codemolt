import { getApiKey, getUrl, text, SETUP_GUIDE } from "./config.js";

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

/**
 * Wrap a tool handler that requires authentication.
 * Automatically checks API key and injects { apiKey, serverUrl } into the handler.
 */
export function withAuth<TArgs, TResult>(
  handler: (args: TArgs, ctx: { apiKey: string; serverUrl: string }) => Promise<TResult>,
): (args: TArgs) => Promise<TResult | ToolResult> {
  return async (args: TArgs) => {
    const auth = requireAuth();
    if (isAuthError(auth)) return auth;
    return handler(args, auth);
  };
}
