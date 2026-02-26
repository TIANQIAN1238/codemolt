/**
 * Server-only avatar processing and OSS upload.
 * DO NOT import this from client components — use `@/lib/avatar-shared` instead.
 *
 * Re-exports client-safe helpers for convenience in server code.
 */

import sharp from "sharp";
import prisma from "@/lib/prisma";
import { isOssConfigured, uploadToOss } from "@/lib/r2";

// Re-export client-safe helpers so server code can import everything from one place
export { isEmojiAvatar, validateAvatar } from "@/lib/avatar-shared";
import { isEmojiAvatar } from "@/lib/avatar-shared";

const HTTP_URL_RE = /^https?:\/\/.+/i;
const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const AVATAR_SIZE = 192;

// ─── Image processing ───

/**
 * Process a raw image buffer: crop to center square, resize to 192x192, output PNG.
 */
export async function processAvatarImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
}

// ─── Upload helpers ───

export async function uploadUserAvatar(
  userId: string,
  buffer: Buffer,
): Promise<string | null> {
  if (!isOssConfigured()) return null;
  const processed = await processAvatarImage(buffer);
  return uploadToOss(`users/${userId}.png`, processed, "image/png");
}

export async function uploadAgentAvatar(
  agentId: string,
  buffer: Buffer,
): Promise<string | null> {
  if (!isOssConfigured()) return null;
  const processed = await processAvatarImage(buffer);
  return uploadToOss(`agents/${agentId}.png`, processed, "image/png");
}

/**
 * Fetch an external avatar URL, process it, and upload to OSS.
 * Returns the public URL or null on failure.
 */
export async function transferExternalAvatar(
  type: "users" | "agents",
  id: string,
  sourceUrl: string,
): Promise<string | null> {
  if (!isOssConfigured()) return null;
  try {
    const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const processed = await processAvatarImage(buffer);
    return uploadToOss(`${type}/${id}.png`, processed, "image/png");
  } catch {
    return null;
  }
}

/**
 * Async fire-and-forget: transfer an external avatar and update DB.
 */
export function transferExternalAvatarAsync(
  type: "users" | "agents",
  id: string,
  sourceUrl: string,
): void {
  transferExternalAvatar(type, id, sourceUrl)
    .then(async (url) => {
      if (!url) return;
      if (type === "users") {
        await prisma.user.update({ where: { id }, data: { avatar: url } });
      } else {
        await prisma.agent.update({ where: { id }, data: { avatar: url } });
      }
    })
    .catch(() => {});
}

/**
 * Decode a base64 data URL into a raw buffer and mime type.
 */
export function decodeBase64Avatar(
  dataUrl: string,
): { buffer: Buffer; mimetype: string } | null {
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/);
  if (!match) return null;
  return {
    mimetype: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

/**
 * Check if a mime type is an allowed avatar image type.
 */
export function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIMES.has(mime);
}

/**
 * Process an agent avatar value:
 * - Emoji → return as-is
 * - Base64 data URL → decode, process, upload to OSS
 * - HTTP URL → keep if it's our OSS URL, otherwise reject
 * - null/empty → return null
 *
 * Returns the final value to store in DB.
 */
export async function processAgentAvatar(
  agentId: string,
  input: string | null | undefined,
): Promise<string | null> {
  if (!input || !input.trim()) return null;

  const trimmed = input.trim();

  // Emoji — save as-is
  if (isEmojiAvatar(trimmed)) return trimmed;

  // Base64 data URL — decode, process, upload
  if (trimmed.startsWith("data:")) {
    const decoded = decodeBase64Avatar(trimmed);
    if (!decoded) return null;
    const url = await uploadAgentAvatar(agentId, decoded.buffer);
    return url;
  }

  // HTTP URL — for existing OSS URLs, keep; otherwise reject
  if (HTTP_URL_RE.test(trimmed)) {
    const ossPublicUrl = process.env.OSS_PUBLIC_URL;
    if (ossPublicUrl && trimmed.startsWith(ossPublicUrl)) return trimmed;
    return null;
  }

  return null;
}
