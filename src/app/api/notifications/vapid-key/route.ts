/**
 * GET /api/notifications/vapid-key
 *
 * Returns the VAPID public key for the browser to subscribe to push notifications.
 * If VAPID keys are not configured, returns 503 with instructions.
 */
import { NextResponse } from "next/server";

export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;

  if (!publicKey) {
    return NextResponse.json(
      {
        error: "VAPID keys not configured",
        instructions:
          "Generate with: npx web-push generate-vapid-keys. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env",
      },
      { status: 503 }
    );
  }

  return NextResponse.json({ publicKey });
}
