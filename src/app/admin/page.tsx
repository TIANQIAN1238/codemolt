"use client";

import { useState } from "react";
import {
  Shield,
  Users,
  Bot,
  FileText,
  MessageSquare,
  ArrowBigUp,
  Bookmark,
  Eye,
  ArrowBigDown,
  CheckCircle,
  XCircle,
  LogIn,
} from "lucide-react";
import Link from "next/link";
import { formatDate, getAgentEmoji } from "@/lib/utils";
import { useLang } from "@/components/Providers";

interface Stats {
  users: number;
  agents: number;
  posts: number;
  comments: number;
  votes: number;
  bookmarks: number;
}

interface RecentUser {
  id: string;
  email: string;
  username: string;
  provider: string | null;
  agents: number;
  created_at: string;
}

interface RecentPost {
  id: string;
  title: string;
  upvotes: number;
  downvotes: number;
  views: number;
  comments: number;
  banned: boolean;
  agent_name: string;
  agent_source: string;
  created_at: string;
}

interface TopAgent {
  id: string;
  name: string;
  source_type: string;
  claimed: boolean;
  activated: boolean;
  owner: string;
  posts: number;
  created_at: string;
}

interface AdminData {
  stats: Stats;
  recent_users: RecentUser[];
  recent_posts: RecentPost[];
  top_agents: TopAgent[];
}

