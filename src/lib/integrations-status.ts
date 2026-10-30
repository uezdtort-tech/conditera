/**
 * integrations-status.ts — единая точка определения статуса внешних интеграций.
 *
 * Зачем: дополнение к master prompt (§9) требует вести статусы для КАЖДОГО
 * внешнего сервиса (NOT_CONFIGURED / IMPLEMENTED / ...). Ops-центр админа
 * показывает живой статус конфигурации; раньше проверялись только YooKassa
 * и n8n, а OAuth-провайдеры, SMTP и Telegram были невидимы для админа.
 *
 * Правила детекции соответствуют логике самих адаптеров:
 *  - OAuth (/api/auth/oauth/[provider]): value отсутствует ИЛИ начинается
 *    с "stub_" → провайдер считается НЕ настроенным;
 *  - Email (lib/email.ts): SMTP_HOST отсутствует → NOT_CONFIGURED;
 *  - Telegram (lib/telegram-bot.ts): TELEGRAM_BOT_TOKEN отсутствует → NOT_CONFIGURED;
 *  - YooKassa (lib/yookassa.ts): isYookassaConfigured().
 *
 * Здесь только НАЛИЧИЕ/ОТСУТСТВИЕ конфигурации — значения секретов
 * никогда не возвращаются (правило «в отчёте только факт наличия»).
 */

function isConfigured(value: string | undefined | null): boolean {
  return !!value && value.trim() !== "" && !value.startsWith("stub_");
}

export interface OAuthProvidersStatus {
  yandex: boolean;
  google: boolean;
  vk: boolean;
}

export interface IntegrationsStatus {
  oauth: OAuthProvidersStatus;
  email: boolean;
  telegram: boolean;
}

export function getIntegrationsStatus(): IntegrationsStatus {
  return {
    oauth: {
      yandex: isConfigured(process.env.YANDEX_CLIENT_ID),
      google: isConfigured(process.env.GOOGLE_CLIENT_ID),
      vk: isConfigured(process.env.VK_CLIENT_ID),
    },
    email: isConfigured(process.env.SMTP_HOST),
    telegram: isConfigured(process.env.TELEGRAM_BOT_TOKEN),
  };
}

/** Число настроенных интеграций (для сводных бейджей). */
export function countConfiguredIntegrations(s: IntegrationsStatus): number {
  return (
    Object.values(s.oauth).filter(Boolean).length +
    (s.email ? 1 : 0) +
    (s.telegram ? 1 : 0)
  );
}
