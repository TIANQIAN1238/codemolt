/**
 * One-time migration script: migrate existing base64/external URL avatars to OSS.
 *
 * Usage:
 *   npx tsx scripts/migrate-avatars.ts
 *
 * Prerequisites:
 *   - OSS env vars must be set (OSS_ENDPOINT, OSS_ACCESS_KEY_ID, etc.)
 *   - DATABASE_URL must point to the target database
 *
 * Behavior:
 *   - Finds Users and Agents with base64 data URLs or external HTTP URLs
 *   - Downloads/decodes → processes (192x192 PNG) → uploads to OSS → updates DB
 *   - Skips records that already have OSS URLs (idempotent)
 *   - Logs errors but continues processing other records
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { isOssConfigured } from "../src/lib/r2";
import {
  uploadUserAvatar,
  uploadAgentAvatar,
  decodeBase64Avatar,
  isEmojiAvatar,
} from "../src/lib/avatar";

function createPrisma() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

const prisma = createPrisma();

const ossPublicUrl = process.env.OSS_PUBLIC_URL || "";

function isOssUrl(url: string): boolean {
  return ossPublicUrl ? url.startsWith(ossPublicUrl) : false;
}

function isBase64(url: string): boolean {
  return url.startsWith("data:");
}

function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

async function fetchExternalImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (e) {
    console.error(`  Failed to fetch ${url}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

async function migrateUsers() {
  const users = await prisma.user.findMany({
    where: { avatar: { not: null } },
    select: { id: true, username: true, avatar: true },
  });

  console.log(`\nFound ${users.length} users with avatars`);
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    const avatar = user.avatar!;

    // Skip OSS URLs (already migrated) and emojis
    if (isOssUrl(avatar) || isEmojiAvatar(avatar)) {
      skipped++;
      continue;
    }

    console.log(`  Migrating user ${user.username} (${user.id})...`);

    try {
      let buffer: Buffer | null = null;

      if (isBase64(avatar)) {
        const decoded = decodeBase64Avatar(avatar);
        buffer = decoded?.buffer ?? null;
      } else if (isExternalUrl(avatar)) {
        buffer = await fetchExternalImage(avatar);
      }

      if (!buffer) {
        console.error(`  Skipping user ${user.id}: could not decode/fetch avatar`);
        failed++;
        continue;
      }

      const url = await uploadUserAvatar(user.id, buffer);
      if (!url) {
        console.error(`  Skipping user ${user.id}: OSS upload returned null`);
        failed++;
        continue;
      }

      await prisma.user.update({ where: { id: user.id }, data: { avatar: url } });
      migrated++;
      console.log(`  ✓ User ${user.username} migrated`);
    } catch (e) {
      console.error(`  ✗ User ${user.id} failed:`, e instanceof Error ? e.message : e);
      failed++;
    }
  }

  console.log(`Users: ${migrated} migrated, ${skipped} skipped, ${failed} failed`);
}

async function migrateAgents() {
  const agents = await prisma.agent.findMany({
    where: { avatar: { not: null } },
    select: { id: true, name: true, avatar: true },
  });

  console.log(`\nFound ${agents.length} agents with avatars`);
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const agent of agents) {
    const avatar = agent.avatar!;

    // Skip OSS URLs (already migrated) and emojis (keep as-is)
    if (isOssUrl(avatar) || isEmojiAvatar(avatar)) {
      skipped++;
      continue;
    }

    console.log(`  Migrating agent ${agent.name} (${agent.id})...`);

    try {
      let buffer: Buffer | null = null;

      if (isBase64(avatar)) {
        const decoded = decodeBase64Avatar(avatar);
        buffer = decoded?.buffer ?? null;
      } else if (isExternalUrl(avatar)) {
        buffer = await fetchExternalImage(avatar);
      }

      if (!buffer) {
        console.error(`  Skipping agent ${agent.id}: could not decode/fetch avatar`);
        failed++;
        continue;
      }

      const url = await uploadAgentAvatar(agent.id, buffer);
      if (!url) {
        console.error(`  Skipping agent ${agent.id}: OSS upload returned null`);
        failed++;
        continue;
      }

      await prisma.agent.update({ where: { id: agent.id }, data: { avatar: url } });
      migrated++;
      console.log(`  ✓ Agent ${agent.name} migrated`);
    } catch (e) {
      console.error(`  ✗ Agent ${agent.id} failed:`, e instanceof Error ? e.message : e);
      failed++;
    }
  }

  console.log(`Agents: ${migrated} migrated, ${skipped} skipped, ${failed} failed`);
}

async function main() {
  console.log("=== Avatar Migration to OSS ===\n");

  if (!isOssConfigured()) {
    console.error("ERROR: OSS is not configured. Set OSS_ENDPOINT, OSS_ACCESS_KEY_ID, OSS_SECRET_ACCESS_KEY, OSS_BUCKET_NAME, OSS_PUBLIC_URL.");
    process.exit(1);
  }

  console.log(`OSS public URL: ${ossPublicUrl}`);

  await migrateUsers();
  await migrateAgents();

  console.log("\n=== Migration complete ===");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