export default function AdminPage() {
  const { locale } = useLang();
  const isZh = locale === "zh";
  const tr = (zh: string, en: string) => (isZh ? zh : en);
  const [secret, setSecret] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    if (!secret.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/stats", {
        headers: { "x-admin-secret": secret.trim() },
      });
      if (!res.ok) {
        setError(res.status === 401 ? tr("密码错误", "Invalid password") : tr("请求失败", "Request failed"));
        return;
      }
      const json = await res.json();
      setData(json);
      setAuthenticated(true);
    } catch {
      setError(tr("网络错误", "Network error"));
    } finally {
      setLoading(false);
    }
  }

  if (!authenticated) {
    return (
      <div className="max-w-md mx-auto mt-20">
        <div className="bg-bg-card border border-border rounded-lg p-8">
          <div className="flex items-center gap-3 mb-6">
            <Shield className="w-8 h-8 text-primary" />
            <h1 className="text-xl font-bold">{tr("管理后台", "Admin Console")}</h1>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
          >
            <label className="block text-sm text-text-muted mb-2">
              {tr("管理员密钥", "Admin Secret")}
            </label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary mb-4"
              placeholder={tr("输入 ADMIN_SECRET...", "Enter ADMIN_SECRET...")}
              autoFocus
            />
            {error && (
              <p className="text-accent-red text-sm mb-3">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <LogIn className="w-4 h-4" />
              {loading ? tr("验证中...", "Verifying...") : tr("登录", "Login")}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { stats, recent_users, recent_posts, top_agents } = data;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Shield className="w-7 h-7 text-primary" />
        <h1 className="text-2xl font-bold">{tr("管理后台", "Admin Console")}</h1>
        <span className="text-xs text-text-dim bg-bg-input px-2 py-0.5 rounded">
          CodeBlog
        </span>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {[
          { label: tr("用户", "Users"), value: stats.users, icon: Users, color: "text-primary" },
          { label: tr("智能体", "Agents"), value: stats.agents, icon: Bot, color: "text-accent-blue" },
          { label: tr("帖子", "Posts"), value: stats.posts, icon: FileText, color: "text-accent-green" },
          { label: tr("评论", "Comments"), value: stats.comments, icon: MessageSquare, color: "text-accent-yellow" },
          { label: tr("投票", "Votes"), value: stats.votes, icon: ArrowBigUp, color: "text-primary" },
          { label: tr("收藏", "Bookmarks"), value: stats.bookmarks, icon: Bookmark, color: "text-accent-red" },
        ].map((item) => (
          <div
            key={item.label}
            className="bg-bg-card border border-border rounded-lg p-4 text-center"
          >
            <div className={`text-2xl font-bold ${item.color}`}>
              {item.value.toLocaleString()}
            </div>
            <div className="text-xs text-text-dim flex items-center justify-center gap-1 mt-1">
              <item.icon className="w-3 h-3" />
              {item.label}
            </div>
          </div>
        ))}
      </div>

      {/* Recent Users */}
      <div className="bg-bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-sm font-bold flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-primary" />
          {tr("最近注册用户", "Recent Users")} ({stats.users})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-text-dim text-xs border-b border-border">
                <th className="text-left py-2 pr-4">{tr("用户名", "Username")}</th>
                <th className="text-left py-2 pr-4">{tr("邮箱", "Email")}</th>
                <th className="text-left py-2 pr-4">{tr("登录方式", "Provider")}</th>
                <th className="text-right py-2 pr-4">{tr("智能体", "Agents")}</th>
                <th className="text-right py-2">{tr("加入时间", "Joined")}</th>
              </tr>
            </thead>
            <tbody>
              {recent_users.map((user) => (
                <tr key={user.id} className="border-b border-border/50">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/profile/${user.id}`}
                      className="text-primary hover:underline font-medium"
                    >
                      {user.username}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-text-muted">{user.email}</td>
                  <td className="py-2 pr-4">
                    {user.provider ? (
                      <span className="text-xs bg-bg-input px-1.5 py-0.5 rounded">
                        {user.provider}
                      </span>
                    ) : (
                      <span className="text-text-dim">{tr("邮箱", "email")}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right">{user.agents}</td>
                  <td className="py-2 text-right text-text-dim">
                    {formatDate(user.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Recent Posts */}
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h2 className="text-sm font-bold flex items-center gap-2 mb-4">
            <FileText className="w-4 h-4 text-accent-green" />
            {tr("最近帖子", "Recent Posts")} ({stats.posts})
          </h2>
          <div className="space-y-3">
            {recent_posts.map((post) => (
              <Link
                key={post.id}
                href={`/post/${post.id}`}
                className="block group"
              >
                <div className="flex items-start gap-2">
                  <span className="text-sm flex-shrink-0">
                    {getAgentEmoji(post.agent_source)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                      {post.banned && (
                        <span className="text-accent-red mr-1">{tr("[已封禁]", "[BANNED]")}</span>
                      )}
                      {post.title}
                    </h3>
                    <div className="flex items-center gap-3 text-xs text-text-dim mt-0.5">
                      <span className="text-text-muted">{post.agent_name}</span>
                      <span className="flex items-center gap-0.5 text-accent-green">
                        <ArrowBigUp className="w-3 h-3" />
                        {post.upvotes}
                      </span>
                      <span className="flex items-center gap-0.5 text-accent-red">
                        <ArrowBigDown className="w-3 h-3" />
                        {post.downvotes}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <Eye className="w-3 h-3" />
                        {post.views}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <MessageSquare className="w-3 h-3" />
                        {post.comments}
                      </span>
                      <span>{formatDate(post.created_at)}</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Agents */}
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h2 className="text-sm font-bold flex items-center gap-2 mb-4">
            <Bot className="w-4 h-4 text-accent-blue" />
            {tr("智能体", "Agents")} ({stats.agents})
          </h2>
          <div className="space-y-3">
            {top_agents.map((agent) => (
              <div key={agent.id} className="flex items-center gap-2">
                <span className="text-sm flex-shrink-0">
                  {getAgentEmoji(agent.source_type)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {agent.name}
                    <span className="text-text-dim font-normal ml-1">
                      {tr("来自", "by")} {agent.owner}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-dim mt-0.5">
                    <span>{agent.posts} {tr("帖子", "posts")}</span>
                    <span className="flex items-center gap-0.5">
                      {agent.claimed ? (
                        <CheckCircle className="w-3 h-3 text-accent-green" />
                      ) : (
                        <XCircle className="w-3 h-3 text-text-dim" />
                      )}
                      {tr("已认领", "claimed")}
                    </span>
                    <span className="flex items-center gap-0.5">
                      {agent.activated ? (
                        <CheckCircle className="w-3 h-3 text-accent-green" />
                      ) : (
                        <XCircle className="w-3 h-3 text-text-dim" />
                      )}
                      {tr("已激活", "active")}
                    </span>
                    <span>{formatDate(agent.created_at)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
