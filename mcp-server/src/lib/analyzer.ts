import type { ParsedSession, SessionAnalysis, ConversationTurn } from "./types.js";

// Analyze a parsed session and extract structured insights
export function analyzeSession(session: ParsedSession): SessionAnalysis {
  const allContent = session.turns.map((t) => t.content).join("\n");
  const humanContent = session.turns
    .filter((t) => t.role === "human")
    .map((t) => t.content)
    .join("\n");
  const aiContent = session.turns
    .filter((t) => t.role === "assistant")
    .map((t) => t.content)
    .join("\n");

  return {
    summary: generateSummary(session),
    topics: extractTopics(allContent),
    languages: detectLanguages(allContent),
    keyInsights: extractInsights(session.turns),
    codeSnippets: extractCodeSnippets(allContent),
    problems: extractProblems(humanContent),
    solutions: extractSolutions(aiContent),
    suggestedTitle: suggestTitle(session),
    suggestedTags: suggestTags(allContent),
  };
}

function generateSummary(session: ParsedSession): string {
  const humanMsgs = session.turns.filter((t) => t.role === "human");
  const problems = extractProblems(humanMsgs.map((t) => t.content).join("\n"));
  const langs = detectLanguages(session.turns.map((t) => t.content).join("\n"));

  // Build a narrative summary instead of a mechanical one
  const parts: string[] = [];

  if (problems.length > 0) {
    parts.push(`Ran into ${problems.length > 1 ? "a few issues" : "an issue"} while working on ${session.project}`);
  } else {
    parts.push(`Worked on ${session.project}`);
  }

  if (langs.length > 0) {
    parts.push(`using ${langs.slice(0, 3).join(", ")}`);
  }

  // Extract the core task from the first meaningful human message
  const firstTask = humanMsgs.find((m) => m.content.trim().length > 20);
  if (firstTask) {
    const task = firstTask.content.split("\n")[0].trim().slice(0, 120);
    parts.push(`— started with: "${task}"`);
  }

  return parts.join(" ") + ".";
}

function extractTopics(content: string): string[] {
  const topics: Set<string> = new Set();

  // Common programming topics
  const topicPatterns: [RegExp, string][] = [
    [/\b(react|vue|angular|svelte|nextjs|next\.js|nuxt)\b/i, "frontend"],
    [/\b(express|fastify|koa|nest\.?js|django|flask|rails)\b/i, "backend"],
    [/\b(typescript|javascript|python|rust|go|java|c\+\+|ruby|swift|kotlin)\b/i, "programming-language"],
    [/\b(docker|kubernetes|k8s|ci\/cd|deploy|devops)\b/i, "devops"],
    [/\b(sql|postgres|mysql|mongodb|redis|database|prisma|drizzle)\b/i, "database"],
    [/\b(test|jest|vitest|pytest|testing|spec|unit test)\b/i, "testing"],
    [/\b(api|rest|graphql|grpc|websocket)\b/i, "api"],
    [/\b(auth|jwt|oauth|session|login|password)\b/i, "authentication"],
    [/\b(css|tailwind|styled|sass|scss|styling)\b/i, "styling"],
    [/\b(git|merge|rebase|branch|commit)\b/i, "git"],
    [/\b(performance|optimize|cache|lazy|memo)\b/i, "performance"],
    [/\b(debug|error|bug|fix|issue|crash)\b/i, "debugging"],
    [/\b(refactor|clean|architecture|pattern|design)\b/i, "architecture"],
    [/\b(security|vulnerability|xss|csrf|injection)\b/i, "security"],
    [/\b(ai|ml|llm|gpt|claude|model|prompt)\b/i, "ai-ml"],
  ];

  for (const [pattern, topic] of topicPatterns) {
    if (pattern.test(content)) {
      topics.add(topic);
    }
  }

  return Array.from(topics);
}

function detectLanguages(content: string): string[] {
  const langs: Set<string> = new Set();

  const langPatterns: [RegExp, string][] = [
    [/```(?:typescript|tsx?)\b/i, "TypeScript"],
    [/```(?:javascript|jsx?)\b/i, "JavaScript"],
    [/```python\b/i, "Python"],
    [/```rust\b/i, "Rust"],
    [/```go\b/i, "Go"],
    [/```java\b/i, "Java"],
    [/```(?:c\+\+|cpp)\b/i, "C++"],
    [/```c\b/i, "C"],
    [/```ruby\b/i, "Ruby"],
    [/```swift\b/i, "Swift"],
    [/```kotlin\b/i, "Kotlin"],
    [/```(?:bash|sh|shell|zsh)\b/i, "Shell"],
    [/```sql\b/i, "SQL"],
    [/```html\b/i, "HTML"],
    [/```css\b/i, "CSS"],
    [/```yaml\b/i, "YAML"],
    [/```json\b/i, "JSON"],
    [/```(?:dockerfile|docker)\b/i, "Docker"],
  ];

  for (const [pattern, lang] of langPatterns) {
    if (pattern.test(content)) {
      langs.add(lang);
    }
  }

  // Also detect from imports/keywords if no code blocks
  if (langs.size === 0) {
    if (/\bimport\s+.*\s+from\s+['"]/.test(content)) langs.add("JavaScript/TypeScript");
    if (/\bdef\s+\w+\s*\(/.test(content)) langs.add("Python");
    if (/\bfn\s+\w+\s*\(/.test(content)) langs.add("Rust");
    if (/\bfunc\s+\w+\s*\(/.test(content)) langs.add("Go");
  }

  return Array.from(langs);
}

function extractInsights(turns: ConversationTurn[]): string[] {
  const insights: string[] = [];

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.role !== "assistant") continue;
    const content = turn.content;

    // Look for key insight patterns in AI responses
    const patterns = [
      /(?:the (?:issue|problem|bug|root cause) (?:is|was))\s+(.{20,150})/i,
      /(?:the (?:solution|fix|answer) (?:is|was))\s+(.{20,150})/i,
      /(?:you (?:should|need to|can))\s+(.{20,150})/i,
      /(?:this (?:happens|occurs) because)\s+(.{20,150})/i,
      /(?:(?:key|important) (?:thing|point|takeaway))\s+(.{20,150})/i,
      /(?:TIL|Today I learned|Learned that)\s+(.{20,150})/i,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        insights.push(match[1].trim().replace(/\.$/, ""));
      }
    }
  }

  // Deduplicate and limit
  return [...new Set(insights)].slice(0, 10);
}

function extractCodeSnippets(
  content: string
): Array<{ language: string; code: string; context: string }> {
  const snippets: Array<{ language: string; code: string; context: string }> = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;

  let match;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const language = match[1] || "unknown";
    const code = match[2].trim();

    if (code.length < 10 || code.length > 2000) continue;

    // Get surrounding context (text before the code block)
    const beforeIdx = Math.max(0, match.index - 200);
    const context = content.slice(beforeIdx, match.index).trim().split("\n").pop() || "";

    snippets.push({ language, code, context });
  }

  return snippets.slice(0, 10);
}

function extractProblems(humanContent: string): string[] {
  const problems: string[] = [];
  const lines = humanContent.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 15 || trimmed.length > 300) continue;

    // Look for problem indicators
    if (
      /\b(error|bug|issue|problem|broken|doesn't work|not working|failing|crash|wrong)\b/i.test(trimmed) &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith("#")
    ) {
      problems.push(trimmed);
    }
  }

  return [...new Set(problems)].slice(0, 5);
}

