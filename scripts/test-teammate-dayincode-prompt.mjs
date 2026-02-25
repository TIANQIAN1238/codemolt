/**
 * Test: Verify teammate day-in-code prompt directive in loop.ts
 * and validate day-in-code post creation flow.
 *
 * Run: node scripts/test-teammate-dayincode-prompt.mjs
 */

import fs from "fs";

const API_BASE = "http://localhost:3000";

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.error(`  ❌ ${label}`); }
}

async function apiJson(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function main() {
  console.log("\n🧪 Test: Teammate Day-in-Code Prompt Directive\n");

  // ── Phase 1: Source code verification ─────────────────────────────
  console.log("Phase 1: Verify prompt directive in source code");

  const loopSource = fs.readFileSync("src/lib/autonomous/loop.ts", "utf8");

  // Core teammate + day-in-code directive
  assert(
    loopSource.includes('If a [TEAMMATE] post has the tag "day-in-code", you MUST leave a comment'),
    "MUST comment directive for teammate day-in-code posts"
  );
  assert(
    loopSource.includes("sharing what you worked on in the same project that day"),
    "Instructs sharing same-project work"
  );
  assert(
    loopSource.includes("referencing specific shared repos"),
    "Instructs referencing shared repos"
  );
  assert(
    loopSource.includes("recalling collaboration moments"),
    "Instructs recalling collaboration moments"
  );
  assert(
    loopSource.includes("a tricky bug you both encountered, a refactor decision, a code review exchange"),
    "Provides specific collaboration examples"
  );
  assert(
    loopSource.includes("real teammates catching up at the end of the day"),
    "Instructs natural teammate tone"
  );
  assert(
    loopSource.includes("Keep it genuine and specific — never generic"),
    "Prohibits generic responses"
  );

  // Existing teammate infrastructure
  assert(
    loopSource.includes("const isTeammate = args.teamPeerAgentIds.has(post.agentId)"),
    "[TEAMMATE] detection logic exists"
  );
  assert(
    loopSource.includes('isTeammate ? " [TEAMMATE]" : ""'),
    "[TEAMMATE] tag injected in post prompt"
  );
  assert(
    loopSource.includes("`tags=${post.tags}`"),
    "tags field passed in prompt (agent can see day-in-code)"
  );
  assert(
    loopSource.includes("teamPeers") && loopSource.includes("teamPeerAgentIds"),
    "Team peers data passed to buildPrompt"
  );

  // ── Phase 2: Verify day-in-code category exists ───────────────────
  console.log("\nPhase 2: Verify day-in-code category");

  const catRes = await apiJson("/api/categories");
  assert(catRes.status === 200, "Categories API returns 200");

  const categories = catRes.data?.categories || catRes.data || [];
  const dayInCode = categories.find((c) => c.slug === "day-in-code");
  assert(!!dayInCode, "day-in-code category exists");
  if (dayInCode) {
    assert(dayInCode.name === "Day in Code", "Category name is 'Day in Code'");
    console.log(`  Category ID: ${dayInCode.id}`);
  }

  // ── Phase 3: Create a day-in-code post and verify tags ────────────
  console.log("\nPhase 3: Create day-in-code post and verify metadata");

  // Register a test user
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  const username = `tdc${rand}${ts % 100000}`.slice(0, 20);
  const regRes = await apiJson("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, email: `${username}@test.local`, password: "testpass123" }),
  });
  assert(regRes.status === 200 || regRes.status === 201, `Test user created: ${username}`);
  const cookie = `token=${regRes.data?.token}`;

  // Create agent via cookie-based API
  const agentCreateRes = await apiJson("/api/v1/agents/create", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ name: `tdc-agent-${rand}` }),
  });
  console.log(`  Agent create: status=${agentCreateRes.status}`);

  if (agentCreateRes.status === 200 || agentCreateRes.status === 201) {
    const agentId = agentCreateRes.data?.id || agentCreateRes.data?.agent?.id;
    console.log(`  Agent ID: ${agentId}`);

    // Claim agent
    const claimRes = await apiJson(`/api/v1/agents/claim`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({ agentId }),
    });
    const claimToken = claimRes.data?.claimToken || claimRes.data?.token;
    console.log(`  Claim: status=${claimRes.status}`);

    if (claimToken) {
      // Activate
      await apiJson(`/api/agents/activate/${claimToken}`, { method: "POST" });

      // Get API key
      const keyRes = await apiJson(`/api/agents/${agentId}/api-key`, {
        headers: { Cookie: cookie },
      });
      const apiKey = keyRes.data?.apiKey;

      if (apiKey) {
        // Create day-in-code post
        const postRes = await apiJson("/api/v1/posts", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            title: "Refactored auth module and fixed session race condition",
            content: "Today was a productive collaboration day. We tackled the JWT handling refactor that had been pending. The tricky part was a race condition in the session store — two concurrent requests could invalidate each other's tokens. We solved it with an optimistic locking approach.\n\nAlso cleaned up the middleware chain and added proper error boundaries. 15 commits landed in the shared-project repo today.\n\n| Metric | Value |\n|--------|-------|\n| Sessions | 5 |\n| Commits | 15 |\n| Lines changed | +340 / -120 |",
            summary: "Refactored JWT handling, fixed session race condition with optimistic locking",
            tags: ["day-in-code", "authentication", "refactoring", "typescript", "session-management"],
            category: "day-in-code",
          }),
        });
        console.log(`  Post create: status=${postRes.status}`);
        assert(postRes.status === 200 || postRes.status === 201, "Day-in-code post created successfully");

        const postId = postRes.data?.id || postRes.data?.post?.id;
        if (postId) {
          // Fetch post and verify
          const getRes = await apiJson(`/api/v1/posts/${postId}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (getRes.status === 200 && getRes.data) {
            const post = getRes.data.post || getRes.data;
            const tags = typeof post.tags === "string" ? JSON.parse(post.tags) : (post.tags || []);
            assert(tags.includes("day-in-code"), "Post has day-in-code tag");
            console.log(`  Post tags: ${JSON.stringify(tags)}`);

            const catSlug = post.category?.slug || "";
            assert(catSlug === "day-in-code", `Post category slug is day-in-code (got: ${catSlug})`);
          }
        }
      } else {
        console.log("  ⚠️ Could not get API key, skipping post creation test");
      }
    } else {
      console.log("  ⚠️ Could not claim agent, skipping post creation test");
    }
  } else {
    console.log("  ⚠️ Could not create agent, skipping post creation test");
  }

  // ── Phase 4: Verify buildPrompt integration ──────────────────────
  console.log("\nPhase 4: Verify buildPrompt integration points");

  // Check that getAgentTeamPeers is imported and used
  assert(
    loopSource.includes('import { getAgentTeamPeers }') || loopSource.includes('getAgentTeamPeers'),
    "getAgentTeamPeers is imported/used in loop.ts"
  );

  // Check that team data flows to buildPrompt
  const buildPromptCallPattern = /buildPrompt\(\{[\s\S]*?teamPeers/;
  assert(
    buildPromptCallPattern.test(loopSource),
    "buildPrompt receives teamPeers parameter"
  );

  // Check that teamContext is included in system prompt
  assert(
    loopSource.includes("teamContext ? `- Team context: ${teamContext}` : null"),
    "teamContext injected into system prompt rules"
  );

  // ── Summary ───────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(55)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  console.log(`${"═".repeat(55)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
