#!/usr/bin/env node
/**
 * SQLite → PostgreSQL 一次性迁移脚本
 * 在 Zeabur 生产容器里运行：
 *   node scripts/migrate-sqlite-to-pg.mjs
 *
 * 环境变量：
 *   SQLITE_PATH  — SQLite 文件路径（默认 /data/codemolt.db）
 *   PG_URL       — PostgreSQL 连接字符串
 */

import Database from "better-sqlite3";
import pg from "pg";

const SQLITE_PATH = process.env.SQLITE_PATH || "/data/codemolt.db";
const PG_URL = process.env.PG_URL;

if (!PG_URL) {
  console.error("❌ 请设置 PG_URL 环境变量");
  process.exit(1);
}

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const client = new pg.Client({ connectionString: PG_URL });

function readAll(table) {
  try {
    return sqlite.prepare(`SELECT * FROM "${table}"`).all();
  } catch {
    return [];
  }
}

function esc(val) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean" || typeof val === "number") return String(val);
  // SQLite stores booleans as 0/1
  return `'${String(val).replace(/'/g, "''")}'`;
}

// SQLite stores booleans as integers; convert for PG
function toBool(v) {
  if (v === 1 || v === true) return "TRUE";
  if (v === 0 || v === false) return "FALSE";
  return "FALSE";
}

// Migrate a table: read from SQLite, insert into PG
async function migrateTable(tableName, columns, boolCols = []) {
  const rows = readAll(tableName);
  if (rows.length === 0) {
    console.log(`  ${tableName}: 0 rows (skip)`);
    return 0;
  }

  for (const row of rows) {
    const vals = columns.map((col) => {
      const v = row[col];
      if (boolCols.includes(col)) return toBool(v);
      return esc(v);
    });
    const sql = `INSERT INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${vals.join(", ")}) ON CONFLICT DO NOTHING`;
    await client.query(sql);
  }

  console.log(`  ${tableName}: ${rows.length} rows migrated`);
  return rows.length;
}

async function main() {
  console.log("Connecting to PostgreSQL...");
  await client.connect();

  // 1. Create schema via Prisma migration SQL
  console.log("Creating schema (0_init)...");
  const fs = await import("fs");
  const path = await import("path");
  const initSql = fs.readFileSync(
    path.join(process.cwd(), "prisma/migrations/0_init/migration.sql"),
    "utf-8"
  );
  await client.query(initSql);
  console.log("Schema created.\n");

  // 2. Migrate tables in dependency order
  console.log("Migrating data...");

  await migrateTable("User", [
    "id", "email", "username", "password", "avatar", "bio",
    "provider", "providerId", "preferredLanguage", "createdAt", "updatedAt",
  ]);

  await migrateTable("OAuthAccount", [
    "id", "provider", "providerId", "email", "createdAt", "userId",
  ]);

  await migrateTable("Agent", [
    "id", "name", "description", "sourceType", "avatar", "apiKey",
    "claimed", "claimToken", "activated", "activateToken",
    "defaultLanguage", "createdAt", "updatedAt", "userId",
  ], ["claimed", "activated"]);

  await migrateTable("Category", [
    "id", "name", "slug", "description", "emoji", "createdAt",
  ]);

  await migrateTable("Post", [
    "id", "title", "content", "summary", "tags", "language",
    "upvotes", "downvotes", "humanUpvotes", "humanDownvotes", "views",
    "banned", "bannedAt", "createdAt", "updatedAt", "agentId", "categoryId",
  ], ["banned"]);

  await migrateTable("Comment", [
    "id", "content", "likes", "createdAt", "updatedAt",
    "userId", "agentId", "postId", "parentId",
  ]);

  await migrateTable("Vote", [
    "id", "value", "userId", "postId", "createdAt",
  ]);

  await migrateTable("Bookmark", [
    "id", "createdAt", "userId", "postId",
  ]);

  await migrateTable("CommentLike", [
    "id", "createdAt", "userId", "commentId",
  ]);

  await migrateTable("Debate", [
    "id", "title", "description", "proLabel", "conLabel",
    "status", "closesAt", "createdAt", "updatedAt",
  ]);

  await migrateTable("DebateEntry", [
    "id", "side", "content", "nickname", "isAgent",
    "upvotes", "downvotes", "createdAt", "debateId", "agentId", "userId",
  ], ["isAgent"]);

  await migrateTable("Notification", [
    "id", "type", "message", "read", "createdAt",
    "userId", "postId", "commentId", "fromUserId",
  ], ["read"]);

  await migrateTable("Follow", [
    "id", "createdAt", "followerId", "followingId",
  ]);

  // 3. Mark the migration as applied so prisma migrate deploy won't re-run it
  await client.query(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) NOT NULL PRIMARY KEY,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `);
  await client.query(`
    INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "finished_at", "applied_steps_count")
    VALUES (gen_random_uuid(), 'manual-migration', '0_init', now(), 1)
    ON CONFLICT DO NOTHING
  `);

  console.log("\n✅ Migration complete!");
  await client.end();
  sqlite.close();
}

main().catch((e) => { console.error("❌ Migration failed:", e); process.exit(1); });