function extractSolutions(aiContent: string): string[] {
  const solutions: string[] = [];
  const sentences = aiContent.split(/[.!]\s+/);

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length < 20 || trimmed.length > 300) continue;

    if (
      /\b(fix|solve|solution|resolve|instead|should|try|change|update|replace|use)\b/i.test(trimmed) &&
      !/\b(error|bug|issue|problem)\b/i.test(trimmed)
    ) {
      solutions.push(trimmed);
    }
  }

  return [...new Set(solutions)].slice(0, 5);
}

function suggestTitle(session: ParsedSession): string {
  const allContent = session.turns.map((t) => t.content).join("\n");
  const humanContent = session.turns.filter((t) => t.role === "human").map((t) => t.content).join("\n");
  const problems = extractProblems(humanContent);
  const solutions = extractSolutions(
    session.turns.filter((t) => t.role === "assistant").map((t) => t.content).join("\n")
  );
  const langs = detectLanguages(allContent);
  const topics = extractTopics(allContent);

  // Try to generate a catchy title like Juejin/HN style
  const langStr = langs.slice(0, 2).join("/") || "code";
  const project = session.project || "my project";

  // Bug story: "踩坑记" style
  if (problems.length > 0) {
    const problem = problems[0].slice(0, 60).replace(/\n/g, " ");
    return `Debugging ${langStr}: ${problem}`;
  }

  // If there are solutions, frame it as a how-to
  if (solutions.length > 0) {
    const solution = solutions[0].slice(0, 60).replace(/\n/g, " ");
    return `How I ${solution.toLowerCase().replace(/^(you |we |i )?(should |need to |can )?/i, "")}`;
  }

  // Topic-based title
  if (topics.length > 0) {
    const topicStr = topics.slice(0, 2).join(" + ");
    return `Working with ${topicStr} in ${project}`;
  }

  // Fallback: use first human message but clean it up
  const firstHuman = session.turns.find((t) => t.role === "human");
  if (firstHuman) {
    const cleaned = firstHuman.content.split("\n")[0].trim().slice(0, 80);
    if (cleaned.length > 15) return cleaned;
  }

  return `${langStr} session: things I learned in ${project}`;
}

function suggestTags(content: string): string[] {
  const tags: Set<string> = new Set();

  // Detect specific technologies
  const techPatterns: [RegExp, string][] = [
    [/\breact\b/i, "react"],
    [/\bnext\.?js\b/i, "nextjs"],
    [/\btypescript\b/i, "typescript"],
    [/\bpython\b/i, "python"],
    [/\brust\b/i, "rust"],
    [/\bdocker\b/i, "docker"],
    [/\bprisma\b/i, "prisma"],
    [/\btailwind\b/i, "tailwindcss"],
    [/\bnode\.?js\b/i, "nodejs"],
    [/\bgit\b/i, "git"],
    [/\bpostgres\b/i, "postgresql"],
    [/\bmongodb\b/i, "mongodb"],
    [/\bredis\b/i, "redis"],
    [/\baws\b/i, "aws"],
    [/\bvue\b/i, "vue"],
    [/\bangular\b/i, "angular"],
    [/\bsvelte\b/i, "svelte"],
    [/\bgraphql\b/i, "graphql"],
    [/\bwebsocket\b/i, "websocket"],
  ];

  for (const [pattern, tag] of techPatterns) {
    if (pattern.test(content)) {
      tags.add(tag);
    }
  }

  // Detect activity type
  if (/\b(bug|fix|error|debug)\b/i.test(content)) tags.add("bug-fix");
  if (/\b(refactor|clean|restructure)\b/i.test(content)) tags.add("refactoring");
  if (/\b(performance|optimize|speed|cache)\b/i.test(content)) tags.add("performance");
  if (/\b(test|spec|coverage)\b/i.test(content)) tags.add("testing");
  if (/\b(deploy|ci|cd|pipeline)\b/i.test(content)) tags.add("devops");

  return Array.from(tags).slice(0, 8);
}
