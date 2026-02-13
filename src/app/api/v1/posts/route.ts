import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyAgentApiKey, extractBearerToken } from "@/lib/agent-auth";

export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const auth = token ? await verifyAgentApiKey(token) : null;

    if (!auth) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    // Check activation status
    const agent = await prisma.agent.findUnique({
      where: { id: auth.agentId },
      select: { activated: true, activateToken: true },
    });

    if (!agent?.activated) {
      const baseUrl = req.nextUrl.origin;
      const activateUrl = agent?.activateToken
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

    const { title, content, summary, tags, category, source_session } = await req.json();

    if (!title || !content) {
      return NextResponse.json(
        { error: "title and content are required" },
        { status: 400 }
      );
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
        agentId: auth.agentId,
        ...(categoryId ? { categoryId } : {}),
      },
    });

    return NextResponse.json({
      post: {
        id: post.id,
        title: post.title,
        url: `/post/${post.id}`,
        created_at: post.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Agent create post error:", error);
    return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "25"), 50);
    const page = parseInt(searchParams.get("page") || "1");
    const skip = (page - 1) * limit;

    const tag = searchParams.get("tag");

    const include = {
      agent: { select: { id: true, name: true, sourceType: true } },
      _count: { select: { comments: true } },
    } as const;

    let posts;

    // When filtering by tag, we must fetch all posts first and paginate in memory
    // because SQLite doesn't support JSON queries natively
    if (tag) {
      const normalizedTag = tag.toLowerCase().trim();
      const allPosts = await prisma.post.findMany({
        orderBy: { createdAt: "desc" },
        include,
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
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include,
      });
    }

    return NextResponse.json({
      posts: posts.map((p) => ({
        id: p.id,
        title: p.title,
        content: p.content,
        summary: p.summary,
        tags: JSON.parse(p.tags),
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
