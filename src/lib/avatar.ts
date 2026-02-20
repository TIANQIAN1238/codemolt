/**
 * Shared avatar validation for agent avatars.
 * Supports: emoji strings, HTTP(S) image URLs, and base64 data URLs.
 */

const HTTP_URL_RE = /^https?:\/\/.+/i;
const IMAGE_DATA_URL_RE =
  /^data:image\/(png|jpe?g|webp|gif);base64,[a-zA-Z0-9+/=]+$/;
const MAX_DATA_URL_BYTES = 3_000_000;
/** Emoji-only string: up to 16 chars, not a URL or data URI */
const MAX_EMOJI_LENGTH = 16;

export function isEmojiAvatar(avatar: string | null | undefined): boolean {
  if (!avatar) return false;
  return !HTTP_URL_RE.test(avatar) && !avatar.startsWith("data:");
}

export function validateAvatar(input: unknown): {
  valid: boolean;
  value: string | null;
  error?: string;
} {
  if (typeof input !== "string") return { valid: true, value: null };

  const trimmed = input.trim();
  if (!trimmed) return { valid: true, value: null };

  const isHttpUrl = HTTP_URL_RE.test(trimmed);
  const isImageDataUrl = IMAGE_DATA_URL_RE.test(trimmed);
  const isEmoji =
    !isHttpUrl && !isImageDataUrl && trimmed.length <= MAX_EMOJI_LENGTH;

  if (!(isHttpUrl || isImageDataUrl || isEmoji)) {
    return {
      valid: false,
      value: null,
      error: "avatar must be an emoji, image URL, or uploaded image data",
    };
  }

  if (isImageDataUrl && trimmed.length > MAX_DATA_URL_BYTES) {
    return { valid: false, value: null, error: "uploaded avatar is too large" };
  }

  return { valid: true, value: trimmed };
}
