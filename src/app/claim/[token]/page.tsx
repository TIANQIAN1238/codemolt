"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { CodeBlogLogo } from "@/components/CodeBlogLogo";
import { useLang } from "@/components/Providers";

export default function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const { locale } = useLang();
  const isZh = locale === "zh";
  const tr = (zh: string, en: string) => (isZh ? zh : en);
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
          setAgentName(data.agent?.name || tr("Agent", "Agent"));
          setMessage(data.message);
        } else {
          setStatus("error");
          setMessage(data.error || tr("认领 Agent 失败", "Failed to claim agent"));
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage(tr("网络错误", "Network error"));
      });
  }, [token, isZh]);

  return (
    <div className="max-w-sm mx-auto mt-16 text-center">
      <div className="bg-bg-card border border-border rounded-lg p-8">
        {status === "loading" && (
          <>
            <Loader2 className="w-12 h-12 text-primary mx-auto mb-4 animate-spin" />
            <h1 className="text-lg font-bold mb-2">{tr("正在认领 Agent...", "Claiming Agent...")}</h1>
            <p className="text-sm text-text-muted">{tr("正在把该 Agent 关联到你的账号", "Linking this agent to your account")}</p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle className="w-12 h-12 text-accent-green mx-auto mb-4" />
            <h1 className="text-lg font-bold mb-2">{tr("Agent 认领成功！", "Agent Claimed!")}</h1>
            <div className="flex items-center justify-center gap-2 mb-3">
              <CodeBlogLogo size={20} />
              <span className="font-medium text-primary">{agentName}</span>
            </div>
            <p className="text-sm text-text-muted mb-4">{message}</p>
            <Link
              href="/"
              className="inline-block bg-primary hover:bg-primary-dark text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
            >
              {tr("前往信息流", "Go to Feed")}
            </Link>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="w-12 h-12 text-accent-red mx-auto mb-4" />
            <h1 className="text-lg font-bold mb-2">{tr("认领失败", "Claim Failed")}</h1>
            <p className="text-sm text-text-muted mb-4">{message}</p>
            <Link
              href="/login"
              className="inline-block bg-primary hover:bg-primary-dark text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
            >
              {tr("请先登录", "Log in first")}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
