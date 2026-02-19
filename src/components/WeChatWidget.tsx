"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X } from "lucide-react";
import { useLang } from "./Providers";

const WeChatIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05a6.093 6.093 0 0 1-.247-1.72c0-3.571 3.354-6.467 7.491-6.467.254 0 .503.015.749.038C16.816 4.643 13.119 2.188 8.691 2.188zm-2.6 4.408a1.047 1.047 0 1 1 0 2.094 1.047 1.047 0 0 1 0-2.094zm5.218 0a1.047 1.047 0 1 1 0 2.094 1.047 1.047 0 0 1 0-2.094zM16.746 8.6c-3.645 0-6.6 2.526-6.6 5.64 0 3.115 2.955 5.641 6.6 5.641a8.19 8.19 0 0 0 2.289-.327.672.672 0 0 1 .56.077l1.49.87a.249.249 0 0 0 .13.04.226.226 0 0 0 .227-.226c0-.056-.023-.11-.038-.166l-.305-1.16a.46.46 0 0 1 .166-.519C22.834 17.46 23.946 15.813 23.946 14.24c0-3.114-2.955-5.64-6.6-5.64h-.6zm-2.41 3.267a.868.868 0 1 1 0 1.735.868.868 0 0 1 0-1.735zm4.82 0a.868.868 0 1 1 0 1.735.868.868 0 0 1 0-1.735z" />
  </svg>
);

const BASE_BOTTOM = 32;
const MARGIN_ABOVE_FOOTER = 16;

export function WeChatWidget() {
  const [qrOpen, setQrOpen] = useState(false);
  const [bottomPx, setBottomPx] = useState(BASE_BOTTOM);
  const popoverRef = useRef<HTMLDivElement>(null);
  const { t } = useLang();

  const updatePosition = useCallback(() => {
    const footer = document.querySelector("footer");
    if (!footer) return;
    const footerRect = footer.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const overlap = viewportH - footerRect.top;
    setBottomPx(overlap > 0 ? overlap + MARGIN_ABOVE_FOOTER : BASE_BOTTOM);
  }, []);

  useEffect(() => {
    updatePosition();
    window.addEventListener("scroll", updatePosition, { passive: true });
    window.addEventListener("resize", updatePosition, { passive: true });
    return () => {
      window.removeEventListener("scroll", updatePosition);
      window.removeEventListener("resize", updatePosition);
    };
  }, [updatePosition]);

  useEffect(() => {
    if (!qrOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQrOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setQrOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [qrOpen]);

  return (
    <div
      className="fixed right-8 z-40 transition-[bottom] duration-200 ease-out"
      style={{ bottom: `${bottomPx}px` }}
      ref={popoverRef}
    >
      {/* Popover card — speech bubble above the button */}
      {qrOpen && (
        <div className="absolute bottom-16 right-0 mb-2 w-72 bg-bg border border-border rounded-2xl shadow-2xl p-5 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <button
            onClick={() => setQrOpen(false)}
            className="absolute top-3 right-3 text-text-dim hover:text-text transition-colors p-0.5 rounded-md hover:bg-bg-input"
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

            <div className="bg-white rounded-xl p-3 inline-block">
              <img
                src="/images/wechat-group-qr.jpg"
                alt="WeChat Group QR Code"
                className="w-48 h-48 object-contain"
              />
            </div>

            <p className="text-[11px] text-text-dim mt-2.5 flex items-center justify-center gap-1">
              <WeChatIcon className="w-3 h-3 text-[#07C160]" />
              {t("footer.scanQr")}
            </p>
          </div>

          {/* Triangle tail */}
          <div className="absolute -bottom-2 right-5 w-4 h-4 bg-bg border-r border-b border-border rotate-45" />
        </div>
      )}

      {/* Floating circle button */}
      <button
        onClick={() => setQrOpen(!qrOpen)}
        className={`flex items-center justify-center w-14 h-14 rounded-full border bg-bg shadow-lg hover:shadow-xl text-text-muted hover:text-text hover:scale-105 active:scale-95 transition-all duration-200 ${
          qrOpen ? "border-primary/50 text-text shadow-xl" : "border-border"
        }`}
        title={t("footer.communityButton")}
      >
        <WeChatIcon className="w-6 h-6" />
      </button>
    </div>
  );
}
