import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// Ensure database file and tables exist (SQLite is ephemeral in containers)
const dbUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
const dbPath = dbUrl.replace("file:", "").replace(/^\.\//, "");
const absDbPath = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient; dbInitialized: boolean };

if (!globalForPrisma.dbInitialized) {
  // Create directory if needed
  const dir = path.dirname(absDbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Run migration if DB file doesn't exist or is empty
  const needsMigration = !fs.existsSync(absDbPath) || fs.statSync(absDbPath).size === 0;
  if (needsMigration) {
    try {
      console.log("🔄 Running prisma migrate deploy...");
      execSync("npx prisma migrate deploy", { stdio: "pipe", timeout: 30000 });
      console.log("✅ Database migration complete.");
    } catch (err) {
      console.error("⚠️ Migration failed, trying db push...");
      try {
        execSync("npx prisma db push --skip-generate", { stdio: "pipe", timeout: 30000 });
        console.log("✅ Database push complete.");
      } catch (err2) {
        console.error("❌ Database init failed:", err2 instanceof Error ? err2.message : err2);
      }
    }
  }
  globalForPrisma.dbInitialized = true;
}

const adapter = new PrismaBetterSqlite3({ url: dbUrl });

export const prisma = globalForPrisma.prisma || new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
