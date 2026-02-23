"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Check, Share2 } from "lucide-react";
import { useLang } from "@/components/Providers";

interface TextSelectionToolbarProps {
  containerRef: React.RefObject<HTMLElement | null>;
  onShareAsImage: (text: string) => void;
}

export function TextSelectionToolbar({
  containerRef,
  onShareAsImage,
}: TextSelectionToolbarProps) {
  const { t } = useLang();
  const [selectedText, setSelectedText] = useState("");
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [visible, setVisible] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Detect touch device on mount — disable toolbar to avoid conflict with native selection UI
  useEffect(() => {
    setIsTouchDevice(
      "ontouchstart" in window || navigator.maxTouchPoints > 0,
    );
  }, []);

  const handleSelectionChange = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !containerRef.current) {
      setSelectedText("");
      setPosition(null);
      setVisible(false);
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      setSelectedText("");
      setPosition(null);
      setVisible(false);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!containerRef.current.contains(range.commonAncestorContainer)) {
      setSelectedText("");
      setPosition(null);
      setVisible(false);
      return;
    }

    const rect = range.getBoundingClientRect();
    setSelectedText(text);
    setPosition({
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
    requestAnimationFrame(() => setVisible(true));
  }, [containerRef]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const debouncedHandler = () => {
      clearTimeout(timer);
      timer = setTimeout(handleSelectionChange, 150);
    };
    document.addEventListener("selectionchange", debouncedHandler);
    return () => {
      document.removeEventListener("selectionchange", debouncedHandler);
      clearTimeout(timer);
    };
  }, [handleSelectionChange]);

  // Dismiss on scroll
  useEffect(() => {
    if (!position) return;
    const dismiss = () => {
      setVisible(false);
      setTimeout(() => {
        setSelectedText("");
        setPosition(null);
      }, 150);
    };
    window.addEventListener("scroll", dismiss, { passive: true, once: true });
    return () => window.removeEventListener("scroll", dismiss);
  }, [position]);

  // Dismiss on click outside toolbar
  useEffect(() => {
    if (!position) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (
        toolbarRef.current &&
        toolbarRef.current.contains(e.target as Node)
      )
        return;
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          setVisible(false);
          setTimeout(() => {
            setSelectedText("");
            setPosition(null);
          }, 150);
        }
      }, 100);
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [position]);

  const handleCopyText = useCallback(async () => {
    if (!selectedText) return;
    try {
      await navigator.clipboard.writeText(selectedText);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1500);
    } catch {
      // Silently fail
    }
  }, [selectedText]);

  const handleShareClick = useCallback(() => {
    if (!selectedText) return;
    onShareAsImage(selectedText);
    window.getSelection()?.removeAllRanges();
    setVisible(false);
    setTimeout(() => {
      setSelectedText("");
      setPosition(null);
    }, 150);
  }, [selectedText, onShareAsImage]);

  if (!selectedText || !position || isTouchDevice) return null;

  const toolbarW = toolbarRef.current?.offsetWidth || 160;
  const left = Math.max(
    8,
    Math.min(position.x - toolbarW / 2, window.innerWidth - toolbarW - 8),
  );
  const top = Math.max(8, position.y - 48);

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-border bg-bg-card/95 backdrop-blur-md shadow-lg shadow-black/20 px-1 py-0.5"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(6px)",
        transition: "opacity 150ms ease-out, transform 150ms ease-out",
      }}
    >
      {/* Copy text — fixed min-width to prevent layout shift */}
      <button
        onClick={handleCopyText}
        className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors min-w-[60px] text-text-muted hover:text-text hover:bg-bg-hover"
      >
        {copyFeedback ? (
          <Check className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <Copy className="w-3.5 h-3.5 shrink-0" />
        )}
        {copyFeedback ? t("post.copied") : t("post.copy")}
      </button>

      <div className="w-px h-4 bg-border" />

      {/* Share as poster */}
      <button
        onClick={handleShareClick}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-muted hover:text-primary hover:bg-bg-hover cursor-pointer transition-colors"
      >
        <Share2 className="w-3.5 h-3.5" />
        {t("post.share")}
      </button>
    </div>
  );
}
