"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sun, Moon, Copy, Check, X, Link2 } from "lucide-react";
import { renderPoster, type PosterOptions } from "@/lib/poster-canvas";
import { copyCanvasToClipboard } from "@/lib/poster-utils";
import { useLang, useThemeMode } from "@/components/Providers";

interface SharePosterModalProps {
  selectedText: string;
  postTitle: string;
  agentName: string;
  userName: string;
  authorAvatar?: string | null;
  /** Override the URL used for QR code, share-to-X, and copy-link. Defaults to current page URL. */
  postUrl?: string;
  onClose: () => void;
}

/**
 * X/Twitter weighted char ranges (count as 2):
 * CJK Radicals through CJK Unified Ideographs, CJK Symbols & Punctuation,
 * Hiragana, Katakana, Hangul, CJK Compatibility, Fullwidth Forms, etc.
 */
const XW2 =
  /[\u1100-\u11ff\u2e80-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe10-\ufe6f\uff00-\uffef]/;

/** X/Twitter weighted length: CJK + fullwidth count as 2, others as 1 */
function xWeightedLength(text: string): number {
  let len = 0;
  for (const char of text) {
    len += XW2.test(char) ? 2 : 1;
  }
  return len;
}

/** Slice text to fit within X weighted character budget (reserves 1 for "…") */
function xSlice(text: string, budget: number): string {
  const ellipsis = 2; // "…" (U+2026) counts as 2 on X
  let len = 0;
  let i = 0;
  for (const char of text) {
    const w = XW2.test(char) ? 2 : 1;
    if (len + w + ellipsis > budget) break;
    len += w;
    i++;
  }
  return text.slice(0, i) + "…";
}

function buildTextFragmentUrl(selectedText: string, baseUrl: string): string {
  const base = baseUrl.split("#")[0];
  const trimmed = selectedText.trim();
  if (trimmed.length <= 80) {
    return `${base}#:~:text=${encodeURIComponent(trimmed)}`;
  }
  const words = trimmed.split(/\s+/);
  if (words.length <= 6) {
    return `${base}#:~:text=${encodeURIComponent(trimmed)}`;
  }
  const start = words.slice(0, 4).join(" ");
  const end = words.slice(-4).join(" ");
  return `${base}#:~:text=${encodeURIComponent(start)},${encodeURIComponent(end)}`;
}

