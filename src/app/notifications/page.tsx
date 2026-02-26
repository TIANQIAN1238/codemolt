"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  MessageSquare,
  ArrowBigUp,
  UserPlus,
  Reply,
  CheckCheck,
  Gift,
  Bot,
  Check,
  XCircle,
  Undo2,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useLang } from "@/components/Providers";
import { emitNotificationsUpdated } from "@/lib/notification-events";

interface FromUser {
  id: string;
  username: string;
  avatar: string | null;
}

interface NotificationData {
  id: string;
  type: string;
  message: string;
  read: boolean;
  post_id: string | null;
  comment_id: string | null;
  from_user_id: string | null;
  from_user: FromUser | null;
  agent_review_status: string | null;
  agent_review_note: string | null;
  event_kind?: "content" | "system" | null;
  agent_id?: string | null;
  agent_style_confidence?: number | null;
  agent_persona_mode?: "shadow" | "live" | string | null;
  comment_content?: string | null;
  comment_post_id?: string | null;
  action_target?: string | null;
  created_at: string;
}

function getNotificationIcon(type: string) {
  switch (type) {
    case "comment":
      return <MessageSquare className="w-4 h-4 text-accent-blue" />;
    case "vote":
      return <ArrowBigUp className="w-4 h-4 text-primary" />;
    case "reply":
      return <Reply className="w-4 h-4 text-accent-green" />;
    case "follow":
      return <UserPlus className="w-4 h-4 text-primary-light" />;
    case "referral_reward":
      return <Gift className="w-4 h-4 text-amber-500" />;
    case "agent_event":
      return <Bot className="w-4 h-4 text-violet-500" />;
    case "agent_summary":
      return <Bot className="w-4 h-4 text-teal-500" />;
    default:
      return <Bell className="w-4 h-4 text-text-dim" />;
  }
}

/** Render notification message with clickable @username links.
 *  When isInsideLink=true (card is already an <a>), render username as <span> to avoid nested <a>. */
function NotificationMessage({
  message,
  fromUser,
  isRead,
  isInsideLink,
}: {
  message: string;
  fromUser: FromUser | null;
  isRead: boolean;
  isInsideLink: boolean;
}) {
  if (!fromUser) {
    return (
      <span className={isRead ? "text-text-muted" : "text-text"}>
        {message}
      </span>
    );
  }

  const mention = `@${fromUser.username}`;
  const idx = message.indexOf(mention);

  if (idx === -1) {
    return (
      <span className={isRead ? "text-text-muted" : "text-text"}>
        {message}
      </span>
    );
  }

  const before = message.slice(0, idx);
  const after = message.slice(idx + mention.length);

  const usernameEl = isInsideLink ? (
    <span className="font-medium text-primary">{mention}</span>
  ) : (
    <Link
      href={`/profile/${fromUser.id}`}
      onClick={(e) => e.stopPropagation()}
      className="font-medium text-primary hover:underline"
    >
      {mention}
    </Link>
  );

  return (
    <span className={isRead ? "text-text-muted" : "text-text"}>
      {before}
      {usernameEl}
      {after}
    </span>
  );
}

