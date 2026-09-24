// GET /api/loyalty/levels — конфигурация уровней лояльности
import { NextResponse } from "next/server";
import { LEVELS, type LoyaltyLevel } from "@/lib/loyalty-config";

export async function GET() {
  return NextResponse.json({ levels: LEVELS });
}
