/**
 * POST /api/telegram/setup-webhook — регистрирует webhook в Telegram.
 * Запускать после деплоя: curl -X POST https://conditera.ru/api/telegram/setup-webhook
 *
 * Auth: cron-secret ИЛИ ADMIN role.
 *
 * Безопасность:
 *   • Авторизация через verifyCronSecret или getUserFromRequest с ролью ADMIN.
 *   • Параллельные запросы: getBotInfo + setWebhook + setBotCommands через Promise.all.
 *   • Тестовое сообщение в канал (если TELEGRAM_CHANNEL_ID задан).
 *   • При сбое — 500 с message.
 */
import { NextRequest, NextResponse } from "next/server";
import { setWebhook, setBotCommands, getBotInfo, sendToChannel } from "@/lib/telegram-bot";
import { verifyCronSecret } from "@/lib/cron-auth";
import { getUserFromRequest } from "@/lib/auth";
import { HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface BotInfo {
  username?: string;
  first_name?: string;
  can_join_groups?: boolean;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Авторизация: cron-secret или админ
    const isCron = verifyCronSecret(request);
    if (!isCron) {
      const user = await getUserFromRequest(request);
      if (!user || !user.roles.includes("ADMIN")) {
        throw new HttpError(403, "Unauthorized");
      }
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://conditera.ru";
    const webhookUrl = `${appUrl}/api/telegram/webhook`;

    // Параллельно: проверка бота, установка webhook, установка команд
    const [botInfo, webhookResult, commandsResult] = await Promise.all([
      getBotInfo() as Promise<BotInfo | null>,
      setWebhook(webhookUrl) as Promise<boolean>,
      setBotCommands() as Promise<boolean>,
    ]);

    // Тестовое сообщение в канал
    let channelTest = false;
    if (process.env.TELEGRAM_CHANNEL_ID) {
      channelTest = await sendToChannel(
        `🤖 <b>Бот активирован</b>\n\nWebhook: ${webhookUrl}\nВремя: ${new Date().toLocaleString("ru-RU")}`
      ) as boolean;
    }

    return NextResponse.json({
      success: true,
      bot: botInfo
        ? {
            username: botInfo.username,
            firstName: botInfo.first_name,
            canJoinGroups: botInfo.can_join_groups,
          }
        : null,
      webhook: {
        url: webhookUrl,
        set: webhookResult,
      },
      commands: commandsResult,
      channelTest,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
