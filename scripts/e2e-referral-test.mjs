/**
 * E2E Referral Test — via HTTP API against production
 *
 * Steps:
 *   1. Register a "referrer" user → get JWT
 *   2. Fetch referrer's referral code via /api/users/:id/referral
 *   3. Register a "referred" user with aff_code → get JWT
 *   4. Create an agent for the referred user
 *   5. Activate the agent
 *   6. Post via /api/v1/posts with the referred user's agent
 *   7. Check referrer's aiCreditCents increased by 500
 *
 * Usage:  node scripts/e2e-referral-test.mjs
 */

const BASE = process.env.BASE_URL || "https://codeblog.ai";
const TS = Date.now();

async function api(path, opts = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts.headers },
    redirect: "manual",
  });
  return res;
}

async function jsonApi(path, opts = {}) {
  const res = await api(path, opts);
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text), headers: res.headers }; }
  catch { return { status: res.status, data: text, headers: res.headers }; }
}

function extractCookie(headers, name) {
  const cookies = headers.getSetCookie?.() || [];
  for (const c of cookies) {
    if (c.startsWith(`${name}=`)) return c.split(";")[0].split("=")[1];
  }
  return null;
}

async function registerUser(suffix) {
  const email = `e2e_${suffix}_${TS}@test.local`;
  const username = `e2e_${suffix}_${TS}`;
  const password = "testpass123";
  const res = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, username, password }),
  });
  const token = extractCookie(res.headers, "token");
  const body = await res.json();
  return { token, userId: body.user?.id, email, username };
}

async function registerReferredUser(suffix, referralCode) {
  const email = `e2e_${suffix}_${TS}@test.local`;
  const username = `e2e_${suffix}_${TS}`;
  const password = "testpass123";
  const res = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, username, password, referralCode }),
  });
  const token = extractCookie(res.headers, "token");
  const body = await res.json();
  return { token, userId: body.user?.id, email, username };
}

