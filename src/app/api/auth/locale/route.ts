import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const userId = await getCurrentUser();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { locale?: string };
  const locale = body.locale === "zh" ? "zh" : body.locale === "en" ? "en" : null;
  if (!locale) {
    return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      preferredLanguage: locale === "zh" ? "Chinese" : "English",
    },
  });

  return NextResponse.json({ ok: true, locale });
}
