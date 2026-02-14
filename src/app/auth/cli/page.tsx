"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Bot, Terminal, CheckCircle, XCircle } from "lucide-react";

function CLIAuthContent() {
  const searchParams = useSearchParams();
  const port = searchParams.get("port") || "19823";
  const [user, setUser] = useState<{ username: string; email: string; avatar: string | null } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "authorizing" | "success" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) {
          setUser(data.user);
          setStatus("ready");
        } else {
          window.location.href = `/login?return_to=${encodeURIComponent(`/auth/cli?port=${port}`)}`;
        }
      })
      .catch(() => {
        window.location.href = `/login?return_to=${encodeURIComponent(`/auth/cli?port=${port}`)}`;
      });
  }, [port]);

  const authorize = async () => {
    setStatus("authorizing");
    try {
      const res = await fetch("/api/auth/cli-token", { method: "POST" });
      if (!res.ok) throw new Error("Failed to create token");
      const data = await res.json();

      const url = new URL(`http://localhost:${port}/callback`);
      url.searchParams.set("token", data.token);
      url.searchParams.set("username", user?.username || "");

      const callbackRes = await fetch(url.toString(), { mode: "no-cors" });
      setStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authorization failed");
      setStatus("error");
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-primary p-4">
      <div className="max-w-md w-full bg-bg-secondary border border-border rounded-xl p-8 shadow-lg">
        {status === "success" ? (
          <div className="text-center">
            <CheckCircle className="w-16 h-16 text-accent-green mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-text mb-2">Authorized!</h1>
            <p className="text-text-muted">
              You can close this window and return to the terminal.
            </p>
          </div>
        ) : status === "error" ? (
          <div className="text-center">
            <XCircle className="w-16 h-16 text-accent-red mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-text mb-2">Authorization Failed</h1>
            <p className="text-text-muted mb-4">{error}</p>
            <button
              onClick={() => setStatus("ready")}
              className="bg-primary hover:bg-primary-dark text-white font-medium py-2 px-6 rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <div className="flex items-center justify-center gap-3 mb-4">
                <Terminal className="w-10 h-10 text-primary" />
                <span className="text-2xl text-text-muted">→</span>
                <Bot className="w-10 h-10 text-primary" />
              </div>
              <h1 className="text-2xl font-bold text-text mb-1">Authorize CodeBlog CLI</h1>
              <p className="text-text-muted text-sm">
                The CodeBlog CLI is requesting access to your account
              </p>
            </div>

            <div className="bg-bg-primary border border-border rounded-lg p-4 mb-6">
              <div className="flex items-center gap-3">
                {user?.avatar ? (
                  <img src={user.avatar} alt="" className="w-10 h-10 rounded-full" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                    {user?.username?.[0]?.toUpperCase() || "?"}
                  </div>
                )}
                <div>
                  <div className="font-medium text-text">{user?.username}</div>
                  <div className="text-sm text-text-muted">{user?.email}</div>
                </div>
              </div>
            </div>

            <div className="space-y-2 mb-6 text-sm text-text-muted">
              <p className="font-medium text-text">This will allow the CLI to:</p>
              <ul className="space-y-1 ml-4">
                <li>• Read and write posts on your behalf</li>
                <li>• Access your profile information</li>
                <li>• Chat with AI using your account</li>
              </ul>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => window.close()}
                className="flex-1 bg-bg-primary hover:bg-bg-input border border-border text-text font-medium py-2.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={authorize}
                disabled={status === "authorizing"}
                className="flex-1 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors"
              >
                {status === "authorizing" ? "Authorizing..." : "Authorize"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CLIAuthPage() {
  return (
    <Suspense>
      <CLIAuthContent />
    </Suspense>
  );
}
