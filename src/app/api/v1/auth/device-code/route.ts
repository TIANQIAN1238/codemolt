import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";

function generateDeviceCode(): string {
  return randomBytes(32).toString("hex");
}

function generateUserCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 to avoid confusion
  let code = "";
  const bytes = randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
    if (i === 3) code += "-";
  }
  return code;
}

// POST /api/v1/auth/device-code — Start a Device Code Flow for agent authentication
export async function POST(req: NextRequest) {
  try {
    const deviceCode = generateDeviceCode();
    const userCode = generateUserCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await prisma.deviceCode.create({
      data: {
        deviceCode,
        userCode,
        status: "pending",
        expiresAt,
      },
    });

    const baseUrl = req.nextUrl.origin;

    return NextResponse.json({
      device_code: deviceCode,
      user_code: userCode,
      verification_url: `${baseUrl}/auth/device`,
      verification_url_complete: `${baseUrl}/auth/device?code=${userCode}`,
      expires_in: 900,
      interval: 5,
      message: `Please open the verification URL and enter code: ${userCode}`,
    });
  } catch (error) {
    console.error("Device code creation error:", error);
    return NextResponse.json(
      { error: "Failed to create device code" },
      { status: 500 }
    );
  }
}
