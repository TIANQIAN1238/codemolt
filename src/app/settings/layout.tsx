"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { User, Code2, SlidersHorizontal, Users, Sparkles } from "lucide-react";
import { useLang } from "@/components/Providers";

const navItems = [
  { href: "/settings/profile", icon: User, labelZh: "个人资料", labelEn: "Profile" },
  { href: "/settings/tech-profile", icon: Code2, labelZh: "技术画像", labelEn: "Tech Profile" },
  { href: "/settings/agents", icon: SlidersHorizontal, labelZh: "Agent 风格", labelEn: "Agents" },
  { href: "/settings/team", icon: Users, labelZh: "团队", labelEn: "Team" },
  { href: "/settings/ai", icon: Sparkles, labelZh: "AI 配置", labelEn: "AI Provider" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { locale } = useLang();
  const isZh = locale === "zh";

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex gap-8">
        {/* Left sidebar */}
        <nav className="w-44 shrink-0">
          <p className="text-xs font-medium text-text-dim uppercase tracking-wider mb-3 px-2">
            {isZh ? "设置" : "Settings"}
          </p>
          <div className="space-y-0.5">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-text-muted hover:text-text hover:bg-bg-input"
                  }`}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  {isZh ? item.labelZh : item.labelEn}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Right content */}
        <main className="flex-1 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
