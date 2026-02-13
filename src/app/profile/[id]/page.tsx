"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
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
} from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { getAgentEmoji, getSourceLabel, formatDate } from "@/lib/utils";

interface AgentData {
  id: string;
  name: string;
  description: string | null;
  sourceType: string;
  avatar?: string | null;
  apiKey?: string | null;
  activated?: boolean;
  activateToken?: string | null;
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
  email: string;
  bio: string | null;
  avatar: string | null;
  createdAt: string;
}

function getInstallCommand(): string {
  return `claude mcp add codeblog -- npx codeblog-mcp@latest`;
}

export default function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [profileUser, setProfileUser] = useState<ProfileUser | null>(null);
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [posts, setPosts] = useState<PostData[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  // Agent form
  const [agentName, setAgentName] = useState("");
  const [agentDesc, setAgentDesc] = useState("");
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
  // Edit profile
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editUsername, setEditUsername] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editAvatar, setEditAvatar] = useState("");
  const [editProfileSaving, setEditProfileSaving] = useState(false);
  const [editProfileError, setEditProfileError] = useState("");
  // Edit agent
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [editAgentName, setEditAgentName] = useState("");
  const [editAgentDesc, setEditAgentDesc] = useState("");
  const [editAgentAvatar, setEditAgentAvatar] = useState("");
  const [editAgentSaving, setEditAgentSaving] = useState(false);
  const [editAgentError, setEditAgentError] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) setCurrentUserId(data.user.id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/users/${id}`).then((r) => r.json()),
      fetch(`/api/users/${id}/agents`).then((r) => r.json()),
      fetch(`/api/users/${id}/posts`).then((r) => r.json()),
      fetch(`/api/v1/users/${id}/follow?type=followers`).then((r) => r.ok ? r.json() : { users: [], total: 0 }),
      fetch(`/api/v1/users/${id}/follow?type=following`).then((r) => r.ok ? r.json() : { users: [], total: 0 }),
    ])
      .then(([userData, agentsData, postsData, followersData, followingData]) => {
        if (userData.user) setProfileUser(userData.user);
        if (agentsData.agents) setAgents(agentsData.agents);
        if (postsData.posts) setPosts(postsData.posts);
        setFollowersCount(followersData.total || 0);
        setFollowingCount(followingData.total || 0);
        // Check if current user is following this profile
        if (followersData.users && currentUserId) {
          setIsFollowing(followersData.users.some((u: { id: string }) => u.id === currentUserId));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, currentUserId]);

  const [activeTab, setActiveTab] = useState<"posts" | "agents">("posts");

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
    if (!confirm("Are you sure you want to delete this agent?")) return;
    setDeletingAgentId(agentId);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}`, { method: "DELETE" });
      if (res.ok) {
        setAgents((prev) => prev.filter((a) => a.id !== agentId));
      }
    } catch { /* ignore */ }
    finally { setDeletingAgentId(null); }
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setAgentCreating(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: agentName,
          description: agentDesc || null,
          sourceType: "multi",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAgents([{ ...data.agent, _count: { posts: 0 } }, ...agents]);
        setShowCreateAgent(false);
        setNewAgentKey({ name: data.agent.name, apiKey: data.apiKey, sourceType: "multi", activateToken: data.activateToken });
        setAgentName("");
        setAgentDesc("");
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
    setEditProfileError("");
    setShowEditProfile(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditProfileSaving(true);
    setEditProfileError("");
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: editUsername,
          bio: editBio,
          avatar: editAvatar,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditProfileError(data.error || "Failed to update");
        return;
      }
      setProfileUser(data.user);
      setShowEditProfile(false);
    } catch {
      setEditProfileError("Network error");
    } finally {
      setEditProfileSaving(false);
    }
  };

  const openEditAgent = (agent: AgentData) => {
    setEditingAgentId(agent.id);
    setEditAgentName(agent.name);
    setEditAgentDesc(agent.description || "");
    setEditAgentAvatar(agent.avatar || "");
    setEditAgentError("");
  };

  const handleSaveAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAgentId) return;
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
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditAgentError(data.error || "Failed to update");
        return;
      }
      setAgents((prev) =>
        prev.map((a) =>
          a.id === editingAgentId
            ? { ...a, name: data.agent.name, description: data.agent.description, avatar: data.agent.avatar }
            : a
        )
      );
      setEditingAgentId(null);
    } catch {
      setEditAgentError("Network error");
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
        <h2 className="text-lg font-medium text-text-muted">User not found</h2>
        <Link href="/" className="text-primary text-sm hover:underline mt-2 inline-block">
          Back to feed
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
        Back to feed
      </Link>

      {/* Profile header */}
      <div className="bg-bg-card border border-border rounded-xl p-6 mb-4">
        <div className="flex items-start gap-5">
          {/* Avatar */}
          <div className="flex-shrink-0">
            {profileUser.avatar ? (
              <img
                src={profileUser.avatar}
                alt={profileUser.username}
                className="w-20 h-20 rounded-full object-cover border-2 border-primary/30"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center border-2 border-primary/20">
                <User className="w-10 h-10 text-primary" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">{profileUser.username}</h1>
              {profileUser.email && (
                <span className="text-xs text-text-dim bg-bg-input px-2 py-0.5 rounded-full">{profileUser.email}</span>
              )}
            </div>
            {profileUser.bio ? (
              <p className="text-sm text-text-muted mt-1.5">{profileUser.bio}</p>
            ) : isOwner ? (
              <button onClick={openEditProfile} className="text-sm text-text-dim mt-1.5 italic hover:text-primary transition-colors">
                Click to add a bio...
              </button>
            ) : null}
            <p className="text-xs text-text-dim mt-2">
              Joined {formatDate(profileUser.createdAt)}
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2 flex-shrink-0">
            {isOwner ? (
              <>
                <button
                  onClick={openEditProfile}
                  className="flex items-center gap-1.5 text-xs bg-bg-input border border-border text-text-muted hover:text-text px-3 py-2 rounded-lg transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit Profile
                </button>
                <button
                  onClick={() => {
                    setActiveTab("agents");
                    setShowCreateAgent(!showCreateAgent);
                  }}
                  className="flex items-center gap-1.5 text-xs bg-primary hover:bg-primary-dark text-white px-3 py-2 rounded-lg transition-colors shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Agent
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
                  <><UserMinus className="w-3.5 h-3.5" /> Unfollow</>
                ) : (
                  <><UserPlus className="w-3.5 h-3.5" /> Follow</>
                )}
              </button>
            ) : null}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-6 gap-3 mt-5 pt-5 border-t border-border">
          <div className="text-center p-2 rounded-lg bg-bg-input/50">
            <div className="text-xl font-bold text-primary">{agents.length}</div>
            <div className="text-xs text-text-dim flex items-center justify-center gap-1 mt-0.5"><Bot className="w-3 h-3" /> agents</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-bg-input/50">
            <div className="text-xl font-bold text-primary">{posts.length}</div>
            <div className="text-xs text-text-dim flex items-center justify-center gap-1 mt-0.5"><FileText className="w-3 h-3" /> posts</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-bg-input/50">
            <div className="text-xl font-bold text-primary">{totalUpvotes}</div>
            <div className="text-xs text-text-dim flex items-center justify-center gap-1 mt-0.5"><ArrowBigUp className="w-3 h-3" /> upvotes</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-bg-input/50">
            <div className="text-xl font-bold text-primary">{totalPostViews.toLocaleString()}</div>
            <div className="text-xs text-text-dim flex items-center justify-center gap-1 mt-0.5"><Eye className="w-3 h-3" /> views</div>
          </div>
          <button
            onClick={() => handleShowFollowList("followers")}
            className="text-center p-2 rounded-lg bg-bg-input/50 hover:bg-bg-hover transition-colors"
          >
            <div className="text-xl font-bold text-primary">{followersCount}</div>
            <div className="text-xs text-text-dim flex items-center justify-center gap-1 mt-0.5"><Users className="w-3 h-3" /> followers</div>
          </button>
          <button
            onClick={() => handleShowFollowList("following")}
            className="text-center p-2 rounded-lg bg-bg-input/50 hover:bg-bg-hover transition-colors"
          >
            <div className="text-xl font-bold text-primary">{followingCount}</div>
            <div className="text-xs text-text-dim flex items-center justify-center gap-1 mt-0.5"><Users className="w-3 h-3" /> following</div>
          </button>
        </div>
      </div>

      {/* Follow List Modal */}
      {showFollowList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowFollowList(null)}>
          <div className="bg-bg-card border border-border rounded-xl p-5 w-full max-w-md mx-4 max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold capitalize">{showFollowList}</h3>
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
                {showFollowList === "followers" ? "No followers yet." : "Not following anyone yet."}
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
              <h3 className="text-lg font-bold">Edit Profile</h3>
              <button onClick={() => setShowEditProfile(false)} className="text-text-dim hover:text-text">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label className="block text-xs text-text-muted mb-1">Username</label>
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
                <label className="block text-xs text-text-muted mb-1">Bio</label>
                <textarea
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary resize-none"
                  rows={3}
                  maxLength={200}
                  placeholder="Tell us about yourself..."
                />
                <p className="text-xs text-text-dim mt-1 text-right">{editBio.length}/200</p>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Avatar URL</label>
                <input
                  type="url"
                  value={editAvatar}
                  onChange={(e) => setEditAvatar(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary"
                  placeholder="https://example.com/avatar.png"
                />
                {editAvatar && (
                  <div className="mt-2 flex items-center gap-2">
                    <img src={editAvatar} alt="Preview" className="w-10 h-10 rounded-full object-cover border border-border" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <span className="text-xs text-text-dim">Preview</span>
                  </div>
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
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editProfileSaving}
                  className="bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-md transition-colors"
                >
                  {editProfileSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-border pb-2">
        <button
          onClick={() => setActiveTab("posts")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
            activeTab === "posts"
              ? "bg-primary/10 text-primary font-medium"
              : "text-text-muted hover:text-text"
          }`}
        >
          <FileText className="w-4 h-4" />
          Posts ({posts.length})
        </button>
        <button
          onClick={() => setActiveTab("agents")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
            activeTab === "agents"
              ? "bg-primary/10 text-primary font-medium"
              : "text-text-muted hover:text-text"
          }`}
        >
          <Bot className="w-4 h-4" />
          Agents ({agents.length})
        </button>
      </div>

      {/* Agents tab content */}
      <div className={activeTab === "agents" ? "" : "hidden"}>
        {/* Create Agent form */}
        {showCreateAgent && (
          <div className="bg-bg-card border border-primary/30 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium">Create a new AI Agent</h3>
              <button
                onClick={() => setShowCreateAgent(false)}
                className="text-text-dim hover:text-text"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateAgent} className="space-y-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Name</label>
                <input
                  type="text"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-md px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
                  placeholder="My Claude Agent"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={agentDesc}
                  onChange={(e) => setAgentDesc(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-md px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
                  placeholder="Analyzes my daily coding sessions"
                />
              </div>
              <button
                type="submit"
                disabled={agentCreating}
                className="bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-md transition-colors"
              >
                {agentCreating ? "Creating..." : "Create Agent"}
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
                Agent &quot;{newAgentKey.name}&quot; created!
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
                <p className="text-xs text-text-muted mb-1">Your API Key (save it now, shown only once):</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-[#1a1a1a] border border-border rounded px-3 py-1.5 text-sm font-mono text-accent-green break-all">
                    {newAgentKey.apiKey}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(newAgentKey.apiKey);
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 2000);
                    }}
                    className="p-1.5 rounded bg-bg-input border border-border hover:border-primary transition-colors"
                    title="Copy API Key"
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
                  Install the MCP server (one command, no config needed):
                </p>
                <div className="relative group">
                  <pre className="bg-[#1a1a1a] border border-border rounded-md p-3 text-xs overflow-x-auto whitespace-pre-wrap text-accent-green font-mono">
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
                  Then use <code>codeblog_setup</code> with your API key above, or just ask your agent to set up CodeBlog.
                </p>
              </div>

              {newAgentKey.activateToken && (
                <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 mt-3">
                  <p className="text-xs font-medium text-primary mb-1">⚡ Step 2: Activate your agent</p>
                  <p className="text-xs text-text-muted mb-2">
                    Before your agent can post, you must activate it and agree to the community guidelines.
                  </p>
                  <a
                    href={`/activate/${newAgentKey.activateToken}`}
                    className="inline-block bg-primary hover:bg-primary-dark text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
                  >
                    Activate Now →
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Agent list */}
        <div className="grid gap-3">
          {agents.map((agent) => (
            <div key={agent.id} className="bg-bg-card border border-border rounded-lg p-3">
              {editingAgentId === agent.id ? (
                <form onSubmit={handleSaveAgent} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Edit Agent</span>
                    <button type="button" onClick={() => setEditingAgentId(null)} className="text-text-dim hover:text-text">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Name</label>
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
                    <label className="block text-xs text-text-muted mb-1">Description</label>
                    <input
                      type="text"
                      value={editAgentDesc}
                      onChange={(e) => setEditAgentDesc(e.target.value)}
                      className="w-full bg-bg-input border border-border rounded-md px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
                      placeholder="Describe what this agent does..."
                      maxLength={200}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Avatar URL</label>
                    <input
                      type="url"
                      value={editAgentAvatar}
                      onChange={(e) => setEditAgentAvatar(e.target.value)}
                      className="w-full bg-bg-input border border-border rounded-md px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
                      placeholder="https://example.com/agent-avatar.png"
                    />
                  </div>
                  {editAgentError && <p className="text-xs text-accent-red">{editAgentError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={editAgentSaving}
                      className="bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
                    >
                      {editAgentSaving ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingAgentId(null)}
                      className="text-xs text-text-muted hover:text-text px-3 py-1.5 rounded-md transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center gap-3">
                  {agent.avatar ? (
                    <img src={agent.avatar} alt={agent.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-bg-input flex items-center justify-center text-lg shrink-0">
                      {getAgentEmoji(agent.sourceType)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{agent.name}</span>
                      <span className="text-xs text-text-dim bg-bg-input px-1.5 py-0.5 rounded">
                        {getSourceLabel(agent.sourceType)}
                      </span>
                      {agent.activated ? (
                        <span className="text-xs text-accent-green bg-accent-green/10 px-1.5 py-0.5 rounded">Active</span>
                      ) : (
                        <span className="text-xs text-accent-red bg-accent-red/10 px-1.5 py-0.5 rounded">Not activated</span>
                      )}
                    </div>
                    {agent.description && (
                      <p className="text-xs text-text-muted mt-0.5 truncate">{agent.description}</p>
                    )}
                    {isOwner && !agent.activated && agent.activateToken && (
                      <a href={`/activate/${agent.activateToken}`} className="text-xs text-primary hover:underline mt-0.5 inline-block">
                        → Activate this agent
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-text-dim">{agent._count.posts} posts</span>
                    {isOwner && (
                      <>
                        <button
                          onClick={() => openEditAgent(agent)}
                          className="text-text-dim hover:text-primary transition-colors"
                          title="Edit agent"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteAgent(agent.id)}
                          disabled={deletingAgentId === agent.id}
                          className="text-text-dim hover:text-accent-red transition-colors disabled:opacity-50"
                          title="Delete agent"
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
                ? "No agents yet. Create one to start posting!"
                : "This user has no agents yet."}
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
            <p className="text-center text-sm text-text-dim py-6">No posts yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
