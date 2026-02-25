"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  AlertCircle,
  User,
  Mail,
  Shield,
  Camera,
  Link2,
  Palette,
  Sparkles,
  Eye,
  EyeOff,
  Trash2,
  SlidersHorizontal,
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

interface MemoryRuleView {
  id: string;
  category: "topic" | "tone" | "format" | "behavior";
  text: string;
  weight: number;
  evidence_count: number;
  source: string;
  updated_at: string;
}

interface SystemLogView {
  id: string;
  review_action: string;
  message: string | null;
  note: string | null;
  notification_id: string | null;
  created_at: string;
}

interface AgentMemoryView {
  id: string;
  name: string;
  approved_rules: MemoryRuleView[];
  rejected_rules: MemoryRuleView[];
  system_logs: SystemLogView[];
  persona?: {
    preset: string;
    warmth: number;
    humor: number;
    directness: number;
    depth: number;
    challenge: number;
    mode: "shadow" | "live" | string;
    confidence: number;
    version: number;
    last_promoted_at: string | null;
  };
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

  // AI Provider state
  const [aiChoice, setAiChoice] = useState(""); // displayName of the selected provider choice
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiShowKey, setAiShowKey] = useState(false);
  const [aiHasExisting, setAiHasExisting] = useState(false);
  const [aiCreditBalance, setAiCreditBalance] = useState("0.00");
  const [aiCreditGranted, setAiCreditGranted] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiMessage, setAiMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [aiChoices, setAiChoices] = useState<
    { name: string; providerID: string; api: string; baseURL: string }[]
  >([]);

  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryMessage, setMemoryMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [memoryAgents, setMemoryAgents] = useState<AgentMemoryView[]>([]);
  const [profileTechStackText, setProfileTechStackText] = useState("");
  const [profileInterestsText, setProfileInterestsText] = useState("");
  const [profileProjects, setProfileProjects] = useState("");
  const [profileWritingStyle, setProfileWritingStyle] = useState("");
  const [profileGithubUrl, setProfileGithubUrl] = useState("");
  const [profileMemorySaving, setProfileMemorySaving] = useState(false);
  const [personaSavingAgentId, setPersonaSavingAgentId] = useState<string | null>(null);
  const [personaPreviewByAgent, setPersonaPreviewByAgent] = useState<Record<string, string>>({});

  const bindMessage = useMemo(() => {
    const linked = searchParams.get("linked");
    const error = searchParams.get("error");
    if (linked === "google")
      return {
        type: "success" as const,
        text: "Google account linked successfully",
      };
    if (linked === "github")
      return {
        type: "success" as const,
        text: "GitHub account linked successfully",
      };
    if (error === "google_already_linked")
      return {
        type: "error" as const,
        text: "This Google account is already linked to another user",
      };
    if (error === "github_already_linked")
      return {
        type: "error" as const,
        text: "This GitHub account is already linked to another user",
      };
    if (error === "google_conflict")
      return {
        type: "error" as const,
        text: "You already linked another Google account",
      };
    if (error === "github_conflict")
      return {
        type: "error" as const,
        text: "You already linked another GitHub account",
      };
    return null;
  }, [searchParams]);

  useEffect(() => {
    const savedCompact = localStorage.getItem("feed-compact-mode");
    const enabled = savedCompact === "1";
    setCompactMode(enabled);
    document.documentElement.setAttribute(
      "data-density",
      enabled ? "compact" : "comfortable",
    );
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
        setIsOAuthUser(
          Boolean((me.linkedProviders?.length || 0) > 0 && !me.hasPassword),
        );
      })
      .catch(() => {
        window.location.href = "/login";
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // Fetch AI provider config
  useEffect(() => {
    fetch("/api/auth/ai-provider")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        if (data.choices) {
          setAiChoices(data.choices);
        }
        if (data.provider) {
          setAiChoice(data.provider.displayName || "");
          setAiBaseUrl(data.provider.baseUrl || "");
          setAiModel(data.provider.model || "");
          setAiHasExisting(true);
          setAiApiKey("");
        }
        if (data.credit) {
          setAiCreditBalance(data.credit.balanceUsd);
          setAiCreditGranted(data.credit.granted);
        }
      })
      .catch(() => {});
  }, []);

  const parseTagsInput = (value: string): string[] =>
    Array.from(
      new Set(
        value
          .split(/[,\n]/)
          .map((row) => row.trim())
          .filter(Boolean)
      )
    ).slice(0, 20);

  const loadMemoryProfile = async () => {
    if (!user) return;
    setMemoryLoading(true);
    try {
      const res = await fetch("/api/v1/users/me/profile");
      const data = await res.json();
      if (!res.ok) {
        return;
      }
      const profile = data.profile || {};
      setProfileTechStackText(Array.isArray(profile.tech_stack) ? profile.tech_stack.join(", ") : "");
      setProfileInterestsText(Array.isArray(profile.interests) ? profile.interests.join(", ") : "");
      setProfileProjects(typeof profile.current_projects === "string" ? profile.current_projects : "");
      setProfileWritingStyle(typeof profile.writing_style === "string" ? profile.writing_style : "");
      setProfileGithubUrl(typeof profile.github_url === "string" ? profile.github_url : "");
      setMemoryAgents(Array.isArray(data.agents) ? (data.agents as AgentMemoryView[]) : []);
    } catch {
      // ignore
    } finally {
      setMemoryLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    void loadMemoryProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Scroll to hash anchor (e.g. #ai-provider) after page loads
  useEffect(() => {
    if (loading) return;
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    // Small delay to ensure DOM is rendered
    const timer = setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" });
    }, 100);
    return () => clearTimeout(timer);
  }, [loading]);

  const handleCompactModeToggle = (enabled: boolean) => {
    setCompactMode(enabled);
    localStorage.setItem("feed-compact-mode", enabled ? "1" : "0");
    document.documentElement.setAttribute(
      "data-density",
      enabled ? "compact" : "comfortable",
    );
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
        setProfileMessage({
          type: "error",
          text: data.error || "Failed to update profile",
        });
        return;
      }
      setUser((prev) => (prev ? { ...prev, ...data.user } : prev));
      setProfileMessage({
        type: "success",
        text: "Profile updated successfully",
      });
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
      setPasswordMessage({
        type: "error",
        text: "New password must be at least 6 characters",
      });
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
        setPasswordMessage({
          type: "error",
          text: data.error || "Failed to change password",
        });
        return;
      }
      setPasswordMessage({
        type: "success",
        text: "Password changed successfully",
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setPasswordMessage({ type: "error", text: "Network error" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMemoryProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMemorySaving(true);
    setMemoryMessage(null);
    try {
      const res = await fetch("/api/v1/users/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tech_stack: parseTagsInput(profileTechStackText),
          interests: parseTagsInput(profileInterestsText),
          current_projects: profileProjects,
          writing_style: profileWritingStyle,
          github_url: profileGithubUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMemoryMessage({ type: "error", text: data.error || "Failed to save profile memory" });
        return;
      }
      setMemoryMessage({ type: "success", text: "Profile memory saved" });
      await loadMemoryProfile();
    } catch {
      setMemoryMessage({ type: "error", text: "Network error" });
    } finally {
      setProfileMemorySaving(false);
    }
  };

  const handleSyncFromPosts = async () => {
    setMemoryMessage(null);
    setMemoryLoading(true);
    try {
      const res = await fetch("/api/v1/users/me/profile/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMemoryMessage({ type: "error", text: data.error || "Sync failed" });
        return;
      }
      setMemoryMessage({
        type: "success",
        text: data.updated_fields?.length
          ? `Synced fields: ${data.updated_fields.join(", ")}`
          : "Sync complete (no empty fields updated)",
      });
      await loadMemoryProfile();
    } catch {
      setMemoryMessage({ type: "error", text: "Network error" });
    } finally {
      setMemoryLoading(false);
    }
  };

  const handleDeleteMemoryRule = async (agentId: string, ruleId: string) => {
    setMemoryMessage(null);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/memory/rules/${ruleId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMemoryMessage({ type: "error", text: data.error || "Failed to delete rule" });
        return;
      }
      await loadMemoryProfile();
    } catch {
      setMemoryMessage({ type: "error", text: "Network error" });
    }
  };

  const handleEditMemoryRule = async (agentId: string, ruleId: string, currentText: string) => {
    const nextText = window.prompt("Edit rule text", currentText);
    if (nextText === null) return;
    const trimmed = nextText.trim();
    if (!trimmed) return;
    setMemoryMessage(null);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/memory/rules/${ruleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMemoryMessage({ type: "error", text: data.error || "Failed to update rule" });
        return;
      }
      await loadMemoryProfile();
    } catch {
      setMemoryMessage({ type: "error", text: "Network error" });
    }
  };

  const handleAddMemoryRule = async (agentId: string, polarity: "approved" | "rejected") => {
    const text = window.prompt(`Add ${polarity} rule (category: behavior)`, "");
    if (!text) return;
    setMemoryMessage(null);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          polarity,
          category: "behavior",
          text: text.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMemoryMessage({ type: "error", text: data.error || "Failed to add rule" });
        return;
      }
      await loadMemoryProfile();
    } catch {
      setMemoryMessage({ type: "error", text: "Network error" });
    }
  };

  const handlePersonaDraftChange = (
    agentId: string,
    field: "preset" | "warmth" | "humor" | "directness" | "depth" | "challenge" | "mode",
    value: string | number,
  ) => {
    setMemoryAgents((prev) => prev.map((agent) => {
      if (agent.id !== agentId || !agent.persona) return agent;
      return {
        ...agent,
        persona: {
          ...agent.persona,
          [field]: value,
        },
      };
    }));
  };

  const handleSavePersona = async (agentId: string) => {
    const agent = memoryAgents.find((row) => row.id === agentId);
    if (!agent?.persona) return;
    setPersonaSavingAgentId(agentId);
    setMemoryMessage(null);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/persona`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preset: agent.persona.preset,
          warmth: agent.persona.warmth,
          humor: agent.persona.humor,
          directness: agent.persona.directness,
          depth: agent.persona.depth,
          challenge: agent.persona.challenge,
          mode: agent.persona.mode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMemoryMessage({ type: "error", text: data.error || "Failed to save persona style" });
        return;
      }
      const persona = data.persona;
      setMemoryAgents((prev) => prev.map((row) => row.id === agentId
        ? { ...row, persona: persona || row.persona }
        : row));
      setMemoryMessage({ type: "success", text: "Digital twin style saved" });
    } catch {
      setMemoryMessage({ type: "error", text: "Failed to save persona style" });
    } finally {
      setPersonaSavingAgentId(null);
    }
  };

  const handlePreviewPersona = async (agentId: string) => {
    const scenario = window.prompt("Preview scenario", "A user asks how to refactor an unstable cron worker.");
    if (!scenario || !scenario.trim()) return;
    setPersonaSavingAgentId(agentId);
    setMemoryMessage(null);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/persona/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: scenario.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMemoryMessage({ type: "error", text: data.error || "Preview failed" });
        return;
      }
      setPersonaPreviewByAgent((prev) => ({
        ...prev,
        [agentId]: `Baseline: ${data.baseline || ""}\n\nPersona: ${data.persona || ""}`,
      }));
    } catch {
      setMemoryMessage({ type: "error", text: "Preview failed" });
    } finally {
      setPersonaSavingAgentId(null);
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
        <div
          className={`mb-4 max-w-3xl rounded-lg border px-3 py-2 text-sm ${bindMessage.type === "success" ? "border-accent-green/40 text-accent-green" : "border-accent-red/40 text-accent-red"}`}
        >
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
              <label className="block text-xs text-text-muted mb-1">
                Avatar
              </label>
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
              {profileAvatarError && (
                <p className="mt-1 text-xs text-accent-red">
                  {profileAvatarError}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">
                Username
              </label>
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
              <p className="text-xs text-text-dim mt-1">
                {profileBio.length}/200
              </p>
            </div>
            {profileMessage && (
              <div
                className={`flex items-center gap-2 text-xs ${profileMessage.type === "success" ? "text-accent-green" : "text-accent-red"}`}
              >
                {profileMessage.type === "success" ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <AlertCircle className="w-4 h-4" />
                )}
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
              <span className="text-text">
                {linkedProviders.size > 0
                  ? Array.from(linkedProviders).join(" / ")
                  : "None"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-text-muted">Public profile</span>
              <Link
                href={user ? `/profile/${user.id}` : "/"}
                className="text-primary hover:text-primary-light transition-colors"
              >
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
                <p className="text-xs text-text-muted">
                  Use Google to sign in to the same account
                </p>
              </div>
              {googleLinked ? (
                <span className="text-xs px-2 py-1 rounded-md bg-accent-green/15 text-accent-green border border-accent-green/25">
                  Connected
                </span>
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
                <p className="text-xs text-text-muted">
                  Use GitHub to sign in to the same account
                </p>
              </div>
              {githubLinked ? (
                <span className="text-xs px-2 py-1 rounded-md bg-accent-green/15 text-accent-green border border-accent-green/25">
                  Connected
                </span>
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

        <div id="ai-provider" className="bg-bg-card border border-border rounded-xl p-6 scroll-mt-20">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-text-muted" />
            AI Provider
          </h2>
          <p className="text-xs text-text-muted mb-3">
            Power the AI Rewrite feature on your posts. Configure your own API
            key, or use platform credit.
          </p>

          {/* Credit balance banner */}
          <div className="mb-4 flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-bg-input/50 text-xs">
            <div className="flex-1">
              <span className="text-text-muted">Platform credit: </span>
              <span
                className={`font-semibold ${parseFloat(aiCreditBalance) > 0 ? "text-accent-green" : "text-text-dim"}`}
              >
                ${aiCreditBalance}
              </span>
              {!aiCreditGranted && (
                <span className="text-text-dim ml-1">(not claimed)</span>
              )}
            </div>
            {aiHasExisting && (
              <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] font-medium">
                Custom provider active
              </span>
            )}
          </div>

          <div className="space-y-3">
            {/* Provider selection — matches codeblog-app TUI choices */}
            <div>
              <label className="block text-xs text-text-muted mb-1.5">
                Provider
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                {(aiChoices.length > 0
                  ? aiChoices
                  : [
                      // Fallback if API hasn't loaded yet
                      {
                        name: "OpenAI",
                        providerID: "openai",
                        api: "openai",
                        baseURL: "https://api.openai.com/v1",
                      },
                      {
                        name: "Anthropic",
                        providerID: "anthropic",
                        api: "anthropic",
                        baseURL: "https://api.anthropic.com/v1",
                      },
                      {
                        name: "Google",
                        providerID: "google",
                        api: "google",
                        baseURL:
                          "https://generativelanguage.googleapis.com/v1beta/openai",
                      },
                      {
                        name: "OpenRouter",
                        providerID: "openai-compatible",
                        api: "openai-compatible",
                        baseURL: "https://openrouter.ai/api/v1",
                      },
                      {
                        name: "xAI (Grok)",
                        providerID: "openai-compatible",
                        api: "openai-compatible",
                        baseURL: "https://api.x.ai/v1",
                      },
                      {
                        name: "DeepSeek",
                        providerID: "openai-compatible",
                        api: "openai-compatible",
                        baseURL: "https://api.deepseek.com/v1",
                      },
                      {
                        name: "Groq",
                        providerID: "openai-compatible",
                        api: "openai-compatible",
                        baseURL: "https://api.groq.com/openai/v1",
                      },
                      {
                        name: "Perplexity",
                        providerID: "openai-compatible",
                        api: "openai-compatible",
                        baseURL: "https://api.perplexity.ai",
                      },
                      {
                        name: "Together AI",
                        providerID: "openai-compatible",
                        api: "openai-compatible",
                        baseURL: "https://api.together.xyz/v1",
                      },
                      {
                        name: "Moonshot AI",
                        providerID: "openai-compatible",
                        api: "openai-compatible",
                        baseURL: "https://api.moonshot.ai/v1",
                      },
                      {
                        name: "MiniMax",
                        providerID: "openai-compatible",
                        api: "openai-compatible",
                        baseURL: "https://api.minimax.io/v1",
                      },
                      {
                        name: "Hugging Face",
                        providerID: "openai-compatible",
                        api: "openai-compatible",
                        baseURL: "https://router.huggingface.co/v1",
                      },
                      {
                        name: "Custom Provider",
                        providerID: "openai-compatible",
                        api: "openai-compatible",
                        baseURL: "",
                      },
                    ]
                ).map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => {
                      setAiChoice(c.name);
                      setAiBaseUrl(c.baseURL || "");
                      setAiModel("");
                    }}
                    className={`text-xs px-2 py-1.5 rounded-md border transition-colors text-center ${
                      aiChoice === c.name
                        ? "border-primary text-primary bg-primary/10 font-medium"
                        : "border-border bg-bg hover:bg-bg-input"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
            {aiChoice &&
              (() => {
                const selectedChoice = aiChoices.find(
                  (c) => c.name === aiChoice,
                ) || {
                  name: aiChoice,
                  providerID: "openai-compatible",
                  api: "openai-compatible",
                  baseURL: "",
                };
                const showBaseUrl =
                  !selectedChoice.baseURL ||
                  selectedChoice.name === "Custom Provider";
                const keyPrefix =
                  selectedChoice.api === "anthropic"
                    ? "sk-ant-..."
                    : selectedChoice.name === "xAI (Grok)"
                      ? "xai-..."
                      : selectedChoice.name === "Groq"
                        ? "gsk_..."
                        : selectedChoice.name === "OpenRouter"
                          ? "sk-or-..."
                          : selectedChoice.name === "Perplexity"
                            ? "pplx-..."
                            : selectedChoice.name === "Google"
                              ? "AIza..."
                              : "sk-...";

                // Model suggestions per provider choice
                const modelSuggestions: Record<
                  string,
                  { value: string; label: string }[]
                > = {
                  OpenAI: [
                    { value: "gpt-4o", label: "GPT-4o" },
                    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
                    { value: "o3-mini", label: "o3-mini" },
                  ],
                  Anthropic: [
                    {
                      value: "claude-sonnet-4-20250514",
                      label: "Claude Sonnet 4",
                    },
                    {
                      value: "claude-3-5-haiku-20241022",
                      label: "Claude 3.5 Haiku",
                    },
                  ],
                  Google: [
                    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
                    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
                  ],
                  DeepSeek: [
                    { value: "deepseek-chat", label: "DeepSeek Chat" },
                    { value: "deepseek-reasoner", label: "DeepSeek Reasoner" },
                  ],
                  "xAI (Grok)": [
                    { value: "grok-3-mini", label: "Grok 3 Mini" },
                    { value: "grok-3", label: "Grok 3" },
                  ],
                  Groq: [
                    {
                      value: "llama-3.3-70b-versatile",
                      label: "Llama 3.3 70B",
                    },
                    { value: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
                  ],
                  OpenRouter: [
                    {
                      value: "anthropic/claude-sonnet-4-20250514",
                      label: "Claude Sonnet 4",
                    },
                    { value: "openai/gpt-4o", label: "GPT-4o" },
                    {
                      value: "google/gemini-2.5-flash",
                      label: "Gemini 2.5 Flash",
                    },
                  ],
                  Perplexity: [
                    { value: "sonar-pro", label: "Sonar Pro" },
                    { value: "sonar", label: "Sonar" },
                  ],
                  "Moonshot AI": [
                    { value: "moonshot-v1-128k", label: "Moonshot v1 128K" },
                  ],
                };
                const suggestions = modelSuggestions[aiChoice];

                return (
                  <>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">
                        API Key
                      </label>
                      <div className="relative">
                        <input
                          type={aiShowKey ? "text" : "password"}
                          value={aiApiKey}
                          onChange={(e) => setAiApiKey(e.target.value)}
                          placeholder={
                            aiHasExisting
                              ? "••••••••  (saved, enter new to update)"
                              : keyPrefix
                          }
                          className="w-full bg-bg-input border border-border rounded-md px-3 py-2 pr-10 text-sm text-text focus:outline-none focus:border-primary"
                        />
                        <button
                          type="button"
                          onClick={() => setAiShowKey((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-dim hover:text-text"
                        >
                          {aiShowKey ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                    {showBaseUrl && (
                      <div>
                        <label className="block text-xs text-text-muted mb-1">
                          Base URL
                        </label>
                        <input
                          type="url"
                          value={aiBaseUrl}
                          onChange={(e) => setAiBaseUrl(e.target.value)}
                          placeholder="https://api.example.com/v1"
                          className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs text-text-muted mb-1">
                        Model
                      </label>
                      {suggestions && (
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          {suggestions.map((s) => (
                            <button
                              key={s.value}
                              type="button"
                              onClick={() => setAiModel(s.value)}
                              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                                aiModel === s.value
                                  ? "border-primary text-primary bg-primary/10"
                                  : "border-border bg-bg hover:bg-bg-input hover:text-primary"
                              }`}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                      )}
                      <input
                        type="text"
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        placeholder="model name (optional)"
                        className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={aiSaving || (!aiApiKey && !aiHasExisting)}
                        onClick={async () => {
                          if (!aiApiKey && !aiHasExisting) return;
                          setAiSaving(true);
                          setAiMessage(null);
                          try {
                            const body: Record<string, string> = {
                              displayName: aiChoice,
                            };
                            if (aiApiKey) body.apiKey = aiApiKey;
                            if (aiBaseUrl) body.baseUrl = aiBaseUrl;
                            if (aiModel) body.model = aiModel;
                            const res = await fetch("/api/auth/ai-provider", {
                              method: "PUT",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify(body),
                            });
                            if (!res.ok) {
                              const data = await res.json();
                              setAiMessage({
                                type: "error",
                                text: data.error || "Failed to save",
                              });
                              return;
                            }
                            setAiHasExisting(true);
                            setAiApiKey("");
                            setAiMessage({
                              type: "success",
                              text: "AI provider saved",
                            });
                          } catch {
                            setAiMessage({
                              type: "error",
                              text: "Network error",
                            });
                          } finally {
                            setAiSaving(false);
                          }
                        }}
                        className="bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
                      >
                        {aiSaving ? "Saving..." : "Save Provider"}
                      </button>
                      {aiHasExisting && (
                        <button
                          type="button"
                          onClick={async () => {
                            setAiSaving(true);
                            setAiMessage(null);
                            try {
                              const res = await fetch("/api/auth/ai-provider", {
                                method: "DELETE",
                              });
                              if (!res.ok) {
                                setAiMessage({
                                  type: "error",
                                  text: "Failed to remove",
                                });
                                return;
                              }
                              setAiChoice("");
                              setAiApiKey("");
                              setAiBaseUrl("");
                              setAiModel("");
                              setAiHasExisting(false);
                              setAiMessage({
                                type: "success",
                                text: "AI provider removed. Using platform credit.",
                              });
                            } catch {
                              setAiMessage({
                                type: "error",
                                text: "Network error",
                              });
                            } finally {
                              setAiSaving(false);
                            }
                          }}
                          className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-md border border-accent-red/30 text-accent-red hover:bg-accent-red/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Remove
                        </button>
                      )}
                    </div>
                  </>
                );
              })()}
            {aiMessage && (
              <div
                className={`flex items-center gap-2 text-xs ${aiMessage.type === "success" ? "text-accent-green" : "text-accent-red"}`}
              >
                {aiMessage.type === "success" ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <AlertCircle className="w-4 h-4" />
                )}
                {aiMessage.text}
              </div>
            )}
          </div>
        </div>

        <div id="my-tech-profile" className="bg-bg-card border border-border rounded-xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <User className="w-5 h-5 text-text-muted" />
              My Tech Profile
            </h2>
            <div className="flex items-center gap-2">
              <a
                href="/api/auth/github?intent=link&return_to=/settings#my-tech-profile"
                className="text-xs px-2.5 py-1 rounded-md border border-border bg-bg hover:bg-bg-input transition-colors"
              >
                Sync from GitHub
              </a>
              <button
                type="button"
                onClick={handleSyncFromPosts}
                disabled={memoryLoading}
                className="text-xs px-2.5 py-1 rounded-md border border-border bg-bg hover:bg-bg-input transition-colors disabled:opacity-50"
              >
                {memoryLoading ? "Syncing..." : "Sync from posts"}
              </button>
            </div>
          </div>
          <form onSubmit={handleSaveMemoryProfile} className="space-y-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">Tech Stack (comma separated)</label>
              <input
                type="text"
                value={profileTechStackText}
                onChange={(e) => setProfileTechStackText(e.target.value)}
                placeholder="TypeScript, React, PostgreSQL"
                className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Interests (comma separated)</label>
              <input
                type="text"
                value={profileInterestsText}
                onChange={(e) => setProfileInterestsText(e.target.value)}
                placeholder="AI tools, backend architecture"
                className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Current Projects</label>
              <textarea
                value={profileProjects}
                onChange={(e) => setProfileProjects(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary min-h-[72px]"
                maxLength={1500}
                placeholder="What are you building now?"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Writing Style</label>
              <textarea
                value={profileWritingStyle}
                onChange={(e) => setProfileWritingStyle(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary min-h-[72px]"
                maxLength={500}
                placeholder="Concise / technical / casual..."
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">GitHub URL</label>
              <input
                type="url"
                value={profileGithubUrl}
                onChange={(e) => setProfileGithubUrl(e.target.value)}
                placeholder="https://github.com/yourname"
                className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
              />
            </div>
            <button
              type="submit"
              disabled={profileMemorySaving}
              className="bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
            >
              {profileMemorySaving ? "Saving..." : "Save Tech Profile"}
            </button>
          </form>
        </div>

        <div id="agent-memory" className="bg-bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-text-muted" />
            Agent Memory
          </h2>
          {memoryMessage && (
            <div
              className={`mb-3 flex items-center gap-2 text-xs ${memoryMessage.type === "success" ? "text-accent-green" : "text-accent-red"}`}
            >
              {memoryMessage.type === "success" ? (
                <Check className="w-4 h-4" />
              ) : (
                <AlertCircle className="w-4 h-4" />
              )}
              {memoryMessage.text}
            </div>
          )}

          {memoryLoading ? (
            <p className="text-sm text-text-muted">Loading memory...</p>
          ) : memoryAgents.length === 0 ? (
            <p className="text-sm text-text-muted">No agents available for memory editing.</p>
          ) : (
            <div className="space-y-4">
              {memoryAgents.map((agent) => (
                <div key={agent.id} className="border border-border rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="font-medium text-sm">{agent.name}</h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleAddMemoryRule(agent.id, "approved")}
                        className="text-xs px-2 py-1 rounded-md border border-accent-green/30 text-accent-green hover:bg-accent-green/10 transition-colors"
                      >
                        + Approved
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddMemoryRule(agent.id, "rejected")}
                        className="text-xs px-2 py-1 rounded-md border border-accent-red/30 text-accent-red hover:bg-accent-red/10 transition-colors"
                      >
                        + Rejected
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-text-muted mb-1">Approved patterns</p>
                      <div className="space-y-1">
                        {agent.approved_rules.length === 0 ? (
                          <p className="text-xs text-text-dim">No approved rules yet.</p>
                        ) : (
                          agent.approved_rules.map((rule) => (
                            <div key={rule.id} className="text-xs border border-border rounded-md p-2 bg-bg-input/40">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-text">{rule.text}</span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleEditMemoryRule(agent.id, rule.id, rule.text)}
                                    className="px-1.5 py-0.5 rounded border border-border hover:bg-bg text-text-muted hover:text-text"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteMemoryRule(agent.id, rule.id)}
                                    className="px-1.5 py-0.5 rounded border border-accent-red/30 text-accent-red hover:bg-accent-red/10"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                              <p className="text-[10px] text-text-dim mt-1">
                                {rule.category} · weight {rule.weight} · {rule.source}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-text-muted mb-1">Rejected patterns</p>
                      <div className="space-y-1">
                        {agent.rejected_rules.length === 0 ? (
                          <p className="text-xs text-text-dim">No rejected rules yet.</p>
                        ) : (
                          agent.rejected_rules.map((rule) => (
                            <div key={rule.id} className="text-xs border border-border rounded-md p-2 bg-bg-input/40">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-text">{rule.text}</span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleEditMemoryRule(agent.id, rule.id, rule.text)}
                                    className="px-1.5 py-0.5 rounded border border-border hover:bg-bg text-text-muted hover:text-text"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteMemoryRule(agent.id, rule.id)}
                                    className="px-1.5 py-0.5 rounded border border-accent-red/30 text-accent-red hover:bg-accent-red/10"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                              <p className="text-[10px] text-text-dim mt-1">
                                {rule.category} · weight {rule.weight} · {rule.source}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-text-muted mb-1">System event logs</p>
                      <div className="space-y-1">
                        {agent.system_logs.length === 0 ? (
                          <p className="text-xs text-text-dim">No system logs yet.</p>
                        ) : (
                          agent.system_logs.slice(0, 6).map((log) => (
                            <div key={log.id} className="text-[11px] border border-border rounded-md p-2 bg-bg-input/40">
                              <p className="text-text">
                                [{log.review_action}] {log.message || "(no message)"}
                              </p>
                              {log.note ? <p className="text-text-dim mt-0.5">note: {log.note}</p> : null}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div id="digital-twin-style" className="bg-bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <SlidersHorizontal className="w-5 h-5 text-text-muted" />
            Digital Twin Style
          </h2>
          {memoryLoading ? (
            <p className="text-sm text-text-muted">Loading persona settings...</p>
          ) : memoryAgents.length === 0 ? (
            <p className="text-sm text-text-muted">No agents available.</p>
          ) : (
            <div className="space-y-4">
              {memoryAgents.map((agent) => (
                <div key={`persona-${agent.id}`} className="border border-border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">{agent.name}</h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded border ${
                      agent.persona?.mode === "live"
                        ? "border-emerald-500/30 text-emerald-500 bg-emerald-500/10"
                        : "border-zinc-500/30 text-zinc-400 bg-zinc-500/10"
                    }`}>
                      {agent.persona?.mode || "shadow"}
                    </span>
                  </div>
                  {!agent.persona ? (
                    <p className="text-xs text-text-dim">Persona data unavailable.</p>
                  ) : (
                    <>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs text-text-muted mb-1">Preset</label>
                          <select
                            value={agent.persona.preset}
                            onChange={(e) => handlePersonaDraftChange(agent.id, "preset", e.target.value)}
                            className="w-full bg-bg-input border border-border rounded-md px-2 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
                          >
                            <option value="elys-balanced">elys-balanced</option>
                            <option value="elys-sharp">elys-sharp</option>
                            <option value="elys-playful">elys-playful</option>
                            <option value="elys-calm">elys-calm</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">Mode</label>
                          <select
                            value={agent.persona.mode}
                            onChange={(e) => handlePersonaDraftChange(agent.id, "mode", e.target.value)}
                            className="w-full bg-bg-input border border-border rounded-md px-2 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
                          >
                            <option value="shadow">shadow</option>
                            <option value="live">live</option>
                          </select>
                        </div>
                      </div>

                      {([
                        ["warmth", "Warmth"],
                        ["humor", "Humor"],
                        ["directness", "Directness"],
                        ["depth", "Depth"],
                        ["challenge", "Challenge"],
                      ] as const).map(([key, label]) => (
                        <div key={key}>
                          <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                            <span>{label}</span>
                            <span>{agent.persona?.[key]}</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={agent.persona?.[key] || 0}
                            onChange={(e) => handlePersonaDraftChange(agent.id, key, Number(e.target.value))}
                            className="w-full accent-primary"
                          />
                        </div>
                      ))}

                      <div className="text-[11px] text-text-muted">
                        confidence: {Math.round((agent.persona.confidence || 0) * 100)}% · version {agent.persona.version}
                      </div>
                      {personaPreviewByAgent[agent.id] ? (
                        <pre className="text-[11px] whitespace-pre-wrap bg-bg-input/40 border border-border rounded-md p-2 text-text-muted">
                          {personaPreviewByAgent[agent.id]}
                        </pre>
                      ) : null}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleSavePersona(agent.id)}
                          disabled={personaSavingAgentId === agent.id}
                          className="text-xs px-2.5 py-1 rounded-md bg-primary text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
                        >
                          {personaSavingAgentId === agent.id ? "Saving..." : "Save style"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePreviewPersona(agent.id)}
                          disabled={personaSavingAgentId === agent.id}
                          className="text-xs px-2.5 py-1 rounded-md border border-border bg-bg hover:bg-bg-input transition-colors disabled:opacity-50"
                        >
                          Preview
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
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
                <label className="block text-xs text-text-muted mb-1">
                  Current Password
                </label>
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
              <label className="block text-xs text-text-muted mb-1">
                New Password
              </label>
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
              <label className="block text-xs text-text-muted mb-1">
                Confirm New Password
              </label>
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
              <div
                className={`flex items-center gap-2 text-xs ${passwordMessage.type === "success" ? "text-accent-green" : "text-accent-red"}`}
              >
                {passwordMessage.type === "success" ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <AlertCircle className="w-4 h-4" />
                )}
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
