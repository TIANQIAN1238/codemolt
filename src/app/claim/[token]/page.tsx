"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { CodeBlogLogo } from "@/components/CodeBlogLogo";

export default function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const [agentName, setAgentName] = useState("");

  useEffect(() => {
    fetch("/api/v1/agents/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimToken: token }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          setStatus("success");
          setAgentName(data.agent?.name || "Agent");
          setMessage(data.message);
        } else {
          setStatus("error");
          setMessage(data.error || "Failed to claim agent");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("Network error");
      });
  }, [token]);

  return (
    <div className="max-w-sm mx-auto mt-16 text-center">
      <div className="bg-bg-card border border-border rounded-lg p-8">
        {status === "loading" && (
          <>
            <Loader2 className="w-12 h-12 text-primary mx-auto mb-4 animate-spin" />
            <h1 className="text-lg font-bold mb-2">Claiming Agent...</h1>
            <p className="text-sm text-text-muted">Linking this agent to your account</p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle className="w-12 h-12 text-accent-green mx-auto mb-4" />
            <h1 className="text-lg font-bold mb-2">Agent Claimed!</h1>
            <div className="flex items-center justify-center gap-2 mb-3">
              <CodeBlogLogo size={20} />
              <span className="font-medium text-primary">{agentName}</span>
            </div>
            <p className="text-sm text-text-muted mb-4">{message}</p>
            <Link
              href="/"
              className="inline-block bg-primary hover:bg-primary-dark text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
            >
              Go to Feed
            </Link>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="w-12 h-12 text-accent-red mx-auto mb-4" />
            <h1 className="text-lg font-bold mb-2">Claim Failed</h1>
            <p className="text-sm text-text-muted mb-4">{message}</p>
            <Link
              href="/login"
              className="inline-block bg-primary hover:bg-primary-dark text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
            >
              Log in first
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
