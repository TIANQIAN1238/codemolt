import assert from "node:assert/strict";
import { buildPrompt } from "@/lib/autonomous/loop";
import { chooseDiverseComment, isCommentTooSimilar } from "@/lib/autonomous/react";

async function run(): Promise<void> {
  const repeated = "这个抽象层设计很清晰。Gateway 作为中间层确实降低耦合。你提到的 Session 抽象很关键。";
  const nearDuplicate = "这个抽象层的设计很清晰，Gateway 作为中间层确实降低耦合。你提到 Session 抽象很关键。";
  const distinct = "我更关心 Queue 在峰值时的丢包策略：有无 dead-letter 与重试抖动控制？";

  assert.equal(isCommentTooSimilar(nearDuplicate, [repeated]), true, "near duplicate should be blocked");
  assert.equal(isCommentTooSimilar(distinct, [repeated]), false, "distinct angle should pass");

  const keepOriginal = await chooseDiverseComment({
    initialComment: distinct,
    existingComments: [repeated],
    regenerate: async () => "should-not-be-called",
  });
  assert.equal(keepOriginal.comment, distinct, "non-duplicate comment should be kept");

  const rewriteSuccess = await chooseDiverseComment({
    initialComment: nearDuplicate,
    existingComments: [repeated],
    regenerate: async () => distinct,
  });
  assert.equal(rewriteSuccess.comment, distinct, "duplicate should be rewritten to distinct content");

  const rewriteFail = await chooseDiverseComment({
    initialComment: nearDuplicate,
    existingComments: [repeated],
    regenerate: async () => nearDuplicate,
  });
  assert.equal(rewriteFail.comment, undefined, "still-duplicate retry should be rejected");

  const prompt = buildPrompt({
    agentName: "tester-agent",
    rules: null,
    learningNotes: null,
    approvedRules: [],
    rejectedRules: [],
    persona: null,
    userProfile: { techStack: [], interests: [], currentProjects: null, writingStyle: null },
    teamPeerAgentIds: new Set<string>(),
    teamPeers: [],
    recentComments: [
      { authorName: "Alice", content: repeated },
      { authorName: "Bob", content: distinct },
    ],
    posts: [
      {
        id: "post_1",
        title: "Gateway 抽象实践",
        summary: "讨论 channel/router/queue/session",
        content: "本文介绍 Gateway 作为 Agent 基础设施抽象层。",
        tags: "[\"architecture\",\"gateway\"]",
        language: "zh",
        upvotes: 0,
        downvotes: 0,
        aiReviewCount: 0,
        aiSpamVotes: 0,
        createdAt: new Date(),
        agentId: "agent_x",
        agent: { name: "author-agent", user: { username: "author" } },
      },
    ],
  });

  assert.match(prompt.system, /avoid repeating the same viewpoint/i);
  assert.match(prompt.user, /Existing comments \(avoid repeating these points\):/);
  assert.match(prompt.user, /Alice:/);

  console.log("issue42-comment-diversity-test passed");
}

run();
