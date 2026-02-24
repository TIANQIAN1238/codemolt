"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  X,
  Send,
  Sparkles,
  Check,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Loader2,
  History,
  XCircle,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { Markdown } from "@/components/Markdown";
import { parseTags } from "@/lib/utils";

interface PostForRewrite {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  tags: string; // JSON string or parsed array
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  changesDismissed?: boolean; // user dismissed the suggested changes
  changesApplied?: boolean;   // changes were applied successfully
}

interface VersionSnapshot {
  version: number;
  title: string;
  content: string;
  summary: string | null;
  tags: string; // JSON string
  changedFields: string[];
  createdAt: string; // ISO string
}

interface RewritePanelProps {
  post: PostForRewrite;
  isOpen: boolean;
  onClose: () => void;
  onPostUpdated: (updated: {
    title?: string;
    content?: string;
    summary?: string | null;
    tags?: string;
    version?: number;
    changedFields?: string[];
  }) => void;
}

const STYLE_PRESETS = [
  {
    key: "professional",
    label: "Professional",
    prompt: "Rewrite this post in a more professional and technical tone. Keep the core insights but improve clarity and structure.",
  },
  {
    key: "casual",
    label: "Casual",
    prompt: "Rewrite this post in a more casual and conversational tone, as if explaining to a friend.",
  },
  {
    key: "detail",
    label: "Add Detail",
    prompt: "Expand on the technical details in this post. Add more explanation and context for the key concepts.",
  },
  {
    key: "concise",
    label: "Concise",
    prompt: "Make this post more concise while keeping the key insights. Remove redundant information.",
  },
];

function extractChanges(
  text: string
): Record<string, unknown> | null {
  // Remove <thinking>...</thinking> blocks first
  const cleaned = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, "");

  // The JSON block is always at the end of the message per system prompt convention.
  // Find the LAST ```json ... ``` block because content may contain nested code blocks.
  const jsonStart = cleaned.lastIndexOf("```json");
  if (jsonStart === -1) return null;

  const afterMarker = cleaned.indexOf("\n", jsonStart);
  if (afterMarker === -1) return null;

  const closingIdx = cleaned.lastIndexOf("```");
  if (closingIdx <= afterMarker) return null;

  const jsonStr = cleaned.slice(afterMarker + 1, closingIdx).trim();
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/** Check if an error message is related to AI provider configuration */
function isAiConfigError(text: string): boolean {
  return /insufficient credit|configure your own ai provider|ai service (temporarily unavailable|not available)/i.test(text);
}

/** Render an error message, adding a Settings link for AI config errors */
function ErrorMessage({ text }: { text: string }) {
  if (!isAiConfigError(text)) {
    return <p className="whitespace-pre-wrap">{text}</p>;
  }
  return (
    <div className="space-y-2">
      <p className="whitespace-pre-wrap">{text}</p>
      <Link
        href="/settings#ai-provider"
        target="_blank"
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary hover:text-primary-dark transition-colors px-2 py-1 rounded-md bg-primary/10 hover:bg-primary/15"
      >
        <Settings className="w-3 h-3" />
        Go to AI Provider Settings
      </Link>
    </div>
  );
}

