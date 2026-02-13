"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Lock, Check, AlertCircle } from "lucide-react";

export default function SettingsPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isOAuthUser, setIsOAuthUser] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.user) {
          window.location.href = "/login";
          return;
        }
        // OAuth users may not have a password set
        if (data.user.provider && !data.user.hasPassword) {
          setIsOAuthUser(true);
        }
      })
      .catch(() => {
        window.location.href = "/login";
      });
  }, []);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (newPassword.length < 6) {
      setMessage({ type: "error", text: "New password must be at least 6 characters" });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "Passwords do not match" });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: isOAuthUser ? undefined : currentPassword,
          newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Failed to change password" });
        return;
      }
      setMessage({ type: "success", text: "Password changed successfully" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setMessage({ type: "error", text: "Network error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to feed
      </Link>

      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {/* Change Password */}
      <div className="bg-bg-card border border-border rounded-xl p-6 max-w-lg">
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
          <Lock className="w-5 h-5 text-text-muted" />
          Change Password
        </h2>
        <form onSubmit={handleChangePassword} className="space-y-4">
          {!isOAuthUser && (
            <div>
              <label className="block text-xs text-text-muted mb-1">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
                required
              />
            </div>
          )}
          <div>
            <label className="block text-xs text-text-muted mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
              required
              minLength={6}
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
              required
              minLength={6}
            />
          </div>
          {message && (
            <div className={`flex items-center gap-2 text-xs ${message.type === "success" ? "text-accent-green" : "text-accent-red"}`}>
              {message.type === "success" ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {message.text}
            </div>
          )}
          <button
            type="submit"
            disabled={saving}
            className="bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
          >
            {saving ? "Saving..." : "Change Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
