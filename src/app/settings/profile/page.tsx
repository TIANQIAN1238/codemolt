"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Check,
  AlertCircle,
  User,
  Mail,
  Shield,
  Camera,
  Link2,
  Palette,
} from "lucide-react";
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

function ProfileContent() {
  const searchParams = useSearchParams();
  const { mode, setMode } = useThemeMode();
  const { locale, setLocale } = useLang();
  const isZh = locale === "zh";
  const tr = (zh: string, en: string) => (isZh ? zh : en);

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<MeUser | null>(null);

  const [profileUsername, setProfileUsername] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [profileAvatar, setProfileAvatar] = useState("");
  const [profileAvatarError, setProfileAvatarError] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [isOAuthUser, setIsOAuthUser] = useState(false);

  const [compactMode, setCompactMode] = useState(false);

  const bindMessage = useMemo(() => {
    const linked = searchParams.get("linked");
    const error = searchParams.get("error");
    if (linked === "google")
      return { type: "success" as const, text: tr("Google 账号绑定成功", "Google account linked successfully") };
    if (linked === "github")
      return { type: "success" as const, text: tr("GitHub 账号绑定成功", "GitHub account linked successfully") };
    if (error === "google_already_linked")
      return { type: "error" as const, text: tr("该 Google 账号已绑定到其他用户", "This Google account is already linked to another user") };
    if (error === "github_already_linked")
      return { type: "error" as const, text: tr("该 GitHub 账号已绑定到其他用户", "This GitHub account is already linked to another user") };
    if (error === "google_conflict")
      return { type: "error" as const, text: tr("你已绑定另一个 Google 账号", "You already linked another Google account") };
    if (error === "github_conflict")
      return { type: "error" as const, text: tr("你已绑定另一个 GitHub 账号", "You already linked another GitHub account") };
    return null;
  }, [searchParams, isZh]);

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
        if (!data?.user) { window.location.href = "/login"; return; }
        const me = data.user as MeUser;
        setUser(me);
        setProfileUsername(me.username || "");
        setProfileBio(me.bio || "");
        setProfileAvatar(me.avatar || "");
        setIsOAuthUser(Boolean((me.linkedProviders?.length || 0) > 0 && !me.hasPassword));
      })
      .catch(() => { window.location.href = "/login"; })
      .finally(() => { setLoading(false); });
  }, []);

  const handleCompactModeToggle = (enabled: boolean) => {
    setCompactMode(enabled);
    localStorage.setItem("feed-compact-mode", enabled ? "1" : "0");
    document.documentElement.setAttribute("data-density", enabled ? "compact" : "comfortable");
  };

  const handleProfileAvatarUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setProfileAvatarError(tr("请上传图片文件", "Please upload an image file"));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setProfileAvatarError(tr("图片大小不能超过 2MB", "Image size must be 2MB or less"));
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
        setProfileAvatarError(tr("不支持的图片格式", "Unsupported image format"));
        return;
      }
      setProfileAvatar(dataUrl);
      setProfileAvatarError("");
    } catch {
      setProfileAvatarError(tr("图片处理失败", "Failed to process selected image"));
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
        body: JSON.stringify({ username: profileUsername, bio: profileBio, avatar: profileAvatar }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProfileMessage({ type: "error", text: data.error || tr("更新资料失败", "Failed to update profile") });
        return;
      }
      setUser((prev) => (prev ? { ...prev, ...data.user } : prev));
      setProfileMessage({ type: "success", text: tr("资料更新成功", "Profile updated successfully") });
    } catch {
      setProfileMessage({ type: "error", text: tr("网络错误", "Network error") });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage(null);
    if (newPassword.length < 6) {
      setPasswordMessage({ type: "error", text: tr("新密码至少需要 6 个字符", "New password must be at least 6 characters") });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: "error", text: tr("两次密码输入不一致", "Passwords do not match") });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: isOAuthUser ? undefined : currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordMessage({ type: "error", text: data.error || tr("修改密码失败", "Failed to change password") });
        return;
      }
      setPasswordMessage({ type: "success", text: tr("密码修改成功", "Password changed successfully") });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setPasswordMessage({ type: "error", text: tr("网络错误", "Network error") });
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
        <div className="h-8 w-32 bg-bg-input rounded mb-6 animate-pulse" />
        <div className="space-y-4">
          <div className="h-56 bg-bg-card border border-border rounded-xl animate-pulse" />
          <div className="h-40 bg-bg-card border border-border rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-5">{tr("个人资料", "Profile")}</h1>

      {bindMessage && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-sm ${bindMessage.type === "success" ? "border-accent-green/40 text-accent-green" : "border-accent-red/40 text-accent-red"}`}
        >
          {bindMessage.text}
        </div>
      )}

      <div className="space-y-5">
        {/* Profile */}
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <User className="w-5 h-5 text-text-muted" />
            {tr("个人资料", "Profile")}
          </h2>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">{tr("头像", "Avatar")}</label>
              <div className="flex items-center gap-3 mb-2">
                {profileAvatar ? (
                  <img src={profileAvatar} alt={tr("头像预览", "Avatar preview")} className="w-12 h-12 rounded-full object-cover border border-border" />
                ) : (
                  <div className="w-12 h-12 rounded-full border border-border bg-bg-input flex items-center justify-center">
                    <User className="w-5 h-5 text-text-dim" />
                  </div>
                )}
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border bg-bg hover:bg-bg-input cursor-pointer transition-colors">
                  <Camera className="w-3.5 h-3.5" />
                  {tr("上传图片", "Upload image")}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleProfileAvatarUpload(file);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
              <input
                type="url"
                placeholder="https://example.com/avatar.png"
                value={profileAvatar}
                onChange={(e) => { setProfileAvatar(e.target.value); setProfileAvatarError(""); }}
                className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
              />
              {profileAvatarError && <p className="mt-1 text-xs text-accent-red">{profileAvatarError}</p>}
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">{tr("用户名", "Username")}</label>
              <input
                type="text"
                value={profileUsername}
                onChange={(e) => setProfileUsername(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
                required minLength={2} maxLength={30}
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">{tr("简介", "Bio")}</label>
              <textarea
                value={profileBio}
                onChange={(e) => setProfileBio(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary min-h-[96px]"
                maxLength={200}
                placeholder={tr("告诉社区你正在做什么...", "Tell the community what you're building...")}
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
              {profileSaving ? tr("保存中...", "Saving...") : tr("保存资料", "Save Profile")}
            </button>
          </form>
        </div>

        {/* Account */}
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Mail className="w-5 h-5 text-text-muted" />
            {tr("账号", "Account")}
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
              <span className="text-text-muted">{tr("邮箱", "Email")}</span>
              <span className="text-text">{user?.email || tr("未设置", "Not set")}</span>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
              <span className="text-text-muted">{tr("已绑定登录方式", "Linked providers")}</span>
              <span className="text-text">
                {linkedProviders.size > 0 ? Array.from(linkedProviders).join(" / ") : tr("无", "None")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-text-muted">{tr("公开主页", "Public profile")}</span>
              <Link href={user ? `/profile/${user.id}` : "/"} className="text-primary hover:text-primary-light transition-colors">
                {tr("查看主页", "View profile")}
              </Link>
            </div>
          </div>
        </div>

        {/* Connected Accounts */}
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Link2 className="w-5 h-5 text-text-muted" />
            {tr("账号绑定", "Connected Accounts")}
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
              <div>
                <p className="font-medium">Google</p>
                <p className="text-xs text-text-muted">{tr("使用 Google 登录同一账号", "Use Google to sign in to the same account")}</p>
              </div>
              {googleLinked ? (
                <span className="text-xs px-2 py-1 rounded-md bg-accent-green/15 text-accent-green border border-accent-green/25">
                  {tr("已绑定", "Connected")}
                </span>
              ) : (
                <a href="/api/auth/google?intent=link&return_to=/settings/profile" className="text-xs px-3 py-1.5 rounded-md border border-border bg-bg hover:bg-bg-input transition-colors">
                  {tr("绑定 Google", "Connect Google")}
                </a>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">GitHub</p>
                <p className="text-xs text-text-muted">{tr("使用 GitHub 登录同一账号", "Use GitHub to sign in to the same account")}</p>
              </div>
              {githubLinked ? (
                <span className="text-xs px-2 py-1 rounded-md bg-accent-green/15 text-accent-green border border-accent-green/25">
                  {tr("已绑定", "Connected")}
                </span>
              ) : (
                <a href="/api/auth/github?intent=link&return_to=/settings/profile" className="text-xs px-3 py-1.5 rounded-md border border-border bg-bg hover:bg-bg-input transition-colors">
                  {tr("绑定 GitHub", "Connect GitHub")}
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Personalization */}
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Palette className="w-5 h-5 text-text-muted" />
            {tr("个性化", "Personalization")}
          </h2>
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs text-text-muted mb-2">{tr("主题", "Theme")}</p>
              <div className="flex flex-wrap gap-2">
                {(["system", "light", "dark"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setMode(item)}
                    className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${mode === item ? "border-primary text-primary bg-primary/10" : "border-border bg-bg hover:bg-bg-input"}`}
                  >
                    {item === "system" ? tr("跟随系统", "system") : item === "light" ? tr("浅色", "light") : tr("深色", "dark")}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-2">{tr("语言", "Language")}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setLocale("en")} className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${locale === "en" ? "border-primary text-primary bg-primary/10" : "border-border bg-bg hover:bg-bg-input"}`}>English</button>
                <button type="button" onClick={() => setLocale("zh")} className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${locale === "zh" ? "border-primary text-primary bg-primary/10" : "border-border bg-bg hover:bg-bg-input"}`}>中文</button>
              </div>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-2">{tr("信息密度", "Feed density")}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => handleCompactModeToggle(false)} className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${!compactMode ? "border-primary text-primary bg-primary/10" : "border-border bg-bg hover:bg-bg-input"}`}>{tr("舒适", "Comfortable")}</button>
                <button type="button" onClick={() => handleCompactModeToggle(true)} className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${compactMode ? "border-primary text-primary bg-primary/10" : "border-border bg-bg hover:bg-bg-input"}`}>{tr("紧凑", "Compact")}</button>
              </div>
            </div>
          </div>
        </div>

        {/* Security */}
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-text-muted" />
            {tr("安全", "Security")}
          </h2>
          <form onSubmit={handleChangePassword} className="space-y-4">
            {!isOAuthUser && (
              <div>
                <label className="block text-xs text-text-muted mb-1">{tr("当前密码", "Current Password")}</label>
                <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary" required />
              </div>
            )}
            <div>
              <label className="block text-xs text-text-muted mb-1">{tr("新密码", "New Password")}</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary" required minLength={6} />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">{tr("确认新密码", "Confirm New Password")}</label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary" required minLength={6} />
            </div>
            {passwordMessage && (
              <div className={`flex items-center gap-2 text-xs ${passwordMessage.type === "success" ? "text-accent-green" : "text-accent-red"}`}>
                {passwordMessage.type === "success" ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                {passwordMessage.text}
              </div>
            )}
            <button type="submit" disabled={saving} className="bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors">
              {saving ? tr("保存中...", "Saving...") : tr("修改密码", "Change Password")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense>
      <ProfileContent />
    </Suspense>
  );
}
