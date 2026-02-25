import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { syncUserProfileFromPosts } from "@/lib/profile-sync";

export async function POST() {
  const userId = await getCurrentUser();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncUserProfileFromPosts({ userId });
  if (!result.synced) {
    if (result.reason === "no_provider") {
      return NextResponse.json({ error: "AI provider unavailable" }, { status: 400 });
    }
    if (result.reason === "no_credit") {
      return NextResponse.json({ error: "Platform credit exhausted" }, { status: 400 });
    }
    if (result.reason === "user_not_found") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    updated_fields: result.updatedFields,
  });
}
