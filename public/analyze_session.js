const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const source = process.argv[2];
const target = process.argv[3];
if (!source || !target) {
  console.error("Usage: node analyze_session.js <source> <path>");
  process.exit(1);
}

function readUtf8(p) { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } }
function parseJsonl(file) {
  const text = readUtf8(file);
  if (!text) return [];
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}
function isNoise(content) {
  return (
    content.startsWith("# AGENTS.md") ||
    content.startsWith("<environment_context>") ||
    content.startsWith("<permissions") ||
    content.startsWith("<app-context>") ||
    content.startsWith("<collaboration_mode>") ||
    content.startsWith("<local-command-caveat>") ||
    content.startsWith("<local-command-stdout>") ||
    content.startsWith("<local-command-stderr>") ||
    content.startsWith("<command-name>")
  );
}
function extractBubbleContent(bubble) {
  const text = String(bubble?.text || bubble?.message || bubble?.rawText || "").trim();
  if (text) return text;

  const tool = bubble?.toolFormerData;
  if (tool && typeof tool === "object") {
    const parts = [];
    const toolName = String(tool.name || tool.tool || "unknown_tool");
    parts.push(`[Tool: ${toolName}]`);
    const args = tool.params || tool.rawArgs;
    if (args) {
      const argText = typeof args === "string" ? args : JSON.stringify(args);
      if (argText && argText !== "{}") parts.push(`Args: ${argText.slice(0, 1500)}`);
    }
    const result = tool.result;
    if (result) {
      const resultText = typeof result === "string" ? result : JSON.stringify(result);
      if (resultText) parts.push(`Result: ${resultText.slice(0, 2000)}`);
    }
    if (parts.length > 1) return parts.join("\n");
  }

  const thinking = Array.isArray(bubble?.allThinkingBlocks)
    ? bubble.allThinkingBlocks
        .map((b) => b?.text || b?.content || "")
        .filter(Boolean)
        .join("\n")
    : "";
  if (thinking) return `[Thinking]\n${thinking.slice(0, 2000)}`;

  if (Array.isArray(bubble?.suggestedCodeBlocks) && bubble.suggestedCodeBlocks.length > 0) {
    const block = bubble.suggestedCodeBlocks[0];
    const code = String(block?.code || "").trim();
    const lang = String(block?.language || "text");
    if (code) return `\`\`\`${lang}\n${code.slice(0, 1800)}\n\`\`\``;
  }

  return "";
}
function detectLanguages(content) {
  const langs = [];
  const map = [
    [/```(?:typescript|tsx?)\b/i, "TypeScript"],
    [/```(?:javascript|jsx?)\b/i, "JavaScript"],
    [/```python\b/i, "Python"],
    [/```rust\b/i, "Rust"],
    [/```go\b/i, "Go"],
    [/```sql\b/i, "SQL"],
    [/```(?:bash|sh|zsh|shell)\b/i, "Shell"],
  ];
  for (const [re, name] of map) if (re.test(content)) langs.push(name);
  if (!langs.length && /\bimport\s+.*\s+from\s+['"]/i.test(content)) langs.push("JavaScript/TypeScript");
  return [...new Set(langs)];
}
function extractProblems(text) {
  const out = [];
  for (const line of text.split("\n").map((s) => s.trim())) {
    if (!line || line.length < 12 || line.length > 300) continue;
    if (/\b(error|bug|issue|problem|broken|failing|crash|not working|有问题|报错|失败)\b/i.test(line)) out.push(line);
  }
  return [...new Set(out)].slice(0, 8);
}
function extractSolutions(text) {
  const out = [];
  for (const seg of text.split(/[.!。]\s+/).map((s) => s.trim())) {
    if (!seg || seg.length < 16 || seg.length > 300) continue;
    if (/\b(fix|solve|solution|resolve|change|update|replace|use|try|建议|修复|改成|排查)\b/i.test(seg)) out.push(seg);
  }
  return [...new Set(out)].slice(0, 8);
}
function extractSnippets(text) {
  const blocks = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const lang = (m[1] || "text").trim();
    const code = (m[2] || "").trim();
    if (code.length >= 20 && code.length <= 2000) blocks.push({ language: lang, code: code.slice(0, 1200) });
  }
  return blocks.slice(0, 3);
}

let turns = [];
let project = "unknown-project";

if (source === "codex") {
  const lines = parseJsonl(target);
  const cwd = lines.find((l) => l?.payload?.cwd)?.payload?.cwd;
  if (cwd) project = path.basename(cwd);
  for (const l of lines) {
    const p = l?.payload;
    if (!p || p.type !== "message") continue;
    const text = Array.isArray(p.content) ? p.content.filter((c) => c?.text).map((c) => c.text).join("\n").trim() : "";
    if (!text) continue;
    if (p.role === "developer" || p.role === "system") continue;
    if (p.role === "user" && isNoise(text)) continue;
    turns.push({ role: p.role === "user" ? "human" : "assistant", content: text });
  }
} else if (source === "claude-code") {
  const lines = parseJsonl(target);
  project = path.basename(path.dirname(target));
  for (const l of lines) {
    if (l?.type !== "user" && l?.type !== "assistant") continue;
    const c = l?.message?.content;
    const text = typeof c === "string"
      ? c
      : Array.isArray(c) ? c.filter((x) => x?.type === "text" && x?.text).map((x) => x.text).join("\n") : "";
    if (!text) continue;
    if (l.type === "user" && isNoise(text)) continue;
    turns.push({ role: l.type === "user" ? "human" : "assistant", content: text });
  }
} else if (source === "cursor" && target.startsWith("vscdb:")) {
  // vscdb:<dbPath>|<composerId>
  const rest = target.slice("vscdb:".length);
  const idx = rest.lastIndexOf("|");
  const dbPath = rest.slice(0, idx);
  const composerId = rest.slice(idx + 1);
  project = "cursor-composer";
  try {
    const metaRaw = execSync(
      `sqlite3 -json ${JSON.stringify(dbPath)} "select value from cursorDiskKV where key='composerData:${composerId}' limit 1;"`,
      { encoding: "utf8" }
    );
    const metaRows = JSON.parse(metaRaw);
    const meta = metaRows[0] ? JSON.parse(metaRows[0].value) : null;
    if (meta?.name) project = meta.name;

    const headersRaw = execSync(
      `sqlite3 -json ${JSON.stringify(dbPath)} "select json_extract(j.value,'$.bubbleId') as bubbleId, json_extract(j.value,'$.type') as type from cursorDiskKV c, json_each(json_extract(c.value,'$.fullConversationHeadersOnly')) j where c.key='composerData:${composerId}' limit 160;"`,
      { encoding: "utf8" }
    );
    const headers = JSON.parse(headersRaw);

    for (const h of headers) {
      const bubbleId = String(h?.bubbleId || "");
      if (!bubbleId) continue;
      const type = Number(h?.type || 0);
      const bubbleRaw = execSync(
        `sqlite3 -json ${JSON.stringify(dbPath)} "select value from cursorDiskKV where key='bubbleId:${composerId}:${bubbleId}' limit 1;"`,
        { encoding: "utf8" }
      );
      const bubbleRows = JSON.parse(bubbleRaw);
      const bubble = bubbleRows[0] ? JSON.parse(bubbleRows[0].value) : null;
      const content = bubble ? extractBubbleContent(bubble) : "";
      if (!content) continue;
      turns.push({ role: type === 1 ? "human" : "assistant", content: content.slice(0, 5000) });
    }
  } catch {}
} else {
  // cursor transcript txt
  project = path.basename(path.dirname(path.dirname(target)));
  const txt = readUtf8(target);
  const blocks = txt.split(/^user:\s*$/m);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const q = block.match(/<user_query>\n?([\s\S]*?)\n?<\/user_query>/);
    if (q?.[1]) {
      const human = q[1].trim();
      if (human && !isNoise(human)) turns.push({ role: "human", content: human });
    }
    const after = block.split(/<\/user_query>/)[1];
    if (after) {
      const ai = after.replace(/^\s*\n\s*A:\s*\n?/, "").trim();
      if (ai) turns.push({ role: "assistant", content: ai });
    }
  }
}

const humanText = turns.filter((t) => t.role === "human").map((t) => t.content).join("\n");
const aiText = turns.filter((t) => t.role === "assistant").map((t) => t.content).join("\n");
const all = turns.map((t) => t.content).join("\n");

const problems = extractProblems(humanText);
const solutions = extractSolutions(aiText);
const snippets = extractSnippets(all);
const languages = detectLanguages(all);
const preview = (turns.find((t) => t.role === "human")?.content || "").slice(0, 220);

console.log(JSON.stringify({
  source,
  path: target,
  project,
  messages: turns.length,
  human: turns.filter((t) => t.role === "human").length,
  ai: turns.filter((t) => t.role === "assistant").length,
  preview,
  languages,
  problems,
  solutions,
  snippets
}, null, 2));
