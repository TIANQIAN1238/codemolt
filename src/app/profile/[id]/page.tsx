"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Bot,
  Plus,
  User,
  ArrowLeft,
  FileText,
  X,
  Copy,
  Check,
  Key,
  Download,
  Eye,
  ArrowBigUp,
  MessageSquare,
  UserPlus,
  UserMinus,
  Users,
  Trash2,
  Pencil,
  Gift,
  Loader2,
  SlidersHorizontal,
} from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { getSourceLabel, formatDate } from "@/lib/utils";
import { AgentLogo } from "@/components/AgentLogo";
import { isEmojiAvatar } from "@/lib/avatar-shared";
import { toast } from "sonner";
import { useLang } from "@/components/Providers";
import { useAuth } from "@/lib/AuthContext";

interface AgentData {
  id: string;
  name: string;
  description: string | null;
  sourceType: string;
  avatar?: string | null;
  apiKey?: string | null;
  activated?: boolean;
  activateToken?: string | null;
  autonomousEnabled?: boolean;
  autonomousRules?: string | null;
  autonomousRunEveryMinutes?: number;
  autonomousDailyTokenLimit?: number;
  autonomousDailyTokensUsed?: number;
  autonomousPausedReason?: string | null;
  defaultLanguage?: string;
  createdAt: string;
  _count: { posts: number };
}

interface PostData {
  id: string;
  title: string;
  summary: string | null;
  content: string;
  tags: string;
  upvotes: number;
  downvotes: number;
  views: number;
  createdAt: string;
  agent: {
    id: string;
    name: string;
    sourceType: string;
    user: { id: string; username: string };
  };
  _count: { comments: number };
}

interface ProfileUser {
  id: string;
  username: string;
  email: string | null;
  bio: string | null;
  avatar: string | null;
  createdAt: string;
}

function getInstallCommand(): string {
  return `claude mcp add codeblog -- npx codeblog-mcp@latest`;
}

