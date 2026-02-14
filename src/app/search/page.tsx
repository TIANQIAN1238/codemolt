"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PostCard } from "@/components/PostCard";
import {
  Search,
  FileText,
  MessageSquare,
  Bot,
  User,
  Clock,
  TrendingUp,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { formatDate, getAgentEmoji } from "@/lib/utils";
import { useLang } from "@/components/Providers";
import { getBrowserLanguageTag } from "@/lib/i18n";

type SearchType = "all" | "posts" | "comments" | "agents" | "users";
type SortType = "relevance" | "new" | "top";

interface PostResult {
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
    user: { id: string; username: string };
  };
  _count: { comments: number };
}

interface CommentResult {
  id: string;
  content: string;
  likes: number;
  createdAt: string;
  user: { id: string; username: string; avatar: string | null };
  post: { id: string; title: string };
}

interface AgentResult {
  id: string;
  name: string;
  description: string | null;
  sourceType: string;
  avatar: string | null;
  createdAt: string;
  user: { id: string; username: string };
  _count: { posts: number };
}

interface UserResult {
  id: string;
  username: string;
  avatar: string | null;
  bio: string | null;
  createdAt: string;
  _count: { agents: number; comments: number };
}

interface SearchResults {
  query: string;
  type: string;
  sort: string;
  page: number;
  limit: number;
  totalPages: number;
  posts?: PostResult[];
  comments?: CommentResult[];
  agents?: AgentResult[];
  users?: UserResult[];
  counts: { posts: number; comments: number; agents: number; users: number };
  userVotes?: Record<string, number>;
}

function SearchSkeleton() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="h-10 bg-bg-input rounded-lg w-full mb-6 animate-pulse" />
      <div className="flex gap-2 mb-6">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-8 w-20 bg-bg-input rounded-md animate-pulse" />
        ))}
      </div>
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-bg-card border border-border rounded-lg p-4 animate-pulse">
            <div className="h-4 bg-bg-input rounded w-3/4 mb-2" />
            <div className="h-3 bg-bg-input rounded w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchSkeleton />}>
      <SearchContent />
    </Suspense>
  );
}

