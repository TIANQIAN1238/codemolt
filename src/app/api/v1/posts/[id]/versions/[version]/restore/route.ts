import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";

// Resolve a complete snapshot for a given version by merging sparse records.
function resolveSnapshot(
  versions: { version: number; title: string | null; content: string | null; summary: string | null; tags: string | null }[],
  targetVersion: number
): { title: string; content: string; summary: string | null; tags: string } {
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

// POST /api/v1/posts/[id]/versions/[version]/restore — Restore a historical version
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  const { id, version: versionStr } = await params;
  const versionNum = parseInt(versionStr, 10);

  if (isNaN(versionNum) || versionNum < 1) {
    return NextResponse.json({ error: "Invalid version number" }, { status: 400 });
  }

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
      return NextResponse.json({ error: "You can only restore versions of your own posts" }, { status: 403 });
    }

    if (versionNum === post.currentVersion) {
      return NextResponse.json({ error: "This version is already current" }, { status: 400 });
    }

    if (versionNum > post.currentVersion) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Fetch all versions up to the target to resolve the full snapshot
    const allVersions = await prisma.postVersion.findMany({
      where: { postId: id, version: { lte: versionNum } },
      orderBy: { version: "desc" },
      select: { version: true, title: true, content: true, summary: true, tags: true },
    });

    if (allVersions.length === 0 || allVersions[0].version !== versionNum) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    const snapshot = resolveSnapshot(allVersions, versionNum);

    // Restore: create a NEW version with the resolved content, then update the post
    const updated = await prisma.$transaction(async (tx) => {
      const newVersion = post.currentVersion + 1;

      const updatedPost = await tx.post.update({
        where: { id },
        data: {
          title: snapshot.title,
          content: snapshot.content,
          summary: snapshot.summary,
          tags: snapshot.tags,
          currentVersion: newVersion,
        },
      });

      // Store as full snapshot since it's a restore operation
      await tx.postVersion.create({
        data: {
          postId: id,
          version: newVersion,
          title: snapshot.title,
          content: snapshot.content,
          summary: snapshot.summary,
          tags: snapshot.tags,
          changedFields: JSON.stringify(["title", "content", "summary", "tags"]),
        },
      });

      return updatedPost;
    });

    return NextResponse.json({
      post: {
        id: updated.id,
        title: updated.title,
        content: updated.content,
        summary: updated.summary,
        tags: JSON.parse(updated.tags),
        version: updated.currentVersion,
        updated_at: updated.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Restore version error:", error);
    return NextResponse.json({ error: "Failed to restore version" }, { status: 500 });
  }
}
