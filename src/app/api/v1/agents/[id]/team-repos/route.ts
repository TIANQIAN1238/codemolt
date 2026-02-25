import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";
import { addManualRepoAndDiscover, getAgentTeamPeers } from "@/lib/github-team";

async function getAuthUserId(req: NextRequest): Promise<string | null> {
  const token = extractBearerToken(req.headers.get("authorization"));
  const agentAuth = token ? await verifyBearerAuth(token) : null;
  return agentAuth?.userId || (await getCurrentUser());
}

// GET /api/v1/agents/[id]/team-repos
// Returns the agent's team peers and manually added repos
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params;
  const userId = await getAuthUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const agent = await prisma.agent.findFirst({
    where: { id: agentId, userId },
    select: { id: true, teamManualRepos: true, teamLastSyncedAt: true },
  });
  if (!agent) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const peers = await getAgentTeamPeers(agentId);

  return NextResponse.json({
    agent_id: agentId,
    manual_repos: agent.teamManualRepos,
    last_synced_at: agent.teamLastSyncedAt,
    team_peers: peers.map((p) => ({
      agent_id: p.peerAgentId,
      agent_name: p.peerAgentName,
      username: p.peerUsername,
      avatar: p.peerAvatar,
      shared_repos: p.sharedRepos,
      strength: p.strength,
      source: p.source,
    })),
  });
}

// POST /api/v1/agents/[id]/team-repos
// Body: { repo_url: "https://github.com/owner/repo" }
// Manually add a repo and discover team relations from its contributors
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params;
  const userId = await getAuthUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const agent = await prisma.agent.findFirst({
    where: { id: agentId, userId },
    select: { id: true },
  });
  if (!agent) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const repoUrl = typeof body.repo_url === "string" ? body.repo_url.trim() : "";
  if (!repoUrl) {
    return NextResponse.json({ error: "repo_url_required" }, { status: 400 });
  }

  const result = await addManualRepoAndDiscover({ agentId, userId, repoFullName: repoUrl });

  if (!result.added) {
    return NextResponse.json({ error: "invalid_or_inaccessible_repo" }, { status: 422 });
  }

  return NextResponse.json({
    added: true,
    new_relations: result.newRelations,
  });
}

// DELETE /api/v1/agents/[id]/team-repos
// Body: { repo_full_name: "owner/repo" }
// Remove a manually added repo
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params;
  const userId = await getAuthUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const agent = await prisma.agent.findFirst({
    where: { id: agentId, userId },
    select: { id: true, teamManualRepos: true },
  });
  if (!agent) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const repoName = typeof body.repo_full_name === "string" ? body.repo_full_name.trim() : "";
  if (!repoName) {
    return NextResponse.json({ error: "repo_full_name_required" }, { status: 400 });
  }

  const updatedRepos = agent.teamManualRepos.filter((r) => r !== repoName);
  await prisma.agent.update({
    where: { id: agentId },
    data: { teamManualRepos: updatedRepos },
  });

  return NextResponse.json({ removed: true });
}
