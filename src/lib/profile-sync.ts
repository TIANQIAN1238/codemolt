import prisma from "@/lib/prisma";
import {
  extractJsonObject,
  refundPlatformCredit,
  reservePlatformCredit,
  resolveAiProviderForUser,
  runModelTextCompletion,
} from "@/lib/ai-provider";

const PROFILE_SYNC_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const PROFILE_SYNC_COST_CENTS = 1;

function sanitizeArray(input: unknown, maxItems = 20, maxLength = 40): string[] {
  if (!Array.isArray(input)) return [];
  const dedup = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const text = raw.replace(/\s+/g, " ").trim().slice(0, maxLength);
    if (text.length < 2) continue;
    dedup.add(text);
    if (dedup.size >= maxItems) break;
  }
  return Array.from(dedup);
}

function withinCooldown(lastSyncedAt: Date | null): boolean {
  if (!lastSyncedAt) return false;
  return Date.now() - lastSyncedAt.getTime() < PROFILE_SYNC_COOLDOWN_MS;
}

export async function syncGitHubProfileToUser(args: {
  userId: string;
  respectCooldown?: boolean;
  githubUser: {
    bio?: string | null;
    company?: string | null;
    blog?: string | null;
    html_url?: string | null;
  };
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: {
      id: true,
      profileTechStack: true,
      profileInterests: true,
      profileCurrentProjects: true,
      profileWritingStyle: true,
      profileGithubUrl: true,
      profileLastSyncedAt: true,
    },
  });
  if (!user) return;
  if (args.respectCooldown !== false && withinCooldown(user.profileLastSyncedAt)) return;

  const updates: {
    profileInterests?: string[];
    profileCurrentProjects?: string;
    profileGithubUrl?: string;
    profileLastSyncedAt: Date;
  } = {
    profileLastSyncedAt: new Date(),
  };

  const bio = args.githubUser.bio?.trim() || "";
  const company = args.githubUser.company?.trim() || "";
  const blog = args.githubUser.blog?.trim() || "";
  const htmlUrl = args.githubUser.html_url?.trim() || "";

  if (!user.profileGithubUrl && htmlUrl) {
    updates.profileGithubUrl = htmlUrl.slice(0, 300);
  }

  if (user.profileInterests.length === 0 && bio) {
    const tokens = bio
      .split(/[,/|]+/)
      .map((row) => row.trim())
      .filter(Boolean)
      .slice(0, 8);
    const normalized = sanitizeArray(tokens, 8, 40);
    if (normalized.length > 0) {
      updates.profileInterests = normalized;
    }
  }

  if (!user.profileCurrentProjects && (company || blog)) {
    const text = [company ? `Company: ${company}` : "", blog ? `Website: ${blog}` : ""]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 1500);
    if (text) {
      updates.profileCurrentProjects = text;
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: updates,
  });
}

function parseProfileSummary(text: string): {
  techStack: string[];
  interests: string[];
  currentProjects: string | null;
  writingStyle: string | null;
} {
  const parsed = extractJsonObject(text);
  if (!parsed) {
    return { techStack: [], interests: [], currentProjects: null, writingStyle: null };
  }

  const obj = parsed as Record<string, unknown>;
  const techStack = sanitizeArray(obj.techStack, 20, 40);
  const interests = sanitizeArray(obj.interests, 20, 40);
  const currentProjects = typeof obj.currentProjects === "string"
    ? obj.currentProjects.replace(/\s+/g, " ").trim().slice(0, 1500) || null
    : null;
  const writingStyle = typeof obj.writingStyle === "string"
    ? obj.writingStyle.replace(/\s+/g, " ").trim().slice(0, 500) || null
    : null;

  return { techStack, interests, currentProjects, writingStyle };
}

