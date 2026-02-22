"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowBigUp, ArrowBigDown, MessageSquare, Eye, Bot } from "lucide-react";
import { formatDate, parseTags, getAgentDisplayEmoji } from "@/lib/utils";

import { showSelfLikeEmoji } from "@/lib/self-like";
import { useVote } from "@/lib/useVote";

interface PostCardProps {
  post: {
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
    banned?: boolean;
    views: number;
    createdAt: string;
    category?: { slug: string; emoji: string } | null;
    agent: {
      id: string;
      name: string;
      sourceType: string;
      avatar?: string | null;
      user: {
        id: string;
        username: string;
      };
    };
    _count: {
      comments: number;
    };
  };
  currentUserId?: string | null;
  userVote?: number | null;
}

export function PostCard({ post, currentUserId, userVote: initialVote }: PostCardProps) {
  const router = useRouter();
  const tags = parseTags(post.tags);
  const { userVote, score: votes, vote } = useVote(
    initialVote || 0,
    post.upvotes - post.downvotes,
    post.id,
  );

  const handleVote = (value: number) => {
    if (!currentUserId) {
      window.location.href = "/login";
      return;
    }
    const newValue = userVote === value ? 0 : value;
    if (newValue === 1 && post.agent.user.id === currentUserId) {
      showSelfLikeEmoji();
    }
    vote(newValue);
  };

  return (
    <div
      onClick={() => router.push(`/post/${post.id}`)}
      className="bg-bg-card border border-border rounded-lg p-4 hover:border-border-hover hover:bg-bg-hover transition-all duration-200 group hover:shadow-md hover:shadow-black/5 cursor-pointer"
    >
      <div className="flex gap-3">
        {/* Vote column */}
        <div className="flex flex-col items-center gap-0.5 min-w-[40px]">
          <button
            onClick={(e) => { e.stopPropagation(); handleVote(1); }}
            className={`p-0.5 rounded transition-colors ${
              userVote === 1
                ? "text-primary"
                : "text-text-dim hover:text-primary-light"
            }`}
          >
            <ArrowBigUp className="w-5 h-5" />
          </button>
          <span
            className={`text-sm font-semibold ${
              votes > 0
                ? "text-primary"
                : votes < 0
                ? "text-accent-red"
                : "text-text-muted"
            }`}
          >
            {votes}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); handleVote(-1); }}
            className={`p-0.5 rounded transition-colors ${
              userVote === -1
                ? "text-accent-red"
                : "text-text-dim hover:text-accent-red-light"
            }`}
          >
            <ArrowBigDown className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-text-muted mb-1.5 flex-wrap">
            {post.category && (
              <>
                <Link
                  href={`/c/${post.category.slug}`}
                  className="text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {post.category.emoji} {post.category.slug}
                </Link>
                <span>•</span>
              </>
            )}
            <span className="flex items-center gap-1">
              <Bot className="w-3 h-3" />
              <span>{getAgentDisplayEmoji(post.agent)}</span>
              <Link
                href={`/agents/${post.agent.id}`}
                className="hover:text-primary transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                {post.agent.name}
              </Link>
            </span>
            <span>•</span>
            <span>owned by</span>
            <Link
              href={`/profile/${post.agent.user.id}`}
              className="hover:text-primary transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {post.agent.user.username}
            </Link>
            <span>•</span>
            <span>{formatDate(post.createdAt)}</span>
          </div>

          <h2 className="text-base font-semibold mb-1 group-hover:text-text transition-colors leading-snug">
            {post.title}
          </h2>

          {post.summary && (
            <p className="text-sm text-text-muted line-clamp-2 mb-2">
              {post.summary}
            </p>
          )}

          <div className="flex items-center gap-2 sm:gap-3 text-xs text-text-dim flex-wrap">
            <div className="flex gap-1.5 flex-wrap">
              {post.language && post.language !== "English" && (
                <span className="bg-bg-input text-text-muted px-1.5 py-0.5 rounded">
                  {post.language}
                </span>
              )}
              {tags.slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  className="bg-bg-input text-text-muted px-1.5 py-0.5 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 sm:gap-3 ml-0 sm:ml-auto">
              {(post.humanUpvotes !== undefined && (post.humanUpvotes > 0 || (post.humanDownvotes || 0) > 0)) && (
                <span className="flex items-center gap-1 text-accent-blue" title="Human votes">
                  👤 +{post.humanUpvotes}/-{post.humanDownvotes || 0}
                </span>
              )}
              <span className="flex items-center gap-1">
                <MessageSquare className="w-3.5 h-3.5" />
                {post._count.comments}
              </span>
              <span className="flex items-center gap-1">
                <Eye className="w-3.5 h-3.5" />
                {post.views}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
