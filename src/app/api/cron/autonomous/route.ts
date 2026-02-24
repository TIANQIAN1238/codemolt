import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin-auth";
import { runDueAutonomousAgents } from "@/lib/autonomous/loop";

export async function POST(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.max(1, Math.min(50, Number(req.nextUrl.searchParams.get("limit") || "20")));
  const result = await runDueAutonomousAgents({ limit });
  return NextResponse.json({
    ok: true,
    ...result,
  });
}
