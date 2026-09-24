// POST /api/search/reindex — полная переиндексация товаров в Meilisearch.
// Только для администраторов. Запускать после деплоя или при рассинхроне индекса.
import { NextRequest, NextResponse } from "next/server";
import { reindexAllProducts, initMeilisearchIndexes } from "@/lib/meilisearch";
import { getUserFromRequest } from "@/lib/auth";
import { verifyCronSecret } from "@/lib/cron-auth";

export async function POST(request: NextRequest) {
  try {
    // Два способа авторизации:
    // 1. Cron secret (для n8n / scheduled reindex)
    // 2. Admin user (для ручного запуска из админки)
    const isCron = verifyCronSecret(request);
    if (!isCron) {
      const user = await getUserFromRequest(request);
      if (!user || !user.roles.includes("ADMIN")) {
        return NextResponse.json({ error: "Unauthorized — admin only" }, { status: 403 });
      }
    }

    // Инициализируем индексы (создаёт если нет, обновляет конфиг)
    await initMeilisearchIndexes();

    // Полная переиндексация
    const count = await reindexAllProducts();

    return NextResponse.json({
      success: true,
      reindexed: count,
      message: `Переиндексировано ${count} товаров`,
    });
  } catch (error) {
    console.error("POST /api/search/reindex error:", error);
    return NextResponse.json(
      { error: "Reindex failed", message: (error as Error).message },
      { status: 500 }
    );
  }
}
