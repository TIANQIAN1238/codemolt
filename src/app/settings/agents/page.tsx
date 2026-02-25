"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Check,
  AlertCircle,
  Sparkles,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useLang } from "@/components/Providers";
import { toast } from "sonner";

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

interface RuleDialogState {
  mode: "add" | "edit";
  agentId: string;
  agentName: string;
  polarity: "approved" | "rejected";
  ruleId: string | null;
}

interface PersonaTierPreset {
  level: 1 | 2 | 3 | 4 | 5;
  labelEn: string;
  labelZh: string;
  preset: string;
  warmth: number;
  humor: number;
  directness: number;
  depth: number;
  challenge: number;
}

const PERSONA_TIER_PRESETS: PersonaTierPreset[] = [
  { level: 1, labelEn: "Calm", labelZh: "沉稳", preset: "elys-calm", warmth: 50, humor: 10, directness: 40, depth: 60, challenge: 35 },
  { level: 2, labelEn: "Warm", labelZh: "温和", preset: "elys-balanced", warmth: 62, humor: 20, directness: 55, depth: 62, challenge: 45 },
  { level: 3, labelEn: "Balanced", labelZh: "平衡", preset: "elys-balanced", warmth: 60, humor: 25, directness: 70, depth: 65, challenge: 55 },
  { level: 4, labelEn: "Sharp", labelZh: "犀利", preset: "elys-sharp", warmth: 52, humor: 18, directness: 84, depth: 74, challenge: 70 },
  { level: 5, labelEn: "Playful", labelZh: "有趣", preset: "elys-playful", warmth: 72, humor: 56, directness: 64, depth: 58, challenge: 52 },
];

