"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Lock, Check, AlertCircle, User, Mail, Shield, Camera, Link2, Palette } from "lucide-react";
import { useLang, useThemeMode } from "@/components/Providers";

interface MeUser {
  id: string;
  email: string | null;
  username: string;
  avatar: string | null;
  bio: string | null;
  provider: string | null;
  hasPassword: boolean;
  linkedProviders?: string[];
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const { mode, setMode } = useThemeMode();
  const { locale, setLocale } = useLang();

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<MeUser | null>(null);

  const [profileUsername, setProfileUsername] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [profileAvatar, setProfileAvatar] = useState("");
  const [profileAvatarError, setProfileAvatarError] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isOAuthUser, setIsOAuthUser] = useState(false);

  const [compactMode, setCompactMode] = useState(false);

  const bindMessage = useMemo(() => {
    const linked = searchParams.get("linked");
    const error = searchParams.get("error");
    if (linked === "google") return { type: "success" as const, text: "Google account linked successfully" };
    if (linked === "github") return { type: "success" as const, text: "GitHub account linked successfully" };
    if (error === "google_already_linked") return { type: "error" as const, text: "This Google account is already linked to another user" };
    if (error === "github_already_linked") return { type: "error" as const, text: "This GitHub account is already linked to another user" };
    if (error === "google_conflict") return { type: "error" as const, text: "You already linked another Google account" };
    if (error === "github_conflict") return { type: "error" as const, text: "You already linked another GitHub account" };
    return null;
  }, [searchParams]);

  useEffect(() => {
    const savedCompact = localStorage.getItem("feed-compact-mode");
    const enabled = savedCompact === "1";
    setCompactMode(enabled);
    document.documentElement.setAttribute("data-density", enabled ? "compact" : "comfortable");
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.user) {
          window.location.href = "/login";
          return;
        }
        const me = data.user as MeUser;
        setUser(me);
        setProfileUsername(me.username || "");
        setProfileBio(me.bio || "");
        setProfileAvatar(me.avatar || "");
        setIsOAuthUser(Boolean((me.linkedProviders?.length || 0) > 0 && !me.hasPassword));
      })
      .catch(() => {
        window.location.href = "/login";
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const handleCompactModeToggle = (enabled: boolean) => {
    setCompactMode(enabled);
    localStorage.setItem("feed-compact-mode", enabled ? "1" : "0");
    document.documentElement.setAttribute("data-density", enabled ? "compact" : "comfortable");
  };

  const handleProfileAvatarUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setProfileAvatarError("Please upload an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setProfileAvatarError("Image size must be 2MB or less");
      return;
    }

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Failed to read image"));
        reader.readAsDataURL(file);
      });
      if (!dataUrl.startsWith("data:image/")) {
        setProfileAvatarError("Unsupported image format");
        return;
      }
      setProfileAvatar(dataUrl);
      setProfileAvatarError("");
    } catch {
      setProfileAvatarError("Failed to process selected image");
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (profileAvatarError) return;

    setProfileMessage(null);
    setProfileSaving(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: profileUsername,
          bio: profileBio,
          avatar: profileAvatar,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProfileMessage({ type: "error", text: data.error || "Failed to update profile" });
        return;
      }
      setUser((prev) => (prev ? { ...prev, ...data.user } : prev));
      setProfileMessage({ type: "success", text: "Profile updated successfully" });
    } catch {
      setProfileMessage({ type: "error", text: "Network error" });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage(null);

    if (newPassword.length < 6) {
      setPasswordMessage({ type: "error", text: "New password must be at least 6 characters" });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: "error", text: "Passwords do not match" });
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
        setPasswordMessage({ type: "error", text: data.error || "Failed to change password" });
        return;
      }
      setPasswordMessage({ type: "success", text: "Password changed successfully" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setPasswordMessage({ type: "error", text: "Network error" });
    } finally {
      setSaving(false);
    }
  };

  const linkedProviders = new Set(user?.linkedProviders || []);
  const googleLinked = linkedProviders.has("google");
  const githubLinked = linkedProviders.has("github");

  if (loading) {
    return (
      <div>
        <div className="h-5 w-28 bg-bg-input rounded mb-6 animate-pulse" />
        <div className="h-8 w-32 bg-bg-input rounded mb-6 animate-pulse" />
        <div className="space-y-4 max-w-3xl">
          <div className="h-56 bg-bg-card border border-border rounded-xl animate-pulse" />
          <div className="h-40 bg-bg-card border border-border rounded-xl animate-pulse" />
          <div className="h-64 bg-bg-card border border-border rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

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

      {bindMessage && (
        <div className={`mb-4 max-w-3xl rounded-lg border px-3 py-2 text-sm ${bindMessage.type === "success" ? "border-accent-green/40 text-accent-green" : "border-accent-red/40 text-accent-red"}`}>
          {bindMessage.text}
        </div>
      )}

      <div className="space-y-5 max-w-3xl">
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <User className="w-5 h-5 text-text-muted" />
            Profile
          </h2>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Avatar</label>
              <div className="flex items-center gap-3 mb-2">
                {profileAvatar ? (
                  <img
                    src={profileAvatar}
                    alt="Avatar preview"
                    className="w-12 h-12 rounded-full object-cover border border-border"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full border border-border bg-bg-input flex items-center justify-center">
                    <User className="w-5 h-5 text-text-dim" />
                  </div>
                )}
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border bg-bg hover:bg-bg-input cursor-pointer transition-colors">
                  <Camera className="w-3.5 h-3.5" />
                  Upload image
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        void handleProfileAvatarUpload(file);
                      }
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
              <input
                type="url"
                placeholder="https://example.com/avatar.png"
                value={profileAvatar}
                onChange={(e) => {
                  setProfileAvatar(e.target.value);
                  setProfileAvatarError("");
                }}
                className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
              />
              {profileAvatarError && <p className="mt-1 text-xs text-accent-red">{profileAvatarError}</p>}
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Username</label>
              <input
                type="text"
                value={profileUsername}
                onChange={(e) => setProfileUsername(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
                required
                minLength={2}
                maxLength={30}
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Bio</label>
              <textarea
                value={profileBio}
                onChange={(e) => setProfileBio(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary min-h-[96px]"
                maxLength={200}
                placeholder="Tell the community what you're building..."
              />
              <p className="text-xs text-text-dim mt-1">{profileBio.length}/200</p>
            </div>
            {profileMessage && (
              <div className={`flex items-center gap-2 text-xs ${profileMessage.type === "success" ? "text-accent-green" : "text-accent-red"}`}>
                {profileMessage.type === "success" ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                {profileMessage.text}
              </div>
            )}
            <button
              type="submit"
              disabled={profileSaving}
              className="bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
            >
              {profileSaving ? "Saving..." : "Save Profile"}
            </button>
          </form>
        </div>

        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Mail className="w-5 h-5 text-text-muted" />
            Account
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
              <span className="text-text-muted">Email</span>
              <span className="text-text">{user?.email || "Not set"}</span>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
              <span className="text-text-muted">Linked providers</span>
              <span className="text-text">{linkedProviders.size > 0 ? Array.from(linkedProviders).join(" / ") : "None"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-text-muted">Public profile</span>
              <Link href={user ? `/profile/${user.id}` : "/"} className="text-primary hover:text-primary-light transition-colors">
                View profile
              </Link>
            </div>
          </div>
        </div>

        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Link2 className="w-5 h-5 text-text-muted" />
            Connected Accounts
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
              <div>
                <p className="font-medium">Google</p>
                <p className="text-xs text-text-muted">Use Google to sign in to the same account</p>
              </div>
              {googleLinked ? (
                <span className="text-xs px-2 py-1 rounded-md bg-accent-green/15 text-accent-green border border-accent-green/25">Connected</span>
              ) : (
                <a
                  href="/api/auth/google?intent=link&return_to=/settings"
                  className="text-xs px-3 py-1.5 rounded-md border border-border bg-bg hover:bg-bg-input transition-colors"
                >
                  Connect Google
                </a>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">GitHub</p>
                <p className="text-xs text-text-muted">Use GitHub to sign in to the same account</p>
              </div>
              {githubLinked ? (
                <span className="text-xs px-2 py-1 rounded-md bg-accent-green/15 text-accent-green border border-accent-green/25">Connected</span>
              ) : (
                <a
                  href="/api/auth/github?intent=link&return_to=/settings"
                  className="text-xs px-3 py-1.5 rounded-md border border-border bg-bg hover:bg-bg-input transition-colors"
                >
                  Connect GitHub
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Palette className="w-5 h-5 text-text-muted" />
            Personalization
          </h2>
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs text-text-muted mb-2">Theme</p>
              <div className="flex flex-wrap gap-2">
                {(["system", "light", "dark"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setMode(item)}
                    className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${mode === item ? "border-primary text-primary bg-primary/10" : "border-border bg-bg hover:bg-bg-input"}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-2">Language</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setLocale("en")}
                  className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${locale === "en" ? "border-primary text-primary bg-primary/10" : "border-border bg-bg hover:bg-bg-input"}`}
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => setLocale("zh")}
                  className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${locale === "zh" ? "border-primary text-primary bg-primary/10" : "border-border bg-bg hover:bg-bg-input"}`}
                >
                  中文
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-2">Feed density</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleCompactModeToggle(false)}
                  className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${!compactMode ? "border-primary text-primary bg-primary/10" : "border-border bg-bg hover:bg-bg-input"}`}
                >
                  Comfortable
                </button>
                <button
                  type="button"
                  onClick={() => handleCompactModeToggle(true)}
                  className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${compactMode ? "border-primary text-primary bg-primary/10" : "border-border bg-bg hover:bg-bg-input"}`}
                >
                  Compact
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-text-muted" />
            Security
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
            {passwordMessage && (
              <div className={`flex items-center gap-2 text-xs ${passwordMessage.type === "success" ? "text-accent-green" : "text-accent-red"}`}>
                {passwordMessage.type === "success" ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                {passwordMessage.text}
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
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}
