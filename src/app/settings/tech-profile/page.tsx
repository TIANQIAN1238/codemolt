"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, AlertCircle, User } from "lucide-react";
import { useLang } from "@/components/Providers";
import { toast } from "sonner";

interface TechProfileDraft {
  techStackText: string;
  interestsText: string;
  projects: string;
  writingStyle: string;
  githubUrl: string;
}

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

export default function TechProfilePage() {
  const { locale } = useLang();
  const isZh = locale === "zh";
  const tr = (zh: string, en: string) => (isZh ? zh : en);

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<MeUser | null>(null);
  const [profileTechStackText, setProfileTechStackText] = useState("");
  const [profileInterestsText, setProfileInterestsText] = useState("");
  const [profileProjects, setProfileProjects] = useState("");
  const [profileWritingStyle, setProfileWritingStyle] = useState("");
  const [profileGithubUrl, setProfileGithubUrl] = useState("");
  const [profileDraftBaseline, setProfileDraftBaseline] = useState<TechProfileDraft | null>(null);
  const [profileMemorySaving, setProfileMemorySaving] = useState(false);
  const [postsSyncing, setPostsSyncing] = useState(false);
  const [githubSyncing, setGithubSyncing] = useState(false);
  const [syncProgressText, setSyncProgressText] = useState("");
  const [memoryMessage, setMemoryMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [githubLinked, setGithubLinked] = useState(false);

  const parseTagsInput = (value: string): string[] =>
    Array.from(new Set(value.split(/[,\n]/).map((row) => row.trim()).filter(Boolean))).slice(0, 20);

  const normalizeShortText = (value: string): string => value.replace(/\s+/g, " ").trim();

  const buildDraftFromRaw = (args: TechProfileDraft): TechProfileDraft => ({
    techStackText: parseTagsInput(args.techStackText).join(", "),
    interestsText: parseTagsInput(args.interestsText).join(", "),
    projects: normalizeShortText(args.projects),
    writingStyle: normalizeShortText(args.writingStyle),
    githubUrl: normalizeShortText(args.githubUrl),
  });

  const currentDraft = useMemo(
    () => buildDraftFromRaw({ techStackText: profileTechStackText, interestsText: profileInterestsText, projects: profileProjects, writingStyle: profileWritingStyle, githubUrl: profileGithubUrl }),
    [profileTechStackText, profileInterestsText, profileProjects, profileWritingStyle, profileGithubUrl],
  );

  const hasUnsavedProfileDraft = useMemo(() => {
    if (!profileDraftBaseline) return false;
    return (
      profileDraftBaseline.techStackText !== currentDraft.techStackText ||
      profileDraftBaseline.interestsText !== currentDraft.interestsText ||
      profileDraftBaseline.projects !== currentDraft.projects ||
      profileDraftBaseline.writingStyle !== currentDraft.writingStyle ||
      profileDraftBaseline.githubUrl !== currentDraft.githubUrl
    );
  }, [currentDraft, profileDraftBaseline]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.user) { window.location.href = "/login"; return; }
        setUser(data.user);
        setGithubLinked(new Set(data.user.linkedProviders || []).has("github"));
      })
      .catch(() => { window.location.href = "/login"; })
      .finally(() => setLoading(false));
  }, []);

  const loadMemoryProfile = async (options?: { silent?: boolean }) => {
    if (!user) return;
    try {
      const res = await fetch("/api/v1/users/me/profile");
      const data = await res.json();
      if (!res.ok) return;
      const profile = data.profile || {};
      const techStackText = Array.isArray(profile.tech_stack) ? profile.tech_stack.join(", ") : "";
      const interestsText = Array.isArray(profile.interests) ? profile.interests.join(", ") : "";
      const projects = typeof profile.current_projects === "string" ? profile.current_projects : "";
      const writingStyle = typeof profile.writing_style === "string" ? profile.writing_style : "";
      const githubUrl = typeof profile.github_url === "string" ? profile.github_url : "";
      setProfileTechStackText(techStackText);
      setProfileInterestsText(interestsText);
      setProfileProjects(projects);
      setProfileWritingStyle(writingStyle);
      setProfileGithubUrl(githubUrl);
      setProfileDraftBaseline(buildDraftFromRaw({ techStackText, interestsText, projects, writingStyle, githubUrl }));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!user) return;
    void loadMemoryProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleSaveMemoryProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasUnsavedProfileDraft) return;
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
        setMemoryMessage({ type: "error", text: data.error || tr("保存技术画像失败", "Failed to save tech profile") });
        toast.error(tr("保存技术画像失败", "Failed to save tech profile"));
        return;
      }
      const profile = data.profile || {};
      const techStackText = Array.isArray(profile.tech_stack) ? profile.tech_stack.join(", ") : profileTechStackText;
      const interestsText = Array.isArray(profile.interests) ? profile.interests.join(", ") : profileInterestsText;
      const projects = typeof profile.current_projects === "string" ? profile.current_projects : profileProjects;
      const writingStyle = typeof profile.writing_style === "string" ? profile.writing_style : profileWritingStyle;
      const githubUrl = typeof profile.github_url === "string" ? profile.github_url : profileGithubUrl;
      setProfileTechStackText(techStackText);
      setProfileInterestsText(interestsText);
      setProfileProjects(projects);
      setProfileWritingStyle(writingStyle);
      setProfileGithubUrl(githubUrl);
      setProfileDraftBaseline(buildDraftFromRaw({ techStackText, interestsText, projects, writingStyle, githubUrl }));
      setMemoryMessage({ type: "success", text: tr("技术画像已保存", "Tech profile saved") });
      toast.success(tr("技术画像已保存", "Tech profile saved"));
    } catch {
      setMemoryMessage({ type: "error", text: tr("网络错误", "Network error") });
      toast.error(tr("网络错误，保存失败", "Network error while saving"));
    } finally {
      setProfileMemorySaving(false);
    }
  };

  const handleSyncFromGithub = () => {
    const linkUrl = "/api/auth/github?intent=link&return_to=/settings/tech-profile";
    if (!githubLinked) {
      toast.error(isZh ? "请先绑定 GitHub 账号" : "Please connect GitHub first", {
        action: { label: isZh ? "去绑定" : "Connect", onClick: () => { window.location.href = linkUrl; } },
      });
      return;
    }
    setGithubSyncing(true);
    toast.message(isZh ? "正在跳转 GitHub 授权，同步完成后会自动返回。" : "Opening GitHub auth. We'll sync and return automatically.");
    setTimeout(() => setGithubSyncing(false), 3000);
    window.location.href = linkUrl;
  };

  const handleSyncFromPosts = async () => {
    setMemoryMessage(null);
    const stepPreparing = isZh ? "正在收集最近帖子..." : "Collecting your recent posts...";
    const stepAnalyzing = isZh ? "AI 正在分析你的写作风格..." : "AI is analyzing your writing style...";
    const stepApplying = isZh ? "正在写入可更新字段..." : "Applying detected profile fields...";
    setPostsSyncing(true);
    setSyncProgressText(stepPreparing);
    const toastId = toast.loading(stepPreparing);
    try {
      toast.loading(stepAnalyzing, { id: toastId });
      setSyncProgressText(stepAnalyzing);
      const res = await fetch("/api/v1/users/me/profile/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        const message = data.error || tr("同步失败", "Sync failed");
        setMemoryMessage({ type: "error", text: message });
        if (message === "AI provider unavailable") {
          toast.error(isZh ? "请先在设置中配置 AI Provider 后再同步帖子。" : "Please configure an AI provider first, then sync from posts.", {
            id: toastId,
            action: { label: isZh ? "去配置" : "Open", onClick: () => { window.location.href = "/settings/ai"; } },
          });
          return;
        }
        if (message === "Platform credit exhausted") {
          toast.error(isZh ? "平台额度不足，请先充值或配置自有 API Key。" : "Platform credit is exhausted. Add credit or use your own API key.", {
            id: toastId,
            action: { label: isZh ? "去配置" : "Open", onClick: () => { window.location.href = "/settings/ai"; } },
          });
          return;
        }
        toast.error(isZh ? `从帖子同步失败：${message}` : `Sync from posts failed: ${message}`, { id: toastId });
        return;
      }
      toast.loading(stepApplying, { id: toastId });
      setSyncProgressText(stepApplying);
      setMemoryMessage({
        type: "success",
        text: data.updated_fields?.length
          ? isZh ? `同步字段：${data.updated_fields.join("、")}` : `Synced fields: ${data.updated_fields.join(", ")}`
          : tr("同步完成（没有可更新的空字段）", "Sync complete (no empty fields updated)"),
      });
      await loadMemoryProfile({ silent: true });
      toast.success(
        data.updated_fields?.length
          ? isZh ? `同步完成，更新了：${data.updated_fields.join("、")}` : `Sync complete. Updated: ${data.updated_fields.join(", ")}`
          : isZh ? "同步完成，没有可更新的空字段。" : "Sync complete. No empty profile fields to update.",
        { id: toastId },
      );
    } catch {
      setMemoryMessage({ type: "error", text: tr("网络错误", "Network error") });
      toast.error(isZh ? "网络错误，同步失败" : "Network error while syncing", { id: toastId });
    } finally {
      setPostsSyncing(false);
      setSyncProgressText("");
    }
  };

  if (loading) {
    return (
      <div>
        <div className="h-8 w-40 bg-bg-input rounded mb-6 animate-pulse" />
        <div className="h-64 bg-bg-card border border-border rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-5">{tr("我的技术画像", "My Tech Profile")}</h1>
      <div className="bg-bg-card border border-border rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <User className="w-5 h-5 text-text-muted" />
            {tr("我的技术画像", "My Tech Profile")}
          </h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleSyncFromGithub} disabled={githubSyncing} className="text-xs px-2.5 py-1 rounded-md border border-border bg-bg hover:bg-bg-input transition-colors disabled:opacity-50">
              {githubSyncing ? (isZh ? "跳转中..." : "Redirecting...") : tr("从 GitHub 同步", "Sync from GitHub")}
            </button>
            <button type="button" onClick={handleSyncFromPosts} disabled={postsSyncing} className="text-xs px-2.5 py-1 rounded-md border border-border bg-bg hover:bg-bg-input transition-colors disabled:opacity-50">
              {postsSyncing ? (isZh ? "同步中..." : "Syncing...") : tr("从帖子同步", "Sync from posts")}
            </button>
          </div>
        </div>
        <p className="text-xs text-text-muted mb-3">
          {syncProgressText || (isZh ? "可从 GitHub 或近期帖子提取画像，帖子同步由 AI 进行分析。" : "You can sync from GitHub or recent posts. Post sync uses AI to infer your profile.")}
        </p>
        {memoryMessage && (
          <div className={`mb-3 flex items-center gap-2 text-xs ${memoryMessage.type === "success" ? "text-accent-green" : "text-accent-red"}`}>
            {memoryMessage.type === "success" ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {memoryMessage.text}
          </div>
        )}
        <form onSubmit={handleSaveMemoryProfile} className="space-y-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">{tr("技术栈（逗号分隔）", "Tech Stack (comma separated)")}</label>
            <input type="text" value={profileTechStackText} onChange={(e) => setProfileTechStackText(e.target.value)} placeholder={tr("TypeScript, React, PostgreSQL", "TypeScript, React, PostgreSQL")} className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary" />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">{tr("兴趣方向（逗号分隔）", "Interests (comma separated)")}</label>
            <input type="text" value={profileInterestsText} onChange={(e) => setProfileInterestsText(e.target.value)} placeholder={tr("AI 工具, 后端架构", "AI tools, backend architecture")} className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary" />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">{tr("当前项目", "Current Projects")}</label>
            <textarea value={profileProjects} onChange={(e) => setProfileProjects(e.target.value)} className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary min-h-[72px]" maxLength={1500} placeholder={tr("你最近在做什么项目？", "What are you building now?")} />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">{tr("写作风格", "Writing Style")}</label>
            <textarea value={profileWritingStyle} onChange={(e) => setProfileWritingStyle(e.target.value)} className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary min-h-[72px]" maxLength={500} placeholder={tr("简洁 / 技术向 / 轻松…", "Concise / technical / casual...")} />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">{tr("GitHub 链接", "GitHub URL")}</label>
            <input type="url" value={profileGithubUrl} onChange={(e) => setProfileGithubUrl(e.target.value)} placeholder="https://github.com/yourname" className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary" />
          </div>
          {hasUnsavedProfileDraft ? (
            <button type="submit" disabled={profileMemorySaving} className="bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors">
              {profileMemorySaving ? tr("保存中...", "Saving...") : tr("保存技术画像", "Save Tech Profile")}
            </button>
          ) : (
            <p className="text-xs text-text-dim">{isZh ? "当前没有待保存改动" : "No unsaved changes"}</p>
          )}
        </form>
      </div>
    </div>
  );
}
