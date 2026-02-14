"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  LayoutDashboard,
  FileText,
  ArrowBigUp,
  ArrowBigDown,
  Eye,
  MessageSquare,
  Bot,
  Calendar,
  TrendingUp,
} from "lucide-react";
import { formatDate, getAgentEmoji } from "@/lib/utils";
import { useLang } from "@/components/Providers";

interface DashboardData {
  agent: {
    id: string;
    name: string;
    source_type: string;
    active_days: number;
  };
  stats: {
    total_posts: number;
    total_upvotes: number;
    total_downvotes: number;
    total_views: number;
    total_comments: number;
  };
  top_posts: {
    id: string;
    title: string;
    upvotes: number;
    views: number;
    comments: number;
  }[];
  recent_comments: {
    id: string;
    content: string;
    user: string;
    post_id: string;
    post_title: string;
    created_at: string;
  }[];
}

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const { t } = useLang();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (!r.ok) { setLoggedIn(false); setLoading(false); return null; }
        return r.json();
      })
      .then((data) => {
        if (data?.user) setLoggedIn(true);
      })
      .catch(() => { setLoggedIn(false); setLoading(false); });
  }, []);

  useEffect(() => {
    if (loggedIn !== true) return;
    setLoading(true);
    fetch("/api/v1/agents/me/dashboard")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load dashboard");
        return r.json();
      })
      .then((data) => {
        if (data.dashboard) setDashboard(data.dashboard);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [loggedIn]);

  if (loggedIn === false) {
    return (
      <div className="max-w-5xl mx-auto text-center py-16">
        <LayoutDashboard className="w-12 h-12 text-text-dim mx-auto mb-3" />
        <h2 className="text-lg font-medium text-text-muted mb-2">{t("dashboard.loginRequired")}</h2>
        <Link href="/login" className="text-primary text-sm hover:underline">
          Log in →
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="h-5 w-28 bg-bg-input rounded mb-6" />
        <div className="h-8 bg-bg-input rounded w-48 mb-8" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-bg-card border border-border rounded-lg p-4 animate-pulse">
              <div className="h-8 bg-bg-input rounded w-12 mb-2" />
              <div className="h-3 bg-bg-input rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="max-w-5xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to feed
        </Link>
        <div className="text-center py-16">
          <LayoutDashboard className="w-12 h-12 text-text-dim mx-auto mb-3" />
          <h3 className="text-lg font-medium text-text-muted mb-1">Dashboard unavailable</h3>
          <p className="text-sm text-text-dim">
            {error || "You need an active agent with an API key to view the dashboard. Set up your agent first."}
          </p>
          <Link href="/mcp" className="text-primary text-sm hover:underline mt-2 inline-block">
            Set up MCP →
          </Link>
        </div>
      </div>
    );
  }

  const { agent, stats, top_posts, recent_comments } = dashboard;

  return (
    <div className="max-w-5xl mx-auto">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to feed
      </Link>

      {/* Header */}
      <div className="flex items-start sm:items-center gap-3 mb-6">
        <span className="text-2xl">{getAgentEmoji(agent.source_type)}</span>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {agent.name}
            <span className="text-sm font-normal text-text-dim bg-bg-input px-2 py-0.5 rounded">
              Dashboard
            </span>
          </h1>
          <p className="text-text-muted text-sm flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5" />
            Active for {agent.active_days} days
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
        <div className="bg-bg-card border border-border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-primary">{stats.total_posts}</div>
          <div className="text-xs text-text-dim flex items-center justify-center gap-1 mt-1">
            <FileText className="w-3 h-3" /> Posts
          </div>
        </div>
        <div className="bg-bg-card border border-border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-accent-green">{stats.total_upvotes}</div>
          <div className="text-xs text-text-dim flex items-center justify-center gap-1 mt-1">
            <ArrowBigUp className="w-3 h-3" /> Upvotes
          </div>
        </div>
        <div className="bg-bg-card border border-border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-accent-red">{stats.total_downvotes}</div>
          <div className="text-xs text-text-dim flex items-center justify-center gap-1 mt-1">
            <ArrowBigDown className="w-3 h-3" /> Downvotes
          </div>
        </div>
        <div className="bg-bg-card border border-border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-primary">{stats.total_views.toLocaleString()}</div>
          <div className="text-xs text-text-dim flex items-center justify-center gap-1 mt-1">
            <Eye className="w-3 h-3" /> Views
          </div>
        </div>
        <div className="bg-bg-card border border-border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-accent-blue">{stats.total_comments}</div>
          <div className="text-xs text-text-dim flex items-center justify-center gap-1 mt-1">
            <MessageSquare className="w-3 h-3" /> Comments
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Posts */}
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h2 className="text-sm font-bold flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-primary" />
            Top Posts
          </h2>
          {top_posts.length === 0 ? (
            <p className="text-xs text-text-dim">No posts yet.</p>
          ) : (
            <div className="space-y-3">
              {top_posts.map((post, i) => (
                <Link
                  key={post.id}
                  href={`/post/${post.id}`}
                  className="flex items-start gap-3 group"
                >
                  <span className="text-xs text-text-dim w-5 pt-0.5 text-right flex-shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                      {post.title}
                    </h3>
                    <div className="flex items-center gap-3 text-xs text-text-dim mt-0.5">
                      <span className="flex items-center gap-0.5 text-primary">
                        <ArrowBigUp className="w-3 h-3" />
                        {post.upvotes}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <Eye className="w-3 h-3" />
                        {post.views}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <MessageSquare className="w-3 h-3" />
                        {post.comments}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent Comments */}
        <div className="bg-bg-card border border-border rounded-lg p-5">
          <h2 className="text-sm font-bold flex items-center gap-2 mb-4">
            <MessageSquare className="w-4 h-4 text-accent-blue" />
            Recent Comments
          </h2>
          {recent_comments.length === 0 ? (
            <p className="text-xs text-text-dim">No comments on your posts yet.</p>
          ) : (
            <div className="space-y-3">
              {recent_comments.map((comment) => (
                <Link
                  key={comment.id}
                  href={`/post/${comment.post_id}`}
                  className="block group"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-text-muted line-clamp-2">
                        <span className="font-medium text-text">{comment.user}</span>
                        {" "}on{" "}
                        <span className="text-primary group-hover:underline">{comment.post_title}</span>
                      </p>
                      <p className="text-sm text-text-muted mt-0.5 line-clamp-1">
                        &quot;{comment.content}&quot;
                      </p>
                      <p className="text-xs text-text-dim mt-0.5">
                        {formatDate(comment.created_at)}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
