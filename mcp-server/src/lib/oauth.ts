import * as http from "http";
import { getUrl } from "./config.js";

const DEFAULT_PORT = 19823;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface CallbackResult {
  api_key?: string;
  username?: string;
  has_agents?: string;
}

/**
 * Start a local HTTP callback server, open the browser for web login,
 * and wait for the callback with the API key.
 *
 * Flow:
 * 1. Start local HTTP server on port 19823 (fallback to 19824, 19825, random)
 * 2. Open browser to codeblog.ai/auth/cli?port=<port>
 * 3. User logs in on the web (email/password, Google, GitHub — any method)
 * 4. Web page sends callback to http://localhost:<port>/callback?api_key=...&username=...
 * 5. Server receives callback, saves config, returns success page
 */
export function startOAuthFlow(): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const serverUrl = getUrl();
    let resolved = false;
    let browserOpened = false;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://localhost`);

      if (url.pathname === "/callback") {
        const result: CallbackResult = {
          api_key: url.searchParams.get("api_key") || undefined,
          username: url.searchParams.get("username") || undefined,
          has_agents: url.searchParams.get("has_agents") || undefined,
        };

        // Return success HTML page
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html>
<html>
<head><title>CodeBlog - Authorized</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #e5e5e5; }
  .card { text-align: center; padding: 2rem; }
  .check { font-size: 4rem; margin-bottom: 1rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  p { color: #888; }
</style>
</head>
<body>
  <div class="card">
    <div class="check">✅</div>
    <h1>Authorized!</h1>
    <p>You can close this window and return to your IDE.</p>
  </div>
  <script>setTimeout(() => window.close(), 3000);</script>
</body>
</html>`);

        resolved = true;
        // Close server after a short delay to ensure response is sent
        setTimeout(() => {
          server.close();
          resolve(result);
        }, 500);
        return;
      }

      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    function openBrowser(port: number) {
      if (browserOpened) return;
      browserOpened = true;

      const authUrl = `${serverUrl}/auth/cli?port=${port}`;
      import("child_process").then(({ exec }) => {
        const platform = process.platform;
        const cmd =
          platform === "darwin" ? `open "${authUrl}"` :
          platform === "win32" ? `start "" "${authUrl}"` :
          `xdg-open "${authUrl}"`;
        exec(cmd);
      });
    }

    // Try ports sequentially: 19823, 19824, 19825, then random (0)
    const ports = [DEFAULT_PORT, DEFAULT_PORT + 1, DEFAULT_PORT + 2, 0];
    let portIndex = 0;

    function tryNextPort() {
      if (portIndex >= ports.length) {
        reject(new Error("Failed to start callback server on any port"));
        return;
      }
      const port = ports[portIndex++];
      server.listen(port);
    }

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && !resolved) {
        tryNextPort();
      } else if (!resolved) {
        reject(err);
      }
    });

    server.on("listening", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : DEFAULT_PORT;
      openBrowser(actualPort);
    });

    // Start trying
    tryNextPort();

    // Timeout
    setTimeout(() => {
      if (!resolved) {
        server.close();
        reject(new Error("Login timed out (5 minutes). Please try again."));
      }
    }, TIMEOUT_MS);
  });
}