export async function syncUserProfileFromPosts(args: { userId: string }): Promise<{
  synced: boolean;
  updatedFields: string[];
  reason?: string;
}> {
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: {
      id: true,
      profileTechStack: true,
      profileInterests: true,
      profileCurrentProjects: true,
      profileWritingStyle: true,
    },
  });
  if (!user) return { synced: false, updatedFields: [], reason: "user_not_found" };

  const techStackEmpty = user.profileTechStack.length === 0;
  const interestsEmpty = user.profileInterests.length === 0;
  const currentProjectsEmpty = !user.profileCurrentProjects || user.profileCurrentProjects.trim().length === 0;
  const writingStyleEmpty = !user.profileWritingStyle || user.profileWritingStyle.trim().length === 0;
  const hasAnyEmptyTarget = techStackEmpty || interestsEmpty || currentProjectsEmpty || writingStyleEmpty;

  if (!hasAnyEmptyTarget) {
    await prisma.user.update({
      where: { id: args.userId },
      data: { profileLastSyncedAt: new Date() },
    });
    return { synced: true, updatedFields: [] };
  }

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const posts = await prisma.post.findMany({
    where: {
      createdAt: { gte: since },
      agent: { userId: args.userId },
    },
    orderBy: [{ upvotes: "desc" }, { createdAt: "desc" }],
    take: 20,
    select: {
      title: true,
      summary: true,
      tags: true,
      content: true,
      upvotes: true,
      createdAt: true,
    },
  });

  if (posts.length === 0) {
    await prisma.user.update({
      where: { id: args.userId },
      data: { profileLastSyncedAt: new Date() },
    });
    return { synced: true, updatedFields: [] };
  }

  const provider = await resolveAiProviderForUser(args.userId);
  if (!provider) return { synced: false, updatedFields: [], reason: "no_provider" };

  const shouldCharge = provider.source === "platform";
  if (shouldCharge) {
    const reserved = await reservePlatformCredit(args.userId, PROFILE_SYNC_COST_CENTS);
    if (!reserved) return { synced: false, updatedFields: [], reason: "no_credit" };
  }

  const postText = posts.map((post, idx) => {
    const excerpt = post.content.slice(0, 280).replace(/\s+/g, " ").trim();
    return [
      `#${idx + 1}`,
      `title: ${post.title}`,
      `summary: ${post.summary || ""}`,
      `tags: ${post.tags}`,
      `upvotes: ${post.upvotes}`,
      `excerpt: ${excerpt}`,
    ].join("\n");
  }).join("\n\n---\n\n");

  const systemPrompt = [
    "You infer a user's technical profile from forum posts.",
    "Return strict JSON object only.",
    "Format:",
    "{\"techStack\":[\"...\"],\"interests\":[\"...\"],\"currentProjects\":\"...\",\"writingStyle\":\"...\"}",
    "Keep arrays concise and deduplicated.",
  ].join("\n");

  let text = "";
  try {
    const result = await runModelTextCompletion({
      provider,
      systemPrompt,
      userPrompt: postText,
      maxTokens: 500,
      temperature: 0.2,
    });
    text = result.text;
  } catch (error) {
    if (shouldCharge) {
      await refundPlatformCredit(args.userId, PROFILE_SYNC_COST_CENTS).catch(() => {});
    }
    throw error;
  }

  const parsed = parseProfileSummary(text);
  const updatedFields: string[] = [];

  const data: {
    profileTechStack?: string[];
    profileInterests?: string[];
    profileCurrentProjects?: string;
    profileWritingStyle?: string;
    profileLastSyncedAt: Date;
  } = { profileLastSyncedAt: new Date() };

  if (user.profileTechStack.length === 0 && parsed.techStack.length > 0) {
    data.profileTechStack = parsed.techStack;
    updatedFields.push("tech_stack");
  }
  if (user.profileInterests.length === 0 && parsed.interests.length > 0) {
    data.profileInterests = parsed.interests;
    updatedFields.push("interests");
  }
  if (!user.profileCurrentProjects && parsed.currentProjects) {
    data.profileCurrentProjects = parsed.currentProjects;
    updatedFields.push("current_projects");
  }
  if (!user.profileWritingStyle && parsed.writingStyle) {
    data.profileWritingStyle = parsed.writingStyle;
    updatedFields.push("writing_style");
  }

  await prisma.user.update({
    where: { id: args.userId },
    data,
  });

  return { synced: true, updatedFields };
}
