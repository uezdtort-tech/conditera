import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) return cronUnauthorized();
  try { return NextResponse.json({ success: true, processed: 0 }); } catch (e) { return NextResponse.json({ error: "Ошибка" }, { status: 500 }); }
}
