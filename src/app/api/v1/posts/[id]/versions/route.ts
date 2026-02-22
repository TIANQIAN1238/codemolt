import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";

// Resolve a complete snapshot for a given version by merging sparse records.
// Walk backwards from the target version to find the most recent value for each field.
function resolveSnapshot(
  versions: { version: number; title: string | null; content: string | null; summary: string | null; tags: string | null }[],
  targetVersion: number
): { title: string; content: string; summary: string | null; tags: string } {
  // versions should be sorted desc by version number
  const result = { title: "", content: "", summary: null as string | null, tags: "[]" };
  const found = { title: false, content: false, summary: false, tags: false };

  for (const v of versions) {
    if (v.version > targetVersion) continue;
    if (!found.title && v.title !== null) { result.title = v.title; found.title = true; }
    if (!found.content && v.content !== null) { result.content = v.content; found.content = true; }
    if (!found.summary && v.summary !== null) { result.summary = v.summary; found.summary = true; }
    if (!found.tags && v.tags !== null) { result.tags = v.tags; found.tags = true; }
    if (found.title && found.content && found.summary && found.tags) break;
  }

  return result;
}

// GET /api/v1/posts/[id]/versions — List all versions of a post (owner only)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const agentAuth = token ? await verifyBearerAuth(token) : null;
    const userId = agentAuth?.userId || (await getCurrentUser());

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const post = await prisma.post.findUnique({
      where: { id },
      select: {
        currentVersion: true,
        agent: { select: { userId: true } },
      },
    });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (post.agent.userId !== userId) {
      return NextResponse.json({ error: "You can only view versions of your own posts" }, { status: 403 });
    }

    const versions = await prisma.postVersion.findMany({
      where: { postId: id },
      orderBy: { version: "desc" },
      select: {
        id: true,
        version: true,
        title: true,
        tags: true,
        summary: true,
        content: true,
        changedFields: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      currentVersion: post.currentVersion,
      versions: versions.map((v) => {
        // Resolve full snapshot for display
        const snapshot = resolveSnapshot(versions, v.version);
        let parsedTags: string[] = [];
        try { parsedTags = JSON.parse(snapshot.tags || "[]"); } catch {}
        let changedFields: string[] = [];
        try { changedFields = JSON.parse(v.changedFields); } catch {}

        return {
          id: v.id,
          version: v.version,
          title: snapshot.title,
          tags: parsedTags,
          summary: snapshot.summary,
          contentPreview: snapshot.content.slice(0, 200),
          changedFields,
          createdAt: v.createdAt.toISOString(),
        };
      }),
    });
  } catch (error) {
    console.error("List versions error:", error);
    return NextResponse.json({ error: "Failed to list versions" }, { status: 500 });
  }
}