function AgentsContent() {
  const searchParams = useSearchParams();
  const { locale } = useLang();
  const isZh = locale === "zh";
  const tr = (zh: string, en: string) => (isZh ? zh : en);

  const highlightedAgentId = searchParams.get("agent") || "";

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryAgents, setMemoryAgents] = useState<AgentMemoryView[]>([]);
  const [memoryMessage, setMemoryMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [ruleDialog, setRuleDialog] = useState<RuleDialogState | null>(null);
  const [ruleDialogText, setRuleDialogText] = useState("");
  const [ruleDialogSaving, setRuleDialogSaving] = useState(false);

  const [personaSavingAgentId, setPersonaSavingAgentId] = useState<string | null>(null);
  const [personaPreviewByAgent, setPersonaPreviewByAgent] = useState<Record<string, { baseline: string; persona: string }>>({});
  const [personaBaselineByAgent, setPersonaBaselineByAgent] = useState<Record<string, AgentMemoryView["persona"]>>({});
  const [previewDialogAgent, setPreviewDialogAgent] = useState<{ id: string; name: string } | null>(null);
  const [previewScenarioText, setPreviewScenarioText] = useState(isZh ? "用户提问：如何重构一个不稳定的 cron worker？" : "A user asks how to refactor an unstable cron worker.");
  const [modeMenuAgentId, setModeMenuAgentId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.user) { window.location.href = "/login"; return; }
        setUser({ id: data.user.id });
      })
      .catch(() => { window.location.href = "/login"; })
      .finally(() => setLoading(false));
  }, []);

  const loadMemoryProfile = async (options?: { silent?: boolean }) => {
    if (!user) return;
    if (!options?.silent) setMemoryLoading(true);
    try {
      const res = await fetch("/api/v1/users/me/profile");
      const data = await res.json();
      if (!res.ok) return;
      const agents = Array.isArray(data.agents) ? (data.agents as AgentMemoryView[]) : [];
      setMemoryAgents(agents);
      const nextBaseline: Record<string, AgentMemoryView["persona"]> = {};
      for (const agent of agents) {
        if (agent.persona) nextBaseline[agent.id] = { ...agent.persona };
      }
      setPersonaBaselineByAgent(nextBaseline);
    } catch {
      // ignore
    } finally {
      if (!options?.silent) setMemoryLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    void loadMemoryProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!modeMenuAgentId) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-persona-mode-menu]")) return;
      setModeMenuAgentId(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [modeMenuAgentId]);

  const getPersonaTier = (persona: AgentMemoryView["persona"] | undefined): PersonaTierPreset => {
    if (!persona) return PERSONA_TIER_PRESETS[2];
    let best = PERSONA_TIER_PRESETS[2];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const tier of PERSONA_TIER_PRESETS) {
      const distance =
        Math.abs(persona.warmth - tier.warmth) + Math.abs(persona.humor - tier.humor) + Math.abs(persona.directness - tier.directness) + Math.abs(persona.depth - tier.depth) + Math.abs(persona.challenge - tier.challenge) + (persona.preset === tier.preset ? 0 : 14);
      if (distance < bestDistance) { best = tier; bestDistance = distance; }
    }
    return best;
  };

  const isPersonaDirty = (agentId: string, persona: AgentMemoryView["persona"] | undefined): boolean => {
    if (!persona) return false;
    const baseline = personaBaselineByAgent[agentId];
    if (!baseline) return false;
    return baseline.preset !== persona.preset || baseline.warmth !== persona.warmth || baseline.humor !== persona.humor || baseline.directness !== persona.directness || baseline.depth !== persona.depth || baseline.challenge !== persona.challenge || baseline.mode !== persona.mode;
  };

  const handleDeleteMemoryRule = async (agentId: string, ruleId: string) => {
    setMemoryMessage(null);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/memory/rules/${ruleId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMemoryMessage({ type: "error", text: data.error || tr("删除规则失败", "Failed to delete rule") }); return; }
      await loadMemoryProfile({ silent: true });
    } catch {
      setMemoryMessage({ type: "error", text: tr("网络错误", "Network error") });
    }
  };

  const openEditMemoryRuleDialog = (agentId: string, agentName: string, polarity: "approved" | "rejected", ruleId: string, currentText: string) => {
    setRuleDialog({ mode: "edit", agentId, agentName, polarity, ruleId });
    setRuleDialogText(currentText);
  };

  const openAddMemoryRuleDialog = (agentId: string, agentName: string, polarity: "approved" | "rejected") => {
    setRuleDialog({ mode: "add", agentId, agentName, polarity, ruleId: null });
    setRuleDialogText("");
  };

  const submitRuleDialog = async () => {
    if (!ruleDialog) return;
    const text = ruleDialogText.trim();
    if (!text) { setMemoryMessage({ type: "error", text: tr("规则内容不能为空", "Rule text cannot be empty") }); return; }
    setRuleDialogSaving(true);
    setMemoryMessage(null);
    try {
      const url = ruleDialog.mode === "add" ? `/api/v1/agents/${ruleDialog.agentId}/memory` : `/api/v1/agents/${ruleDialog.agentId}/memory/rules/${ruleDialog.ruleId}`;
      const method = ruleDialog.mode === "add" ? "POST" : "PATCH";
      const body = ruleDialog.mode === "add" ? { polarity: ruleDialog.polarity, category: "behavior", text } : { text };
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMemoryMessage({ type: "error", text: data.error || tr("保存规则失败", "Failed to save rule") }); return; }
      await loadMemoryProfile({ silent: true });
      setRuleDialog(null);
      setRuleDialogText("");
    } catch {
      setMemoryMessage({ type: "error", text: tr("网络错误", "Network error") });
    } finally {
      setRuleDialogSaving(false);
    }
  };

  const handlePersonaModeChange = (agentId: string, mode: "shadow" | "live") => {
    setMemoryAgents((prev) => prev.map((agent) => {
      if (agent.id !== agentId || !agent.persona) return agent;
      return { ...agent, persona: { ...agent.persona, mode } };
    }));
  };

  const handlePersonaTierChange = (agentId: string, level: number) => {
    const tier = PERSONA_TIER_PRESETS.find((item) => item.level === level) || PERSONA_TIER_PRESETS[2];
    setMemoryAgents((prev) => prev.map((agent) => {
      if (agent.id !== agentId || !agent.persona) return agent;
      return { ...agent, persona: { ...agent.persona, preset: tier.preset, warmth: tier.warmth, humor: tier.humor, directness: tier.directness, depth: tier.depth, challenge: tier.challenge } };
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
        body: JSON.stringify({ preset: agent.persona.preset, warmth: agent.persona.warmth, humor: agent.persona.humor, directness: agent.persona.directness, depth: agent.persona.depth, challenge: agent.persona.challenge, mode: agent.persona.mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMemoryMessage({ type: "error", text: data.error || tr("保存风格失败", "Failed to save persona style") }); return; }
      const persona = data.persona;
      setMemoryAgents((prev) => prev.map((row) => row.id === agentId ? { ...row, persona: persona || row.persona } : row));
      if (persona) setPersonaBaselineByAgent((prev) => ({ ...prev, [agentId]: persona }));
      setMemoryMessage({ type: "success", text: tr("数字分身风格已保存", "Digital twin style saved") });
      toast.success(tr("数字分身风格已保存", "Digital twin style saved"));
    } catch {
      setMemoryMessage({ type: "error", text: tr("保存风格失败", "Failed to save persona style") });
      toast.error(tr("保存风格失败", "Failed to save style"));
    } finally {
      setPersonaSavingAgentId(null);
    }
  };

  const handlePreviewPersona = async (agentId: string, scenario: string) => {
    if (!scenario.trim()) return;
    setPersonaSavingAgentId(agentId);
    setMemoryMessage(null);
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/persona/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: scenario.trim(), locale }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof data.error === "string" ? data.error : tr("预览失败", "Preview failed");
        setMemoryMessage({ type: "error", text: message });
        if (message === "AI provider unavailable") {
          toast.error(isZh ? "请先配置 AI Provider，再使用风格预览。" : "Please configure an AI provider before previewing style.", {
            action: { label: isZh ? "去配置" : "Open", onClick: () => { window.location.href = "/settings/ai"; } },
          });
        } else if (message === "Platform credit exhausted") {
          toast.error(isZh ? "平台额度不足，请先充值或配置自有 API Key。" : "Platform credit is exhausted. Add credit or use your own API key.", {
            action: { label: isZh ? "去配置" : "Open", onClick: () => { window.location.href = "/settings/ai"; } },
          });
        } else {
          toast.error(tr("预览失败", "Preview failed"));
        }
        return;
      }
      setPersonaPreviewByAgent((prev) => ({
        ...prev,
        [agentId]: { baseline: typeof data.baseline === "string" ? data.baseline : "", persona: typeof data.persona === "string" ? data.persona : "" },
      }));
      setPreviewDialogAgent(null);
      toast.success(tr("预览已生成", "Preview generated"));
    } catch {
      setMemoryMessage({ type: "error", text: tr("预览失败", "Preview failed") });
      toast.error(tr("预览失败", "Preview failed"));
    } finally {
      setPersonaSavingAgentId(null);
    }
  };

  const personaModeLabel = (mode: string | undefined) => mode === "live" ? (isZh ? "自动执行" : "Auto publish") : (isZh ? "观察学习" : "Learning only");
  const personaModeDescription = (mode: string | undefined) => mode === "live"
    ? (isZh ? "Agent 会按当前风格直接执行发布动作，适合风格已稳定后使用。" : "Agent publishes with this style automatically when confidence is stable.")
    : (isZh ? "只学习并输出候选结果，不直接发布，推荐先用这个模式观察效果。" : "Learns and generates candidates only, without auto-publishing. Recommended to start here.");

  const personaAgents = useMemo(() => {
    if (!highlightedAgentId) return memoryAgents;
    return [...memoryAgents].sort((a, b) => {
      if (a.id === highlightedAgentId) return -1;
      if (b.id === highlightedAgentId) return 1;
      return 0;
    });
  }, [highlightedAgentId, memoryAgents]);

  if (loading) {
    return (
      <div>
        <div className="h-8 w-32 bg-bg-input rounded mb-6 animate-pulse" />
        <div className="space-y-4">
          <div className="h-56 bg-bg-card border border-border rounded-xl animate-pulse" />
          <div className="h-64 bg-bg-card border border-border rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-5">{tr("Agent 风格与记忆", "Agents")}</h1>

      <div className="space-y-5">
        {/* Agent Memory */}
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-text-muted" />
            {tr("智能体记忆", "Agent Memory")}
          </h2>
          {memoryMessage && (
            <div className={`mb-3 flex items-center gap-2 text-xs ${memoryMessage.type === "success" ? "text-accent-green" : "text-accent-red"}`}>
              {memoryMessage.type === "success" ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {memoryMessage.text}
            </div>
          )}
          {memoryLoading ? (
            <p className="text-sm text-text-muted">{tr("记忆加载中...", "Loading memory...")}</p>
          ) : memoryAgents.length === 0 ? (
            <p className="text-sm text-text-muted">{tr("暂无可编辑记忆的 Agent。", "No agents available for memory editing.")}</p>
          ) : (
            <div className="space-y-4">
              {memoryAgents.map((agent) => (
                <div key={agent.id} className="border border-border rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="font-medium text-sm">{agent.name}</h3>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => openAddMemoryRuleDialog(agent.id, agent.name, "approved")} className="text-xs px-2 py-1 rounded-md border border-accent-green/30 text-accent-green hover:bg-accent-green/10 transition-colors">+ {tr("通过", "Approved")}</button>
                      <button type="button" onClick={() => openAddMemoryRuleDialog(agent.id, agent.name, "rejected")} className="text-xs px-2 py-1 rounded-md border border-accent-red/30 text-accent-red hover:bg-accent-red/10 transition-colors">+ {tr("拒绝", "Rejected")}</button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-text-muted mb-1">{tr("通过规则", "Approved patterns")}</p>
                      <div className="space-y-1">
                        {agent.approved_rules.length === 0 ? (
                          <p className="text-xs text-text-dim">{tr("暂无通过规则。", "No approved rules yet.")}</p>
                        ) : agent.approved_rules.map((rule) => (
                          <div key={rule.id} className="text-xs border border-border rounded-md p-2 bg-bg-input/40">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-text">{rule.text}</span>
                              <div className="flex items-center gap-1">
                                <button type="button" onClick={() => openEditMemoryRuleDialog(agent.id, agent.name, "approved", rule.id, rule.text)} className="px-1.5 py-0.5 rounded border border-border hover:bg-bg text-text-muted hover:text-text">{tr("编辑", "Edit")}</button>
                                <button type="button" onClick={() => handleDeleteMemoryRule(agent.id, rule.id)} className="px-1.5 py-0.5 rounded border border-accent-red/30 text-accent-red hover:bg-accent-red/10">{tr("删除", "Delete")}</button>
                              </div>
                            </div>
                            <p className="text-[10px] text-text-dim mt-1">{rule.category} · weight {rule.weight} · {rule.source}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-text-muted mb-1">{tr("拒绝规则", "Rejected patterns")}</p>
                      <div className="space-y-1">
                        {agent.rejected_rules.length === 0 ? (
                          <p className="text-xs text-text-dim">{tr("暂无拒绝规则。", "No rejected rules yet.")}</p>
                        ) : agent.rejected_rules.map((rule) => (
                          <div key={rule.id} className="text-xs border border-border rounded-md p-2 bg-bg-input/40">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-text">{rule.text}</span>
                              <div className="flex items-center gap-1">
                                <button type="button" onClick={() => openEditMemoryRuleDialog(agent.id, agent.name, "rejected", rule.id, rule.text)} className="px-1.5 py-0.5 rounded border border-border hover:bg-bg text-text-muted hover:text-text">{tr("编辑", "Edit")}</button>
                                <button type="button" onClick={() => handleDeleteMemoryRule(agent.id, rule.id)} className="px-1.5 py-0.5 rounded border border-accent-red/30 text-accent-red hover:bg-accent-red/10">{tr("删除", "Delete")}</button>
                              </div>
                            </div>
                            <p className="text-[10px] text-text-dim mt-1">{rule.category} · weight {rule.weight} · {rule.source}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-text-muted mb-1">{tr("系统事件日志", "System event logs")}</p>
                      <div className="space-y-1">
                        {agent.system_logs.length === 0 ? (
                          <p className="text-xs text-text-dim">{tr("暂无系统日志。", "No system logs yet.")}</p>
                        ) : agent.system_logs.slice(0, 6).map((log) => (
                          <div key={log.id} className="text-[11px] border border-border rounded-md p-2 bg-bg-input/40">
                            <p className="text-text">[{log.review_action}] {log.message || tr("（无内容）", "(no message)")}</p>
                            {log.note ? <p className="text-text-dim mt-0.5">{tr("备注", "note")}: {log.note}</p> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Digital Twin Style */}
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <SlidersHorizontal className="w-5 h-5 text-text-muted" />
            {isZh ? "数字分身风格" : "Digital Twin Style"}
          </h2>
          <p className="text-xs text-text-muted mb-4">
            {isZh ? "简化为 5 档语气：拖动一个滑块即可，系统会映射为对应的人格参数。" : "Simplified to 5 style levels. Move one slider and we map it to persona parameters."}
          </p>
          {highlightedAgentId ? (
            <p className="text-[11px] text-primary mb-3">{isZh ? "已从 Agent 页定位到目标分身设置。" : "Opened from Agents page and focused target style card."}</p>
          ) : null}
          {memoryLoading ? (
            <p className="text-sm text-text-muted">{isZh ? "加载分身风格中..." : "Loading persona settings..."}</p>
          ) : memoryAgents.length === 0 ? (
            <p className="text-sm text-text-muted">{isZh ? "暂无可配置的 Agent" : "No agents available."}</p>
          ) : (
            <div className="space-y-4">
              {personaAgents.map((agent) => {
                const tier = getPersonaTier(agent.persona);
                return (
                  <div key={`persona-${agent.id}`} className={`border rounded-lg p-3 space-y-3 ${highlightedAgentId === agent.id ? "border-primary/50 bg-primary/5" : "border-border"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-medium">{agent.name}</h3>
                      <span className={`text-[10px] px-2 py-0.5 rounded border ${agent.persona?.mode === "live" ? "border-emerald-500/30 text-emerald-500 bg-emerald-500/10" : "border-zinc-500/30 text-zinc-400 bg-zinc-500/10"}`}>
                        {personaModeLabel(agent.persona?.mode)}
                      </span>
                    </div>
                    {!agent.persona ? (
                      <p className="text-xs text-text-dim">{isZh ? "分身数据不可用" : "Persona data unavailable."}</p>
                    ) : (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                              <span>{isZh ? "风格档位" : "Style level"}</span>
                              <span className="font-medium text-text">L{tier.level} · {isZh ? tier.labelZh : tier.labelEn}</span>
                            </div>
                            <input type="range" min={1} max={5} step={1} value={tier.level} onChange={(e) => handlePersonaTierChange(agent.id, Number(e.target.value))} className="w-full accent-primary" />
                            <div className="mt-1 flex justify-between text-[10px] text-text-dim"><span>L1</span><span>L2</span><span>L3</span><span>L4</span><span>L5</span></div>
                          </div>
                          <div>
                            <label className="block text-xs text-text-muted mb-1">{isZh ? "执行模式" : "Execution mode"}</label>
                            <div className="relative" data-persona-mode-menu>
                              <button type="button" onClick={() => setModeMenuAgentId((current) => (current === agent.id ? null : agent.id))} className="w-full bg-bg-input border border-border rounded-md px-2 py-1.5 text-xs text-text text-left hover:border-primary/50 transition-colors">
                                {personaModeLabel(agent.persona.mode)}
                              </button>
                              {modeMenuAgentId === agent.id ? (
                                <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-bg-card shadow-lg p-1">
                                  <button type="button" onClick={() => { handlePersonaModeChange(agent.id, "shadow"); setModeMenuAgentId(null); }} className={`w-full text-left text-xs px-2 py-1.5 rounded ${agent.persona.mode === "shadow" ? "bg-primary/10 text-primary font-medium" : "text-text hover:bg-bg-input"}`}>{isZh ? "观察学习（推荐）" : "Learning only (recommended)"}</button>
                                  <button type="button" onClick={() => { handlePersonaModeChange(agent.id, "live"); setModeMenuAgentId(null); }} className={`w-full text-left text-xs px-2 py-1.5 rounded ${agent.persona.mode === "live" ? "bg-primary/10 text-primary font-medium" : "text-text hover:bg-bg-input"}`}>{isZh ? "自动执行" : "Auto publish"}</button>
                                </div>
                              ) : null}
                            </div>
                            <p className="text-[11px] text-text-dim mt-1">{personaModeDescription(agent.persona.mode)}</p>
                          </div>
                        </div>
                        <div className="text-[11px] text-text-muted">{isZh ? "当前风格稳定度" : "Current style stability"}: {Math.round((agent.persona.confidence || 0) * 100)}%</div>
                        {personaPreviewByAgent[agent.id] ? (
                          <div className="space-y-2">
                            <div className="rounded-md border border-border bg-bg-input/40 p-2">
                              <p className="text-[11px] text-text-dim mb-1">{isZh ? "基础风格" : "Baseline"}</p>
                              <p className="text-xs text-text whitespace-pre-wrap break-words">{personaPreviewByAgent[agent.id]?.baseline || (isZh ? "暂无内容" : "No content")}</p>
                            </div>
                            <div className="rounded-md border border-primary/25 bg-primary/5 p-2">
                              <p className="text-[11px] text-primary mb-1">{isZh ? "数字分身风格" : "Digital twin style"}</p>
                              <p className="text-xs text-text whitespace-pre-wrap break-words">{personaPreviewByAgent[agent.id]?.persona || (isZh ? "暂无内容" : "No content")}</p>
                            </div>
                          </div>
                        ) : null}
                        <div className="flex items-center gap-2">
                          {isPersonaDirty(agent.id, agent.persona) ? (
                            <button type="button" onClick={() => handleSavePersona(agent.id)} disabled={personaSavingAgentId === agent.id} className="text-xs px-2.5 py-1 rounded-md bg-primary text-white hover:bg-primary-dark transition-colors disabled:opacity-50">
                              {personaSavingAgentId === agent.id ? (isZh ? "保存中..." : "Saving...") : (isZh ? "保存风格" : "Save style")}
                            </button>
                          ) : (
                            <span className="text-[11px] text-text-dim">{isZh ? "当前无待保存风格改动" : "No unsaved style changes"}</span>
                          )}
                          <button type="button" onClick={() => { setPreviewDialogAgent({ id: agent.id, name: agent.name }); setPreviewScenarioText(isZh ? "用户提问：如何重构一个不稳定的 cron worker？" : "A user asks how to refactor an unstable cron worker."); }} disabled={personaSavingAgentId === agent.id} className="text-xs px-2.5 py-1 rounded-md border border-border bg-bg hover:bg-bg-input transition-colors disabled:opacity-50">
                            {isZh ? "预览" : "Preview"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Rule Dialog */}
      {ruleDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setRuleDialog(null)}>
          <div className="bg-bg-card border border-border rounded-xl p-5 w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">
                {ruleDialog.mode === "add"
                  ? isZh ? `新增${ruleDialog.polarity === "approved" ? "通过" : "拒绝"}规则 · ${ruleDialog.agentName}` : `Add ${ruleDialog.polarity} rule · ${ruleDialog.agentName}`
                  : isZh ? `编辑规则 · ${ruleDialog.agentName}` : `Edit rule · ${ruleDialog.agentName}`}
              </h3>
              <button type="button" onClick={() => setRuleDialog(null)} className="text-text-dim hover:text-text transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <textarea value={ruleDialogText} onChange={(e) => setRuleDialogText(e.target.value)} className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary min-h-[96px]" placeholder={isZh ? "输入规则内容..." : "Enter rule text..."} maxLength={300} />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRuleDialog(null)} className="text-sm px-3 py-1.5 rounded-md border border-border bg-bg hover:bg-bg-input transition-colors">{isZh ? "取消" : "Cancel"}</button>
              <button type="button" onClick={() => void submitRuleDialog()} disabled={ruleDialogSaving} className="text-sm px-3 py-1.5 rounded-md bg-primary text-white hover:bg-primary-dark transition-colors disabled:opacity-50">
                {ruleDialogSaving ? (isZh ? "保存中..." : "Saving...") : (isZh ? "保存" : "Save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Dialog */}
      {previewDialogAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPreviewDialogAgent(null)}>
          <div className="bg-bg-card border border-border rounded-xl p-5 w-full max-w-2xl mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">{isZh ? `风格预览 · ${previewDialogAgent.name}` : `Style Preview · ${previewDialogAgent.name}`}</h3>
              <button type="button" onClick={() => setPreviewDialogAgent(null)} className="text-text-dim hover:text-text transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <textarea value={previewScenarioText} onChange={(e) => setPreviewScenarioText(e.target.value)} className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary min-h-[100px]" placeholder={isZh ? "输入想预览的场景..." : "Enter scenario for style preview..."} />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setPreviewDialogAgent(null)} className="text-sm px-3 py-1.5 rounded-md border border-border bg-bg hover:bg-bg-input transition-colors">{isZh ? "取消" : "Cancel"}</button>
              <button type="button" onClick={() => void handlePreviewPersona(previewDialogAgent.id, previewScenarioText)} disabled={personaSavingAgentId === previewDialogAgent.id} className="text-sm px-3 py-1.5 rounded-md bg-primary text-white hover:bg-primary-dark transition-colors disabled:opacity-50">
                {personaSavingAgentId === previewDialogAgent.id ? (isZh ? "生成中..." : "Generating...") : (isZh ? "生成预览" : "Generate preview")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AgentsPage() {
  return (
    <Suspense>
      <AgentsContent />
    </Suspense>
  );
}
