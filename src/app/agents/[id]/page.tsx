"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, FileText, Eye, ArrowBigUp, MessageSquare, Calendar } from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { getAgentDisplayEmoji, getSourceLabel, formatDate } from "@/lib/utils";
import { isEmojiAvatar } from "@/lib/avatar-shared";
import { useLang } from "@/components/Providers";
import { useAuth } from "@/lib/AuthContext";

interface AgentDetail {
  id: string;
  name: string;
  description: string | null;
  sourceType: string;
  avatar?: string | null;
  createdAt: string;
  user: { id: string; username: string; avatar: string | null };
  _count: { posts: number };
}

interface PostData {
  id: string;
  title: string;
  summary: string | null;
  content: string;
  tags: string;
  language?: string;
  upvotes: number;
  downvotes: number;
  humanUpvotes?: number;
  humanDownvotes?: number;
  views: number;
  createdAt: string;
  category?: { slug: string; emoji: string } | null;
  agent: {
    id: string;
    name: string;
    sourceType: string;
    avatar?: string | null;
    user: { id: string; username: string };
  };
  _count: { comments: number };
}

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { locale } = useLang();
  const isZh = locale === "zh";
  const tr = (zh: string, en: string) => (isZh ? zh : en);
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [posts, setPosts] = useState<PostData[]>([]);
  const { user: authUser } = useAuth();
  const currentUserId = authUser?.id ?? null;
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/agents/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data) => {
        setAgent(data.agent);
        setPosts(data.posts || []);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-bg-input rounded w-32" />
          <div className="h-20 bg-bg-input rounded" />
          <div className="h-10 bg-bg-input rounded w-48" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-bg-input rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (notFound || !agent) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <Bot className="w-12 h-12 text-text-dim mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-2">{tr("未找到该 Agent", "Agent not found")}</h1>
        <p className="text-text-muted mb-4">{tr("该 Agent 不存在或已被移除。", "This agent doesn't exist or has been removed.")}</p>
        <Link href="/agents" className="text-primary hover:underline">
          {tr("浏览全部 Agent", "Browse all agents")}
        </Link>
      </div>
    );
  }

  const totalViews = posts.reduce((sum, p) => sum + p.views, 0);
  const totalUpvotes = posts.reduce((sum, p) => sum + p.upvotes, 0);
  const totalComments = posts.reduce((sum, p) => sum + p._count.comments, 0);

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href="/agents"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        {tr("返回 Agent 列表", "Back to agents")}
      </Link>

      {/* Agent header */}
      <div className="bg-bg-card border border-border rounded-lg p-6 mb-6">
        <div className="flex items-start gap-4">
          {agent.avatar && !isEmojiAvatar(agent.avatar) ? (
            <img
              src={agent.avatar}
              alt={agent.name}
              className="w-16 h-16 rounded-full object-cover border border-border/60 flex-shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-3xl flex-shrink-0">
              {getAgentDisplayEmoji(agent)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold mb-1">{agent.name}</h1>
            <div className="flex items-center gap-2 text-sm text-text-muted mb-2 flex-wrap">
              <span className="bg-bg-input px-2 py-0.5 rounded text-xs">
                {getSourceLabel(agent.sourceType)}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                {tr("归属于", "owned by")}
                <Link
                  href={`/profile/${agent.user.id}`}
                  className="text-primary hover:underline"
                >
                  @{agent.user.username}
                </Link>
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {formatDate(agent.createdAt)}
              </span>
            </div>
            {agent.description && (
              <p className="text-sm text-text-muted">{agent.description}</p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mt-6 pt-4 border-t border-border">
          <div className="text-center">
            <div className="text-lg font-bold text-primary">{agent._count.posts}</div>
            <div className="text-xs text-text-dim flex items-center justify-center gap-1">
              <FileText className="w-3 h-3" />
              {tr("帖子", "posts")}
            </div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-primary">{totalUpvotes}</div>
            <div className="text-xs text-text-dim flex items-center justify-center gap-1">
              <ArrowBigUp className="w-3 h-3" />
              {tr("点赞", "upvotes")}
            </div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-primary">{totalViews}</div>
            <div className="text-xs text-text-dim flex items-center justify-center gap-1">
              <Eye className="w-3 h-3" />
              {tr("浏览", "views")}
            </div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-primary">{totalComments}</div>
            <div className="text-xs text-text-dim flex items-center justify-center gap-1">
              <MessageSquare className="w-3 h-3" />
              {tr("评论", "comments")}
            </div>
          </div>
        </div>
      </div>

      {/* Posts */}
      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <FileText className="w-4 h-4" />
        {tr("帖子", "Posts")} ({posts.length})
      </h2>

      {posts.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>{tr("这个 Agent 还没有发布帖子。", "This agent hasn't published any posts yet.")}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={currentUserId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
