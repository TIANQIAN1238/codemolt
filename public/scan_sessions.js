const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const home = os.homedir();

function exists(p) { try { return fs.existsSync(p); } catch { return false; } }
function statSafe(p) { try { return fs.statSync(p); } catch { return null; } }
function readUtf8(p) { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } }
function walkFiles(root, exts, recursive = true) {
  const out = [];
  if (!exists(root)) return out;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const fp = path.join(cur, e.name);
      if (e.isDirectory()) { if (recursive) stack.push(fp); continue; }
      if (!e.isFile()) continue;
      if (exts.some((ext) => fp.endsWith(ext))) out.push(fp);
    }
  }
  return out;
}
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

function scanCodex() {
  const roots = [
    path.join(home, ".codex", "sessions"),
    path.join(home, ".codex", "archived_sessions"),
  ].filter(exists);
  let files = [];
  for (const r of roots) files = files.concat(walkFiles(r, [".jsonl"], true));

  const out = [];
  for (const f of files) {
    const st = statSafe(f); if (!st) continue;
    const lines = parseJsonl(f); if (lines.length < 3) continue;
    const turns = [];
    for (const l of lines) {
      const p = l?.payload;
      if (!p || p.type !== "message") continue;
      const content = Array.isArray(p.content)
        ? p.content.filter((c) => c?.text).map((c) => c.text).join("\n").trim()
        : "";
      if (!content) continue;
      if (p.role === "developer" || p.role === "system") continue;
      if (p.role === "user" && isNoise(content)) continue;
      turns.push({ role: p.role === "user" ? "human" : "assistant", content });
    }
    const human = turns.filter((t) => t.role === "human");
    const ai = turns.filter((t) => t.role === "assistant");
    if (turns.length < 4 || human.length < 2) continue;

    const cwd = lines.find((l) => l?.payload?.cwd)?.payload?.cwd || "";
    out.push({
      source: "codex",
      path: f,
      project: cwd ? path.basename(cwd) : "unknown",
      messages: turns.length,
      human: human.length,
      ai: ai.length,
      modified: st.mtime.toISOString(),
      preview: (human[0]?.content || "").slice(0, 200),
    });
  }
  return out;
}

function scanClaude() {
  const root = path.join(home, ".claude", "projects");
  if (!exists(root)) return [];
  const files = walkFiles(root, [".jsonl"], true);
  const out = [];
  for (const f of files) {
    const st = statSafe(f); if (!st) continue;
    const lines = parseJsonl(f); if (lines.length < 3) continue;
    const turns = [];
    for (const l of lines) {
      if (l?.type !== "user" && l?.type !== "assistant") continue;
      const c = l?.message?.content;
      const text = typeof c === "string"
        ? c
        : Array.isArray(c)
          ? c.filter((x) => x?.type === "text" && x?.text).map((x) => x.text).join("\n")
          : "";
      const content = (text || "").trim();
      if (!content) continue;
      if (l.type === "user" && isNoise(content)) continue;
      turns.push({ role: l.type === "user" ? "human" : "assistant", content });
    }
    const human = turns.filter((t) => t.role === "human");
    const ai = turns.filter((t) => t.role === "assistant");
    if (turns.length < 4 || human.length < 2) continue;

    out.push({
      source: "claude-code",
      path: f,
      project: path.basename(path.dirname(f)),
      messages: turns.length,
      human: human.length,
      ai: ai.length,
      modified: st.mtime.toISOString(),
      preview: (human[0]?.content || "").slice(0, 200),
    });
  }
  return out;
}

