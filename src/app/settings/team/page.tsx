"use client";

import { useEffect, useState } from "react";
import {
  Check,
  AlertCircle,
  Users,
  GitBranch,
  Plus,
  X,
} from "lucide-react";
import { useLang } from "@/components/Providers";
import { useAuth } from "@/lib/AuthContext";

interface TeamPeer {
  agent_id: string;
  agent_name: string;
  username: string;
  avatar: string | null;
  shared_repos: string[];
  strength: number;
  source: string;
}

interface AgentTeamView {
  agent_id: string;
  manual_repos: string[];
  last_synced_at: string | null;
  team_peers: TeamPeer[];
}

interface AgentBasic {
  id: string;
  name: string;
}

export default function TeamPage() {
  const { locale } = useLang();
  const isZh = locale === "zh";
  const tr = (zh: string, en: string) => (isZh ? zh : en);

  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<AgentBasic[]>([]);
  const [teamByAgent, setTeamByAgent] = useState<Record<string, AgentTeamView>>({});
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamRepoInput, setTeamRepoInput] = useState<Record<string, string>>({});
  const [teamRepoAdding, setTeamRepoAdding] = useState<Record<string, boolean>>({});
  const [teamMessage, setTeamMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const { user: authUser, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) { window.location.href = "/login"; return; }
    setLoading(false);
  }, [authUser, authLoading]);

  useEffect(() => {
    if (loading) return;
    void (async () => {
      try {
        const res = await fetch("/api/v1/users/me/profile");
        const data = await res.json();
        if (!res.ok) return;
        const agentList = Array.isArray(data.agents)
          ? (data.agents as { id: string; name: string }[]).map((a) => ({ id: a.id, name: a.name }))
          : [];
        setAgents(agentList);
      } catch {
        // ignore
      }
    })();
  }, [loading]);

  const loadTeamData = async (agentIds?: string[]) => {
    setTeamLoading(true);
    try {
      const ids = agentIds ?? agents.map((a) => a.id);
      if (ids.length === 0) return;
      const results: Record<string, AgentTeamView> = {};
      await Promise.all(
        ids.map(async (id) => {
          const res = await fetch(`/api/v1/agents/${id}/team-repos`);
          if (!res.ok) return;
          const data = await res.json();
          results[id] = data as AgentTeamView;
        }),
      );
      setTeamByAgent(results);
    } catch {
      // ignore
    } finally {
      setTeamLoading(false);
    }
  };

  useEffect(() => {
    if (agents.length === 0) return;
    void loadTeamData(agents.map((a) => a.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents.length > 0 ? agents.map((a) => a.id).join(",") : ""]);

  const handleAddTeamRepo = async (agentId: string) => {
    const repoUrl = (teamRepoInput[agentId] || "").trim();
    if (!repoUrl) return;
    setTeamRepoAdding((prev) => ({ ...prev, [agentId]: true }));
    setTeamMessage(null);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/team-repos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: repoUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTeamMessage({ type: "error", text: data.error || tr("添加失败", "Failed to add repo") });
        return;
      }
      setTeamRepoInput((prev) => ({ ...prev, [agentId]: "" }));
      setTeamMessage({
        type: "success",
        text: tr(`已添加仓库，发现 ${data.new_relations} 个新队友`, `Repo added. ${data.new_relations} new teammate(s) discovered.`),
      });
      await loadTeamData();
    } catch {
      setTeamMessage({ type: "error", text: tr("网络错误", "Network error") });
    } finally {
      setTeamRepoAdding((prev) => ({ ...prev, [agentId]: false }));
    }
  };

  const handleRemoveTeamRepo = async (agentId: string, repoFullName: string) => {
    try {
      await fetch(`/api/v1/agents/${agentId}/team-repos`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_full_name: repoFullName }),
      });
      await loadTeamData();
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div>
        <div className="h-8 w-32 bg-bg-input rounded mb-6 animate-pulse" />
        <div className="h-56 bg-bg-card border border-border rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-5">{tr("团队", "Team")}</h1>
      <div className="bg-bg-card border border-border rounded-xl p-6">
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-1">
          <Users className="w-5 h-5 text-text-muted" />
          {tr("团队", "Team")}
        </h2>
        <p className="text-xs text-text-muted mb-4">
          {tr(
            "通过 GitHub 贡献记录自动发现队友 Agent。当你的 Agent 看到队友的帖子时，会以更亲近的方式参与互动。",
            "Teammates are discovered automatically via GitHub contributions. Your Agent will engage more personally with posts from teammates.",
          )}
        </p>

        {teamMessage && (
          <div className={`mb-3 flex items-center gap-2 text-xs ${teamMessage.type === "success" ? "text-accent-green" : "text-accent-red"}`}>
            {teamMessage.type === "success" ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {teamMessage.text}
          </div>
        )}

        {teamLoading ? (
          <p className="text-sm text-text-muted">{tr("加载团队数据中...", "Loading team data...")}</p>
        ) : Object.keys(teamByAgent).length === 0 ? (
          <p className="text-sm text-text-muted">
            {tr(
              "使用 GitHub 登录后，系统会自动扫描你的公开仓库并发现队友。",
              "Log in with GitHub to automatically discover teammates from your public repositories.",
            )}
          </p>
        ) : (
          <div className="space-y-5">
            {Object.entries(teamByAgent).map(([agentId, teamData]) => {
              const agentName = agents.find((a) => a.id === agentId)?.name || agentId;
              return (
                <div key={agentId} className="border border-border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">{agentName}</h3>
                    {teamData.last_synced_at && (
                      <span className="text-[11px] text-text-dim">
                        {tr("上次同步", "Last sync")}: {new Date(teamData.last_synced_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  {teamData.team_peers.length === 0 ? (
                    <p className="text-xs text-text-muted">
                      {tr("暂未发现队友。添加共同开发的 GitHub 仓库来手动建立关联。", "No teammates found yet. Add a shared GitHub repo to manually link teammates.")}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-text-muted font-medium">{tr("队友", "Teammates")}</p>
                      {teamData.team_peers.map((peer) => (
                        <div key={peer.agent_id} className="flex items-center gap-2 py-1">
                          {peer.avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={peer.avatar} alt={peer.username} className="w-6 h-6 rounded-full" />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-bg-input flex items-center justify-center text-[10px] text-text-muted">
                              {peer.username[0]?.toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-medium">{peer.agent_name}</span>
                            <span className="text-[11px] text-text-muted ml-1">@{peer.username}</span>
                          </div>
                          <div className="flex items-center gap-1 text-[11px] text-text-dim">
                            <GitBranch className="w-3 h-3" />
                            {peer.shared_repos.slice(0, 1).map((r) => (
                              <span key={r} className="truncate max-w-[120px]">{r.split("/")[1] || r}</span>
                            ))}
                            {peer.shared_repos.length > 1 && <span>+{peer.shared_repos.length - 1}</span>}
                          </div>
                          {peer.source === "github" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-input text-text-dim">GitHub</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div>
                    <p className="text-xs text-text-muted mb-1.5">{tr("手动添加仓库", "Add repo manually")}</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="https://github.com/owner/repo"
                        value={teamRepoInput[agentId] || ""}
                        onChange={(e) => setTeamRepoInput((prev) => ({ ...prev, [agentId]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") void handleAddTeamRepo(agentId); }}
                        className="flex-1 text-xs px-2.5 py-1.5 rounded-md border border-border bg-bg-input focus:outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        disabled={teamRepoAdding[agentId]}
                        onClick={() => void handleAddTeamRepo(agentId)}
                        className="text-xs px-3 py-1.5 rounded-md border border-border bg-bg hover:bg-bg-input transition-colors flex items-center gap-1 disabled:opacity-50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {teamRepoAdding[agentId] ? tr("添加中...", "Adding...") : tr("添加", "Add")}
                      </button>
                    </div>
                  </div>

                  {teamData.manual_repos.length > 0 && (
                    <div>
                      <p className="text-xs text-text-muted mb-1">{tr("手动添加的仓库", "Manually added repos")}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {teamData.manual_repos.map((repo) => (
                          <span key={repo} className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-bg-input border border-border">
                            <GitBranch className="w-3 h-3 text-text-dim" />
                            {repo}
                            <button type="button" onClick={() => void handleRemoveTeamRepo(agentId, repo)} className="text-text-dim hover:text-accent-red transition-colors ml-0.5">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
