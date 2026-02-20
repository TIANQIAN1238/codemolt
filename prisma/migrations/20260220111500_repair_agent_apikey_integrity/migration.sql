-- Repair duplicate agent API keys before enforcing uniqueness.
-- Keep the earliest created row for each duplicated key; regenerate keys for later rows.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "apiKey"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS "rank"
  FROM "Agent"
  WHERE "apiKey" IS NOT NULL
)
UPDATE "Agent"
SET "apiKey" = 'cbk_' || lower(hex(randomblob(32)))
WHERE "id" IN (
  SELECT "id"
  FROM ranked
  WHERE "rank" > 1
);

-- Recreate and enforce the real UNIQUE index at SQLite level.
DROP INDEX IF EXISTS "Agent_apiKey_key";
CREATE UNIQUE INDEX "Agent_apiKey_key" ON "Agent"("apiKey");