function scanCursor() {
  const out = [];

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
        if (argText && argText !== "{}") parts.push(`Args: ${argText.slice(0, 1200)}`);
      }
      const result = tool.result;
      if (result) {
        const resultText = typeof result === "string" ? result : JSON.stringify(result);
        if (resultText) parts.push(`Result: ${resultText.slice(0, 1500)}`);
      }
      if (parts.length > 1) return parts.join("\n");
    }

    const thinking = Array.isArray(bubble?.allThinkingBlocks)
      ? bubble.allThinkingBlocks
          .map((b) => b?.text || b?.content || "")
          .filter(Boolean)
          .join("\n")
      : "";
    if (thinking) return `[Thinking]\n${thinking.slice(0, 1500)}`;

    if (Array.isArray(bubble?.suggestedCodeBlocks) && bubble.suggestedCodeBlocks.length > 0) {
      const block = bubble.suggestedCodeBlocks[0];
      const code = String(block?.code || "").trim();
      const lang = String(block?.language || "text");
      if (code) return `\`\`\`${lang}\n${code.slice(0, 1500)}\n\`\`\``;
    }

    return "";
  }

  // Cursor transcript format
  const root = path.join(home, ".cursor", "projects");
  if (exists(root)) {
    const files = walkFiles(root, [".txt"], true).filter((f) => f.includes("/agent-transcripts/"));
    for (const f of files) {
      const st = statSafe(f); if (!st) continue;
      const txt = readUtf8(f); if (!txt || txt.length < 80) continue;
      const users = [...txt.matchAll(/<user_query>\n?([\s\S]*?)\n?<\/user_query>/g)].map((m) => (m[1] || "").trim());
      if (users.length < 2) continue;
      out.push({
        source: "cursor",
        path: f,
        project: path.basename(path.dirname(path.dirname(f))),
        messages: users.length * 2,
        human: users.length,
        ai: users.length,
        modified: st.mtime.toISOString(),
        preview: (users[0] || "").slice(0, 200),
      });
    }
  }

  // Cursor composer format (state.vscdb)
  const db = path.join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  if (exists(db)) {
    try {
      const raw = execSync(
        `sqlite3 -json ${JSON.stringify(db)} "select key, json_extract(value,'$.composerId') as composerId, json_extract(value,'$.name') as name, json_array_length(json_extract(value,'$.fullConversationHeadersOnly')) as bubbles, json_extract(value,'$.lastUpdatedAt') as lastUpdatedAt from cursorDiskKV where key like 'composerData:%' order by json_extract(value,'$.lastUpdatedAt') desc limit 50;"`,
        { encoding: "utf8" }
      );
      const rows = JSON.parse(raw);
      for (const r of rows) {
        const bubbles = Number(r.bubbles || 0);
        if (bubbles < 4) continue;
        const cid = String(r.composerId || "").trim();
        if (!cid) continue;

        let humanCount = Math.floor(bubbles / 2);
        let aiCount = Math.ceil(bubbles / 2);
        let preview = String(r.name || "Cursor composer session").slice(0, 200);

        try {
          const headerRaw = execSync(
            `sqlite3 -json ${JSON.stringify(db)} "select json_extract(j.value,'$.bubbleId') as bubbleId, json_extract(j.value,'$.type') as type from cursorDiskKV c, json_each(json_extract(c.value,'$.fullConversationHeadersOnly')) j where c.key='composerData:${cid}' limit 80;"`,
            { encoding: "utf8" }
          );
          const headers = JSON.parse(headerRaw);
          humanCount = headers.filter((h) => Number(h.type) === 1).length;
          aiCount = headers.filter((h) => Number(h.type) === 2).length;

          const firstUser = headers.find((h) => Number(h.type) === 1);
          if (firstUser?.bubbleId) {
            const bubbleRaw = execSync(
              `sqlite3 -json ${JSON.stringify(db)} "select value from cursorDiskKV where key='bubbleId:${cid}:${firstUser.bubbleId}' limit 1;"`,
              { encoding: "utf8" }
            );
            const bubbleRows = JSON.parse(bubbleRaw);
            const bubble = bubbleRows[0] ? JSON.parse(bubbleRows[0].value) : null;
            const extracted = bubble ? extractBubbleContent(bubble) : "";
            if (extracted) preview = extracted.slice(0, 200);
          }
        } catch {}

        out.push({
          source: "cursor",
          path: `vscdb:${db}|${cid}`,
          project: "cursor-composer",
          messages: humanCount + aiCount,
          human: humanCount,
          ai: aiCount,
          modified: new Date(Number(r.lastUpdatedAt || 0)).toISOString(),
          preview: preview,
        });
      }
    } catch {}
  }

  return out;
}

const sessions = [...scanCodex(), ...scanClaude(), ...scanCursor()]
  .sort((a, b) => String(b.modified).localeCompare(String(a.modified)))
  .slice(0, 40);

console.log(JSON.stringify(sessions, null, 2));
