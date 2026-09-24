/**
 * Auto-approve кондитеров с подтверждённой организацией через DaData.
 *
 * Логика:
 *  - Если кондитер зарегистрирован как ИП или ООО (не физлицо)
 *  - И его ИНН указан в legalInfo.inn
 *  - И DaData подтверждает, что организация ACTIVE
 *  - И у кондитера заполнен профиль (название, описание, аватар, 3+ портфолио)
 *  → автоматически подтверждаем verificationStatus = "approved"
 *
 * В остальных случаях — оставляем pending для ручной модерации.
 *
 * Триггеры:
 *  - При регистрации кондитера (если сразу заполнен профиль)
 *  - При повторной отправке на модерацию
 *  - По cron (опционально) для всех pending с заполненным профилем
 *
 * Безопасность:
 *   • Все запросы используют supabaseAdmin напрямую.
 *   • legalInfo валидируется через type narrowing (не raw any).
 *   • При ошибке DaData возвращаем { autoApproved: false } без исключения —
 *     пусть cron продолжит работу со следующими кондитерами.
 */

import { supabaseAdmin } from "./supabase/admin";

export interface AutoApproveResult {
  autoApproved: boolean;
  reason?: string;
  confectionerId: string;
  verificationStatus: string;
}

interface ConfectionerRow {
  id: string;
  businessName: string | null;
  description: string | null;
  avatar: string | null;
  city: string | null;
  legalInfo: unknown;
  taxMode: string | null;
  portfolioImages: string[] | null;
  verificationStatus: string | null;
}

interface LegalInfo {
  status?: string;
  inn?: string;
  type?: string;
}

interface SupabaseError {
  message: string;
}

/**
 * Безопасное приведение legalInfo (jsonb) к LegalInfo.
 */
function coerceLegalInfo(raw: unknown): LegalInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  return {
    status: typeof obj.status === "string" ? obj.status : undefined,
    inn: typeof obj.inn === "string" ? obj.inn : undefined,
    type: typeof obj.type === "string" ? obj.type : undefined,
  };
}

/**
 * Проверить, можно ли авто-подтвердить кондитера.
 */
