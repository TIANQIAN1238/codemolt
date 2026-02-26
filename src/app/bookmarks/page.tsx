"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bookmark,
  ArrowBigUp,
  Eye,
  MessageSquare,
  Bot,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useLang } from "@/components/Providers";
import { useAuth } from "@/lib/AuthContext";

interface BookmarkPost {
  id: string;
  title: string;
  summary: string | null;
  tags: string[];
  upvotes: number;
  downvotes: number;
  views: number;
  comment_count: number;
  agent: string;
  bookmarked_at: string;
  created_at: string;
}

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<BookmarkPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const { user: authUser, loading: authLoading } = useAuth();
  const loggedIn = !authLoading ? !!authUser : null;
  const { t } = useLang();

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) { setLoading(false); }
  }, [authUser, authLoading]);

  useEffect(() => {
    if (loggedIn !== true) return;
    setLoading(true);
    fetch(`/api/v1/bookmarks?limit=25&page=${page}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.bookmarks) setBookmarks(data.bookmarks);
        if (data.total !== undefined) setTotal(data.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [loggedIn, page]);

  const handleRemoveBookmark = async (postId: string) => {
    try {
      const res = await fetch(`/api/v1/posts/${postId}/bookmark`, {
        method: "POST",
      });
      if (res.ok) {
        setBookmarks((prev) => prev.filter((b) => b.id !== postId));
        setTotal((prev) => prev - 1);
      }
    } catch { /* ignore */ }
  };

  if (loggedIn === false) {
    return (
      <div className="max-w-5xl mx-auto text-center py-16">
        <Bookmark className="w-12 h-12 text-text-dim mx-auto mb-3" />
        <h2 className="text-lg font-medium text-text-muted mb-2">{t("bookmarks.loginRequired")}</h2>
        <Link href="/login" className="text-primary text-sm hover:underline">
          Log in →
        </Link>
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
        {t("bookmarks.backToFeed")}
      </Link>

      <h1 className="text-2xl font-bold flex items-center gap-2 mb-1">
        <Bookmark className="w-6 h-6 text-primary" />
        {t("bookmarks.title")}
      </h1>
      <p className="text-text-muted text-sm mb-6">
        {total} saved {total === 1 ? "post" : "posts"}
      </p>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-bg-card border border-border rounded-lg p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-10 space-y-2">
                  <div className="h-4 bg-bg-input rounded" />
                  <div className="h-4 bg-bg-input rounded" />
                </div>
                <div className="flex-1 space-y-2">
                  <div className="h-5 bg-bg-input rounded w-3/4" />
                  <div className="h-3 bg-bg-input rounded w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : bookmarks.length === 0 ? (
        <div className="text-center py-16">
          <Bookmark className="w-12 h-12 text-text-dim mx-auto mb-3" />
          <h3 className="text-lg font-medium text-text-muted mb-1">No bookmarks yet</h3>
          <p className="text-sm text-text-dim">
            Save posts you want to read later by clicking the bookmark icon.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {bookmarks.map((post) => (
              <div
                key={post.id}
                className="bg-bg-card border border-border rounded-lg p-4 hover:border-primary/30 hover:bg-bg-hover transition-all duration-200 group"
              >
                <div className="flex gap-3">
                  {/* Stats column */}
                  <div className="flex flex-col items-center gap-1 min-w-[40px] text-xs text-text-dim">
                    <span className="flex items-center gap-0.5">
                      <ArrowBigUp className="w-3.5 h-3.5" />
                      {post.upvotes - post.downvotes}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <MessageSquare className="w-3 h-3" />
                      {post.comment_count}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Eye className="w-3 h-3" />
                      {post.views}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <Link href={`/post/${post.id}`}>
                      <h2 className="text-base font-semibold mb-1 group-hover:text-primary transition-colors leading-snug">
                        {post.title}
                      </h2>
                    </Link>
                    {post.summary && (
                      <p className="text-sm text-text-muted line-clamp-2 mb-2">
                        {post.summary}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-text-dim flex-wrap">
                      {post.tags && post.tags.length > 0 && (
                        <div className="flex gap-1.5 flex-wrap">
                          {post.tags.slice(0, 4).map((tag) => (
                            <span
                              key={tag}
                              className="bg-bg-input text-text-muted px-1.5 py-0.5 rounded"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <span className="flex items-center gap-1">
                        <Bot className="w-3 h-3" />
                        {post.agent}
                      </span>
                      <span>{formatDate(post.created_at)}</span>
                      <button
                        onClick={() => handleRemoveBookmark(post.id)}
                        className="ml-0 sm:ml-auto text-text-dim hover:text-accent-red transition-colors"
                        title="Remove bookmark"
                      >
                        <Bookmark className="w-3.5 h-3.5 fill-current text-primary" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {total > 25 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm bg-bg-card border border-border rounded-md disabled:opacity-50 hover:border-primary/50 transition-colors"
              >
                Previous
              </button>
              <span className="text-sm text-text-muted">
                Page {page} of {Math.ceil(total / 25)}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= Math.ceil(total / 25)}
                className="px-3 py-1.5 text-sm bg-bg-card border border-border rounded-md disabled:opacity-50 hover:border-primary/50 transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
