"use client";

import { useEffect, useState } from "react";
import {
  Check,
  AlertCircle,
  Sparkles,
  Eye,
  EyeOff,
  Trash2,
  Zap,
  Loader2,
} from "lucide-react";
import { useLang } from "@/components/Providers";

export default function AiProviderPage() {
  const { locale } = useLang();
  const isZh = locale === "zh";
  const tr = (zh: string, en: string) => (isZh ? zh : en);

  const [loading, setLoading] = useState(true);

  const [aiChoice, setAiChoice] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiShowKey, setAiShowKey] = useState(false);
  const [aiHasExisting, setAiHasExisting] = useState(false);
  const [aiCreditBalance, setAiCreditBalance] = useState("0.00");
  const [aiCreditGranted, setAiCreditGranted] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiMessage, setAiMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [aiChoices, setAiChoices] = useState<{ name: string; providerID: string; api: string; baseURL: string }[]>([]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.user) { window.location.href = "/login"; return; }
      })
      .catch(() => { window.location.href = "/login"; })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/auth/ai-provider")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        if (data.choices) setAiChoices(data.choices);
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

  if (loading) {
    return (
      <div>
        <div className="h-8 w-32 bg-bg-input rounded mb-6 animate-pulse" />
        <div className="h-64 bg-bg-card border border-border rounded-xl animate-pulse" />
      </div>
    );
  }

  const fallbackChoices = [
    { name: "OpenAI", providerID: "openai", api: "openai", baseURL: "https://api.openai.com/v1" },
    { name: "Anthropic", providerID: "anthropic", api: "anthropic", baseURL: "https://api.anthropic.com/v1" },
    { name: "Google", providerID: "google", api: "google", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai" },
    { name: "OpenRouter", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://openrouter.ai/api/v1" },
    { name: "xAI (Grok)", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://api.x.ai/v1" },
    { name: "DeepSeek", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://api.deepseek.com/v1" },
    { name: "Groq", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://api.groq.com/openai/v1" },
    { name: "Perplexity", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://api.perplexity.ai" },
    { name: "Together AI", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://api.together.xyz/v1" },
    { name: "Moonshot AI", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://api.moonshot.ai/v1" },
    { name: "MiniMax", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://api.minimax.io/v1" },
    { name: "Hugging Face", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://router.huggingface.co/v1" },
    { name: "Custom Provider", providerID: "openai-compatible", api: "openai-compatible", baseURL: "" },
  ];

  const choices = aiChoices.length > 0 ? aiChoices : fallbackChoices;

  const testConnection = async () => {
    setAiTesting(true);
    setAiMessage(null);
    try {
      const res = await fetch("/api/auth/ai-provider/test", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setAiMessage({ type: "success", text: tr(`连接成功 (${data.model})`, `Connection successful (${data.model})`) });
      } else {
        setAiMessage({ type: "error", text: tr(`连接失败：${data.error}`, `Connection failed: ${data.error}`) });
      }
    } catch {
      setAiMessage({ type: "error", text: tr("网络错误", "Network error") });
    } finally {
      setAiTesting(false);
    }
  };

  const selectedChoice = aiChoices.find((c) => c.name === aiChoice) || { name: aiChoice, providerID: "openai-compatible", api: "openai-compatible", baseURL: "" };
  const showBaseUrl = !selectedChoice.baseURL || selectedChoice.name === "Custom Provider";
  const keyPrefix = selectedChoice.api === "anthropic" ? "sk-ant-..." : selectedChoice.name === "xAI (Grok)" ? "xai-..." : selectedChoice.name === "Groq" ? "gsk_..." : selectedChoice.name === "OpenRouter" ? "sk-or-..." : selectedChoice.name === "Perplexity" ? "pplx-..." : selectedChoice.name === "Google" ? "AIza..." : "sk-...";

  const modelSuggestions: Record<string, { value: string; label: string }[]> = {
    OpenAI: [{ value: "gpt-4o", label: "GPT-4o" }, { value: "gpt-4o-mini", label: "GPT-4o Mini" }, { value: "o3-mini", label: "o3-mini" }],
    Anthropic: [{ value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" }, { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" }],
    Google: [{ value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }, { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }],
    DeepSeek: [{ value: "deepseek-chat", label: "DeepSeek Chat" }, { value: "deepseek-reasoner", label: "DeepSeek Reasoner" }],
    "xAI (Grok)": [{ value: "grok-3-mini", label: "Grok 3 Mini" }, { value: "grok-3", label: "Grok 3" }],
    Groq: [{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" }, { value: "mixtral-8x7b-32768", label: "Mixtral 8x7B" }],
    OpenRouter: [{ value: "anthropic/claude-sonnet-4-20250514", label: "Claude Sonnet 4" }, { value: "openai/gpt-4o", label: "GPT-4o" }, { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" }],
    Perplexity: [{ value: "sonar-pro", label: "Sonar Pro" }, { value: "sonar", label: "Sonar" }],
    "Moonshot AI": [{ value: "moonshot-v1-128k", label: "Moonshot v1 128K" }],
  };
  const suggestions = modelSuggestions[aiChoice];

  return (
    <div>
      <h1 className="text-xl font-bold mb-5">{tr("AI 提供商", "AI Provider")}</h1>
      <div className="bg-bg-card border border-border rounded-xl p-6">
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-2">
          <Sparkles className="w-5 h-5 text-text-muted" />
          {tr("AI 提供商", "AI Provider")}
        </h2>
        <p className="text-xs text-text-muted mb-3">
          {tr(
            "为帖子的 AI Rewrite 功能提供模型能力。你可以配置自己的 API Key，或使用平台额度。",
            "Power the AI Rewrite feature on your posts. Configure your own API key, or use platform credit."
          )}
        </p>

        <div className="mb-4 flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-bg-input/50 text-xs">
          <div className="flex-1">
            <span className="text-text-muted">{tr("平台额度：", "Platform credit: ")}</span>
            <span className={`font-semibold ${parseFloat(aiCreditBalance) > 0 ? "text-accent-green" : "text-text-dim"}`}>${aiCreditBalance}</span>
            {!aiCreditGranted && <span className="text-text-dim ml-1">{tr("（未领取）", "(not claimed)")}</span>}
          </div>
          {aiHasExisting && (
            <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] font-medium">
              {tr("自定义提供商已启用", "Custom provider active")}
            </span>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-text-muted mb-1.5">{tr("提供商", "Provider")}</label>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
              {choices.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => { setAiChoice(c.name); setAiBaseUrl(c.baseURL || ""); setAiModel(""); }}
                  className={`text-xs px-2 py-1.5 rounded-md border transition-colors text-center ${aiChoice === c.name ? "border-primary text-primary bg-primary/10 font-medium" : "border-border bg-bg hover:bg-bg-input"}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          {aiChoice && (
            <>
              <div>
                <label className="block text-xs text-text-muted mb-1">API Key</label>
                <div className="relative">
                  <input
                    type={aiShowKey ? "text" : "password"}
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                    placeholder={aiHasExisting ? "••••••••  (saved, enter new to update)" : keyPrefix}
                    className="w-full bg-bg-input border border-border rounded-md px-3 py-2 pr-10 text-sm text-text focus:outline-none focus:border-primary"
                  />
                  <button type="button" onClick={() => setAiShowKey((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-dim hover:text-text">
                    {aiShowKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {showBaseUrl && (
                <div>
                  <label className="block text-xs text-text-muted mb-1">Base URL</label>
                  <input type="url" value={aiBaseUrl} onChange={(e) => setAiBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary" />
                </div>
              )}
              <div>
                <label className="block text-xs text-text-muted mb-1">{tr("模型", "Model")}</label>
                {suggestions && (
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {suggestions.map((s) => (
                      <button key={s.value} type="button" onClick={() => setAiModel(s.value)} className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${aiModel === s.value ? "border-primary text-primary bg-primary/10" : "border-border bg-bg hover:bg-bg-input hover:text-primary"}`}>{s.label}</button>
                    ))}
                  </div>
                )}
                <input type="text" value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder={tr("模型名称（可选）", "model name (optional)")} className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-primary" />
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
                      const body: Record<string, string> = { displayName: aiChoice };
                      if (aiApiKey) body.apiKey = aiApiKey;
                      if (aiBaseUrl) body.baseUrl = aiBaseUrl;
                      if (aiModel) body.model = aiModel;
                      const res = await fetch("/api/auth/ai-provider", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
                      if (!res.ok) {
                        const data = await res.json();
                        setAiMessage({ type: "error", text: data.error || tr("保存失败", "Failed to save") });
                        return;
                      }
                      setAiHasExisting(true);
                      setAiApiKey("");
                      setAiMessage({ type: "success", text: tr("AI 提供商已保存，正在测试连接...", "AI provider saved, testing connection...") });
                      // Auto-test after save
                      setTimeout(() => testConnection(), 100);
                    } catch {
                      setAiMessage({ type: "error", text: tr("网络错误", "Network error") });
                    } finally {
                      setAiSaving(false);
                    }
                  }}
                  className="bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
                >
                  {aiSaving ? tr("保存中...", "Saving...") : tr("保存提供商", "Save Provider")}
                </button>
                {aiHasExisting && (
                  <button
                    type="button"
                    disabled={aiTesting}
                    onClick={testConnection}
                    className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-md border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                  >
                    {aiTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    {aiTesting ? tr("测试中...", "Testing...") : tr("测试连接", "Test Connection")}
                  </button>
                )}
                {aiHasExisting && (
                  <button
                    type="button"
                    onClick={async () => {
                      setAiSaving(true);
                      setAiMessage(null);
                      try {
                        const res = await fetch("/api/auth/ai-provider", { method: "DELETE" });
                        if (!res.ok) { setAiMessage({ type: "error", text: tr("移除失败", "Failed to remove") }); return; }
                        setAiChoice("");
                        setAiApiKey("");
                        setAiBaseUrl("");
                        setAiModel("");
                        setAiHasExisting(false);
                        setAiMessage({ type: "success", text: tr("已移除 AI 提供商，切换为平台额度。", "AI provider removed. Using platform credit.") });
                      } catch {
                        setAiMessage({ type: "error", text: tr("网络错误", "Network error") });
                      } finally {
                        setAiSaving(false);
                      }
                    }}
                    className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-md border border-accent-red/30 text-accent-red hover:bg-accent-red/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {tr("移除", "Remove")}
                  </button>
                )}
              </div>
            </>
          )}
          {aiMessage && (
            <div className={`flex items-center gap-2 text-xs ${aiMessage.type === "success" ? "text-accent-green" : "text-accent-red"}`}>
              {aiMessage.type === "success" ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {aiMessage.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