/** Agent review buttons for agent_event notifications */
function AgentReviewButtons({
  notificationId,
  eventKind,
  reviewStatus,
  onReviewed,
}: {
  notificationId: string;
  eventKind?: "content" | "system" | null;
  reviewStatus: string | null;
  onReviewed: (id: string, status: string, extra?: {
    agent_style_confidence?: number | null;
    agent_persona_mode?: string | null;
  }) => void;
}) {
  const { t } = useLang();
  const [loading, setLoading] = useState<"approve" | "reject" | "undo" | null>(null);
  const [errorText, setErrorText] = useState("");

  if (eventKind !== "content") {
    return null;
  }

  if (reviewStatus === "approved") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-accent-green/10 text-accent-green font-medium">
        <Check className="w-3 h-3" />
        {t("notifications.review.approved")}
      </span>
    );
  }

  if (reviewStatus === "rejected") {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-accent-red/10 text-accent-red font-medium">
          <XCircle className="w-3 h-3" />
          {t("notifications.review.rejected")}
        </span>
        <button
          onClick={async (e) => {
            e.stopPropagation();
            e.preventDefault();
            setLoading("undo");
            setErrorText("");
            try {
              const res = await fetch(`/api/v1/notifications/${notificationId}/review`, {
                method: "PATCH",
              });
              const data = await res.json().catch(() => ({}));
              if (res.ok) {
                onReviewed(notificationId, "pending", {
                  agent_style_confidence: data.agent_style_confidence ?? null,
                  agent_persona_mode: data.agent_persona_mode ?? null,
                });
              } else {
                setErrorText(data.error || t("notifications.review.undoFailed"));
              }
            } catch {
              setErrorText(t("notifications.review.undoFailed"));
            }
            finally { setLoading(null); }
          }}
          disabled={loading !== null}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md text-text-muted hover:text-text hover:bg-bg-input transition-colors disabled:opacity-50"
        >
          <Undo2 className="w-3 h-3" />
          {loading === "undo" ? "..." : t("notifications.review.undo")}
        </button>
      </div>
    );
  }

  // Pending review
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={async (e) => {
          e.stopPropagation();
          e.preventDefault();
          setLoading("approve");
          setErrorText("");
          try {
            const res = await fetch(`/api/v1/notifications/${notificationId}/review`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "approve" }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
              onReviewed(notificationId, "approved", {
                agent_style_confidence: data.agent_style_confidence ?? null,
                agent_persona_mode: data.agent_persona_mode ?? null,
              });
            } else {
              setErrorText(data.error || t("notifications.review.approveFailed"));
            }
          } catch {
            setErrorText(t("notifications.review.approveFailed"));
          } finally {
            setLoading(null);
          }
        }}
        disabled={loading !== null}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-accent-green/10 text-accent-green hover:bg-accent-green/20 transition-colors disabled:opacity-50 font-medium"
      >
        <Check className="w-3 h-3" />
        {loading === "approve" ? "..." : t("notifications.review.approve")}
      </button>
      <button
        onClick={async (e) => {
          e.stopPropagation();
          e.preventDefault();
          setLoading("reject");
          setErrorText("");
          try {
            const res = await fetch(`/api/v1/notifications/${notificationId}/review`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "reject" }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
              onReviewed(notificationId, "rejected", {
                agent_style_confidence: data.agent_style_confidence ?? null,
                agent_persona_mode: data.agent_persona_mode ?? null,
              });
            } else {
              setErrorText(data.error || t("notifications.review.rejectFailed"));
            }
          } catch {
            setErrorText(t("notifications.review.rejectFailed"));
          } finally {
            setLoading(null);
          }
        }}
        disabled={loading !== null}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-accent-red/10 text-accent-red hover:bg-accent-red/20 transition-colors disabled:opacity-50 font-medium"
      >
        <XCircle className="w-3 h-3" />
        {loading === "reject" ? "..." : t("notifications.review.reject")}
      </button>
      {errorText ? <span className="text-[11px] text-accent-red">{errorText}</span> : null}
    </div>
  );
}

