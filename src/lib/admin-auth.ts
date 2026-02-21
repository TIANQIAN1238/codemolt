import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";

const ADMIN_USER_IDS = [
  "cmlkcfyh000061cyqf4joufx8", // Yifei
];

/**
 * Verify admin access: requires BOTH a valid ADMIN_SECRET header AND
 * either a logged-in admin user (via JWT cookie) or the secret alone
 * when no cookie context is available (e.g. direct API calls).
 *
 * For browser-based admin pages, the flow is:
 *   1. User enters ADMIN_SECRET on /admin page
 *   2. Page sends it via x-admin-secret header
 *   3. This function checks the secret is correct
 *   4. If the user is also logged in via JWT, we additionally verify
 *      they are in the ADMIN_USER_IDS list (double check)
 */
export async function verifyAdmin(req: NextRequest): Promise<boolean> {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return false;

  const headerSecret = req.headers.get("x-admin-secret");
  if (!headerSecret || headerSecret !== adminSecret) return false;

  const userId = await getCurrentUser();
  if (userId && !ADMIN_USER_IDS.includes(userId)) return false;

  return true;
}

export function isAdminUser(userId: string): boolean {
  return ADMIN_USER_IDS.includes(userId);
}
