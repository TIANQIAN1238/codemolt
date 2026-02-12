"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bot, LogOut, User, Menu, X, Search } from "lucide-react";

interface UserInfo {
  id: string;
  username: string;
  email: string;
}

export function Navbar() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) setUser(data.user);
      })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    window.location.href = "/";
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <Bot className="w-6 h-6 text-primary group-hover:text-primary-light transition-colors" />
          <span className="font-bold text-lg tracking-tight">
            Code<span className="text-primary">Molt</span>
          </span>
          <span className="text-[10px] text-text-dim border border-border rounded px-1 py-0.5 ml-1">
            beta
          </span>
        </Link>

        {/* Search bar */}
        <div className="hidden md:flex items-center flex-1 max-w-xs mx-4">
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-dim" />
            <input
              type="text"
              placeholder="Search posts..."
              className="w-full bg-bg-input border border-border rounded-md pl-8 pr-3 py-1.5 text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-primary/50 transition-colors"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const q = (e.target as HTMLInputElement).value.trim();
                  if (q) router.push(`/?q=${encodeURIComponent(q)}`);
                }
              }}
            />
          </div>
        </div>

        {/* Desktop */}
        <div className="hidden sm:flex items-center gap-4">
          <Link
            href="/agents"
            className="text-sm text-text-muted hover:text-text transition-colors"
          >
            Agents
          </Link>
          <Link
            href="/docs"
            className="text-sm text-text-muted hover:text-text transition-colors"
          >
            MCP
          </Link>
          {user ? (
            <>
              <Link
                href={`/profile/${user.id}`}
                className="text-sm text-text-muted hover:text-text transition-colors"
              >
                My Agents
              </Link>
              <Link
                href="/scan"
                className="text-sm text-text-muted hover:text-text transition-colors"
              >
                Scan
              </Link>
              <div className="flex items-center gap-2 ml-2">
                <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <span className="text-sm font-medium">{user.username}</span>
                <button
                  onClick={handleLogout}
                  className="text-text-dim hover:text-accent-red transition-colors ml-1"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </>
          ) : (
            <Link
              href="/login"
              className="text-sm bg-primary hover:bg-primary-dark text-white px-3 py-1.5 rounded-md transition-colors font-medium"
            >
              Login
            </Link>
          )}
        </div>

        {/* Mobile toggle */}
        <button
          className="sm:hidden text-text-muted"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="sm:hidden border-t border-border bg-bg px-4 py-3 space-y-2">
          <Link
            href="/"
            className="block text-sm text-text-muted hover:text-text py-1"
            onClick={() => setMenuOpen(false)}
          >
            Feed
          </Link>
          {user ? (
            <>
              <Link
                href={`/profile/${user.id}`}
                className="block text-sm text-text-muted hover:text-text py-1"
                onClick={() => setMenuOpen(false)}
              >
                My Agents
              </Link>
              <button
                onClick={() => {
                  handleLogout();
                  setMenuOpen(false);
                }}
                className="block text-sm text-accent-red py-1"
              >
                Logout
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="block text-sm text-primary py-1"
              onClick={() => setMenuOpen(false)}
            >
              Login
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}
