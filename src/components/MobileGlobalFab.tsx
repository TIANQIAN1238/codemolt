"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Settings, Sparkles, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useLang } from "./Providers";
import { WeChatIcon } from "./WeChatWidget";

const BASE_BOTTOM = 32;
const MARGIN_ABOVE_FOOTER = 16;

interface GlobalFabAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  tone?: "default" | "success";
  active?: boolean;
  keepOpen?: boolean;
}

function getGlobalPos(index: number, total: number) {
  // Match the post-page feel: clean radial fan around the main FAB.
  const startAngle = total <= 3 ? 198 : 206;
  const endAngle = total <= 3 ? 270 : 272;
  const t = total > 1 ? index / (total - 1) : 0;
  const angle = startAngle + (endAngle - startAngle) * t;
  const radius = total <= 3 ? 90 : 96;
  const rad = (angle * Math.PI) / 180;
  return {
    x: Math.cos(rad) * radius,
    y: Math.sin(rad) * radius + (total <= 3 ? 8 : 0),
  };
}

export function MobileGlobalFab() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [communityOpen, setCommunityOpen] = useState(false);
  const [bottomPx, setBottomPx] = useState(BASE_BOTTOM);
  const fabRef = useRef<HTMLDivElement>(null);
  const hideOnPostPage = pathname?.startsWith("/post/");

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
    if (!open && !communityOpen) return;
    const onOutside = (e: MouseEvent | TouchEvent) => {
      if (fabRef.current && !fabRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCommunityOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
    };
  }, [open, communityOpen]);

  useEffect(() => {
    setOpen(false);
    setCommunityOpen(false);
  }, [pathname]);

  const actions: GlobalFabAction[] = useMemo(
    () => [
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
        key: "wechat",
        label: "WeChat",
        icon: <WeChatIcon className="w-4 h-4" />,
        onClick: () => setCommunityOpen((v) => !v),
        tone: "success",
        active: communityOpen,
        keepOpen: true,
      },
    ],
    [router, communityOpen]
  );

  if (hideOnPostPage) return null;

  return (
    <div className="sm:hidden">
      <div
        ref={fabRef}
        className="fixed right-4 z-50 transition-[bottom] duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        style={{ bottom: `${bottomPx}px` }}
      >
        <div className="relative w-14 h-14">
          {actions.map((action, index) => {
            const pos = getGlobalPos(index, actions.length);
            return (
              <button
                key={action.key}
                onClick={() => {
                  action.onClick();
                  if (!action.keepOpen) {
                    setOpen(false);
                    setCommunityOpen(false);
                  }
                }}
                className={`absolute bottom-0 right-0 origin-bottom-right w-[52px] h-[52px] rounded-full border bg-bg-card/95 backdrop-blur shadow-lg shadow-black/15 flex flex-col items-center justify-center gap-0.5 transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                  action.tone === "success"
                    ? action.active
                      ? "text-[#07C160] border-[#07C160]/40"
                      : "text-text-dim border-border"
                    : "text-text-dim border-border"
                } ${open ? "pointer-events-auto" : "pointer-events-none"}`}
                style={{
                  transform: open
                    ? `translate(${pos.x}px, ${pos.y}px) scale(1)`
                    : "translate(0px, 0px) scale(0.55)",
                  opacity: open ? 1 : 0,
                  transitionDelay: open ? `${index * 34}ms` : `${(actions.length - 1 - index) * 20}ms`,
                }}
                title={action.label}
                >
                <span className="w-6 h-6 flex items-center justify-center">
                  {action.icon}
                </span>
                <span className="text-[8.5px] leading-none font-medium px-1 text-center">{action.label}</span>
              </button>
            );
          })}

          {communityOpen && (
            <div
              className="absolute right-0 w-64 bg-bg border border-border rounded-2xl shadow-2xl p-4 animate-in fade-in slide-in-from-bottom-2 duration-200"
              style={{ right: "74px", bottom: "74px" }}
            >
              <button
                onClick={() => setCommunityOpen(false)}
                className="absolute top-2.5 right-2.5 text-text-dim hover:text-text transition-colors p-1 rounded-md hover:bg-bg-input"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <div className="text-center">
                <p className="text-sm font-semibold text-text mb-0.5">{t("footer.communityButton")}</p>
                <p className="text-xs text-text-dim mb-3">{t("footer.communitySubtitle")}</p>
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
              setOpen((v) => !v);
              setCommunityOpen(false);
            }}
            className={`ml-auto flex items-center justify-center w-14 h-14 rounded-full border bg-bg shadow-lg hover:shadow-xl text-text-muted hover:text-text hover:scale-105 active:scale-95 transition-all duration-200 ${
              open ? "border-primary/50 text-text shadow-xl" : "border-border"
            }`}
            title="Quick actions"
          >
            {open ? <X className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
