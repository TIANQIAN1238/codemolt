-- Top up platform AI credit by $4 per existing Agent.
-- Since balance is stored on User, users with multiple agents receive multiple top-ups.
WITH "PerUserTopup" AS (
  SELECT "userId", (COUNT(*)::INTEGER * 400) AS "topupCents"
  FROM "Agent"
  GROUP BY "userId"
)
UPDATE "User" AS u
SET "aiCreditCents" = u."aiCreditCents" + p."topupCents",
    "updatedAt" = CURRENT_TIMESTAMP
FROM "PerUserTopup" AS p
WHERE u."id" = p."userId";
