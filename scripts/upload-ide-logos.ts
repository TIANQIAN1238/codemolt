/**
 * One-time script: Download IDE avatar images from @lobehub/icons-static-avatar,
 * then upload to our OSS under ide-logos/<sourceType>.webp.
 *
 * Usage:
 *   npx tsx scripts/upload-ide-logos.ts
 */

import "dotenv/config";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

// ─── sourceType → lobe-icons slug mapping ────────────────────────────
interface IdeLogo {
  sourceType: string;
  lobeSlug: string | null;
}

const LOGOS: IdeLogo[] = [
  { sourceType: "claude-code",    lobeSlug: "claude" },
  { sourceType: "cursor",         lobeSlug: "cursor" },
  { sourceType: "windsurf",       lobeSlug: "windsurf" },
  { sourceType: "codex",          lobeSlug: "openai" },
  { sourceType: "vscode-copilot", lobeSlug: "githubcopilot" },
  { sourceType: "openclaw",       lobeSlug: "openclaw" },
  { sourceType: "manus",          lobeSlug: "manus" },
  { sourceType: "multi",          lobeSlug: null }, // custom generated
];

const LOBE_CDN = "https://registry.npmmirror.com/@lobehub/icons-static-avatar/latest/files/avatars";
const SIZE = 512;

// ─── Helpers ─────────────────────────────────────────────────────────

async function downloadFromLobe(slug: string): Promise<Buffer> {
  const url = `${LOBE_CDN}/${slug}.webp`;
  console.log(`  Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** "multi" avatar: 4 dots in a 2×2 grid on indigo background */
function generateMultiAvatar(): Promise<Buffer> {
  const s = SIZE;
  const r = s * 0.09;  // dot radius
  const gap = s * 0.16; // distance from center to dot center
  const cx = s / 2;
  const cy = s / 2;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" fill="#6366F1"/>
  <circle cx="${cx - gap}" cy="${cy - gap}" r="${r}" fill="#fff"/>
  <circle cx="${cx + gap}" cy="${cy - gap}" r="${r}" fill="#fff"/>
  <circle cx="${cx - gap}" cy="${cy + gap}" r="${r}" fill="#fff"/>
  <circle cx="${cx + gap}" cy="${cy + gap}" r="${r}" fill="#A5B4FC"/>
</svg>`;
  return sharp(Buffer.from(svg)).resize(s, s).webp({ quality: 90 }).toBuffer();
}

function getS3Client() {
  const endpoint = process.env.OSS_ENDPOINT;
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OSS_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing OSS env vars (OSS_ENDPOINT, OSS_ACCESS_KEY_ID, OSS_SECRET_ACCESS_KEY)");
  }
  return new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function uploadToOss(client: S3Client, key: string, body: Buffer, contentType: string): Promise<string> {
  const bucket = process.env.OSS_BUCKET_NAME;
  const publicUrl = process.env.OSS_PUBLIC_URL;
  if (!bucket || !publicUrl) throw new Error("Missing OSS_BUCKET_NAME or OSS_PUBLIC_URL");

  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );

  return `${publicUrl.replace(/\/$/, "")}/${bucket}/${key}`;
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const client = getS3Client();
  const results: Record<string, string> = {};

  for (const logo of LOGOS) {
    console.log(`Processing ${logo.sourceType}...`);

    let webpBuf: Buffer;

    if (logo.lobeSlug) {
      webpBuf = await downloadFromLobe(logo.lobeSlug);
    } else {
      // multi
      webpBuf = await generateMultiAvatar();
    }

    const key = `ide-logos/${logo.sourceType}.webp`;
    const url = await uploadToOss(client, key, webpBuf, "image/webp");
    results[logo.sourceType] = url;
    console.log(`  ✓ ${url}`);
  }

  console.log("\nDone! URLs:");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
