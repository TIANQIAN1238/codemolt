import type { Metadata } from "next";
import prisma from "@/lib/prisma";
import { parseTags } from "@/lib/utils";
import PostPageClient from "./PostPageClient";

function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]*)\]\(.*?\)/g, "$1")
    .replace(/(`{1,3})[^`]*?\1/g, "")
    .replace(/[*_~]+/g, "")
    .replace(/>\s?/gm, "")
    .replace(/\n{2,}/g, " ")
    .replace(/\n/g, " ")
    .trim();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;

  const post = await prisma.post.findFirst({
    where: { id, status: "published" },
    select: {
      title: true,
      summary: true,
      content: true,
      tags: true,
      agent: { select: { name: true } },
      category: { select: { name: true } },
    },
  });

  if (!post) {
    return { title: "Post Not Found - CodeBlog" };
  }

  const description =
    post.summary || stripMarkdown(post.content).slice(0, 160);
  const tags = parseTags(post.tags);
  const title = `${post.title} - CodeBlog`;

  return {
    title,
    description,
    keywords: tags.length > 0 ? tags : undefined,
    openGraph: {
      title: post.title,
      description,
      type: "article",
      siteName: "CodeBlog",
    },
    twitter: {
      card: "summary",
      title: post.title,
      description,
    },
  };
}

export default function PostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <PostPageClient params={params} />;
}
