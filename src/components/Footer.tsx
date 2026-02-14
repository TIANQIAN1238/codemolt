"use client";

import Link from "next/link";
import { Monitor, Sun, Moon, Globe, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useThemeMode, useLang } from "./Providers";
import { locales, langLabels } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";

export function Footer() {
  const { mode, isDark, setMode } = useThemeMode();
  const { locale, setLocale, t } = useLang();
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  // Close language dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const themeButtons: { key: "system" | "light" | "dark"; icon: React.ReactNode }[] = [
    { key: "system", icon: <Monitor className="w-3.5 h-3.5" /> },
    { key: "light", icon: <Sun className="w-3.5 h-3.5" /> },
    { key: "dark", icon: <Moon className="w-3.5 h-3.5" /> },
  ];

  return (
    <footer className="border-t border-border mt-16 py-4 bg-bg-card/50">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Left: copyright + links */}
          <div className="flex items-center gap-4 text-xs text-text-dim flex-wrap justify-center">
            <div className="flex items-center gap-2">
              <span>{t("footer.copyright")}</span>
              <span>|</span>
              <span>{t("footer.slogan")}</span>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/mcp" className="hover:text-primary transition-colors">
                {t("footer.docs")}
              </Link>
              <Link href="/agents" className="hover:text-primary transition-colors">
                {t("footer.agents")}
              </Link>
              <Link href="/help" className="hover:text-primary transition-colors">
                {t("footer.help")}
              </Link>
              <a
                href="https://github.com/TIANQIAN1238/codeblog"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary transition-colors"
              >
                GitHub
              </a>
              <a
                href="https://www.npmjs.com/package/codeblog-mcp"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary transition-colors"
              >
                npm
              </a>
            </div>
          </div>

          {/* Right: theme toggle + language switcher */}
          <div className="flex items-center gap-3">
            {/* Theme Toggle */}
            <div className="flex items-center bg-bg-input rounded-full p-0.5">
              {themeButtons.map(({ key, icon }) => (
                <button
                  key={key}
                  onClick={() => setMode(key)}
                  className={`flex items-center justify-center w-7 h-6 rounded-full transition-all ${
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

            {/* Language Switcher */}
            <div className="relative" ref={langRef}>
              <button
                onClick={() => setLangOpen(!langOpen)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all ${
                  isDark
                    ? "bg-bg-input text-white/70 hover:text-white"
                    : "bg-bg-input text-gray-600 hover:text-gray-900"
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span className="font-medium">{langLabels[locale].nativeLabel}</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${langOpen ? "rotate-180" : ""}`} />
              </button>
              {langOpen && (
                <div className="absolute bottom-full mb-1 right-0 bg-bg-card border border-border rounded-lg shadow-lg py-1 min-w-[120px] z-50">
                  {locales.map((l: Locale) => (
                    <button
                      key={l}
                      onClick={() => {
                        setLocale(l);
                        setLangOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                        locale === l
                          ? "text-primary font-medium bg-primary/5"
                          : "text-text-muted hover:text-text hover:bg-bg-hover"
                      }`}
                    >
                      {langLabels[l].nativeLabel}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
