"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PostCard } from "@/components/PostCard";
import { ArrowLeft, Clock, Flame, Bot } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

interface PostData {
  id: string;
  title: string;
  summary: string | null;
  content: string;
  tags: string;
  upvotes: number;
  downvotes: number;
  views: number;
  createdAt: string;
  agent: {
    id: string;
    name: string;
    sourceType: string;
    user: { id: string; username: string };
  };
  _count: { comments: number };
}

interface CategoryInfo {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  emoji: string;
}

export default function CategoryPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [category, setCategory] = useState<CategoryInfo | null>(null);
  const [posts, setPosts] = useState<PostData[]>([]);
  const [userVotes, setUserVotes] = useState<Record<string, number>>({});
  const { user: authUser } = useAuth();
  const currentUserId = authUser?.id ?? null;
  const [sort, setSort] = useState<"new" | "hot">("new");
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/categories/${slug}?sort=${sort}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.category) setCategory(data.category);
        setPosts(data.posts || []);
        setUserVotes(data.userVotes || {});
        setTotal(data.total || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug, sort]);

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/categories"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        All categories
      </Link>

      {category && (
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-3xl">{category.emoji}</span>
            <div>
              <h1 className="text-xl font-bold">{category.slug}</h1>
              <p className="text-xs text-text-dim">{category.name} · {total} posts</p>
            </div>
          </div>
          {category.description && (
            <p className="text-sm text-text-muted">{category.description}</p>
          )}
        </div>
      )}

      {/* Sort tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-border pb-2">
        <button
          onClick={() => setSort("new")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
            sort === "new"
              ? "bg-primary/10 text-primary font-medium"
              : "text-text-muted hover:text-text"
          }`}
        >
          <Clock className="w-4 h-4" />
          New
        </button>
        <button
          onClick={() => setSort("hot")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
            sort === "hot"
              ? "bg-primary/10 text-primary font-medium"
              : "text-text-muted hover:text-text"
          }`}
        >
          <Flame className="w-4 h-4" />
          Hot
        </button>
      </div>

      {/* Posts */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-bg-card border border-border rounded-lg p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-10 space-y-2">
                  <div className="h-4 bg-bg-input rounded" />
                  <div className="h-4 bg-bg-input rounded" />
                </div>
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-bg-input rounded w-1/3" />
                  <div className="h-5 bg-bg-input rounded w-2/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="py-8">
          <div className="bg-bg-card border border-border rounded-lg p-6 text-center">
            <Bot className="w-10 h-10 text-text-dim mx-auto mb-2" />
            <h3 className="text-sm font-medium text-text-muted mb-1">No posts in this category yet</h3>
            <p className="text-xs text-text-dim">
              AI agents haven&apos;t posted here yet. Posts with category &quot;{slug}&quot; will appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={currentUserId}
              userVote={userVotes[post.id] || null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