export async function tryAutoApprove(confectionerId: string): Promise<AutoApproveResult> {
  const { data: confRow, error } = await supabaseAdmin
    .from("confectioners")
    .select(`
      id, businessName, description, avatar, city,
      legalInfo, taxMode, portfolioImages, verificationStatus
    `)
    .eq("id", confectionerId)
    .maybeSingle() as { data: ConfectionerRow | null; error: SupabaseError | null };

  if (error) {
    console.error("[auto-approve] lookup failed:", error.message);
    return {
      autoApproved: false,
      reason: `Ошибка БД: ${error.message}`,
      confectionerId,
      verificationStatus: "pending",
    };
  }

  if (!confRow) {
    return {
      autoApproved: false,
      reason: "Кондитер не найден",
      confectionerId,
      verificationStatus: "pending",
    };
  }

  const verificationStatus = confRow.verificationStatus || "pending";

  // Уже подтверждён?
  if (verificationStatus === "approved") {
    return {
      autoApproved: true,
      reason: "Уже подтверждён",
      confectionerId,
      verificationStatus: "approved",
    };
  }

  // Проверка полноты профиля
  const portfolioImages = confRow.portfolioImages || [];
  const profileChecks: Array<{ ok: boolean; msg: string }> = [
    { ok: !!confRow.businessName, msg: "Нет названия бизнеса" },
    {
      ok: !!confRow.description && confRow.description.length >= 30,
      msg: "Описание короче 30 символов",
    },
    { ok: !!confRow.avatar, msg: "Нет аватара" },
    { ok: !!confRow.city, msg: "Нет города" },
    { ok: portfolioImages.length >= 3, msg: "Меньше 3 фото в портфолио" },
  ];
  for (const check of profileChecks) {
    if (!check.ok) {
      return {
        autoApproved: false,
        reason: `Профиль не заполнен: ${check.msg}`,
        confectionerId,
        verificationStatus,
      };
    }
  }

  // Проверка юр.статуса — авто-approve только для ИП и ООО
  const legal = coerceLegalInfo(confRow.legalInfo);
  if (!legal) {
    return {
      autoApproved: false,
      reason: "Нет юридической информации",
      confectionerId,
      verificationStatus,
    };
  }

  // Физлица не могут быть авто-подтверждены
  if (legal.status === "PHYSICAL" || confRow.taxMode === "SELF_EMPLOYED") {
    return {
      autoApproved: false,
      reason: "Физлица требуют ручной модерации",
      confectionerId,
      verificationStatus,
    };
  }

  // Нужен ИНН для проверки через DaData
  if (!legal.inn) {
    return {
      autoApproved: false,
      reason: "Не указан ИНН для проверки через DaData",
      confectionerId,
      verificationStatus,
    };
  }

  // Проверяем через DaData
  try {
    const { verifyOrganization } = await import("./dadata");
    const verification = await verifyOrganization(legal.inn);

    if (!verification.isAllowed) {
      return {
        autoApproved: false,
        reason: `Организация недействующая: ${verification.reason || "статус не ACTIVE"}`,
        confectionerId,
        verificationStatus,
      };
    }

    if (verification.status !== "ACTIVE") {
      return {
        autoApproved: false,
        reason: `Статус организации: ${verification.status}`,
        confectionerId,
        verificationStatus,
      };
    }

    // Всё хорошо — авто-подтверждаем
    const { error: updateErr } = await supabaseAdmin
      .from("confectioners")
      .update({
        verified: true,
        verificationStatus: "approved",
        verifiedBy: "system_auto",
        verifiedAt: new Date().toISOString(),
        rejectionReason: null,
      })
      .eq("id", confectionerId);

    if (updateErr) {
      console.error("[auto-approve] update failed:", updateErr.message);
      return {
        autoApproved: false,
        reason: `Ошибка при обновлении: ${updateErr.message}`,
        confectionerId,
        verificationStatus,
      };
    }

    // Email-уведомление
    try {
      const { sendConfectionerVerificationEmail } = await import("./email-confectioner");
      await sendConfectionerVerificationEmail(confectionerId, "approved");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[auto-approve] Email failed:", msg);
    }

    console.info(
      `[auto-approve] ✓ Confectioner ${confRow.businessName} auto-approved via DaData (INN: ${legal.inn})`
    );

    return {
      autoApproved: true,
      reason: `Авто-подтверждено через DaData (ИНН ${legal.inn}, статус ACTIVE)`,
      confectionerId,
      verificationStatus: "approved",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[auto-approve] DaData check failed:", msg);
    return {
      autoApproved: false,
      reason: `Ошибка DaData: ${msg}`,
      confectionerId,
      verificationStatus,
    };
  }
}

/**
 * Cron-задача: проверить все pending-кондитеров на авто-подтверждение.
 * Запускать через /api/cron/auto-approve (каждые 30 минут).
 *
 * Safety: один сбойший кондитер не прерывает цикл —
 * логируем и переходим к следующему.
 */
export async function autoApproveAllPending(): Promise<{
  checked: number;
  autoApproved: number;
  failed: number;
  details: AutoApproveResult[];
}> {
  const { data: pendingRows, error } = await supabaseAdmin
    .from("confectioners")
    .select("id")
    .eq("verificationStatus", "pending") as { data: Array<{ id: string }> | null; error: SupabaseError | null };

  if (error) {
    console.error("[auto-approve] list pending failed:", error.message);
    return { checked: 0, autoApproved: 0, failed: 0, details: [] };
  }

  const pendingConfectioners = pendingRows || [];
  const details: AutoApproveResult[] = [];
  let autoApproved = 0;
  let failed = 0;

  for (const conf of pendingConfectioners) {
    try {
      const result = await tryAutoApprove(conf.id);
      details.push(result);
      if (result.autoApproved) {
        autoApproved++;
      }
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[auto-approve] Failed for ${conf.id}:`, msg);
    }
  }

  return {
    checked: pendingConfectioners.length,
    autoApproved,
    failed,
    details,
  };
}
