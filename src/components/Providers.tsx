"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import type { Locale } from "@/lib/i18n";
import { defaultLocale, getDictionary } from "@/lib/i18n";
import { Toaster, toast } from "sonner";
import { AuthProvider, useAuth } from "@/lib/AuthContext";

// ==================== Theme ====================
type ThemeMode = "system" | "light" | "dark";

interface ThemeContextType {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  mode: "dark",
  isDark: true,
  setMode: () => {},
});

export function useThemeMode() {
  return useContext(ThemeContext);
}

// ==================== Language ====================
interface LangContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const LangContext = createContext<LangContextType>({
  locale: defaultLocale,
  setLocale: () => {},
  t: (key: string) => key,
});

export function useLang() {
  return useContext(LangContext);
}

// ==================== Combined Provider ====================
export function Providers({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("dark");
  const [isDark, setIsDark] = useState(true);
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  const [dict, setDict] = useState<Record<string, string>>(getDictionary(defaultLocale));
  const [mounted, setMounted] = useState(false);
  const presenceStartedRef = useRef(false);

  const syncLocaleToServer = useCallback((l: Locale) => {
    void fetch("/api/auth/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: l }),
    }).catch(() => {});
  }, []);

  // Init from localStorage
  useEffect(() => {
    const savedMode = localStorage.getItem("theme-mode") as ThemeMode | null;
    const savedLocale = localStorage.getItem("locale") as Locale | null;
    if (savedMode) setModeState(savedMode);
    if (savedLocale) {
      setLocaleState(savedLocale);
      setDict(getDictionary(savedLocale));
      syncLocaleToServer(savedLocale);
    } else {
      syncLocaleToServer(defaultLocale);
    }
    setMounted(true);
  }, [syncLocaleToServer]);

  // Apply theme
  useEffect(() => {
    if (!mounted) return;

    const applyTheme = () => {
      let dark: boolean;
      if (mode === "dark") {
        dark = true;
      } else if (mode === "light") {
        dark = false;
      } else {
        dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      }
      setIsDark(dark);
      document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    };

    applyTheme();

    if (mode === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", applyTheme);
      return () => mq.removeEventListener("change", applyTheme);
    }
  }, [mode, mounted]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    localStorage.setItem("theme-mode", m);
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    setDict(getDictionary(l));
    localStorage.setItem("locale", l);
    document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
    syncLocaleToServer(l);
  }, [syncLocaleToServer]);

  const t = useCallback(
    (key: string) => dict[key] || key,
    [dict]
  );

  useEffect(() => {
    if (!mounted || presenceStartedRef.current) return;
    presenceStartedRef.current = true;

    let timer: ReturnType<typeof setInterval> | null = null;
    let active = true;

    const reportPresence = (action: "heartbeat" | "offline") => {
      void fetch("/api/auth/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
        keepalive: action === "offline",
      }).catch(() => {});
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        reportPresence("heartbeat");
      }
    };

    const onPageHide = () => {
      reportPresence("offline");
    };

    const bootstrapPresence = async () => {
      const me = await fetch("/api/auth/me").catch(() => null);
      if (!active || !me?.ok) return;
      const data = await me.json().catch(() => null);
      if (!active || !data?.user) return;

      const summaryRes = await fetch(`/api/v1/agents/me/away-summary?locale=${locale}`).catch(() => null);
      if (active && summaryRes?.ok) {
        const summaryData = await summaryRes.json().catch(() => null);
        if (summaryData?.summary?.message) {
          toast(t("notifications.awayTitle"), {
            description: summaryData.summary.message,
            icon: "🤖",
            duration: 7000,
          });
        }
      }
      if (!active) return;

      reportPresence("heartbeat");
      timer = setInterval(() => {
        reportPresence("heartbeat");
      }, 60_000);

      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("pagehide", onPageHide);
    };

    void bootstrapPresence();

    return () => {
      active = false;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [locale, mounted, t]);

  return (
    <AuthProvider>
      <ThemeContext.Provider value={{ mode, isDark, setMode }}>
        <LangContext.Provider value={{ locale, setLocale, t }}>
          {children}
          <Toaster
            position="bottom-center"
            theme={isDark ? "dark" : "light"}
            richColors
            offset={40}
          />
        </LangContext.Provider>
      </ThemeContext.Provider>
    </AuthProvider>
  );
}