/** Check if content change is "small" (< 30% diff by length) */
function isSmallContentChange(oldContent: string, newContent: string): boolean {
  const lenDiff = Math.abs(newContent.length - oldContent.length);
  const maxLen = Math.max(oldContent.length, newContent.length, 1);
  return lenDiff / maxLen < 0.3 && newContent.length < 500;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function RewritePanel({
  post,
  isOpen,
  onClose,
  onPostUpdated,
}: RewritePanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [applying, setApplying] = useState<number | null>(null);
  const [actionMsg, setActionMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // In-memory version history (ephemeral — cleared when panel/page closes)
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Resizable panel
  const [panelSize, setPanelSize] = useState({ width: 360, height: 520 });
  const resizingRef = useRef<{ edge: "left" | "top" | "top-left"; startX: number; startY: number; startW: number; startH: number } | null>(null);

  // Reset in-memory versions when panel closes (ephemeral by design)
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      // Panel just opened — initialize v1 from current post state
      setVersions([{
        version: 1,
        title: post.title,
        content: post.content,
        summary: post.summary,
        tags: typeof post.tags === "string" ? post.tags : JSON.stringify(post.tags),
        changedFields: [],
        createdAt: new Date().toISOString(),
      }]);
      setVersionsOpen(false);
    }
    prevOpenRef.current = isOpen;
  }, [isOpen, post.title, post.content, post.summary, post.tags]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  // Close on click outside (skip clicks on the rewrite-panel-trigger button)
  useEffect(() => {
    if (!isOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't close if clicking the button that opens the panel
      if (target.closest?.("[data-rewrite-trigger]")) return;
      if (panelRef.current && !panelRef.current.contains(target)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen, onClose]);

  // Cleanup abort on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Resize handlers
  const startResize = useCallback((edge: "left" | "top" | "top-left", e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { edge, startX: e.clientX, startY: e.clientY, startW: panelSize.width, startH: panelSize.height };

    const onMove = (ev: MouseEvent) => {
      const r = resizingRef.current;
      if (!r) return;
      const dx = r.startX - ev.clientX;
      const dy = r.startY - ev.clientY;
      setPanelSize({
        width: (r.edge === "left" || r.edge === "top-left")
          ? Math.max(300, Math.min(800, r.startW + dx))
          : r.startW,
        height: (r.edge === "top" || r.edge === "top-left")
          ? Math.max(300, Math.min(900, r.startH + dy))
          : r.startH,
      });
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [panelSize]);

  const sendMessage = async (content: string) => {
    if (!content.trim() || streaming) return;

    const userMsg: ChatMessage = { role: "user", content: content.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);
    setActionMsg(null);

    const apiMessages = newMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/v1/posts/${post.id}/rewrite/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${err.error || "Something went wrong"}`,
          },
        ]);
        setStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      let assistantContent = "";
      let buffer = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          try {
            const data = JSON.parse(line.slice(6));
            const delta = data.choices?.[0]?.delta?.content;
            if (delta) {
              assistantContent += delta;
              const content = assistantContent;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content,
                };
                return updated;
              });
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages((prev) => [
          ...prev.slice(0, -1).length > messages.length
            ? prev.slice(0, -1)
            : prev,
          {
            role: "assistant",
            content: "Error: Connection failed. Please try again.",
          },
        ]);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const applyChanges = async (
    changes: Record<string, unknown>,
    messageIndex: number
  ) => {
    setApplying(messageIndex);
    setActionMsg(null);

    try {
      const body: Record<string, unknown> = {};
      if (changes.title) body.title = changes.title;
      if (changes.content) body.content = changes.content;
      if (changes.summary !== undefined) body.summary = changes.summary;
      if (changes.tags) body.tags = changes.tags;

      const res = await fetch(`/api/v1/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        setActionMsg({
          type: "error",
          text: err.error || "Failed to apply changes",
        });
        return;
      }

      const data = await res.json();
      // Track changed fields for the in-memory version
      const changedFields: string[] = [];
      if (changes.title && changes.title !== post.title) changedFields.push("title");
      if (changes.content && changes.content !== post.content) changedFields.push("content");
      if (changes.summary !== undefined && (changes.summary || null) !== post.summary) changedFields.push("summary");
      if (changes.tags) {
        const oldTags = typeof post.tags === "string" ? post.tags : JSON.stringify(post.tags);
        const newTags = JSON.stringify(changes.tags);
        if (newTags !== oldTags) changedFields.push("tags");
      }

      // Create in-memory version snapshot
      const nextVersion = versions.length > 0 ? versions[0].version + 1 : 2;
      const newSnapshot: VersionSnapshot = {
        version: nextVersion,
        title: data.post.title,
        content: changes.content ? String(changes.content) : post.content,
        summary: data.post.summary ?? null,
        tags: JSON.stringify(data.post.tags),
        changedFields,
        createdAt: new Date().toISOString(),
      };
      setVersions((prev) => [newSnapshot, ...prev]);

      onPostUpdated({
        title: data.post.title,
        summary: data.post.summary,
        tags: JSON.stringify(data.post.tags),
        version: nextVersion,
        changedFields,
        ...(changes.content ? { content: changes.content as string } : {}),
      });
      // Mark this message's changes as applied
      setMessages((prev) => {
        const updated = [...prev];
        updated[messageIndex] = { ...updated[messageIndex], changesApplied: true };
        return updated;
      });
      setActionMsg({ type: "success", text: "Changes applied!" });
    } catch {
      setActionMsg({ type: "error", text: "Network error" });
    } finally {
      setApplying(null);
    }
  };

  const restoreVersion = async (version: number) => {
    const snapshot = versions.find((v) => v.version === version);
    if (!snapshot) return;

    setRestoringVersion(version);
    setActionMsg(null);
    try {
      // PATCH the post with the snapshot content
      const body: Record<string, unknown> = {
        title: snapshot.title,
        content: snapshot.content,
        summary: snapshot.summary,
        tags: parseTags(snapshot.tags),
      };

      const res = await fetch(`/api/v1/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        setActionMsg({
          type: "error",
          text: err.error || "Failed to restore version",
        });
        return;
      }

      // Truncate: remove all versions after the restored one
      setVersions((prev) => prev.filter((v) => v.version <= version));

      onPostUpdated({
        title: snapshot.title,
        content: snapshot.content,
        summary: snapshot.summary,
        tags: snapshot.tags,
        changedFields: ["title", "content", "summary", "tags"],
      });
      setActionMsg({
        type: "success",
        text: `Restored to v${version}`,
      });
    } catch {
      setActionMsg({ type: "error", text: "Network error" });
    } finally {
      setRestoringVersion(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div
      ref={panelRef}
      className={`fixed z-50 transition-all duration-200 ${
        isOpen
          ? "opacity-100 scale-100 pointer-events-auto"
          : "opacity-0 scale-95 pointer-events-none"
      }`}
      style={{
        bottom: "calc(2rem + 56px + 12px)",
        right: "calc(2rem + 56px + 16px)",
      }}
    >
      <div
        className="bg-bg border border-border rounded-2xl shadow-2xl shadow-black/20 flex flex-col overflow-hidden relative"
        style={{ width: `${panelSize.width}px`, height: `${panelSize.height}px` }}
      >
        {/* Resize handles */}
        {/* Left edge */}
        <div
          className="absolute left-0 top-3 bottom-3 w-1.5 cursor-ew-resize z-10 group"
          onMouseDown={(e) => startResize("left", e)}
        >
          <div className="h-full w-px mx-auto rounded-full opacity-0 group-hover:opacity-100 bg-primary/40 transition-opacity" />
        </div>
        {/* Top edge */}
        <div
          className="absolute top-0 left-3 right-3 h-1.5 cursor-ns-resize z-10 group"
          onMouseDown={(e) => startResize("top", e)}
        >
          <div className="w-full h-px my-auto rounded-full opacity-0 group-hover:opacity-100 bg-primary/40 transition-opacity" />
        </div>
        {/* Top-left corner */}
        <div
          className="absolute top-0 left-0 w-3 h-3 cursor-nwse-resize z-20"
          onMouseDown={(e) => startResize("top-left", e)}
        />
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span className="font-semibold text-[13px]">Rewrite</span>
            <span className="text-[10px] text-text-dim px-1.5 py-0.5 rounded-full bg-bg-input">
              v{versions.length > 0 ? versions[0].version : 1}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-bg-input transition-colors text-text-dim hover:text-text"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Style Presets */}
        <div className="px-3 py-2 border-b border-border/60 shrink-0">
          <div className="flex flex-wrap gap-1">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                disabled={streaming}
                onClick={() => sendMessage(preset.prompt)}
                className="text-[10px] px-2 py-[3px] rounded-full border border-border bg-bg hover:bg-bg-input hover:border-primary/30 hover:text-primary transition-colors disabled:opacity-50"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-2.5 min-h-0">
          {messages.length === 0 && (
            <div className="text-center text-text-dim text-[11px] mt-6 space-y-1.5">
              <Sparkles className="w-5 h-5 mx-auto opacity-25" />
              <p>Ask AI to rewrite your post</p>
              <p className="text-[10px] opacity-70">
                &quot;Make it more concise&quot; &middot; &quot;Add the evolver tag&quot;
              </p>
            </div>
          )}

          {messages.map((msg, i) => {
            const changes =
              msg.role === "assistant" && !msg.changesDismissed && !msg.changesApplied
                ? extractChanges(msg.content)
                : null;
            const appliedChanges =
              msg.role === "assistant" && msg.changesApplied
                ? extractChanges(msg.content)
                : null;

            // Strip the last json block and <thinking> tags from display text
            const displayContent = msg.role === "assistant"
              ? (() => {
                  let text = msg.content;
                  // Remove <thinking>...</thinking> blocks
                  text = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, "").trim();
                  // Remove the last ```json ... ``` block
                  const jsonStart = text.lastIndexOf("```json");
                  if (jsonStart !== -1) {
                    text = text.slice(0, jsonStart).trim();
                  }
                  return text;
                })()
              : msg.content;

            return (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[88%] rounded-xl px-2.5 py-1.5 text-[12px] leading-relaxed ${
                    msg.role === "user"
                      ? "bg-primary text-white rounded-br-sm"
                      : "bg-bg-card border border-border/60 rounded-bl-sm"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose-sm [&_p]:text-[12px] [&_p]:leading-relaxed [&_p]:my-1 [&_li]:text-[12px] [&_code]:text-[11px]">
                      {displayContent && (
                        isAiConfigError(displayContent)
                          ? <ErrorMessage text={displayContent} />
                          : <Markdown content={displayContent} />
                      )}

                      {/* Changes preview card */}
                      {changes && (
                        <div className="mt-2 rounded-lg border border-primary/25 bg-primary/[0.03] overflow-hidden">
                          <div className="px-2.5 py-1.5 border-b border-primary/15 bg-primary/[0.05]">
                            <span className="text-[10px] font-semibold text-primary">Suggested Changes</span>
                          </div>
                          <div className="px-2.5 py-2 space-y-1.5 max-h-[200px] overflow-y-auto">
                            {"title" in changes && (
                              <div>
                                <span className="text-[9px] font-medium text-text-muted uppercase tracking-wide">Title</span>
                                {post.title !== String(changes.title) ? (
                                  <div className="mt-0.5 space-y-0.5">
                                    <p className="text-[11px] text-accent-red/80 line-through">{post.title}</p>
                                    <p className="text-[11px] text-accent-green">{String(changes.title)}</p>
                                  </div>
                                ) : (
                                  <p className="text-[11px] text-text mt-0.5">{String(changes.title)}</p>
                                )}
                              </div>
                            )}
                            {"content" in changes && (() => {
                              const newContent = String(changes.content);
                              const small = isSmallContentChange(post.content, newContent);
                              if (small) {
                                return (
                                  <div>
                                    <span className="text-[9px] font-medium text-text-muted uppercase tracking-wide">Content</span>
                                    <div className="mt-0.5 space-y-0.5">
                                      <p className="text-[11px] text-accent-red/80 line-through line-clamp-3">
                                        {post.content
                                          .replace(/```[\s\S]*?```/g, "[code]")
                                          .replace(/#{1,6}\s+/g, "")
                                          .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
                                          .replace(/\n{2,}/g, " | ")
                                          .replace(/\n/g, " ")
                                          .slice(0, 200)}
                                      </p>
                                      <p className="text-[11px] text-accent-green line-clamp-3">
                                        {newContent
                                          .replace(/```[\s\S]*?```/g, "[code]")
                                          .replace(/#{1,6}\s+/g, "")
                                          .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
                                          .replace(/\n{2,}/g, " | ")
                                          .replace(/\n/g, " ")
                                          .slice(0, 200)}
                                      </p>
                                    </div>
                                  </div>
                                );
                              }
                              return (
                                <div>
                                  <span className="text-[9px] font-medium text-text-muted uppercase tracking-wide">Content</span>
                                  <div className="mt-0.5 max-h-[120px] overflow-y-auto rounded border border-border/40 bg-bg/50 p-1.5">
                                    <p className="text-[11px] text-text whitespace-pre-wrap break-words">
                                      {newContent
                                        .replace(/```[\s\S]*?```/g, "[code]")
                                        .replace(/#{1,6}\s+/g, "")
                                        .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
                                        .slice(0, 800)}
                                      {newContent.length > 800 && "..."}
                                    </p>
                                  </div>
                                </div>
                              );
                            })()}
                            {"tags" in changes && Array.isArray(changes.tags) && (() => {
                              const oldTags = parseTags(post.tags);
                              const newTags = changes.tags as string[];
                              const added = newTags.filter(t => !oldTags.includes(t));
                              const removed = oldTags.filter(t => !newTags.includes(t));
                              const unchanged = newTags.filter(t => oldTags.includes(t));
                              const hasDiff = added.length > 0 || removed.length > 0;
                              return (
                                <div>
                                  <span className="text-[9px] font-medium text-text-muted uppercase tracking-wide">Tags</span>
                                  <div className="flex flex-wrap gap-1 mt-0.5">
                                    {hasDiff ? (
                                      <>
                                        {removed.map((tag) => (
                                          <span key={`rm-${tag}`} className="text-[10px] px-1.5 py-px rounded-full bg-accent-red/10 border border-accent-red/20 text-accent-red line-through">
                                            {tag}
                                          </span>
                                        ))}
                                        {unchanged.map((tag) => (
                                          <span key={tag} className="text-[10px] px-1.5 py-px rounded-full bg-bg-input border border-border text-text">
                                            {tag}
                                          </span>
                                        ))}
                                        {added.map((tag) => (
                                          <span key={`add-${tag}`} className="text-[10px] px-1.5 py-px rounded-full bg-accent-green/10 border border-accent-green/20 text-accent-green">
                                            + {tag}
                                          </span>
                                        ))}
                                      </>
                                    ) : (
                                      newTags.map((tag) => (
                                        <span key={tag} className="text-[10px] px-1.5 py-px rounded-full bg-bg-input border border-border text-text">
                                          {tag}
                                        </span>
                                      ))
                                    )}
                                  </div>
                                </div>
                              );
                            })()}
                            {"summary" in changes && (
                              <div>
                                <span className="text-[9px] font-medium text-text-muted uppercase tracking-wide">Summary</span>
                                {(post.summary || "") !== String(changes.summary || "") ? (
                                  <div className="mt-0.5 space-y-0.5">
                                    {post.summary && <p className="text-[11px] text-accent-red/80 line-through">{post.summary}</p>}
                                    <p className="text-[11px] text-accent-green">{String(changes.summary)}</p>
                                  </div>
                                ) : (
                                  <p className="text-[11px] text-text mt-0.5 line-clamp-2">{String(changes.summary)}</p>
                                )}
                              </div>
                            )}
                          </div>
                          {/* Accept / Reject buttons */}
                          <div className="flex border-t border-primary/15">
                            <button
                              type="button"
                              disabled={applying === i}
                              onClick={() => {
                                setMessages((prev) => {
                                  const updated = [...prev];
                                  updated[i] = { ...updated[i], changesDismissed: true };
                                  return updated;
                                });
                              }}
                              className="flex-1 flex items-center justify-center gap-1 text-[11px] py-2 text-text-muted hover:text-accent-red hover:bg-accent-red/5 transition-colors border-r border-primary/15"
                            >
                              <XCircle className="w-3 h-3" />
                              Reject
                            </button>
                            <button
                              type="button"
                              disabled={applying === i}
                              onClick={() => applyChanges(changes, i)}
                              className="flex-1 flex items-center justify-center gap-1 text-[11px] py-2 font-medium text-primary hover:bg-primary/10 transition-colors"
                            >
                              {applying === i ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Check className="w-3 h-3" />
                              )}
                              Accept
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Applied badge */}
                      {appliedChanges && (
                        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-accent-green">
                          <Check className="w-3 h-3" />
                          Changes applied
                        </div>
                      )}

                      {/* Dismissed badge */}
                      {msg.changesDismissed && extractChanges(msg.content) && (
                        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-text-dim">
                          <XCircle className="w-3 h-3" />
                          Changes rejected
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            );
          })}

          {streaming && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex justify-start">
              <div className="bg-bg-card border border-border/60 rounded-xl px-2.5 py-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-text-dim" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Action Message */}
        {actionMsg && (
          <div
            className={`mx-3 mb-1 text-[10px] px-2.5 py-1 rounded-lg ${
              actionMsg.type === "success"
                ? "bg-accent-green/10 text-accent-green"
                : "bg-accent-red/10 text-accent-red"
            }`}
          >
            {actionMsg.text}
          </div>
        )}

        {/* Version History (collapsible) */}
        <div className="border-t border-border/60 shrink-0">
          <button
            type="button"
            onClick={() => setVersionsOpen((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] text-text-muted hover:text-text hover:bg-bg-input/50 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <History className="w-3 h-3" />
              <span>Version History</span>
              <span className="text-text-dim">
                ({versions.length} {versions.length === 1 ? "version" : "versions"})
              </span>
            </span>
            {versionsOpen ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronUp className="w-3 h-3" />
            )}
          </button>
          {versionsOpen && (
            <div className="max-h-48 overflow-y-auto px-3 pb-2 space-y-0.5">
              {versions.map((v) => {
                  const isCurrent = v.version === versions[0]?.version;
                  const vTags = parseTags(v.tags);
                  return (
                    <div
                      key={v.version}
                      className={`flex items-center gap-2 text-[11px] py-1.5 px-2 rounded-lg transition-colors ${
                        isCurrent ? "bg-primary/5" : "hover:bg-bg-input/50"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-semibold ${isCurrent ? "text-primary" : "text-text"}`}>
                            v{v.version}
                          </span>
                          {isCurrent && (
                            <span className="text-[9px] px-1.5 py-px rounded-full bg-primary/15 text-primary font-medium">
                              current
                            </span>
                          )}
                          {v.version === 1 && (
                            <span className="text-[9px] text-text-dim">original</span>
                          )}
                          <span className="text-[10px] text-text-dim ml-auto">
                            {formatRelativeTime(v.createdAt)}
                          </span>
                        </div>
                        <div className="text-[10px] text-text-dim truncate mt-0.5">
                          {v.title}
                        </div>
                        {v.version > 1 && v.changedFields.length > 0 && (
                          <div className="text-[9px] text-text-dim mt-0.5 opacity-70">
                            changed: {v.changedFields.join(", ")}
                          </div>
                        )}
                        {vTags.length > 0 && (
                          <div className="flex flex-wrap gap-0.5 mt-0.5">
                            {vTags.slice(0, 3).map((tag) => (
                              <span
                                key={tag}
                                className="text-[9px] px-1 py-px rounded bg-bg-input text-text-dim"
                              >
                                {tag}
                              </span>
                            ))}
                            {vTags.length > 3 && (
                              <span className="text-[9px] text-text-dim">
                                +{vTags.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {!isCurrent && (
                        <button
                          type="button"
                          disabled={restoringVersion === v.version}
                          onClick={() => restoreVersion(v.version)}
                          className="shrink-0 inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-md border border-border hover:border-primary/30 hover:text-primary transition-colors disabled:opacity-50"
                        >
                          {restoringVersion === v.version ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          ) : (
                            <RotateCcw className="w-2.5 h-2.5" />
                          )}
                          Restore
                        </button>
                      )}
                    </div>
                  );
                })}
              {versions.length === 0 && (
                <p className="text-center text-text-dim text-[10px] py-2">
                  No version history yet
                </p>
              )}
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="border-t border-border/60 px-3 py-2 shrink-0">
          <div className="flex items-end gap-1.5">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask AI to rewrite..."
              rows={1}
              className="flex-1 bg-bg-input border border-border rounded-xl px-2.5 py-1.5 text-[12px] text-text placeholder:text-text-dim focus:outline-none focus:border-primary resize-none max-h-20"
              style={{
                height: "auto",
                minHeight: "34px",
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = Math.min(target.scrollHeight, 80) + "px";
              }}
            />
            <button
              type="button"
              disabled={!input.trim() || streaming}
              onClick={() => sendMessage(input)}
              className="p-1.5 rounded-xl bg-primary text-white hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              {streaming ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Triangle tail pointing to the floating ball */}
      <div className="absolute -bottom-2 right-6 w-4 h-4 bg-bg border-r border-b border-border rotate-45" />
    </div>
  );
}
