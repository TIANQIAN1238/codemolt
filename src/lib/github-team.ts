/**
 * GitHub Team Discovery
 *
 * Identifies team relationships between CodeBlog agents by comparing
 * GitHub repository contributors. No user OAuth token needed — only public
 * repo data is used. A server-level GITHUB_API_TOKEN (optional) raises the
 * rate limit from 60 → 5000 req/hr.
 */

import prisma from "@/lib/prisma";

const GITHUB_API_TOKEN = process.env.GITHUB_API_TOKEN; // optional server PAT
const MAX_REPOS_PER_USER = 100; // per-page max GitHub allows
const MAX_REPOS_TO_SCAN = 50; // hard cap to limit API calls
const SYNC_COOLDOWN_HOURS = 24; // re-scan at most once per day

type GitHubRepo = {
  full_name: string; // e.g. "owner/repo"
  private: boolean;
};

type GitHubContributor = {
  login: string;
};

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (GITHUB_API_TOKEN) {
    headers["Authorization"] = `Bearer ${GITHUB_API_TOKEN}`;
  }
  return headers;
}

async function fetchUserPublicRepos(username: string): Promise<string[]> {
  const repoNames: string[] = [];
  let page = 1;
  const perPage = Math.min(MAX_REPOS_PER_USER, 100);

  while (repoNames.length < MAX_REPOS_TO_SCAN) {
    const url = `https://api.github.com/users/${encodeURIComponent(username)}/repos?type=public&sort=pushed&per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers: githubHeaders() });
    if (!res.ok) break;
    const repos: GitHubRepo[] = await res.json();
    if (!Array.isArray(repos) || repos.length === 0) break;
    for (const repo of repos) {
      if (!repo.private) {
        repoNames.push(repo.full_name);
      }
      if (repoNames.length >= MAX_REPOS_TO_SCAN) break;
    }
    if (repos.length < perPage) break;
    page++;
  }

  return repoNames;
}

async function fetchRepoContributors(repoFullName: string): Promise<string[]> {
  const url = `https://api.github.com/repos/${repoFullName}/contributors?per_page=100&anon=0`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) return [];
  const data: GitHubContributor[] = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((c) => c.login.toLowerCase());
}

/**
 * Scan GitHub repos for a given user and discover team relations with other
 * CodeBlog agents whose owners also have githubUsername set.
 *
 * This is safe to call after any GitHub OAuth login or signup.
 * Skips scan if already done within SYNC_COOLDOWN_HOURS, unless forced.
 */
export async function discoverGitHubTeamRelations(args: {
  userId: string;
  githubUsername: string;
  force?: boolean;
}): Promise<{ newRelations: number; updatedRelations: number }> {
  const { userId, githubUsername } = args;

  // Find the agent(s) owned by this user
  const agents = await prisma.agent.findMany({
    where: { userId },
    select: { id: true, teamLastSyncedAt: true, teamManualRepos: true },
  });
  if (agents.length === 0) return { newRelations: 0, updatedRelations: 0 };

  // Cooldown check — skip if any agent was scanned recently (user-level cooldown)
  const cooldownCutoff = new Date(Date.now() - SYNC_COOLDOWN_HOURS * 60 * 60 * 1000);
  if (!args.force) {
    const anyRecent = agents.some(
      (a) => a.teamLastSyncedAt && a.teamLastSyncedAt > cooldownCutoff,
    );
    if (anyRecent) return { newRelations: 0, updatedRelations: 0 };
  }

  // Fetch this user's public repos
  const myRepos = await fetchUserPublicRepos(githubUsername);
  if (myRepos.length === 0) {
    // Mark synced even if no repos (user might have only private repos)
    await prisma.agent.updateMany({
      where: { userId },
      data: { teamLastSyncedAt: new Date() },
    });
    return { newRelations: 0, updatedRelations: 0 };
  }

  const myRepoSet = new Set(myRepos.map((r) => r.toLowerCase()));

  // Find all other CodeBlog users with a githubUsername
  const otherUsers = await prisma.user.findMany({
    where: {
      id: { not: userId },
      githubUsername: { not: null },
    },
    select: {
      id: true,
      githubUsername: true,
      agents: { select: { id: true } },
    },
  });

  if (otherUsers.length === 0) {
    await prisma.agent.updateMany({ where: { userId }, data: { teamLastSyncedAt: new Date() } });
    return { newRelations: 0, updatedRelations: 0 };
  }

  // For each other user, check if they share repos with us via contributor lists
  let newRelations = 0;
  let updatedRelations = 0;

  for (const otherUser of otherUsers) {
    if (!otherUser.githubUsername || otherUser.agents.length === 0) continue;

    const otherRepos = await fetchUserPublicRepos(otherUser.githubUsername);
    const sharedRepoNames = otherRepos.filter((r) => myRepoSet.has(r.toLowerCase()));

    if (sharedRepoNames.length === 0) continue;

    // Verify actual contribution on shared repos (check first repo to keep calls low)
    const verifiedShared: string[] = [];
    for (const repoFullName of sharedRepoNames.slice(0, 5)) {
      const contributors = await fetchRepoContributors(repoFullName);
      const meContributed = contributors.includes(githubUsername.toLowerCase());
      const peerContributed = contributors.includes(otherUser.githubUsername.toLowerCase());
      if (meContributed && peerContributed) {
        verifiedShared.push(repoFullName);
      }
    }

    if (verifiedShared.length === 0) continue;

    const strength = verifiedShared.length;

    // Create bidirectional relations for all agent pairs
    for (const myAgent of agents) {
      for (const peerAgent of otherUser.agents) {
        const existing = await prisma.agentTeamRelation.findUnique({
          where: { agentId_peerAgentId: { agentId: myAgent.id, peerAgentId: peerAgent.id } },
        });

        if (existing) {
          await prisma.agentTeamRelation.update({
            where: { agentId_peerAgentId: { agentId: myAgent.id, peerAgentId: peerAgent.id } },
            data: { sharedRepos: verifiedShared, strength, verifiedAt: new Date() },
          });
          // Update reverse direction too
          await prisma.agentTeamRelation.updateMany({
            where: { agentId: peerAgent.id, peerAgentId: myAgent.id },
            data: { sharedRepos: verifiedShared, strength, verifiedAt: new Date() },
          });
          updatedRelations++;
        } else {
          await prisma.agentTeamRelation.create({
            data: {
              agentId: myAgent.id,
              peerAgentId: peerAgent.id,
              sharedRepos: verifiedShared,
              strength,
              source: "github",
            },
          });
          // Create reverse direction
          await prisma.agentTeamRelation.upsert({
            where: { agentId_peerAgentId: { agentId: peerAgent.id, peerAgentId: myAgent.id } },
            create: {
              agentId: peerAgent.id,
              peerAgentId: myAgent.id,
              sharedRepos: verifiedShared,
              strength,
              source: "github",
            },
            update: { sharedRepos: verifiedShared, strength, verifiedAt: new Date() },
          });
          newRelations++;
        }
      }
    }
  }

  // Mark scan time
  await prisma.agent.updateMany({ where: { userId }, data: { teamLastSyncedAt: new Date() } });

  return { newRelations, updatedRelations };
}

/**
 * Add a single repo manually for an agent and discover team relations from it.
 * Used when a user explicitly links a repo URL in the UI.
 */
export async function addManualRepoAndDiscover(args: {
  agentId: string;
  userId: string;
  repoFullName: string; // e.g. "owner/repo"
}): Promise<{ added: boolean; newRelations: number }> {
  const { agentId, userId, repoFullName } = args;

  const normalizedRepo = repoFullName.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(normalizedRepo)) {
    return { added: false, newRelations: 0 };
  }

  // Check repo is accessible
  const res = await fetch(`https://api.github.com/repos/${normalizedRepo}`, {
    headers: githubHeaders(),
  });
  if (!res.ok) return { added: false, newRelations: 0 };

  const agent = await prisma.agent.findUnique({
    where: { id: agentId, userId },
    select: { id: true, teamManualRepos: true },
  });
  if (!agent) return { added: false, newRelations: 0 };

  // Add to manual repos if not already there
  if (!agent.teamManualRepos.includes(normalizedRepo)) {
    await prisma.agent.update({
      where: { id: agentId },
      data: { teamManualRepos: { push: normalizedRepo } },
    });
  }

  // Get contributors for this specific repo
  const contributors = await fetchRepoContributors(normalizedRepo);

  // Find CodeBlog users whose githubUsername appears in contributors
  // contributors are already lowercased from fetchRepoContributors
  const contributorSet = new Set(contributors);
  const matchedUsers = await prisma.user.findMany({
    where: {
      id: { not: userId },
      githubUsername: { not: null },
    },
    select: {
      id: true,
      githubUsername: true,
      agents: { select: { id: true } },
    },
  });
  const filteredUsers = matchedUsers.filter(
    (u) => u.githubUsername && contributorSet.has(u.githubUsername.toLowerCase()),
  );

  let newRelations = 0;
  for (const peerUser of filteredUsers) {
    for (const peerAgent of peerUser.agents) {
      // Upsert forward direction, deduplicating sharedRepos
      const existing = await prisma.agentTeamRelation.findUnique({
        where: { agentId_peerAgentId: { agentId, peerAgentId: peerAgent.id } },
        select: { sharedRepos: true },
      });
      const existingRepos = existing?.sharedRepos ?? [];
      const mergedRepos = [...new Set([...existingRepos, normalizedRepo])];
      const strength = mergedRepos.length;

      await prisma.agentTeamRelation.upsert({
        where: { agentId_peerAgentId: { agentId, peerAgentId: peerAgent.id } },
        create: {
          agentId,
          peerAgentId: peerAgent.id,
          sharedRepos: mergedRepos,
          strength,
          source: "manual",
        },
        update: {
          sharedRepos: mergedRepos,
          strength,
          verifiedAt: new Date(),
        },
      });

      // Upsert reverse direction
      const existingReverse = await prisma.agentTeamRelation.findUnique({
        where: { agentId_peerAgentId: { agentId: peerAgent.id, peerAgentId: agentId } },
        select: { sharedRepos: true },
      });
      const existingReverseRepos = existingReverse?.sharedRepos ?? [];
      const mergedReverseRepos = [...new Set([...existingReverseRepos, normalizedRepo])];
      const reverseStrength = mergedReverseRepos.length;

      await prisma.agentTeamRelation.upsert({
        where: { agentId_peerAgentId: { agentId: peerAgent.id, peerAgentId: agentId } },
        create: {
          agentId: peerAgent.id,
          peerAgentId: agentId,
          sharedRepos: mergedReverseRepos,
          strength: reverseStrength,
          source: "manual",
        },
        update: {
          sharedRepos: mergedReverseRepos,
          strength: reverseStrength,
          verifiedAt: new Date(),
        },
      });
      newRelations++;
    }
  }

  return { added: true, newRelations };
}

/**
 * Get all team peers for an agent, with their names and shared repos.
 */
export async function getAgentTeamPeers(agentId: string): Promise<
  Array<{
    peerAgentId: string;
    peerAgentName: string;
    peerUsername: string;
    peerAvatar: string | null;
    sharedRepos: string[];
    strength: number;
    source: string;
  }>
> {
  const relations = await prisma.agentTeamRelation.findMany({
    where: { agentId },
    include: {
      peerAgent: {
        select: {
          id: true,
          name: true,
          user: { select: { username: true, avatar: true } },
        },
      },
    },
    orderBy: { strength: "desc" },
  });

  return relations.map((r) => ({
    peerAgentId: r.peerAgentId,
    peerAgentName: r.peerAgent.name,
    peerUsername: r.peerAgent.user.username,
    peerAvatar: r.peerAgent.user.avatar,
    sharedRepos: r.sharedRepos,
    strength: r.strength,
    source: r.source,
  }));
}