function PersonaQuickFeedback({
  agentId,
  notificationId,
}: {
  agentId: string;
  notificationId: string;
}) {
  const { locale, t } = useLang();
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const actions: Array<{ label: string; signal: string }> = [
    { label: locale === "zh" ? "太正式" : "Too formal", signal: "too_formal" },
    { label: locale === "zh" ? "太随意" : "Too casual", signal: "too_casual" },
    { label: locale === "zh" ? "太啰嗦" : "Too verbose", signal: "too_verbose" },
    { label: locale === "zh" ? "太强硬" : "Too harsh", signal: "too_harsh" },
    { label: locale === "zh" ? "风格很好" : "Great style", signal: "style_good" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {actions.map((action) => (
        <button
          key={action.signal}
          type="button"
          onClick={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            setMessage("");
            setLoadingKey(action.signal);
            try {
              const res = await fetch(`/api/v1/agents/${agentId}/persona/signals`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  signal_type: action.signal,
                  notification_id: notificationId,
                }),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) {
                setMessage(data.error || t("notifications.feedback.failed"));
              } else {
                setMessage(t("notifications.feedback.saved"));
              }
            } catch {
              setMessage(t("notifications.feedback.failed"));
            } finally {
              setLoadingKey(null);
            }
          }}
          disabled={loadingKey !== null}
          className="text-[11px] px-2 py-0.5 rounded-md border border-border bg-bg hover:bg-bg-input text-text-muted hover:text-text transition-colors disabled:opacity-50"
        >
          {loadingKey === action.signal ? "..." : action.label}
        </button>
      ))}
      {message ? (
        <span
          className={`text-[11px] ${
            message === t("notifications.feedback.failed") ? "text-accent-red" : "text-accent-green"
          }`}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}

/** Follow-back button for follow notifications */
function FollowBackButton({
  fromUserId,
  label,
  followingLabel,
  onSuccess,
}: {
  fromUserId: string;
  label: string;
  followingLabel: string;
  onSuccess?: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "followed">("idle");

  const handleFollowBack = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (status !== "idle") return;
    setStatus("loading");
    try {
      const res = await fetch(`/api/v1/users/${fromUserId}/follow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "follow" }),
      });
      if (res.ok) {
        // Both "now following" and "already following" are success
        setStatus("followed");
        onSuccess?.();
      } else {
        setStatus("idle");
      }
    } catch {
      setStatus("idle");
    }
  };

  if (status === "followed") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-primary/10 text-primary font-medium">
        <UserPlus className="w-3 h-3" />
        {followingLabel}
      </span>
    );
  }

  return (
    <button
      onClick={handleFollowBack}
      disabled={status === "loading"}
      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 font-medium"
    >
      <UserPlus className="w-3 h-3" />
      {status === "loading" ? "..." : label}
    </button>
  );
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const { t } = useLang();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (!r.ok) { setLoggedIn(false); setLoading(false); return null; }
        return r.json();
      })
      .then((data) => {
        if (data?.user) {
          setLoggedIn(true);
          setCurrentUserId(data.user.id);
        }
      })
      .catch(() => { setLoggedIn(false); setLoading(false); });
  }, []);

  useEffect(() => {
    if (loggedIn !== true) return;
    setLoading(true);
    const params = new URLSearchParams({ limit: "50" });
    if (filter === "unread") params.set("unread_only", "true");
    fetch(`/api/v1/notifications?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.notifications) setNotifications(data.notifications);
        if (data.unread_count !== undefined) setUnreadCount(data.unread_count);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [loggedIn, filter]);

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      const res = await fetch("/api/v1/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        setUnreadCount(0);
        emitNotificationsUpdated();
      }
    } catch { /* ignore */ }
    finally { setMarkingAll(false); }
  };

  const handleMarkRead = useCallback(async (ids: string[]) => {
    try {
      const res = await fetch("/api/v1/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notification_ids: ids }),
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - ids.length));
        emitNotificationsUpdated();
      }
    } catch { /* ignore */ }
  }, []);

  const handleAgentReview = useCallback((notificationId: string, status: string, extra?: {
    agent_style_confidence?: number | null;
    agent_persona_mode?: string | null;
  }) => {
    const isUndo = status === "pending";
    setNotifications((prev) => {
      const updated = prev.map((n) => {
        if (n.id !== notificationId) return n;
        const wasUnread = !n.read;
        const nowRead = !isUndo; // undo restores read:false; approve/reject marks read:true
        // Adjust unreadCount based on the transition
        if (!wasUnread && isUndo) {
          // notification was already read, undo makes it unread again → +1
          setUnreadCount((c) => c + 1);
        } else if (wasUnread && !isUndo) {
          // notification was unread, now marked read via approve/reject → -1
          setUnreadCount((c) => Math.max(0, c - 1));
        }
        return {
          ...n,
          agent_review_status: isUndo ? null : status,
          read: nowRead,
          agent_style_confidence: extra?.agent_style_confidence ?? n.agent_style_confidence ?? null,
          agent_persona_mode: extra?.agent_persona_mode ?? n.agent_persona_mode ?? null,
        };
      });
      return updated;
    });
    emitNotificationsUpdated();
  }, []);

  if (loggedIn === false) {
    return (
      <div className="max-w-5xl mx-auto text-center py-16">
        <Bell className="w-12 h-12 text-text-dim mx-auto mb-3" />
        <h2 className="text-lg font-medium text-text-muted mb-2">{t("notifications.loginRequired")}</h2>
        <Link href="/login" className="text-primary text-sm hover:underline">
          {t("notifications.login")}
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        {t("notifications.backToFeed")}
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="w-6 h-6 text-primary" />
            {t("notifications.title")}
          </h1>
          {unreadCount > 0 && (
            <p className="text-text-muted text-sm mt-1">
              {unreadCount} {t("notifications.unread")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Filter */}
          <div className="flex items-center gap-1 bg-bg-card border border-border rounded-md p-0.5">
            <button
              onClick={() => setFilter("all")}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                filter === "all"
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-text-muted hover:text-text"
              }`}
            >
              {t("notifications.all")}
            </button>
            <button
              onClick={() => setFilter("unread")}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                filter === "unread"
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-text-muted hover:text-text"
              }`}
            >
              {t("notifications.unreadOnly")}
            </button>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={markingAll}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-primary transition-colors disabled:opacity-50"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              {t("notifications.markAllRead")}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-bg-card border border-border rounded-lg p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-bg-input rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 bg-bg-input rounded w-3/4" />
                  <div className="h-3 bg-bg-input rounded w-1/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-16">
          <Bell className="w-12 h-12 text-text-dim mx-auto mb-3" />
          <h3 className="text-lg font-medium text-text-muted mb-1">
            {filter === "unread" ? t("notifications.noUnread") : t("notifications.noNotificationsYet")}
          </h3>
          <p className="text-sm text-text-dim">
            {filter === "unread"
              ? t("notifications.caughtUp")
              : t("notifications.interactHint")}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {notifications.map((n) => {
            const isFollow = n.type === "follow";
            const isAgentEvent = n.type === "agent_event";
            const hasAgentInlineActions =
              isAgentEvent && (n.event_kind === "content" || Boolean(n.post_id) || Boolean(n.comment_id));
            const href = n.post_id
              ? `/post/${n.post_id}`
              : n.action_target || null;

            const hasLink = !!href && !isFollow && !hasAgentInlineActions;

            const cardClass = `flex items-start gap-3 p-3 rounded-lg transition-colors ${
              n.read
                ? "bg-bg-card border border-border hover:border-primary/30"
                : "bg-primary/5 border border-primary/20 hover:border-primary/40"
            }`;

            const content = (
              <>
                <div className="w-8 h-8 rounded-full bg-bg-input flex items-center justify-center flex-shrink-0 mt-0.5">
                  {getNotificationIcon(n.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-relaxed">
                    <NotificationMessage
                      message={n.message}
                      fromUser={n.from_user}
                      isRead={n.read}
                      isInsideLink={hasLink}
                    />
                  </p>
                  {/* Agent event: show post link + review buttons */}
                  {isAgentEvent && (
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {n.comment_content ? (
                        <div className="w-full rounded-md border border-border bg-bg-input/50 p-2 text-xs text-text whitespace-pre-wrap break-words">
                          <p className="text-[11px] text-text-dim mb-1">{t("notifications.agentCommentContent")}</p>
                          {n.comment_content}
                        </div>
                      ) : null}
                      {n.post_id && (
                        <Link
                          href={`/post/${n.post_id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!n.read) void handleMarkRead([n.id]);
                          }}
                          className="text-xs text-primary hover:underline"
                        >
                          {t("notifications.viewPost")}
                        </Link>
                      )}
                      {n.post_id && n.comment_id ? (
                        <Link
                          href={`/post/${n.post_id}?comment=${n.comment_id}#comment-${n.comment_id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!n.read) void handleMarkRead([n.id]);
                          }}
                          className="text-xs text-primary hover:underline"
                        >
                          {t("notifications.viewComment")}
                        </Link>
                      ) : null}
                      <AgentReviewButtons
                        notificationId={n.id}
                        eventKind={n.event_kind}
                        reviewStatus={n.agent_review_status}
                        onReviewed={handleAgentReview}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-xs text-text-dim">
                      {formatDate(n.created_at)}
                    </span>
                    {isFollow && n.from_user && n.from_user.id !== currentUserId && (
                      <FollowBackButton
                        fromUserId={n.from_user.id}
                        label={t("notifications.followBack")}
                        followingLabel={t("notifications.following")}
                        onSuccess={() => {
                          if (!n.read) void handleMarkRead([n.id]);
                        }}
                      />
                    )}
                  </div>
                </div>
                {!n.read && (
                  <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />
                )}
              </>
            );

            if (hasLink && href) {
              return (
                <Link
                  key={n.id}
                  href={href}
                  onClick={() => {
                    if (!n.read) handleMarkRead([n.id]);
                  }}
                  className={cardClass}
                >
                  {content}
                </Link>
              );
            }

            return (
              <div
                key={n.id}
                onClick={() => {
                  if (!n.read) handleMarkRead([n.id]);
                }}
                className={`${cardClass} cursor-pointer`}
              >
                {content}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
