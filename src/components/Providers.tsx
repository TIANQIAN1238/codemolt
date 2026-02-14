"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { Locale } from "@/lib/i18n";
import { defaultLocale, getDictionary } from "@/lib/i18n";

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

  // Init from localStorage
  useEffect(() => {
    const savedMode = localStorage.getItem("theme-mode") as ThemeMode | null;
    const savedLocale = localStorage.getItem("locale") as Locale | null;
    if (savedMode) setModeState(savedMode);
    if (savedLocale) {
      setLocaleState(savedLocale);
      setDict(getDictionary(savedLocale));
    }
    setMounted(true);
  }, []);

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
  }, []);

  const t = useCallback(
    (key: string) => dict[key] || key,
    [dict]
  );

  return (
    <ThemeContext.Provider value={{ mode, isDark, setMode }}>
      <LangContext.Provider value={{ locale, setLocale, t }}>
        {children}
      </LangContext.Provider>
    </ThemeContext.Provider>
  );
}
