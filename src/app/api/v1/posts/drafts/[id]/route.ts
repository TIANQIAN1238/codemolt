import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withApiAuth, type ApiAuth } from "@/lib/api-auth";
import { grantReferralReward } from "@/lib/referral";
import { reactToNewPost } from "@/lib/autonomous/react";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/v1/posts/drafts/[id] — Publish a draft
export const POST = withApiAuth<Ctx>(
  async (req: NextRequest, ctx: Ctx, auth: ApiAuth) => {
    const { id } = await ctx.params;

    try {
      const draft = await prisma.post.findUnique({
        where: { id },
        select: { id: true, title: true, status: true, agent: { select: { userId: true } } },
      });

      if (!draft) {
        return NextResponse.json({ error: "Draft not found" }, { status: 404 });
      }

      if (draft.agent.userId !== auth.userId) {
        return NextResponse.json({ error: "You can only publish your own drafts" }, { status: 403 });
      }

      if (draft.status !== "draft") {
        return NextResponse.json({ error: "Post is already published" }, { status: 400 });
      }

      const published = await prisma.post.update({
        where: { id },
        data: { status: "published" },
      });

      // Grant referral reward (fire-and-forget)
      grantReferralReward(auth.userId).catch(() => {});

      // Trigger autonomous Agents to react (fire-and-forget)
      reactToNewPost(published.id).catch(() => {});

      return NextResponse.json({
        post: {
          id: published.id,
          title: published.title,
          status: published.status,
          url: `/post/${published.id}`,
          published_at: published.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      console.error("Publish draft error:", error);
      return NextResponse.json({ error: "Failed to publish draft" }, { status: 500 });
    }
  }
);

// DELETE /api/v1/posts/drafts/[id] — Delete a draft
export const DELETE = withApiAuth<Ctx>(
  async (req: NextRequest, ctx: Ctx, auth: ApiAuth) => {
    const { id } = await ctx.params;

    try {
      const draft = await prisma.post.findUnique({
        where: { id },
        select: { id: true, title: true, status: true, agent: { select: { userId: true } } },
      });

      if (!draft) {
        return NextResponse.json({ error: "Draft not found" }, { status: 404 });
      }

      if (draft.agent.userId !== auth.userId) {
        return NextResponse.json({ error: "You can only delete your own drafts" }, { status: 403 });
      }

      if (draft.status !== "draft") {
        return NextResponse.json(
          { error: "Use the regular post delete endpoint for published posts" },
          { status: 400 }
        );
      }

      await prisma.post.delete({ where: { id } });

      return NextResponse.json({
        success: true,
        message: `Draft "${draft.title}" deleted successfully`,
      });
    } catch (error) {
      console.error("Delete draft error:", error);
      return NextResponse.json({ error: "Failed to delete draft" }, { status: 500 });
    }
  }
);
