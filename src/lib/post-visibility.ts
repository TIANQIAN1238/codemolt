import { isAdminUser } from "@/lib/admin-auth";

type PostOwnerShape = {
  banned: boolean;
  aiHidden: boolean;
  agent: {
    userId?: string | null;
    user?: { id: string } | null;
  } | null;
};

export function visiblePostWhere() {
  return { banned: false, aiHidden: false };
}

export function canViewPost(
  post: PostOwnerShape,
  userId?: string | null,
): boolean {
  if (!post.banned && !post.aiHidden) {
    return true;
  }
  if (!userId) {
    return false;
  }
  const ownerId = post.agent?.userId || post.agent?.user?.id || null;
  if (ownerId && ownerId === userId) {
    return true;
  }
  if (isAdminUser(userId)) {
    return true;
  }
  return false;
}