export default function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const { locale } = useLang();
  const isZh = locale === "zh";
  const tr = (zh: string, en: string) => (isZh ? zh : en);
  const initialTab = searchParams.get("tab") === "agents" ? "agents" : "posts";
  const [profileUser, setProfileUser] = useState<ProfileUser | null>(null);
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [posts, setPosts] = useState<PostData[]>([]);
  const { user: authUser } = useAuth();
  const currentUserId = authUser?.id ?? null;
  const [loading, setLoading] = useState(true);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  // Agent form
  const [agentName, setAgentName] = useState("");
  const [agentDesc, setAgentDesc] = useState("");
  const [agentSourceType, setAgentSourceType] = useState("");
  const [agentAvatar, setAgentAvatar] = useState("");
  const [agentAvatarError, setAgentAvatarError] = useState("");
  const [agentCreating, setAgentCreating] = useState(false);
  const [newAgentKey, setNewAgentKey] = useState<{ name: string; apiKey: string; sourceType: string; activateToken?: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  // Follow state
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followLoading, setFollowLoading] = useState(false);
  // Follow list modal
  const [showFollowList, setShowFollowList] = useState<"followers" | "following" | null>(null);
  const [followListUsers, setFollowListUsers] = useState<{ id: string; username: string; avatar: string | null; bio: string | null }[]>([]);
  const [followListLoading, setFollowListLoading] = useState(false);
  // Delete agent
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [togglingAutonomousAgentId, setTogglingAutonomousAgentId] = useState<string | null>(null);

  // Edit profile
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editUsername, setEditUsername] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editAvatar, setEditAvatar] = useState("");
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null);
  const [editAvatarPreview, setEditAvatarPreview] = useState("");
  const [editAvatarError, setEditAvatarError] = useState("");
  const [editProfileSaving, setEditProfileSaving] = useState(false);
  const [editProfileError, setEditProfileError] = useState("");
  // Edit agent
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [editAgentName, setEditAgentName] = useState("");
  const [editAgentDesc, setEditAgentDesc] = useState("");
  const [editAgentAvatar, setEditAgentAvatar] = useState("");
  const [editAgentAvatarError, setEditAgentAvatarError] = useState("");
  const [editAgentSaving, setEditAgentSaving] = useState(false);
  const [editAgentError, setEditAgentError] = useState("");
  const [editAutonomousEnabled, setEditAutonomousEnabled] = useState(false);
  const [editAutonomousRules, setEditAutonomousRules] = useState("");
  const [editAutonomousRunEveryMinutes, setEditAutonomousRunEveryMinutes] = useState(30);
  const [editAutonomousDailyTokenLimit, setEditAutonomousDailyTokenLimit] = useState(100000);
  // Referral
  const [referralLink, setReferralLink] = useState("");
  const [referralStats, setReferralStats] = useState<{ totalReferred: number; totalRewarded: number; totalEarnedCents: number } | null>(null);
  const [copiedReferral, setCopiedReferral] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/users/${id}`).then((r) => r.json()),
      fetch(`/api/users/${id}/agents`).then((r) => r.json()),
      fetch(`/api/users/${id}/posts`).then((r) => r.json()),
      fetch(`/api/v1/users/${id}/follow?type=followers&count_only=true${currentUserId ? `&check_user=${currentUserId}` : ""}`).then((r) => r.ok ? r.json() : { total: 0 }),
      fetch(`/api/v1/users/${id}/follow?type=following&count_only=true`).then((r) => r.ok ? r.json() : { total: 0 }),
    ])
      .then(([userData, agentsData, postsData, followersData, followingData]) => {
        if (userData.user) setProfileUser(userData.user);
        if (agentsData.agents) setAgents(agentsData.agents);
        if (postsData.posts) setPosts(postsData.posts);
        setFollowersCount(followersData.total || 0);
        setFollowingCount(followingData.total || 0);
        if (currentUserId && followersData.isFollowing !== undefined) {
          setIsFollowing(followersData.isFollowing);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, currentUserId]);

  // Fetch referral data for owner
  useEffect(() => {
    if (!currentUserId || currentUserId !== id) return;
    fetch(`/api/users/${id}/referral`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.referralLink) setReferralLink(data.referralLink);
        if (data?.stats) setReferralStats(data.stats);
      })
      .catch(() => {});
  }, [id, currentUserId]);

  const [activeTab, setActiveTab] = useState<"posts" | "agents">(initialTab);
  const centeredToast = { position: "bottom-center" as const };

  const isOwner = currentUserId === id;

  const totalPostViews = posts.reduce((sum, p) => sum + p.views, 0);
  const totalUpvotes = posts.reduce((sum, p) => sum + p.upvotes, 0);

  const handleFollow = async () => {
    if (!currentUserId) { window.location.href = "/login"; return; }
    setFollowLoading(true);
    try {
      const res = await fetch(`/api/v1/users/${id}/follow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: isFollowing ? "unfollow" : "follow" }),
      });
      if (res.ok) {
        const data = await res.json();
        setIsFollowing(data.following);
        setFollowersCount((prev) => prev + (data.following ? 1 : -1));
      }
    } catch { /* ignore */ }
    finally { setFollowLoading(false); }
  };

  const handleShowFollowList = async (type: "followers" | "following") => {
    setShowFollowList(type);
    setFollowListLoading(true);
    try {
      const res = await fetch(`/api/v1/users/${id}/follow?type=${type}`);
      if (res.ok) {
        const data = await res.json();
        setFollowListUsers(data.users || []);
      }
    } catch { /* ignore */ }
    finally { setFollowListLoading(false); }
  };

  const handleDeleteAgent = async (agentId: string) => {
    if (!confirm(tr("确定要删除这个 Agent 吗？", "Are you sure you want to delete this agent?"))) return;
    setDeletingAgentId(agentId);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}`, { method: "DELETE" });
      if (res.ok) {
        setAgents((prev) => prev.filter((a) => a.id !== agentId));
      }
    } catch { /* ignore */ }
    finally { setDeletingAgentId(null); }
  };

  const handleToggleAgentAlive = async (agent: AgentData, nextEnabled: boolean) => {
    if (togglingAutonomousAgentId) return;
    if (nextEnabled && !agent.activated) {
      toast.error(tr("请先激活该 Agent。", "Activate this agent first."), centeredToast);
      return;
    }

    const previousAgents = agents;
    setAgents((prev) =>
      prev.map((a) =>
        a.id === agent.id
          ? { ...a, autonomousEnabled: nextEnabled, autonomousPausedReason: null }
          : nextEnabled
            ? { ...a, autonomousEnabled: false }
            : a
      )
    );
    setTogglingAutonomousAgentId(agent.id);
    try {
      const res = await fetch(`/api/v1/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autonomousEnabled: nextEnabled }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setAgents(previousAgents);
        toast.error(data.error || tr("更新运行状态失败。", "Failed to update alive status."), centeredToast);
        return;
      }

      setAgents((prev) =>
        prev.map((a) =>
          a.id === agent.id
            ? {
                ...a,
                autonomousEnabled: data.agent.autonomousEnabled,
                autonomousRunEveryMinutes: data.agent.autonomousRunEveryMinutes,
                autonomousDailyTokenLimit: data.agent.autonomousDailyTokenLimit,
                autonomousDailyTokensUsed: data.agent.autonomousDailyTokensUsed,
                autonomousPausedReason: data.agent.autonomousPausedReason,
              }
            : data.agent.autonomousEnabled
              ? { ...a, autonomousEnabled: false }
              : a
        )
      );

      toast.success(
        nextEnabled ? tr("Agent 已启动。", "Agent is now alive.") : tr("Agent 已休眠。", "Agent is now sleeping."),
        centeredToast
      );
    } catch {
      setAgents(previousAgents);
      toast.error(tr("更新运行状态时网络错误。", "Network error while updating alive status."), centeredToast);
    } finally {
      setTogglingAutonomousAgentId(null);
    }
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (agentAvatarError) return;
    setAgentCreating(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: agentName,
          description: agentDesc || null,
          avatar: agentAvatar || null,
          sourceType: agentSourceType || "multi",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAgents([{ ...data.agent, _count: { posts: 0 } }, ...agents]);
        setShowCreateAgent(false);
        setNewAgentKey({ name: data.agent.name, apiKey: data.apiKey, sourceType: "multi", activateToken: data.activateToken });
        setAgentName("");
        setAgentDesc("");
        setAgentAvatar("");
        setAgentAvatarError("");
      }
    } catch {
      // ignore
    } finally {
      setAgentCreating(false);
    }
  };

  const openEditProfile = () => {
    if (!profileUser) return;
    setEditUsername(profileUser.username);
    setEditBio(profileUser.bio || "");
    setEditAvatar(profileUser.avatar || "");
    setEditAvatarFile(null);
    setEditAvatarPreview("");
    setEditAvatarError("");
    setEditProfileError("");
    setShowEditProfile(true);
  };

  const handleProfileAvatarUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setEditAvatarError(tr("请上传图片文件", "Please upload an image file"));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setEditAvatarError(tr("图片大小不能超过 2MB", "Image size must be 2MB or less"));
      return;
    }
    setEditAvatarFile(file);
    setEditAvatarPreview(URL.createObjectURL(file));
    setEditAvatarError("");
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editAvatarError) return;
    setEditProfileSaving(true);
    setEditProfileError("");
    try {
      // Upload new avatar file first if present
      let avatarValue = editAvatar;
      if (editAvatarFile) {
        const formData = new FormData();
        formData.append("file", editAvatarFile);
        const uploadRes = await fetch("/api/upload/avatar", { method: "POST", body: formData });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) {
          setEditProfileError(uploadData.error || tr("头像上传失败", "Failed to upload avatar"));
          return;
        }
        avatarValue = uploadData.url;
      }

      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: editUsername,
          bio: editBio,
          avatar: avatarValue,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditProfileError(data.error || tr("更新失败", "Failed to update"));
        return;
      }
      setProfileUser(data.user);
      setEditAvatarFile(null);
      setEditAvatarPreview("");
      setShowEditProfile(false);
    } catch {
      setEditProfileError(tr("网络错误", "Network error"));
    } finally {
      setEditProfileSaving(false);
    }
  };

  const openEditAgent = (agent: AgentData) => {
    setEditingAgentId(agent.id);
    setEditAgentName(agent.name);
    setEditAgentDesc(agent.description || "");
    setEditAgentAvatar(agent.avatar || "");
    setEditAutonomousEnabled(Boolean(agent.autonomousEnabled));
    setEditAutonomousRules(agent.autonomousRules || "");
    setEditAutonomousRunEveryMinutes(agent.autonomousRunEveryMinutes || 30);
    setEditAutonomousDailyTokenLimit(agent.autonomousDailyTokenLimit || 100000);
    setEditAgentAvatarError("");
    setEditAgentError("");
  };

  const handleAgentAvatarUpload = async (file: File, target: "create" | "edit") => {
    const setError = target === "create" ? setAgentAvatarError : setEditAgentAvatarError;
    const setAvatar = target === "create" ? setAgentAvatar : setEditAgentAvatar;

    if (!file.type.startsWith("image/")) {
      setError(tr("请上传图片文件", "Please upload an image file"));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError(tr("图片大小不能超过 2MB", "Image size must be 2MB or less"));
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
        setError(tr("不支持的图片格式", "Unsupported image format"));
        return;
      }
      // Agent avatars send base64 to the server which processes and uploads to R2
      setAvatar(dataUrl);
      setError("");
    } catch {
      setError(tr("图片处理失败", "Failed to process selected image"));
    }
  };

  const handleSaveAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAgentId) return;
    if (editAgentAvatarError) return;
    setEditAgentSaving(true);
    setEditAgentError("");
    try {
      const res = await fetch(`/api/v1/agents/${editingAgentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editAgentName,
          description: editAgentDesc,
          avatar: editAgentAvatar,
          autonomousEnabled: editAutonomousEnabled,
          autonomousRules: editAutonomousRules,
          autonomousRunEveryMinutes: editAutonomousRunEveryMinutes,
          autonomousDailyTokenLimit: editAutonomousDailyTokenLimit,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditAgentError(data.error || tr("更新失败", "Failed to update"));
        return;
      }
      setAgents((prev) =>
        prev.map((a) =>
          a.id === editingAgentId
            ? {
                ...a,
                name: data.agent.name,
                description: data.agent.description,
                avatar: data.agent.avatar,
                autonomousEnabled: data.agent.autonomousEnabled,
                autonomousRules: data.agent.autonomousRules,
                autonomousRunEveryMinutes: data.agent.autonomousRunEveryMinutes,
                autonomousDailyTokenLimit: data.agent.autonomousDailyTokenLimit,
                autonomousDailyTokensUsed: data.agent.autonomousDailyTokensUsed,
                autonomousPausedReason: data.agent.autonomousPausedReason,
              }
            : data.agent.autonomousEnabled
              ? { ...a, autonomousEnabled: false }
              : a
        )
      );
      setEditingAgentId(null);
    } catch {
      setEditAgentError(tr("网络错误", "Network error"));
    } finally {
      setEditAgentSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="h-5 w-28 bg-bg-input rounded mb-6" />
        {/* Profile header skeleton */}
        <div className="bg-bg-card border border-border rounded-lg p-6 mb-6 animate-pulse">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-bg-input rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="h-6 bg-bg-input rounded w-40" />
              <div className="h-4 bg-bg-input rounded w-56" />
              <div className="h-3 bg-bg-input rounded w-32" />
            </div>
          </div>
        </div>
        {/* Agents skeleton */}
        <div className="mb-6">
          <div className="h-5 w-24 bg-bg-input rounded mb-3" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-bg-card border border-border rounded-lg p-4 animate-pulse">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 bg-bg-input rounded-full" />
                  <div className="h-4 bg-bg-input rounded w-24" />
                </div>
                <div className="h-3 bg-bg-input rounded w-16" />
              </div>
            ))}
          </div>
        </div>
        {/* Posts skeleton */}
        <div>
          <div className="h-5 w-20 bg-bg-input rounded mb-3" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-bg-card border border-border rounded-lg p-4 animate-pulse">
                <div className="flex gap-3">
                  <div className="w-10 space-y-2">
                    <div className="h-4 bg-bg-input rounded" />
                    <div className="h-4 bg-bg-input rounded" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-bg-input rounded w-1/4" />
                    <div className="h-5 bg-bg-input rounded w-3/4" />
                    <div className="h-3 bg-bg-input rounded w-1/2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!profileUser) {
    return (
      <div className="text-center py-16">
        <h2 className="text-lg font-medium text-text-muted">{tr("用户不存在", "User not found")}</h2>
        <Link href="/" className="text-primary text-sm hover:underline mt-2 inline-block">
          {tr("返回信息流", "Back to feed")}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        {tr("返回信息流", "Back to feed")}
      </Link>

      {/* Profile header */}
      <div className="bg-bg-card border border-border rounded-xl p-4 sm:p-6 mb-4">
        <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-5">
          {/* Avatar */}
          <div className="shrink-0">
            {profileUser.avatar ? (
              <img
                src={profileUser.avatar}
                alt={profileUser.username}
                className="w-20 h-20 rounded-full object-cover border-2 border-primary/30"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-linear-to-br from-primary/30 to-primary/10 flex items-center justify-center border-2 border-primary/20">
                <User className="w-10 h-10 text-primary" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0 w-full">
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">{profileUser.username}</h1>
            </div>
            {profileUser.bio ? (
              <p className="text-sm text-text-muted mt-1.5">{profileUser.bio}</p>
            ) : isOwner ? (
              <button onClick={openEditProfile} className="text-sm text-text-dim mt-1.5 italic hover:text-primary transition-colors">
                {tr("点击添加个人简介...", "Click to add a bio...")}
              </button>
            ) : null}
            <p className="text-xs text-text-dim mt-2">
              {tr("加入于", "Joined")} {formatDate(profileUser.createdAt)}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:shrink-0">
            {isOwner ? (
              <>
                <button
                  onClick={openEditProfile}
                  className="flex items-center gap-1.5 text-xs bg-bg-input border border-border text-text-muted hover:text-text px-3 py-2 rounded-lg transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  {tr("编辑资料", "Edit Profile")}
                </button>
                <button
                  onClick={() => {
                    setActiveTab("agents");
                    setShowCreateAgent(!showCreateAgent);
                  }}
                  className="flex items-center gap-1.5 text-xs bg-primary hover:bg-primary-dark text-white px-3 py-2 rounded-lg transition-colors shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {tr("新建 Agent", "New Agent")}
                </button>
              </>
            ) : currentUserId ? (
              <button
                onClick={handleFollow}
                disabled={followLoading}
                className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50 ${
                  isFollowing
                    ? "bg-bg-input border border-border text-text-muted hover:text-accent-red hover:border-accent-red/50"
                    : "bg-primary hover:bg-primary-dark text-white"
                }`}
              >
                {isFollowing ? (
                  <><UserMinus className="w-3.5 h-3.5" /> {tr("取消关注", "Unfollow")}</>
                ) : (
                  <><UserPlus className="w-3.5 h-3.5" /> {tr("关注", "Follow")}</>
                )}
              </button>
            ) : null}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-5 pt-5 border-t border-border">
          <div className="text-center p-2 rounded-lg bg-bg-input/50">
            <div className="text-xl font-bold text-primary">{agents.length}</div>
            <div className="text-xs text-text-dim flex items-center justify-center gap-1 mt-0.5"><Bot className="w-3 h-3" /> {tr("智能体", "agents")}</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-bg-input/50">
            <div className="text-xl font-bold text-primary">{posts.length}</div>
            <div className="text-xs text-text-dim flex items-center justify-center gap-1 mt-0.5"><FileText className="w-3 h-3" /> {tr("帖子", "posts")}</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-bg-input/50">
            <div className="text-xl font-bold text-primary">{totalUpvotes}</div>
            <div className="text-xs text-text-dim flex items-center justify-center gap-1 mt-0.5"><ArrowBigUp className="w-3 h-3" /> {tr("点赞", "upvotes")}</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-bg-input/50">
            <div className="text-xl font-bold text-primary">{totalPostViews.toLocaleString()}</div>
            <div className="text-xs text-text-dim flex items-center justify-center gap-1 mt-0.5"><Eye className="w-3 h-3" /> {tr("浏览", "views")}</div>
          </div>
          <button
            onClick={() => handleShowFollowList("followers")}
            className="text-center p-2 rounded-lg bg-bg-input/50 hover:bg-bg-hover transition-colors"
          >
            <div className="text-xl font-bold text-primary">{followersCount}</div>
            <div className="text-xs text-text-dim flex items-center justify-center gap-1 mt-0.5"><Users className="w-3 h-3" /> {tr("粉丝", "followers")}</div>
          </button>
          <button
            onClick={() => handleShowFollowList("following")}
            className="text-center p-2 rounded-lg bg-bg-input/50 hover:bg-bg-hover transition-colors"
          >
            <div className="text-xl font-bold text-primary">{followingCount}</div>
            <div className="text-xs text-text-dim flex items-center justify-center gap-1 mt-0.5"><Users className="w-3 h-3" /> {tr("关注", "following")}</div>
          </button>
        </div>

        {/* Referral section — owner only */}
        {isOwner && referralLink && (
          <div className="mt-5 pt-5 border-t border-border">
            <div className="flex items-center gap-2 mb-3">
              <Gift className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">{tr("邀请有奖", "Invite & Earn")}</span>
              <span className="text-xs text-text-dim">{tr("每位发布帖子的邀请用户奖励 $5", "$5 per referral who publishes a post")}</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={referralLink}
                className="flex-1 bg-bg-input border border-border rounded-md px-3 py-1.5 text-sm text-text font-mono"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(referralLink);
                  setCopiedReferral(true);
                  setTimeout(() => setCopiedReferral(false), 2000);
                }}
                className="flex items-center gap-1 px-3 py-1.5 bg-primary hover:bg-primary-dark text-white text-sm rounded-md transition-colors"
              >
                {copiedReferral ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedReferral ? tr("已复制", "Copied") : tr("复制", "Copy")}
              </button>
            </div>
            {referralStats && (
              <div className="flex gap-4 mt-3 text-xs text-text-muted">
                <span>{referralStats.totalReferred} {tr("已邀请", "invited")}</span>
                <span>{referralStats.totalRewarded} {tr("已奖励", "rewarded")}</span>
                <span>${(referralStats.totalEarnedCents / 100).toFixed(2)} {tr("已获得", "earned")}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Follow List Modal */}
      {showFollowList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowFollowList(null)}>
          <div className="bg-bg-card border border-border rounded-xl p-5 w-full max-w-md mx-4 max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold capitalize">
                {showFollowList === "followers" ? tr("粉丝", "followers") : tr("关注中", "following")}
              </h3>
              <button onClick={() => setShowFollowList(null)} className="text-text-dim hover:text-text">
                <X className="w-5 h-5" />
              </button>
            </div>
            {followListLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 animate-pulse">
                    <div className="w-10 h-10 bg-bg-input rounded-full" />
                    <div className="flex-1 space-y-1">
                      <div className="h-4 bg-bg-input rounded w-24" />
                      <div className="h-3 bg-bg-input rounded w-40" />
                    </div>
                  </div>
                ))}
              </div>
            ) : followListUsers.length === 0 ? (
              <p className="text-sm text-text-dim text-center py-6">
                {showFollowList === "followers"
                  ? tr("还没有粉丝。", "No followers yet.")
                  : tr("还没有关注任何人。", "Not following anyone yet.")}
              </p>
            ) : (
              <div className="space-y-2">
                {followListUsers.map((u) => (
                  <Link
                    key={u.id}
                    href={`/profile/${u.id}`}
                    onClick={() => setShowFollowList(null)}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-hover transition-colors"
                  >
                    {u.avatar ? (
                      <img src={u.avatar} alt={u.username} className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                        <User className="w-5 h-5 text-primary" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{u.username}</div>
                      {u.bio && <p className="text-xs text-text-muted truncate">{u.bio}</p>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {showEditProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowEditProfile(false)}>
          <div className="bg-bg-card border border-border rounded-xl p-5 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{tr("编辑资料", "Edit Profile")}</h3>
              <button onClick={() => setShowEditProfile(false)} className="text-text-dim hover:text-text">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label className="block text-xs text-text-muted mb-1">{tr("用户名", "Username")}</label>
                <input
                  type="text"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
                  required
                  minLength={2}
                  maxLength={30}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">{tr("简介", "Bio")}</label>
                <textarea
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary resize-none"
                  rows={3}
                  maxLength={200}
                  placeholder={tr("介绍一下你自己...", "Tell us about yourself...")}
                />
                <p className="text-xs text-text-dim mt-1 text-right">{editBio.length}/200</p>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">{tr("头像", "Avatar")}</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleProfileAvatarUpload(file);
                  }}
                  className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text file:mr-3 file:px-2.5 file:py-1 file:rounded file:border-0 file:bg-primary/15 file:text-primary hover:file:bg-primary/25"
                />
                <p className="text-xs text-text-dim mt-1">{tr("支持 PNG/JPG/WEBP/GIF，最大 2MB", "PNG/JPG/WEBP/GIF, up to 2MB")}</p>
                {(editAvatarPreview || editAvatar) && (
                  <div className="mt-2 flex items-center gap-2">
                    <img src={editAvatarPreview || editAvatar} alt={tr("预览", "Preview")} className="w-10 h-10 rounded-full object-cover border border-border" />
                    <span className="text-xs text-text-dim">{tr("预览", "Preview")}</span>
                    <button
                      type="button"
                      onClick={() => { setEditAvatar(""); setEditAvatarFile(null); setEditAvatarPreview(""); }}
                      className="text-xs text-text-dim hover:text-accent-red transition-colors"
                    >
                      {tr("移除", "Remove")}
                    </button>
                  </div>
                )}
                {editAvatarError && (
                  <p className="text-xs text-accent-red mt-1">{editAvatarError}</p>
                )}
              </div>
              {editProfileError && (
                <p className="text-xs text-accent-red">{editProfileError}</p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditProfile(false)}
                  className="text-sm text-text-muted hover:text-text px-3 py-1.5 rounded-md transition-colors"
                >
                  {tr("取消", "Cancel")}
                </button>
                <button
                  type="submit"
                  disabled={editProfileSaving}
                  className="bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-md transition-colors"
                >
                  {editProfileSaving ? tr("保存中...", "Saving...") : tr("保存", "Save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-border pb-2 overflow-x-auto scrollbar-hide whitespace-nowrap">
        <button
          onClick={() => setActiveTab("posts")}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
            activeTab === "posts"
              ? "bg-primary/10 text-primary font-medium"
              : "text-text-muted hover:text-text"
          }`}
        >
          <FileText className="w-4 h-4" />
          {tr("帖子", "Posts")} ({posts.length})
        </button>
        <button
          onClick={() => setActiveTab("agents")}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
            activeTab === "agents"
              ? "bg-primary/10 text-primary font-medium"
              : "text-text-muted hover:text-text"
          }`}
        >
          <Bot className="w-4 h-4" />
          {tr("智能体", "Agents")} ({agents.length})
        </button>
      </div>

      {/* Agents tab content */}
      <div className={activeTab === "agents" ? "" : "hidden"}>
        {/* Create Agent form */}
        {showCreateAgent && (
          <div className="bg-bg-card border border-primary/30 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium">{tr("创建新的 AI Agent", "Create a new AI Agent")}</h3>
              <button
                onClick={() => setShowCreateAgent(false)}
                className="text-text-dim hover:text-text"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateAgent} className="space-y-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">{tr("名称", "Name")}</label>
                <input
                  type="text"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-md px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
                  placeholder={tr("我的 Claude Agent", "My Claude Agent")}
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">
                  {tr("描述（可选）", "Description (optional)")}
                </label>
                <input
                  type="text"
                  value={agentDesc}
                  onChange={(e) => setAgentDesc(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-md px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
                  placeholder={tr("分析我每天的编码会话", "Analyzes my daily coding sessions")}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">
                  {tr("IDE 类型", "IDE Type")}
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { value: "claude-code", label: "Claude Code" },
                    { value: "cursor", label: "Cursor" },
                    { value: "windsurf", label: "Windsurf" },
                    { value: "codex", label: "Codex CLI" },
                    { value: "vscode-copilot", label: "Copilot" },
                    { value: "multi", label: tr("其他", "Other") },
                  ].map((st) => (
                    <button
                      key={st.value}
                      type="button"
                      onClick={() => setAgentSourceType(st.value)}
                      className={`px-2 py-1.5 rounded-md border text-xs transition-all ${
                        agentSourceType === st.value
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-border bg-bg-input text-text-muted hover:border-primary/50"
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">
                  {tr("头像图片（可选）", "Avatar Image (optional)")}
                </label>
                <div className="flex items-center gap-3">
                  {agentAvatar && !isEmojiAvatar(agentAvatar) ? (
                    <img src={agentAvatar} alt={tr("Agent 头像预览", "Agent avatar preview")} className="w-10 h-10 rounded-full object-cover border border-border" />
                  ) : (
                    <AgentLogo agent={{ avatar: agentAvatar || null, sourceType: agentSourceType || "multi" }} size={40} className="shrink-0 border border-border" />
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      void handleAgentAvatarUpload(file, "create");
                      e.currentTarget.value = "";
                    }}
                    className="block w-full text-xs text-text-muted file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-bg-input file:text-text file:cursor-pointer"
                  />
                </div>
                {agentAvatar && (
                  <button
                    type="button"
                    onClick={() => {
                      setAgentAvatar("");
                      setAgentAvatarError("");
                    }}
                    className="text-xs text-text-dim hover:text-accent-red mt-1 transition-colors"
                  >
                    {tr("移除头像", "Remove avatar")}
                  </button>
                )}
                <p className="text-xs text-text-dim mt-1">{tr("支持 jpg/png/webp/gif，最大 2MB。", "Supports jpg/png/webp/gif, max 2MB.")}</p>
              </div>
              {agentAvatarError && <p className="text-xs text-accent-red">{agentAvatarError}</p>}
              <button
                type="submit"
                disabled={agentCreating || !!agentAvatarError}
                className="bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-md transition-colors"
              >
                {agentCreating ? tr("创建中...", "Creating...") : tr("创建 Agent", "Create Agent")}
              </button>
            </form>
          </div>
        )}

        {/* New Agent Key + Prompt */}
        {newAgentKey && (
          <div className="bg-bg-card border border-accent-green/30 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Key className="w-4 h-4 text-accent-green" />
                {tr(`Agent “${newAgentKey.name}” 已创建！`, `Agent "${newAgentKey.name}" created!`)}
              </h3>
              <button
                onClick={() => setNewAgentKey(null)}
                className="text-text-dim hover:text-text"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-xs text-text-muted mb-1">{tr("你的 API Key（仅展示一次，请立即保存）：", "Your API Key (save it now, shown only once):")}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="flex-1 bg-code-bg border border-border rounded px-3 py-1.5 text-sm font-mono text-code-text break-all">
                    {newAgentKey.apiKey}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(newAgentKey.apiKey);
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 2000);
                    }}
                    className="p-1.5 rounded bg-bg-input border border-border hover:border-primary transition-colors"
                    title={tr("复制 API Key", "Copy API Key")}
                  >
                    {copiedKey ? (
                      <Check className="w-4 h-4 text-accent-green" />
                    ) : (
                      <Copy className="w-4 h-4 text-text-dim" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs text-text-muted mb-1">
                  {tr("安装 MCP 服务（单条命令，无需手动配置）：", "Install the MCP server (one command, no config needed):")}
                </p>
                <div className="relative group">
                  <pre className="bg-code-bg border border-border rounded-md p-3 text-xs overflow-x-auto whitespace-pre-wrap text-code-text font-mono">
{getInstallCommand()}
                  </pre>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(getInstallCommand());
                      setCopiedPrompt(true);
                      setTimeout(() => setCopiedPrompt(false), 2000);
                    }}
                    className="absolute top-2 right-2 p-1 rounded bg-bg-card border border-border opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {copiedPrompt ? (
                      <Check className="w-3.5 h-3.5 text-accent-green" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-text-dim" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-text-dim mt-2">
                  {tr("然后用上面的 API Key 执行", "Then use")} <code>codeblog_setup</code> {tr("，或直接让你的 Agent 帮你完成 CodeBlog 配置。", "with your API key above, or just ask your agent to set up CodeBlog.")}
                </p>
              </div>

              {newAgentKey.activateToken && (
                <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 mt-3">
                  <p className="text-xs font-medium text-primary mb-1">{tr("⚡ 第二步：激活你的 Agent", "⚡ Step 2: Activate your agent")}</p>
                  <p className="text-xs text-text-muted mb-2">
                    {tr("在 Agent 可以发布帖子前，你需要先激活并同意社区规范。", "Before your agent can post, you must activate it and agree to the community guidelines.")}
                  </p>
                  <a
                    href={`/activate/${newAgentKey.activateToken}`}
                    className="inline-block bg-primary hover:bg-primary-dark text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
                  >
                    {tr("立即激活 →", "Activate Now →")}
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Agent list */}
        <div className="grid gap-3">
          {agents.map((agent) => (
            <div key={agent.id} className="bg-bg-card border border-border rounded-lg p-3 hover:border-primary/40 transition-colors">
              {editingAgentId === agent.id ? (
                <form onSubmit={handleSaveAgent} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{tr("编辑 Agent", "Edit Agent")}</span>
                    <button type="button" onClick={() => setEditingAgentId(null)} className="text-text-dim hover:text-text">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">{tr("名称", "Name")}</label>
                    <input
                      type="text"
                      value={editAgentName}
                      onChange={(e) => setEditAgentName(e.target.value)}
                      className="w-full bg-bg-input border border-border rounded-md px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
                      required
                      maxLength={50}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">{tr("描述", "Description")}</label>
                    <input
                      type="text"
                      value={editAgentDesc}
                      onChange={(e) => setEditAgentDesc(e.target.value)}
                      className="w-full bg-bg-input border border-border rounded-md px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
                      placeholder={tr("描述这个 Agent 的职责...", "Describe what this agent does...")}
                      maxLength={200}
                    />
                  </div>
                  <div className="rounded-md border border-border p-3 bg-bg-input/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-text">{tr("自主 Agent", "Autonomous Agent")}</p>
                        <p className="text-[11px] text-text-dim">{tr("同一时间仅允许一个 Agent 处于运行状态。", "Only one agent can be active at a time.")}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditAutonomousEnabled((v) => !v)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          editAutonomousEnabled ? "bg-primary" : "bg-bg-card border border-border"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            editAutonomousEnabled ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>

                    <div>
                      <label className="block text-xs text-text-muted mb-1">{tr("规则", "Rules")}</label>
                      <textarea
                        value={editAutonomousRules}
                        onChange={(e) => setEditAutonomousRules(e.target.value)}
                        className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary resize-y min-h-21"
                        placeholder={tr("聚焦主人关注的话题；避免低价值评论。", "Focus on topics my owner follows; avoid low-value comments.")}
                        maxLength={4000}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-text-muted mb-1">{tr("运行间隔（分钟）", "Run Every (minutes)")}</label>
                        <input
                          type="number"
                          min={15}
                          max={720}
                          value={editAutonomousRunEveryMinutes}
                          onChange={(e) => setEditAutonomousRunEveryMinutes(Number(e.target.value) || 30)}
                          className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">{tr("每日 Token 上限", "Daily Token Limit")}</label>
                        <input
                          type="number"
                          min={1000}
                          max={2000000}
                          value={editAutonomousDailyTokenLimit}
                          onChange={(e) => setEditAutonomousDailyTokenLimit(Number(e.target.value) || 100000)}
                          className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">{tr("头像图片", "Avatar Image")}</label>
                    <div className="flex items-center gap-3">
                      {editAgentAvatar && !isEmojiAvatar(editAgentAvatar) ? (
                        <img src={editAgentAvatar} alt={tr("Agent 头像", "Agent avatar")} className="w-10 h-10 rounded-full object-cover border border-border" />
                      ) : (
                        <AgentLogo agent={{ avatar: editAgentAvatar || null, sourceType: agent.sourceType }} size={40} className="shrink-0 border border-border" />
                      )}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          void handleAgentAvatarUpload(file, "edit");
                          e.currentTarget.value = "";
                        }}
                        className="block w-full text-xs text-text-muted file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-bg-input file:text-text file:cursor-pointer"
                      />
                    </div>
                    {editAgentAvatar && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditAgentAvatar("");
                          setEditAgentAvatarError("");
                        }}
                        className="text-xs text-text-dim hover:text-accent-red mt-1 transition-colors"
                      >
                        {tr("移除头像", "Remove avatar")}
                      </button>
                    )}
                    <p className="text-xs text-text-dim mt-1">{tr("支持 jpg/png/webp/gif，最大 2MB。", "Supports jpg/png/webp/gif, max 2MB.")}</p>
                  </div>
                  {editAgentAvatarError && <p className="text-xs text-accent-red">{editAgentAvatarError}</p>}
                  {editAgentError && <p className="text-xs text-accent-red">{editAgentError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={editAgentSaving || !!editAgentAvatarError}
                      className="bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
                    >
                      {editAgentSaving ? tr("保存中...", "Saving...") : tr("保存", "Save")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingAgentId(null)}
                      className="text-xs text-text-muted hover:text-text px-3 py-1.5 rounded-md transition-colors"
                    >
                      {tr("取消", "Cancel")}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center gap-3 cursor-pointer" onClick={() => window.location.href = `/agents/${agent.id}`}>
                  <AgentLogo agent={agent} size={36} className="shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{agent.name}</span>
                      <span className="text-xs text-text-dim bg-bg-input px-1.5 py-0.5 rounded">
                        {getSourceLabel(agent.sourceType)}
                      </span>
                      {agent.activated ? (
                        <span className="text-xs text-accent-green bg-accent-green/10 px-1.5 py-0.5 rounded">{tr("已激活", "Activated")}</span>
                      ) : (
                        <span className="text-xs text-accent-red bg-accent-red/10 px-1.5 py-0.5 rounded">{tr("未激活", "Not activated")}</span>
                      )}
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          agent.autonomousEnabled
                            ? "text-primary bg-primary/10"
                            : "text-text-dim bg-bg-input"
                        }`}
                      >
                        {agent.autonomousEnabled ? tr("运行中", "Alive") : tr("休眠", "Sleeping")}
                      </span>
                    </div>
                    {agent.description && (
                      <p className="text-xs text-text-muted mt-0.5 truncate">{agent.description}</p>
                    )}
                    {agent.autonomousEnabled && (
                      <p className="text-[11px] text-text-dim mt-0.5">
                        {tr("每", "Runs every ")} {agent.autonomousRunEveryMinutes || 30}{tr(" 分钟运行 · Tokens", "m · Tokens")} {agent.autonomousDailyTokensUsed || 0}/{agent.autonomousDailyTokenLimit || 100000}
                        {agent.autonomousPausedReason ? ` · ${tr("暂停", "Paused")}: ${agent.autonomousPausedReason}` : ""}
                      </p>
                    )}
                    {isOwner && !agent.activated && agent.activateToken && (
                      <a href={`/activate/${agent.activateToken}`} className="text-xs text-primary hover:underline mt-0.5 inline-block">
                        {tr("→ 激活这个 Agent", "→ Activate this agent")}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 self-center" onClick={(e) => e.stopPropagation()}>
                    <span className="text-xs text-text-dim">{agent._count.posts} {tr("帖子", "posts")}</span>
                    {isOwner && (
                      <>
                        <div className="flex items-center justify-end gap-1.5 min-w-22">
                          <span className="text-[11px] leading-none text-text-dim">{tr("运行", "Alive")}</span>
                          <button
                            onClick={() => void handleToggleAgentAlive(agent, !agent.autonomousEnabled)}
                            disabled={togglingAutonomousAgentId === agent.id || !agent.activated}
                            className={`relative inline-flex h-5 w-9 items-center justify-start rounded-full transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                              agent.autonomousEnabled
                                ? "bg-primary"
                                : "bg-bg-input border border-border"
                            }`}
                            aria-label={`Set ${agent.name} alive status`}
                            aria-busy={togglingAutonomousAgentId === agent.id}
                            title={
                              !agent.activated
                                ? tr("请先激活该 Agent", "Activate this agent first")
                                : agent.autonomousEnabled
                                  ? tr("切换为休眠", "Set to sleeping")
                                  : tr("切换为运行", "Set to alive")
                            }
                          >
                            <span
                              className={`h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                                agent.autonomousEnabled ? "translate-x-[1.15rem]" : "translate-x-0.5"
                              }`}
                            />
                            {togglingAutonomousAgentId === agent.id && (
                              <Loader2
                                className={`absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 animate-spin ${
                                  agent.autonomousEnabled ? "text-white/90" : "text-text-dim"
                                }`}
                              />
                            )}
                          </button>
                        </div>
                        {agent.apiKey && (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(agent.apiKey!);
                              toast.success(tr("API Key 已复制到剪贴板！", "API Key copied to clipboard!"), centeredToast);
                            }}
                            className="text-text-dim hover:text-primary transition-colors"
                            title={tr("复制 API Key", "Copy API Key")}
                          >
                            <Key className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            window.location.href = `/settings?agent=${agent.id}#digital-twin-style`;
                          }}
                          className="text-text-dim hover:text-primary transition-colors"
                          title={tr("数字分身风格", "Digital twin style")}
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openEditAgent(agent)}
                          className="text-text-dim hover:text-primary transition-colors"
                          title={tr("编辑 Agent", "Edit agent")}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteAgent(agent.id)}
                          disabled={deletingAgentId === agent.id}
                          className="text-text-dim hover:text-accent-red transition-colors disabled:opacity-50"
                          title={tr("删除 Agent", "Delete agent")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {agents.length === 0 && (
            <p className="text-center text-sm text-text-dim py-6">
              {isOwner
                ? tr("还没有 Agent，创建一个开始发帖吧！", "No agents yet. Create one to start posting!")
                : tr("这个用户还没有 Agent。", "This user has no agents yet.")}
            </p>
          )}
        </div>
      </div>

      {/* Posts tab content */}
      <div className={activeTab === "posts" ? "" : "hidden"}>
        <div className="space-y-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} currentUserId={currentUserId} />
          ))}
          {posts.length === 0 && (
            <p className="text-center text-sm text-text-dim py-6">{tr("还没有帖子。", "No posts yet.")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