export function SharePosterModal({
  selectedText,
  postTitle,
  agentName,
  userName,
  authorAvatar,
  postUrl: postUrlProp,
  onClose,
}: SharePosterModalProps) {
  const { t } = useLang();
  const { isDark } = useThemeMode();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readyRef = useRef(false);
  const [posterTheme, setPosterTheme] = useState<"light" | "dark">(
    isDark ? "dark" : "light",
  );
  const [copySuccess, setCopySuccess] = useState(false);
  const [linkSuccess, setLinkSuccess] = useState(false);
  const [ready, setReady] = useState(false);
  const [closing, setClosing] = useState(false);

  // Open dialog as modal on mount
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  // Native dialog close event (ESC key, etc.)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (e: Event) => {
      // Prevent native close so we can animate
      e.preventDefault();
      triggerClose();
    };
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  });

  const triggerClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      dialogRef.current?.close();
      onClose();
    }, 200);
  }, [closing, onClose]);

  const pageUrl = postUrlProp || (typeof window !== "undefined" ? window.location.href.split("#")[0] : "");

  const draw = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const options: PosterOptions = {
      selectedText,
      postTitle,
      agentName,
      userName,
      authorAvatar,
      postUrl: pageUrl || undefined,
      theme: posterTheme,
    };
    await renderPoster(canvas, options);
    if (!readyRef.current) {
      readyRef.current = true;
      setReady(true);
    }
  }, [selectedText, postTitle, agentName, userName, authorAvatar, posterTheme, pageUrl]);

  useEffect(() => {
    draw();
  }, [draw]);

  const handleCopy = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || copySuccess) return;
    try {
      await copyCanvasToClipboard(canvas);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // Clipboard API might not be available
    }
  }, [copySuccess]);

  const handleCopyLink = useCallback(async () => {
    if (linkSuccess) return;
    try {
      const url = postUrlProp ? pageUrl : buildTextFragmentUrl(selectedText, pageUrl);
      await navigator.clipboard.writeText(url);
      setLinkSuccess(true);
      setTimeout(() => setLinkSuccess(false), 2000);
    } catch {
      // Silently fail
    }
  }, [selectedText, linkSuccess, pageUrl]);

  const handleShareToX = useCallback(() => {
    const budgetForText = 280 - 2 - pageUrl.length - 1; // 2 for "\n\n", 1 for trailing spaces
    const text =
      xWeightedLength(selectedText) > budgetForText
        ? xSlice(selectedText, budgetForText)
        : selectedText;
    const xUrl = `https://x.com/intent/post?text=${encodeURIComponent(text + "\n\n" + pageUrl)}`;
    window.open(xUrl, "_blank", "noopener,noreferrer");
  }, [selectedText, pageUrl]);

  const toggleTheme = useCallback(() => {
    setPosterTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const show = ready && !closing;

  // Secondary button style
  const secondaryBtn =
    "flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-text cursor-pointer transition-all hover:bg-border/60 active:scale-95";

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 m-0 h-dvh w-dvw max-h-dvh max-w-full bg-transparent p-0 open:flex flex-col items-center justify-center gap-5"
      style={
        {
          /* Animate backdrop via inline style on the dialog itself */
        }
      }
      onClick={(e) => {
        if (e.target === dialogRef.current) triggerClose();
      }}
    >
      {/* Backdrop — separate div so we can animate it */}
      <div
        className="fixed inset-0"
        style={{
          backgroundColor: closing ? "rgba(0,0,0,0)" : "rgba(0,0,0,0.6)",
          transition: "background-color 200ms ease-out",
        }}
        onClick={triggerClose}
      />

      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className="relative z-10 flex flex-col items-center justify-center gap-5 p-4 w-fit max-w-[min(90vw,720px)]"
        onClick={(e) => {
          if (e.target === e.currentTarget) triggerClose();
        }}
      >
        {/* Canvas preview */}
        <div
          className="relative overflow-hidden rounded-2xl shadow-2xl inline-block"
          style={{
            opacity: show ? 1 : 0,
            transform: show
              ? "scale(1) translateY(0)"
              : closing
                ? "scale(0.95) translateY(8px)"
                : "scale(0.92) translateY(16px)",
            transition: "opacity 200ms ease-out, transform 200ms ease-out",
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              display: "block",
              maxWidth: "min(90vw, 720px)",
              maxHeight: "70vh",
              width: "auto",
              height: "auto",
            }}
          />
        </div>

        {/* Bottom toolbar + close button */}
        <div
          className="flex items-center gap-2"
          style={{
            opacity: show ? 1 : 0,
            transform: show ? "translateY(0)" : "translateY(12px)",
            transition: closing
              ? "opacity 150ms ease-out, transform 150ms ease-out"
              : "opacity 250ms ease-out 80ms, transform 250ms ease-out 80ms",
          }}
        >
          <div className="flex items-center gap-2 rounded-full border border-border/50 bg-bg-card/95 backdrop-blur-xl shadow-lg px-2 py-1.5">
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="flex items-center justify-center w-8 h-8 rounded-full text-text-secondary hover:text-text hover:bg-border/60 cursor-pointer transition-colors"
              title={
                posterTheme === "dark" ? "Switch to light" : "Switch to dark"
              }
            >
              {posterTheme === "dark" ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>

            <div className="w-px h-4 bg-border/100" />

            {/* Share to X */}
            <button
              onClick={handleShareToX}
              className="flex items-center justify-center w-8 h-8 rounded-full text-text-secondary hover:text-text hover:bg-border/60 cursor-pointer transition-colors"
              title="Share to X"
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </button>

            <div className="w-px h-4 bg-border/100" />

            <div className="flex items-center gap-1.5 pl-1">
              {/* Copy link (text fragment) */}
              <button
                onClick={handleCopyLink}
                className={`${secondaryBtn} justify-center`}
              >
                {linkSuccess ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Link2 className="w-3.5 h-3.5" />
                )}
                {linkSuccess ? t("post.copied") : t("post.copyLink")}
              </button>

              {/* Copy image */}
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary hover:bg-primary-dark px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer transition-all active:scale-95"
              >
                {copySuccess ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copySuccess ? t("post.imageCopied") : t("post.copyImage")}
              </button>
            </div>
          </div>

          {/* Standalone close button */}
          <div className="rounded-full border border-border/50 bg-bg-card/95 backdrop-blur-xl shadow-lg">
            <button
              onClick={triggerClose}
              className="flex items-center justify-center w-8 h-8 rounded-full text-text-secondary hover:text-text hover:bg-border/60 cursor-pointer transition-colors active:scale-95"
              aria-label={t("post.close")}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
