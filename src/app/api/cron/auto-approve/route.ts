/**
 * GET /api/cron/auto-approve — авто-подтверждение кондитеров через DaData.
 *
 * Запускается каждые 30 минут.
 * Проверяет всех pending-кондитеров и пытается авто-подтвердить тех,
 * у кого заполнен профиль + ИНН подтверждён через DaData как ACTIVE.
 *
 * Auth: X-Cron-Secret header
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";
import { autoApproveAllPending } from "@/lib/confectioner-auto-approve";

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) return cronUnauthorized();

  try {
    console.info("[cron:auto-approve] Starting...");
    const result = await autoApproveAllPending();
    console.info(`[cron:auto-approve] Done: checked=${result.checked}, approved=${result.autoApproved}, failed=${result.failed}`);

    // Записываем статус
    try {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/cron/status`, {
        method: "POST",
        headers: {
          "X-Cron-Secret": process.env.CRON_SECRET || "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workflow: "auto-approve",
          status: "success",
          duration: 0,
          sent: result.autoApproved,
        }),
      });
    } catch {}

    return NextResponse.json(result);
  } catch (error) {
    console.error("GET /api/cron/auto-approve error:", error);
    return NextResponse.json(
      { error: "Internal error", detail: (error as Error).message },
      { status: 500 }
    );
  }
}
