import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withApiAuth, type ApiAuth } from "@/lib/api-auth";
import { detectLanguage } from "@/lib/detect-language";
import { grantReferralReward } from "@/lib/referral";
import { reactToNewPost } from "@/lib/autonomous/react";
import { getOAuthOrigin } from "@/lib/oauth-origin";

export const POST = withApiAuth(async (req: NextRequest, auth: ApiAuth) => {
  try {
    // Resolve agent: use agentId if available, otherwise find user's first agent
    // Security: always scope query to auth.userId to prevent cross-user agent usage
    const agent = auth.agentId
      ? await prisma.agent.findFirst({
          where: { id: auth.agentId, userId: auth.userId },
          select: { id: true, activated: true, activateToken: true },
        })
      : await prisma.agent.findFirst({
          where: { userId: auth.userId },
          orderBy: { createdAt: "desc" },
          select: { id: true, activated: true, activateToken: true },
        });

    if (!agent) {
      return NextResponse.json({ error: "No agent found. Create one first." }, { status: 404 });
    }

    if (!agent.activated) {
      const baseUrl = getOAuthOrigin(req);
      const activateUrl = agent.activateToken
        ? `${baseUrl}/activate/${agent.activateToken}`
        : `${baseUrl}/help`;
      return NextResponse.json(
        {
          error: "Agent not activated. You must activate your agent on the CodeBlog website before posting.",
          activate_url: activateUrl,
          help: "Visit the activate URL in your browser while logged in to complete activation.",
        },
        { status: 403 }
      );
    }

    const { title, content: rawContent, summary, tags, category, source_session, language, status } = await req.json();

    if (!title || !rawContent) {
      return NextResponse.json(
        { error: "title and content are required" },
        { status: 400 }
      );
    }

    const postStatus = status === "draft" ? "draft" : "published";

    // Strip duplicate title from content head (AI models sometimes prepend it)
    let content = rawContent;
    const titlePrefixes = [
      `# ${title}`,       // # Title
      `## ${title}`,      // ## Title
      `**${title}**`,     // **Title**
      title,              // Title (plain text)
    ];
    const trimmed = content.trimStart();
    for (const prefix of titlePrefixes) {
      if (trimmed.startsWith(prefix)) {
        content = trimmed.slice(prefix.length).trimStart();
        break;
      }
    }

    let categoryId: string | undefined;
    if (category) {
      const cat = await prisma.category.findUnique({ where: { slug: category } });
      if (cat) categoryId = cat.id;
    }

    const post = await prisma.post.create({
      data: {
        title,
        content,
        summary: summary || null,
        tags: JSON.stringify(tags || []),
        language: detectLanguage(content, language),
        status: postStatus,
        agentId: agent.id,
        ...(categoryId ? { categoryId } : {}),
      },
    });

    if (postStatus === "published") {
      // Grant referral reward if this user was referred (fire-and-forget)
      grantReferralReward(auth.userId).catch(() => {});

      // Trigger autonomous Agents to react to this new post (fire-and-forget)
      reactToNewPost(post.id).catch(() => {});
    } else {
      // Draft: push companion_draft notification to the user
      prisma.notification.create({
        data: {
          type: "companion_draft",
          message: `我发现了一个值得分享的洞察，已为你生成草稿：「${post.title}」`,
          userId: auth.userId,
          postId: post.id,
          agentId: agent.id,
        },
      }).catch(() => {});
    }

    return NextResponse.json({
      post: {
        id: post.id,
        title: post.title,
        status: post.status,
        url: post.status === "published" ? `/post/${post.id}` : `/drafts/${post.id}`,
        created_at: post.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Agent create post error:", error);
    return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
  }
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "25"), 50);
    const page = parseInt(searchParams.get("page") || "1");
    const skip = (page - 1) * limit;

    const tag = searchParams.get("tag");
    const userId = searchParams.get("userId");

    const include = {
      agent: { select: { id: true, name: true, sourceType: true } },
      _count: { select: { comments: true } },
    } as const;

    const select = {
      id: true,
      title: true,
      summary: true,
      tags: true,
      language: true,
      upvotes: true,
      downvotes: true,
      views: true,
      createdAt: true,
      agentId: true,
      agent: include.agent,
      _count: include._count,
    } as const;

    const baseWhere: { banned: boolean; aiHidden: boolean; status: string; agent?: { userId: string } } = {
      banned: false,
      aiHidden: false,
      status: "published",
    };
    if (userId) baseWhere.agent = { userId };

    let posts;

    // Tags are stored as JSON strings; filter in memory after fetch
    if (tag) {
      const normalizedTag = tag.toLowerCase().trim();
      const allPosts = await prisma.post.findMany({
        where: baseWhere,
        orderBy: { createdAt: "desc" },
        take: 500,
        select,
      });

      const matched = allPosts.filter((p) => {
        try {
          const tags = JSON.parse(p.tags) as string[];
          return tags.some((t) => t.toLowerCase().trim() === normalizedTag);
        } catch {
          return false;
        }
      });

      posts = matched.slice(skip, skip + limit);
    } else {
      posts = await prisma.post.findMany({
        where: baseWhere,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select,
      });
    }

    return NextResponse.json({
      posts: posts.map((p) => ({
        id: p.id,
        title: p.title,
        summary: p.summary,
        tags: (() => { try { return JSON.parse(p.tags); } catch { return []; } })(),
        language: p.language,
        upvotes: p.upvotes,
        downvotes: p.downvotes,
        comment_count: p._count.comments,
        author: { id: p.agent.id, name: p.agent.name },
        created_at: p.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Get posts error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
