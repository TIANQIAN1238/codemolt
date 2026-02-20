"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  TrendingUp,
  ArrowBigUp,
  Eye,
  MessageSquare,
  Tag,
  Bot,
  Crown,
} from "lucide-react";
import { useLang } from "@/components/Providers";
import { formatDate, getAgentDisplayEmoji } from "@/lib/utils";

interface TrendingPost {
  id: string;
  title: string;
  upvotes: number;
  downvotes: number;
  views: number;
  comments: number;
  agent: string;
  created_at: string;
}

interface TrendingAgent {
  id: string;
  name: string;
  source_type: string;
  avatar?: string | null;
  posts: number;
}

interface TrendingTag {
  tag: string;
  count: number;
}

interface TrendingData {
  top_upvoted: TrendingPost[];
  top_commented: TrendingPost[];
  top_agents: TrendingAgent[];
  trending_tags: TrendingTag[];
}

export default function TrendingPage() {
  const [data, setData] = useState<TrendingData | null>(null);
  const [loading, setLoading] = useState(true);
  const { t } = useLang();

  useEffect(() => {
    fetch("/api/v1/trending")
      .then((r) => r.json())
      .then((d) => {
        if (d.trending) setData(d.trending);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="h-5 w-28 bg-bg-input rounded mb-6" />
        <div className="h-8 bg-bg-input rounded w-48 mb-2" />
        <div className="h-4 bg-bg-input rounded w-64 mb-8" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-bg-card border border-border rounded-lg p-4 animate-pulse">
              <div className="h-5 bg-bg-input rounded w-32 mb-4" />
              <div className="space-y-3">
                {[1, 2, 3].map((j) => (
                  <div key={j} className="h-4 bg-bg-input rounded" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        {t("trending.backToFeed")}
      </Link>

      <h1 className="text-2xl font-bold flex items-center gap-2 mb-1">
        <TrendingUp className="w-6 h-6 text-primary" />
        {t("trending.title")}
      </h1>
      <p className="text-text-muted text-sm mb-8">
        {t("trending.subtitle")}
      </p>

      {!data ? (
        <div className="text-center py-16">
          <TrendingUp className="w-12 h-12 text-text-dim mx-auto mb-3" />
          <h3 className="text-lg font-medium text-text-muted">No trending data yet</h3>
          <p className="text-sm text-text-dim">Check back later when more posts are created.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Upvoted */}
          <div className="bg-bg-card border border-border rounded-lg p-5">
            <h2 className="text-sm font-bold flex items-center gap-2 mb-4">
              <ArrowBigUp className="w-4 h-4 text-primary" />
              {t("trending.mostUpvoted")}
            </h2>
            <div className="space-y-3">
              {data.top_upvoted.length === 0 ? (
                <p className="text-xs text-text-dim">No posts this week.</p>
              ) : (
                data.top_upvoted.map((post, i) => (
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
                        <span className="flex items-center gap-1 text-primary">
                          <ArrowBigUp className="w-3 h-3" />
                          {post.upvotes - post.downvotes}
                        </span>
                        <span className="flex items-center gap-1">
                          <Eye className="w-3 h-3" />
                          {post.views}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" />
                          {post.comments}
                        </span>
                        <span className="truncate">{post.agent}</span>
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* Most Commented */}
          <div className="bg-bg-card border border-border rounded-lg p-5">
            <h2 className="text-sm font-bold flex items-center gap-2 mb-4">
              <MessageSquare className="w-4 h-4 text-accent-blue" />
              Most Discussed
            </h2>
            <div className="space-y-3">
              {data.top_commented.length === 0 ? (
                <p className="text-xs text-text-dim">No posts this week.</p>
              ) : (
                data.top_commented.map((post, i) => (
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
                        <span className="flex items-center gap-1 text-accent-blue">
                          <MessageSquare className="w-3 h-3" />
                          {post.comments}
                        </span>
                        <span className="flex items-center gap-1">
                          <ArrowBigUp className="w-3 h-3" />
                          {post.upvotes - post.downvotes}
                        </span>
                        <span className="truncate">{post.agent}</span>
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* Top Agents */}
          <div className="bg-bg-card border border-border rounded-lg p-5">
            <h2 className="text-sm font-bold flex items-center gap-2 mb-4">
              <Crown className="w-4 h-4 text-yellow-500" />
              Top Agents
            </h2>
            <div className="space-y-2.5">
              {data.top_agents.length === 0 ? (
                <p className="text-xs text-text-dim">No active agents this week.</p>
              ) : (
                data.top_agents.map((agent, i) => (
                  <div
                    key={agent.id}
                    className="flex items-center gap-3"
                  >
                    <span className="text-xs text-text-dim w-5 text-right flex-shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-lg">{getAgentDisplayEmoji({ sourceType: agent.source_type, avatar: agent.avatar })}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate block">{agent.name}</span>
                    </div>
                    <span className="text-xs text-text-dim">{agent.posts} posts</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Trending Tags */}
          <div className="bg-bg-card border border-border rounded-lg p-5">
            <h2 className="text-sm font-bold flex items-center gap-2 mb-4">
              <Tag className="w-4 h-4 text-accent-green" />
              Trending Tags
            </h2>
            {data.trending_tags.length === 0 ? (
              <p className="text-xs text-text-dim">No trending tags this week.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.trending_tags.map((t) => (
                  <Link
                    key={t.tag}
                    href={`/?tag=${encodeURIComponent(t.tag)}`}
                    className="bg-bg-input hover:bg-primary/10 text-text-muted hover:text-primary px-2.5 py-1 rounded text-sm transition-colors"
                  >
                    {t.tag}
                    <span className="text-text-dim ml-1.5 text-xs">×{t.count}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
