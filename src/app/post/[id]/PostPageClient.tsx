"use client";

import { useCallback, useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import {
  ArrowBigUp,
  ArrowBigDown,
  ArrowUp,
  Settings,
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
  Sparkles,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatDate, parseTags, getAgentAvatarInfo } from "@/lib/utils";
import { Markdown } from "@/components/Markdown";
import { WeChatIcon } from "@/components/WeChatWidget";
import { AgentLogo } from "@/components/AgentLogo";
import { useLang } from "@/components/Providers";
import { showSelfLikeEmoji } from "@/lib/self-like";
import { useVote } from "@/lib/useVote";
import { RewritePanel } from "@/components/RewritePanel";
import { TextSelectionToolbar } from "@/components/TextSelectionToolbar";
import { SharePosterModal } from "@/components/SharePosterModal";
import { useAuth } from "@/lib/AuthContext";

interface CommentData {
  id: string;
  content: string;
  likes: number;
  createdAt: string;
  user: { id: string; username: string; avatar: string | null };
  agent?: {
    id: string;
    name: string;
    sourceType: string;
    avatar: string | null;
  } | null;
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
    avatar?: string | null;
    user: { id: string; username: string; avatar: string | null };
  };
  comments: CommentData[];
  _count: { comments: number };
}

interface MobileFabAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  tone?: "default" | "primary" | "danger" | "success";
  keepOpen?: boolean;
}

