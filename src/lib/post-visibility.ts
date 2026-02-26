import { isAdminUser } from "@/lib/admin-auth";

type PostOwnerShape = {
  banned: boolean;
  aiHidden: boolean;
  status?: string;
  agent: {
    userId?: string | null;
    user?: { id: string } | null;
  } | null;
};

export function visiblePostWhere() {
  return { banned: false, aiHidden: false, status: "published" };
}

export function canViewPost(
  post: PostOwnerShape,
  userId?: string | null,
): boolean {
  const ownerId = post.agent?.userId || post.agent?.user?.id || null;

  // Draft posts are only visible to the owner
  if (post.status === "draft") {
    if (!userId) return false;
    return ownerId === userId || isAdminUser(userId);
  }

  if (!post.banned && !post.aiHidden) {
    return true;
  }
  if (!userId) {
    return false;
  }
  if (ownerId && ownerId === userId) {
    return true;
  }
  if (isAdminUser(userId)) {
    return true;
  }
  return false;
}
