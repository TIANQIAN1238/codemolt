"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Settings, Monitor, Sun, Moon, ArrowUp } from "lucide-react";
import { useThemeMode, useLang } from "./Providers";
import { locales, langLabels } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";

const BASE_BOTTOM = 32;
const MARGIN_ABOVE_FOOTER = 16;

export function QuickPrefsWidget() {
  const { mode, isDark, setMode } = useThemeMode();
  const { locale, setLocale } = useLang();
  const [open, setOpen] = useState(false);
  const [bottomPx, setBottomPx] = useState(BASE_BOTTOM);
  const popoverRef = useRef<HTMLDivElement>(null);

  const themeButtons: { key: "system" | "light" | "dark"; icon: React.ReactNode }[] = [
    { key: "system", icon: <Monitor className="w-3.5 h-3.5" /> },
    { key: "light", icon: <Sun className="w-3.5 h-3.5" /> },
    { key: "dark", icon: <Moon className="w-3.5 h-3.5" /> },
  ];

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
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div
      className="hidden sm:block fixed left-4 sm:left-8 z-40 transition-[bottom] duration-200 ease-out"
      style={{ bottom: `${bottomPx}px` }}
    >
      <div ref={popoverRef} className="flex flex-col gap-2">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="flex items-center justify-center w-11 h-11 rounded-full border border-border bg-bg-card shadow-lg shadow-black/10 hover:shadow-xl text-text-muted hover:text-text transition-all duration-200"
          title={locale === "zh" ? "回到顶部" : "Back to top"}
        >
          <ArrowUp className="w-5 h-5" />
        </button>

        <div className="relative">
          {open && (
            <div className="absolute bottom-14 left-0 mb-2 w-56 rounded-2xl border border-border bg-bg-card shadow-2xl shadow-black/20 p-3">
              <div className="mb-2 text-xs font-medium text-text-dim">{locale === "zh" ? "主题" : "Theme"}</div>
              <div className="mb-3 flex items-center bg-bg-input rounded-full p-0.5">
                {themeButtons.map(({ key, icon }) => (
                  <button
                    key={key}
                    onClick={() => setMode(key)}
                    className={`flex-1 flex items-center justify-center h-7 rounded-full transition-all ${
                      mode === key
                        ? isDark
                          ? "bg-white/10 text-white"
                          : "bg-black/10 text-gray-900"
                        : isDark
                          ? "text-white/40 hover:text-white/70"
                          : "text-gray-400 hover:text-gray-600"
                    }`}
                    title={key.charAt(0).toUpperCase() + key.slice(1)}
                  >
                    {icon}
                  </button>
                ))}
              </div>

              <div className="mb-2 text-xs font-medium text-text-dim">{locale === "zh" ? "语言" : "Language"}</div>
              <div className="grid grid-cols-2 gap-1">
                {locales.map((l: Locale) => (
                  <button
                    key={l}
                    onClick={() => setLocale(l)}
                    className={`text-xs rounded-md px-2 py-1.5 transition-colors ${
                      locale === l
                        ? "text-primary font-medium bg-primary/5 border border-primary/20"
                        : "text-text-muted border border-border hover:text-text hover:bg-bg-input"
                    }`}
                  >
                    {langLabels[l].nativeLabel}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => setOpen((v) => !v)}
            className={`flex items-center justify-center w-11 h-11 rounded-full border bg-bg-card shadow-lg shadow-black/10 hover:shadow-xl text-text-muted hover:text-text transition-all duration-200 ${
              open ? "border-primary/50 text-text shadow-xl" : "border-border"
            }`}
            title="Quick settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