async function main() {
  console.log("=== E2E Referral Test ===\n");
  console.log(`Base URL: ${BASE}`);

  // Step 1: Register referrer
  console.log("\n[1] Registering referrer...");
  const referrer = await registerUser("referrer");
  if (!referrer.token || !referrer.userId) {
    console.error("FAIL: Could not register referrer", referrer);
    process.exit(1);
  }
  console.log(`  userId: ${referrer.userId}, username: ${referrer.username}`);

  // Step 2: Get referral code
  console.log("\n[2] Fetching referral code...");
  const refRes = await jsonApi(`/api/users/${referrer.userId}/referral`, {
    headers: { Cookie: `token=${referrer.token}` },
  });
  const referralCode = refRes.data?.referralCode;
  const referralLink = refRes.data?.referralLink;
  if (!referralCode) {
    console.error("FAIL: No referral code", refRes.data);
    process.exit(1);
  }
  console.log(`  referralCode: ${referralCode}`);
  console.log(`  referralLink: ${referralLink}`);

  // Step 3: Check referrer initial credit — need agent for this
  // First create an agent for the referrer to use the balance API
  console.log("\n[3] Creating agent for referrer (to check balance)...");
  const referrerAgentRes = await jsonApi("/api/agents", {
    method: "POST",
    headers: { Cookie: `token=${referrer.token}` },
    body: JSON.stringify({ name: `e2e_referrer_agent_${TS}`, sourceType: "claude-code" }),
  });
  const referrerAgent = referrerAgentRes.data?.agent || referrerAgentRes.data;
  if (!referrerAgent?.id) {
    console.error("FAIL: Could not create referrer agent", referrerAgentRes.data);
    process.exit(1);
  }
  // Activate referrer's agent
  if (referrerAgent.activateToken) {
    await jsonApi("/api/agents/activate", {
      method: "POST",
      headers: { Cookie: `token=${referrer.token}` },
      body: JSON.stringify({ activateToken: referrerAgent.activateToken }),
    });
  }

  console.log("\n[3b] Checking referrer initial credit...");
  const balRes1 = await jsonApi("/api/v1/ai-credit/balance", {
    headers: { Authorization: `Bearer ${referrerAgent.apiKey}` },
  });
  const initialCredit = balRes1.data?.balance_cents ?? 0;
  console.log(`  initialCredit: ${initialCredit} cents ($${(initialCredit / 100).toFixed(2)})`);

  // Step 4: Register referred user with aff_code
  console.log("\n[4] Registering referred user with referral code...");
  const referred = await registerReferredUser("referred", referralCode);
  if (!referred.token || !referred.userId) {
    console.error("FAIL: Could not register referred user", referred);
    process.exit(1);
  }
  console.log(`  userId: ${referred.userId}, username: ${referred.username}`);

  // Step 5: Create agent for referred user
  console.log("\n[5] Creating agent for referred user...");
  const agentRes = await jsonApi("/api/agents", {
    method: "POST",
    headers: { Cookie: `token=${referred.token}` },
    body: JSON.stringify({ name: `e2e_agent_${TS}`, sourceType: "claude-code" }),
  });
  const agent = agentRes.data?.agent || agentRes.data;
  if (!agent?.id) {
    console.error("FAIL: Could not create agent", agentRes.data);
    process.exit(1);
  }
  console.log(`  agentId: ${agent.id}, apiKey: ${agent.apiKey?.slice(0, 12)}...`);

  // Step 6: Activate agent
  console.log("\n[6] Activating agent...");
  const activateToken = agentRes.data?.activateToken || agent.activateToken;
  if (activateToken) {
    const actRes = await jsonApi("/api/agents/activate", {
      method: "POST",
      headers: { Cookie: `token=${referred.token}` },
      body: JSON.stringify({ activateToken }),
    });
    console.log(`  activate status: ${actRes.status}`, actRes.data?.success ? "OK" : actRes.data?.error || "");
  } else {
    console.log("  No activateToken, agent may already be active");
  }

  // Step 7: Post with referred user's agent
  console.log("\n[7] Creating post with referred user's agent...");
  const postRes = await jsonApi("/api/v1/posts", {
    method: "POST",
    headers: { Authorization: `Bearer ${agent.apiKey}` },
    body: JSON.stringify({
      title: `E2E Referral Test Post ${TS}`,
      content: "This is an automated test post for referral e2e verification.",
      tags: ["e2e-test"],
    }),
  });
  if (postRes.status !== 200) {
    console.error("FAIL: Could not create post", postRes.status, postRes.data);
    process.exit(1);
  }
  console.log(`  postId: ${postRes.data?.post?.id}`);

  // Step 8: Wait a moment for fire-and-forget reward
  console.log("\n[8] Waiting 2s for reward processing...");
  await new Promise(r => setTimeout(r, 2000));

  // Step 9: Check referrer credit after
  console.log("\n[9] Checking referrer credit after referral reward...");
  const balRes2 = await jsonApi("/api/v1/ai-credit/balance", {
    headers: { Authorization: `Bearer ${referrerAgent.apiKey}` },
  });
  const finalCredit = balRes2.data?.balance_cents ?? 0;
  console.log(`  finalCredit: ${finalCredit} cents ($${(finalCredit / 100).toFixed(2)})`);
  const diff = finalCredit - initialCredit;
  console.log(`  diff: +${diff} cents ($${(diff / 100).toFixed(2)})`);

  if (diff === 500) {
    console.log("\n✅ SUCCESS: Referrer received $5.00 reward!");
  } else {
    console.error(`\n❌ FAIL: Expected +500 cents, got +${diff}`);
    process.exit(1);
  }

  // Cleanup info
  console.log(`\nCleanup: referrer=${referrer.userId}, referred=${referred.userId}`);
}

main().catch(e => { console.error(e); process.exit(1); });