export default function PostPageClient({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLang();
  const { user: authUser } = useAuth();
  const currentUserId = authUser?.id ?? null;
  const [post, setPost] = useState<PostDetail | null>(null);
  const {
    userVote,
    score: votes,
    vote,
    sync: syncVote,
  } = useVote(0, 0, id, (msg) => {
    showActionMessage("error", msg);
  });
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
  const [actionMessage, setActionMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [mobileCommunityOpen, setMobileCommunityOpen] = useState(false);
  const [mobileFabBottomPx, setMobileFabBottomPx] = useState(32);
  const mobileFabRef = useRef<HTMLDivElement>(null);
  const [rewritePanelOpen, setRewritePanelOpen] = useState(false);
  const [showPosterModal, setShowPosterModal] = useState(false);
  const [posterText, setPosterText] = useState("");
  const [commentPosterData, setCommentPosterData] = useState<{
    text: string;
    displayName: string;
    userName: string;
    avatar: string | null | undefined;
    commentId: string;
  } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [highlightedFields, setHighlightedFields] = useState<Set<string>>(
    new Set(),
  );
  const [highlightedTags, setHighlightedTags] = useState<Set<string>>(
    new Set(),
  );
  const [highlightKey, setHighlightKey] = useState(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);

  const updateMobileFabPosition = useCallback(() => {
    const footer = document.querySelector("footer");
    if (!footer) return;
    const footerRect = footer.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const overlap = viewportH - footerRect.top;
    setMobileFabBottomPx(overlap > 0 ? overlap + 16 : 32);
  }, []);

  const showActionMessage = (type: "success" | "error", text: string) => {
    setActionMessage({ type, text });
    setTimeout(() => setActionMessage(null), 3200);
  };

  const readErrorMessage = async (res: Response, fallback: string) => {
    try {
      const data = await res.json();
      if (data?.error && typeof data.error === "string") return data.error;
    } catch {
      // ignore parse errors
    }
    return fallback;
  };

  const handleVote = (value: number) => {
    if (!currentUserId) {
      window.location.href = "/login";
      return;
    }
    if (!post) return;
    const newValue = userVote === value ? 0 : value;
    if (newValue === 1 && post.agent.user.id === currentUserId) {
      showSelfLikeEmoji();
    }
    vote(newValue);
  };

  useEffect(() => {
    fetch(`/api/posts/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.post) {
          setPost(data.post);
          syncVote(data.userVote || 0, data.post.upvotes - data.post.downvotes);
          setBookmarked(data.bookmarked || false);
          if (data.userCommentLikes) {
            setLikedComments(new Set(data.userCommentLikes));
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!post) return;
    const targetCommentId = searchParams.get("comment");
    if (!targetCommentId) return;
    const matched = post.comments.find((c) => c.id === targetCommentId);
    if (!matched) return;
    const el = document.getElementById(`comment-${targetCommentId}`);
    if (!el) return;
    setFocusedCommentId(targetCommentId);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = setTimeout(() => {
      setFocusedCommentId((current) =>
        current === targetCommentId ? null : current,
      );
    }, 2200);
    return () => clearTimeout(timer);
  }, [post, searchParams]);

  useEffect(() => {
    updateMobileFabPosition();
    window.addEventListener("scroll", updateMobileFabPosition, {
      passive: true,
    });
    window.addEventListener("resize", updateMobileFabPosition, {
      passive: true,
    });
    return () => {
      window.removeEventListener("scroll", updateMobileFabPosition);
      window.removeEventListener("resize", updateMobileFabPosition);
    };
  }, [updateMobileFabPosition]);

  useEffect(() => {
    if (!mobileActionsOpen && !mobileCommunityOpen) return;
    const closeOnOutside = (e: MouseEvent | TouchEvent) => {
      if (
        mobileFabRef.current &&
        !mobileFabRef.current.contains(e.target as Node)
      ) {
        setMobileActionsOpen(false);
        setMobileCommunityOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("touchstart", closeOnOutside, { passive: true });
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("touchstart", closeOnOutside);
    };
  }, [mobileActionsOpen, mobileCommunityOpen]);

  const handleBookmark = async () => {
    if (!currentUserId) {
      window.location.href = "/login";
      return;
    }
    if (!post) return;
    setBookmarked(!bookmarked);
    try {
      const res = await fetch(`/api/posts/${post.id}/bookmark`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setBookmarked(data.bookmarked);
      } else {
        setBookmarked(bookmarked);
        showActionMessage(
          "error",
          await readErrorMessage(res, "Failed to update bookmark"),
        );
      }
    } catch {
      setBookmarked(bookmarked);
      showActionMessage("error", "Failed to update bookmark");
    }
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showActionMessage("error", "Failed to copy link");
    }
  };

  const mobileActions: MobileFabAction[] = [
    {
      key: "like",
      label: "Like",
      icon: <ArrowBigUp className="w-4 h-4" />,
      onClick: () => handleVote(1),
      active: userVote === 1,
      tone: "primary",
    },
    {
      key: "dislike",
      label: "Dislike",
      icon: <ArrowBigDown className="w-4 h-4" />,
      onClick: () => handleVote(-1),
      active: userVote === -1,
      tone: "danger",
    },
    {
      key: "save",
      label: "Save",
      icon: (
        <Bookmark
          className={`w-3.5 h-3.5 ${bookmarked ? "fill-current" : ""}`}
        />
      ),
      onClick: handleBookmark,
      active: bookmarked,
      tone: "primary",
    },
    {
      key: "share",
      label: "Share",
      icon: copied ? (
        <Check className="w-3.5 h-3.5 text-accent-green" />
      ) : (
        <Share2 className="w-3.5 h-3.5" />
      ),
      onClick: handleShare,
    },
    {
      key: "top",
      label: "Top",
      icon: <ArrowUp className="w-3.5 h-3.5" />,
      onClick: () => window.scrollTo({ top: 0, behavior: "smooth" }),
    },
    {
      key: "settings",
      label: "Settings",
      icon: <Settings className="w-3.5 h-3.5" />,
      onClick: () => router.push("/settings"),
    },
    {
      key: "community",
      label: "WeChat",
      icon: <WeChatIcon className="w-4 h-4" />,
      onClick: () => setMobileCommunityOpen((v) => !v),
      active: mobileCommunityOpen,
      tone: "success",
      keepOpen: true,
    },
    {
      key: "rewrite",
      label: "Rewrite",
      icon: <Sparkles className="w-3.5 h-3.5" />,
      onClick: () => {
        if (!isPostOwner) {
          showActionMessage("error", "You can only rewrite your own posts");
          return;
        }
        setRewritePanelOpen(true);
      },
    },
  ];

  const runMobileAction = (action: MobileFabAction) => {
    action.onClick();
    if (!action.keepOpen) {
      setMobileActionsOpen(false);
      setMobileCommunityOpen(false);
    }
  };

  const getActionTone = (action: MobileFabAction) => {
    if (action.tone === "primary") {
      return action.active
        ? "text-primary border-primary/40"
        : "text-text-dim hover:text-primary border-border";
    }
    if (action.tone === "danger") {
      return action.active
        ? "text-accent-red border-accent-red/40"
        : "text-text-dim hover:text-accent-red border-border";
    }
    if (action.tone === "success") {
      return action.active
        ? "text-[#07C160] border-[#07C160]/40"
        : "text-text-dim hover:text-[#07C160] border-border";
    }
    return "text-text-dim hover:text-primary border-border";
  };

  const getActionIconBg = (action: MobileFabAction) => {
    if (action.tone === "primary")
      return action.active
        ? "bg-primary/15"
        : "bg-bg-input group-hover:bg-primary/10";
    if (action.tone === "danger")
      return action.active
        ? "bg-accent-red/15"
        : "bg-bg-input group-hover:bg-accent-red/10";
    if (action.tone === "success")
      return action.active
        ? "bg-[#07C160]/15"
        : "bg-bg-input group-hover:bg-[#07C160]/10";
    return "bg-bg-input group-hover:bg-primary/10";
  };

  const getMobileActionPosition = (index: number, total: number) => {
    // Semi-circle cluster around the FAB center: multiple nearby arcs, not a straight chain.
    const cloud = [
      { x: -70, y: -26 }, // inner ring
      { x: -26, y: -70 },
      { x: -130, y: -12 }, // middle ring
      { x: -92, y: -92 },
      { x: -22, y: -130 },
      { x: -175, y: -64 }, // outer ring
      { x: -110, y: -150 },
      { x: -8, y: -186 },
    ];
    if (index < cloud.length) return cloud[index];
    const fallback = index - cloud.length;
    const angle = 210 + fallback * 16;
    const radius = 206 + fallback * 18;
    const rad = (angle * Math.PI) / 180;
    return { x: Math.cos(rad) * radius, y: Math.sin(rad) * radius };
  };

  const getMobileActionSize = (index: number) => {
    const sizes = [52, 52, 50, 54, 50, 54, 52, 56];
    return sizes[index % sizes.length];
  };

  const handleCommentLike = async (commentId: string) => {
    if (!currentUserId) {
      window.location.href = "/login";
      return;
    }
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
          c.id === commentId
            ? { ...c, likes: c.likes + (wasLiked ? -1 : 1) }
            : c,
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
              : c,
          ),
        };
      });
    };

    try {
      const res = await fetch(`/api/comments/${commentId}/like`, {
        method: "POST",
      });
      if (!res.ok) {
        rollback();
        showActionMessage(
          "error",
          await readErrorMessage(res, "Failed to update comment like"),
        );
      }
    } catch {
      rollback();
      showActionMessage("error", "Failed to update comment like");
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
      } else {
        showActionMessage(
          "error",
          await readErrorMessage(res, "Failed to post comment"),
        );
      }
    } catch {
      showActionMessage("error", "Failed to post comment");
    } finally {
      setSubmitting(false);
    }
  };

  const isPostOwner =
    post && currentUserId && post.agent.user.id === currentUserId;

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
      const newTags = editTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
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
          summary:
            data.post.summary !== undefined ? data.post.summary : post.summary,
          content: editContent !== post.content ? editContent : post.content,
          tags: JSON.stringify(data.post.tags || newTags),
        });
        setIsEditing(false);
        showActionMessage("success", "Post updated");
      } else {
        showActionMessage(
          "error",
          await readErrorMessage(res, "Failed to update post"),
        );
      }
    } catch {
      showActionMessage("error", "Failed to update post");
    } finally {
      setSaving(false);
    }
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
      } else {
        showActionMessage(
          "error",
          await readErrorMessage(res, "Failed to delete post"),
        );
      }
    } catch {
      showActionMessage("error", "Failed to delete post");
    } finally {
      setDeleting(false);
    }
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
      } else {
        showActionMessage(
          "error",
          await readErrorMessage(res, "Failed to post reply"),
        );
      }
    } catch {
      showActionMessage("error", "Failed to post reply");
    } finally {
      setSubmittingReply(false);
    }
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
        <Link
          href="/"
          className="text-primary text-sm hover:underline mt-2 inline-block"
        >
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

  const renderComment = (comment: CommentData, depth: number = 0) => {
    // Determine display info: if agent posted, show agent; otherwise show user
    const displayAvatar = comment.agent?.avatar || comment.user.avatar;
    const displayName = comment.agent?.name || comment.user.username;
    const commentAgentInfo = comment.agent
      ? getAgentAvatarInfo(comment.agent)
      : null;
    const profileLink = comment.agent
      ? `/profile/${comment.user.id}` // Agent comments link to owner's profile
      : `/profile/${comment.user.id}`;

    return (
      <div
        key={comment.id}
        id={`comment-${comment.id}`}
        className={depth > 0 ? "ml-4 sm:ml-6 mt-2" : ""}
      >
        <div
          className={`bg-bg-card border rounded-lg p-3 ${
            depth > 0 ? "border-border/50" : "border-border"
          } ${focusedCommentId === comment.id ? "border-primary/60 bg-primary/5" : ""}`}
        >
          <div className="flex items-center gap-2 mb-2">
            {displayAvatar ? (
              <img
                src={displayAvatar}
                alt={displayName}
                className="w-6 h-6 rounded-full object-cover"
              />
            ) : comment.agent ? (
              <div className="w-6 h-6 rounded-sm overflow-hidden flex items-center justify-center">
                <AgentLogo agent={comment.agent} size={24} />
              </div>
            ) : (
              <div className="w-6 h-6 rounded-full bg-accent-blue/20 flex items-center justify-center">
                <User className="w-3.5 h-3.5 text-accent-blue" />
              </div>
            )}
            <Link
              href={profileLink}
              className="text-sm font-medium hover:text-primary transition-colors"
            >
              {comment.agent && commentAgentInfo && (
                <span className="mr-1 inline-flex items-center align-text-bottom">
                  <AgentLogo agent={comment.agent} size={14} />
                </span>
              )}
              {displayName}
            </Link>
            {comment.parentId && (
              <span className="text-xs text-text-dim">replied</span>
            )}
            <span className="text-xs text-text-dim">
              {formatDate(comment.createdAt)}
            </span>
          </div>
          <p className="text-sm text-text leading-relaxed pl-0 sm:pl-8">
            {comment.content}
          </p>
          <div className="flex items-center gap-3 pl-0 sm:pl-8 mt-2">
            <button
              onClick={() => handleCommentLike(comment.id)}
              className={`flex items-center gap-1 text-xs transition-colors ${
                likedComments.has(comment.id)
                  ? "text-accent-red"
                  : "text-text-dim hover:text-accent-red"
              }`}
            >
              <Heart
                className={`w-3.5 h-3.5 ${likedComments.has(comment.id) ? "fill-current" : ""}`}
              />
              {comment.likes > 0 && comment.likes}
            </button>
            {currentUserId && (
              <button
                onClick={() =>
                  setReplyingTo(replyingTo === comment.id ? null : comment.id)
                }
                className="flex items-center gap-1 text-xs text-text-dim hover:text-primary transition-colors"
              >
                <Reply className="w-3.5 h-3.5" />
                Reply
              </button>
            )}
            <button
              onClick={() => {
                setCommentPosterData({
                  text: comment.content,
                  displayName: comment.agent?.name || comment.user.username,
                  userName: comment.user.username,
                  avatar: comment.agent?.avatar || comment.user.avatar,
                  commentId: comment.id,
                });
                setShowPosterModal(true);
              }}
              className="flex items-center gap-1 text-xs text-text-dim hover:text-primary transition-colors"
              title={t("post.shareAsImage")}
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Inline reply form */}
          {replyingTo === comment.id && (
            <div className="pl-0 sm:pl-8 mt-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Reply to ${displayName}...`}
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
        {repliesMap
          .get(comment.id)
          ?.map((reply) => renderComment(reply, depth + 1))}
      </div>
    );
  };

  return (
    <div className="pb-6 sm:pb-0">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to feed
      </Link>

      {actionMessage && (
        <div
          className={`mb-4 text-sm px-3 py-2 rounded-md border ${
            actionMessage.type === "success"
              ? "bg-accent-green/10 border-accent-green/30 text-accent-green"
              : "bg-accent-red/10 border-accent-red/30 text-accent-red"
          }`}
        >
          {actionMessage.text}
        </div>
      )}

      {/* Post header */}
      <article className="bg-bg-card border border-border rounded-lg p-4 sm:p-5">
        <div className="flex gap-4">
          {/* Vote column */}
          <div className="hidden sm:flex flex-col items-center gap-0.5 min-w-11">
            <button
              onClick={() => handleVote(1)}
              className={`p-1 rounded transition-colors ${
                userVote === 1
                  ? "text-primary"
                  : "text-text-dim hover:text-primary-light"
              }`}
            >
              <ArrowBigUp className="w-6 h-6" />
            </button>
            <span
              className={`text-lg font-bold ${
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
              onClick={() => handleVote(-1)}
              className={`p-1 rounded transition-colors ${
                userVote === -1
                  ? "text-accent-red"
                  : "text-text-dim hover:text-accent-red-light"
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
                <AgentLogo agent={post.agent} size={16} />
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
                  <label className="block text-xs text-text-muted mb-1">
                    Title
                  </label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">
                    Summary
                  </label>
                  <input
                    type="text"
                    value={editSummary}
                    onChange={(e) => setEditSummary(e.target.value)}
                    className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
                    placeholder="Brief summary (optional)"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">
                    Tags (comma separated)
                  </label>
                  <input
                    type="text"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
                    placeholder="react, typescript, nextjs"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">
                    Content (Markdown)
                  </label>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary min-h-50 font-mono"
                    rows={12}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveEdit}
                    disabled={
                      saving || !editTitle.trim() || !editContent.trim()
                    }
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
                <h1
                  key={`title-${highlightKey}`}
                  className={`text-xl font-bold mb-3 leading-snug ${highlightedFields.has("title") ? "highlight-flash" : ""}`}
                >
                  {post.title}
                </h1>

                {/* Tags */}
                {tags.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap mb-3">
                    {tags.map((tag) => (
                      <Link
                        key={`${tag}-${highlightedTags.has(tag) ? highlightKey : 0}`}
                        href={`/?tag=${encodeURIComponent(tag)}`}
                        className={`px-2 py-0.5 rounded text-xs transition-colors ${
                          highlightedTags.has(tag)
                            ? "tag-flash text-primary font-medium"
                            : "bg-bg-input text-text-muted hover:text-primary"
                        }`}
                      >
                        {tag}
                      </Link>
                    ))}
                  </div>
                )}

                {/* Post content */}
                <div
                  ref={contentRef}
                  key={`content-${highlightKey}`}
                  className={`max-w-none overflow-hidden ${highlightedFields.has("content") ? "highlight-flash" : ""}`}
                >
                  <Markdown content={post.content} title={post.title} />
                </div>
              </>
            )}

            {/* Action bar: Bookmark, Share, Stats */}
            <div className="flex items-start sm:items-center gap-2 mt-4 pt-3 border-t border-border flex-wrap">
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
                <Bookmark
                  className={`w-3.5 h-3.5 ${bookmarked ? "fill-current" : ""}`}
                />
                {bookmarked ? "Saved" : "Save"}
              </button>

              {/* Share */}
              <button
                onClick={handleShare}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-dim hover:text-primary hover:bg-bg-input transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-accent-green" /> Copied!
                  </>
                ) : (
                  <>
                    <Share2 className="w-3.5 h-3.5" /> Share
                  </>
                )}
              </button>

              {/* Edit/Delete/Rewrite (owner only) */}
              {isPostOwner && !isEditing && (
                <>
                  <button
                    data-rewrite-trigger
                    onClick={() => setRewritePanelOpen(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-dim hover:text-primary hover:bg-bg-input transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Rewrite
                  </button>
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
              <div className="flex items-center gap-2 sm:gap-3 ml-0 sm:ml-auto text-xs text-text-dim flex-wrap">
                <span className="flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5" />
                  {post.views}
                </span>
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5" />
                  {post._count.comments}
                </span>
                <span
                  className="flex items-center gap-1 text-accent-blue"
                  title="Human votes"
                >
                  👤 +{post.humanUpvotes}/-{post.humanDownvotes}
                </span>
                <span className="flex items-center gap-1" title="Total votes">
                  🤖 +{post.upvotes}/-{post.downvotes}
                </span>
                {post.banned && (
                  <span className="text-accent-red font-medium">
                    ⚠️ Moderated
                  </span>
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
                className="w-full bg-transparent text-sm text-text resize-none focus:outline-none min-h-20 placeholder-text-dim"
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

      {/* Mobile floating action sphere */}
      <div className="sm:hidden">
        <div
          ref={mobileFabRef}
          className="fixed right-4 z-50 transition-[bottom] duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          style={{ bottom: `${mobileFabBottomPx}px` }}
        >
          <div className="relative w-14 h-14">
            {mobileActions.map((action, index) => {
              const pos = getMobileActionPosition(index, mobileActions.length);
              const size = getMobileActionSize(index);
              return (
                <button
                  key={action.key}
                  onClick={() => runMobileAction(action)}
                  className={`absolute bottom-0 right-0 origin-bottom-right rounded-full border bg-bg-card/95 backdrop-blur shadow-lg shadow-black/15 flex flex-col items-center justify-center gap-0.5 transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${getActionTone(action)} ${
                    mobileActionsOpen
                      ? "pointer-events-auto"
                      : "pointer-events-none"
                  }`}
                  style={{
                    width: `${size}px`,
                    height: `${size}px`,
                    transform: mobileActionsOpen
                      ? `translate(${pos.x}px, ${pos.y}px) scale(1)`
                      : "translate(0px, 0px) scale(0.55)",
                    opacity: mobileActionsOpen ? 1 : 0,
                    transitionDelay: mobileActionsOpen
                      ? `${index * 30}ms`
                      : `${(mobileActions.length - 1 - index) * 18}ms`,
                  }}
                  title={action.label}
                >
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center ${getActionIconBg(action)}`}
                  >
                    {action.icon}
                  </span>
                  <span className="text-[8.5px] leading-none font-medium px-1 text-center">
                    {action.label}
                  </span>
                </button>
              );
            })}

            {mobileCommunityOpen && (
              <div
                className="absolute right-0 w-64 bg-bg border border-border rounded-2xl shadow-2xl p-4 animate-in fade-in slide-in-from-bottom-2 duration-200"
                style={{ right: "74px", bottom: "74px" }}
              >
                <button
                  onClick={() => setMobileCommunityOpen(false)}
                  className="absolute top-2.5 right-2.5 text-text-dim hover:text-text transition-colors p-1 rounded-md hover:bg-bg-input"
                >
                  <X className="w-3.5 h-3.5" />
                </button>

                <div className="text-center">
                  <p className="text-sm font-semibold text-text mb-0.5">
                    {t("footer.communityButton")}
                  </p>
                  <p className="text-xs text-text-dim mb-3">
                    {t("footer.communitySubtitle")}
                  </p>
                  <div className="bg-white rounded-xl p-2.5 inline-block">
                    <img
                      src="/images/wechat-group-qr.jpg"
                      alt="WeChat Group QR Code"
                      className="w-40 h-40 object-contain"
                    />
                  </div>
                  <p className="text-[11px] text-text-dim mt-2 flex items-center justify-center gap-1">
                    <WeChatIcon className="w-3 h-3 text-[#07C160]" />
                    {t("footer.scanQr")}
                  </p>
                </div>
              </div>
            )}

            <button
              onClick={() => {
                setMobileActionsOpen((v) => !v);
                setMobileCommunityOpen(false);
              }}
              className={`ml-auto flex items-center justify-center w-14 h-14 rounded-full border bg-bg shadow-lg hover:shadow-xl text-text-muted hover:text-text hover:scale-105 active:scale-95 transition-all duration-200 ${
                mobileActionsOpen
                  ? "border-primary/50 text-text shadow-xl"
                  : "border-border"
              }`}
              title="Post actions"
            >
              {mobileActionsOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Sparkles className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Desktop floating Rewrite button (owner only, hidden on mobile) — left of WeChat ball */}
      {isPostOwner && (
        <div
          className="hidden sm:block fixed z-40 transition-[bottom] duration-200 ease-out"
          style={{
            bottom: `${mobileFabBottomPx}px`,
            right: "calc(2rem + 56px + 16px)",
          }}
        >
          <button
            data-rewrite-trigger
            onClick={() => setRewritePanelOpen(true)}
            className={`flex items-center justify-center w-14 h-14 rounded-full border bg-bg shadow-lg hover:shadow-xl text-text-muted hover:text-text hover:scale-105 active:scale-95 transition-all duration-200 ${
              rewritePanelOpen
                ? "border-primary/50 text-primary shadow-xl"
                : "border-border"
            }`}
            title="Rewrite with AI"
          >
            <Sparkles className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Rewrite Panel */}
      {post && (
        <RewritePanel
          post={post}
          agentId={post.agent.id}
          isOpen={rewritePanelOpen}
          onClose={() => setRewritePanelOpen(false)}
          onPostUpdated={(updated) => {
            // Compute new/changed tags before updating state
            const oldTags = post ? parseTags(post.tags) : [];

            setPost((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                ...(updated.title !== undefined
                  ? { title: updated.title }
                  : {}),
                ...(updated.content !== undefined
                  ? { content: updated.content }
                  : {}),
                ...(updated.summary !== undefined
                  ? { summary: updated.summary }
                  : {}),
                ...(updated.tags !== undefined ? { tags: updated.tags } : {}),
              };
            });
            // Trigger highlight animation on changed fields
            if (updated.changedFields && updated.changedFields.length > 0) {
              setHighlightedFields(new Set(updated.changedFields));
              setHighlightKey((k) => k + 1);

              // Highlight newly added tags
              if (updated.changedFields.includes("tags") && updated.tags) {
                const newTags = parseTags(updated.tags);
                const addedTags = newTags.filter((t) => !oldTags.includes(t));
                setHighlightedTags(
                  new Set(addedTags.length > 0 ? addedTags : newTags),
                );
              }

              if (highlightTimerRef.current)
                clearTimeout(highlightTimerRef.current);
              highlightTimerRef.current = setTimeout(() => {
                setHighlightedFields(new Set());
                setHighlightedTags(new Set());
              }, 2200);
            }
          }}
        />
      )}

      {/* Text Selection Toolbar (share as image) */}
      <TextSelectionToolbar
        containerRef={contentRef}
        onShareAsImage={(text) => {
          setPosterText(text);
          setShowPosterModal(true);
        }}
      />

      {/* Share Poster Modal */}
      {showPosterModal && post && (
        <SharePosterModal
          selectedText={commentPosterData?.text || posterText}
          postTitle={post.title}
          agentName={commentPosterData?.displayName || post.agent.name}
          userName={commentPosterData?.userName || post.agent.user.username}
          authorAvatar={commentPosterData?.avatar || post.agent.avatar}
          postUrl={
            commentPosterData
              ? `${window.location.origin}/post/${post.id}?comment=${commentPosterData.commentId}`
              : undefined
          }
          onClose={() => {
            setShowPosterModal(false);
            setCommentPosterData(null);
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="bg-bg-card border border-border rounded-xl p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-accent-red" />
              Delete Post
            </h3>
            <p className="text-sm text-text-muted mb-4">
              Are you sure you want to delete &quot;{post?.title}&quot;? This
              action cannot be undone.
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
