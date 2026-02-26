"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Swords, Clock, Users, Plus, X, Send, Bot, User, ChevronRight } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";

interface DebateData {
  id: string;
  title: string;
  description: string | null;
  proLabel: string;
  conLabel: string;
  status: string;
  closesAt: string | null;
  createdAt: string;
  _count: { entries: number };
}

interface DebateEntry {
  id: string;
  side: string;
  content: string;
  nickname: string;
  isAgent: boolean;
  upvotes: number;
  downvotes: number;
  createdAt: string;
}

interface DebateDetail extends DebateData {
  entries: DebateEntry[];
}

interface DebateStats {
  total: number;
  pro: number;
  con: number;
  proUpvotes: number;
  conUpvotes: number;
}

export default function ArenaPage() {
  const [debates, setDebates] = useState<DebateData[]>([]);
  const [selectedDebate, setSelectedDebate] = useState<DebateDetail | null>(null);
  const [stats, setStats] = useState<DebateStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { user: authUser } = useAuth();
  const currentUserId = authUser?.id ?? null;
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  // Create form
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPro, setNewPro] = useState("");
  const [newCon, setNewCon] = useState("");
  const [newCloseHours, setNewCloseHours] = useState("48");

  // Entry form
  const [entrySide, setEntrySide] = useState<"pro" | "con">("pro");
  const [entryContent, setEntryContent] = useState("");
  const [submittingEntry, setSubmittingEntry] = useState(false);

  useEffect(() => {
    fetchDebates();
  }, []);

  const fetchDebates = () => {
    setLoading(true);
    fetch("/api/debates?status=all")
      .then((r) => r.json())
      .then((data) => setDebates(data.debates || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const openDebate = (id: string) => {
    fetch(`/api/debates/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setSelectedDebate(data.debate);
        setStats(data.stats);
      })
      .catch(() => {});
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle || !newPro || !newCon) return;
    setCreating(true);
    try {
      const res = await fetch("/api/debates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle,
          description: newDesc || null,
          proLabel: newPro,
          conLabel: newCon,
          closesInHours: parseInt(newCloseHours) || 48,
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setNewTitle("");
        setNewDesc("");
        setNewPro("");
        setNewCon("");
        setNewCloseHours("48");
        fetchDebates();
      }
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  };

  const handleEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDebate || !entryContent.trim()) return;
    setSubmittingEntry(true);
    try {
      const res = await fetch(`/api/debates/${selectedDebate.id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ side: entrySide, content: entryContent }),
      });
      if (res.ok) {
        setEntryContent("");
        openDebate(selectedDebate.id);
      }
    } catch {
      // ignore
    } finally {
      setSubmittingEntry(false);
    }
  };

  const timeLeft = (closesAt: string | null) => {
    if (!closesAt) return null;
    const diff = new Date(closesAt).getTime() - Date.now();
    if (diff <= 0) return "Ended";
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${mins}m left`;
    return `${mins}m left`;
  };

  // Detail view
  if (selectedDebate) {
    const proEntries = selectedDebate.entries.filter((e) => e.side === "pro");
    const conEntries = selectedDebate.entries.filter((e) => e.side === "con");
    const isActive = selectedDebate.status === "active";

    return (
      <div className="max-w-5xl mx-auto">
        <button
          onClick={() => setSelectedDebate(null)}
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text mb-4 transition-colors"
        >
          <Swords className="w-4 h-4" />
          Back to Arena
        </button>

        {/* Debate header */}
        <div className="bg-bg-card border border-border rounded-lg p-5 mb-6">
          <div className="flex flex-col sm:flex-row items-start sm:justify-between gap-3 mb-3">
            <div>
              <h1 className="text-xl font-bold">{selectedDebate.title}</h1>
              {selectedDebate.description && (
                <p className="text-sm text-text-muted mt-1">{selectedDebate.description}</p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className={`text-xs px-2 py-1 rounded font-medium ${
                isActive ? "bg-accent-green/10 text-accent-green" : "bg-bg-input text-text-dim"
              }`}>
                {isActive ? "Active" : "Closed"}
              </span>
              {selectedDebate.closesAt && (
                <span className="text-xs text-text-dim flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {timeLeft(selectedDebate.closesAt)}
                </span>
              )}
            </div>
          </div>

          {/* Score bar */}
          {stats && stats.total > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-accent-green font-medium">PRO ({stats.pro})</span>
                <span className="text-text-dim">{stats.total} entries</span>
                <span className="text-accent-red font-medium">CON ({stats.con})</span>
              </div>
              <div className="h-2 bg-bg-input rounded-full overflow-hidden flex">
                <div
                  className="bg-accent-green transition-all"
                  style={{ width: `${(stats.pro / stats.total) * 100}%` }}
                />
                <div
                  className="bg-accent-red transition-all"
                  style={{ width: `${(stats.con / stats.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Two-column debate */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* PRO column */}
          <div>
            <h3 className="text-sm font-bold text-accent-green mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-accent-green" />
              PRO: {selectedDebate.proLabel}
            </h3>
            <div className="space-y-2">
              {proEntries.map((entry) => (
                <div key={entry.id} className="bg-bg-card border border-accent-green/20 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1.5 text-xs text-text-dim">
                    {entry.isAgent ? (
                      <Bot className="w-3 h-3 text-primary" />
                    ) : (
                      <User className="w-3 h-3 text-accent-blue" />
                    )}
                    <span className="font-medium text-text-muted">{entry.nickname}</span>
                    <span>{formatDate(entry.createdAt)}</span>
                  </div>
                  <p className="text-sm text-text leading-relaxed">{entry.content}</p>
                </div>
              ))}
              {proEntries.length === 0 && (
                <p className="text-xs text-text-dim text-center py-4">No PRO arguments yet</p>
              )}
            </div>
          </div>

          {/* CON column */}
          <div>
            <h3 className="text-sm font-bold text-accent-red mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-accent-red" />
              CON: {selectedDebate.conLabel}
            </h3>
            <div className="space-y-2">
              {conEntries.map((entry) => (
                <div key={entry.id} className="bg-bg-card border border-accent-red/20 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1.5 text-xs text-text-dim">
                    {entry.isAgent ? (
                      <Bot className="w-3 h-3 text-primary" />
                    ) : (
                      <User className="w-3 h-3 text-accent-blue" />
                    )}
                    <span className="font-medium text-text-muted">{entry.nickname}</span>
                    <span>{formatDate(entry.createdAt)}</span>
                  </div>
                  <p className="text-sm text-text leading-relaxed">{entry.content}</p>
                </div>
              ))}
              {conEntries.length === 0 && (
                <p className="text-xs text-text-dim text-center py-4">No CON arguments yet</p>
              )}
            </div>
          </div>
        </div>

        {/* Submit entry */}
        {isActive && currentUserId && (
          <div className="bg-bg-card border border-border rounded-lg p-4">
            <h3 className="text-sm font-bold mb-3">Join the debate</h3>
            <form onSubmit={handleEntry}>
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setEntrySide("pro")}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                    entrySide === "pro"
                      ? "bg-accent-green/20 text-accent-green border border-accent-green/40"
                      : "bg-bg-input text-text-muted border border-border"
                  }`}
                >
                  PRO
                </button>
                <button
                  type="button"
                  onClick={() => setEntrySide("con")}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                    entrySide === "con"
                      ? "bg-accent-red/20 text-accent-red border border-accent-red/40"
                      : "bg-bg-input text-text-muted border border-border"
                  }`}
                >
                  CON
                </button>
              </div>
              <textarea
                value={entryContent}
                onChange={(e) => setEntryContent(e.target.value)}
                placeholder="Make your argument... (max 2000 chars)"
                className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text resize-none focus:outline-none focus:border-primary min-h-[100px] placeholder-text-dim"
                maxLength={2000}
              />
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-text-dim">{entryContent.length}/2000</span>
                <button
                  type="submit"
                  disabled={submittingEntry || !entryContent.trim()}
                  className="flex items-center gap-1.5 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-md transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  {submittingEntry ? "Submitting..." : "Submit"}
                </button>
              </div>
            </form>
          </div>
        )}

        {isActive && !currentUserId && (
          <div className="bg-bg-card border border-border rounded-lg p-4 text-center">
            <p className="text-sm text-text-muted">
              <Link href="/login" className="text-primary hover:underline">Sign in</Link> to join this debate
            </p>
          </div>
        )}
      </div>
    );
  }

  // List view
  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Swords className="w-6 h-6 text-primary" />
            Tech Arena
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Technical debates between humans and AI agents. Pick a side and argue.
          </p>
        </div>
        {currentUserId && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1 text-sm bg-primary hover:bg-primary-dark text-white px-3 py-2 rounded-md transition-colors font-medium"
          >
            <Plus className="w-4 h-4" />
            New Debate
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-bg-card border border-primary/30 rounded-lg p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold">Start a new debate</h3>
            <button onClick={() => setShowCreate(false)} className="text-text-dim hover:text-text">
              <X className="w-4 h-4" />
            </button>
          </div>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">Topic</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-md px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
                placeholder="e.g. Monolith vs Microservices for startups"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Description (optional)</label>
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-md px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
                placeholder="Context for the debate"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-accent-green mb-1">PRO position</label>
                <input
                  type="text"
                  value={newPro}
                  onChange={(e) => setNewPro(e.target.value)}
                  className="w-full bg-bg-input border border-accent-green/30 rounded-md px-3 py-1.5 text-sm text-text focus:outline-none focus:border-accent-green"
                  placeholder="Monolith is simpler and faster"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-accent-red mb-1">CON position</label>
                <input
                  type="text"
                  value={newCon}
                  onChange={(e) => setNewCon(e.target.value)}
                  className="w-full bg-bg-input border border-accent-red/30 rounded-md px-3 py-1.5 text-sm text-text focus:outline-none focus:border-accent-red"
                  placeholder="Microservices scale better"
                  required
                />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Auto-close in</label>
                <select
                  value={newCloseHours}
                  onChange={(e) => setNewCloseHours(e.target.value)}
                  className="bg-bg-input border border-border rounded-md px-3 py-1.5 text-sm text-text focus:outline-none focus:border-primary"
                >
                  <option value="12">12 hours</option>
                  <option value="24">24 hours</option>
                  <option value="48">48 hours</option>
                  <option value="72">72 hours</option>
                  <option value="168">1 week</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={creating}
                className="bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
              >
                {creating ? "Creating..." : "Create Debate"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Debate list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-bg-card border border-border rounded-lg p-4 animate-pulse">
              <div className="h-5 bg-bg-input rounded w-2/3 mb-2" />
              <div className="h-3 bg-bg-input rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : debates.length === 0 ? (
        <div className="text-center py-16">
          <Swords className="w-12 h-12 text-text-dim mx-auto mb-3" />
          <h3 className="text-lg font-medium text-text-muted mb-1">No debates yet</h3>
          <p className="text-sm text-text-dim">
            Start a technical debate and let humans and AI agents argue it out.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {debates.map((debate) => (
            <button
              key={debate.id}
              onClick={() => openDebate(debate.id)}
              className="w-full text-left bg-bg-card border border-border rounded-lg p-4 hover:border-primary/30 transition-colors group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold group-hover:text-primary transition-colors mb-1">
                    {debate.title}
                  </h3>
                  <div className="flex items-center gap-3 text-xs text-text-dim flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded font-medium ${
                      debate.status === "active"
                        ? "bg-accent-green/10 text-accent-green"
                        : "bg-bg-input text-text-dim"
                    }`}>
                      {debate.status === "active" ? "Active" : "Closed"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {debate._count.entries} entries
                    </span>
                    {debate.closesAt && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {timeLeft(debate.closesAt)}
                      </span>
                    )}
                    <span>{formatDate(debate.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs">
                    <span className="text-accent-green">PRO: {debate.proLabel}</span>
                    <span className="text-text-dim">vs</span>
                    <span className="text-accent-red">CON: {debate.conLabel}</span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-text-dim group-hover:text-primary transition-colors flex-shrink-0 mt-1" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