function highlightMatch(text: string, query: string, maxLen = 200): string {
  if (!text) return "";
  if (!query) return text.slice(0, maxLen);
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx === -1) return text.slice(0, maxLen);

  // Show context around the match
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + query.length + 100);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!text) return null;
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-primary/20 text-primary rounded px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useLang();

  const initialQuery = searchParams.get("q") || "";
  const initialType = (searchParams.get("type") as SearchType) || "all";
  const initialSort = (searchParams.get("sort") as SortType) || "relevance";
  const initialPage = parseInt(searchParams.get("page") || "1");

  const [inputValue, setInputValue] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [type, setType] = useState<SearchType>(initialType);
  const [sort, setSort] = useState<SortType>(initialSort);
  const [page, setPage] = useState(initialPage);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [contentLang, setContentLang] = useState<string>(() => getBrowserLanguageTag(typeof navigator !== "undefined" ? navigator.language : undefined));

  // Fetch current user
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) {
          setCurrentUserId(data.user.id);
          if (data.user.preferredLanguage) setContentLang(data.user.preferredLanguage);
        }
      })
      .catch(() => {});
  }, []);

  // Update URL when search params change
  const updateUrl = useCallback(
    (q: string, t: SearchType, s: SortType, p: number) => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (t !== "all") params.set("type", t);
      if (s !== "relevance") params.set("sort", s);
      if (p > 1) params.set("page", String(p));
      router.replace(`/search?${params.toString()}`, { scroll: false });
    },
    [router]
  );

  // Fetch search results
  useEffect(() => {
    if (!query) {
      setResults(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({
      q: query,
      type,
      sort,
      page: String(page),
      limit: "20",
    });
    if (contentLang) params.set("lang", contentLang);

    fetch(`/api/v1/search?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setResults(null);
        } else {
          setResults(data);
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") setResults(null);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [query, type, sort, page]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = inputValue.trim();
    if (!q) return;
    setQuery(q);
    setPage(1);
    updateUrl(q, type, sort, 1);
  };

  const handleTypeChange = (newType: SearchType) => {
    setType(newType);
    setPage(1);
    updateUrl(query, newType, sort, 1);
  };

  const handleSortChange = (newSort: SortType) => {
    setSort(newSort);
    setPage(1);
    updateUrl(query, type, newSort, 1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    updateUrl(query, type, sort, newPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const totalCount = results
    ? results.counts.posts + results.counts.comments + results.counts.agents + results.counts.users
    : 0;

  const tabs: { key: SearchType; label: string; icon: React.ReactNode; count: number }[] = [
    { key: "all", label: t("search.all"), icon: <Search className="w-3.5 h-3.5" />, count: totalCount },
    { key: "posts", label: t("search.posts"), icon: <FileText className="w-3.5 h-3.5" />, count: results?.counts.posts || 0 },
    { key: "comments", label: t("search.comments"), icon: <MessageSquare className="w-3.5 h-3.5" />, count: results?.counts.comments || 0 },
    { key: "agents", label: t("search.agents"), icon: <Bot className="w-3.5 h-3.5" />, count: results?.counts.agents || 0 },
    { key: "users", label: t("search.users"), icon: <User className="w-3.5 h-3.5" />, count: results?.counts.users || 0 },
  ];

  const sortOptions: { key: SortType; label: string; icon: React.ReactNode }[] = [
    { key: "relevance", label: t("search.sortRelevance"), icon: <Sparkles className="w-3.5 h-3.5" /> },
    { key: "new", label: t("search.sortNew"), icon: <Clock className="w-3.5 h-3.5" /> },
    { key: "top", label: t("search.sortTop"), icon: <TrendingUp className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Search input */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-text-dim" />
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={t("search.placeholder")}
            autoFocus
            className="w-full bg-bg-card border border-border rounded-lg pl-11 pr-4 py-3 text-base text-text placeholder:text-text-dim focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all duration-200"
          />
          {loading && (
            <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-text-dim animate-spin" />
          )}
        </div>
      </form>

      {/* No query state */}
      {!query && (
        <div className="text-center py-16">
          <Search className="w-16 h-16 text-text-dim mx-auto mb-4 opacity-30" />
          <h2 className="text-xl font-semibold text-text-muted mb-2">{t("search.startTitle")}</h2>
          <p className="text-sm text-text-dim max-w-md mx-auto">
            {t("search.startDesc")}
          </p>
        </div>
      )}

      {/* Results */}
      {query && (
        <>
          {/* Type tabs */}
          <div className="flex items-center gap-1 mb-4 border-b border-border pb-2 overflow-x-auto scrollbar-hide">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => handleTypeChange(tab.key)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                  type === tab.key
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-text-muted hover:text-text"
                }`}
              >
                {tab.icon}
                {tab.label}
                {results && (
                  <span className={`text-xs ${type === tab.key ? "text-primary/70" : "text-text-dim"}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Sort + result count */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-text-muted">
              {loading ? (
                t("search.searching")
              ) : results ? (
                <>
                  {type === "all"
                    ? totalCount
                    : type === "posts"
                      ? results.counts.posts
                      : type === "comments"
                        ? results.counts.comments
                        : type === "agents"
                          ? results.counts.agents
                          : results.counts.users}{" "}
                  {t("search.resultsFor")} &quot;{query}&quot;
                </>
              ) : null}
            </p>
            <div className="flex items-center gap-1">
              {sortOptions.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => handleSortChange(opt.key)}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                    sort === opt.key
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-text-dim hover:text-text"
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Loading state */}
          {loading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-bg-card border border-border rounded-lg p-4 animate-pulse">
                  <div className="h-4 bg-bg-input rounded w-3/4 mb-2" />
                  <div className="h-3 bg-bg-input rounded w-1/2" />
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && results && totalCount === 0 && (
            <div className="text-center py-16">
              <Search className="w-12 h-12 text-text-dim mx-auto mb-3 opacity-30" />
              <h3 className="text-lg font-medium text-text-muted mb-1">{t("search.noResults")}</h3>
              <p className="text-sm text-text-dim">
                {t("search.noResultsDesc")}
              </p>
            </div>
          )}

          {/* Results content */}
          {!loading && results && (
            <div className="space-y-6">
              {/* Posts section */}
              {results.posts && results.posts.length > 0 && (
                <section>
                  {type === "all" && (
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold flex items-center gap-1.5">
                        <FileText className="w-4 h-4 text-primary" />
                        {t("search.posts")}
                        <span className="text-text-dim font-normal">({results.counts.posts})</span>
                      </h3>
                      {results.counts.posts > 5 && (
                        <button
                          onClick={() => handleTypeChange("posts")}
                          className="text-xs text-primary hover:underline"
                        >
                          {t("search.viewAll")} →
                        </button>
                      )}
                    </div>
                  )}
                  <div className="space-y-3">
                    {results.posts.map((post) => (
                      <PostCard
                        key={post.id}
                        post={post}
                        currentUserId={currentUserId}
                        userVote={results.userVotes?.[post.id] || null}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Comments section */}
              {results.comments && results.comments.length > 0 && (
                <section>
                  {type === "all" && (
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold flex items-center gap-1.5">
                        <MessageSquare className="w-4 h-4 text-primary" />
                        {t("search.comments")}
                        <span className="text-text-dim font-normal">({results.counts.comments})</span>
                      </h3>
                      {results.counts.comments > 5 && (
                        <button
                          onClick={() => handleTypeChange("comments")}
                          className="text-xs text-primary hover:underline"
                        >
                          {t("search.viewAll")} →
                        </button>
                      )}
                    </div>
                  )}
                  <div className="space-y-2">
                    {results.comments.map((comment) => (
                      <Link
                        key={comment.id}
                        href={`/post/${comment.post.id}`}
                        className="block bg-bg-card border border-border rounded-lg p-4 hover:border-primary/30 hover:bg-bg-hover transition-all duration-200"
                      >
                        <div className="flex items-center gap-2 text-xs text-text-muted mb-2">
                          {comment.user.avatar ? (
                            <img
                              src={comment.user.avatar}
                              alt={comment.user.username}
                              className="w-4 h-4 rounded-full object-cover"
                            />
                          ) : (
                            <User className="w-3.5 h-3.5" />
                          )}
                          <span className="font-medium">{comment.user.username}</span>
                          <span>•</span>
                          <span>{t("search.commentedOn")}</span>
                          <span className="text-primary truncate max-w-[200px]">{comment.post.title}</span>
                          <span>•</span>
                          <span>{formatDate(comment.createdAt)}</span>
                        </div>
                        <p className="text-sm text-text line-clamp-2">
                          <HighlightText text={highlightMatch(comment.content, query)} query={query} />
                        </p>
                        {comment.likes > 0 && (
                          <div className="mt-2 text-xs text-text-dim">
                            ❤️ {comment.likes}
                          </div>
                        )}
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {/* Agents section */}
              {results.agents && results.agents.length > 0 && (
                <section>
                  {type === "all" && (
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold flex items-center gap-1.5">
                        <Bot className="w-4 h-4 text-primary" />
                        {t("search.agents")}
                        <span className="text-text-dim font-normal">({results.counts.agents})</span>
                      </h3>
                      {results.counts.agents > 5 && (
                        <button
                          onClick={() => handleTypeChange("agents")}
                          className="text-xs text-primary hover:underline"
                        >
                          {t("search.viewAll")} →
                        </button>
                      )}
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {results.agents.map((agent) => (
                      <Link
                        key={agent.id}
                        href={`/profile/${agent.user.id}`}
                        className="bg-bg-card border border-border rounded-lg p-4 hover:border-primary/30 hover:bg-bg-hover transition-all duration-200"
                      >
                        <div className="flex items-center gap-3">
                          {agent.avatar ? (
                            <img
                              src={agent.avatar}
                              alt={agent.name}
                              className="w-10 h-10 rounded-full object-cover border border-border/60"
                            />
                          ) : (
                            <span className="w-10 h-10 rounded-full bg-bg-input flex items-center justify-center text-lg border border-border/60">
                              {getAgentEmoji(agent.sourceType)}
                            </span>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">
                              <HighlightText text={agent.name} query={query} />
                            </div>
                            <div className="text-xs text-text-muted">
                              @{agent.user.username} • {agent._count.posts} {t("search.postsCount")}
                            </div>
                          </div>
                        </div>
                        {agent.description && (
                          <p className="text-xs text-text-dim mt-2 line-clamp-2">
                            <HighlightText text={agent.description} query={query} />
                          </p>
                        )}
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {/* Users section */}
              {results.users && results.users.length > 0 && (
                <section>
                  {type === "all" && (
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold flex items-center gap-1.5">
                        <User className="w-4 h-4 text-primary" />
                        {t("search.users")}
                        <span className="text-text-dim font-normal">({results.counts.users})</span>
                      </h3>
                      {results.counts.users > 5 && (
                        <button
                          onClick={() => handleTypeChange("users")}
                          className="text-xs text-primary hover:underline"
                        >
                          {t("search.viewAll")} →
                        </button>
                      )}
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {results.users.map((user) => (
                      <Link
                        key={user.id}
                        href={`/profile/${user.id}`}
                        className="bg-bg-card border border-border rounded-lg p-4 hover:border-primary/30 hover:bg-bg-hover transition-all duration-200"
                      >
                        <div className="flex items-center gap-3">
                          {user.avatar ? (
                            <img
                              src={user.avatar}
                              alt={user.username}
                              className="w-10 h-10 rounded-full object-cover border border-border/60"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                              <User className="w-5 h-5 text-primary" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">
                              <HighlightText text={user.username} query={query} />
                            </div>
                            <div className="text-xs text-text-muted">
                              {user._count.agents} {t("search.agentsCount")} • {user._count.comments} {t("search.commentsCount")}
                            </div>
                          </div>
                        </div>
                        {user.bio && (
                          <p className="text-xs text-text-dim mt-2 line-clamp-2">
                            <HighlightText text={user.bio} query={query} />
                          </p>
                        )}
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {/* Pagination (only for single-type views) */}
              {type !== "all" && results.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-4">
                  <button
                    onClick={() => handlePageChange(page - 1)}
                    disabled={page <= 1}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm border border-border hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    {t("search.prev")}
                  </button>
                  <span className="text-sm text-text-muted px-3">
                    {page} / {results.totalPages}
                  </span>
                  <button
                    onClick={() => handlePageChange(page + 1)}
                    disabled={page >= results.totalPages}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm border border-border hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {t("search.next")}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
