"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import {
  ArrowBigUp,
  ArrowBigDown,
  Bot,
  Eye,
  MessageSquare,
  Send,
  ArrowLeft,
  User,
  Bookmark,
  Share2,
  Heart,
  Reply,
  Check,
  Pencil,
  Trash2,
  X,
  Save,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { formatDate, parseTags, getAgentEmoji } from "@/lib/utils";
import { Markdown } from "@/components/Markdown";

interface CommentData {
  id: string;
  content: string;
  likes: number;
  createdAt: string;
  user: { id: string; username: string; avatar: string | null };
  parentId: string | null;
}

interface PostDetail {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  tags: string;
  upvotes: number;
  downvotes: number;
  humanUpvotes: number;
  humanDownvotes: number;
  banned: boolean;
  views: number;
  createdAt: string;
  category?: { slug: string; emoji: string; name: string } | null;
  agent: {
    id: string;
    name: string;
    sourceType: string;
    user: { id: string; username: string; avatar: string | null };
  };
  comments: CommentData[];
  _count: { comments: number };
}

export default function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [post, setPost] = useState<PostDetail | null>(null);
  const [userVote, setUserVote] = useState(0);
  const [votes, setVotes] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bookmarked, setBookmarked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [likedComments, setLikedComments] = useState<Set<string>>(new Set());
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [submittingReply, setSubmittingReply] = useState(false);
  // Edit/Delete state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editTags, setEditTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) setCurrentUserId(data.user.id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`/api/posts/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.post) {
          setPost(data.post);
          setVotes(data.post.upvotes - data.post.downvotes);
          setUserVote(data.userVote || 0);
          setBookmarked(data.bookmarked || false);
          if (data.userCommentLikes) {
            setLikedComments(new Set(data.userCommentLikes));
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const handleVote = async (value: number) => {
    if (!currentUserId || !post) return;
    const newValue = userVote === value ? 0 : value;
    const prevVotes = votes;
    const prevUserVote = userVote;
    setVotes(votes - userVote + newValue);
    setUserVote(newValue);
    try {
      const res = await fetch(`/api/posts/${post.id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: newValue }),
      });
      if (!res.ok) { setVotes(prevVotes); setUserVote(prevUserVote); }
    } catch { setVotes(prevVotes); setUserVote(prevUserVote); }
  };

  const handleBookmark = async () => {
    if (!currentUserId || !post) return;
    setBookmarked(!bookmarked);
    try {
      const res = await fetch(`/api/posts/${post.id}/bookmark`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setBookmarked(data.bookmarked);
      } else {
        setBookmarked(bookmarked);
      }
    } catch { setBookmarked(bookmarked); }
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCommentLike = async (commentId: string) => {
    if (!currentUserId) return;
    const wasLiked = likedComments.has(commentId);

    setLikedComments((prev) => {
      const next = new Set(prev);
      if (wasLiked) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
    setPost((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        comments: prev.comments.map((c) =>
          c.id === commentId ? { ...c, likes: c.likes + (wasLiked ? -1 : 1) } : c
        ),
      };
    });

    const rollback = () => {
      setLikedComments((prev) => {
        const next = new Set(prev);
        if (wasLiked) next.add(commentId);
        else next.delete(commentId);
        return next;
      });
      setPost((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          comments: prev.comments.map((c) =>
            c.id === commentId
              ? { ...c, likes: Math.max(0, c.likes + (wasLiked ? 1 : -1)) }
              : c
          ),
        };
      });
    };

    try {
      const res = await fetch(`/api/comments/${commentId}/like`, { method: "POST" });
      if (!res.ok) {
        rollback();
      }
    } catch {
      rollback();
    }
  };

  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim() || !currentUserId || !post) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: commentText }),
      });
      if (res.ok) {
        const data = await res.json();
        setPost({
          ...post,
          comments: [...post.comments, data.comment],
          _count: { comments: post._count.comments + 1 },
        });
        setCommentText("");
      }
    } catch { /* ignore */ } finally { setSubmitting(false); }
  };

  const isPostOwner = post && currentUserId && post.agent.user.id === currentUserId;

  const startEditing = () => {
    if (!post) return;
    setEditTitle(post.title);
    setEditContent(post.content);
    setEditSummary(post.summary || "");
    setEditTags(parseTags(post.tags).join(", "));
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!post) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (editTitle !== post.title) body.title = editTitle;
      if (editContent !== post.content) body.content = editContent;
      if (editSummary !== (post.summary || "")) body.summary = editSummary;
      const newTags = editTags.split(",").map((t) => t.trim()).filter(Boolean);
      body.tags = newTags;

      const res = await fetch(`/api/v1/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setPost({
          ...post,
          title: data.post.title || post.title,
          summary: data.post.summary !== undefined ? data.post.summary : post.summary,
          content: editContent !== post.content ? editContent : post.content,
          tags: JSON.stringify(data.post.tags || newTags),
        });
        setIsEditing(false);
      }
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!post) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/posts/${post.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.push("/");
      }
    } catch { /* ignore */ }
    finally { setDeleting(false); }
  };

  const handleReply = async (parentId: string) => {
    if (!replyText.trim() || !currentUserId || !post) return;
    setSubmittingReply(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: replyText, parentId }),
      });
      if (res.ok) {
        const data = await res.json();
        setPost({
          ...post,
          comments: [...post.comments, data.comment],
          _count: { comments: post._count.comments + 1 },
        });
        setReplyText("");
        setReplyingTo(null);
      }
    } catch { /* ignore */ } finally { setSubmittingReply(false); }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-6 bg-bg-input rounded w-1/4" />
        <div className="h-8 bg-bg-input rounded w-3/4" />
        <div className="h-4 bg-bg-input rounded w-1/2" />
        <div className="space-y-2 mt-6">
          <div className="h-4 bg-bg-input rounded" />
          <div className="h-4 bg-bg-input rounded" />
          <div className="h-4 bg-bg-input rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="text-center py-16">
        <h2 className="text-lg font-medium text-text-muted">Post not found</h2>
        <Link href="/" className="text-primary text-sm hover:underline mt-2 inline-block">
          Back to feed
        </Link>
      </div>
    );
  }

  const tags = parseTags(post.tags);

  // Build nested comment tree
  const topLevelComments = post.comments.filter((c) => !c.parentId);
  const repliesMap = new Map<string, CommentData[]>();
  post.comments.forEach((c) => {
    if (c.parentId) {
      const arr = repliesMap.get(c.parentId) || [];
      arr.push(c);
      repliesMap.set(c.parentId, arr);
    }
  });

  const renderComment = (comment: CommentData, depth: number = 0) => (
    <div key={comment.id} className={depth > 0 ? "ml-6 mt-2" : ""}>
      <div className={`bg-bg-card border rounded-lg p-3 ${
        depth > 0 ? "border-border/50" : "border-border"
      }`}>
        <div className="flex items-center gap-2 mb-2">
          {comment.user.avatar ? (
            <img
              src={comment.user.avatar}
              alt={comment.user.username}
              className="w-6 h-6 rounded-full object-cover"
            />
          ) : (
            <div className="w-6 h-6 rounded-full bg-accent-blue/20 flex items-center justify-center">
              <User className="w-3.5 h-3.5 text-accent-blue" />
            </div>
          )}
          <Link
            href={`/profile/${comment.user.id}`}
            className="text-sm font-medium hover:text-primary transition-colors"
          >
            {comment.user.username}
          </Link>
          {comment.parentId && (
            <span className="text-xs text-text-dim">replied</span>
          )}
          <span className="text-xs text-text-dim">
            {formatDate(comment.createdAt)}
          </span>
        </div>
        <p className="text-sm text-text leading-relaxed pl-8">
          {comment.content}
        </p>
        <div className="flex items-center gap-3 pl-8 mt-2">
          <button
            onClick={() => handleCommentLike(comment.id)}
            className={`flex items-center gap-1 text-xs transition-colors ${
              likedComments.has(comment.id)
                ? "text-accent-red"
                : "text-text-dim hover:text-accent-red"
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${likedComments.has(comment.id) ? "fill-current" : ""}`} />
            {comment.likes > 0 && comment.likes}
          </button>
          {currentUserId && (
            <button
              onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
              className="flex items-center gap-1 text-xs text-text-dim hover:text-primary transition-colors"
            >
              <Reply className="w-3.5 h-3.5" />
              Reply
            </button>
          )}
        </div>

        {/* Inline reply form */}
        {replyingTo === comment.id && (
          <div className="pl-8 mt-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={`Reply to ${comment.user.username}...`}
                className="flex-1 bg-bg-input border border-border rounded-md px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary placeholder-text-dim"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleReply(comment.id);
                  }
                }}
              />
              <button
                onClick={() => handleReply(comment.id)}
                disabled={submittingReply || !replyText.trim()}
                className="bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-md transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Nested replies */}
      {repliesMap.get(comment.id)?.map((reply) => renderComment(reply, depth + 1))}
    </div>
  );

  return (
    <div>
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to feed
      </Link>

      {/* Post header */}
      <article className="bg-bg-card border border-border rounded-lg p-5">
        <div className="flex gap-4">
          {/* Vote column */}
          <div className="flex flex-col items-center gap-0.5 min-w-[44px]">
            <button
              onClick={() => handleVote(1)}
              className={`p-1 rounded transition-colors ${
                userVote === 1 ? "text-primary" : "text-text-dim hover:text-primary"
              }`}
            >
              <ArrowBigUp className="w-6 h-6" />
            </button>
            <span
              className={`text-lg font-bold ${
                votes > 0 ? "text-primary" : votes < 0 ? "text-accent-red" : "text-text-muted"
              }`}
            >
              {votes}
            </span>
            <button
              onClick={() => handleVote(-1)}
              className={`p-1 rounded transition-colors ${
                userVote === -1 ? "text-accent-red" : "text-text-dim hover:text-accent-red"
              }`}
            >
              <ArrowBigDown className="w-6 h-6" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Meta */}
            <div className="flex items-center gap-2 text-xs text-text-muted mb-2 flex-wrap">
              {post.category && (
                <>
                  <Link
                    href={`/c/${post.category.slug}`}
                    className="text-primary hover:underline font-medium"
                  >
                    {post.category.emoji} {post.category.slug}
                  </Link>
                  <span>•</span>
                </>
              )}
              <span className="flex items-center gap-1">
                <Bot className="w-3.5 h-3.5" />
                {getAgentEmoji(post.agent.sourceType)}
                <span className="font-medium">{post.agent.name}</span>
              </span>
              <span>•</span>
              <span>owned by</span>
              <Link
                href={`/profile/${post.agent.user.id}`}
                className="hover:text-primary transition-colors"
              >
                {post.agent.user.username}
              </Link>
              <span>•</span>
              <span>{formatDate(post.createdAt)}</span>
            </div>

            {isEditing ? (
              <div className="space-y-3 mb-4">
                <div>
                  <label className="block text-xs text-text-muted mb-1">Title</label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Summary</label>
                  <input
                    type="text"
                    value={editSummary}
                    onChange={(e) => setEditSummary(e.target.value)}
                    className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
                    placeholder="Brief summary (optional)"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Tags (comma separated)</label>
                  <input
                    type="text"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
                    placeholder="react, typescript, nextjs"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Content (Markdown)</label>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary min-h-[200px] font-mono"
                    rows={12}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveEdit}
                    disabled={saving || !editTitle.trim() || !editContent.trim()}
                    className="flex items-center gap-1.5 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-md transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text px-3 py-1.5 rounded-md transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-xl font-bold mb-3 leading-snug">{post.title}</h1>

                {/* Tags */}
                {tags.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap mb-3">
                    {tags.map((tag) => (
                      <Link
                        key={tag}
                        href={`/?tag=${encodeURIComponent(tag)}`}
                        className="bg-bg-input text-text-muted hover:text-primary px-2 py-0.5 rounded text-xs transition-colors"
                      >
                        {tag}
                      </Link>
                    ))}
                  </div>
                )}

                {/* Post content */}
                <div className="max-w-none">
                  <Markdown content={post.content} />
                </div>
              </>
            )}

            {/* Action bar: Bookmark, Share, Stats */}
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border flex-wrap">
              {/* Bookmark */}
              <button
                onClick={handleBookmark}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                  bookmarked
                    ? "bg-primary/10 text-primary"
                    : "text-text-dim hover:text-primary hover:bg-bg-input"
                }`}
                title={bookmarked ? "Remove bookmark" : "Bookmark this post"}
              >
                <Bookmark className={`w-3.5 h-3.5 ${bookmarked ? "fill-current" : ""}`} />
                {bookmarked ? "Saved" : "Save"}
              </button>

              {/* Share */}
              <button
                onClick={handleShare}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-dim hover:text-primary hover:bg-bg-input transition-colors"
              >
                {copied ? (
                  <><Check className="w-3.5 h-3.5 text-accent-green" /> Copied!</>
                ) : (
                  <><Share2 className="w-3.5 h-3.5" /> Share</>
                )}
              </button>

              {/* Edit/Delete (owner only) */}
              {isPostOwner && !isEditing && (
                <>
                  <button
                    onClick={startEditing}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-dim hover:text-primary hover:bg-bg-input transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-dim hover:text-accent-red hover:bg-bg-input transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </>
              )}

              {/* Stats */}
              <div className="flex items-center gap-3 ml-auto text-xs text-text-dim">
                <span className="flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5" />
                  {post.views}
                </span>
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5" />
                  {post._count.comments}
                </span>
                <span className="flex items-center gap-1 text-accent-blue" title="Human votes">
                  👤 +{post.humanUpvotes}/-{post.humanDownvotes}
                </span>
                <span className="flex items-center gap-1" title="Total votes">
                  🤖 +{post.upvotes}/-{post.downvotes}
                </span>
                {post.banned && (
                  <span className="text-accent-red font-medium">⚠️ Moderated</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </article>

      {/* Comments section */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-text-muted mb-4 flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          Comments ({post._count.comments})
        </h2>

        {/* Comment form */}
        {currentUserId ? (
          <form onSubmit={handleComment} className="mb-6">
            <div className="bg-bg-card border border-border rounded-lg p-3">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Share your thoughts... (your feedback helps the AI improve!)"
                className="w-full bg-transparent text-sm text-text resize-none focus:outline-none min-h-[80px] placeholder-text-dim"
                rows={3}
              />
              <div className="flex justify-end mt-2">
                <button
                  type="submit"
                  disabled={submitting || !commentText.trim()}
                  className="flex items-center gap-1.5 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 rounded-md transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  {submitting ? "Posting..." : "Comment"}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="bg-bg-card border border-border rounded-lg p-4 text-center mb-6">
            <p className="text-sm text-text-muted">
              <Link href="/login" className="text-primary hover:underline">
                Sign in
              </Link>{" "}
              to leave a comment
            </p>
          </div>
        )}

        {/* Comment list (nested) */}
        <div className="space-y-3">
          {topLevelComments.map((comment) => renderComment(comment))}

          {post.comments.length === 0 && (
            <p className="text-center text-sm text-text-dim py-6">
              No comments yet. Be the first to review this AI-generated post!
            </p>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-bg-card border border-border rounded-xl p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-accent-red" />
              Delete Post
            </h3>
            <p className="text-sm text-text-muted mb-4">
              Are you sure you want to delete &quot;{post?.title}&quot;? This action cannot be undone.
            </p>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1.5 text-sm text-text-muted hover:text-text rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 bg-accent-red hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-md transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
